import test from 'node:test'
import assert from 'node:assert/strict'

import { buildTileMap } from '../../src/scene-pack/tileArrangement.js'
import { conditionTileEdges } from '../../src/scene-pack/tileEdgeConditioning.js'
import { evaluateSceneTileQualityGate, measureSharedEdgeDelta } from '../../src/scene-pack/tileQualityGate.js'

function setPixel(image, x, y, rgba) {
  const offset = (y * image.width + x) * 4
  image.data[offset] = rgba[0]
  image.data[offset + 1] = rgba[1]
  image.data[offset + 2] = rgba[2]
  image.data[offset + 3] = rgba[3] ?? 255
}

function getPixel(image, x, y) {
  const offset = (y * image.width + x) * 4
  return [...image.data.slice(offset, offset + 4)]
}

function makeTile({ fill, north, east, south, west }) {
  const image = {
    width: 32,
    height: 32,
    data: new Uint8ClampedArray(32 * 32 * 4),
  }
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      setPixel(image, x, y, fill)
    }
  }
  for (let x = 0; x < image.width; x += 1) {
    setPixel(image, x, 0, north)
    setPixel(image, x, image.height - 1, south)
  }
  for (let y = 0; y < image.height; y += 1) {
    setPixel(image, 0, y, west)
    setPixel(image, image.width - 1, y, east)
  }
  setPixel(image, 16, 16, fill)
  return image
}

test('conditionTileEdges makes runtime tile edges seam-safe without mutating tile centers', () => {
  const map = buildTileMap({ width: 2, height: 1, masks: [12, 8] })
  const rawTiles = {
    8: makeTile({
      fill: [70, 120, 58, 255],
      north: [20, 40, 80, 255],
      east: [220, 20, 20, 255],
      south: [20, 200, 80, 255],
      west: [10, 10, 180, 255],
    }),
    12: makeTile({
      fill: [86, 132, 64, 255],
      north: [200, 40, 60, 255],
      east: [240, 230, 40, 255],
      south: [50, 40, 200, 255],
      west: [30, 190, 210, 255],
    }),
  }
  const beforeCenter = getPixel(rawTiles[12], 16, 16)
  const beforeFirstPixel = getPixel(rawTiles[12], 31, 16)

  const rawReport = evaluateSceneTileQualityGate({
    map,
    tiles: rawTiles,
    thresholds: { maxVisualSeamDelta: 8, maxSelfLoopDelta: 8 },
  })
  assert.equal(rawReport.status, 'fail')
  assert.deepEqual(rawReport.blocking_errors, ['tile.visual_seam_mismatch', 'tile.self_loop_mismatch'])
  assert.ok(measureSharedEdgeDelta(rawTiles[12], rawTiles[8], 'east').average_delta > 8)

  const conditioned = conditionTileEdges(rawTiles, { mode: 'edge_conditioning_v0', band: 3 })
  const conditionedReport = evaluateSceneTileQualityGate({
    map,
    tiles: conditioned.tiles,
    thresholds: { maxVisualSeamDelta: 8, maxSelfLoopDelta: 8 },
  })

  assert.equal(conditionedReport.status, 'pass')
  assert.deepEqual(conditionedReport.blocking_errors, [])
  assert.deepEqual(getPixel(conditioned.tiles[12], 16, 16), beforeCenter)
  assert.deepEqual(getPixel(rawTiles[12], 16, 16), beforeCenter)
  assert.deepEqual(getPixel(rawTiles[12], 31, 16), beforeFirstPixel)
  assert.notDeepEqual(getPixel(conditioned.tiles[12], 31, 16), beforeFirstPixel)
  assert.equal(conditioned.report.enabled, true)
  assert.equal(conditioned.report.mode, 'edge_conditioning_v0')
  assert.equal(conditioned.report.band, 3)
  assert.equal(conditioned.report.tile_count, 2)
  assert.ok(conditioned.report.changed_pixel_count > 0)
  assert.ok(conditioned.report.changed_pixel_ratio > 0)
})

test('conditionTileEdges edge-aware v1 keeps structural seams passable with fewer changed pixels than v0', () => {
  const map = buildTileMap({ width: 3, height: 2, masks: [4, 12, 8, 6, 15, 9] })
  const rawTiles = Object.fromEntries(
    [4, 6, 8, 9, 12, 15].map((mask, index) => [mask, makeTile({
      fill: [60 + index * 8, 110 + index * 4, 54 + index * 3, 255],
      north: [220, 30 + index, 30, 255],
      east: [30, 210, 70 + index, 255],
      south: [40 + index, 50, 220, 255],
      west: [230, 210 - index, 50, 255],
    })])
  )

  const v0 = conditionTileEdges(rawTiles, { mode: 'edge_conditioning_v0', band: 3 })
  const v1 = conditionTileEdges(rawTiles, { mode: 'edge_aware_conditioning_v1', band: 3 })
  const v1Report = evaluateSceneTileQualityGate({
    map,
    tiles: v1.tiles,
    thresholds: { maxVisualSeamDelta: 8, maxSelfLoopDelta: 8 },
  })

  assert.equal(v1Report.status, 'pass')
  assert.equal(v1.report.mode, 'edge_aware_conditioning_v1')
  assert.equal(v1.report.requested_band, 3)
  assert.equal(v1.report.applied_edge_depth, 1)
  assert.ok(v1.report.changed_pixel_ratio < v0.report.changed_pixel_ratio)
  assert.ok(v1.report.changed_pixel_count < v0.report.changed_pixel_count)
  assert.ok(v1.report.edge_signature_groups.length > 0)
})

test('conditionTileEdges can be disabled for raw comparison runs', () => {
  const rawTiles = {
    0: makeTile({
      fill: [80, 120, 60, 255],
      north: [200, 40, 60, 255],
      east: [240, 230, 40, 255],
      south: [50, 40, 200, 255],
      west: [30, 190, 210, 255],
    }),
  }

  const conditioned = conditionTileEdges(rawTiles, { enabled: false })

  assert.equal(conditioned.report.enabled, false)
  assert.equal(conditioned.report.changed_pixel_count, 0)
  assert.deepEqual([...conditioned.tiles[0].data], [...rawTiles[0].data])
  assert.notEqual(conditioned.tiles[0].data, rawTiles[0].data)
})
