import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import sharp from 'sharp'

import {
  buildSceneTileManualPromptPack,
  inspectSceneTileManualRetestInputs,
  renderSceneTileManualHandoff,
} from '../../src/scene-pack/benchmark/sceneTileManualPromptPack.js'

test('buildSceneTileManualPromptPack compiles v0.6 prompts for default scene cases', () => {
  const pack = buildSceneTileManualPromptPack({
    runId: 'manual_v06',
    outputDir: 'tmp/manual-prompts',
    inputDir: '/tmp/manual-scene-v06',
    sampleSize: 2,
  })

  assert.equal(pack.mode, 'scene_tile_manual_prompt_pack_v0')
  assert.equal(pack.run_id, 'manual_v06')
  assert.equal(pack.output_dir, 'tmp/manual-prompts/manual_v06')
  assert.equal(pack.input_dir, '/tmp/manual-scene-v06')
  assert.equal(pack.handoff_file, 'manual_handoff.md')
  assert.deepEqual(pack.required_image, { format: 'png', width: 192, height: 192 })
  assert.equal(pack.prompt_contract.contract_version, 'scene_tile_prompt_contract_v0_6')
  assert.deepEqual(pack.cases.map((item) => item.id), ['mossy_forest_ground', 'dry_cliff_path'])
  assert.equal(pack.cases[0].prompt_file, 'mossy_forest_ground/prompt.txt')
  assert.equal(pack.cases[0].expected_input_filename, 'mossy_forest_ground_192.png')
  assert.equal(pack.cases[0].expected_input_file, '/tmp/manual-scene-v06/mossy_forest_ground_192.png')
  assert.match(pack.cases[0].prompt, /repeat the same edge motif/i)
  assert.doesNotMatch(pack.cases[0].prompt, /Mask placement/i)
  const handoff = renderSceneTileManualHandoff(pack)
  assert.match(handoff, /true PNG image data/i)
  assert.match(handoff, /exactly 192x192 pixels/i)
  assert.match(handoff, /Do not save JPEG data with a \.png filename/i)
  assert.match(handoff, /mossy_forest_ground_192\.png/i)
})

test('inspectSceneTileManualRetestInputs reports missing expected v0.6 inputs', async () => {
  const retest = await inspectSceneTileManualRetestInputs({
    inputDir: '/tmp/missing-scene-tile-v06-test',
    outputDir: 'tmp/matrix',
    runId: 'manual_retest',
    sampleSize: 2,
  })

  assert.equal(retest.mode, 'scene_tile_manual_retest_plan_v0')
  assert.equal(retest.status, 'missing_inputs')
  assert.equal(retest.ready, false)
  assert.equal(retest.input_dir, '/tmp/missing-scene-tile-v06-test')
  assert.deepEqual(retest.missing_inputs.map((item) => item.expected_input_filename), [
    'mossy_forest_ground_192.png',
    'dry_cliff_path_192.png',
  ])
  assert.deepEqual(retest.matrix_inputs.map((item) => item.id), ['mossy_forest_ground', 'dry_cliff_path'])
})

test('inspectSceneTileManualRetestInputs rejects JPEG data with png filename', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'scene-tile-manual-invalid-'))
  const inputDir = path.join(root, 'inputs')
  await mkdir(inputDir, { recursive: true })
  await writeFile(
    path.join(inputDir, 'mossy_forest_ground_192.png'),
    await sharp({
      create: {
        width: 1024,
        height: 1024,
        channels: 4,
        background: { r: 40, g: 90, b: 40, alpha: 1 },
      },
    }).jpeg().toBuffer()
  )

  const retest = await inspectSceneTileManualRetestInputs({
    inputDir,
    outputDir: 'tmp/matrix',
    runId: 'manual_retest_invalid',
    sampleSize: 1,
  })

  assert.equal(retest.status, 'invalid_inputs')
  assert.equal(retest.ready, false)
  assert.equal(retest.existing_input_count, 1)
  assert.equal(retest.missing_input_count, 0)
  assert.equal(retest.invalid_input_count, 1)
  assert.deepEqual(retest.invalid_inputs[0].blocking_errors, [
    'source_sheet_format_mismatch',
    'source_sheet_size_mismatch',
  ])
  assert.equal(retest.invalid_inputs[0].actual_format, 'jpeg')
  assert.deepEqual(retest.invalid_inputs[0].actual_size, { width: 1024, height: 1024 })
})
