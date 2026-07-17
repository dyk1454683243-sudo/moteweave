import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildSceneTileLiveGatePlan,
  selectSceneTileGateCases,
} from '../../src/scene-pack/benchmark/sceneTileLiveGate.js'

test('selectSceneTileGateCases supports sample size and explicit case ids', () => {
  assert.deepEqual(
    selectSceneTileGateCases({ sampleSize: 2 }).map((item) => item.id),
    ['mossy_forest_ground', 'dry_cliff_path']
  )
  assert.deepEqual(
    selectSceneTileGateCases({ caseIds: ['wet_cave_floor'] }).map((item) => item.id),
    ['wet_cave_floor']
  )
  assert.throws(() => selectSceneTileGateCases({ caseIds: ['missing_case'] }), /Unknown scene tile gate case id/)
})

test('buildSceneTileLiveGatePlan records provider calls and correction options', () => {
  const plan = buildSceneTileLiveGatePlan({
    runId: 'scene_gate_plan',
    outputDir: 'tmp/out',
    sampleSize: 2,
    providerPresetId: 'scene-provider',
    imageConfig: { image_size: '1K', aspect_ratio: '1:1' },
    styleCorrection: { mode: 'palette_snap', maxColors: 16 },
    edgeConditioning: { enabled: true, band: 3, mode: 'edge-aware-v1' },
    candidateCount: 3,
    seed: 10,
  })

  assert.equal(plan.run_id, 'scene_gate_plan')
  assert.equal(plan.output_dir, 'tmp/out/scene_gate_plan')
  assert.equal(plan.estimated_provider_calls, 6)
  assert.equal(plan.provider_preset_id, 'scene-provider')
  assert.deepEqual(plan.image_config, { image_size: '1K', aspect_ratio: '1:1' })
  assert.equal(plan.scene_options.candidate_count, 3)
  assert.equal(plan.scene_options.gate_policy.raw_tile_quality, 'strict')
  assert.equal(plan.scene_options.style_correction.mode, 'palette_snap')
  assert.equal(plan.scene_options.edge_conditioning.mode, 'edge-aware-v1')
  assert.deepEqual(plan.cases.map((item) => item.seed), [10, 11])
  assert.deepEqual(plan.cases.map((item) => item.item_id), ['mossy_forest_ground_v1', 'dry_cliff_path_v1'])
})

test('buildSceneTileLiveGatePlan rejects candidate counts above live gate cap', () => {
  assert.throws(
    () => buildSceneTileLiveGatePlan({ candidateCount: 9 }),
    /candidateCount must be 8 or less/
  )
})
