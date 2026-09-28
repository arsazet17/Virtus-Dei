import './style.css'
import { uploadScreenshot } from './services/storage.js'
import { createPendingRecognition, recognizeScreenshot } from './services/recognition.js'
import { loadAnalysisCycle, correctScreenshotNumbers } from './services/analysis-cycle.js'
import { supabase } from './supabase.js'

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
  analysisTab: 'pre',
  draws: [],
  shots: [],
  learning: [],
  loading: true,
  refreshing: false,
  uploading: 0,
  error: null,
  selectedShotId: null
}

const app = document.querySelector('#app')

const pad = n => String(n).padStart(2, '0')
const columnOf = n => Number(n) % 10 === 0 ? 10 : Number(n) % 10

function esc(value) {
  const div = document.createElement('div')
  div.textContent = value ?? ''
  return div.innerHTML
}

function cleanNumbers(input) {
  if (!Array.isArray(input)) return []
  return [...new Set(input.map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= 80))]
}

function officialTime(draw) {
  return draw?.raw?.official_draw_time || draw?.draw_time || draw?.created_at || ''
}

function officialColumn(draw) {
  const n = Number(draw?.raw?.official_column ?? draw?.raw?.column ?? draw?.column)
  return Number.isFinite(n) && n >= 1 && n <= 10 ? n : null
}

function computedColumn(numbers = []) {
  const count = Array(11).fill(0)
  const reach = Array(11).fill(999)
  numbers.forEach(n => count[columnOf(n)]++)
  const max = Math.max(...count.slice(1))
  for (let c = 1; c <= 10; c++) {
    if (count[c] !== max) continue
    let seen = 0
    for (let i = 0; i < numbers.length; i++) {
      if (columnOf(numbers[i]) === c) seen++
      if (seen === max) { reach[c] = i; break }
    }
  }
  let winner = 1
  for (let c = 2; c <= 10; c++) {
    if (count[c] > count[winner] || (count[c] === count[winner] && reach[c] < reach[winner])) winner = c
  }
  return winner
}

function drawColumn(draw) {
  return officialColumn(draw) || computedColumn(cleanNumbers(draw?.result_numbers))
}

function formatMoscow(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).format(date).replace(',', '')
}

function moscowTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit', hour12: false
  }).format(date)
}

function stepSchedule(time, steps = 1) {
  let current = time
  for (let s = 0; s < Math.max(1, steps); s++) {
    const index = SCHEDULE.indexOf(current)
    if (index >= 0) current = SCHEDULE[(index + 1) % SCHEDULE.length]
    else {
      const m = String(current || '').match(/(\d{2}):(\d{2})/)
      if (!m) return '—'
      const mins = Number(m[1]) * 60 + Number(m[2])
      const next = SCHEDULE.find(t => {
        const [h, min] = t.split(':').map(Number)
        return h * 60 + min > mins
      })
      current = next || SCHEDULE[0]
    }
  }
  return current
}

function latestDraw() { return state.draws[0] || null }

function shotTarget(shot) {
  return Number(shot?.target_draw_number ?? shot?.upload?.target_draw_number)
}

function shotNumbers(shot) {
  return cleanNumbers(shot?.ocr_numbers ?? shot?.recognition?.numbers)
}

function isVerifiedShot(shot) {
  const status = shot?.ocr_status ?? shot?.recognition?.status
  return status === 'verified' && shotNumbers(shot).length === 10
}

function targetDrawNumber() {
  const latest = latestDraw()
  const latestNo = Number(latest?.draw_number || 0)
  const seen = Number(latest?.raw?.current_draw_seen)
  let target = latestNo ? latestNo + 1 : null
  if (Number.isFinite(seen) && seen > latestNo) target = Math.max(Number(target || 0), seen)
  const future = state.shots.map(shotTarget).filter(n => Number.isFinite(n) && n > latestNo)
  if (future.length) target = Math.max(Number(target || 0), ...future)
  return target || null
}

function targetDrawTime() {
  const latest = latestDraw()
  const target = targetDrawNumber()
  if (!latest || !target) return '—'
  const latestNo = Number(latest.draw_number)
  const steps = Math.max(1, target - latestNo)
  return stepSchedule(moscowTime(officialTime(latest)), steps)
}

function shotsForTarget(target, verifiedOnly = true) {
  const rows = state.shots.filter(s => shotTarget(s) === Number(target))
  return verifiedOnly ? rows.filter(isVerifiedShot) : rows
}

function analyseShots(target) {
  const shots = shotsForTarget(target, true)
  const freq = new Map(Array.from({ length: 80 }, (_, i) => [i + 1, 0]))
  const columns = Array(11).fill(0)
  for (const shot of shots) {
    for (const n of new Set(shotNumbers(shot))) {
      freq.set(n, (freq.get(n) || 0) + 1)
      columns[columnOf(n)]++
    }
  }
  const all = [...freq].map(([number, count]) => ({
    number, count, share: shots.length ? count / shots.length : 0
  }))
  const shown = all.filter(x => x.count > 0).sort((a, b) => b.count - a.count || a.number - b.number)
  const threshold = shots.length >= 2 ? Math.max(2, Math.ceil(shots.length * 0.60)) : Infinity
  const persistent = shown.filter(x => x.count >= threshold)
  const frequent = shown.filter(x => !persistent.some(p => p.number === x.number)).slice(0, 16)
  const absent = all.filter(x => x.count === 0).map(x => x.number)
  const columnRows = Array.from({ length: 10 }, (_, i) => ({ column: i + 1, count: columns[i + 1] }))
    .sort((a, b) => b.count - a.count || a.column - b.column)
  return {
    target: Number(target), shots, total: shots.length, all, shown, persistent, frequent, absent,
    unique: shown.length, threshold, columns: columnRows
  }
}

function learningRow(target) {
  return state.learning.find(row => Number(row.target_draw_number) === Number(target)) || null
}

function checkDraw(draw) {
  if (!draw) return null
  const target = Number(draw.draw_number)
  const fact = cleanNumbers(draw.result_numbers)
  const analysis = analyseShots(target)
  let union = analysis.shown.map(x => x.number)
  let persistent = analysis.persistent.map(x => x.number)
  let absent = analysis.absent
  let shotCount = analysis.total

  if (!shotCount) {
    const saved = learningRow(target)
    union = cleanNumbers(saved?.features?.union_numbers)
    persistent = cleanNumbers(saved?.features?.persistent_numbers)
    absent = cleanNumbers(saved?.absent_numbers)
    shotCount = Number(saved?.screenshot_count || 0)
  }
  if (!shotCount) return null

  const unionSet = new Set(union)
  const persistentSet = new Set(persistent)
  const factSet = new Set(fact)
  return {
    target, fact, shotCount, union, persistent, absent,
    hits: fact.filter(n => unionSet.has(n)),
    persistentHits: fact.filter(n => persistentSet.has(n)),
    avoidedHits: fact.filter(n => !unionSet.has(n)),
    proposedMisses: union.filter(n => !factSet.has(n)),
    unionSet, persistentSet
  }
}

function latestCheckedDraw() {
  return state.draws.find(draw => checkDraw(draw)) || null
}

function learningSummary() {
  const rows = state.learning.filter(row => Number(row.screenshot_count || 0) > 0)
  let unionHits = 0, expectedUnion = 0, persistentHits = 0, expectedPersistent = 0, absentHits = 0, expectedAbsent = 0
  let screenshotHits = 0, screenshotSamples = 0
  for (const row of rows) {
    const f = row.features || {}
    unionHits += Number(f.union_hit_count ?? f.coverage_count ?? 0)
    expectedUnion += Number(f.expected_union_hits || 0)
    persistentHits += Number(f.persistent_hit_count || 0)
    expectedPersistent += Number(f.expected_persistent_hits || 0)
    absentHits += Number(f.absent_hit_count ?? row?.conclusions?.absent_hit_numbers?.length ?? f.draw_numbers_never_seen_in_screenshots?.length ?? 0)
    expectedAbsent += Number(f.expected_absent_hits || 0)
    const per = Array.isArray(f.per_screenshot_hits) ? f.per_screenshot_hits : []
    screenshotHits += per.reduce((sum, x) => sum + Number(x.hits || 0), 0)
    screenshotSamples += per.length
  }
  return {
    cycles: rows.length,
    unionHits, expectedUnion,
    persistentHits, expectedPersistent,
    absentHits, expectedAbsent,
    avgShotHits: screenshotSamples ? screenshotHits / screenshotSamples : null,
    screenshotSamples
  }
}

function drawStats(numbers = []) {
  const nums = cleanNumbers(numbers)
  const sum = nums.reduce((a, b) => a + b, 0)
  const even = nums.filter(n => n % 2 === 0).length
  const odd = nums.length - even
  return { sum, even, odd, parity: even === odd ? 'поровну' : even > odd ? 'чёт' : 'нечёт' }
}

function numberChips(numbers, cls = '') {
  if (!numbers?.length) return '<span class="empty-text">—</span>'
  return `<div class="chips">${numbers.map(n => `<span class="${cls}">${pad(n)}</span>`).join('')}</div>`
}

function header() {
  return `<header class="app-header">
    <div class="brand-block">
      <div class="brand-mark">V</div>
      <div><div class="brand-name">VIRTUS DEI</div><div class="brand-sub">KENO · АНАЛИЗ СКРИНШОТОВ</div></div>
    </div>
    <button class="icon-btn" data-refresh aria-label="Обновить">↻</button>
  </header>
  <nav class="top-nav">
    ${navButton('home','Главная')}
    ${navButton('screens','Скриншоты')}
    ${navButton('analysis','Анализ')}
    ${navButton('archive','Архив')}
  </nav>`
}

function navButton(page, label) {
  return `<button data-page="${page}" class="${state.page === page ? 'on' : ''}">${label}</button>`
}

function footer() {
  return `<footer class="bottom-nav">
    ${footButton('home','⌂','Главная')}
    ${footButton('screens','▧','Скрины')}
    ${footButton('analysis','⌁','Анализ')}
    ${footButton('archive','▦','Архив')}
  </footer>`
}

function footButton(page, icon, label) {
  return `<button data-page="${page}" class="${state.page === page ? 'on' : ''}"><b>${icon}</b><span>${label}</span></button>`
}

function targetCard() {
  const target = targetDrawNumber()
  const allShots = shotsForTarget(target, false)
  const verified = shotsForTarget(target, true)
  const a = analyseShots(target)
  return `<section class="target-card">
    <div>
      <div class="eyebrow">ТЕКУЩИЙ ТИРАЖ</div>
      <div class="target-time">${targetDrawTime()}</div>
      <div class="target-number">№${target || '—'}</div>
    </div>
    <div class="target-status">
      <span>${verified.length} проверено</span>
      <span>${allShots.length} загружено</span>
      <span>${a.persistent.length ? `🎯 ${a.persistent.length} настойчивых` : 'сигнал формируется'}</span>
    </div>
  </section>`
}

function controlPanel() {
  return `<section class="panel control-panel">
    <div class="panel-title">ПАНЕЛЬ УПРАВЛЕНИЯ</div>
    <div class="control-grid">
      <button data-page="screens"><b>▧</b><span>Загрузить<br>скриншоты</span></button>
      <button data-pre-analysis><b>◎</b><span>Анализ<br>до тиража</span></button>
      <button data-post-check><b>✓</b><span>Проверка<br>после тиража</span></button>
      <button data-page="archive"><b>▦</b><span>Архив<br>циклов</span></button>
    </div>
  </section>`
}

function preSummary(target = targetDrawNumber()) {
  const a = analyseShots(target)
  if (!a.total) {
    return `<section class="panel"><div class="panel-head"><div><div class="eyebrow">ДО ТИРАЖА</div><h2>Анализ предложки</h2></div><span class="status-pill muted">нет скринов</span></div>
      <p class="muted-text">Загрузите скриншоты случайных чисел Столото. В анализ попадут только скрины, где распознаны все 10 чисел.</p>
      <button class="primary-btn" data-page="screens">＋ Загрузить скриншоты</button></section>`
  }
  const strongest = a.persistent.map(x => x.number)
  const frequent = a.frequent.slice(0, 10).map(x => x.number)
  return `<section class="panel">
    <div class="panel-head"><div><div class="eyebrow">ДО ТИРАЖА · №${target}</div><h2>Что предлагает алгоритм</h2></div><span class="status-pill good">${a.total} скр.</span></div>
    <div class="metric-row compact">
      <div><b>${a.unique}</b><span>уникальных</span></div>
      <div><b>${strongest.length}</b><span>настойчивых</span></div>
      <div><b>${a.absent.length}</b><span>не показал</span></div>
    </div>
    <div class="analysis-line"><b>🎯 Настойчиво:</b>${numberChips(strongest,'strong')}</div>
    <div class="analysis-line"><b>Чаще остальных:</b>${numberChips(frequent,'warm')}</div>
    <div class="analysis-line"><b>⊘ Совсем не показывает:</b>${numberChips(a.absent.slice(0, 28),'absent')}</div>
    <button class="secondary-btn" data-pre-analysis>Открыть полный анализ →</button>
  </section>`
}

function latestFactCard() {
  const draw = latestDraw()
  if (!draw) return `<section class="panel"><div class="muted-text">Последний тираж загружается…</div></section>`
  const numbers = cleanNumbers(draw.result_numbers)
  const stats = drawStats(numbers)
  const check = checkDraw(draw)
  const column = drawColumn(draw)
  return `<section class="panel fact-card">
    <div class="panel-head">
      <div><div class="eyebrow">ПОСЛЕДНИЙ ТИРАЖ</div><h2>№${draw.draw_number}</h2><div class="fact-time">${formatMoscow(officialTime(draw))}</div></div>
      <div class="column-badge">🔴 <b>ст${column || '—'}</b></div>
    </div>
    <div class="fact-meta"><span>Σ ${stats.sum}</span><span>${stats.even}/${stats.odd}</span><span>${stats.parity}</span>${check ? `<span class="verified-tag">проверен по ${check.shotCount} скр.</span>` : ''}</div>
    <div class="number-grid">${numbers.map(n => factBall(n, check)).join('')}</div>
    ${check ? `<div class="legend"><span class="leg strong">● настойчивый HIT</span><span class="leg offered">● предлагался</span><span class="leg avoided">● алгоритм обходил</span></div>` : ''}
  </section>`
}

function factBall(n, check) {
  let cls = ''
  let mark = ''
  if (check) {
    if (check.persistentSet.has(n)) { cls = 'strong-hit'; mark = '✓' }
    else if (check.unionSet.has(n)) { cls = 'offered-hit'; mark = '✓' }
    else { cls = 'avoided-hit'; mark = '!' }
  }
  return `<div class="fact-ball ${cls}"><span>${pad(n)}</span>${mark ? `<i>${mark}</i>` : ''}</div>`
}

function postSummary(draw = latestCheckedDraw()) {
  const check = checkDraw(draw)
  if (!draw || !check) {
    return `<section class="panel"><div class="panel-head"><div><div class="eyebrow">ПОСЛЕ ТИРАЖА</div><h2>Проверка результата</h2></div><span class="status-pill muted">ожидание</span></div><p class="muted-text">Как только выйдет тираж, приложение сопоставит факт со скриншотами этого тиража и сохранит результат в обучение.</p></section>`
  }
  return `<section class="panel">
    <div class="panel-head"><div><div class="eyebrow">ПОСЛЕ ТИРАЖА · №${draw.draw_number}</div><h2>Проверка скриншотов</h2></div><span class="status-pill good">обучение ✓</span></div>
    <div class="metric-row">
      <div class="good-box"><b>${check.hits.length}/20</b><span>встречались на скринах</span></div>
      <div class="good-box"><b>${check.persistentHits.length}</b><span>настойчивые вышли</span></div>
      <div class="bad-box"><b>${check.avoidedHits.length}</b><span>обходил, но вышли</span></div>
    </div>
    <div class="analysis-line"><b>✓ Предлагал и вышли:</b>${numberChips(check.hits,'hit')}</div>
    <div class="analysis-line"><b>⚠ Обходил, но вышли:</b>${numberChips(check.avoidedHits,'missed')}</div>
    <button class="secondary-btn" data-post-check>Разобрать ошибки →</button>
  </section>`
}

function homeView() {
  return `${header()}${targetCard()}${controlPanel()}${preSummary()}${latestFactCard()}${postSummary()}${learningMini()}`
}

function learningMini() {
  const s = learningSummary()
  return `<section class="panel learning-mini">
    <div class="panel-head"><div><div class="eyebrow">ОБУЧЕНИЕ</div><h2>Накопленная проверка</h2></div><span class="status-pill">${s.cycles} циклов</span></div>
    <p class="muted-text">${learningConclusion(s)}</p>
    <button class="secondary-btn" data-learning>Открыть обучение →</button>
  </section>`
}

function shotStatus(shot) {
  const status = shot?.ocr_status ?? shot?.recognition?.status
  const nums = shotNumbers(shot)
  if (status === 'verified' && nums.length === 10) return '✓ 10/10'
  if (status === 'review') return `⚠ ${nums.length}/10`
  if (status === 'pending') return '… обработка'
  if (status === 'error') return '✕ ошибка'
  return `${nums.length}/10`
}

function shotImage(shot) {
  return shot.image_url || shot.localUrl || null
}

function shotCard(shot) {
  const nums = shotNumbers(shot)
  const image = shotImage(shot)
  const id = shot.id || shot.serverId
  return `<article class="shot-card ${isVerifiedShot(shot) ? 'verified' : 'review'}">
    ${image ? `<a href="${esc(image)}" target="_blank" rel="noopener"><img src="${esc(image)}" alt="Скриншот"></a>` : '<div class="shot-placeholder">▧</div>'}
    <div class="shot-body">
      <div class="shot-top"><b>№${shotTarget(shot) || '—'}</b><span>${shotStatus(shot)}</span></div>
      <div class="shot-numbers">${nums.length ? nums.map(n => `<i>${pad(n)}</i>`).join('') : '<small>числа ещё не распознаны</small>'}</div>
      <div class="shot-actions">${id && !String(id).startsWith('local:') ? `<button data-correct="${esc(String(id).replace('cloud:',''))}">✎ Исправить OCR</button>` : ''}</div>
    </div>
  </article>`
}

function screenshotsView() {
  const target = targetDrawNumber()
  const current = shotsForTarget(target, false)
  const groups = groupShotHistory().filter(g => g.target !== Number(target))
  return `${header()}
    <section class="panel upload-panel">
      <div class="panel-head"><div><div class="eyebrow">СКРИНШОТЫ ДЛЯ ТИРАЖА</div><h2>№${target || '—'} · ${targetDrawTime()}</h2></div><span class="status-pill ${state.uploading ? 'warn' : 'good'}">${state.uploading ? `обработка ${state.uploading}` : 'готово'}</span></div>
      <div class="upload-grid">
        <label class="upload-btn primary"><input id="galleryInput" type="file" accept="image/png,image/jpeg,image/webp" multiple hidden><b>▧</b><span>Выбрать скрины<small>несколько сразу</small></span></label>
        <label class="upload-btn"><input id="cameraInput" type="file" accept="image/*" capture="environment" hidden><b>◉</b><span>Сделать фото<small>камера телефона</small></span></label>
      </div>
      <div class="ocr-note">В анализ идут только скрины со статусом <b>✓ 10/10</b>. Если OCR ошибся — нажмите «Исправить OCR» и впишите 10 чисел вручную.</div>
    </section>
    <div class="section-title"><span>Текущий набор</span><b>${current.length} скр.</b></div>
    <div class="shot-list">${current.length ? current.map(shotCard).join('') : '<section class="panel empty-panel">Скриншотов для текущего тиража пока нет.</section>'}</div>
    <div class="section-title"><span>Архив скриншотов</span><b>${groups.reduce((s,g)=>s+g.shots.length,0)}</b></div>
    <div class="history-groups">${groups.length ? groups.map(group => `<details class="history-group"><summary><span>Тираж №${group.target}</span><b>${group.shots.length} скр.</b></summary><div class="shot-list">${group.shots.map(shotCard).join('')}</div></details>`).join('') : '<section class="panel empty-panel">Архив пока пуст.</section>'}</div>`
}

function groupShotHistory() {
  const map = new Map()
  for (const shot of state.shots) {
    const target = shotTarget(shot)
    if (!Number.isFinite(target)) continue
    if (!map.has(target)) map.set(target, [])
    map.get(target).push(shot)
  }
  return [...map.entries()].sort((a,b)=>b[0]-a[0]).map(([target,shots])=>({target,shots}))
}

function analysisTabs() {
  const tabs = [['pre','До тиража'],['post','После тиража'],['learn','Обучение']]
  return `<div class="analysis-tabs">${tabs.map(([id,label])=>`<button data-analysis-tab="${id}" class="${state.analysisTab===id?'on':''}">${label}</button>`).join('')}</div>`
}

function analysisView() {
  let body = preAnalysisView()
  if (state.analysisTab === 'post') body = postAnalysisView()
  if (state.analysisTab === 'learn') body = learningView()
  return `${header()}${analysisTabs()}${body}`
}

function preAnalysisView() {
  const target = targetDrawNumber()
  const a = analyseShots(target)
  if (!a.total) return `<section class="panel"><div class="panel-head"><div><div class="eyebrow">РЕЗУЛЬТАТ АНАЛИЗА ДО ТИРАЖА</div><h2>№${target || '—'}</h2></div></div><p class="muted-text">Нет проверенных скриншотов 10/10.</p><button class="primary-btn" data-page="screens">Загрузить скрины</button></section>`

  const strong = a.persistent.map(x=>x.number)
  const medium = a.shown.filter(x=>x.count >= 2 && !strong.includes(x.number)).map(x=>x.number)
  const weak = a.shown.filter(x=>x.count === 1).map(x=>x.number)
  const topColumns = a.columns.slice(0,4)
  return `<section class="panel">
    <div class="panel-head"><div><div class="eyebrow">РЕЗУЛЬТАТ АНАЛИЗА СКРИНОВ</div><h2>Тираж №${target} · ${targetDrawTime()}</h2></div><span class="status-pill good">${a.total} скр.</span></div>
    <div class="metric-row compact"><div><b>${a.total}</b><span>скринов</span></div><div><b>${a.unique}</b><span>уникальных</span></div><div><b>${strong.length}</b><span>настойчивых</span></div><div><b>${a.absent.length}</b><span>обходит</span></div></div>
  </section>
  <section class="panel"><div class="panel-title">РЕЗУЛЬТАТ АЛГОРИТМА ДО ТИРАЖА</div>
    <div class="analysis-line large"><b>🟢 Настойчивое предложение</b>${numberChips(strong,'strong')}</div>
    <div class="analysis-line large"><b>🟡 Повторяется</b>${numberChips(medium,'warm')}</div>
    <div class="analysis-line large"><b>🔵 Показал один раз</b>${numberChips(weak,'cool')}</div>
    <div class="analysis-line large"><b>🔴 Вообще отсутствуют</b>${numberChips(a.absent,'absent')}</div>
  </section>
  <section class="panel"><div class="panel-title">РАСПРЕДЕЛЕНИЕ ПО СТОЛБАМ</div><div class="column-list">${topColumns.map(x=>`<div><span>ст${x.column}</span><b>${x.count}</b><i style="width:${Math.min(100, x.count / Math.max(1, topColumns[0].count) * 100)}%"></i></div>`).join('')}</div><div class="muted-text">Показаны 4 столба, которые чаще встречались на загруженных скриншотах.</div></section>
  <section class="panel conclusion"><div class="panel-title">ВЫВОД ДО ТИРАЖА</div><p>${preConclusion(a)}</p></section>`
}

function preConclusion(a) {
  if (!a.total) return 'Недостаточно данных.'
  const strong = a.persistent.map(x=>x.number)
  const top = a.shown.slice(0,8).map(x=>x.number)
  return `По ${a.total} проверенным скриншотам чаще всего повторяются: ${strong.length ? strong.join(', ') : top.join(', ')}. Совсем не были предложены ${a.absent.length} чисел. Это описание поведения генератора на скриншотах, а не гарантия следующего результата.`
}

function postAnalysisView() {
  const draw = latestCheckedDraw()
  const check = checkDraw(draw)
  if (!draw || !check) return `<section class="panel"><div class="panel-head"><div><div class="eyebrow">ПРОВЕРКА ПОСЛЕ ТИРАЖА</div><h2>Факт ещё не связан со скринами</h2></div></div><p class="muted-text">Нажмите «Обновить» после выхода тиража. Если его факт уже есть в базе, проверка появится автоматически.</p><button class="primary-btn" data-refresh>↻ Обновить факт</button></section>`

  const saved = learningRow(draw.draw_number)
  const perShot = Array.isArray(saved?.features?.per_screenshot_hits) ? saved.features.per_screenshot_hits : []
  const perText = perShot.length ? perShot.map((x,i)=>`скрин ${i+1}: ${x.hits}/10`).join(' · ') : '—'
  return `<section class="panel">
    <div class="panel-head"><div><div class="eyebrow">ПРОВЕРКА ПОСЛЕ ТИРАЖА</div><h2>№${draw.draw_number} · ${formatMoscow(officialTime(draw))}</h2></div><div class="column-badge">🔴 <b>ст${drawColumn(draw)}</b></div></div>
    <div class="number-grid">${cleanNumbers(draw.result_numbers).map(n=>factBall(n,check)).join('')}</div>
  </section>
  <section class="panel"><div class="panel-title">СРАВНЕНИЕ С ПРЕДЛОЖКОЙ</div>
    <div class="metric-row"><div class="good-box"><b>${check.hits.length}/20</b><span>были предложены</span></div><div class="good-box"><b>${check.persistentHits.length}</b><span>настойчивые вышли</span></div><div class="bad-box"><b>${check.avoidedHits.length}</b><span>обходил, но вышли</span></div></div>
    <div class="analysis-line"><b>✓ Предлагал и вышли:</b>${numberChips(check.hits,'hit')}</div>
    <div class="analysis-line"><b>✓ Настойчивые HIT:</b>${numberChips(check.persistentHits,'strong')}</div>
    <div class="analysis-line"><b>⚠ Обходил, но вышли:</b>${numberChips(check.avoidedHits,'missed')}</div>
  </section>
  <section class="panel"><div class="panel-title">ЧТО СРАБОТАЛО</div><ul class="result-list good-list"><li>На скриншотах встречались ${check.hits.length} из 20 фактических чисел.</li><li>Из настойчивой группы вышло ${check.persistentHits.length}.</li><li>По отдельным скринам: ${esc(perText)}.</li></ul></section>
  <section class="panel"><div class="panel-title">ОШИБКИ / ЧТО УЧИТЬ</div><ul class="result-list bad-list"><li>Алгоритм вообще не показывал, но они вышли: ${check.avoidedHits.join(', ') || 'нет'}.</li><li>Предлагались на скринах, но не вышли: ${check.proposedMisses.slice(0,30).join(', ') || 'нет'}${check.proposedMisses.length>30?'…':''}.</li><li>Результат ${saved ? 'уже записан' : 'будет записан'} в накопленное обучение.</li></ul></section>`
}

function learningView() {
  const s = learningSummary()
  return `<section class="panel"><div class="panel-head"><div><div class="eyebrow">НАКОПЛЕННОЕ ОБУЧЕНИЕ</div><h2>${s.cycles} завершённых циклов</h2></div><span class="status-pill">модель v2</span></div>
    <div class="metric-row compact"><div><b>${s.unionHits}</b><span>HIT из всех предложенных</span></div><div><b>${s.persistentHits}</b><span>HIT настойчивых</span></div><div><b>${s.absentHits}</b><span>вышли из обхода</span></div>${s.avgShotHits==null?'':`<div><b>${s.avgShotHits.toFixed(2)}</b><span>ср. HIT на скрин</span></div>`}</div>
  </section>
  <section class="panel"><div class="panel-title">ВЛИЯЮТ ЛИ СКРИНШОТЫ НА СЛЕДУЮЩИЙ ТИРАЖ?</div><p class="learning-text">${learningConclusion(s)}</p>${learningExpectation(s)}</section>
  <section class="panel"><div class="panel-title">ПОСЛЕДНИЕ ОБУЧЕННЫЕ ЦИКЛЫ</div><div class="learn-rows">${state.learning.slice(0,20).map(row=>learnRow(row)).join('') || '<div class="muted-text">Пока нет завершённых циклов.</div>'}</div></section>`
}

function learningConclusion(s) {
  if (!s.cycles) return 'Обучение ещё не началось: нужен хотя бы один тираж со скриншотами до факта.'
  if (s.cycles < 5) return `Накоплено ${s.cycles} циклов. Этого пока мало, чтобы делать вывод о влиянии случайных чисел Столото на следующий тираж. Приложение продолжает считать отдельно предложенные, настойчивые и полностью обходившиеся числа.`
  const delta = s.expectedUnion ? s.unionHits - s.expectedUnion : 0
  const direction = Math.abs(delta) < 2 ? 'близко к условному случайному ожиданию' : delta > 0 ? 'выше условного случайного ожидания' : 'ниже условного случайного ожидания'
  return `По ${s.cycles} циклам числа, которые встречались хотя бы на одном скриншоте, дали ${s.unionHits} попаданий; это ${direction}. Числа, которых не было ни на одном скриншоте, всё равно выходили ${s.absentHits} раз. Это описательная статистика и сама по себе не доказывает влияние генератора на тираж.`
}

function learningExpectation(s) {
  if (!s.expectedUnion && !s.expectedPersistent && !s.expectedAbsent) return ''
  return `<div class="expectation-grid"><div><span>Все предложенные</span><b>${s.unionHits}</b><small>условное ожидание ${s.expectedUnion.toFixed(1)}</small></div><div><span>Настойчивые</span><b>${s.persistentHits}</b><small>ожидание ${s.expectedPersistent.toFixed(1)}</small></div><div><span>Обходившиеся</span><b>${s.absentHits}</b><small>ожидание ${s.expectedAbsent.toFixed(1)}</small></div></div>`
}

function learnRow(row) {
  const f = row.features || {}
  return `<div class="learn-row"><span>№${row.target_draw_number}</span><span>${row.screenshot_count} скр.</span><span>${Number(f.union_hit_count ?? f.coverage_count ?? 0)}/20 HIT</span><span>обход→факт ${Number(f.absent_hit_count ?? row?.conclusions?.absent_hit_numbers?.length ?? 0)}</span></div>`
}

function archiveView() {
  return `${header()}<section class="panel archive-intro"><div class="panel-head"><div><div class="eyebrow">АРХИВ</div><h2>Тиражи и проверки</h2></div><span class="status-pill">${state.draws.length}</span></div><p class="muted-text">Здесь тиражи идут компактно. Откройте строку, если нужны 20 чисел и проверка скриншотов.</p></section><div class="archive-list">${state.draws.slice(0,80).map(archiveRow).join('')}</div>`
}

function archiveRow(draw) {
  const check = checkDraw(draw)
  return `<details class="archive-row"><summary><span class="arch-no">№${draw.draw_number}</span><span>${formatMoscow(officialTime(draw)).replace(/^\d{2}\.\d{2}\.\d{4}\s*/,'')}</span><span class="arch-col">ст${drawColumn(draw)}</span><span class="arch-hit">${check ? `${check.hits.length}/20` : '—'}</span><i>⌄</i></summary><div class="archive-body"><div class="number-grid compact-grid">${cleanNumbers(draw.result_numbers).map(n=>factBall(n,check)).join('')}</div>${check ? `<div class="archive-check"><div><b>Предлагал и вышли</b>${numberChips(check.hits,'hit')}</div><div><b>Обходил, но вышли</b>${numberChips(check.avoidedHits,'missed')}</div></div>` : '<div class="muted-text">Для этого тиража нет сохранённых скриншотов до факта.</div>'}</div></details>`
}

function render() {
  let body = homeView()
  if (state.page === 'screens') body = screenshotsView()
  if (state.page === 'analysis') body = analysisView()
  if (state.page === 'archive') body = archiveView()
  app.innerHTML = `<div class="app-shell">${state.error ? `<div class="error-banner">${esc(state.error)}</div>` : ''}${body}</div>${footer()}`
  bind()
}

function bind() {
  document.querySelectorAll('[data-page]').forEach(btn => btn.addEventListener('click', () => {
    state.page = btn.dataset.page
    render()
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }))
  document.querySelectorAll('[data-refresh]').forEach(btn => btn.addEventListener('click', refreshAll))
  document.querySelectorAll('[data-pre-analysis]').forEach(btn => btn.addEventListener('click', () => {
    state.page = 'analysis'; state.analysisTab = 'pre'; render(); window.scrollTo({ top: 0, behavior: 'smooth' })
  }))
  document.querySelectorAll('[data-post-check]').forEach(btn => btn.addEventListener('click', async () => {
    await refreshAll(); state.page = 'analysis'; state.analysisTab = 'post'; render(); window.scrollTo({ top: 0, behavior: 'smooth' })
  }))
  document.querySelectorAll('[data-learning]').forEach(btn => btn.addEventListener('click', () => {
    state.page = 'analysis'; state.analysisTab = 'learn'; render(); window.scrollTo({ top: 0, behavior: 'smooth' })
  }))
  document.querySelectorAll('[data-analysis-tab]').forEach(btn => btn.addEventListener('click', () => {
    state.analysisTab = btn.dataset.analysisTab; render()
  }))
  document.querySelectorAll('[data-correct]').forEach(btn => btn.addEventListener('click', () => correctOcr(btn.dataset.correct)))
  const gallery = document.querySelector('#galleryInput')
  const camera = document.querySelector('#cameraInput')
  if (gallery) gallery.addEventListener('change', handleFiles)
  if (camera) camera.addEventListener('change', handleFiles)
}

async function correctOcr(id) {
  const shot = state.shots.find(s => String(s.id).replace('cloud:','') === String(id) || String(s.id) === `cloud:${id}`)
  const current = shotNumbers(shot).join(' ')
  const raw = window.prompt('Введите ровно 10 чисел от 1 до 80 через пробел или запятую:', current)
  if (raw == null) return
  const numbers = cleanNumbers(raw.match(/\d+/g) || [])
  if (numbers.length !== 10) {
    window.alert('Нужно ровно 10 разных чисел от 1 до 80.')
    return
  }
  try {
    state.error = null
    await correctScreenshotNumbers(id, numbers)
    await refreshAll()
  } catch (error) {
    state.error = `Не удалось исправить OCR: ${error.message || error}`
    render()
  }
}

async function handleFiles(event) {
  const files = [...event.target.files]
  event.target.value = ''
  if (!files.length) return
  const target = targetDrawNumber()
  state.page = 'screens'
  state.uploading += files.length
  render()

  for (const file of files) {
    const local = {
      id: `local:${crypto.randomUUID()}`,
      target_draw_number: target,
      localUrl: URL.createObjectURL(file),
      ocr_status: 'pending',
      ocr_numbers: [],
      local: true,
      created_at: new Date().toISOString()
    }
    state.shots.unshift(local)
    render()

    try {
      const upload = await uploadScreenshot(file, target || 'pending')
      local.serverId = upload?.screenshot_id
      local.target_draw_number = Number(upload?.target_draw_number || target)
      const recognition = await recognizeScreenshot(file, upload?.screenshot_id)
      local.ocr_status = recognition.status
      local.ocr_numbers = recognition.numbers
      local.ocr_confidence = recognition.confidence
      local.message = recognition.message
    } catch (error) {
      local.ocr_status = 'error'
      local.message = error.message || String(error)
      state.error = `Ошибка одного из скриншотов: ${local.message}`
    } finally {
      state.uploading = Math.max(0, state.uploading - 1)
      render()
    }
  }
  await refreshAll()
}

async function loadDraws() {
  if (!supabase) throw new Error('Supabase не подключён')
  const { data, error } = await supabase
    .from('draws')
    .select('draw_number,draw_time,result_numbers,source,raw,created_at')
    .order('draw_number', { ascending: false })
    .limit(120)
  if (error) throw error
  state.draws = data || []
}

async function loadCycle() {
  const data = await loadAnalysisCycle(220)
  const serverShots = (data.screenshots || []).map(row => ({
    ...row,
    id: `cloud:${row.id}`,
    serverId: row.id,
    local: false
  }))
  const serverIds = new Set(serverShots.map(s => s.serverId))
  const pendingLocal = state.shots.filter(s => s.local && (!s.serverId || !serverIds.has(s.serverId)))
  state.shots = [...pendingLocal, ...serverShots]
  state.learning = data.learning || []
}

async function refreshAll() {
  if (state.refreshing) return
  state.refreshing = true
  state.error = null
  render()
  const results = await Promise.allSettled([loadDraws(), loadCycle()])
  const errors = results.filter(r => r.status === 'rejected').map(r => r.reason?.message || String(r.reason))
  if (errors.length) state.error = errors.join(' · ')
  state.loading = false
  state.refreshing = false
  render()
}

window.addEventListener('error', event => {
  if (!app.children.length) app.innerHTML = `<div class="app-shell"><section class="panel"><b>Ошибка запуска</b><p>${esc(event.message || 'Неизвестная ошибка')}</p></section></div>`
})

render()
refreshAll()
