import test from 'node:test'
import assert from 'node:assert/strict'

import { encodeRgbaPng, loadRgba } from '../../src/character-pack/imageCodec.js'
import {
  buildSharedPalette,
  detectPixelGrid,
  detectPixelGridSequence,
  normalizePixelGridRefinementOptions,
  PIXEL_GRID_RECIPE_IDS,
  PIXEL_GRID_REFINEMENT_LIMITS,
  refinePixelFrame,
  refinePixelFrames,
  refinePixelFramesAsync,
} from '../../src/character-pack/pixelGridRefinement.js'
import { finishQualityCharacterImage } from '../../src/character-pack/textToImageGeneration.js'
import { createMotionSourceContract } from '../../src/motion-source/contract.js'
import { buildMotionStrip } from '../../src/motion-source/stripBuilder.js'

const PALETTE = [
  [28, 32, 46, 255],
  [70, 130, 210, 255],
  [210, 72, 54, 255],
  [238, 196, 78, 255],
  [88, 172, 102, 255],
]

function pixelOffset(width, x, y) {
  return (y * width + x) * 4
}

function blankImage(width, height) {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) }
}

function setPixel(image, x, y, color) {
  const offset = pixelOffset(image.width, x, y)
  image.data[offset] = color[0]
  image.data[offset + 1] = color[1]
  image.data[offset + 2] = color[2]
  image.data[offset + 3] = color[3] ?? 255
}

function makeLogicalSprite(width = 12, height = 12, colorShift = 0) {
  const image = blankImage(width, height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if ((x === 0 || y === 0 || x === width - 1 || y === height - 1) && (x + y) % 2 === 0) continue
      const color = PALETTE[(x * 3 + y * 5 + colorShift) % PALETTE.length]
      setPixel(image, x, y, color)
    }
  }
  return image
}

function upscaleLogical(logical, { cellSize = 6, offset = { x: 2, y: 2 }, margin = 2 } = {}) {
  const image = blankImage(offset.x + logical.width * cellSize + margin, offset.y + logical.height * cellSize + margin)
  for (let y = 0; y < logical.height; y += 1) {
    for (let x = 0; x < logical.width; x += 1) {
      const src = pixelOffset(logical.width, x, y)
      const color = [
        logical.data[src],
        logical.data[src + 1],
        logical.data[src + 2],
        logical.data[src + 3],
      ]
      for (let dy = 0; dy < cellSize; dy += 1) {
        for (let dx = 0; dx < cellSize; dx += 1) {
          setPixel(image, offset.x + x * cellSize + dx, offset.y + y * cellSize + dy, color)
        }
      }
    }
  }
  return image
}

function corruptNearGridEdges(image, { cellSize = 6, offset = { x: 2, y: 2 }, frameNoise = 0 } = {}) {
  const output = { width: image.width, height: image.height, data: new Uint8ClampedArray(image.data) }
  for (let y = 0; y < output.height; y += 1) {
    for (let x = 0; x < output.width; x += 1) {
      const pixel = pixelOffset(output.width, x, y)
      if (output.data[pixel + 3] === 0) continue
      const localX = x - offset.x
      const localY = y - offset.y
      const nearVertical = localX > 0 && localX % cellSize === 0
      const nearHorizontal = localY > 0 && localY % cellSize === 0
      if (nearVertical || nearHorizontal) {
        output.data[pixel] = Math.round(output.data[pixel] * 0.75 + 32)
        output.data[pixel + 1] = Math.round(output.data[pixel + 1] * 0.75 + 32)
        output.data[pixel + 2] = Math.round(output.data[pixel + 2] * 0.75 + 32)
        output.data[pixel + 3] = 180
      } else if ((x + y + frameNoise) % 17 === 0) {
        output.data[pixel] = Math.max(0, Math.min(255, output.data[pixel] + (frameNoise % 2 === 0 ? 3 : -3)))
      }
    }
  }
  return output
}

function makeGridFrame({ colorShift = 0, frameNoise = 0 } = {}) {
  return corruptNearGridEdges(upscaleLogical(makeLogicalSprite(12, 12, colorShift)), { frameNoise })
}

function makeHarmonicFrame() {
  const logical = blankImage(12, 12)
  const pattern = [0, 1, 1, 0, 0, 1]
  for (let y = 0; y < logical.height; y += 1) {
    for (let x = 0; x < logical.width; x += 1) {
      setPixel(logical, x, y, PALETTE[pattern[x % pattern.length]])
    }
  }
  return corruptNearGridEdges(upscaleLogical(logical), { frameNoise: 3 })
}

function makeModerateSingleCandidateFrame() {
  const spans = [6, 6, 4, 8, 6]
  const image = blankImage(30, 30)
  let y = 0
  for (let row = 0; row < spans.length; row += 1) {
    let x = 0
    for (let column = 0; column < spans.length; column += 1) {
      const color = PALETTE[(row + column) % 2 === 0 ? 1 : 2]
      for (let dy = 0; dy < spans[row]; dy += 1) {
        for (let dx = 0; dx < spans[column]; dx += 1) {
          setPixel(image, x + dx, y + dy, color)
        }
      }
      x += spans[column]
    }
    y += spans[row]
  }
  return image
}

function countAlphaValues(image) {
  const values = new Set()
  for (let offset = 3; offset < image.data.length; offset += 4) values.add(image.data[offset])
  return values
}

function matchingPixels(a, b) {
  const length = Math.min(a.data.length, b.data.length)
  let same = 0
  let total = 0
  for (let offset = 0; offset < length; offset += 4) {
    total += 1
    if (
      a.data[offset] === b.data[offset] &&
      a.data[offset + 1] === b.data[offset + 1] &&
      a.data[offset + 2] === b.data[offset + 2] &&
      a.data[offset + 3] === b.data[offset + 3]
    ) same += 1
  }
  return total ? same / total : 1
}

function sameBytes(a, b) {
  return Buffer.compare(Buffer.from(a.data), Buffer.from(b.data)) === 0
}

function makeNoiseImage(width = 48, height = 48) {
  const image = blankImage(width, height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      setPixel(image, x, y, [
        (x * 37 + y * 19) % 256,
        (x * 11 + y * 53 + 7) % 256,
        (x * 71 + y * 5 + 13) % 256,
        255,
      ])
    }
  }
  return image
}

function makeSparseNoiseSprite(width = 64, height = 64) {
  const image = blankImage(width, height)
  for (let y = 8; y < height - 8; y += 1) {
    for (let x = 8; x < width - 8; x += 1) {
      if ((x * 17 + y * 29) % 7 > 3) continue
      setPixel(image, x, y, [
        (x * 31 + y * 7) % 256,
        (x * 5 + y * 43) % 256,
        (x * 19 + y * 13) % 256,
        255,
      ])
    }
  }
  return image
}

test('detectPixelGrid recovers cell size and offset from corrupted near-pixel art', () => {
  const image = makeGridFrame()
  const grid = detectPixelGrid(image, { minCell: 4, maxCell: 8 })

  assert.equal(grid.cell_size, 6)
  assert.deepEqual(grid.offset, { x: 2, y: 2 })
  assert.ok(grid.confidence >= 0.8, JSON.stringify(grid))

  const palette = PALETTE.map((color) => color.slice(0, 3))
  const refined = refinePixelFrame(image, { grid, palette })
  const expected = refinePixelFrame(upscaleLogical(makeLogicalSprite()), {
    grid,
    palette,
  })
  assert.ok(matchingPixels(refined.logicalImage, expected.logicalImage) >= 0.98)
})

test('refinePixelFrames locks one shared palette across noisy frame variants', () => {
  const frameA = makeGridFrame({ frameNoise: 2 })
  const frameB = makeGridFrame({ frameNoise: 5 })
  const result = refinePixelFrames([frameA, frameB], { maxColors: 8, minCell: 4, maxCell: 8 })

  assert.equal(result.status, 'refined')
  assert.equal(result.report.sequence.shared_palette, true)
  assert.deepEqual(result.palette.colors, buildSharedPalette([frameA, frameB], { maxColors: 8 }).colors)
  assert.deepEqual([...result.logicalFrames[0].data], [...result.logicalFrames[1].data])
})

test('refinement is deterministic and idempotent', () => {
  const first = refinePixelFrames([makeGridFrame()], { maxColors: 8, minCell: 4, maxCell: 8 })
  const second = refinePixelFrames(first.frames, { maxColors: 8, minCell: 4, maxCell: 8 })

  assert.equal(first.status, 'refined')
  assert.equal(second.status, 'refined')
  assert.equal(sameBytes(second.frames[0], first.frames[0]), true)
})

test('refinePixelFrames degrades honestly when no reliable grid is present', () => {
  const image = makeNoiseImage()
  const result = refinePixelFrames([image], { minConfidence: 0.6, minCell: 4, maxCell: 8 })

  assert.equal(result.status, 'passthrough_no_grid')
  assert.equal(result.frames[0], image)
  assert.ok(result.report.warnings.includes('no_reliable_grid_detected'))
})

test('edge cases do not crash and alpha hardening emits only 0/255 alpha', () => {
  const transparent = blankImage(8, 8)
  assert.equal(refinePixelFrames([transparent], { minCell: 2, maxCell: 8 }).status, 'passthrough_no_grid')
  assert.equal(detectPixelGrid(blankImage(1, 1)).method, 'none')

  const logicalSingleCell = blankImage(1, 1)
  setPixel(logicalSingleCell, 0, 0, PALETTE[1])
  const singleCell = corruptNearGridEdges(upscaleLogical(logicalSingleCell, { cellSize: 6, offset: { x: 0, y: 0 }, margin: 0 }))
  singleCell.data[pixelOffset(singleCell.width, 0, 0) + 3] = 180
  const refined = refinePixelFrame(singleCell, {
    grid: { cell_size: 6, offset: { x: 0, y: 0 }, confidence: 1, method: 'run_length_mode' },
    palette: PALETTE.map((color) => color.slice(0, 3)),
    alphaHardenThreshold: 128,
  })
  const alphaValues = countAlphaValues(refined.image)
  assert.deepEqual([...alphaValues].sort((a, b) => a - b), [255])
  assert.ok(refined.report.alpha_hardened_pixel_count > 0)
})

test('quality character finishing consumes grid refinement as opt-in report path', async () => {
  const png = await encodeRgbaPng(makeGridFrame())
  const result = await finishQualityCharacterImage(png, {
    backgroundMode: 'alpha',
    maxColors: 8,
    downsampleFactor: 2,
    outline: false,
    pixelGridRefinement: { minCell: 4, maxCell: 8, minConfidence: 0.6 },
  })
  const output = await loadRgba(result.resultPng)

  assert.equal(result.report.pixel_grid_refinement.status, 'refined')
  assert.equal(result.report.downsample.skipped_by_grid_refinement, true)
  assert.equal(output.width, 14)
  assert.equal(output.height, 14)
})

test('Quality Character v2 passthrough preserves the legacy outline fallback', async () => {
  const result = await finishQualityCharacterImage(await encodeRgbaPng(makeSparseNoiseSprite()), {
    backgroundMode: 'alpha',
    maxColors: 8,
    downsampleFactor: 2,
    outline: true,
    pixelGridRefinement: {
      recipe: PIXEL_GRID_RECIPE_IDS.V2_BALANCED,
      minCell: 4,
      maxCell: 8,
      minConfidence: 0.99,
      minSequenceSupport: 1,
    },
  })

  assert.equal(result.report.pixel_grid_refinement.status, 'passthrough_no_grid')
  assert.equal(result.report.outline.mode, 'alpha_outline')
  assert.ok(result.report.outline.outline_pixel_count > 0)
  assert.equal(result.report.downsample.skipped_by_grid_refinement, false)
})

test('Quality Character v2 outline report follows the emitted logical image scale', async () => {
  const logical = blankImage(3, 3)
  setPixel(logical, 1, 1, PALETTE[1])
  const result = await finishQualityCharacterImage(
    await encodeRgbaPng(upscaleLogical(logical, {
      cellSize: 4,
      offset: { x: 0, y: 0 },
      margin: 0,
    })),
    {
      backgroundMode: 'alpha',
      maxColors: 32,
      downsampleFactor: 2,
      outline: true,
      pixelGridRefinement: {
        recipe: PIXEL_GRID_RECIPE_IDS.V2_BALANCED,
        minCell: 4,
        maxCell: 4,
        minConfidence: 0,
        minSequenceSupport: 0,
      },
    }
  )
  const output = await loadRgba(result.resultPng)

  assert.equal(output.width, 3)
  assert.equal(output.height, 3)
  assert.equal(result.report.pixel_grid_refinement.settings.max_colors, 16)
  assert.equal(
    result.report.pixel_grid_refinement.consensus.frame_detections[0].detection_work.pixel_limit,
    4 * 1024 * 1024
  )
  assert.equal(
    result.report.outline.outline_pixel_count,
    result.report.pixel_grid_refinement.outline.outline_logical_pixel_count
  )
  assert.equal(
    result.report.outline.outline_pixel_ratio,
    result.report.pixel_grid_refinement.outline.outline_logical_pixel_ratio
  )
  assert.ok(result.report.outline.outline_pixel_ratio <= 1)
})

test('motion source strip can refine selected normalized frames before composition', async () => {
  const frames = Array.from({ length: 4 }, () => makeGridFrame())
  const contract = createMotionSourceContract({
    target_frame_count: 4,
    frame_size: { normalized_cell: [96, 96] },
    background: { source_requirement: 'transparent_alpha' },
  })
  const baseline = await buildMotionStrip({
    frames,
    contract,
    selectedFrameIndexes: [0, 1, 2, 3],
  })
  const result = await buildMotionStrip({
    frames,
    contract,
    selectedFrameIndexes: [0, 1, 2, 3],
    pixelGridRefinement: { minCell: 4, maxCell: 8, minConfidence: 0.6, maxColors: 8 },
  })

  assert.equal(result.report.pixel_grid_refinement.schema_version, 1)
  assert.equal(result.report.pixel_grid_refinement.status, 'refined')
  assert.equal(result.report.pixel_grid_refinement.sequence.frame_count, 4)
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      result.report.pixel_grid_refinement.sequence,
      'normalized_grid_status'
    ),
    false
  )
  assert.deepEqual(result.report.normalization, baseline.report.normalization)
  assert.equal(result.report.normalization.pixel_grid, null)
  assert.equal(result.report.normalized_frames.every((frame) => frame.normalized_bbox), true)
})

test('Motion Source v2 refines selected source frames before grid-aware normalization', async () => {
  const frames = Array.from({ length: 4 }, (_, index) => makeGridFrame({ frameNoise: index }))
  const result = await buildMotionStrip({
    frames,
    contract: createMotionSourceContract({
      target_frame_count: 4,
      frame_size: { normalized_cell: [64, 64] },
      background: { source_requirement: 'transparent_alpha' },
    }),
    selectedFrameIndexes: [0, 1, 2, 3],
    pixelGridRefinement: {
      recipe: PIXEL_GRID_RECIPE_IDS.V2_BALANCED,
      minCell: 4,
      maxCell: 8,
      minConfidence: 0.5,
      minSequenceSupport: 0.5,
      maxColors: 8,
    },
  })

  assert.equal(result.report.pixel_grid_refinement.mode, 'pixel_grid_refinement_v2')
  assert.equal(result.report.pixel_grid_refinement.recipe.id, PIXEL_GRID_RECIPE_IDS.V2_BALANCED)
  assert.equal(result.report.normalization.pixel_grid.source_cell_size, 6)
  assert.ok(Number.isInteger(result.report.normalization.pixel_grid.normalized_cell_size))
  assert.equal(result.report.normalization.pixel_grid.phase_alignment, 'normalized_cell_multiple')
  assert.equal(result.report.normalized_frames.every((frame) => frame.pixel_grid_refinement), true)
  const normalizedCellSize = result.report.normalization.pixel_grid.normalized_cell_size
  for (const frame of result.report.normalized_frames) {
    assert.equal(
      frame.normalized_bbox.y + frame.normalized_bbox.h - 1,
      result.report.normalization.baseline_y
    )
    assert.equal(frame.placement.pixel_grid_phase.aligned, true)
    assert.equal(
      (
        (
          frame.placement.dst_x -
          frame.placement.pixel_grid_phase.required_destination_residue.x
        ) % normalizedCellSize +
        normalizedCellSize
      ) % normalizedCellSize,
      0
    )
    assert.equal(
      (
        (
          frame.placement.dst_y -
          frame.placement.pixel_grid_phase.required_destination_residue.y
        ) % normalizedCellSize +
        normalizedCellSize
      ) % normalizedCellSize,
      0
    )
  }
})

test('Motion Source grid normalization never enlarges a cell beyond the fit scale', async () => {
  const result = await buildMotionStrip({
    frames: Array.from({ length: 2 }, () => makeGridFrame()),
    contract: createMotionSourceContract({
      target_frame_count: 2,
      frame_size: { normalized_cell: [16, 16] },
      anchor_policy: { padding_px: 2 },
      background: { source_requirement: 'transparent_alpha' },
    }),
    selectedFrameIndexes: [0, 1],
    pixelGridRefinement: {
      recipe: PIXEL_GRID_RECIPE_IDS.V2_BALANCED,
      minCell: 4,
      maxCell: 8,
      minConfidence: 0.5,
      minSequenceSupport: 0.5,
      maxColors: 8,
    },
  })

  assert.ok(result.report.normalization.scale <= result.report.normalization.requested_scale)
  assert.equal(
    result.report.normalization.pixel_grid.status,
    'passthrough_normalization_incompatible'
  )
  assert.equal(result.report.normalization.pixel_grid.attempted_status, 'integer_cell_unavailable')
  assert.equal(
    result.report.pixel_grid_refinement.status,
    'passthrough_normalization_incompatible'
  )
  assert.equal(result.report.pixel_grid_refinement.sequence.shared_grid, false)
  assert.deepEqual(result.report.pixel_grid_refinement.sequence.invariants, [])
  assert.ok(result.report.warnings.includes(
    'grid_normalization_passthrough_normalization_incompatible'
  ))
  assert.equal(
    result.report.pixel_grid_refinement.frames.every((frame) => (
      frame.applied === false &&
      frame.changed_pixel_ratio === 0 &&
      frame.detail_protected_pixel_count === 0
    )),
    true
  )
  assert.ok(result.report.pixel_grid_refinement.source_refinement.frames.length > 0)
  assert.equal(
    result.report.normalized_frames.every((frame) => frame.pixel_grid_refinement === null),
    true
  )
  for (const frame of result.report.normalized_frames) {
    assert.ok(frame.normalized_bbox.x >= 0)
    assert.ok(frame.normalized_bbox.y >= 0)
    assert.ok(frame.normalized_bbox.x + frame.normalized_bbox.w <= 16)
    assert.ok(frame.normalized_bbox.y + frame.normalized_bbox.h <= 16)
    assert.equal(
      frame.normalized_bbox.y + frame.normalized_bbox.h - 1,
      result.report.normalization.baseline_y
    )
  }
})

test('Motion Source v2 recipe-only binding detects 24px and 32px source grids', async () => {
  const logical = makeLogicalSprite(4, 4)
  for (const cellSize of [24, 32]) {
    const frames = Array.from({ length: 3 }, () => (
      upscaleLogical(logical, {
        cellSize,
        offset: { x: 3, y: 3 },
        margin: 3,
      })
    ))
    const result = await buildMotionStrip({
      frames,
      contract: createMotionSourceContract({
        target_frame_count: 3,
        frame_size: { normalized_cell: [192, 192] },
        background: { source_requirement: 'transparent_alpha' },
      }),
      selectedFrameIndexes: [0, 1, 2],
      pixelGridRefinement: {
        recipe: PIXEL_GRID_RECIPE_IDS.V2_BALANCED,
        minConfidence: 0,
        minSequenceSupport: 0,
      },
    })

    assert.equal(result.report.pixel_grid_refinement.settings.max_cell, 32)
    assert.equal(
      result.report.pixel_grid_refinement.grid.cell_size,
      cellSize,
      JSON.stringify(result.report.pixel_grid_refinement)
    )
    assert.equal(result.report.pixel_grid_refinement.status, 'refined')
    assert.equal(result.report.normalization.pixel_grid.status, 'applied')
  }
})

test('Motion Source preserves the declared baseline when a partial-cell phase is incompatible', async () => {
  const frame = blankImage(12, 12)
  for (let y = 0; y < 6; y += 1) {
    for (let x = 0; x < 12; x += 1) {
      setPixel(frame, x, y, x < 6 ? PALETTE[2] : PALETTE[3])
    }
  }
  for (let y = 6; y < 11; y += 1) {
    for (let x = 0; x < 12; x += 1) {
      setPixel(frame, x, y, PALETTE[(x + y) % 2])
    }
  }
  const result = await buildMotionStrip({
    frames: [frame, frame],
    contract: createMotionSourceContract({
      target_frame_count: 2,
      frame_size: { normalized_cell: [64, 64] },
      background: { source_requirement: 'transparent_alpha' },
    }),
    selectedFrameIndexes: [0, 1],
    pixelGridRefinement: {
      recipe: PIXEL_GRID_RECIPE_IDS.V2_DETAIL_SAFE,
      minCell: 6,
      maxCell: 6,
      minConfidence: 0,
      minSequenceSupport: 0,
      maxColors: 4,
    },
  })

  assert.equal(
    result.report.pixel_grid_refinement.status,
    'passthrough_normalization_incompatible',
    JSON.stringify(result.report.pixel_grid_refinement)
  )
  assert.equal(result.report.pixel_grid_refinement.source_refinement_status, 'refined')
  assert.equal(
    result.report.normalization.pixel_grid.status,
    'passthrough_normalization_incompatible'
  )
  assert.equal(result.report.normalization.pixel_grid.attempted_status, 'placement_unaligned')
  assert.equal(result.report.normalization.pixel_grid.phase_alignment, 'bounded_fallback')
  assert.equal(
    result.report.pixel_grid_refinement.frames.every((item) => (
      item.applied === false &&
      item.changed_pixel_ratio === 0
    )),
    true
  )
  assert.ok(result.report.pixel_grid_refinement.source_refinement.frames.some((item) => (
    item.detail_protected_cell_count > 0
  )))
  for (const normalized of result.report.normalized_frames) {
    assert.equal(
      normalized.normalized_bbox.y + normalized.normalized_bbox.h - 1,
      result.report.normalization.baseline_y
    )
  }
})

test('pixel grid recipes preserve legacy opt-in and reject unknown v2 recipes', () => {
  assert.deepEqual(normalizePixelGridRefinementOptions(true), {
    recipe: PIXEL_GRID_RECIPE_IDS.V1_COMPAT,
  })
  assert.deepEqual(normalizePixelGridRefinementOptions({
    recipe: PIXEL_GRID_RECIPE_IDS.V2_BALANCED,
    minCell: 4,
    maxCell: 8,
  }), {
    recipe: PIXEL_GRID_RECIPE_IDS.V2_BALANCED,
    minCell: 4,
    maxCell: 8,
  })
  assert.throws(
    () => normalizePixelGridRefinementOptions({ recipe: 'pixel_grid_unknown' }),
    (error) => error?.code === 'invalid_pixel_grid_recipe'
  )
  assert.throws(
    () => normalizePixelGridRefinementOptions({ recipe: PIXEL_GRID_RECIPE_IDS.V2_BALANCED, surprise: true }),
    (error) => error?.code === 'unknown_pixel_grid_option'
  )
  for (const recipe of [false, 0, '', null]) {
    assert.throws(
      () => normalizePixelGridRefinementOptions({ recipe }),
      (error) => error?.code === 'invalid_pixel_grid_recipe'
    )
  }
  assert.throws(
    () => normalizePixelGridRefinementOptions({
      recipe: PIXEL_GRID_RECIPE_IDS.V2_BALANCED,
      minCell: 1,
    }),
    (error) => error?.code === 'invalid_pixel_grid_option'
  )
  assert.throws(
    () => normalizePixelGridRefinementOptions({
      recipe: PIXEL_GRID_RECIPE_IDS.V2_BALANCED,
      alphaHardenThreshold: 0,
    }),
    (error) => error?.code === 'invalid_pixel_grid_option'
  )
  assert.throws(
    () => normalizePixelGridRefinementOptions({
      recipe: PIXEL_GRID_RECIPE_IDS.V2_BALANCED,
      alphaThreshold: 0,
    }),
    (error) => error?.code === 'invalid_pixel_grid_option'
  )
  assert.throws(
    () => normalizePixelGridRefinementOptions({
      recipe: PIXEL_GRID_RECIPE_IDS.V2_BALANCED,
      emitLogical: 'false',
    }),
    (error) => error?.code === 'invalid_pixel_grid_option'
  )
})

test('v2 sequence consensus ignores one noisy outlier and locks shared phase', () => {
  const frames = [
    makeGridFrame({ frameNoise: 1 }),
    makeGridFrame({ frameNoise: 2 }),
    makeNoiseImage(76, 76),
    makeGridFrame({ frameNoise: 4 }),
    makeGridFrame({ frameNoise: 5 }),
  ]
  const consensus = detectPixelGridSequence(frames, {
    minCell: 4,
    maxCell: 8,
    sampleLimit: 5,
  })
  const result = refinePixelFrames(frames, {
    recipe: PIXEL_GRID_RECIPE_IDS.V2_BALANCED,
    minCell: 4,
    maxCell: 8,
    minConfidence: 0.5,
    minSequenceSupport: 0.6,
    maxColors: 8,
  })

  assert.equal(consensus.cell_size, 6)
  assert.deepEqual(consensus.offset, { x: 2, y: 2 })
  assert.ok(consensus.support_ratio >= 0.6)
  assert.equal(result.status, 'refined')
  assert.equal(result.report.schema_version, 2)
  assert.equal(result.report.mode, 'pixel_grid_refinement_v2')
  assert.equal(result.report.recipe.id, PIXEL_GRID_RECIPE_IDS.V2_BALANCED)
  assert.equal(result.report.sequence.shared_grid, true)
  assert.deepEqual(result.report.sequence.invariants, ['shared_palette', 'shared_grid'])
})

test('sequence sampleLimit one analyzes exactly the first frame', () => {
  const consensus = detectPixelGridSequence([
    makeGridFrame({ frameNoise: 1 }),
    makeGridFrame({ frameNoise: 2 }),
    makeGridFrame({ frameNoise: 3 }),
  ], {
    minCell: 4,
    maxCell: 8,
    sampleLimit: 1,
  })

  assert.deepEqual(consensus.sampled_frame_indexes, [0])
  assert.equal(consensus.frame_detections.length, 1)
})

test('sequence consensus retains a moderate single candidate before confidence amplification', () => {
  const frame = makeModerateSingleCandidateFrame()
  const detection = detectPixelGrid(frame, {
    minCell: 6,
    maxCell: 6,
    candidateLimit: 1,
  })

  assert.equal(detection.candidates.length, 1)
  assert.ok(detection.confidence >= 0.45, JSON.stringify(detection))
  assert.ok(detection.candidates[0].score >= 0.4, JSON.stringify(detection))
  assert.ok(
    detection.candidates[0].score < detection.confidence * 0.65,
    JSON.stringify(detection)
  )

  const consensus = detectPixelGridSequence([frame], {
    minCell: 6,
    maxCell: 6,
    sampleLimit: 1,
  })
  assert.equal(consensus.cell_size, 6, JSON.stringify(consensus))
  assert.equal(consensus.supporting_frame_count, 1)
})

test('v2 harmonic review prefers the stronger six-pixel boundary family', () => {
  const frames = Array.from({ length: 4 }, () => makeHarmonicFrame())
  const consensus = detectPixelGridSequence(frames, {
    minCell: 3,
    maxCell: 12,
    sampleLimit: 4,
  })

  assert.equal(consensus.cell_size, 6)
  assert.ok(consensus.rejected_harmonics.some((candidate) => (
    candidate.cell_size === 3 &&
    candidate.alias_of === 6 &&
    candidate.reason === 'harmonic_alias'
  )), JSON.stringify(consensus))
})

test('v2 harmonic review does not fabricate alias evidence when boundaries are ambiguous', () => {
  const logical = blankImage(12, 12)
  for (let y = 0; y < logical.height; y += 1) {
    for (let x = 0; x < logical.width; x += 1) setPixel(logical, x, y, PALETTE[1])
  }
  const frames = Array.from({ length: 3 }, () => upscaleLogical(logical, {
    offset: { x: 0, y: 0 },
    margin: 0,
  }))
  const consensus = detectPixelGridSequence(frames, {
    minCell: 3,
    maxCell: 12,
    sampleLimit: 3,
  })

  assert.deepEqual(consensus.rejected_harmonics, [])
})

test('v2 all-noise sequences remain passthrough instead of gaining confidence from support count', () => {
  const frames = Array.from({ length: 4 }, (_, index) => makeNoiseImage(48 + index, 48 + index))
  const result = refinePixelFrames(frames, {
    recipe: PIXEL_GRID_RECIPE_IDS.V2_BALANCED,
    minCell: 4,
    maxCell: 8,
    minConfidence: 0.6,
    minSequenceSupport: 0.5,
  })

  assert.equal(result.status, 'passthrough_no_grid')
  assert.equal(result.frames[0], frames[0])
  assert.ok(result.report.warnings.includes('no_reliable_grid_detected'))
})

test('autocorrelation detection records a bounded sampled comparison workload', () => {
  const detection = detectPixelGrid(makeNoiseImage(384, 384), {
    minCell: 2,
    maxCell: 32,
  })

  assert.equal(detection.method, 'autocorrelation')
  assert.ok(detection.detection_work.autocorrelation.sample_stride > 1)
  assert.ok(
    detection.detection_work.autocorrelation.comparison_count <=
    detection.detection_work.autocorrelation.comparison_limit
  )
  assert.ok(detection.detection_work.run_histogram_bins <= 32 * 8 + 1)
})

test('detail-safe refinement preserves complex source detail inside a grid cell', () => {
  const image = blankImage(12, 6)
  for (let y = 0; y < 6; y += 1) {
    for (let x = 0; x < 12; x += 1) {
      const checker = (x + y) % 2
      setPixel(image, x, y, x < 6 ? PALETTE[checker] : PALETTE[2])
    }
  }
  const grid = { cell_size: 6, offset: { x: 0, y: 0 }, confidence: 1, method: 'sequence_consensus' }
  const palette = [PALETTE[0], PALETTE[1], PALETTE[2]].map((color) => color.slice(0, 3))
  const flat = refinePixelFrame(image, { grid, palette, detailProtection: 'off' })
  const safe = refinePixelFrame(image, { grid, palette, detailProtection: 'detail_safe' })
  const leftCellColors = new Set()
  for (let y = 0; y < 6; y += 1) {
    for (let x = 0; x < 6; x += 1) {
      const offset = pixelOffset(safe.image.width, x, y)
      leftCellColors.add(`${safe.image.data[offset]},${safe.image.data[offset + 1]},${safe.image.data[offset + 2]}`)
    }
  }

  assert.equal(new Set(Array.from({ length: 36 }, (_, index) => {
    const x = index % 6
    const y = Math.floor(index / 6)
    const offset = pixelOffset(flat.image.width, x, y)
    return `${flat.image.data[offset]},${flat.image.data[offset + 1]},${flat.image.data[offset + 2]}`
  })).size, 1)
  assert.ok(leftCellColors.size > 1)
  assert.equal(safe.report.detail_protected_cell_count, 1)
  assert.equal(safe.report.detail_protection_reason, 'source_detail_preserved')
})

test('detail-safe recipe preserves complex cells through the real sequence orchestrator', () => {
  const image = blankImage(18, 6)
  for (let y = 0; y < 6; y += 1) {
    for (let x = 0; x < 18; x += 1) {
      const color = x < 6
        ? PALETTE[(x + y) % 2]
        : x < 12
          ? PALETTE[2]
          : PALETTE[3]
      setPixel(image, x, y, color)
    }
  }
  const result = refinePixelFrames([image], {
    recipe: PIXEL_GRID_RECIPE_IDS.V2_DETAIL_SAFE,
    minCell: 6,
    maxCell: 6,
    minConfidence: 0,
    minSequenceSupport: 0,
    maxColors: 4,
  })
  const leftCellColors = new Set()
  for (let y = 0; y < 6; y += 1) {
    for (let x = 0; x < 6; x += 1) {
      const offset = pixelOffset(result.frames[0].width, x, y)
      leftCellColors.add(
        `${result.frames[0].data[offset]},${result.frames[0].data[offset + 1]},${result.frames[0].data[offset + 2]}`
      )
    }
  }

  assert.equal(result.status, 'refined')
  assert.equal(result.report.recipe.id, PIXEL_GRID_RECIPE_IDS.V2_DETAIL_SAFE)
  assert.ok(result.report.frames[0].detail_protected_cell_count >= 1)
  assert.ok(leftCellColors.size > 1)
  assert.equal(result.logicalSafe, false)
  assert.equal(result.logicalFrames, null)
})

test('OKLab palette matching is explicit and can diverge from RGB matching', () => {
  const palette = [
    [24, 36, 220],
    [20, 190, 64],
    [230, 72, 42],
    [238, 210, 48],
  ]
  const grid = { cell_size: 2, offset: { x: 0, y: 0 }, confidence: 1, method: 'sequence_consensus' }
  let divergence = null
  for (let r = 24; r <= 232 && !divergence; r += 52) {
    for (let g = 24; g <= 232 && !divergence; g += 52) {
      for (let b = 24; b <= 232 && !divergence; b += 52) {
        const image = blankImage(2, 2)
        for (let y = 0; y < 2; y += 1) for (let x = 0; x < 2; x += 1) setPixel(image, x, y, [r, g, b, 255])
        const rgb = refinePixelFrame(image, { grid, palette, colorDistance: 'rgb' })
        const oklab = refinePixelFrame(image, { grid, palette, colorDistance: 'oklab' })
        if (!sameBytes(rgb.image, oklab.image)) divergence = { image, rgb, oklab }
      }
    }
  }

  assert.ok(divergence)
  assert.equal(divergence.rgb.report.detail_protected_cell_count, 0)
  assert.equal(divergence.oklab.report.detail_protected_cell_count, 0)
})

test('OKLab recipe is active through the real sequence orchestrator', () => {
  const frame = upscaleLogical(makeLogicalSprite(4, 4), {
    cellSize: 4,
    offset: { x: 0, y: 0 },
    margin: 0,
  })
  const result = refinePixelFrames([frame], {
    recipe: PIXEL_GRID_RECIPE_IDS.V2_OKLAB,
    minCell: 4,
    maxCell: 4,
    minConfidence: 0,
    minSequenceSupport: 0,
    maxColors: 4,
  })
  const repeated = refinePixelFrames([frame], {
    recipe: PIXEL_GRID_RECIPE_IDS.V2_OKLAB,
    minCell: 4,
    maxCell: 4,
    minConfidence: 0,
    minSequenceSupport: 0,
    maxColors: 4,
  })

  assert.equal(result.status, 'refined')
  assert.equal(result.report.recipe.id, PIXEL_GRID_RECIPE_IDS.V2_OKLAB)
  assert.equal(result.report.palette.color_distance, 'oklab')
  assert.ok(result.report.resource_budget.actual_color_comparisons > 0)
  assert.equal(sameBytes(result.frames[0], repeated.frames[0]), true)
  assert.deepEqual(result.report.palette, repeated.report.palette)
})

test('zero coverage and zero harden threshold never fill a fully transparent cell', () => {
  const image = blankImage(4, 2)
  setPixel(image, 0, 0, [120, 80, 40, 1])
  const refined = refinePixelFrame(image, {
    grid: {
      cell_size: 2,
      offset: { x: 0, y: 0 },
      confidence: 1,
      method: 'sequence_consensus',
    },
    palette: [[120, 80, 40]],
    alphaHardenThreshold: 0,
    emptyCellCoverage: 0,
  })

  for (let y = 0; y < 2; y += 1) {
    for (let x = 2; x < 4; x += 1) {
      assert.equal(refined.image.data[pixelOffset(refined.image.width, x, y) + 3], 0)
    }
  }
})

test('refinement work budget fails safe with unchanged frame objects and evidence', () => {
  const frames = [makeGridFrame(), makeGridFrame({ frameNoise: 1 })]
  const result = refinePixelFrames(frames, {
    recipe: PIXEL_GRID_RECIPE_IDS.V2_BALANCED,
    minCell: 4,
    maxCell: 8,
    minConfidence: 0,
    minSequenceSupport: 0,
    resourceLimits: {
      max_total_pixels: 100,
    },
  })

  assert.equal(result.status, 'passthrough_refinement_budget')
  assert.equal(result.frames[0], frames[0])
  assert.equal(result.frames[1], frames[1])
  assert.equal(result.report.resource_budget.status, 'exceeded')
  assert.ok(result.report.resource_budget.violations.includes('max_total_pixels'))
  assert.ok(result.report.warnings.includes('grid_refinement_budget_exceeded'))
})

test('internal resource overrides can lower but never raise fixed ceilings', () => {
  const result = refinePixelFrames([makeGridFrame()], {
    recipe: PIXEL_GRID_RECIPE_IDS.V2_BALANCED,
    minCell: 4,
    maxCell: 8,
    minConfidence: 0,
    minSequenceSupport: 0,
    resourceLimits: {
      max_frame_pixels: Number.MAX_SAFE_INTEGER,
      max_total_pixels: Number.MAX_SAFE_INTEGER,
      max_color_comparisons: Number.MAX_SAFE_INTEGER,
      max_total_cells: Number.MAX_SAFE_INTEGER,
    },
  })

  assert.equal(result.status, 'refined')
  assert.deepEqual(result.report.resource_budget.limits, PIXEL_GRID_REFINEMENT_LIMITS)
})

test('reserved outline color cannot activate refinement without sampled source colors', () => {
  const frame = blankImage(513, 513)
  for (let y = 1; y < frame.height; y += 2) {
    for (let x = 1; x < frame.width; x += 2) {
      setPixel(frame, x, y, PALETTE[1])
    }
  }
  const result = refinePixelFrames([frame], {
    recipe: PIXEL_GRID_RECIPE_IDS.V2_BALANCED,
    minCell: 2,
    maxCell: 2,
    minConfidence: 0,
    minSequenceSupport: 0,
    maxColors: 4,
    outlineMode: 'outer',
  })

  assert.equal(result.status, 'passthrough_no_grid')
  assert.equal(result.frames[0], frame)
  assert.ok(result.report.warnings.includes('no_visible_palette_colors'))
  assert.equal(result.report.frames[0].changed_pixel_ratio, 0)
})

test('single-frame refiner rejects an unsafe cell-count workload before processing', () => {
  const image = blankImage(513, 513)
  assert.throws(
    () => refinePixelFrame(image, {
      grid: {
        cell_size: 1,
        offset: { x: 0, y: 0 },
        confidence: 1,
        method: 'direct_test',
      },
      palette: [[0, 0, 0]],
    }),
    (error) => (
      error?.code === 'pixel_grid_refinement_budget_exceeded' &&
      error.resource_budget.violations.includes('max_total_cells')
    )
  )
})

test('async sequence refinement yields and observes AbortSignal cancellation', async () => {
  const controller = new AbortController()
  const frames = Array.from({ length: 4 }, (_, index) => makeGridFrame({ frameNoise: index }))
  const pending = refinePixelFramesAsync(frames, {
    recipe: PIXEL_GRID_RECIPE_IDS.V2_BALANCED,
    minCell: 4,
    maxCell: 8,
    minConfidence: 0,
    minSequenceSupport: 0,
    signal: controller.signal,
  })
  setTimeout(() => controller.abort(), 0)

  await assert.rejects(
    pending,
    (error) => error?.code === 'cancelled'
  )
})

test('Motion strip build observes cancellation before cleanup and artifact encoding', async () => {
  const controller = new AbortController()
  controller.abort()

  await assert.rejects(
    buildMotionStrip({
      frames: [makeGridFrame(), makeGridFrame()],
      contract: createMotionSourceContract({
        target_frame_count: 2,
        background: { source_requirement: 'transparent_alpha' },
      }),
      selectedFrameIndexes: [0, 1],
      pixelGridRefinement: {
        recipe: PIXEL_GRID_RECIPE_IDS.V2_BALANCED,
      },
      signal: controller.signal,
    }),
    (error) => error?.code === 'cancelled'
  )
})

test('v2 outer outline is projected after cell consolidation', () => {
  const logical = blankImage(3, 3)
  setPixel(logical, 1, 1, PALETTE[1])
  const frame = upscaleLogical(logical, { cellSize: 4, offset: { x: 0, y: 0 }, margin: 0 })
  const result = refinePixelFrames([frame], {
    recipe: PIXEL_GRID_RECIPE_IDS.V2_BALANCED,
    minCell: 4,
    maxCell: 4,
    minConfidence: 0,
    minSequenceSupport: 0,
    maxColors: 4,
    outlineMode: 'outer',
  })

  assert.equal(result.status, 'refined')
  assert.equal(result.report.outline.stage, 'after_refinement')
  assert.equal(result.report.outline.mode, 'outer')
  assert.ok(result.report.outline.outline_cell_count >= 4)
  assert.ok(result.logicalFrames[0].data.filter((_, index) => index % 4 === 3 && result.logicalFrames[0].data[index] > 0).length >= 5)
})

test('v2 outer outline is byte-idempotent and reserves its color at a full palette cap', () => {
  const logical = blankImage(5, 5)
  setPixel(logical, 2, 2, PALETTE[1])
  setPixel(logical, 2, 1, PALETTE[2])
  setPixel(logical, 3, 2, PALETTE[3])
  setPixel(logical, 2, 3, PALETTE[4])
  const frame = upscaleLogical(logical, {
    cellSize: 4,
    offset: { x: 0, y: 0 },
    margin: 0,
  })
  const options = {
    recipe: PIXEL_GRID_RECIPE_IDS.V2_BALANCED,
    minCell: 4,
    maxCell: 4,
    minConfidence: 0,
    minSequenceSupport: 0,
    maxColors: 4,
    outlineMode: 'outer',
    outlineColor: [24, 24, 32],
  }
  const first = refinePixelFrames([frame], options)
  const second = refinePixelFrames(first.frames, options)

  assert.equal(first.status, 'refined')
  assert.equal(second.status, 'refined')
  assert.ok(first.report.palette.reserved_colors.some((color) => (
    color[0] === 24 && color[1] === 24 && color[2] === 32
  )))
  assert.equal(sameBytes(first.frames[0], second.frames[0]), true)
  assert.equal(second.report.outline.added_outline_cell_count, 0)
  assert.equal(second.report.outline.outline_pixel_count, 0)
})

test('v2 outer outline does not expand a source outline using the same fixed color', () => {
  const outlineColor = [24, 24, 32, 255]
  const logical = blankImage(5, 5)
  setPixel(logical, 2, 2, PALETTE[1])
  setPixel(logical, 2, 1, outlineColor)
  setPixel(logical, 3, 2, outlineColor)
  setPixel(logical, 2, 3, outlineColor)
  setPixel(logical, 1, 2, outlineColor)
  const frame = upscaleLogical(logical, {
    cellSize: 4,
    offset: { x: 0, y: 0 },
    margin: 0,
  })
  const options = {
    recipe: PIXEL_GRID_RECIPE_IDS.V2_BALANCED,
    minCell: 4,
    maxCell: 4,
    minConfidence: 0,
    minSequenceSupport: 0,
    maxColors: 4,
    outlineMode: 'outer',
    outlineColor: outlineColor.slice(0, 3),
  }
  const first = refinePixelFrames([frame], options)
  const second = refinePixelFrames(first.frames, options)

  assert.equal(sameBytes(first.frames[0], second.frames[0]), true)
  assert.equal(first.report.outline.added_outline_cell_count, 0)
  assert.equal(second.report.outline.added_outline_cell_count, 0)
})
