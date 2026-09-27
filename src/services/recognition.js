export function validateRecognizedNumbers(numbers) {
  const normalized = [...new Set(numbers.map(Number).filter(Number.isFinite))]
    .filter(n => n >= 1 && n <= 80)
  return { ok: normalized.length === 10, numbers: normalized, count: normalized.length }
}

export function createPendingRecognition(file) {
  return {
    status: 'pending',
    confidence: null,
    numbers: [],
    message: `Файл ${file.name} принят. OCR-модуль будет подключён следующим этапом.`
  }
}
