import { readFile } from 'node:fs/promises'
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createEmptyLocalRepairState,
  editorState,
} from '../../src/ui/editor/state.js'
import { createEmptyFrameRepairState } from '../../src/ui/editor/frameRepairState.js'

test('local Repair state factory exposes the complete ephemeral Workbench contract', () => {
  const local = createEmptyLocalRepairState()

  assert.deepEqual(Object.keys(local).sort(), [
    'acceptInFlight',
    'currentDraftSettingsHash',
    'diagnostics',
    'differenceCache',
    'draft',
    'draftHashGeneration',
    'error',
    'filmstrip',
    'lastValidCanonical',
    'message',
    'openGeneration',
    'preview',
    'previewModel',
    'profile',
    'renderFrame',
    'selection',
    'sourceContext',
    'status',
    'validation',
    'validationContext',
    'view',
    'warningConfirmation',
  ].sort())
  assert.equal(local.selection, null)
  assert.equal(local.sourceContext, null)
  assert.equal(local.profile, null)
  assert.equal(local.draft, null)
  assert.equal(local.validationContext, null)
  assert.equal(local.lastValidCanonical, null)
  assert.deepEqual(local.validation, {
    status: 'fail',
    blocking_errors: ['repair_not_open'],
    invalidPaths: [],
  })
  assert.equal(local.draftHashGeneration, 0)
  assert.equal(local.currentDraftSettingsHash, null)
  assert.equal(local.preview, null)
  assert.deepEqual(local.previewModel, {
    state: 'no_preview',
    frames: [],
    modeAvailability: {},
    acceptance: { canAccept: false, reason: 'no_preview' },
    diagnostics: [],
  })
  assert.equal(local.acceptInFlight, false)
  assert.equal(local.warningConfirmation, null)
  assert.deepEqual(local.filmstrip, { frames: [], selectedIndex: 0, playing: false })
  assert.equal(local.renderFrame, null)
  assert.ok(local.differenceCache instanceof Map)
  assert.deepEqual(local.view, {
    clipId: '',
    frameIndex: null,
    mode: 'before',
    zoom: 1,
    pan: { x: 0, y: 0 },
    overlays: { cuts: true, anchor: true, baseline: true, bbox: true, debug: false },
  })
  assert.equal(local.status, 'idle')
  assert.equal(local.message, '')
  assert.deepEqual(local.diagnostics, [])
  assert.equal(local.error, null)
  assert.equal(local.openGeneration, 0)
})

test('each local Repair factory result owns independent mutable collections', () => {
  const first = createEmptyLocalRepairState()
  const second = createEmptyLocalRepairState()

  first.validation.blocking_errors.push('invalid_recipe')
  first.previewModel.frames.push(1)
  first.previewModel.diagnostics.push({ code: 'old' })
  first.filmstrip.frames.push(2)
  first.view.pan.x = 10
  first.view.overlays.cuts = false
  first.differenceCache.set('job:0', { pixels: true })

  assert.deepEqual(second.validation.blocking_errors, ['repair_not_open'])
  assert.deepEqual(second.previewModel.frames, [])
  assert.deepEqual(second.previewModel.diagnostics, [])
  assert.deepEqual(second.filmstrip.frames, [])
  assert.deepEqual(second.view.pan, { x: 0, y: 0 })
  assert.equal(second.view.overlays.cuts, true)
  assert.equal(second.differenceCache.size, 0)
})

test('global Repair state separates Workbench, Frame Repair, and existing AI Action state', () => {
  assert.deepEqual(Object.keys(editorState.repair).sort(), ['aiAction', 'frame', 'local'])
  assert.deepEqual(editorState.repair.aiAction, {
    selectedAction: '',
    providerPresetId: '',
    imageSize: '1K',
    plan: null,
    job: null,
    importResult: null,
    status: 'idle',
    message: '',
    assetId: null,
    revisionId: null,
  })
  assert.deepEqual(editorState.repair.local, createEmptyLocalRepairState())
  assert.deepEqual(editorState.repair.frame, createEmptyFrameRepairState())
  for (const oldFlatKey of [
    'selectedAction',
    'providerPresetId',
    'imageSize',
    'plan',
    'job',
    'importResult',
    'status',
    'message',
    'assetId',
    'revisionId',
  ]) {
    assert.equal(Object.hasOwn(editorState.repair, oldFlatKey), false)
  }
})

test('server canonical Preview echo stays separate from editable null-revision draft settings', () => {
  const local = createEmptyLocalRepairState()
  local.draft = {
    recipe: {
      implementation_revision: null,
      background: { mode: 'auto', tolerance: 24 },
    },
  }
  local.preview = {
    jobId: 'job_preview',
    recipeHash: 'b'.repeat(64),
    submittedDraftSettingsHash: 'a'.repeat(64),
    submittedCanonicalRecipe: {
      implementation_revision: 'server-build-revision',
      background: { mode: 'auto', tolerance: 24 },
    },
  }
  local.warningConfirmation = {
    jobId: local.preview.jobId,
    recipeHash: local.preview.recipeHash,
    confirmed: true,
  }

  local.draft.recipe.background.tolerance = 30

  assert.equal(local.draft.recipe.implementation_revision, null)
  assert.equal(local.preview.submittedCanonicalRecipe.implementation_revision, 'server-build-revision')
  assert.equal(local.preview.submittedCanonicalRecipe.background.tolerance, 24)
  assert.deepEqual(local.warningConfirmation, {
    jobId: 'job_preview',
    recipeHash: 'b'.repeat(64),
    confirmed: true,
  })
})

test('local draft, Preview, and view edits never dirty or serialize into the project and histories', (t) => {
  const original = {
    project: editorState.project,
    dirty: editorState.dirty,
    sceneHistories: editorState.sceneHistories,
    repair: editorState.repair,
  }
  t.after(() => {
    editorState.project = original.project
    editorState.dirty = original.dirty
    editorState.sceneHistories = original.sceneHistories
    editorState.repair = original.repair
  })
  editorState.project = {
    id: 'project_demo',
    revision: 4,
    assets: { asset_hero: { id: 'asset_hero', active_revision_id: 'rev_003' } },
    scenes: { scene_main: { id: 'scene_main', layers: [] } },
  }
  editorState.dirty = false
  editorState.sceneHistories = {
    'project_demo:scene_main': {
      cursor: 0,
      snapshots: [{ scene: { id: 'scene_main', layers: [] } }],
    },
  }
  editorState.repair = {
    local: createEmptyLocalRepairState(),
    frame: createEmptyFrameRepairState(),
    aiAction: structuredClone(original.repair.aiAction ?? {}),
  }
  const projectBefore = JSON.stringify(editorState.project)
  const historiesBefore = structuredClone(editorState.sceneHistories)

  editorState.repair.local.selection = {
    projectId: 'project_demo',
    projectRevision: 4,
    assetId: 'asset_hero',
    revisionId: 'rev_003',
  }
  editorState.repair.local.draft = { recipe: { implementation_revision: null } }
  editorState.repair.local.preview = { jobId: 'job_preview', submittedDraftSettingsHash: 'a'.repeat(64) }
  editorState.repair.local.view.zoom = 4
  editorState.repair.local.filmstrip.frames.push(0, 1, 2)
  editorState.repair.local.differenceCache.set('job_preview:0', { width: 96, height: 96 })

  assert.equal(JSON.stringify(editorState.project), projectBefore)
  assert.equal(editorState.dirty, false)
  assert.deepEqual(editorState.sceneHistories, historiesBefore)
  assert.doesNotMatch(JSON.stringify(editorState.project), /job_preview|implementation_revision|filmstrip/)
})

test('UI repair foundation modules remain browser-safe and import no server or node runtime', async () => {
  for (const relativePath of [
    '../../src/ui/editor/api.js',
    '../../src/ui/editor/artifactClient.js',
    '../../src/ui/editor/repairPreviewLifecycle.js',
    '../../src/ui/editor/state.js',
  ]) {
    const source = await readFile(new URL(relativePath, import.meta.url), 'utf8')
    assert.doesNotMatch(source, /(?:from\s+|import\s*\()['"]node:/)
    assert.doesNotMatch(source, /(?:from\s+|import\s*\()['"][^'"]*(?:server|editor-project\/apiHandler)/)
  }
})
