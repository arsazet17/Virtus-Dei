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
  if (requestOrigin && !ALLOWED_ORIGINS.has(requestOrigin)) return new Response(JSON.stringify({ok:false,error:"origin not allowed"}),{status:403});
  if(req.method==="OPTIONS") return new Response(null,{status:204,headers});

  if (req.method !== 'POST') return new Response(JSON.stringify({ok:false,error:'POST required'}), {status:405,headers});
  try {
    const body = await req.json();
    const id = String(body.screenshot_id || '');
    const nums = Array.isArray(body.numbers) ? body.numbers.map(Number) : [];
    const unique = [...new Set(nums)].filter(n => Number.isInteger(n) && n >= 1 && n <= 80);
    if (!id) throw new Error('screenshot_id is required');
    const status = nums.length === 10 && unique.length === 10 && Number(body.confidence) >= 70 && body.client_status !== 'review' ? 'verified' : 'review';

    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {auth:{persistSession:false}});
    const { data, error } = await db.from('screenshots').update({
      ocr_numbers: unique,
      ocr_confidence: Number.isFinite(Number(body.confidence)) ? Number(body.confidence) : null,
      ocr_status: status,
      coordinates: body.coordinates && typeof body.coordinates === 'object' ? body.coordinates : {}
    }).eq('id', id).select().single();
    if (error) throw error;
    return new Response(JSON.stringify({ok:true,status,numbers:unique,row:data}), {headers});
  } catch (e) {
    return new Response(JSON.stringify({ok:false,error:String(e?.message ?? e)}), {status:400,headers});
  }
});
