import assert from 'node:assert/strict'
import test from 'node:test'

import {
  FULL_SHEET_GENERATION_PROFILE_IDS,
  FULL_SHEET_GENERATION_PROFILES,
} from '../src/character-pack/generationProfiles.js'
import { assertProfileBackgroundEvidence } from '../src/server/fullSheetGenerationAcceptance.js'

test('Accept applies Background Matte V2 evidence requirements from the sealed Profile recipe', () => {
  const currentFixedProfile = FULL_SHEET_GENERATION_PROFILES[
    FULL_SHEET_GENERATION_PROFILE_IDS.FIXED_REGION
  ]
  const historicalFixedProfile = { ...currentFixedProfile }
  delete historicalFixedProfile.background_recipe_id

  assert.doesNotThrow(() => assertProfileBackgroundEvidence({
    profile: historicalFixedProfile,
    backgroundRemovedProviderOutput: null,
    backgroundMatteV2: null,
  }))
  assert.doesNotThrow(() => assertProfileBackgroundEvidence({
    profile: historicalFixedProfile,
    backgroundRemovedProviderOutput: {},
    backgroundMatteV2: null,
  }))

  assert.throws(
    () => assertProfileBackgroundEvidence({
      profile: currentFixedProfile,
      backgroundRemovedProviderOutput: null,
      backgroundMatteV2: null,
    }),
    (error) => error?.code === 'artifact_integrity_failed',
  )

  assert.throws(
    () => assertProfileBackgroundEvidence({
      profile: historicalFixedProfile,
      backgroundRemovedProviderOutput: null,
      backgroundMatteV2: {},
    }),
    (error) => error?.code === 'artifact_integrity_failed',
  )
})
