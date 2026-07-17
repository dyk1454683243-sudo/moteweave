import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildTopdownRepairManifestForBenchmarkReport,
  buildTopdownRepairTask,
} from '../../src/character-pack/benchmark/topdownRepairManifest.js'

test('buildTopdownRepairTask turns a frame issue into a single-cell repair payload', () => {
  const task = buildTopdownRepairTask({
    runId: 'openrouter_bench_repair',
    item: {
      case: {
        id: 'frog_knight',
        description: 'a tiny frog knight with a round shield and leaf cape',
      },
      variant: 1,
      artifacts: { dir: 'generated/openrouter-benchmarks/openrouter_bench_repair/items/frog_knight_v1' },
      generation: {
        prompt_contract: { contract_version: 'character_prompt_contract_v1_2', layout_id: 'topdown_rpg_v0' },
        image_config: { image_size: '1K', aspect_ratio: '1:1' },
      },
    },
    issue: {
      message: 'frame_6_empty',
      issue: 'empty_frame',
      frame: 6,
      row: 0,
      col: 6,
      animation: 'idle_up',
      frame_in_animation: 2,
      repair_scope: 'single_cell',
      strategy: 'regenerate_missing_pose_in_cell',
    },
  })

  assert.equal(task.task_id, 'frog_knight_v1_frame_6_empty')
  assert.equal(task.repair_scope, 'single_cell')
  assert.equal(task.strategy, 'regenerate_missing_pose_in_cell')
  assert.deepEqual(task.target.rect, { x: 576, y: 0, w: 96, h: 96 })
  assert.deepEqual(task.target.anchor, { x: 48, y: 88, mode: 'feet-center' })
  assert.deepEqual(task.context.same_animation_frames.map((frame) => frame.frame), [4, 5, 7])
  assert.equal(task.artifacts.normalized_sheet, 'generated/openrouter-benchmarks/openrouter_bench_repair/items/frog_knight_v1/normalized_sheet.png')
  assert.match(task.provider_payload.prompt, /Repair exactly one topdown_rpg_v0 cell/)
  assert.match(task.provider_payload.prompt, /frame 6, row 0, column 6/)
  assert.match(task.provider_payload.prompt, /Output one repaired 96x96 cell PNG/)
})

test('buildTopdownRepairManifestForBenchmarkReport aggregates repair tasks from a benchmark report', () => {
  const manifest = buildTopdownRepairManifestForBenchmarkReport({
    run_id: 'openrouter_bench_repair',
    preset: 'topdown_rpg_v0',
    provider_preset_id: 'openrouter-gemini-image',
    template_file: 'motion_template_ocha_8x8.png',
    image_config: { image_size: '2K', aspect_ratio: '1:1' },
    items: [
      {
        case: {
          id: 'frog_knight',
          description: 'a tiny frog knight with a round shield and leaf cape',
        },
        variant: 1,
        artifacts: { dir: 'generated/openrouter-benchmarks/openrouter_bench_repair/items/frog_knight_v1' },
        generation: { prompt_contract: { contract_version: 'character_prompt_contract_v1_2' } },
        validation: {
          status: 'fail',
          blocking_errors: ['frame_6_empty', 'frame_24_cropped', 'halo_score_high'],
          warnings: [],
        },
      },
      {
        case: { id: 'blue_wizard', description: 'a small blue robed wizard' },
        variant: 1,
        validation: { status: 'pass', blocking_errors: [], warnings: [] },
      },
    ],
  })

  assert.equal(manifest.schema_version, 1)
  assert.equal(manifest.run_id, 'openrouter_bench_repair')
  assert.equal(manifest.summary.task_count, 2)
  assert.deepEqual(manifest.summary.by_strategy, {
    regenerate_missing_pose_in_cell: 1,
    regenerate_pose_with_more_padding: 1,
  })
  assert.deepEqual(manifest.summary.top_frames, [
    { frame: 6, count: 1 },
    { frame: 24, count: 1 },
  ])
  assert.equal(manifest.tasks[1].target.animation, 'walk_left')
  assert.deepEqual(manifest.tasks[1].target.rect, { x: 0, y: 288, w: 96, h: 96 })
  assert.equal(manifest.tasks[1].provider_payload.image_config.image_size, '2K')
})
