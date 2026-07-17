import { JOB_ID_PATTERN } from './constants.js'

const ACTIVE_REPROCESS_STATUSES = new Set([
  'planning',
  'queued',
  'generating',
  'processing',
  'post_processing',
])
const TERMINAL_REPROCESS_FAILURES = new Set([
  'failed',
  'failed_model_error',
  'failed_safety_filter',
  'not_found',
])
const WARNING_CONFIRMATION_INVALIDATIONS = new Set([
  'build_started',
  'preview_replaced',
  'draft_edited',
  'selection_changed',
  'discarded',
  'accept_succeeded',
  'hash_mismatch',
])

function sameRepairSelection(left, right) {
  const hasIdentity = (selection) => Boolean(selection) &&
    typeof selection.projectId === 'string' && selection.projectId.length > 0 &&
    Number.isInteger(selection.projectRevision) && selection.projectRevision > 0 &&
    typeof selection.assetId === 'string' && selection.assetId.length > 0 &&
    typeof selection.revisionId === 'string' && selection.revisionId.length > 0
  return hasIdentity(left) && hasIdentity(right) &&
    left.projectId === right.projectId &&
    left.projectRevision === right.projectRevision &&
    left.assetId === right.assetId &&
    left.revisionId === right.revisionId
}

function isRepairHash(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

function hasWarningConfirmationIdentity(jobId, recipeHash) {
  return typeof jobId === 'string' && JOB_ID_PATTERN.test(jobId) &&
    isRepairHash(recipeHash)
}

export function getRepairPreviewFreshness(input) {
  const fresh = sameRepairSelection(input.selection, input.submittedSelection) &&
    isRepairHash(input.currentDraftSettingsHash) &&
    isRepairHash(input.submittedDraftSettingsHash) &&
    input.currentDraftSettingsHash === input.submittedDraftSettingsHash
  const quality = input.validation?.status ?? 'unknown'
  const complete = input.artifacts?.complete === true
  if (input.accepted === true) return { state: 'accepted', fresh: true, inspectable: true }
  if (!input.job) {
    return {
      state: input.draftDirty ? 'dirty' : 'no_preview',
      fresh: false,
      inspectable: false,
    }
  }
  if (!fresh) return { state: 'stale', fresh: false, inspectable: complete }
  if (input.job.status === 'queued') {
    return { state: 'queued', fresh: true, inspectable: false }
  }
  if (ACTIVE_REPROCESS_STATUSES.has(input.job.status)) {
    return { state: 'processing', fresh: true, inspectable: false }
  }
  if (TERMINAL_REPROCESS_FAILURES.has(input.job.status)) {
    return { state: 'failed', fresh: true, inspectable: complete }
  }
  if (input.job.status === 'failed_post_processing') {
    return complete && quality === 'fail'
      ? { state: 'blocked_quality', fresh: true, inspectable: true }
      : { state: 'failed', fresh: true, inspectable: false }
  }
  if (input.job.status !== 'done' || !complete || !['pass', 'warning'].includes(quality)) {
    return { state: 'failed', fresh: true, inspectable: complete }
  }
  return {
    state: quality === 'warning' ? 'warning' : 'ready',
    fresh: true,
    inspectable: true,
  }
}

export function getRepairAcceptanceState(input) {
  const warningConfirmed = hasWarningConfirmationIdentity(input.jobId, input.recipeHash) &&
    hasWarningConfirmationIdentity(
      input.warningConfirmation?.jobId,
      input.warningConfirmation?.recipeHash,
    ) &&
    input.warningConfirmation.confirmed === true &&
    input.warningConfirmation.jobId === input.jobId &&
    input.warningConfirmation.recipeHash === input.recipeHash
  if (input.underlyingJobStatus !== 'done') {
    return { canAccept: false, reason: 'job_not_done' }
  }
  if (input.hashesMatch !== true) {
    return { canAccept: false, reason: 'preview_hash_mismatch' }
  }
  if (!hasWarningConfirmationIdentity(input.jobId, input.recipeHash)) {
    return { canAccept: false, reason: 'preview_not_acceptable' }
  }
  const acceptableEvidence = input.fresh === true &&
    input.artifactsComplete === true &&
    ((input.previewState === 'ready' && input.qualityStatus === 'pass') ||
      (input.previewState === 'warning' && input.qualityStatus === 'warning'))
  if (!acceptableEvidence) {
    return { canAccept: false, reason: 'preview_not_acceptable' }
  }
  if (input.previewState === 'warning' && !warningConfirmed) {
    return { canAccept: false, reason: 'warning_confirmation_required' }
  }
  return { canAccept: true, reason: null }
}

export function reduceRepairWarningConfirmation(current, event) {
  if (event?.type === 'confirm') {
    return event.confirmed === true && hasWarningConfirmationIdentity(event.jobId, event.recipeHash)
      ? { jobId: event.jobId, recipeHash: event.recipeHash, confirmed: true }
      : null
  }
  if (WARNING_CONFIRMATION_INVALIDATIONS.has(event?.type)) return null
  return current
}

export function getRepairFilmstripDurationMs(frameCount, fps) {
  return Number.isInteger(frameCount) &&
    frameCount > 0 &&
    Number.isFinite(fps) &&
    fps > 0
    ? (frameCount * 1000) / fps
    : 0
}

export function reduceRepairFilmstrip(state, event) {
  const frames = state.frames
  const select = (selectedIndex) => selectedIndex === state.selectedIndex
    ? state
    : { ...state, selectedIndex }
  if (!frames.length) {
    return state.selectedIndex === 0 && state.playing === false
      ? state
      : { ...state, selectedIndex: 0, playing: false }
  }
  if (event.type === 'toggle_play') return { ...state, playing: !state.playing }
  if (event.type === 'first') return select(0)
  if (event.type === 'last') return select(frames.length - 1)
  if (event.type === 'select') {
    if (!Number.isInteger(event.index)) return state
    return select(Math.max(0, Math.min(frames.length - 1, event.index)))
  }
  if (event.type === 'tick' && state.playing) {
    return select((state.selectedIndex + 1) % frames.length)
  }
  if (event.type === 'arrow' && event.filmstripFocused &&
      ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
    const delta = event.key === 'ArrowRight' ? 1 : -1
    return select(
      Math.max(
        0,
        Math.min(frames.length - 1, state.selectedIndex + delta),
      ),
    )
  }
  return state
}
