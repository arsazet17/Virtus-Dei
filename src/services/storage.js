import { invokeFunction } from './functions.js'
import { supabaseConfigured } from '../supabase.js'

export async function uploadScreenshot(file, drawId = 'pending') {
  if (!supabaseConfigured) return { mode: 'demo', path: null, error: null }

  const form = new FormData()
  form.append('file', file, file.name)
  form.append('captured_at', new Date(file.lastModified || Date.now()).toISOString())
  if (drawId !== 'pending' && Number.isFinite(Number(drawId))) {
    form.append('target_draw_number', String(drawId))
  }

  const data = await invokeFunction('screenshot-upload', form)

  if (!data?.ok) throw new Error(data?.error || 'Upload failed')
  return data
}

export async function saveScreenshotRecord(record) {
  return { mode: 'server-managed', record }
}
