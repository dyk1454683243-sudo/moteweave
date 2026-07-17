import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  buildSceneTileReport,
  summarizeSceneTileReportItems,
  writeSceneTileReport,
} from '../../src/scene-pack/benchmark/sceneTileReport.js'

function qualityGate(status, { warnings = [], blocking_errors = [], gates = [], gate_policy } = {}) {
  return {
    status,
    warnings,
    blocking_errors,
    ...(gate_policy ? { gate_policy } : {}),
    gates,
    failure_taxonomy: [
      ...warnings.map((category) => ({ category, count: 1, examples: [status] })),
      ...blocking_errors.map((category) => ({ category, count: 1, examples: [status] })),
    ],
  }
}

function candidateSelection({ selected = 'candidate_02', selectedStatus = 'pass' } = {}) {
  return {
    schema_version: 1,
    mode: 'scene_tile_candidate_selection_v0',
    candidate_count: 2,
    selected_candidate_id: selected,
    selected_status: selectedStatus,
    selection_reason: `${selected} selected from 2 candidates`,
    ranking: [
      {
        id: selected,
        status: selectedStatus,
        blocking_errors: [],
        warnings: [],
        failure_taxonomy: [],
        score: { status_rank: selectedStatus === 'pass' ? 0 : 1 },
      },
      {
        id: 'candidate_01',
        status: 'fail',
        blocking_errors: ['tile.visual_seam_mismatch'],
        warnings: ['tile.duplicate_runtime_tile'],
        failure_taxonomy: [
          { category: 'tile.visual_seam_mismatch', count: 1, examples: ['candidate_01'] },
        ],
        score: { status_rank: 2 },
      },
    ],
  }
}

test('summarizeSceneTileReportItems aggregates pass, warning, fail, and gate status counts', () => {
  const summary = summarizeSceneTileReportItems([
    { id: 'pass', quality_gate: qualityGate('pass', { gates: [{ id: 'visual_seams', status: 'pass' }] }) },
    { id: 'warn', quality_gate: qualityGate('warning', { warnings: ['tile.duplicate_runtime_tile'], gates: [{ id: 'visual_seams', status: 'warning' }] }) },
    { id: 'fail', quality_gate: qualityGate('fail', { blocking_errors: ['tile.visual_seam_mismatch'], gates: [{ id: 'visual_seams', status: 'fail' }] }) },
  ])

  assert.equal(summary.total, 3)
  assert.deepEqual(summary.validation, { pass: 1, warning: 1, fail: 1, unknown: 0 })
  assert.equal(summary.pass_rate, 0.3333)
  assert.equal(summary.sample_size, 3)
  assert.equal(summary.usable_rate, 0.6667)
  assert.deepEqual(summary.gate_policy.raw_tile_quality, { warn: 0, strict: 0, unknown: 3 })
  assert.deepEqual(summary.correction_paths, [{ label: 'none', count: 3, raw_vs_conditioned_review_count: 0 }])
  assert.equal(summary.correction_dependency.dependency_level, 'low')
  assert.equal(summary.correction_dependency.corrected_item_count, 0)
  assert.equal(summary.correction_dependency.uncorrected_item_count, 3)
  assert.equal(summary.correction_dependency.style_snap.changed_pixel_ratio.count, 0)
  assert.equal(summary.candidate_selection.total_candidates, 0)
  assert.deepEqual(summary.gates[0], { id: 'visual_seams', pass: 1, warning: 1, fail: 1, not_run: 0, unknown: 0 })
  assert.equal(summary.failure_taxonomy.top_categories[0].id, 'tile.duplicate_runtime_tile')
})

test('writeSceneTileReport writes JSON and Markdown from explicit artifact dirs', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'scene-tile-report-'))
  const passDir = path.join(root, 'scene_pass')
  const warningDir = path.join(root, 'scene_warning')
  const outputDir = path.join(root, 'reports')
  await mkdir(passDir)
  await mkdir(warningDir)
  await writeFile(
    path.join(passDir, 'quality_gate.json'),
    JSON.stringify(qualityGate('pass', { gates: [{ id: 'metadata_seams', status: 'pass' }] }), null, 2)
  )
  await writeFile(
    path.join(warningDir, 'quality_gate.json'),
    JSON.stringify(qualityGate('warning', {
      warnings: ['tile.source_atlas_continuity'],
      gate_policy: { raw_tile_quality: 'strict' },
      gates: [{ id: 'metadata_seams', status: 'pass' }, { id: 'source_atlas_structure', status: 'warning' }],
    }), null, 2)
  )
  await writeFile(
    path.join(warningDir, 'style_correction.json'),
    JSON.stringify({ mode: 'palette_snap', output_mutation: 'palette_snap', changed_pixel_ratio: 0.5 }, null, 2)
  )
  await writeFile(
    path.join(warningDir, 'edge_conditioning.json'),
    JSON.stringify({ mode: 'edge_aware_conditioning_v1', enabled: true, band: 3, changed_pixel_ratio: 0.05 }, null, 2)
  )
  await writeFile(
    path.join(warningDir, 'tile_conditioning_review.json'),
    JSON.stringify({ status: 'pass' }, null, 2)
  )
  await writeFile(
    path.join(warningDir, 'candidate_selection.json'),
    JSON.stringify(candidateSelection(), null, 2)
  )

  const report = await writeSceneTileReport({
    sceneDirs: [passDir, warningDir],
    outputDir,
    runId: 'scene_report_test',
  })

  const saved = JSON.parse(await readFile(path.join(outputDir, 'scene_report_test', 'scene_tile_report.json'), 'utf8'))
  const markdown = await readFile(path.join(outputDir, 'scene_report_test', 'scene_tile_report.md'), 'utf8')

  assert.equal(report.summary.total, 2)
  assert.equal(report.summary.sample_size, 2)
  assert.equal(saved.summary.validation.pass, 1)
  assert.equal(saved.summary.validation.warning, 1)
  assert.deepEqual(saved.summary.gate_policy.raw_tile_quality, { warn: 0, strict: 1, unknown: 1 })
  assert.equal(saved.summary.correction_paths.find((item) => item.label === 'style:palette_snap+edge:edge_aware_conditioning_v1').raw_vs_conditioned_review_count, 1)
  assert.equal(saved.summary.correction_dependency.dependency_level, 'high')
  assert.equal(saved.summary.correction_dependency.corrected_item_count, 1)
  assert.equal(saved.summary.correction_dependency.style_and_edge_correction_count, 1)
  assert.equal(saved.summary.correction_dependency.raw_vs_conditioned_review_count, 1)
  assert.equal(saved.summary.correction_dependency.style_snap.item_count, 1)
  assert.equal(saved.summary.correction_dependency.style_snap.heavy_mutation_count, 1)
  assert.equal(saved.summary.correction_dependency.style_snap.changed_pixel_ratio.average, 0.5)
  assert.equal(saved.summary.correction_dependency.edge_conditioning.item_count, 1)
  assert.equal(saved.summary.correction_dependency.edge_conditioning.changed_pixel_ratio.average, 0.05)
  assert.equal(saved.summary.correction_dependency.edge_conditioning.review_status.pass, 1)
  assert.deepEqual(saved.summary.correction_dependency.signals, ['style_snap_heavy_mutation'])
  assert.equal(saved.items[1].gate_policy.raw_tile_quality, 'strict')
  assert.equal(saved.items[1].correction_path.label, 'style:palette_snap+edge:edge_aware_conditioning_v1')
  assert.equal(saved.items[1].candidate_selection.selected_candidate_id, 'candidate_02')
  assert.equal(saved.summary.candidate_selection.total_candidates, 2)
  assert.equal(saved.summary.candidate_selection.failed_candidate_count, 1)
  assert.equal(saved.summary.candidate_selection.failed_candidate_taxonomy.top_categories[0].id, 'tile.visual_seam_mismatch')
  assert.match(markdown, /Scene Tile Report: scene_report_test/)
  assert.match(markdown, /Raw tile policy/)
  assert.match(markdown, /Correction Paths/)
  assert.match(markdown, /Correction Dependency/)
  assert.match(markdown, /Style snap avg changed-pixel ratio/)
  assert.match(markdown, /Candidate Selection/)
  assert.match(markdown, /candidate_02 selected from 2 candidates/)
  assert.match(markdown, /source_atlas_structure/)
  assert.match(markdown, /tile.source_atlas_continuity/)
})

test('buildSceneTileReport records missing quality gates as unknown artifacts', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'scene-tile-report-missing-'))
  const missingDir = path.join(root, 'scene_missing')
  await mkdir(missingDir)

  const report = await buildSceneTileReport({
    sceneDirs: [missingDir],
    runId: 'missing_quality_gate',
  })

  assert.equal(report.summary.validation.unknown, 1)
  assert.deepEqual(report.items[0].quality_gate.warnings, ['missing_quality_gate'])
  assert.equal(report.summary.failure_taxonomy.top_categories[0].id, 'artifact.missing_quality_gate')
})
