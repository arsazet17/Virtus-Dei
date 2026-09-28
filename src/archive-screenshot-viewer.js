import './archive-screenshot-viewer.css'
import { invokeFunction } from './services/functions.js'

const cache = new Map()

function esc(value) {
  const div = document.createElement('div')
  div.textContent = value ?? ''
  return div.innerHTML
}

function cleanNumbers(input) {
  if (!Array.isArray(input)) return []
  return [...new Set(input.map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= 80))]
}

function pad(n) { return String(n).padStart(2, '0') }

async function loadTarget(target) {
  if (!cache.has(target)) {
    cache.set(target, invokeFunction('archive-shot-detail', { target_draw_number: target }).then(data => {
      if (!data?.ok) throw new Error(data?.error || 'Не удалось загрузить скриншоты')
      return data
    }).catch(error => {
      cache.delete(target)
      throw error
    }))
  }
  return cache.get(target)
}

function parseTarget(row) {
  const text = row.querySelector('summary .arch-no')?.textContent || row.querySelector('summary')?.textContent || ''
  const match = text.match(/№\s*(\d+)/)
  return match ? Number(match[1]) : null
}

function shotCardHtml(shot, index, factSet) {
  const nums = cleanNumbers(shot.ocr_numbers)
  const hits = nums.filter(n => factSet.has(n))
  const misses = nums.filter(n => !factSet.has(n))
  const status = shot.ocr_status === 'verified' && nums.length === 10 ? '✓ 10/10' : `${nums.length}/10`
  return `<article class="archive-shot-card" data-shot-id="${esc(shot.id)}">
    <button class="archive-shot-image" type="button" data-open-shot="${esc(shot.id)}" aria-label="Открыть Скрин ${index + 1}">
      ${shot.image_url ? `<span class="archive-shot-picture"><img src="${esc(shot.image_url)}" alt="Скрин ${index + 1}" loading="lazy"><span class="archive-shot-overlay"></span></span>` : '<span class="archive-shot-noimage">Скрин недоступен</span>'}
    </button>
    <div class="archive-shot-info">
      <div class="archive-shot-title"><b>Скрин ${index + 1}</b><span>${status}</span><strong>${hits.length}/10 HIT</strong></div>
      <div class="archive-shot-proposed">${nums.map(n => `<i class="${factSet.has(n) ? 'hit' : ''}">${pad(n)}${factSet.has(n) ? '<small>✓</small>' : ''}</i>`).join('') || '<em>Числа не распознаны</em>'}</div>
      <div class="archive-shot-line"><b>Вышли из этого скрина:</b> ${hits.length ? hits.map(pad).join(', ') : 'нет'}</div>
      <div class="archive-shot-line muted"><b>Предлагал, но не вышли:</b> ${misses.length ? misses.map(pad).join(', ') : 'нет'}</div>
    </div>
  </article>`
}

function paintHitBoxes(scope, data) {
  const factSet = new Set(cleanNumbers(data.draw?.result_numbers))
  for (const card of scope.querySelectorAll('.archive-shot-card')) {
    const shot = data.screenshots.find(s => String(s.id) === String(card.dataset.shotId))
    const img = card.querySelector('img')
    const overlay = card.querySelector('.archive-shot-overlay')
    if (!shot || !img || !overlay) continue
    const paint = () => {
      overlay.innerHTML = ''
      const nw = img.naturalWidth || 0, nh = img.naturalHeight || 0
      if (!nw || !nh) return
      for (const n of cleanNumbers(shot.ocr_numbers).filter(x => factSet.has(x))) {
        const c = shot.coordinates?.[String(n)]
        if (!c || !Number.isFinite(Number(c.x)) || !Number.isFinite(Number(c.y))) continue
        const box = document.createElement('span')
        box.className = 'archive-shot-hitbox'
        box.style.left = `${Number(c.x) / nw * 100}%`
        box.style.top = `${Number(c.y) / nh * 100}%`
        box.style.width = `${Number(c.width || 1) / nw * 100}%`
        box.style.height = `${Number(c.height || 1) / nh * 100}%`
        box.innerHTML = `<b>✓</b>`
        overlay.appendChild(box)
      }
    }
    if (img.complete) paint()
    else img.addEventListener('load', paint, { once: true })
  }
}

function openShotModal(shot, data, index) {
  if (!shot?.image_url) return
  const factSet = new Set(cleanNumbers(data.draw?.result_numbers))
  const nums = cleanNumbers(shot.ocr_numbers)
  const hits = nums.filter(n => factSet.has(n))
  const modal = document.createElement('div')
  modal.className = 'archive-shot-modal'
  modal.innerHTML = `<div class="archive-shot-modal-card">
    <button class="archive-shot-modal-close" type="button">×</button>
    <div class="archive-shot-modal-head"><b>Скрин ${index + 1} · тираж №${data.target_draw_number}</b><span>${hits.length}/10 HIT</span></div>
    <span class="archive-shot-picture archive-shot-picture-full"><img src="${esc(shot.image_url)}" alt="Скрин ${index + 1}"><span class="archive-shot-overlay"></span></span>
    <div class="archive-shot-proposed modal-numbers">${nums.map(n => `<i class="${factSet.has(n) ? 'hit' : ''}">${pad(n)}${factSet.has(n) ? '<small>✓</small>' : ''}</i>`).join('')}</div>
    <div class="archive-shot-line"><b>Вышли:</b> ${hits.length ? hits.map(pad).join(', ') : 'нет'}</div>
  </div>`
  document.body.appendChild(modal)
  const img = modal.querySelector('img')
  const overlay = modal.querySelector('.archive-shot-overlay')
  const paint = () => {
    overlay.innerHTML = ''
    const nw = img.naturalWidth || 0, nh = img.naturalHeight || 0
    if (!nw || !nh) return
    for (const n of hits) {
      const c = shot.coordinates?.[String(n)]
      if (!c) continue
      const box = document.createElement('span')
      box.className = 'archive-shot-hitbox'
      box.style.left = `${Number(c.x) / nw * 100}%`
      box.style.top = `${Number(c.y) / nh * 100}%`
      box.style.width = `${Number(c.width || 1) / nw * 100}%`
      box.style.height = `${Number(c.height || 1) / nh * 100}%`
      box.innerHTML = '<b>✓</b>'
      overlay.appendChild(box)
    }
  }
  if (img.complete) paint(); else img.addEventListener('load', paint, { once: true })
  const close = () => modal.remove()
  modal.querySelector('.archive-shot-modal-close').addEventListener('click', close)
  modal.addEventListener('click', event => { if (event.target === modal) close() })
}

async function showViewer(viewer, target) {
  const button = viewer.querySelector('.archive-shot-toggle')
  const body = viewer.querySelector('.archive-shot-gallery')
  if (viewer.dataset.loaded === '1') {
    body.hidden = !body.hidden
    button.textContent = body.hidden ? `📷 Посмотреть скрины (${viewer.dataset.count})` : 'Скрыть скрины'
    return
  }
  button.disabled = true
  button.textContent = 'Загружаю скрины…'
  try {
    const data = await loadTarget(target)
    const shots = data.screenshots || []
    viewer.dataset.loaded = '1'
    viewer.dataset.count = String(shots.length)
    if (!shots.length) {
      body.innerHTML = '<div class="archive-shot-empty">Для этого тиража скрины не сохранены.</div>'
    } else {
      const factSet = new Set(cleanNumbers(data.draw?.result_numbers))
      body.innerHTML = shots.map((shot, index) => shotCardHtml(shot, index, factSet)).join('')
      paintHitBoxes(body, data)
      body.querySelectorAll('[data-open-shot]').forEach(btn => btn.addEventListener('click', () => {
        const shot = shots.find(s => String(s.id) === String(btn.dataset.openShot))
        const index = shots.findIndex(s => String(s.id) === String(btn.dataset.openShot))
        openShotModal(shot, data, index)
      }))
    }
    body.hidden = false
    button.textContent = 'Скрыть скрины'
  } catch (error) {
    body.innerHTML = `<div class="archive-shot-empty error">Не удалось загрузить скрины: ${esc(error.message || error)}</div>`
    body.hidden = false
    button.textContent = '📷 Повторить загрузку скринов'
  } finally {
    button.disabled = false
  }
}

function enhanceArchive() {
  document.querySelectorAll('details.archive-row[open]').forEach(row => {
    const body = row.querySelector('.archive-body')
    const target = parseTarget(row)
    if (!body || !target || body.querySelector('.archive-shot-viewer')) return
    const viewer = document.createElement('div')
    viewer.className = 'archive-shot-viewer'
    viewer.dataset.target = String(target)
    viewer.innerHTML = `<button class="archive-shot-toggle" type="button">📷 Посмотреть скрины</button><div class="archive-shot-gallery" hidden></div>`
    body.appendChild(viewer)
    viewer.querySelector('.archive-shot-toggle').addEventListener('click', () => showViewer(viewer, target))
  })
}

const observer = new MutationObserver(() => enhanceArchive())
observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['open'] })
document.addEventListener('click', () => queueMicrotask(enhanceArchive), true)
enhanceArchive()
