import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

import { buildBenchmarkGallery } from '../../src/character-pack/benchmark/benchmarkGallery.js'

test('buildBenchmarkGallery returns a compact index for local OpenRouter benchmark runs', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'benchmark-gallery-'))
  const generatedDir = path.join(root, 'generated')
  const runDir = path.join(generatedDir, 'openrouter-benchmarks', 'openrouter_bench_test')
  const itemDir = path.join(runDir, 'items', 'wizard_v1')
  await mkdir(itemDir, { recursive: true })
  await writeFile(path.join(itemDir, 'walk_down.gif'), Buffer.from('gif'))
  await writeFile(
    path.join(runDir, 'benchmark_report.json'),
    JSON.stringify(
      {
        schema_version: 1,
        run_id: 'openrouter_bench_test',
        created_at: '2026-05-31T01:02:03.000Z',
        preset: 'topdown_rpg_v0',
        template_file: 'motion_template_ocha_8x8.png',
        image_config: { image_size: '1K', aspect_ratio: '1:1' },
        summary: { total: 1, validation: { pass: 1, warning: 0, fail: 0 } },
        items: [
          {
            case: { id: 'wizard', description: 'a blue robed wizard' },
            variant: 1,
            status: 'done',
            generation: {
              provider: 'openrouter',
              model: 'mock/image',
              prompt_contract: {
                contract_version: 'character_prompt_contract_v1_1',
                layout_id: 'topdown_rpg_v0',
              },
            },
            validation: { status: 'pass', warnings: [], blocking_errors: [] },
            failure_taxonomy: {
              primary: 'structure.empty_frame',
              severity: 'error',
              categories: [
                { id: 'structure.empty_frame', severity: 'error', count: 1, examples: ['frame_6_empty'] },
              ],
            },
            quality: { halo_score: 0.02 },
            artifacts: { dir: itemDir, files: { row_gif_count: 1 } },
          },
        ],
      },
      null,
      2
    )
  )

  const gallery = await buildBenchmarkGallery({ generatedDir })

  assert.equal(gallery.runs.length, 1)
  assert.equal(gallery.runs[0].run_id, 'openrouter_bench_test')
  assert.equal(gallery.runs[0].items[0].id, 'wizard_v1')
  assert.equal(gallery.runs[0].items[0].case_id, 'wizard')
  assert.equal(gallery.runs[0].items[0].source_url, '/generated/openrouter-benchmarks/openrouter_bench_test/items/wizard_v1/source.png')
  assert.equal(gallery.runs[0].items[0].normalized_sheet_url, '/generated/openrouter-benchmarks/openrouter_bench_test/items/wizard_v1/normalized_sheet.png')
  assert.equal(gallery.runs[0].items[0].prompt_url, '/generated/openrouter-benchmarks/openrouter_bench_test/items/wizard_v1/prompt.txt')
  assert.equal(gallery.runs[0].items[0].debug_report_url, '/generated/openrouter-benchmarks/openrouter_bench_test/items/wizard_v1/debug_report.json')
  assert.equal(gallery.runs[0].items[0].failure_taxonomy.primary, 'structure.empty_frame')
  assert.equal(gallery.runs[0].items[0].failure_taxonomy.categories[0].examples[0], 'frame_6_empty')
  assert.deepEqual(gallery.runs[0].items[0].row_gif_previews, [
    {
      name: 'walk_down.gif',
      url: '/generated/openrouter-benchmarks/openrouter_bench_test/items/wizard_v1/walk_down.gif',
      animation: 'walk_down',
      label: 'walk down',
    },
  ])
})

test('buildBenchmarkGallery returns an empty index when no benchmark root exists', async () => {
  const generatedDir = path.join(os.tmpdir(), `missing-benchmark-gallery-${Date.now()}`)
  const gallery = await buildBenchmarkGallery({ generatedDir })

  assert.deepEqual(gallery, { schema_version: 1, runs: [] })
})

test('buildBenchmarkGallery avoids artifact URLs for model failures', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'benchmark-gallery-failures-'))
  const generatedDir = path.join(root, 'generated')
  const runDir = path.join(generatedDir, 'openrouter-benchmarks', 'openrouter_bench_failure')
  await mkdir(runDir, { recursive: true })
  await writeFile(
    path.join(runDir, 'benchmark_report.json'),
    JSON.stringify({
      run_id: 'openrouter_bench_failure',
      created_at: '2026-05-31T02:00:00.000Z',
      summary: { total: 1, validation: { pass: 0, warning: 0, fail: 0, unknown: 1 } },
      items: [
        {
          case: { id: 'model_error', description: 'provider failed' },
          variant: 1,
          status: 'failed_model_error',
          generation: { template_file: 'motion_template_ocha_8x8.png' },
          validation: { status: 'unknown', warnings: [], blocking_errors: [] },
          failure: { mode: 'model_error', reason: 'provider failed' },
        },
      ],
    })
  )

  const gallery = await buildBenchmarkGallery({ generatedDir })
  const [item] = gallery.runs[0].items

  assert.equal(item.status, 'failed_model_error')
  assert.equal(item.source_url, undefined)
  assert.equal(item.normalized_sheet_url, undefined)
  assert.deepEqual(item.row_gif_previews, [])
})

test('buildBenchmarkGallery slices recent runs before expanding item artifacts', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'benchmark-gallery-slice-'))
  const generatedDir = path.join(root, 'generated')
  const benchmarkDir = path.join(generatedDir, 'openrouter-benchmarks')
  const runs = [
    ['old_run', '2026-05-30T01:00:00.000Z'],
    ['new_run', '2026-05-31T01:00:00.000Z'],
  ]
  for (const [runId, createdAt] of runs) {
    const runDir = path.join(benchmarkDir, runId)
    await mkdir(path.join(runDir, 'items', `${runId}_item_v1`), { recursive: true })
    await writeFile(
      path.join(runDir, 'benchmark_report.json'),
      JSON.stringify({
        run_id: runId,
        created_at: createdAt,
        summary: { total: 1, validation: { pass: 1, warning: 0, fail: 0 } },
        items: [
          {
            case: { id: `${runId}_item`, description: runId },
            variant: 1,
            status: 'done',
            validation: { status: 'pass', warnings: [], blocking_errors: [] },
            artifacts: { dir: path.join(runDir, 'items', `${runId}_item_v1`), files: { row_gif_count: 0 } },
          },
        ],
      })
    )
  }

  const gallery = await buildBenchmarkGallery({ generatedDir, maxRuns: 1 })

  assert.equal(gallery.runs.length, 1)
  assert.equal(gallery.runs[0].run_id, 'new_run')
  assert.equal(gallery.runs[0].item_count, 1)
  assert.equal(gallery.runs[0].visible_item_count, 1)
})
