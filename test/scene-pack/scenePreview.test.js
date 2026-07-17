import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildScenePreviewBundle,
  buildScenePreviewMaskGrid,
} from '../../src/scene-pack/scenePreview.js'

test('buildScenePreviewMaskGrid creates valid dual-grid maps from shared corner patterns', () => {
  const island = buildScenePreviewMaskGrid({ width: 4, height: 3, pattern: 'island' })

  assert.equal(island.width, 4)
  assert.equal(island.height, 3)
  assert.equal(island.masks.length, 12)
  assert.ok(island.masks.some((mask) => mask !== 0 && mask !== 15))
  assert.deepEqual(island.corner_grid_size, { w: 5, h: 4 })
})

test('buildScenePreviewBundle returns map, scene json, LDtk json, and metrics', () => {
  const bundle = buildScenePreviewBundle({
    projectId: 'demo_scene_pack',
    identifier: 'scene_preview',
    width: 4,
    height: 3,
    pattern: 'path',
    tilesetRelPath: 'scene/tileset.png',
  })

  assert.equal(bundle.status, 'pass')
  assert.equal(bundle.map.width, 4)
  assert.equal(bundle.map.height, 3)
  assert.equal(bundle.sceneJson.identifier, 'scene_preview')
  assert.equal(bundle.ldtkProjectJson.jsonVersion, '1.5.3')
  assert.equal(bundle.ldtkProjectJson.defs.tilesets[0].relPath, 'scene/tileset.png')
  assert.equal(bundle.metrics.tile_count, 12)
  assert.equal(bundle.metrics.unique_mask_count > 1, true)
})

test('buildScenePreviewBundle can use rule-based arrangement metadata', () => {
  const bundle = buildScenePreviewBundle({
    projectId: 'demo_scene_pack',
    identifier: 'rule_preview',
    width: 5,
    height: 4,
    pattern: 'rule',
    seed: 12,
    density: 0.45,
    tilesetRelPath: 'scene/tileset.png',
  })

  assert.equal(bundle.status, 'pass')
  assert.equal(bundle.maskGrid.pattern, 'rule')
  assert.equal(bundle.maskGrid.arrangement.mode, 'rule_based_dual_grid_v0')
  assert.equal(bundle.maskGrid.arrangement.seed, 12)
  assert.equal(bundle.map.arrangement.mode, 'rule_based_dual_grid_v0')
  assert.equal(bundle.metrics.arrangement_mode, 'rule_based_dual_grid_v0')
  assert.equal(bundle.metrics.unique_mask_count > 1, true)
})
