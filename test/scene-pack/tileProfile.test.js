import test from 'node:test'
import assert from 'node:assert/strict'

import {
  TOPDOWN_TILE_DUAL_GRID_V0,
  areTileEdgesCompatible,
  buildTileAtlasMetadata,
  getTileSourceRegion,
  validateTileProfile,
} from '../../src/scene-pack/tileProfile.js'

test('topdown_tile_dual_grid_v0 defines a padded 16-tile dual-grid atlas', () => {
  assert.equal(TOPDOWN_TILE_DUAL_GRID_V0.id, 'topdown_tile_dual_grid_v0')
  assert.deepEqual(TOPDOWN_TILE_DUAL_GRID_V0.tile, { w: 32, h: 32 })
  assert.deepEqual(TOPDOWN_TILE_DUAL_GRID_V0.grid, { columns: 4, rows: 4 })
  assert.deepEqual(TOPDOWN_TILE_DUAL_GRID_V0.source.cell, { w: 48, h: 48, padding: 8 })
  assert.deepEqual(TOPDOWN_TILE_DUAL_GRID_V0.source.sheet, { w: 192, h: 192 })

  assert.deepEqual(getTileSourceRegion(0b1010), {
    index: 10,
    row: 2,
    col: 2,
    x: 104,
    y: 104,
    w: 32,
    h: 32,
    padding: { top: 8, right: 8, bottom: 8, left: 8 },
  })
})

test('tile atlas metadata exposes row-major masks, corners, edges, and source regions', () => {
  const metadata = buildTileAtlasMetadata()

  assert.equal(metadata.profile, 'topdown_tile_dual_grid_v0')
  assert.equal(metadata.tiles.length, 16)
  assert.deepEqual(metadata.tiles[0], {
    id: 'mask_0',
    index: 0,
    row: 0,
    col: 0,
    mask: 0,
    corners: { nw: false, ne: false, se: false, sw: false },
    edges: {
      north: [false, false],
      east: [false, false],
      south: [false, false],
      west: [false, false],
    },
    source: { x: 8, y: 8, w: 32, h: 32 },
  })
  assert.deepEqual(metadata.tiles[15].corners, { nw: true, ne: true, se: true, sw: true })
})

test('tile edge compatibility compares shared dual-grid corner signatures', () => {
  assert.equal(areTileEdgesCompatible(0b0110, 0b1001, 'east'), true)
  assert.equal(areTileEdgesCompatible(0b0110, 0b0001, 'east'), false)
  assert.equal(areTileEdgesCompatible(0b0011, 0b1100, 'north'), true)
  assert.equal(areTileEdgesCompatible(0b0011, 0b0100, 'north'), false)
})

test('validateTileProfile enforces source padding before generation uses the atlas', () => {
  const passing = validateTileProfile()

  assert.equal(passing.status, 'pass')
  assert.deepEqual(passing.blocking_errors, [])
  assert.equal(passing.metrics.tile_count, 16)
  assert.equal(passing.metrics.min_source_padding_px, 8)

  const failing = validateTileProfile({
    ...TOPDOWN_TILE_DUAL_GRID_V0,
    source: {
      sheet: { w: 120, h: 128 },
      cell: { w: 32, h: 32, padding: 0 },
    },
  })

  assert.equal(failing.status, 'fail')
  assert.deepEqual(failing.blocking_errors, ['source_padding_below_min', 'source_sheet_size_mismatch'])
})
