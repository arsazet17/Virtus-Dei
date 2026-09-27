import "jsr:@supabase/functions-js/edge-runtime.d.ts";

Deno.serve(async (_req: Request) => {
  const login = Deno.env.get('STOLOTO_LOGIN')
  const password = Deno.env.get('STOLOTO_PASSWORD')
  if (!login || !password) {
    return new Response(JSON.stringify({ ok:false, error:'STOLOTO secrets are not configured' }), {
      status: 503, headers:{'content-type':'application/json'}
    })
  }
  return new Response(JSON.stringify({
    ok: true,
    configured: true,
    message: 'Credentials detected. Stoloto adapter is awaiting endpoint/login-flow implementation.'
  }), { headers:{'content-type':'application/json'} })
})
