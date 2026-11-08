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
    const cubeHits = t.cube_numbers.length ? t.cube_numbers.filter(n => set.has(n)) : null
    const removedHits = t.removed.filter(n => set.has(n))
    const addedHits = t.added.filter(n => set.has(n))
    const col = drawColumn(d)
    const par = drawParity(fact)
    rows.push({ no, time: d.draw_time, hits, cubeHits, removedHits, addedHits, col, colHit: t.columns.length ? t.columns.includes(col) : null, par, parHit: t.parity ? t.parity === par : null })
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
  const addedSet = new Set(t.added)
  const balls = t.numbers.map(n => `<span class="cube-ball${allHits.has(n) ? ' hit' : ''}${addedSet.has(n) ? ' added' : ''}">${n}</span>`).join('')
    + t.removed.map(n => `<span class="cube-ball removed" title="убрано из куба">${n}</span>`).join('')
  const changed = !t._shadow && (t.removed.length || t.added.length)
  const extra = [
    t.columns.length ? `столбы ${t.columns.join(', ')}` : '',
    t.parity ? `чётность: ${PARITY[t.parity]}` : '',
    ''
  ].filter(Boolean).join(' · ')
  const change = changed ? `<div class="cube-change">Куб изменён: ${t.removed.length ? `убрано ${t.removed.join(', ')}` : ''}${t.removed.length && t.added.length ? ' · ' : ''}${t.added.length ? `добавлено ${t.added.join(', ')}` : ''}</div>` : (t.cube_numbers.length && !t._shadow && strategyOf(t) !== 'cube' ? '<div class="cube-change same">Куб без изменений</div>' : '')
  const body = rows.map(r => r.pending
    ? `<tr class="pending"><td>№${r.no}</td><td colspan="${changed ? 5 : 4}">ожидание</td></tr>`
    : `<tr><td>№${r.no}<small>${timeMsk(r.time)}</small></td><td class="${r.hits.length >= 4 ? 'good' : ''}"><b>${r.hits.length}</b>${r.hits.length ? `<small>${r.hits.join(' ')}</small>` : ''}</td>${changed ? `<td>${r.cubeHits.length}<small>${r.removedHits.length ? `убранные: ${r.removedHits.join(' ')}` : ''}${r.addedHits.length ? ` добавл.: ${r.addedHits.join(' ')}` : ''}</small></td>` : ''}<td class="${r.colHit === true ? 'good' : r.colHit === false ? 'bad' : ''}">ст${r.col ?? '—'}</td><td class="${r.parHit === true ? 'good' : r.parHit === false ? 'bad' : ''}">${PARITY[r.par]}</td></tr>`
  ).join('')
  return `<details class="cube-ticket"${t._open ? ' open' : ''}>
    <summary>
      <div class="cube-top">${chip(strategyOf(t))}<b>№${t.target_draw_number}</b>${t._strategy === 'iris' ? '<span class="cube-status">авто</span>' : t._shadow ? '<span class="cube-status">без правок</span>' : `<span class="cube-status ${t.status}">${t.status === 'real' ? 'куплен' : 'отслеживаю'}</span>`}<i>⌄</i></div>
      <div class="cube-balls">${balls}</div>
      ${extra ? `<div class="cube-extra">${esc(extra)}</div>` : ''}
      ${change}
      <div class="cube-sum">${esc(summary(rows, t))}</div>
    </summary>
    <table class="cube-table"><thead><tr><th>Тираж</th><th>Совпало</th>${changed ? '<th>Куб дал бы</th>' : ''}<th>Столб</th><th>Чётность</th></tr></thead><tbody>${body}</tbody></table>
    ${t.reason || t.note ? `<div class="cube-note">${esc(t.reason || t.note)}</div>` : ''}
  </details>`
}

// ───── Стратегии ─────
const STRATS = {
  cube: { label: 'Куб', hint: 'что дал кубик Столото, без правок' },
  kub1: { label: 'КУБ-1', hint: 'куб, поправленный по матрице столбов и чисел' },
  iris: { label: 'Iris', hint: '7 повторов последних 6 тиражей, считается само' },
  alex: { label: 'Александр', hint: 'ваши билеты' }
}
const strategyOf = t => t._strategy || (t.algo === 'КУБ-1' ? 'kub1' : t.algo === 'Александр' ? 'alex' : 'cube')
const chip = k => `<span class="cube-chip s-${k}">${STRATS[k].label}</span>`

// Правило Iris: из последних 6 тиражей — числа, выпавшие 2+ раза; берём те, что есть в 1–2 последних
// тиражах, и собираем 7 штук плотной группой (общие ряды/столбы на поле 8×10).
function irisPick(prev) {
  if (prev.length < 6) return null
  const win = prev.slice(-6)
  const cnt = new Map()
  win.forEach(d => clean(d.result_numbers).forEach(n => cnt.set(n, (cnt.get(n) || 0) + 1)))
  const recent = new Set([...clean(prev.at(-1).result_numbers), ...clean(prev.at(-2).result_numbers)])
  const rowOf = n => Math.ceil(n / 10)
  let cand = [...recent].filter(n => (cnt.get(n) || 0) >= 2)
  if (cand.length < 7) cand = [...cnt.keys()].filter(n => cnt.get(n) >= 2)
  const pick = []
  const score = n => cnt.get(n) * 10 + pick.filter(m => rowOf(m) === rowOf(n) || columnOf(m) === columnOf(n)).length * 4 + cand.filter(m => m !== n && (rowOf(m) === rowOf(n) || columnOf(m) === columnOf(n))).length
  while (pick.length < 7 && cand.length) {
    cand.sort((x, y) => score(y) - score(x) || x - y)
    pick.push(cand.shift())
  }
  return pick.length === 7 ? pick.sort((x, y) => x - y) : null
}

function irisTickets(draws, latestNo) {
  const sorted = [...draws].sort((x, y) => Number(x.draw_number) - Number(y.draw_number))
  const out = []
  for (let i = 6; i <= sorted.length; i++) {
    const target = i < sorted.length ? Number(sorted[i].draw_number) : latestNo + 1
    const nums = irisPick(sorted.slice(0, i))
    if (!nums) continue
    out.push({ id: 'iris-' + target, _strategy: 'iris', target_draw_number: target, numbers: nums, cube_numbers: [], removed: [], added: [], columns: [], parity: null, status: 'track', track_draws: 10, algo: 'Iris', reason: 'Повторы последних 6 тиражей, взяты из двух свежих тиражей плотной группой' })
  }
  return out
}

// Тень «куба»: что дал бы кубик без правок (для честного сравнения с КУБ-1)
function cubeShadows(tickets) {
  return tickets.filter(t => strategyOf(t) === 'kub1' && t.cube_numbers.length).map(t => ({ ...t, id: 'shadow-' + t.id, _strategy: 'cube', _shadow: true, numbers: t.cube_numbers, removed: [], added: [] }))
}

function stratStats(list, byNo) {
  const rows = list.flatMap(t => ticketRows(t, byNo).filter(r => !r.pending).map(r => ({ r, t })))
  if (!rows.length) return { tickets: list.length, draws: 0 }
  const pct = Math.round(rows.reduce((a, x) => a + x.r.hits.length / Math.max(1, x.t.numbers.length), 0) / rows.length * 100)
  const best = rows.reduce((b, x) => (x.r.hits.length / x.t.numbers.length > b.v ? { v: x.r.hits.length / x.t.numbers.length, h: x.r.hits.length, n: x.t.numbers.length } : b), { v: -1 })
  const big = rows.filter(x => x.r.hits.length >= Math.ceil(x.t.numbers.length * 0.6)).length
  const col = rows.filter(x => x.r.colHit !== null), par = rows.filter(x => x.r.parHit !== null)
  return { tickets: list.length, draws: rows.length, pct, best: `${best.h} из ${best.n}`, big,
    col: col.length ? `${col.filter(x => x.r.colHit).length}/${col.length}` : '—',
    par: par.length ? `${par.filter(x => x.r.parHit).length}/${par.length}` : '—' }
}

function compareHTML(groups, byNo) {
  const rows = Object.keys(STRATS).map(k => {
    const st = stratStats(groups[k] || [], byNo)
    const tone = !st.draws ? '' : st.pct > 25 ? 'up' : st.pct < 25 ? 'down' : ''
    return `<button class="cmp-row ${state.filter === k ? 'on' : ''}" data-cube-filter="${k}">
      <span class="cmp-name">${chip(k)}<small>${STRATS[k].hint}</small></span>
      <span class="cmp-pct ${tone}">${st.draws ? st.pct + '%' : '—'}<small>${st.draws ? (tone === 'up' ? 'ведёт' : tone === 'down' ? 'уводит' : 'норма') : 'ждём тиражи'}</small></span>
      <span class="cmp-cell"><b>${st.tickets}</b><small>билетов</small></span>
      <span class="cmp-cell"><b>${st.draws ? st.best : '—'}</b><small>лучший</small></span>
      <span class="cmp-cell"><b>${st.draws ? st.big : '—'}</b><small>крупных</small></span>
      <span class="cmp-cell"><b>${st.col}</b><small>столб</small></span>
      <span class="cmp-cell"><b>${st.par}</b><small>чётность</small></span>
    </button>`
  }).join('')
  return `<div class="cmp">${rows}</div>
  <p class="cube-hint">% — сколько чисел билета совпадает в среднем за тираж. Норма для любых чисел — 25% (20 из 80): выше — стратегия ведёт, ниже — уводит. «Крупных» — тиражей, где совпало 60% билета и больше (например 5 из 7, 6 из 10). Нажмите на строку, чтобы оставить только эту стратегию.</p>`
}

const state = { filter: 'all' }
let lastData = null

function filtersHTML(groups) {
  const keys = ['all', ...Object.keys(STRATS)]
  return `<div class="cube-filters">${keys.map(k => `<button data-cube-filter="${k}" class="${state.filter === k ? 'on' : ''}">${k === 'all' ? 'Все' : STRATS[k].label}<i>${k === 'all' ? Object.values(groups).reduce((a, g) => a + g.length, 0) : (groups[k] || []).length}</i></button>`).join('')}</div>`
}

function render(data) {
  const { groups, byNo } = data
  let list = state.filter === 'all' ? [...(groups.kub1 || []), ...(groups.alex || []), ...(groups.cube || []).filter(t => !t._shadow), ...(groups.iris || []).slice(0, 12)] : [...(groups[state.filter] || [])]
  if (state.filter === 'iris') list = list.slice(0, 40)
  list.sort((x, y) => y.target_draw_number - x.target_draw_number)
  list.forEach(t => { t._open = false })
  if (list[0]) list[0]._open = true
  const note = state.filter === 'iris' ? '<p class="cube-hint">Билеты Iris собираются автоматически на каждый тираж. Показаны последние 40.</p>'
    : state.filter === 'cube' ? '<p class="cube-hint">Сюда входят и «тени» билетов КУБ-1 — что дал бы куб без правок.</p>' : ''
  return `<div class="panel-head"><div><div class="eyebrow">КУБ СТОЛОТО · СТРАТЕГИИ</div><h2>Кто ведёт, кто уводит</h2></div><button class="icon-btn" data-cube-reload aria-label="Обновить">↻</button></div>
    ${compareHTML(groups, byNo)}
    ${filtersHTML(groups)}
    ${note}
    ${list.length ? list.map(t => ticketHTML(t, byNo)).join('') : '<p class="muted-text">Билетов этой стратегии пока нет.</p>'}`
}

async function build() {
  if (!supabase) throw new Error('Supabase не настроен')
  const { data: tickets, error } = await supabase.from('cube_tickets').select('*').order('created_at', { ascending: false }).limit(200)
  if (error) throw error
  const list = (tickets || []).map(t => ({ ...t, numbers: clean(t.numbers), cube_numbers: clean(t.cube_numbers), removed: clean(t.removed), added: clean(t.added), columns: (t.columns || []).map(Number) }))
  const { data: recent, error: rErr } = await supabase.from('draws').select('draw_number,draw_time,result_numbers,raw').order('draw_number', { ascending: false }).limit(90)
  if (rErr) throw rErr
  const latestNo = Number(recent?.[0]?.draw_number || 0)
  const minTicket = list.length ? Math.min(...list.map(t => t.target_draw_number)) : latestNo
  let older = []
  const oldestRecent = Math.min(...(recent || []).map(d => Number(d.draw_number)))
  if (minTicket < oldestRecent) {
    const { data: o, error: oErr } = await supabase.from('draws').select('draw_number,draw_time,result_numbers,raw').gte('draw_number', minTicket).lt('draw_number', oldestRecent)
    if (oErr) throw oErr
    older = o || []
  }
  const all = [...older, ...(recent || [])]
  const byNo = new Map(all.map(d => [Number(d.draw_number), d]))
  const iris = irisTickets(recent || [], latestNo).sort((x, y) => y.target_draw_number - x.target_draw_number)
  const groups = { cube: [], kub1: [], iris, alex: [] }
  list.forEach(t => groups[strategyOf(t)].push(t))
  groups.cube.push(...cubeShadows(list))
  return { groups, byNo }
}
function paint(root, html) {
  root.dataset.filled = '1'
  root.innerHTML = html
  root.querySelector('[data-cube-reload]')?.addEventListener('click', () => { cacheAt = 0; refresh() })
  root.querySelectorAll('[data-cube-filter]').forEach(b => b.addEventListener('click', () => {
    const k = b.dataset.cubeFilter
    state.filter = state.filter === k && k !== 'all' ? 'all' : k
    if (lastData) { cacheHTML = render(lastData); paint(root, cacheHTML) }
  }))
}

function refresh() {
  if (inflight) return inflight
  inflight = build()
    .then(data => { lastData = data; cacheHTML = render(data); cacheAt = Date.now() })
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
