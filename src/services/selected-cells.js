// Select only blue number cells; never OCR surrounding prices, counters or desktop UI.
export function findSelectedCells({ data, width, height }) {
  const mask = new Uint8Array(width * height)
  for (let i = 0; i < mask.length; i++) {
    const p = i * 4, r = data[p], g = data[p + 1], b = data[p + 2]
    mask[i] = b > 145 && b > r * 1.6 && b > g * 1.25 ? 1 : 0
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
      for (const next of [x ? p - 1 : -1, x + 1 < width ? p + 1 : -1, p - width, p + width]) {
        if (next >= 0 && next < mask.length && mask[next]) { mask[next] = 0; queue[tail++] = next }
      }
    }
    const w = right - left + 1, h = bottom - top + 1
    if (w >= 14 && h >= 14 && w <= width / 5 && h <= height / 4 &&
        w / h > 0.7 && w / h < 1.4 && tail / (w * h) > 0.42) {
      boxes.push({ left, top, width: w, height: h })
    }
  }
  // A ticket is one compact group of similarly sized cells on a regular grid.
  const groups = []
  const unused = new Set(boxes)
  for (const box of boxes) {
    if (!unused.has(box)) continue
    const group = [box]; unused.delete(box)
    for (let i = 0; i < group.length; i++) {
      for (const other of unused) {
        const a = group[i], dx = Math.abs(a.left - other.left), dy = Math.abs(a.top - other.top)
        const similar = Math.abs(a.width - other.width) < a.width * 0.2 &&
          Math.abs(a.height - other.height) < a.height * 0.2
        if (similar && dx <= a.width * 10.5 && dy <= a.height * 8.5) {
          group.push(other); unused.delete(other)
        }
      }
    }
    if (group.length >= 5) groups.push(group)
  }
  if (groups.length !== 1) return { cells: [], reason: groups.length ? 'На изображении несколько таблиц. Загрузите их отдельно.' : 'Не найдена таблица с синими выбранными ячейками.' }
  const cells = groups[0].sort((a, b) => Math.abs(a.top - b.top) < a.height / 2 ? a.left - b.left : a.top - b.top)
  const unitW = cells.map(c => c.width).sort((a,b)=>a-b)[Math.floor(cells.length/2)]
  const unitH = cells.map(c => c.height).sort((a,b)=>a-b)[Math.floor(cells.length/2)]
  const originX = Math.min(...cells.map(c => c.left)), originY = Math.min(...cells.map(c => c.top))
  const fitsAxis = (axis, origin, size, count) => {
    for (let ratio = 1.02; ratio <= 1.32; ratio += 0.01) {
      const step = size * ratio
      if (cells.every(c => { const n=(c[axis]-origin)/step; return Math.round(n) < count && Math.abs(n-Math.round(n)) < 0.14 })) return true
    }
    return false
  }
  if (!fitsAxis('left',originX,unitW,10) || !fitsAxis('top',originY,unitH,8)) return {cells:[], reason:'Выбранные ячейки не образуют таблицу 1–80.'}
  return { cells, reason: cells.length === 10 ? '' : `В таблице выделено ${cells.length} ячеек; требуется ровно 10.` }
}

export function validateRecognizedNumbers(values) {
  const valid = values.filter(n => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 80)
  const numbers = [...new Set(valid)].sort((a, b) => a - b)
  return { ok: values.length === 10 && valid.length === 10 && numbers.length === 10, numbers, count: numbers.length }
}
