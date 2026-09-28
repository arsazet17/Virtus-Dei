import { invokeFunction } from './functions.js'

export async function loadAnalysisCycle(limit = 200) {
  const data = await invokeFunction('analysis-cycle', { action: 'sync_history', limit })
  if (!data?.ok) throw new Error(data?.error || 'Не удалось загрузить архив анализа')
  return data
}

export async function correctScreenshotNumbers(screenshotId, numbers) {
  const data = await invokeFunction('analysis-cycle', {
    action: 'correct',
    screenshot_id: screenshotId,
    numbers
  })
  if (!data?.ok) throw new Error(data?.error || 'Не удалось сохранить исправление')
  return data
}

export async function syncLearning() {
  const data = await invokeFunction('analysis-cycle', { action: 'sync' })
  if (!data?.ok) throw new Error(data?.error || 'Не удалось обновить обучение')
  return data
}
