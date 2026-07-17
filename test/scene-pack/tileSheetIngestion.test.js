import test from 'node:test'
import assert from 'node:assert/strict'

import { getTileSourceRegion } from '../../src/scene-pack/tileProfile.js'
import {
  buildScenePackFromTileSheet,
  extractTileSheetTiles,
  validateTileSheetImage,
} from '../../src/scene-pack/tileSheetIngestion.js'

function setPixel(image, x, y, rgba) {
  const offset = (y * image.width + x) * 4
  image.data[offset] = rgba[0]
  image.data[offset + 1] = rgba[1]
  image.data[offset + 2] = rgba[2]
  image.data[offset + 3] = rgba[3] ?? 255
}

function fillRect(image, rect, rgba) {
  for (let y = rect.y; y < rect.y + rect.h; y += 1) {
    for (let x = rect.x; x < rect.x + rect.w; x += 1) setPixel(image, x, y, rgba)
  }
}

function makeSheet({ colorForMask = () => [80, 120, 60, 255] } = {}) {
  const image = {
    width: 192,
    height: 192,
    data: new Uint8ClampedArray(192 * 192 * 4),
  }
  for (let mask = 0; mask < 16; mask += 1) {
    const region = getTileSourceRegion(mask)
    fillRect(image, { x: region.col * 48, y: region.row * 48, w: 48, h: 48 }, [240, 40, 200, 255])
    fillRect(image, region, colorForMask(mask))
  }
  return image
}

test('validateTileSheetImage accepts the padded dual-grid source size', () => {
  const validation = validateTileSheetImage(makeSheet())

  assert.equal(validation.status, 'pass')
  assert.deepEqual(validation.blocking_errors, [])
  assert.deepEqual(validation.metrics, {
    width: 192,
    height: 192,
    expected_width: 192,
    expected_height: 192,
    tile_count: 16,
    source_cell_size: { w: 48, h: 48, padding: 8 },
    runtime_tile_size: { w: 32, h: 32 },
  })
})

test('extractTileSheetTiles slices the central 32x32 runtime tile for every mask', () => {
  const sheet = makeSheet({
    colorForMask: (mask) => [mask * 10, mask * 7, 200 - mask * 5, 255],
  })

  const result = extractTileSheetTiles(sheet)

  assert.equal(result.profile, 'topdown_tile_dual_grid_v0')
  assert.deepEqual(Object.keys(result.tiles), Array.from({ length: 16 }, (_, index) => String(index)))
  assert.equal(result.tiles[6].width, 32)
  assert.equal(result.tiles[6].height, 32)
  assert.deepEqual([...result.tiles[6].data.slice(0, 4)], [60, 42, 170, 255])
  assert.deepEqual([...result.tiles[6].data.slice((31 * 32 + 31) * 4, (31 * 32 + 31) * 4 + 4)], [60, 42, 170, 255])
  assert.notDeepEqual([...result.tiles[6].data.slice(0, 4)], [240, 40, 200, 255])
  assert.deepEqual(result.tileAtlasMetadata.tiles[6].source, { x: 104, y: 56, w: 32, h: 32 })
})

test('validateTileSheetImage rejects non-profile source sheets', () => {
  const invalid = {
    width: 191,
    height: 192,
    data: new Uint8ClampedArray(191 * 192 * 4),
  }

  const validation = validateTileSheetImage(invalid)

  assert.equal(validation.status, 'fail')
  assert.deepEqual(validation.blocking_errors, ['source_sheet_size_mismatch'])
  assert.throws(() => extractTileSheetTiles(invalid), /source_sheet_size_mismatch/)
})

test('buildScenePackFromTileSheet creates quality, scene, LDtk, and artifact payloads', () => {
  const source = makeSheet()
  const tilesetPng = Buffer.from('tileset png bytes')

  const result = buildScenePackFromTileSheet({
    source,
    tilesetPng,
    projectId: 'uploaded_scene_project',
    identifier: 'uploaded_scene',
    width: 2,
    height: 2,
    pattern: 'solid',
    tilesetRelPath: 'scene/tileset.png',
    palette: [{ rgb: [80, 120, 60] }],
  })

  assert.equal(result.status, 'pass')
  assert.equal(result.map, result.tileMap)
  assert.equal(result.tileMap.width, 2)
  assert.equal(result.tileMap.height, 2)
  assert.equal(result.sceneJson.identifier, 'uploaded_scene')
  assert.equal(result.ldtkProjectJson.defs.tilesets[0].relPath, 'scene/tileset.png')
  assert.equal(result.qualityGate.status, 'pass')
  assert.equal(result.qualityGate.gates.find((gate) => gate.id === 'visual_seams').observed.checked_pair_count, 4)
  assert.equal(result.files.tilesetPng, tilesetPng)
})

test('buildScenePackFromTileSheet can use rule-based arrangement metadata', () => {
  const result = buildScenePackFromTileSheet({
    source: makeSheet(),
    identifier: 'rule_scene',
    width: 5,
    height: 4,
    pattern: 'rule',
    seed: 12,
    density: 0.45,
  })

  assert.equal(result.status, 'warning')
  assert.deepEqual(result.qualityGate.warnings, ['tile.duplicate_runtime_tile'])
  assert.equal(result.tileMap.arrangement.mode, 'rule_based_dual_grid_v0')
  assert.equal(result.tileMap.arrangement.seed, 12)
  assert.equal(result.metrics.arrangement_mode, 'rule_based_dual_grid_v0')
  assert.equal(result.sceneJson.identifier, 'rule_scene')
})

test('buildScenePackFromTileSheet can enforce raw tile policy for release gates', () => {
  const result = buildScenePackFromTileSheet({
    source: makeSheet(),
    identifier: 'strict_rule_scene',
    width: 5,
    height: 4,
    pattern: 'rule',
    seed: 12,
    density: 0.45,
    gatePolicy: { raw_tile_quality: 'strict' },
  })

  assert.equal(result.status, 'fail')
  assert.equal(result.qualityGate.gate_policy.raw_tile_quality, 'strict')
  assert.deepEqual(result.qualityGate.blocking_errors, ['tile.duplicate_runtime_tile'])
  assert.equal(result.qualityGate.gates.find((gate) => gate.id === 'tile_distinctness').status, 'fail')
})
