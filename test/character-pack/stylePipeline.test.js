import test from 'node:test'
import assert from 'node:assert/strict'

import {
  applyPixelFinishing,
  applyPixelStyleCorrection,
  downsampleNearest,
  extractPalette,
  measureStyleDrift,
  snapToPalette,
  strengthenAlphaOutline,
  strengthenInnerAlphaOutline,
} from '../../src/character-pack/stylePipeline.js'

function makeImage(width, height, pixels) {
  const data = new Uint8ClampedArray(width * height * 4)
  pixels.forEach((rgba, index) => {
    const offset = index * 4
    data[offset] = rgba[0]
    data[offset + 1] = rgba[1]
    data[offset + 2] = rgba[2]
    data[offset + 3] = rgba[3] ?? 255
  })
  return { width, height, data }
}

test('extractPalette returns deterministic visible colors with counts and ratios', () => {
  const image = makeImage(4, 1, [
    [10, 20, 30, 255],
    [10, 20, 30, 255],
    [200, 40, 20, 255],
    [5, 5, 5, 0],
  ])

  const palette = extractPalette(image, { maxColors: 2 })

  assert.deepEqual(palette, [
    { hex: '#0a141e', rgb: [10, 20, 30], count: 2, ratio: 0.6667 },
    { hex: '#c82814', rgb: [200, 40, 20], count: 1, ratio: 0.3333 },
  ])
})

test('extractPalette median-cuts noisy colors into bounded representative colors', () => {
  const image = makeImage(6, 1, [
    [8, 12, 20, 255],
    [10, 13, 21, 255],
    [12, 15, 22, 255],
    [210, 80, 30, 255],
    [214, 82, 35, 255],
    [218, 84, 40, 255],
  ])

  const palette = extractPalette(image, { maxColors: 2 })

  assert.equal(palette.length, 2)
  assert.deepEqual(palette.map((color) => color.count), [3, 3])
  assert.deepEqual(palette.map((color) => color.rgb), [
    [10, 13, 21],
    [214, 82, 35],
  ])
})

test('extractPalette handles large unique-color images without stack overflow', () => {
  const width = 280
  const height = 260
  const data = new Uint8ClampedArray(width * height * 4)
  for (let index = 0; index < width * height; index++) {
    const offset = index * 4
    data[offset] = index % 256
    data[offset + 1] = Math.floor(index / 256) % 256
    data[offset + 2] = Math.floor(index / (256 * 256)) % 256
    data[offset + 3] = 255
  }
  const palette = extractPalette({ width, height, data }, { maxColors: 8 })

  assert.equal(palette.length, 8)
  assert.equal(palette.reduce((sum, color) => sum + color.count, 0), width * height)
})

test('snapToPalette maps visible pixels to nearest palette colors and preserves alpha', () => {
  const image = makeImage(3, 1, [
    [12, 18, 28, 255],
    [210, 50, 22, 128],
    [1, 1, 1, 0],
  ])
  const result = snapToPalette(image, {
    palette: [
      { rgb: [10, 20, 30] },
      { rgb: [220, 40, 20] },
    ],
  })

  assert.deepEqual([...result.data], [
    10, 20, 30, 255,
    220, 40, 20, 128,
    1, 1, 1, 0,
  ])
})

test('downsampleNearest requires an integer factor and samples the top-left source pixel', () => {
  const image = makeImage(4, 4, Array.from({ length: 16 }, (_, index) => [index, index + 1, index + 2, 255]))

  const result = downsampleNearest(image, { factor: 2 })

  assert.deepEqual({ width: result.width, height: result.height }, { width: 2, height: 2 })
  assert.deepEqual([...result.data], [
    0, 1, 2, 255,
    2, 3, 4, 255,
    8, 9, 10, 255,
    10, 11, 12, 255,
  ])
  assert.throws(() => downsampleNearest(image, { factor: 1.5 }), /integer factor/i)
})

test('measureStyleDrift reports palette distance without mutating pixels', () => {
  const image = makeImage(4, 1, [
    [10, 20, 30, 255],
    [11, 20, 30, 255],
    [220, 40, 20, 255],
    [1, 1, 1, 0],
  ])

  const report = measureStyleDrift(image, {
    palette: [
      { rgb: [10, 20, 30] },
      { rgb: [220, 40, 20] },
    ],
  })

  assert.equal(report.mode, 'report_only')
  assert.equal(report.visible_pixel_count, 3)
  assert.equal(report.unique_color_count, 3)
  assert.equal(report.palette_color_count, 2)
  assert.equal(report.off_palette_pixel_count, 1)
  assert.equal(report.off_palette_ratio, 0.3333)
  assert.equal(report.average_nearest_palette_distance, 0.3333)
  assert.equal(report.max_nearest_palette_distance, 1)
  assert.deepEqual([...image.data.slice(0, 4)], [10, 20, 30, 255])
})

test('applyPixelStyleCorrection palette-snaps with explicit mutation evidence', () => {
  const image = makeImage(4, 1, [
    [12, 18, 28, 255],
    [210, 50, 22, 255],
    [1, 1, 1, 0],
    [12, 18, 28, 255],
  ])

  const result = applyPixelStyleCorrection(image, {
    mode: 'palette_snap',
    palette: [
      { rgb: [10, 20, 30] },
      { rgb: [220, 40, 20] },
    ],
  })

  assert.equal(result.report.mode, 'palette_snap')
  assert.equal(result.report.output_mutation, 'palette_snap')
  assert.equal(result.report.palette.source, 'provided')
  assert.equal(result.report.palette.colors.length, 2)
  assert.equal(result.report.metrics.before.off_palette_ratio, 1)
  assert.equal(result.report.metrics.after.off_palette_ratio, 0)
  assert.equal(result.report.changed_pixel_count, 3)
  assert.equal(result.report.changed_pixel_ratio, 0.75)
  assert.deepEqual([...result.image.data], [
    10, 20, 30, 255,
    220, 40, 20, 255,
    1, 1, 1, 0,
    10, 20, 30, 255,
  ])
  assert.deepEqual([...image.data.slice(0, 4)], [12, 18, 28, 255])
})

test('strengthenAlphaOutline adds a one-pixel outline around visible alpha', () => {
  const image = makeImage(3, 3, [
    [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0],
    [0, 0, 0, 0], [200, 40, 60, 255], [0, 0, 0, 0],
    [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0],
  ])

  const result = strengthenAlphaOutline(image, { color: [10, 20, 30] })

  assert.equal(result.report.outline_pixel_count, 4)
  assert.deepEqual([...result.image.data.slice((0 * 3 + 1) * 4, (0 * 3 + 1) * 4 + 4)], [10, 20, 30, 255])
  assert.deepEqual([...result.image.data.slice((1 * 3 + 1) * 4, (1 * 3 + 1) * 4 + 4)], [200, 40, 60, 255])
})

test('strengthenInnerAlphaOutline recolors visible edge pixels without expanding alpha', () => {
  const image = makeImage(3, 3, [
    [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0],
    [0, 0, 0, 0], [200, 40, 60, 255], [0, 0, 0, 0],
    [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0],
  ])

  const result = strengthenInnerAlphaOutline(image, { color: [10, 20, 30] })

  assert.equal(result.report.outline_pixel_count, 1)
  assert.deepEqual([...result.image.data.slice((1 * 3 + 1) * 4, (1 * 3 + 1) * 4 + 4)], [10, 20, 30, 255])
  assert.equal([...result.image.data].filter((_, index) => index % 4 === 3 && result.image.data[index] > 0).length, 1)
})

test('applyPixelFinishing snaps palette, removes weak alpha and small islands, and reports outline metrics', () => {
  const image = makeImage(5, 3, [
    [0, 0, 0, 0], [12, 18, 28, 255], [13, 19, 29, 255], [0, 0, 0, 0], [250, 250, 250, 12],
    [0, 0, 0, 0], [210, 50, 22, 255], [212, 51, 24, 255], [0, 0, 0, 0], [80, 80, 80, 255],
    [0, 0, 0, 0], [12, 18, 28, 255], [13, 19, 29, 255], [0, 0, 0, 0], [0, 0, 0, 0],
  ])

  const result = applyPixelFinishing(image, {
    maxColors: 2,
    cleanupMinAlpha: 18,
    componentCleanup: true,
    componentCleanupMinArea: 2,
    outline: true,
    outlineMode: 'both',
    outlineColor: [4, 5, 6],
    cellSize: { w: 96, h: 96 },
  })

  assert.equal(result.report.mode, 'pixel_finishing_v1')
  assert.equal(result.report.palette.colors.length, 2)
  assert.equal(result.report.alpha_cleanup.cleanup_min_alpha, 18)
  assert.equal(result.report.alpha_cleanup.removed_pixel_count, 1)
  assert.equal(result.report.halo_residue.after.near_white_edge_pixels, 0)
  assert.equal(result.report.component_cleanup.removed_components, 1)
  assert.equal(result.report.outline.enabled, true)
  assert.equal(result.report.outline.mode, 'both')
  assert.equal(result.report.grid.cell_size.w, 96)
  assert.ok(result.report.changed_pixel_count > 0)
  const lowAlphaOffset = (0 * 5 + 4) * 4
  assert.equal(result.image.data[lowAlphaOffset + 3], 0)
})
