import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const ALLOWED_ORIGINS = new Set([
  "https://arsazet17.github.io",
  "http://localhost:5173",
  "http://127.0.0.1:5173"
]);

const BASELINE = 20 / 80;
const PRIOR_WEIGHT = 40;
const MODEL_VERSION = "virtus-possible-output-v2-cutoff";
const SCHEDULE = [
  "00:02","00:17","00:32","01:02","01:17","01:32","02:02","02:17","02:32","03:02","03:32","04:02",
  "04:17","04:32","05:02","05:17","05:32","06:02","06:17","06:32","07:02","07:32","08:02","08:17",
  "08:32","09:02","09:17","09:32","10:02","10:17","10:32","11:02","11:32","12:02","12:17","12:32",
  "13:02","13:17","13:32","14:02","14:17","14:32","15:02","15:32","16:02","16:17","16:32","17:02",
  "17:17","17:32","18:02","18:17","18:32","19:02","19:32","20:02","20:17","20:32","21:02","21:17",
  "21:32","22:02","22:17","22:32","23:02","23:32"
];

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
  const usableShots: any[] = [];
  const usable: number[][] = [];
  for (const shot of shots || []) {
    const nums = cleanNumbers(shot?.ocr_numbers);
    if (nums.length !== 10) continue;
    usableShots.push({ ...shot, nums });
    usable.push(nums);
    for (const n of nums) freq.set(n, (freq.get(n) || 0) + 1);
  }
  const ranked = [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 8);
  const counts: Record<string, number> = {};
  for (const [n, count] of ranked) counts[String(n)] = count;
  return { usableShots, usable, numbers: ranked.map(([n]) => n), counts };
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
    if (row?.features?.anti_leakage !== true) continue;
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
    candidates: top.map(x => ({
      number: x.number,
      relation: x.tier,
      support_shots: x.supportShots,
      index: Number(x.index.toFixed(4))
    }))
  };
}

function moscowParts(value: unknown) {
  const date = new Date(String(value || ""));
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value);
  const year = get("year"), month = get("month"), day = get("day"), hour = get("hour"), minute = get("minute");
  if (![year, month, day, hour, minute].every(Number.isFinite)) return null;
  return { year, month, day, hour, minute };
}

function scheduledCutoffFromPrevious(value: unknown, steps: number) {
  const p = moscowParts(value);
  if (!p || !Number.isInteger(steps) || steps < 1) return null;
  let localDate = Date.UTC(p.year, p.month - 1, p.day);
  let current = `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;

  for (let s = 0; s < steps; s++) {
    const exact = SCHEDULE.indexOf(current);
    let nextIndex = -1;
    if (exact >= 0) {
      nextIndex = (exact + 1) % SCHEDULE.length;
      if (nextIndex === 0) localDate += 86400000;
    } else {
      const mins = p.hour * 60 + p.minute;
      nextIndex = SCHEDULE.findIndex(t => {
        const [h, m] = t.split(":").map(Number);
        return h * 60 + m > mins;
      });
      if (nextIndex < 0) {
        nextIndex = 0;
        localDate += 86400000;
      }
    }
    current = SCHEDULE[nextIndex];
  }

  const d = new Date(localDate);
  const [hour, minute] = current.split(":").map(Number);
  return new Date(Date.UTC(
    d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour - 3, minute, 0, 0
  )).toISOString();
}

async function resolveCutoff(db: any, target: number, fact: any) {
  const direct = fact?.draw_time || fact?.raw?.official_draw_time;
  if (direct) {
    const d = new Date(direct);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }

  const { data: prev, error } = await db
    .from("draws")
    .select("draw_number,draw_time,raw")
    .lt("draw_number", target)
    .order("draw_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!prev) return null;
  const prevTime = prev?.raw?.official_draw_time || prev?.draw_time;
  const steps = target - Number(prev.draw_number);
  return scheduledCutoffFromPrevious(prevTime, steps);
}

async function fingerprintShots(shots: any[]) {
  const canonical = (shots || [])
    .map((s: any) => `${String(s.id)}:${cleanNumbers(s.ocr_numbers).sort((a, b) => a - b).join(",")}`)
    .sort()
    .join("|");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function freezeExisting(db: any, existing: any, cutoffAt: string | null) {
  if (!existing || existing.frozen_at) return existing;
  const { data, error } = await db
    .from("possible_output_archive")
    .update({
      frozen_at: new Date().toISOString(),
      cutoff_at: existing.cutoff_at || cutoffAt,
      updated_at: existing.updated_at || new Date().toISOString()
    })
    .eq("id", existing.id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

async function saveForecast(db: any, target: number) {
  if (!Number.isInteger(target) || target <= 0) {
    return { status: 400, body: { ok: false, error: "valid target_draw_number is required" } };
  }

  const { data: existing, error: existingError } = await db
    .from("possible_output_archive")
    .select("*")
    .eq("target_draw_number", target)
    .maybeSingle();
  if (existingError) throw existingError;

  const { data: fact, error: factError } = await db
    .from("draws")
    .select("draw_number,result_numbers,draw_time,raw")
    .eq("draw_number", target)
    .maybeSingle();
  if (factError) throw factError;

  const cutoffAt = await resolveCutoff(db, target, fact);
  const factComplete = Boolean(fact && cleanNumbers(fact.result_numbers).length === 20);

  if (factComplete) {
    if (!existing) {
      return {
        status: 409,
        body: { ok: false, locked: true, error: "fact already exists; forecast cannot be created after the draw" }
      };
    }
    const frozen = await freezeExisting(db, existing, cutoffAt);
    return { status: 200, body: { ok: true, locked: true, forecast: frozen } };
  }

  if (!cutoffAt) {
    return { status: 409, body: { ok: false, error: "target cutoff could not be resolved" } };
  }

  const cutoffMs = new Date(cutoffAt).getTime();
  if (!Number.isFinite(cutoffMs)) {
    return { status: 409, body: { ok: false, error: "invalid target cutoff" } };
  }

  const lockNow = Date.now() >= cutoffMs;
  if (existing && (existing.frozen_at || lockNow)) {
    const frozen = lockNow ? await freezeExisting(db, existing, cutoffAt) : existing;
    return { status: 200, body: { ok: true, locked: true, forecast: frozen } };
  }

  const { data: allShots, error: screenshotError } = await db
    .from("screenshots")
    .select("id,ocr_numbers,created_at")
    .eq("target_draw_number", target)
    .eq("ocr_status", "verified")
    .order("created_at", { ascending: true });
  if (screenshotError) throw screenshotError;

  const preCutoffShots = (allShots || []).filter((s: any) => {
    const t = new Date(s.created_at).getTime();
    return Number.isFinite(t) && t < cutoffMs;
  });
  const excludedLate = Math.max(0, (allShots || []).length - preCutoffShots.length);
  const frequent = frequentFromShots(preCutoffShots);
  if (!frequent.usable.length) {
    return { status: 409, body: { ok: false, error: "no verified pre-cutoff screenshots for target draw" } };
  }

  const { data: historyRows, error: historyError } = await db
    .from("learning_observations")
    .select("target_draw_number,features")
    .lt("target_draw_number", target);
  if (historyError) throw historyError;

  const forecast = buildForecast(frequent.usable, historyRows || []);
  const inputFingerprint = await fingerprintShots(frequent.usableShots);
  const sourceIds = frequent.usableShots.map((s: any) => String(s.id));
  const now = new Date().toISOString();

  const payload = {
    target_draw_number: target,
    combo: forecast.combo,
    candidates: forecast.candidates,
    frequent_numbers: frequent.numbers,
    frequent_counts: frequent.counts,
    screenshot_count: frequent.usable.length,
    history_cycles: forecast.cycles,
    model_version: MODEL_VERSION,
    cutoff_at: cutoffAt,
    source_screenshot_ids: sourceIds,
    input_fingerprint: inputFingerprint,
    excluded_late_screenshot_count: excludedLate,
    frozen_at: lockNow ? now : null,
    updated_at: now
  };

  if (existing &&
      existing.input_fingerprint === inputFingerprint &&
      Number(existing.history_cycles || 0) === Number(forecast.cycles || 0) &&
      existing.model_version === MODEL_VERSION) {
    return { status: 200, body: { ok: true, locked: false, forecast: existing } };
  }

  let saved: any = null;
  if (existing) {
    const { data, error } = await db
      .from("possible_output_archive")
      .update(payload)
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error) throw error;
    saved = data;
  } else {
    const { data, error } = await db
      .from("possible_output_archive")
      .insert(payload)
      .select("*")
      .single();
    if (error) throw error;
    saved = data;
  }

  return { status: 200, body: { ok: true, locked: Boolean(saved?.frozen_at), forecast: saved } };
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
        .select("target_draw_number,combo,candidates,frequent_numbers,frequent_counts,screenshot_count,history_cycles,model_version,created_at,updated_at,cutoff_at,frozen_at,source_screenshot_ids,input_fingerprint,excluded_late_screenshot_count")
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
          locked: Boolean(row.frozen_at || checked),
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
