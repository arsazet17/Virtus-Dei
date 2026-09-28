import { invokeFunction } from './services/functions.js'

let decorating = false

function serverIdFromCard(card) {
  const source = card.querySelector('[data-correct]')
  return source?.dataset?.correct || null
}

function isFailedCard(card) {
  const status = card.querySelector('.shot-top span')?.textContent || ''
  const noNumbers = Boolean(card.querySelector('.shot-numbers small'))
  return /ошибка/i.test(status) || noNumbers
}

function deleteButton(id = '') {
  const attr = id ? `data-delete-failed="${id}"` : 'data-delete-local-failed="1"'
  return `<button type="button" class="delete-failed-shot" ${attr}>🗑 Удалить</button>`
}

function decorateFailedShots() {
  if (decorating) return
  decorating = true
  try {
    document.querySelectorAll('.shot-card.review').forEach(card => {
      if (card.dataset.deleteReady === '1') return
      if (!isFailedCard(card)) return

      const actions = card.querySelector('.shot-actions')
      if (!actions) return

      const serverId = serverIdFromCard(card)
      // Для полностью нераспознанного/ошибочного скрина не предлагаем ручное исправление:
      // пользователь либо удаляет его, либо загружает заново.
      actions.innerHTML = deleteButton(serverId || '')
      card.dataset.deleteReady = '1'
    })

    const note = document.querySelector('.ocr-note')
    if (note && !note.dataset.deleteHint) {
      note.innerHTML = 'В анализ идут только скрины со статусом <b>✓ 10/10</b>. Если скрин не распознан и стоит <b>✕ ошибка</b> — удалите его и загрузите заново.'
      note.dataset.deleteHint = '1'
    }
  } finally {
    decorating = false
  }
}

async function deleteServerScreenshot(button, screenshotId) {
  const form = new FormData()
  form.append('action', 'delete')
  form.append('screenshot_id', screenshotId)

  button.disabled = true
  button.textContent = 'Удаляю…'
  try {
    const data = await invokeFunction('screenshot-upload', form)
    if (!data?.ok) throw new Error(data?.error || 'Не удалось удалить скриншот')
    window.location.reload()
  } catch (error) {
    button.disabled = false
    button.textContent = '🗑 Удалить'
    window.alert(`Не удалось удалить скриншот: ${error?.message || error}`)
  }
}

document.addEventListener('click', event => {
  const serverButton = event.target.closest?.('[data-delete-failed]')
  const localButton = event.target.closest?.('[data-delete-local-failed]')
  const button = serverButton || localButton
  if (!button) return

  event.preventDefault()
  event.stopPropagation()

  if (!window.confirm('Удалить этот непрошедший скриншот?')) return

  if (serverButton) {
    deleteServerScreenshot(serverButton, serverButton.dataset.deleteFailed)
  } else {
    // Если загрузка оборвалась до записи на сервер, перезагрузка убирает локальную карточку.
    window.location.reload()
  }
}, true)

const style = document.createElement('style')
style.textContent = `
  .shot-actions .delete-failed-shot{
    border-color:#7d3540;
    background:#35171d;
    color:#ff9ba4;
    font-weight:900;
  }
  .shot-actions .delete-failed-shot:disabled{opacity:.6;cursor:wait}
`
document.head.appendChild(style)

const observer = new MutationObserver(() => decorateFailedShots())
observer.observe(document.documentElement, { childList:true, subtree:true })
window.addEventListener('load', decorateFailedShots)
setTimeout(decorateFailedShots, 100)
