import test from 'node:test'
import assert from 'node:assert/strict'

import { computeGridBoundaries, correctGridByProjection, sliceRgbaCells } from '../../src/character-pack/sheetSlicer.js'

test('computeGridBoundaries uses cumulative rounding without dropping pixels', () => {
  const grid = computeGridBoundaries({ width: 1001, height: 999, columns: 8, rows: 8 })
  assert.equal(grid.columns.length, 8)
  assert.equal(grid.rows.length, 8)
  assert.equal(grid.columns[0].x, 0)
  assert.equal(grid.columns[7].x + grid.columns[7].w, 1001)
  assert.equal(grid.rows[7].y + grid.rows[7].h, 999)
})

test('sliceRgbaCells emits row-major cells', () => {
  const image = { width: 4, height: 2, data: new Uint8ClampedArray(4 * 2 * 4) }
  image.data[(0 * 4 + 0) * 4 + 3] = 255
  image.data[(1 * 4 + 3) * 4 + 3] = 255
  const cells = sliceRgbaCells(image, computeGridBoundaries({ width: 4, height: 2, columns: 2, rows: 1 }))
  assert.equal(cells.length, 2)
  assert.deepEqual(cells[0].meta, { index: 0, row: 0, col: 0, x: 0, y: 0, w: 2, h: 2 })
  assert.deepEqual(cells[1].meta, { index: 1, row: 0, col: 1, x: 2, y: 0, w: 2, h: 2 })
})

test('correctGridByProjection moves a boundary to a low-content seam', () => {
  const image = { width: 9, height: 1, data: new Uint8ClampedArray(9 * 4) }
  for (const x of [0, 1, 2, 6, 7, 8]) image.data[x * 4 + 3] = 255
  const grid = computeGridBoundaries({ width: 9, height: 1, columns: 3, rows: 1 })
  const corrected = correctGridByProjection(image, grid, { searchRadius: 1 })
  assert.equal(corrected.correction.applied, true)
  assert.equal(corrected.columns[1].x, 4)
})

test('correctGridByProjection also moves row boundaries to low-content seams', () => {
  const image = { width: 1, height: 9, data: new Uint8ClampedArray(9 * 4) }
  for (const y of [0, 1, 2, 6, 7, 8]) image.data[y * 4 + 3] = 255
  const grid = computeGridBoundaries({ width: 1, height: 9, columns: 1, rows: 3 })
  const corrected = correctGridByProjection(image, grid, { searchRadius: 1 })
  assert.equal(corrected.correction.applied, true)
  assert.equal(corrected.rows[1].y, 4)
  assert.deepEqual(corrected.correction.rows_corrected, [1, 2])
})
