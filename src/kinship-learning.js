import './kinship-learning.css'
import { invokeFunction } from './services/functions.js'

let rows = []
let screenshots = []
let loading = false
let loaded = false
let lastPostTarget = null
let lastPreKey = ''

const pad = n => String(n).padStart(2, '0')
const BASELINE = 20 / 80
const PRIOR_WEIGHT = 40
const columnOf = n => Number(n) % 10 === 0 ? 10 : Number(n) % 10
const validNumber = n => Number.isInteger(n) && n >= 1 && n <= 80

function tierLabel(tier) {
  if (tier === 'neighbor_1') return 'ближний сосед ±1'
  if (tier === 'neighbor_2') return 'сосед ±2'
  if (tier === 'same_column') return 'родство по столбцу'
  if (tier === 'direct') return 'показывался напрямую'
  return 'холодная зона'
}

function tierShort(tier) {
  if (tier === 'direct') return 'прямо'
  if (tier === 'neighbor_1') return '±1'
  if (tier === 'neighbor_2') return '±2'
  if (tier === 'same_column') return 'столб'
  return 'холодный'
}

function esc(value) {
  const div = document.createElement('div')
  div.textContent = value ?? ''
  return div.innerHTML
}

function cleanNumbers(input) {
  if (!Array.isArray(input)) return []
  return [...new Set(input.map(Number).filter(validNumber))]
}

function chips(numbers = []) {
  if (!numbers.length) return '<span class="kin-empty">—</span>'
  return `<span class="kin-chips">${numbers.map(n => `<i>${pad(n)}</i>`).join('')}</span>`
}

function visiblePostTarget() {
  const eyebrow = [...document.querySelectorAll('.eyebrow')]
    .find(el => el.textContent?.includes('ПРОВЕРКА ПОСЛЕ ТИРАЖА'))
  if (!eyebrow) return null
  const panel = eyebrow.closest('.panel')
  const text = panel?.textContent || ''
  const m = text.match(/№\s*(\d+)/)
  return m ? Number(m[1]) : null
}

function visiblePreTarget() {
  const heading = [...document.querySelectorAll('.panel-head h2')]
    .find(el => /Тираж\s*№\s*\d+/i.test(el.textContent || ''))
  const m = String(heading?.textContent || '').match(/Тираж\s*№\s*(\d+)/i)
  return m ? Number(m[1]) : null
}

function preAnchor() {
  const title = [...document.querySelectorAll('.panel-title')]
    .find(el => el.textContent?.trim() === 'РЕЗУЛЬТАТ АЛГОРИТМА ДО ТИРАЖА')
  return title?.closest('.panel') || null
}

function errorsPanel() {
  const title = [...document.querySelectorAll('.panel-title')]
    .find(el => el.textContent?.trim() === 'ОШИБКИ / ЧТО УЧИТЬ')
  return title?.closest('.panel') || null
}

function relationPanel(row) {
  const relations = Array.isArray(row?.conclusions?.miss_relations) ? row.conclusions.miss_relations : []
  if (!relations.length) return ''
  const shotCount = Number(row.screenshot_count || 0)
  const near1 = relations.filter(r => Number(r.neighbor1_shots || 0) > 0).length
  const near2 = relations.filter(r => Number(r.neighbor2_shots || 0) > 0).length
  const sameCol = relations.filter(r => Number(r.same_column_shots || 0) > 0).length
  const cold = relations.filter(r => r.tier === 'cold').length

  return `<section class="panel kin-panel" id="kinship-post-panel">
    <div class="panel-head">
      <div><div class="eyebrow">ОБУЧЕНИЕ V3 · РОДСТВО</div><h2>Где были пропущенные числа</h2></div>
      <span class="status-pill">${relations.length} чисел</span>
    </div>
    <div class="kin-metrics">
      <div><b>${near1}/${relations.length}</b><span>имели ±1</span></div>
      <div><b>${near2}/${relations.length}</b><span>имели ±2</span></div>
      <div><b>${sameCol}/${relations.length}</b><span>имели столб</span></div>
      <div><b>${cold}</b><span>без намёка</span></div>
    </div>
    <div class="kin-list">
      ${relations.map(r => `<article class="kin-row">
        <div class="kin-number">${pad(r.number)}</div>
        <div class="kin-body">
          <div class="kin-top"><b>${esc(tierLabel(r.tier))}</b><span>ст${r.column}</span></div>
          <div><span>±1</span>${chips(r.neighbor1_numbers_seen)}<small>${Number(r.neighbor1_shots || 0)}/${shotCount} скр.</small></div>
          <div><span>±2</span>${chips(r.neighbor2_numbers_seen)}<small>${Number(r.neighbor2_shots || 0)}/${shotCount} скр.</small></div>
          <div><span>столб</span>${chips(r.same_column_numbers_seen)}<small>${Number(r.same_column_shots || 0)}/${shotCount} скр.</small></div>
        </div>
      </article>`).join('')}
    </div>
    <p class="kin-note">Эти признаки уже сохраняются для всех чисел 1–80 в каждом завершённом цикле. Вес заранее не назначается: история сама показывает, что действительно связано с последующим выходом.</p>
  </section>`
}

function injectPost() {
  const target = visiblePostTarget()
  const anchor = errorsPanel()
  if (!target || !anchor) return
  if (document.querySelector('#kinship-post-panel')?.dataset.target === String(target)) return
  document.querySelector('#kinship-post-panel')?.remove()
  const row = rows.find(r => Number(r.target_draw_number) === target)
  if (!row?.conclusions?.miss_relations) return
  const wrap = document.createElement('div')
  wrap.innerHTML = relationPanel(row)
  const panel = wrap.firstElementChild
  if (!panel) return
  panel.dataset.target = String(target)
  anchor.insertAdjacentElement('afterend', panel)
  lastPostTarget = target
}

function aggregate(rowsInput) {
  const out = {
    cycles: 0,
    direct: { candidates: 0, hits: 0 },
    neighbor1: { candidates: 0, hits: 0 },
    neighbor2: { candidates: 0, hits: 0 },
    sameColumn: { candidates: 0, hits: 0 },
    cold: { candidates: 0, hits: 0 }
  }
  for (const row of rowsInput) {
    const s = row?.features?.relation_stats
    if (!s) continue
    out.cycles++
    out.direct.candidates += Number(s?.tier_counts?.direct || 0)
    out.direct.hits += Number(s?.tier_hits?.direct || 0)
    out.neighbor1.candidates += Number(s?.tier_counts?.neighbor_1 || 0)
    out.neighbor1.hits += Number(s?.tier_hits?.neighbor_1 || 0)
    out.neighbor2.candidates += Number(s?.tier_counts?.neighbor_2 || 0)
    out.neighbor2.hits += Number(s?.tier_hits?.neighbor_2 || 0)
    out.sameColumn.candidates += Number(s?.tier_counts?.same_column || 0)
    out.sameColumn.hits += Number(s?.tier_hits?.same_column || 0)
    out.cold.candidates += Number(s?.tier_counts?.cold || 0)
    out.cold.hits += Number(s?.tier_hits?.cold || 0)
  }
  return out
}

function rate(item) {
  return item.candidates ? `${(100 * item.hits / item.candidates).toFixed(1)}%` : '—'
}

function smoothedRate(item) {
  const candidates = Number(item?.candidates || 0)
  const hits = Number(item?.hits || 0)
  return (hits + BASELINE * PRIOR_WEIGHT) / (candidates + PRIOR_WEIGHT)
}

function currentProfile(number, usable) {
  const n1 = [number - 1, number + 1].filter(validNumber)
  const n2 = [number - 2, number + 2].filter(validNumber)
  const exactShots = usable.filter(nums => nums.includes(number)).length
  const neighbor1Shots = usable.filter(nums => nums.some(v => n1.includes(v))).length
  const neighbor2Shots = usable.filter(nums => nums.some(v => n2.includes(v))).length
  const sameColumnShots = usable.filter(nums => nums.some(v => v !== number && columnOf(v) === columnOf(number))).length
  let tier = 'cold'
  let supportShots = 0
  let related = []
  if (exactShots > 0) {
    tier = 'direct'; supportShots = exactShots; related = [number]
  } else if (neighbor1Shots > 0) {
    tier = 'neighbor_1'; supportShots = neighbor1Shots
    related = n1.filter(n => usable.some(nums => nums.includes(n)))
  } else if (neighbor2Shots > 0) {
    tier = 'neighbor_2'; supportShots = neighbor2Shots
    related = n2.filter(n => usable.some(nums => nums.includes(n)))
  } else if (sameColumnShots > 0) {
    tier = 'same_column'; supportShots = sameColumnShots
    related = [...new Set(usable.flat().filter(n => n !== number && columnOf(n) === columnOf(number)))].sort((a,b) => a-b)
  }
  return { number, tier, supportShots, related }
}

function possibleOutput(target) {
  const usable = screenshots
    .filter(s => Number(s?.target_draw_number) === Number(target) && s?.ocr_status === 'verified')
    .map(s => cleanNumbers(s?.ocr_numbers))
    .filter(nums => nums.length === 10)
  if (!usable.length) return null

  // Anti-leakage: only cycles strictly BEFORE the target draw are allowed.
  const historyRows = rows.filter(r => Number(r?.target_draw_number) < Number(target) && r?.features?.relation_stats)
  const stats = aggregate(historyRows)
  const byTier = {
    direct: stats.direct,
    neighbor_1: stats.neighbor1,
    neighbor_2: stats.neighbor2,
    same_column: stats.sameColumn,
    cold: stats.cold
  }

  const candidates = Array.from({ length: 80 }, (_, i) => currentProfile(i + 1, usable)).map(p => {
    const hist = byTier[p.tier] || { candidates: 0, hits: 0 }
    const learnedRate = smoothedRate(hist)
    const supportShare = p.supportShots / usable.length
    // Индекс, НЕ вероятность: историческое отклонение от базовых 25% + сила текущего сигнала.
    const index = 100 * (learnedRate / BASELINE) + 12 * supportShare
    return { ...p, learnedRate, supportShare, index, hist }
  }).sort((a, b) => b.index - a.index || b.supportShots - a.supportShots || a.number - b.number)

  return { usable, stats, candidates, combo: candidates.slice(0, 10) }
}

function signalLabel(cycles) {
  if (cycles < 10) return 'СЛАБАЯ БАЗА'
  if (cycles < 30) return 'НАБЛЮДЕНИЕ'
  return 'НАКОПЛЕННАЯ БАЗА'
}

function possiblePanel(target, result) {
  const combo = result.combo
  return `<section class="panel kin-panel kin-possible" id="kinship-pre-panel" data-target="${target}">
    <div class="panel-head">
      <div><div class="eyebrow">ДО ТИРАЖА · РОДСТВО V3</div><h2>Возможный выход</h2></div>
      <span class="status-pill ${result.stats.cycles < 10 ? 'warn' : 'good'}">${signalLabel(result.stats.cycles)}</span>
    </div>
    <div class="kin-combo-label">КОМБА 10 ЧИСЕЛ · по текущим ${result.usable.length} скринам</div>
    <div class="kin-combo">${combo.map((x, i) => `<span title="${esc(tierLabel(x.tier))}"><small>${i + 1}</small>${pad(x.number)}</span>`).join('')}</div>
    <div class="kin-candidates">
      ${combo.map(x => `<div class="kin-candidate">
        <b>${pad(x.number)}</b>
        <span>${tierShort(x.tier)} · ${x.supportShots}/${result.usable.length} скр.</span>
        <em>индекс ${x.index.toFixed(0)}</em>
      </div>`).join('')}
    </div>
    <p class="kin-note">Расчёт использует только скрины текущего тиража и ${result.stats.cycles} завершённых более ранних циклов. Текущий факт не используется. «Индекс» — сравнительный рейтинг кандидатов, не вероятность выигрыша. При малой базе комбинация считается исследовательской.</p>
  </section>`
}

function injectPre() {
  const target = visiblePreTarget()
  const anchor = preAnchor()
  if (!target || !anchor) return
  const result = possibleOutput(target)
  const key = result ? `${target}:${result.usable.length}:${result.stats.cycles}` : `${target}:none`
  if (key === lastPreKey && document.querySelector('#kinship-pre-panel')) return
  document.querySelector('#kinship-pre-panel')?.remove()
  if (!result) { lastPreKey = key; return }
  const wrap = document.createElement('div')
  wrap.innerHTML = possiblePanel(target, result)
  const panel = wrap.firstElementChild
  if (!panel) return
  anchor.insertAdjacentElement('afterend', panel)
  lastPreKey = key
}

function injectLearning() {
  const title = [...document.querySelectorAll('.panel-title')]
    .find(el => el.textContent?.includes('ВЛИЯЮТ ЛИ СКРИНШОТЫ'))
  const anchor = title?.closest('.panel')
  if (!anchor || document.querySelector('#kinship-learning-panel')) return
  const a = aggregate(rows)
  if (!a.cycles) return
  const section = document.createElement('section')
  section.className = 'panel kin-panel'
  section.id = 'kinship-learning-panel'
  section.innerHTML = `
    <div class="panel-head"><div><div class="eyebrow">ОБУЧЕНИЕ V3</div><h2>Родство пропущенных чисел</h2></div><span class="status-pill">${a.cycles} циклов</span></div>
    <div class="kin-learn-grid">
      <div><span>Показывались напрямую</span><b>${a.direct.hits}/${a.direct.candidates}</b><small>${rate(a.direct)} выходов среди кандидатов</small></div>
      <div><span>Непоказано, но рядом ±1</span><b>${a.neighbor1.hits}/${a.neighbor1.candidates}</b><small>${rate(a.neighbor1)} выходов среди кандидатов</small></div>
      <div><span>Непоказано, но рядом ±2</span><b>${a.neighbor2.hits}/${a.neighbor2.candidates}</b><small>${rate(a.neighbor2)} выходов среди кандидатов</small></div>
      <div><span>Непоказано, но есть тот же столб</span><b>${a.sameColumn.hits}/${a.sameColumn.candidates}</b><small>${rate(a.sameColumn)} выходов среди кандидатов</small></div>
      <div><span>Совсем без родства</span><b>${a.cold.hits}/${a.cold.candidates}</b><small>${rate(a.cold)} выходов среди кандидатов</small></div>
    </div>
    <p class="kin-note">Эта накопленная статистика служит весом для блока «Возможный выход». При расчёте до тиража используются только завершённые циклы, которые были раньше прогнозируемого тиража.</p>`
  anchor.insertAdjacentElement('afterend', section)
}

function inject() {
  if (!loaded) return
  injectPost()
  injectPre()
  injectLearning()
}

async function loadLearning() {
  if (loading || loaded) return
  loading = true
  try {
    const data = await invokeFunction('analysis-cycle', { action: 'sync_history', limit: 300 })
    rows = Array.isArray(data?.learning) ? data.learning : []
    screenshots = Array.isArray(data?.screenshots) ? data.screenshots : []
    loaded = true
    inject()
  } catch (error) {
    console.warn('Kinship learning unavailable:', error)
  } finally {
    loading = false
  }
}

const observer = new MutationObserver(() => {
  if (!loaded) return
  const target = visiblePostTarget()
  if (target !== lastPostTarget || !document.querySelector('#kinship-post-panel')) injectPost()
  injectPre()
  injectLearning()
})

observer.observe(document.documentElement, { childList: true, subtree: true })
loadLearning()
