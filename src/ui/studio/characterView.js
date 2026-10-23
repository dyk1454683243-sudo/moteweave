import { getCurrentLanguage, setCurrentLanguage } from '../i18n.js'
import {
  isRecoverableStrictPendingRestoreError,
  loadAcceptedRawCharacterSource,
  mapStrictJobStatus,
  pollStrictGenerationJob,
  postStrictManualAcceptance,
  prepareStrictManualAcceptanceEvidence,
  parseStrictPendingGenerationSelector,
  replayStrictAcceptedPublication,
  requestStrictFixedRegionReview,
  restoreStrictReviewRequiredGeneration,
  selectStrictGeminiPreset,
  startStrictLiveGeneration,
  STRICT_FIXED_REGION_PROFILE,
  STRICT_V2_URL_FIELDS,
  validateStrictAcceptedPublicationCache,
} from './characterApi.js'
import { CHARACTER_T2I_PRESETS } from '../../character-pack/textToImagePrompt.js'
import {
  refreshStudioSettingsLanguage,
  studioProviderSnapshot,
  subscribeStudioProviderSnapshot,
  studioT,
  translateStudioDocument,
} from './settingsView.js'
import {
  getStudioLocalCharacterProjectCandidate,
  getStudioCharacterProcessingSourceState,
  initStudioCharacterLocal,
  adoptStudioCharacterProcessingSource,
  setStudioCharacterProcessingContext,
  renderStudioCharacterLocalLanguage,
} from './characterLocalView.js'
import {
  bindCharacterComboboxKinds,
  closeAllCharacterComboboxes,
  closeCharacterCombobox,
  commitCharacterCombobox,
  focusCharacterCombobox,
  openCharacterCombobox,
  readSelectOptions,
  registerCharacterCombobox,
  syncCharacterCombobox,
} from './characterCombobox.js'
import {
  applyCharacterSourceParameterIsolation,
  acceptedCharacterArtifactsReady,
  bindSharedCharacterResult,
  clearSharedCharacterResult,
  createAiAcceptedSourceResultPresentation,
  createAiReviewResultPresentation,
  getSharedCharacterExportPresentation,
  getSharedCharacterResultOwner,
  initSharedCharacterResult,
  loadAcceptedCharacterResultArtifacts,
  refreshSharedCharacterResultPresentation,
} from './characterResultView.js'

const REVIEW_LINKS = Object.freeze([
  ['character.reviewLinkReview', 'generation_review_url'],
  ['character.reviewLinkRequest', 'generation_request_manifest_url'],
  ['character.reviewLinkReferences', 'generation_reference_manifest_url'],
  ['character.reviewLinkPrompt', 'generation_prompt_url'],
])

export const CHARACTER_AI_COMPATIBLE_PRESET_IDS = Object.freeze(
  Object.values(CHARACTER_T2I_PRESETS)
    .filter((preset) => preset.aspectRatio === '1:1')
    .map((preset) => preset.id),
)
const DEFAULT_CHARACTER_PRESET = 'rpg_humanoid_v0'
const CHARACTER_AI_REFERENCE_MODE_BUILTIN = 'builtin'
const CHARACTER_AI_REFERENCE_MODE_CUSTOM = 'custom'
const CHARACTER_AI_MODEL_LOADING_VALUE = ''
const CHARACTER_AI_REFERENCE_TYPES = Object.freeze(new Set(['image/png', 'image/webp', 'image/jpeg']))
const CHARACTER_AI_REFERENCE_NAME = /\.(?:png|webp|jpe?g)$/i
const CHARACTER_AI_REFERENCE_KINDS = Object.freeze(['reference', 'palette'])
export const CHARACTER_AI_REFERENCE_MAX_BYTES = 2 * 1024 * 1024
export const CHARACTER_AI_REFERENCE_TOTAL_MAX_BYTES = 3 * 1024 * 1024
const CHARACTER_AI_REFERENCE_ERROR_KEYS = Object.freeze({
  reference_required: 'character.referenceRequired',
  reference_size_invalid: 'character.referenceSizeInvalid',
  reference_total_size_invalid: 'character.referenceTotalSizeInvalid',
  reference_type_invalid: 'character.referenceTypeInvalid',
  reference_read_failed: 'character.referenceReadFailed',
})
const characterAiReferenceEpoch = {
  reference: 0,
  palette: 0,
}
const CHARACTER_AI_COMBOBOX_KINDS = Object.freeze(['model', 'preset', 'referenceMode'])
registerCharacterCombobox('model', {
  select: 'character-model',
  trigger: 'character-model-trigger',
  value: 'character-model-value',
  list: 'character-model-list',
  optionPrefix: 'character-model-option',
  labelledBy: 'character-model-label',
  describedBy: () => {
    const gemini = globalThis.document?.getElementById?.('character-ai-gemini')
    return gemini && !gemini.hidden ? 'character-ai-gemini' : ''
  },
})
registerCharacterCombobox('preset', {
  select: 'character-preset',
  trigger: 'character-preset-trigger',
  value: 'character-preset-value',
  list: 'character-preset-list',
  optionPrefix: 'character-preset-option',
  labelledBy: 'character-preset-label',
})
registerCharacterCombobox('referenceMode', {
  select: 'character-reference-mode',
  trigger: 'character-reference-mode-trigger',
  value: 'character-reference-mode-value',
  list: 'character-reference-mode-list',
  optionPrefix: 'character-reference-mode-option',
  labelledBy: 'character-reference-mode-label',
  describedBy: () => 'character-reference-mode-help character-reference-mode-error',
})

const RELEASE_LINKS = Object.freeze([
  ['character-release-pack', 'zip_url'],
  ['character-release-godot', 'godot_npc_zip_url'],
  ['character-release-rpgmaker', 'rpgmaker_zip_url'],
  ['character-release-ocad', 'ocad_zip_url'],
])

const PIPELINE_PRESETS = Object.freeze({
  setup: Object.freeze([
    ['raw', 'character.pipelineRaw'],
    ['matte', 'character.pipelineMatte'],
    ['count', 'character.pipelineCount'],
    ['evidence', 'character.pipelineEvidence'],
    ['quality', 'character.pipelineQuality'],
    ['review', 'character.pipelineReview'],
    ['accept', 'character.pipelineAccept'],
  ]),
  confirm: null,
  running: null,
  review_required: Object.freeze([
    ['raw', 'character.pipelineRaw'],
    ['output', 'character.pipelineOutput'],
    ['six_base', 'character.pipelineSixBase'],
    ['spill', 'character.pipelineSpill'],
    ['sure_bg', 'character.pipelineSureBackground'],
    ['unknown', 'character.pipelineUnknown'],
    ['sure_fg', 'character.pipelineSureForeground'],
  ]),
  accepted: Object.freeze([
    ['idle', 'character.pipelineIdle'],
    ['walk_down', 'character.pipelineWalkDown'],
    ['walk_up', 'character.pipelineWalkUp'],
    ['walk_left', 'character.pipelineWalkLeft'],
    ['walk_right', 'character.pipelineWalkRight'],
    ['attack', 'character.pipelineAttack'],
    ['hurt', 'character.pipelineHurt'],
  ]),
  topdown: Object.freeze([
    ['profile', 'character.pipelineProfile'],
    ['structure', 'character.pipelineStructure'],
    ['prompt', 'character.pipelinePrompt'],
    ['model', 'character.pipelineModel'],
    ['budget', 'character.pipelineBudget'],
    ['hashes', 'character.pipelineHashes'],
    ['review', 'character.pipelineReview'],
  ]),
})

const JOB_STATUS_KEYS = Object.freeze({
  queued: 'character.jobStatusQueued',
  generating: 'character.jobStatusGenerating',
  post_processing: 'character.jobStatusPostProcessing',
  done: 'character.jobStatusDone',
  failed_quality_gate: 'character.jobStatusFailedQuality',
  failed_safety_filter: 'character.jobStatusFailedSafety',
  failed_model_error: 'character.jobStatusFailedModel',
  failed_post_processing: 'character.jobStatusFailedPost',
  not_found: 'character.jobStatusNotFound',
  request_failed: 'character.jobStatusRequestFailed',
  evidence_error: 'character.jobStatusEvidenceError',
  poll_interrupted: 'character.jobStatusPollInterrupted',
  submission_unknown: 'character.jobStatusSubmissionUnknown',
})

const EVIDENCE_MEDIA = Object.freeze([
  ['character-raw-image', 'raw_provider_output_url'],
  ['character-background-image', 'background_removed_provider_output_url'],
  ['character-normalized-image', 'normalized_sheet_url'],
  ['character-preview-image', 'background_preview_url'],
  ['character-spill-image', 'background_spill_overlay_url'],
  ['character-sure-background-image', 'background_sure_background_mask_url'],
  ['character-unknown-image', 'background_unknown_band_mask_url'],
  ['character-sure-foreground-image', 'background_sure_foreground_mask_url'],
  ['character-alpha-image', 'background_alpha_estimate_url'],
  ['character-reconstruction-image', 'background_foreground_reconstruction_url'],
])

const ACCEPTED_PUBLICATION_CACHE_KEY = 'gametool.studio.accepted-publication.v1'

let initialized = false
let boundCharacterDocument = null
let state = createInitialCharacterState()
let operationEpoch = 0
let activeController = null
let serviceConnectionAvailable = true
let activeCharacterMode = 'local'
let acceptedHydrateCount = 0

export function inspectStudioCharacterState() {
  return Object.freeze({
    mode: activeCharacterMode,
    phase: state.phase,
    busy: state.busy,
    jobId: state.job?.id ?? null,
    rawProviderOutputUrl: state.job?.raw_provider_output_url ?? null,
    pendingSelector: state.pendingSelector,
    publicationId: state.acceptance?.publication_id ?? null,
    hasAcceptedResult: Boolean(state.acceptedResult),
    acceptedHydrateError: state.acceptedHydrateError,
    acceptedPresentationReady: Boolean(state.acceptedPresentationReady),
    processingSourceReady: Boolean(state.processingSourceReady),
    processingSourceError: state.processingSourceError,
    processingSourcePublicationId: state.processingSourcePublicationId,
    hydrateCount: acceptedHydrateCount,
    missingQualityUrl: Boolean(state.acceptedResult?.missingQualityUrl),
  })
}

export function acceptedHydrationKind(value = state) {
  if (value.phase !== 'accepted') return null
  if (value.acceptedHydrateError || value.acceptedResult?.error || value.processingSourceError) return 'error'
  if (
    value.busy === 'hydrate'
    || !acceptedCharacterArtifactsReady(value.acceptedResult)
    || !value.acceptedPresentationReady
    || !value.processingSourceReady
  ) return 'pending'
  return 'ready'
}

function acceptedProcessingHandoffComplete(value = state) {
  return Boolean(
    value.phase === 'accepted'
    && value.processingSourceReady
    && value.processingSourcePublicationId === value.acceptance?.publication_id,
  )
}

function activeAiProcessingSourceReady() {
  const source = getStudioCharacterProcessingSourceState()
  return Boolean(
    source.hasSource
    && source.sourceOrigin === 'ai'
    && source.sourceProvenance?.publicationId,
  )
}

export function getStudioCharacterProjectCandidate() {
  if (activeCharacterMode === 'local') return getStudioLocalCharacterProjectCandidate()
  if (!activeAiProcessingSourceReady()) return null
  return getStudioLocalCharacterProjectCandidate()
}

function byId(id) {
  return globalThis.document?.getElementById?.(id) ?? null
}

function setText(id, value) {
  const node = byId(id)
  if (node) node.textContent = String(value ?? '')
}

function setHidden(id, hidden) {
  const node = byId(id)
  if (node) node.hidden = hidden
}

function compactHash(value) {
  const hash = String(value ?? '')
  return hash.length === 64 ? `${hash.slice(0, 12)}…${hash.slice(-8)}` : hash || '—'
}

function errorMessage(error) {
  if (error?.code === 'gemini_not_ready') return studioT('character.geminiNotReady')
  if (error?.code === 'invalid_issue_count') return studioT('character.issueCountInvalid')
  const detail = String(error?.message || error || '').trim()
  if (!detail) return studioT('character.unknownError')
  return studioT('character.failureDetail', { error: detail })
}

function issueCountFromControl() {
  const control = byId('character-issue-count')
  const value = Number(control?.value)
  if (!Number.isInteger(value) || value < 0) {
    const error = new Error('invalid issue count')
    error.code = 'invalid_issue_count'
    throw error
  }
  return value
}

function acceptFailureRequiresEvidenceRecheck(error) {
  return new Set([
    'artifact_integrity_failed',
    'acceptance_binding_stale',
    'acceptance_conflict',
    'source_job_not_found',
    'source_not_reviewable',
  ]).has(error?.code)
}

function beginOperation() {
  activeController?.abort()
  activeController = new AbortController()
  operationEpoch += 1
  return { epoch: operationEpoch, signal: activeController.signal }
}

function currentOperation(epoch) {
  return epoch === operationEpoch
}

function acceptedPublicationFromQuery() {
  try {
    const values = new URL(globalThis.location?.href).searchParams.getAll('publication')
    return values.length === 1 ? values[0] : null
  } catch {
    return null
  }
}

function pendingGenerationFromQuery() {
  try {
    const params = new URL(globalThis.location?.href).searchParams
    const jobs = params.getAll('pending_job')
    const reviews = params.getAll('pending_review')
    if (jobs.length !== 1 || reviews.length !== 1) return null
    return parseStrictPendingGenerationSelector({ jobId: jobs[0], reviewId: reviews[0] })
  } catch {
    return null
  }
}

function cacheAcceptedPublication({ publicationId, sourceJobId, body, response }) {
  try {
    globalThis.sessionStorage?.setItem(ACCEPTED_PUBLICATION_CACHE_KEY, JSON.stringify({
      version: 1,
      publicationId,
      sourceJobId,
      body,
      response,
    }))
  } catch {
    // Storage is an optional continuity aid; the validated server publication remains authoritative.
  }
}

function readAcceptedPublicationCache(publicationId) {
  try {
    const raw = globalThis.sessionStorage?.getItem(ACCEPTED_PUBLICATION_CACHE_KEY)
    if (!raw) return null
    return validateStrictAcceptedPublicationCache(JSON.parse(raw), publicationId)
  } catch {
    try {
      globalThis.sessionStorage?.removeItem(ACCEPTED_PUBLICATION_CACHE_KEY)
    } catch {
      // An unavailable storage surface is equivalent to a cache miss.
    }
    return null
  }
}

function selectAcceptedPublicationInUrl(publicationId) {
  try {
    const url = new URL(globalThis.location?.href)
    url.searchParams.set('publication', publicationId)
    url.searchParams.delete('pending_job')
    url.searchParams.delete('pending_review')
    globalThis.history?.replaceState(globalThis.history.state, '', url.href)
  } catch {
    // A history or storage policy must not turn a successful manual Accept into a failure.
  }
}

function clearPendingGenerationInUrl() {
  try {
    const url = new URL(globalThis.location?.href)
    url.searchParams.delete('pending_job')
    url.searchParams.delete('pending_review')
    globalThis.history?.replaceState(globalThis.history.state, '', url.href)
  } catch {
    // URL cleanup must not block the provider-free preparation of a new Review.
  }
}

export function createInitialCharacterState() {
  return {
    phase: 'setup',
    busy: null,
    pendingSelector: null,
    review: null,
    draftDescription: '',
    draftCharacterPreset: DEFAULT_CHARACTER_PRESET,
    draftSeed: '',
    draftReferenceMode: CHARACTER_AI_REFERENCE_MODE_BUILTIN,
    draftReferenceImage: null,
    draftPaletteImage: null,
    draftReferenceError: null,
    draftPaletteError: null,
    draftCustomReferenceError: null,
    draftConceptError: null,
    draftSeedError: null,
    sealedDescription: '',
    reviewConsumed: false,
    job: null,
    evidenceBody: null,
    verifiedArtifacts: [],
    evidenceMediaStatus: {},
    acceptance: null,
    acceptedBinding: null,
    acceptedResult: null,
    acceptedHydrateError: null,
    acceptedPresentationReady: false,
    processingSourceReady: false,
    processingSourceError: null,
    processingSourcePublicationId: null,
    failureMode: null,
    acceptError: null,
    error: null,
  }
}

export function deriveCharacterPresentation(value = state) {
  const phase = value.phase
  if (phase === 'topdown') {
    return {
      titleKey: 'character.topdownTitle',
      summaryKey: 'character.topdownSummary',
      kickerKey: 'character.topdownKicker',
      stageTitleKey: 'character.topdownStageTitle',
      stageSummaryKey: 'character.topdownStageSummary',
      actionKey: 'character.topdownAction',
      action: 'blocked',
      topStatusKey: 'character.statusBlockedPreReview',
      stagePhaseKey: 'character.phaseTopdown',
    }
  }
  if (phase === 'confirm') {
    return {
      titleKey: 'character.confirmTitle',
      summaryKey: 'character.confirmSummary',
      kickerKey: 'character.confirmKicker',
      stageTitleKey: 'character.confirmStageTitle',
      stageSummaryKey: 'character.confirmStageSummary',
      actionKey: 'character.confirmAction',
      action: 'confirm',
      topStatusKey: 'character.statusReady',
      stagePhaseKey: 'character.phaseConfirm',
    }
  }
  if (phase === 'running') {
    if (['restore_loading', 'restore_interrupted', 'restore_failed'].includes(value.failureMode)) {
      const loading = value.failureMode === 'restore_loading'
      const interrupted = value.failureMode === 'restore_interrupted'
      return {
        titleKey: loading
          ? 'character.pendingRestoreLoadingTitle'
          : interrupted
            ? 'character.pendingRestoreInterruptedTitle'
            : 'character.pendingRestoreFailedTitle',
        summaryKey: loading
          ? 'character.pendingRestoreLoadingSummary'
          : interrupted
            ? 'character.pendingRestoreInterruptedSummary'
            : 'character.pendingRestoreFailedSummary',
        kickerKey: loading
          ? 'character.pendingRestoreLoadingKicker'
          : interrupted
            ? 'character.pendingRestoreInterruptedKicker'
            : 'character.pendingRestoreFailedKicker',
        stageTitleKey: loading
          ? 'character.pendingRestoreLoadingStageTitle'
          : interrupted
            ? 'character.pendingRestoreInterruptedStageTitle'
            : 'character.pendingRestoreFailedStageTitle',
        stageSummaryKey: loading
          ? 'character.pendingRestoreLoadingStageSummary'
          : interrupted
            ? 'character.pendingRestoreInterruptedStageSummary'
            : 'character.pendingRestoreFailedStageSummary',
        actionKey: interrupted
          ? 'character.retryPendingRestore'
          : loading
            ? 'character.pendingRestoreLoadingAction'
            : 'character.pendingRestoreFailedAction',
        action: interrupted ? 'restore' : 'blocked',
        topStatusKey: loading
          ? 'character.statusPendingRestoreLoading'
          : interrupted
            ? 'character.statusPendingRestoreInterrupted'
            : 'character.statusPendingRestoreFailed',
        stagePhaseKey: loading
          ? 'character.phasePendingRestoreLoading'
          : interrupted
            ? 'character.phasePendingRestoreInterrupted'
            : 'character.phasePendingRestoreFailed',
      }
    }
    const jobStatus = value.failureMode === 'submission_unknown'
      ? 'submission_unknown'
      : value.failureMode === 'poll_interrupted'
        ? 'poll_interrupted'
        : value.failureMode === 'evidence'
          ? 'evidence_error'
          : value.job?.status || 'queued'
    const usedCalls = authoritativeCallUsage(value.job)
    const action = value.failureMode === 'poll_interrupted'
      ? 'observe'
      : value.failureMode === 'evidence'
        ? 'recheck'
        : 'running'
    return {
      titleKey: 'character.runningTitle',
      summaryKey: 'character.runningSummary',
      kickerKey: 'character.runningKicker',
      stageTitleKey: 'character.runningStageTitle',
      stageSummaryKey: 'character.runningStageSummary',
      actionKey: action === 'observe'
        ? 'character.resumeObservation'
        : action === 'recheck'
          ? 'character.recheckEvidence'
          : 'character.runningAction',
      action,
      statusCode: jobStatus,
      usedCalls,
      stageStatusCode: jobStatus,
    }
  }
  if (phase === 'review_required') {
    const evidenceFailure = value.failureMode === 'evidence'
    return {
      titleKey: evidenceFailure ? 'character.evidenceFailedTitle' : 'character.reviewRequiredTitle',
      summaryKey: evidenceFailure ? 'character.evidenceFailedSummary' : 'character.reviewRequiredSummary',
      kickerKey: evidenceFailure ? 'character.evidenceFailedKicker' : 'character.reviewRequiredKicker',
      stageTitleKey: evidenceFailure ? 'character.evidenceFailedStageTitle' : 'character.reviewRequiredStageTitle',
      stageSummaryKey: evidenceFailure ? 'character.evidenceFailedStageSummary' : 'character.reviewRequiredStageSummary',
      actionKey: evidenceFailure && value.job && value.review
        ? 'character.recheckEvidence'
        : evidenceFailure
          ? 'character.evidenceUnavailableAction'
          : 'character.acceptAction',
      action: evidenceFailure && value.job && value.review ? 'recheck' : evidenceFailure ? 'blocked' : 'accept',
      topStatusKey: value.job ? 'character.statusReviewRequired' : 'character.statusReviewRequiredZero',
      stagePhaseKey: 'character.phaseReviewRequired',
    }
  }
  if (phase === 'accepted') {
    const hydration = acceptedHydrationKind(value)
    const hydrateFailed = hydration === 'error'
    const hydratePending = hydration === 'pending'
    return {
      titleKey: 'character.acceptedTitle',
      summaryKey: hydrateFailed
        ? 'character.acceptedHydrateFailedSummary'
        : hydratePending
          ? 'character.acceptedHydratePendingSummary'
          : 'character.acceptedSummary',
      kickerKey: hydrateFailed
        ? 'character.acceptedHydrateFailedKicker'
        : hydratePending
          ? 'character.acceptedHydratePendingKicker'
          : 'character.acceptedKicker',
      stageTitleKey: 'character.acceptedStageTitle',
      stageSummaryKey: hydrateFailed
        ? 'character.acceptedHydrateFailedSummary'
        : hydratePending
          ? 'character.acceptedHydratePendingSummary'
          : 'character.acceptedStageSummary',
      actionKey: hydrateFailed
        ? 'character.retryAcceptedArtifacts'
        : 'character.acceptedHydratePendingAction',
      action: hydrateFailed ? 'retry-accepted' : 'blocked',
      topStatusKey: hydrateFailed
        ? 'character.statusAcceptedIncomplete'
        : hydratePending
          ? 'character.statusAcceptedPending'
          : 'character.statusAccepted',
      stagePhaseKey: 'character.phaseAccepted',
    }
  }
  const restoringPublication = value.busy === 'restore'
  return {
    titleKey: 'character.reviewTitle',
    summaryKey: 'character.reviewSummary',
    kickerKey: 'character.reviewKicker',
    stageTitleKey: 'character.reviewStageTitle',
    stageSummaryKey: 'character.reviewStageSummary',
    actionKey: restoringPublication ? 'character.restoringPublicationAction' : 'character.reviewAction',
    action: restoringPublication ? 'blocked' : 'review',
    topStatusKey: restoringPublication ? 'character.statusRestoringPublication' : 'character.statusReviewPending',
    stagePhaseKey: 'character.phaseReview',
  }
}

function localizedJobStatus(status) {
  const key = JOB_STATUS_KEYS[status]
  return key ? studioT(key) : String(status || '—')
}

function presentationStagePhase(presentation) {
  if (presentation.stagePhaseKey) return studioT(presentation.stagePhaseKey)
  return localizedJobStatus(presentation.stageStatusCode)
}

function presentationTopStatus(presentation) {
  if (presentation.topStatusKey) return studioT(presentation.topStatusKey)
  const status = localizedJobStatus(presentation.statusCode)
  return studioT(
    presentation.usedCalls === null ? 'character.statusCallsUnknown' : 'character.statusCallsKnown',
    { status, used: presentation.usedCalls },
  )
}

export function characterHeaderCrumbKey(value) {
  if (value?.failureMode) return 'character.headerCrumb'
  return {
    setup: 'character.headerCrumb',
    confirm: 'character.headerCrumbConfirm',
    running: 'character.headerCrumbRunning',
    review_required: 'character.headerCrumbReviewRequired',
    accepted: 'character.headerCrumbAccepted',
    topdown: 'character.headerCrumbTopdown',
  }[value?.phase] || 'character.headerCrumb'
}

function authoritativeCallUsage(job) {
  const reported = job?.provider_call_budget?.used_provider_calls
  if (Number.isInteger(reported)) return reported
  return null
}

function renderAiBudget(presentation) {
  const used = authoritativeCallUsage(state.job)
  const reviewReady = Boolean(state.review) || ['confirm', 'running', 'review_required', 'accepted'].includes(state.phase)
  const planned = state.phase === 'topdown' ? 0 : reviewReady && state.phase !== 'setup' ? 1 : 0
  const max = state.phase === 'topdown' ? 0 : 1
  const usedText = used === null
    ? (state.phase === 'setup' || state.phase === 'confirm' || state.phase === 'topdown' ? '0' : '—')
    : String(used)
  setText('character-ai-planned-calls', String(planned))
  setText('character-ai-max-calls', String(max))
  setText('character-ai-used-calls', usedText)
  setText('character-ai-next-action', studioT(presentation.actionKey))
}

function setActionMessage(message = '', status = '') {
  const node = byId('character-action-message')
  if (!node) return
  node.textContent = message
  node.dataset.state = status
}

function renderReviewBinding() {
  const review = state.review
  const sealedInputVisible = state.phase === 'review_required' && Boolean(review)
  setHidden('character-sealed-input', true)
  setText(
    'character-sealed-description',
    state.sealedDescription?.trim() || studioT('character.sealedDescriptionUnavailable'),
  )
  const promptLink = byId('character-sealed-prompt-link')
  if (promptLink) {
    const promptUrl = sealedInputVisible ? review?.generation_prompt_url : null
    if (promptUrl) {
      promptLink.href = promptUrl
      promptLink.hidden = false
    } else {
      promptLink.removeAttribute('href')
      promptLink.hidden = true
    }
  }
  setHidden('character-sealed-binding', true)
  setText('character-review-id', review?.reviewed_run_id || '—')
  setText('character-plan-hash', review?.plan_hash || '—')
  setText('character-reference-hash', review?.reference_manifest_sha256 || '—')
  setText('character-provider-binding', review
    ? `${review.provider?.preset_id || '—'} · ${review.provider?.route_kind || '—'}`
    : '—')
  setText('character-model-binding', review
    ? `${review.model || '—'} · ${review.image_config?.image_size || '—'} · ${review.image_config?.aspect_ratio || '—'}`
    : '—')
  const links = byId('character-review-links')
  if (!links) return
  links.replaceChildren()
  if (!review) return
  for (const [labelKey, field] of REVIEW_LINKS) {
    if (!review[field]) continue
    const anchor = document.createElement('a')
    anchor.href = review[field]
    anchor.textContent = studioT(labelKey)
    anchor.target = '_blank'
    anchor.rel = 'noopener'
    links.append(anchor)
  }
}

function evidenceCount(job = state.job) {
  return Object.keys(STRICT_V2_URL_FIELDS).filter((field) => Boolean(job?.[field])).length
}

function clearArtifactMedia() {
  for (const [id] of EVIDENCE_MEDIA) {
    byId(id)?.removeAttribute('src')
  }
}

function evidenceMediaReady() {
  return EVIDENCE_MEDIA.every(([, field]) => state.evidenceMediaStatus[field] === 'loaded')
}

function renderEvidenceArtifactLinks() {
  const links = byId('character-evidence-artifacts')
  if (!links) return
  links.replaceChildren()
  if (state.phase !== 'review_required') return
  for (const artifact of state.verifiedArtifacts) {
    const anchor = document.createElement('a')
    const file = document.createElement('strong')
    const detail = document.createElement('span')
    anchor.href = artifact.url
    anchor.target = '_blank'
    anchor.rel = 'noopener'
    file.textContent = artifact.file
    detail.textContent = `${artifact.sha256} · ${artifact.byte_length} B · ${artifact.url}`
    anchor.title = `${artifact.sha256} · ${artifact.url}`
    anchor.append(file, detail)
    links.append(anchor)
  }
}

function renderEvidence() {
  const visible = state.phase === 'review_required' && Boolean(state.job && state.evidenceBody)
  const review = state.review
  const rawSha = state.evidenceBody?.expectedRawProviderOutputSha256 || '—'
  const loadedMediaCount = EVIDENCE_MEDIA.filter(([, field]) => state.evidenceMediaStatus[field] === 'loaded').length
  const summaryStatus = byId('character-evidence-summary-status')
  setText('character-evidence-provider', review
    ? `${review.provider?.preset_id || '—'} · ${review.provider?.route_kind || '—'}`
    : '—')
  setText('character-evidence-model', review
    ? `${review.model || '—'} · ${review.image_config?.image_size || '—'} · ${review.image_config?.aspect_ratio || '—'}`
    : '—')
  setText('character-evidence-review-id', review?.reviewed_run_id || review?.review_id || '—')
  setBoundText('character-evidence-raw-sha', rawSha, rawSha)
  if (summaryStatus) {
    const ready = visible && evidenceMediaReady()
    summaryStatus.dataset.state = state.failureMode === 'evidence' ? 'error' : ready ? 'ready' : 'loading'
    summaryStatus.textContent = state.failureMode === 'evidence'
      ? studioT('character.evidenceSummaryError')
      : ready
        ? studioT('character.evidenceVerifiedCount', { count: evidenceCount() })
        : studioT('character.evidenceLoadingCount', { count: loadedMediaCount, total: EVIDENCE_MEDIA.length })
  }
  setHidden('character-evidence-grid', !visible)
  setHidden('character-evidence-artifacts', !visible)
  if (!visible) {
    clearArtifactMedia()
    renderEvidenceArtifactLinks()
    return
  }
  const job = state.job
  for (const [id, field] of EVIDENCE_MEDIA) {
    const image = byId(id)
    if (!image) continue
    const status = state.evidenceMediaStatus[field]
    image.dataset.evidenceField = field
    image.hidden = status === 'failed'
    if (status === 'failed') {
      image.removeAttribute('src')
    } else if (typeof job?.[field] === 'string' && job[field] && image.getAttribute('src') !== job[field]) {
      image.src = job[field]
    } else if (!(typeof job?.[field] === 'string' && job[field])) {
      image.removeAttribute('src')
      if ('src' in image) image.src = ''
    }
  }
  setText('character-raw-caption', compactHash(state.evidenceBody?.expectedRawProviderOutputSha256))
  setText('character-spill-caption', studioT('character.maskSummary', { count: evidenceCount(job) }))
  renderEvidenceArtifactLinks()
}

function setReleaseLink(id, url) {
  const anchor = byId(id)
  if (!anchor) return
  anchor.hidden = !url
  if (url) anchor.href = url
  else anchor.removeAttribute('href')
}

function renderRelease() {
  setHidden('character-release-grid', true)
  for (const [id] of RELEASE_LINKS) setReleaseLink(id, null)
}

export function characterPipelineStepState(value, step) {
  if (value.phase === 'accepted') return acceptedHydrationKind(value) === 'ready' ? 'complete' : 'wait'
  if (value.phase === 'review_required') {
    if (value.failureMode === 'evidence') {
      return step === 'raw' && value.job?.raw_provider_output_url ? 'complete' : 'wait'
    }
    return 'complete'
  }
  if (value.phase === 'topdown') {
    if (step === 'profile') return 'complete'
    if (step === 'structure') return 'current'
    return 'wait'
  }
  if (value.phase === 'confirm' && step === 'review') return 'current'
  if (value.phase === 'running') {
    if (value.failureMode) return step === 'raw' && value.job?.raw_provider_output_url ? 'complete' : 'wait'
    if (step === 'raw') return value.job?.raw_provider_output_url ? 'complete' : 'current'
    if (step === 'matte' && value.job?.status === 'post_processing') return 'current'
  }
  return 'wait'
}

export function characterJobStripPresentation(value) {
  if (value.phase === 'setup' && value.busy === 'restore') {
    return { titleKey: 'character.statusRestoringPublication', detailKey: 'character.restoringPublicationAction' }
  }
  if (value.phase === 'review_required' && value.failureMode === 'evidence') {
    return { titleKey: 'character.jobStatusEvidenceError', detailKey: 'character.evidenceFailedStageSummary' }
  }
  if (value.phase === 'running' && ['restore_loading', 'restore_interrupted', 'restore_failed'].includes(value.failureMode)) {
    return {
      restore_loading: {
        titleKey: 'character.statusPendingRestoreLoading',
        detailKey: 'character.pendingRestoreLoadingStageSummary',
      },
      restore_interrupted: {
        titleKey: 'character.statusPendingRestoreInterrupted',
        detailKey: 'character.pendingRestoreInterruptedStageSummary',
      },
      restore_failed: {
        titleKey: 'character.statusPendingRestoreFailed',
        detailKey: 'character.pendingRestoreFailedStageSummary',
      },
    }[value.failureMode]
  }
  if (value.phase === 'running' && value.failureMode) {
    const statusCode = value.failureMode === 'submission_unknown'
      ? 'submission_unknown'
      : value.failureMode === 'poll_interrupted'
        ? 'poll_interrupted'
        : value.failureMode === 'evidence'
          ? 'evidence_error'
          : value.job?.status || 'request_failed'
    return { statusCode, detailKey: null }
  }
  return {
    setup: { titleKey: 'character.stripReviewTitle', detailKey: 'character.reviewJobDetail' },
    confirm: { titleKey: 'character.stripConfirmTitle', detailKey: 'character.confirmJobDetail' },
    running: { titleKey: 'character.stripRunningTitle', detailKey: 'character.runningJobDetail' },
    review_required: { titleKey: 'character.stripReviewRequiredTitle', detailKey: 'character.reviewRequiredJobDetail' },
    topdown: { titleKey: 'character.stripTopdownTitle', detailKey: 'character.topdownJobDetail' },
    accepted: { titleKey: 'character.statusAccepted', detailKey: null },
  }[value.phase] || { titleKey: 'character.stripReviewTitle', detailKey: 'character.reviewJobDetail' }
}

function renderPipeline() {
  const standard = PIPELINE_PRESETS.setup
  const preset = PIPELINE_PRESETS[state.phase] || standard
  const items = [...document.querySelectorAll('[data-pipeline-step]')]
  items.forEach((item, index) => {
    const [step, labelKey] = preset[index] || standard[index]
    item.dataset.pipelineStep = step
    const title = item.querySelector('span')
    if (title) title.textContent = studioT(labelKey)
    const stepState = characterPipelineStepState(state, item.dataset.pipelineStep)
    item.classList.toggle('is-complete', stepState === 'complete')
    item.classList.toggle('is-current', stepState === 'current')
    const label = item.querySelector('small')
    if (label) {
      label.textContent = stepState === 'complete'
        ? studioT('character.pipelineComplete')
        : studioT(stepState === 'current' ? 'character.pipelineCurrent' : 'character.pipelineWait')
    }
  })
  const strip = characterJobStripPresentation(state)
  const pipelineStatus = strip.statusCode ? localizedJobStatus(strip.statusCode) : studioT(strip.titleKey)
  setText('character-running-job-state', pipelineStatus)
  let pipelineDetail
  if (state.phase === 'running' && ['restore_loading', 'restore_interrupted', 'restore_failed'].includes(state.failureMode)) {
    pipelineDetail = studioT(strip.detailKey)
  } else if (state.phase === 'running' && state.failureMode) {
    pipelineDetail = state.job?.reason
      ? studioT('character.failureDetail', { error: state.job.reason })
      : state.error || studioT('character.unknownError')
  } else if (state.phase === 'review_required' && state.failureMode === 'evidence') {
    pipelineDetail = state.error || studioT(strip.detailKey)
  } else if (state.phase === 'running' && state.job?.raw_provider_output_url) {
    pipelineDetail = studioT('character.rawPersisted')
  } else if (strip.detailKey === 'character.runningJobDetail') {
    const usedCalls = authoritativeCallUsage(state.job)
    pipelineDetail = usedCalls === null
      ? studioT('character.jobCallsUnknown')
      : studioT('character.runningJobDetail', {
        used: usedCalls,
      })
  } else {
    pipelineDetail = strip.detailKey ? studioT(strip.detailKey) : ''
  }
  setText('character-running-job-detail', pipelineDetail)
}

function setBoundText(id, value, fullValue = value) {
  const node = byId(id)
  if (!node) return
  node.textContent = String(value ?? '—')
  if (fullValue && String(fullValue) !== '—') node.title = String(fullValue)
  else node.removeAttribute('title')
}

function renderRunningPhases() {
  const phases = [...document.querySelectorAll('[data-running-phase]')]
  let completedThrough = -1
  let current = state.phase === 'running' ? 0 : -1
  const status = state.job?.status
  if (status === 'generating') current = 1
  if (state.job?.raw_provider_output_url) {
    completedThrough = 2
    current = status === 'post_processing' ? 3 : -1
  }
  if (status === 'done') {
    completedThrough = phases.length - 1
    current = -1
  }
  phases.forEach((item, index) => {
    item.classList.toggle('is-complete', index <= completedThrough)
    item.classList.toggle('is-current', index === current && !state.failureMode)
  })
}

function renderFigmaStateBindings() {
  const usedCalls = authoritativeCallUsage(state.job)
  setText('character-running-provider-calls', usedCalls === null ? '—' : usedCalls)
  setText(
    'character-running-call-budget',
    studioT(usedCalls === null ? 'character.callsUnknown' : usedCalls === 1 ? 'character.callsOne' : 'character.callsNone'),
  )
  const rawSha = state.job?.raw_provider_output_sha256
  setBoundText('character-running-raw-provenance', compactHash(rawSha), rawSha)
  const submissionUnknown = state.failureMode === 'submission_unknown'
  const pendingRestore = ['restore_loading', 'restore_interrupted', 'restore_failed'].includes(state.failureMode)
  const terminalBeforeRaw = state.failureMode === 'terminal' && !state.job?.raw_provider_output_url
  setText(
    'character-running-mode-binding',
    studioT(
      pendingRestore
        ? 'character.pendingRestoreExistingArtifacts'
        : submissionUnknown
          ? 'character.sealedSubmissionUnknown'
          : 'character.oneCallSealedJob',
    ),
  )
  setText(
    'character-running-panel-title',
    studioT(
      state.job?.raw_provider_output_url
        ? 'character.runningProviderComplete'
        : pendingRestore
          ? state.failureMode === 'restore_failed'
            ? 'character.runningPendingRestoreFailed'
            : state.failureMode === 'restore_interrupted'
              ? 'character.runningPendingRestoreInterrupted'
              : 'character.runningPendingRestoreLoading'
        : submissionUnknown
          ? 'character.runningSubmissionUnknown'
          : terminalBeforeRaw
            ? 'character.runningStopped'
            : 'character.runningProviderPending',
    ),
  )
  setText(
    'character-running-network-phase',
    studioT(
      state.job?.raw_provider_output_url
        ? 'character.networkFinished'
        : pendingRestore
          ? 'character.networkPendingRestoreReadOnly'
        : submissionUnknown
          ? 'character.networkStateUnknown'
          : terminalBeforeRaw
            ? 'character.networkStateStopped'
            : 'character.networkStatePending',
    ),
  )

  setText('character-review-gate-binding', 'manual_accept_v1')
  setText(
    'character-review-mode-binding',
    studioT(state.job ? 'character.statusReviewRequired' : 'character.statusReviewRequiredZero'),
  )
  setBoundText(
    'character-review-raw-sha',
    compactHash(state.evidenceBody?.expectedRawProviderOutputSha256),
    state.evidenceBody?.expectedRawProviderOutputSha256,
  )
  setText('character-review-matte-count', state.phase === 'review_required'
    ? `${evidenceCount()}/11`
    : '—')

  const acceptance = state.phase === 'accepted' ? state.acceptance : null
  const binding = state.phase === 'accepted' ? state.acceptedBinding : null
  setBoundText('character-accepted-publication-id', acceptance?.publication_id)
  setText('character-accepted-profile', STRICT_FIXED_REGION_PROFILE.generationProfileId)
  setBoundText('character-accepted-source-job', acceptance?.source_job_id)
  setBoundText(
    'character-accepted-raw-sha',
    compactHash(binding?.expectedRawProviderOutputSha256),
    binding?.expectedRawProviderOutputSha256,
  )
  setText('character-accepted-release-gate', acceptance ? studioT('character.acceptedSealedValue') : '—')
  setText('character-accepted-output-pack', acceptance?.zip_url?.split('/').at(-1) || '—')
  setText(
    'character-accepted-output-engines',
    acceptance ? 'Godot · RPG Maker · OCAD' : '—',
  )
  const hydration = acceptedHydrationKind()
  setText(
    'character-accepted-card-kicker',
    studioT(
      hydration === 'ready'
        ? 'character.acceptedKicker'
        : hydration === 'error'
          ? 'character.acceptedHydrateFailedKicker'
          : 'character.acceptedHydratePendingKicker',
    ),
  )
  setText(
    'character-accepted-card-detail',
    studioT(
      hydration === 'ready'
        ? 'character.releasePack'
        : hydration === 'error'
          ? 'character.acceptedHydrateFailedSummary'
          : 'character.acceptedDownloadUnverified',
    ),
  )
  renderRunningPhases()
}


function cleanPromptValue(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ')
}

function compatibleCharacterPreset(value) {
  const preset = String(value || DEFAULT_CHARACTER_PRESET)
  return CHARACTER_AI_COMPATIBLE_PRESET_IDS.includes(preset) ? preset : DEFAULT_CHARACTER_PRESET
}

function currentCharacterAiDrafts() {
  return {
    draftDescription: byId('character-description')?.value ?? state.draftDescription ?? '',
    draftCharacterPreset: compatibleCharacterPreset(
      byId('character-preset')?.value || state.draftCharacterPreset,
    ),
    draftSeed: byId('character-seed')?.value ?? state.draftSeed ?? '',
    draftReferenceMode: compatibleCharacterAiReferenceMode(
      byId('character-reference-mode')?.value || state.draftReferenceMode,
    ),
    draftReferenceImage: state.draftReferenceImage,
    draftPaletteImage: state.draftPaletteImage,
    draftReferenceError: state.draftReferenceError,
    draftPaletteError: state.draftPaletteError,
    draftCustomReferenceError: state.draftCustomReferenceError,
  }
}

function compatibleCharacterAiReferenceMode(value) {
  return value === CHARACTER_AI_REFERENCE_MODE_CUSTOM
    ? CHARACTER_AI_REFERENCE_MODE_CUSTOM
    : CHARACTER_AI_REFERENCE_MODE_BUILTIN
}

function characterAiUsesCustomReferences(value = state) {
  return compatibleCharacterAiReferenceMode(
    value === state
      ? (byId('character-reference-mode')?.value || state.draftReferenceMode)
      : value.draftReferenceMode,
  ) === CHARACTER_AI_REFERENCE_MODE_CUSTOM
}

function characterAiHasCustomReferenceDraft(value = state) {
  return Boolean(reviewImagePayload(value.draftReferenceImage) || reviewImagePayload(value.draftPaletteImage))
}

function characterAiComboboxInvalid(kind) {
  return kind === 'referenceMode' && Boolean(state.draftCustomReferenceError)
}

function characterAiComboboxNormalize(kind) {
  if (kind === 'referenceMode') return compatibleCharacterAiReferenceMode
  if (kind === 'preset') return compatibleCharacterPreset
  return undefined
}

function focusCharacterAiCombobox(kind) {
  focusCharacterCombobox(kind)
}

function focusCharacterAiReferenceMode() {
  focusCharacterCombobox('referenceMode')
}

function closeAllCharacterAiComboboxes(options) {
  closeAllCharacterComboboxes(options)
}

function closeCharacterAiReferenceModeMenu(options) {
  closeCharacterCombobox('referenceMode', options)
}

function syncCharacterAiCombobox(kind, { editable = true } = {}) {
  syncCharacterCombobox(kind, { editable, invalid: characterAiComboboxInvalid(kind) })
}

function syncCharacterAiReferenceModeListbox(options) {
  syncCharacterAiCombobox('referenceMode', options)
}

function openCharacterAiCombobox(kind) {
  openCharacterCombobox(kind, { editable: true, invalid: characterAiComboboxInvalid(kind) })
}

function openCharacterAiReferenceModeMenu() {
  openCharacterAiCombobox('referenceMode')
}

function commitCharacterAiCombobox(kind, value) {
  commitCharacterCombobox(kind, value, {
    normalize: characterAiComboboxNormalize(kind),
    invalid: characterAiComboboxInvalid(kind),
  })
}

function commitCharacterAiReferenceMode(value) {
  commitCharacterAiCombobox('referenceMode', value)
}

function replaceSelectOptions(select, specs, selectedValue) {
  if (!select) return
  const doc = globalThis.document
  if (typeof select.replaceChildren === 'function' && typeof doc?.createElement === 'function') {
    const options = specs.map((spec) => {
      const option = doc.createElement('option')
      option.value = spec.value
      option.textContent = spec.label
      option.selected = spec.value === selectedValue
      return option
    })
    select.replaceChildren(...options)
  } else {
    select.options = specs.map((spec) => ({
      value: spec.value,
      text: spec.label,
      textContent: spec.label,
      selected: spec.value === selectedValue,
    }))
  }
  select.value = selectedValue
}

function resolvedCharacterAiModel() {
  const snapshot = studioProviderSnapshot()
  const kind = snapshot?.kind
  if (!kind || kind === 'loading' || kind === 'saving' || kind === 'clearing') {
    return { status: 'loading' }
  }
  if (!serviceConnectionAvailable || kind !== 'resolved' || !snapshot.provider) {
    return { status: 'unavailable' }
  }
  try {
    return { status: 'ready', preset: selectStrictGeminiPreset(snapshot.provider) }
  } catch {
    return { status: 'unavailable' }
  }
}

function renderCharacterAiModelSelect({ editable = true } = {}) {
  const select = byId('character-model')
  if (!select) return
  const resolved = resolvedCharacterAiModel()
  const ready = resolved.status === 'ready'
  const preset = ready ? resolved.preset : null
  const selectedValue = ready ? String(preset.id) : CHARACTER_AI_MODEL_LOADING_VALUE
  const specs = ready
    ? [{ value: selectedValue, label: `Gemini · ${preset.model || preset.id}` }]
    : [{
        value: CHARACTER_AI_MODEL_LOADING_VALUE,
        label: studioT(resolved.status === 'loading' ? 'character.modelChecking' : 'character.modelUnavailable'),
      }]
  replaceSelectOptions(select, specs, selectedValue)
  const disabled = !ready || !editable
  select.disabled = disabled
  select.setAttribute('aria-disabled', String(disabled))
  const gemini = byId('character-ai-gemini')
  if (gemini && !gemini.hidden) select.setAttribute('aria-describedby', 'character-ai-gemini')
  else select.removeAttribute('aria-describedby')
  syncCharacterAiCombobox('model', { editable: !disabled })
}

function reviewImagePayload(image) {
  if (!image?.base64) return null
  return {
    base64: image.base64,
    mimeType: image.mimeType || 'image/png',
    name: image.name || 'reference.png',
  }
}

function formatCharacterAiFileSize(size) {
  const bytes = Number(size)
  if (!Number.isFinite(bytes) || bytes <= 0) return '—'
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
  if (bytes >= 1024) return `${Math.max(1, Math.round(bytes / 1024))} KiB`
  return `${bytes} B`
}

function characterAiReferenceError(code) {
  const key = CHARACTER_AI_REFERENCE_ERROR_KEYS[code] || 'character.referenceReadFailed'
  const error = new Error(studioT(key))
  error.code = code
  return error
}

export function characterAiReferenceErrorText(code) {
  if (!code) return ''
  const key = CHARACTER_AI_REFERENCE_ERROR_KEYS[code] || 'character.referenceReadFailed'
  return studioT(key)
}

export async function readCharacterAiReferenceFile(file, kind = 'reference', { otherSize = 0 } = {}) {
  if (!file || typeof file.arrayBuffer !== 'function') {
    throw characterAiReferenceError('reference_required')
  }
  const size = Number(file.size)
  if (!Number.isSafeInteger(size) || size <= 0 || size > CHARACTER_AI_REFERENCE_MAX_BYTES) {
    throw characterAiReferenceError('reference_size_invalid')
  }
  const peer = Number(otherSize) || 0
  if (size + peer > CHARACTER_AI_REFERENCE_TOTAL_MAX_BYTES) {
    throw characterAiReferenceError('reference_total_size_invalid')
  }
  const type = String(file.type ?? '').toLowerCase()
  const name = String(file.name ?? '')
  if (!(CHARACTER_AI_REFERENCE_TYPES.has(type) || (!type && CHARACTER_AI_REFERENCE_NAME.test(name)))) {
    throw characterAiReferenceError('reference_type_invalid')
  }
  let bytes
  try {
    bytes = new Uint8Array(await file.arrayBuffer())
  } catch {
    throw characterAiReferenceError('reference_read_failed')
  }
  if (!bytes.byteLength) {
    throw characterAiReferenceError('reference_read_failed')
  }
  const chunk = 0x8000
  let binary = ''
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  let base64 = ''
  try {
    base64 = globalThis.btoa(binary)
  } catch {
    throw characterAiReferenceError('reference_read_failed')
  }
  const mimeType = CHARACTER_AI_REFERENCE_TYPES.has(type)
    ? type
    : name.toLowerCase().endsWith('.webp')
      ? 'image/webp'
      : name.toLowerCase().endsWith('.jpg') || name.toLowerCase().endsWith('.jpeg')
        ? 'image/jpeg'
        : 'image/png'
  return {
    name: name || `${kind}.png`,
    mimeType,
    base64,
    size: bytes.byteLength,
    objectUrl: globalThis.URL?.createObjectURL?.(file) || '',
  }
}

export function collectCharacterAiReviewInput(value = state) {
  const live = value === state ? currentCharacterAiDrafts() : {
    draftDescription: value.draftDescription ?? '',
    draftCharacterPreset: compatibleCharacterPreset(value.draftCharacterPreset),
    draftSeed: value.draftSeed ?? '',
    draftReferenceMode: compatibleCharacterAiReferenceMode(value.draftReferenceMode),
    draftReferenceImage: value.draftReferenceImage,
    draftPaletteImage: value.draftPaletteImage,
  }
  const description = cleanPromptValue(live.draftDescription)
  const providerPresetId = String(
    value === state
      ? (byId('character-model')?.value ?? '')
      : (value.providerPresetId ?? value.draftProviderPresetId ?? ''),
  ).trim()
  const seedRaw = String(live.draftSeed ?? '').trim()
  const seed = seedRaw === '' ? undefined : Number(seedRaw)
  if (seedRaw !== '' && !Number.isInteger(seed)) {
    const error = new Error(studioT('character.seedInvalid'))
    error.code = 'seed_invalid'
    throw error
  }
  const custom = compatibleCharacterAiReferenceMode(live.draftReferenceMode) === CHARACTER_AI_REFERENCE_MODE_CUSTOM
  const referenceImage = custom ? reviewImagePayload(live.draftReferenceImage) : null
  const paletteImage = custom ? reviewImagePayload(live.draftPaletteImage) : null
  if (custom && !referenceImage && !paletteImage) {
    const error = new Error(studioT('character.customReferenceRequired'))
    error.code = 'custom_reference_required'
    throw error
  }
  return {
    description,
    characterPreset: compatibleCharacterPreset(live.draftCharacterPreset),
    ...(providerPresetId ? { providerPresetId } : {}),
    ...(referenceImage ? { referenceImage } : {}),
    ...(paletteImage ? { paletteImage } : {}),
    ...(seed !== undefined ? { generationOptions: { candidateCount: 1, seed } } : {}),
  }
}

function revokeCharacterAiReviewImage(image) {
  if (image?.objectUrl) globalThis.URL?.revokeObjectURL?.(image.objectUrl)
}

function renderCharacterAiReference(kind, { editable = true } = {}) {
  const image = kind === 'palette' ? state.draftPaletteImage : state.draftReferenceImage
  const errorCode = kind === 'palette' ? state.draftPaletteError : state.draftReferenceError
  const errorText = characterAiReferenceErrorText(errorCode)
  const empty = byId(`character-${kind}-empty`)
  const selected = byId(`character-${kind}-selected`)
  const preview = byId(`character-${kind}-preview`)
  const name = byId(`character-${kind}-name`)
  const meta = byId(`character-${kind}-meta`)
  const file = byId(`character-${kind}-file`)
  const clear = byId(`character-${kind}-clear`)
  const error = byId(`character-${kind}-error`)
  if (empty) empty.hidden = Boolean(image)
  if (selected) selected.hidden = !image
  if (preview) {
    preview.alt = studioT(kind === 'palette' ? 'character.paletteImageAlt' : 'character.referenceImageAlt')
    if (image?.objectUrl) {
      if (preview.getAttribute?.('src') !== image.objectUrl) preview.src = image.objectUrl
    } else {
      if ('src' in preview) preview.src = ''
      preview.removeAttribute?.('src')
    }
  }
  if (name) name.textContent = image?.name || '—'
  if (meta) meta.textContent = image ? formatCharacterAiFileSize(image.size) : '—'
  if (file) {
    file.disabled = !editable
    const describedBy = [`character-${kind}-label`, `character-${kind}-error`].join(' ')
    file.setAttribute('aria-describedby', describedBy)
    if (errorText) file.setAttribute('aria-invalid', 'true')
    else file.removeAttribute('aria-invalid')
  }
  if (clear) clear.disabled = !editable || !image
  if (error) {
    error.hidden = !errorText
    error.textContent = errorText || ''
  }
}

export async function assignCharacterAiReference(kind, file) {
  if (!CHARACTER_AI_REFERENCE_KINDS.includes(kind)) return
  const epoch = characterAiReferenceEpoch[kind] + 1
  characterAiReferenceEpoch[kind] = epoch
  const imageKey = kind === 'palette' ? 'draftPaletteImage' : 'draftReferenceImage'
  const errorKey = kind === 'palette' ? 'draftPaletteError' : 'draftReferenceError'
  try {
    const next = await readCharacterAiReferenceFile(file, kind)
    if (characterAiReferenceEpoch[kind] !== epoch) {
      revokeCharacterAiReviewImage(next)
      return
    }
    const other = kind === 'palette' ? state.draftReferenceImage : state.draftPaletteImage
    if ((Number(next.size) || 0) + (Number(other?.size) || 0) > CHARACTER_AI_REFERENCE_TOTAL_MAX_BYTES) {
      revokeCharacterAiReviewImage(next)
      setState({ [errorKey]: 'reference_total_size_invalid' })
      return
    }
    revokeCharacterAiReviewImage(state[imageKey])
    setState({ [imageKey]: next, [errorKey]: null, draftCustomReferenceError: null })
  } catch (error) {
    if (characterAiReferenceEpoch[kind] !== epoch) return
    setState({ [errorKey]: error?.code || 'reference_read_failed' })
  }
}

export function clearCharacterAiReference(kind) {
  if (!CHARACTER_AI_REFERENCE_KINDS.includes(kind)) return
  characterAiReferenceEpoch[kind] += 1
  const imageKey = kind === 'palette' ? 'draftPaletteImage' : 'draftReferenceImage'
  const errorKey = kind === 'palette' ? 'draftPaletteError' : 'draftReferenceError'
  const file = byId(`character-${kind}-file`)
  revokeCharacterAiReviewImage(state[imageKey])
  if (file) file.value = ''
  setState({ [imageKey]: null, [errorKey]: null })
}

function setCharacterAiControlValue(id, value) {
  const node = byId(id)
  if (!node) return
  const next = value ?? ''
  if (node.value !== next) node.value = next
}

function setCharacterAiControlEditable(id, editable) {
  const node = byId(id)
  if (node) node.disabled = !editable
}

function renderAiSourceComposer({ acceptedSourceReady = false } = {}) {
  const setup = state.phase === 'setup'
  const reviewRequired = state.phase === 'review_required'
  const editable = serviceConnectionAvailable
    && (setup || reviewRequired || acceptedSourceReady)
    && !state.busy
  setCharacterAiControlValue('character-description', state.draftDescription)
  setCharacterAiControlEditable('character-description', editable)
  const descriptionNode = byId('character-description')
  if (descriptionNode) {
    descriptionNode.required = true
    descriptionNode.setAttribute('aria-required', 'true')
    descriptionNode.setAttribute('aria-describedby', 'character-description-error')
    if (state.draftConceptError) descriptionNode.setAttribute('aria-invalid', 'true')
    else descriptionNode.removeAttribute('aria-invalid')
  }
  const conceptError = byId('character-description-error')
  if (conceptError) {
    const textValue = state.draftConceptError ? studioT('character.descriptionRequired') : ''
    conceptError.hidden = !textValue
    conceptError.textContent = textValue
  }
  setCharacterAiControlValue('character-preset', compatibleCharacterPreset(state.draftCharacterPreset))
  setCharacterAiControlEditable('character-preset', editable)
  const referenceMode = compatibleCharacterAiReferenceMode(state.draftReferenceMode)
  const customReferences = referenceMode === CHARACTER_AI_REFERENCE_MODE_CUSTOM
  const missingCustomReference = customReferences && !characterAiHasCustomReferenceDraft()
  setCharacterAiControlValue('character-reference-mode', referenceMode)
  setCharacterAiControlEditable('character-reference-mode', editable)
  if (!editable) closeAllCharacterAiComboboxes()
  const modeHelp = byId('character-reference-mode-help')
  if (modeHelp) {
    modeHelp.textContent = studioT(
      customReferences ? 'character.referenceModeCustomHelp' : 'character.referenceModeBuiltinHelp',
    )
  }
  const modeError = byId('character-reference-mode-error')
  if (modeError) {
    const textValue = state.draftCustomReferenceError ? studioT('character.customReferenceRequired') : ''
    modeError.hidden = !textValue
    modeError.textContent = textValue
  }
  const modeSelect = byId('character-reference-mode')
  if (modeSelect) {
    modeSelect.setAttribute('aria-describedby', 'character-reference-mode-help character-reference-mode-error')
    if (state.draftCustomReferenceError) modeSelect.setAttribute('aria-invalid', 'true')
    else modeSelect.removeAttribute('aria-invalid')
  }
  const refs = byId('character-ai-refs')
  if (refs) {
    refs.hidden = !customReferences
    refs.setAttribute('aria-hidden', String(!customReferences))
  }
  if (!customReferences) clearCustomReferenceActionMessage()
  setCharacterAiControlValue('character-seed', state.draftSeed)
  setCharacterAiControlEditable('character-seed', editable)
  const seed = byId('character-seed')
  if (seed) {
    seed.setAttribute('aria-describedby', 'character-seed-error')
    if (state.draftSeedError || (String(state.draftSeed ?? '').trim() && !Number.isInteger(Number(state.draftSeed)))) {
      seed.setAttribute('aria-invalid', 'true')
    } else {
      seed.removeAttribute('aria-invalid')
    }
  }
  const seedError = byId('character-seed-error')
  if (seedError) {
    const textValue = state.draftSeedError ? studioT('character.seedInvalid') : ''
    seedError.hidden = !textValue
    seedError.textContent = textValue
  }
  for (const kind of CHARACTER_AI_REFERENCE_KINDS) {
    renderCharacterAiReference(kind, { editable: editable && customReferences })
  }
  const description = byId('character-description')
  const replacementReady = reviewRequired || acceptedSourceReady
  const blocked = characterAiComposerBlockedReason()
  const regenerate = byId('character-regenerate-action')
  const replaceHelp = byId('character-replace-help')
  if (regenerate) {
    regenerate.hidden = !replacementReady
    regenerate.disabled = Boolean(blocked) || missingCustomReference || Boolean(state.busy) || !description?.value.trim()
    const described = []
    if (replacementReady && replaceHelp) described.push('character-replace-help')
    if (missingCustomReference) described.push('character-reference-mode-help')
    if (described.length) regenerate.setAttribute('aria-describedby', described.join(' '))
    else regenerate.removeAttribute('aria-describedby')
  }
  if (replaceHelp) replaceHelp.hidden = !replacementReady
  const primary = byId('character-primary-action')
  if (primary && (primary.dataset.action === 'review' || !primary.dataset.action)) {
    primary.disabled = Boolean(blocked) || missingCustomReference || Boolean(state.busy) || !serviceConnectionAvailable
    if (missingCustomReference) {
      primary.setAttribute('aria-describedby', 'character-reference-mode-help character-reference-mode-error')
    } else {
      primary.removeAttribute('aria-describedby')
    }
  }
  const gemini = byId('character-ai-gemini')
  if (gemini) {
    const show = blocked === 'file' || blocked === 'gemini'
    gemini.hidden = !show
    gemini.setAttribute('aria-hidden', String(!show))
    if (show) {
      gemini.textContent = blocked === 'file'
        ? studioT('app.fileModeMessage')
        : studioT('character.geminiEligibility')
    }
  }
  renderCharacterAiModelSelect({ editable })
  syncCharacterAiCombobox('preset', { editable })
  syncCharacterAiCombobox('referenceMode', { editable })
}

function characterAiHasLockedGeminiPreset(providerState) {
  try {
    selectStrictGeminiPreset(providerState)
    return true
  } catch (error) {
    return error?.code === 'gemini_not_ready' ? false : false
  }
}

function characterAiComposerBlockedReason() {
  if (!serviceConnectionAvailable) return 'file'
  const snapshot = studioProviderSnapshot()
  const kind = snapshot?.kind
  if (!kind || kind === 'loading' || kind === 'saving' || kind === 'clearing') return 'loading'
  if (kind !== 'resolved' || !snapshot.provider) return 'gemini'
  return characterAiHasLockedGeminiPreset(snapshot.provider) ? null : 'gemini'
}

function characterAiComposerCanPrepareReview() {
  if (state.busy) return false
  if (state.phase === 'setup') return true
  if (state.phase === 'review_required') return true
  return acceptedProcessingHandoffComplete()
}

function characterAiComposerFailClosedIfBlocked() {
  const blocked = characterAiComposerBlockedReason()
  if (!blocked) return false
  if (blocked === 'file') setActionMessage(studioT('app.fileModeMessage'), 'error')
  else if (blocked === 'gemini') setActionMessage(studioT('character.geminiEligibility'), 'error')
  return true
}

function clearCustomReferenceActionMessage() {
  const node = byId('character-action-message')
  if (!node) return
  const required = studioT('character.customReferenceRequired')
  if (node.textContent === required || node.textContent.includes(required)) setActionMessage('', '')
}

function prepareCharacterAiReviewInput() {
  const drafts = currentCharacterAiDrafts()
  const description = cleanPromptValue(drafts.draftDescription)
  if (!description) {
    setState({
      ...drafts,
      draftConceptError: 'description_required',
      draftSeedError: null,
    })
    setActionMessage(studioT('character.descriptionRequired'), 'error')
    byId('character-description')?.focus()
    return null
  }
  let input
  try {
    input = collectCharacterAiReviewInput()
  } catch (error) {
    const seedInvalid = error?.code === 'seed_invalid'
    const customReferenceRequired = error?.code === 'custom_reference_required'
    setState({
      ...drafts,
      draftDescription: description,
      draftConceptError: null,
      draftSeedError: seedInvalid ? 'seed_invalid' : null,
      draftCustomReferenceError: customReferenceRequired
        ? 'custom_reference_required'
        : drafts.draftCustomReferenceError,
    })
    if (seedInvalid) byId('character-seed')?.focus()
    else if (customReferenceRequired) focusCharacterAiReferenceMode()
    setActionMessage(errorMessage(error), 'error')
    return null
  }
  if (characterAiComposerFailClosedIfBlocked()) return null
  let preset
  try {
    preset = selectStrictGeminiPreset(studioProviderSnapshot().provider)
  } catch {
    setActionMessage(studioT('character.geminiEligibility'), 'error')
    focusCharacterAiCombobox('model')
    return null
  }
  if (input.providerPresetId !== preset.id) {
    setActionMessage(studioT('character.geminiEligibility'), 'error')
    focusCharacterAiCombobox('model')
    return null
  }
  return { drafts, description, input }
}

export function handleCharacterAiComposerSubmit(event) {
  event?.preventDefault?.()
  if (state.busy) return
  if (state.phase === 'setup') {
    void buildReview()
    return
  }
  regenerateFromPrompt()
}

function renderControls(presentation) {
  const setup = state.phase === 'setup'
  const topdown = state.phase === 'topdown'
  renderAiSourceComposer()
  const fixed = byId('character-fixed-profile')
  const topdownButton = byId('character-topdown-profile')
  if (fixed) {
    fixed.disabled = !serviceConnectionAvailable || !(setup || topdown) || Boolean(state.busy)
    fixed.disabled = true
    fixed.classList.toggle('is-active', !topdown)
    fixed.setAttribute('aria-pressed', String(!topdown))
  }
  if (topdownButton) {
    topdownButton.disabled = !serviceConnectionAvailable || !(setup || topdown) || Boolean(state.busy)
    topdownButton.classList.toggle('is-active', topdown)
    topdownButton.setAttribute('aria-pressed', String(topdown))
  }
  const primary = byId('character-primary-action')
  if (primary) {
    primary.dataset.action = presentation.action
    primary.textContent = studioT(presentation.actionKey)
    const missingCustomReference = characterAiUsesCustomReferences() && !characterAiHasCustomReferenceDraft()
    const blocksNewReview = presentation.action === 'review' && missingCustomReference
    const composerBlocked = presentation.action === 'review' && Boolean(characterAiComposerBlockedReason())
    primary.disabled = composerBlocked || blocksNewReview || !serviceConnectionAvailable || Boolean(state.busy) ||
      ['blocked', 'running'].includes(presentation.action) ||
      (presentation.action === 'retry-accepted' && state.busy === 'hydrate') ||
      (presentation.action === 'accept' && (!state.evidenceBody || !evidenceMediaReady()))
    if (blocksNewReview) {
      primary.setAttribute('aria-describedby', 'character-reference-mode-help character-reference-mode-error')
    } else if (presentation.action === 'review') {
      primary.removeAttribute('aria-describedby')
    }
  }
  setHidden('character-reset-action', true)
  setHidden('character-review-evidence', true)
  setHidden('character-accepted-retry', true)
  const preflight = byId('character-accept-preflight')
  if (preflight) {
    if (state.acceptError) preflight.textContent = studioT('character.acceptFailed', { error: state.acceptError })
    else if (state.error) preflight.textContent = studioT('character.evidenceInvalid', { error: state.error })
    else if (state.busy === 'evidence' || (state.evidenceBody && !evidenceMediaReady())) {
      preflight.textContent = studioT('character.evidencePending')
    } else if (state.evidenceBody) preflight.textContent = studioT('character.evidenceVerified')
    else preflight.textContent = studioT('character.acceptNotReady')
  }
}

export function bindAiSharedResult() {
  applyCharacterSourceParameterIsolation()
  const disclosure = byId('character-ai-evidence-disclosure')
  if (disclosure) disclosure.hidden = state.phase !== 'review_required'
  if (acceptedProcessingHandoffComplete()) {
    renderRelease()
    return Promise.resolve()
  }
  if (state.phase === 'review_required' && state.job?.raw_provider_output_url) {
    return bindSharedCharacterResult(createAiReviewResultPresentation(state.job), { owner: 'ai' })
      .then(() => { renderRelease() })
  }
  const current = getSharedCharacterExportPresentation()
  if (
    state.phase === 'accepted'
    && state.busy === 'hydrate'
    && getSharedCharacterResultOwner() === 'ai'
    && current.reviewStatic
    && state.job?.id === state.acceptance?.source_job_id
    && current.sheetUrl === state.job?.raw_provider_output_url
  ) {
    refreshSharedCharacterResultPresentation()
    renderRelease()
    return Promise.resolve()
  }
  if (activeAiProcessingSourceReady()) {
    refreshSharedCharacterResultPresentation()
    renderRelease()
    return Promise.resolve()
  }
  if (state.acceptedResult?.sheetUrl) {
    return bindSharedCharacterResult(
      createAiAcceptedSourceResultPresentation(state.acceptedResult.sheetUrl),
      { owner: 'ai' },
    ).then(() => { renderRelease() })
  }
  clearSharedCharacterResult({ force: true })
  renderRelease()
  return Promise.resolve()
}

function clearAiOwnedMedia() {
  clearArtifactMedia()
  setHidden('character-ai-evidence-disclosure', true)
  setHidden('character-evidence-grid', true)
  setHidden('character-evidence-artifacts', true)
  setHidden('character-release-grid', true)
}

function isLiveAcceptedHydrate(operation, acceptance) {
  return Boolean(
    operation
    && currentOperation(operation.epoch)
    && activeCharacterMode === 'ai'
    && state.phase === 'accepted'
    && state.acceptance?.publication_id === acceptance?.publication_id,
  )
}

async function hydrateAcceptedResult(acceptance, operation) {
  if (!acceptance) return
  if (!operation) operation = beginOperation()
  acceptedHydrateCount += 1
  setStudioCharacterProcessingContext({ active: true, surfaceActive: false })
  try {
    const acceptedResult = await loadAcceptedCharacterResultArtifacts(acceptance, {
      signal: operation.signal,
    })
    if (!isLiveAcceptedHydrate(operation, acceptance)) return
    if (acceptedResult.error || !acceptedCharacterArtifactsReady(acceptedResult)) {
      setState({
        acceptedResult,
        acceptedHydrateError: acceptedResult.error || Object.freeze({
          code: 'accepted_artifact_failed',
          message: 'Accepted files are incomplete',
        }),
        acceptedPresentationReady: false,
        processingSourceReady: false,
        processingSourceError: acceptedResult.error || Object.freeze({
          code: 'accepted_artifact_failed',
          message: 'Accepted files are incomplete',
        }),
        processingSourcePublicationId: null,
        busy: state.busy === 'hydrate' ? null : state.busy,
      })
      return
    }
    state = {
      ...state,
      acceptedResult,
      acceptedHydrateError: null,
      acceptedPresentationReady: false,
      processingSourceReady: false,
      processingSourceError: null,
      processingSourcePublicationId: null,
      busy: 'hydrate',
    }
    const sourceFile = await loadAcceptedRawCharacterSource(
      acceptance,
      state.acceptedBinding,
      { signal: operation.signal },
    )
    if (!isLiveAcceptedHydrate(operation, acceptance)) return
    const adopted = await adoptStudioCharacterProcessingSource(sourceFile, {
      sourceOrigin: 'ai',
      sourceProvenance: Object.freeze({
        publicationId: acceptance.publication_id,
        sourceJobId: acceptance.source_job_id ?? null,
        expectedRawProviderOutputSha256: state.acceptedBinding?.expectedRawProviderOutputSha256 ?? null,
      }),
      signal: operation.signal,
    })
    if (!isLiveAcceptedHydrate(operation, acceptance)) return
    const processingSource = getStudioCharacterProcessingSourceState()
    if (
      !adopted
      || !processingSource.hasSource
      || processingSource.sourceOrigin !== 'ai'
      || processingSource.sourceProvenance?.publicationId !== acceptance.publication_id
    ) {
      const error = new Error('Accepted AI source did not enter shared processing')
      error.code = 'accepted_source_decode_failed'
      throw error
    }
    setStudioCharacterProcessingContext({ active: true, surfaceActive: true })
    setState({
      acceptedResult,
      acceptedHydrateError: null,
      acceptedPresentationReady: true,
      processingSourceReady: true,
      processingSourceError: null,
      processingSourcePublicationId: acceptance.publication_id,
      busy: null,
    })
  } catch (error) {
    if (!isLiveAcceptedHydrate(operation, acceptance)) return
    if (error?.name === 'AbortError') return
    const acceptedHydrateError = {
      code: error?.code || 'accepted_source_failed',
      message: errorMessage(error),
    }
    setStudioCharacterProcessingContext({ active: true, surfaceActive: false })
    setState({
      acceptedResult: state.acceptedResult ?? Object.freeze({
        complete: false,
        animations: null,
        debugReport: null,
        missingQualityUrl: !Object.hasOwn(acceptance || {}, 'debug_report_url'),
        error: acceptedHydrateError,
      }),
      acceptedHydrateError,
      acceptedPresentationReady: false,
      processingSourceReady: false,
      processingSourceError: acceptedHydrateError,
      processingSourcePublicationId: null,
      busy: state.busy === 'hydrate' ? null : state.busy,
    })
  }
}

export function renderStudioCharacter() {
  const root = byId('studio-character-view')
  if (!root) return
  root.dataset.characterMode = activeCharacterMode
  const acceptedReviewHydrating = state.phase === 'accepted'
    && state.busy === 'hydrate'
    && Boolean(state.job?.raw_provider_output_url)
  const activeAiSourceVisible = activeCharacterMode === 'ai'
    && activeAiProcessingSourceReady()
    && !acceptedReviewHydrating
  const aiProcessingReady = activeAiSourceVisible && acceptedProcessingHandoffComplete()
  root.dataset.characterProcessingSource = activeCharacterMode === 'local' || activeAiSourceVisible
    ? 'ready'
    : 'acquiring'
  root.dataset.characterAiFlow = aiProcessingReady ? 'source' : 'acquisition'
  const localWorkspace = byId('character-local-workspace')
  if (localWorkspace) localWorkspace.hidden = false
  for (const [id, mode] of [
    ['character-local-entry', 'local'],
    ['character-ai-entry', 'ai'],
  ]) {
    const button = byId(id)
    const active = activeCharacterMode === mode
    button?.classList.toggle('is-active', active)
    button?.setAttribute('aria-pressed', String(active))
  }
  setStudioCharacterProcessingContext({
    active: true,
    surfaceActive: activeCharacterMode === 'local' || activeAiSourceVisible,
  })
  if (activeCharacterMode === 'local' || aiProcessingReady) {
    if (aiProcessingReady) renderAiSourceComposer({ acceptedSourceReady: true })
    delete root.dataset.characterPhase
    delete root.dataset.characterFailure
    applyCharacterSourceParameterIsolation()
    renderRelease()
    return
  }
  const presentation = deriveCharacterPresentation()
  setText('character-header-crumb', studioT(characterHeaderCrumbKey(state)))
  root.dataset.characterPhase = state.phase
  if (state.failureMode) root.dataset.characterFailure = state.failureMode
  else delete root.dataset.characterFailure
  setText('character-flow-title', studioT('character.aiSourceTitle'))
  setText('character-flow-summary', studioT(presentation.summaryKey))
  setText('character-stage-kicker', studioT(presentation.kickerKey))
  setText('character-stage-title', studioT(presentation.stageTitleKey || presentation.kickerKey))
  setText('character-stage-help', studioT(presentation.stageSummaryKey || presentation.summaryKey))
  setText('character-local-stage-kicker', studioT(presentation.kickerKey))
  setText('character-local-stage-title', studioT(presentation.stageTitleKey || presentation.kickerKey))
  setText('character-local-stage-help', studioT(presentation.stageSummaryKey || presentation.summaryKey))
  const stagePhase = presentationStagePhase(presentation)
  const statusText = presentationTopStatus(presentation)
  setText('character-stage-phase', stagePhase)
  setText('character-local-stage-phase', stagePhase)
  setText('character-top-status', statusText)
  const topStatus = byId('character-top-status')
  if (topStatus) {
    topStatus.dataset.state = (() => {
      if (state.phase === 'accepted') {
        const hydration = acceptedHydrationKind()
        if (hydration === 'error') return 'error'
        if (hydration === 'pending') return 'loading'
        return 'ready'
      }
      if (state.failureMode || state.error || state.acceptError || state.phase === 'topdown') return 'error'
      if (state.busy || state.phase === 'running') return 'loading'
      if (state.phase === 'review_required') return 'ready'
      return 'idle'
    })()
    topStatus.setAttribute(
      'aria-busy',
      String(
        state.phase === 'accepted'
          ? acceptedHydrationKind() === 'pending'
          : Boolean(state.busy) || (state.phase === 'running' && !state.failureMode),
      ),
    )
  }

  const flowBadge = byId('character-flow-badge')?.querySelector('span')
  if (flowBadge) flowBadge.textContent = stagePhase
  setHidden('character-placeholder', true)
  setHidden('character-blocking-grid', state.phase !== 'topdown')
  renderReviewBinding()
  renderEvidence()
  renderRelease()
  renderPipeline()
  renderFigmaStateBindings()
  renderControls(presentation)
  renderAiBudget(presentation)
  bindAiSharedResult()
  if (state.error) setActionMessage(state.error, 'error')
  else if (state.busy === 'review') setActionMessage(studioT('character.reviewBuilding'), 'loading')
  else if (state.phase === 'confirm') setActionMessage(studioT('character.reviewReady'), 'ready')
  else if (state.busy === 'confirm') setActionMessage(studioT('character.confirming'), 'loading')
  else if (state.busy === 'accept') setActionMessage(studioT('character.accepting'), 'loading')
  else setActionMessage('')
}

export function renderStudioCharacterLanguage() {
  const language = getCurrentLanguage() === 'en' ? 'en' : 'zh'
  translateStudioDocument(document, language)
  document.querySelectorAll('[data-character-language]').forEach((button) => {
    const active = button.dataset.characterLanguage === language
    button.classList.toggle('is-current', active)
    button.setAttribute('aria-pressed', String(active))
  })
  if (!byId('studio-character-view')?.hidden) {
    document.title = language === 'en' ? 'MoteWeave · Character Studio' : 'MoteWeave · 角色工作室'
  }
  renderStudioCharacter()
  renderStudioCharacterLocalLanguage()
}

function setState(patch) {
  const previousPhase = state.phase
  state = { ...state, ...patch }
  renderStudioCharacter()
  if (state.phase !== previousPhase && ['setup', 'confirm', 'review_required', 'accepted', 'topdown'].includes(state.phase)) {
    const focusTargetId = ['setup', 'confirm'].includes(state.phase)
      ? 'character-flow-title'
      : 'character-workspace-title'
    queueMicrotask(() => byId(focusTargetId)?.focus({ preventScroll: true }))
  }
}

async function buildReview() {
  if (!serviceConnectionAvailable) {
    setActionMessage(studioT('app.fileModeMessage'), 'error')
    return
  }
  const prepared = prepareCharacterAiReviewInput()
  if (!prepared) return
  await startPreparedCharacterAiReview(prepared)
}

async function startPreparedCharacterAiReview({ drafts, description, input }) {
  const operation = beginOperation()
  setState({
    busy: 'review',
    ...drafts,
    draftDescription: description,
    draftConceptError: null,
    draftSeedError: null,
    acceptError: null,
    error: null,
  })
  try {
    const review = await requestStrictFixedRegionReview(input, { signal: operation.signal })
    if (!currentOperation(operation.epoch)) return
    setState({
      phase: 'confirm',
      busy: null,
      review,
      ...drafts,
      draftDescription: description,
      sealedDescription: description,
      reviewConsumed: false,
      acceptError: null,
      error: null,
    })
  } catch (error) {
    if (!currentOperation(operation.epoch) || error?.name === 'AbortError') return
    setState({ phase: 'setup', busy: null, ...drafts, draftDescription: description, error: errorMessage(error) })
  }
}

function updateRunningJob(job, epoch) {
  if (!currentOperation(epoch)) return
  state = { ...state, phase: 'running', job, error: null }
  renderStudioCharacter()
}

async function enterReviewRequired(job, operation) {
  setState({
    phase: 'running',
    busy: 'evidence',
    job,
    evidenceBody: null,
    verifiedArtifacts: [],
    evidenceMediaStatus: {},
    failureMode: null,
    acceptError: null,
    error: null,
  })
  try {
    const prepared = await prepareStrictManualAcceptanceEvidence({
      job,
      review: state.review,
      humanReviewedIssueCount: 0,
    }, { signal: operation.signal })
    if (!currentOperation(operation.epoch)) return
    setState({
      phase: 'review_required',
      busy: null,
      evidenceBody: prepared.acceptanceBody,
      verifiedArtifacts: prepared.verifiedArtifacts,
      evidenceMediaStatus: Object.fromEntries(EVIDENCE_MEDIA.map(([, field]) => [field, 'pending'])),
      failureMode: null,
      acceptError: null,
      error: null,
    })
  } catch (error) {
    if (!currentOperation(operation.epoch) || error?.name === 'AbortError') return
    setState({
      phase: 'review_required',
      busy: null,
      evidenceBody: null,
      verifiedArtifacts: [],
      evidenceMediaStatus: {},
      failureMode: 'evidence',
      acceptError: null,
      error: errorMessage(error),
    })
  }
}

async function observeGenerationJob(initialJob, operation) {
  updateRunningJob(initialJob, operation.epoch)
  const terminalJob = await pollStrictGenerationJob(initialJob, {
    signal: operation.signal,
    onUpdate: (job) => updateRunningJob(job, operation.epoch),
  })
  if (!currentOperation(operation.epoch)) return
  const outcome = mapStrictJobStatus(terminalJob).outcome
  if (outcome === 'done') {
    await enterReviewRequired(terminalJob, operation)
    return
  }
  setState({
    phase: 'running',
    busy: null,
    job: terminalJob,
    failureMode: 'terminal',
    error: errorMessage(terminalJob.reason || terminalJob.failure_status || outcome),
  })
}

async function confirmGeneration() {
  if (!state.review || state.reviewConsumed) return
  const operation = beginOperation()
  setState({ phase: 'running', busy: 'confirm', reviewConsumed: true, job: null, failureMode: null, acceptError: null, error: null })
  try {
    const initialJob = await startStrictLiveGeneration(state.review, { signal: operation.signal })
    if (!currentOperation(operation.epoch)) return
    setState({ busy: null, job: initialJob })
    await observeGenerationJob(initialJob, operation)
  } catch (error) {
    if (!currentOperation(operation.epoch) || error?.name === 'AbortError') return
    const mapped = state.job ? mapStrictJobStatus(state.job) : null
    setState({
      phase: 'running',
      busy: null,
      failureMode: state.job && !mapped.terminal ? 'poll_interrupted' : state.job ? 'terminal' : 'submission_unknown',
      error: errorMessage(error),
    })
  }
}

async function resumeGenerationObservation() {
  if (state.failureMode !== 'poll_interrupted' || !state.job) return
  const operation = beginOperation()
  setState({ phase: 'running', busy: 'observe', failureMode: null, acceptError: null, error: null })
  try {
    await observeGenerationJob(state.job, operation)
  } catch (error) {
    if (!currentOperation(operation.epoch) || error?.name === 'AbortError') return
    setState({ phase: 'running', busy: null, failureMode: 'poll_interrupted', error: errorMessage(error) })
  }
}

async function recheckEvidence() {
  if (state.failureMode !== 'evidence' || !state.job || !state.review) return
  const operation = beginOperation()
  await enterReviewRequired(state.job, operation)
}

async function acceptGeneration() {
  if (!state.evidenceBody || !state.job) return
  let humanReviewedIssueCount
  try {
    humanReviewedIssueCount = issueCountFromControl()
  } catch (error) {
    const issueControl = byId('character-issue-count')
    issueControl?.setAttribute('aria-invalid', 'true')
    setActionMessage(errorMessage(error), 'error')
    issueControl?.focus()
    return
  }
  byId('character-issue-count')?.removeAttribute('aria-invalid')
  const operation = beginOperation()
  const body = { ...state.evidenceBody, humanReviewedIssueCount }
  setState({ busy: 'accept', acceptError: null, error: null })
  try {
    const acceptance = await postStrictManualAcceptance(state.job.id, body, { signal: operation.signal })
    if (!currentOperation(operation.epoch)) return
    cacheAcceptedPublication({
      publicationId: acceptance.publication_id,
      sourceJobId: state.job.id,
      body,
      response: acceptance,
    })
    selectAcceptedPublicationInUrl(acceptance.publication_id)
    setState({
      phase: 'accepted',
      busy: 'hydrate',
      pendingSelector: null,
      acceptance,
      acceptedBinding: body,
      acceptedResult: null,
      acceptedHydrateError: null,
      acceptedPresentationReady: false,
      processingSourceReady: false,
      processingSourceError: null,
      processingSourcePublicationId: null,
      failureMode: null,
      acceptError: null,
      error: null,
    })
    void hydrateAcceptedResult(acceptance, operation)
  } catch (error) {
    if (!currentOperation(operation.epoch) || error?.name === 'AbortError') return
    if (acceptFailureRequiresEvidenceRecheck(error)) {
      setState({
        phase: 'review_required',
        busy: null,
        evidenceBody: null,
        verifiedArtifacts: state.verifiedArtifacts,
        evidenceMediaStatus: state.evidenceMediaStatus,
        failureMode: 'evidence',
        acceptError: null,
        error: errorMessage(error),
      })
      return
    }
    setState({ phase: 'review_required', busy: null, acceptError: errorMessage(error), error: null })
  }
}

async function restoreAcceptedPublicationFromQuery() {
  const publicationId = acceptedPublicationFromQuery()
  if (!serviceConnectionAvailable || !publicationId || state.phase !== 'setup') return
  const cached = readAcceptedPublicationCache(publicationId)
  if (cached) {
    const operation = beginOperation()
    setState({
      ...createInitialCharacterState(),
      phase: 'accepted',
      busy: 'hydrate',
      acceptance: cached.response,
      acceptedBinding: cached.body,
    })
    void hydrateAcceptedResult(cached.response, operation)
    return
  }
  const operation = beginOperation()
  setState({ busy: 'restore', acceptError: null, error: null })
  try {
    const restored = await replayStrictAcceptedPublication(publicationId, {
      signal: operation.signal,
    })
    if (!currentOperation(operation.epoch) || state.phase !== 'setup') return
    cacheAcceptedPublication(restored)
    setState({
      ...createInitialCharacterState(),
      phase: 'accepted',
      busy: 'hydrate',
      acceptance: restored.response,
      acceptedBinding: restored.body,
    })
    void hydrateAcceptedResult(restored.response, operation)
  } catch (error) {
    if (!currentOperation(operation.epoch) || error?.name === 'AbortError') return
    setState({
      ...createInitialCharacterState(),
      phase: 'review_required',
      failureMode: 'evidence',
      error: errorMessage(error),
    })
  }
}

async function restorePendingGenerationFromQuery() {
  const selector = state.pendingSelector || pendingGenerationFromQuery()
  const canRestore = state.phase === 'setup' || (
    state.phase === 'running' && state.failureMode === 'restore_interrupted'
  )
  if (!serviceConnectionAvailable || !selector || !canRestore) return
  const operation = beginOperation()
  setState({
    ...createInitialCharacterState(),
    phase: 'running',
    busy: 'restore',
    pendingSelector: selector,
    failureMode: 'restore_loading',
  })
  try {
    const restored = await restoreStrictReviewRequiredGeneration(selector, {
      signal: operation.signal,
    })
    if (!currentOperation(operation.epoch) || state.failureMode !== 'restore_loading') return
    state = {
      ...createInitialCharacterState(),
      pendingSelector: selector,
      review: restored.review,
      draftDescription: restored.sealedDescription,
      sealedDescription: restored.sealedDescription,
      reviewConsumed: true,
      job: restored.job,
    }
    await enterReviewRequired(restored.job, operation)
  } catch (error) {
    if (!currentOperation(operation.epoch) || error?.name === 'AbortError') return
    setState({
      ...createInitialCharacterState(),
      phase: 'running',
      pendingSelector: selector,
      failureMode: isRecoverableStrictPendingRestoreError(error)
        ? 'restore_interrupted'
        : 'restore_failed',
      error: errorMessage(error),
    })
  }
}

function resetToReview() {
  const drafts = currentCharacterAiDrafts()
  const keepAcceptedVisual = (state.phase === 'accepted' || acceptedProcessingHandoffComplete())
    ? {
        acceptance: state.acceptance,
        acceptedResult: state.acceptedResult,
        acceptedBinding: state.acceptedBinding,
        acceptedPresentationReady: state.acceptedPresentationReady,
      }
    : {}
  activeController?.abort()
  operationEpoch += 1
  clearPendingGenerationInUrl()
  setState({ ...createInitialCharacterState(), ...drafts, ...keepAcceptedVisual })
}

function regenerateFromPrompt() {
  const canPrepareReplacement = state.phase === 'review_required'
    || acceptedProcessingHandoffComplete()
  if (!canPrepareReplacement || state.busy) return
  const prepared = prepareCharacterAiReviewInput()
  if (!prepared) return
  resetToReview()
  void startPreparedCharacterAiReview(prepared)
}

function showTopdownBlocked() {
  if (state.phase !== 'setup') return
  setState({ ...createInitialCharacterState(), ...currentCharacterAiDrafts(), phase: 'topdown' })
}

function showFixedSetup() {
  if (state.phase !== 'topdown') return
  setState({ ...createInitialCharacterState(), ...currentCharacterAiDrafts() })
}

function showCharacterMode(mode) {
  if (!['local', 'ai'].includes(mode) || activeCharacterMode === mode) return
  closeAllCharacterAiComboboxes()
  const sharedProcessingReady = activeAiProcessingSourceReady()
  if (!sharedProcessingReady) clearSharedCharacterResult({ force: true })
  if (state.phase === 'accepted' && state.busy === 'hydrate') {
    activeController?.abort()
    operationEpoch += 1
    state = {
      ...state,
      busy: null,
      acceptedPresentationReady: false,
      processingSourceReady: false,
      processingSourceError: null,
      processingSourcePublicationId: null,
    }
  }
  applyCharacterSourceParameterIsolation(mode)
  const root = byId('studio-character-view')
  if (mode === 'local') {
    if (root) {
      delete root.dataset.characterPhase
      delete root.dataset.characterFailure
    }
    clearAiOwnedMedia()
  }
  activeCharacterMode = mode
  if (mode === 'ai') resumeAcceptedHydrateIfNeeded()
  renderStudioCharacter()
  queueMicrotask(() => {
    const headingId = mode === 'local'
      ? 'character-local-source-title'
      : sharedProcessingReady || ['setup', 'confirm'].includes(state.phase)
        ? 'character-flow-title'
        : 'character-workspace-title'
    const heading = byId(headingId)
    heading?.focus({ preventScroll: true })
  })
}

function resumeAcceptedHydrateIfNeeded() {
  if (
    activeCharacterMode !== 'ai'
    || state.phase !== 'accepted'
    || !state.acceptance
    || state.busy === 'hydrate'
    || acceptedProcessingHandoffComplete()
    || state.acceptedHydrateError
    || state.acceptedResult?.error
  ) return
  const operation = beginOperation()
  state = {
    ...state,
    busy: 'hydrate',
    acceptedPresentationReady: false,
  }
  void hydrateAcceptedResult(state.acceptance, operation)
}

export function seedStudioCharacterStateForTest(patch = {}) {
  activeController?.abort()
  activeController = null
  operationEpoch += 1
  characterAiReferenceEpoch.reference += 1
  characterAiReferenceEpoch.palette += 1
  revokeCharacterAiReviewImage(state.draftReferenceImage)
  revokeCharacterAiReviewImage(state.draftPaletteImage)
  activeCharacterMode = patch.mode || 'ai'
  state = { ...createInitialCharacterState(), ...patch }
  delete state.mode
  renderStudioCharacter()
}

export function inspectStudioCharacterAiComposer() {
  return Object.freeze({
    phase: state.phase,
    busy: state.busy,
    draftDescription: state.draftDescription,
    draftCharacterPreset: state.draftCharacterPreset,
    draftSeed: state.draftSeed,
    draftReferenceMode: compatibleCharacterAiReferenceMode(state.draftReferenceMode),
    refsHidden: Boolean(byId('character-ai-refs')?.hidden),
    modelValue: byId('character-model')?.value ?? '',
    modelDisabled: Boolean(byId('character-model')?.disabled),
    modelOptions: readSelectOptions(byId('character-model')),
    draftReferenceName: state.draftReferenceImage?.name ?? null,
    draftPaletteName: state.draftPaletteImage?.name ?? null,
    draftReferenceSize: state.draftReferenceImage?.size ?? null,
    draftPaletteSize: state.draftPaletteImage?.size ?? null,
    draftReferenceObjectUrl: state.draftReferenceImage?.objectUrl ?? null,
    draftPaletteObjectUrl: state.draftPaletteImage?.objectUrl ?? null,
    draftReferenceError: state.draftReferenceError,
    draftPaletteError: state.draftPaletteError,
    draftConceptError: state.draftConceptError,
    draftSeedError: state.draftSeedError,
    draftCustomReferenceError: state.draftCustomReferenceError,
    actionMessage: byId('character-action-message')?.textContent ?? '',
    primaryAction: byId('character-primary-action')?.dataset?.action ?? '',
    primaryDisabled: Boolean(byId('character-primary-action')?.disabled),
    hasReview: Boolean(state.review),
    hasEvidenceBody: Boolean(state.evidenceBody),
    pendingSelector: state.pendingSelector,
    rawProviderOutputUrl: state.job?.raw_provider_output_url ?? null,
    modelTriggerExpanded: byId('character-model-trigger')?.getAttribute('aria-expanded') === 'true',
    modelTriggerRole: byId('character-model-trigger')?.getAttribute('role') || '',
    modelTriggerDisabled: byId('character-model-trigger')?.getAttribute('aria-disabled') === 'true',
    modelActiveDescendant: byId('character-model-trigger')?.getAttribute('aria-activedescendant') || '',
    modelListHidden: Boolean(byId('character-model-list')?.hidden),
    modelTriggerValue: byId('character-model-value')?.textContent || '',
    presetTriggerExpanded: byId('character-preset-trigger')?.getAttribute('aria-expanded') === 'true',
    presetTriggerRole: byId('character-preset-trigger')?.getAttribute('role') || '',
    presetActiveDescendant: byId('character-preset-trigger')?.getAttribute('aria-activedescendant') || '',
    presetListHidden: Boolean(byId('character-preset-list')?.hidden),
    presetTriggerValue: byId('character-preset-value')?.textContent || '',
    referenceModeTriggerExpanded: byId('character-reference-mode-trigger')?.getAttribute('aria-expanded') === 'true',
    referenceModeTriggerRole: byId('character-reference-mode-trigger')?.getAttribute('role') || '',
    referenceModeActiveDescendant: byId('character-reference-mode-trigger')?.getAttribute('aria-activedescendant') || '',
    referenceModeListHidden: Boolean(byId('character-reference-mode-list')?.hidden),
    referenceModeOptionValues: ['builtin', 'custom'].map((value) => (
      byId(`character-reference-mode-option-${value}`)?.dataset?.value
      || byId(`character-reference-mode-option-${value}`)?.getAttribute?.('data-value')
      || value
    )),
    comboboxCaretPaths: ['character-model-trigger', 'character-preset-trigger', 'character-reference-mode-trigger'].map((id) => (
      byId(id)?.querySelector?.('path')?.getAttribute?.('d') || ''
    )),
    comboboxCarets: ['character-model-trigger', 'character-preset-trigger', 'character-reference-mode-trigger'].map((id) => {
      const trigger = byId(id)
      const path = trigger?.querySelector?.('path')
      const svg = trigger?.querySelector?.('svg')
      return {
        d: path?.getAttribute?.('d') || '',
        stroke: path?.getAttribute?.('stroke') || '',
        strokeWidth: path?.getAttribute?.('stroke-width') || '',
        linecap: path?.getAttribute?.('stroke-linecap') || '',
        linejoin: path?.getAttribute?.('stroke-linejoin') || '',
        width: svg?.getAttribute?.('width') || '',
        height: svg?.getAttribute?.('height') || '',
        transform: svg?.getAttribute?.('transform') || svg?.style?.transform || '',
      }
    }),
    geminiBlock: characterAiComposerBlockedReason(),
  })
}

export function seedStudioCharacterAcceptedForTest({
  acceptance = null,
  acceptedResult = null,
  acceptedHydrateError = null,
  acceptedBinding = null,
  busy = null,
  acceptedPresentationReady = false,
  processingSourceReady = false,
  processingSourceError = null,
  processingSourcePublicationId = null,
} = {}) {
  activeCharacterMode = 'ai'
  state = {
    ...createInitialCharacterState(),
    phase: acceptance ? 'accepted' : 'setup',
    acceptance,
    acceptedResult,
    acceptedHydrateError,
    acceptedBinding,
    busy,
    acceptedPresentationReady: Boolean(acceptedPresentationReady),
    processingSourceReady: Boolean(processingSourceReady),
    processingSourceError,
    processingSourcePublicationId,
  }
}

export function startStudioCharacterAcceptedHydrateForTest(acceptance, {
  acceptedBinding = null,
  reviewJob = null,
} = {}) {
  activeCharacterMode = 'ai'
  const operation = beginOperation()
  state = {
    ...createInitialCharacterState(),
    phase: 'accepted',
    busy: 'hydrate',
    acceptance,
    acceptedBinding,
    job: reviewJob,
  }
  renderStudioCharacter()
  return hydrateAcceptedResult(acceptance, operation)
}

export function switchStudioCharacterSource(mode) {
  showCharacterMode(mode)
}

function retryAcceptedHydrate() {
  if (!state.acceptance || state.busy === 'hydrate' || activeCharacterMode !== 'ai' || state.phase !== 'accepted') return
  const operation = beginOperation()
  setState({
    busy: 'hydrate',
    acceptedResult: null,
    acceptedHydrateError: null,
    acceptedPresentationReady: false,
    processingSourceReady: false,
    processingSourceError: null,
    processingSourcePublicationId: null,
  })
  void hydrateAcceptedResult(state.acceptance, operation)
}

function handlePrimaryAction() {
  const action = byId('character-primary-action')?.dataset.action
  if (state.busy === 'hydrate' && action === 'retry-accepted') return
  if (action === 'review') void buildReview()
  else if (action === 'confirm') void confirmGeneration()
  else if (action === 'accept') void acceptGeneration()
  else if (action === 'observe') void resumeGenerationObservation()
  else if (action === 'restore') void restorePendingGenerationFromQuery()
  else if (action === 'recheck') void recheckEvidence()
  else if (action === 'retry-accepted') retryAcceptedHydrate()
}

function handleEvidenceImageLoad(event) {
  if (state.phase !== 'review_required' || !state.evidenceBody) return
  const field = event.currentTarget?.dataset?.evidenceField
  if (!field || state.evidenceMediaStatus[field] === 'loaded') return
  setState({
    evidenceMediaStatus: { ...state.evidenceMediaStatus, [field]: 'loaded' },
  })
}

function handleEvidenceImageError(event) {
  if (state.phase !== 'review_required' || !state.evidenceBody) return
  const image = event.currentTarget
  const field = image?.dataset?.evidenceField
  image?.removeAttribute('src')
  if (image) image.hidden = true
  setState({
    phase: 'review_required',
    evidenceBody: null,
    verifiedArtifacts: state.verifiedArtifacts,
    evidenceMediaStatus: field
      ? { ...state.evidenceMediaStatus, [field]: 'failed' }
      : { ...state.evidenceMediaStatus },
    failureMode: 'evidence',
    acceptError: null,
    error: studioT('character.evidenceImageFailed'),
  })
}

function bindCharacterChrome() {
  const doc = globalThis.document ?? null
  if (boundCharacterDocument === doc) return
  boundCharacterDocument = doc
  byId('character-local-entry')?.addEventListener('click', () => showCharacterMode('local'))
  byId('character-ai-entry')?.addEventListener('click', () => showCharacterMode('ai'))
  byId('character-primary-action')?.addEventListener('click', handlePrimaryAction)
  byId('character-regenerate-action')?.addEventListener('click', regenerateFromPrompt)
  byId('character-accepted-retry')?.addEventListener('click', retryAcceptedHydrate)
  byId('character-reset-action')?.addEventListener('click', resetToReview)
  byId('character-fixed-profile')?.addEventListener('click', showFixedSetup)
  byId('character-topdown-profile')?.addEventListener('click', showTopdownBlocked)
  byId('character-ai-form')?.addEventListener('submit', handleCharacterAiComposerSubmit)
  const syncDraft = (event) => {
    const target = event.currentTarget
    const drafts = currentCharacterAiDrafts()
    const patch = { ...drafts }
    if (target?.id === 'character-description' && String(target.value || '').trim()) {
      patch.draftConceptError = null
    }
    if (target?.id === 'character-seed' && (String(target.value || '').trim() === '' || Number.isInteger(Number(target.value)))) {
      patch.draftSeedError = null
    }
    if (target?.id === 'character-reference-mode') {
      const nextMode = compatibleCharacterAiReferenceMode(target.value)
      if (nextMode !== CHARACTER_AI_REFERENCE_MODE_CUSTOM) {
        patch.draftCustomReferenceError = null
        clearCustomReferenceActionMessage()
      } else {
        patch.draftCustomReferenceError = characterAiHasCustomReferenceDraft()
          ? null
          : state.draftCustomReferenceError
      }
    }
    state = { ...state, ...patch }
    renderAiSourceComposer({
      acceptedSourceReady: state.phase === 'review_required' || acceptedProcessingHandoffComplete() || Boolean(state.acceptedResult),
    })
  }
  byId('character-description')?.addEventListener('input', syncDraft)
  byId('character-preset')?.addEventListener('change', syncDraft)
  byId('character-model')?.addEventListener('change', syncDraft)
  byId('character-reference-mode')?.addEventListener('change', syncDraft)
  bindCharacterComboboxKinds(CHARACTER_AI_COMBOBOX_KINDS, {
    invalidOf: characterAiComboboxInvalid,
    normalizeOf: characterAiComboboxNormalize,
  })
  byId('character-seed')?.addEventListener('input', syncDraft)
  for (const kind of CHARACTER_AI_REFERENCE_KINDS) {
    byId(`character-${kind}-file`)?.addEventListener('change', (event) => {
      const input = event.currentTarget
      const file = input?.files?.[0] ?? null
      if (input) input.value = ''
      if (file) void assignCharacterAiReference(kind, file)
    })
    byId(`character-${kind}-clear`)?.addEventListener('click', () => clearCharacterAiReference(kind))
  }
  byId('character-issue-count')?.addEventListener('input', (event) => {
    const value = Number(event.currentTarget?.value)
    if (Number.isInteger(value) && value >= 0) event.currentTarget.removeAttribute('aria-invalid')
  })
  for (const [id] of EVIDENCE_MEDIA) {
    byId(id)?.addEventListener('load', handleEvidenceImageLoad)
    byId(id)?.addEventListener('error', handleEvidenceImageError)
  }
}

export function initStudioCharacter({ serviceAvailable = true } = {}) {
  serviceConnectionAvailable = serviceAvailable
  bindCharacterChrome()
  if (initialized) return
  initialized = true
  subscribeStudioProviderSnapshot(() => {
    if (initialized) renderStudioCharacter()
  })
  const acceptedPublication = acceptedPublicationFromQuery()
  const pendingGeneration = pendingGenerationFromQuery()
  activeCharacterMode = acceptedPublication || pendingGeneration ? 'ai' : 'local'
  initStudioCharacterLocal({ serviceAvailable })
  initSharedCharacterResult()
  applyCharacterSourceParameterIsolation()
  document.querySelectorAll('[data-character-language]').forEach((button) => {
    button.addEventListener('click', () => {
      setCurrentLanguage(button.dataset.characterLanguage)
      refreshStudioSettingsLanguage()
      renderStudioCharacterLanguage()
    })
  })
  renderStudioCharacterLanguage()
  if (acceptedPublication) void restoreAcceptedPublicationFromQuery()
  else if (pendingGeneration) void restorePendingGenerationFromQuery()
}
