import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildRuleBasedTileMap,
  buildLdtkSceneJson,
  buildTileMap,
  validateTileMap,
} from '../../src/scene-pack/tileArrangement.js'

test('buildTileMap records row-major tile cells with dual-grid masks', () => {
  const map = buildTileMap({
    width: 2,
    height: 1,
    masks: [0b0110, 0b1001],
  })

  assert.equal(map.profile, 'topdown_tile_dual_grid_v0')
  assert.deepEqual(map.tile_size, { w: 32, h: 32 })
  assert.deepEqual(map.cells, [
    { index: 0, x: 0, y: 0, mask: 6, tile_id: 'mask_6' },
    { index: 1, x: 1, y: 0, mask: 9, tile_id: 'mask_9' },
  ])
})

test('validateTileMap reports shared-edge mismatches before arrangement export', () => {
  const valid = validateTileMap(buildTileMap({ width: 2, height: 1, masks: [0b0110, 0b1001] }))

  assert.equal(valid.status, 'pass')
  assert.deepEqual(valid.blocking_errors, [])
  assert.deepEqual(valid.edge_mismatches, [])

  const invalid = validateTileMap(buildTileMap({ width: 2, height: 1, masks: [0b0110, 0b0001] }))

  assert.equal(invalid.status, 'fail')
  assert.deepEqual(invalid.blocking_errors, ['tile_edge_mismatch'])
  assert.deepEqual(invalid.edge_mismatches, [
    {
      at: { x: 0, y: 0, index: 0, mask: 6 },
      neighbor: { x: 1, y: 0, index: 1, mask: 1 },
      side: 'east',
    },
  ])
})

test('buildRuleBasedTileMap creates deterministic valid dual-grid arrangements', () => {
  const first = buildRuleBasedTileMap({ width: 5, height: 4, seed: 42, density: 0.55 })
  const second = buildRuleBasedTileMap({ width: 5, height: 4, seed: 42, density: 0.55 })
  const different = buildRuleBasedTileMap({ width: 5, height: 4, seed: 43, density: 0.55 })

  assert.equal(first.arrangement.mode, 'rule_based_dual_grid_v0')
  assert.equal(first.arrangement.seed, 42)
  assert.equal(first.arrangement.density, 0.55)
  assert.deepEqual(first.cells.map((cell) => cell.mask), second.cells.map((cell) => cell.mask))
  assert.notDeepEqual(first.cells.map((cell) => cell.mask), different.cells.map((cell) => cell.mask))
  assert.equal(validateTileMap(first).status, 'pass')
  assert.ok(new Set(first.cells.map((cell) => cell.mask)).size > 1)
})

test('buildLdtkSceneJson exports validated tile maps as a stable JSON skeleton', () => {
  const map = buildTileMap({
    width: 2,
    height: 1,
    masks: [0b0110, 0b1001],
  })

  const scene = buildLdtkSceneJson({ map, identifier: 'smoke_scene' })

  assert.equal(scene.format, 'ldtk_style_scene_pack_v0')
  assert.equal(scene.identifier, 'smoke_scene')
  assert.deepEqual(scene.world_grid_size, { w: 64, h: 32 })
  assert.equal(scene.defs.tilesets[0].identifier, 'topdown_tile_dual_grid_v0_tileset')
  assert.equal(scene.defs.tilesets[0].tile_grid_size, 32)
  assert.deepEqual(scene.levels[0].layers[0].grid_tiles, [
    { px: [0, 0], src: [104, 56], tile: 6, flip: 0 },
    { px: [32, 0], src: [56, 104], tile: 9, flip: 0 },
  ])
})

test('buildLdtkSceneJson rejects maps with incompatible tile edges', () => {
  const map = buildTileMap({
    width: 2,
    height: 1,
    masks: [0b0110, 0b0001],
  })

  assert.throws(() => buildLdtkSceneJson({ map }), /tile_edge_mismatch/)
})
