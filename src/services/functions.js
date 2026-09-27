import { supabase } from '../supabase.js'

// This public anon JWT is only for the Edge gateway, which still requires JWTs.
// The rest of the client continues to use the modern publishable key.
export async function invokeFunction(name, body) {
  const key = import.meta.env.VITE_SUPABASE_FUNCTIONS_ANON_KEY
  const {data,error} = await supabase.functions.invoke(name, {
    body, ...(key ? {headers:{Authorization:`Bearer ${key}`}} : {})
  })
  if (error) {
    let message=error.message
    if(error.context?.json) {
      try {const detail=await error.context.json();message=detail.error||detail.message||message} catch {}
    }
    throw new Error(message)
  }
  return data
}
