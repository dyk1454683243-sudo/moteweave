import test from 'node:test'
import assert from 'node:assert/strict'

import { conditionTileEdges } from '../../src/scene-pack/tileEdgeConditioning.js'
import {
  buildTileConditioningReview,
  renderTileConditioningContactSheet,
} from '../../src/scene-pack/tileConditioningReview.js'

function setPixel(image, x, y, rgba) {
  const offset = (y * image.width + x) * 4
  image.data[offset] = rgba[0]
  image.data[offset + 1] = rgba[1]
  image.data[offset + 2] = rgba[2]
  image.data[offset + 3] = rgba[3] ?? 255
}

function makeTile({ fill, edge }) {
  const image = {
    width: 32,
    height: 32,
    data: new Uint8ClampedArray(32 * 32 * 4),
  }
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const color = x === 0 || x === image.width - 1 || y === 0 || y === image.height - 1 ? edge : fill
      setPixel(image, x, y, color)
    }
  }
  return image
}

test('buildTileConditioningReview warns when structural pass still has visible mutation risk', () => {
  const rawTiles = {
    0: makeTile({ fill: [80, 120, 60, 255], edge: [220, 30, 30, 255] }),
    1: makeTile({ fill: [85, 125, 65, 255], edge: [30, 210, 80, 255] }),
  }
  const conditioned = conditionTileEdges(rawTiles, { mode: 'edge_aware_conditioning_v1', band: 3 })

  const review = buildTileConditioningReview({
    rawTiles,
    conditionedTiles: conditioned.tiles,
    edgeConditioning: conditioned.report,
    qualityGate: { status: 'pass' },
    thresholds: { maxChangedPixelRatio: 0.1 },
  })
  const contactSheet = renderTileConditioningContactSheet({
    rawTiles,
    conditionedTiles: conditioned.tiles,
    columns: 2,
  })

  assert.equal(review.schema_version, 1)
  assert.equal(review.mode, 'tile_conditioning_review_v0')
  assert.equal(review.status, 'warning')
  assert.deepEqual(review.warnings, ['tile.edge_conditioning_visible_mutation'])
  assert.equal(review.metrics.structural_status, 'pass')
  assert.equal(review.metrics.edge_conditioning_mode, 'edge_aware_conditioning_v1')
  assert.ok(review.metrics.changed_pixel_ratio >= 0.1)
  assert.equal(review.artifacts.contact_sheet, 'tile_conditioning_review.png')
  assert.equal(contactSheet.width, 136)
  assert.equal(contactSheet.height, 32)
  assert.notDeepEqual(
    [...contactSheet.data.slice((16 * contactSheet.width + 31) * 4, (16 * contactSheet.width + 31) * 4 + 4)],
    [...contactSheet.data.slice((16 * contactSheet.width + 104) * 4, (16 * contactSheet.width + 104) * 4 + 4)]
  )
})
