import { pixelOffset } from './imageMath.js'

function ranges(total, count, key) {
  return Array.from({ length: count }, (_, i) => {
    const start = Math.round((i * total) / count)
    const end = Math.round(((i + 1) * total) / count)
    return { [key]: start, [key === 'x' ? 'w' : 'h']: Math.max(1, end - start) }
  })
}

export function computeGridBoundaries({ width, height, columns, rows, manualOverrides = null }) {
  const cols = ranges(width, columns, 'x')
  const rowRanges = ranges(height, rows, 'y')
  if (manualOverrides?.columns) {
    for (let i = 0; i < columns; i++) {
      const x0 = manualOverrides.columns[i] ?? cols[i].x
      const x1 = manualOverrides.columns[i + 1] ?? (cols[i].x + cols[i].w)
      cols[i] = { x: x0, w: Math.max(1, x1 - x0) }
    }
  }
  if (manualOverrides?.rows) {
    for (let i = 0; i < rows; i++) {
      const y0 = manualOverrides.rows[i] ?? rowRanges[i].y
      const y1 = manualOverrides.rows[i + 1] ?? (rowRanges[i].y + rowRanges[i].h)
      rowRanges[i] = { y: y0, h: Math.max(1, y1 - y0) }
    }
  }
  return { columns: cols, rows: rowRanges }
}

export function sliceRgbaCells(image, grid) {
  const cells = []
  for (let row = 0; row < grid.rows.length; row++) {
    for (let col = 0; col < grid.columns.length; col++) {
      const c = grid.columns[col]
      const r = grid.rows[row]
      const data = new Uint8ClampedArray(c.w * r.h * 4)
      for (let y = 0; y < r.h; y++) {
        for (let x = 0; x < c.w; x++) {
          const src = pixelOffset(image.width, c.x + x, r.y + y)
          const dst = pixelOffset(c.w, x, y)
          data[dst] = image.data[src]
          data[dst + 1] = image.data[src + 1]
          data[dst + 2] = image.data[src + 2]
          data[dst + 3] = image.data[src + 3]
        }
      }
      cells.push({ image: { width: c.w, height: r.h, data }, meta: { index: cells.length, row, col, x: c.x, y: r.y, w: c.w, h: r.h } })
    }
  }
  return cells
}

function alphaColumnProjection(image) {
  return Array.from({ length: image.width }, (_, x) => {
    let sum = 0
    for (let y = 0; y < image.height; y++) sum += image.data[pixelOffset(image.width, x, y) + 3]
    return sum
  })
}

function alphaRowProjection(image) {
  return Array.from({ length: image.height }, (_, y) => {
    let sum = 0
    for (let x = 0; x < image.width; x++) sum += image.data[pixelOffset(image.width, x, y) + 3]
    return sum
  })
}

function nearestMin(values, center, radius) {
  const start = Math.max(0, center - radius)
  const end = Math.min(values.length - 1, center + radius)
  let bestValue = values[center] ?? Infinity
  for (let i = start; i <= end; i++) {
    if ((values[i] ?? Infinity) < bestValue) bestValue = values[i]
  }
  const minima = []
  for (let i = start; i <= end; i++) {
    if ((values[i] ?? Infinity) === bestValue) minima.push(i)
  }
  return minima[Math.floor(minima.length / 2)] ?? center
}

export function correctGridByProjection(image, grid, { searchRadius = 6 } = {}) {
  const columnProjection = alphaColumnProjection(image)
  const rowProjection = alphaRowProjection(image)
  const starts = [0, ...grid.columns.slice(1).map((col) => col.x), image.width]
  const rowStarts = [0, ...grid.rows.slice(1).map((row) => row.y), image.height]
  let applied = false
  const columnsCorrected = []
  const rowsCorrected = []
  for (let i = 1; i < starts.length - 1; i++) {
    const corrected = nearestMin(columnProjection, starts[i], searchRadius)
    if (corrected !== starts[i]) {
      starts[i] = corrected
      applied = true
      columnsCorrected.push(i)
    }
  }
  for (let i = 1; i < rowStarts.length - 1; i++) {
    const corrected = nearestMin(rowProjection, rowStarts[i], searchRadius)
    if (corrected !== rowStarts[i]) {
      rowStarts[i] = corrected
      applied = true
      rowsCorrected.push(i)
    }
  }
  const columns = grid.columns.map((_, i) => ({ x: starts[i], w: Math.max(1, starts[i + 1] - starts[i]) }))
  const rows = grid.rows.map((_, i) => ({ y: rowStarts[i], h: Math.max(1, rowStarts[i + 1] - rowStarts[i]) }))
  return {
    ...grid,
    columns,
    rows,
    correction: {
      applied,
      method: 'projection_minima',
      columns_corrected: columnsCorrected,
      rows_corrected: rowsCorrected,
    },
  }
}
