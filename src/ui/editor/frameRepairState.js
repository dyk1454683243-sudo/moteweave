const FRAME_REPAIR_UI_STATES = Object.freeze({
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

const ACTION_KEYS = Object.freeze([
  'edit_mask',
  'review_call',
  'generate',
  'recover',
  'confirm_warning',
  'accept',
  'discard',
  'close',
])

export function createEmptyFrameRepairState() {
  return {
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
  }
}

export function getFrameRepairUiState(requestedState) {
  const state = Object.hasOwn(FRAME_REPAIR_UI_STATES, requestedState)
    ? requestedState
    : 'failed_processing'
  const [message, declaredActions, retainsDraft] = FRAME_REPAIR_UI_STATES[state]
  const actions = [...declaredActions]
  const allowed = new Set(actions)
  const actionAvailability = Object.fromEntries(
    ACTION_KEYS.map((action) => [action, allowed.has(action)]),
  )
  return {
    state,
    message,
    announcement: message,
    actions,
    actionAvailability,
    retainsDraft,
    mutatesProject: state === 'accepted',
    tone: [
      'invalid_mask',
      'blocked_quality',
      'failed_model',
      'failed_processing',
      'outcome_unknown',
      'stale_plan',
      'project_conflict',
      'asset_revision_conflict',
    ].includes(state)
      ? 'blocking'
      : state === 'warning'
        ? 'warning'
        : 'neutral',
  }
}

export function hasExactFrameRepairWarningConfirmation({
  warningConfirmation,
  jobId,
  planHash,
} = {}) {
  return Boolean(
    warningConfirmation &&
    warningConfirmation.confirmed === true &&
    warningConfirmation.jobId === jobId &&
    warningConfirmation.planHash === planHash,
  )
}
