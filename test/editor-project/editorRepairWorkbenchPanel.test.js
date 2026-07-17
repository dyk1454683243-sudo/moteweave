import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import { TOPDOWN_RPG_V0 } from '../../src/character-pack/profile.js'
import { createDefaultCharacterProcessingRecipe } from '../../src/editor-project/recipes.js'
import { buildRepairUiStateModel } from '../../src/ui/editor/repairWorkbenchPanel.js'
import { fakeDocument } from '../helpers/fakeEditorDom.js'

const REPAIR_UI_STATE_CASES = [
  ['no_project', 'Load a project to use Repair.', [], false],
  ['no_asset', 'Select a Character Pack asset to begin.', [], false],
  ['unsupported_asset', 'Repair is available for Character Pack assets.', [], false],
  ['loading', 'Loading managed Character Pack artifacts…', [], false],
  ['missing_artifact', 'A required managed artifact is unavailable.', ['retry'], false],
  ['unsafe_artifact_path', 'A managed artifact path was rejected.', [], false],
  ['no_preview', 'Build Preview to compare processed output.', ['build', 'discard'], true],
  ['dirty', 'Recipe has unbuilt changes.', ['build', 'reset', 'discard'], true],
  ['invalid_recipe', 'Fix the highlighted Recipe fields before building.', ['reset', 'discard'], true],
  ['queued', 'Preview queued.', ['discard'], true],
  ['processing', 'Preview processing.', ['discard'], true],
  ['ready', 'Preview ready for review.', ['build', 'accept', 'reset', 'discard'], true],
  ['stale', 'Recipe changed after this Preview.', ['build', 'reset', 'discard'], true],
  ['warning', 'Review and confirm warnings before accepting.', ['build', 'accept', 'confirm_warning', 'reset', 'discard'], true],
  ['accepting', 'Accepting revision… Keep this project open until the outcome is known.', [], true],
  ['blocked_quality', 'Preview failed the quality gate and cannot be accepted.', ['build', 'reset', 'discard'], true],
  ['failed', 'Preview processing failed. Your draft is unchanged.', ['build', 'reset', 'discard'], true],
  ['revision_conflict', 'The project changed. Reload before building or accepting.', ['discard'], true],
  ['asset_revision_conflict', 'The active asset revision changed. Reopen Repair.', ['discard'], true],
  ['selection_switched', 'Repair context changed; late results were ignored.', [], false],
  ['accepted', 'Preview accepted as a new immutable revision.', ['discard'], false],
  ['teardown', '', [], false],
]

for (const [state, message, actions, retainsDraft] of REPAIR_UI_STATE_CASES) {
  test(`Repair UI state ${state}`, () => {
    const model = buildRepairUiStateModel({ state })
    assert.equal(model.message, message)
    assert.deepEqual(model.actions, actions)
    assert.equal(model.retainsDraft, retainsDraft)
    assert.equal(model.mutatesProject, state === 'accepted')
    assert.equal(model.announcement, message)
  })
}

test('Repair UI state model gates actions, preserves typed details, and distinguishes blocking tone', () => {
  const warning = buildRepairUiStateModel({
    state: 'warning', draftDirty: true, canBuild: true, canAccept: true, warningConfirmed: false,
  })
  assert.deepEqual(warning.actionAvailability, {
    retry: false, build: true, accept: true, reset: true, discard: true, confirmWarning: true,
  })
  assert.equal(warning.tone, 'warning')

  const unsafe = buildRepairUiStateModel({
    state: 'unsafe_artifact_path', errorCode: 'unsafe_artifact_path', details: 'escaped root', canBuild: true,
  })
  assert.equal(unsafe.errorText, 'unsafe_artifact_path: escaped root')
  assert.equal(unsafe.actionAvailability.retry, false)
  assert.equal(unsafe.actionAvailability.build, false)
  assert.equal(unsafe.tone, 'blocking')

  const missing = buildRepairUiStateModel({ state: 'missing_artifact' })
  assert.equal(missing.actionAvailability.retry, true)
  assert.equal(buildRepairUiStateModel({ state: 'no_preview' }).tone, 'neutral')
})

function canonicalRecipe() {
  const recipe = createDefaultCharacterProcessingRecipe()
  recipe.source = {
    file_name: 'source.png',
    source_layout: 'topdown_rpg_v0',
    source_job_id: 'job_parent',
    asset_id: 'asset_hero',
    black_matte_artifact_ref: null,
  }
  return recipe
}

function modelFixture(overrides = {}) {
  const recipe = canonicalRecipe()
  const beforeImage = { width: 768, height: 768 }
  const local = {
    draft: {
      recipe,
      fieldOrigins: Object.fromEntries([
        'grid.manual_overrides', 'anchor_offset.x', 'anchor_offset.y', 'frame_adjustments',
        'background.mode', 'background.tolerance', 'cleanup.component_cleanup', 'cleanup.min_alpha',
        'cleanup.min_area', 'cleanup.min_area_ratio', 'pixel_finishing.enabled',
        'pixel_finishing.max_colors', 'pixel_finishing.outline', 'pixel_finishing.outline_mode',
        'correction.auto_correct', 'correction.motion_stabilize', 'correction.motion_max_shift',
        'locked_animations', 'style_report.max_colors',
      ].map((path) => [path, 'default'])),
      provenance: { fixedRegionStaging: null },
      dirty: false,
    },
    view: { clipId: 'walk_down', frameIndex: 0, mode: 'before', zoom: 1, pan: { x: 0, y: 0 }, overlays: { cuts: true, anchor: true, baseline: true, bbox: true, debug: false } },
    filmstrip: { frames: [0, 1], selectedIndex: 0, playing: false },
    preview: null,
    previewModel: null,
    acceptInFlight: false,
    warningConfirmation: null,
    ...overrides.local,
  }
  const sourceContext = {
    inputMode: 'managed_source', sourceLayoutKind: 'uniform_grid', sourceSize: { width: 768, height: 768 },
    beforeImage, autoGrid: { columns: Array.from({ length: 9 }, (_, index) => index * 96), rows: Array.from({ length: 9 }, (_, index) => index * 96) },
    manualGrid: { enabled: true, reason: null }, dualMatte: { enabled: false, reason: 'No valid managed black matte is recorded' },
    ...overrides.sourceContext,
  }
  const asset = {
    id: 'asset_hero', name: 'A hero name that remains fully accessible',
    clips: {
      walk_down: { label: 'Walking down with a deliberately long clip name', frames: [0, 1], fps: 8 },
      idle_empty: { label: 'Empty idle', frames: [], fps: 8 },
      attack: { label: 'Attack', frames: [12, 13], fps: 4 },
    },
    ...overrides.asset,
  }
  const previewModel = {
    state: 'no_preview',
    modeAvailability: { before: { enabled: true }, after: { enabled: false, reason: 'after_frame_unavailable' }, split: { enabled: false, reason: 'comparison_size_mismatch' }, difference: { enabled: false, reason: 'comparison_size_mismatch' }, onion: { enabled: false, reason: 'comparison_size_mismatch' } },
    acceptance: { canAccept: false, reason: 'no_preview' },
    diagnostics: [{ code: 'no_preview', message: 'Build Preview to compare processed output.' }],
    evidence: null,
    ...overrides.previewModel,
  }
  const renderFrame = {
    mode: local.view.mode, before: beforeImage, after: null, beforeRect: { sx: 0, sy: 0, sw: 96, sh: 96 }, afterRect: null,
    frameSize: TOPDOWN_RPG_V0.frame, overlayCommands: [{ type: 'anchor', x: 48, y: 80, overlay: 'anchor' }],
    ...overrides.renderFrame,
  }
  return {
    local, aiAction: { assetId: null, revisionId: null, selectedAction: '', providerPresetId: '', imageSize: '1K', status: 'idle', message: '' },
    asset, revision: { id: 'rev_001' }, sourceContext, profile: TOPDOWN_RPG_V0,
    validation: { status: 'pass', blocking_errors: [], invalidPaths: [] }, previewModel, renderFrame,
  }
}

test('Repair workbench source exposes the complete honest surface and no forbidden active capability', async () => {
  const source = await readFile('src/ui/editor/repairWorkbenchPanel.js', 'utf8')
  for (const expected of [
    'editor-repair-workbench', 'editor-repair-header', 'editor-repair-canvas', 'editor-repair-recipe',
    'editor-repair-filmstrip', 'editor-repair-quality', 'aria-live', 'aria-pressed',
    'Geometry', 'Cleanup', 'Pixel Finishing', 'Advanced correction', 'AI Action Repair',
    'Build Preview', 'Accept as revision', 'Reset draft', 'Discard session', 'warning-confirmation',
    'First', 'Play', 'Last', 'Repair Frame', 'Quality Gate', 'fixed-staging', 'dual_matte', 'Coming later',
  ]) assert.match(source, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.doesNotMatch(source, /brush|eraser|Style Enforcement|provider key|raw generated path/i)
  assert.doesNotMatch(source, /importGeneratedJob|Pixel Grid Refinement[^\n]*disabled\s*=\s*false/)
  assert.doesNotMatch(source, /aria-disabled-reason/, 'disabled reasons must use standard accessible name/description semantics')
  assert.match(source, /textarea:not\(\[disabled\]\)/, 'mobile Recipe focus trapping must include the Frame Repair instruction')
})

test('Repair Recipe view model binds availability, provenance, real clips, and concise quality evidence', async () => {
  const { buildRepairWorkbenchViewModel } = await import('../../src/ui/editor/repairWorkbenchPanel.js')
  const fixture = modelFixture({
    previewModel: {
      state: 'ready',
      acceptance: { canAccept: true, reason: null },
      evidence: {
        validationStatus: 'pass', failureTaxonomy: [], uniqueColors: 16, paletteChangedRatio: 0.2,
        haloBefore: 4, haloAfter: 0, residueBefore: 2, residueAfter: 0, outlineRatio: 0.1,
        componentCleanup: { removed_components: 3 }, anchor: { effective_anchor: { x: 48, y: 80 } }, baseline: 80,
        motionStabilization: { applied_count: 2 }, manualAdjustments: { wouldCrop: [{ frame: 7, dx: 16, dy: -16, reason: 'would_crop' }] },
        framesByIndex: {}, warnings: [], missingMetrics: [], differenceDiagnostics: [
          { code: 'difference_alpha_only_change', pixelCount: 3 },
          { code: 'difference_transparent_rgb_only', pixelCount: 2 },
        ],
      },
      diagnostics: [],
    },
  })
  fixture.local.filmstrip = { frames: Array.from({ length: 64 }, (_, index) => index), selectedIndex: 0, playing: false }
  fixture.asset.clips.walk_down.frames = [...fixture.local.filmstrip.frames]
  const view = buildRepairWorkbenchViewModel(fixture)
  assert.equal(view.assetName, fixture.asset.name)
  assert.equal(view.filmstrip.items.length, 64)
  assert.equal(view.filmstrip.summary, '64 frames; first sheet frame 0')
  assert.match(view.qualityRows.find((row) => row.label === 'Would crop').value, /frame 7, dx 16, dy -16, not applied/)
  assert.match(view.differenceDiagnosticText, /3 alpha-only/)
  assert.match(view.differenceDiagnosticText, /2 transparent RGB-only/)
  assert.deepEqual(view.previewModelEvidenceTaxonomy ?? fixture.previewModel.evidence.failureTaxonomy, [])
  assert.equal(view.controlAvailability['pixel_finishing.max_colors'].enabled, false)
  assert.equal(view.controlAvailability['correction.motion_max_shift'].enabled, true)
  assert.equal(view.dualMatte.enabled, false)
  assert.equal(view.fieldOrigins['background.mode'], 'default')
})

test('Repair overlay commands never fabricate uniform cuts for fixed-region or empty-frame sources', async () => {
  const { buildRepairDraftOverlayCommands } = await import('../../src/ui/editor/repairWorkbenchPanel.js')
  const fixed = buildRepairDraftOverlayCommands({ recipe: canonicalRecipe(), profile: TOPDOWN_RPG_V0, frameIndex: 0, sourceSize: { width: 768, height: 768 }, sourceLayoutKind: 'fixed_regions' })
  assert.equal(fixed.some((command) => command.overlay === 'cuts'), false)
  const empty = buildRepairDraftOverlayCommands({ recipe: canonicalRecipe(), profile: TOPDOWN_RPG_V0, frameIndex: null })
  assert.deepEqual(empty, [])
})

test('Repair panel mounts once, changes clips locally, disables single-frame play, and exposes accessible reasons', async () => {
  const { buildRepairWorkbenchViewModel, createRepairWorkbenchPanel } = await import('../../src/ui/editor/repairWorkbenchPanel.js')
  const documentRef = fakeDocument()
  const root = documentRef.createElement('div')
  const calls = { clip: [], build: 0, render: 0 }
  const fixture = modelFixture()
  let view = buildRepairWorkbenchViewModel(fixture)
  const context = {
    selection: { projectId: 'p', projectRevision: 1, assetId: 'asset_hero', revisionId: 'rev_001' },
    viewModel: () => view,
    setView() {}, patchDraft() {}, resetDraft() {}, buildPreview() { calls.build += 1 }, acceptPreview() {}, discard() {},
    handleFilmstripAction() {}, handleFilmstripKey() {}, selectFilmstripFrame() {}, confirmWarning() {}, renderAiAction() {}, onClose() {},
    selectClip(clipId) { calls.clip.push(clipId) },
  }
  const panel = createRepairWorkbenchPanel({
    root, documentRef, lifecycle: { setSelection() {}, stop() {} },
    createRenderer: () => ({ render() { calls.render += 1 }, destroy() {} }),
    onProjectAccepted() {}, announce() {},
  })
  panel.open(context)
  const workbench = root.querySelector('.editor-repair-workbench')
  assert.ok(workbench)
  assert.equal(root.children.length, 1)
  const canvas = root.querySelector('.editor-repair-canvas')
  assert.equal(canvas.tabIndex, 0)
  assert.match(canvas.getAttribute('aria-label'), /Character Pack frame evidence/)
  const clip = root.querySelector('[data-repair-control="filmstrip-clip"]')
  clip.value = 'idle_empty'
  clip.dispatchEvent({ type: 'change' })
  assert.deepEqual(calls.clip, ['idle_empty'])
  assert.equal(calls.build, 0)
  fixture.local.view.clipId = 'attack'
  fixture.local.filmstrip = { frames: [12], selectedIndex: 0, playing: false }
  fixture.asset.clips.attack.frames = [12]
  view = buildRepairWorkbenchViewModel(fixture)
  panel.render(view)
  const play = root.querySelector('.editor-repair-filmstrip-play')
  assert.equal(play.disabled, true)
  assert.match(play.title, /at least two frames/i)
  panel.close('panel_switch')
  panel.destroy()
  assert.equal(root.children.length, 0)
})

test('Repair controls patch only named Recipe paths and never auto-build', async () => {
  const { buildRepairWorkbenchViewModel, createRepairWorkbenchPanel } = await import('../../src/ui/editor/repairWorkbenchPanel.js')
  const documentRef = fakeDocument()
  const root = documentRef.createElement('div')
  const fixture = modelFixture()
  const patches = []
  let builds = 0
  const view = buildRepairWorkbenchViewModel(fixture)
  const context = {
    selection: { projectId: 'p', projectRevision: 1, assetId: 'asset_hero', revisionId: 'rev_001' }, viewModel: () => view,
    setView() {}, patchDraft(value) { patches.push(value) }, resetDraft() {}, buildPreview() { builds += 1 }, acceptPreview() {}, discard() {},
    handleFilmstripAction() {}, handleFilmstripKey() {}, selectFilmstripFrame() {}, selectClip() {}, confirmWarning() {}, renderAiAction() {}, onClose() {},
  }
  const panel = createRepairWorkbenchPanel({ root, documentRef, lifecycle: { setSelection() {}, stop() {} }, createRenderer: () => ({ render() {}, destroy() {} }), onProjectAccepted() {}, announce() {} })
  panel.open(context)
  const tolerance = root.querySelector('[data-repair-control="background-tolerance"]')
  tolerance.value = '31'
  tolerance.dispatchEvent({ type: 'input' })
  const anchor = root.querySelector('[data-repair-control="anchor-x"]')
  anchor.value = '4'
  anchor.dispatchEvent({ type: 'input' })
  assert.deepEqual(patches, [
    { path: 'background.tolerance', value: 31 },
    { path: 'anchor_offset.x', value: 4 },
  ])
  assert.equal(builds, 0)
})

test('Repair panel mobile Recipe drawer traps focus and closes on Escape', async () => {
  const { buildRepairWorkbenchViewModel, createRepairWorkbenchPanel } = await import('../../src/ui/editor/repairWorkbenchPanel.js')
  const documentRef = fakeDocument({ narrow: true })
  const root = documentRef.createElement('div')
  const fixture = modelFixture()
  const view = buildRepairWorkbenchViewModel(fixture)
  const context = {
    selection: { projectId: 'p', projectRevision: 1, assetId: 'asset_hero', revisionId: 'rev_001' }, viewModel: () => view,
    setView() {}, patchDraft() {}, resetDraft() {}, buildPreview() {}, acceptPreview() {}, discard() {}, handleFilmstripAction() {}, handleFilmstripKey() {}, selectFilmstripFrame() {}, selectClip() {}, confirmWarning() {},
    renderAiAction(container) { const hiddenPlan = documentRef.createElement('button'); hiddenPlan.textContent = 'Hidden Plan'; container.append(hiddenPlan) }, onClose() {},
  }
  const panel = createRepairWorkbenchPanel({ root, documentRef, lifecycle: { setSelection() {}, stop() {} }, createRenderer: () => ({ render() {}, destroy() {} }), onProjectAccepted() {}, announce() {} })
  panel.open(context)
  const trigger = root.querySelector('.editor-repair-recipe-trigger')
  trigger.dispatchEvent({ type: 'click' })
  assert.equal(trigger.getAttribute('aria-expanded'), 'true')
  const recipe = root.querySelector('.editor-repair-recipe')
  recipe.dispatchEvent({ type: 'keydown', key: 'Tab', shiftKey: true })
  assert.equal(documentRef.activeElement, root.querySelector('summary'))
  recipe.dispatchEvent({ type: 'keydown', key: 'Escape' })
  assert.equal(trigger.getAttribute('aria-expanded'), 'false')
  assert.equal(documentRef.activeElement, trigger)
})

test('Repair Recipe full control matrix dispatches only its declared local path with zero Build calls', async () => {
  const { buildRepairWorkbenchViewModel, createRepairWorkbenchPanel, REPAIR_RECIPE_CONTROL_SPECS } = await import('../../src/ui/editor/repairWorkbenchPanel.js')
  const documentRef = fakeDocument()
  const root = documentRef.createElement('div')
  const fixture = modelFixture()
  fixture.local.draft.recipe.grid.manual_overrides = {
    columns: Array.from({ length: 9 }, (_, index) => index * 96),
    rows: Array.from({ length: 9 }, (_, index) => index * 96),
  }
  fixture.local.draft.recipe.pixel_finishing.enabled = true
  const patches = []
  let builds = 0
  let view = buildRepairWorkbenchViewModel(fixture)
  const context = {
    selection: { projectId: 'p', projectRevision: 1, assetId: 'asset_hero', revisionId: 'rev_001' }, viewModel: () => view,
    setView() {}, patchDraft(value) { patches.push(value) }, resetDraft() {}, buildPreview() { builds += 1 }, acceptPreview() {}, discard() {},
    handleFilmstripAction() {}, handleFilmstripKey() {}, selectFilmstripFrame() {}, selectClip() {}, confirmWarning() {}, renderAiAction() {}, onClose() {},
  }
  const panel = createRepairWorkbenchPanel({ root, documentRef, lifecycle: { setSelection() {} }, createRenderer: () => ({ render() {}, destroy() {} }), onProjectAccepted() {}, announce() {} })
  panel.open(context)

  const seen = new Set()
  for (const spec of REPAIR_RECIPE_CONTROL_SPECS) {
    const control = root.querySelector(`[data-repair-control="${spec.control}"]`)
    if (control.disabled) continue
    seen.add(spec.control)
    patches.length = 0
    if (spec.type === 'checkbox') control.checked = !control.checked
    else if (spec.type === 'number') control.value = String(Number(control.value) + Number(control.step || 1))
    else if (spec.type === 'multiple') control.options[0].selected = !control.options[0].selected
    else control.value = control.options.find((option) => !option.disabled && option.value !== control.value)?.value ?? control.value
    control.dispatchEvent({ type: spec.type === 'number' ? 'input' : 'change' })
    assert.equal(patches.length, 1, spec.control)
    assert.equal(patches[0].path, spec.path, spec.control)
  }
  assert.deepEqual(
    [...seen].sort(),
    REPAIR_RECIPE_CONTROL_SPECS.filter((spec) => spec.control !== 'style-max-colors').map((spec) => spec.control).sort(),
  )
  const geometryControls = [
    ['anchor-x', 'anchor_offset.x'], ['anchor-y', 'anchor_offset.y'],
    ['frame-dx', 'frame_adjustments.0.dx'], ['frame-dy', 'frame_adjustments.0.dy'],
  ]
  for (const [selector, path] of geometryControls) {
    patches.length = 0
    const control = root.querySelector(`[data-repair-control="${selector}"]`)
    control.value = '1'
    control.dispatchEvent({ type: 'input' })
    assert.deepEqual(patches, [{ path, value: 1 }])
  }
  patches.length = 0
  for (const control of [
    ...root.querySelectorAll('[data-repair-control="grid-x"]'),
    ...root.querySelectorAll('[data-repair-control="grid-y"]'),
  ]) {
    patches.length = 0
    control.dispatchEvent({ type: 'input' })
    assert.equal(patches[0].path, 'grid.manual_overrides')
    assert.equal(patches[0].value.columns.length, 9)
    assert.equal(patches[0].value.rows.length, 9)
    assert.equal(patches[0].value.columns[0], 0)
    assert.equal(patches[0].value.columns.at(-1), 768)
  }
  const gridMode = root.querySelector('[data-repair-control="grid-mode"]')
  patches.length = 0
  gridMode.value = 'auto'
  gridMode.dispatchEvent({ type: 'change' })
  assert.deepEqual(patches, [{ path: 'grid.manual_overrides', value: null }])
  patches.length = 0
  gridMode.value = 'manual'
  gridMode.dispatchEvent({ type: 'change' })
  assert.equal(patches[0].value.columns.length, 9)
  assert.equal(builds, 0)

  view = buildRepairWorkbenchViewModel(fixture)
  panel.render(view)
  const styleBudget = root.querySelector('[data-repair-control="style-max-colors"]')
  assert.equal(styleBudget.disabled, true)
  assert.match(styleBudget.getAttribute('aria-label'), /Derived from/)
  patches.length = 0
  styleBudget.value = '99'
  styleBudget.dispatchEvent({ type: 'input' })
  assert.equal(patches.length, 0, 'disabled derived style budget must not patch')

  fixture.local.draft.recipe.pixel_finishing.enabled = false
  view = buildRepairWorkbenchViewModel(fixture)
  panel.render(view)
  patches.length = 0
  styleBudget.value = '17'
  styleBudget.dispatchEvent({ type: 'input' })
  assert.deepEqual(patches, [{ path: 'style_report.max_colors', value: 17 }])
})

test('Repair numeric blank remains invalid instead of silently becoming zero', async () => {
  const { buildRepairWorkbenchViewModel, createRepairWorkbenchPanel } = await import('../../src/ui/editor/repairWorkbenchPanel.js')
  const documentRef = fakeDocument()
  const root = documentRef.createElement('div')
  const fixture = modelFixture()
  const patches = []
  const view = buildRepairWorkbenchViewModel(fixture)
  const context = {
    selection: { projectId: 'p', projectRevision: 1, assetId: 'asset_hero', revisionId: 'rev_001' }, viewModel: () => view,
    setView() {}, patchDraft(value) { patches.push(value) }, resetDraft() {}, buildPreview() {}, acceptPreview() {}, discard() {}, handleFilmstripAction() {}, handleFilmstripKey() {}, selectFilmstripFrame() {}, selectClip() {}, confirmWarning() {}, renderAiAction() {}, onClose() {},
  }
  const panel = createRepairWorkbenchPanel({ root, documentRef, lifecycle: { setSelection() {} }, createRenderer: () => ({ render() {}, destroy() {} }), onProjectAccepted() {}, announce() {} })
  panel.open(context)
  const anchor = root.querySelector('[data-repair-control="anchor-x"]')
  anchor.value = ''
  anchor.dispatchEvent({ type: 'input' })
  assert.equal(Number.isNaN(patches[0].value), true)
})

test('Repair panel ignores disabled events, single-frame Space, and redraws cached thumbnails only once', async () => {
  const { buildRepairWorkbenchViewModel, createRepairWorkbenchPanel } = await import('../../src/ui/editor/repairWorkbenchPanel.js')
  const documentRef = fakeDocument()
  const root = documentRef.createElement('div')
  const fixture = modelFixture()
  fixture.local.view.clipId = 'attack'
  fixture.local.filmstrip = { frames: [12], selectedIndex: 0, playing: false }
  fixture.asset.clips.attack.frames = [12]
  let view = buildRepairWorkbenchViewModel(fixture)
  const actions = []
  const patches = []
  const context = {
    selection: { projectId: 'p', projectRevision: 1, assetId: 'asset_hero', revisionId: 'rev_001' }, viewModel: () => view,
    setView() {}, patchDraft(value) { patches.push(value) }, resetDraft() {}, buildPreview() {}, acceptPreview() {}, discard() {},
    handleFilmstripAction(value) { actions.push(value) }, handleFilmstripKey(value) { actions.push(value) }, selectFilmstripFrame() {}, selectClip() {}, confirmWarning() {}, renderAiAction() {}, onClose() {},
  }
  const panel = createRepairWorkbenchPanel({ root, documentRef, lifecycle: { setSelection() {} }, createRenderer: () => ({ render() {}, destroy() {} }), onProjectAccepted() {}, announce() {} })
  panel.open(context)
  const firstDrawCount = documentRef.drawImageCount
  panel.render(view)
  assert.equal(documentRef.drawImageCount, firstDrawCount)
  root.querySelector('.editor-repair-filmstrip-frames').dispatchEvent({ type: 'keydown', key: ' ' })
  assert.deepEqual(actions, [])
  const disabledStyle = root.querySelector('[data-repair-control="style-max-colors"]')
  fixture.local.draft.recipe.pixel_finishing.enabled = true
  view = buildRepairWorkbenchViewModel(fixture)
  panel.render(view)
  disabledStyle.value = '99'
  disabledStyle.dispatchEvent({ type: 'input' })
  assert.deepEqual(patches, [])
})

test('Repair mobile media changes synchronize Recipe inert and aria-hidden state', async () => {
  const { buildRepairWorkbenchViewModel, createRepairWorkbenchPanel } = await import('../../src/ui/editor/repairWorkbenchPanel.js')
  const documentRef = fakeDocument({ narrow: false })
  const root = documentRef.createElement('div')
  const fixture = modelFixture()
  const view = buildRepairWorkbenchViewModel(fixture)
  const context = {
    selection: { projectId: 'p', projectRevision: 1, assetId: 'asset_hero', revisionId: 'rev_001' }, viewModel: () => view,
    setView() {}, patchDraft() {}, resetDraft() {}, buildPreview() {}, acceptPreview() {}, discard() {}, handleFilmstripAction() {}, handleFilmstripKey() {}, selectFilmstripFrame() {}, selectClip() {}, confirmWarning() {}, renderAiAction() {}, onClose() {},
  }
  const panel = createRepairWorkbenchPanel({ root, documentRef, lifecycle: { setSelection() {} }, createRenderer: () => ({ render() {}, destroy() {} }), onProjectAccepted() {}, announce() {} })
  panel.open(context)
  const recipe = root.querySelector('.editor-repair-recipe')
  assert.equal(recipe.inert, false)
  assert.equal(recipe.getAttribute('aria-hidden'), null)
  documentRef.media.setMatches(true)
  assert.equal(recipe.inert, true)
  assert.equal(recipe.getAttribute('aria-hidden'), 'true')
  documentRef.media.setMatches(false)
  assert.equal(recipe.inert, false)
  assert.equal(recipe.getAttribute('aria-hidden'), null)
})

test('Repair overlay drawing scales line and anchor geometry by renderer pixel ratio', async () => {
  const { createInitialRepairRenderFrame } = await import('../../src/ui/editor/repairWorkbenchPanel.js')
  const documentRef = fakeDocument()
  const local = modelFixture().local
  local.profile = TOPDOWN_RPG_V0
  local.sourceContext = modelFixture().sourceContext
  local.draft = modelFixture().local.draft
  const frame = createInitialRepairRenderFrame({ local, beforeImage: { width: 768, height: 768 } })
  const ctx = documentRef.createElement('canvas').getContext('2d')
  frame.drawOverlay(ctx, { type: 'anchor', x: 48, y: 88 }, { x: 0, y: 0, w: 96, h: 96 }, 2)
  assert.equal(documentRef.lineWidths.at(-1), 2)
  assert.equal(documentRef.arcCalls.at(-1)[2], 6)
})

test('Repair invalid-path mapping covers every Workbench validator code', async () => {
  const { repairInvalidPaths } = await import('../../src/ui/editor/repairWorkbenchPanel.js')
  const expected = {
    invalid_anchor_offset: ['anchor_offset.x', 'anchor_offset.y'],
    invalid_locked_animations: ['locked_animations'],
    unknown_outline_mode: ['pixel_finishing.outline_mode'],
    invalid_style_report_enabled: ['style_report.enabled'],
    invalid_style_report_max_colors: ['style_report.max_colors'],
    style_report_budget_must_match_pixel_finishing: ['style_report.max_colors'],
  }
  for (const [code, paths] of Object.entries(expected)) {
    assert.deepEqual(repairInvalidPaths([code]).sort(), paths.sort(), code)
  }
})

test('Repair pre-preview evidence stays unavailable and filmstrip timer is the only animation driver', async () => {
  const { buildRepairWorkbenchViewModel } = await import('../../src/ui/editor/repairWorkbenchPanel.js')
  const fixture = modelFixture()
  fixture.local.filmstrip.playing = true
  const view = buildRepairWorkbenchViewModel(fixture)
  assert.equal(view.qualityRows.find((row) => row.label === 'Blocking taxonomy').value, null)
  assert.match(view.differenceDiagnosticText, /Unavailable/)
  assert.equal(view.renderFrame.playing, false)
})

test('Repair invalid sheet frame remains a truthful unavailable item instead of reindexing the clip', async () => {
  const { buildRepairWorkbenchViewModel } = await import('../../src/ui/editor/repairWorkbenchPanel.js')
  const fixture = modelFixture()
  fixture.local.filmstrip = { frames: [0, 999, 1], selectedIndex: 1, playing: false }
  fixture.asset.clips.walk_down.frames = [0, 999, 1]
  const view = buildRepairWorkbenchViewModel(fixture)
  assert.equal(view.filmstrip.items.length, 3)
  assert.equal(view.filmstrip.items[1].frameIndex, 999)
  assert.equal(view.filmstrip.items[1].available, false)
  assert.equal(view.filmstrip.selectedIndex, 1)
})

test('Repair quality and Recipe DOM remain stable across filmstrip-only renders', async () => {
  const { buildRepairWorkbenchViewModel, createRepairWorkbenchPanel } = await import('../../src/ui/editor/repairWorkbenchPanel.js')
  const documentRef = fakeDocument()
  const root = documentRef.createElement('div')
  const fixture = modelFixture()
  let view = buildRepairWorkbenchViewModel(fixture)
  const context = {
    selection: { projectId: 'p', projectRevision: 1, assetId: 'asset_hero', revisionId: 'rev_001' }, viewModel: () => view,
    setView() {}, patchDraft() {}, resetDraft() {}, buildPreview() {}, acceptPreview() {}, discard() {}, handleFilmstripAction() {}, handleFilmstripKey() {}, selectFilmstripFrame() {}, selectClip() {}, confirmWarning() {}, renderAiAction() {}, onClose() {},
  }
  const panel = createRepairWorkbenchPanel({ root, documentRef, lifecycle: { setSelection() {} }, createRenderer: () => ({ render() {}, destroy() {} }), onProjectAccepted() {}, announce() {} })
  panel.open(context)
  const qualityChildren = [...root.querySelector('.editor-repair-quality-metrics').children]
  const createCount = documentRef.createCount
  fixture.local.filmstrip.selectedIndex = 1
  fixture.local.view.frameIndex = 1
  view = buildRepairWorkbenchViewModel(fixture)
  panel.render(view)
  const nextQualityChildren = root.querySelector('.editor-repair-quality-metrics').children
  assert.equal(nextQualityChildren.length, qualityChildren.length)
  nextQualityChildren.forEach((child, index) => assert.equal(child, qualityChildren[index]))
  assert.equal(documentRef.createCount, createCount, 'filmstrip tick must not rebuild stable quality or Recipe nodes')
})

test('Repair disabled actions ignore programmatic clicks and rapid Accept adopts only once', async () => {
  const { buildRepairWorkbenchViewModel, createRepairWorkbenchPanel } = await import('../../src/ui/editor/repairWorkbenchPanel.js')
  const documentRef = fakeDocument()
  const root = documentRef.createElement('div')
  const fixture = modelFixture()
  let buildCalls = 0
  let acceptCalls = 0
  let adopted = 0
  let resolveAccept
  const accepted = new Promise((resolve) => { resolveAccept = resolve })
  let view = buildRepairWorkbenchViewModel(fixture)
  const context = {
    selection: { projectId: 'p', projectRevision: 1, assetId: 'asset_hero', revisionId: 'rev_001' }, viewModel: () => view,
    setView() {}, patchDraft() {}, resetDraft() {}, buildPreview() { buildCalls += 1 }, acceptPreview() { acceptCalls += 1; return accepted }, discard() {}, handleFilmstripAction() {}, handleFilmstripKey() {}, selectFilmstripFrame() {}, selectClip() {}, confirmWarning() {}, renderAiAction() {}, onClose() {},
  }
  const panel = createRepairWorkbenchPanel({ root, documentRef, lifecycle: { setSelection() {} }, createRenderer: () => ({ render() {}, destroy() {} }), onProjectAccepted() { adopted += 1 }, announce() {} })
  panel.open(context)
  root.querySelector('button').dispatchEvent({ type: 'noop' })
  const buttons = root.querySelectorAll('button')
  const build = buttons.find((button) => button.textContent === 'Build Preview')
  const accept = buttons.find((button) => button.textContent === 'Accept as revision')
  assert.equal(accept.disabled, true)
  accept.dispatchEvent({ type: 'click' })
  assert.equal(acceptCalls, 0)
  build.disabled = true
  build.dispatchEvent({ type: 'click' })
  assert.equal(buildCalls, 0)
  fixture.previewModel = { ...fixture.previewModel, state: 'ready', acceptance: { canAccept: true, reason: null } }
  view = buildRepairWorkbenchViewModel(fixture)
  panel.render(view)
  accept.dispatchEvent({ type: 'click' })
  accept.dispatchEvent({ type: 'click' })
  assert.equal(acceptCalls, 1)
  resolveAccept({ project: {}, asset: {} })
  await accepted
  await Promise.resolve()
  assert.equal(adopted, 1)
})

test('Repair filmstrip exposes the real clip label, fps, duration, position, and zero-fps playback truth', async () => {
  const { buildRepairWorkbenchViewModel, createRepairWorkbenchPanel } = await import('../../src/ui/editor/repairWorkbenchPanel.js')
  const documentRef = fakeDocument()
  const root = documentRef.createElement('div')
  const fixture = modelFixture()
  let view = buildRepairWorkbenchViewModel(fixture)
  const context = {
    selection: { projectId: 'p', projectRevision: 1, assetId: 'asset_hero', revisionId: 'rev_001' }, viewModel: () => view,
    setView() {}, patchDraft() {}, resetDraft() {}, buildPreview() {}, acceptPreview() {}, discard() {}, handleFilmstripAction() {}, handleFilmstripKey() {}, selectFilmstripFrame() {}, selectClip() {}, confirmWarning() {}, renderAiAction() {}, onClose() {},
  }
  const panel = createRepairWorkbenchPanel({ root, documentRef, lifecycle: { setSelection() {} }, createRenderer: () => ({ render() {}, destroy() {} }), onProjectAccepted() {}, announce() {} })
  panel.open(context)
  const meta = root.querySelector('.editor-repair-filmstrip-meta')
  assert.match(meta.textContent, /Walking down with a deliberately long clip name/)
  assert.match(meta.textContent, /8 fps/)
  assert.match(meta.textContent, /0\.25s/)
  assert.match(meta.textContent, /1\/2/)
  assert.equal(meta.title, 'Walking down with a deliberately long clip name')

  fixture.asset.clips.walk_down.fps = 0
  view = buildRepairWorkbenchViewModel(fixture)
  panel.render(view)
  const play = root.querySelector('.editor-repair-filmstrip-play')
  assert.equal(play.disabled, true)
  assert.match(play.title, /valid fps/i)
})

test('Repair filmstrip keeps one roving tab stop and moves focus with Arrow selection', async () => {
  const { buildRepairWorkbenchViewModel, createRepairWorkbenchPanel } = await import('../../src/ui/editor/repairWorkbenchPanel.js')
  const documentRef = fakeDocument()
  const root = documentRef.createElement('div')
  const fixture = modelFixture()
  let view = buildRepairWorkbenchViewModel(fixture)
  const context = {
    selection: { projectId: 'p', projectRevision: 1, assetId: 'asset_hero', revisionId: 'rev_001' }, viewModel: () => view,
    setView() {}, patchDraft() {}, resetDraft() {}, buildPreview() {}, acceptPreview() {}, discard() {}, handleFilmstripAction() {},
    handleFilmstripKey(key) {
      if (key !== 'ArrowRight') return
      fixture.local.filmstrip.selectedIndex = 1
      fixture.local.view.frameIndex = 1
      view = buildRepairWorkbenchViewModel(fixture)
      panel.render(view)
    },
    selectFilmstripFrame() {}, selectClip() {}, confirmWarning() {}, renderAiAction() {}, onClose() {},
  }
  const panel = createRepairWorkbenchPanel({ root, documentRef, lifecycle: { setSelection() {} }, createRenderer: () => ({ render() {}, destroy() {} }), onProjectAccepted() {}, announce() {} })
  panel.open(context)
  const listbox = root.querySelector('.editor-repair-filmstrip-frames')
  const first = listbox.children[0]
  const second = listbox.children[1]
  assert.equal(listbox.tabIndex, -1)
  assert.deepEqual(listbox.children.map((item) => item.tabIndex), [0, -1])
  first.focus()
  first.dispatchEvent({ type: 'keydown', key: 'ArrowRight', bubbles: true })
  assert.deepEqual(listbox.children.map((item) => item.tabIndex), [-1, 0])
  assert.equal(documentRef.activeElement, second)

  fixture.local.filmstrip = { frames: [], selectedIndex: 0, playing: false }
  fixture.local.view.frameIndex = null
  view = buildRepairWorkbenchViewModel(fixture)
  panel.render(view)
  assert.equal(listbox.tabIndex, 0)
})

test('Repair AI render key covers the rendered plan, job, import, and status chain', async () => {
  const { buildRepairWorkbenchViewModel } = await import('../../src/ui/editor/repairWorkbenchPanel.js')
  const fixture = modelFixture()
  fixture.aiAction = {
    ...fixture.aiAction,
    plan: { can_run: true, selected_animation: 'walk_down', estimated_provider_calls: 1 },
    job: { id: 'job_ai', status: 'queued', repair_summary_url: '/generated/job_ai/summary.json' },
    importResult: { revision: { id: 'rev_002' } },
  }
  const initial = buildRepairWorkbenchViewModel(fixture).aiActionRenderKey
  fixture.aiAction.plan.estimated_provider_calls = 2
  const changedPlan = buildRepairWorkbenchViewModel(fixture).aiActionRenderKey
  fixture.aiAction.job.status = 'done'
  const changedJob = buildRepairWorkbenchViewModel(fixture).aiActionRenderKey
  fixture.aiAction.importResult.revision.id = 'rev_003'
  const changedImport = buildRepairWorkbenchViewModel(fixture).aiActionRenderKey
  assert.notEqual(initial, changedPlan)
  assert.notEqual(changedPlan, changedJob)
  assert.notEqual(changedJob, changedImport)
})

test('Repair disabled mode, overlay, and navigation events cannot mutate local state programmatically', async () => {
  const { buildRepairWorkbenchViewModel, createRepairWorkbenchPanel } = await import('../../src/ui/editor/repairWorkbenchPanel.js')
  const documentRef = fakeDocument()
  const root = documentRef.createElement('div')
  const fixture = modelFixture()
  const view = buildRepairWorkbenchViewModel(fixture)
  const views = []
  const actions = []
  const context = {
    selection: { projectId: 'p', projectRevision: 1, assetId: 'asset_hero', revisionId: 'rev_001' }, viewModel: () => view,
    setView(value) { views.push(value) }, patchDraft() {}, resetDraft() {}, buildPreview() {}, acceptPreview() {}, discard() {}, handleFilmstripAction(value) { actions.push(value) }, handleFilmstripKey() {}, selectFilmstripFrame() {}, selectClip() {}, confirmWarning() {}, renderAiAction() {}, onClose() {},
  }
  const panel = createRepairWorkbenchPanel({ root, documentRef, lifecycle: { setSelection() {} }, createRenderer: () => ({ render() {}, destroy() {} }), onProjectAccepted() {}, announce() {} })
  panel.open(context)
  const after = root.querySelector('[data-repair-mode="after"]')
  const debug = root.querySelector('[data-repair-overlay="debug"]')
  const first = root.querySelector('.editor-repair-filmstrip-first')
  assert.equal(after.disabled, true)
  assert.equal(debug.disabled, true)
  assert.equal(first.disabled, true)
  after.dispatchEvent({ type: 'click', bubbles: true })
  debug.dispatchEvent({ type: 'click', bubbles: true })
  first.dispatchEvent({ type: 'click', bubbles: true })
  assert.deepEqual(views, [])
  assert.deepEqual(actions, [])
})

test('Frame Repair swaps into the existing Recipe rail, routes Canvas edits, badges one real frame, and restores DOM', async () => {
  const { buildRepairWorkbenchViewModel, createRepairWorkbenchPanel } = await import('../../src/ui/editor/repairWorkbenchPanel.js')
  const documentRef = fakeDocument()
  const root = documentRef.createElement('div')
  const fixture = modelFixture()
  let view = buildRepairWorkbenchViewModel(fixture)
  view.frameRepairEligibility = { enabled: true, reason: null }
  const calls = []
  const frameView = {
    active: true,
    stage: 'target_mask',
    uiState: 'needs_scope',
    message: 'Add a rectangle to define the repair area.',
    announcement: 'Add a rectangle to define the repair area.',
    selection: { clipId: 'walk_down', clipFramePosition: 0, sheetFrameIndex: 0, revisionId: 'rev_001' },
    instruction: '', maskMode: 'add_rectangle', maskEdits: [], selectedEditIndex: null,
    mask: { source: 'user_scoped', confidence: 'needs_scope', activePixelCount: 0 },
    providerState: { active_preset_id: 'preset-a', presets: [{ id: 'preset-a', label: 'Preset A', model: 'model-a', available: true }] },
    providerPresetId: 'preset-a', imageSize: '1K', plan: null, planHash: null, job: null,
    candidate: null, quality: null, diagnostics: [], error: null,
    canReview: false, reviewReason: 'instruction_and_non_empty_mask_required',
    canEdit: true,
    canGenerate: false, generateReason: 'provider_free_plan_required',
    canAccept: false, acceptReason: 'candidate_not_acceptable', warningConfirmed: false,
    actions: ['edit_mask', 'review_call', 'close'],
  }
  const context = {
    selection: { projectId: 'p', projectRevision: 1, assetId: 'asset_hero', revisionId: 'rev_001' },
    viewModel: () => view,
    setView(value) { calls.push(['setView', value]) }, patchDraft() {}, resetDraft() {}, buildPreview() {}, acceptPreview() {}, discard() {},
    handleFilmstripAction() {}, handleFilmstripKey() {}, selectFilmstripFrame() {}, selectClip() {}, confirmWarning() {}, renderAiAction() {}, onClose() {},
    enterFrameRepair() {
      calls.push(['enter'])
      view = {
        ...view,
        frameRepair: frameView,
        filmstrip: {
          ...view.filmstrip,
          items: view.filmstrip.items.map((item, index) => ({
            ...item,
            repaired: index === 0,
            repairedLabel: index === 0 ? 'Repaired candidate' : null,
          })),
        },
      }
      panel.render(view)
      return true
    },
    closeFrameRepair(reason) { calls.push(['close', reason]); view = { ...view, frameRepair: null }; panel.render(view) },
    setFrameRepairInstruction(value) { calls.push(['instruction', value]) },
    setFrameRepairProvider() {}, setFrameRepairImageSize() {}, setFrameRepairMaskMode() {},
    selectFrameRepairEdit() {}, updateFrameRepairEdit() {}, deleteFrameRepairEdit() {}, undoFrameRepairEdit() {},
    reviewFrameRepairCall() {}, generateFrameRepairCandidate() {}, acceptFrameRepairCandidate() {},
    discardFrameRepairCandidate() {}, confirmFrameRepairWarning() {},
    handleFrameRepairPointer(type, payload) { calls.push(['pointer', type, payload]) },
  }
  const panel = createRepairWorkbenchPanel({
    root, documentRef, lifecycle: { setSelection() {} },
    createRenderer: () => ({ render() {}, destroy() {} }), onProjectAccepted() {}, announce() {},
  })
  panel.open(context)
  const recipeBody = root.querySelector('.editor-repair-recipe-body')
  const aiAction = root.querySelector('.editor-repair-ai-action')
  const quality = root.querySelector('.editor-repair-quality')
  const trigger = root.querySelector('.editor-repair-frame-trigger')
  assert.equal(trigger.disabled, false)
  trigger.dispatchEvent({ type: 'click' })

  assert.deepEqual(calls[0], ['enter'])
  assert.equal(recipeBody.hidden, true)
  assert.equal(recipeBody.inert, true)
  assert.equal(aiAction.hidden, true)
  assert.equal(quality.hidden, true)
  assert.equal(root.querySelector('.editor-frame-repair-rail').hidden, false)
  assert.equal(root.querySelector('.editor-repair-recipe').getAttribute('aria-label'), 'Frame Repair')
  assert.equal(root.querySelector('.editor-repair-recipe-trigger').textContent, 'Frame Repair')
  const repaired = root.querySelector('[data-repaired="true"]')
  assert.ok(repaired)
  assert.match(repaired.getAttribute('aria-label'), /Repaired candidate/)

  const instruction = root.querySelector('[data-frame-repair-control="instruction"]')
  instruction.value = 'repair hand'
  instruction.dispatchEvent({ type: 'input' })
  root.querySelector('.editor-repair-canvas').dispatchEvent({
    type: 'pointerdown', pointerId: 7, clientX: 40, clientY: 40, preventDefault() {},
  })
  assert.deepEqual(calls.find((entry) => entry[0] === 'instruction'), ['instruction', 'repair hand'])
  assert.equal(calls.some((entry) => entry[0] === 'pointer' && entry[1] === 'down'), true)
  assert.equal(calls.some((entry) => entry[0] === 'setView'), false, 'Frame Repair pointer must not start Canvas pan')

  root.querySelector('[data-frame-repair-action="close"]').dispatchEvent({ type: 'click' })
  assert.equal(recipeBody.hidden, false)
  assert.equal(recipeBody.inert, false)
  assert.equal(aiAction.hidden, false)
  assert.equal(quality.hidden, false)
  assert.equal(root.querySelector('.editor-frame-repair-rail').hidden, true)
})

function qualityPanelHarness(documentRef) {
  const element = documentRef.createElement('section')
  element.className = 'editor-frame-repair-quality-gate'
  const canvasSlot = documentRef.createElement('div')
  canvasSlot.className = 'editor-quality-gate-canvas-slot'
  element.append(canvasSlot)
  let action = null
  let destroyed = 0
  let focused = 0
  const rendered = []
  return {
    element,
    canvasSlot,
    rendered,
    get destroyed() { return destroyed },
    get focused() { return focused },
    factory({ onAction }) {
      action = onAction
      return {
        element,
        canvasSlot,
        render(view) { rendered.push(view) },
        focusPrimary() { focused += 1 },
        destroy() { destroyed += 1 },
      }
    },
    emit(type, payload) { return action(type, payload) },
  }
}

function qualityWorkbenchContext(viewRef, calls = {}) {
  return {
    selection: { projectId: 'p', projectRevision: 1, assetId: 'asset_hero', revisionId: 'rev_001' },
    viewModel: () => viewRef.current,
    setView(value) { calls.views?.push(value) },
    patchDraft() {}, resetDraft() {}, buildPreview() {}, acceptPreview() {}, discard() {},
    handleFilmstripAction() {}, handleFilmstripKey() {}, selectFilmstripFrame() {}, selectClip() {},
    confirmWarning() {}, renderAiAction() {}, onClose() {},
    enterFrameRepair() { calls.ordinaryFrameEntries = (calls.ordinaryFrameEntries ?? 0) + 1; return true },
    closeFrameRepair() {}, setFrameRepairMaskMode() {}, setFrameRepairInstruction() {},
    setFrameRepairProvider() {}, setFrameRepairImageSize() {}, selectFrameRepairEdit() {},
    updateFrameRepairEdit() {}, deleteFrameRepairEdit() {}, undoFrameRepairEdit() {},
    reviewFrameRepairCall() { calls.framePlans = (calls.framePlans ?? 0) + 1 },
    generateFrameRepairCandidate() { calls.generates = (calls.generates ?? 0) + 1 },
    recoverFrameRepairOperation() {}, acceptFrameRepairCandidate() {}, discardFrameRepairCandidate() {},
    confirmFrameRepairWarning() {}, handleFrameRepairPointer() {},
  }
}

test('Quality Gate entry is eligibility-bound and restores the same Canvas node and ordinary DOM state', async () => {
  const { buildRepairWorkbenchViewModel, createRepairWorkbenchPanel } = await import('../../src/ui/editor/repairWorkbenchPanel.js')
  const documentRef = fakeDocument()
  const root = documentRef.createElement('div')
  const harness = qualityPanelHarness(documentRef)
  const fixture = modelFixture()
  const viewRef = { current: buildRepairWorkbenchViewModel(fixture) }
  viewRef.current.frameRepairEligibility = { enabled: false, reason: 'Character Pack required' }
  const panel = createRepairWorkbenchPanel({
    root,
    documentRef,
    lifecycle: { setSelection() {} },
    createRenderer: () => ({ render() {}, destroy() {} }),
    createQualityGatePanel: harness.factory,
    onProjectAccepted() {},
    announce() {},
  })
  const runtime = { getView: () => ({ phase: 'entry' }), handleAction() {} }
  assert.equal(panel.attachQualityGate(runtime), true)
  panel.open(qualityWorkbenchContext(viewRef))

  const trigger = root.querySelector('.editor-repair-quality-gate-trigger')
  assert.equal(trigger.hidden, true)
  assert.equal(trigger.disabled, true)
  trigger.dispatchEvent({ type: 'click' })
  assert.equal(panel.openQualityGate(), false)

  viewRef.current = { ...viewRef.current, frameRepairEligibility: { enabled: true, reason: null } }
  panel.render(viewRef.current)
  assert.equal(trigger.hidden, false)
  assert.equal(trigger.disabled, false)
  const workbench = root.querySelector('.editor-repair-workbench')
  const canvasRegion = root.querySelector('.editor-repair-canvas-region')
  const canvas = root.querySelector('.editor-repair-canvas')
  const originalParent = canvasRegion.parentNode
  const originalNextSibling = originalParent.children[originalParent.children.indexOf(canvasRegion) + 1]
  const ordinary = [
    root.querySelector('.editor-repair-header'),
    root.querySelector('.editor-repair-recipe'),
    root.querySelector('.editor-repair-filmstrip'),
    root.querySelector('.editor-repair-quality'),
  ]

  trigger.dispatchEvent({ type: 'click' })
  assert.equal(workbench.dataset.qualityGateWorkspace, 'true')
  assert.equal(canvasRegion.parentNode, harness.canvasSlot)
  assert.equal(root.querySelector('.editor-repair-canvas'), canvas)
  assert.equal(harness.element.hidden, false)
  ordinary.forEach((element) => {
    assert.equal(element.hidden, true)
    assert.equal(element.inert, true)
  })

  assert.equal(panel.closeQualityGate(), true)
  assert.equal(canvasRegion.parentNode, originalParent)
  assert.equal(originalParent.children[originalParent.children.indexOf(canvasRegion) + 1], originalNextSibling)
  assert.equal(workbench.dataset.qualityGateWorkspace, undefined)
  ordinary.forEach((element) => {
    assert.equal(element.hidden, false)
    assert.equal(element.inert, false)
  })
  panel.destroy()
  panel.destroy()
  assert.equal(harness.destroyed, 1)
  assert.equal(canvasRegion.parentNode, originalParent, 'destroy must not leave Canvas owned by the quality panel')
})

test('Quality Gate authoring, blind labels, evidence selection, and action guards preserve Workbench identity', async () => {
  const { buildRepairWorkbenchViewModel, createRepairWorkbenchPanel } = await import('../../src/ui/editor/repairWorkbenchPanel.js')
  const documentRef = fakeDocument()
  const root = documentRef.createElement('div')
  const harness = qualityPanelHarness(documentRef)
  const fixture = modelFixture({
    previewModel: {
      modeAvailability: Object.fromEntries(['before', 'after', 'split', 'difference', 'onion'].map((mode) => [mode, { enabled: true, reason: null }])),
    },
  })
  const viewRef = { current: buildRepairWorkbenchViewModel(fixture) }
  viewRef.current.frameRepairEligibility = { enabled: true, reason: null }
  const calls = { views: [], runtime: [], ordinaryFrameEntries: 0, framePlans: 0, generates: 0 }
  let runtimeView = {
    phase: 'reviewing',
    blindPresentation: { a: 'after', b: 'before', revealed: false },
  }
  let canvasRegion
  let originalParent
  const runtime = {
    getView: () => runtimeView,
    handleAction(type, payload) {
      calls.runtime.push([type, payload])
      if (type === 'author_case') {
        assert.equal(canvasRegion.parentNode, originalParent, 'authoring must regain the ordinary Canvas before runtime entry')
        assert.equal(root.querySelector('.editor-repair-workbench').dataset.qualityGateWorkspace, undefined)
      }
      if (type === 'reveal') runtimeView = { ...runtimeView, blindPresentation: { ...runtimeView.blindPresentation, revealed: true } }
      if (type === 'explode') throw new Error('controlled test error')
      return true
    },
  }
  const panel = createRepairWorkbenchPanel({
    root,
    documentRef,
    lifecycle: { setSelection() {} },
    createRenderer: () => ({ render() {}, destroy() {} }),
    createQualityGatePanel: harness.factory,
    onProjectAccepted() {},
    announce() {},
  })
  panel.attachQualityGate(runtime)
  panel.open(qualityWorkbenchContext(viewRef, calls))
  canvasRegion = root.querySelector('.editor-repair-canvas-region')
  originalParent = canvasRegion.parentNode
  const beforeControl = root.querySelector('[data-repair-mode="before"]')
  const afterControl = root.querySelector('[data-repair-mode="after"]')
  const splitControl = root.querySelector('[data-repair-mode="split"]')
  const canvas = root.querySelector('.editor-repair-canvas')
  panel.openQualityGate()

  assert.equal(calls.runtime[0][0], 'rehydrate', 'recovery is requested only by explicit Quality Gate entry')
  assert.equal(beforeControl.textContent, 'A')
  assert.equal(afterControl.textContent, 'B')
  assert.equal(splitControl.hidden, true)
  assert.equal(splitControl.disabled, true)
  assert.doesNotMatch(canvas.getAttribute('aria-label'), /before|after/i)
  delete beforeControl.dataset.qualityGateUnderlyingMode
  assert.equal(beforeControl.dataset.repairMode, 'before')
  assert.equal(beforeControl.disabled, false)
  beforeControl.dispatchEvent({ type: 'click', bubbles: true })
  assert.deepEqual(
    calls.views,
    [{ mode: 'after' }],
    'A must resolve the server-mapped mode even if mutable DOM presentation state is missing',
  )

  await harness.emit('select_evidence', { caseId: 'completed_case' })
  assert.deepEqual(calls.runtime.at(-1), ['select_evidence', { caseId: 'completed_case' }])
  assert.equal(calls.framePlans, 0)
  assert.equal(calls.generates, 0)

  await harness.emit('author_case', { caseId: 'real_shape_01', expectedImprovement: 'Restore the intended shape.' })
  assert.equal(canvasRegion.parentNode, originalParent)
  await harness.emit('save_case')
  assert.deepEqual(calls.runtime.at(-1), ['save_case', {
    caseId: 'real_shape_01',
    expectedImprovement: 'Restore the intended shape.',
  }])
  assert.equal(canvasRegion.parentNode, harness.canvasSlot)
  assert.equal(root.querySelector('.editor-repair-workbench').dataset.qualityGateWorkspace, 'true')

  const focusedBeforeReveal = beforeControl
  beforeControl.focus()
  await harness.emit('reveal')
  assert.equal(root.querySelector('[data-repair-mode="before"]'), focusedBeforeReveal)
  assert.equal(documentRef.activeElement, focusedBeforeReveal)
  assert.equal(beforeControl.textContent, 'Before')
  assert.equal(afterControl.textContent, 'After')
  assert.equal(splitControl.hidden, false)

  await harness.emit('explode')
  assert.equal(canvasRegion.parentNode, originalParent, 'runtime errors must restore ordinary Canvas ownership')
  assert.equal(root.querySelector('.editor-repair-workbench').dataset.qualityGateWorkspace, undefined)
  assert.equal(calls.ordinaryFrameEntries, 0, 'Quality Gate actions must not invoke the ordinary Frame Repair entry')
  panel.destroy()
})
