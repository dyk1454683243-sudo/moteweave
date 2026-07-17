import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildQualityCharacterPrompt,
  normalizeGenerationOptions,
  parsePromptFieldEntries,
  resolveTextToImageAspectRatio,
  summarizeQualityPromptContract,
} from '../../src/character-pack/textToImagePrompt.js'

test('quality character prompt uses structured fields and stays single-image', () => {
  const promptFields = parsePromptFieldEntries([
    'outfit=blue cloak and gold shoulder armor',
    'equipment:compact sword',
  ])
  const prompt = buildQualityCharacterPrompt({
    description: 'silver swordswoman',
    characterPreset: 'xianxia_hero_v0',
    promptFields,
    backgroundMode: 'alpha',
  })

  assert.match(prompt, /silver swordswoman/)
  assert.match(prompt, /blue cloak and gold shoulder armor/)
  assert.match(prompt, /compact sword/)
  assert.match(prompt, /one single centered full-body character only/)
  assert.match(prompt, /35-60% of canvas height/)
  assert.match(prompt, /downscaled to a 96x96 RPG sprite/)
  assert.match(prompt, /not a sprite sheet/)
  assert.match(prompt, /transparent if the provider supports alpha/)
})

test('quality prompt summary records preset fields and 2:1 aspect defaults', () => {
  const summary = summarizeQualityPromptContract({
    characterPreset: 'two_to_one_character_v0',
    promptFields: { identity: 'jade healer' },
    backgroundMode: 'flood',
  })

  assert.equal(summary.mode, 'quality_character_v0')
  assert.equal(summary.preset, 'two_to_one_character_v0')
  assert.equal(summary.aspect_ratio, '2:1')
  assert.equal(summary.contract_version, 'quality_character_prompt_contract_v1_0')
  assert.ok(summary.validation_expectations.includes('production_scale_bbox'))
  assert.deepEqual(summary.prompt_fields, { identity: 'jade healer' })
  assert.equal(resolveTextToImageAspectRatio({ mode: 'quality_character_v0', characterPreset: 'two_to_one_character_v0' }), '2:1')
})

test('generation options normalize candidate count and provider sampling params', () => {
  assert.equal(normalizeGenerationOptions().candidateCount, 1)

  const options = normalizeGenerationOptions({
    candidate_count: '99',
    temperature: '1.4',
    top_p: '0.7',
    top_k: '32',
    seed: '12',
  })

  assert.equal(options.candidateCount, 8)
  assert.equal(options.temperature, 1.4)
  assert.equal(options.topP, 0.7)
  assert.equal(options.topK, 32)
  assert.equal(options.seed, 12)
})
