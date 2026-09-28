import './fact-order-tabs.css'

let mode = 'draw'

function latestFactPanel() {
  const eyebrow = [...document.querySelectorAll('.eyebrow')]
    .find(el => el.textContent?.trim() === 'ПОСЛЕДНИЙ ТИРАЖ')
  return eyebrow?.closest('.panel') || null
}

function numberFromBall(ball) {
  const text = ball?.querySelector('span')?.textContent || ball?.textContent || ''
  const n = Number(String(text).match(/\d+/)?.[0])
  return Number.isFinite(n) ? n : 999
}

function cloneGrid(grid, balls) {
  const copy = grid.cloneNode(false)
  copy.classList.add('fact-order-clone')
  for (const ball of balls) copy.appendChild(ball.cloneNode(true))
  return copy
}

function renderMode(panel, nextMode) {
  const grid = panel.querySelector('.number-grid:not(.fact-order-clone)')
  if (!grid) return

  const original = [...grid.querySelectorAll('.fact-ball')]
    .map((ball, index) => ({ ball, index, number: numberFromBall(ball) }))

  // Preserve the true draw order once per rendered panel.
  if (!panel._factDrawOrder || panel._factDrawOrder.length !== original.length) {
    panel._factDrawOrder = original.map(x => ({ number: x.number, html: x.ball.outerHTML }))
  }

  const drawOrder = panel._factDrawOrder.map(x => {
    const wrap = document.createElement('div')
    wrap.innerHTML = x.html
    return wrap.firstElementChild
  }).filter(Boolean)
  const ascending = [...drawOrder].sort((a, b) => numberFromBall(a) - numberFromBall(b))

  panel.querySelectorAll('.fact-order-extra,.fact-order-label').forEach(el => el.remove())
  grid.innerHTML = ''

  if (nextMode === 'asc') {
    for (const ball of ascending) grid.appendChild(ball)
  } else {
    for (const ball of drawOrder) grid.appendChild(ball)
  }

  if (nextMode === 'both') {
    const label1 = document.createElement('div')
    label1.className = 'fact-order-label'
    label1.textContent = 'ВЫПАДЕНИЕ'
    grid.insertAdjacentElement('beforebegin', label1)

    const label2 = document.createElement('div')
    label2.className = 'fact-order-label fact-order-extra'
    label2.textContent = 'ВОЗРАСТАНИЕ'
    grid.insertAdjacentElement('afterend', label2)

    const second = cloneGrid(grid, ascending)
    second.classList.add('fact-order-extra')
    label2.insertAdjacentElement('afterend', second)
  }

  panel.querySelectorAll('[data-fact-order]').forEach(btn => {
    btn.classList.toggle('on', btn.dataset.factOrder === nextMode)
  })
  mode = nextMode
}

function inject() {
  const panel = latestFactPanel()
  if (!panel) return
  const meta = panel.querySelector('.fact-meta')
  const grid = panel.querySelector('.number-grid:not(.fact-order-clone)')
  if (!meta || !grid) return
  if (panel.querySelector('.fact-order-tabs')) return

  const controls = document.createElement('div')
  controls.className = 'fact-order-tabs'
  controls.innerHTML = `
    <button type="button" data-fact-order="draw">Выпадение</button>
    <button type="button" data-fact-order="asc">Возрастание</button>
    <button type="button" data-fact-order="both">Вместе</button>`
  meta.insertAdjacentElement('afterend', controls)

  controls.querySelectorAll('[data-fact-order]').forEach(btn => {
    btn.addEventListener('click', () => renderMode(panel, btn.dataset.factOrder))
  })
  renderMode(panel, mode)
}

const observer = new MutationObserver(() => inject())
observer.observe(document.documentElement, { childList: true, subtree: true })
inject()
