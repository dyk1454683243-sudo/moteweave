import test from 'node:test'
import assert from 'node:assert/strict'

import * as editorProject from '../../src/editor-project/index.js'
import { hashRepairRecipe } from '../../src/editor-project/repairRecipeHash.js'
import {
  createDraftSettingsHashInput,
  serializeCanonicalRecipe,
} from '../../src/editor-project/repairRecipeSerialization.js'
import { hashRepairRecipeBytes } from '../../src/ui/editor/repairHash.js'

const FULL_HASH = 'd409d6fa4c5bb415e5e31dfb8e15e4323ff5268727a4ef95930ca1604b7f2233'
const SETTINGS_HASH = '10460fa71084d4bb10ba9a649c2135fe1ce9c4c5244125fe7c7c42ec135fb782'

const CANONICAL_REPAIR_RECIPE = {
  version: 'processing_recipe_v0',
  target_pipeline: 'character_pack',
  pipeline_contract: 'character_pack_process_v1',
  implementation_revision: '8aa1b0d',
  source: {
    file_name: 'source.png',
    source_layout: 'topdown_rpg_v0',
    source_job_id: 'job_hero',
    asset_id: 'asset_hero',
    black_matte_artifact_ref: null,
  },
  background: { mode: 'auto', tolerance: 24 },
  cleanup: { component_cleanup: true, min_alpha: 18, min_area: 4, min_area_ratio: 0 },
  fixed_region_staging: {
    enabled: false,
    mode: null,
    stage_size: null,
    crop_right: null,
    crop_bottom: null,
    matte_tolerance: null,
  },
  grid: { manual_overrides: null },
  anchor_offset: { x: 0, y: 0 },
  frame_adjustments: {},
  locked_animations: [],
  correction: { auto_correct: true, motion_stabilize: true, motion_max_shift: 2 },
  pixel_finishing: { enabled: false, max_colors: 16, outline: true, outline_mode: 'outer' },
  style_report: { enabled: true, max_colors: 16 },
  outputs: { frame_sizes: [96, 64, 48, 32, 16] },
}

test('canonical Recipe serialization recursively sorts keys and preserves array order', () => {
  const first = {
    z: { beta: 2, alpha: 1 },
    array: [{ z: 3, a: 1 }, 2, 1],
    a: true,
  }
  const second = {
    a: true,
    array: [{ a: 1, z: 3 }, 2, 1],
    z: { alpha: 1, beta: 2 },
  }

  const firstBytes = serializeCanonicalRecipe(first)
  const secondBytes = serializeCanonicalRecipe(second)

  assert.equal(firstBytes instanceof Uint8Array, true)
  assert.deepEqual(firstBytes, secondBytes)
  assert.equal(
    new TextDecoder().decode(firstBytes),
    '{"a":true,"array":[{"a":1,"z":3},2,1],"z":{"alpha":1,"beta":2}}',
  )
})

test('Node hashing matches the full and revision-neutral golden vectors', () => {
  const settingsInput = createDraftSettingsHashInput(CANONICAL_REPAIR_RECIPE)

  assert.equal(
    hashRepairRecipe(serializeCanonicalRecipe(CANONICAL_REPAIR_RECIPE)),
    FULL_HASH,
  )
  assert.equal(
    hashRepairRecipe(serializeCanonicalRecipe(settingsInput)),
    SETTINGS_HASH,
  )
  assert.equal(settingsInput.implementation_revision, null)
  assert.equal(CANONICAL_REPAIR_RECIPE.implementation_revision, '8aa1b0d')
  assert.deepEqual(
    { ...settingsInput, implementation_revision: '8aa1b0d' },
    CANONICAL_REPAIR_RECIPE,
  )
})

test('browser Web Crypto hashing matches both golden vectors', {
  skip: !globalThis.crypto?.subtle,
}, async () => {
  assert.equal(
    await hashRepairRecipeBytes(serializeCanonicalRecipe(CANONICAL_REPAIR_RECIPE)),
    FULL_HASH,
  )
  assert.equal(
    await hashRepairRecipeBytes(serializeCanonicalRecipe(createDraftSettingsHashInput(CANONICAL_REPAIR_RECIPE))),
    SETTINGS_HASH,
  )
})

test('the browser-safe editor-project barrel does not export the Node hash adapter', () => {
  assert.equal('hashRepairRecipe' in editorProject, false)
  assert.equal(typeof editorProject.serializeCanonicalRecipe, 'function')
})
