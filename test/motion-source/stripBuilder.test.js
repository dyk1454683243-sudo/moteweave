import test from 'node:test'
import assert from 'node:assert/strict'

import { encodeRgbaPng, loadRgba } from '../../src/character-pack/imageCodec.js'
import { createMotionSourceContract } from '../../src/motion-source/contract.js'
import { buildMotionStrip } from '../../src/motion-source/stripBuilder.js'

function paintRect(image, rect, color) {
  for (let y = rect.y; y < rect.y + rect.h; y += 1) {
    for (let x = rect.x; x < rect.x + rect.w; x += 1) {
      if (x < 0 || y < 0 || x >= image.width || y >= image.height) continue
      const offset = (y * image.width + x) * 4
      image.data[offset] = color[0]
      image.data[offset + 1] = color[1]
      image.data[offset + 2] = color[2]
      image.data[offset + 3] = color[3]
    }
  }
}

function sourceFrame({
  width = 48,
  height = 48,
  background = [255, 255, 255, 255],
  rect = { x: 20, y: 12, w: 8, h: 24 },
  color = [40, 90, 170, 255],
  halo = false,
  foot = null,
  checkerboard = false,
  gradient = false,
} = {}) {
  const image = { width, height, data: new Uint8ClampedArray(width * height * 4) }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4
      const bg = checkerboard && (x + y) % 2 === 0
        ? [210, 210, 210, 255]
        : gradient
          ? [255 - y, 255 - y, 255 - y, 255]
          : background
      image.data[offset] = bg[0]
      image.data[offset + 1] = bg[1]
      image.data[offset + 2] = bg[2]
      image.data[offset + 3] = bg[3]
    }
  }
  if (halo) paintRect(image, { x: rect.x - 1, y: rect.y, w: 1, h: rect.h }, [250, 250, 250, 255])
  paintRect(image, rect, color)
  if (foot === 'left') paintRect(image, { x: rect.x - 4, y: rect.y + rect.h - 2, w: 4, h: 2 }, color)
  if (foot === 'right') paintRect(image, { x: rect.x + rect.w, y: rect.y + rect.h - 2, w: 4, h: 2 }, color)
  return image
}

function movingFrames(count = 12, options = {}) {
  return Array.from({ length: count }, (_, index) => sourceFrame({
    ...options,
    rect: { x: 14 + index, y: 12, w: 8, h: 24 },
    foot: index % 2 === 0 ? 'left' : 'right',
  }))
}

function repeatedFourPhaseFrames() {
  const phases = [
    { rect: { x: 16, y: 12, w: 8, h: 24 }, foot: 'left', color: [180, 40, 40, 255] },
    { rect: { x: 18, y: 10, w: 8, h: 26 }, foot: 'right', color: [40, 150, 70, 255] },
    { rect: { x: 20, y: 12, w: 10, h: 24 }, foot: 'left', color: [40, 80, 180, 255] },
    { rect: { x: 18, y: 14, w: 8, h: 22 }, foot: 'right', color: [180, 140, 40, 255] },
  ]
  return [...phases, ...phases].map((phase) => sourceFrame(phase))
}

test('buildMotionStrip creates a normalized 96px-high strip and contact sheet', async () => {
  const contract = createMotionSourceContract({ target_frame_count: 8 })
  const result = await buildMotionStrip({ frames: movingFrames(12), contract })

  const strip = await loadRgba(result.normalizedMotionStripPng)
  const contactSheet = await loadRgba(result.motionContactSheetPng)

  assert.equal(strip.width, 96 * 8)
  assert.equal(strip.height, 96)
  assert.equal(contactSheet.width, 96 * 8)
  assert.equal(contactSheet.height, 96 * 2)
  assert.equal(result.report.selected_frame_count, 8)
  assert.equal(result.report.frame_selection.selected.length, 8)
  assert.equal(result.report.requested_selection_mode, null)
  assert.equal(result.report.effective_selection_mode, 'auto')
  assert.equal(result.report.frame_selection.selection_mode, 'auto')
  assert.ok(result.report.frame_selection.rejected.length > 0)
})

test('buildMotionStrip uses the automatic selector for explicit auto mode', async () => {
  const result = await buildMotionStrip({
    frames: movingFrames(6),
    contract: createMotionSourceContract({ target_frame_count: 4 }),
    selectionMode: 'auto',
  })

  assert.equal(result.report.requested_selection_mode, 'auto')
  assert.equal(result.report.effective_selection_mode, 'auto')
  assert.equal(result.selectedFrames.selection_mode, 'auto')
  assert.equal(result.selectedFrames.selected.length, 4)
  assert.ok(result.selectedFrames.rejected.length > 0)
})

test('buildMotionStrip preserves explicit manual frame order and reports requested and effective modes', async () => {
  const result = await buildMotionStrip({
    frames: movingFrames(5),
    contract: createMotionSourceContract({ target_frame_count: 3 }),
    selectionMode: 'manual',
    selectedFrameIndexes: [4, 1, 0],
  })

  assert.equal(result.report.requested_selection_mode, 'manual')
  assert.equal(result.report.effective_selection_mode, 'manual')
  assert.equal(result.selectedFrames.requested_selection_mode, 'manual')
  assert.equal(result.selectedFrames.effective_selection_mode, 'manual')
  assert.deepEqual(
    result.selectedFrames.selected.map((frame) => frame.original_index),
    [4, 1, 0]
  )
})

test('buildMotionStrip binds Motion Selection v2 provenance and periodic phase evidence', async () => {
  const frames = repeatedFourPhaseFrames()
  const frameProvenance = frames.map((_, candidateIndex) => ({
    candidate_index: candidateIndex,
    raw_index: candidateIndex * 2,
    timestamp_ms: candidateIndex * 80,
    duration_ms: 80,
    timing_source: 'derived_sampling',
    source_entry: `frame_${String(candidateIndex * 2).padStart(3, '0')}.png`,
  }))
  const result = await buildMotionStrip({
    frames,
    frameProvenance,
    contract: createMotionSourceContract({
      target_frame_count: 4,
      motion_selection: {
        recipe: 'motion_selection_recipe_v2',
        loop_expectation: 'loop',
        temporal_matte: 'evidence_only',
      },
    }),
  })

  assert.equal(result.selectedFrames.mode, 'motion_selection_report_v2')
  assert.equal(result.selectedFrames.schema_version, 2)
  assert.equal(result.selectedFrames.periodicity.status, 'detected')
  assert.equal(result.selectedFrames.periodicity.selected_period, 4)
  assert.deepEqual(
    result.selectedFrames.selected.map((frame) => frame.raw_index),
    [0, 2, 4, 6]
  )
  assert.deepEqual(
    result.framesIndex.frames.map((frame) => frame.raw_index),
    [0, 2, 4, 6]
  )
  assert.equal(result.report.status, 'done')
  assert.equal(result.report.frame_selection.temporal_matte.modifies_pixels, false)
})

test('buildMotionStrip honors a validated complete contract that uses the camel selection alias', async () => {
  const contract = createMotionSourceContract({ target_frame_count: 3 })
  delete contract.motion_selection
  contract.motionSelection = {
    recipe: 'motion_selection_recipe_v2',
    loopExpectation: 'once',
    temporalMatte: 'disabled',
  }
  const result = await buildMotionStrip({
    frames: movingFrames(5),
    contract,
  })

  assert.equal(result.selectedFrames.mode, 'motion_selection_report_v2')
  assert.equal(result.selectedFrames.settings.loop_expectation, 'once')
})

test('buildMotionStrip keeps Motion Selection v2 automatic stages out of Manual authority', async () => {
  const result = await buildMotionStrip({
    frames: movingFrames(5),
    frameProvenance: Array.from({ length: 5 }, (_, index) => ({
      candidate_index: index,
      raw_index: index * 3,
      timestamp_ms: null,
      duration_ms: null,
      timing_source: 'unavailable',
      source_entry: null,
    })),
    contract: createMotionSourceContract({
      target_frame_count: 3,
      motion_selection: {
        recipe: 'motion_selection_recipe_v2',
        loop_expectation: 'auto',
        temporal_matte: 'evidence_only',
      },
    }),
    selectionMode: 'manual',
    selectedFrameIndexes: [4, 1, 0],
  })

  assert.deepEqual(
    result.selectedFrames.selected.map((frame) => frame.original_index),
    [4, 1, 0]
  )
  assert.deepEqual(
    result.selectedFrames.selected.map((frame) => frame.raw_index),
    [12, 3, 0]
  )
  assert.equal(result.selectedFrames.registration.status, 'not_run_manual_authority')
  assert.equal(result.selectedFrames.periodicity.status, 'not_run_manual_authority')
  assert.equal(result.selectedFrames.temporal_matte.status, 'not_run_manual_authority')
})

test('buildMotionStrip reports a Manual v2 target mismatch without redefining the contract target', async () => {
  const result = await buildMotionStrip({
    frames: movingFrames(4),
    contract: createMotionSourceContract({
      target_frame_count: 3,
      motion_selection: {
        recipe: 'motion_selection_recipe_v2',
        loop_expectation: 'once',
        temporal_matte: 'disabled',
      },
    }),
    selectionMode: 'manual',
    selectedFrameIndexes: [3, 1],
  })

  assert.equal(result.selectedFrames.target.target_frame_count, 3)
  assert.equal(result.selectedFrames.target.selected_frame_count, 2)
  assert.equal(result.selectedFrames.target.target_satisfied, false)
  assert.equal(result.selectedFrames.target.shortfall_count, 1)
  assert.ok(result.selectedFrames.warnings.includes('manual_target_count_mismatch'))
  assert.equal(result.report.status, 'warning')
})

test('buildMotionStrip reports a v2 target shortfall as warning without fabricating frames', async () => {
  const frame = sourceFrame()
  const result = await buildMotionStrip({
    frames: [frame, sourceFrame(), sourceFrame(), sourceFrame()],
    contract: createMotionSourceContract({
      target_frame_count: 3,
      motion_selection: {
        recipe: 'motion_selection_recipe_v2',
        loop_expectation: 'auto',
        temporal_matte: 'disabled',
      },
    }),
  })

  assert.equal(result.selectedFrames.status, 'insufficient_target')
  assert.equal(result.selectedFrames.target.target_satisfied, false)
  assert.equal(result.selectedFrames.selected.length, 1)
  assert.equal(result.report.status, 'warning')
})

test('buildMotionStrip preserves legacy manual inference for non-empty indexes', async () => {
  const result = await buildMotionStrip({
    frames: movingFrames(4),
    contract: createMotionSourceContract({ target_frame_count: 2 }),
    selectedFrameIndexes: [3, 1],
  })

  assert.equal(result.report.requested_selection_mode, null)
  assert.equal(result.report.effective_selection_mode, 'manual')
  assert.deepEqual(
    result.selectedFrames.selected.map((frame) => frame.original_index),
    [3, 1]
  )
})

test('buildMotionStrip rejects explicit auto with manual indexes before processing', async () => {
  await assert.rejects(
    buildMotionStrip({
      frames: movingFrames(4),
      contract: createMotionSourceContract({ target_frame_count: 2 }),
      selectionMode: 'auto',
      selectedFrameIndexes: [0, 1],
    }),
    /auto_selection_conflicts_with_frame_indexes/
  )
})

test('buildMotionStrip lowers white halo score during background cleanup', async () => {
  const contract = createMotionSourceContract({ target_frame_count: 4 })
  const result = await buildMotionStrip({
    frames: movingFrames(4, { halo: true }),
    contract,
  })

  assert.ok(result.report.background.halo_score_before > result.report.background.halo_score_after)
  assert.equal(result.report.background.frames.some((frame) => frame.halo_score_after > frame.halo_score_before), false)
})

test('buildMotionStrip removes flat chroma backgrounds with a configured key color', async () => {
  const contract = createMotionSourceContract({
    target_frame_count: 4,
    background: { key_color: [0, 255, 0], tolerance: 18 },
  })
  const result = await buildMotionStrip({
    frames: movingFrames(4, { background: [0, 255, 0, 255] }),
    contract,
  })
  const strip = await loadRgba(result.normalizedMotionStripPng)

  assert.equal(strip.data[3], 0)
  assert.equal(result.report.background.key_color.join(','), '0,255,0')
  assert.equal(result.report.background.frames.every((frame) => frame.visible_bbox_after), true)
})

test('buildMotionStrip warns for flattened checkerboard and gradient backgrounds', async () => {
  const contract = createMotionSourceContract({ target_frame_count: 2 })
  const checkerboard = await buildMotionStrip({
    frames: [sourceFrame({ checkerboard: true }), sourceFrame({ checkerboard: true, rect: { x: 22, y: 12, w: 8, h: 24 } })],
    contract,
  })
  const gradient = await buildMotionStrip({
    frames: [sourceFrame({ gradient: true }), sourceFrame({ gradient: true, rect: { x: 22, y: 12, w: 8, h: 24 } })],
    contract,
  })

  assert.ok(checkerboard.report.source_warnings.includes('non_flat_edge_background'))
  assert.ok(gradient.report.source_warnings.includes('non_flat_edge_background'))
})

test('buildMotionStrip keeps a stable action baseline and applies static offset', async () => {
  const frames = movingFrames(8)
  const base = await buildMotionStrip({
    frames,
    contract: createMotionSourceContract({ target_frame_count: 8 }),
  })
  const shifted = await buildMotionStrip({
    frames,
    contract: createMotionSourceContract({
      target_frame_count: 8,
      anchor_policy: { static_offset_y: -5 },
    }),
  })

  const bottoms = base.report.normalized_frames.map((frame) => frame.normalized_bbox.bottom)
  assert.equal(new Set(bottoms).size, 1)
  assert.equal(base.report.normalization.baseline_y - shifted.report.normalization.baseline_y, 5)
})

test('buildMotionStrip centers by visible bbox instead of alternating foot x positions', async () => {
  const result = await buildMotionStrip({
    frames: movingFrames(8),
    contract: createMotionSourceContract({ target_frame_count: 8 }),
  })

  const centers = result.report.normalized_frames.map((frame) => frame.normalized_bbox.centerX)
  assert.equal(Math.max(...centers) - Math.min(...centers), 0)
  assert.equal(centers[0], 48)
})

test('buildMotionStrip returns JSON-safe selected frame evidence', async () => {
  const result = await buildMotionStrip({
    frames: movingFrames(10),
    contract: createMotionSourceContract({ target_frame_count: 4 }),
  })

  assert.equal(result.selectedFrames.selected.length, 4)
  assert.ok(result.selectedFrames.selected.every((frame) => Number.isInteger(frame.original_index)))
  assert.ok(result.selectedFrames.rejected.every((frame) => frame.reason))
  assert.equal(JSON.parse(JSON.stringify(result.report)).frame_selection.selected.length, 4)
})

test('buildMotionStrip keeps v1 candidate and raw provenance distinct after stride sampling', async () => {
  const frames = movingFrames(6)
  const result = await buildMotionStrip({
    frames,
    frameProvenance: frames.map((_, index) => ({
      candidate_index: index,
      raw_index: index * 2,
      timestamp_ms: null,
      duration_ms: null,
      timing_source: 'unavailable',
      source_entry: `frame_${index * 2}.png`,
    })),
    contract: createMotionSourceContract({ target_frame_count: 4 }),
  })

  assert.deepEqual(
    result.framesIndex.frames.map((frame) => frame.raw_index),
    result.selectedFrames.selected.map((frame) => frame.raw_index)
  )
  assert.ok(result.framesIndex.frames.some(
    (frame) => frame.raw_index !== frame.candidate_index
  ))
})

test('buildMotionStrip returns PNG buffers without writing files', async () => {
  const result = await buildMotionStrip({
    frames: movingFrames(4),
    contract: createMotionSourceContract({ target_frame_count: 4 }),
  })

  assert.ok(Buffer.isBuffer(result.normalizedMotionStripPng))
  assert.ok(Buffer.isBuffer(result.motionContactSheetPng))
  assert.ok(Buffer.isBuffer(await encodeRgbaPng(result.stripImage)))
})
