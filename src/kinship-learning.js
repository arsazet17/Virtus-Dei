import './kinship-learning.css'
import { invokeFunction } from './services/functions.js'

let rows = []
let loading = false
let loaded = false
let lastPostTarget = null

const pad = n => String(n).padStart(2, '0')

function tierLabel(tier) {
  if (tier === 'neighbor_1') return 'ближний сосед ±1'
  if (tier === 'neighbor_2') return 'сосед ±2'
  if (tier === 'same_column') return 'родство по столбцу'
  if (tier === 'direct') return 'показывался напрямую'
  return 'холодная зона'
}

function esc(value) {
  const div = document.createElement('div')
  div.textContent = value ?? ''
  return div.innerHTML
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
    <p class="kin-note">Эти признаки уже сохраняются для всех чисел 1–80 в каждом завершённом цикле. Вес заранее не назначается: история сама покажет, что действительно связано с последующим выходом.</p>
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
    neighbor1: { candidates: 0, hits: 0 },
    neighbor2: { candidates: 0, hits: 0 },
    sameColumn: { candidates: 0, hits: 0 },
    cold: { candidates: 0, hits: 0 }
  }
  for (const row of rowsInput) {
    const s = row?.features?.relation_stats
    if (!s) continue
    out.cycles++
    for (const [src, dst] of [
      ['neighbor1_unseen', 'neighbor1'],
      ['neighbor2_unseen', 'neighbor2'],
      ['same_column_unseen', 'sameColumn'],
      ['cold_unseen', 'cold']
    ]) {
      out[dst].candidates += Number(s?.[src]?.candidates || 0)
      out[dst].hits += Number(s?.[src]?.hits || 0)
    }
  }
  return out
}

function rate(item) {
  return item.candidates ? `${(100 * item.hits / item.candidates).toFixed(1)}%` : '—'
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
      <div><span>Непоказано, но рядом ±1</span><b>${a.neighbor1.hits}/${a.neighbor1.candidates}</b><small>${rate(a.neighbor1)} выходов среди кандидатов</small></div>
      <div><span>Непоказано, но рядом ±2</span><b>${a.neighbor2.hits}/${a.neighbor2.candidates}</b><small>${rate(a.neighbor2)} выходов среди кандидатов</small></div>
      <div><span>Непоказано, но есть тот же столб</span><b>${a.sameColumn.hits}/${a.sameColumn.candidates}</b><small>${rate(a.sameColumn)} выходов среди кандидатов</small></div>
      <div><span>Совсем без родства</span><b>${a.cold.hits}/${a.cold.candidates}</b><small>${rate(a.cold)} выходов среди кандидатов</small></div>
    </div>
    <p class="kin-note">Это обучающая статистика, а не готовая вероятность. Когда добавим кнопку прогноза, расчёт будет брать только признаки, накопленные до прогнозируемого тиража, чтобы не было подглядывания в результат.</p>`
  anchor.insertAdjacentElement('afterend', section)
}

function inject() {
  if (!loaded) return
  injectPost()
  injectLearning()
}

async function loadLearning() {
  if (loading || loaded) return
  loading = true
  try {
    const data = await invokeFunction('analysis-cycle', { action: 'sync_history', limit: 220 })
    rows = Array.isArray(data?.learning) ? data.learning : []
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
  injectLearning()
})

observer.observe(document.documentElement, { childList: true, subtree: true })
loadLearning()
