import './style.css'
import { uploadScreenshot } from './services/storage.js'
import { createPendingRecognition, recognizeScreenshot } from './services/recognition.js'
import { supabaseConfigured, supabase } from './supabase.js'

const state = {
  screenshots: [],
  selectedId: null,
  page: 'dashboard',
  draws: [],
  drawsLoading: true,
  drawsError: null
}

const navItems = [
  ['dashboard', '⌂', 'Главная'],
  ['upload', '▣', 'Загрузить скрин'],
  ['analysis', '◎', 'Анализ скриншотов'],
  ['draws', '◫', 'Тиражи'],
  ['fact', '✦', 'Факт'],
  ['compare', '◑', 'Сравнение'],
  ['archive', '▤', 'Архив']
]

const app = document.querySelector('#app')
app.innerHTML = `
<div class="shell">
  <aside class="sidebar">
    <div class="brand">
      <img class="brand-icon" src="${import.meta.env.BASE_URL}icons/virtus-dei-512.png" alt="Virtus Dei" width="112" height="112">
      <b>Virtus Dei</b><small>est — id est nobis</small>
    </div>
    <nav id="nav"></nav>
    <div class="system-card"><span class="online-dot"></span><div><small>Статус</small><b>${supabaseConfigured ? 'Онлайн' : 'Локально'}</b></div></div>
  </aside>
  <div class="app-column">
    <div class="mobile-topbar">
      <div class="mobile-brand"><img src="${import.meta.env.BASE_URL}icons/virtus-dei-192.png" alt=""><div><b>Virtus Dei</b><small>est — id est nobis</small></div></div>
      <button id="mobileMenu" class="icon-button">☰</button>
    </div>
    <main id="page"></main>
  </div>
</div>`

const nav = document.querySelector('#nav')
nav.innerHTML = navItems.map(([key, icon, label]) => `<button class="nav" data-page="${key}"><span>${icon}</span>${label}</button>`).join('')
nav.addEventListener('click', event => {
  const button = event.target.closest('[data-page]')
  if (!button) return
  state.page = button.dataset.page
  render()
  document.querySelector('.sidebar')?.classList.remove('open')
})
document.querySelector('#mobileMenu').onclick = () => document.querySelector('.sidebar')?.classList.toggle('open')

function render() {
  document.querySelectorAll('.nav').forEach(btn => btn.classList.toggle('active', btn.dataset.page === state.page))
  const page = document.querySelector('#page')
  if (state.page === 'dashboard') page.innerHTML = dashboardView()
  else if (state.page === 'upload') page.innerHTML = uploadView()
  else if (state.page === 'analysis') page.innerHTML = analysisView()
  else if (state.page === 'draws') page.innerHTML = drawsView()
  else if (state.page === 'fact') page.innerHTML = factView()
  else if (state.page === 'compare') page.innerHTML = compareView()
  else page.innerHTML = archiveView()
  bindPageEvents()
}

function pageHeader(title, subtitle) {
  const now = new Date().toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })
  return `<header class="page-header"><div><h1>${title}</h1><p>${subtitle}</p></div><div class="header-meta"><span>${now}</span><span class="cloud ${supabaseConfigured ? 'ok' : 'warn'}">${supabaseConfigured ? '● Облако' : '○ Локально'}</span></div></header>`
}

function latestDraw() {
  return state.draws[0] || null
}

function currentTargetDraw() {
  const uploaded = state.screenshots.map(s => Number(s.upload?.target_draw_number)).filter(Number.isFinite)
  if (uploaded.length) return Math.max(...uploaded)
  const latest = latestDraw()
  const seen = Number(latest?.raw?.current_draw_seen)
  if (Number.isFinite(seen) && seen > Number(latest?.draw_number || 0)) return seen
  return latest?.draw_number ? Number(latest.draw_number) + 1 : null
}

function drawColumn(draw) {
  const value = Number(draw?.raw?.official_column)
  return Number.isFinite(value) && value >= 1 && value <= 10 ? value : null
}

function dashboardView() {
  const analytics = getAnalytics()
  const target = currentTargetDraw()
  const last = latestDraw()
  return `${pageHeader('Главная', 'Текущий цикл и состояние системы')}
  <section class="current-cycle">
    <div class="cycle-main"><small>ТЕКУЩИЙ ТИРАЖ ДЛЯ СКРИНОВ</small><strong>${target ? `№ ${target}` : 'Определяется…'}</strong><span>${state.screenshots.length ? `${state.screenshots.length} скрин(ов) уже привязано` : 'Загрузите скриншоты до выхода факта'}</span><div class="hero-actions"><button class="primary" data-go="upload">+ Загрузить скрин</button><button class="secondary" data-go="analysis">Анализ скриншотов</button></div></div>
    <div class="last-fact"><small>Последний фактический тираж</small>${last ? `<b>№ ${last.draw_number}</b><div class="draw-balls compact">${balls(last.result_numbers)}</div><span>${drawColumn(last) ? `Столб ${drawColumn(last)}` : 'Столб не получен'}</span>` : `<b>${state.drawsLoading ? 'Загрузка…' : 'Нет данных'}</b>`}</div>
  </section>
  <section class="quick-grid">
    ${quickCard('▣','Загрузить скрин', target ? `Для тиража №${target}` : 'Текущий цикл','upload')}
    ${quickCard('◎','Анализ скриншотов','Настойчивость и обход','analysis')}
    ${quickCard('◫','Тиражи','Живые факты из базы','draws')}
    ${quickCard('✦','Факт', last ? `Последний №${last.draw_number}` : 'Ждём данные','fact')}
  </section>
  <section class="dashboard-grid">
    <div class="panel"><div class="panel-title"><div><h3>Последние скриншоты</h3><p>${target ? `Привязка к тиражу №${target}` : 'Текущая сессия'}</p></div></div>${miniShots()}</div>
    <div class="panel"><div class="panel-title"><div><h3>Сводка алгоритма</h3><p>По распознанным скриншотам</p></div></div>${analyticsSummary(analytics)}</div>
  </section>`
}

function quickCard(icon, title, text, page) {
  return `<button class="quick-card" data-go="${page}"><span class="quick-icon">${icon}</span><div><b>${title}</b><small>${text}</small></div><i>→</i></button>`
}

function uploadView() {
  const target = currentTargetDraw()
  return `${pageHeader('Загрузить скрин', 'Скриншоты автоматически привязываются к следующему тиражу')}
  <section class="target-banner"><div><small>СКРИНЫ ИДУТ В ТИРАЖ</small><strong>${target ? `№ ${target}` : 'Определяем номер…'}</strong><span>После выхода этого тиража его факт появится в разделе «Факт».</span></div><button class="secondary" data-go="draws">Посмотреть тиражи →</button></section>
  <section class="upload-layout">
    <div class="panel upload-panel"><label class="dropzone"><input id="fileInput" type="file" accept="image/png,image/jpeg,image/webp" multiple hidden><span class="upload-symbol">⇧</span><b>Перетащите или выберите скриншоты</b><small>PNG, JPG, JPEG, WEBP · можно выбрать несколько</small><span class="primary fake-button">Выбрать файлы</span></label><div class="upload-status"><span id="processing"></span><b>${state.screenshots.length} загружено</b></div></div>
    <div class="panel requirements"><h3>После загрузки</h3><div class="check-row">✓ <span>Скрин получает номер целевого тиража</span></div><div class="check-row">✓ <span>Распознаются 10 выбранных чисел</span></div><div class="check-row">✓ <span>Пересчитывается настойчивость и обход</span></div><div class="check-row">✓ <span>После выхода факта можно сравнивать</span></div><button class="secondary full" data-go="analysis">Перейти в анализ →</button></div>
  </section>
  <section class="workspace"><div class="panel grow"><div class="panel-title"><div><h3>Загруженные скриншоты</h3><p>${target ? `Цель: тираж №${target}` : 'Текущая сессия'}</p></div></div><div id="shots" class="shots">${shotsMarkup()}</div></div><div class="panel detail"><div class="panel-title"><div><h3>Просмотр</h3><p>Распознанные числа</p></div></div><div id="detail">${detailMarkup()}</div></div></section>`
}

function analysisView() {
  const a = getAnalytics()
  const target = currentTargetDraw()
  return `${pageHeader('Анализ скриншотов', target ? `Анализ предложки перед тиражом №${target}` : 'Что алгоритм предлагает и обходит')}
  <section class="summary-strip"><div><small>Целевой тираж</small><strong>${target ? `№${target}` : '—'}</strong></div><div><small>Скриншотов</small><strong>${a.total}</strong></div><div><small>Самое частое</small><strong>${a.top[0]?.number ?? '—'}</strong></div><div><small>Не встречались</small><strong>${a.absent.length}</strong></div></section>
  ${a.total === 0 ? emptyAnalysis() : `<section class="analysis-grid"><div class="signal-card persistent"><div class="signal-head"><div><span>🎯</span><div><h3>Настойчиво предлагает</h3><p>Повторяется в большой доле скриншотов</p></div></div><span class="signal-count">${a.persistent.length}</span></div>${numberBars(a.persistent, a.total, 'green')}</div><div class="signal-card avoided"><div class="signal-head"><div><span>⊘</span><div><h3>Обходит / избегает</h3><p>Не показывает вообще или почти не показывает</p></div></div><span class="signal-count">${a.absent.length}</span></div>${avoidedMarkup(a)}</div></section><section class="analysis-grid secondary-analysis"><div class="panel"><div class="panel-title"><div><h3>Часто встречаются</h3><p>Рейтинг чисел</p></div></div>${numberBars(a.top.slice(0,12), a.total, 'blue')}</div><div class="panel"><div class="panel-title"><div><h3>Редко встречаются</h3><p>Есть, но слабо</p></div></div>${rareMarkup(a)}</div></section><section class="panel all-frequency"><div class="panel-title"><div><h3>Карта 1–80</h3><p>Сколько раз каждое число было предложено</p></div></div><div class="number-map">${a.all.map(x => `<div class="map-cell ${cellClass(x.count,a.total)}"><b>${x.number}</b><small>${x.count}×</small></div>`).join('')}</div></section>`}`
}

function drawsView() {
  return `${pageHeader('Тиражи', 'Последние фактические тиражи из базы Stoloto')}${state.drawsLoading ? `<section class="panel loading">Загружаю тиражи…</section>` : state.drawsError ? `<section class="panel error-box">Не удалось загрузить тиражи: ${escapeHtml(state.drawsError)}</section>` : `<section class="draw-list">${state.draws.map(draw => drawCard(draw)).join('')}</section>`}`
}

function factView() {
  const target = currentTargetDraw()
  const targetFact = state.draws.find(d => Number(d.draw_number) === Number(target))
  const last = latestDraw()
  if (targetFact) return `${pageHeader('Факт', `Тираж №${target} уже вышел`)}${factCard(targetFact, true)}`
  return `${pageHeader('Факт', target ? `Ждём тираж №${target}` : 'Ожидание факта')}<section class="waiting-fact"><span>◷</span><h2>${target ? `Тираж №${target} ещё не записан как завершённый` : 'Номер текущего тиража определяется'}</h2><p>Скриншоты уже привязаны к этому тиражу. Как только синхронизация получит 20 официальных чисел и столб, факт появится здесь.</p></section>${last ? `<h3 class="section-label">Последний полученный факт</h3>${factCard(last, false)}` : ''}`
}

function compareView() {
  const target = currentTargetDraw()
  const fact = state.draws.find(d => Number(d.draw_number) === Number(target))
  const a = getAnalytics()
  if (!fact) return `${pageHeader('Сравнение', target ? `Предложка против факта тиража №${target}` : 'Предложка против факта')}<section class="waiting-fact"><span>◑</span><h2>Факт ещё не пришёл</h2><p>${target ? `Ждём завершения тиража №${target}.` : 'Ждём определения текущего тиража.'} Анализ скриншотов уже можно смотреть.</p><button class="secondary" data-go="analysis">Открыть анализ</button></section>`
  const proposed = a.top.slice(0,10).map(x => x.number)
  const hits = proposed.filter(n => fact.result_numbers?.includes(n))
  return `${pageHeader('Сравнение', `Тираж №${fact.draw_number}`)}<section class="compare-grid"><div class="panel"><h3>Топ предложки по частоте</h3><div class="draw-balls">${balls(proposed)}</div></div><div class="panel"><h3>Факт</h3><div class="draw-balls">${balls(fact.result_numbers)}</div></div></section><section class="panel compare-result"><h3>Совпадения среди топ-10 предложки</h3><strong>${hits.length}/10</strong><div class="draw-balls hit-balls">${balls(hits)}</div></section>`
}

function archiveView() {
  return `${pageHeader('Архив', 'Рабочие данные Virtus Dei')}<section class="panel placeholder"><span>▤</span><h2>Архив</h2><p>История фактических тиражей уже доступна в разделе «Тиражи». Архив скриншотов будет подключён отдельным шагом.</p><button class="secondary" data-go="draws">Открыть тиражи</button></section>`
}

function drawCard(draw) {
  const column = drawColumn(draw)
  return `<article class="draw-card"><div class="draw-card-head"><div><small>${formatDate(draw.draw_time || draw.created_at)}</small><h3>Тираж №${draw.draw_number}</h3></div><span class="column-badge">${column ? `Столб ${column}` : 'Столб —'}</span></div><div class="draw-balls compact">${balls(draw.result_numbers)}</div></article>`
}

function factCard(draw, target) {
  const column = drawColumn(draw)
  return `<section class="fact-card ${target ? 'target-fact' : ''}"><div><small>${target ? 'ЦЕЛЕВОЙ ФАКТ' : 'ПОСЛЕДНИЙ ФАКТ'}</small><h2>Тираж №${draw.draw_number}</h2><p>${formatDate(draw.draw_time || draw.created_at)}</p></div><div><span class="column-badge big">${column ? `Столб ${column}` : 'Столб не получен'}</span><div class="draw-balls">${balls(draw.result_numbers)}</div></div></section>`
}

function balls(numbers = []) {
  return (numbers || []).map(n => `<span>${n}</span>`).join('') || '<em>—</em>'
}

function formatDate(value) {
  if (!value) return 'Время не указано'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' })
}

function miniShots() {
  if (!state.screenshots.length) return `<div class="empty-mini"><span>▣</span><p>Скриншотов пока нет</p><button class="secondary" data-go="upload">Загрузить</button></div>`
  return `<div class="mini-shots">${state.screenshots.slice(-4).reverse().map((s,i) => `<button data-go="upload" class="mini-shot"><img src="${s.localUrl}" alt=""><div><b>Скрин ${state.screenshots.length-i}</b><small>${s.upload?.target_draw_number ? `Тираж №${s.upload.target_draw_number}` : statusText(s)}</small></div></button>`).join('')}</div>`
}

function analyticsSummary(a) {
  if (!a.total) return `<div class="empty-summary">После загрузки здесь появятся главные сигналы.</div>`
  const persistent = a.persistent.slice(0,6).map(x => `<span>${x.number}</span>`).join('') || '<em>—</em>'
  const absent = a.absent.slice(0,10).map(x => `<span>${x}</span>`).join('') || '<em>—</em>'
  return `<div class="summary-block green"><small>Настойчиво предлагает</small><div class="chips">${persistent}</div></div><div class="summary-block red"><small>Обходит</small><div class="chips">${absent}</div></div>`
}

function getAnalytics() {
  const usable = state.screenshots.filter(s => Array.isArray(s.recognition?.numbers) && s.recognition.numbers.length)
  const counts = new Map(Array.from({length:80},(_,i)=>[i+1,0]))
  for (const shot of usable) {
    const unique = new Set(shot.recognition.numbers.filter(n => Number.isInteger(n) && n >= 1 && n <= 80))
    unique.forEach(n => counts.set(n, (counts.get(n) || 0) + 1))
  }
  const all = [...counts].map(([number,count]) => ({number,count,share:usable.length ? count/usable.length : 0}))
  const seen = all.filter(x => x.count > 0)
  const top = [...seen].sort((a,b)=>b.count-a.count || a.number-b.number)
  const rare = [...seen].sort((a,b)=>a.count-b.count || a.number-b.number)
  const threshold = Math.max(2, Math.ceil(usable.length * 0.6))
  let persistent = top.filter(x => x.count >= threshold)
  if (!persistent.length && top.length) persistent = top.slice(0, Math.min(8, top.length))
  const absent = all.filter(x => x.count === 0).map(x => x.number)
  return { total:usable.length, unique:seen.length, all, top, rare, persistent, absent }
}

function numberBars(items, total, tone) {
  if (!items.length) return `<div class="no-data">Недостаточно данных</div>`
  return `<div class="bar-list">${items.map(x => { const pct = total ? Math.round(x.count/total*100) : 0; return `<div class="bar-row"><span class="ball">${x.number}</span><div class="bar-track"><i class="${tone}" style="width:${Math.max(4,pct)}%"></i></div><b>${pct}%</b><small>${x.count}/${total}</small></div>` }).join('')}</div>`
}

function avoidedMarkup(a) {
  if (!a.absent.length) return `<div class="no-data">Все числа 1–80 уже встречались.</div>`
  return `<div class="avoid-note"><b>${a.absent.length} чисел пока не выбраны ни на одном скриншоте</b><small>Это текущая зона обхода алгоритма.</small></div><div class="chips avoid-chips">${a.absent.map(n => `<span>${n}</span>`).join('')}</div>`
}

function rareMarkup(a) {
  const rare = a.rare.slice(0,16)
  if (!rare.length) return `<div class="no-data">Недостаточно данных</div>`
  return `<div class="rare-grid">${rare.map(x => `<div><span class="ball">${x.number}</span><b>${Math.round(x.share*100)}%</b><small>${x.count} раз</small></div>`).join('')}</div>`
}

function cellClass(count,total) {
  if (!count) return 'zero'
  const share = total ? count/total : 0
  if (share >= .6) return 'hot'
  if (share >= .3) return 'warm'
  return 'cool'
}

function emptyAnalysis() {
  return `<section class="panel empty-analysis"><span>◎</span><h2>Для анализа нужны скриншоты</h2><p>После распознавания скринов здесь появятся настойчивые, редкие и обходящие числа.</p><button class="primary" data-go="upload">Загрузить скриншоты</button></section>`
}

function shotsMarkup() {
  if (!state.screenshots.length) return `<div class="empty-state"><span>▣</span><p>Пока нет загруженных скриншотов</p></div>`
  return state.screenshots.map((s,i)=>`<button class="shot ${state.selectedId===s.id?'selected':''}" data-id="${s.id}"><img src="${s.localUrl}" alt=""><div><b>Скриншот №${i+1}</b><small>${s.upload?.target_draw_number ? `Тираж №${s.upload.target_draw_number}` : new Date(s.createdAt).toLocaleTimeString('ru-RU')}</small><em>${statusText(s)}</em></div></button>`).join('')
}

function detailMarkup() {
  const s = state.screenshots.find(x => x.id === state.selectedId) || state.screenshots.at(-1)
  if (!s) return `<div class="detail-empty"><span>▣</span><p>Выберите или загрузите скриншот</p></div>`
  const nums = s.recognition.numbers?.length ? `<div class="recognizedNums">${s.recognition.numbers.map(n=>`<span>${n}</span>`).join('')}</div>` : ''
  return `<div class="target-mini">${s.upload?.target_draw_number ? `Для тиража №${s.upload.target_draw_number}` : 'Целевой тираж определяется'}</div><img class="preview" src="${s.localUrl}" alt=""><div class="status ${s.recognition.status}">${statusText(s)}</div>${nums}<p class="recognition-message">${escapeHtml(s.recognition.message || '')}</p>`
}

function statusText(s) {
  if (s.recognition.status === 'verified') return `✓ 10/10 · ${s.upload.mode === 'cloud' && s.recognition.saved !== false ? 'сохранён' : 'распознан'}`
  if (s.recognition.status === 'review') return `⚠ проверить · найдено ${s.recognition.numbers.length}`
  if (s.recognition.status === 'error') return '✕ ошибка'
  return '… обработка'
}

function escapeHtml(value) {
  const div = document.createElement('div')
  div.textContent = value
  return div.innerHTML
}

function bindPageEvents() {
  document.querySelectorAll('[data-go]').forEach(btn => btn.onclick = () => { state.page = btn.dataset.go; render() })
  document.querySelectorAll('.shot').forEach(btn => btn.onclick = () => { state.selectedId = btn.dataset.id; render() })
  const input = document.querySelector('#fileInput')
  if (input) input.addEventListener('change', handleFiles)
}

async function handleFiles(event) {
  const files = [...event.target.files]
  if (!files.length) return
  const input = event.target
  input.disabled = true
  const target = currentTargetDraw()
  const processing = document.querySelector('#processing')
  if (processing) processing.textContent = `Тираж №${target || '…'} · обработка ${files.length} файл(ов)…`

  for (const file of files) {
    const item = { id:crypto.randomUUID(), file, localUrl:URL.createObjectURL(file), upload:{mode:'pending',target_draw_number:target}, recognition:createPendingRecognition(file), createdAt:new Date().toISOString() }
    state.screenshots.push(item)
    state.selectedId = item.id
    render()
    try { item.upload = await uploadScreenshot(file, target || 'pending') }
    catch (err) { item.upload = { mode:'local', target_draw_number:target, error:err.message || String(err) } }
    try {
      item.recognition = await recognizeScreenshot(file, item.upload.screenshot_id)
      if (item.upload.error) item.recognition.message += ` Облако недоступно: ${item.upload.error}`
    } catch (err) {
      item.recognition = { status:'error', confidence:null, numbers:[], message:`Ошибка обработки: ${err.message || err}` }
    }
    render()
  }

  const done = document.querySelector('#processing')
  if (done) done.textContent = `Готово. Скрины привязаны к тиражу №${currentTargetDraw() || target || '—'}.`
  input.value = ''
  input.disabled = false
}

async function loadDraws() {
  if (!supabase) {
    state.drawsLoading = false
    state.drawsError = 'Supabase не подключён'
    render()
    return
  }
  const { data, error } = await supabase.from('draws').select('draw_number,draw_time,result_numbers,source,raw,created_at').order('draw_number',{ascending:false}).limit(30)
  state.drawsLoading = false
  if (error) state.drawsError = error.message
  else state.draws = data || []
  render()
}

render()
loadDraws()
