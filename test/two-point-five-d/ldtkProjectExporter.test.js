import test from 'node:test'
import assert from 'node:assert/strict'

import { buildTwoPointFiveDAtlasPlan } from '../../src/two-point-five-d/terrainAutotileBuilder.js'
import { buildTwoPointFiveDGuardedRuleMap } from '../../src/two-point-five-d/terrainRuleMapBuilder.js'
import {
  buildTwoPointFiveDLdtkAutoLayerRules,
  buildTwoPointFiveDLdtkProjectJson,
  validateTwoPointFiveDLdtkProjectJson,
  validateTwoPointFiveDLdtkWorkflowReadiness,
} from '../../src/two-point-five-d/ldtkProjectExporter.js'

test('2.5D LDtk auto-layer rules cover every corner mask', () => {
  const plan = buildTwoPointFiveDAtlasPlan()
  const rules = buildTwoPointFiveDLdtkAutoLayerRules({ plan })

  assert.equal(rules.mode, 'two_point_five_d_ldtk_auto_layer_rules_v1')
  assert.equal(rules.layer_identifier, 'TerrainMasks')
  assert.equal(rules.int_grid_values.length, 16)
  assert.equal(rules.int_grid_values.find((item) => item.tile.mask === 15).value, 16)
  assert.equal(rules.auto_rule_groups.length, 1)
  assert.equal(rules.auto_rule_groups[0].rules.length, 16)
  assert.deepEqual(rules.auto_rule_groups[0].rules.find((rule) => rule.metadata.mask === 15).tileIds, [51])
  assert.deepEqual(rules.auto_rule_groups[0].rules.find((rule) => rule.metadata.mask === 0).tileIds, [])
})

test('2.5D LDtk project export preserves logical grid, sprite cell metadata, and auto-layer rules', () => {
  const plan = buildTwoPointFiveDAtlasPlan()
  const map = buildTwoPointFiveDGuardedRuleMap({ plan, width: 4, height: 3, seed: 11, density: 0.5 })
  const project = buildTwoPointFiveDLdtkProjectJson({
    plan,
    map,
    projectId: 'two_point_five_d_test',
    identifier: 'terrain_rule_map',
    tilesetRelPath: 'strict_atlas.png',
  })
  const validation = validateTwoPointFiveDLdtkProjectJson(project)
  const workflowValidation = validateTwoPointFiveDLdtkWorkflowReadiness(project)

  assert.equal(project.twoPointFiveD.mode, 'two_point_five_d_ldtk_project_export_v1')
  assert.equal(project.twoPointFiveD.claim_boundary, 'Concrete single-level LDtk project export plus LDtk-style auto-layer rule authoring; no editor round-trip evaluation or full WFC solver is claimed.')
  assert.equal(project.twoPointFiveD.auto_layer_rules.rule_count, 16)
  assert.equal(project.defaultGridSize, 32)
  assert.ok(project.nextUid > 1015)
  assert.equal(project.defaultPivotX, 0.5)
  assert.equal(project.defaultPivotY, 1)
  assert.equal(project.levels[0].pxWid, 128)
  assert.equal(project.levels[0].pxHei, 96)
  assert.equal(project.defs.tilesets[0].tileGridSize, 64)
  assert.equal(project.defs.tilesets[0].__cWid, 16)
  assert.equal(project.defs.tilesets[0].__cHei, 16)
  assert.equal(project.defs.tilesets[0].customData.find((item) => item.tileId === 51).data.includes('"mask":15'), true)
  const terrainMaskLayerDef = project.defs.layers.find((layer) => layer.identifier === 'TerrainMasks')
  assert.equal(terrainMaskLayerDef.type, 'IntGrid')
  assert.equal(terrainMaskLayerDef.intGridValues.length, 16)
  assert.equal(terrainMaskLayerDef.autoRuleGroups[0].rules.length, 16)
  const tileLayer = project.levels[0].layerInstances.find((layer) => layer.__identifier === 'Tiles')
  const maskLayer = project.levels[0].layerInstances.find((layer) => layer.__identifier === 'TerrainMasks')
  assert.equal(tileLayer.__gridSize, 32)
  assert.equal(tileLayer.gridTiles.length, 12)
  assert.equal(maskLayer.__gridSize, 32)
  assert.equal(maskLayer.intGridCsv.length, 12)
  assert.deepEqual(tileLayer.gridTiles[0].d.slice(0, 3), [0, 0, 0])
  assert.equal(validation.status, 'pass')
  assert.equal(validation.metrics.grid_tile_count, 12)
  assert.equal(validation.metrics.terrain_mask_cell_count, 12)
  assert.equal(validation.metrics.auto_layer_rule_count, 16)
  assert.equal(validation.metrics.tileset_tile_grid_size, 64)
  assert.equal(validation.metrics.default_grid_size, 32)
  assert.equal(validation.metrics.has_two_point_five_d_metadata, true)
  assert.equal(workflowValidation.status, 'pass')
  assert.equal(workflowValidation.metrics.tileset_relpath, 'strict_atlas.png')
  assert.equal(workflowValidation.metrics.duplicate_uid_count, 0)
  assert.equal(workflowValidation.metrics.auto_rule_count, 16)
  assert.equal(workflowValidation.metrics.int_grid_cell_count, 12)
  assert.equal(workflowValidation.metrics.grid_tile_count, 12)
  assert.equal(workflowValidation.metrics.layer_order.includes('TerrainMasks'), true)
  assert.match(workflowValidation.claim_boundary, /Static LDtk import-readiness/)
})
