import { createWorker, PSM } from 'tesseract.js'
import { invokeFunction } from './functions.js'
import { supabase } from '../supabase.js'
import { findSelectedCells, validateRecognizedNumbers } from './selected-cells.js'
export { validateRecognizedNumbers } from './selected-cells.js'

let workerPromise
async function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker('eng', 1, { logger: () => {} }).then(async worker => {
      await worker.setParameters({
        tessedit_char_whitelist: '0123456789',
        tessedit_pageseg_mode: PSM.SINGLE_LINE,
        user_defined_dpi: '300'
      })
      return worker
    }).catch(error => { workerPromise = null; throw error })
  }
  return workerPromise
}

export function createPendingRecognition(file) {
  return {
    status: 'pending', confidence: null, numbers: [],
    message: `Файл ${file.name} принят. Идёт распознавание выбранных ячеек.`
  }
}

function makeTile(context, cell, threshold) {
  const inset = Math.max(2, Math.round(cell.width * 0.11))
  const w = Math.max(4, cell.width - inset * 2)
  const h = Math.max(4, cell.height - inset * 2)
  const crop = context.getImageData(cell.left + inset, cell.top + inset, w, h)
  for (let p = 0; p < crop.data.length; p += 4) {
    const r = crop.data[p], g = crop.data[p + 1], b = crop.data[p + 2]
    const whiteDigit = r >= threshold && g >= threshold && b >= threshold
    crop.data[p] = crop.data[p + 1] = crop.data[p + 2] = whiteDigit ? 0 : 255
    crop.data[p + 3] = 255
  }
  const raw = document.createElement('canvas')
  raw.width = w; raw.height = h
  raw.getContext('2d').putImageData(crop, 0, 0)
  const tile = document.createElement('canvas')
  tile.width = w * 5 + 48
  tile.height = h * 5 + 48
  const ctx = tile.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, tile.width, tile.height)
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(raw, 24, 24, w * 5, h * 5)
  return { tile, inset }
}

function validCandidate(text) {
  const clean = String(text || '').replace(/\s+/g, '')
  if (!/^\d{1,2}$/.test(clean)) return NaN
  const n = Number(clean)
  return Number.isInteger(n) && n >= 1 && n <= 80 ? n : NaN
}

async function recognizeCell(worker, context, cell) {
  const first = makeTile(context, cell, 165)
  let result = await worker.recognize(first.tile)
  let best = {
    number: validCandidate(result.data.text),
    confidence: Number(result.data.confidence) || 0
  }

  if (!Number.isInteger(best.number) || best.confidence < 84) {
    const second = makeTile(context, cell, 215)
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK })
    try {
      const retry = await worker.recognize(second.tile)
      const candidate = {
        number: validCandidate(retry.data.text),
        confidence: Number(retry.data.confidence) || 0
      }
      if (Number.isInteger(candidate.number) && (!Number.isInteger(best.number) || candidate.confidence > best.confidence)) best = candidate
    } finally {
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE })
    }
  }
  return best
}

function geometryInference(cells, values, confidences) {
  const votes = new Map()
  for (let i = 0; i < cells.length; i++) {
    const n = values[i]
    if (!Number.isInteger(n) || confidences[i] < 70) continue
    const actualX = (n - 1) % 10
    const actualY = Math.floor((n - 1) / 10)
    const dx = actualX - Number(cells[i].gridX)
    const dy = actualY - Number(cells[i].gridY)
    const key = `${dx},${dy}`
    const entry = votes.get(key) || { dx, dy, count: 0, confidence: 0 }
    entry.count++
    entry.confidence += confidences[i]
    votes.set(key, entry)
  }

  const ranked = [...votes.values()].sort((a, b) => b.count - a.count || b.confidence - a.confidence)
  const best = ranked[0]
  if (!best || best.count < 2) return null

  const inferred = cells.map(cell => {
    const x = Number(cell.gridX) + best.dx
    const y = Number(cell.gridY) + best.dy
    if (x < 0 || x > 9 || y < 0 || y > 7) return NaN
    return y * 10 + x + 1
  })
  const checked = validateRecognizedNumbers(inferred)
  if (!checked.ok) return null

  let agreements = 0
  for (let i = 0; i < values.length; i++) {
    if (Number.isInteger(values[i]) && values[i] === inferred[i]) agreements++
  }
  if (agreements < 2) return null
  return { values: inferred, numbers: checked.numbers, anchors: best.count, agreements }
}

export async function recognizeScreenshot(file, screenshotId) {
  const bitmap = await createImageBitmap(file)
  const canvas = document.createElement('canvas')
  const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height))
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const context = canvas.getContext('2d', { willReadFrequently: true })
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()

  const detection = findSelectedCells(context.getImageData(0, 0, canvas.width, canvas.height))
  if (detection.reason) return { status: 'review', confidence: 0, numbers: [], message: detection.reason, coordinates: {} }

  const worker = await getWorker()
  const values = [], confidences = []
  for (const cell of detection.cells) {
    const result = await recognizeCell(worker, context, cell)
    values.push(result.number)
    confidences.push(result.confidence)
  }

  const geometry = geometryInference(detection.cells, values, confidences)
  const finalValues = geometry?.values || values
  const checked = validateRecognizedNumbers(finalValues)
  const reliableOcr = confidences.every((c, i) => Number.isInteger(values[i]) && c >= 70)
  const verified = checked.ok && (Boolean(geometry) || reliableOcr)
  const coordinates = {}
  if (checked.ok) {
    for (let i = 0; i < detection.cells.length; i++) {
      const n = finalValues[i]
      const cell = detection.cells[i]
      coordinates[n] = {
        x: Math.round(cell.left / scale), y: Math.round(cell.top / scale),
        width: Math.round(cell.width / scale), height: Math.round(cell.height / scale),
        gridX: cell.gridX, gridY: cell.gridY
      }
    }
  }

  const minConfidence = confidences.length ? Math.min(...confidences) : 0
  const effectiveConfidence = geometry ? Math.max(85, minConfidence) : minConfidence
  let message
  if (verified && geometry) {
    message = `Распознано 10/10: ${checked.numbers.join(', ')}. OCR дополнительно проверен геометрией таблицы по ${geometry.anchors} якорям.`
  } else if (verified) {
    message = `Распознано 10/10 выбранных чисел: ${checked.numbers.join(', ')}`
  } else {
    const good = values.filter((n, i) => Number.isInteger(n) && confidences[i] >= 70).length
    message = `Нужно проверить выбранные ячейки: уверенно распознано ${good} из 10. Используйте «Исправить OCR» или загрузите скрин крупнее.`
  }

  const result = {
    status: verified ? 'verified' : 'review',
    numbers: checked.numbers,
    confidence: effectiveConfidence,
    coordinates,
    message,
    geometry: geometry ? { anchors: geometry.anchors, agreements: geometry.agreements } : null
  }

  if (screenshotId && supabase) {
    try {
      const saved = await invokeFunction('screenshot-ocr', {
        screenshot_id: screenshotId,
        numbers: result.numbers,
        confidence: result.confidence,
        coordinates,
        client_status: result.status
      })
      if (!saved?.ok) throw new Error(saved?.error || 'Не удалось сохранить результат')
      result.saved = true
    } catch (error) {
      result.saved = false
      result.message += ` Результат пока не сохранён в облаке: ${error.message}`
    }
  }
  return result
}
