const APP_VERSION = '0.2.5'
const REFRESH_FLAG = 'virtus.manualRefresh.v1'

function ensureRefreshUi() {
  const sub = document.querySelector('.brand-sub')
  if (sub && !sub.querySelector('.app-version')) {
    const version = document.createElement('span')
    version.className = 'app-version'
    version.textContent = ` · v${APP_VERSION}`
    sub.appendChild(version)
  }

  document.querySelectorAll('[data-refresh]').forEach(button => {
    button.title = 'Обновить приложение и данные'
    button.setAttribute('aria-label', 'Обновить приложение и данные')
  })
}

function showUpdatedMark() {
  let wasManual = false
  try {
    wasManual = sessionStorage.getItem(REFRESH_FLAG) === '1'
    if (wasManual) sessionStorage.removeItem(REFRESH_FLAG)
  } catch (_) {}
  if (!wasManual) return

  const header = document.querySelector('.app-header')
  if (!header || header.querySelector('.manual-refresh-ok')) return
  const mark = document.createElement('span')
  mark.className = 'manual-refresh-ok'
  mark.textContent = `обновлено · v${APP_VERSION}`
  header.appendChild(mark)
  setTimeout(() => mark.remove(), 3500)
}

async function hardRefresh(button) {
  if (button?.dataset?.hardRefreshing === '1') return
  if (button) {
    button.dataset.hardRefreshing = '1'
    button.disabled = true
    button.classList.add('hard-refreshing')
  }

  try { sessionStorage.setItem(REFRESH_FLAG, '1') } catch (_) {}

  try {
    if ('caches' in window) {
      const keys = await caches.keys()
      await Promise.all(keys.map(key => caches.delete(key)))
    }
  } catch (_) {}

  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations()
      await Promise.all(regs.map(reg => reg.unregister()))
    }
  } catch (_) {}

  const url = new URL(window.location.href)
  url.searchParams.set('_refresh', String(Date.now()))
  window.location.replace(url.toString())
}

document.addEventListener('click', event => {
  const button = event.target.closest?.('[data-refresh]')
  if (!button) return
  event.preventDefault()
  event.stopPropagation()
  event.stopImmediatePropagation()
  hardRefresh(button)
}, true)

const style = document.createElement('style')
style.textContent = `
  .app-version{color:#55d8ff;font-weight:800;white-space:nowrap}
  [data-refresh].hard-refreshing{animation:virtusRefreshSpin .7s linear infinite;opacity:.75}
  .manual-refresh-ok{margin-left:auto;margin-right:56px;padding:6px 10px;border:1px solid rgba(79,225,147,.45);border-radius:999px;background:rgba(28,126,78,.18);color:#63e7a0;font-size:12px;font-weight:800;white-space:nowrap}
  @keyframes virtusRefreshSpin{to{transform:rotate(360deg)}}
  @media(max-width:520px){.manual-refresh-ok{position:absolute;right:58px;top:10px;margin:0;font-size:10px;padding:4px 7px}.app-version{font-size:11px}}
`
document.head.appendChild(style)

const observer = new MutationObserver(() => {
  ensureRefreshUi()
  showUpdatedMark()
})
observer.observe(document.documentElement, { subtree: true, childList: true })

ensureRefreshUi()
showUpdatedMark()

// Убираем только технический cache-buster из адресной строки после успешного запуска.
if (new URL(window.location.href).searchParams.has('_refresh')) {
  const clean = new URL(window.location.href)
  clean.searchParams.delete('_refresh')
  history.replaceState(null, '', clean.pathname + clean.search + clean.hash)
}
