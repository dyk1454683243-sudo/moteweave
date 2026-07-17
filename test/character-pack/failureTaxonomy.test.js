import test from 'node:test'
import assert from 'node:assert/strict'

import {
  classifyBenchmarkItem,
  classifyValidationMessages,
  summarizeFailureTaxonomy,
} from '../../src/character-pack/failureTaxonomy.js'

test('classifyValidationMessages maps blocking structure failures', () => {
  assert.equal(classifyValidationMessages({ blocking_errors: ['frame_6_empty'] }).primary, 'structure.empty_frame')
  assert.equal(classifyValidationMessages({ blocking_errors: ['frame_2_cropped'] }).primary, 'structure.cropped')
  assert.equal(classifyValidationMessages({ blocking_errors: ['frame_count_mismatch'] }).primary, 'structure.frame_count')
})

test('classifyValidationMessages maps warnings to taxonomy buckets', () => {
  assert.equal(classifyValidationMessages({ warnings: ['walk_down_low_motion'] }).primary, 'motion.low_motion')
  assert.equal(classifyValidationMessages({ warnings: ['frame_1_anchor_drift'] }).primary, 'alignment.anchor_drift')
  assert.equal(classifyValidationMessages({ warnings: ['frame_1_baseline_drift'] }).primary, 'alignment.baseline_drift')
  assert.equal(classifyValidationMessages({ warnings: ['halo_score_high'] }).primary, 'background.halo')
  assert.equal(classifyValidationMessages({ warnings: ['edge_pressure_high'] }).primary, 'composition.edge_pressure')
  assert.equal(classifyValidationMessages({ warnings: ['source_region_edge_pressure_high'] }).primary, 'layout.source_region_edge_pressure')
  assert.equal(classifyValidationMessages({ warnings: ['dual_matte_inconsistent'] }).primary, 'background.dual_matte')
})

test('classifyValidationMessages keeps examples and counts repeated buckets', () => {
  const taxonomy = classifyValidationMessages({
    blocking_errors: ['frame_6_empty', 'frame_7_empty'],
    warnings: ['halo_score_high'],
  })

  assert.equal(taxonomy.primary, 'structure.empty_frame')
  assert.equal(taxonomy.severity, 'error')
  assert.deepEqual(taxonomy.categories[0], {
    id: 'structure.empty_frame',
    severity: 'error',
    count: 2,
    examples: ['frame_6_empty', 'frame_7_empty'],
  })
  assert.equal(taxonomy.categories[1].id, 'background.halo')
})

test('classifyValidationMessages does not classify clean pass metrics as failures', () => {
  const taxonomy = classifyValidationMessages({
    status: 'pass',
    warnings: [],
    blocking_errors: [],
    metrics: { duplicate_frames: [{ frames: [0, 1] }] },
  })

  assert.equal(taxonomy.primary, null)
  assert.deepEqual(taxonomy.categories, [])
})

test('classifyBenchmarkItem maps provider and pipeline failures', () => {
  assert.equal(classifyBenchmarkItem({ failure: { mode: 'model_error' } }).primary, 'provider.model_error')
  assert.equal(classifyBenchmarkItem({ failure: { mode: 'post_processing' } }).primary, 'pipeline.post_processing')
  assert.equal(classifyBenchmarkItem({ failure: { mode: 'unexpected_error' } }).primary, 'pipeline.unexpected_error')
})

test('classifyBenchmarkItem prefers validation root cause before post-processing wrapper', () => {
  const taxonomy = classifyBenchmarkItem({
    validation: { status: 'fail', blocking_errors: ['frame_6_empty'], warnings: [] },
    failure: { mode: 'post_processing', reason: 'frame_6_empty' },
  })

  assert.equal(taxonomy.primary, 'structure.empty_frame')
  assert.ok(taxonomy.categories.some((category) => category.id === 'pipeline.post_processing'))
})

test('summarizeFailureTaxonomy aggregates top categories', () => {
  const summary = summarizeFailureTaxonomy([
    { validation: { status: 'fail', blocking_errors: ['frame_6_empty'], warnings: [] } },
    { validation: { status: 'fail', blocking_errors: ['frame_7_empty'], warnings: [] } },
    { validation: { status: 'warning', warnings: ['halo_score_high'], blocking_errors: [] } },
    { failure: { mode: 'model_error', reason: 'provider rejected request' } },
  ])

  assert.equal(summary.total, 4)
  assert.equal(summary.classified, 4)
  assert.equal(summary.top_categories[0].id, 'structure.empty_frame')
  assert.equal(summary.top_categories[0].count, 2)
  assert.ok(summary.top_categories.some((category) => category.id === 'background.halo'))
  assert.ok(summary.top_categories.some((category) => category.id === 'provider.model_error'))
})
