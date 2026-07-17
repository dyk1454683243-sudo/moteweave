import test from 'node:test'
import assert from 'node:assert/strict'

import sharp from 'sharp'

import {
  TWO_POINT_FIVE_D_MATERIAL_SOURCE_BENCHMARK_REVIEW_MODE,
  buildTwoPointFiveDMaterialSourceBenchmarkReview,
  renderTwoPointFiveDMaterialSourceBenchmarkReviewHtml,
  renderTwoPointFiveDMaterialSourceBenchmarkReviewMarkdown,
  renderTwoPointFiveDMaterialSourceBenchmarkReviewPng,
} from '../../src/two-point-five-d/materialSourceBenchmarkReview.js'

function makeCandidate({
  id = 'candidate_01',
  caseId = 'case_a',
  status = 'pass',
  warnings = [],
  blockingErrors = [],
  outputDir = `items/${caseId}/${id}`,
} = {}) {
  return {
    id,
    case_id: caseId,
    status,
    warnings,
    blocking_errors: blockingErrors,
    output_dir: outputDir,
  }
}

function makeReport({ status = 'pass', cases = [], summary = {} } = {}) {
  return {
    schema_version: 1,
    mode: 'two_point_five_d_material_source_benchmark_v1',
    status,
    run_id: 'review_unit',
    summary: {
      status,
      case_count: cases.length,
      candidate_count: cases.reduce((total, item) => total + item.candidates.length, 0),
      selected_validation: { pass: 0, warning: 0, fail: 0, error: 0 },
      candidate_validation: { pass: 0, warning: 0, fail: 0, error: 0 },
      selected_pass_rate: 0,
      selected_usable_rate: 0,
      stopped_early: false,
      failure_taxonomy: { top_categories: [] },
      ...summary,
    },
    cases,
    claim_boundary: 'Provider output is raw material source only.',
  }
}

function makeCase({
  id = 'case_a',
  selected = makeCandidate({ caseId: id }),
  candidates = [selected],
  selectionReason = 'candidate_01 selected from 1 candidates; passed local validation',
} = {}) {
  return {
    id,
    item_id: `${id}_v1`,
    description: id,
    output_dir: `items/${id}_v1`,
    candidates,
    candidate_selection: {
      schema_version: 1,
      mode: 'two_point_five_d_material_source_candidate_selection_v1',
      candidate_count: candidates.length,
      selected_candidate_id: selected?.id ?? null,
      selected_candidate_index: selected?.index ?? null,
      selected_status: selected?.status ?? 'error',
      selection_reason: selectionReason,
      ranking: selected ? [selected, ...candidates.filter((item) => item.id !== selected.id)] : candidates,
    },
  }
}

test('2.5D material-source benchmark review marks clean pass reports ready to expand', () => {
  const cases = [
    makeCase({ id: 'mossy_cliff', selected: makeCandidate({ caseId: 'mossy_cliff' }) }),
    makeCase({ id: 'dry_plateau', selected: makeCandidate({ caseId: 'dry_plateau' }) }),
  ]
  const report = makeReport({
    cases,
    summary: {
      selected_validation: { pass: 2, warning: 0, fail: 0, error: 0 },
      candidate_validation: { pass: 2, warning: 0, fail: 0, error: 0 },
      selected_pass_rate: 1,
      selected_usable_rate: 1,
      failure_taxonomy: { top_categories: [] },
    },
  })

  const review = buildTwoPointFiveDMaterialSourceBenchmarkReview(report)

  assert.equal(review.mode, TWO_POINT_FIVE_D_MATERIAL_SOURCE_BENCHMARK_REVIEW_MODE)
  assert.equal(review.status, 'ready_to_expand')
  assert.equal(review.release_ready, true)
  assert.equal(review.decision.next_action, 'run_larger_sample')
  assert.equal(review.decision.priority, 'P2')
  assert.equal(review.summary.selected_pass_rate, 1)
  assert.equal(review.selected_cases.length, 2)
  assert.deepEqual(review.top_issues, [])
})

test('2.5D material-source benchmark review turns usable warnings into extraction work', () => {
  const selected = makeCandidate({
    id: 'candidate_02',
    caseId: 'mossy_cliff',
    status: 'warning',
    warnings: ['material_source.low_contrast', 'quality_gate.warning_sample_count'],
  })
  const report = makeReport({
    status: 'warning',
    cases: [makeCase({ id: 'mossy_cliff', selected })],
    summary: {
      selected_validation: { pass: 0, warning: 1, fail: 0, error: 0 },
      candidate_validation: { pass: 0, warning: 1, fail: 0, error: 0 },
      selected_pass_rate: 0,
      selected_usable_rate: 1,
      failure_taxonomy: {
        top_categories: [
          { id: 'material_source.low_contrast', count: 1, examples: ['mossy_cliff/candidate_02'] },
          { id: 'quality_gate.warning_sample_count', count: 1, examples: ['mossy_cliff/candidate_02'] },
        ],
      },
    },
  })

  const review = buildTwoPointFiveDMaterialSourceBenchmarkReview(report)

  assert.equal(review.status, 'review_warnings')
  assert.equal(review.release_ready, false)
  assert.equal(review.decision.next_action, 'improve_material_extraction')
  assert.equal(review.decision.priority, 'P1')
  assert.equal(review.summary.selected_warning_count, 2)
  assert.equal(review.top_issues[0].severity, 'warning')
  assert.match(review.decision.rationale, /local material extraction/i)
})

test('2.5D material-source benchmark review separates provider route blockers from quality evidence', () => {
  const selected = makeCandidate({
    caseId: 'mossy_cliff',
    status: 'error',
    blockingErrors: ['provider_material_source_generation_failed'],
    outputDir: null,
  })
  const candidates = [
    selected,
    makeCandidate({ id: 'candidate_02', caseId: 'mossy_cliff', status: 'error', blockingErrors: ['provider_material_source_generation_failed'], outputDir: null }),
    makeCandidate({ id: 'candidate_03', caseId: 'mossy_cliff', status: 'error', blockingErrors: ['provider_material_source_generation_failed'], outputDir: null }),
  ]
  const report = makeReport({
    status: 'fail',
    cases: [makeCase({ id: 'mossy_cliff', selected, candidates })],
    summary: {
      selected_validation: { pass: 0, warning: 0, fail: 0, error: 1 },
      candidate_validation: { pass: 0, warning: 0, fail: 0, error: 3 },
      selected_pass_rate: 0,
      selected_usable_rate: 0,
      stopped_early: true,
      failure_taxonomy: {
        top_categories: [
          { id: 'provider_material_source_generation_failed', count: 3, examples: ['mossy_cliff/candidate_01'] },
        ],
      },
    },
  })

  const review = buildTwoPointFiveDMaterialSourceBenchmarkReview(report)

  assert.equal(review.status, 'provider_blocked')
  assert.equal(review.release_ready, false)
  assert.equal(review.decision.next_action, 'fix_provider_route')
  assert.equal(review.decision.priority, 'P0')
  assert.equal(review.summary.provider_error_count, 3)
  assert.equal(review.summary.selected_blocking_error_count, 1)
  assert.match(review.decision.rationale, /provider/i)
})

test('2.5D material-source benchmark review renders provider-free handoff markdown', () => {
  const selected = makeCandidate({
    id: 'candidate_02',
    caseId: 'mossy_cliff',
    status: 'warning',
    warnings: ['material_source.low_contrast'],
    outputDir: 'items/mossy_cliff_v1/candidate_02',
  })
  const report = makeReport({
    status: 'warning',
    cases: [makeCase({ id: 'mossy_cliff', selected })],
    summary: {
      selected_validation: { pass: 0, warning: 1, fail: 0, error: 0 },
      candidate_validation: { pass: 0, warning: 1, fail: 0, error: 0 },
      selected_pass_rate: 0,
      selected_usable_rate: 1,
      failure_taxonomy: {
        top_categories: [
          { id: 'material_source.low_contrast', count: 1, examples: ['mossy_cliff/candidate_02'] },
        ],
      },
    },
  })
  const review = buildTwoPointFiveDMaterialSourceBenchmarkReview(report)
  const markdown = renderTwoPointFiveDMaterialSourceBenchmarkReviewMarkdown(review)

  assert.match(markdown, /2\.5D Material Source Benchmark Review/)
  assert.match(markdown, /Next action: improve_material_extraction/)
  assert.match(markdown, /material_source\.low_contrast: 1/)
  assert.match(markdown, /mossy_cliff/)
  assert.match(markdown, /Provider output is raw material source only/)
})

test('2.5D material-source benchmark review renders screenshot-friendly html', () => {
  const selected = makeCandidate({
    id: 'candidate_01',
    caseId: 'mossy_cliff',
    status: 'pass',
    outputDir: 'items/mossy_cliff_v1/candidate_01',
  })
  const report = makeReport({
    cases: [makeCase({ id: 'mossy_cliff', selected })],
    summary: {
      selected_validation: { pass: 1, warning: 0, fail: 0, error: 0 },
      candidate_validation: { pass: 1, warning: 0, fail: 0, error: 0 },
      selected_pass_rate: 1,
      selected_usable_rate: 1,
      failure_taxonomy: { top_categories: [] },
    },
  })
  const review = buildTwoPointFiveDMaterialSourceBenchmarkReview(report)
  const html = renderTwoPointFiveDMaterialSourceBenchmarkReviewHtml(review)

  assert.match(html, /<!doctype html>/)
  assert.match(html, /2\.5D Material Source Benchmark Review/)
  assert.match(html, /run_larger_sample/)
  assert.match(html, /mossy_cliff/)
  assert.match(html, /No top issues recorded/)
  assert.doesNotMatch(html, /<script/i)
})

test('2.5D material-source benchmark review renders screenshot png', async () => {
  const selected = makeCandidate({
    id: 'candidate_01',
    caseId: 'mossy_cliff',
    status: 'pass',
    outputDir: 'items/mossy_cliff_v1/candidate_01',
  })
  const report = makeReport({
    cases: [makeCase({ id: 'mossy_cliff', selected })],
    summary: {
      selected_validation: { pass: 1, warning: 0, fail: 0, error: 0 },
      candidate_validation: { pass: 1, warning: 0, fail: 0, error: 0 },
      selected_pass_rate: 1,
      selected_usable_rate: 1,
      failure_taxonomy: { top_categories: [] },
    },
  })
  const review = buildTwoPointFiveDMaterialSourceBenchmarkReview(report)
  const png = await renderTwoPointFiveDMaterialSourceBenchmarkReviewPng(review)
  const metadata = await sharp(png).metadata()

  assert.equal(metadata.format, 'png')
  assert.equal(metadata.width, 1440)
  assert.ok(metadata.height >= 760)
})
