export function compareScreenshotToDraw(screenNumbers, drawNumbers) {
  const drawSet = new Set(drawNumbers)
  return screenNumbers.map(number => ({ number, hit: drawSet.has(number) }))
}

export function summarizeScreenshots(screenshots, drawNumbers) {
  const frequency = new Map()
  for (const shot of screenshots) {
    for (const n of shot.numbers || []) frequency.set(n, (frequency.get(n) || 0) + 1)
  }
  return drawNumbers.map(n => ({
    number: n,
    shownCount: frequency.get(n) || 0,
    totalScreenshots: screenshots.length,
    share: screenshots.length ? (frequency.get(n) || 0) / screenshots.length : 0
  }))
}

export function absenceSignals(screenshots, drawNumbers) {
  const seen = new Set(screenshots.flatMap(s => s.numbers || []))
  return drawNumbers.filter(n => !seen.has(n))
}
