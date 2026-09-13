import assert from 'node:assert/strict'
import test from 'node:test'

import {
  FULL_SHEET_GENERATION_PROFILE_IDS,
  assertFullSheetGenerationProfileRequest,
  resolveFullSheetGenerationProfile,
} from '../../src/character-pack/generationProfiles.js'

test('full-sheet profiles are strict one-call Gemini Native contracts', () => {
  for (const id of Object.values(FULL_SHEET_GENERATION_PROFILE_IDS)) {
    const profile = resolveFullSheetGenerationProfile(id, { required: true })
    assert.equal(profile.id, id)
    assert.equal(profile.generation_mode, 'production_sheet_v0')
    assert.equal(profile.provider, 'gemini')
    assert.equal(profile.route_kind, 'google_native')
    assert.deepEqual(profile.image_config, { image_size: '2K', aspect_ratio: '1:1' })
    assert.deepEqual(profile.reference_size, { w: 1024, h: 1024 })
    assert.equal(profile.candidate_count, 1)
    assert.equal(profile.max_provider_calls, 1)
    assert.equal(profile.automatic_retry, false)
    assert.equal(profile.provider_fallback, false)
    assert.equal(profile.model_fallback, false)
  }

  const fixedRegion = resolveFullSheetGenerationProfile(FULL_SHEET_GENERATION_PROFILE_IDS.FIXED_REGION)
  assert.equal(fixedRegion.background_recipe_id, 'deterministic_pixel_matte_v2')

  const topdown = resolveFullSheetGenerationProfile(FULL_SHEET_GENERATION_PROFILE_IDS.TOPDOWN)
  assert.equal(topdown.background_recipe_id, undefined)
})

test('full-sheet profile resolution rejects unknown ids and contract overrides', () => {
  assert.equal(resolveFullSheetGenerationProfile(''), null)
  assert.throws(() => resolveFullSheetGenerationProfile('', { required: true }), /required/)
  assert.throws(() => resolveFullSheetGenerationProfile('unknown_profile'), /unknown generation profile/)

  const profile = resolveFullSheetGenerationProfile(FULL_SHEET_GENERATION_PROFILE_IDS.FIXED_REGION)
  assert.doesNotThrow(() => assertFullSheetGenerationProfileRequest(profile, {
    preset: 'fixed_region_motion_v0',
    mode: 'production_sheet_v0',
    imageConfig: { image_size: '2K', aspect_ratio: '1:1' },
    generationOptions: { candidateCount: 1 },
    maxProviderCalls: 1,
    backgroundMode: 'deterministic_pixel_matte_v2',
  }))
  assert.throws(() => assertFullSheetGenerationProfileRequest(profile, { preset: 'topdown_rpg_v0' }), /cannot be overridden/)
  assert.throws(() => assertFullSheetGenerationProfileRequest(profile, { generationOptions: { candidateCount: 2 } }), /must be 1/)
  assert.throws(() => assertFullSheetGenerationProfileRequest(profile, { imageConfig: { image_size: '1K' } }), /cannot be overridden/)
  assert.throws(() => assertFullSheetGenerationProfileRequest(profile, { maxProviderCalls: 2 }), /must be 1/)
  assert.throws(() => assertFullSheetGenerationProfileRequest(profile, { backgroundMode: 'auto' }), /background mode cannot be overridden/)
})
