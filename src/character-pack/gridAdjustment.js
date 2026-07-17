export function snapToNearestProjectionMinimum(projection, position, radius = 6) {
  const start = Math.max(0, Math.floor(position - radius))
  const end = Math.min(projection.length - 1, Math.ceil(position + radius))
  const candidates = []
  for (let i = start; i <= end; i++) {
    const value = projection[i] ?? Infinity
    const prev = projection[i - 1] ?? Infinity
    const next = projection[i + 1] ?? Infinity
    if (value <= prev && value <= next) candidates.push(i)
  }
  if (!candidates.length) {
    for (let i = start; i <= end; i++) candidates.push(i)
  }
  candidates.sort((a, b) => {
    const distanceDelta = Math.abs(a - position) - Math.abs(b - position)
    if (distanceDelta !== 0) return distanceDelta
    return (projection[a] ?? Infinity) - (projection[b] ?? Infinity)
  })
  return candidates[0] ?? Math.round(position)
}

export function buildManualOverrides({ width, height, verticalLines, horizontalLines }) {
  return {
    columns: [0, ...verticalLines.map(Math.round), width],
    rows: [0, ...horizontalLines.map(Math.round), height],
  }
}
