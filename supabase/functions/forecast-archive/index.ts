import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const ALLOWED_ORIGINS = new Set([
  "https://arsazet17.github.io",
  "http://localhost:5173",
  "http://127.0.0.1:5173"
]);

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
  return [...new Set(input.map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= 80))];
}

function cleanCandidates(input: unknown, combo: number[]) {
  if (!Array.isArray(input)) return [];
  const allowed = new Set(combo);
  return input.slice(0, 10).map((item: any) => ({
    number: Number(item?.number),
    relation: String(item?.relation || "").slice(0, 80),
    index: Number.isFinite(Number(item?.index)) ? Number(item.index) : null
  })).filter((item: any) => allowed.has(item.number));
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

    if (action === "save") {
      const target = Number(body?.target_draw_number);
      const combo = cleanNumbers(body?.combo);
      if (!Number.isInteger(target) || target <= 0 || combo.length !== 10) {
        return json({ ok: false, error: "valid target_draw_number and exactly 10 unique numbers are required" }, 400, origin);
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
        return json({ ok: Boolean(frozen), locked: true, forecast: frozen || null, error: frozen ? null : "fact already exists; forecast cannot be created after the draw" }, frozen ? 200 : 409, origin);
      }

      const { count: screenshotCount, error: screenshotError } = await db
        .from("screenshots")
        .select("id", { count: "exact", head: true })
        .eq("target_draw_number", target)
        .eq("ocr_status", "verified");
      if (screenshotError) throw screenshotError;
      if (!screenshotCount) return json({ ok: false, error: "no verified screenshots for target draw" }, 409, origin);

      const { count: historyCycles, error: cyclesError } = await db
        .from("learning_observations")
        .select("target_draw_number", { count: "exact", head: true })
        .lt("target_draw_number", target);
      if (cyclesError) throw cyclesError;

      const candidates = cleanCandidates(body?.candidates, combo);
      const now = new Date().toISOString();
      const { data: saved, error: saveError } = await db
        .from("possible_output_archive")
        .upsert({
          target_draw_number: target,
          combo,
          candidates,
          screenshot_count: Number(screenshotCount || 0),
          history_cycles: Number(historyCycles || 0),
          model_version: "virtus-possible-output-v1",
          updated_at: now
        }, { onConflict: "target_draw_number" })
        .select("*")
        .single();
      if (saveError) throw saveError;

      return json({ ok: true, locked: false, forecast: saved }, 200, origin);
    }

    if (action === "history") {
      const limit = Math.min(100, Math.max(1, Number(body?.limit) || 40));
      const { data: forecasts, error: archiveError } = await db
        .from("possible_output_archive")
        .select("target_draw_number,combo,candidates,screenshot_count,history_cycles,model_version,created_at,updated_at")
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
        const fact = factByTarget.get(target) || [];
        const checked = fact.length === 20;
        const factSet = new Set(fact);
        const hitNumbers = checked ? combo.filter(n => factSet.has(n)) : [];
        return {
          ...row,
          target_draw_number: target,
          combo,
          checked,
          fact_numbers: checked ? fact : [],
          hit_numbers: hitNumbers,
          hit_count: hitNumbers.length
        };
      });

      return json({ ok: true, forecasts: rows }, 200, origin);
    }

    return json({ ok: false, error: "unknown action" }, 400, origin);
  } catch (error) {
    return json({ ok: false, error: String((error as any)?.message ?? error) }, 500, origin);
  }
});
