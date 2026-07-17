import test from 'node:test'
import assert from 'node:assert/strict'

import { buildTileMap } from '../../src/scene-pack/tileArrangement.js'
import {
  evaluateSceneTileQualityGate,
  measureSharedEdgeDelta,
} from '../../src/scene-pack/tileQualityGate.js'

function setPixel(image, x, y, rgba) {
  const offset = (y * image.width + x) * 4
  image.data[offset] = rgba[0]
  image.data[offset + 1] = rgba[1]
  image.data[offset + 2] = rgba[2]
  image.data[offset + 3] = rgba[3] ?? 255
}

function makeTile({ fill = [20, 40, 60, 255], edges = {} } = {}) {
  const width = 4
  const height = 4
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const edge =
        y === 0 ? edges.north :
          y === height - 1 ? edges.south :
            x === 0 ? edges.west :
              x === width - 1 ? edges.east :
                null
      const rgba = edge ?? fill
      const offset = (y * width + x) * 4
      data[offset] = rgba[0]
      data[offset + 1] = rgba[1]
      data[offset + 2] = rgba[2]
      data[offset + 3] = rgba[3] ?? 255
    }
  }
  return { width, height, data }
}

function makeContinuousSourceSheet() {
  const image = {
    width: 192,
    height: 192,
    data: new Uint8ClampedArray(192 * 192 * 4),
  }
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      setPixel(image, x, y, [
        40 + Math.floor(x / 8),
        80 + Math.floor(y / 8),
        110 + ((x + y) % 11),
        255,
      ])
    }
  }
  return image
}

test('measureSharedEdgeDelta compares touching tile borders in both directions', () => {
  const red = [200, 20, 20, 255]
  const blue = [20, 20, 200, 255]
  const left = makeTile({ edges: { east: red, west: blue } })
  const right = makeTile({ edges: { west: red, east: red } })

  assert.equal(measureSharedEdgeDelta(left, right, 'east').average_delta, 0)
  assert.equal(measureSharedEdgeDelta(left, right, 'west').average_delta, 180)
})

test('evaluateSceneTileQualityGate passes matching map seams and self loops', () => {
  const edge = [80, 120, 60, 255]
  const tile = makeTile({
    fill: edge,
    edges: { north: edge, east: edge, south: edge, west: edge },
  })
  const map = buildTileMap({ width: 2, height: 1, masks: [15, 15] })

  const report = evaluateSceneTileQualityGate({
    map,
    tiles: { 15: tile },
    palette: [{ rgb: edge.slice(0, 3) }],
  })

  assert.equal(report.status, 'pass')
  assert.equal(report.schema_version, 1)
  assert.equal(report.profile, 'topdown_tile_dual_grid_v0')
  assert.deepEqual(report.blocking_errors, [])
  assert.deepEqual(report.gates.map((gate) => [gate.id, gate.status]), [
    ['metadata_seams', 'pass'],
    ['visual_seams', 'pass'],
    ['tile_self_loops', 'pass'],
    ['tile_distinctness', 'pass'],
    ['style_drift', 'pass'],
  ])
  assert.equal(report.gates.find((gate) => gate.id === 'visual_seams').observed.max_edge_delta, 0)
  assert.equal(report.gates.find((gate) => gate.id === 'tile_self_loops').observed.max_edge_delta, 0)
  assert.equal(report.gates.find((gate) => gate.id === 'style_drift').observed.max_off_palette_ratio, 0)
})

test('evaluateSceneTileQualityGate separates metadata seam and visual seam failures', () => {
  const red = [200, 20, 20, 255]
  const blue = [20, 20, 200, 255]
  const left = makeTile({ fill: red, edges: { east: red, west: blue, north: red, south: blue } })
  const right = makeTile({ fill: blue, edges: { west: blue, east: red, north: blue, south: red } })
  const map = buildTileMap({ width: 2, height: 1, masks: [6, 1] })

  const report = evaluateSceneTileQualityGate({
    map,
    tiles: { 6: left, 1: right },
    thresholds: { maxSeamDelta: 12, maxSelfLoopDelta: 12 },
  })

  assert.equal(report.status, 'fail')
  assert.deepEqual(report.blocking_errors, ['tile.metadata_seam_mismatch', 'tile.visual_seam_mismatch', 'tile.self_loop_mismatch'])
  assert.equal(report.gates.find((gate) => gate.id === 'metadata_seams').observed.edge_mismatch_count, 1)
  assert.equal(report.gates.find((gate) => gate.id === 'visual_seams').observed.failed_pair_count, 1)
  assert.deepEqual(report.failure_taxonomy, [
    { category: 'tile.self_loop_mismatch', count: 4, examples: ['mask_1 horizontal', 'mask_1 vertical', 'mask_6 horizontal'] },
    { category: 'tile.metadata_seam_mismatch', count: 1, examples: ['0,0 east -> 1,0'] },
    { category: 'tile.visual_seam_mismatch', count: 1, examples: ['0,0 east -> 1,0'] },
  ])
  assert.equal(report.gates.find((gate) => gate.id === 'visual_seams').details.failed_pairs[0].average_delta, 180)
})

test('evaluateSceneTileQualityGate warns when tile colors drift from the shared palette', () => {
  const paletteColor = [10, 10, 10]
  const offPalette = [120, 20, 20, 255]
  const tile = makeTile({ fill: offPalette })
  const before = [...tile.data]

  const report = evaluateSceneTileQualityGate({
    tiles: { 0: tile },
    palette: [{ rgb: paletteColor }],
    thresholds: { maxOffPaletteRatio: 0.25 },
  })

  assert.equal(report.status, 'warning')
  assert.deepEqual(report.blocking_errors, [])
  assert.deepEqual(report.warnings, ['tile.style_drift'])
  assert.equal(report.gates.find((gate) => gate.id === 'style_drift').status, 'warning')
  assert.equal(report.gates.find((gate) => gate.id === 'style_drift').observed.max_off_palette_ratio, 1)
  assert.equal(report.gates.find((gate) => gate.id === 'style_drift').details.output_mutation, 'none')
  assert.deepEqual([...tile.data], before)
})

test('evaluateSceneTileQualityGate marks style drift not_run without image palette inputs', () => {
  const tile = makeTile()
  const report = evaluateSceneTileQualityGate({
    tiles: { 0: tile },
  })

  assert.equal(report.status, 'pass')
  assert.equal(report.gates.find((gate) => gate.id === 'style_drift').status, 'not_run')
  assert.deepEqual(report.gates.find((gate) => gate.id === 'style_drift').observed, {})
})

test('evaluateSceneTileQualityGate warns when the source atlas reads as one continuous scene', () => {
  const report = evaluateSceneTileQualityGate({
    tiles: { 0: makeTile() },
    source: makeContinuousSourceSheet(),
  })

  assert.equal(report.status, 'warning')
  assert.equal(report.gate_policy.raw_tile_quality, 'warn')
  assert.deepEqual(report.blocking_errors, [])
  assert.deepEqual(report.warnings, ['tile.source_atlas_continuity'])
  const gate = report.gates.find((item) => item.id === 'source_atlas_structure')
  assert.equal(gate.status, 'warning')
  assert.equal(gate.observed.checked_boundary_count, 24)
  assert.ok(gate.observed.continuous_boundary_count > 0)
  assert.ok(gate.details.continuous_boundaries[0].distinct_color_count >= 4)
  assert.deepEqual(report.failure_taxonomy, [
    { category: 'tile.source_atlas_continuity', count: gate.observed.continuous_boundary_count, examples: gate.details.continuous_boundaries.slice(0, 3).map((item) => item.id) },
  ])
})

test('evaluateSceneTileQualityGate can enforce raw tile structure warnings as strict failures', () => {
  const report = evaluateSceneTileQualityGate({
    tiles: { 0: makeTile() },
    source: makeContinuousSourceSheet(),
    gatePolicy: { raw_tile_quality: 'strict' },
  })

  assert.equal(report.status, 'fail')
  assert.equal(report.gate_policy.raw_tile_quality, 'strict')
  assert.deepEqual(report.blocking_errors, ['tile.source_atlas_continuity'])
  assert.deepEqual(report.warnings, [])
  assert.equal(report.gates.find((item) => item.id === 'source_atlas_structure').status, 'fail')
})

test('evaluateSceneTileQualityGate warns when referenced runtime masks are duplicate tiles', () => {
  const tile = makeTile({ fill: [80, 120, 60, 255] })
  const map = buildTileMap({ width: 2, height: 1, masks: [6, 15] })

  const report = evaluateSceneTileQualityGate({
    map,
    tiles: { 15: tile, 6: tile },
  })

  assert.equal(report.status, 'warning')
  assert.deepEqual(report.blocking_errors, [])
  assert.deepEqual(report.warnings, ['tile.duplicate_runtime_tile'])
  const gate = report.gates.find((item) => item.id === 'tile_distinctness')
  assert.equal(gate.status, 'warning')
  assert.equal(gate.observed.checked_tile_count, 2)
  assert.equal(gate.observed.duplicate_pair_count, 1)
  assert.deepEqual(gate.details.duplicate_pairs, [
    { a: 'mask_6', b: 'mask_15', average_delta: 0, max_delta: 0 },
  ])
  assert.deepEqual(report.failure_taxonomy, [
    { category: 'tile.duplicate_runtime_tile', count: 1, examples: ['mask_6 ~= mask_15'] },
  ])
})

test('evaluateSceneTileQualityGate can enforce duplicate runtime tile warnings as strict failures', () => {
  const tile = makeTile({ fill: [80, 120, 60, 255] })
  const map = buildTileMap({ width: 2, height: 1, masks: [6, 15] })

  const report = evaluateSceneTileQualityGate({
    map,
    tiles: { 15: tile, 6: tile },
    rawTilePolicy: 'strict',
  })

  assert.equal(report.status, 'fail')
  assert.equal(report.gate_policy.raw_tile_quality, 'strict')
  assert.deepEqual(report.blocking_errors, ['tile.duplicate_runtime_tile'])
  assert.deepEqual(report.warnings, [])
  assert.equal(report.gates.find((item) => item.id === 'tile_distinctness').status, 'fail')
})
