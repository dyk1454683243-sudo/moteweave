import test from 'node:test'
import assert from 'node:assert/strict'

import { buildManualOverrides, snapToNearestProjectionMinimum } from '../../src/character-pack/gridAdjustment.js'

test('snapToNearestProjectionMinimum chooses the lowest content line in a radius', () => {
  const projection = [10, 9, 1, 8, 12, 2, 9]
  assert.equal(snapToNearestProjectionMinimum(projection, 4, 2), 5)
  assert.equal(snapToNearestProjectionMinimum(projection, 1, 2), 2)
})

test('buildManualOverrides turns cut lines into row and column boundaries', () => {
  const overrides = buildManualOverrides({
    width: 800,
    height: 800,
    verticalLines: [100, 200, 300, 400, 500, 600, 700],
    horizontalLines: [100, 200, 300, 400, 500, 600, 700],
  })
  assert.deepEqual(overrides.columns, [0, 100, 200, 300, 400, 500, 600, 700, 800])
  assert.deepEqual(overrides.rows, [0, 100, 200, 300, 400, 500, 600, 700, 800])
})
