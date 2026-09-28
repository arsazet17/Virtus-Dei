import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const ALLOWED_ORIGINS = new Set(["https://arsazet17.github.io","http://localhost:5173","http://127.0.0.1:5173"]);
function responseHeaders(origin: string) {
  return { "content-type":"application/json", "Access-Control-Allow-Origin":origin || "https://arsazet17.github.io",
    "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods":"POST, OPTIONS", "Vary":"Origin" };
}

Deno.serve(async (req: Request) => {
  const requestOrigin=req.headers.get("origin")||"";
  const headers=responseHeaders(requestOrigin);
  if (requestOrigin && !ALLOWED_ORIGINS.has(requestOrigin)) return new Response(JSON.stringify({ok:false,error:"origin not allowed"}),{status:403,headers});
  if(req.method==="OPTIONS") return new Response(null,{status:204,headers});
  if (req.method !== "POST") return new Response(JSON.stringify({ ok:false, error:"POST required" }), { status:405, headers });

  try {
    const form = await req.formData();
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(url, serviceRole, { auth:{ persistSession:false } });

    const action = String(form.get("action") || "upload");
    if (action === "delete") {
      const screenshotId = String(form.get("screenshot_id") || "").trim();
      if (!screenshotId) throw new Error("screenshot_id is required");

      const { data:shot, error:shotError } = await db.from("screenshots")
        .select("id,set_id,original_path,marked_path,ocr_status,ocr_numbers")
        .eq("id", screenshotId)
        .maybeSingle();
      if (shotError) throw shotError;
      if (!shot) return new Response(JSON.stringify({ ok:false, error:"screenshot not found" }), { status:404, headers });

      const numbers = Array.isArray(shot.ocr_numbers) ? shot.ocr_numbers : [];
      if (shot.ocr_status === "verified" || numbers.length === 10) {
        return new Response(JSON.stringify({ ok:false, error:"verified screenshot cannot be deleted here" }), { status:409, headers });
      }

      const paths = [...new Set([shot.original_path, shot.marked_path].filter(Boolean).map(String))];
      if (paths.length) {
        const { error:storageError } = await db.storage.from("virtus-screenshots").remove(paths);
        if (storageError) throw storageError;
      }

      const { error:comparisonError } = await db.from("comparisons").delete().eq("screenshot_id", screenshotId);
      if (comparisonError) throw comparisonError;

      const { error:deleteError } = await db.from("screenshots").delete().eq("id", screenshotId);
      if (deleteError) throw deleteError;

      if (shot.set_id) {
        const { count, error:countError } = await db.from("screenshots")
          .select("id", { count:"exact", head:true })
          .eq("set_id", shot.set_id);
        if (countError) throw countError;
        if ((count || 0) === 0) {
          const { error:setDeleteError } = await db.from("screenshot_sets").delete().eq("id", shot.set_id);
          if (setDeleteError) throw setDeleteError;
        }
      }

      return new Response(JSON.stringify({ ok:true, deleted:true, screenshot_id:screenshotId }), { headers });
    }

    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("file is required");
    if (!["image/png","image/jpeg","image/webp"].includes(file.type)) throw new Error("unsupported image type");
    if (file.size < 100 || file.size > 20 * 1024 * 1024) throw new Error("invalid file size");

    let targetDrawNumber = Number(form.get("target_draw_number") || 0);
    if (!targetDrawNumber) {
      const { data:last, error:lastError } = await db.from("draws").select("draw_number").order("draw_number", { ascending:false }).limit(1).maybeSingle();
      if (lastError) throw lastError;
      targetDrawNumber = last?.draw_number ? Number(last.draw_number) + 1 : 0;
    }

    const { data:set, error:setError } = await db.from("screenshot_sets").insert({
      target_draw_number: targetDrawNumber || null,
      status: "open"
    }).select().single();
    if (setError) throw setError;

    const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const path = `${targetDrawNumber || "pending"}/${set.id}/${crypto.randomUUID()}.${ext}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { error:uploadError } = await db.storage.from("virtus-screenshots").upload(path, bytes, { contentType:file.type, upsert:false });
    if (uploadError) throw uploadError;

    const { data:shot, error:shotError } = await db.from("screenshots").insert({
      set_id: set.id,
      target_draw_number: targetDrawNumber || null,
      original_path: path,
      captured_at: form.get("captured_at") || null,
      received_at: new Date().toISOString(),
      ocr_numbers: [],
      ocr_status: "pending",
      coordinates: {}
    }).select().single();
    if (shotError) throw shotError;

    return new Response(JSON.stringify({ ok:true, mode:"cloud", path, set_id:set.id, screenshot_id:shot.id, target_draw_number:targetDrawNumber }), { headers });
  } catch (e) {
    return new Response(JSON.stringify({ ok:false, error:String(e?.message ?? e) }), { status:400, headers });
  }
});
