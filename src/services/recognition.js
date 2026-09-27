import { createWorker } from 'tesseract.js'
import { supabase } from '../supabase.js'

let workerPromise

async function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker('eng', 1, {
      logger: () => {}
    })
  }
  return workerPromise
}

export function validateRecognizedNumbers(numbers) {
  const normalized = [...new Set(numbers.map(Number).filter(Number.isFinite))]
    .filter(n => Number.isInteger(n) && n >= 1 && n <= 80)
  return { ok: normalized.length === 10, numbers: normalized, count: normalized.length }
}

export function createPendingRecognition(file) {
  return {
    status: 'pending',
    confidence: null,
    numbers: [],
    message: `Файл ${file.name} принят. Идёт распознавание.`
  }
}

export async function recognizeScreenshot(file, screenshotId) {
  const worker = await getWorker()
  const { data } = await worker.recognize(file)
  const tokens = String(data.text || '').match(/\b\d{1,2}\b/g)?.map(Number) || []
  const validated = validateRecognizedNumbers(tokens)
  const result = {
    status: validated.ok ? 'verified' : 'review',
    confidence: Number(data.confidence || 0),
    numbers: validated.numbers,
    message: validated.ok
      ? `Распознано 10/10: ${validated.numbers.join(', ')}`
      : `Нужно проверить: найдено ${validated.count} уникальных чисел 1–80.`
  }

  if (screenshotId && supabase) {
    const { data: saved, error } = await supabase.functions.invoke('screenshot-ocr', {
      body: {
        screenshot_id: screenshotId,
        numbers: result.numbers,
        confidence: result.confidence,
        coordinates: {}
      }
    })
    if (error) throw error
    if (saved?.status) result.status = saved.status
  }

  return result
}
