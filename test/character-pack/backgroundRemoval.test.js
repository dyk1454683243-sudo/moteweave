import test from 'node:test'
import assert from 'node:assert/strict'

import {
  cleanupAlphaArtifactsFromRgba,
  cleanupEdgeMatteResidueFromRgba,
  cleanupSmallAlphaComponentsFromRgba,
  decontaminateEdgeColorsFromRgba,
  floodRemoveBackgroundFromRgba,
  dualMatteFromRgba,
  edgePaletteRemoveBackgroundFromRgba,
  passthroughRgba,
} from '../../src/character-pack/backgroundRemoval.js'

function rgba(width, height, pixels) {
  return { width, height, data: Uint8ClampedArray.from(pixels.flat(2)) }
}

test('passthrough preserves transparent source alpha', () => {
  const src = rgba(1, 2, [[1, 2, 3, 0], [4, 5, 6, 255]])
  const out = passthroughRgba(src)
  assert.deepEqual([...out.data], [...src.data])
})

test('flood removal removes edge white but preserves internal white', () => {
  const src = rgba(5, 5, [
    [255, 255, 255, 255], [255, 255, 255, 255], [255, 255, 255, 255], [255, 255, 255, 255], [255, 255, 255, 255],
    [255, 255, 255, 255], [10, 10, 10, 255], [10, 10, 10, 255], [10, 10, 10, 255], [255, 255, 255, 255],
    [255, 255, 255, 255], [10, 10, 10, 255], [255, 255, 255, 255], [10, 10, 10, 255], [255, 255, 255, 255],
    [255, 255, 255, 255], [10, 10, 10, 255], [10, 10, 10, 255], [10, 10, 10, 255], [255, 255, 255, 255],
    [255, 255, 255, 255], [255, 255, 255, 255], [255, 255, 255, 255], [255, 255, 255, 255], [255, 255, 255, 255],
  ])
  const out = floodRemoveBackgroundFromRgba(src, { color: [255, 255, 255], tolerance: 0 })
  assert.equal(out.data[3], 0)
  assert.equal(out.data[(2 * 5 + 2) * 4 + 3], 255)
})

test('edge palette removal clears fake transparent checkerboard without deleting enclosed light pixels', () => {
  const light = [253, 253, 253, 255]
  const dark = [200, 205, 211, 255]
  const ink = [10, 10, 20, 255]
  const checker = (x, y) => ((x + y) % 2 === 0 ? light : dark)
  const pixels = Array.from({ length: 5 }, (_, y) =>
    Array.from({ length: 5 }, (_, x) => {
      if (x >= 1 && x <= 3 && y >= 1 && y <= 3) return ink
      return checker(x, y)
    })
  )
  pixels[2][2] = light

  const out = edgePaletteRemoveBackgroundFromRgba(rgba(5, 5, pixels), { tolerance: 8 })

  assert.equal(out.data[3], 0)
  assert.deepEqual([...out.data.slice(0, 3)], [0, 0, 0])
  assert.equal(out.data[(0 * 5 + 1) * 4 + 3], 0)
  assert.equal(out.data[(2 * 5 + 2) * 4 + 3], 255)
})

test('edge palette removal clears edge-connected neutral checkerboard variants outside the dominant colors', () => {
  const light = [253, 253, 253, 255]
  const dark = [200, 205, 211, 255]
  const rareLitBackground = [232, 233, 236, 255]
  const pixels = Array.from({ length: 7 }, (_, y) =>
    Array.from({ length: 7 }, (_, x) => ((x + y) % 2 === 0 ? light : dark))
  )
  pixels[3][3] = rareLitBackground

  const out = edgePaletteRemoveBackgroundFromRgba(rgba(7, 7, pixels), { tolerance: 8, maxColors: 2 })

  assert.equal(out.data[(3 * 7 + 3) * 4 + 3], 0)
  assert.deepEqual([...out.data.slice((3 * 7 + 3) * 4, (3 * 7 + 3) * 4 + 3)], [0, 0, 0])
})

test('edge matte residue cleanup clears near-background fringe while preserving enclosed light pixels', () => {
  const pixels = Array.from({ length: 7 }, () => Array.from({ length: 7 }, () => [0, 0, 0, 0]))
  for (let y = 2; y <= 4; y++) {
    for (let x = 2; x <= 4; x++) pixels[y][x] = [20, 60, 120, 255]
  }
  pixels[1][3] = [236, 238, 241, 255]
  pixels[3][3] = [236, 238, 241, 255]

  const out = cleanupEdgeMatteResidueFromRgba(rgba(7, 7, pixels), {
    colors: [[238, 239, 240]],
    tolerance: 8,
    residueTolerance: 16,
  })

  assert.equal(out.data[(1 * 7 + 3) * 4 + 3], 0)
  assert.equal(out.data[(3 * 7 + 3) * 4 + 3], 255)
})

test('edge matte residue cleanup can skip colors already covered by flood tolerance', () => {
  const pixels = Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => [0, 0, 0, 0]))
  for (let y = 1; y <= 3; y++) {
    for (let x = 1; x <= 3; x++) pixels[y][x] = [20, 60, 120, 255]
  }
  pixels[1][2] = [250, 250, 250, 255]
  pixels[2][1] = [236, 238, 241, 255]

  const out = cleanupEdgeMatteResidueFromRgba(rgba(5, 5, pixels), {
    colors: [[255, 255, 255]],
    tolerance: 18,
    minDistance: 18,
    residueTolerance: 40,
  })

  assert.equal(out.data[(1 * 5 + 2) * 4 + 3], 255)
  assert.equal(out.data[(2 * 5 + 1) * 4 + 3], 0)
})

test('edge color decontamination pulls matte-tinted edge pixels toward foreground neighbors', () => {
  const pixels = Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => [0, 0, 0, 0]))
  for (let y = 1; y <= 3; y++) {
    for (let x = 2; x <= 3; x++) pixels[y][x] = [30, 70, 130, 255]
  }
  pixels[2][1] = [205, 216, 232, 255]

  const out = decontaminateEdgeColorsFromRgba(rgba(5, 5, pixels), {
    colors: [[238, 239, 240]],
    tolerance: 8,
    maxBackgroundDistance: 80,
    strength: 0.6,
  })

  const offset = (2 * 5 + 1) * 4
  assert.equal(out.data[offset + 3], 255)
  assert.ok(out.data[offset] < 120)
  assert.ok(out.data[offset + 1] < 140)
  assert.ok(out.data[offset + 2] < 180)
})

test('alpha cleanup removes faint neutral matte crumbs without deleting the sprite', () => {
  const pixels = Array.from({ length: 6 }, () => Array.from({ length: 6 }, () => [0, 0, 0, 0]))
  for (let y = 2; y <= 4; y++) {
    for (let x = 2; x <= 4; x++) pixels[y][x] = [24, 72, 96, 255]
  }
  pixels[0][0] = [255, 255, 255, 12]
  pixels[1][1] = [247, 247, 247, 64]

  const out = cleanupAlphaArtifactsFromRgba(rgba(6, 6, pixels), { minAlpha: 18 })

  assert.equal(out.data[3], 0)
  assert.equal(out.data[(1 * 6 + 1) * 4 + 3], 0)
  assert.equal(out.data[(3 * 6 + 3) * 4 + 3], 255)
})

test('component cleanup removes isolated crumbs but keeps meaningful detached parts', () => {
  const pixels = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => [0, 0, 0, 0]))
  for (let y = 2; y <= 5; y++) {
    for (let x = 2; x <= 4; x++) pixels[y][x] = [24, 72, 96, 255]
  }
  for (let y = 1; y <= 2; y++) {
    for (let x = 6; x <= 7; x++) pixels[y][x] = [180, 110, 40, 255]
  }
  pixels[0][0] = [255, 255, 255, 255]
  pixels[7][7] = [0, 0, 0, 255]

  const result = cleanupSmallAlphaComponentsFromRgba(rgba(8, 8, pixels), { minArea: 3 })

  assert.equal(result.stats.removed_components, 2)
  assert.equal(result.stats.removed_pixels, 2)
  assert.equal(result.image.data[3], 0)
  assert.equal(result.image.data[(7 * 8 + 7) * 4 + 3], 0)
  assert.equal(result.image.data[(2 * 8 + 2) * 4 + 3], 255)
  assert.equal(result.image.data[(1 * 8 + 6) * 4 + 3], 255)
})

test('dual matte computes alpha and flags inconsistent paired images', () => {
  const white = rgba(1, 1, [[255, 128, 128, 255]])
  const black = rgba(1, 1, [[128, 0, 0, 255]])
  const out = dualMatteFromRgba(white, black, { consistencyTolerance: 255 })
  assert.equal(out.warnings.length, 0)
  assert.ok(out.image.data[3] > 120)

  const bad = dualMatteFromRgba(white, rgba(1, 1, [[10, 200, 10, 255]]), { consistencyTolerance: 10 })
  assert.deepEqual(bad.warnings, ['dual_matte_inconsistent'])
})
