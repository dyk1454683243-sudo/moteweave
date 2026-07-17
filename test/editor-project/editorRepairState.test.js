import test from 'node:test'
import assert from 'node:assert/strict'

import {
  getRepairAcceptanceState,
  getRepairFilmstripDurationMs,
  getRepairPreviewFreshness,
  reduceRepairFilmstrip,
  reduceRepairWarningConfirmation,
} from '../../src/editor-project/repairState.js'

const SETTINGS_HASH = 'a'.repeat(64)
const RECIPE_HASH = 'b'.repeat(64)
const selection = {
  projectId: 'project_demo',
  projectRevision: 3,
  assetId: 'asset_hero',
  revisionId: 'rev_001',
}
const completeArtifacts = { complete: true }

function freshnessInput(overrides = {}) {
  return {
    currentDraftSettingsHash: SETTINGS_HASH,
    submittedDraftSettingsHash: SETTINGS_HASH,
    selection,
    submittedSelection: selection,
    job: { status: 'done' },
    artifacts: completeArtifacts,
    validation: { status: 'pass' },
    ...overrides,
  }
}

test('repair preview state distinguishes no preview, dirty, and accepted', () => {
  assert.deepEqual(
    getRepairPreviewFreshness(freshnessInput({ job: null, draftDirty: false })),
    { state: 'no_preview', fresh: false, inspectable: false },
  )
  assert.deepEqual(
    getRepairPreviewFreshness(freshnessInput({ job: null, draftDirty: true })),
    { state: 'dirty', fresh: false, inspectable: false },
  )
  assert.deepEqual(
    getRepairPreviewFreshness(freshnessInput({ accepted: true, job: null })),
    { state: 'accepted', fresh: true, inspectable: true },
  )
})

test('repair preview freshness requires all four selection identity fields', () => {
  for (const [key, value] of [
    ['projectId', 'project_other'],
    ['projectRevision', 4],
    ['assetId', 'asset_other'],
    ['revisionId', 'rev_other'],
  ]) {
    assert.deepEqual(
      getRepairPreviewFreshness(freshnessInput({
        submittedSelection: { ...selection, [key]: value },
      })),
      { state: 'stale', fresh: false, inspectable: true },
    )
  }

  assert.deepEqual(
    getRepairPreviewFreshness(freshnessInput({ submittedDraftSettingsHash: 'c'.repeat(64) })),
    { state: 'stale', fresh: false, inspectable: true },
  )
  assert.deepEqual(
    getRepairPreviewFreshness(freshnessInput({ selection: {}, submittedSelection: {} })),
    { state: 'stale', fresh: false, inspectable: true },
  )
  assert.deepEqual(
    getRepairPreviewFreshness(freshnessInput({
      currentDraftSettingsHash: undefined,
      submittedDraftSettingsHash: undefined,
    })),
    { state: 'stale', fresh: false, inspectable: true },
  )
  assert.deepEqual(
    getRepairPreviewFreshness(freshnessInput({
      currentDraftSettingsHash: SETTINGS_HASH.toUpperCase(),
      submittedDraftSettingsHash: SETTINGS_HASH.toUpperCase(),
    })),
    { state: 'stale', fresh: false, inspectable: true },
  )
  for (const submittedSelection of [
    { ...selection, projectId: '' },
    { ...selection, projectRevision: 1.5 },
    { ...selection, projectRevision: '3' },
    { ...selection, assetId: '' },
    { ...selection, revisionId: '' },
  ]) {
    assert.deepEqual(
      getRepairPreviewFreshness(freshnessInput({
        selection: submittedSelection,
        submittedSelection,
      })),
      { state: 'stale', fresh: false, inspectable: true },
    )
  }
})

test('repair preview maps queued and active processing statuses', () => {
  assert.deepEqual(
    getRepairPreviewFreshness(freshnessInput({ job: { status: 'queued' } })),
    { state: 'queued', fresh: true, inspectable: false },
  )
  for (const status of ['planning', 'generating', 'processing', 'post_processing']) {
    assert.deepEqual(
      getRepairPreviewFreshness(freshnessInput({ job: { status } })),
      { state: 'processing', fresh: true, inspectable: false },
    )
  }
})

test('repair preview maps ready, warning, and terminal failures', () => {
  assert.deepEqual(
    getRepairPreviewFreshness(freshnessInput()),
    { state: 'ready', fresh: true, inspectable: true },
  )
  assert.deepEqual(
    getRepairPreviewFreshness(freshnessInput({ validation: { status: 'warning' } })),
    { state: 'warning', fresh: true, inspectable: true },
  )
  for (const status of ['failed', 'failed_model_error', 'failed_safety_filter', 'not_found']) {
    assert.deepEqual(
      getRepairPreviewFreshness(freshnessInput({ job: { status } })),
      { state: 'failed', fresh: true, inspectable: true },
    )
  }
  assert.deepEqual(
    getRepairPreviewFreshness(freshnessInput({ artifacts: { complete: false } })),
    { state: 'failed', fresh: true, inspectable: false },
  )
  assert.deepEqual(
    getRepairPreviewFreshness(freshnessInput({ validation: { status: 'fail' } })),
    { state: 'failed', fresh: true, inspectable: true },
  )
})

test('failed post-processing remains inspectable when complete artifacts fail quality', () => {
  assert.deepEqual(
    getRepairPreviewFreshness({
      currentDraftSettingsHash: SETTINGS_HASH,
      submittedDraftSettingsHash: SETTINGS_HASH,
      selection,
      submittedSelection: selection,
      job: { status: 'failed_post_processing' },
      artifacts: completeArtifacts,
      validation: { status: 'fail' },
    }),
    { state: 'blocked_quality', fresh: true, inspectable: true },
  )
  assert.equal(
    getRepairAcceptanceState({
      previewState: 'blocked_quality',
      underlyingJobStatus: 'failed_post_processing',
      qualityStatus: 'fail',
    }).canAccept,
    false,
  )
  assert.deepEqual(
    getRepairPreviewFreshness(freshnessInput({
      job: { status: 'failed_post_processing' },
      artifacts: { complete: false },
      validation: { status: 'fail' },
    })),
    { state: 'failed', fresh: true, inspectable: false },
  )
})

test('acceptance requires done status, matching hashes, and an acceptable preview', () => {
  const ready = {
    previewState: 'ready',
    underlyingJobStatus: 'done',
    hashesMatch: true,
    fresh: true,
    artifactsComplete: true,
    qualityStatus: 'pass',
    jobId: 'job_a',
    recipeHash: RECIPE_HASH,
  }

  assert.deepEqual(getRepairAcceptanceState(ready), { canAccept: true, reason: null })
  assert.deepEqual(
    getRepairAcceptanceState({ ...ready, underlyingJobStatus: 'processing' }),
    { canAccept: false, reason: 'job_not_done' },
  )
  assert.deepEqual(
    getRepairAcceptanceState({ ...ready, hashesMatch: false }),
    { canAccept: false, reason: 'preview_hash_mismatch' },
  )
  assert.deepEqual(
    getRepairAcceptanceState({ ...ready, previewState: 'blocked_quality' }),
    { canAccept: false, reason: 'preview_not_acceptable' },
  )
  for (const overrides of [
    { fresh: false },
    { artifactsComplete: false },
    { qualityStatus: 'fail' },
    { qualityStatus: 'unknown' },
    { jobId: '' },
    { recipeHash: RECIPE_HASH.toUpperCase() },
    { recipeHash: [RECIPE_HASH] },
  ]) {
    assert.deepEqual(
      getRepairAcceptanceState({ ...ready, ...overrides }),
      { canAccept: false, reason: 'preview_not_acceptable' },
    )
  }
})

test('warning confirmation is bound to the exact job and full recipe hash', () => {
  const warning = {
    previewState: 'warning',
    underlyingJobStatus: 'done',
    hashesMatch: true,
    fresh: true,
    artifactsComplete: true,
    qualityStatus: 'warning',
    jobId: 'job_a',
    recipeHash: RECIPE_HASH,
  }
  const confirmation = { jobId: 'job_a', recipeHash: RECIPE_HASH, confirmed: true }

  assert.deepEqual(
    getRepairAcceptanceState(warning),
    { canAccept: false, reason: 'warning_confirmation_required' },
  )
  assert.deepEqual(
    getRepairAcceptanceState({ ...warning, warningConfirmation: confirmation }),
    { canAccept: true, reason: null },
  )
  assert.deepEqual(
    getRepairAcceptanceState({ ...warning, jobId: 'job_b', warningConfirmation: confirmation }),
    { canAccept: false, reason: 'warning_confirmation_required' },
  )
  assert.deepEqual(
    getRepairAcceptanceState({ ...warning, recipeHash: 'c'.repeat(64), warningConfirmation: confirmation }),
    { canAccept: false, reason: 'warning_confirmation_required' },
  )
  assert.deepEqual(
    getRepairAcceptanceState({ ...warning, warningConfirmation: true }),
    { canAccept: false, reason: 'warning_confirmation_required' },
  )
  assert.deepEqual(
    getRepairAcceptanceState({
      ...warning,
      jobId: undefined,
      recipeHash: undefined,
      warningConfirmation: { jobId: undefined, recipeHash: undefined, confirmed: true },
    }),
    { canAccept: false, reason: 'preview_not_acceptable' },
  )
})

test('warning confirmation reducer binds confirmation and clears every invalidating event', () => {
  const confirmed = reduceRepairWarningConfirmation(null, {
    type: 'confirm',
    jobId: 'job_a',
    recipeHash: RECIPE_HASH,
    confirmed: true,
  })
  assert.deepEqual(confirmed, { jobId: 'job_a', recipeHash: RECIPE_HASH, confirmed: true })

  for (const type of [
    'build_started',
    'preview_replaced',
    'draft_edited',
    'selection_changed',
    'discarded',
    'accept_succeeded',
    'hash_mismatch',
  ]) {
    assert.equal(reduceRepairWarningConfirmation(confirmed, { type }), null)
  }
  assert.equal(
    reduceRepairWarningConfirmation(confirmed, {
      type: 'confirm',
      jobId: 'job_a',
      recipeHash: RECIPE_HASH,
      confirmed: false,
    }),
    null,
  )
  assert.equal(reduceRepairWarningConfirmation(null, {
    type: 'confirm',
    confirmed: true,
  }), null)
  assert.equal(reduceRepairWarningConfirmation(null, {
    type: 'confirm',
    jobId: 'job_a',
    recipeHash: RECIPE_HASH.toUpperCase(),
    confirmed: true,
  }), null)
  const ignored = { type: 'poll_progress' }
  assert.equal(reduceRepairWarningConfirmation(confirmed, ignored), confirmed)
})

test('filmstrip reducer clamps selection and implements first, last, play, and tick', () => {
  const state = { frames: ['a', 'b', 'c'], selectedIndex: 1, playing: false }

  assert.deepEqual(reduceRepairFilmstrip(state, { type: 'first' }), { ...state, selectedIndex: 0 })
  assert.deepEqual(reduceRepairFilmstrip(state, { type: 'last' }), { ...state, selectedIndex: 2 })
  assert.deepEqual(reduceRepairFilmstrip(state, { type: 'select', index: -10 }), { ...state, selectedIndex: 0 })
  assert.deepEqual(reduceRepairFilmstrip(state, { type: 'select', index: 10 }), { ...state, selectedIndex: 2 })
  assert.deepEqual(reduceRepairFilmstrip(state, { type: 'toggle_play' }), { ...state, playing: true })
  assert.equal(reduceRepairFilmstrip(state, { type: 'tick' }), state)
  assert.deepEqual(
    reduceRepairFilmstrip({ ...state, selectedIndex: 2, playing: true }, { type: 'tick' }),
    { ...state, selectedIndex: 0, playing: true },
  )
  assert.deepEqual(
    reduceRepairFilmstrip({ frames: [], selectedIndex: 8, playing: true }, { type: 'tick' }),
    { frames: [], selectedIndex: 0, playing: false },
  )
})

test('filmstrip arrows act only while the filmstrip owns focus', () => {
  const state = { frames: ['a', 'b', 'c'], selectedIndex: 1, playing: false }

  assert.equal(
    reduceRepairFilmstrip(state, { type: 'arrow', key: 'ArrowRight', filmstripFocused: false }),
    state,
  )
  assert.deepEqual(
    reduceRepairFilmstrip(state, { type: 'arrow', key: 'ArrowRight', filmstripFocused: true }),
    { ...state, selectedIndex: 2 },
  )
  assert.deepEqual(
    reduceRepairFilmstrip({ ...state, selectedIndex: 0 }, { type: 'arrow', key: 'ArrowLeft', filmstripFocused: true }),
    { ...state, selectedIndex: 0 },
  )
  assert.deepEqual(
    reduceRepairFilmstrip(state, { type: 'arrow', key: 'ArrowUp', filmstripFocused: true }),
    { ...state, selectedIndex: 1 },
  )
})

test('filmstrip semantic no-ops preserve state identity', () => {
  const first = { frames: ['a', 'b', 'c'], selectedIndex: 0, playing: false }
  const middle = { ...first, selectedIndex: 1 }
  const last = { ...first, selectedIndex: 2 }
  const empty = { frames: [], selectedIndex: 0, playing: false }

  assert.equal(reduceRepairFilmstrip(first, { type: 'first' }), first)
  assert.equal(reduceRepairFilmstrip(last, { type: 'last' }), last)
  assert.equal(reduceRepairFilmstrip(middle, { type: 'select', index: 1 }), middle)
  assert.equal(
    reduceRepairFilmstrip(first, { type: 'arrow', key: 'ArrowLeft', filmstripFocused: true }),
    first,
  )
  assert.equal(
    reduceRepairFilmstrip(last, { type: 'arrow', key: 'ArrowRight', filmstripFocused: true }),
    last,
  )
  assert.equal(reduceRepairFilmstrip(empty, { type: 'tick' }), empty)
  for (const index of [undefined, Number.NaN, 1.5, '1']) {
    assert.equal(reduceRepairFilmstrip(middle, { type: 'select', index }), middle)
  }
})

test('filmstrip duration is frame count divided by fps in milliseconds', () => {
  assert.equal(getRepairFilmstripDurationMs(4, 8), 500)
  assert.equal(getRepairFilmstripDurationMs(3, 7.5), 400)
  assert.equal(getRepairFilmstripDurationMs(1, 8), 125, 'one real frame lasts exactly 1000 / fps')
  for (const [frameCount, fps] of [[0, 8], [-1, 8], [1.5, 8], [4, 0], [4, Infinity]]) {
    assert.equal(getRepairFilmstripDurationMs(frameCount, fps), 0)
  }
})

test('filmstrip advances and clamps indices within the selected real clip frame sequence', () => {
  const selectedClipFrames = [32, 35]
  const otherClipFrames = [0, 1, 2, 3]
  const initial = {
    clipId: 'walk_right',
    frames: selectedClipFrames,
    selectedIndex: 0,
    playing: true,
  }

  const advanced = reduceRepairFilmstrip(initial, { type: 'tick' })
  assert.equal(advanced.clipId, 'walk_right')
  assert.equal(advanced.frames, selectedClipFrames)
  assert.equal(advanced.frames[advanced.selectedIndex], 35)
  assert.deepEqual(otherClipFrames, [0, 1, 2, 3], 'unselected clip frames are never advanced')

  const clampedRight = reduceRepairFilmstrip(
    { ...advanced, playing: false },
    { type: 'arrow', key: 'ArrowRight', filmstripFocused: true },
  )
  assert.equal(clampedRight.frames[clampedRight.selectedIndex], 35)
  const first = reduceRepairFilmstrip(clampedRight, { type: 'first' })
  assert.equal(first.frames[first.selectedIndex], 32)
  const last = reduceRepairFilmstrip(first, { type: 'last' })
  assert.equal(last.frames[last.selectedIndex], 35)
})
