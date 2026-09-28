import './fact-order-tabs-v2.css'

let activeMode = 'draw'

function latestFactPanel() {
  const eyebrow = [...document.querySelectorAll('.eyebrow')]
    .find(el => el.textContent?.trim() === 'ПОСЛЕДНИЙ ТИРАЖ')
  return eyebrow?.closest('.fact-card, .panel') || null
}

function numberFromBall(ball) {
  const text = ball?.querySelector('span')?.textContent || ball?.textContent || ''
  const m = String(text).match(/\d{1,2}/)
  const n = Number(m?.[0])
  return Number.isInteger(n) && n >= 1 && n <= 80 ? n : null
}

function captureSource(panel, grid) {
  if (panel.__factOrderSource) return panel.__factOrderSource
  const source = [...grid.querySelectorAll('.fact-ball')]
    .map(ball => ({ number: numberFromBall(ball), html: ball.outerHTML }))
    .filter(x => x.number != null)
  if (source.length === 20) panel.__factOrderSource = source
  return source
}

function ballFromHtml(html) {
  const wrap = document.createElement('div')
  wrap.innerHTML = html
  return wrap.firstElementChild
}

function fillGrid(grid, balls) {
  grid.replaceChildren(...balls)
}

function buildBall(entry) {
  return ballFromHtml(entry.html)
}

function buildTogetherBall(drawEntry, ascEntry) {
  const ball = buildBall(drawEntry)
  if (!ball) return null
  const span = ball.querySelector('span')
  if (span) {
    span.textContent = String(drawEntry.number).padStart(2, '0')
    const asc = document.createElement('small')
    asc.className = 'fact-order-pair'
    asc.textContent = `(${String(ascEntry.number).padStart(2, '0')})`
    span.appendChild(asc)
  }
  ball.classList.add('fact-order-together-ball')
  return ball
}

function renderMode(panel, mode) {
  const grid = panel.querySelector('.number-grid')
  if (!grid) return
  const source = captureSource(panel, grid)
  if (source.length !== 20) return
  const ascending = [...source].sort((a, b) => a.number - b.number)

  let balls
  if (mode === 'asc') {
    balls = ascending.map(buildBall).filter(Boolean)
  } else if (mode === 'both') {
    balls = source.map((entry, i) => buildTogetherBall(entry, ascending[i])).filter(Boolean)
  } else {
    balls = source.map(buildBall).filter(Boolean)
  }

  fillGrid(grid, balls)
  panel.querySelectorAll('[data-fact-order-v2]').forEach(btn => {
    btn.classList.toggle('on', btn.dataset.factOrderV2 === mode)
  })
  activeMode = mode
}

function inject() {
  const panel = latestFactPanel()
  if (!panel) return
  const meta = panel.querySelector('.fact-meta')
  const grid = panel.querySelector('.number-grid')
  if (!meta || !grid) return

  if (!panel.querySelector('.fact-order-tabs-v2')) {
    captureSource(panel, grid)
    const controls = document.createElement('div')
    controls.className = 'fact-order-tabs-v2'
    controls.innerHTML = `
      <button type="button" data-fact-order-v2="draw">Выпадение</button>
      <button type="button" data-fact-order-v2="asc">Возрастание</button>
      <button type="button" data-fact-order-v2="both">Вместе</button>`
    meta.insertAdjacentElement('afterend', controls)
    controls.querySelectorAll('[data-fact-order-v2]').forEach(btn => {
      btn.addEventListener('click', () => renderMode(panel, btn.dataset.factOrderV2))
    })
    renderMode(panel, activeMode)
  }
}

let scheduled = false
const observer = new MutationObserver(() => {
  if (scheduled) return
  scheduled = true
  requestAnimationFrame(() => {
    scheduled = false
    inject()
  })
})
observer.observe(document.documentElement, { childList: true, subtree: true })
inject()
