import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildLdtkProjectJson,
  validateLdtkProjectJson,
} from '../../src/scene-pack/ldtkProjectExport.js'
import { buildTileMap } from '../../src/scene-pack/tileArrangement.js'

test('buildLdtkProjectJson exports a complete project with tiles and entity fields', () => {
  const map = buildTileMap({
    width: 2,
    height: 1,
    masks: [0b0110, 0b1001],
  })

  const project = buildLdtkProjectJson({
    projectId: 'demo_project',
    identifier: 'meadow_scene',
    map,
    tilesetRelPath: 'scene/tileset.png',
    entityDefs: [
      {
        identifier: 'SpawnPoint',
        color: '#ffcc00',
        width: 32,
        height: 32,
        fields: [
          { identifier: 'Kind', type: 'String', defaultValue: 'hero' },
        ],
      },
    ],
  })

  assert.equal(project.jsonVersion, '1.5.3')
  assert.equal(project.externalLevels, false)
  assert.equal(project.defaultGridSize, 32)
  assert.equal(project.identifierStyle, 'Capitalize')
  assert.equal(project.levels[0].identifier, 'meadow_scene')
  assert.equal(project.levels[0].pxWid, 64)
  assert.equal(project.levels[0].pxHei, 32)
  assert.equal(project.defs.tilesets[0].identifier, 'topdown_tile_dual_grid_v0_tileset')
  assert.equal(project.defs.tilesets[0].relPath, 'scene/tileset.png')
  assert.equal(project.defs.tilesets[0].tileGridSize, 32)
  assert.equal(project.defs.tilesets[0].padding, 8)
  assert.equal(project.defs.tilesets[0].spacing, 16)

  const tilesLayerDef = project.defs.layers.find((layer) => layer.identifier === 'Tiles')
  const entityLayerDef = project.defs.layers.find((layer) => layer.identifier === 'Entities')
  assert.equal(tilesLayerDef.type, 'Tiles')
  assert.equal(tilesLayerDef.tilesetDefUid, project.defs.tilesets[0].uid)
  assert.equal(entityLayerDef.type, 'Entities')

  const tilesLayer = project.levels[0].layerInstances.find((layer) => layer.__identifier === 'Tiles')
  assert.deepEqual(tilesLayer.gridTiles, [
    { px: [0, 0], src: [104, 56], t: 6, f: 0, a: 1, d: [0, 0, 0] },
    { px: [32, 0], src: [56, 104], t: 9, f: 0, a: 1, d: [1, 0, 1] },
  ])

  assert.deepEqual(project.defs.entities[0].fieldDefs.map((field) => ({
    identifier: field.identifier,
    type: field.type,
    defaultOverride: field.defaultOverride,
  })), [
    { identifier: 'Kind', type: 'String', defaultOverride: 'hero' },
  ])

  assert.deepEqual(validateLdtkProjectJson(project), {
    status: 'pass',
    blocking_errors: [],
    metrics: {
      level_count: 1,
      layer_count: 2,
      tileset_count: 1,
      entity_def_count: 1,
      grid_tile_count: 2,
    },
  })
})

test('buildLdtkProjectJson rejects tile maps with invalid shared edges', () => {
  const map = buildTileMap({
    width: 2,
    height: 1,
    masks: [0b0110, 0b0001],
  })

  assert.throws(() => buildLdtkProjectJson({ map }), /tile_edge_mismatch/)
})

test('validateLdtkProjectJson reports missing project sections and tile counts', () => {
  const invalid = validateLdtkProjectJson({
    jsonVersion: '1.5.3',
    defs: { tilesets: [], layers: [], entities: [] },
    levels: [
      {
        layerInstances: [
          { __identifier: 'Tiles', gridTiles: [{ t: 1 }] },
        ],
      },
    ],
  })

  assert.equal(invalid.status, 'fail')
  assert.deepEqual(invalid.blocking_errors, [
    'missing_iid',
    'missing_required_root_fields',
    'missing_tileset_def',
    'missing_tiles_layer_def',
    'missing_entities_layer_def',
    'missing_level_identifier',
    'missing_level_size',
    'grid_tile_shape_invalid',
  ])
  assert.equal(invalid.metrics.grid_tile_count, 1)
})
