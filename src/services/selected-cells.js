// Detect only the blue selected number cells. Surrounding prices, counters and browser UI are ignored.
export function findSelectedCells({ data, width, height }) {
  const mask = new Uint8Array(width * height)
  for (let i = 0; i < mask.length; i++) {
    const p = i * 4, r = data[p], g = data[p + 1], b = data[p + 2]
    mask[i] = b > 140 && b > r * 1.5 && b > g * 1.20 ? 1 : 0
  }

  const queue = new Int32Array(mask.length)
  const boxes = []
  for (let seed = 0; seed < mask.length; seed++) {
    if (!mask[seed]) continue
    let head = 0, tail = 1, left = width, top = height, right = 0, bottom = 0
    queue[0] = seed; mask[seed] = 0
    while (head < tail) {
      const p = queue[head++], x = p % width, y = Math.floor(p / width)
      left = Math.min(left, x); right = Math.max(right, x)
      top = Math.min(top, y); bottom = Math.max(bottom, y)
      const nexts = [x ? p - 1 : -1, x + 1 < width ? p + 1 : -1, p - width, p + width]
      for (const next of nexts) {
        if (next >= 0 && next < mask.length && mask[next]) {
          mask[next] = 0
          queue[tail++] = next
        }
      }
    }
    const w = right - left + 1, h = bottom - top + 1
    if (
      w >= 14 && h >= 14 && w <= width / 5 && h <= height / 4 &&
      w / h > 0.68 && w / h < 1.45 && tail / (w * h) > 0.38
    ) boxes.push({ left, top, width: w, height: h })
  }

  // A ticket is one compact family of similarly sized cells.
  const groups = []
  const unused = new Set(boxes)
  for (const box of boxes) {
    if (!unused.has(box)) continue
    const group = [box]
    unused.delete(box)
    for (let i = 0; i < group.length; i++) {
      for (const other of [...unused]) {
        const a = group[i]
        const dx = Math.abs(a.left - other.left), dy = Math.abs(a.top - other.top)
        const similar = Math.abs(a.width - other.width) < a.width * 0.22 &&
          Math.abs(a.height - other.height) < a.height * 0.22
        if (similar && dx <= a.width * 10.7 && dy <= a.height * 8.7) {
          group.push(other)
          unused.delete(other)
        }
      }
    }
    if (group.length >= 5) groups.push(group)
  }

  if (groups.length !== 1) {
    return {
      cells: [],
      reason: groups.length
        ? 'На изображении несколько таблиц. Загрузите их отдельно.'
        : 'Не найдена таблица с синими выбранными ячейками.'
    }
  }

  const cells = groups[0]
  const unitW = median(cells.map(c => c.width))
  const unitH = median(cells.map(c => c.height))
  const originX = Math.min(...cells.map(c => c.left))
  const originY = Math.min(...cells.map(c => c.top))
  const fitX = fitAxis(cells, 'left', originX, unitW, 10)
  const fitY = fitAxis(cells, 'top', originY, unitH, 8)

  if (!fitX || !fitY) return { cells: [], reason: 'Выбранные ячейки не образуют таблицу 1–80.' }

  const gridded = cells.map(c => ({
    ...c,
    gridX: Math.round((c.left - originX) / fitX.step),
    gridY: Math.round((c.top - originY) / fitY.step)
  })).sort((a, b) => a.gridY - b.gridY || a.gridX - b.gridX)

  if (gridded.some(c => c.gridX < 0 || c.gridX > 9 || c.gridY < 0 || c.gridY > 7)) {
    return { cells: [], reason: 'Геометрия выбранных ячеек выходит за таблицу 1–80.' }
  }

  return {
    cells: gridded,
    reason: gridded.length === 10 ? '' : `В таблице выделено ${gridded.length} ячеек; требуется ровно 10.`,
    grid: { stepX: fitX.step, stepY: fitY.step, originX, originY }
  }
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] || 0
}

function fitAxis(cells, axis, origin, size, count) {
  let best = null
  for (let ratio = 1.01; ratio <= 1.36; ratio += 0.005) {
    const step = size * ratio
    let error = 0
    let ok = true
    for (const c of cells) {
      const raw = (c[axis] - origin) / step
      const pos = Math.round(raw)
      const delta = Math.abs(raw - pos)
      if (pos < 0 || pos >= count || delta > 0.17) { ok = false; break }
      error += delta
    }
    if (ok && (!best || error < best.error)) best = { step, error }
  }
  return best
}

export function validateRecognizedNumbers(values) {
  const valid = values.filter(n => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 80)
  const numbers = [...new Set(valid)].sort((a, b) => a - b)
  return { ok: values.length === 10 && valid.length === 10 && numbers.length === 10, numbers, count: numbers.length }
}
