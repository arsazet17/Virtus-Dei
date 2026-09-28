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

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin") || "";
  if (origin && !ALLOWED_ORIGINS.has(origin)) return json({ ok: false, error: "origin not allowed" }, 403, origin);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: responseHeaders(origin) });
  if (req.method !== "POST") return json({ ok: false, error: "POST required" }, 405, origin);

  try {
    const body = await req.json().catch(() => ({}));
    const target = Number(body?.target_draw_number);
    if (!Number.isInteger(target) || target <= 0) return json({ ok: false, error: "valid target_draw_number required" }, 400, origin);

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } }
    );

    const { data: shots, error: shotsError } = await db
      .from("screenshots")
      .select("id,target_draw_number,original_path,captured_at,received_at,ocr_numbers,ocr_confidence,ocr_status,coordinates,created_at")
      .eq("target_draw_number", target)
      .order("created_at", { ascending: true });
    if (shotsError) throw shotsError;

    const paths = (shots || []).map((s: any) => s.original_path).filter(Boolean);
    const urlByPath = new Map<string, string>();
    if (paths.length) {
      const { data: signed } = await db.storage.from("virtus-screenshots").createSignedUrls(paths, 3600);
      for (const item of signed || []) if (item.path && item.signedUrl) urlByPath.set(item.path, item.signedUrl);
    }

    const { data: draw, error: drawError } = await db
      .from("draws")
      .select("draw_number,draw_time,result_numbers,raw,created_at")
      .eq("draw_number", target)
      .maybeSingle();
    if (drawError) throw drawError;

    const screenshots = (shots || []).map((s: any) => ({
      id: s.id,
      target_draw_number: Number(s.target_draw_number),
      image_url: urlByPath.get(s.original_path) || null,
      captured_at: s.captured_at,
      received_at: s.received_at,
      created_at: s.created_at,
      ocr_numbers: cleanNumbers(s.ocr_numbers),
      ocr_confidence: s.ocr_confidence == null ? null : Number(s.ocr_confidence),
      ocr_status: s.ocr_status,
      coordinates: s.coordinates && typeof s.coordinates === "object" ? s.coordinates : {}
    }));

    return json({
      ok: true,
      target_draw_number: target,
      screenshots,
      draw: draw ? {
        draw_number: Number(draw.draw_number),
        draw_time: draw.raw?.official_draw_time || draw.draw_time || draw.created_at,
        result_numbers: cleanNumbers(draw.result_numbers),
        official_column: Number(draw.raw?.official_column ?? draw.raw?.column ?? 0) || null
      } : null
    }, 200, origin);
  } catch (error) {
    return json({ ok: false, error: String((error as any)?.message ?? error) }, 500, origin);
  }
});
