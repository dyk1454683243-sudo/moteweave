import test from 'node:test'
import assert from 'node:assert/strict'

import { expandCellCanvas, centerCropCell } from '../../src/character-pack/cellGeometry.js'

test('expandCellCanvas adds transparent padding without moving source pixels', () => {
  const cell = { width: 2, height: 2, data: new Uint8ClampedArray(16) }
  cell.data[3] = 255
  const out = expandCellCanvas(cell, { top: 1, right: 2, bottom: 0, left: 1 })
  assert.equal(out.width, 5)
  assert.equal(out.height, 3)
  assert.equal(out.data[((1 * 5 + 1) * 4) + 3], 255)
})

test('centerCropCell crops or pads around the cell center', () => {
  const cell = { width: 4, height: 4, data: new Uint8ClampedArray(4 * 4 * 4) }
  cell.data[((2 * 4 + 2) * 4) + 3] = 255
  const cropped = centerCropCell(cell, { width: 2, height: 2 })
  assert.equal(cropped.width, 2)
  assert.equal(cropped.height, 2)
  assert.equal(cropped.data[((1 * 2 + 1) * 4) + 3], 255)
})
