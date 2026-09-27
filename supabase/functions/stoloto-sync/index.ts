import "jsr:@supabase/functions-js/edge-runtime.d.ts";

Deno.serve(async (_req: Request) => {
  const login = Deno.env.get('STOLOTOLOGIN')
  const password = Deno.env.get('STOLOTOPASSWORD')

  if (!login || !password) {
    return new Response(JSON.stringify({
      ok: false,
      error: 'STOLOTO secrets are not configured'
    }), {
      status: 503,
      headers: { 'content-type': 'application/json' }
    })
  }

  return new Response(JSON.stringify({
    ok: true,
    configured: true,
    message: 'Credentials detected. Stoloto adapter is ready for the real login/sync flow.'
  }), {
    headers: { 'content-type': 'application/json' }
  })
})
