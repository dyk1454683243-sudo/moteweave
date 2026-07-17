import test from 'node:test'
import assert from 'node:assert/strict'

import { TOPDOWN_RPG_V0 } from '../../src/character-pack/profile.js'
import {
  createDefaultCharacterProcessingRecipe,
  validateCharacterWorkbenchRecipe,
} from '../../src/editor-project/index.js'
import {
  RepairRecipeError,
  applyRepairDraftSettingsHash,
  canonicalizeRepairRecipe,
  createRepairRecipeDraft,
  migrateCharacterProcessingRecipe,
  updateRepairRecipeDraft,
  validateRepairRecipeDraft,
  withRepairImplementationRevision,
} from '../../src/editor-project/repairRecipe.js'
import {
  getRepairAcceptanceState,
  getRepairPreviewFreshness,
} from '../../src/editor-project/repairState.js'

const asset = { id: 'asset_hero' }
const revision = { id: 'rev_current', source_job_id: 'job_parent' }

function managedSourceContext(overrides = {}) {
  return {
    inputMode: 'managed_source',
    sourceLayout: 'topdown_rpg_v0',
    sourceLayoutKind: 'uniform_grid',
    sourceSize: { width: 768, height: 768 },
    sourceFileName: 'source.png',
    blackMatteArtifactRef: null,
    ...overrides,
  }
}

function createDraft(loadedRecipe, sourceContext = managedSourceContext()) {
  return createRepairRecipeDraft({ asset, revision, loadedRecipe, sourceContext })
}

function validManualGrid() {
  const points = Array.from({ length: 9 }, (_, index) => index * 96)
  return { columns: points, rows: points }
}

function canonicalContext(overrides = {}) {
  return {
    inputMode: 'managed_source',
    sourceLayoutKind: 'uniform_grid',
    sourceSize: { width: 768, height: 768 },
    profile: TOPDOWN_RPG_V0,
    hasBlackMatte: false,
    ...overrides,
  }
}

function assertRepairCode(fn, code) {
  assert.throws(fn, (error) => {
    assert.equal(error instanceof RepairRecipeError, true)
    assert.equal(error.name, 'RepairRecipeError')
    assert.equal(error.code, 'invalid_recipe')
    assert.deepEqual(error.codes, [code])
    return true
  })
}

test('a new repair draft uses documented defaults and the active source identity', () => {
  const draft = createDraft(undefined)

  assert.deepEqual(draft.recipe.source, {
    file_name: 'source.png',
    source_layout: 'topdown_rpg_v0',
    source_job_id: 'job_parent',
    asset_id: 'asset_hero',
    black_matte_artifact_ref: null,
  })
  assert.deepEqual(draft.recipe.fixed_region_staging, {
    enabled: false,
    mode: null,
    stage_size: null,
    crop_right: null,
    crop_bottom: null,
    matte_tolerance: null,
  })
  assert.equal(draft.recipe.background.tolerance, 24)
  assert.equal(draft.recipe.implementation_revision, null)
  assert.equal(draft.recipe.style_report.enabled, true)
  assert.deepEqual(draft.recipe.outputs.frame_sizes, [96, 64, 48, 32, 16])
  assert.equal(draft.dirty, false)
  assert.equal(draft.hashStatus, 'pending')
  assert.equal(draft.openingDraftSettingsHash, null)
  assert.equal(draft.currentDraftSettingsHash, null)
  assert.equal(draft.fieldOrigins['background.tolerance'], 'default')
  assert.equal(draft.fieldOrigins['style_report.enabled'], 'forced')
  assert.equal(draft.fieldOrigins.fixed_region_staging, 'provenance')
  assert.equal(draft.fieldOrigins['source.source_layout'], 'provenance')
  assert.equal(Object.isFrozen(draft.openingRecipe), true)
  assert.equal(Object.isFrozen(draft.openingRecipe.source), true)
  assert.equal(Object.isFrozen(draft.fieldOrigins), true)
  assert.notEqual(draft.recipe, draft.openingRecipe)
})

test('a historical recipe inherits only editable settings and rebinds current provenance', () => {
  const loadedRecipe = createDefaultCharacterProcessingRecipe({
    fileName: 'old.png',
    sourceLayout: 'fixed_region_motion_v0',
    sourceJobId: 'job_old',
    assetId: 'asset_old',
    blackMatteArtifactRef: 'old/black.png',
    createdFrom: {
      background: { mode: 'flood', tolerance: 17 },
      cleanup: { component_cleanup: false, min_alpha: 12, min_area: 8, min_area_ratio: 0.1 },
      anchor_offset: { x: 3, y: -4 },
      frame_adjustments: { 5: { dx: 2, dy: -1 } },
      locked_animations: ['walk_down'],
      correction: { auto_correct: false, motion_stabilize: false, motion_max_shift: 1 },
      pixel_finishing: { enabled: false, max_colors: 12, outline: false, outline_mode: 'none' },
      style_report: { enabled: true, max_colors: 9 },
    },
  })
  loadedRecipe.implementation_revision = 'old-build'
  loadedRecipe.unrelated_history_field = { ignored: true }

  const draft = createDraft(loadedRecipe, managedSourceContext({
    sourceFileName: 'current.png',
    blackMatteArtifactRef: 'managed/current-black.png',
  }))

  assert.deepEqual(draft.recipe.source, {
    file_name: 'current.png',
    source_layout: 'topdown_rpg_v0',
    source_job_id: 'job_parent',
    asset_id: 'asset_hero',
    black_matte_artifact_ref: 'managed/current-black.png',
  })
  assert.deepEqual(draft.recipe.background, { mode: 'flood', tolerance: 17 })
  assert.deepEqual(draft.recipe.cleanup, {
    component_cleanup: false,
    min_alpha: 12,
    min_area: 8,
    min_area_ratio: 0.1,
  })
  assert.deepEqual(draft.recipe.anchor_offset, { x: 3, y: -4 })
  assert.deepEqual(draft.recipe.frame_adjustments, { 5: { dx: 2, dy: -1 } })
  assert.deepEqual(draft.recipe.locked_animations, ['walk_down'])
  assert.deepEqual(draft.recipe.fixed_region_staging, {
    enabled: false,
    mode: null,
    stage_size: null,
    crop_right: null,
    crop_bottom: null,
    matte_tolerance: null,
  })
  assert.equal(draft.recipe.implementation_revision, null)
  assert.equal(draft.recipe.style_report.enabled, true)
  assert.equal(draft.recipe.style_report.max_colors, 9)
  assert.equal('unrelated_history_field' in draft.recipe, false)
  assert.equal(draft.dirty, false)
  assert.equal(draft.fieldOrigins['background.tolerance'], 'inherited')
  assert.equal(draft.fieldOrigins['style_report.max_colors'], 'inherited')
  assert.deepEqual(draft.provenance, { fixedRegionStaging: loadedRecipe.fixed_region_staging })
  assert.equal(Object.isFrozen(draft.provenance.fixedRegionStaging), true)
})

test('legacy output scales migrate to fixed frame sizes without reinterpretation', () => {
  const loadedRecipe = createDefaultCharacterProcessingRecipe()
  loadedRecipe.outputs = { scales: [1, 2, 4] }

  const migrated = migrateCharacterProcessingRecipe(loadedRecipe)

  assert.deepEqual(migrated.recipe.outputs, { frame_sizes: [96, 64, 48, 32, 16] })
  assert.deepEqual(migrated.diagnostics, ['legacy_output_scales_migrated'])
  assert.equal(migrated.recipe.outputs.frame_sizes.includes(4), false)
})

test('migration falls back from an invalid historical style budget', () => {
  for (const maxColors of [0, 257, '16']) {
    const loadedRecipe = createDefaultCharacterProcessingRecipe({
      createdFrom: {
        pixel_finishing: { enabled: false, max_colors: 12 },
        style_report: { max_colors: maxColors },
      },
    })

    const migrated = migrateCharacterProcessingRecipe(loadedRecipe)
    const draft = createDraft(loadedRecipe)

    assert.equal(migrated.recipe.style_report.max_colors, 12)
    assert.equal(migrated.inheritedPaths.includes('style_report.max_colors'), false)
    assert.equal(draft.fieldOrigins['style_report.max_colors'], 'default')
  }
})

test('migration synchronizes the derived style budget when Pixel Finishing is enabled', () => {
  const loadedRecipe = createDefaultCharacterProcessingRecipe({
    createdFrom: {
      pixel_finishing: { enabled: true, max_colors: 8 },
      style_report: { enabled: true, max_colors: 32 },
    },
  })

  const migrated = migrateCharacterProcessingRecipe(loadedRecipe)
  const draft = createDraft(loadedRecipe)

  assert.equal(migrated.recipe.style_report.max_colors, 8)
  assert.ok(migrated.diagnostics.includes('style_report_budget_synced_to_pixel_finishing'))
  assert.equal(draft.recipe.style_report.max_colors, 8)
  assert.equal(draft.fieldOrigins['style_report.max_colors'], 'derived')
  assert.equal(draft.dirty, false)
  assert.equal(validateCharacterWorkbenchRecipe(draft.recipe).status, 'pass')
})

test('matching finishing budgets stay derived without a synchronization diagnostic', () => {
  const loadedRecipe = createDefaultCharacterProcessingRecipe({
    createdFrom: {
      pixel_finishing: { enabled: true, max_colors: 8 },
      style_report: { max_colors: 8 },
    },
  })

  const draft = createDraft(loadedRecipe)

  assert.equal(draft.fieldOrigins['style_report.max_colors'], 'derived')
  assert.equal(draft.diagnostics.includes('style_report_budget_synced_to_pixel_finishing'), false)
})

test('normalized-sheet fallback uses the authoritative layout and disables incompatible settings', () => {
  const loadedRecipe = createDefaultCharacterProcessingRecipe({
    blackMatteArtifactRef: 'old/black.png',
    createdFrom: {
      background: { mode: 'dual_matte' },
      grid: { manual_overrides: validManualGrid() },
    },
  })

  const draft = createDraft(loadedRecipe, managedSourceContext({
    inputMode: 'normalized_sheet_fallback',
    sourceLayout: 'fixed_region_motion_v0',
    sourceLayoutKind: 'fixed_regions',
    blackMatteArtifactRef: 'managed/current-black.png',
  }))

  assert.equal(draft.recipe.source.source_layout, 'topdown_rpg_v0')
  assert.equal(draft.recipe.grid.manual_overrides, null)
  assert.equal(draft.recipe.background.mode, 'auto')
  assert.ok(draft.diagnostics.includes('normalized_sheet_fallback'))
  assert.ok(draft.diagnostics.includes('manual_grid_unavailable_for_fixed_regions'))
  assert.ok(draft.diagnostics.includes('dual_matte_unavailable_for_input'))
})

test('fixed-region sources discard inherited manual cuts with a stable diagnostic', () => {
  const loadedRecipe = createDefaultCharacterProcessingRecipe({
    createdFrom: { grid: { manual_overrides: validManualGrid() } },
  })

  const draft = createDraft(loadedRecipe, managedSourceContext({
    sourceLayout: 'fixed_region_motion_v0',
    sourceLayoutKind: 'fixed_regions',
    sourceSize: { width: 252, height: 252 },
  }))

  assert.equal(draft.recipe.source.source_layout, 'fixed_region_motion_v0')
  assert.equal(draft.recipe.grid.manual_overrides, null)
  assert.ok(draft.diagnostics.includes('manual_grid_unavailable_for_fixed_regions'))
})

test('repair updates reject immutable identity and use one editable path', () => {
  const draft = createDraft(undefined)

  for (const path of [
    'source.asset_id',
    'source.source_job_id',
    'source.source_layout',
    'source.file_name',
    'implementation_revision',
    'fixed_region_staging.enabled',
    'outputs.frame_sizes',
  ]) {
    assert.throws(
      () => updateRepairRecipeDraft(draft, { path, value: 'changed' }),
      /repair patch path is not editable/,
    )
  }
  assert.throws(() => updateRepairRecipeDraft(draft, { background: { tolerance: 2 } }), TypeError)

  const updated = updateRepairRecipeDraft(draft, {
    path: 'frame_adjustments.12.dx',
    value: 3,
  })

  assert.deepEqual(updated.recipe.frame_adjustments['12'], { dx: 3, dy: 0 })
  assert.deepEqual(draft.recipe.frame_adjustments, {})
  assert.equal(updated.recipe.implementation_revision, null)
  assert.equal(updated.dirty, true)
  assert.equal(updated.hashStatus, 'pending')
})

test('repair updates keep the finishing style budget derived until finishing is disabled', () => {
  let draft = createDraft(createDefaultCharacterProcessingRecipe({
    createdFrom: {
      pixel_finishing: { enabled: false, max_colors: 12 },
      style_report: { max_colors: 20 },
    },
  }))

  draft = updateRepairRecipeDraft(draft, { path: 'pixel_finishing.enabled', value: true })
  assert.equal(draft.recipe.style_report.max_colors, 12)
  assert.equal(draft.fieldOrigins['style_report.max_colors'], 'derived')

  draft = updateRepairRecipeDraft(draft, { path: 'pixel_finishing.max_colors', value: 8 })
  assert.equal(draft.recipe.style_report.max_colors, 8)
  assert.equal(draft.fieldOrigins['style_report.max_colors'], 'derived')
  assert.throws(
    () => updateRepairRecipeDraft(draft, { path: 'style_report.max_colors', value: 6 }),
    /style_report\.max_colors is derived while Pixel Finishing is enabled/,
  )

  draft = updateRepairRecipeDraft(draft, { path: 'pixel_finishing.enabled', value: false })
  assert.equal(draft.fieldOrigins['style_report.max_colors'], 'derived')
  draft = updateRepairRecipeDraft(draft, { path: 'style_report.max_colors', value: 6 })
  assert.equal(draft.recipe.style_report.max_colors, 6)
  assert.equal(draft.fieldOrigins['style_report.max_colors'], 'edited')
})

test('draft settings hashes establish and compare the clean opening identity', () => {
  const firstHash = 'a'.repeat(64)
  const secondHash = 'b'.repeat(64)
  const draft = createDraft(undefined)

  assert.throws(() => applyRepairDraftSettingsHash(draft, firstHash), /not initialized/)
  assert.throws(() => applyRepairDraftSettingsHash(draft, firstHash.toUpperCase(), { initialize: true }), /invalid/)
  assert.throws(() => applyRepairDraftSettingsHash(draft, [firstHash], { initialize: true }), /invalid/)

  const initialized = applyRepairDraftSettingsHash(draft, firstHash, { initialize: true })
  const changed = applyRepairDraftSettingsHash(initialized, secondHash)
  const restored = applyRepairDraftSettingsHash(changed, firstHash)

  assert.equal(initialized.dirty, false)
  assert.equal(initialized.hashStatus, 'ready')
  assert.equal(changed.dirty, true)
  assert.equal(restored.dirty, false)
})

test('editing a hashed draft invalidates preview freshness until rehash completes', () => {
  const settingsHash = 'a'.repeat(64)
  const recipeHash = 'b'.repeat(64)
  const selected = {
    projectId: 'project_demo',
    projectRevision: 3,
    assetId: 'asset_hero',
    revisionId: 'rev_current',
  }
  const previewInput = {
    submittedDraftSettingsHash: settingsHash,
    selection: selected,
    submittedSelection: selected,
    job: { status: 'done' },
    artifacts: { complete: true },
    validation: { status: 'pass' },
  }
  const initialized = applyRepairDraftSettingsHash(createDraft(undefined), settingsHash, {
    initialize: true,
  })
  const beforeEdit = getRepairPreviewFreshness({
    ...previewInput,
    currentDraftSettingsHash: initialized.currentDraftSettingsHash,
  })

  assert.deepEqual(beforeEdit, { state: 'ready', fresh: true, inspectable: true })
  assert.deepEqual(getRepairAcceptanceState({
    previewState: beforeEdit.state,
    underlyingJobStatus: 'done',
    hashesMatch: true,
    fresh: beforeEdit.fresh,
    artifactsComplete: true,
    qualityStatus: 'pass',
    jobId: 'job_preview',
    recipeHash,
  }), { canAccept: true, reason: null })

  const edited = updateRepairRecipeDraft(initialized, {
    path: 'background.tolerance',
    value: 25,
  })
  const afterEdit = getRepairPreviewFreshness({
    ...previewInput,
    currentDraftSettingsHash: edited.currentDraftSettingsHash,
  })

  assert.equal(edited.hashStatus, 'pending')
  assert.equal(edited.currentDraftSettingsHash, null)
  assert.equal(edited.openingDraftSettingsHash, settingsHash)
  assert.equal(edited.dirty, true)
  assert.deepEqual(afterEdit, { state: 'stale', fresh: false, inspectable: true })
  assert.deepEqual(getRepairAcceptanceState({
    previewState: afterEdit.state,
    underlyingJobStatus: 'done',
    hashesMatch: true,
    fresh: afterEdit.fresh,
    artifactsComplete: true,
    qualityStatus: 'pass',
    jobId: 'job_preview',
    recipeHash,
  }), { canAccept: false, reason: 'preview_not_acceptable' })
})

test('canonicalization validates manual cut boundaries', () => {
  const recipe = createDraft(undefined).recipe
  recipe.grid.manual_overrides = validManualGrid()
  assert.deepEqual(canonicalizeRepairRecipe(recipe, canonicalContext()).grid.manual_overrides, validManualGrid())

  const invalidCases = [
    ['columns', { columns: [0, 96, 768], rows: validManualGrid().rows }],
    ['columns', { columns: [1, 96, 192, 288, 384, 480, 576, 672, 768], rows: validManualGrid().rows }],
    ['columns', { columns: [0, 96, 192, 288, 384, 480, 576, 576, 768], rows: validManualGrid().rows }],
    ['rows', { columns: validManualGrid().columns, rows: [0, 96.5, 192, 288, 384, 480, 576, 672, 768] }],
  ]
  for (const [axis, manualOverrides] of invalidCases) {
    const candidate = structuredClone(recipe)
    candidate.grid.manual_overrides = manualOverrides
    assertRepairCode(
      () => canonicalizeRepairRecipe(candidate, canonicalContext()),
      `invalid_manual_${axis}`,
    )
  }
})

test('canonicalization rejects manual cuts when the resolved source has fixed regions', () => {
  const recipe = createDraft(undefined).recipe
  recipe.grid.manual_overrides = validManualGrid()

  assertRepairCode(
    () => canonicalizeRepairRecipe(recipe, canonicalContext({ sourceLayoutKind: 'fixed_regions' })),
    'manual_grid_unavailable_for_fixed_regions',
  )
})

test('canonicalization validates and numerically orders frame adjustments', () => {
  const recipe = createDraft(undefined).recipe
  recipe.frame_adjustments = {
    10: { dx: 1, dy: 0 },
    2: { dx: -2, dy: 3 },
    1: { dx: 0, dy: 0 },
  }

  const canonical = canonicalizeRepairRecipe(recipe, canonicalContext())
  assert.deepEqual(Object.keys(canonical.frame_adjustments), ['2', '10'])
  assert.deepEqual(canonical.frame_adjustments, {
    2: { dx: -2, dy: 3 },
    10: { dx: 1, dy: 0 },
  })

  for (const frameAdjustments of [
    { 64: { dx: 1, dy: 0 } },
    { '-1': { dx: 1, dy: 0 } },
    { '1.5': { dx: 1, dy: 0 } },
    { '01': { dx: 1, dy: 0 } },
    { '1e0': { dx: 1, dy: 0 } },
    { '+1': { dx: 1, dy: 0 } },
    { '': { dx: 1, dy: 0 } },
    { 2: { dx: 17, dy: 0 } },
    { 2: { dx: 1, dy: 0, extra: true } },
    { 2: { dx: 1.5, dy: 0 } },
  ]) {
    const candidate = structuredClone(recipe)
    candidate.frame_adjustments = frameAdjustments
    assertRepairCode(
      () => canonicalizeRepairRecipe(candidate, canonicalContext()),
      'invalid_frame_adjustments',
    )
  }
})

test('canonicalization rejects unknown locks and deduplicates known locks in profile order', () => {
  const recipe = createDraft(undefined).recipe
  recipe.locked_animations = ['walk_down', 'idle_up', 'walk_down', 'idle_up']

  const canonical = canonicalizeRepairRecipe(recipe, canonicalContext())
  assert.deepEqual(canonical.locked_animations, ['idle_up', 'walk_down'])

  recipe.locked_animations = ['walk_down', 'missing_animation']
  assertRepairCode(
    () => canonicalizeRepairRecipe(recipe, canonicalContext()),
    'unknown_locked_animation',
  )
})

test('canonicalization conditionally requires a managed black matte', () => {
  const recipe = createDraft(undefined, managedSourceContext({
    blackMatteArtifactRef: 'managed/black.png',
  })).recipe
  recipe.background.mode = 'dual_matte'

  assertRepairCode(
    () => canonicalizeRepairRecipe(recipe, canonicalContext()),
    'dual_matte_requires_managed_black_matte',
  )
  assert.equal(
    canonicalizeRepairRecipe(recipe, canonicalContext({ hasBlackMatte: true })).background.mode,
    'dual_matte',
  )
  assertRepairCode(
    () => canonicalizeRepairRecipe(recipe, canonicalContext({ inputMode: 'normalized_sheet_fallback', hasBlackMatte: true })),
    'dual_matte_requires_managed_black_matte',
  )
})

test('canonicalization preserves strict style-budget validation as a server defense', () => {
  const recipe = createDraft(undefined).recipe
  recipe.pixel_finishing.enabled = true
  recipe.pixel_finishing.max_colors = 8
  recipe.style_report.max_colors = 16

  assertRepairCode(
    () => canonicalizeRepairRecipe(recipe, canonicalContext()),
    'style_report_budget_must_match_pixel_finishing',
  )
})

test('validation returns canonical results and implementation binding stays server-owned', () => {
  const draft = createDraft(undefined)
  draft.recipe.locked_animations = ['walk_down', 'idle_up', 'walk_down']

  const result = validateRepairRecipeDraft(draft, canonicalContext())
  assert.equal(result.status, 'pass')
  assert.deepEqual(result.blocking_errors, [])
  assert.deepEqual(result.canonical.locked_animations, ['idle_up', 'walk_down'])

  const withRevision = withRepairImplementationRevision(result.canonical, '8aa1b0d')
  assert.equal(withRevision.implementation_revision, '8aa1b0d')
  assert.equal(result.canonical.implementation_revision, null)

  assertRepairCode(
    () => withRepairImplementationRevision(withRevision, 'new-build'),
    'draft_implementation_revision_must_be_null',
  )

  draft.recipe.frame_adjustments = { 100: { dx: 1, dy: 0 } }
  assert.deepEqual(validateRepairRecipeDraft(draft, canonicalContext()), {
    status: 'fail',
    blocking_errors: ['invalid_frame_adjustments'],
    canonical: null,
  })
})

test('validation converts malformed Recipe sections into stable blocking errors', () => {
  for (const mutate of [
    (recipe) => { recipe.background = null },
    (recipe) => { delete recipe.background },
    (recipe) => { delete recipe.grid },
  ]) {
    const draft = createDraft(undefined)
    mutate(draft.recipe)

    const result = validateRepairRecipeDraft(draft, canonicalContext())

    assert.equal(result.status, 'fail')
    assert.equal(result.canonical, null)
    assert.ok(result.blocking_errors.length > 0)
  }
})
