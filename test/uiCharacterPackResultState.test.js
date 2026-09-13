import test from 'node:test'
import assert from 'node:assert/strict'

import {
  characterPackQualityReportNeedsReview,
  characterPackJobStatusKey,
  characterPackResultState,
  characterPackResultStatusKey,
  characterPackResultToastKey,
} from '../src/ui/characterPack/resultState.js'

test('Character Pack terminal results use ready, needs review, and failed states', () => {
  assert.equal(
    characterPackResultState({
      status: 'done',
      release_ready: true,
      artifact_disposition: 'release',
    }),
    'ready',
  )
  assert.equal(
    characterPackResultState({
      status: 'done',
      release_ready: false,
      artifact_disposition: 'diagnostic_only',
    }),
    'needs_review',
  )
  assert.equal(
    characterPackResultState({ status: 'done' }, { reviewRequired: true }),
    'needs_review',
  )
  assert.equal(
    characterPackResultState({ status: 'done' }, { releaseBlocked: true }),
    'needs_review',
  )
  assert.equal(
    characterPackResultState({
      status: 'done',
      release_gate: { warnings: ['manual_review_required'] },
    }),
    'needs_review',
  )
  assert.equal(
    characterPackResultState({
      status: 'done',
      release_gate: { status: 'warning', release_ready: true },
    }),
    'needs_review',
  )
  assert.equal(
    characterPackResultState({
      status: 'done',
      release_gate: {},
    }),
    'needs_review',
  )
  assert.equal(
    characterPackResultState({
      status: 'done',
      failure_status: 'failed_validation',
    }),
    'failed',
  )

  for (const status of [
    'failed_quality_gate',
    'failed_post_processing',
    'failed_model_error',
    'failed_safety_filter',
    'failed_future_contract',
  ]) {
    assert.equal(characterPackResultState({ status }), 'failed', status)
  }
})

test('Character Pack treats malformed or non-passing quality reports as review evidence', () => {
  assert.equal(characterPackQualityReportNeedsReview(null), true)
  assert.equal(characterPackQualityReportNeedsReview({}), true)
  assert.equal(
    characterPackQualityReportNeedsReview({
      validation: { status: 'unknown' },
    }),
    true,
  )
  assert.equal(
    characterPackQualityReportNeedsReview({
      validation: { status: 'warning' },
    }),
    true,
  )
  assert.equal(
    characterPackQualityReportNeedsReview({
      validation: { status: 'pass', warnings: ['manual_review_required'] },
    }),
    true,
  )
  assert.equal(
    characterPackQualityReportNeedsReview({
      validation: { status: 'pass', warnings: [], blocking_errors: [] },
    }),
    false,
  )
})

test('Character Pack non-terminal jobs never claim a terminal result', () => {
  assert.equal(characterPackResultState(null), null)
  for (const status of ['queued', 'generating', 'post_processing']) {
    assert.equal(characterPackResultState({ status }), null, status)
  }
})

test('Character Pack status keys preserve known terminal evidence before report loading', () => {
  assert.equal(
    characterPackJobStatusKey({
      status: 'done',
      failure_status: 'failed_validation',
      debug_report_url: '/debug-report.json',
    }),
    'character.result.failed.title',
  )
  assert.equal(
    characterPackJobStatusKey(
      {
        status: 'done',
        debug_report_url: '/debug-report.json',
      },
      { releaseBlocked: true },
    ),
    'character.result.needsReview.title',
  )
  assert.equal(
    characterPackJobStatusKey({
      status: 'done',
      debug_report_url: '/debug-report.json',
    }),
    'character.job.status.postProcessing',
  )
  assert.equal(
    characterPackJobStatusKey(
      {
        status: 'done',
        debug_report_url: '/debug-report.json',
      },
      { reviewRequired: false },
    ),
    'character.result.ready.title',
  )
})

test('Character Pack result state maps to localized status and toast keys', () => {
  assert.equal(
    characterPackResultStatusKey('ready'),
    'character.result.ready.title',
  )
  assert.equal(
    characterPackResultStatusKey('needs_review'),
    'character.result.needsReview.title',
  )
  assert.equal(
    characterPackResultStatusKey('failed'),
    'character.result.failed.title',
  )
  assert.equal(
    characterPackResultToastKey('ready'),
    'character.toast.ready',
  )
  assert.equal(
    characterPackResultToastKey('needs_review'),
    'character.toast.needsReview',
  )
  assert.equal(
    characterPackResultToastKey('failed'),
    'character.toast.failed',
  )
  assert.equal(characterPackResultToastKey(null), null)
})
