import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

import {
  evaluateOpenRouterQualityGate,
  runOpenRouterCharacterBenchmark,
  selectOpenRouterBenchmarkCases,
  summarizeOpenRouterBenchmark,
  summarizeDuplicateFrameReuse,
} from '../../src/character-pack/benchmark/openRouterBenchmark.js'
import {
  FIXED_REGION_MOTION_LAYOUT_ID,
  LEGACY_OCAD_MOTION_LAYOUT_ID,
} from '../../src/character-pack/sourceLayouts.js'

test('runOpenRouterCharacterBenchmark writes JSON and Markdown reports from generated sources', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'openrouter-benchmark-'))
  const fixture = await readFile('test/fixtures/character-pack/topdown_rpg_v0_sample_hero.png')
  const calls = []

  const result = await runOpenRouterCharacterBenchmark({
    cases: [{ id: 'wizard', description: 'a blue robed wizard with a wooden staff' }],
    variantsPerCase: 1,
    outputDir: root,
    runId: 'openrouter_bench_test',
    preset: 'topdown_rpg_v0',
    providerPresetId: 'mock-provider-preset',
    generateSource: async (request) => {
      calls.push(request)
      return {
        buffer: fixture,
        provider: 'openrouter',
        model: 'mock/image',
        prompt: 'mock prompt',
        promptContract: {
          schema_version: 1,
          contract_version: 'character_prompt_contract_v1_1',
          preset: 'topdown_rpg_v0',
          layout_id: 'topdown_rpg_v0',
          layout_kind: 'uniform_grid',
          validation_expectations: ['exact_8x8_grid'],
        },
        inputImages: { template: true, reference: false },
        templateName: 'motion_template_ocha_8x8.png',
        referenceName: null,
        providerPresetId: request.providerPresetId,
      }
    },
  })

  assert.equal(result.run_id, 'openrouter_bench_test')
  assert.equal(result.summary.total, 1)
  assert.equal(result.summary.validation.pass, 1)
  assert.equal(result.summary.failures.total, 0)
  assert.equal(result.summary.failure_taxonomy.classified, 0)
  assert.equal(result.items[0].case.id, 'wizard')
  assert.equal(result.items[0].variant, 1)
  assert.equal(result.items[0].generation.template_file, 'motion_template_ocha_8x8.png')
  assert.equal(result.items[0].generation.provider_preset_id, 'mock-provider-preset')
  assert.equal(result.items[0].generation.model, 'mock/image')
  assert.equal(result.items[0].generation.prompt_contract.contract_version, 'character_prompt_contract_v1_1')
  assert.equal(result.items[0].generation.prompt_contract.layout_id, 'topdown_rpg_v0')
  assert.equal(result.items[0].artifacts.files.row_gif_count, 16)
  assert.equal(result.items[0].artifacts.row_gif_previews.length, 16)
  assert.equal(result.items[0].artifacts.row_gif_previews[0].url, undefined)
  assert.match(result.markdown, /Project Three OpenRouter Benchmark/)
  assert.match(result.markdown, /motion_template_ocha_8x8\.png/)
  assert.match(result.markdown, /\| Case \| Variant \| Status \| Validation \| Taxonomy \| Halo \| Expected reuse \| Unexpected dupes \| Failure \|/)
  assert.doesNotMatch(result.markdown, /\| Case \| Variant \| Status \| Validation \| Taxonomy \| Halo \| Duplicates \| Failure \|/)
  assert.equal(calls[0].templateImage.name, 'motion_template_ocha_8x8.png')
  assert.equal(calls[0].providerPresetId, 'mock-provider-preset')

  const saved = JSON.parse(await readFile(path.join(root, 'openrouter_bench_test', 'benchmark_report.json'), 'utf8'))
  assert.equal(saved.summary.total, 1)
  assert.match(await readFile(path.join(root, 'openrouter_bench_test', 'benchmark_report.md'), 'utf8'), /wizard/)
})

test('summarizeOpenRouterBenchmark aggregates validation and failure modes', () => {
  const summary = summarizeOpenRouterBenchmark([
    { status: 'done', validation: { status: 'pass' }, quality: { halo_score: 0.1, duplicate_group_count: 1 } },
    { status: 'done', validation: { status: 'warning' }, quality: { halo_score: 0.3, duplicate_group_count: 2 } },
    { status: 'failed_model_error', failure: { mode: 'model_error' } },
    { status: 'failed_post_processing', validation: { status: 'fail' }, failure: { mode: 'post_processing' } },
  ])

  assert.equal(summary.total, 4)
  assert.deepEqual(summary.validation, { pass: 1, warning: 1, fail: 1, unknown: 1 })
  assert.deepEqual(summary.failures, { total: 2, model_error: 1, post_processing: 1, unexpected_error: 0 })
  assert.deepEqual(summary.top_warnings, [])
  assert.equal(summary.metrics.halo_score.avg, 0.2)
  assert.equal(summary.metrics.duplicate_group_count.max, 2)
  assert.ok(summary.failure_taxonomy.top_categories.some((category) => category.id === 'provider.model_error'))
  assert.ok(summary.failure_taxonomy.top_categories.some((category) => category.id === 'pipeline.post_processing'))
})

test('summarizeOpenRouterBenchmark aggregates failure taxonomy buckets', () => {
  const summary = summarizeOpenRouterBenchmark([
    { validation: { status: 'fail', blocking_errors: ['frame_6_empty'], warnings: [] }, failure: { mode: 'post_processing', reason: 'frame_6_empty' } },
    { validation: { status: 'warning', blocking_errors: [], warnings: ['halo_score_high'] } },
    { validation: { status: 'unknown' }, failure: { mode: 'model_error', reason: 'provider rejected request' } },
  ])

  assert.equal(summary.failure_taxonomy.top_categories[0].id, 'structure.empty_frame')
  assert.ok(summary.failure_taxonomy.top_categories.some((category) => category.id === 'background.halo'))
  assert.ok(summary.failure_taxonomy.top_categories.some((category) => category.id === 'provider.model_error'))
})

test('runOpenRouterCharacterBenchmark preserves prompt contract metadata when post-processing fails', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'openrouter-benchmark-failure-'))
  const promptContract = {
    schema_version: 1,
    contract_version: 'character_prompt_contract_v1_1',
    preset: 'topdown_rpg_v0',
    layout_id: 'topdown_rpg_v0',
    layout_kind: 'uniform_grid',
    validation_expectations: ['exact_8x8_grid'],
  }

  const result = await runOpenRouterCharacterBenchmark({
    cases: [{ id: 'broken', description: 'a broken generated source' }],
    variantsPerCase: 1,
    outputDir: root,
    runId: 'openrouter_bench_failure_test',
    generateSource: async () => ({
      buffer: Buffer.from('not-a-png'),
      provider: 'openrouter',
      model: 'mock/image',
      prompt: 'mock prompt',
      promptContract,
      inputImages: { template: true, reference: false, palette: false },
      templateName: 'motion_template_ocha_8x8.png',
      referenceName: null,
      paletteName: null,
    }),
    processSheet: async () => {
      throw Object.assign(new Error('post process exploded'), { status: 'failed_post_processing' })
    },
  })

  assert.equal(result.items[0].status, 'failed_post_processing')
  assert.equal(result.items[0].generation.provider, 'openrouter')
  assert.equal(result.items[0].generation.model, 'mock/image')
  assert.deepEqual(result.items[0].generation.prompt_contract, promptContract)
  assert.equal(result.items[0].failure.mode, 'post_processing')
  assert.equal(result.items[0].failure_taxonomy.primary, 'pipeline.post_processing')
})

test('runOpenRouterCharacterBenchmark passes the selected preset into post-processing source layout', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'openrouter-benchmark-source-layout-'))
  let processOptions = null

  await runOpenRouterCharacterBenchmark({
    cases: [{ id: 'fixed_region_case', description: 'fixed-region source' }],
    variantsPerCase: 1,
    outputDir: root,
    runId: 'openrouter_bench_source_layout_test',
    preset: LEGACY_OCAD_MOTION_LAYOUT_ID,
    loadTemplate: async () => ({ name: 'fixed_region_motion_template_v1.png', buffer: Buffer.from('template') }),
    generateSource: async () => ({
      buffer: Buffer.from('generated'),
      provider: 'openrouter',
      model: 'mock/image',
      prompt: 'mock prompt',
      promptContract: {
        schema_version: 1,
        contract_version: 'character_prompt_contract_v1_1',
        preset: LEGACY_OCAD_MOTION_LAYOUT_ID,
        layout_id: LEGACY_OCAD_MOTION_LAYOUT_ID,
        layout_kind: 'fixed_regions',
        validation_expectations: ['exact_fixed_region_layout'],
      },
      inputImages: { template: true, reference: false, palette: false },
      templateName: 'fixed_region_motion_template_v1.png',
      referenceName: null,
      paletteName: null,
    }),
    processSheet: async (_buffer, options) => {
      processOptions = options
      throw Object.assign(new Error('stop after options capture'), { status: 'failed_post_processing' })
    },
  })

  assert.equal(processOptions.sourceLayout, FIXED_REGION_MOTION_LAYOUT_ID)
  assert.equal(processOptions.generation.prompt_contract.layout_id, LEGACY_OCAD_MOTION_LAYOUT_ID)
})

test('runOpenRouterCharacterBenchmark defaults to the fixed-region motion generation layout', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'openrouter-benchmark-default-fixed-region-'))
  const calls = []
  let processOptions = null

  const result = await runOpenRouterCharacterBenchmark({
    cases: [{ id: 'default_case', description: 'default generation source layout' }],
    variantsPerCase: 1,
    outputDir: root,
    runId: 'openrouter_bench_default_fixed_region_test',
    loadTemplate: async (preset) => ({ name: `${preset}.png`, buffer: Buffer.from('template') }),
    generateSource: async (request) => {
      calls.push(request)
      return {
        buffer: Buffer.from('generated'),
        provider: 'openrouter',
        model: 'mock/image',
        prompt: 'mock prompt',
        promptContract: {
          schema_version: 1,
          contract_version: 'character_prompt_contract_v1_3',
          preset: FIXED_REGION_MOTION_LAYOUT_ID,
          layout_id: FIXED_REGION_MOTION_LAYOUT_ID,
          layout_kind: 'fixed_regions',
          validation_expectations: ['exact_fixed_region_layout'],
        },
        inputImages: { template: true, reference: false, palette: false },
        templateName: 'fixed_region_motion_template_v1.png',
        referenceName: null,
        paletteName: null,
      }
    },
    processSheet: async (_buffer, options) => {
      processOptions = options
      throw Object.assign(new Error('stop after options capture'), { status: 'failed_post_processing' })
    },
  })

  assert.equal(result.preset, FIXED_REGION_MOTION_LAYOUT_ID)
  assert.equal(calls[0].preset, FIXED_REGION_MOTION_LAYOUT_ID)
  assert.equal(calls[0].templateImage.name, `${FIXED_REGION_MOTION_LAYOUT_ID}.png`)
  assert.equal(processOptions.sourceLayout, FIXED_REGION_MOTION_LAYOUT_ID)
})

function makeOcadFrame(index, { runtimeAction, sourceRegionKey, sourceAction, flipH = false }) {
  return {
    index,
    runtime_action: runtimeAction,
    source_frame: {
      layout: LEGACY_OCAD_MOTION_LAYOUT_ID,
      action: sourceAction,
      region_key: sourceRegionKey,
      flip_h: flipH,
      template_motion: { family: sourceAction },
    },
  }
}

test('summarizeDuplicateFrameReuse separates expected fixed-region source reuse from real duplicate motion', () => {
  const summary = summarizeDuplicateFrameReuse(
    [
      { hash: 'idle', frames: [0, 1, 2, 3] },
      { hash: 'walk', frames: [16, 17] },
    ],
    [
      makeOcadFrame(0, { runtimeAction: 'idle_down', sourceRegionKey: 'idledown', sourceAction: 'idledown' }),
      makeOcadFrame(1, { runtimeAction: 'idle_down', sourceRegionKey: 'idledown', sourceAction: 'idledown' }),
      makeOcadFrame(2, { runtimeAction: 'idle_down', sourceRegionKey: 'idledown', sourceAction: 'idledown' }),
      makeOcadFrame(3, { runtimeAction: 'idle_down', sourceRegionKey: 'idledown', sourceAction: 'idledown' }),
      makeOcadFrame(16, { runtimeAction: 'walk_down', sourceRegionKey: 'walkdown0', sourceAction: 'walkdown' }),
      makeOcadFrame(17, { runtimeAction: 'walk_down', sourceRegionKey: 'walkdown1', sourceAction: 'walkdown' }),
    ]
  )

  assert.equal(summary.total_groups, 2)
  assert.equal(summary.expected_source_reuse_groups, 1)
  assert.equal(summary.unexpected_duplicate_groups, 1)
  assert.deepEqual(summary.expected_source_reuse_actions, [{ id: 'idledown', count: 1 }])
  assert.deepEqual(summary.unexpected_duplicate_actions, [{ id: 'walkdown', count: 1 }])
})

test('summarizeOpenRouterBenchmark filters expected fixed-region source reuse out of top duplicate taxonomy', () => {
  const summary = summarizeOpenRouterBenchmark([
    {
      validation: { status: 'warning', warnings: ['source_region_edge_pressure_high'], blocking_errors: [] },
      quality: {
        duplicate_group_count: 9,
        duplicate_expected_source_reuse_count: 9,
        duplicate_unexpected_group_count: 0,
      },
      failure_taxonomy: {
        primary: 'motion.duplicate_frames',
        severity: 'warning',
        categories: [
          { id: 'motion.duplicate_frames', severity: 'warning', count: 9, examples: ['duplicate_frames'] },
          { id: 'layout.source_region_edge_pressure', severity: 'warning', count: 1, examples: ['source_region_edge_pressure_high'] },
        ],
      },
    },
  ])

  assert.equal(summary.failure_taxonomy.primary['motion.duplicate_frames'], undefined)
  assert.equal(summary.failure_taxonomy.primary['layout.source_region_edge_pressure'], 1)
  assert.ok(summary.failure_taxonomy.top_categories.every((category) => category.id !== 'motion.duplicate_frames'))
  assert.equal(summary.metrics.duplicate_expected_source_reuse_count.avg, 9)
  assert.equal(summary.metrics.duplicate_unexpected_group_count.avg, 0)
})

test('evaluateOpenRouterQualityGate marks unexpected duplicate frames as motion quality debt', () => {
  const summary = summarizeOpenRouterBenchmark([
    {
      validation: { status: 'warning', warnings: ['source_region_edge_pressure_high'], blocking_errors: [] },
      quality: { duplicate_group_count: 3, duplicate_expected_source_reuse_count: 0, duplicate_unexpected_group_count: 3 },
      failure_taxonomy: {
        primary: 'layout.source_region_edge_pressure',
        severity: 'warning',
        categories: [
          { id: 'layout.source_region_edge_pressure', severity: 'warning', count: 1, examples: ['source_region_edge_pressure_high'] },
          { id: 'motion.duplicate_frames', severity: 'warning', count: 3, examples: ['duplicate_frames'] },
        ],
      },
    },
  ])

  const gate = evaluateOpenRouterQualityGate({ preset: FIXED_REGION_MOTION_LAYOUT_ID, summary })
  const duplicateGate = gate.gates.find((item) => item.id === 'motion_duplicate_frames')

  assert.equal(gate.status, 'warning')
  assert.equal(duplicateGate.status, 'warning')
  assert.deepEqual(duplicateGate.observed, {
    duplicate_examples: 3,
    duplicate_examples_per_item: 3,
    avg_duplicate_group_count: 3,
    avg_expected_source_reuse_count: 0,
    avg_unexpected_duplicate_group_count: 3,
  })
})

test('evaluateOpenRouterQualityGate accepts expected fixed-region source reuse without warning', () => {
  const summary = summarizeOpenRouterBenchmark([
    {
      validation: { status: 'warning', warnings: ['source_region_edge_pressure_high'], blocking_errors: [] },
      quality: {
        duplicate_group_count: 9,
        duplicate_expected_source_reuse_count: 9,
        duplicate_unexpected_group_count: 0,
      },
      failure_taxonomy: {
        primary: 'layout.source_region_edge_pressure',
        severity: 'warning',
        categories: [
          { id: 'motion.duplicate_frames', severity: 'warning', count: 9, examples: ['duplicate_frames'] },
          { id: 'layout.source_region_edge_pressure', severity: 'warning', count: 1, examples: ['source_region_edge_pressure_high'] },
        ],
      },
    },
  ])

  const gate = evaluateOpenRouterQualityGate({ preset: LEGACY_OCAD_MOTION_LAYOUT_ID, summary })
  assert.equal(gate.preset, FIXED_REGION_MOTION_LAYOUT_ID)
  const duplicateGate = gate.gates.find((item) => item.id === 'motion_duplicate_frames')

  assert.equal(gate.status, 'pass')
  assert.equal(duplicateGate.status, 'pass')
  assert.equal(duplicateGate.observed.avg_duplicate_group_count, 9)
  assert.equal(duplicateGate.observed.avg_expected_source_reuse_count, 9)
  assert.equal(duplicateGate.observed.avg_unexpected_duplicate_group_count, 0)
})

test('summarizeOpenRouterBenchmark counts repeated warnings and blocking errors', () => {
  const summary = summarizeOpenRouterBenchmark([
    { status: 'done', validation: { status: 'warning', warnings: ['anchor_drift', 'halo'] } },
    { status: 'done', validation: { status: 'warning', warnings: ['anchor_drift'], blocking_errors: ['missing_frame'] } },
  ])

  assert.deepEqual(summary.top_warnings, [
    { message: 'anchor_drift', count: 2 },
    { message: 'halo', count: 1 },
  ])
  assert.deepEqual(summary.top_blocking_errors, [{ message: 'missing_frame', count: 1 }])
})

test('selectOpenRouterBenchmarkCases supports ordered case-id subsets for focused gates', () => {
  const selected = selectOpenRouterBenchmarkCases({
    caseIds: ['frog_knight', 'blue_wizard', 'thunder_drummer'],
  })

  assert.deepEqual(selected.map((item) => item.id), ['frog_knight', 'blue_wizard', 'thunder_drummer'])
  assert.match(selected[0].description, /frog knight/i)
})

test('selectOpenRouterBenchmarkCases rejects unknown focused gate case ids', () => {
  assert.throws(
    () => selectOpenRouterBenchmarkCases({ caseIds: ['blue_wizard', 'missing_case'] }),
    /Unknown OpenRouter benchmark case id: missing_case/
  )
})
