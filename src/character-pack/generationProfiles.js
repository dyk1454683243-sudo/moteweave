import {
  FIXED_REGION_MOTION_LAYOUT_ID,
  TOPDOWN_RPG_SOURCE_LAYOUT_ID,
} from './sourceLayoutIds.js'
import {
  BACKGROUND_RECIPE_IDS,
  resolveBackgroundMode,
} from './backgroundProcessingContract.js'
import { TEXT_TO_IMAGE_MODE_PRODUCTION_SHEET } from './textToImagePrompt.js'

export const FULL_SHEET_GENERATION_PROFILE_IDS = Object.freeze({
  FIXED_REGION: 'full_sheet_fixed_region_v1',
  TOPDOWN: 'full_sheet_topdown_v1',
})

const COMMON_PROFILE = Object.freeze({
  schema_version: 1,
  generation_mode: TEXT_TO_IMAGE_MODE_PRODUCTION_SHEET,
  route_kind: 'google_native',
  provider: 'gemini',
  image_config: Object.freeze({
    aspect_ratio: '1:1',
    image_size: '2K',
  }),
  reference_size: Object.freeze({ w: 1024, h: 1024 }),
  candidate_count: 1,
  max_provider_calls: 1,
  automatic_retry: false,
  provider_fallback: false,
  model_fallback: false,
  identity_reference: 'optional_strong_authority',
  subject_count_gate: 'subject_count_gate_v1',
})

export const FULL_SHEET_GENERATION_PROFILES = Object.freeze({
  [FULL_SHEET_GENERATION_PROFILE_IDS.FIXED_REGION]: Object.freeze({
    ...COMMON_PROFILE,
    id: FULL_SHEET_GENERATION_PROFILE_IDS.FIXED_REGION,
    source_layout: FIXED_REGION_MOTION_LAYOUT_ID,
    background_recipe_id: BACKGROUND_RECIPE_IDS.DETERMINISTIC_PIXEL_MATTE_V2,
  }),
  [FULL_SHEET_GENERATION_PROFILE_IDS.TOPDOWN]: Object.freeze({
    ...COMMON_PROFILE,
    id: FULL_SHEET_GENERATION_PROFILE_IDS.TOPDOWN,
    source_layout: TOPDOWN_RPG_SOURCE_LAYOUT_ID,
  }),
})

function cloneProfile(profile) {
  return JSON.parse(JSON.stringify(profile))
}

export function resolveFullSheetGenerationProfile(value, { required = false } = {}) {
  const id = String(value ?? '').trim()
  if (!id) {
    if (required) throw new Error('generationProfileId is required')
    return null
  }
  const profile = FULL_SHEET_GENERATION_PROFILES[id]
  if (!profile) throw new Error(`unknown generation profile: ${id}`)
  return cloneProfile(profile)
}

export function assertFullSheetGenerationProfileRequest(profile, {
  preset,
  mode,
  imageConfig = {},
  generationOptions = {},
  maxProviderCalls,
  backgroundMode,
} = {}) {
  if (!profile) throw new Error('generation profile is required')
  if (preset != null && String(preset).trim() && String(preset).trim() !== profile.source_layout) {
    throw new Error('generation profile source layout cannot be overridden')
  }
  if (mode != null && String(mode).trim() && String(mode).trim() !== profile.generation_mode) {
    throw new Error('generation profile mode cannot be overridden')
  }
  const imageSize = imageConfig.image_size ?? imageConfig.imageSize
  const aspectRatio = imageConfig.aspect_ratio ?? imageConfig.aspectRatio
  if (imageSize != null && String(imageSize) !== profile.image_config.image_size) {
    throw new Error('generation profile image size cannot be overridden')
  }
  if (aspectRatio != null && String(aspectRatio) !== profile.image_config.aspect_ratio) {
    throw new Error('generation profile aspect ratio cannot be overridden')
  }
  const candidateCount = generationOptions.candidateCount ?? generationOptions.candidate_count
  if (candidateCount != null && Number(candidateCount) !== profile.candidate_count) {
    throw new Error('generation profile candidate count must be 1')
  }
  if (maxProviderCalls != null && Number(maxProviderCalls) !== profile.max_provider_calls) {
    throw new Error('generation profile maxProviderCalls must be 1')
  }
  if (profile.background_recipe_id != null && backgroundMode != null) {
    const backgroundContract = resolveBackgroundMode(backgroundMode, {
      allowDeterministicV2:
        profile.background_recipe_id === BACKGROUND_RECIPE_IDS.DETERMINISTIC_PIXEL_MATTE_V2,
    })
    if (backgroundContract.recipe_id !== profile.background_recipe_id) {
      throw new Error('generation profile background mode cannot be overridden')
    }
  }
  return profile
}
