import { getCurrentLanguage, setCurrentLanguage } from '../i18n.js'
import {
  isRecoverableStrictPendingRestoreError,
  mapStrictJobStatus,
  pollStrictGenerationJob,
  postStrictManualAcceptance,
  prepareStrictManualAcceptanceEvidence,
  parseStrictPendingGenerationSelector,
  replayStrictAcceptedPublication,
  requestStrictFixedRegionReview,
  restoreStrictReviewRequiredGeneration,
  startStrictLiveGeneration,
  STRICT_FIXED_REGION_PROFILE,
  STRICT_V2_URL_FIELDS,
  validateStrictAcceptedPublicationCache,
} from './characterApi.js'
import {
  refreshStudioSettingsLanguage,
  studioT,
  translateStudioDocument,
} from './settingsView.js'
import {
  getStudioLocalCharacterProjectCandidate,
  initStudioCharacterLocal,
  renderStudioCharacterLocal,
  renderStudioCharacterLocalLanguage,
  setStudioCharacterLocalActive,
} from './characterLocalView.js'
import {
  getStudioCompatCharacterProjectCandidate,
  initStudioCharacterCompat,
  renderStudioCharacterCompat,
  renderStudioCharacterCompatLanguage,
  setStudioCharacterCompatActive,
} from './characterCompatView.js'

const REVIEW_LINKS = Object.freeze([
  ['character.reviewLinkReview', 'generation_review_url'],
  ['character.reviewLinkRequest', 'generation_request_manifest_url'],
  ['character.reviewLinkReferences', 'generation_reference_manifest_url'],
  ['character.reviewLinkPrompt', 'generation_prompt_url'],
])

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
let state = createInitialCharacterState()
let operationEpoch = 0
let activeController = null
let serviceConnectionAvailable = true
let activeCharacterMode = 'local'

export function getStudioCharacterProjectCandidate() {
  const localCandidate = getStudioLocalCharacterProjectCandidate()
  const compatCandidate = getStudioCompatCharacterProjectCandidate()
  const acceptance = state?.phase === 'accepted' ? state.acceptance : null
  const strictCandidate = (
    !acceptance ||
    acceptance.status !== 'done' ||
    acceptance.manual_acceptance_status !== 'accepted' ||
    !acceptance.publication_id ||
    !acceptance.zip_url
  )
    ? null
    : Object.freeze({
        kind: 'character',
        jobId: acceptance.publication_id,
        sourceJobId: acceptance.source_job_id ?? null,
        status: 'accepted',
        profile: STRICT_FIXED_REGION_PROFILE.generationProfileId,
        zipUrl: acceptance.zip_url,
      })
  if (activeCharacterMode === 'local') return localCandidate ?? compatCandidate ?? strictCandidate
  if (activeCharacterMode === 'compat') return compatCandidate ?? localCandidate ?? strictCandidate
  return strictCandidate ?? compatCandidate ?? localCandidate
}

function byId(id) {
  return document.getElementById(id)
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

export function createInitialCharacterState() {
  return {
    phase: 'setup',
    busy: null,
    pendingSelector: null,
    review: null,
    reviewConsumed: false,
    job: null,
    evidenceBody: null,
    verifiedArtifacts: [],
    evidenceMediaStatus: {},
    acceptance: null,
    acceptedBinding: null,
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
    return {
      titleKey: 'character.acceptedTitle',
      summaryKey: 'character.acceptedSummary',
      kickerKey: 'character.acceptedKicker',
      stageTitleKey: 'character.acceptedStageTitle',
      stageSummaryKey: 'character.acceptedStageSummary',
      actionKey: 'character.openAccepted',
      action: 'open',
      topStatusKey: 'character.statusAccepted',
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

function authoritativeCallUsage(job) {
  const reported = job?.provider_call_budget?.used_provider_calls
  if (Number.isInteger(reported)) return reported
  return null
}

function setActionMessage(message = '', status = '') {
  const node = byId('character-action-message')
  if (!node) return
  node.textContent = message
  node.dataset.state = status
}

function renderReviewBinding() {
  const review = state.review
  setHidden('character-sealed-binding', !review)
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
    } else if (image.getAttribute('src') !== job[field]) {
      image.src = job[field]
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
  const acceptance = state.phase === 'accepted' ? state.acceptance : null
  setHidden('character-release-grid', !acceptance)
  for (const [id, field] of RELEASE_LINKS) setReleaseLink(id, acceptance?.[field])
  const acceptedImage = byId('character-accepted-image')
  if (acceptedImage) {
    if (acceptance?.normalized_sheet_url) acceptedImage.src = acceptance.normalized_sheet_url
    else acceptedImage.removeAttribute('src')
  }
  const exportLink = byId('character-export-link')
  if (exportLink) {
    const enabled = Boolean(acceptance?.zip_url)
    exportLink.hidden = false
    exportLink.setAttribute('aria-disabled', String(!enabled))
    if (enabled) {
      exportLink.href = acceptance.zip_url
      exportLink.removeAttribute('tabindex')
      exportLink.textContent = studioT('character.export')
    } else {
      exportLink.removeAttribute('href')
      exportLink.tabIndex = -1
      exportLink.textContent = studioT(
        state.phase === 'running'
          ? 'character.exportRunning'
          : state.phase === 'review_required'
            ? 'character.exportReviewRequired'
            : state.phase === 'topdown'
              ? 'character.exportBlocked'
              : 'character.exportLocked',
      )
    }
  }
}

function pipelineState(step) {
  if (state.phase === 'accepted') return 'complete'
  if (state.phase === 'review_required') return 'complete'
  if (state.phase === 'topdown') {
    if (step === 'profile') return 'complete'
    if (step === 'structure') return 'current'
    return 'wait'
  }
  if (state.phase === 'confirm' && step === 'review') return 'current'
  if (state.phase === 'running') {
    if (step === 'raw') return state.job?.raw_provider_output_url ? 'complete' : 'current'
    if (step === 'matte' && state.job?.status === 'post_processing') return 'current'
  }
  return 'wait'
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
    const stepState = pipelineState(item.dataset.pipelineStep)
    item.classList.toggle('is-complete', stepState === 'complete')
    item.classList.toggle('is-current', stepState === 'current')
    const label = item.querySelector('small')
    if (label) {
      label.textContent = stepState === 'complete'
        ? '✓'
        : studioT(stepState === 'current' ? 'character.pipelineCurrent' : 'character.pipelineWait')
    }
  })
  const presentation = deriveCharacterPresentation(state)
  const pipelineStatus = state.phase === 'running' && state.failureMode
    ? presentation.topStatusKey
      ? studioT(presentation.topStatusKey)
      : localizedJobStatus(presentation.statusCode)
    : state.job?.status
    ? localizedJobStatus(state.job.status)
    : state.phase === 'accepted'
      ? studioT('character.statusAccepted')
      : state.phase === 'review_required'
        ? studioT(state.job ? 'character.statusReviewRequired' : 'character.statusReviewRequiredZero')
        : state.phase === 'confirm'
          ? studioT('character.statusReady')
          : state.phase === 'topdown'
            ? studioT('character.statusBlockedPreReview')
            : studioT('character.statusReviewPending')
  setText('character-job-state', pipelineStatus)
  setText('character-running-job-state', pipelineStatus)
  let pipelineDetail
  if (state.phase === 'running' && state.failureMode) {
    pipelineDetail = state.job?.reason
      ? studioT('character.failureDetail', { error: state.job.reason })
      : state.error || studioT('character.unknownError')
  } else if (state.phase === 'running' && state.job?.raw_provider_output_url) {
    pipelineDetail = studioT('character.rawPersisted')
  } else if (state.phase === 'running') {
    const usedCalls = authoritativeCallUsage(state.job)
    pipelineDetail = usedCalls === null
      ? studioT('character.jobCallsUnknown')
      : studioT('character.jobCallsKnown', {
        used: usedCalls,
        status: localizedJobStatus(state.job?.status || 'queued'),
      })
  } else if (state.phase === 'review_required') {
    pipelineDetail = studioT('character.reviewArtifactCount', { count: evidenceCount() })
  } else if (state.phase === 'accepted') {
    pipelineDetail = studioT('character.acceptedPipelineDetail')
  } else if (state.phase === 'topdown') {
    pipelineDetail = studioT('character.topdownPipelineDetail')
  } else {
    pipelineDetail = studioT('character.noProviderYet')
  }
  setText('character-job-detail', pipelineDetail)
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
  renderRunningPhases()
}

function renderControls(presentation) {
  const setup = state.phase === 'setup'
  const topdown = state.phase === 'topdown'
  const editable = serviceConnectionAvailable && setup && !state.busy
  const description = byId('character-description')
  if (description) description.disabled = !editable
  const fixed = byId('character-fixed-profile')
  const topdownButton = byId('character-topdown-profile')
  if (fixed) {
    fixed.disabled = !serviceConnectionAvailable || !(setup || topdown) || Boolean(state.busy)
    fixed.classList.toggle('is-active', !topdown)
    fixed.setAttribute('aria-pressed', String(!topdown))
  }
  if (topdownButton) {
    topdownButton.disabled = !serviceConnectionAvailable || !(setup || topdown) || Boolean(state.busy)
    topdownButton.classList.toggle('is-active', topdown)
    topdownButton.setAttribute('aria-pressed', String(topdown))
  }
  setText('character-profile-value', topdown ? 'full_sheet_topdown_v1' : STRICT_FIXED_REGION_PROFILE.generationProfileId)
  setText('character-layout-value', topdown ? 'topdown_rpg_v0' : 'fixed_region_motion_v0')
  const usedCalls = authoritativeCallUsage(state.job)
  const budgetKey = topdown || ['setup', 'confirm'].includes(state.phase)
    ? 'character.callsNone'
    : ['review_required', 'accepted'].includes(state.phase)
      ? 'character.callsOne'
      : usedCalls === null
        ? 'character.callsUnknown'
        : usedCalls === 1
          ? 'character.callsOne'
          : 'character.callsNone'
  setText('character-budget-value', studioT(budgetKey))
  setText(
    'character-matte-value',
    topdown ? studioT('character.matteNotActivated') : STRICT_FIXED_REGION_PROFILE.backgroundMode,
  )

  const primary = byId('character-primary-action')
  if (primary) {
    primary.dataset.action = presentation.action
    primary.textContent = studioT(presentation.actionKey)
    primary.disabled = !serviceConnectionAvailable || Boolean(state.busy) ||
      ['blocked', 'running'].includes(presentation.action) ||
      (presentation.action === 'accept' && (!state.evidenceBody || !evidenceMediaReady()))
  }
  setHidden('character-reset-action', true)
  setHidden('character-review-evidence', state.phase !== 'review_required')
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

export function renderStudioCharacter() {
  const root = byId('studio-character-view')
  if (!root) return
  root.dataset.characterMode = activeCharacterMode
  const localWorkspace = byId('character-local-workspace')
  const compatWorkspace = byId('character-compat-workspace')
  const aiWorkspace = byId('character-ai-workspace')
  if (localWorkspace) localWorkspace.hidden = activeCharacterMode !== 'local'
  if (compatWorkspace) compatWorkspace.hidden = activeCharacterMode !== 'compat'
  if (aiWorkspace) {
    aiWorkspace.hidden = activeCharacterMode !== 'ai'
    aiWorkspace.inert = activeCharacterMode !== 'ai'
    if (activeCharacterMode !== 'ai') aiWorkspace.setAttribute('aria-hidden', 'true')
    else aiWorkspace.removeAttribute('aria-hidden')
  }
  for (const [id, mode] of [
    ['character-local-entry', 'local'],
    ['character-ai-entry', 'ai'],
    ['character-compat-entry', 'compat'],
  ]) {
    const button = byId(id)
    const active = activeCharacterMode === mode
    button?.classList.toggle('is-active', active)
    button?.setAttribute('aria-pressed', String(active))
  }
  setStudioCharacterLocalActive(activeCharacterMode === 'local')
  setStudioCharacterCompatActive(activeCharacterMode === 'compat')
  if (activeCharacterMode === 'local') {
    renderStudioCharacterLocal()
    return
  }
  if (activeCharacterMode === 'compat') {
    root.dataset.characterPhase = 'compat'
    delete root.dataset.characterFailure
    renderStudioCharacterCompat()
    return
  }
  setText('character-header-crumb', studioT('character.headerCrumb'))
  const presentation = deriveCharacterPresentation()
  root.dataset.characterPhase = state.phase
  if (state.failureMode) root.dataset.characterFailure = state.failureMode
  else delete root.dataset.characterFailure
  setText('character-flow-title', studioT(presentation.titleKey))
  setText('character-flow-summary', studioT(presentation.summaryKey))
  setText('character-stage-kicker', studioT(presentation.kickerKey))
  setText('character-stage-title', studioT(presentation.stageTitleKey))
  setText('character-stage-summary', studioT(presentation.stageSummaryKey))
  const stagePhase = presentationStagePhase(presentation)
  const statusText = presentationTopStatus(presentation)
  setText('character-stage-phase', stagePhase)
  setText('character-top-status', statusText)
  const topStatus = byId('character-top-status')
  if (topStatus) {
    topStatus.dataset.state = state.failureMode || state.error || state.acceptError || state.phase === 'topdown'
      ? 'error'
      : state.busy || state.phase === 'running'
        ? 'loading'
        : state.phase === 'accepted' || state.phase === 'review_required'
          ? 'ready'
          : 'idle'
    topStatus.setAttribute(
      'aria-busy',
      String(Boolean(state.busy) || (state.phase === 'running' && !state.failureMode)),
    )
  }

  const flowBadge = byId('character-flow-badge')?.querySelector('span')
  if (flowBadge) flowBadge.textContent = stagePhase
  setHidden('character-placeholder', ['review_required', 'accepted'].includes(state.phase))
  setHidden('character-blocking-grid', state.phase !== 'topdown')
  renderReviewBinding()
  renderEvidence()
  renderRelease()
  renderPipeline()
  renderFigmaStateBindings()
  renderControls(presentation)
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
  renderStudioCharacterLocalLanguage()
  renderStudioCharacterCompatLanguage()
  renderStudioCharacter()
}

function setState(patch) {
  const previousPhase = state.phase
  state = { ...state, ...patch }
  renderStudioCharacter()
  if (state.phase !== previousPhase && ['setup', 'confirm', 'review_required', 'accepted', 'topdown'].includes(state.phase)) {
    queueMicrotask(() => byId('character-flow-title')?.focus({ preventScroll: true }))
  }
}

async function buildReview() {
  if (!serviceConnectionAvailable) {
    setActionMessage(studioT('app.fileModeMessage'), 'error')
    return
  }
  const descriptionControl = byId('character-description')
  const description = descriptionControl?.value.trim() || ''
  if (!description) {
    descriptionControl?.setAttribute('aria-invalid', 'true')
    setActionMessage(studioT('character.descriptionRequired'), 'error')
    descriptionControl?.focus()
    return
  }
  descriptionControl?.removeAttribute('aria-invalid')
  const operation = beginOperation()
  setState({ busy: 'review', acceptError: null, error: null })
  try {
    const review = await requestStrictFixedRegionReview({ description }, { signal: operation.signal })
    if (!currentOperation(operation.epoch)) return
    setState({ phase: 'confirm', busy: null, review, reviewConsumed: false, acceptError: null, error: null })
  } catch (error) {
    if (!currentOperation(operation.epoch) || error?.name === 'AbortError') return
    setState({ phase: 'setup', busy: null, error: errorMessage(error) })
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
      busy: null,
      pendingSelector: null,
      acceptance,
      acceptedBinding: body,
      failureMode: null,
      acceptError: null,
      error: null,
    })
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
    setState({
      ...createInitialCharacterState(),
      phase: 'accepted',
      acceptance: cached.response,
      acceptedBinding: cached.body,
    })
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
      acceptance: restored.response,
      acceptedBinding: restored.body,
    })
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
  activeController?.abort()
  operationEpoch += 1
  setState(createInitialCharacterState())
}

function showTopdownBlocked() {
  if (state.phase !== 'setup') return
  setState({ ...createInitialCharacterState(), phase: 'topdown' })
}

function showFixedSetup() {
  if (state.phase !== 'topdown') return
  setState(createInitialCharacterState())
}

function showCharacterMode(mode) {
  if (!['local', 'ai', 'compat'].includes(mode) || activeCharacterMode === mode) return
  activeCharacterMode = mode
  renderStudioCharacter()
  queueMicrotask(() => {
    const heading = byId(
      mode === 'local'
        ? 'character-local-flow-title'
        : mode === 'compat'
          ? 'character-compat-title'
          : 'character-flow-title',
    )
    heading?.focus({ preventScroll: true })
  })
}

function handlePrimaryAction() {
  const action = byId('character-primary-action')?.dataset.action
  if (action === 'review') void buildReview()
  else if (action === 'confirm') void confirmGeneration()
  else if (action === 'accept') void acceptGeneration()
  else if (action === 'observe') void resumeGenerationObservation()
  else if (action === 'restore') void restorePendingGenerationFromQuery()
  else if (action === 'recheck') void recheckEvidence()
  else if (action === 'open') byId('character-release-pack')?.click()
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

export function initStudioCharacter({ serviceAvailable = true } = {}) {
  if (initialized) return
  initialized = true
  serviceConnectionAvailable = serviceAvailable
  const acceptedPublication = acceptedPublicationFromQuery()
  const pendingGeneration = pendingGenerationFromQuery()
  activeCharacterMode = acceptedPublication || pendingGeneration ? 'ai' : 'local'
  initStudioCharacterLocal({ serviceAvailable })
  initStudioCharacterCompat({ serviceAvailable })
  byId('character-local-entry')?.addEventListener('click', () => showCharacterMode('local'))
  byId('character-ai-entry')?.addEventListener('click', () => showCharacterMode('ai'))
  byId('character-compat-entry')?.addEventListener('click', () => showCharacterMode('compat'))
  byId('character-primary-action')?.addEventListener('click', handlePrimaryAction)
  byId('character-reset-action')?.addEventListener('click', resetToReview)
  byId('character-fixed-profile')?.addEventListener('click', showFixedSetup)
  byId('character-topdown-profile')?.addEventListener('click', showTopdownBlocked)
  byId('character-description')?.addEventListener('input', (event) => {
    if (event.currentTarget?.value.trim()) event.currentTarget.removeAttribute('aria-invalid')
  })
  byId('character-issue-count')?.addEventListener('input', (event) => {
    const value = Number(event.currentTarget?.value)
    if (Number.isInteger(value) && value >= 0) event.currentTarget.removeAttribute('aria-invalid')
  })
  for (const [id] of EVIDENCE_MEDIA) {
    byId(id)?.addEventListener('load', handleEvidenceImageLoad)
    byId(id)?.addEventListener('error', handleEvidenceImageError)
  }
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
