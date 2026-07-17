import test from 'node:test'
import assert from 'node:assert/strict'

import { generateTwoPointFiveDMaterialSource } from '../../src/two-point-five-d/aiMaterialSourceBridge.js'
import { DEFAULT_TWO_POINT_FIVE_D_TILESET_CONTRACT } from '../../src/two-point-five-d/tilesetContract.js'

test('2.5D AI material source bridge spends one provider call and reports raw-source handoff', async () => {
  const providerBudget = { max: 1, used: 0 }
  let request = null
  const result = await generateTwoPointFiveDMaterialSource({
    description: 'mossy cliff terrain material board',
    promptFields: {
      topMaterial: 'mossy grass top',
      sideMaterial: 'dark cliff wall side',
    },
    contract: DEFAULT_TWO_POINT_FIVE_D_TILESET_CONTRACT,
    providerPresetId: 'source-provider',
    imageConfig: { image_size: '1K' },
    generationOptions: { seed: 42, temperature: 0.4, candidateCount: 9 },
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
    fetchImpl: async () => {
      throw new Error('fetch should not be called when requestPromptImage is injected')
    },
    requestPromptImage: async (nextRequest) => {
      request = nextRequest
      return {
        buffer: Buffer.from('raw-material-source'),
        prompt: nextRequest.prompt,
      }
    },
  })

  assert.equal(providerBudget.used, 1)
  assert.equal(request.providerPreset.id, 'source-provider')
  assert.equal(request.apiKey, 'test-key')
  assert.deepEqual(request.imageConfig, { aspect_ratio: '1:1', image_size: '1K' })
  assert.deepEqual(request.generationOptions, { seed: 42, temperature: 0.4 })
  assert.match(request.prompt, /not the final tileset asset/i)
  assert.match(request.prompt, /local deterministic code will crop\/sample materials/i)

  assert.equal(result.buffer.toString('utf8'), 'raw-material-source')
  assert.equal(result.report.status, 'pass')
  assert.equal(result.report.source_role, 'raw_material_source_not_clean_atlas')
  assert.equal(result.report.provider, 'openrouter')
  assert.equal(result.report.model, 'mock/source-image')
  assert.equal(result.report.provider_call_budget.used_provider_calls, 1)
  assert.equal(result.report.generated_source.direct_asset_use_allowed, false)
  assert.equal(result.report.pipeline_handoff.final_atlas_structure_owner, 'local_deterministic_pipeline')
  assert.equal(result.report.prompt_contract.requested_aspect_ratio, '1:1')
})
