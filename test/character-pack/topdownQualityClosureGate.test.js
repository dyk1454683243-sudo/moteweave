import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

import {
  TOPDOWN_QUALITY_CLOSURE_CASE_IDS,
  buildTopdownQualityClosurePlan,
  runTopdownQualityClosureGate,
} from '../../src/character-pack/benchmark/topdownQualityClosureGate.js'

test('buildTopdownQualityClosurePlan defaults to high-risk topdown cases and 1K/2K matrix', () => {
  const plan = buildTopdownQualityClosurePlan({ runId: 'topdown_quality_test' })

  assert.equal(plan.run_id, 'topdown_quality_test')
  assert.equal(plan.preset, 'topdown_rpg_v0')
  assert.deepEqual(plan.case_ids, TOPDOWN_QUALITY_CLOSURE_CASE_IDS)
  assert.deepEqual(plan.image_sizes, ['1K', '2K'])
  assert.deepEqual(
    plan.runs.map((run) => ({ run_id: run.run_id, image_size: run.image_size, sample_size: run.sample_size })),
    [
      { run_id: 'topdown_quality_test_1k', image_size: '1K', sample_size: TOPDOWN_QUALITY_CLOSURE_CASE_IDS.length },
      { run_id: 'topdown_quality_test_2k', image_size: '2K', sample_size: TOPDOWN_QUALITY_CLOSURE_CASE_IDS.length },
    ]
  )
})

test('runTopdownQualityClosureGate writes aggregate report for matrix benchmark runs', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'topdown-quality-closure-'))
  const calls = []

  const report = await runTopdownQualityClosureGate({
    outputDir,
    runId: 'topdown_quality_test',
    runBenchmark: async (options) => {
      calls.push(options)
      return {
        run_id: options.runId,
        preset: options.preset,
        template_file: 'motion_template_ocha_8x8.png',
        image_config: options.imageConfig,
        summary: {
          total: options.cases.length,
          validation: { pass: options.imageConfig.image_size === '2K' ? 4 : 3, warning: 0, fail: 1, unknown: 0 },
          failures: { total: 1, model_error: 0, post_processing: 1, unexpected_error: 0 },
          failure_taxonomy: {
            primary: { 'structure.empty_frame': 1 },
            top_categories: [{ id: 'structure.empty_frame', count: 1, severity: 'error', examples: ['frame_6_empty'] }],
          },
          pass_rate: options.imageConfig.image_size === '2K' ? 0.8 : 0.6,
          usable_rate: options.imageConfig.image_size === '2K' ? 0.8 : 0.6,
        },
        items: [
          {
            case: { id: 'blue_wizard' },
            validation: {
              status: 'fail',
              blocking_errors: ['frame_6_empty', 'frame_24_cropped'],
              warnings: [],
            },
          },
        ],
      }
    },
  })

  assert.deepEqual(calls.map((call) => call.imageConfig.image_size), ['1K', '2K'])
  assert.deepEqual(calls[0].cases.map((item) => item.id), TOPDOWN_QUALITY_CLOSURE_CASE_IDS)
  assert.equal(calls[0].preset, 'topdown_rpg_v0')
  assert.equal(report.run_id, 'topdown_quality_test')
  assert.equal(report.runs.length, 2)
  assert.deepEqual(report.comparison.map((item) => [item.image_size, item.pass_rate, item.usable_rate]), [
    ['1K', 0.6, 0.6],
    ['2K', 0.8, 0.8],
  ])
  assert.equal(report.runs[0].repair_summary.issue_count, 2)
  assert.deepEqual(report.runs[0].repair_summary.by_issue, { empty_frame: 1, cropped_frame: 1 })
  assert.deepEqual(report.comparison[0].repair_top_frames, [
    { frame: 6, count: 1 },
    { frame: 24, count: 1 },
  ])

  const saved = JSON.parse(await readFile(path.join(outputDir, 'topdown_quality_test', 'quality_closure_report.json'), 'utf8'))
  assert.equal(saved.run_id, 'topdown_quality_test')
  assert.equal(saved.runs[0].run_id, 'topdown_quality_test_1k')
  assert.match(await readFile(path.join(outputDir, 'topdown_quality_test', 'quality_closure_report.md'), 'utf8'), /Topdown Quality Closure Gate/)
})
