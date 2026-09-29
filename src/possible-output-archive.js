import './possible-output-archive.css'
import { invokeFunction } from './services/functions.js'

let lastSavedSignature = ''
let archiveLoading = false
let syncTimer = null

const pad = n => String(n).padStart(2, '0')

function tierShort(tier) {
  if (tier === 'direct') return 'прямо'
  if (tier === 'neighbor_1') return '±1'
  if (tier === 'neighbor_2') return '±2'
  if (tier === 'same_column') return 'столб'
  return 'холодный'
}

function verifiedCountFromPage() {
  const text = String(document.querySelector('.target-status')?.textContent || '')
  const m = text.match(/(\d+)\s+проверено/i)
  return m ? Number(m[1]) : null
}

function visibleShotSignature() {
  const cards = [...document.querySelectorAll('.shot-card.verified')]
  if (!cards.length) return ''
  return cards.map(card => String(card.textContent || '').replace(/\s+/g, ' ').trim()).join('|')
}

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
  const label = String(panel.querySelector('.kin-combo-label')?.textContent || '')
  const countMatch = label.match(/(?:текущим|сервер[^·]*·)\s*(\d+)\s+скрин/i)
  const panelCount = countMatch ? Number(countMatch[1]) : 0
  const verifiedCount = verifiedCountFromPage()
  const screenshotCount = Number.isFinite(verifiedCount) ? verifiedCount : panelCount
  return { panel, target, combo, candidates, screenshotCount }
}

function predictionSignature(current) {
  if (!current) return ''
  return `${current.target}:${current.screenshotCount}:${current.combo.join('-')}:${visibleShotSignature()}`
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

function applyServerForecast(panel, forecast, locked) {
  if (!panel || !forecast) return
  const combo = Array.isArray(forecast.combo) ? forecast.combo.map(Number).filter(Number.isFinite) : []
  const candidates = Array.isArray(forecast.candidates) ? forecast.candidates : []
  if (combo.length !== 10) return

  const count = Number(forecast.screenshot_count || 0)
  const label = panel.querySelector('.kin-combo-label')
  if (label) label.textContent = `КОМБА 10 ЧИСЕЛ · сервер · ${count} скрин. до cutoff${locked ? ' · FROZEN' : ''}`

  const comboBox = panel.querySelector('.kin-combo')
  if (comboBox) {
    comboBox.innerHTML = combo.map((n, i) => `<span><small>${i + 1}</small>${pad(n)}</span>`).join('')
  }

  const list = panel.querySelector('.kin-candidates')
  if (list && candidates.length) {
    list.innerHTML = candidates.map(item => {
      const n = Number(item.number)
      const support = Number(item.support_shots ?? 0)
      const index = Number(item.index)
      return `<div class="kin-candidate">
        <b>${pad(n)}</b>
        <span>${tierShort(item.relation)} · ${support}/${count} скр.</span>
        <em>индекс ${Number.isFinite(index) ? index.toFixed(0) : '—'}</em>
      </div>`
    }).join('')
  }

  panel.dataset.poaLocked = locked ? '1' : '0'
  panel.dataset.poaFingerprint = String(forecast.input_fingerprint || '')
}

async function saveCurrentPrediction() {
  const current = currentPrediction()
  if (!current) return
  if (current.panel.dataset.poaLocked === '1') return

  const signature = predictionSignature(current)
  if (signature === lastSavedSignature) return
  lastSavedSignature = signature
  setSaveState(current.panel, 'сервер…', 'wait')

  try {
    const data = await invokeFunction('forecast-archive', {
      action: 'save',
      target_draw_number: current.target
    })
    const locked = Boolean(data?.locked)
    applyServerForecast(current.panel, data?.forecast, locked)
    setSaveState(current.panel, locked ? 'FROZEN ✓' : 'сервер сохранён ✓', 'ok')

    const after = currentPrediction()
    lastSavedSignature = predictionSignature(after)

    document.querySelector('#possible-output-history-panel')?.remove()
    archiveLoading = false
    loadArchiveIntoView()
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

function frequentChip(number, counts, hitSet) {
  const count = Number(counts?.[String(number)] || 0)
  return `<span class="${hitSet.has(Number(number)) ? 'hit' : ''}">${pad(number)}${count ? `<small>×${count}</small>` : ''}</span>`
}

function archiveMarkup(rows) {
  const checked = rows.filter(r => r.checked)
  const avgCombo = checked.length ? checked.reduce((sum, r) => sum + Number(r.hit_count || 0), 0) / checked.length : null
  const frequentChecked = checked.filter(r => Array.isArray(r.frequent_numbers) && r.frequent_numbers.length)
  const avgFrequent = frequentChecked.length
    ? frequentChecked.reduce((sum, r) => sum + Number(r.frequent_hit_count || 0), 0) / frequentChecked.length
    : null

  return `<section class="panel poa-panel" id="possible-output-history-panel">
    <div class="panel-head">
      <div><div class="eyebrow">МИНИ-АРХИВ</div><h2>Возможный выход · проверки</h2></div>
      <span class="status-pill">${rows.length} прогнозов</span>
    </div>
    <div class="poa-metrics">
      <div><b>${checked.length}</b><span>уже проверено</span></div>
      <div><b>${avgCombo == null ? '—' : avgCombo.toFixed(2)}</b><span>ср. комба HIT /10</span></div>
      <div><b>${avgFrequent == null ? '—' : avgFrequent.toFixed(2)}</b><span>ср. TOP‑8 HIT</span></div>
    </div>
    <div class="poa-list">
      ${rows.length ? rows.map(row => {
        const hitSet = new Set((row.hit_numbers || []).map(Number))
        const frequentHitSet = new Set((row.frequent_hit_numbers || []).map(Number))
        const frequent = Array.isArray(row.frequent_numbers) ? row.frequent_numbers : []
        const counts = row.frequent_counts || {}
        const comboStatus = row.checked ? `КОМБО ${Number(row.hit_count || 0)}/10` : (row.locked ? 'FROZEN' : 'ожидание факта')
        const frequentStatus = row.checked && frequent.length ? `TOP‑8 ${Number(row.frequent_hit_count || 0)}/${frequent.length}` : ''
        const late = Number(row.excluded_late_screenshot_count || 0)
        return `<details class="poa-row">
          <summary>
            <b>№${row.target_draw_number}</b>
            <span>${row.screenshot_count} скр.</span>
            <strong class="${row.checked ? 'checked' : 'waiting'}">${comboStatus}${frequentStatus ? `<small>${frequentStatus}</small>` : ''}</strong>
            <i>⌄</i>
          </summary>
          <div class="poa-body">
            <div class="poa-caption">ЗАФИКСИРОВАННАЯ СЕРВЕРОМ КОМБА · 10 ЧИСЕЛ</div>
            <div class="poa-combo">${(row.combo || []).map(n => `<span class="${hitSet.has(Number(n)) ? 'hit' : ''}">${pad(n)}</span>`).join('')}</div>
            ${row.checked ? `<div class="poa-hitline"><b>Комба попала:</b> ${(row.hit_numbers || []).map(pad).join(', ') || 'нет'} · ${Number(row.hit_count || 0)}/10</div>` : '<div class="poa-hitline muted">Тираж ещё не закрыт фактом.</div>'}

            <div class="poa-separator"></div>
            <div class="poa-caption">TOP‑8 ПО ЧАСТОТЕ НА СКРИНАХ · НЕ «БОЛЬШИНСТВО»</div>
            ${frequent.length
              ? `<div class="poa-combo poa-frequent">${frequent.map(n => frequentChip(n, counts, frequentHitSet)).join('')}</div>`
              : '<div class="poa-hitline muted">TOP‑8 для этой старой записи не был зафиксирован.</div>'}
            ${frequent.length && row.checked
              ? `<div class="poa-hitline"><b>TOP‑8 попали:</b> ${(row.frequent_hit_numbers || []).map(pad).join(', ') || 'нет'} · ${Number(row.frequent_hit_count || 0)}/${frequent.length}</div>`
              : frequent.length ? '<div class="poa-hitline muted">Проверка TOP‑8 ждёт официальный факт.</div>' : ''}

            <div class="poa-meta">сохранено ${formatDate(row.updated_at)} · cutoff ${formatDate(row.cutoff_at)}${row.frozen_at ? ` · FROZEN ${formatDate(row.frozen_at)}` : ''}${late ? ` · поздних исключено ${late}` : ''} · история ${row.history_cycles} циклов · ${row.model_version}</div>
          </div>
        </details>`
      }).join('') : '<div class="poa-empty">Архив начнёт заполняться автоматически, когда появится первая комба «Возможный выход».</div>'}
    </div>
    <p class="poa-note">Сервер сам пересчитывает комбинацию только по verified-скринам ДО cutoff. До cutoff запись обновляется только при изменении входов; после cutoff или появления факта становится FROZEN. Поздние скрины в честную оценку не попадают. TOP‑8 — это просто восемь самых частых чисел, а не большинство.</p>
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

function scheduleSync() {
  clearTimeout(syncTimer)
  syncTimer = setTimeout(sync, 350)
}

const observer = new MutationObserver(scheduleSync)
observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true })
sync()
