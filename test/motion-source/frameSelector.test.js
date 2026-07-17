import test from 'node:test'
import assert from 'node:assert/strict'

import {
  MOTION_SELECTION_LOOP_EXPECTATIONS,
  MOTION_SELECTION_RECIPE_IDS,
  MOTION_SELECTION_TEMPORAL_MATTE_MODES,
  normalizeMotionSelectionOptions,
  selectMotionFrames,
  selectMotionFramesAsync,
} from '../../src/motion-source/frameSelector.js'

function blankFrame(width = 16, height = 16) {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) }
}

function rectFrame({ width = 16, height = 16, x = 2, y = 4, w = 4, h = 6, color = [40, 80, 160, 255] } = {}) {
  const frame = blankFrame(width, height)
  for (let yy = y; yy < y + h; yy += 1) {
    for (let xx = x; xx < x + w; xx += 1) {
      const offset = (yy * width + xx) * 4
      frame.data[offset] = color[0]
      frame.data[offset + 1] = color[1]
      frame.data[offset + 2] = color[2]
      frame.data[offset + 3] = color[3]
    }
  }
  return frame
}

function cloneFrame(frame) {
  return { width: frame.width, height: frame.height, data: new Uint8ClampedArray(frame.data) }
}

function solidFrame(color, width = 8, height = 8) {
  const frame = blankFrame(width, height)
  for (let offset = 0; offset < frame.data.length; offset += 4) {
    frame.data[offset] = color[0]
    frame.data[offset + 1] = color[1]
    frame.data[offset + 2] = color[2]
    frame.data[offset + 3] = color[3] ?? 255
  }
  return frame
}

function recolorLeadingPixels(frame, count, color) {
  const next = cloneFrame(frame)
  for (let pixel = 0; pixel < count; pixel += 1) {
    const offset = pixel * 4
    next.data[offset] = color[0]
    next.data[offset + 1] = color[1]
    next.data[offset + 2] = color[2]
    next.data[offset + 3] = color[3] ?? 255
  }
  return next
}

function v2Options(overrides = {}) {
  return {
    recipe: MOTION_SELECTION_RECIPE_IDS.V2,
    loop_expectation: MOTION_SELECTION_LOOP_EXPECTATIONS.AUTO,
    temporal_matte: MOTION_SELECTION_TEMPORAL_MATTE_MODES.DISABLED,
    ...overrides,
  }
}

test('selectMotionFrames removes exact duplicate frames with evidence', () => {
  const first = rectFrame({ x: 2 })
  const frames = [first, cloneFrame(first), rectFrame({ x: 5 }), cloneFrame(first)]

  const result = selectMotionFrames(frames, { targetFrameCount: 3 })

  assert.deepEqual(result.selected.map((frame) => frame.original_index), [0, 2])
  assert.equal(result.rejected.length, 2)
  assert.deepEqual(result.rejected.map((frame) => frame.original_index), [1, 3])
  assert.deepEqual(result.rejected.map((frame) => frame.reason), ['duplicate_frame', 'duplicate_frame'])
  assert.equal(result.rejected[0].duplicate_of, 0)
  assert.equal(result.rejected[1].duplicate_of, 0)
  assert.ok(result.rejected[0].hash)
  assert.equal(result.rejected[0].motion_delta.score, 0)
})

test('selectMotionFrames removes near-duplicate static frames with evidence', () => {
  const frames = [
    rectFrame({ x: 2, color: [40, 80, 160, 255] }),
    rectFrame({ x: 2, color: [41, 80, 160, 255] }),
    rectFrame({ x: 5, color: [41, 80, 160, 255] }),
  ]

  const result = selectMotionFrames(frames, { targetFrameCount: 3 })

  assert.deepEqual(result.selected.map((frame) => frame.original_index), [0, 2])
  const nearDuplicate = result.rejected.find((frame) => frame.original_index === 1)
  assert.equal(nearDuplicate.reason, 'near_duplicate_frame')
  assert.equal(nearDuplicate.near_duplicate_of, 0)
  assert.ok(nearDuplicate.near_duplicate_similarity >= 0.99)
})

test('selectMotionFrames picks 8 frames from 12 inputs in stable original order', () => {
  const frames = Array.from({ length: 12 }, (_, index) => rectFrame({ x: 1 + index }))

  const result = selectMotionFrames(frames, { targetFrameCount: 8 })

  assert.equal(result.selected.length, 8)
  assert.deepEqual(result.selected.map((frame) => frame.original_index), [0, 2, 3, 5, 6, 8, 9, 11])
  assert.ok(result.selected.every((frame, index, list) => index === 0 || list[index - 1].original_index < frame.original_index))
  assert.equal(result.input_frame_count, 12)
  assert.equal(result.distinct_frame_count, 12)
})

test('selectMotionFrames prefers bbox motion inside sampling windows', () => {
  const frames = [
    rectFrame({ x: 2, color: [40, 80, 160, 255] }),
    rectFrame({ x: 2, color: [180, 80, 40, 255] }),
    rectFrame({ x: 6, color: [180, 80, 40, 255] }),
    rectFrame({ x: 6, color: [40, 180, 80, 255] }),
    rectFrame({ x: 9, color: [40, 180, 80, 255] }),
    rectFrame({ x: 11, color: [40, 180, 80, 255] }),
  ]

  const result = selectMotionFrames(frames, { targetFrameCount: 4 })

  assert.deepEqual(result.selected.map((frame) => frame.original_index), [0, 2, 4, 5])
  assert.ok(result.selected[1].selection_score > result.rejected.find((frame) => frame.original_index === 1).selection_score)
  assert.ok(result.selected[2].selection_score > result.rejected.find((frame) => frame.original_index === 3).selection_score)
})

test('selectMotionFrames keeps selected indexes tied to original source frames', () => {
  const frames = [
    rectFrame({ x: 1 }),
    rectFrame({ x: 2 }),
    rectFrame({ x: 3 }),
    rectFrame({ x: 4 }),
    rectFrame({ x: 5 }),
  ]

  const result = selectMotionFrames(frames, { targetFrameCount: 4 })

  for (const selected of result.selected) {
    assert.equal(selected.source_position, selected.original_index)
    assert.equal(frames[selected.original_index].width, selected.width)
    assert.equal(frames[selected.original_index].height, selected.height)
  }
})

test('selectMotionFrames reports loop similarity for closing-frame loops', () => {
  const first = rectFrame({ x: 2 })
  const frames = [
    first,
    rectFrame({ x: 4 }),
    rectFrame({ x: 6 }),
    rectFrame({ x: 4 }),
    cloneFrame(first),
  ]

  const result = selectMotionFrames(frames, { targetFrameCount: 4 })

  assert.equal(result.loop.start_original_index, 0)
  assert.equal(result.loop.end_original_index, 4)
  assert.equal(result.loop.seamless, true)
  assert.equal(result.loop.similarity, 1)
  assert.ok(!result.warnings.includes('loop_not_seamless'))
})

test('selectMotionFrames rejects seamless loop closing frames instead of selecting both endpoints', () => {
  const first = rectFrame({ x: 2, color: [40, 80, 160, 255] })
  const frames = [
    first,
    rectFrame({ x: 4, color: [40, 80, 160, 255] }),
    rectFrame({ x: 6, color: [40, 80, 160, 255] }),
    rectFrame({ x: 3, color: [40, 80, 160, 255] }),
    rectFrame({ x: 2, color: [41, 80, 160, 255] }),
  ]

  const result = selectMotionFrames(frames, { targetFrameCount: 4 })

  assert.equal(result.loop.seamless, true)
  assert.deepEqual(result.selected.map((frame) => frame.original_index), [0, 1, 2, 3])
  const closing = result.rejected.find((frame) => frame.original_index === 4)
  assert.equal(closing.reason, 'loop_closing_frame')
  assert.equal(closing.loop_duplicate_of, 0)
  assert.ok(!result.selected.some((frame) => frame.original_index === 4))
})

test('selectMotionFrames warns when source does not look like a seamless loop', () => {
  const frames = Array.from({ length: 5 }, (_, index) => rectFrame({ x: 1 + index * 2 }))

  const result = selectMotionFrames(frames, { targetFrameCount: 4 })

  assert.equal(result.loop.seamless, false)
  assert.ok(result.loop.similarity < 1)
  assert.ok(result.warnings.includes('loop_not_seamless'))
})

test('selectMotionFrames records bbox and motion deltas for selected and rejected frames', () => {
  const first = rectFrame({ x: 2, y: 3 })
  const frames = [first, rectFrame({ x: 5, y: 3 }), cloneFrame(first), rectFrame({ x: 8, y: 5 })]

  const result = selectMotionFrames(frames, { targetFrameCount: 3 })

  for (const selected of result.selected) {
    assert.equal(selected.bbox.width, 4)
    assert.equal(selected.bbox.height, 6)
    assert.equal(typeof selected.motion_delta.score, 'number')
  }
  assert.equal(result.rejected[0].original_index, 2)
  assert.equal(result.rejected[0].bbox.width, 4)
  assert.equal(typeof result.rejected[0].motion_delta.score, 'number')
})

test('selectMotionFrames warns on too few distinct frames instead of fabricating frames', () => {
  const first = rectFrame({ x: 3 })
  const second = rectFrame({ x: 6 })
  const frames = [first, cloneFrame(first), second, cloneFrame(second)]

  const result = selectMotionFrames(frames, { targetFrameCount: 8 })

  assert.deepEqual(result.selected.map((frame) => frame.original_index), [0, 2])
  assert.equal(result.selected.length, 2)
  assert.ok(result.warnings.includes('too_few_distinct_frames'))
})

test('motion selection normalization defaults to v1 and canonicalizes v2 aliases', () => {
  assert.deepEqual(normalizeMotionSelectionOptions(), {
    recipe: MOTION_SELECTION_RECIPE_IDS.V1_COMPAT,
    loop_expectation: MOTION_SELECTION_LOOP_EXPECTATIONS.AUTO,
    temporal_matte: MOTION_SELECTION_TEMPORAL_MATTE_MODES.DISABLED,
  })
  assert.deepEqual(normalizeMotionSelectionOptions(null), normalizeMotionSelectionOptions(false))
  assert.deepEqual(normalizeMotionSelectionOptions({
    recipe: MOTION_SELECTION_RECIPE_IDS.V2,
    loopExpectation: MOTION_SELECTION_LOOP_EXPECTATIONS.LOOP,
    temporalMatte: MOTION_SELECTION_TEMPORAL_MATTE_MODES.EVIDENCE_ONLY,
  }), {
    recipe: MOTION_SELECTION_RECIPE_IDS.V2,
    loop_expectation: MOTION_SELECTION_LOOP_EXPECTATIONS.LOOP,
    temporal_matte: MOTION_SELECTION_TEMPORAL_MATTE_MODES.EVIDENCE_ONLY,
  })
})

test('motion selection normalization rejects unknown recipes fields aliases and enum values', () => {
  assert.throws(
    () => normalizeMotionSelectionOptions(true),
    { code: 'invalid_motion_selection_options' }
  )
  assert.throws(
    () => normalizeMotionSelectionOptions({ recipe: 'future_recipe' }),
    { code: 'invalid_motion_selection_recipe' }
  )
  assert.throws(
    () => normalizeMotionSelectionOptions({
      recipe: MOTION_SELECTION_RECIPE_IDS.V2,
      future_threshold: 0.5,
    }),
    { code: 'unknown_motion_selection_option', option: 'future_threshold' }
  )
  assert.throws(
    () => normalizeMotionSelectionOptions({
      recipe: MOTION_SELECTION_RECIPE_IDS.V2,
      loop_expectation: 'loop',
      loopExpectation: 'once',
    }),
    { code: 'conflicting_motion_selection_option' }
  )
  assert.throws(
    () => normalizeMotionSelectionOptions({
      recipe: MOTION_SELECTION_RECIPE_IDS.V2,
      loop_expectation: 'sometimes',
    }),
    { code: 'invalid_motion_selection_option', option: 'loop_expectation' }
  )
  assert.throws(
    () => normalizeMotionSelectionOptions({
      recipe: MOTION_SELECTION_RECIPE_IDS.V1_COMPAT,
      temporal_matte: MOTION_SELECTION_TEMPORAL_MATTE_MODES.EVIDENCE_ONLY,
    }),
    { code: 'invalid_motion_selection_option' }
  )
})

test('omitted false null and explicit v1 recipes preserve exact v1 selection reports', () => {
  const frames = Array.from({ length: 6 }, (_, index) => rectFrame({ x: index + 1 }))
  const baseline = selectMotionFrames(frames, { targetFrameCount: 4 })

  assert.deepEqual(
    selectMotionFrames(frames, { targetFrameCount: 4, motionSelection: false }),
    baseline
  )
  assert.deepEqual(
    selectMotionFrames(frames, { targetFrameCount: 4, motionSelection: null }),
    baseline
  )
  assert.deepEqual(
    selectMotionFrames(frames, {
      targetFrameCount: 4,
      motionSelection: { recipe: MOTION_SELECTION_RECIPE_IDS.V1_COMPAT },
    }),
    baseline
  )
  assert.equal(baseline.mode, undefined)
  assert.equal(baseline.schema_version, undefined)
  assert.ok(baseline.selected.every((frame) => /^[0-9a-f]{8}$/.test(frame.hash)))
})

test('v1 selection preserves aligned raw provenance without changing candidate choices', () => {
  const frames = Array.from({ length: 6 }, (_, index) => rectFrame({ x: index + 1 }))
  const baseline = selectMotionFrames(frames, { targetFrameCount: 4 })
  const provenance = frames.map((_, index) => ({
    candidate_index: index,
    raw_index: index * 2,
    timestamp_ms: null,
    duration_ms: null,
    timing_source: 'unavailable',
    source_entry: `frame_${index * 2}.png`,
  }))
  const result = selectMotionFrames(frames, {
    targetFrameCount: 4,
    frameProvenance: provenance,
  })

  assert.deepEqual(
    result.selected.map((frame) => frame.original_index),
    baseline.selected.map((frame) => frame.original_index)
  )
  assert.deepEqual(
    result.selected.map((frame) => frame.raw_index),
    baseline.selected.map((frame) => frame.original_index * 2)
  )
  assert.deepEqual(result.provenance, provenance)
})

test('v2 registration is bounded analysis-only and preserves raw provenance', () => {
  const frames = [
    rectFrame({ width: 128, height: 32, x: 20, y: 8, w: 16, h: 12 }),
    rectFrame({ width: 128, height: 32, x: 22, y: 8, w: 16, h: 12 }),
    rectFrame({ width: 128, height: 32, x: 19, y: 8, w: 16, h: 12 }),
  ]
  const originalBytes = frames.map((frame) => Array.from(frame.data))
  const frameProvenance = [
    {
      candidate_index: 0,
      raw_index: 0,
      timestamp_ms: 0,
      duration_ms: 40,
      timing_source: 'exact',
      source_entry: 'frame-000.png',
    },
    {
      candidate_index: 1,
      raw_index: 3,
      timestamp_ms: 120,
      duration_ms: 40,
      timing_source: 'derived_sampling',
      source_entry: 'frame-003.png',
    },
    {
      candidate_index: 2,
      raw_index: 6,
      timestamp_ms: null,
      duration_ms: null,
      timing_source: 'unavailable',
      source_entry: null,
    },
  ]

  const result = selectMotionFrames(frames, {
    targetFrameCount: 1,
    motionSelection: v2Options(),
    frameProvenance,
  })

  assert.equal(result.mode, 'motion_selection_report_v2')
  assert.equal(result.schema_version, 2)
  assert.equal(result.registration.analysis_raster.width, 64)
  assert.equal(result.registration.analysis_raster.height, 16)
  assert.ok(result.registration.frames.every((frame) => Math.abs(frame.shift_x) <= 3))
  assert.ok(result.registration.frames.every((frame) => Math.abs(frame.shift_y) <= 3))
  assert.equal(result.registration.search.analysis_only, true)
  assert.deepEqual(result.provenance, frameProvenance)
  assert.equal(result.selected[0].raw_index, 0)
  assert.match(result.selected[0].hash, /^[0-9a-f]{8}:[0-9a-f]{8}$/)
  assert.deepEqual(frames.map((frame) => Array.from(frame.data)), originalBytes)
})

test('v2 removes non-adjacent duplicates through global evidence', () => {
  const first = solidFrame([220, 30, 30, 255])
  const frames = [
    first,
    solidFrame([30, 220, 30, 255]),
    cloneFrame(first),
    solidFrame([30, 30, 220, 255]),
  ]

  const result = selectMotionFrames(frames, {
    targetFrameCount: 3,
    motionSelection: v2Options({ loop_expectation: 'once' }),
  })

  assert.deepEqual(result.selected.map((frame) => frame.original_index), [0, 1, 3])
  const duplicate = result.rejected.find((frame) => frame.original_index === 2)
  assert.equal(duplicate.reason, 'duplicate_frame')
  assert.equal(duplicate.duplicate_of, 0)
  assert.deepEqual(result.clusters.items[0].member_original_indexes, [0, 2])
})

test('v2 complete-link clustering does not transitively merge a near-duplicate chain', () => {
  const first = solidFrame([40, 80, 120, 255], 10, 10)
  const middle = recolorLeadingPixels(first, 5, [255, 80, 120, 255])
  const last = recolorLeadingPixels(first, 10, [255, 80, 120, 255])

  const result = selectMotionFrames([first, middle, last], {
    targetFrameCount: 2,
    motionSelection: v2Options({ loop_expectation: 'once' }),
  })

  assert.equal(result.clusters.algorithm, 'complete_link')
  assert.equal(result.clusters.items.length, 2)
  assert.deepEqual(result.clusters.items[0].member_original_indexes, [0, 1])
  assert.deepEqual(result.clusters.items[1].member_original_indexes, [2])
  assert.deepEqual(result.selected.map((frame) => frame.original_index), [0, 2])
  assert.ok(result.clusters.pair_comparison_count <= 3)
})

test('v2 static gate abstains from periodicity and reports target shortfall truthfully', () => {
  const frame = solidFrame([120, 80, 40, 255])
  const result = selectMotionFrames(
    [frame, cloneFrame(frame), cloneFrame(frame), cloneFrame(frame)],
    {
      targetFrameCount: 3,
      motionSelection: v2Options(),
    }
  )

  assert.equal(result.static_gate.status, 'not_applicable_static')
  assert.equal(result.periodicity.status, 'not_applicable_static')
  assert.equal(result.loop.seamless, null)
  assert.equal(result.status, 'insufficient_target')
  assert.deepEqual(result.selected.map((selected) => selected.original_index), [0])
  assert.equal(result.target.target_satisfied, false)
  assert.equal(result.target.shortfall_count, 2)
  assert.ok(result.warnings.includes('insufficient_distinct_phases'))
})

test('v2 static gate evaluates registered translation jitter in the analysis coordinate system', () => {
  const frames = [20, 24, 22, 23].map((x) => rectFrame({
    width: 128,
    height: 32,
    x,
    y: 8,
    w: 16,
    h: 12,
  }))
  const result = selectMotionFrames(frames, {
    targetFrameCount: 2,
    motionSelection: v2Options(),
  })

  assert.equal(result.clusters.items.length, 1)
  assert.equal(result.static_gate.status, 'not_applicable_static')
  assert.equal(result.static_gate.raw_bbox_center_range_source_pixels, 4)
  assert.equal(result.static_gate.raw_bbox_center_range_analysis_pixels, 2)
  assert.equal(result.periodicity.status, 'not_applicable_static')
  assert.equal(result.loop.seamless, null)
})

test('v2 detects a repeated period and selects one loop cycle without its closing repeat', () => {
  const cycle = [
    solidFrame([220, 30, 30, 255]),
    solidFrame([30, 220, 30, 255]),
    solidFrame([30, 30, 220, 255]),
    solidFrame([220, 180, 30, 255]),
  ]
  const frames = [...cycle, ...cycle.map(cloneFrame)]

  const result = selectMotionFrames(frames, {
    targetFrameCount: 4,
    motionSelection: v2Options({ loop_expectation: 'loop' }),
  })

  assert.equal(result.periodicity.status, 'detected')
  assert.equal(result.periodicity.selected_period, 4)
  assert.equal(result.phase_selection.effective_mode, 'loop')
  assert.deepEqual(result.selected.map((frame) => frame.original_index), [0, 1, 2, 3])
  assert.ok(result.selected.every((frame) => frame.original_index < 4))
  assert.equal(result.loop.periodic_cycle_detected, true)
  assert.ok(!result.warnings.includes('loop_period_not_confident'))
})

test('v2 rejects integer-multiple harmonics in favor of a clear fundamental period', () => {
  const first = solidFrame([230, 40, 40, 255])
  const second = solidFrame([40, 40, 230, 255])
  const frames = [
    first,
    second,
    cloneFrame(first),
    cloneFrame(second),
    cloneFrame(first),
    cloneFrame(second),
    cloneFrame(first),
    cloneFrame(second),
  ]

  const result = selectMotionFrames(frames, {
    targetFrameCount: 2,
    motionSelection: v2Options({ loop_expectation: 'auto' }),
  })

  assert.equal(result.periodicity.status, 'detected')
  assert.equal(result.periodicity.selected_period, 2)
  assert.ok(result.periodicity.harmonic_decisions.some(
    (decision) => decision.rejected_lag === 4 && decision.fundamental_lag === 2
  ))
  assert.deepEqual(result.selected.map((frame) => frame.original_index), [0, 1])
})

test('v2 abstains when a visually similar half-period cannot prove cluster repetition', () => {
  const phaseA = solidFrame([220, 40, 40, 255], 10, 10)
  const phaseB = solidFrame([40, 220, 40, 255], 10, 10)
  const phaseC = solidFrame([40, 40, 220, 255], 10, 10)
  const phaseD = solidFrame([80, 100, 140, 255], 10, 10)
  const phaseDVariant = recolorLeadingPixels(phaseD, 7, [120, 100, 140, 255])
  const cycle = [
    phaseA,
    phaseB,
    phaseC,
    phaseD,
    phaseA,
    phaseB,
    phaseC,
    phaseDVariant,
  ]
  const frames = [...cycle, ...cycle.map(cloneFrame)]
  const result = selectMotionFrames(frames, {
    targetFrameCount: 4,
    motionSelection: v2Options({ loop_expectation: 'auto' }),
  })

  const half = result.periodicity.candidates.find((candidate) => candidate.lag === 4)
  const full = result.periodicity.candidates.find((candidate) => candidate.lag === 8)
  assert.equal(half.cluster_repeat_ratio, 0.75)
  assert.equal(full.cluster_repeat_ratio, 1)
  assert.equal(result.periodicity.status, 'ambiguous_harmonic')
  assert.deepEqual(result.periodicity.ambiguous_lags, [4, 8])
  assert.equal(result.phase_selection.effective_mode, 'once')
  assert.ok(result.warnings.includes('ambiguous_harmonic'))
})

test('v2 once expectation remains monotonic and does not require seamless endpoints', () => {
  const frames = [
    solidFrame([220, 30, 30, 255]),
    solidFrame([180, 80, 30, 255]),
    solidFrame([100, 160, 30, 255]),
    solidFrame([30, 160, 100, 255]),
    solidFrame([30, 80, 180, 255]),
  ]
  const result = selectMotionFrames(frames, {
    targetFrameCount: 3,
    motionSelection: v2Options({ loop_expectation: 'once' }),
  })

  assert.equal(result.phase_selection.effective_mode, 'once')
  assert.deepEqual(result.selected.map((frame) => frame.original_index), [0, 2, 4])
  assert.ok(!result.warnings.includes('loop_not_seamless'))
  assert.ok(!result.warnings.includes('loop_period_not_confident'))
})

test('v2 temporal matte is evidence-only and cannot change selected indexes', () => {
  const frames = [
    rectFrame({ x: 1 }),
    rectFrame({ x: 5 }),
    rectFrame({ x: 9 }),
  ]
  const disabled = selectMotionFrames(frames, {
    targetFrameCount: 3,
    motionSelection: v2Options({ temporal_matte: 'disabled', loop_expectation: 'once' }),
  })
  const evidenceOnly = selectMotionFrames(frames, {
    targetFrameCount: 3,
    motionSelection: v2Options({
      temporal_matte: 'evidence_only',
      loop_expectation: 'once',
    }),
  })

  assert.deepEqual(
    evidenceOnly.selected.map((frame) => frame.original_index),
    disabled.selected.map((frame) => frame.original_index)
  )
  assert.equal(disabled.temporal_matte.status, 'disabled')
  assert.equal(evidenceOnly.temporal_matte.status, 'evidence_only')
  assert.equal(evidenceOnly.temporal_matte.modifies_pixels, false)
  assert.ok(evidenceOnly.temporal_matte.warnings.includes('temporal_matte_motion_confounded'))
})

test('v2 validates aligned provenance frame bounds and cancellation', () => {
  const frames = [solidFrame([20, 40, 60, 255]), solidFrame([60, 40, 20, 255])]
  assert.throws(
    () => selectMotionFrames(frames, {
      targetFrameCount: 1,
      motionSelection: v2Options(),
      frameProvenance: [{ candidate_index: 0, raw_index: 0 }],
    }),
    { code: 'invalid_motion_frame_provenance' }
  )
  assert.throws(
    () => selectMotionFrames(
      Array.from({ length: 65 }, () => cloneFrame(frames[0])),
      {
        targetFrameCount: 1,
        motionSelection: v2Options(),
      }
    ),
    { code: 'motion_selection_v2_frame_limit_exceeded', max_frame_count: 64 }
  )
  const controller = new AbortController()
  controller.abort(new Error('cancel requested'))
  assert.throws(
    () => selectMotionFrames(frames, {
      targetFrameCount: 1,
      motionSelection: v2Options(),
      signal: controller.signal,
    }),
    { code: 'cancelled', failure_status: 'cancelled' }
  )
})

test('async v2 yields between bounded stages and observes runtime cancellation', async () => {
  const frames = Array.from({ length: 64 }, (_, index) => rectFrame({
    width: 64,
    height: 64,
    x: 8 + (index % 4),
    y: 12,
    w: 20,
    h: 32,
    color: [40 + index, 80, 160, 255],
  }))
  const controller = new AbortController()
  const pending = selectMotionFramesAsync(frames, {
    targetFrameCount: 8,
    motionSelection: v2Options(),
    signal: controller.signal,
  })
  setTimeout(() => controller.abort(new Error('runtime cancel requested')), 0)

  await assert.rejects(
    pending,
    { code: 'cancelled', failure_status: 'cancelled' }
  )
})
