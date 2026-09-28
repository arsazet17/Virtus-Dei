import './style.css'
import { uploadScreenshot } from './services/storage.js'
import { createPendingRecognition, recognizeScreenshot } from './services/recognition.js'
import { supabaseConfigured } from './supabase.js'

const state = {
  screenshots: [],
  selectedId: null,
  page: 'dashboard'
}

const navItems = [
  ['dashboard', '⌂', 'Главная'],
  ['upload', '▣', 'Загрузить скрин'],
  ['analysis', '◎', 'Анализ скриншотов'],
  ['draws', '◫', 'Тиражи'],
  ['proposal', '⌘', 'Предложка'],
  ['fact', '✦', 'Факт'],
  ['compare', '◑', 'Сравнение'],
  ['stats', '▥', 'Анализ'],
  ['archive', '▤', 'Архив']
]

const app = document.querySelector('#app')
app.innerHTML = `
<div class="shell">
  <aside class="sidebar">
    <div class="brand">
      <img class="brand-icon" src="${import.meta.env.BASE_URL}icons/virtus-dei-512.png" alt="Virtus Dei" width="120" height="120">
      <b>Virtus Dei</b><small>est — id est nobis</small>
    </div>
    <nav id="nav"></nav>
    <div class="system-card">
      <span class="online-dot"></span><div><small>Статус системы</small><b>${supabaseConfigured ? 'Онлайн' : 'Локальный режим'}</b></div>
    </div>
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
nav.addEventListener('click', e => {
  const button = e.target.closest('[data-page]')
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
  else page.innerHTML = placeholderView(state.page)
  bindPageEvents()
}

function pageHeader(title, subtitle) {
  const now = new Date().toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' })
  return `<header class="page-header"><div><h1>${title}</h1><p>${subtitle}</p></div><div class="header-meta"><span>${now}</span><span class="cloud ${supabaseConfigured ? 'ok' : 'warn'}">${supabaseConfigured ? '● Облако' : '○ Локально'}</span></div></header>`
}

function dashboardView() {
  const analytics = getAnalytics()
  return `${pageHeader('Главная', 'Текущий цикл, загруженные данные и быстрые действия')}
  <section class="hero-dashboard">
    <div class="hero-copy"><span class="eyebrow">VIRTUS DEI</span><h2>Система анализа предложки</h2><p>Загружайте скриншоты до тиража. Система собирает частоты и показывает, какие числа алгоритм предлагает настойчиво, а какие систематически обходит.</p><div class="hero-actions"><button class="primary" data-go="upload">+ Загрузить скрин</button><button class="secondary" data-go="analysis">Открыть анализ</button></div></div>
    <div class="hero-metric"><small>Распознано скриншотов</small><strong>${analytics.total}</strong><span>${analytics.unique} уникальных чисел замечено</span></div>
  </section>
  <section class="quick-grid">
    ${quickCard('▣','Загрузить скрин','Добавить новые данные','upload')}
    ${quickCard('◎','Анализ скриншотов','Настойчивость и обход','analysis')}
    ${quickCard('◫','Тиражи','История и данные','draws')}
    ${quickCard('◑','Сравнение','Предложка против факта','compare')}
  </section>
  <section class="dashboard-grid">
    <div class="panel"><div class="panel-title"><div><h3>Последние скриншоты</h3><p>Текущая сессия</p></div><button class="link-button" data-go="upload">Все скрины →</button></div>${miniShots()}</div>
    <div class="panel"><div class="panel-title"><div><h3>Сводка алгоритма</h3><p>По распознанным скриншотам</p></div></div>${analyticsSummary(analytics)}</div>
  </section>`
}

function quickCard(icon, title, text, page) {
  return `<button class="quick-card" data-go="${page}"><span class="quick-icon">${icon}</span><div><b>${title}</b><small>${text}</small></div><i>→</i></button>`
}

function uploadView() {
  return `${pageHeader('Загрузить скрин', 'Добавьте скриншоты текущего цикла для распознавания чисел')}
  <section class="upload-layout">
    <div class="panel upload-panel">
      <label class="dropzone"><input id="fileInput" type="file" accept="image/png,image/jpeg,image/webp" multiple hidden><span class="upload-symbol">⇧</span><b>Перетащите или выберите скриншоты</b><small>PNG, JPG, JPEG, WEBP · можно выбрать сразу несколько</small><span class="primary fake-button">Выбрать файлы</span></label>
      <div class="upload-status"><span id="processing"></span><b id="uploadCount">${state.screenshots.length} загружено</b></div>
    </div>
    <div class="panel requirements"><h3>Что происходит после загрузки</h3><div class="check-row">✓ <span>Распознаются выбранные 10 чисел</span></div><div class="check-row">✓ <span>Каждый скрин сохраняется в текущую сессию</span></div><div class="check-row">✓ <span>Анализ частот пересчитывается автоматически</span></div><div class="check-row">✓ <span>Появляются «настойчиво предлагает» и «обходит»</span></div><button class="secondary full" data-go="analysis">Перейти в анализ →</button></div>
  </section>
  <section class="workspace">
    <div class="panel grow"><div class="panel-title"><div><h3>Загруженные скриншоты</h3><p>Нажмите на карточку для просмотра</p></div></div><div id="shots" class="shots">${shotsMarkup()}</div></div>
    <div class="panel detail"><div class="panel-title"><div><h3>Просмотр</h3><p>Распознанные числа</p></div></div><div id="detail">${detailMarkup()}</div></div>
  </section>`
}

function analysisView() {
  const a = getAnalytics()
  return `${pageHeader('Анализ скриншотов', 'Что алгоритм предлагает настойчиво, что показывает редко и какие числа обходит')}
  <section class="summary-strip">
    <div><small>Скриншотов в анализе</small><strong>${a.total}</strong></div>
    <div><small>Уникальных чисел</small><strong>${a.unique}</strong></div>
    <div><small>Самое частое</small><strong>${a.top[0]?.number ?? '—'}</strong></div>
    <div><small>Не встречались</small><strong>${a.absent.length}</strong></div>
  </section>
  ${a.total === 0 ? emptyAnalysis() : `
  <section class="analysis-grid">
    <div class="signal-card persistent"><div class="signal-head"><div><span>🎯</span><div><h3>Настойчиво предлагает</h3><p>Числа, которые повторяются в большой доле скриншотов</p></div></div><span class="signal-count">${a.persistent.length}</span></div>${numberBars(a.persistent, a.total, 'green')}</div>
    <div class="signal-card avoided"><div class="signal-head"><div><span>⊘</span><div><h3>Обходит / избегает</h3><p>Числа с нулевой или минимальной частотой появления</p></div></div><span class="signal-count">${a.absent.length}</span></div>${avoidedMarkup(a)}</div>
  </section>
  <section class="analysis-grid secondary-analysis">
    <div class="panel"><div class="panel-title"><div><h3>Часто встречаются</h3><p>Рейтинг всех замеченных чисел</p></div></div>${numberBars(a.top.slice(0,12), a.total, 'blue')}</div>
    <div class="panel"><div class="panel-title"><div><h3>Редко встречаются</h3><p>Были замечены, но появляются слабо</p></div></div>${rareMarkup(a)}</div>
  </section>
  <section class="panel all-frequency"><div class="panel-title"><div><h3>Карта 1–80</h3><p>Количество появлений каждого числа во всех распознанных скриншотах</p></div><div class="legend"><span class="legend-hot">часто</span><span class="legend-cold">обходит</span></div></div><div class="number-map">${a.all.map(x => `<div class="map-cell ${cellClass(x.count,a.total)}"><b>${x.number}</b><small>${x.count}×</small></div>`).join('')}</div></section>
  `}`
}

function emptyAnalysis() {
  return `<section class="panel empty-analysis"><span>◎</span><h2>Для анализа нужны скриншоты</h2><p>После распознавания хотя бы одного скриншота здесь появится карта частот. Чем больше скриншотов, тем лучше видно настойчивость и обход.</p><button class="primary" data-go="upload">Загрузить скриншоты</button></section>`
}

function placeholderView(key) {
  const item = navItems.find(x => x[0] === key)
  return `${pageHeader(item?.[2] || 'Раздел', 'Раздел сохранён в новой структуре приложения')}<section class="panel placeholder"><span>${item?.[1] || '◌'}</span><h2>${item?.[2] || 'Раздел'}</h2><p>Этот раздел остаётся отдельным рабочим модулем. Главная перестройка сейчас сосредоточена на цепочке «Загрузка → Анализ скриншотов».</p><button class="secondary" data-go="analysis">Открыть анализ скриншотов</button></section>`
}

function miniShots() {
  if (!state.screenshots.length) return `<div class="empty-mini"><span>▣</span><p>Скриншотов пока нет</p><button class="secondary" data-go="upload">Загрузить</button></div>`
  return `<div class="mini-shots">${state.screenshots.slice(-4).reverse().map((s,i) => `<button data-go="upload" class="mini-shot"><img src="${s.localUrl}" alt=""><div><b>Скрин ${state.screenshots.length-i}</b><small>${statusText(s)}</small></div></button>`).join('')}</div>`
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
  return `<div class="bar-list">${items.map(x => {
    const pct = total ? Math.round(x.count/total*100) : 0
    return `<div class="bar-row"><span class="ball">${x.number}</span><div class="bar-track"><i class="${tone}" style="width:${Math.max(4,pct)}%"></i></div><b>${pct}%</b><small>${x.count}/${total}</small></div>`
  }).join('')}</div>`
}

function avoidedMarkup(a) {
  if (!a.absent.length) return `<div class="no-data">Все числа 1–80 уже встречались хотя бы один раз.</div>`
  return `<div class="avoid-note"><b>${a.absent.length} чисел пока не выбраны ни на одном скриншоте</b><small>Показываем весь список — это и есть текущая зона обхода алгоритма.</small></div><div class="chips avoid-chips">${a.absent.map(n => `<span>${n}</span>`).join('')}</div>`
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

function shotsMarkup() {
  if (!state.screenshots.length) return `<div class="empty-state"><span>▣</span><p>Пока нет загруженных скриншотов</p></div>`
  return state.screenshots.map((s,i)=>`<button class="shot ${state.selectedId===s.id?'selected':''}" data-id="${s.id}"><img src="${s.localUrl}" alt=""><div><b>Скриншот №${i+1}</b><small>${new Date(s.createdAt).toLocaleTimeString('ru-RU')}</small><em>${statusText(s)}</em></div></button>`).join('')
}

function detailMarkup() {
  const s = state.screenshots.find(x => x.id === state.selectedId) || state.screenshots.at(-1)
  if (!s) return `<div class="detail-empty"><span>▣</span><p>Выберите или загрузите скриншот</p></div>`
  const nums = s.recognition.numbers?.length ? `<div class="recognizedNums">${s.recognition.numbers.map(n=>`<span>${n}</span>`).join('')}</div>` : ''
  return `<img class="preview" src="${s.localUrl}" alt=""><div class="status ${s.recognition.status}">${statusText(s)}</div>${nums}<p class="recognition-message">${escapeHtml(s.recognition.message || '')}</p>`
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

async function handleFiles(e) {
  const files = [...e.target.files]
  if (!files.length) return
  const input = e.target
  input.disabled = true
  const processing = document.querySelector('#processing')
  if (processing) processing.textContent = `Обработка ${files.length} файл(ов)…`

  for (const file of files) {
    const item = {
      id: crypto.randomUUID(),
      file,
      localUrl: URL.createObjectURL(file),
      upload: { mode:'pending' },
      recognition: createPendingRecognition(file),
      createdAt: new Date().toISOString()
    }
    state.screenshots.push(item)
    state.selectedId = item.id
    render()
    const liveProcessing = document.querySelector('#processing')
    if (liveProcessing) liveProcessing.textContent = `Распознаётся: ${file.name}`

    try { item.upload = await uploadScreenshot(file) }
    catch (err) { item.upload = { mode:'local', error:err.message || String(err) } }

    try {
      item.recognition = await recognizeScreenshot(file, item.upload.screenshot_id)
      if (item.upload.error) item.recognition.message += ` Облако недоступно: ${item.upload.error}`
    } catch (err) {
      item.recognition = { status:'error', confidence:null, numbers:[], message:`Ошибка обработки: ${err.message || err}` }
    }
    render()
  }

  const done = document.querySelector('#processing')
  if (done) done.textContent = 'Готово. Анализ пересчитан.'
  input.value = ''
  input.disabled = false
}

render()
