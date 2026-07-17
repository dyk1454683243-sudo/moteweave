import test from 'node:test'
import assert from 'node:assert/strict'
import { access, mkdtemp, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import sharp from 'sharp'

import {
  buildTwoPointFiveDMaterialSourceBenchmarkPlan,
  runTwoPointFiveDMaterialSourceBenchmark,
} from '../../src/two-point-five-d/materialSourceBenchmark.js'
import { DEFAULT_TWO_POINT_FIVE_D_TILESET_CONTRACT } from '../../src/two-point-five-d/tilesetContract.js'

async function exists(filePath) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

async function makeMaterialBoardPng() {
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" shape-rendering="crispEdges">',
    '<rect width="1024" height="1024" fill="#1d2119"/>',
    '<rect x="0" y="0" width="512" height="342" fill="#4f9a45"/>',
    '<rect x="512" y="0" width="512" height="342" fill="#765235"/>',
    '<rect x="0" y="342" width="512" height="341" fill="#b6d46d"/>',
    '<rect x="512" y="342" width="512" height="341" fill="#77b457"/>',
    '<rect x="0" y="683" width="512" height="341" fill="#8c7c43"/>',
    '<rect x="512" y="683" width="512" height="341" fill="#242820"/>',
    '<rect x="120" y="96" width="64" height="48" fill="#8fca63"/>',
    '<rect x="640" y="112" width="80" height="48" fill="#8d6844"/>',
    '<rect x="160" y="500" width="96" height="24" fill="#d7e88b"/>',
    '<rect x="656" y="824" width="128" height="32" fill="#303528"/>',
    '</svg>',
  ].join('')
  return sharp(Buffer.from(svg)).png().toBuffer()
}

test('2.5D material-source benchmark selects the best completed local candidate', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'two-point-five-d-source-benchmark-'))
  const materialBoard = await makeMaterialBoardPng()
  const providerBudget = { max: 2, used: 0 }
  let requestCount = 0
  const plan = buildTwoPointFiveDMaterialSourceBenchmarkPlan({
    runId: 'benchmark_unit',
    outputDir,
    description: 'mossy cliff terrain raw source',
    providerPresetId: 'source-provider',
    candidateCount: 2,
    generationOptions: { seed: 3 },
    imageConfig: { image_size: '1K', aspect_ratio: '1:1' },
    contract: DEFAULT_TWO_POINT_FIVE_D_TILESET_CONTRACT,
    mapOptions: { width: 3, height: 3 },
  })

  const report = await runTwoPointFiveDMaterialSourceBenchmark({
    plan,
    providerBudget,
    env: {
      CHARACTER_PROVIDER_PRESETS: JSON.stringify([
        {
          id: 'source-provider',
          provider: 'openrouter',
          apiKey: 'test-key',
          model: 'mock/source-image',
          baseUrl: 'http://example.invalid/v1/chat/completions',
          image_size: '1K',
          aspect_ratio: '1:1',
        },
      ]),
      CHARACTER_DEFAULT_PROVIDER: 'source-provider',
    },
    requestPromptImage: async (request) => {
      requestCount += 1
      return {
        buffer: requestCount === 1 ? Buffer.from('not a png') : materialBoard,
        prompt: request.prompt,
      }
    },
  })

  assert.equal(requestCount, 2)
  assert.equal(providerBudget.used, 2)
  assert.equal(report.mode, 'two_point_five_d_material_source_benchmark_v1')
  assert.equal(report.summary.candidate_count, 2)
  assert.deepEqual(report.summary.provider_call_budget, {
    planned_provider_calls: 2,
    max_provider_calls: 2,
    used_provider_calls: 2,
  })
  assert.equal(report.cases.length, 1)
  assert.equal(report.cases[0].candidates[0].status, 'error')
  assert.equal(report.cases[0].candidate_selection.selected_candidate_id, 'candidate_02')
  assert.notEqual(report.cases[0].candidate_selection.selected_status, 'error')
  assert.equal(report.review.mode, 'two_point_five_d_material_source_benchmark_review_v1')
  assert.match(report.review.decision.next_action, /^(run_larger_sample|review_warning_taxonomy|improve_material_extraction)$/)
  assert.equal(await exists(path.join(plan.output_dir, 'material_source_benchmark.json')), true)
  assert.equal(await exists(path.join(plan.output_dir, 'material_source_benchmark.md')), true)
  assert.equal(await exists(path.join(plan.output_dir, 'items/custom_material_source_v1/candidate_02/strict_atlas.png')), true)

  const written = JSON.parse(await readFile(path.join(plan.output_dir, 'material_source_benchmark.json'), 'utf8'))
  assert.equal(written.cases[0].candidate_selection.selected_candidate_id, 'candidate_02')
  assert.equal(written.review.mode, 'two_point_five_d_material_source_benchmark_review_v1')
  assert.match(written.claim_boundary, /does not claim providers can emit final strict atlases/)
  const markdown = await readFile(path.join(plan.output_dir, 'material_source_benchmark.md'), 'utf8')
  assert.match(markdown, /## Decision Summary/)
  assert.match(markdown, /Next action:/)
})
