import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const ALLOWED_ORIGINS = new Set([
  "https://arsazet17.github.io",
  "http://localhost:5173",
  "http://127.0.0.1:5173"
]);

const BASELINE = 20 / 80;
const PRIOR_WEIGHT = 40;
const validNumber = (n: number) => Number.isInteger(n) && n >= 1 && n <= 80;
const columnOf = (n: number) => n % 10 === 0 ? 10 : n % 10;

function responseHeaders(origin: string) {
  return {
    "content-type": "application/json",
    "Access-Control-Allow-Origin": origin || "https://arsazet17.github.io",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin"
  };
}

function json(body: unknown, status: number, origin: string) {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders(origin) });
}

function cleanNumbers(input: unknown): number[] {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.map(Number).filter(validNumber))];
}

function frequentFromShots(shots: any[]) {
  const freq = new Map<number, number>();
  const usable: number[][] = [];
  for (const shot of shots || []) {
    const nums = cleanNumbers(shot?.ocr_numbers);
    if (nums.length !== 10) continue;
    usable.push(nums);
    for (const n of nums) freq.set(n, (freq.get(n) || 0) + 1);
  }
  const ranked = [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 8);
  const counts: Record<string, number> = {};
  for (const [n, count] of ranked) counts[String(n)] = count;
  return { usable, numbers: ranked.map(([n]) => n), counts };
}

function aggregate(rows: any[]) {
  const out = {
    cycles: 0,
    direct: { candidates: 0, hits: 0 },
    neighbor1: { candidates: 0, hits: 0 },
    neighbor2: { candidates: 0, hits: 0 },
    sameColumn: { candidates: 0, hits: 0 },
    cold: { candidates: 0, hits: 0 }
  };
  for (const row of rows || []) {
    const s = row?.features?.relation_stats;
    if (!s) continue;
    out.cycles++;
    out.direct.candidates += Number(s?.tier_counts?.direct || 0);
    out.direct.hits += Number(s?.tier_hits?.direct || 0);
    out.neighbor1.candidates += Number(s?.tier_counts?.neighbor_1 || 0);
    out.neighbor1.hits += Number(s?.tier_hits?.neighbor_1 || 0);
    out.neighbor2.candidates += Number(s?.tier_counts?.neighbor_2 || 0);
    out.neighbor2.hits += Number(s?.tier_hits?.neighbor_2 || 0);
    out.sameColumn.candidates += Number(s?.tier_counts?.same_column || 0);
    out.sameColumn.hits += Number(s?.tier_hits?.same_column || 0);
    out.cold.candidates += Number(s?.tier_counts?.cold || 0);
    out.cold.hits += Number(s?.tier_hits?.cold || 0);
  }
  return out;
}

function smoothedRate(item: { candidates: number; hits: number }) {
  return (Number(item?.hits || 0) + BASELINE * PRIOR_WEIGHT) /
    (Number(item?.candidates || 0) + PRIOR_WEIGHT);
}

function currentProfile(number: number, usable: number[][]) {
  const n1 = [number - 1, number + 1].filter(validNumber);
  const n2 = [number - 2, number + 2].filter(validNumber);
  const exactShots = usable.filter(nums => nums.includes(number)).length;
  const neighbor1Shots = usable.filter(nums => nums.some(v => n1.includes(v))).length;
  const neighbor2Shots = usable.filter(nums => nums.some(v => n2.includes(v))).length;
  const sameColumnShots = usable.filter(nums => nums.some(v => v !== number && columnOf(v) === columnOf(number))).length;
  let tier = "cold";
  let supportShots = 0;
  if (exactShots > 0) { tier = "direct"; supportShots = exactShots; }
  else if (neighbor1Shots > 0) { tier = "neighbor_1"; supportShots = neighbor1Shots; }
  else if (neighbor2Shots > 0) { tier = "neighbor_2"; supportShots = neighbor2Shots; }
  else if (sameColumnShots > 0) { tier = "same_column"; supportShots = sameColumnShots; }
  return { number, tier, supportShots };
}

function buildForecast(usable: number[][], historyRows: any[]) {
  const stats = aggregate(historyRows);
  const byTier: Record<string, { candidates: number; hits: number }> = {
    direct: stats.direct,
    neighbor_1: stats.neighbor1,
    neighbor_2: stats.neighbor2,
    same_column: stats.sameColumn,
    cold: stats.cold
  };
  const ranked = Array.from({ length: 80 }, (_, i) => currentProfile(i + 1, usable)).map(p => {
    const hist = byTier[p.tier] || { candidates: 0, hits: 0 };
    const learnedRate = smoothedRate(hist);
    const supportShare = p.supportShots / usable.length;
    const index = 100 * (learnedRate / BASELINE) + 12 * supportShare;
    return { ...p, index };
  }).sort((a, b) => b.index - a.index || b.supportShots - a.supportShots || a.number - b.number);
  const top = ranked.slice(0, 10);
  return {
    cycles: stats.cycles,
    combo: top.map(x => x.number),
    candidates: top.map(x => ({ number: x.number, relation: x.tier, index: Number(x.index.toFixed(4)) }))
  };
}

async function saveForecast(db: any, target: number) {
  if (!Number.isInteger(target) || target <= 0) {
    return { status: 400, body: { ok: false, error: "valid target_draw_number is required" } };
  }

  const { data: fact, error: factError } = await db
    .from("draws")
    .select("draw_number,result_numbers")
    .eq("draw_number", target)
    .maybeSingle();
  if (factError) throw factError;

  if (fact && cleanNumbers(fact.result_numbers).length === 20) {
    const { data: frozen, error: frozenError } = await db
      .from("possible_output_archive")
      .select("*")
      .eq("target_draw_number", target)
      .maybeSingle();
    if (frozenError) throw frozenError;
    return {
      status: frozen ? 200 : 409,
      body: {
        ok: Boolean(frozen),
        locked: true,
        forecast: frozen || null,
        error: frozen ? null : "fact already exists; forecast cannot be created after the draw"
      }
    };
  }

  const { data: shots, error: screenshotError } = await db
    .from("screenshots")
    .select("id,ocr_numbers,created_at")
    .eq("target_draw_number", target)
    .eq("ocr_status", "verified")
    .order("created_at", { ascending: true });
  if (screenshotError) throw screenshotError;

  const frequent = frequentFromShots(shots || []);
  if (!frequent.usable.length) {
    return { status: 409, body: { ok: false, error: "no verified screenshots for target draw" } };
  }

  const { data: historyRows, error: historyError } = await db
    .from("learning_observations")
    .select("target_draw_number,features")
    .lt("target_draw_number", target);
  if (historyError) throw historyError;

  const forecast = buildForecast(frequent.usable, historyRows || []);
  const now = new Date().toISOString();
  const { data: saved, error: saveError } = await db
    .from("possible_output_archive")
    .upsert({
      target_draw_number: target,
      combo: forecast.combo,
      candidates: forecast.candidates,
      frequent_numbers: frequent.numbers,
      frequent_counts: frequent.counts,
      screenshot_count: frequent.usable.length,
      history_cycles: forecast.cycles,
      model_version: "virtus-possible-output-v2-auto",
      updated_at: now
    }, { onConflict: "target_draw_number" })
    .select("*")
    .single();
  if (saveError) throw saveError;

  return { status: 200, body: { ok: true, locked: false, forecast: saved } };
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin") || "";
  if (origin && !ALLOWED_ORIGINS.has(origin)) return json({ ok: false, error: "origin not allowed" }, 403, origin);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: responseHeaders(origin) });
  if (req.method !== "POST") return json({ ok: false, error: "POST required" }, 405, origin);

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(url, serviceRole, { auth: { persistSession: false } });
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "history");

    if (action === "save" || action === "auto_save") {
      const result = await saveForecast(db, Number(body?.target_draw_number));
      return json(result.body, result.status, origin);
    }

    if (action === "history") {
      const limit = Math.min(100, Math.max(1, Number(body?.limit) || 40));
      const { data: forecasts, error: archiveError } = await db
        .from("possible_output_archive")
        .select("target_draw_number,combo,candidates,frequent_numbers,frequent_counts,screenshot_count,history_cycles,model_version,created_at,updated_at")
        .order("target_draw_number", { ascending: false })
        .limit(limit);
      if (archiveError) throw archiveError;

      const targets = (forecasts || []).map((r: any) => Number(r.target_draw_number)).filter(Number.isFinite);
      const factByTarget = new Map<number, number[]>();
      if (targets.length) {
        const { data: draws, error: drawError } = await db
          .from("draws")
          .select("draw_number,result_numbers")
          .in("draw_number", targets);
        if (drawError) throw drawError;
        for (const draw of draws || []) factByTarget.set(Number(draw.draw_number), cleanNumbers(draw.result_numbers));
      }

      const rows = (forecasts || []).map((row: any) => {
        const target = Number(row.target_draw_number);
        const combo = cleanNumbers(row.combo);
        const frequentNumbers = cleanNumbers(row.frequent_numbers).slice(0, 8);
        const fact = factByTarget.get(target) || [];
        const checked = fact.length === 20;
        const factSet = new Set(fact);
        const hitNumbers = checked ? combo.filter(n => factSet.has(n)) : [];
        const frequentHitNumbers = checked ? frequentNumbers.filter(n => factSet.has(n)) : [];
        return {
          ...row,
          target_draw_number: target,
          combo,
          frequent_numbers: frequentNumbers,
          checked,
          fact_numbers: checked ? fact : [],
          hit_numbers: hitNumbers,
          hit_count: hitNumbers.length,
          frequent_hit_numbers: frequentHitNumbers,
          frequent_hit_count: frequentHitNumbers.length
        };
      });
      return json({ ok: true, forecasts: rows }, 200, origin);
    }

    return json({ ok: false, error: "unknown action" }, 400, origin);
  } catch (error) {
    return json({ ok: false, error: String((error as any)?.message ?? error) }, 500, origin);
  }
});
