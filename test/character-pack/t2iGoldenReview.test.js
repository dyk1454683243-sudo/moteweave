import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildT2iGoldenReview,
  buildT2iGoldenClosureAnalysis,
  buildT2iGoldenReviewHtml,
  buildT2iGoldenReviewMarkdown,
} from '../../src/character-pack/benchmark/t2iGoldenReview.js'

function sampleReport() {
  return {
    run_id: 't2i_sample',
    t2i_mode: 'quality_character_v0',
    candidate_count: 2,
    image_config: { image_size: '2K', aspect_ratio: '1:1' },
    generation_options: { candidateCount: 2 },
    items: [
      {
        case_id: 'hero_ok',
        locale: 'en',
        description: 'blue hero',
        status: 'done',
        selected_index: 2,
        selected_score: 620,
        candidate_selection: {
          candidates: [
            { index: 1, score: 610, status: 'pass', metrics: { visible_pixel_count: 1200, unique_color_count: 10 } },
            { index: 2, score: 620, status: 'pass', metrics: { visible_pixel_count: 1800, unique_color_count: 16, palette_changed_pixel_ratio: 0.2, outline_pixel_ratio: 0.04 } },
          ],
        },
      },
      {
        case_id: 'hero_weak',
        locale: 'zh',
        description: 'weak hero',
        status: 'done',
        selected_index: 1,
        selected_score: 590,
        candidate_selection: {
          candidates: [
            { index: 1, score: 590, status: 'pass', metrics: { visible_pixel_count: 420, unique_color_count: 4, palette_changed_pixel_ratio: 0.82 } },
          ],
        },
      },
    ],
  }
}

test('t2i golden review classifies usable cases and issue taxonomy', () => {
  const review = buildT2iGoldenReview(sampleReport(), {
    artifactStatusByCaseId: {
      hero_ok: {
        source: { exists: true, href: 'hero_ok/source.png' },
        result: { exists: true, href: 'hero_ok/t2i_result.png' },
        prompt: { exists: true, href: 'hero_ok/prompt.txt' },
        generation: { exists: true, href: 'hero_ok/generation.json' },
        candidates: [{ index: 2, artifact: { exists: true, href: 'hero_ok/candidate_2.png' } }],
      },
      hero_weak: {
        source: { exists: true, href: 'hero_weak/source.png' },
        result: { exists: false, href: 'hero_weak/t2i_result.png' },
        prompt: { exists: true, href: 'hero_weak/prompt.txt' },
        generation: { exists: true, href: 'hero_weak/generation.json' },
      },
    },
  })

  assert.equal(review.schema_version, 't2i_golden_review_v0_2')
  assert.equal(review.summary.total, 2)
  assert.equal(review.summary.usable_count, 1)
  assert.equal(review.summary.usable_rate, 0.5)
  assert.equal(review.quality_gate.status, 'fail')
  assert.equal(review.items[0].review_status, 'pass')
  assert.equal(review.items[0].candidate_scores[1].artifact.href, 'hero_ok/candidate_2.png')
  assert.equal(review.items[1].review_status, 'fail')
  assert.equal(review.summary.issue_taxonomy.missing_result_file, 1)
  assert.equal(review.summary.issue_taxonomy.score_below_warning, 1)
  assert.equal(review.closure_analysis.status, 'needs_action')
  assert.equal(review.closure_analysis.primary_action, 'artifact_and_provider_reliability')
  assert.deepEqual(review.closure_analysis.priority_actions.map((item) => item.id), [
    'artifact_and_provider_reliability',
    'candidate_selection_and_sampling',
    'pixel_finishing_calibration',
    'prompt_scale_contract',
  ])
  assert.equal(review.closure_analysis.priority_actions[0].priority, 'P0')
})

test('t2i golden review evaluates the published release candidate while retaining diagnostic selection evidence', () => {
  const review = buildT2iGoldenReview({
    run_id: 'release_selection_alignment',
    t2i_mode: 'quality_character_v0',
    candidate_count: 2,
    items: [
      {
        case_id: 'release_candidate_wins',
        locale: 'en',
        description: 'compact release candidate',
        status: 'done',
        selected_index: 1,
        selected_score: 700,
        release_selected_index: 2,
        release_selected_score: 620,
        candidate_selection: {
          selected_index: 1,
          selected_score: 700,
          release_selected_index: 2,
          release_selected_score: 620,
          candidates: [
            {
              index: 1,
              score: 700,
              status: 'fail',
              release_ready: false,
              metrics: {
                visible_pixel_count: 360000,
                unique_color_count: 32,
                bbox_area_ratio: 0.68,
                edge_margin_ratio: 0.02,
              },
            },
            {
              index: 2,
              score: 620,
              status: 'pass',
              release_ready: true,
              metrics: {
                visible_pixel_count: 1800,
                unique_color_count: 16,
                palette_changed_pixel_ratio: 0.2,
                outline_pixel_ratio: 0.04,
                bbox_width_ratio: 0.4,
                bbox_height_ratio: 0.7,
                bbox_area_ratio: 0.28,
                center_offset_ratio: 0.02,
                edge_margin_ratio: 0.1,
              },
            },
          ],
        },
      },
    ],
  }, {
    artifactStatusByCaseId: {
      release_candidate_wins: {
        source: { exists: true, href: 'release_candidate_wins/source.png' },
        result: { exists: true, href: 'release_candidate_wins/t2i_result.png' },
        prompt: { exists: true, href: 'release_candidate_wins/prompt.txt' },
        generation: { exists: true, href: 'release_candidate_wins/generation.json' },
      },
    },
  })

  const item = review.items[0]
  assert.equal(item.review_status, 'pass')
  assert.equal(item.selected_index, 1)
  assert.equal(item.selected_score, 700)
  assert.equal(item.diagnostic_selected_index, 1)
  assert.equal(item.diagnostic_selected_score, 700)
  assert.equal(item.release_selected_index, 2)
  assert.equal(item.release_selected_score, 620)
  assert.equal(item.reviewed_selection_role, 'release')
  assert.equal(item.reviewed_index, 2)
  assert.equal(item.reviewed_score, 620)
  assert.equal(item.metrics.bbox_area_ratio, 0.28)
  assert.deepEqual(item.issues, [])
  assert.equal(review.summary.average_selected_score, 700)
  assert.equal(review.summary.average_reviewed_score, 620)
  assert.match(buildT2iGoldenReviewMarkdown(review), /release #2/)
  assert.match(buildT2iGoldenReviewHtml(review), /release #2 score 620/)
})

test('t2i golden review fails closed when release selection evidence is inconsistent', () => {
  const review = buildT2iGoldenReview({
    run_id: 'release_selection_inconsistent',
    t2i_mode: 'quality_character_v0',
    candidate_count: 1,
    items: [
      {
        case_id: 'missing_release_candidate',
        locale: 'en',
        description: 'inconsistent evidence',
        status: 'done',
        selected_index: 1,
        selected_score: 620,
        release_selected_index: 2,
        release_selected_score: 620,
        candidate_selection: {
          selected_index: 1,
          selected_score: 620,
          release_selected_index: 3,
          release_selected_score: 621,
          candidates: [{
            index: 1,
            score: 620,
            status: 'pass',
            release_ready: true,
            metrics: {},
          }],
        },
      },
    ],
  }, {
    artifactStatusByCaseId: {
      missing_release_candidate: {
        source: { exists: true },
        result: { exists: true },
        prompt: { exists: true },
        generation: { exists: true },
      },
    },
  })

  const item = review.items[0]
  assert.equal(item.review_status, 'fail')
  assert.equal(item.usable, false)
  assert.ok(item.issues.includes('release_selection_index_mismatch'))
  assert.ok(item.issues.includes('release_selection_score_mismatch'))
  assert.ok(item.issues.includes('release_candidate_missing'))
})

test('t2i golden review renders markdown and html gallery', () => {
  const review = buildT2iGoldenReview(sampleReport(), {
    artifactStatusByCaseId: {
      hero_ok: {
        source: { exists: true, href: 'hero_ok/source.png' },
        result: { exists: true, href: 'hero_ok/t2i_result.png' },
        prompt: { exists: true, href: 'hero_ok/prompt.txt' },
        generation: { exists: true, href: 'hero_ok/generation.json' },
        candidates: [{ index: 2, artifact: { exists: true, href: 'hero_ok/candidate_2.png' } }],
      },
    },
  })
  const markdown = buildT2iGoldenReviewMarkdown(review)
  const html = buildT2iGoldenReviewHtml(review)

  assert.match(markdown, /T2I Golden Review t2i_sample/)
  assert.match(markdown, /score_below_warning/)
  assert.match(markdown, /Closure Analysis/)
  assert.match(markdown, /candidate_selection_and_sampling/)
  assert.match(html, /hero_ok\/candidate_2\.png/)
  assert.match(html, /Issue Taxonomy/)
  assert.match(html, /Closure Analysis/)
})

test('t2i golden review flags oversized display art as not production-usable', () => {
  const review = buildT2iGoldenReview({
    run_id: 't2i_oversized',
    t2i_mode: 'quality_character_v0',
    candidate_count: 1,
    image_config: { image_size: '2K', aspect_ratio: '1:1' },
    generation_options: { candidateCount: 1 },
    items: [
      {
        case_id: 'huge_guardian',
        locale: 'en',
        description: 'huge guardian',
        status: 'done',
        selected_index: 1,
        selected_score: 700,
        candidate_selection: {
          candidates: [
            {
              index: 1,
              score: 700,
              status: 'pass',
              metrics: {
                visible_pixel_count: 360000,
                unique_color_count: 32,
                palette_changed_pixel_ratio: 0.2,
                outline_pixel_ratio: 0.004,
                bbox_width_ratio: 0.82,
                bbox_height_ratio: 0.9,
                bbox_area_ratio: 0.68,
                center_offset_ratio: 0.02,
                edge_margin_ratio: 0.02,
              },
            },
          ],
        },
      },
    ],
  }, {
    artifactStatusByCaseId: {
      huge_guardian: {
        source: { exists: true, href: 'huge_guardian/source.png' },
        result: { exists: true, href: 'huge_guardian/t2i_result.png' },
        prompt: { exists: true, href: 'huge_guardian/prompt.txt' },
        generation: { exists: true, href: 'huge_guardian/generation.json' },
      },
    },
  })

  assert.equal(review.items[0].review_status, 'fail')
  assert.equal(review.items[0].usable, false)
  assert.deepEqual(review.items[0].issues.filter((issue) => issue.startsWith('bbox_')), [
    'bbox_too_wide',
    'bbox_too_tall',
    'bbox_too_large',
  ])
  assert.equal(review.summary.issue_taxonomy.high_visible_pixel_count, 1)
  assert.equal(review.summary.issue_taxonomy.tight_edge_margin, 1)
  assert.equal(review.closure_analysis.primary_action, 'prompt_scale_contract')
  assert.deepEqual(review.closure_analysis.priority_actions.map((item) => [item.id, item.priority]), [
    ['prompt_scale_contract', 'P0'],
  ])
})

test('t2i golden closure analysis maps review issues to technical owners', () => {
  const analysis = buildT2iGoldenClosureAnalysis({
    quality_gate: { status: 'fail' },
    summary: { total: 3 },
    items: [
      {
        case_id: 'too_large',
        issues: ['high_visible_pixel_count', 'bbox_too_large'],
        candidate_scores: [{ index: 1, score: 620, status: 'pass' }],
        selected_score: 620,
      },
      {
        case_id: 'mutated',
        issues: ['high_palette_change'],
        candidate_scores: [{ index: 1, score: 610, status: 'pass' }],
        selected_score: 610,
      },
      {
        case_id: 'wrong_selected',
        issues: ['score_below_usable'],
        candidate_scores: [
          { index: 1, score: 608, status: 'pass' },
          { index: 2, score: 630, status: 'pass' },
        ],
        selected_score: 608,
      },
    ],
  })

  assert.equal(analysis.status, 'needs_action')
  assert.deepEqual(analysis.priority_actions.map((item) => item.id), [
    'prompt_scale_contract',
    'candidate_selection_and_sampling',
    'pixel_finishing_calibration',
  ])
  assert.deepEqual(analysis.priority_actions[0].issue_counts, {
    bbox_too_large: 1,
    high_visible_pixel_count: 1,
  })
  assert.equal(analysis.priority_actions[1].issue_counts.selected_non_best_score, 1)
  assert.equal(analysis.priority_actions[2].layer, 'pixel_finishing')
})

test('t2i golden review fails blank images but exempts missing metrics', () => {
  const makeItem = (caseId, metrics) => ({
    case_id: caseId,
    status: 'done',
    selected_index: 1,
    selected_score: 650,
    candidate_selection: {
      selected_index: 1,
      candidates: [{ index: 1, score: 650, status: 'pass', metrics }],
    },
  })
  const blankMetrics = {
    visible_pixel_count: 0,
    unique_color_count: 0,
    palette_changed_pixel_ratio: 0,
    outline_pixel_ratio: 0,
    bbox_width_ratio: 0,
    bbox_height_ratio: 0,
    bbox_area_ratio: 0,
    center_offset_ratio: 0,
    edge_margin_ratio: 0,
  }
  const review = buildT2iGoldenReview(
    { items: [makeItem('blank_image', blankMetrics), makeItem('missing_metrics', {})] },
    {}
  )

  const blank = review.items.find((item) => item.case_id === 'blank_image')
  assert.equal(blank.review_status, 'fail')
  assert.equal(blank.usable, false)
  assert.ok(blank.issues.includes('low_visible_pixel_count'))
  assert.ok(blank.issues.includes('tight_edge_margin'))

  const missing = review.items.find((item) => item.case_id === 'missing_metrics')
  assert.equal(missing.review_status, 'pass')
  assert.equal(missing.usable, true)
  assert.deepEqual(missing.issues, [])
})
