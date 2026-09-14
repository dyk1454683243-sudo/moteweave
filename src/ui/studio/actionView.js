import { TOPDOWN_RPG_V0 } from '../../character-pack/profile.js'
import { getCurrentLanguage, setCurrentLanguage } from '../i18n.js'
import {
  analyzeMotionSource,
  analyzeMotionSourceSet,
  applyMotionSourceSet,
  applyMotionStrip,
  buildMotionStrip,
  cancelMotionSourceJob,
  createMotionOperationId,
  fetchImageArtifact,
  fetchJsonArtifact,
  fetchMotionSourceToolStatus,
  previewMotionFrames,
  releaseMotionSourceUpload,
  releaseMotionSourceUploadOperation,
  uploadMotionSource,
  waitForMotionSourceJob,
} from '../motionSource/api.js'
import {
  assertBoundMotionArtifact,
  assertMotionJobBinding,
  assertMotionJobCompletionArtifacts,
  assertUploadedMotionSourceDescriptor,
  deriveMotionControlAvailability,
  deriveMotionFrameControlAvailability,
  isMotionOperationCurrent,
  isMotionSourceTooLarge,
  motionSourceByteLimit,
} from '../motionSource/binding.js'
import {
  createMotionOptionsModel,
  formatMotionKeyColor,
  parseMotionKeyColor,
  serializeMotionOptions,
  updateMotionOptionsModel,
} from '../motionSource/optionsModel.js'
import {
  isMotionBuildBindingCurrent,
  isMotionPreviewBindingCurrent,
  mapMotionEvidence,
  mapMotionReportOutcome,
  motionApplyCompatibility,
  motionBuildFingerprint,
  motionCandidateFingerprint,
  preservePreviewCandidates,
  restoreAutoFrameSelection,
} from '../motionSource/guidedState.js'
import { studioT, translateStudioDocument } from './settingsView.js'

const ACTION_PHASES = new Set([
  'empty',
  'running',
  'paused',
  'preview',
  'review',
  'blocked',
  'applied',
  'abandon',
  'advanced',
  'source_set',
])

const JOB_FAILURE_STATUSES = new Set([
  'failed_post_processing',
  'failed_model_error',
  'failed_safety_filter',
  'failed_quality_gate',
  'not_found',
])

const ACTION_STATUS_KEYS = Object.freeze({
  idle: 'action.status.idle',
  queued: 'action.status.queued',
  generating: 'action.status.generating',
  post_processing: 'action.status.postProcessing',
  done: 'action.status.done',
  failed_post_processing: 'action.status.failedPostProcessing',
  failed_model_error: 'action.status.failedModelError',
  failed_safety_filter: 'action.status.failedSafetyFilter',
  failed_quality_gate: 'action.status.failedQualityGate',
  not_found: 'action.status.notFound',
  cancelled: 'action.status.cancelled',
  cancelling: 'action.status.cancelling',
  poll_paused: 'action.status.pollPaused',
  complete: 'action.status.complete',
  needs_review: 'action.status.needsReview',
  blocked: 'action.status.blocked',
  running: 'action.status.running',
  waiting: 'action.status.waiting',
  not_run: 'action.status.notRun',
  unavailable: 'action.status.unavailable',
  preview_ready: 'action.status.previewReady',
  review: 'action.status.review',
  advanced: 'action.status.advanced',
  abandon_confirmation: 'action.status.abandonConfirmation',
  source_set: 'action.status.sourceSet',
  applied: 'action.status.applied',
})

const ACTION_RECOVERY_LABEL_KEYS = Object.freeze({
  analysis: 'action.recovery.analysis',
  preview: 'action.recovery.preview',
  build: 'action.recovery.build',
  apply: 'action.recovery.apply',
  set: 'action.recovery.sourceSetAnalyze',
  setApply: 'action.recovery.sourceSetApply',
  adjust: 'action.recovery.adjust',
})

const ACTION_ARTIFACT_FIELDS = Object.freeze([
  ['motion_source_analysis_url', 'action.artifact.analysis'],
  ['frame_preview_index_url', 'action.artifact.previewIndex'],
  ['frame_preview_sheet_url', 'action.artifact.previewSheet'],
  ['motion_source_report_url', 'action.artifact.motionReport'],
  ['motion_contact_sheet_url', 'action.artifact.contactSheet'],
  ['normalized_motion_strip_url', 'action.artifact.normalizedStrip'],
  ['selected_frames_url', 'action.artifact.selectedFrames'],
  ['video_frames_sheet_url', 'action.artifact.videoFramesSheet'],
  ['frames_index_url', 'action.artifact.framesIndex'],
  ['frames_zip_url', 'action.artifact.framesZip'],
  ['apply_motion_strip_report_url', 'action.artifact.applyReport'],
  ['applied_normalized_sheet_url', 'action.artifact.appliedSheet'],
  ['motion_source_set_report_url', 'action.artifact.sourceSetReport'],
  ['identity_consistency_report_url', 'action.artifact.identityReport'],
  ['motion_source_set_apply_report_url', 'action.artifact.setApplyReport'],
])

const GUIDED_ACTION_ARTIFACT_FIELDS = new Set([
  'motion_source_analysis_url',
  'frame_preview_index_url',
  'frame_preview_sheet_url',
  'motion_source_report_url',
  'motion_contact_sheet_url',
  'normalized_motion_strip_url',
  'selected_frames_url',
  'video_frames_sheet_url',
  'frames_index_url',
  'frames_zip_url',
  'apply_motion_strip_report_url',
  'applied_normalized_sheet_url',
])

const SOURCE_SET_ACTION_ARTIFACT_FIELDS = new Set([
  'motion_source_set_report_url',
  'identity_consistency_report_url',
  'motion_source_set_apply_report_url',
  'applied_normalized_sheet_url',
])

const OPTION_FIELDS = Object.freeze({
  action: 'string',
  targetFrameCount: 'number',
  selectionMode: 'string',
  selectionRecipe: 'string',
  loopExpectation: 'string',
  temporalMatte: 'string',
  stride: 'number',
  fps: 'number',
  maxFrames: 'number',
  startSec: 'number',
  endSec: 'nullableNumber',
  backgroundMethod: 'string',
  keyColor: 'keyColor',
  backgroundTolerance: 'number',
  defringe: 'boolean',
  staticOffsetY: 'number',
  pixelGridRecipe: 'string',
  resampleStrategy: 'string',
})

let initialized = false
let actionState = null

function byId(id) {
  return document.getElementById(id)
}

function actionError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details })
}

function isAbortError(error) {
  return error?.name === 'AbortError'
}

function isUncertainTransportError(error) {
  return !isAbortError(error) &&
    !error?.status &&
    !error?.code &&
    (error instanceof TypeError || error instanceof SyntaxError)
}

function exactPhase(value) {
  return ACTION_PHASES.has(value) ? value : 'empty'
}

function setHidden(node, hidden) {
  if (node) node.hidden = Boolean(hidden)
}

function setText(id, value) {
  const node = byId(id)
  if (node) node.textContent = value == null || value === '' ? '—' : String(value)
}

function setStatus(id, text, state = 'idle', busy = false) {
  const node = byId(id)
  if (!node) return
  node.textContent = text
  node.dataset.state = state
  node.setAttribute('aria-busy', String(Boolean(busy)))
}

function rememberLastJob(state, job, flow) {
  const exactFlow = flow === 'sourceSet' ? 'sourceSet' : 'guided'
  if (!state.lastJobByFlow) state.lastJobByFlow = { guided: null, sourceSet: null }
  state.lastJobByFlow[exactFlow] = job ?? null
  state.lastJob = job ?? null
}

function lastJobForFlow(state, flow) {
  const exactFlow = flow === 'sourceSet' ? 'sourceSet' : 'guided'
  const operation = state.activeOperation ?? state.resumableOperation
  if (operation && flowForStoreKey(operation.storeKey) === exactFlow) {
    return operation.lastJob ?? null
  }
  return state.lastJobByFlow?.[exactFlow] ?? null
}

function localizedActionStatus(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  const key = ACTION_STATUS_KEYS[raw]
  if (!key) return raw
  const localized = studioT(key)
  return localized === raw ? raw : `${raw} · ${localized}`
}

function translatedActionStatus(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  const key = ACTION_STATUS_KEYS[raw]
  return key ? studioT(key) : raw
}

function flowForStoreKey(storeKey) {
  return ['set', 'setApply'].includes(storeKey) ? 'sourceSet' : 'guided'
}

export function deriveActionFlow(state = actionState) {
  const operation = state?.activeOperation ?? state?.resumableOperation ?? state?.uiOperation
  if (operation?.storeKey) return flowForStoreKey(operation.storeKey)
  if (state?.phase === 'source_set' || state?.currentFlow === 'sourceSet') return 'sourceSet'
  return 'guided'
}

function clearImage(id) {
  const image = byId(id)
  if (!image) return
  image.removeAttribute('src')
  image.hidden = true
}

function currentOrigin() {
  return globalThis.location?.origin ?? ''
}

export function assertStudioActionArtifactUrl(value, {
  origin = currentOrigin(),
} = {}) {
  if (typeof value !== 'string' || !value.startsWith('/generated/')) {
    throw actionError('motion_artifact_url_invalid', 'Motion artifact URL is not an allowed generated-file path.')
  }
  const parsed = new URL(value, origin || 'http://127.0.0.1')
  if (
    parsed.pathname !== value ||
    parsed.search ||
    parsed.hash ||
    (origin && parsed.origin !== origin)
  ) {
    throw actionError('motion_artifact_url_invalid', 'Motion artifact URL is not same-origin and exact.')
  }
  return value
}

function renderVerifiedImage(id, url) {
  const image = byId(id)
  if (!image) return
  if (!url) {
    clearImage(id)
    return
  }
  const exactUrl = assertStudioActionArtifactUrl(url)
  if (image.getAttribute('src') !== exactUrl) image.src = exactUrl
  image.hidden = false
}

function operationContext(state = actionState) {
  return {
    uiOperation: state?.uiOperation ?? null,
    renderToken: state?.renderToken ?? 0,
    sourceEpoch: state?.sourceEpoch ?? 0,
    sourceFile: state?.sourceFile ?? null,
    sourceDescriptor: state?.sourceDescriptor ?? null,
  }
}

function ownsOperation(state, handle) {
  return Boolean(
    state &&
    handle &&
    state.uiOperation === handle &&
    state.renderToken === handle.renderToken &&
    (handle.bound !== true || state.sourceEpoch === handle.epoch),
  )
}

function serializedOptions(state = actionState) {
  return serializeMotionOptions(state.optionsModel, {
    frameSelection: state.frameSelection,
  })
}

function currentPreviewBinding(state = actionState, options = serializedOptions(state)) {
  if (!state.previewBinding || !state.sourceDescriptor) return false
  return isMotionPreviewBindingCurrent(state.previewBinding, {
    sourceEpoch: state.sourceEpoch,
    sourceIdentity: state.sourceDescriptor.source_identity,
    options,
  })
}

function currentBuildBinding(state = actionState, options = serializedOptions(state)) {
  if (!state.buildBinding || !state.sourceDescriptor) return false
  return isMotionBuildBindingCurrent(state.buildBinding, {
    sourceEpoch: state.sourceEpoch,
    sourceIdentity: state.sourceDescriptor.source_identity,
    options,
  })
}

function evidenceForFlow(state, flow) {
  return state?.evidenceByFlow?.[flow] ?? null
}

function setFlowEvidence(state, flow, evidence) {
  if (!state.evidenceByFlow) {
    state.evidenceByFlow = { guided: null, sourceSet: null }
  }
  state.evidenceByFlow[flow] = evidence ?? null
  state.evidence = evidence ?? null
  return state.evidenceByFlow[flow]
}

function clearFlowEvidence(state, flow) {
  const previous = evidenceForFlow(state, flow)
  if (state.evidenceByFlow) state.evidenceByFlow[flow] = null
  if (state.evidence === previous) state.evidence = null
}

function applyCompatibility(state = actionState, options = serializedOptions(state)) {
  return motionApplyCompatibility({
    action: options.action,
    resampleStrategy: options.output_profile?.resample_strategy,
    editedStripOverride: Boolean(state.stripFile),
    hasLatestBuild: Boolean(state.jobs.build),
    latestBuildCurrent: currentBuildBinding(state, options),
    latestBuildEvidenceStatus: evidenceForFlow(state, 'guided')?.status ?? 'waiting',
    stripFrameCount: !state.stripFile && Number.isInteger(state.jobs.build?.selected_frame_count)
      ? state.jobs.build.selected_frame_count
      : null,
  })
}

export function createInitialActionState({ serviceAvailable = true } = {}) {
  return {
    serviceAvailable: Boolean(serviceAvailable),
    phase: 'empty',
    priorPhase: 'empty',
    currentFlow: 'guided',
    priorFlow: 'guided',
    abandonReturnPhase: null,
    renderToken: 0,
    sourceEpoch: 0,
    sourceFile: null,
    sourceDescriptor: null,
    sourceUploadOperationId: null,
    sheetFile: null,
    stripFile: null,
    manifestFile: null,
    sourceSetStripFiles: [],
    optionsModel: createMotionOptionsModel(),
    toolStatus: null,
    toolError: null,
    uiOperation: null,
    activeOperation: null,
    resumableOperation: null,
    observationController: null,
    lastJob: null,
    lastJobByFlow: { guided: null, sourceSet: null },
    jobs: {},
    reports: {},
    artifacts: {},
    previewCandidates: [],
    frameSelection: [],
    previewBinding: null,
    buildBinding: null,
    evidence: null,
    evidenceByFlow: { guided: null, sourceSet: null },
    blockedOperationKey: null,
    error: null,
    notice: null,
  }
}

export function deriveActionPresentation(state = actionState) {
  const phase = exactPhase(state?.phase)
  const job = state?.activeOperation?.lastJob ?? state?.resumableOperation?.lastJob ?? null
  const status = job?.status ?? state?.activeOperation?.status ?? (
    phase === 'paused' ? 'poll_paused' :
      phase === 'applied' ? 'applied' :
        phase === 'blocked' ? 'blocked' :
          phase === 'review' ? (evidenceForFlow(state, 'guided')?.status ?? 'review') :
            phase === 'preview' ? 'preview_ready' :
              phase === 'advanced' ? 'advanced' :
                phase === 'abandon' ? 'abandon_confirmation' :
                phase === 'source_set' ? 'source_set' : 'idle'
  )
  const titleKey = {
    empty: 'action.phase.emptyTitle',
    running: 'action.phase.runningTitle',
    paused: 'action.phase.pausedTitle',
    preview: 'action.phase.previewTitle',
    review: 'action.phase.reviewTitle',
    blocked: 'action.phase.blockedTitle',
    applied: 'action.phase.appliedTitle',
    abandon: 'action.phase.abandonTitle',
    advanced: 'action.phase.advancedTitle',
    source_set: 'action.phase.sourceSetTitle',
  }[phase]
  const summaryKey = {
    empty: 'action.phase.emptySummary',
    running: 'action.phase.runningSummary',
    paused: 'action.phase.pausedSummary',
    preview: 'action.phase.previewSummary',
    review: 'action.phase.reviewSummary',
    blocked: 'action.phase.blockedSummary',
    applied: 'action.phase.appliedSummary',
    abandon: 'action.phase.abandonSummary',
    advanced: 'action.phase.advancedSummary',
    source_set: 'action.phase.sourceSetSummary',
  }[phase]
  return Object.freeze({ phase, status, titleKey, summaryKey })
}

function actionControls(state = actionState) {
  let options = null
  let candidateFingerprint = null
  let buildFingerprint = null
  let compatibility = { allowed: false, reason: 'latest_build_missing' }
  let previewCurrent = false
  try {
    options = serializedOptions(state)
    candidateFingerprint = motionCandidateFingerprint(options)
    buildFingerprint = motionBuildFingerprint(options)
    previewCurrent = currentPreviewBinding(state, options)
    compatibility = applyCompatibility(state, options)
  } catch (error) {
    options = null
    candidateFingerprint = null
    buildFingerprint = null
    compatibility = { allowed: false, reason: error?.code ?? 'invalid_options' }
  }
  const availability = deriveMotionControlAvailability({
    sourceFile: state.sourceFile,
    uiBusy: Boolean(state.uiOperation) || state.phase === 'abandon',
    frameSelection: state.frameSelection,
    sheetFile: state.sheetFile,
    manifestFile: state.manifestFile,
    sourceSetStripFiles: state.sourceSetStripFiles,
    toolStatus: state.toolStatus,
    options,
    binding: { candidate_fingerprint: candidateFingerprint, build_fingerprint: buildFingerprint },
    previewCurrent,
    previewArtifactError: state.artifacts.previewError,
    applyCompatibility: compatibility,
    frameCandidates: state.previewCandidates,
    activeOperation: state.activeOperation,
    resumableOperation: state.resumableOperation,
    operationContext: operationContext(state),
  })
  if (state.serviceAvailable) return availability
  return Object.freeze({
    facts: availability.facts,
    controls: Object.freeze(Object.fromEntries(
      Object.keys(availability.controls).map((name) => [
        name,
        name === 'navigation',
      ]),
    )),
  })
}

export function deriveActionBlockedRecovery(state, controls = {}) {
  if (
    exactPhase(state?.phase) !== 'blocked' ||
    state?.uiOperation ||
    state?.activeOperation ||
    state?.resumableOperation
  ) return null

  const operationKey = state?.blockedOperationKey
  let action = null
  if (operationKey === 'analysis' && controls.analyze) action = 'analysis'
  else if (operationKey === 'preview' && controls.previewFrames && state?.reports?.analysis) {
    action = 'preview'
  } else if (operationKey === 'build' && controls.guidedBuild) action = 'build'
  else if (operationKey === 'apply' && controls.applyStrip) action = 'apply'
  else if (operationKey === 'apply' && controls.guidedBuild) action = 'build'
  else if (operationKey === 'set' && controls.analyzeSet) action = 'set'
  else if (
    operationKey === 'setApply' &&
    controls.applySet &&
    state?.reports?.set?.can_apply_multi_strip === true
  ) action = 'setApply'
  else action = 'adjust'

  return Object.freeze({ action, labelKey: ACTION_RECOVERY_LABEL_KEYS[action] })
}

function renderSourceMeta(state) {
  const file = state.sourceFile
  const descriptor = state.sourceDescriptor
  setText('studio-action-source-name', file?.name ?? studioT('action.source.none'))
  setText('studio-action-source-size', file ? studioT('action.source.bytes', { count: file.size }) : '—')
  setText('studio-action-source-kind', descriptor?.media_kind ?? file?.type ?? '—')
  setText('studio-action-source-identity', descriptor?.source_identity ?? '—')
  setText('studio-action-upload-id', descriptor?.upload_id ?? '—')
}

function renderSelectedFiles(state) {
  setText('studio-action-sheet-file-name', state.sheetFile?.name ?? studioT('action.chooseFile'))
  setText('studio-action-strip-file-name', state.stripFile?.name ?? studioT('action.chooseFile'))
  setText('studio-action-manifest-file-name', state.manifestFile?.name ?? studioT('action.chooseFile'))
  setText(
    'studio-action-strip-files-name',
    state.sourceSetStripFiles.length
      ? state.sourceSetStripFiles.map((file) => file.name).join(', ')
      : studioT('action.chooseFiles'),
  )
}

function renderJobMeta(state, flow) {
  const operation = state.activeOperation ?? state.resumableOperation
  const job = lastJobForFlow(state, flow)
  setText('studio-action-job-id', job?.id ?? operation?.jobId ?? '—')
  setText('studio-action-operation-id', job?.operation_id ?? operation?.operationId ?? '—')
  setText('studio-action-options-hash', job?.options_hash ?? operation?.optionsHash ?? '—')
  setText(
    'studio-action-job-state',
    localizedActionStatus(job?.status ?? (state.resumableOperation ? 'poll_paused' : '')) || '—',
  )
}

function renderOperationStatus(state, flow) {
  const operation = state.activeOperation ?? state.resumableOperation
  const job = lastJobForFlow(state, flow)
  setText(
    'studio-action-running-title',
    operation
      ? studioT('action.runningOperation', { operation: studioT(operation.labelKey) })
      : studioT('action.runningTitle'),
  )
  setText(
    'studio-action-progress-label',
    job?.status
      ? localizedActionStatus(job.status)
      : state.notice ?? studioT('action.progressWaiting'),
  )
  const progress = byId('studio-action-progress')?.parentElement
  if (progress) progress.dataset.state = state.activeOperation ? 'indeterminate' : 'idle'
}

function renderQualityStatus(state, evidence) {
  const qualityState = state.error
    ? 'blocked'
    : evidence?.status === 'complete'
      ? 'complete'
      : evidence?.status === 'needs_review'
        ? 'needs_review'
        : evidence?.status === 'blocked'
          ? 'blocked'
          : 'waiting'
  const key = qualityState === 'complete'
    ? 'action.contextQualityPass'
    : qualityState === 'needs_review'
      ? 'action.contextQualityNeedsReview'
      : qualityState === 'blocked'
        ? 'action.contextQualityBlocked'
        : 'action.contextQualityWaiting'
  const quality = byId('studio-action-quality-status')
  if (quality) {
    quality.textContent = studioT(key)
    quality.dataset.state = qualityState
  }
}

function renderSourceSetOutcome(state) {
  const report = state.reports.set
  const key = !report
    ? 'action.sourceSetStageHelp'
    : report.can_apply_multi_strip === true
      ? 'action.sourceSetOutcomePass'
      : 'action.sourceSetOutcomeBlocked'
  setText('studio-action-source-set-outcome', studioT(key))
}

function renderToolStatus(state) {
  const values = [
    ['studio-action-ffmpeg-status', state.toolStatus?.ffmpeg],
    ['studio-action-rembg-status', state.toolStatus?.rembg],
  ]
  for (const [id, tool] of values) {
    if (state.toolError) {
      setStatus(id, studioT('action.tool.unknown'), 'error')
    } else if (!state.toolStatus) {
      setStatus(id, studioT('action.tool.checking'), 'loading', true)
    } else {
      setStatus(
        id,
        studioT(tool?.available ? 'action.tool.available' : 'action.tool.unavailable'),
        tool?.available ? 'ready' : 'warning',
      )
    }
  }
}

function renderOptions(state) {
  document.querySelectorAll('[data-action-option]').forEach((control) => {
    const field = control.dataset.actionOption
    if (!Object.hasOwn(OPTION_FIELDS, field)) return
    const value = state.optionsModel[field]
    if (control.type === 'checkbox') control.checked = Boolean(value)
    else if (field === 'keyColor') control.value = formatMotionKeyColor(value)
    else control.value = value == null ? '' : String(value)
  })
  const actionSelect = byId('studio-action-option-action')
  if (actionSelect && !actionSelect.options.length) {
    for (const animation of TOPDOWN_RPG_V0.animations) {
      const option = document.createElement('option')
      option.value = animation.name
      option.textContent = animation.name
      actionSelect.append(option)
    }
    actionSelect.value = state.optionsModel.action
  }
}

function renderFrameSelection(state, availability) {
  const list = byId('studio-action-frame-list')
  if (!list) return
  list.replaceChildren()
  if (!state.frameSelection.length) {
    const empty = document.createElement('li')
    empty.className = 'action-frame-empty'
    empty.textContent = studioT('action.frames.empty')
    list.append(empty)
    return
  }
  state.frameSelection.forEach((frame, index) => {
    const gates = deriveMotionFrameControlAvailability({
      uiBusy: availability.facts.busy,
      index,
      frameCount: state.frameSelection.length,
    })
    const item = document.createElement('li')
    item.dataset.candidateIndex = String(frame.candidate_index)
    const check = document.createElement('input')
    check.type = 'checkbox'
    check.checked = Boolean(frame.selected)
    check.disabled = !gates.toggle
    check.dataset.actionFrame = 'toggle'
    check.dataset.index = String(index)
    check.setAttribute('aria-label', studioT('action.frames.toggle', { index: frame.candidate_index }))
    const copy = document.createElement('span')
    copy.textContent = studioT('action.frames.item', {
      candidate: frame.candidate_index,
      raw: frame.raw_index,
      time: frame.timestamp_ms ?? '—',
    })
    item.append(check, copy)
    for (const [action, labelKey, enabled] of [
      ['up', 'action.frames.up', gates.up],
      ['down', 'action.frames.down', gates.down],
      ['remove', 'action.frames.remove', gates.remove],
    ]) {
      const button = document.createElement('button')
      button.type = 'button'
      button.dataset.actionFrame = action
      button.dataset.index = String(index)
      button.disabled = !enabled
      button.textContent = studioT(labelKey)
      item.append(button)
    }
    list.append(item)
  })
}

function evidenceValue(entry) {
  if (!entry) return studioT('action.evidence.waiting')
  const status = entry.status ?? 'waiting'
  const detail = entry.reason ?? entry.source_kind ?? entry.authority ?? ''
  const localizedStatus = localizedActionStatus(status)
  return detail ? `${localizedStatus} · ${detail}` : localizedStatus
}

function renderEvidence(evidence) {
  for (const [key, id] of [
    ['source', 'studio-action-evidence-source'],
    ['selection', 'studio-action-evidence-selection'],
    ['loop', 'studio-action-evidence-loop'],
    ['cleanup', 'studio-action-evidence-cleanup'],
    ['grid', 'studio-action-evidence-grid'],
    ['binding', 'studio-action-evidence-binding'],
  ]) {
    setText(id, evidenceValue(evidence?.[key]))
  }
  setStatus(
    'studio-action-evidence-status',
    evidence?.status
      ? localizedActionStatus(evidence.status)
      : studioT('action.evidence.waiting'),
    evidence?.status === 'complete' ? 'ready' : evidence?.status === 'blocked' ? 'error' : 'warning',
  )
}

function artifactsForFlow(state, flow) {
  const allowed = flow === 'sourceSet'
    ? SOURCE_SET_ACTION_ARTIFACT_FIELDS
    : GUIDED_ACTION_ARTIFACT_FIELDS
  const artifacts = Object.fromEntries(
    Object.entries(state.artifacts).filter(([field]) => allowed.has(field)),
  )
  delete artifacts.apply_motion_strip_report_url
  delete artifacts.motion_source_set_apply_report_url
  delete artifacts.applied_normalized_sheet_url
  const report = flow === 'sourceSet' ? state.reports.setApply : state.reports.apply
  const job = report ? (flow === 'sourceSet' ? state.jobs.setApply : state.jobs.apply) : null
  if (flow === 'sourceSet' && job?.motion_source_set_apply_report_url) {
    artifacts.motion_source_set_apply_report_url = job.motion_source_set_apply_report_url
  }
  if (flow === 'guided' && job?.apply_motion_strip_report_url) {
    artifacts.apply_motion_strip_report_url = job.apply_motion_strip_report_url
  }
  if (job?.applied_normalized_sheet_url) {
    artifacts.applied_normalized_sheet_url = job.applied_normalized_sheet_url
  }
  return artifacts
}

export function deriveActionAppliedDownloadUrl(state, flow = deriveActionFlow(state)) {
  if (
    exactPhase(state?.phase) !== 'applied' ||
    state?.uiOperation ||
    state?.activeOperation ||
    state?.resumableOperation
  ) return null

  const sourceSet = flow === 'sourceSet'
  const job = sourceSet ? state?.jobs?.setApply : state?.jobs?.apply
  const report = sourceSet ? state?.reports?.setApply : state?.reports?.apply
  if (job?.status !== 'done' || !report) return null
  const outcome = mapMotionReportOutcome({ job, report })
  if (!['complete', 'needs_review'].includes(outcome.status)) return null
  const url = artifactsForFlow(state, sourceSet ? 'sourceSet' : 'guided')
    .applied_normalized_sheet_url
  return url ? assertStudioActionArtifactUrl(url) : null
}

function renderAppliedDownload(state, flow) {
  const link = byId('studio-action-download-applied')
  if (!link) return
  link.removeAttribute('href')
  link.hidden = true
  link.setAttribute('aria-disabled', 'true')
  let url = null
  try {
    url = deriveActionAppliedDownloadUrl(state, flow)
  } catch {
    return
  }
  if (!url) return
  link.setAttribute('href', url)
  link.hidden = false
  link.setAttribute('aria-disabled', 'false')
}

function renderArtifacts(state, flow) {
  const list = byId('studio-action-artifact-list')
  if (!list) return
  list.replaceChildren()
  const artifacts = artifactsForFlow(state, flow)
  for (const [field, labelKey] of ACTION_ARTIFACT_FIELDS) {
    const url = artifacts[field]
    if (!url) continue
    const item = document.createElement('li')
    const link = document.createElement('a')
    link.href = assertStudioActionArtifactUrl(url)
    link.target = '_blank'
    link.rel = 'noopener'
    link.textContent = studioT(labelKey)
    const path = document.createElement('code')
    path.textContent = url
    item.append(link, path)
    list.append(item)
  }
  const empty = !list.children.length
  setHidden(list, empty)
  setHidden(byId('studio-action-artifact-empty'), !empty)
}

function renderButtons(state, availability) {
  const controls = availability.controls
  const mappings = [
    ['studio-action-analyze', controls.analyze],
    ['studio-action-preview', controls.previewFrames && Boolean(state.reports.analysis)],
    ['studio-action-build', controls.guidedBuild],
    ['studio-action-apply', controls.applyStrip],
    ['studio-action-cancel', controls.cancel],
    ['studio-action-resume', controls.resume],
    ['studio-action-source-set-analyze', controls.analyzeSet],
    ['studio-action-source-set-apply', controls.applySet && state.reports.set?.can_apply_multi_strip === true],
    ['studio-action-restore-auto', controls.restoreAuto],
  ]
  for (const [id, enabled] of mappings) {
    const button = byId(id)
    if (button) button.disabled = !enabled
  }
  const recovery = deriveActionBlockedRecovery(state, controls)
  const recoveryButton = byId('studio-action-recover')
  if (recoveryButton) {
    recoveryButton.hidden = !recovery
    recoveryButton.disabled = !recovery
    if (recovery) {
      recoveryButton.dataset.actionRecovery = recovery.action
      recoveryButton.textContent = studioT(recovery.labelKey)
    } else {
      delete recoveryButton.dataset.actionRecovery
    }
  }
  const modeSwitchLocked = Boolean(state.uiOperation) || state.phase === 'abandon'
  for (const id of ['studio-action-advanced-toggle', 'studio-action-source-set-toggle']) {
    const button = byId(id)
    if (button) button.disabled = modeSwitchLocked
  }
  document.querySelectorAll('[data-action-return-guided]').forEach((button) => {
    button.disabled = modeSwitchLocked
  })
  document.querySelectorAll('[data-action-option]').forEach((control) => {
    control.disabled = !controls.requestOptions
  })
  const loop = byId('studio-action-option-loop-expectation')
  if (loop) loop.disabled = !controls.loopExpectation
  const temporalMatte = byId('studio-action-option-temporal-matte')
  if (temporalMatte) temporalMatte.disabled = !controls.temporalMatte
  const source = byId('studio-action-file')
  if (source) source.disabled = !controls.chooseSource
  const sheet = byId('studio-action-sheet-file')
  if (sheet) sheet.disabled = !controls.chooseSheet
  const strip = byId('studio-action-strip-file')
  if (strip) strip.disabled = !controls.chooseSheet
  const manifest = byId('studio-action-manifest-file')
  if (manifest) manifest.disabled = !controls.requestOptions
  const sourceSetStrips = byId('studio-action-strip-files')
  if (sourceSetStrips) sourceSetStrips.disabled = !controls.requestOptions
}

export function renderStudioAction(state = actionState) {
  if (!state) return
  const view = byId('studio-action-view')
  if (!view) return
  const presentation = deriveActionPresentation(state)
  const availability = actionControls(state)
  const sourceSetFlow = deriveActionFlow(state) === 'sourceSet'
  const visibleEvidence = evidenceForFlow(state, sourceSetFlow ? 'sourceSet' : 'guided')
  view.dataset.actionPhase = presentation.phase
  view.dataset.actionStatus = presentation.status
  view.dataset.actionFlow = sourceSetFlow ? 'source_set' : 'guided'
  view.dataset.actionSourceSetStatus = state.reports.set
    ? state.reports.set.can_apply_multi_strip === true ? 'pass' : 'blocked'
    : 'input'
  view.setAttribute('aria-busy', String(Boolean(state.activeOperation)))
  setText('studio-action-phase-title', studioT(presentation.titleKey))
  setText('studio-action-phase-summary', studioT(presentation.summaryKey))
  setStatus(
    'studio-action-status',
    translatedActionStatus(presentation.status),
    state.error ? 'error' : state.activeOperation ? 'loading' : presentation.phase === 'applied' ? 'ready' : 'idle',
    Boolean(state.activeOperation),
  )
  setStatus(
    'studio-action-live-status',
    state.error?.message ?? state.notice ?? studioT(presentation.summaryKey),
    state.error ? 'error' : state.activeOperation ? 'loading' : 'idle',
    Boolean(state.activeOperation),
  )
  const error = byId('studio-action-error')
  if (error) {
    error.textContent = state.error?.message ?? ''
    error.hidden = !state.error
  }
  document.querySelectorAll('[data-action-panel]').forEach((panel) => {
    const phases = String(panel.dataset.actionPanel).split(/\s+/).filter(Boolean)
    const sourceSetSidebar = ['studio-action-apply-inputs', 'studio-action-source-set-panel']
      .includes(panel.id)
    const sourceSetRunning = sourceSetFlow &&
      ['running', 'paused', 'blocked', 'applied'].includes(presentation.phase) &&
      sourceSetSidebar
    panel.hidden = !(phases.includes(presentation.phase) || sourceSetRunning)
  })
  document.querySelectorAll('[data-action-source="guided"]').forEach((panel) => {
    panel.hidden = sourceSetFlow
  })
  renderSourceMeta(state)
  renderSelectedFiles(state)
  const visibleFlow = sourceSetFlow ? 'sourceSet' : 'guided'
  renderJobMeta(state, visibleFlow)
  renderOperationStatus(state, visibleFlow)
  renderToolStatus(state)
  renderOptions(state)
  renderFrameSelection(state, availability)
  renderEvidence(visibleEvidence)
  renderQualityStatus(state, visibleEvidence)
  renderSourceSetOutcome(state)
  renderArtifacts(state, visibleFlow)
  renderAppliedDownload(state, visibleFlow)
  renderButtons(state, availability)
  renderVerifiedImage('studio-action-preview-image', state.artifacts.frame_preview_sheet_url)
  renderVerifiedImage('studio-action-strip-image', state.artifacts.normalized_motion_strip_url)
  renderVerifiedImage('studio-action-contact-image', state.artifacts.motion_contact_sheet_url)
  const appliedArtifacts = artifactsForFlow(state, visibleFlow)
  renderVerifiedImage('studio-action-applied-image', appliedArtifacts.applied_normalized_sheet_url)
}

export function renderStudioActionLanguage() {
  const root = byId('studio-action-view')
  if (!root) return
  translateStudioDocument(root, getCurrentLanguage())
  root.querySelectorAll('[data-action-language]').forEach((button) => {
    const active = button.dataset.actionLanguage === getCurrentLanguage()
    button.classList.toggle('is-current', active)
    button.setAttribute('aria-pressed', String(active))
  })
  if (actionState) renderStudioAction(actionState)
  renderStudioAction()
}

function clearDerivedState(state, { keepSource = true } = {}) {
  state.phase = 'empty'
  state.priorPhase = 'empty'
  state.currentFlow = 'guided'
  state.priorFlow = 'guided'
  state.abandonReturnPhase = null
  state.error = null
  state.notice = null
  state.jobs = {}
  state.reports = {}
  state.artifacts = {}
  state.previewCandidates = []
  state.frameSelection = []
  state.previewBinding = null
  state.buildBinding = null
  state.evidence = null
  state.evidenceByFlow = { guided: null, sourceSet: null }
  state.blockedOperationKey = null
  state.uiOperation = null
  state.activeOperation = null
  state.resumableOperation = null
  state.lastJob = null
  state.lastJobByFlow = { guided: null, sourceSet: null }
  if (!keepSource) {
    state.sourceFile = null
    state.sourceDescriptor = null
    state.sourceUploadOperationId = null
    state.stripFile = null
    const stripInput = byId('studio-action-strip-file')
    if (stripInput) stripInput.value = ''
  }
  for (const id of [
    'studio-action-preview-image',
    'studio-action-strip-image',
    'studio-action-contact-image',
    'studio-action-applied-image',
  ]) clearImage(id)
}

function releasePriorUpload(descriptor, operationId) {
  if (!descriptor && !operationId) return
  const release = operationId
    ? releaseMotionSourceUploadOperation(operationId)
    : releaseMotionSourceUpload(descriptor.upload_id)
  release.catch(() => {})
}

function resetForSourceFile(file) {
  const state = actionState
  const priorDescriptor = state.sourceDescriptor
  const priorOperationId = state.sourceUploadOperationId
  state.observationController?.abort()
  state.renderToken += 1
  state.sourceEpoch += 1
  clearDerivedState(state, { keepSource: false })
  state.sourceFile = file ?? null
  if (file && isMotionSourceTooLarge(file)) {
    state.error = actionError(
      'motion_source_too_large',
      studioT('action.error.tooLarge', { limit: motionSourceByteLimit(file) }),
    )
  }
  releasePriorUpload(priorDescriptor, priorOperationId)
  renderStudioAction(state)
}

async function ensureUploadedSource(handle, signal) {
  const state = actionState
  const file = state.sourceFile
  if (!file) throw actionError('motion_source_required', studioT('action.error.sourceRequired'))
  if (state.sourceDescriptor) return state.sourceDescriptor
  const operationId = state.sourceUploadOperationId ?? createMotionOperationId('motion_upload_op')
  state.sourceUploadOperationId = operationId
  state.notice = studioT('action.notice.uploading')
  renderStudioAction(state)
  const descriptor = await uploadMotionSource(file, { operationId, signal })
  if (!isMotionOperationCurrent(handle, operationContext(state))) {
    releasePriorUpload(descriptor, operationId)
    throw new DOMException('Motion source changed during upload.', 'AbortError')
  }
  assertUploadedMotionSourceDescriptor(descriptor, { file, operationId })
  state.sourceDescriptor = descriptor
  return descriptor
}

function nextHandle(handle, patch = {}) {
  if (!ownsOperation(actionState, handle)) {
    throw new DOMException('Motion operation is no longer current.', 'AbortError')
  }
  const next = Object.freeze({ ...handle, ...patch })
  if (actionState.uiOperation === handle) actionState.uiOperation = next
  if (actionState.activeOperation === handle) actionState.activeOperation = next
  if (actionState.resumableOperation === handle) actionState.resumableOperation = next
  return next
}

function clearArtifactFields(state, fields) {
  for (const field of fields) delete state.artifacts[field]
}

function invalidateOperationAuthority(state, storeKey) {
  if (storeKey === 'analysis') {
    state.jobs.analysis = null
    state.reports.analysis = null
    clearArtifactFields(state, ['motion_source_analysis_url'])
  }
  if (['analysis', 'preview'].includes(storeKey)) {
    state.jobs.preview = null
    state.reports.preview = null
    state.previewCandidates = []
    state.frameSelection = []
    state.previewBinding = null
    clearArtifactFields(state, ['frame_preview_index_url', 'frame_preview_sheet_url'])
  }
  if (['analysis', 'preview', 'build'].includes(storeKey)) {
    state.jobs.build = null
    state.reports.build = null
    state.buildBinding = null
    clearFlowEvidence(state, 'guided')
    clearArtifactFields(state, [
      'motion_source_report_url',
      'motion_contact_sheet_url',
      'normalized_motion_strip_url',
      'selected_frames_url',
      'video_frames_sheet_url',
      'frames_index_url',
      'frames_zip_url',
    ])
  }
  if (['analysis', 'preview', 'build', 'apply'].includes(storeKey)) {
    state.jobs.apply = null
    state.reports.apply = null
    clearArtifactFields(state, ['apply_motion_strip_report_url', 'applied_normalized_sheet_url'])
  }
  if (storeKey === 'set') {
    state.jobs.set = null
    state.reports.set = null
    clearFlowEvidence(state, 'sourceSet')
    clearArtifactFields(state, ['motion_source_set_report_url', 'identity_consistency_report_url'])
  }
  if (['set', 'setApply'].includes(storeKey)) {
    state.jobs.setApply = null
    state.reports.setApply = null
    clearArtifactFields(state, ['motion_source_set_apply_report_url', 'applied_normalized_sheet_url'])
  }
  if (state.lastJob && !Object.values(state.jobs).includes(state.lastJob)) {
    state.lastJob = null
  }
  for (const flow of ['guided', 'sourceSet']) {
    const job = state.lastJobByFlow?.[flow]
    if (job && !Object.values(state.jobs).includes(job)) state.lastJobByFlow[flow] = null
  }
}

function beginOperation({
  kind,
  labelKey,
  storeKey,
  bound,
  starter,
  optionsSnapshot = null,
}) {
  const state = actionState
  if (state.uiOperation) {
    throw actionError('motion_operation_active', studioT('action.error.operationActive'))
  }
  state.lastJob = null
  const handle = Object.freeze({
    kind,
    labelKey,
    storeKey,
    bound,
    starter,
    renderToken: state.renderToken,
    epoch: state.sourceEpoch,
    sourceIdentity: null,
    operationId: bound ? createMotionOperationId(`motion_${storeKey}_op`) : null,
    optionsHash: null,
    jobId: null,
    status: 'queued',
    lastJob: null,
    optionsSnapshot,
    candidateFingerprint: optionsSnapshot ? motionCandidateFingerprint(optionsSnapshot) : null,
    buildFingerprint: storeKey === 'build' && optionsSnapshot
      ? motionBuildFingerprint(optionsSnapshot)
      : null,
  })
  state.uiOperation = handle
  state.activeOperation = handle
  state.resumableOperation = null
  state.currentFlow = flowForStoreKey(storeKey)
  state.observationController = new AbortController()
  state.phase = 'running'
  state.blockedOperationKey = null
  state.error = null
  invalidateOperationAuthority(state, storeKey)
  state.notice = studioT('action.notice.queued')
  renderStudioAction(state)
  return { handle, controller: state.observationController }
}

function finishOperation(handle) {
  const state = actionState
  if (!ownsOperation(state, handle)) return false
  if (state.uiOperation === handle) state.uiOperation = null
  if (state.activeOperation === handle) state.activeOperation = null
  if (state.resumableOperation === handle) state.resumableOperation = null
  state.observationController = null
  return true
}

function pauseOperation(handle, error) {
  const state = actionState
  if (!ownsOperation(state, handle)) return false
  const paused = nextHandle(handle, {
    status: error?.job?.status ?? handle.status,
    lastJob: error?.job ?? handle.lastJob,
  })
  state.uiOperation = paused
  state.activeOperation = null
  state.resumableOperation = paused
  state.observationController = null
  state.phase = 'paused'
  state.blockedOperationKey = null
  state.error = null
  state.notice = error?.code === 'poll_timeout'
    ? studioT('action.notice.pollPaused')
    : studioT('action.notice.transportUnknown')
  renderStudioAction(state)
  return true
}

function failOperation(handle, error) {
  const state = actionState
  if (!ownsOperation(state, handle)) return false
  const lastJob = error?.job ?? handle?.lastJob ?? null
  if (lastJob && handle?.storeKey) state.jobs[handle.storeKey] = lastJob
  if (lastJob && handle?.storeKey) {
    rememberLastJob(state, lastJob, flowForStoreKey(handle.storeKey))
  }
  if (handle?.storeKey) state.currentFlow = flowForStoreKey(handle.storeKey)
  if (handle?.storeKey === 'build') {
    setFlowEvidence(state, 'guided', mapMotionEvidence({
      job: lastJob,
      report: null,
      bindingCurrent: false,
      artifactError: error,
    }))
  }
  finishOperation(handle)
  state.uiOperation = null
  state.resumableOperation = null
  state.phase = 'blocked'
  state.blockedOperationKey = handle?.storeKey ?? null
  state.error = error instanceof Error ? error : new Error(String(error))
  state.notice = null
  renderStudioAction(state)
  return true
}

function bindJob(handle, job) {
  const bound = assertMotionJobBinding(handle, job)
  return nextHandle(handle, { ...bound, status: job.status, lastJob: job })
}

function assertCurrentOperation(handle) {
  if (!isMotionOperationCurrent(handle, operationContext(actionState))) {
    throw new DOMException('Motion operation is no longer current.', 'AbortError')
  }
}

async function observeJob(handle, initialJob, controller, { refreshFirst = false } = {}) {
  let currentHandle = bindJob(handle, initialJob)
  rememberLastJob(actionState, initialJob, flowForStoreKey(currentHandle.storeKey))
  const finalJob = await waitForMotionSourceJob(initialJob, {
    signal: controller.signal,
    refreshFirst,
    onUpdate: (job) => {
      if (!isMotionOperationCurrent(currentHandle, operationContext(actionState))) return
      currentHandle = bindJob(currentHandle, job)
      rememberLastJob(actionState, job, flowForStoreKey(currentHandle.storeKey))
      actionState.notice = studioT('action.notice.jobStatus', {
        status: localizedActionStatus(job.status),
      })
      renderStudioAction(actionState)
    },
  })
  assertCurrentOperation(currentHandle)
  currentHandle = bindJob(currentHandle, finalJob)
  rememberLastJob(actionState, finalJob, flowForStoreKey(currentHandle.storeKey))
  return { handle: currentHandle, job: finalJob }
}

async function fetchBoundJson(handle, url, { signal } = {}) {
  const exactUrl = assertStudioActionArtifactUrl(url)
  const artifact = await fetchJsonArtifact(exactUrl, { signal })
  assertCurrentOperation(handle)
  return assertBoundMotionArtifact(handle, artifact)
}

async function verifyImage(url, { signal } = {}) {
  const exactUrl = assertStudioActionArtifactUrl(url)
  await fetchImageArtifact(exactUrl, { signal })
  return exactUrl
}

function commitJobArtifacts(job) {
  const verified = {}
  for (const [field] of ACTION_ARTIFACT_FIELDS) {
    if (job?.[field]) verified[field] = assertStudioActionArtifactUrl(job[field])
  }
  Object.assign(actionState.artifacts, verified)
}

async function processCompletedJob(handle, job, { signal } = {}) {
  const state = actionState
  assertCurrentOperation(handle)
  state.currentFlow = flowForStoreKey(handle.storeKey)
  state.blockedOperationKey = null
  assertMotionJobCompletionArtifacts(job, handle.storeKey)
  if (handle.storeKey === 'set' && job.identity_consistency_report_url) {
    const reportUrl = assertStudioActionArtifactUrl(job.identity_consistency_report_url)
    const report = await fetchJsonArtifact(reportUrl, { signal })
    assertCurrentOperation(handle)
    commitJobArtifacts(job)
    state.reports.set = report
    state.jobs.set = job
    setFlowEvidence(state, 'sourceSet', mapMotionReportOutcome({ job, report }))
    state.phase = 'source_set'
    state.notice = studioT(
      report?.can_apply_multi_strip === true
        ? 'action.notice.sourceSetReady'
        : 'action.notice.sourceSetBlocked',
    )
    return
  }
  if (JOB_FAILURE_STATUSES.has(job.status) || String(job.status).startsWith('failed_')) {
    throw actionError(
      job.failure_status ?? job.status,
      job.reason ?? studioT('action.error.jobFailed', {
        status: localizedActionStatus(job.status),
      }),
      { job },
    )
  }
  if (job.status !== 'done') {
    throw actionError('motion_job_not_terminal', studioT('action.error.jobNotTerminal'))
  }
  if (handle.storeKey === 'analysis') {
    const report = await fetchBoundJson(handle, job.motion_source_analysis_url, { signal })
    assertCurrentOperation(handle)
    commitJobArtifacts(job)
    state.reports.analysis = report
    state.jobs.analysis = job
    const outcome = mapMotionReportOutcome({ job, report })
    if (outcome.status === 'blocked') {
      setFlowEvidence(state, 'guided', outcome)
      state.phase = 'blocked'
      state.blockedOperationKey = 'analysis'
      return
    }
    state.phase = 'preview'
    state.notice = studioT('action.notice.analysisReady')
    return
  }
  if (handle.storeKey === 'preview') {
    const index = await fetchBoundJson(handle, job.frame_preview_index_url, { signal })
    await verifyImage(job.frame_preview_sheet_url, { signal })
    assertCurrentOperation(handle)
    commitJobArtifacts(job)
    state.reports.preview = index
    state.jobs.preview = job
    state.previewCandidates = [...preservePreviewCandidates(index)]
    state.frameSelection = restoreAutoFrameSelection(state.previewCandidates)
    state.optionsModel = updateMotionOptionsModel(state.optionsModel, {
      selectionMode: index.default_selection_mode === 'manual' ? 'manual' : 'auto',
    })
    state.previewBinding = {
      source_epoch: handle.epoch,
      source_identity: handle.sourceIdentity,
      operation_id: handle.operationId,
      options_hash: handle.optionsHash,
      candidate_fingerprint: handle.candidateFingerprint,
    }
    state.phase = 'preview'
    state.notice = studioT('action.notice.previewReady')
    return
  }
  if (handle.storeKey === 'build') {
    const report = await fetchBoundJson(handle, job.motion_source_report_url, { signal })
    await fetchBoundJson(handle, job.selected_frames_url, { signal })
    await verifyImage(job.normalized_motion_strip_url, { signal })
    if (job.motion_contact_sheet_url) await verifyImage(job.motion_contact_sheet_url, { signal })
    assertCurrentOperation(handle)
    commitJobArtifacts(job)
    state.reports.build = report
    state.jobs.build = job
    state.buildBinding = {
      source_epoch: handle.epoch,
      source_identity: handle.sourceIdentity,
      operation_id: handle.operationId,
      options_hash: handle.optionsHash,
      build_fingerprint: handle.buildFingerprint,
    }
    const evidence = setFlowEvidence(state, 'guided', mapMotionEvidence({
      job,
      report,
      bindingCurrent: true,
    }))
    state.phase = ['complete', 'needs_review'].includes(evidence.status)
      ? 'review'
      : 'blocked'
    if (state.phase === 'blocked') state.blockedOperationKey = 'build'
    state.notice = studioT(
      state.phase === 'review' ? 'action.notice.buildReady' : 'action.notice.buildBlocked',
    )
    return
  }
  if (handle.storeKey === 'apply') {
    const reportUrl = assertStudioActionArtifactUrl(job.apply_motion_strip_report_url)
    const report = await fetchJsonArtifact(reportUrl, { signal })
    await verifyImage(job.applied_normalized_sheet_url, { signal })
    assertCurrentOperation(handle)
    commitJobArtifacts(job)
    state.reports.apply = report
    state.jobs.apply = job
    const outcome = mapMotionReportOutcome({ job, report })
    if (outcome.status === 'blocked') {
      setFlowEvidence(state, 'guided', outcome)
      state.phase = 'blocked'
      state.blockedOperationKey = 'apply'
      state.notice = studioT('action.notice.applyBlocked')
      return
    }
    setFlowEvidence(state, 'guided', outcome)
    state.phase = 'applied'
    state.notice = studioT(
      outcome.status === 'needs_review'
        ? 'action.notice.applyNeedsReview'
        : 'action.notice.applied',
    )
    return
  }
  if (handle.storeKey === 'setApply') {
    const reportUrl = assertStudioActionArtifactUrl(job.motion_source_set_apply_report_url)
    const report = await fetchJsonArtifact(reportUrl, { signal })
    await verifyImage(job.applied_normalized_sheet_url, { signal })
    assertCurrentOperation(handle)
    commitJobArtifacts(job)
    state.reports.setApply = report
    state.jobs.setApply = job
    const outcome = mapMotionReportOutcome({ job, report })
    if (outcome.status === 'blocked') {
      setFlowEvidence(state, 'sourceSet', outcome)
      state.phase = 'blocked'
      state.blockedOperationKey = 'setApply'
      state.notice = studioT('action.notice.applyBlocked')
      return
    }
    setFlowEvidence(state, 'sourceSet', outcome)
    state.phase = 'applied'
    state.notice = studioT(
      outcome.status === 'needs_review'
        ? 'action.notice.applyNeedsReview'
        : 'action.notice.sourceSetApplied',
    )
  }
}

async function runBoundSourceOperation(storeKey, labelKey, starter, optionsSnapshot = null) {
  let operation = null
  try {
    operation = beginOperation({
      kind: 'source',
      labelKey,
      storeKey,
      bound: true,
      starter,
      optionsSnapshot,
    })
    let { handle, controller } = operation
    const descriptor = await ensureUploadedSource(handle, controller.signal)
    if (!isMotionOperationCurrent(handle, operationContext(actionState))) return
    handle = nextHandle(handle, { sourceIdentity: descriptor.source_identity })
    const initialJob = await starter(descriptor, {
      operationId: handle.operationId,
      signal: controller.signal,
    })
    const observed = await observeJob(handle, initialJob, controller)
    await processCompletedJob(observed.handle, observed.job, { signal: controller.signal })
    finishOperation(observed.handle)
    renderStudioAction(actionState)
  } catch (error) {
    const handle = actionState.activeOperation ?? operation?.handle
    if (!handle || !isMotionOperationCurrent(handle, operationContext(actionState))) return
    if (handle.status === 'cancelling') return
    if (
      error?.status === 404 ||
      error?.code === 'source_identity_mismatch' ||
      error?.code === 'upload_not_found'
    ) {
      actionState.sourceDescriptor = null
      actionState.sourceUploadOperationId = null
      failOperation(
        handle,
        actionError('motion_server_session_expired', studioT('action.error.sessionExpired')),
      )
      return
    }
    if (error?.code === 'poll_timeout' || isUncertainTransportError(error)) {
      pauseOperation(handle, error)
    } else if (isAbortError(error)) {
      if (handle.jobId) pauseOperation(handle, error)
      else failOperation(handle, actionError('motion_request_aborted', studioT('action.error.requestAborted')))
    } else {
      failOperation(handle, error)
    }
  }
}

async function runGenericOperation(storeKey, labelKey, starter) {
  let operation = null
  try {
    operation = beginOperation({
      kind: 'generic',
      labelKey,
      storeKey,
      bound: false,
      starter,
    })
    const { controller } = operation
    const initialJob = await starter(controller.signal)
    const observed = await observeJob(operation.handle, initialJob, controller)
    await processCompletedJob(observed.handle, observed.job, { signal: controller.signal })
    finishOperation(observed.handle)
    renderStudioAction(actionState)
  } catch (error) {
    const handle = actionState.activeOperation ?? operation?.handle
    if (!handle || !isMotionOperationCurrent(handle, operationContext(actionState))) return
    if (handle.status === 'cancelling') return
    if (
      handle.jobId &&
      (error?.code === 'poll_timeout' || isUncertainTransportError(error) || isAbortError(error))
    ) {
      pauseOperation(handle, error)
    } else if (isUncertainTransportError(error) || isAbortError(error)) {
      failOperation(
        handle,
        actionError('motion_job_receipt_missing', studioT('action.error.jobReceiptMissing')),
      )
    } else {
      failOperation(handle, error)
    }
  }
}

async function resumeExistingOperation() {
  const state = actionState
  let handle = state.resumableOperation
  if (!handle || !isMotionOperationCurrent(handle, operationContext(state))) return
  state.activeOperation = handle
  state.resumableOperation = null
  state.observationController = new AbortController()
  state.phase = 'running'
  state.blockedOperationKey = null
  state.error = null
  state.notice = studioT('action.notice.resuming')
  renderStudioAction(state)
  try {
    const controller = state.observationController
    let initialJob
    let refreshFirst = false
    if (handle.jobId) {
      initialJob = {
        id: handle.jobId,
        status: handle.status,
        ...(handle.bound ? {
          operation_id: handle.operationId,
          source_identity: handle.sourceIdentity,
          options_hash: handle.optionsHash,
        } : {}),
      }
      refreshFirst = true
    } else {
      if (!handle.bound) {
        throw actionError('motion_job_receipt_missing', studioT('action.error.jobReceiptMissing'))
      }
      const descriptor = await ensureUploadedSource(handle, controller.signal)
      if (handle.sourceIdentity && descriptor.source_identity !== handle.sourceIdentity) {
        throw actionError('motion_source_binding_mismatch', studioT('action.error.sourceChanged'))
      }
      handle = nextHandle(handle, { sourceIdentity: descriptor.source_identity })
      initialJob = await handle.starter(descriptor, {
        operationId: handle.operationId,
        signal: controller.signal,
      })
    }
    const observed = await observeJob(handle, initialJob, controller, { refreshFirst })
    await processCompletedJob(observed.handle, observed.job, { signal: controller.signal })
    finishOperation(observed.handle)
    renderStudioAction(state)
  } catch (error) {
    const current = state.activeOperation ?? handle
    if (!ownsOperation(state, current)) return
    if (current.status === 'cancelling' && isAbortError(error)) return
    if (
      error?.status === 404 ||
      error?.code === 'motion_job_not_found' ||
      error?.code === 'source_identity_mismatch' ||
      error?.code === 'upload_not_found'
    ) {
      if (current.bound) {
        state.sourceDescriptor = null
        state.sourceUploadOperationId = null
      }
      failOperation(current, actionError('motion_server_session_expired', studioT('action.error.sessionExpired')))
    } else if (error?.code === 'poll_timeout' || isUncertainTransportError(error) || isAbortError(error)) {
      pauseOperation(current, error)
    } else {
      failOperation(current, error)
    }
  }
}

async function cancelCurrentOperation() {
  const state = actionState
  let handle = state.activeOperation ?? state.resumableOperation
  if (
    handle?.bound !== true ||
    !handle.jobId ||
    !isMotionOperationCurrent(handle, operationContext(state))
  ) return
  state.observationController?.abort()
  handle = nextHandle(handle, { status: 'cancelling' })
  state.activeOperation = handle
  state.resumableOperation = null
  state.phase = 'running'
  state.blockedOperationKey = null
  state.notice = studioT('action.notice.cancelling')
  renderStudioAction(state)
  try {
    const job = await cancelMotionSourceJob(handle.jobId)
    handle = bindJob(handle, job)
    rememberLastJob(state, job, flowForStoreKey(handle.storeKey))
    if (job.status === 'done') await processCompletedJob(handle, job)
    else {
      state.phase = 'blocked'
      state.blockedOperationKey = handle.storeKey
      state.error = actionError(
        job.failure_status ?? 'cancelled',
        job.reason ?? studioT('action.notice.cancelled'),
      )
    }
    finishOperation(handle)
    renderStudioAction(state)
  } catch (error) {
    if (!ownsOperation(state, handle)) return
    if (error?.status === 404 || error?.code === 'motion_job_not_found') {
      if (handle.bound) {
        state.sourceDescriptor = null
        state.sourceUploadOperationId = null
      }
      failOperation(
        handle,
        actionError('motion_server_session_expired', studioT('action.error.sessionExpired')),
      )
    } else {
      pauseOperation(handle, error)
    }
  }
}

function startAnalysis() {
  return runBoundSourceOperation(
    'analysis',
    'action.operation.analysis',
    (source, request) => analyzeMotionSource(source, request),
  )
}

function startPreview() {
  const options = serializedOptions(actionState)
  return runBoundSourceOperation(
    'preview',
    'action.operation.preview',
    (source, request) => previewMotionFrames(source, options, request),
    options,
  )
}

function startBuild() {
  const options = serializedOptions(actionState)
  if (!currentPreviewBinding(actionState, options)) {
    actionState.currentFlow = 'guided'
    actionState.error = actionError('motion_preview_stale', studioT('action.error.previewStale'))
    actionState.phase = 'blocked'
    actionState.blockedOperationKey = null
    renderStudioAction(actionState)
    return null
  }
  return runBoundSourceOperation(
    'build',
    'action.operation.build',
    (source, request) => buildMotionStrip(source, options, request),
    options,
  )
}

function startApply() {
  const options = serializedOptions(actionState)
  const compatibility = applyCompatibility(actionState, options)
  if (!compatibility.allowed) {
    actionState.currentFlow = 'guided'
    actionState.error = actionError(
      compatibility.reason ?? 'motion_apply_blocked',
      studioT('action.error.applyBlocked', { reason: compatibility.reason ?? 'unknown' }),
    )
    actionState.phase = 'blocked'
    actionState.blockedOperationKey = null
    renderStudioAction(actionState)
    return null
  }
  const payload = {
    sheetFile: actionState.sheetFile,
    stripFile: actionState.stripFile,
    stripUrl: actionState.artifacts.normalized_motion_strip_url,
    options,
  }
  return runGenericOperation(
    'apply',
    'action.operation.apply',
    (signal) => applyMotionStrip(payload, { signal }),
  )
}

function startSourceSetAnalysis() {
  const payload = {
    manifestFile: actionState.manifestFile,
    stripFiles: actionState.sourceSetStripFiles,
  }
  return runGenericOperation(
    'set',
    'action.operation.sourceSetAnalyze',
    (signal) => analyzeMotionSourceSet(payload, { signal }),
  )
}

function startSourceSetApply() {
  if (actionState.reports.set?.can_apply_multi_strip !== true) {
    actionState.currentFlow = 'sourceSet'
    actionState.error = actionError('motion_source_set_blocked', studioT('action.error.sourceSetBlocked'))
    renderStudioAction(actionState)
    return null
  }
  const payload = {
    sheetFile: actionState.sheetFile,
    manifestFile: actionState.manifestFile,
    stripFiles: actionState.sourceSetStripFiles,
    options: serializedOptions(actionState),
  }
  return runGenericOperation(
    'setApply',
    'action.operation.sourceSetApply',
    (signal) => applyMotionSourceSet(payload, { signal }),
  )
}

function recoverBlockedOperation() {
  const state = actionState
  const recovery = deriveActionBlockedRecovery(state, actionControls(state).controls)
  if (!recovery) return

  state.blockedOperationKey = null
  state.error = null
  state.notice = null
  if (recovery.action === 'adjust') {
    const sourceSet = deriveActionFlow(state) === 'sourceSet'
    state.currentFlow = sourceSet ? 'sourceSet' : 'guided'
    state.phase = sourceSet
      ? 'source_set'
      : state.previewCandidates.length ? 'preview' : 'empty'
    renderStudioAction(state)
    byId('studio-action-phase-title')?.focus({ preventScroll: true })
    return
  }

  const starters = {
    analysis: startAnalysis,
    preview: startPreview,
    build: startBuild,
    apply: startApply,
    set: startSourceSetAnalysis,
    setApply: startSourceSetApply,
  }
  const starter = starters[recovery.action]
  if (starter) void starter()
}

function parseOptionValue(field, control) {
  const kind = OPTION_FIELDS[field]
  if (kind === 'boolean') return Boolean(control.checked)
  if (kind === 'number') return Number(control.value)
  if (kind === 'nullableNumber') return control.value === '' ? null : Number(control.value)
  if (kind === 'keyColor') {
    const value = parseMotionKeyColor(control.value)
    if (!value) throw actionError('invalid_motion_key_color', studioT('action.error.keyColor'))
    return value
  }
  return control.value
}

function invalidateOptionDependentState(field) {
  const state = actionState
  const priorApplyAuthority = {
    guided: hasGuidedApplyResultAuthority(state),
    sourceSet: hasSourceSetApplyResultAuthority(state),
  }
  const hadApplyAuthority = priorApplyAuthority.guided || priorApplyAuthority.sourceSet ||
    state.phase === 'applied' || state.priorPhase === 'applied'
  const options = serializedOptions(state)
  const hasPreviewAuthority = Boolean(state.previewBinding || state.jobs.preview)
  const hasBuildAuthority = Boolean(state.buildBinding || state.jobs.build || state.reports.build)
  if (hasPreviewAuthority && !currentPreviewBinding(state, options)) {
    invalidateOperationAuthority(state, 'preview')
  } else if (hasBuildAuthority && !currentBuildBinding(state, options)) {
    invalidateOperationAuthority(state, 'build')
  }
  if (hadApplyAuthority) {
    invalidateApplyResult({
      scope: 'both',
      authorityWasPresent: priorApplyAuthority,
    })
  }
  if (
    !hadApplyAuthority &&
    (state.phase === 'review' || state.phase === 'blocked' || state.phase === 'applied')
  ) {
    state.phase = state.previewCandidates.length ? 'preview' : 'empty'
  }
  if (
    state.phase === 'advanced' &&
    ['review', 'blocked', 'applied'].includes(state.priorPhase)
  ) {
    state.priorPhase = guidedFallbackPhase(state)
  }
  state.notice = studioT('action.notice.optionsChanged')
  state.blockedOperationKey = null
  state.error = null
}

function updateOptionFromControl(control) {
  const field = control.dataset.actionOption
  if (!Object.hasOwn(OPTION_FIELDS, field) || actionState.uiOperation) return
  try {
    const patch = { [field]: parseOptionValue(field, control) }
    if (field === 'action') {
      const animation = TOPDOWN_RPG_V0.animations.find((item) => item.name === patch.action)
      if (animation) patch.targetFrameCount = animation.count
    }
    actionState.optionsModel = updateMotionOptionsModel(actionState.optionsModel, patch)
    invalidateOptionDependentState(field)
  } catch (error) {
    actionState.error = error
  }
  renderStudioAction(actionState)
}

function restoreAutomaticSelection() {
  if (actionState.uiOperation || !actionState.previewCandidates.length) return
  actionState.optionsModel = updateMotionOptionsModel(actionState.optionsModel, {
    selectionMode: 'auto',
  })
  actionState.frameSelection = restoreAutoFrameSelection(actionState.previewCandidates)
  invalidateOperationAuthority(actionState, 'build')
  actionState.phase = 'preview'
  actionState.blockedOperationKey = null
  actionState.notice = studioT('action.notice.autoRestored')
  actionState.error = null
  renderStudioAction(actionState)
}

function updateFrameSelection(target) {
  if (actionState.uiOperation) return
  const index = Number(target.dataset.index)
  const frames = [...actionState.frameSelection]
  if (!Number.isSafeInteger(index) || !frames[index]) return
  const action = target.dataset.actionFrame
  actionState.optionsModel = updateMotionOptionsModel(actionState.optionsModel, {
    selectionMode: 'manual',
  })
  if (action === 'toggle') {
    frames[index] = { ...frames[index], selected: Boolean(target.checked) }
  } else if (action === 'remove') {
    frames.splice(index, 1)
  } else if (action === 'up' && index > 0) {
    const [frame] = frames.splice(index, 1)
    frames.splice(index - 1, 0, frame)
  } else if (action === 'down' && index < frames.length - 1) {
    const [frame] = frames.splice(index, 1)
    frames.splice(index + 1, 0, frame)
  }
  actionState.frameSelection = frames
  invalidateOperationAuthority(actionState, 'build')
  actionState.phase = 'preview'
  actionState.blockedOperationKey = null
  actionState.notice = studioT('action.notice.manualUpdated')
  actionState.error = null
  renderStudioAction(actionState)
}

function showActionMode(phase) {
  if (actionState.uiOperation) return
  if (!['advanced', 'source_set'].includes(phase)) return
  if (!['advanced', 'source_set'].includes(actionState.phase)) {
    actionState.priorPhase = actionState.phase
    actionState.priorFlow = actionState.currentFlow
  }
  if (phase === 'source_set') actionState.currentFlow = 'sourceSet'
  actionState.phase = phase
  actionState.error = null
  actionState.notice = null
  renderStudioAction(actionState)
  byId('studio-action-phase-title')?.focus({ preventScroll: true })
}

function returnToGuided() {
  if (actionState.uiOperation) return
  const fallback = actionState.priorFlow === 'sourceSet'
    ? guidedFallbackPhase(actionState)
    : exactPhase(actionState.priorPhase)
  actionState.currentFlow = 'guided'
  actionState.priorFlow = 'guided'
  actionState.phase = fallback
  if (['advanced', 'source_set'].includes(actionState.phase)) actionState.phase = 'empty'
  actionState.error = null
  actionState.notice = null
  renderStudioAction(actionState)
}

function hasUnappliedActionWork(state = actionState) {
  if (state?.phase === 'applied') return false
  return Boolean(
    state?.sourceFile ||
    state?.sourceDescriptor ||
    state?.activeOperation ||
    state?.resumableOperation ||
    state?.previewCandidates?.length ||
    state?.frameSelection?.length ||
    Object.keys(state?.jobs ?? {}).length,
  )
}

function requestAbandonToCharacter(event) {
  if (byId('studio-action-view')?.hidden !== false) return
  // Switching modules must not cancel, duplicate, or detach a live/paused Job.
  // Keep the exact operation in memory and let the internal hash navigation
  // proceed; the user can return to Action to observe or resume that same Job.
  if (actionState.uiOperation || actionState.resumableOperation) return
  if (!hasUnappliedActionWork(actionState) || actionState.phase === 'abandon') return
  if (event?.button !== undefined && event.button !== 0) return
  if (event?.metaKey || event?.ctrlKey || event?.shiftKey || event?.altKey) return
  event?.preventDefault()
  actionState.abandonReturnPhase = exactPhase(actionState.phase)
  actionState.phase = 'abandon'
  actionState.error = null
  actionState.notice = studioT('action.notice.abandonPending')
  renderStudioAction(actionState)
  byId('studio-action-phase-title')?.focus({ preventScroll: true })
}

function cancelAbandon() {
  if (actionState.phase !== 'abandon') return
  const returnPhase = exactPhase(actionState.abandonReturnPhase ?? 'empty')
  actionState.abandonReturnPhase = null
  actionState.phase = returnPhase === 'abandon' ? 'empty' : returnPhase
  actionState.notice = null
  renderStudioAction(actionState)
}

function confirmAbandon() {
  if (actionState.phase !== 'abandon') return
  const descriptor = actionState.sourceDescriptor
  const operationId = actionState.sourceUploadOperationId
  actionState.observationController?.abort()
  releasePriorUpload(descriptor, operationId)
  for (const id of [
    'studio-action-file',
    'studio-action-sheet-file',
    'studio-action-strip-file',
    'studio-action-manifest-file',
    'studio-action-strip-files',
  ]) {
    const input = byId(id)
    if (input) input.value = ''
  }
  const serviceAvailable = actionState.serviceAvailable
  actionState = createInitialActionState({ serviceAvailable })
  renderStudioAction(actionState)
  globalThis.location.hash = '#character'
}

function bindActionControl(id, listener) {
  byId(id)?.addEventListener('click', listener)
}

function hasGuidedApplyResultAuthority(state) {
  return Boolean(
    state.jobs.apply ||
    state.reports.apply ||
    state.artifacts.apply_motion_strip_report_url
  )
}

function hasSourceSetApplyResultAuthority(state) {
  return Boolean(
    state.jobs.setApply ||
    state.reports.setApply ||
    state.artifacts.motion_source_set_apply_report_url
  )
}

function remainingEvidenceAfterApplyInvalidation(state, { sourceSet = false } = {}) {
  if (sourceSet && state.jobs.set && state.reports.set) {
    return mapMotionReportOutcome({ job: state.jobs.set, report: state.reports.set })
  }
  if (!state.jobs.build || !state.reports.build || !state.buildBinding) return null
  try {
    if (!currentBuildBinding(state, serializedOptions(state))) return null
  } catch {
    return null
  }
  return mapMotionEvidence({
    job: state.jobs.build,
    report: state.reports.build,
    bindingCurrent: true,
  })
}

function guidedFallbackPhase(state) {
  const evidence = evidenceForFlow(state, 'guided')
  if (state.jobs.build && state.reports.build && evidence) {
    return evidence.status === 'blocked' ? 'blocked' : 'review'
  }
  return state.previewCandidates.length ? 'preview' : 'empty'
}

function invalidateApplyResult({
  scope = 'guided',
  authorityWasPresent = null,
} = {}) {
  const state = actionState
  const affected = new Set(
    scope === 'both' ? ['guided', 'sourceSet'] :
      scope === 'sourceSet' ? ['sourceSet'] : ['guided'],
  )
  const hadAuthority = {
    guided: authorityWasPresent?.guided ?? hasGuidedApplyResultAuthority(state),
    sourceSet: authorityWasPresent?.sourceSet ?? hasSourceSetApplyResultAuthority(state),
  }
  if (affected.has('guided')) invalidateOperationAuthority(state, 'apply')
  if (affected.has('sourceSet')) invalidateOperationAuthority(state, 'setApply')

  if (affected.has('guided') && hadAuthority.guided) {
    setFlowEvidence(
      state,
      'guided',
      remainingEvidenceAfterApplyInvalidation(state, { sourceSet: false }),
    )
  }
  if (affected.has('sourceSet') && hadAuthority.sourceSet) {
    setFlowEvidence(
      state,
      'sourceSet',
      remainingEvidenceAfterApplyInvalidation(state, { sourceSet: true }),
    )
  }
  const currentFlow = state.currentFlow === 'sourceSet' ? 'sourceSet' : 'guided'
  if (affected.has(currentFlow) && hadAuthority[currentFlow]) {
    const fallbackPhase = currentFlow === 'sourceSet'
      ? 'source_set'
      : guidedFallbackPhase(state)
    if (state.phase === 'applied' || state.phase === 'blocked') {
      state.phase = fallbackPhase
    }
    if (
      state.priorFlow === currentFlow &&
      (state.priorPhase === 'applied' || state.priorPhase === 'blocked')
    ) {
      state.priorPhase = fallbackPhase
    }
  }
}

function bindActionInputs() {
  byId('studio-action-file')?.addEventListener('change', (event) => {
    resetForSourceFile(event.currentTarget.files?.[0] ?? null)
  })
  byId('studio-action-sheet-file')?.addEventListener('change', (event) => {
    actionState.sheetFile = event.currentTarget.files?.[0] ?? null
    invalidateApplyResult({ scope: 'both' })
    actionState.error = null
    renderStudioAction(actionState)
  })
  byId('studio-action-strip-file')?.addEventListener('change', (event) => {
    actionState.stripFile = event.currentTarget.files?.[0] ?? null
    invalidateApplyResult({ scope: 'guided' })
    actionState.error = null
    renderStudioAction(actionState)
  })
  byId('studio-action-manifest-file')?.addEventListener('change', (event) => {
    actionState.manifestFile = event.currentTarget.files?.[0] ?? null
    actionState.currentFlow = 'sourceSet'
    invalidateApplyResult({ scope: 'sourceSet' })
    invalidateOperationAuthority(actionState, 'set')
    actionState.phase = 'source_set'
    actionState.error = null
    renderStudioAction(actionState)
  })
  byId('studio-action-strip-files')?.addEventListener('change', (event) => {
    actionState.sourceSetStripFiles = [...(event.currentTarget.files ?? [])]
    actionState.currentFlow = 'sourceSet'
    invalidateApplyResult({ scope: 'sourceSet' })
    invalidateOperationAuthority(actionState, 'set')
    actionState.phase = 'source_set'
    actionState.error = null
    renderStudioAction(actionState)
  })
  document.querySelectorAll('[data-action-option]').forEach((control) => {
    control.addEventListener(control.type === 'range' ? 'input' : 'change', () => {
      updateOptionFromControl(control)
    })
  })
  const frameList = byId('studio-action-frame-list')
  frameList?.addEventListener('change', (event) => updateFrameSelection(event.target))
  frameList?.addEventListener('click', (event) => {
    if (event.target?.dataset?.actionFrame && event.target.type !== 'checkbox') {
      updateFrameSelection(event.target)
    }
  })
}

function bindActionButtons() {
  bindActionControl('studio-action-analyze', () => void startAnalysis())
  bindActionControl('studio-action-preview', () => void startPreview())
  bindActionControl('studio-action-build', () => void startBuild())
  bindActionControl('studio-action-apply', () => void startApply())
  bindActionControl('studio-action-cancel', () => void cancelCurrentOperation())
  bindActionControl('studio-action-resume', () => void resumeExistingOperation())
  bindActionControl('studio-action-recover', recoverBlockedOperation)
  bindActionControl('studio-action-source-set-analyze', () => void startSourceSetAnalysis())
  bindActionControl('studio-action-source-set-apply', () => void startSourceSetApply())
  bindActionControl('studio-action-restore-auto', restoreAutomaticSelection)
  bindActionControl('studio-action-advanced-toggle', () => showActionMode('advanced'))
  bindActionControl('studio-action-source-set-toggle', () => showActionMode('source_set'))
  bindActionControl('studio-action-abandon-cancel', cancelAbandon)
  bindActionControl('studio-action-abandon-confirm', confirmAbandon)
  document.querySelector('[data-studio-route="character"]')?.addEventListener(
    'click',
    requestAbandonToCharacter,
  )
  document.querySelectorAll('[data-action-return-guided]').forEach((button) => {
    button.addEventListener('click', returnToGuided)
  })
  document.querySelectorAll('[data-action-language]').forEach((button) => {
    button.addEventListener('click', () => {
      setCurrentLanguage(button.dataset.actionLanguage)
      const select = byId('language-select')
      if (select) {
        select.value = getCurrentLanguage()
        select.dispatchEvent(new Event('change', { bubbles: true }))
      }
      renderStudioActionLanguage()
    })
  })
}

async function loadToolStatus() {
  if (!actionState.serviceAvailable) return
  try {
    actionState.toolStatus = await fetchMotionSourceToolStatus()
    actionState.toolError = null
  } catch (error) {
    actionState.toolError = error
  }
  renderStudioAction(actionState)
}

export function getStudioActionState() {
  return actionState
}

export function initStudioAction({ serviceAvailable = true } = {}) {
  if (initialized) {
    renderStudioActionLanguage()
    return Promise.resolve(actionState)
  }
  const view = byId('studio-action-view')
  if (!view) return Promise.resolve(null)
  initialized = true
  actionState = createInitialActionState({ serviceAvailable })
  bindActionInputs()
  bindActionButtons()
  renderOptions(actionState)
  renderStudioActionLanguage()
  return loadToolStatus().then(() => actionState)
}
