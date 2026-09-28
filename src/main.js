import './style.css'
import { uploadScreenshot } from './services/storage.js'
import { createPendingRecognition, recognizeScreenshot } from './services/recognition.js'
import { supabaseConfigured, supabase } from './supabase.js'

const SCHEDULE = [
  '00:02','00:17','00:32','01:02','01:17','01:32','02:02','02:17','02:32','03:02','03:32','04:02',
  '04:17','04:32','05:02','05:17','05:32','06:02','06:17','06:32','07:02','07:32','08:02','08:17',
  '08:32','09:02','09:17','09:32','10:02','10:17','10:32','11:02','11:32','12:02','12:17','12:32',
  '13:02','13:17','13:32','14:02','14:17','14:32','15:02','15:32','16:02','16:17','16:32','17:02',
  '17:17','17:32','18:02','18:17','18:32','19:02','19:32','20:02','20:17','20:32','21:02','21:17',
  '21:32','22:02','22:17','22:32','23:02','23:32'
]

const state = {
  page: 'home',
  draws: [],
  drawsLoading: true,
  drawsError: null,
  screenshots: [],
  screenshotsLoading: true,
  screenshotsError: null,
  selectedId: null,
  syncing: false
}

const app = document.querySelector('#app')

function columnOf(n) { return n % 10 === 0 ? 10 : n % 10 }
function pad(n) { return String(n).padStart(2, '0') }
function escapeHtml(value) {
  const div = document.createElement('div')
  div.textContent = value ?? ''
  return div.innerHTML
}

function screenshotTarget(s) {
  return Number(s?.upload?.target_draw_number ?? s?.target_draw_number)
}

function screenshotNumbers(s) {
  return (s?.recognition?.numbers || s?.ocr_numbers || []).map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= 80)
}

function officialColumn(draw) {
  const value = Number(draw?.raw?.official_column ?? draw?.raw?.column ?? draw?.column)
  return Number.isFinite(value) && value >= 1 && value <= 10 ? value : null
}

function computedColumn(numbers = []) {
  const counts = Array(11).fill(0)
  const reach = Array(11).fill(999)
  numbers.forEach(n => counts[columnOf(Number(n))]++)
  const max = Math.max(...counts.slice(1))
  for (let c = 1; c <= 10; c++) {
    if (counts[c] !== max) continue
    let seen = 0
    for (let i = 0; i < numbers.length; i++) {
      if (columnOf(Number(numbers[i])) === c) seen++
      if (seen === max) { reach[c] = i; break }
    }
  }
  let winner = 1
  for (let c = 2; c <= 10; c++) {
    if (counts[c] > counts[winner] || (counts[c] === counts[winner] && reach[c] < reach[winner])) winner = c
  }
  return winner
}

function drawColumn(draw) {
  return officialColumn(draw) || computedColumn(draw?.result_numbers || [])
}

function drawStats(numbers = []) {
  const clean = numbers.map(Number).filter(Number.isFinite)
  const sum = clean.reduce((a,b)=>a+b,0)
  const even = clean.filter(n=>n%2===0).length
  const odd = clean.length - even
  const counts = Array(11).fill(0)
  clean.forEach(n => counts[columnOf(n)]++)
  const single = [], empty = []
  for (let c=1;c<=10;c++) {
    if (counts[c]===1) single.push(c)
    if (counts[c]===0) empty.push(c)
  }
  return { sum, even, odd, parity: even===odd?'поровну':even>odd?'чёт':'нечёт', single, empty }
}

function formatMoscow(value) {
  if (!value) return 'Время не указано'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow', day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit', hour12:false
  }).format(date).replace(',', '')
}

function moscowTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone:'Europe/Moscow', hour:'2-digit', minute:'2-digit', hour12:false
  }).format(date)
}

function nextScheduledTime(time) {
  const m = String(time || '').match(/(\d{2}):(\d{2})/)
  if (!m) return '—'
  const current = Number(m[1]) * 60 + Number(m[2])
  const rows = SCHEDULE.map(t => {
    const [h, min] = t.split(':').map(Number)
    return { t, minutes:h*60+min }
  })
  return (rows.find(x=>x.minutes>current) || rows[0]).t
}

function latestDraw() { return state.draws[0] || null }

function targetDrawNumber() {
  const latest = latestDraw()
  const latestNo = Number(latest?.draw_number || 0)
  const seen = Number(latest?.raw?.current_draw_seen)
  let target = Number.isFinite(seen) && seen > latestNo ? seen : (latestNo ? latestNo + 1 : null)
  const futureTargets = state.screenshots
    .map(s => screenshotTarget(s))
    .filter(n => Number.isFinite(n) && (!latestNo || n > latestNo))
  if (futureTargets.length) target = Math.max(Number(target || 0), ...futureTargets)
  return target || null
}

function transitionSet(index) {
  const current = state.draws[index]
  const previous = state.draws[index+1]
  if (!current || !previous) return new Set()
  return new Set((previous.result_numbers || []).filter(n => (current.result_numbers || []).includes(n)))
}

function samePositionSet(draw) {
  const nums = (draw?.result_numbers || []).map(Number)
  const asc = [...nums].sort((a,b)=>a-b)
  const out = new Set()
  nums.forEach((n,i)=>{ if (n === asc[i]) out.add(n) })
  return out
}

function screenshotsForDraw(drawNumber) {
  const target = Number(drawNumber)
  return state.screenshots.filter(s => screenshotTarget(s) === target && screenshotNumbers(s).length)
}

function analyticsFromShots(shots) {
  const usable = shots.filter(s => screenshotNumbers(s).length)
  const counts = new Map(Array.from({length:80},(_,i)=>[i+1,0]))
  for (const shot of usable) {
    const unique = new Set(screenshotNumbers(shot))
    unique.forEach(n=>counts.set(n,(counts.get(n)||0)+1))
  }
  const all = [...counts].map(([number,count])=>({number,count,share:usable.length?count/usable.length:0}))
  const seen = all.filter(x=>x.count>0)
  const top = [...seen].sort((a,b)=>b.count-a.count||a.number-b.number)
  const threshold = usable.length >= 2 ? Math.max(2,Math.ceil(usable.length*.6)) : Infinity
  const persistent = top.filter(x=>x.count>=threshold)
  const absent = all.filter(x=>x.count===0).map(x=>x.number)
  return {total:usable.length,all,top,persistent,absent,unique:seen.length}
}

function getAnalytics(drawNumber = targetDrawNumber()) {
  return analyticsFromShots(screenshotsForDraw(drawNumber))
}

function proposalCheck(draw) {
  const shots = screenshotsForDraw(draw?.draw_number)
  const analytics = analyticsFromShots(shots)
  if (!analytics.total) return null
  const fact = (draw?.result_numbers || []).map(Number)
  const proposed = new Set(analytics.top.map(x=>x.number))
  const persistent = new Set(analytics.persistent.map(x=>x.number))
  const hits = fact.filter(n=>proposed.has(n))
  const persistentHits = fact.filter(n=>persistent.has(n))
  const avoidedHits = fact.filter(n=>!proposed.has(n))
  return { shots, analytics, proposed, persistent, hits, persistentHits, avoidedHits }
}

function numberChips(numbers, cls='') {
  if (!numbers?.length) return '<span class="check-none">—</span>'
  return `<div class="check-chips">${numbers.map(n=>`<span class="${cls}">${pad(n)}</span>`).join('')}</div>`
}

function proposalCheckMarkup(check) {
  if (!check) return ''
  const persistentAll = check.analytics.persistent.map(x=>x.number)
  return `<div class="proposal-check">
    <div class="proposal-check-head"><b>ПРОВЕРКА ПРЕДЛОЖКИ</b><span>${check.analytics.total} скр. · ${check.analytics.unique} уник.</span></div>
    <div class="proposal-metrics">
      <span class="good">✓ попало ${check.hits.length}/20</span>
      <span>🎯 настойчивых ${persistentAll.length}</span>
      <span class="good">✓ настойчивых попало ${check.persistentHits.length}</span>
    </div>
    <div class="check-line"><b>Предлагал и вышли:</b>${numberChips(check.hits,'hit')}</div>
    <div class="check-line"><b>Настойчиво предлагал:</b>${numberChips(persistentAll,'persistent')}</div>
    <div class="check-line"><b>Обошёл, но вышли:</b>${numberChips(check.avoidedHits,'missed')}</div>
  </div>`
}

function drawCard(draw, index, label) {
  const numbers = (draw.result_numbers || []).map(Number)
  const stats = drawStats(numbers)
  const trans = transitionSet(index)
  const same = samePositionSet(draw)
  const column = drawColumn(draw)
  const check = proposalCheck(draw)
  const notes = [
    stats.single.length ? `<span class="single">☝️ одиночные: ${stats.single.map(x=>`ст${x}`).join(', ')}</span>` : '',
    stats.empty.length ? `<span class="empty">${stats.empty.map(x=>`ст${x} ☐ — пустой!`).join(' ')}</span>` : ''
  ].filter(Boolean).join(' · ')
  return `<section class="card draw-card ${check?'has-check':''}">
    <div class="head">
      <div>
        <div class="label">${label}</div>
        <div class="draw">№${draw.draw_number}</div>
        <div class="time">${formatMoscow(draw.draw_time || draw.created_at)}</div>
      </div>
      <div class="win">🔴 ст${column || '—'}</div>
    </div>
    <div class="meta"><span>Σ ${stats.sum}</span><span>${stats.even}/${stats.odd}</span><span>${stats.parity}</span>${check?`<span class="verified-meta">проверка ${check.analytics.total} скр.</span>`:''}</div>
    <div class="numbers">${numbers.map(n=>{
      const proposalHit = Boolean(check?.proposed.has(n))
      const persistentHit = Boolean(check?.persistent.has(n))
      const classes = ['ball', trans.has(n)?'pass':'', same.has(n)?'same':'', proposalHit?'proposal-hit':'', persistentHit?'persistent-hit':''].filter(Boolean).join(' ')
      const marks = `${trans.has(n)?'<i class="transition-mark">◆</i>':''}${proposalHit?'<i class="proposal-mark">✓</i>':''}`
      return `<div class="${classes}">${pad(n)}${marks?`<span class="ball-marks">${marks}</span>`:''}</div>`
    }).join('')}</div>
    ${notes ? `<div class="notes">${notes}</div>` : ''}
    ${proposalCheckMarkup(check)}
  </section>`
}

function nextDrawBanner() {
  const latest = latestDraw()
  if (!latest) return `<div class="next-banner"><span>СЛЕД ТИРАЖ</span><b>—</b></div>`
  const nextNo = Number(latest.draw_number) + 1
  const nextTime = nextScheduledTime(moscowTime(latest.draw_time || latest.created_at))
  return `<div class="next-banner"><span>СЛЕД ТИРАЖ</span> <b>№${nextNo}</b><em>·</em><strong>${nextTime}</strong></div>`
}

function topBar() {
  return `<div class="top">
    <div>
      <div class="brand">✦ VIRTUS DEI</div>
      <div class="sub">скриншоты · факт · анализ предложки</div>
    </div>
    <button class="icon" data-refresh title="Обновить">↻</button>
  </div>`
}

function homeView() {
  const cards = state.drawsLoading
    ? `<section class="card small">Загружаю тиражи…</section>`
    : state.drawsError
      ? `<section class="card small error">Ошибка загрузки: ${escapeHtml(state.drawsError)}</section>`
      : state.draws.slice(0,3).map((d,i)=>drawCard(d,i,['ПОСЛЕДНИЙ ТИРАЖ','ПРЕДЫДУЩИЙ ТИРАЖ','ПРЕДПРЕДЫДУЩИЙ ТИРАЖ'][i] || 'ТИРАЖ')).join('')
  const target = targetDrawNumber()
  const analytics = getAnalytics(target)
  return `${topBar()}
    ${nextDrawBanner()}
    <main id="cards">${cards}</main>
    <div class="section"><span>Скриншоты перед тиражом ${target ? `№${target}` : ''}</span></div>
    <section class="card action-card">
      <div class="action-row">
        <button class="tool primary" data-page="upload">▣ Загрузить скрин</button>
        <button class="tool" data-page="analysis">◎ Анализ скриншотов</button>
      </div>
      <div class="small">${state.screenshotsLoading ? 'Поднимаю сохранённые проверки…' : analytics.total ? `Для №${target}: распознано ${analytics.total} скрин(ов).` : `Для №${target || '—'} скринов пока нет.`}</div>
      ${analytics.total ? `<div class="mini-summary"><span>Настойчиво: ${analytics.persistent.slice(0,8).map(x=>x.number).join(', ') || 'пока нет серии'}</span><span>Обходит: ${analytics.absent.slice(0,12).join(', ') || '—'}</span></div>` : ''}
      ${state.screenshotsError ? `<div class="small error">История скринов: ${escapeHtml(state.screenshotsError)}</div>` : ''}
    </section>`
}

function uploadView() {
  const target = targetDrawNumber()
  const currentShots = state.screenshots.filter(s=>screenshotTarget(s)===Number(target) && !s.persisted)
  const selected = currentShots.find(x=>x.id===state.selectedId) || currentShots.at(-1)
  return `${topBar()}
    <div class="section"><span>▣ Загрузить скрин</span><button class="back" data-page="home">← Главная</button></div>
    <section class="card upload-card">
      <div class="label">СКРИНЫ ИДУТ В ТИРАЖ</div>
      <div class="draw">${target ? `№${target}` : 'Определяется…'}</div>
      <label class="dropzone"><input id="fileInput" type="file" accept="image/png,image/jpeg,image/webp" multiple hidden><b>＋ Выбрать скриншоты</b><span>PNG · JPG · WEBP</span></label>
      <div id="processing" class="small"></div>
    </section>
    <div class="section"><span>Загруженные сейчас</span></div>
    <div class="shots">${currentShots.length ? currentShots.slice().reverse().map((s,i)=>`<button class="shot ${selected?.id===s.id?'on':''}" data-shot="${s.id}">${s.localUrl?`<img src="${s.localUrl}" alt="">`:'<div class="shot-placeholder">▣</div>'}<span><b>Скрин ${currentShots.length-i}</b><small>${statusText(s)}</small></span></button>`).join('') : `<section class="card small">Для тиража №${target || '—'} новых скриншотов пока нет.</section>`}</div>
    ${selected ? `<section class="card preview-card"><div class="label">ПРОСМОТР</div>${selected.localUrl?`<img src="${selected.localUrl}" alt="">`:''}<div class="recognized">${screenshotNumbers(selected).map(n=>`<span>${n}</span>`).join('')}</div><div class="small">${escapeHtml(selected.recognition?.message||'')}</div></section>` : ''}`
}

function historyCheckCard(drawNumber) {
  const analytics = getAnalytics(drawNumber)
  const draw = state.draws.find(d=>Number(d.draw_number)===Number(drawNumber))
  if (!analytics.total) return ''
  if (!draw) return `<section class="card history-check"><div class="head"><div><div class="label">СОХРАНЁННАЯ ПРЕДЛОЖКА</div><div class="draw">№${drawNumber}</div></div><div class="history-count">${analytics.total} скр.</div></div><div class="small">Факта этого тиража нет в загруженном окне архива.</div>${bars(analytics.top.slice(0,10),analytics.total)}</section>`
  const check = proposalCheck(draw)
  return `<section class="card history-check"><div class="head"><div><div class="label">СОХРАНЁННАЯ ПРОВЕРКА</div><div class="draw">№${drawNumber}</div></div><div class="history-count">${analytics.total} скр.</div></div>${proposalCheckMarkup(check)}</section>`
}

function analysisView() {
  const target = targetDrawNumber()
  const a = getAnalytics(target)
  const historyDraws = [...new Set(state.screenshots.map(s=>screenshotTarget(s)).filter(Number.isFinite))]
    .sort((x,y)=>y-x)
    .filter(n=>n!==Number(target))
  return `${topBar()}
    <div class="section"><span>◎ Анализ скриншотов</span><button class="back" data-page="home">← Главная</button></div>
    <section class="card"><div class="label">ТЕКУЩИЙ ЦЕЛЕВОЙ ТИРАЖ</div><div class="draw">${target ? `№${target}` : '—'}</div><div class="meta"><span>скринов ${a.total}</span><span>обходит ${a.absent.length}</span></div></section>
    ${a.total ? `
      <section class="card"><div class="label green">🎯 НАСТОЙЧИВО ПРЕДЛАГАЕТ</div>${a.persistent.length?bars(a.persistent,a.total):'<div class="small">Для настойчивого сигнала нужно повторение минимум на двух скринах и ≥60% набора.</div>'}</section>
      <section class="card"><div class="label">ЧАЩЕ ВСЕГО ПРЕДЛАГАЕТ</div>${bars(a.top.slice(0,12),a.total)}</section>
      <section class="card"><div class="label red">⊘ ОБХОДИТ / НЕ ПОКАЗЫВАЕТ</div><div class="chip-grid">${a.absent.map(n=>`<span>${n}</span>`).join('')}</div></section>
      <section class="card"><div class="label">КАРТА 1–80</div><div class="map">${a.all.map(x=>`<span class="m ${mapClass(x,a.total)}"><b>${x.number}</b><small>${x.count}×</small></span>`).join('')}</div></section>`
      : `<section class="card small">Для текущего тиража №${target || '—'} скриншотов пока нет. Ниже остаются сохранённые проверки прошлых тиражей.</section>`}
    <div class="section"><span>Сохранённые проверки</span></div>
    ${state.screenshotsLoading ? `<section class="card small">Загружаю историю скринов…</section>` : historyDraws.length ? historyDraws.slice(0,12).map(historyCheckCard).join('') : `<section class="card small">Сохранённых проверок пока нет.</section>`}`
}

function archiveView() {
  return `${topBar()}
    <div class="section"><span>▦ Архив тиражей</span><button class="back" data-page="home">← Главная</button></div>
    ${state.drawsLoading ? `<section class="card small">Загрузка…</section>` : state.draws.map((d,i)=>drawCard(d,i,i===0?'ПОСЛЕДНИЙ ТИРАЖ':'ТИРАЖ')).join('')}`
}

function footer() {
  return `<div class="footer"><div class="footerin">
    <button data-page="home" class="${state.page==='home'?'on':''}"><b>⌂</b>Главная</button>
    <button data-page="archive" class="${state.page==='archive'?'on':''}"><b>▦</b>Архив</button>
    <button data-page="analysis" class="${state.page==='analysis'?'on':''}"><b>◎</b>Анализ</button>
    <button data-refresh><b>↻</b>Обновить</button>
  </div></div>`
}

function render() {
  let body = homeView()
  if (state.page==='upload') body = uploadView()
  else if (state.page==='analysis') body = analysisView()
  else if (state.page==='archive') body = archiveView()
  app.innerHTML = `<div class="app">${body}</div>${footer()}`
  bindEvents()
}

function bindEvents() {
  document.querySelectorAll('[data-page]').forEach(btn => btn.addEventListener('click',()=>{
    state.page = btn.dataset.page
    render()
    scrollTo({top:0,behavior:'smooth'})
  }))
  document.querySelectorAll('[data-refresh]').forEach(btn => btn.addEventListener('click',refreshAll))
  document.querySelectorAll('[data-shot]').forEach(btn => btn.addEventListener('click',()=>{
    state.selectedId = btn.dataset.shot
    render()
  }))
  const input = document.querySelector('#fileInput')
  if (input) input.addEventListener('change',handleFiles)
}

function statusText(s) {
  if (s.recognition?.status === 'verified') return `✓ 10/10 · ${s.persisted || (s.upload?.mode === 'cloud' && s.recognition.saved !== false) ? 'сохранён' : 'распознан'}`
  if (s.recognition?.status === 'review') return `⚠ проверить · ${s.recognition.numbers?.length || 0}`
  if (s.recognition?.status === 'pending') return '… обработка'
  if (s.recognition?.status === 'error') return '✕ ошибка'
  return '… обработка'
}

async function handleFiles(event) {
  const files = [...event.target.files]
  if (!files.length) return
  const target = targetDrawNumber()
  for (const file of files) {
    const item = {
      id: crypto.randomUUID(), file, localUrl: URL.createObjectURL(file), createdAt:new Date().toISOString(), persisted:false,
      upload:{mode:'pending',target_draw_number:target}, recognition:createPendingRecognition(file)
    }
    state.screenshots.push(item)
    state.selectedId = item.id
    render()
    try { item.upload = await uploadScreenshot(file,target || 'pending') }
    catch (err) { item.upload = {mode:'local',target_draw_number:target,error:err.message || String(err)} }
    try {
      item.recognition = await recognizeScreenshot(file,item.upload?.screenshot_id)
      if (item.upload?.error) item.recognition.message = `${item.recognition.message || ''} Облако: ${item.upload.error}`.trim()
    } catch (err) {
      item.recognition = {status:'error',confidence:null,numbers:[],message:`Ошибка обработки: ${err.message || err}`}
    }
    render()
  }
  event.target.value = ''
  await loadScreenshotHistory(false)
}

function bars(items,total) {
  if (!items.length) return `<div class="small">Недостаточно данных</div>`
  return `<div class="bars">${items.slice(0,12).map(x=>{
    const pct = total ? Math.round(x.count/total*100) : 0
    return `<div><b>${x.number}</b><span><i style="width:${Math.max(5,pct)}%"></i></span><em>${pct}%</em></div>`
  }).join('')}</div>`
}

function mapClass(x,total) {
  if (!x.count) return 'zero'
  const share = total ? x.count/total : 0
  if (share>=.6) return 'hot'
  if (share>=.3) return 'warm'
  return 'cool'
}

async function loadDraws(manual=false) {
  if (!supabase) {
    state.drawsLoading = false
    state.drawsError = 'Supabase не подключён'
    if (manual) render()
    return
  }
  const {data,error} = await supabase.from('draws').select('draw_number,draw_time,result_numbers,source,raw,created_at').order('draw_number',{ascending:false}).limit(80)
  state.drawsLoading = false
  state.drawsError = error ? error.message : null
  if (!error) state.draws = data || []
  if (manual) render()
}

async function loadScreenshotHistory(manual=false) {
  if (!supabase) {
    state.screenshotsLoading = false
    state.screenshotsError = 'Supabase не подключён'
    if (manual) render()
    return
  }
  const {data,error} = await supabase.rpc('get_screenshot_analysis_history',{limit_rows:500})
  state.screenshotsLoading = false
  state.screenshotsError = error ? error.message : null
  if (!error) {
    const persisted = (data || []).map(row => ({
      id:`cloud:${row.id}`,
      persisted:true,
      localUrl:null,
      createdAt:row.created_at,
      upload:{mode:'cloud-history',target_draw_number:Number(row.target_draw_number),screenshot_id:row.id},
      recognition:{
        status:row.ocr_status || 'pending',
        confidence:row.ocr_confidence == null ? null : Number(row.ocr_confidence),
        numbers:(row.ocr_numbers || []).map(Number),
        message:'Сохранённая проверка из облака.'
      }
    }))
    const locals = state.screenshots.filter(s=>!s.persisted)
    const byKey = new Map()
    persisted.forEach(s=>byKey.set(String(s.upload?.screenshot_id || s.id),s))
    locals.forEach(s=>byKey.set(String(s.upload?.screenshot_id || s.id),s))
    state.screenshots = [...byKey.values()]
  }
  if (manual) render()
}

async function refreshAll() {
  if (state.syncing) return
  state.syncing = true
  render()
  await Promise.all([loadDraws(false),loadScreenshotHistory(false)])
  state.syncing = false
  render()
}

window.addEventListener('error', event => {
  if (!document.querySelector('#app')?.children.length) {
    app.innerHTML = `<div class="app"><section class="card"><b>Ошибка запуска</b><div class="small">${escapeHtml(event.message || 'Неизвестная ошибка')}</div></section></div>`
  }
})

render()
refreshAll()
