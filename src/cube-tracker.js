// 🎲 Куб: билеты «Случайные числа» из Кено Столото и их ход по тиражам.
// Записи в cube_tickets добавляет Claude по команде пользователя; здесь — только чтение и подсчёт.
import './cube-tracker.css'
import { supabase } from './supabase.js'

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const columnOf = n => (n % 10 === 0 ? 10 : n % 10)
const clean = a => (Array.isArray(a) ? a.map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= 80) : [])
const PARITY = { even: 'чёт', odd: 'нечёт', equal: 'поровну' }

function drawColumn(draw) {
  const off = Number(draw?.raw?.official_column ?? draw?.raw?.column)
  if (Number.isFinite(off) && off >= 1 && off <= 10) return off
  const nums = clean(draw?.result_numbers)
  const count = Array(11).fill(0)
  nums.forEach(n => count[columnOf(n)]++)
  const max = Math.max(...count.slice(1))
  let best = null, bestReach = 999
  for (let c = 1; c <= 10; c++) {
    if (count[c] !== max) continue
    let seen = 0
    for (let i = 0; i < nums.length; i++) {
      if (columnOf(nums[i]) === c && ++seen === max) { if (i < bestReach) { bestReach = i; best = c } break }
    }
  }
  return best
}

function drawParity(nums) {
  const even = nums.filter(n => n % 2 === 0).length
  return even === 10 ? 'equal' : even > 10 ? 'even' : 'odd'
}

const timeMsk = v => {
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(d)
}

function ticketRows(t, drawsByNo) {
  const rows = []
  for (let k = 0; k < t.track_draws; k++) {
    const no = t.target_draw_number + k
    const d = drawsByNo.get(no)
    if (!d) { rows.push({ no, pending: true }); continue }
    const fact = clean(d.result_numbers)
    const set = new Set(fact)
    const hits = t.numbers.filter(n => set.has(n))
    const col = drawColumn(d)
    const par = drawParity(fact)
    rows.push({ no, time: d.draw_time, hits, col, colHit: t.columns.length ? t.columns.includes(col) : null, par, parHit: t.parity ? t.parity === par : null })
  }
  return rows
}

function summary(rows, t) {
  const done = rows.filter(r => !r.pending)
  if (!done.length) return 'ждём первый тираж'
  const avg = (done.reduce((a, r) => a + r.hits.length, 0) / done.length).toFixed(1)
  const best = Math.max(...done.map(r => r.hits.length))
  const parts = [`${done.length}/${rows.length} тир`, `чисел в среднем ${avg} из ${t.numbers.length}`, `лучший ${best}`]
  if (t.columns.length) parts.push(`столб ${done.filter(r => r.colHit).length}/${done.length}`)
  if (t.parity) parts.push(`чётность ${done.filter(r => r.parHit).length}/${done.length}`)
  return parts.join(' · ')
}

function ticketHTML(t, drawsByNo) {
  const rows = ticketRows(t, drawsByNo)
  const allHits = new Set(rows.flatMap(r => r.hits || []))
  const balls = t.numbers.map(n => `<span class="cube-ball${allHits.has(n) ? ' hit' : ''}">${n}</span>`).join('')
  const extra = [
    t.columns.length ? `столбы ${t.columns.join(', ')}` : '',
    t.parity ? `чётность: ${PARITY[t.parity]}` : ''
  ].filter(Boolean).join(' · ')
  const body = rows.map(r => r.pending
    ? `<tr class="pending"><td>№${r.no}</td><td colspan="4">ожидание</td></tr>`
    : `<tr><td>№${r.no}<small>${timeMsk(r.time)}</small></td><td class="${r.hits.length >= 4 ? 'good' : ''}"><b>${r.hits.length}</b>${r.hits.length ? `<small>${r.hits.join(' ')}</small>` : ''}</td><td class="${r.colHit === true ? 'good' : r.colHit === false ? 'bad' : ''}">ст${r.col ?? '—'}</td><td class="${r.parHit === true ? 'good' : r.parHit === false ? 'bad' : ''}">${PARITY[r.par]}</td></tr>`
  ).join('')
  return `<details class="cube-ticket"${t._open ? ' open' : ''}>
    <summary>
      <div class="cube-top"><b>№${t.target_draw_number}</b><span class="cube-status ${t.status}">${t.status === 'real' ? 'куплен' : 'отслеживаю'}</span><i>⌄</i></div>
      <div class="cube-balls">${balls}</div>
      ${extra ? `<div class="cube-extra">${esc(extra)}</div>` : ''}
      <div class="cube-sum">${esc(summary(rows, t))}</div>
    </summary>
    <table class="cube-table"><thead><tr><th>Тираж</th><th>Совпало</th><th>Столб</th><th>Чётность</th></tr></thead><tbody>${body}</tbody></table>
    ${t.note ? `<div class="cube-note">${esc(t.note)}</div>` : ''}
  </details>`
}

function aggregate(tickets, drawsByNo) {
  const done = tickets.flatMap(t => ticketRows(t, drawsByNo).filter(r => !r.pending).map(r => ({ r, t })))
  if (!done.length) return ''
  const first = tickets.map(t => ({ t, r: ticketRows(t, drawsByNo)[0] })).filter(x => x.r && !x.r.pending)
  const avgFirst = first.length ? (first.reduce((a, x) => a + x.r.hits.length / Math.max(1, x.t.numbers.length), 0) / first.length * 100).toFixed(0) : '—'
  const avgAll = (done.reduce((a, x) => a + x.r.hits.length / Math.max(1, x.t.numbers.length), 0) / done.length * 100).toFixed(0)
  const colRows = done.filter(x => x.r.colHit !== null), parRows = done.filter(x => x.r.parHit !== null)
  return `<div class="cube-agg">
    <div><b>${tickets.length}</b><span>билетов</span></div>
    <div><b>${avgFirst}%</b><span>чисел совпало в свой тираж</span></div>
    <div><b>${avgAll}%</b><span>за все 10 тиражей</span></div>
    <div><b>${colRows.length ? colRows.filter(x => x.r.colHit).length + '/' + colRows.length : '—'}</b><span>столб угадан</span></div>
    <div><b>${parRows.length ? parRows.filter(x => x.r.parHit).length + '/' + parRows.length : '—'}</b><span>чётность угадана</span></div>
  </div>
  <p class="cube-hint">Норма для случайных 10 чисел — 25% совпадений (20 из 80). Выше нормы — куб «ведёт», ниже — «уводит».</p>`
}

let cacheHTML = ''
let cacheAt = 0
let inflight = null

async function build() {
  if (!supabase) throw new Error('Supabase не настроен')
  const { data: tickets, error } = await supabase.from('cube_tickets').select('*').order('created_at', { ascending: false }).limit(60)
  if (error) throw error
  const list = (tickets || []).map(t => ({ ...t, numbers: clean(t.numbers), columns: (t.columns || []).map(Number) }))
  if (!list.length) {
    return `<div class="panel-head"><div><div class="eyebrow">КУБ СТОЛОТО</div><h2>Билетов пока нет</h2></div></div><p class="muted-text">Скажите Claude: «зайди в Кено, нажми кубик и отправь билет в Virtus Dei». Билет появится здесь, и приложение будет вести его 10 тиражей.</p>`
  }
  const min = Math.min(...list.map(t => t.target_draw_number))
  const max = Math.max(...list.map(t => t.target_draw_number + t.track_draws - 1))
  const { data: draws, error: dErr } = await supabase.from('draws').select('draw_number,draw_time,result_numbers,raw').gte('draw_number', min).lte('draw_number', max)
  if (dErr) throw dErr
  const byNo = new Map((draws || []).map(d => [Number(d.draw_number), d]))
  list[0]._open = true
  return `<div class="panel-head"><div><div class="eyebrow">КУБ СТОЛОТО · ХОД ПО ТИРАЖАМ</div><h2>Что даёт куб</h2></div><button class="icon-btn" data-cube-reload aria-label="Обновить">↻</button></div>
    ${aggregate(list, byNo)}
    ${list.map(t => ticketHTML(t, byNo)).join('')}`
}

function paint(root, html) {
  root.dataset.filled = '1'
  root.innerHTML = html
  root.querySelector('[data-cube-reload]')?.addEventListener('click', () => { cacheAt = 0; refresh() })
}

function refresh() {
  if (inflight) return inflight
  inflight = build()
    .then(html => { cacheHTML = html; cacheAt = Date.now() })
    .catch(e => { cacheHTML = `<p class="muted-text">Не удалось загрузить билеты куба: ${esc(e.message || e)}</p>`; cacheAt = Date.now() })
    .finally(() => {
      inflight = null
      const root = document.getElementById('cube-root')
      if (root) paint(root, cacheHTML)
    })
  return inflight
}

const watch = () => {
  const root = document.getElementById('cube-root')
  if (!root || root.dataset.filled === '1') return
  if (cacheHTML) paint(root, cacheHTML)
  else root.dataset.filled = '1'
  if (!cacheHTML || Date.now() - cacheAt > 60000) refresh()
}
new MutationObserver(watch).observe(document.body, { childList: true, subtree: true })
watch()
