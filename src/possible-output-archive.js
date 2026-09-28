import './possible-output-archive.css'
import { invokeFunction } from './services/functions.js'

let lastSavedSignature = ''
let archiveLoading = false

const pad = n => String(n).padStart(2, '0')

function currentPrediction() {
  const panel = document.querySelector('#kinship-pre-panel')
  if (!panel) return null
  const target = Number(panel.dataset.target)
  if (!Number.isInteger(target) || target <= 0) return null

  const candidates = [...panel.querySelectorAll('.kin-candidate')].map(row => {
    const number = Number(row.querySelector('b')?.textContent?.trim())
    const relation = String(row.querySelector('span')?.textContent || '').trim()
    const indexText = String(row.querySelector('em')?.textContent || '')
    const indexMatch = indexText.match(/-?\d+(?:[.,]\d+)?/)
    const index = indexMatch ? Number(indexMatch[0].replace(',', '.')) : null
    return { number, relation, index }
  }).filter(x => Number.isInteger(x.number) && x.number >= 1 && x.number <= 80)

  const combo = candidates.map(x => x.number)
  if (combo.length !== 10 || new Set(combo).size !== 10) return null
  return { panel, target, combo, candidates }
}

function setSaveState(panel, text, kind = 'ok') {
  let badge = panel.querySelector('.poa-save-state')
  if (!badge) {
    badge = document.createElement('span')
    badge.className = 'poa-save-state'
    const head = panel.querySelector('.panel-head')
    if (head) head.appendChild(badge)
  }
  badge.dataset.kind = kind
  badge.textContent = text
}

async function saveCurrentPrediction() {
  const current = currentPrediction()
  if (!current) return
  const signature = `${current.target}:${current.combo.join('-')}`
  if (signature === lastSavedSignature) return
  lastSavedSignature = signature
  setSaveState(current.panel, 'архив…', 'wait')

  try {
    const data = await invokeFunction('forecast-archive', {
      action: 'save',
      target_draw_number: current.target,
      combo: current.combo,
      candidates: current.candidates
    })
    setSaveState(current.panel, data?.locked ? 'архив заморожен ✓' : 'архив сохранён ✓', 'ok')
  } catch (error) {
    lastSavedSignature = ''
    setSaveState(current.panel, 'архив: ошибка', 'bad')
    console.warn('Possible-output archive save failed:', error)
  }
}

function learningAnchor() {
  const kin = document.querySelector('#kinship-learning-panel')
  if (kin) return kin
  const title = [...document.querySelectorAll('.panel-title')]
    .find(el => el.textContent?.includes('ПОСЛЕДНИЕ ОБУЧЕННЫЕ ЦИКЛЫ'))
  return title?.closest('.panel') || null
}

function formatDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
  }).format(date).replace(',', '')
}

function archiveMarkup(rows) {
  const checked = rows.filter(r => r.checked)
  const avg = checked.length ? checked.reduce((sum, r) => sum + Number(r.hit_count || 0), 0) / checked.length : null

  return `<section class="panel poa-panel" id="possible-output-history-panel">
    <div class="panel-head">
      <div><div class="eyebrow">МИНИ-АРХИВ</div><h2>Возможный выход · проверки</h2></div>
      <span class="status-pill">${rows.length} прогнозов</span>
    </div>
    <div class="poa-metrics">
      <div><b>${checked.length}</b><span>уже проверено</span></div>
      <div><b>${avg == null ? '—' : avg.toFixed(2)}</b><span>ср. HIT из 10</span></div>
      <div><b>2.50</b><span>случайное ожидание</span></div>
    </div>
    <div class="poa-list">
      ${rows.length ? rows.map(row => {
        const hitSet = new Set((row.hit_numbers || []).map(Number))
        const status = row.checked ? `HIT ${Number(row.hit_count || 0)}/10` : 'ожидание факта'
        return `<details class="poa-row">
          <summary>
            <b>№${row.target_draw_number}</b>
            <span>${row.screenshot_count} скр.</span>
            <strong class="${row.checked ? 'checked' : 'waiting'}">${status}</strong>
            <i>⌄</i>
          </summary>
          <div class="poa-body">
            <div class="poa-caption">ЗАФИКСИРОВАННАЯ КОМБА</div>
            <div class="poa-combo">${(row.combo || []).map(n => `<span class="${hitSet.has(Number(n)) ? 'hit' : ''}">${pad(n)}</span>`).join('')}</div>
            ${row.checked ? `<div class="poa-hitline"><b>Попали:</b> ${(row.hit_numbers || []).map(pad).join(', ') || 'нет'}</div>` : '<div class="poa-hitline muted">Тираж ещё не закрыт фактом.</div>'}
            <div class="poa-meta">${formatDate(row.updated_at)} · история ${row.history_cycles} циклов · ${row.model_version}</div>
          </div>
        </details>`
      }).join('') : '<div class="poa-empty">Архив начнёт заполняться автоматически, когда появится первая комба «Возможный выход».</div>'}
    </div>
    <p class="poa-note">До выхода тиража запись обновляется при изменении комбы. После появления официального факта она больше не переписывается, а только получает результат проверки.</p>
  </section>`
}

async function loadArchiveIntoView() {
  const anchor = learningAnchor()
  if (!anchor || document.querySelector('#possible-output-history-panel') || archiveLoading) return
  archiveLoading = true
  try {
    const data = await invokeFunction('forecast-archive', { action: 'history', limit: 60 })
    if (!learningAnchor() || document.querySelector('#possible-output-history-panel')) return
    const wrap = document.createElement('div')
    wrap.innerHTML = archiveMarkup(Array.isArray(data?.forecasts) ? data.forecasts : [])
    const panel = wrap.firstElementChild
    if (panel) learningAnchor().insertAdjacentElement('afterend', panel)
  } catch (error) {
    console.warn('Possible-output archive load failed:', error)
  } finally {
    archiveLoading = false
  }
}

function sync() {
  saveCurrentPrediction()
  loadArchiveIntoView()
}

const observer = new MutationObserver(sync)
observer.observe(document.documentElement, { subtree: true, childList: true })
sync()
