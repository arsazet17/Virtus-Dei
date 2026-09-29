import { invokeFunction } from './services/functions.js'

let lastKey = ''
let loading = false
let timer = null

const pad = n => String(n).padStart(2, '0')

function cleanNumbers(input) {
  if (!Array.isArray(input)) return []
  return [...new Set(input.map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= 80))]
}

function currentTarget() {
  const panelTarget = Number(document.querySelector('#kinship-pre-panel')?.dataset?.target)
  if (Number.isInteger(panelTarget) && panelTarget > 0) return panelTarget

  const texts = [
    document.querySelector('.target-number')?.textContent,
    ...[...document.querySelectorAll('.panel-head h2')].map(el => el.textContent)
  ]
  for (const text of texts) {
    const m = String(text || '').match(/№\s*(\d+)/)
    if (m) return Number(m[1])
  }
  return null
}

function visibleVerifiedCount() {
  const texts = [
    document.querySelector('.target-status')?.textContent,
    ...[...document.querySelectorAll('.status-pill')].map(el => el.textContent)
  ]
  for (const text of texts) {
    const m = String(text || '').match(/(\d+)\s*(?:проверено|скр\.?)/i)
    if (m) return Number(m[1])
  }
  return 0
}

function clarifyExistingLabels() {
  document.querySelectorAll('.metric-row span').forEach(span => {
    const text = String(span.textContent || '').trim().toLowerCase()
    if (text === 'настойчивых') span.textContent = 'настойчивые ≥60%'
    if (text === 'уникальных') span.textContent = 'покрытие скринов'
  })

  document.querySelectorAll('.analysis-line b').forEach(b => {
    const text = String(b.textContent || '')
    if (text.includes('🎯 Настойчиво:')) b.textContent = '🎯 Настойчивые ≥60%:'
    if (text.includes('🟢 Настойчивое предложение')) b.textContent = '🟢 Настойчивые ≥60%'
  })
}

function anchor() {
  const kin = document.querySelector('#kinship-pre-panel')
  if (kin) return kin
  const title = [...document.querySelectorAll('.panel-title')]
    .find(el => el.textContent?.trim() === 'РЕЗУЛЬТАТ АЛГОРИТМА ДО ТИРАЖА')
  return title?.closest('.panel') || null
}

function chips(rows, cls = '') {
  if (!rows.length) return '<span class="empty-text">—</span>'
  return `<div class="chips">${rows.map(x => `<span class="${cls}">${pad(x.number)}<small>×${x.count}</small></span>`).join('')}</div>`
}

function buildStats(shots) {
  const freq = new Map(Array.from({ length: 80 }, (_, i) => [i + 1, 0]))
  for (const shot of shots) {
    for (const n of new Set(cleanNumbers(shot.ocr_numbers))) freq.set(n, (freq.get(n) || 0) + 1)
  }
  const shown = [...freq.entries()]
    .filter(([, count]) => count > 0)
    .map(([number, count]) => ({ number, count }))
    .sort((a, b) => b.count - a.count || a.number - b.number)
  const threshold = shots.length >= 2 ? Math.max(2, Math.ceil(shots.length * 0.60)) : Infinity
  const persistent = shown.filter(x => x.count >= threshold)
  const top8 = shown.slice(0, 8)
  return { shown, persistent, top8, threshold, coverage: shown.length }
}

function panelMarkup(target, shots, stats) {
  const thresholdText = Number.isFinite(stats.threshold) ? `${stats.threshold}/${shots.length}` : 'нужны ≥2 скрина'
  const expected = (stats.coverage * 20 / 80).toFixed(1)
  return `<section class="panel" id="screen-metric-clarifier" data-target="${target}">
    <div class="panel-head">
      <div><div class="eyebrow">ТРИ РАЗНЫХ ПОКАЗАТЕЛЯ</div><h2>Скрины · №${target}</h2></div>
      <span class="status-pill">${shots.length} verified</span>
    </div>
    <div class="metric-row compact">
      <div><b>${stats.persistent.length}</b><span>настойчивые ≥60%</span></div>
      <div><b>${stats.top8.length}</b><span>TOP‑8 по частоте</span></div>
      <div><b>${stats.coverage}/80</b><span>общее покрытие скринов</span></div>
    </div>
    <div class="analysis-line"><b>🎯 Настойчивые ≥60% · порог ${thresholdText}:</b>${chips(stats.persistent, 'strong')}</div>
    <div class="analysis-line"><b>TOP‑8 по частоте · это НЕ большинство:</b>${chips(stats.top8, 'warm')}</div>
    <p class="muted-text">Покрытие ${stats.coverage}/80 означает, что на всех verified-скринах хотя бы раз встретились ${stats.coverage} разных чисел. Условное случайное ожидание попаданий при таком покрытии — около ${expected} из 20; это не прогноз.</p>
  </section>`
}

async function refreshPanel() {
  clarifyExistingLabels()
  const target = currentTarget()
  const a = anchor()
  if (!target || !a || loading) return

  const key = `${target}:${visibleVerifiedCount()}`
  if (key === lastKey && document.querySelector('#screen-metric-clarifier')) return
  loading = true
  try {
    const data = await invokeFunction('analysis-cycle', { action: 'history', limit: 300 })
    const shots = (Array.isArray(data?.screenshots) ? data.screenshots : [])
      .filter(s => Number(s?.target_draw_number) === target && s?.ocr_status === 'verified')
      .filter(s => cleanNumbers(s?.ocr_numbers).length === 10)
    const stats = buildStats(shots)

    document.querySelector('#screen-metric-clarifier')?.remove()
    if (!shots.length) {
      lastKey = key
      return
    }

    const wrap = document.createElement('div')
    wrap.innerHTML = panelMarkup(target, shots, stats)
    const panel = wrap.firstElementChild
    if (panel) a.insertAdjacentElement('afterend', panel)
    lastKey = key
  } catch (error) {
    console.warn('Metric clarification unavailable:', error)
  } finally {
    loading = false
  }
}

function schedule() {
  clearTimeout(timer)
  timer = setTimeout(refreshPanel, 450)
}

const observer = new MutationObserver(schedule)
observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true })
refreshPanel()
