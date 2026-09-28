import './column-grouped-analysis.css'
import { loadAnalysisCycle } from './services/analysis-cycle.js'

const pad = n => String(n).padStart(2, '0')
const columnOf = n => Number(n) % 10 === 0 ? 10 : Number(n) % 10

let lastKey = ''
let running = false

function currentTarget() {
  const headings = [...document.querySelectorAll('.panel-head h2')]
  for (const node of headings) {
    const m = String(node.textContent || '').match(/Тираж\s*№(\d+)/i)
    if (m) return Number(m[1])
  }
  return null
}

function currentShotCount() {
  const panel = [...document.querySelectorAll('.panel')].find(p =>
    /РЕЗУЛЬТАТ АНАЛИЗА СКРИНОВ/i.test(p.textContent || '')
  )
  if (!panel) return 0
  const m = String(panel.textContent || '').match(/(\d+)\s*скр\./i)
  return m ? Number(m[1]) : 0
}

function isPreAnalysisVisible() {
  return [...document.querySelectorAll('.analysis-line.large > b')]
    .some(b => /Повторяется/i.test(b.textContent || ''))
}

function groupedRows(entries) {
  const cols = Array.from({ length: 10 }, (_, i) => ({ column: i + 1, rows: [] }))
  for (const item of entries) cols[columnOf(item.number) - 1].rows.push(item)
  for (const col of cols) col.rows.sort((a, b) => a.number - b.number)
  return cols
}

function matrixHtml(entries, mode) {
  const columns = groupedRows(entries)
  return `<div class="keno-column-matrix ${mode}">${columns.map(col => {
    const rows = col.rows.length
      ? col.rows.map(item => `<div class="keno-col-number"><b>${pad(item.number)}</b>${mode === 'repeat' ? `<small>×${item.count}</small>` : mode === 'once' ? '<small>×1</small>' : ''}</div>`).join('')
      : '<div class="keno-col-empty">—</div>'
    return `<div class="keno-col"><div class="keno-col-head">ст${col.column}</div><div class="keno-col-body">${rows}</div></div>`
  }).join('')}</div>`
}

function replaceCard(labelRegex, title, entries, mode) {
  const label = [...document.querySelectorAll('.analysis-line.large > b')]
    .find(b => labelRegex.test(b.textContent || ''))
  if (!label) return
  const card = label.closest('.analysis-line.large')
  if (!card) return
  card.classList.add('column-sorted-card', `column-sorted-${mode}`)
  card.innerHTML = `<b>${title}</b>${matrixHtml(entries, mode)}`
}

async function applyColumnGrouping() {
  if (running || !isPreAnalysisVisible()) return
  const target = currentTarget()
  const shotCount = currentShotCount()
  if (!target || !shotCount) return

  const key = `${target}:${shotCount}`
  if (key === lastKey && document.querySelector('.keno-column-matrix')) return

  running = true
  try {
    const data = await loadAnalysisCycle(300)
    const shots = (data?.screenshots || []).filter(s =>
      Number(s?.target_draw_number) === target &&
      s?.ocr_status === 'verified' &&
      Array.isArray(s?.ocr_numbers) &&
      new Set(s.ocr_numbers.map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= 80)).size === 10
    )
    if (!shots.length) return

    const freq = new Map(Array.from({ length: 80 }, (_, i) => [i + 1, 0]))
    for (const shot of shots) {
      for (const n of new Set(shot.ocr_numbers.map(Number))) {
        if (Number.isInteger(n) && n >= 1 && n <= 80) freq.set(n, (freq.get(n) || 0) + 1)
      }
    }

    const total = shots.length
    const threshold = total >= 2 ? Math.max(2, Math.ceil(total * 0.60)) : Infinity
    const repeat = [...freq.entries()]
      .filter(([, count]) => count >= 2 && count < threshold)
      .map(([number, count]) => ({ number, count }))
    const once = [...freq.entries()]
      .filter(([, count]) => count === 1)
      .map(([number, count]) => ({ number, count }))
    const absent = [...freq.entries()]
      .filter(([, count]) => count === 0)
      .map(([number, count]) => ({ number, count }))

    replaceCard(/Повторяется/i, '🟡 Повторяется · сколько раз на скринах', repeat, 'repeat')
    replaceCard(/Показал один раз/i, '🔵 Показал один раз', once, 'once')
    replaceCard(/Вообще отсутствуют/i, '🔴 Вообще отсутствуют', absent, 'absent')
    lastKey = key
  } catch (error) {
    console.warn('column-grouped-analysis:', error)
  } finally {
    running = false
  }
}

let timer = null
const observer = new MutationObserver(() => {
  clearTimeout(timer)
  timer = setTimeout(applyColumnGrouping, 120)
})

observer.observe(document.documentElement, { childList: true, subtree: true })
window.addEventListener('load', applyColumnGrouping)
setTimeout(applyColumnGrouping, 300)
