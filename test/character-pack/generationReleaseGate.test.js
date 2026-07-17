import test from 'node:test'
import assert from 'node:assert/strict'

import { DEFAULT_T2I_GOLDEN_REVIEW_THRESHOLDS } from '../../src/character-pack/benchmark/t2iGoldenReview.js'
import {
  evaluateProductionSheetReleaseGate,
  evaluateQualityCharacterReleaseGate,
  GENERATION_RELEASE_GATE_MODE,
  QUALITY_CHARACTER_RELEASE_THRESHOLDS,
  resolveGenerationArtifactDisposition,
} from '../../src/character-pack/generationReleaseGate.js'
import { FIXED_REGION_MOTION_LAYOUT_ID } from '../../src/character-pack/sourceLayouts.js'

function passingValidation() {
  return { status: 'pass', warnings: [], blocking_errors: [] }
}

function passingClosure() {
  return { status: 'pass', release_ready: true, gates: [] }
}

function passingProductionDebugReport(overrides = {}) {
  return {
    source_layout: { id: 'topdown_rpg_v0' },
    validation: passingValidation(),
    quality_closure: passingClosure(),
    ...overrides,
  }
}

function boundaryQualityInput(overrides = {}) {
  return {
    score: 615,
    bbox: { x: 10, y: 10, w: 64, h: 96 },
    metrics: {
      visible_pixel_count: 1000,
      unique_color_count: 8,
      palette_changed_pixel_ratio: 0.7,
      outline_pixel_ratio: 0.08,
      bbox_width_ratio: 0.72,
      bbox_height_ratio: 0.86,
      bbox_area_ratio: 0.42,
      center_offset_ratio: 0.1,
      edge_margin_ratio: 0.035,
    },
    ...overrides,
  }
}

test('generation release gate shares the frozen golden review thresholds', () => {
  assert.strictEqual(QUALITY_CHARACTER_RELEASE_THRESHOLDS, DEFAULT_T2I_GOLDEN_REVIEW_THRESHOLDS)
  assert.equal(Object.isFrozen(QUALITY_CHARACTER_RELEASE_THRESHOLDS), true)
})

test('artifact disposition releases only when every canonical gate field agrees', () => {
  const passing = {
    generationReleaseGate: {
      schema_version: 1,
      mode: GENERATION_RELEASE_GATE_MODE,
      generation_mode: 'quality_character_v0',
      policy: 'golden_review_hard_thresholds_v1',
      status: 'pass',
      release_ready: true,
      blocking_errors: [],
      warnings: [],
      evidence: {},
    },
    releaseReady: true,
    artifactDisposition: 'release',
  }
  assert.equal(resolveGenerationArtifactDisposition(passing), 'release')

  const conflicts = [
    { generationReleaseGate: { ...passing.generationReleaseGate, schema_version: 2 } },
    { generationReleaseGate: { ...passing.generationReleaseGate, mode: 'unknown_gate' } },
    { generationReleaseGate: { ...passing.generationReleaseGate, policy: 'unknown_policy' } },
    { generationReleaseGate: { ...passing.generationReleaseGate, status: 'fail' } },
    { generationReleaseGate: { ...passing.generationReleaseGate, release_ready: false } },
    { generationReleaseGate: { ...passing.generationReleaseGate, blocking_errors: ['blocked'] } },
    { generationReleaseGate: { ...passing.generationReleaseGate, warnings: null } },
    { generationReleaseGate: { ...passing.generationReleaseGate, evidence: null } },
    { releaseReady: false },
    { artifactDisposition: 'diagnostic_only' },
  ]
  for (const conflict of conflicts) {
    assert.equal(resolveGenerationArtifactDisposition({ ...passing, ...conflict }), 'diagnostic_only')
  }
  assert.equal(resolveGenerationArtifactDisposition({}), null)
})

test('production release gate passes strict evidence and treats source quality as not applicable for non-fixed layouts', () => {
  const result = evaluateProductionSheetReleaseGate({
    debugReport: passingProductionDebugReport(),
  })

  assert.equal(result.schema_version, 1)
  assert.equal(result.mode, GENERATION_RELEASE_GATE_MODE)
  assert.equal(result.generation_mode, 'production_sheet_v0')
  assert.equal(result.status, 'pass')
  assert.equal(result.release_ready, true)
  assert.deepEqual(result.blocking_errors, [])
  assert.equal(result.evidence.source_quality.applicable, false)
  assert.equal(result.evidence.source_quality.status, 'not_applicable')
})

test('production release gate requires clean source quality evidence for fixed-region layouts', () => {
  const debugReport = passingProductionDebugReport({
    source_layout: { id: FIXED_REGION_MOTION_LAYOUT_ID },
    source_quality: passingValidation(),
  })
  const pass = evaluateProductionSheetReleaseGate({ debugReport })
  const missing = evaluateProductionSheetReleaseGate({
    debugReport: { ...debugReport, source_quality: null },
  })

  assert.equal(pass.release_ready, true)
  assert.equal(pass.evidence.source_quality.applicable, true)
  assert.equal(missing.release_ready, false)
  assert.ok(missing.blocking_errors.includes('source_quality.evidence_missing'))
})

test('production release gate fails closed when required evidence is missing', () => {
  const cases = [
    {
      name: 'source layout identity',
      debugReport: { ...passingProductionDebugReport(), source_layout: null },
      expected: 'source_layout.evidence_missing',
    },
    {
      name: 'unsupported source layout identity',
      debugReport: { ...passingProductionDebugReport(), source_layout: { id: 'unknown_layout_v0' } },
      expected: 'source_layout.unsupported',
    },
    {
      name: 'validation object',
      debugReport: passingProductionDebugReport({ validation: null }),
      expected: 'validation.evidence_missing',
    },
    {
      name: 'validation status',
      debugReport: passingProductionDebugReport({ validation: { warnings: [], blocking_errors: [] } }),
      expected: 'validation.status_missing',
    },
    {
      name: 'validation warnings',
      debugReport: passingProductionDebugReport({ validation: { status: 'pass', blocking_errors: [] } }),
      expected: 'validation.warnings_missing',
    },
    {
      name: 'validation blocking errors',
      debugReport: passingProductionDebugReport({ validation: { status: 'pass', warnings: [] } }),
      expected: 'validation.blocking_errors_missing',
    },
    {
      name: 'fixed source quality status',
      debugReport: passingProductionDebugReport({
        source_layout: { id: FIXED_REGION_MOTION_LAYOUT_ID },
        source_quality: { warnings: [], blocking_errors: [] },
      }),
      expected: 'source_quality.status_missing',
    },
    {
      name: 'fixed source quality warnings',
      debugReport: passingProductionDebugReport({
        source_layout: { id: FIXED_REGION_MOTION_LAYOUT_ID },
        source_quality: { status: 'pass', blocking_errors: [] },
      }),
      expected: 'source_quality.warnings_missing',
    },
    {
      name: 'fixed source quality blocking errors',
      debugReport: passingProductionDebugReport({
        source_layout: { id: FIXED_REGION_MOTION_LAYOUT_ID },
        source_quality: { status: 'pass', warnings: [] },
      }),
      expected: 'source_quality.blocking_errors_missing',
    },
    {
      name: 'quality closure object',
      debugReport: passingProductionDebugReport({ quality_closure: null }),
      expected: 'quality_closure.evidence_missing',
    },
    {
      name: 'quality closure status',
      debugReport: passingProductionDebugReport({ quality_closure: { release_ready: true, gates: [] } }),
      expected: 'quality_closure.status_missing',
    },
    {
      name: 'quality closure release readiness',
      debugReport: passingProductionDebugReport({ quality_closure: { status: 'pass', gates: [] } }),
      expected: 'quality_closure.not_release_ready',
    },
    {
      name: 'quality closure gate evidence',
      debugReport: passingProductionDebugReport({ quality_closure: { status: 'pass', release_ready: true } }),
      expected: 'quality_closure.gates_missing',
    },
  ]

  for (const item of cases) {
    const result = evaluateProductionSheetReleaseGate({ debugReport: item.debugReport })
    assert.equal(result.release_ready, false, item.name)
    assert.ok(result.blocking_errors.includes(item.expected), item.name)
  }
})

test('production release gate rejects non-pass statuses, warnings, and blocking errors', () => {
  const cases = [
    {
      name: 'validation status',
      debugReport: passingProductionDebugReport({
        validation: { status: 'warning', warnings: [], blocking_errors: [] },
      }),
      expected: 'validation.status_not_pass',
    },
    {
      name: 'validation warnings',
      debugReport: passingProductionDebugReport({
        validation: { status: 'pass', warnings: ['motion_warning'], blocking_errors: [] },
      }),
      expected: 'validation.warnings_present',
    },
    {
      name: 'validation blockers',
      debugReport: passingProductionDebugReport({
        validation: { status: 'pass', warnings: [], blocking_errors: ['cropped_frame'] },
      }),
      expected: 'validation.blocking_errors_present',
    },
    {
      name: 'fixed source quality status',
      debugReport: passingProductionDebugReport({
        source_layout: { id: FIXED_REGION_MOTION_LAYOUT_ID },
        source_quality: { status: 'warning', warnings: [], blocking_errors: [] },
      }),
      expected: 'source_quality.status_not_pass',
    },
    {
      name: 'fixed source quality warnings',
      debugReport: passingProductionDebugReport({
        source_layout: { id: FIXED_REGION_MOTION_LAYOUT_ID },
        source_quality: { status: 'pass', warnings: ['source_warning'], blocking_errors: [] },
      }),
      expected: 'source_quality.warnings_present',
    },
    {
      name: 'fixed source quality blockers',
      debugReport: passingProductionDebugReport({
        source_layout: { id: FIXED_REGION_MOTION_LAYOUT_ID },
        source_quality: { status: 'pass', warnings: [], blocking_errors: ['empty_region'] },
      }),
      expected: 'source_quality.blocking_errors_present',
    },
    {
      name: 'quality closure status',
      debugReport: passingProductionDebugReport({
        quality_closure: { status: 'warning', release_ready: true, gates: [] },
      }),
      expected: 'quality_closure.status_not_pass',
    },
    {
      name: 'quality closure readiness',
      debugReport: passingProductionDebugReport({
        quality_closure: { status: 'pass', release_ready: false, gates: [] },
      }),
      expected: 'quality_closure.not_release_ready',
    },
    {
      name: 'quality closure nested gate status',
      debugReport: passingProductionDebugReport({
        quality_closure: {
          status: 'pass',
          release_ready: true,
          gates: [{ id: 'motion_consistency', status: 'warning' }],
        },
      }),
      expected: 'quality_closure.gates_not_pass',
    },
  ]

  for (const item of cases) {
    const result = evaluateProductionSheetReleaseGate({ debugReport: item.debugReport })
    assert.equal(result.status, 'fail', item.name)
    assert.ok(result.blocking_errors.includes(item.expected), item.name)
  }
})

test('quality character release gate passes exact hard and soft threshold boundaries', () => {
  const cases = [
    { name: 'all preferred and bbox thresholds', input: boundaryQualityInput(), warning: null },
    {
      name: 'hard score minimum',
      input: boundaryQualityInput({ score: 600 }),
      warning: 'quality_character.score_below_usable',
    },
    {
      name: 'maximum visible pixels',
      input: (() => {
        const input = boundaryQualityInput()
        input.metrics.visible_pixel_count = 220000
        return input
      })(),
      warning: null,
    },
  ]

  for (const item of cases) {
    const result = evaluateQualityCharacterReleaseGate(item.input)
    assert.equal(result.schema_version, 1, item.name)
    assert.equal(result.mode, GENERATION_RELEASE_GATE_MODE, item.name)
    assert.equal(result.generation_mode, 'quality_character_v0', item.name)
    assert.equal(result.status, 'pass', item.name)
    assert.equal(result.release_ready, true, item.name)
    assert.deepEqual(result.blocking_errors, [], item.name)
    if (item.warning) assert.ok(result.warnings.includes(item.warning), item.name)
    else assert.deepEqual(result.warnings, [], item.name)
  }
})

test('quality character release gate rejects every value beyond a hard boundary', () => {
  const cases = [
    { name: 'missing bbox', patch: { bbox: null }, expected: 'quality_character_empty' },
    { name: 'empty image', metric: ['visible_pixel_count', 0], expected: 'quality_character_empty' },
    { name: 'score below 600', patch: { score: 599.999 }, expected: 'quality_character_score_below_warning' },
    { name: 'too many visible pixels', metric: ['visible_pixel_count', 220001], expected: 'quality_character_visible_area_too_large' },
    { name: 'bbox too wide', metric: ['bbox_width_ratio', 0.7201], expected: 'quality_character_bbox_too_wide' },
    { name: 'bbox too tall', metric: ['bbox_height_ratio', 0.8601], expected: 'quality_character_bbox_too_tall' },
    { name: 'bbox area too large', metric: ['bbox_area_ratio', 0.4201], expected: 'quality_character_bbox_too_large' },
    { name: 'off center', metric: ['center_offset_ratio', 0.1001], expected: 'quality_character_off_center' },
    { name: 'edge margin too small', metric: ['edge_margin_ratio', 0.0349], expected: 'quality_character_edge_margin_too_small' },
  ]

  for (const item of cases) {
    const input = boundaryQualityInput(item.patch)
    if (item.metric) input.metrics[item.metric[0]] = item.metric[1]
    const result = evaluateQualityCharacterReleaseGate(input)
    assert.equal(result.release_ready, false, item.name)
    assert.ok(result.blocking_errors.includes(item.expected), item.name)
  }
})

test('quality character release gate fails closed for every missing hard metric', () => {
  const hardMetrics = [
    'visible_pixel_count',
    'bbox_width_ratio',
    'bbox_height_ratio',
    'bbox_area_ratio',
    'center_offset_ratio',
    'edge_margin_ratio',
  ]

  const missingScore = evaluateQualityCharacterReleaseGate(boundaryQualityInput({ score: null }))
  assert.ok(missingScore.blocking_errors.includes('quality_character_score_missing'))

  for (const metric of hardMetrics) {
    const input = boundaryQualityInput()
    delete input.metrics[metric]
    const result = evaluateQualityCharacterReleaseGate(input)
    assert.equal(result.release_ready, false, metric)
    assert.ok(result.blocking_errors.includes(`quality_character_metrics_missing:${metric}`), metric)
  }
})

test('quality character release gate reports soft warnings without blocking release', () => {
  const cases = [
    { name: 'score', patch: { score: 614.999 }, expected: 'quality_character.score_below_usable' },
    { name: 'visible pixels', metric: ['visible_pixel_count', 999], expected: 'quality_character.visible_pixels_below_preferred' },
    { name: 'unique colors', metric: ['unique_color_count', 7], expected: 'quality_character.unique_colors_below_preferred' },
    { name: 'palette change', metric: ['palette_changed_pixel_ratio', 0.7001], expected: 'quality_character.palette_change_above_preferred' },
    { name: 'outline ratio', metric: ['outline_pixel_ratio', 0.0801], expected: 'quality_character.outline_ratio_above_preferred' },
  ]

  for (const item of cases) {
    const input = boundaryQualityInput(item.patch)
    if (item.metric) input.metrics[item.metric[0]] = item.metric[1]
    const result = evaluateQualityCharacterReleaseGate(input)
    assert.equal(result.release_ready, true, item.name)
    assert.ok(result.warnings.includes(item.expected), item.name)
  }
})

test('quality character release gate does not fail closed for absent soft-only metrics', () => {
  const input = boundaryQualityInput()
  delete input.metrics.unique_color_count
  delete input.metrics.palette_changed_pixel_ratio
  delete input.metrics.outline_pixel_ratio

  const result = evaluateQualityCharacterReleaseGate(input)

  assert.equal(result.release_ready, true)
  assert.deepEqual(result.blocking_errors, [])
  assert.deepEqual(result.warnings, [])
})
