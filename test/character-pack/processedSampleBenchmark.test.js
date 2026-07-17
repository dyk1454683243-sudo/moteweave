import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  runProcessedSampleBenchmark,
  summarizeProcessedReports,
} from '../../src/character-pack/benchmark/processedSampleBenchmark.js'
import {
  FIXED_REGION_MOTION_LAYOUT_ID,
  LEGACY_OCAD_MOTION_LAYOUT_ID,
} from '../../src/character-pack/sourceLayouts.js'

async function writeDebugReport(root, name, report) {
  const dir = path.join(root, name)
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, 'debug_report.json'), JSON.stringify(report, null, 2))
}

function makeReport({ status, warnings = [], sourceLayout = 'topdown_rpg_v0', backgroundMode = 'flood', motionCount = 0, jitterTransitions = 0 }) {
  return {
    source_layout: { id: sourceLayout },
    background_mode: backgroundMode,
    normalization: {
      auto_correction: { applied_count: 1 },
      motion_stabilization: { applied_count: motionCount },
    },
    validation: {
      status,
      warnings,
      blocking_errors: status === 'fail' ? ['frame_2_cropped'] : [],
      metrics: {
        halo_score: warnings.includes('halo_score_high') ? 0.05 : 0.01,
        edge_pressure: { severe_frame_count: warnings.includes('edge_pressure_high') ? 9 : 0 },
        subpixel_jitter: {
          max_center_x_fractional_spread: jitterTransitions ? 0.5 : 0,
          max_half_pixel_x_transitions: jitterTransitions,
        },
      },
    },
    frames: [
      { normalized_anchor: { x: 48, y: 88 } },
      { normalized_anchor: { x: 50, y: 88 } },
      { normalized_anchor: { x: 49, y: 89 } },
    ],
  }
}

test('summarizeProcessedReports aggregates validation, drift, and failure-mode distributions', () => {
  const summary = summarizeProcessedReports([
    { id: 'a', path: 'generated/a/debug_report.json', report: makeReport({ status: 'pass', motionCount: 2, jitterTransitions: 3 }) },
    { id: 'b', path: 'generated/b/debug_report.json', report: makeReport({ status: 'warning', warnings: ['halo_score_high', 'edge_pressure_high'], sourceLayout: LEGACY_OCAD_MOTION_LAYOUT_ID, backgroundMode: 'edge_palette' }) },
    { id: 'c', path: 'generated/c/debug_report.json', report: makeReport({ status: 'fail' }) },
  ])

  assert.equal(summary.total, 3)
  assert.deepEqual(summary.validation, { pass: 1, warning: 1, fail: 1, unknown: 0 })
  assert.equal(summary.source_layouts[FIXED_REGION_MOTION_LAYOUT_ID], 1)
  assert.equal(summary.background_modes.edge_palette, 1)
  assert.equal(summary.failure_modes.halo, 1)
  assert.equal(summary.failure_modes.edge_pressure, 1)
  assert.equal(summary.failure_modes.cropped, 1)
  assert.ok(summary.failure_taxonomy.top_categories.some((category) => category.id === 'background.halo'))
  assert.ok(summary.failure_taxonomy.top_categories.some((category) => category.id === 'structure.cropped'))
  assert.equal(summary.metrics.anchor_spread_x.avg, 2)
  assert.equal(summary.metrics.motion_stabilization_applied_count.max, 2)
  assert.equal(summary.metrics.subpixel_jitter_max_half_pixel_x_transitions.max, 3)
})

test('runProcessedSampleBenchmark scans generated debug reports and writes JSON plus Markdown', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'processed-sample-bench-'))
  const generated = path.join(root, 'generated')
  await writeDebugReport(generated, 'job_real_a', makeReport({ status: 'pass', motionCount: 1 }))
  await writeDebugReport(generated, 'job_real_b', makeReport({ status: 'warning', warnings: ['frame_4_anchor_drift'] }))

  const report = await runProcessedSampleBenchmark({
    rootDir: generated,
    outputDir: path.join(root, 'out'),
    runId: 'processed_test',
  })

  assert.equal(report.summary.total, 2)
  assert.equal(report.items[0].id, 'job_real_a')
  assert.equal(report.items[1].id, 'job_real_b')
  assert.equal(report.summary.failure_modes.anchor_drift, 1)
  assert.equal(report.items[1].failure_taxonomy.primary, 'alignment.anchor_drift')
  assert.equal(typeof report.items[0].metrics.subpixel_jitter_max_half_pixel_x_transitions, 'number')

  const savedJson = JSON.parse(await readFile(path.join(root, 'out', 'processed_test', 'processed_sample_benchmark.json'), 'utf8'))
  const savedMd = await readFile(path.join(root, 'out', 'processed_test', 'processed_sample_benchmark.md'), 'utf8')
  assert.equal(savedJson.run_id, 'processed_test')
  assert.match(savedMd, /Processed Character Pack Benchmark/)
  assert.match(savedMd, /Half-Pixel Jitter/)
})
