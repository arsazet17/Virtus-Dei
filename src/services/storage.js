import { supabase, supabaseConfigured } from '../supabase.js'

export async function uploadScreenshot(file, drawId = 'pending') {
  if (!supabaseConfigured) return { mode: 'demo', path: null, error: null }
  const safeName = `${Date.now()}-${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
  const path = `${drawId}/${safeName}`
  const { error } = await supabase.storage.from('screenshots').upload(path, file, {
    contentType: file.type || 'image/png',
    upsert: false
  })
  if (error) throw error
  return { mode: 'cloud', path, error: null }
}

export async function saveScreenshotRecord(record) {
  if (!supabaseConfigured) return { mode: 'demo' }
  const { data, error } = await supabase.from('screenshots').insert(record).select().single()
  if (error) throw error
  return data
}
