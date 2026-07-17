import { readFile } from 'node:fs/promises'
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createEmptyFrameRepairState,
  getFrameRepairUiState,
  hasExactFrameRepairWarningConfirmation,
} from '../../src/ui/editor/frameRepairState.js'
import { editorState } from '../../src/ui/editor/state.js'

const UI_STATES = Object.freeze({
  no_project: ['Load a project to repair a frame.', [], false],
  no_asset: ['Select a Character Pack asset to repair a frame.', [], false],
  unsupported_asset: ['Frame Repair is available for managed Character Pack assets.', [], false],
  no_frame: ['Select one real animation frame to begin.', [], false],
  planning: ['Building a provider-free repair plan…', ['edit_mask', 'close'], true],
  needs_scope: ['Add a rectangle to define the repair area.', ['edit_mask', 'review_call', 'close'], true],
  invalid_mask: ['The repair mask must contain at least one pixel.', ['edit_mask', 'review_call', 'close'], true],
  planned: ['Review the exact one-call plan before generation.', ['edit_mask', 'generate', 'close'], true],
  provider_unavailable: ['The selected provider is unavailable; generation is disabled.', ['edit_mask', 'review_call', 'close'], true],
  confirming: ['Submitting the one confirmed provider call…', ['close'], true],
  queued: ['The repair job is queued.', ['close'], true],
  generating: ['The provider is generating one candidate.', ['close'], true],
  post_processing: ['Applying the mask and validating the candidate…', ['close'], true],
  ready: ['The candidate is ready for review.', ['accept', 'discard', 'close'], true],
  warning: ['Review and confirm the exact candidate warning before acceptance.', ['confirm_warning', 'accept', 'discard', 'close'], true],
  blocked_quality: ['The candidate failed required quality checks and cannot be accepted.', ['discard', 'close'], true],
  failed_model: ['The single provider attempt failed; it will not retry automatically.', ['review_call', 'discard', 'close'], true],
  failed_processing: ['Local candidate processing failed; the parent revision is unchanged.', ['review_call', 'discard', 'close'], true],
  outcome_unknown: ['The submitted call outcome is unknown; recover the original operation before retrying.', ['recover', 'discard', 'close'], true],
  stale_plan: ['The repair plan is stale; review a new provider-free plan.', ['edit_mask', 'review_call', 'discard', 'close'], true],
  project_conflict: ['The project changed; reload it before continuing.', ['discard', 'close'], true],
  asset_revision_conflict: ['The active asset revision changed; reopen Frame Repair.', ['discard', 'close'], true],
  selection_switched: ['The frame selection changed; late results were ignored.', ['close'], false],
  accepting: ['Accepting a new immutable revision…', [], true],
  accepted: ['The candidate was accepted as a new immutable revision.', ['close'], false],
  discarded: ['The candidate was discarded; the project was not changed.', ['close'], false],
  teardown: ['', [], false],
})

test('Frame Repair state matrix has one honest message and exact actions for every required state', () => {
  for (const [state, [message, actions, retainsDraft]] of Object.entries(UI_STATES)) {
    const model = getFrameRepairUiState(state)
    assert.equal(model.state, state)
    assert.equal(model.message, message)
    assert.equal(model.announcement, message)
    assert.deepEqual(model.actions, actions)
    assert.equal(model.retainsDraft, retainsDraft)
    assert.equal(model.mutatesProject, state === 'accepted')
  }

  const unknown = getFrameRepairUiState('not_a_real_state')
  assert.equal(unknown.state, 'failed_processing')
  assert.deepEqual(unknown.actions, UI_STATES.failed_processing[1])
})

test('empty Frame Repair state exposes the complete independent ephemeral contract', () => {
  const first = createEmptyFrameRepairState()
  const second = createEmptyFrameRepairState()

  assert.deepEqual(first, {
    active: false,
    selection: null,
    stage: 'target_mask',
    uiState: 'no_frame',
    instruction: '',
    maskMode: 'add_rectangle',
    baseMask: null,
    maskEdits: [],
    selectedEditIndex: null,
    provisionalMask: null,
    plan: null,
    planHash: null,
    planInvalidReason: null,
    providerState: null,
    providerPresetId: '',
    imageSize: '1K',
    operationId: null,
    job: null,
    candidate: null,
    quality: null,
    warningConfirmation: null,
    pointerDraft: null,
    diagnostics: [],
    error: null,
    generation: 0,
  })

  first.maskEdits.push({ op: 'add_rectangle', x: 1, y: 2, width: 3, height: 4 })
  first.diagnostics.push({ code: 'needs_scope' })
  assert.deepEqual(second.maskEdits, [])
  assert.deepEqual(second.diagnostics, [])
})

test('warning confirmation is bound to the exact job and plan hash', () => {
  const planHash = 'a'.repeat(64)
  const confirmation = { jobId: 'job_frame', planHash, confirmed: true }

  assert.equal(hasExactFrameRepairWarningConfirmation({
    warningConfirmation: confirmation,
    jobId: 'job_frame',
    planHash,
  }), true)
  assert.equal(hasExactFrameRepairWarningConfirmation({
    warningConfirmation: confirmation,
    jobId: 'job_other',
    planHash,
  }), false)
  assert.equal(hasExactFrameRepairWarningConfirmation({
    warningConfirmation: confirmation,
    jobId: 'job_frame',
    planHash: 'b'.repeat(64),
  }), false)
  assert.equal(hasExactFrameRepairWarningConfirmation({
    warningConfirmation: { ...confirmation, confirmed: false },
    jobId: 'job_frame',
    planHash,
  }), false)
})

test('global Frame Repair edits remain outside project JSON, dirty state, and scene history', (t) => {
  const original = {
    project: editorState.project,
    dirty: editorState.dirty,
    sceneHistories: editorState.sceneHistories,
    repair: editorState.repair,
  }
  t.after(() => Object.assign(editorState, original))

  editorState.project = {
    id: 'project_demo',
    revision: 4,
    assets: { asset_hero: { id: 'asset_hero', active_revision_id: 'rev_003' } },
    scenes: { scene_main: { id: 'scene_main', layers: [] } },
  }
  editorState.dirty = false
  editorState.sceneHistories = {
    'project_demo:scene_main': { cursor: 0, snapshots: [{ scene: { id: 'scene_main', layers: [] } }] },
  }
  editorState.repair = {
    ...original.repair,
    frame: createEmptyFrameRepairState(),
  }
  const projectBefore = JSON.stringify(editorState.project)
  const historiesBefore = structuredClone(editorState.sceneHistories)

  Object.assign(editorState.repair.frame, {
    active: true,
    selection: {
      projectId: 'project_demo',
      projectRevision: 4,
      assetId: 'asset_hero',
      revisionId: 'rev_003',
      clipId: 'walk_down',
      clipFramePosition: 1,
      sheetFrameIndex: 33,
    },
    instruction: 'repair the hand',
    planHash: 'a'.repeat(64),
    operationId: 'fr_0123456789abcdef',
  })
  editorState.repair.frame.maskEdits.push({
    op: 'add_rectangle', x: 10, y: 10, width: 8, height: 8,
  })

  assert.equal(JSON.stringify(editorState.project), projectBefore)
  assert.equal(editorState.dirty, false)
  assert.deepEqual(editorState.sceneHistories, historiesBefore)
  assert.doesNotMatch(JSON.stringify(editorState.project), /repair the hand|fr_0123456789abcdef/)
})

test('global state and project-reset path reset ephemeral Frame Repair state while retaining safe provider metadata', async () => {
  assert.deepEqual(editorState.repair.frame, createEmptyFrameRepairState())
  const shell = await readFile(new URL('../../src/ui/editor/shell.js', import.meta.url), 'utf8')
  assert.match(shell, /const frameRepairProviderState = editorState\.repair\.frame\?\.providerState \?\? null/)
  assert.match(shell, /frame:\s*\{ \.\.\.createEmptyFrameRepairState\(\), providerState: frameRepairProviderState \}/)
})

test('Frame Repair browser state modules stay free of Node and server imports', async () => {
  for (const relativePath of [
    '../../src/ui/editor/frameRepairState.js',
    '../../src/ui/editor/frameRepairLifecycle.js',
    '../../src/ui/editor/api.js',
    '../../src/ui/editor/state.js',
  ]) {
    const source = await readFile(new URL(relativePath, import.meta.url), 'utf8')
    assert.doesNotMatch(source, /(?:from\s+|import\s*\()['"]node:/)
    assert.doesNotMatch(source, /(?:from\s+|import\s*\()['"][^'"]*(?:server|editor-project\/apiHandler)/)
  }
})
