import { state } from './appState.js'
import { TOPDOWN_RPG_V0 } from '../character-pack/profile.js'
import { $, showToast } from './dom.js'
import { t } from './i18n.js'
import {
  analyzeMotionSource,
  analyzeMotionSourceSet,
  applyMotionSourceSet,
  applyMotionStrip,
  buildMotionEnginePacksFromAppliedSheet,
  buildMotionStrip,
  cancelMotionSourceJob,
  createMotionOperationId,
  fetchImageArtifact,
  fetchMotionSourceToolStatus,
  fetchJsonArtifact,
  previewMotionFrames,
  releaseMotionSourceUpload,
  releaseMotionSourceUploadOperation,
  uploadMotionSource,
  waitForMotionSourceJob,
} from './motionSource/api.js'
import {
  assertMotionEnginePackResult,
  buildMotionApplyContextCommit,
  motionEnginePackBindingCurrent,
  motionEnginePackExportReadiness,
} from './motionSource/enginePackExportState.js'
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
  serializeMotionSelectionOptions,
} from './motionSource/guidedState.js'

const VIDEO_EXT = /\.(mp4|mov|webm|mkv|avi|m4v)$/i
const GIF_ZIP_EXT = /\.(gif|zip)$/i
const MAX_VIDEO_BYTES = 200 * 1024 * 1024
const MAX_GIF_ZIP_BYTES = 64 * 1024 * 1024
const MAX_RASTER_BYTES = 32 * 1024 * 1024
const TERMINAL_JOB_STATUSES = new Set(['done', 'failed_quality_gate', 'failed_post_processing', 'failed_model_error', 'failed_safety_filter'])
const MOTION_PIXEL_GRID_RECIPES = new Set([
  'pixel_grid_v2_balanced',
  'pixel_grid_v2_detail_safe',
  'pixel_grid_v2_oklab',
])
const MOTION_ACTIONS = new Map(
  TOPDOWN_RPG_V0.animations.map((animation) => [animation.name, animation])
)
const MOTION_REQUEST_CONTROL_SELECTORS = [
  '#motion-source-action',
  '#motion-source-target-frames',
  '#motion-source-stride',
  '#motion-source-fps',
  '#motion-source-start-sec',
  '#motion-source-end-sec',
  '#motion-source-max-frames',
  '#motion-source-selection-mode',
  '#motion-source-selection-recipe',
  '#motion-source-loop-expectation',
  '#motion-source-temporal-matte',
  '#motion-source-restore-auto',
  '#motion-source-background-method',
  '#motion-source-key-color',
  '#motion-source-tolerance',
  '#motion-source-defringe',
  '#motion-source-static-offset-y',
  '#motion-source-pixel-grid-recipe',
  '#motion-source-resample-strategy',
  '#motion-source-sheet-file',
  '#motion-source-strip-file',
  '#motion-source-manifest-file',
  '#motion-source-set-strip-files',
]
const MOTION_GUIDED_CONTROL_SELECTORS = [
  '#motion-source-view-guided',
  '#motion-source-view-advanced',
  '#motion-guide-choose-source',
  '#motion-guide-analyze',
  '#motion-guide-action',
  '#motion-guide-target',
  '#motion-guide-selection-mode',
  '#motion-guide-selection-recipe',
  '#motion-guide-loop-expectation',
  '#motion-guide-temporal-matte',
  '#motion-guide-preview',
  '#motion-guide-restore-auto',
  '#motion-guide-background-method',
  '#motion-guide-tolerance',
  '#motion-guide-pixel-grid-recipe',
  '#motion-guide-build',
  '#motion-guide-open-advanced',
  '#motion-guide-choose-sheet',
  '#motion-guide-resample',
  '#motion-guide-apply',
  '#motion-guide-build-engine-packs',
  '#motion-guide-open-artifacts',
]
const MOTION_RELEASE_RETRY_DELAYS_MS = Object.freeze([0, 250, 1000, 4000])
const MOTION_RELEASE_REQUEST_TIMEOUT_MS = 3000

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function fileName(file) {
  return file?.name ?? 'none'
}

function setStatus(message, status = 'idle') {
  const statusEl = $('#motion-source-status')
  if (!statusEl) return
  statusEl.textContent = message
  statusEl.dataset.status = status
}

function isAbortError(error) {
  return error?.name === 'AbortError' || error?.code === 'ABORT_ERR'
}

function abortMotionObservation() {
  state.motionSource.observationController?.abort()
  state.motionSource.observationController = null
}

function queueMotionSourceUploadRelease({ uploadId = null, operationId = null } = {}) {
  const key = operationId || uploadId
  if (!key || state.motionSource.releaseTasks.has(key)) return
  const task = (async () => {
    let lastError = null
    for (const delayMs of MOTION_RELEASE_RETRY_DELAYS_MS) {
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs))
      try {
        const request = { timeoutMs: MOTION_RELEASE_REQUEST_TIMEOUT_MS }
        if (operationId) return await releaseMotionSourceUploadOperation(operationId, request)
        return await releaseMotionSourceUpload(uploadId, request)
      } catch (error) {
        lastError = error
      }
    }
    console.warn(`Motion source release could not be requested: ${String(lastError?.message || lastError)}`)
    return null
  })().finally(() => {
    state.motionSource.releaseTasks.delete(key)
  })
  state.motionSource.releaseTasks.set(key, task)
}

function operationMatchesCurrentState(handle) {
  if (!handle) return false
  if (state.motionSource.uiOperation !== handle) return false
  if (state.motionSource.renderToken !== handle.renderToken) return false
  if (!handle.bound) return true
  if (state.motionSource.sourceEpoch !== handle.epoch) return false
  if (!state.motionSource.sourceFile) return false
  if (
    handle.sourceIdentity &&
    state.motionSource.sourceDescriptor?.source_identity !== handle.sourceIdentity
  ) {
    return false
  }
  return true
}

function claimUiOperation(handle) {
  if (state.motionSource.uiOperation) return false
  state.motionSource.renderToken += 1
  handle.renderToken = state.motionSource.renderToken
  state.motionSource.uiOperation = handle
  return true
}

function releaseUiOperation(handle) {
  if (state.motionSource.uiOperation !== handle) return
  state.motionSource.uiOperation = null
  if (state.motionSource.activeOperation === handle) state.motionSource.activeOperation = null
  if (state.motionSource.resumableOperation === handle) state.motionSource.resumableOperation = null
  state.motionSource.renderToken += 1
  renderGuidedMotionSource()
}

function pauseUiOperation(handle, message) {
  if (!operationMatchesCurrentState(handle)) return
  state.motionSource.activeOperation = null
  state.motionSource.resumableOperation = handle
  setStatus(message, 'paused')
  renderGuidedMotionSource()
}

function invalidateUiOperation() {
  state.motionSource.uiOperation = null
  state.motionSource.activeOperation = null
  state.motionSource.resumableOperation = null
  state.motionSource.renderToken += 1
  renderGuidedMotionSource()
}

function selectionMode() {
  return state.motionSource.selectionMode === 'manual' ? 'manual' : 'auto'
}

function setSelectionMode(mode, { clearManual = mode === 'auto' } = {}) {
  state.motionSource.selectionMode = mode === 'manual' ? 'manual' : 'auto'
  if (clearManual) {
    state.motionSource.frameSelection = restoreAutoFrameSelection(
      state.motionSource.frameCandidates
    )
  }
  const control = $('#motion-source-selection-mode')
  if (control) control.value = state.motionSource.selectionMode
  const guidedControl = $('#motion-guide-selection-mode')
  if (guidedControl) guidedControl.value = state.motionSource.selectionMode
  const hint = $('#motion-source-selection-hint')
  if (hint) {
    hint.textContent = state.motionSource.selectionMode === 'manual'
      ? t('motion.selection.manualHint')
      : t('motion.selection.autoHint')
  }
  renderSourceMeta()
  renderGuidedMotionSource()
  syncActionButtons()
}

function isVideoFile(file) {
  return Boolean(
    file &&
    (
      (file.name && VIDEO_EXT.test(file.name)) ||
      String(file.type || '').toLowerCase().startsWith('video/')
    )
  )
}

function isGifOrZipFile(file) {
  const type = String(file?.type || '').toLowerCase()
  return Boolean(
    file &&
    (
      (file.name && GIF_ZIP_EXT.test(file.name)) ||
      type === 'image/gif' ||
      type === 'application/zip' ||
      type === 'application/x-zip-compressed'
    )
  )
}

function sourceByteLimit(file) {
  if (isVideoFile(file)) return MAX_VIDEO_BYTES
  if (isGifOrZipFile(file)) return MAX_GIF_ZIP_BYTES
  return MAX_RASTER_BYTES
}

function sourceTooLarge(file) {
  return Boolean(file && file.size > sourceByteLimit(file))
}

function motionAction(name = $('#motion-source-action')?.value) {
  return MOTION_ACTIONS.get(String(name || '')) ?? null
}

function populateMotionActions() {
  const controls = [
    $('#motion-source-action'),
    $('#motion-guide-action'),
  ].filter(Boolean)
  const current = controls.map((control) => control.value)
    .find((value) => MOTION_ACTIONS.has(value)) ?? 'walk_down'
  const html = TOPDOWN_RPG_V0.animations.map((animation) => (
    `<option value="${escapeHtml(animation.name)}">${escapeHtml(animation.name)}</option>`
  )).join('')
  for (const control of controls) {
    control.innerHTML = html
    control.value = current
  }
}

function setMotionView(view, { focus = false } = {}) {
  const resolved = view === 'advanced' ? 'advanced' : 'guided'
  state.motionSource.view = resolved
  const panel = $('#motion-source')
  const guided = $('#motion-source-guided-sidebar')
  const advanced = $('#motion-source-advanced-sidebar')
  if (panel) panel.dataset.motionSourceView = resolved
  if (guided) guided.hidden = resolved !== 'guided'
  if (advanced) advanced.hidden = resolved !== 'advanced'
  for (const [name, selector] of [
    ['guided', '#motion-source-view-guided'],
    ['advanced', '#motion-source-view-advanced'],
  ]) {
    const button = $(selector)
    if (!button) continue
    const active = name === resolved
    button.classList.toggle('active', active)
    button.setAttribute('aria-pressed', String(active))
  }
  if (focus) {
    const destination = resolved === 'guided' ? guided : advanced
    destination?.focus({ preventScroll: true })
    if (window.matchMedia('(max-width: 1180px)').matches) {
      destination?.scrollIntoView({ block: 'start', behavior: 'auto' })
    }
  }
  renderGuidedMotionSource()
  syncActionButtons()
}

function copyControlValue(fromSelector, toSelector) {
  const from = $(fromSelector)
  const to = $(toSelector)
  if (!from || !to) return
  if (from.type === 'checkbox') to.checked = from.checked
  else to.value = from.value
}

function syncGuidedControlsFromAdvanced() {
  for (const [advanced, guided] of [
    ['#motion-source-action', '#motion-guide-action'],
    ['#motion-source-target-frames', '#motion-guide-target'],
    ['#motion-source-selection-mode', '#motion-guide-selection-mode'],
    ['#motion-source-selection-recipe', '#motion-guide-selection-recipe'],
    ['#motion-source-loop-expectation', '#motion-guide-loop-expectation'],
    ['#motion-source-temporal-matte', '#motion-guide-temporal-matte'],
    ['#motion-source-background-method', '#motion-guide-background-method'],
    ['#motion-source-tolerance', '#motion-guide-tolerance'],
    ['#motion-source-pixel-grid-recipe', '#motion-guide-pixel-grid-recipe'],
    ['#motion-source-resample-strategy', '#motion-guide-resample'],
  ]) {
    copyControlValue(advanced, guided)
  }
}

function syncMotionSelectionDependencies() {
  const recipeControl = $('#motion-source-selection-recipe')
  if (!recipeControl) return
  const isV1 = recipeControl.value === 'motion_selection_v1_compat'
  if (isV1) {
    $('#motion-source-loop-expectation').value = 'auto'
    $('#motion-source-temporal-matte').value = 'disabled'
  }
  for (const selector of [
    '#motion-source-loop-expectation',
    '#motion-source-temporal-matte',
    '#motion-guide-loop-expectation',
    '#motion-guide-temporal-matte',
  ]) {
    const control = $(selector)
    if (control) control.disabled = isV1 || Boolean(state.motionSource.uiOperation)
  }
  const dependency = $('#motion-source-selection-recipe-hint')
  if (dependency) dependency.textContent = t('motion.selection.v1Dependency')
  const guidedDependency = $('#motion-guide-temporal-matte-hint')
  if (guidedDependency) {
    guidedDependency.textContent = isV1
      ? t('motion.selection.v1Dependency')
      : t('motion.guide.temporalMatte.hint')
  }
  syncGuidedControlsFromAdvanced()
}

function formatBytes(bytes = 0) {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${(bytes / (1024 ** exponent)).toFixed(exponent ? 1 : 0)} ${units[exponent]}`
}

function syncSourceHint() {
  const file = state.motionSource.sourceFile
  const hint = $('#motion-source-file-hint')
  if (!hint) return
  if (!file) {
    hint.textContent = 'GIF/ZIP up to 64MB, still image up to 32MB, or video up to 200MB with local FFmpeg available.'
  } else if (sourceTooLarge(file)) {
    hint.textContent = `${fileName(file)} is ${formatBytes(file.size)}. This source type is limited to ${formatBytes(sourceByteLimit(file))}.`
  } else if (isVideoFile(file)) {
    const ffmpegAvailable = state.motionSource.toolStatus?.ffmpeg?.available
    hint.textContent = ffmpegAvailable === true
      ? `${fileName(file)} selected. Preview and Build Strip will extract frames through local FFmpeg.`
      : ffmpegAvailable === false
        ? `${fileName(file)} selected. Analyze is available; Preview and Build require local FFmpeg.`
        : `${fileName(file)} selected. Checking local FFmpeg before enabling Preview and Build.`
  } else {
    hint.textContent = `${fileName(file)} ready for provider-free local analysis.`
  }
  syncActionButtons()
}

function syncActionButtons() {
  const hasSource = Boolean(state.motionSource.sourceFile)
  const sourceBlocked = sourceTooLarge(state.motionSource.sourceFile)
  const uiBusy = Boolean(state.motionSource.uiOperation)
  const hasManualFrames = state.motionSource.frameSelection.some((frame) => frame.selected)
  const hasSheet = Boolean(state.motionSource.sheetFile)
  const hasManifest = Boolean(state.motionSource.manifestFile)
  const hasSourceSetStrips = state.motionSource.setStripFiles.length > 0
  const videoToolBlocked = isVideoFile(state.motionSource.sourceFile) &&
    state.motionSource.toolStatus?.ffmpeg?.available !== true
  const rembgToolBlocked = $('#motion-source-background-method').value === 'external_rembg' &&
    state.motionSource.toolStatus?.rembg?.available !== true
  const options = currentMotionOptions()
  const binding = currentMotionBinding(options)
  const previewOptionsValid = Boolean(binding.candidate_fingerprint)
  const buildOptionsValid = Boolean(binding.build_fingerprint)
  const previewCurrent = previewBindingCurrent(options)
  const previewArtifactError = artifactErrorFor('preview')
  const applyCompatibility = currentApplyCompatibility(options)
  const enginePackReadiness = motionEnginePackExportReadiness({
    applyJob: state.motionSource.jobs.apply,
    applyReport: state.motionSource.reports.apply,
    applyResultStale: state.motionSource.applyResultStale,
    applyArtifactError: artifactErrorFor('apply'),
    enginePackBinding: state.motionSource.enginePackBinding,
    enginePackJob: state.motionSource.jobs.enginePacks,
  })
  const manualBlocked = selectionMode() === 'manual' && (
    !hasManualFrames ||
    !previewCurrent ||
    Boolean(previewArtifactError)
  )

  $('#motion-source-analyze').disabled = !hasSource || sourceBlocked || uiBusy
  $('#motion-source-preview-frames').disabled =
    !hasSource ||
    sourceBlocked ||
    uiBusy ||
    videoToolBlocked ||
    !previewOptionsValid
  $('#motion-source-build-strip').disabled = !hasSource ||
    sourceBlocked ||
    uiBusy ||
    videoToolBlocked ||
    rembgToolBlocked ||
    !buildOptionsValid ||
    manualBlocked
  $('#motion-source-apply-strip').disabled =
    uiBusy ||
    !hasSheet ||
    !applyCompatibility.allowed
  $('#motion-source-analyze-set').disabled = uiBusy || !hasManifest || !hasSourceSetStrips
  $('#motion-source-apply-set').disabled = uiBusy || !hasSheet || !hasManifest || !hasSourceSetStrips
  $('#motion-source-build-engine-packs').disabled = uiBusy || !enginePackReadiness.ready

  const guidedAnalyze = $('#motion-guide-analyze')
  const guidedPreview = $('#motion-guide-preview')
  const guidedBuild = $('#motion-guide-build')
  const guidedApply = $('#motion-guide-apply')
  const guidedEnginePacks = $('#motion-guide-build-engine-packs')
  const guidedRestore = $('#motion-guide-restore-auto')
  const chooseSource = $('#motion-guide-choose-source')
  const chooseSheet = $('#motion-guide-choose-sheet')

  const cancellable = state.motionSource.activeOperation ?? state.motionSource.resumableOperation
  const activeCancellable = Boolean(
    cancellable?.bound &&
    cancellable.jobId &&
    operationMatchesCurrentState(cancellable) &&
    cancellable.status !== 'cancelling' &&
    !TERMINAL_JOB_STATUSES.has(cancellable.status)
  )
  $('#motion-source-cancel').disabled = !activeCancellable
  const guidedCancel = $('#motion-guide-cancel')
  if (guidedCancel) {
    guidedCancel.hidden = !activeCancellable
    guidedCancel.disabled = !activeCancellable
  }
  const resumable = state.motionSource.resumableOperation
  const resumeButton = $('#motion-source-resume')
  resumeButton.disabled = !operationMatchesCurrentState(resumable)
  resumeButton.textContent = resumable && !resumable.jobId
    ? 'Recover operation'
    : 'Resume polling'
  const guidedResume = $('#motion-guide-resume')
  if (guidedResume) {
    guidedResume.hidden = resumeButton.disabled
    guidedResume.disabled = resumeButton.disabled
    guidedResume.textContent = t('motion.toolbar.resume')
  }

  for (const selector of MOTION_REQUEST_CONTROL_SELECTORS) {
    const control = $(selector)
    if (control) control.disabled = uiBusy
  }
  for (const selector of MOTION_GUIDED_CONTROL_SELECTORS) {
    const control = $(selector)
    if (control) control.disabled = uiBusy
  }
  for (const selector of [
    '#motion-source-view-guided',
    '#motion-source-view-advanced',
    '#motion-guide-open-advanced',
    '#motion-guide-open-artifacts',
  ]) {
    const control = $(selector)
    if (control) control.disabled = false
  }
  if (guidedAnalyze) guidedAnalyze.disabled = $('#motion-source-analyze').disabled
  if (guidedPreview) guidedPreview.disabled = $('#motion-source-preview-frames').disabled
  if (guidedBuild) {
    guidedBuild.disabled =
      $('#motion-source-build-strip').disabled ||
      !previewCurrent ||
      Boolean(previewArtifactError)
  }
  if (guidedApply) guidedApply.disabled = $('#motion-source-apply-strip').disabled
  if (guidedEnginePacks) guidedEnginePacks.disabled = $('#motion-source-build-engine-packs').disabled
  if (guidedRestore) {
    guidedRestore.disabled = uiBusy || state.motionSource.frameCandidates.length === 0
  }
  $('#motion-source-restore-auto').disabled =
    uiBusy || state.motionSource.frameCandidates.length === 0
  if (chooseSource) chooseSource.disabled = uiBusy
  if (chooseSheet) chooseSheet.disabled = uiBusy
  for (const control of document.querySelectorAll('[data-motion-key-color]')) {
    control.disabled = uiBusy
  }
  const frameCount = state.motionSource.frameSelection.length
  for (const control of document.querySelectorAll('#motion-source-frame-picker input, #motion-source-frame-picker button')) {
    const action = control.dataset.frameAction
    const index = Number(control.dataset.index)
    control.disabled = uiBusy ||
      (action === 'up' && index === 0) ||
      (action === 'down' && index === frameCount - 1)
  }
  syncMotionSelectionDependencies()
}

export function serializeMotionPixelGridRecipe(value) {
  if (value === 'disabled') return null
  if (!MOTION_PIXEL_GRID_RECIPES.has(value)) {
    throw new Error(`Unsupported Motion Pixel Grid recipe: ${value}`)
  }
  return { recipe: value }
}

function readMotionOptions() {
  const selectedIndexes = state.motionSource.frameSelection
    .filter((frame) => frame.selected)
    .map((frame) => frame.source_index)
  const requestedSelectionMode = selectionMode()
  const motionSelection = serializeMotionSelectionOptions({
    recipe: $('#motion-source-selection-recipe').value,
    loopExpectation: $('#motion-source-loop-expectation').value,
    temporalMatte: $('#motion-source-temporal-matte').value,
  })
  const pixelGridRefinement = serializeMotionPixelGridRecipe(
    $('#motion-source-pixel-grid-recipe').value
  )
  const options = {
    action: $('#motion-source-action').value,
    frames: Number($('#motion-source-target-frames').value),
    selection_mode: requestedSelectionMode,
    motion_selection: motionSelection,
    stride: Number($('#motion-source-stride').value),
    fps: Number($('#motion-source-fps').value),
    maxFrames: Number($('#motion-source-max-frames').value),
    startSec: Number($('#motion-source-start-sec').value || 0),
    endSec: $('#motion-source-end-sec').value === '' ? null : Number($('#motion-source-end-sec').value),
    background: {
      method: $('#motion-source-background-method').value,
      key_color: $('#motion-source-key-color').value.split(',').map((part) => Number(part.trim())),
      tolerance: Number($('#motion-source-tolerance').value),
      defringe: $('#motion-source-defringe').checked,
    },
    anchor_policy: {
      static_offset_y: Number($('#motion-source-static-offset-y').value),
    },
    output_profile: {
      resample_strategy: $('#motion-source-resample-strategy').value,
    },
  }
  if (pixelGridRefinement) options.pixel_grid_refinement = pixelGridRefinement
  if (requestedSelectionMode === 'manual') options.selected_frame_indexes = selectedIndexes
  return options
}

function snapshotMotionOptions() {
  return JSON.parse(JSON.stringify(readMotionOptions()))
}

function currentMotionOptions() {
  try {
    return readMotionOptions()
  } catch {
    return null
  }
}

function currentMotionBinding(options = currentMotionOptions()) {
  let candidateFingerprint = null
  let buildFingerprint = null
  if (options) {
    try {
      candidateFingerprint = motionCandidateFingerprint(options)
    } catch {
      candidateFingerprint = null
    }
    try {
      buildFingerprint = motionBuildFingerprint(options)
    } catch {
      buildFingerprint = null
    }
  }
  return {
    source_epoch: state.motionSource.sourceEpoch,
    source_identity: state.motionSource.sourceDescriptor?.source_identity ?? null,
    candidate_fingerprint: candidateFingerprint,
    build_fingerprint: buildFingerprint,
  }
}

function previewBindingCurrent(options = currentMotionOptions()) {
  if (!options) return false
  return isMotionPreviewBindingCurrent(
    state.motionSource.previewBinding,
    currentMotionBinding(options)
  )
}

function buildBindingCurrent(options = currentMotionOptions()) {
  if (!options) return false
  return isMotionBuildBindingCurrent(
    state.motionSource.buildBinding,
    currentMotionBinding(options)
  )
}

function currentApplyCompatibility(options = currentMotionOptions()) {
  const report = state.motionSource.reports.build
  const editedStripOverride = Boolean(state.motionSource.stripFile)
  const buildCurrent = buildBindingCurrent(options)
  const buildEvidence = mapMotionEvidence({
    job: state.motionSource.jobs.build,
    report,
    bindingCurrent: report ? buildCurrent : true,
    artifactError: artifactErrorFor('build'),
  })
  return motionApplyCompatibility({
    action: options?.action,
    resampleStrategy:
      options?.output_profile?.resample_strategy ??
      $('#motion-source-resample-strategy')?.value ??
      'reject_mismatch',
    editedStripOverride,
    hasLatestBuild: Boolean(state.motionSource.stripUrl && state.motionSource.jobs.build),
    latestBuildCurrent: buildCurrent,
    latestBuildEvidenceStatus: buildEvidence.status,
    stripFrameCount: !editedStripOverride && Number.isInteger(report?.selected_frame_count)
      ? report.selected_frame_count
      : null,
    profile: TOPDOWN_RPG_V0,
  })
}

function artifactErrorFor(storeKey) {
  const errors = Object.values(state.motionSource.artifactErrors?.[storeKey] ?? {})
  return errors[0] ?? null
}

function setArtifactError(storeKey, error) {
  if (!storeKey) return null
  const artifactKey = error?.artifact_key ??
    (error?.artifact_kind === 'image_load' && error?.artifact_url
      ? `image_load:${error.artifact_url}`
      : error?.artifact_kind ?? 'artifact')
  const artifactError = {
    status: 'artifact_error',
    store_key: storeKey,
    artifact_key: artifactKey,
    reason: error?.reason ?? error?.message ?? String(error),
    ...(error?.artifact_kind ? { artifact_kind: error.artifact_kind } : {}),
    ...(error?.artifact_url ? { artifact_url: error.artifact_url } : {}),
  }
  state.motionSource.artifactErrors[storeKey] ??= {}
  state.motionSource.artifactErrors[storeKey][artifactKey] = artifactError
  return artifactError
}

function clearArtifactError(storeKey, {
  artifactKind = null,
  artifactUrl = null,
} = {}) {
  const errors = state.motionSource.artifactErrors?.[storeKey]
  if (!errors) return false
  let cleared = false
  for (const [key, current] of Object.entries(errors)) {
    if (artifactKind && current.artifact_kind !== artifactKind) continue
    if (artifactUrl && current.artifact_url !== artifactUrl) continue
    delete errors[key]
    cleared = true
  }
  return cleared
}

function markApplyResultStale() {
  if (state.motionSource.reports.apply) {
    state.motionSource.applyResultStale = true
  }
}

function shortEvidence(value, length = 18) {
  const text = String(value ?? '')
  if (!text) return '—'
  return text.length > length ? `${text.slice(0, length)}…` : text
}

function guideStatusLabel(status) {
  const key = {
    waiting: 'motion.status.waiting',
    ready: 'motion.status.ready',
    running: 'motion.status.running',
    needs_review: 'motion.status.needsReview',
    'needs-review': 'motion.status.needsReview',
    blocked: 'motion.status.blocked',
    complete: 'motion.status.complete',
    stale: 'motion.status.stale',
    not_run: 'motion.status.notRun',
    'not-run': 'motion.status.notRun',
    unavailable: 'motion.status.unavailable',
    disabled: 'motion.option.disabled',
    not_applied: 'motion.hud.notApplied',
    current: 'motion.status.complete',
  }[status] ?? 'motion.status.waiting'
  return t(key)
}

function setGuideStepState(step, status) {
  const node = document.querySelector(`.motion-guide-step[data-step="${step}"]`)
  if (!node) return
  const stateName = status === 'needs_review' ? 'needs-review' : status.replaceAll('_', '-')
  node.dataset.state = stateName
  const label = node.querySelector('.motion-guide-step-status')
  if (label) {
    label.removeAttribute('data-i18n')
    label.textContent = guideStatusLabel(status)
  }
}

function renderEvidenceCard(selector, evidence, lines) {
  const card = $(selector)
  if (!card) return
  const status = evidence?.status ?? 'not_run'
  const visualStatus = status === 'current'
    ? 'complete'
    : status === 'not_applied'
      ? 'needs_review'
      : status === 'disabled'
        ? 'not_run'
        : status
  card.dataset.state = visualStatus.replaceAll('_', '-')
  const body = card.querySelector('p')
  if (!body) return
  body.removeAttribute('data-i18n')
  body.textContent = lines.filter(Boolean).join(' · ') || guideStatusLabel(status)
}

function activeMotionStoreKey() {
  return state.motionSource.activeOperation?.storeKey ??
    state.motionSource.resumableOperation?.storeKey ??
    null
}

function renderGuidedMotionSource() {
  if (!$('#motion-source')) return
  syncGuidedControlsFromAdvanced()
  const toleranceValue = $('#motion-guide-tolerance-value')
  if (toleranceValue) toleranceValue.textContent = $('#motion-source-tolerance')?.value ?? '24'

  const file = state.motionSource.sourceFile
  const sourceSummary = $('#motion-guide-source-summary')
  if (sourceSummary) {
    sourceSummary.removeAttribute('data-i18n')
    if (!file) {
      sourceSummary.textContent = t('motion.guide.sourceNone')
    } else {
      const identity = state.motionSource.sourceDescriptor?.source_identity
      const parts = [fileName(file), formatBytes(file.size)]
      if (state.motionSource.sourceMeta?.duration) {
        parts.push(`${state.motionSource.sourceMeta.duration.toFixed(2)}s`)
      }
      if (state.motionSource.sourceMeta?.width && state.motionSource.sourceMeta?.height) {
        parts.push(`${state.motionSource.sourceMeta.width}×${state.motionSource.sourceMeta.height}`)
      }
      parts.push(identity ? shortEvidence(identity) : t('motion.guide.sourcePending'))
      if (state.motionSource.toolStatus) {
        parts.push(t(
          state.motionSource.toolStatus.ffmpeg?.available
            ? 'motion.tool.ffmpegReady'
            : 'motion.tool.ffmpegUnavailable'
        ))
        parts.push(t(
          state.motionSource.toolStatus.rembg?.available
            ? 'motion.tool.rembgReady'
            : 'motion.tool.rembgUnavailable'
        ))
      }
      sourceSummary.textContent = parts.join(' · ')
    }
  }

  const sourceRunning = activeMotionStoreKey() === 'analysis'
  const sourceToolBlocked =
    isVideoFile(file) &&
    state.motionSource.toolStatus?.ffmpeg?.available === false
  const analysisOutcome = mapMotionReportOutcome({
    job: state.motionSource.jobs.analysis,
    report: state.motionSource.reports.analysis,
    artifactError: artifactErrorFor('analysis'),
  })
  setGuideStepState(
    'source',
    !file
      ? 'waiting'
      : sourceTooLarge(file) || sourceToolBlocked
        ? 'blocked'
        : sourceRunning
          ? 'running'
          : state.motionSource.reports.analysis ||
              state.motionSource.jobs.analysis ||
              artifactErrorFor('analysis')
            ? analysisOutcome.status
            : 'ready'
  )

  const options = currentMotionOptions()
  const previewCurrent = previewBindingCurrent(options)
  const buildCurrent = buildBindingCurrent(options)
  const buildJob = state.motionSource.jobs.build
  const buildReport = state.motionSource.reports.build
  const evidence = mapMotionEvidence({
    job: buildJob,
    report: buildReport,
    bindingCurrent: buildReport ? buildCurrent : true,
    artifactError: artifactErrorFor('build'),
  })

  const previewRunning = activeMotionStoreKey() === 'preview'
  setGuideStepState(
    'select',
    previewRunning
      ? 'running'
      : artifactErrorFor('preview')
        ? 'blocked'
      : state.motionSource.frameCandidates.length === 0
        ? (file ? 'ready' : 'waiting')
        : previewCurrent
          ? 'ready'
          : 'stale'
  )

  const selectedCount = state.motionSource.frameSelection
    .filter((frame) => frame.selected).length
  const reviewSummary = $('#motion-guide-review-summary')
  if (reviewSummary) {
    reviewSummary.removeAttribute('data-i18n')
    reviewSummary.textContent = artifactErrorFor('build')
      ? t('motion.guide.evidenceUnavailable')
      : buildReport
      ? `${guideStatusLabel(buildCurrent ? evidence.status : 'stale')} · ${buildReport.selected_frame_count ?? 0}/${buildReport.contract?.target_frame_count ?? '—'}`
      : state.motionSource.frameCandidates.length
        ? `${t('motion.guide.candidatesReady')} · ${state.motionSource.frameCandidates.length} · ${selectionMode()}${selectedCount ? ` ${selectedCount}` : ''}`
        : t('motion.guide.review.empty')
  }

  const buildRunning = activeMotionStoreKey() === 'build'
  const cleanupToolBlocked =
    $('#motion-source-background-method')?.value === 'external_rembg' &&
    state.motionSource.toolStatus?.rembg?.available === false
  setGuideStepState(
    'cleanup',
    cleanupToolBlocked
      ? 'blocked'
      : buildRunning
      ? 'running'
      : artifactErrorFor('build')
        ? 'blocked'
      : buildReport
        ? buildCurrent
          ? evidence.status
          : 'stale'
        : previewCurrent
          ? 'ready'
          : (file ? 'waiting' : 'waiting')
  )
  setGuideStepState(
    'review',
    artifactErrorFor('build')
      ? 'blocked'
      : buildReport
      ? buildCurrent
        ? evidence.status
        : 'stale'
      : 'waiting'
  )

  const compatibility = currentApplyCompatibility(options)
  const sheetSummary = $('#motion-guide-sheet-summary')
  if (sheetSummary) {
    sheetSummary.removeAttribute('data-i18n')
    if (!state.motionSource.sheetFile) {
      sheetSummary.textContent = t('motion.guide.apply.noSheet')
    } else if (compatibility.reason === 'latest_build_stale') {
      sheetSummary.textContent = `${fileName(state.motionSource.sheetFile)} · ${t('motion.guide.buildStale')}`
    } else if (compatibility.reason === 'target_frame_count_mismatch') {
      sheetSummary.textContent = `${fileName(state.motionSource.sheetFile)} · ${t('motion.guide.applyMismatch')}`
    } else if (compatibility.reason === 'latest_build_evidence_blocked') {
      sheetSummary.textContent = `${fileName(state.motionSource.sheetFile)} · ${t('motion.guide.evidenceUnavailable')}`
    } else {
      sheetSummary.textContent = fileName(state.motionSource.sheetFile)
    }
  }
  const applyArtifactError =
    artifactErrorFor('setApply') ??
    artifactErrorFor('apply')
  const applyOutcome = mapMotionReportOutcome({
    job: state.motionSource.jobs.apply,
    report: state.motionSource.reports.apply,
    artifactError: artifactErrorFor('apply'),
  })
  const setApplyOutcome = mapMotionReportOutcome({
    job: state.motionSource.jobs.setApply,
    report: state.motionSource.reports.setApply,
    artifactError: artifactErrorFor('setApply'),
  })
  const applyRunning = ['apply', 'setApply'].includes(activeMotionStoreKey())
  let applyStatus = 'waiting'
  if (applyRunning) {
    applyStatus = 'running'
  } else if (applyArtifactError) {
    applyStatus = 'blocked'
  } else if (state.motionSource.reports.apply || state.motionSource.jobs.apply) {
    applyStatus = state.motionSource.applyResultStale
      ? 'stale'
      : applyOutcome.status
  } else if (
    state.motionSource.reports.setApply ||
    state.motionSource.jobs.setApply
  ) {
    applyStatus = setApplyOutcome.status
  } else if (!state.motionSource.sheetFile) {
    applyStatus = 'waiting'
  } else if (compatibility.allowed) {
    applyStatus = compatibility.status
  } else {
    applyStatus = compatibility.reason === 'latest_build_stale'
      ? 'stale'
      : 'blocked'
  }
  setGuideStepState('apply', applyStatus)

  const sourceEvidence = {
    ...evidence.source,
    status: evidence.source.status === 'not_run' && file ? 'ready' : evidence.source.status,
  }
  renderEvidenceCard('#motion-hud-source', sourceEvidence, [
    sourceEvidence.source_kind ?? (file ? file.type || 'local' : null),
    sourceEvidence.input_frame_count == null
      ? null
      : t('motion.hud.frames', { count: sourceEvidence.input_frame_count }),
    state.motionSource.sourceDescriptor?.source_identity
      ? shortEvidence(state.motionSource.sourceDescriptor.source_identity)
      : null,
  ])
  renderEvidenceCard('#motion-hud-selection', evidence.selection, [
    evidence.selection.authority,
    evidence.selection.recipe,
    evidence.selection.selected_frame_count == null
      ? null
      : `${evidence.selection.selected_frame_count}/${evidence.selection.target_frame_count ?? '—'}`,
    evidence.selection.automatic_stages?.reason === 'manual_authority'
      ? t('motion.hud.manualAuthority')
      : null,
  ])
  renderEvidenceCard('#motion-hud-loop', evidence.loop, [
    evidence.loop.reason === 'manual_authority'
      ? t('motion.hud.manualAuthority')
      : evidence.loop.expectation,
    evidence.loop.periodicity_status,
    evidence.loop.selected_period == null
      ? null
      : t('motion.hud.period', { count: evidence.loop.selected_period }),
    evidence.loop.phase_mode,
    evidence.loop.warnings?.length
      ? t('motion.hud.warnings', { count: evidence.loop.warnings.length })
      : null,
  ])
  renderEvidenceCard('#motion-hud-cleanup', evidence.cleanup, [
    evidence.cleanup.halo_score_before == null
      ? null
      : t('motion.hud.halo', {
          before: evidence.cleanup.halo_score_before,
          after: evidence.cleanup.halo_score_after ?? '—',
        }),
    evidence.cleanup.external_matting_status,
    evidence.cleanup.warnings?.length
      ? t('motion.hud.warnings', { count: evidence.cleanup.warnings.length })
      : null,
  ])
  renderEvidenceCard('#motion-hud-grid', evidence.grid, [
    evidence.grid.status === 'not_applied' ? t('motion.hud.notApplied') : evidence.grid.recipe,
    evidence.grid.evidence_status,
    evidence.grid.shared_grid == null
      ? null
      : t('motion.hud.sharedGrid', {
          value: t(evidence.grid.shared_grid ? 'motion.value.yes' : 'motion.value.no'),
        }),
    evidence.grid.shared_palette == null
      ? null
      : t('motion.hud.sharedPalette', {
          value: t(evidence.grid.shared_palette ? 'motion.value.yes' : 'motion.value.no'),
        }),
  ])
  renderEvidenceCard('#motion-hud-binding', evidence.binding, [
    evidence.binding.status,
    shortEvidence(evidence.binding.operation_id),
    shortEvidence(evidence.binding.options_hash),
  ])
}

function renderJson(selector, data, fallback = 'No report yet. Run a real job to populate this panel.') {
  const node = $(selector)
  if (!node) return
  node.textContent = data ? JSON.stringify(data, null, 2) : fallback
}

function renderImage(selector, url, { storeKey = null } = {}) {
  const image = $(selector)
  if (!image) return
  if (!url) {
    image.hidden = true
    delete image.dataset.artifactUrl
    image.onload = null
    image.onerror = null
    image.removeAttribute('src')
    return
  }
  const exactUrl = String(url)
  image.hidden = true
  image.dataset.artifactUrl = exactUrl
  image.onload = () => {
    if (image.dataset.artifactUrl !== exactUrl) return
    image.hidden = false
    if (storeKey && clearArtifactError(storeKey, {
      artifactKind: 'image_load',
      artifactUrl: exactUrl,
    })) {
      renderGuidedMotionSource()
      syncActionButtons()
    }
  }
  image.onerror = () => {
    if (image.dataset.artifactUrl !== exactUrl) return
    image.hidden = true
    if (!storeKey) return
    setArtifactError(storeKey, {
      reason: 'Motion source image artifact could not be decoded.',
      artifact_kind: 'image_load',
      artifact_url: exactUrl,
    })
    renderGuidedMotionSource()
    syncActionButtons()
  }
  image.src = exactUrl
}

function renderToolStatus(status = state.motionSource.toolStatus) {
  const node = $('#motion-source-ffmpeg-status')
  if (!node) return
  if (!status) {
    node.textContent = 'Local tools: checking...'
    renderGuidedMotionSource()
    return
  }
  const ffmpeg = status.ffmpeg?.available ? 'FFmpeg ready' : 'FFmpeg unavailable'
  const rembg = status.rembg?.available ? 'rembg ready' : 'rembg unavailable (optional)'
  node.textContent = `Local tools: ${ffmpeg}; ${rembg}.`
  renderGuidedMotionSource()
}

function renderSourceMeta() {
  const node = $('#motion-source-file-meta')
  const identityNode = $('#motion-source-identity')
  if (!node) return
  const file = state.motionSource.sourceFile
  if (!file) {
    node.textContent = 'No source selected.'
    if (identityNode) identityNode.textContent = `No source identity | selection ${selectionMode()}`
    renderGuidedMotionSource()
    return
  }
  const meta = state.motionSource.sourceMeta
  const parts = [fileName(file), formatBytes(file.size)]
  if (meta?.duration) parts.push(`${meta.duration.toFixed(2)}s`)
  if (meta?.width && meta?.height) parts.push(`${meta.width} x ${meta.height}`)
  node.textContent = parts.join(' | ')
  if (identityNode) {
    const identity = state.motionSource.sourceDescriptor?.source_identity
    const digest = identity ? `${identity.slice(0, 19)}...` : 'pending upload'
    identityNode.textContent = `${digest} | selection ${selectionMode()}`
  }
  renderGuidedMotionSource()
}

function previewUrlFor(indexUrl, file) {
  return new URL(file, new URL(indexUrl, window.location.origin)).pathname
}

function renderLinks(job = {}) {
  const rows = [
    ['Source analysis', 'motion_source_analysis.json', job.motion_source_analysis_url],
    ['Frame preview', 'frame_preview_index.json', job.frame_preview_index_url],
    ['Preview sheet', 'frame_preview_sheet.png', job.frame_preview_sheet_url],
    ['Motion report', 'motion_source_report.json', job.motion_source_report_url],
    ['Selected frames', 'selected_frames.json', job.selected_frames_url],
    ['Contact sheet', 'motion_contact_sheet.png', job.motion_contact_sheet_url],
    ['Normalized strip', 'normalized_motion_strip.png', job.normalized_motion_strip_url],
    ['Video frames sheet', 'video_frames_sheet.png', job.video_frames_sheet_url],
    ['Frames index', 'frames_index.json', job.frames_index_url],
    ['Frames ZIP', 'frames.zip', job.frames_zip_url],
    ['Apply report', 'apply_motion_strip_report.json', job.apply_motion_strip_report_url],
    ['Applied sheet', 'applied_normalized_sheet.png', job.applied_normalized_sheet_url],
    ['Reprocessed sheet', 'normalized_sheet.png', job.normalized_sheet_url],
    ['Export validation report', 'debug_report.json', job.debug_report_url],
    ['Character Pack', 'character_pack.zip', job.zip_url],
    ['Godot package', 'godot_npc_pack.zip', job.godot_npc_zip_url],
    ['RPG Maker package', 'rpgmaker_pack.zip', job.rpgmaker_zip_url],
    ['OCAD package', 'ocad_pack.zip', job.ocad_zip_url],
    ['Source set', 'motion_source_set_report.json', job.motion_source_set_report_url],
    ['Identity gate', 'identity_consistency_report.json', job.identity_consistency_report_url],
    ['Set apply report', 'motion_source_set_apply_report.json', job.motion_source_set_apply_report_url],
  ]
  $('#motion-source-links').innerHTML = rows.map(([name, format, href]) => `
    <div class="motion-source-link-row ${href ? '' : 'is-empty'}">
      <span><b>${escapeHtml(name)}</b><small>${escapeHtml(format)}</small></span>
      ${href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer" download>Open</a>` : '<em>After job</em>'}
    </div>
  `).join('')
}

function framePickerFocusDescriptor() {
  const active = document.activeElement
  const action = active?.dataset?.frameAction
  const candidateIndex = Number(active?.dataset?.candidateIndex)
  if (!action || !Number.isInteger(candidateIndex)) return null
  return { action, candidateIndex }
}

function restoreFramePickerFocus(focus = null) {
  if (!focus) return
  const exact = document.querySelector(
    `#motion-source-frame-picker [data-frame-action="${focus.action}"][data-candidate-index="${focus.candidateIndex}"]`
  )
  if (exact) {
    exact.focus()
    return
  }
  const nearest = document.querySelector(
    '#motion-source-frame-picker [data-frame-action="toggle"]'
  )
  const preferredRestore = state.motionSource.view === 'advanced'
    ? $('#motion-source-restore-auto')
    : $('#motion-guide-restore-auto')
  ;(nearest ?? preferredRestore ?? $('#motion-guide-restore-auto') ?? $('#motion-source-restore-auto'))?.focus()
}

function renderFramePicker({ focus = null } = {}) {
  const node = $('#motion-source-frame-picker')
  if (!node) return
  const frames = state.motionSource.frameSelection
  if (!frames.length) {
    node.innerHTML = `<p>${escapeHtml(t('motion.frame.empty'))}</p>`
    syncActionButtons()
    restoreFramePickerFocus(focus)
    return
  }
  node.innerHTML = frames.map((frame, index) => `
    <article class="motion-source-frame-card ${frame.selected ? 'is-selected' : ''}" data-source-index="${escapeHtml(frame.source_index)}" data-candidate-index="${escapeHtml(frame.candidate_index ?? frame.source_index)}">
      <img src="${escapeHtml(frame.preview_url)}" alt="${escapeHtml(t('motion.frame.previewAlt', { index: frame.candidate_index ?? frame.source_index }))}" />
      <label class="checkbox-row">
        <input type="checkbox" data-frame-action="toggle" data-index="${escapeHtml(index)}" data-candidate-index="${escapeHtml(frame.candidate_index ?? frame.source_index)}" ${frame.selected ? 'checked' : ''} />
        <span>${escapeHtml(t('motion.frame.candidate', { index: frame.candidate_index ?? frame.source_index }))}</span>
      </label>
      <p class="motion-source-frame-provenance">
        ${escapeHtml(t('motion.frame.raw', { index: frame.raw_index ?? '—' }))}
        ${frame.timestamp_ms == null ? '' : ` · ${escapeHtml(t('motion.frame.time', { time: frame.timestamp_ms }))}`}
        ${frame.source_entry ? ` · ${escapeHtml(frame.source_entry)}` : ''}
      </p>
      <div class="motion-source-frame-card-actions">
        <button type="button" data-frame-action="up" data-index="${escapeHtml(index)}" data-candidate-index="${escapeHtml(frame.candidate_index ?? frame.source_index)}" ${index === 0 ? 'disabled' : ''}>${escapeHtml(t('motion.frame.up'))}</button>
        <button type="button" data-frame-action="down" data-index="${escapeHtml(index)}" data-candidate-index="${escapeHtml(frame.candidate_index ?? frame.source_index)}" ${index === frames.length - 1 ? 'disabled' : ''}>${escapeHtml(t('motion.frame.down'))}</button>
        <button type="button" data-frame-action="remove" data-index="${escapeHtml(index)}" data-candidate-index="${escapeHtml(frame.candidate_index ?? frame.source_index)}">${escapeHtml(t('motion.frame.remove'))}</button>
      </div>
    </article>
  `).join('')
  syncActionButtons()
  restoreFramePickerFocus(focus)
}

function renderFramePreviewIndex(index, indexUrl, handle) {
  state.motionSource.framePreviewIndexUrl = indexUrl
  state.motionSource.frameCandidates = Object.freeze(
    preservePreviewCandidates(index.frames ?? []).map((frame) => Object.freeze({
      ...frame,
      preview_url: previewUrlFor(indexUrl, frame.preview_file),
    }))
  )
  state.motionSource.frameSelection = restoreAutoFrameSelection(
    state.motionSource.frameCandidates
  )
  state.motionSource.previewBinding = {
    source_epoch: handle.epoch,
    source_identity: handle.sourceIdentity,
    operation_id: handle.operationId,
    options_hash: handle.optionsHash,
    candidate_fingerprint: handle.candidateFingerprint,
    frame_preview_index_url: indexUrl,
  }
  state.motionSource.reports.preview = index
  setSelectionMode(index.default_selection_mode ?? 'auto')
  renderFramePicker()
  renderGuidedMotionSource()
}

function resetMotionSourceDerivedState() {
  state.motionSource.stripUrl = null
  state.motionSource.frameCandidates = []
  state.motionSource.frameSelection = []
  state.motionSource.framePreviewIndexUrl = null
  state.motionSource.previewBinding = null
  state.motionSource.buildBinding = null
  for (const storeKey of Object.keys(state.motionSource.artifactErrors)) {
    state.motionSource.artifactErrors[storeKey] = {}
  }
  state.motionSource.applyResultStale = false
  state.motionSource.enginePackBinding = null
  state.motionSource.reports.analysis = null
  state.motionSource.reports.preview = null
  state.motionSource.reports.build = null
  state.motionSource.reports.apply = null
  state.motionSource.reports.enginePacks = null
  state.motionSource.jobs.analysis = null
  state.motionSource.jobs.preview = null
  state.motionSource.jobs.build = null
  state.motionSource.jobs.apply = null
  state.motionSource.jobs.enginePacks = null
  renderImage('#motion-source-frame-preview-sheet', null)
  renderImage('#motion-source-contact-sheet', null)
  renderImage('#motion-source-strip-preview', null)
  renderImage('#motion-source-apply-preview', state.motionSource.jobs.setApply?.applied_normalized_sheet_url ?? null)
  renderLinks({
    ...(state.motionSource.jobs.set ?? {}),
    ...(state.motionSource.jobs.setApply ?? {}),
  })
  renderJson('#motion-source-report', null)
  renderSelectedFrames(null)
  renderFramePicker()
  renderGuidedMotionSource()
}

function markMotionSettingsChanged() {
  renderGuidedMotionSource()
  syncActionButtons()
}

function loadVideoMetadata(file) {
  state.motionSource.sourceMeta = null
  renderSourceMeta()
  if (!file || !isVideoFile(file)) return
  const video = document.createElement('video')
  const url = URL.createObjectURL(file)
  video.preload = 'metadata'
  video.onloadedmetadata = () => {
    if (state.motionSource.sourceFile !== file) {
      URL.revokeObjectURL(url)
      return
    }
    state.motionSource.sourceMeta = {
      duration: Number.isFinite(video.duration) ? video.duration : null,
      width: video.videoWidth,
      height: video.videoHeight,
    }
    URL.revokeObjectURL(url)
    renderSourceMeta()
  }
  video.onerror = () => {
    URL.revokeObjectURL(url)
    if (state.motionSource.sourceFile !== file) return
    renderSourceMeta()
  }
  video.src = url
}

function renderSelectedFrames(selected = null) {
  const list = $('#motion-source-selected-list')
  if (!list) return
  const frames = selected?.selected ?? []
  if (!frames.length) {
    list.innerHTML = `<li>${escapeHtml(t('motion.frame.selectedEmpty'))}</li>`
    return
  }
  list.innerHTML = frames.map((frame) => `
    <li>
      <span>${escapeHtml(frame.output_index ?? frame.index ?? frames.indexOf(frame))}</span>
      ${escapeHtml(t('motion.frame.candidate', {
        index: frame.candidate_index ?? frame.original_index ?? frame.source_index ?? '—',
      }))}
      · ${escapeHtml(t('motion.frame.raw', {
        index: frame.raw_index ?? frame.original_index ?? '—',
      }))}
      ${frame.timestamp_ms == null ? '' : ` · ${escapeHtml(t('motion.frame.time', { time: frame.timestamp_ms }))}`}
    </li>
  `).join('')
}

function motionOperationMatches(handle, job = null) {
  if (!operationMatchesCurrentState(handle)) return false
  if (!job) return true
  if (job.id !== handle.jobId) return false
  if (!handle.bound) return true
  return job.operation_id === handle.operationId &&
    job.source_identity === handle.sourceIdentity &&
    job.options_hash === handle.optionsHash
}

function assertMotionJob(handle, job) {
  if (!job?.id || (handle.jobId && job.id !== handle.jobId)) {
    throw Object.assign(new Error('Motion job did not match the active UI operation.'), {
      code: 'motion_job_binding_mismatch',
    })
  }
  handle.jobId ??= job.id
  if (!handle.bound) return
  const optionsHash = job?.options_hash
  if (
    job.operation_id !== handle.operationId ||
    job.source_identity !== handle.sourceIdentity ||
    !/^sha256:[a-f0-9]{64}$/.test(optionsHash ?? '') ||
    (handle.optionsHash && handle.optionsHash !== optionsHash)
  ) {
    throw Object.assign(new Error('Motion job identity did not match the active source operation.'), {
      code: 'motion_source_binding_mismatch',
    })
  }
  handle.optionsHash ??= optionsHash
}

function assertBoundMotionArtifact(handle, artifact) {
  if (!handle?.bound) return
  if (
    !artifact ||
    artifact.operation_id !== handle.operationId ||
    artifact.source_identity !== handle.sourceIdentity ||
    artifact.options_hash !== handle.optionsHash
  ) {
    throw Object.assign(new Error('Motion artifact identity did not match the active source operation.'), {
      code: 'motion_source_binding_mismatch',
    })
  }
}

function renderCommittedMotionArtifacts() {
  const enginePackJob = motionEnginePackBindingCurrent(
    state.motionSource.enginePackBinding,
    {
      applyJob: state.motionSource.jobs.apply,
      applyResultStale: state.motionSource.applyResultStale,
      enginePackJob: state.motionSource.jobs.enginePacks,
    }
  )
    ? state.motionSource.jobs.enginePacks
    : {}
  renderLinks({
    ...(state.motionSource.jobs.analysis ?? {}),
    ...(state.motionSource.jobs.preview ?? {}),
    ...(state.motionSource.jobs.build ?? {}),
    ...(state.motionSource.jobs.apply ?? {}),
    ...enginePackJob,
    ...(state.motionSource.jobs.set ?? {}),
    ...(state.motionSource.jobs.setApply ?? {}),
  })
  renderImage(
    '#motion-source-frame-preview-sheet',
    state.motionSource.jobs.preview?.frame_preview_sheet_url,
    { storeKey: 'preview' }
  )
  renderImage(
    '#motion-source-contact-sheet',
    state.motionSource.jobs.build?.motion_contact_sheet_url,
    { storeKey: 'build' }
  )
  renderImage(
    '#motion-source-strip-preview',
    state.motionSource.jobs.build?.normalized_motion_strip_url ??
      state.motionSource.stripUrl,
    { storeKey: 'build' }
  )
  renderImage(
    '#motion-source-apply-preview',
    state.motionSource.jobs.setApply?.applied_normalized_sheet_url ??
      state.motionSource.jobs.apply?.applied_normalized_sheet_url,
    {
      storeKey: state.motionSource.jobs.setApply?.applied_normalized_sheet_url
        ? 'setApply'
        : 'apply',
    }
  )
}

async function renderMotionJob(job, handle, { signal } = {}) {
  if (!motionOperationMatches(handle, job)) return false

  try {
    const requiredArtifactsByStore = {
      analysis: ['motion_source_analysis_url'],
      preview: ['frame_preview_index_url', 'frame_preview_sheet_url'],
      build: [
        'motion_source_report_url',
        'selected_frames_url',
        'normalized_motion_strip_url',
      ],
      apply: ['apply_motion_strip_report_url', 'applied_normalized_sheet_url'],
      enginePacks: [
        'debug_report_url',
        'normalized_sheet_url',
        'animations_url',
        'metadata_url',
        'editor_metadata_url',
        'zip_url',
        'godot_npc_zip_url',
        'rpgmaker_zip_url',
        'ocad_zip_url',
      ],
      set: ['identity_consistency_report_url'],
      setApply: ['motion_source_set_apply_report_url', 'applied_normalized_sheet_url'],
    }
    const missingArtifact = (requiredArtifactsByStore[handle.storeKey] ?? [])
      .find((name) => !job[name])
    if (job.status === 'done' && missingArtifact) {
      throw new Error(`Motion job completed without ${missingArtifact}.`)
    }

    if (handle.storeKey === 'preview' && job.frame_preview_index_url) {
      const index = await fetchJsonArtifact(job.frame_preview_index_url, { signal })
      if (!motionOperationMatches(handle, job)) return false
      assertBoundMotionArtifact(handle, index)
      await fetchImageArtifact(job.frame_preview_sheet_url, { signal })
      if (!motionOperationMatches(handle, job)) return false
      clearArtifactError(handle.storeKey)
      handle.evidenceReport = index
      state.motionSource.jobs.preview = job
      renderJson('#motion-source-report', index)
      renderFramePreviewIndex(index, job.frame_preview_index_url, handle)
    } else if (handle.storeKey === 'build' && job.motion_source_report_url) {
      const report = await fetchJsonArtifact(job.motion_source_report_url, { signal })
      if (!motionOperationMatches(handle, job)) return false
      assertBoundMotionArtifact(handle, report)
      let selected = null
      if (job.selected_frames_url) {
        selected = await fetchJsonArtifact(job.selected_frames_url, { signal })
        if (!motionOperationMatches(handle, job)) return false
        assertBoundMotionArtifact(handle, selected)
      }
      await fetchImageArtifact(job.normalized_motion_strip_url, { signal })
      if (!motionOperationMatches(handle, job)) return false
      if (job.motion_contact_sheet_url) {
        await fetchImageArtifact(job.motion_contact_sheet_url, { signal })
        if (!motionOperationMatches(handle, job)) return false
      }
      clearArtifactError(handle.storeKey)
      state.motionSource.reports.build = report
      state.motionSource.buildBinding = {
        source_epoch: handle.epoch,
        source_identity: handle.sourceIdentity,
        operation_id: handle.operationId,
        options_hash: handle.optionsHash,
        build_fingerprint: handle.buildFingerprint,
      }
      state.motionSource.jobs.build = job
      state.motionSource.stripUrl = job.normalized_motion_strip_url ?? null
      markApplyResultStale()
      handle.evidenceReport = report
      renderJson('#motion-source-report', report)
      if (selected) renderSelectedFrames(selected)
    } else if (handle.storeKey === 'analysis' && job.motion_source_analysis_url) {
      const report = await fetchJsonArtifact(job.motion_source_analysis_url, { signal })
      if (!motionOperationMatches(handle, job)) return false
      assertBoundMotionArtifact(handle, report)
      clearArtifactError(handle.storeKey)
      state.motionSource.reports.analysis = report
      handle.evidenceReport = report
      renderJson('#motion-source-report', report)
      if (report.external_binary?.kind === 'ffmpeg') {
        const toolStatus = {
          ...state.motionSource.toolStatus,
          ffmpeg: report.external_binary,
        }
        state.motionSource.toolStatus = toolStatus
        renderToolStatus(toolStatus)
        syncSourceHint()
      }
      state.motionSource.jobs.analysis = job
    } else if (handle.storeKey === 'setApply' && job.motion_source_set_apply_report_url) {
      const report = await fetchJsonArtifact(job.motion_source_set_apply_report_url, { signal })
      if (!motionOperationMatches(handle, job)) return false
      await fetchImageArtifact(job.applied_normalized_sheet_url, { signal })
      if (!motionOperationMatches(handle, job)) return false
      clearArtifactError(handle.storeKey)
      clearArtifactError('apply')
      clearArtifactError('enginePacks')
      Object.assign(state.motionSource, buildMotionApplyContextCommit(
        state.motionSource,
        { kind: 'set', job, report }
      ))
      handle.evidenceReport = report
      renderJson('#motion-source-report', report)
    } else if (handle.storeKey === 'apply' && job.apply_motion_strip_report_url) {
      const report = await fetchJsonArtifact(job.apply_motion_strip_report_url, { signal })
      if (!motionOperationMatches(handle, job)) return false
      await fetchImageArtifact(job.applied_normalized_sheet_url, { signal })
      if (!motionOperationMatches(handle, job)) return false
      clearArtifactError(handle.storeKey)
      clearArtifactError('setApply')
      clearArtifactError('enginePacks')
      Object.assign(state.motionSource, buildMotionApplyContextCommit(
        state.motionSource,
        { kind: 'single', job, report }
      ))
      handle.evidenceReport = report
      renderJson('#motion-source-report', report)
    } else if (handle.storeKey === 'enginePacks' && job.debug_report_url) {
      const report = await fetchJsonArtifact(job.debug_report_url, { signal })
      if (!motionOperationMatches(handle, job)) return false
      await fetchImageArtifact(job.normalized_sheet_url, { signal })
      if (!motionOperationMatches(handle, job)) return false
      const binding = assertMotionEnginePackResult({
        job,
        debugReport: report,
        inputBinding: handle.enginePackInputBinding,
      })
      clearArtifactError(handle.storeKey)
      state.motionSource.reports.enginePacks = report
      state.motionSource.jobs.enginePacks = job
      state.motionSource.enginePackBinding = binding
      handle.evidenceReport = report
      renderJson('#motion-source-report', report)
    } else if (handle.storeKey === 'set' && job.identity_consistency_report_url) {
      const report = await fetchJsonArtifact(job.identity_consistency_report_url, { signal })
      if (!motionOperationMatches(handle, job)) return false
      clearArtifactError(handle.storeKey)
      state.motionSource.reports.set = report
      handle.evidenceReport = report
      renderJson('#motion-source-report', report)
      state.motionSource.jobs.set = job
    } else {
      state.motionSource.jobs[handle.storeKey] = job
    }
  } catch (error) {
    if (!motionOperationMatches(handle, job)) return false
    if (error?.code === 'motion_source_binding_mismatch') throw error
    const artifactError = setArtifactError(handle.storeKey, {
      reason: error.message || String(error),
      artifact_kind: 'artifact_fetch',
    })
    handle.artifactError = artifactError
    renderJson('#motion-source-report', artifactError)
  }
  renderCommittedMotionArtifacts()
  renderGuidedMotionSource()
  syncActionButtons()
  return true
}

function isUncertainTransportError(error) {
  return !isAbortError(error) &&
    !error?.status &&
    !error?.code &&
    (error instanceof TypeError || error instanceof SyntaxError)
}

function assertUploadedSourceDescriptor(descriptor, { file, operationId }) {
  if (
    !descriptor?.upload_id ||
    descriptor.operation_id !== operationId ||
    descriptor.source_name !== String(file.name || '').trim() ||
    descriptor.byte_length !== file.size ||
    !/^sha256:[a-f0-9]{64}$/.test(descriptor.source_identity ?? '')
  ) {
    throw Object.assign(new Error('Uploaded Motion source descriptor did not match the selected file.'), {
      code: 'motion_source_binding_mismatch',
    })
  }
}

async function ensureUploadedSource(epoch, signal) {
  const file = state.motionSource.sourceFile
  if (!file) throw new Error('Motion source file is required')
  if (state.motionSource.sourceDescriptor) return state.motionSource.sourceDescriptor
  const operationId = state.motionSource.sourceUploadOperationId ??
    createMotionOperationId('motion_upload_op')
  state.motionSource.sourceUploadOperationId = operationId
  setStatus('Uploading source', 'queued')
  const descriptor = await uploadMotionSource(file, {
    operationId,
    signal,
  })
  if (state.motionSource.sourceEpoch !== epoch || state.motionSource.sourceFile !== file) {
    queueMotionSourceUploadRelease({
      uploadId: descriptor.upload_id,
      operationId,
    })
    throw Object.assign(new Error('Motion source changed during upload.'), { name: 'AbortError' })
  }
  assertUploadedSourceDescriptor(descriptor, { file, operationId })
  state.motionSource.sourceDescriptor = descriptor
  renderSourceMeta()
  return descriptor
}

async function waitForUiOperation(handle, job, controller, { refreshFirst = false } = {}) {
  assertMotionJob(handle, job)
  handle.status = job.status
  const finalJob = await waitForMotionSourceJob(job, {
    signal: controller.signal,
    refreshFirst,
    onUpdate: (current) => {
      assertMotionJob(handle, current)
      if (!motionOperationMatches(handle, current)) return
      handle.status = current.status
      setStatus(`${handle.label}: ${current.status}`, current.status)
      syncActionButtons()
    },
  })
  assertMotionJob(handle, finalJob)
  if (!motionOperationMatches(handle, finalJob)) return null
  handle.status = finalJob.status
  await renderMotionJob(finalJob, handle, { signal: controller.signal })
  if (!motionOperationMatches(handle, finalJob)) return null
  return finalJob
}

function announceTerminalJob(handle, job) {
  if (job.status === 'done') {
    if (handle.artifactError) {
      setStatus(t('motion.evidence.blocked'), 'failed')
      showToast(t('motion.guide.evidenceUnavailable'))
      return
    }
    let evidence = null
    if (handle.storeKey === 'build') {
      evidence = mapMotionEvidence({
        job,
        report: handle.evidenceReport,
        bindingCurrent: buildBindingCurrent(),
        artifactError: handle.artifactError,
      })
    } else if (['analysis', 'apply', 'enginePacks', 'setApply'].includes(handle.storeKey)) {
      evidence = mapMotionReportOutcome({
        job,
        report: handle.evidenceReport,
        artifactError: handle.artifactError,
      })
    }
    if (evidence?.status === 'blocked') {
      setStatus(t('motion.evidence.blocked'), 'failed')
      showToast(t('motion.evidence.blocked'))
      return
    }
    if (evidence?.status === 'needs_review') {
      setStatus(t('motion.evidence.needsReview'), 'warning')
      showToast(t('motion.evidence.needsReview'))
      return
    }
    setStatus(`${handle.label}: done`, 'done')
    showToast(`${handle.label} done`)
    return
  }
  const cancelled = job.failure_status === 'cancelled' ||
    job.motion_source_lifecycle === 'cancelled'
  const message = cancelled
    ? `${handle.label}: cancelled`
    : (job.reason ?? `${handle.label} failed`)
  setStatus(message, 'failed')
  showToast(message)
}

function beginObservation(handle) {
  const controller = new AbortController()
  state.motionSource.observationController = controller
  state.motionSource.activeOperation = handle
  state.motionSource.resumableOperation = null
  return controller
}

function finishObservation(controller) {
  if (state.motionSource.observationController === controller) {
    state.motionSource.observationController = null
  }
  renderGuidedMotionSource()
  syncActionButtons()
}

function beginUiOperation(handle) {
  if (!claimUiOperation(handle)) {
    showToast('Finish, resume, or cancel the current Motion source operation first.')
    return null
  }
  const controller = beginObservation(handle)
  setStatus(`${handle.label}: queued`, 'queued')
  renderGuidedMotionSource()
  syncActionButtons()
  return controller
}

async function runJob(label, starter, storeKey, handleOptions = {}) {
  const handle = {
    bound: false,
    kind: 'generic',
    label,
    storeKey,
    starter,
    jobId: null,
    status: 'queued',
    ...handleOptions,
  }
  const controller = beginUiOperation(handle)
  if (!controller) return
  try {
    const initialJob = await starter(controller.signal)
    const job = await waitForUiOperation(handle, initialJob, controller)
    if (!job) return
    announceTerminalJob(handle, job)
    releaseUiOperation(handle)
  } catch (error) {
    const current = operationMatchesCurrentState(handle)
    if (error?.code === 'poll_timeout' && current && handle.jobId) {
      handle.status = error.job?.status ?? handle.status
      pauseUiOperation(handle, `${label}: polling paused`)
      showToast('Polling timed out. Resume continues the same job.')
    } else if (isAbortError(error)) {
      if (current && handle.jobId) {
        pauseUiOperation(handle, `${label}: observation stopped`)
      } else if (current) {
        releaseUiOperation(handle)
        setStatus(`${label}: request aborted`, 'failed')
        showToast(`${label}: request aborted`)
      }
    } else if (isUncertainTransportError(error) && current && handle.jobId) {
      pauseUiOperation(handle, `${label}: connection interrupted`)
      showToast('Connection interrupted. Resume continues the same job.')
    } else if (current) {
      releaseUiOperation(handle)
      setStatus(error.message || String(error), 'failed')
      showToast(error.message || String(error))
    }
  } finally {
    finishObservation(controller)
  }
}

async function runSourceJob(label, starter, storeKey, {
  optionsSnapshot = null,
} = {}) {
  let candidateFingerprint = null
  let buildFingerprint = null
  if (optionsSnapshot) {
    candidateFingerprint = motionCandidateFingerprint(optionsSnapshot)
    if (storeKey === 'build') {
      buildFingerprint = motionBuildFingerprint(optionsSnapshot)
    }
  }
  const handle = {
    bound: true,
    kind: 'source',
    epoch: state.motionSource.sourceEpoch,
    sourceIdentity: null,
    operationId: createMotionOperationId(`motion_${storeKey}_op`),
    optionsHash: null,
    label,
    storeKey,
    starter,
    optionsSnapshot,
    candidateFingerprint,
    buildFingerprint,
    jobId: null,
    status: 'queued',
  }
  const controller = beginUiOperation(handle)
  if (!controller) return
  try {
    const descriptor = await ensureUploadedSource(handle.epoch, controller.signal)
    if (!operationMatchesCurrentState(handle)) return
    handle.sourceIdentity = descriptor.source_identity
    const initialJob = await starter(descriptor, {
      operationId: handle.operationId,
      signal: controller.signal,
    })
    const job = await waitForUiOperation(handle, initialJob, controller)
    if (!job) return
    announceTerminalJob(handle, job)
    releaseUiOperation(handle)
  } catch (error) {
    const current = operationMatchesCurrentState(handle)
    if (error?.code === 'poll_timeout' && current && handle.jobId) {
      handle.status = error.job?.status ?? handle.status
      pauseUiOperation(handle, `${label}: polling paused`)
      showToast('Polling timed out. Resume continues the same job.')
    } else if (isAbortError(error)) {
      if (current && handle.status !== 'cancelling') {
        pauseUiOperation(handle, `${label}: observation stopped`)
      }
    } else if (isUncertainTransportError(error) && current) {
      pauseUiOperation(handle, `${label}: request outcome unknown`)
      showToast('The request outcome is unknown. Resume retries the same operation id.')
    } else if (current) {
      if (
        !handle.sourceIdentity ||
        error?.status === 404 ||
        error?.code === 'source_identity_mismatch'
      ) {
        state.motionSource.sourceDescriptor = null
        state.motionSource.sourceUploadOperationId = null
        renderSourceMeta()
      }
      releaseUiOperation(handle)
      setStatus(error.message || String(error), 'failed')
      showToast(error.message || String(error))
    }
  } finally {
    finishObservation(controller)
  }
}

async function resumeMotionJob() {
  const handle = state.motionSource.resumableOperation
  if (!operationMatchesCurrentState(handle)) {
    if (state.motionSource.uiOperation === handle) releaseUiOperation(handle)
    syncActionButtons()
    return
  }
  const controller = beginObservation(handle)
  setStatus(`${handle.label}: resuming`, 'queued')
  renderGuidedMotionSource()
  syncActionButtons()
  try {
    let job
    if (!handle.jobId) {
      if (!handle.bound) throw new Error('This Motion operation cannot be recovered without a job id.')
      const descriptor = await ensureUploadedSource(handle.epoch, controller.signal)
      if (!operationMatchesCurrentState(handle)) return
      if (handle.sourceIdentity && handle.sourceIdentity !== descriptor.source_identity) {
        throw Object.assign(new Error('Motion source identity changed before operation recovery.'), {
          code: 'motion_source_binding_mismatch',
        })
      }
      handle.sourceIdentity = descriptor.source_identity
      const initialJob = await handle.starter(descriptor, {
        operationId: handle.operationId,
        signal: controller.signal,
      })
      job = await waitForUiOperation(handle, initialJob, controller)
    } else {
      const knownJob = {
        id: handle.jobId,
        status: handle.status,
        ...(handle.bound ? {
          operation_id: handle.operationId,
          source_identity: handle.sourceIdentity,
          options_hash: handle.optionsHash,
        } : {}),
      }
      job = await waitForUiOperation(handle, knownJob, controller, { refreshFirst: true })
    }
    if (!job) return
    announceTerminalJob(handle, job)
    releaseUiOperation(handle)
  } catch (error) {
    const current = operationMatchesCurrentState(handle)
    if (error?.code === 'poll_timeout' && current) {
      handle.status = error.job?.status ?? handle.status
      pauseUiOperation(handle, `${handle.label}: polling paused`)
      showToast('Polling timed out. Resume continues the same job.')
    } else if (isAbortError(error)) {
      if (current && handle.status !== 'cancelling') {
        pauseUiOperation(handle, `${handle.label}: observation stopped`)
      }
    } else if (isUncertainTransportError(error) && current) {
      pauseUiOperation(handle, `${handle.label}: request outcome unknown`)
      showToast('The request outcome is unknown. Resume retries the same operation id.')
    } else if (current) {
      if (
        (handle.bound && !handle.sourceIdentity) ||
        error?.status === 404 ||
        error?.code === 'source_identity_mismatch'
      ) {
        state.motionSource.sourceDescriptor = null
        state.motionSource.sourceUploadOperationId = null
        renderSourceMeta()
      }
      releaseUiOperation(handle)
      setStatus(error.message || String(error), 'failed')
      showToast(error?.status === 404
        ? 'Motion server session expired. Upload the selected source again.'
        : (error.message || String(error)))
    }
  } finally {
    finishObservation(controller)
  }
}

async function cancelActiveSourceJob() {
  const handle = state.motionSource.activeOperation ?? state.motionSource.resumableOperation
  if (
    !handle?.bound ||
    !handle.jobId ||
    !operationMatchesCurrentState(handle) ||
    handle.status === 'cancelling' ||
    TERMINAL_JOB_STATUSES.has(handle.status)
  ) {
    return
  }
  state.motionSource.activeOperation = handle
  state.motionSource.resumableOperation = null
  handle.status = 'cancelling'
  abortMotionObservation()
  setStatus(`${handle.label}: cancelling`, 'queued')
  renderGuidedMotionSource()
  syncActionButtons()
  try {
    const job = await cancelMotionSourceJob(handle.jobId)
    assertMotionJob(handle, job)
    if (!motionOperationMatches(handle, job)) return
    handle.status = job.status
    await renderMotionJob(job, handle)
    if (!motionOperationMatches(handle, job)) return
    announceTerminalJob(handle, job)
    releaseUiOperation(handle)
  } catch (error) {
    if (!operationMatchesCurrentState(handle)) return
    if (error?.status === 404) {
      state.motionSource.sourceDescriptor = null
      state.motionSource.sourceUploadOperationId = null
      releaseUiOperation(handle)
      setStatus('Motion server session expired.', 'failed')
      showToast('Motion server session expired. Upload the selected source again.')
      renderSourceMeta()
    } else {
      pauseUiOperation(handle, `${handle.label}: cancellation outcome unknown`)
      showToast(`${error.message || String(error)} Resume polling to inspect the existing job.`)
    }
  } finally {
    syncActionButtons()
  }
}

function bindFileInputs() {
  $('#motion-source-file').addEventListener('change', (event) => {
    const priorDescriptor = state.motionSource.sourceDescriptor
    const priorUploadOperationId = state.motionSource.sourceUploadOperationId
    abortMotionObservation()
    invalidateUiOperation()
    state.motionSource.sourceEpoch += 1
    state.motionSource.sourceFile = event.currentTarget.files?.[0] ?? null
    state.motionSource.sourceDescriptor = null
    state.motionSource.sourceUploadOperationId = null
    resetMotionSourceDerivedState()
    setSelectionMode('auto')
    setStatus('waiting', 'idle')
    loadVideoMetadata(state.motionSource.sourceFile)
    syncSourceHint()
    queueMotionSourceUploadRelease({
      uploadId: priorDescriptor?.upload_id ?? null,
      operationId: priorUploadOperationId,
    })
  })
  $('#motion-source-sheet-file').addEventListener('change', (event) => {
    state.motionSource.sheetFile = event.currentTarget.files?.[0] ?? null
    markApplyResultStale()
    renderGuidedMotionSource()
    syncActionButtons()
  })
  $('#motion-source-strip-file').addEventListener('change', (event) => {
    state.motionSource.stripFile = event.currentTarget.files?.[0] ?? null
    markApplyResultStale()
    renderGuidedMotionSource()
    syncActionButtons()
  })
  $('#motion-source-manifest-file').addEventListener('change', (event) => {
    state.motionSource.manifestFile = event.currentTarget.files?.[0] ?? null
    syncActionButtons()
  })
  $('#motion-source-set-strip-files').addEventListener('change', (event) => {
    state.motionSource.setStripFiles = [...(event.currentTarget.files ?? [])]
    syncActionButtons()
  })
}

function bindOptionControls() {
  for (const selector of ['#motion-source-tolerance', '#motion-source-static-offset-y']) {
    $(selector).addEventListener('input', () => {
      $(`${selector}-value`).textContent = $(selector).value
      if (selector === '#motion-source-tolerance') {
        copyControlValue(selector, '#motion-guide-tolerance')
      }
      markMotionSettingsChanged()
    })
  }
  for (const button of document.querySelectorAll('[data-motion-key-color]')) {
    button.addEventListener('click', () => {
      if (state.motionSource.uiOperation) return
      $('#motion-source-key-color').value = button.dataset.motionKeyColor
      markMotionSettingsChanged()
    })
  }
  for (const selector of [
    '#motion-source-action',
    '#motion-source-target-frames',
    '#motion-source-stride',
    '#motion-source-fps',
    '#motion-source-start-sec',
    '#motion-source-end-sec',
    '#motion-source-max-frames',
    '#motion-source-background-method',
    '#motion-source-key-color',
    '#motion-source-defringe',
    '#motion-source-pixel-grid-recipe',
    '#motion-source-resample-strategy',
  ]) {
    const control = $(selector)
    const eventName = control?.type === 'range' || control?.type === 'number' || control?.type === 'text'
      ? 'input'
      : 'change'
    control?.addEventListener(eventName, () => {
      syncGuidedControlsFromAdvanced()
      if (
        selector === '#motion-source-action' ||
        selector === '#motion-source-resample-strategy'
      ) {
        markApplyResultStale()
      }
      markMotionSettingsChanged()
    })
  }
  $('#motion-source-selection-recipe').addEventListener('change', () => {
    syncMotionSelectionDependencies()
    markMotionSettingsChanged()
  })
  for (const selector of [
    '#motion-source-loop-expectation',
    '#motion-source-temporal-matte',
  ]) {
    $(selector).addEventListener('change', markMotionSettingsChanged)
  }
  $('#motion-source-selection-mode').addEventListener('change', (event) => {
    if (state.motionSource.uiOperation) {
      event.currentTarget.value = selectionMode()
      return
    }
    setSelectionMode(event.currentTarget.value, {
      clearManual: event.currentTarget.value === 'auto',
    })
    renderFramePicker()
  })

  const restoreAutomaticSelection = () => {
    if (state.motionSource.uiOperation) return
    setSelectionMode('auto')
    renderFramePicker()
    setStatus(t('motion.frame.restoredAuto'), 'idle')
  }
  $('#motion-source-restore-auto').addEventListener('click', restoreAutomaticSelection)
  $('#motion-guide-restore-auto').addEventListener('click', restoreAutomaticSelection)

  const bindGuidedValue = (
    guidedSelector,
    advancedSelector,
    eventName = 'change',
    onChange = markMotionSettingsChanged
  ) => {
    $(guidedSelector)?.addEventListener(eventName, (event) => {
      if (state.motionSource.uiOperation) {
        copyControlValue(advancedSelector, guidedSelector)
        return
      }
      const advanced = $(advancedSelector)
      if (!advanced) return
      if (event.currentTarget.type === 'checkbox') {
        advanced.checked = event.currentTarget.checked
      } else {
        advanced.value = event.currentTarget.value
      }
      onChange(event)
    })
  }

  bindGuidedValue('#motion-guide-action', '#motion-source-action', 'change', (event) => {
    const action = motionAction(event.currentTarget.value)
    if (action) {
      $('#motion-source-target-frames').value = String(action.count)
      $('#motion-guide-target').value = String(action.count)
    }
    markApplyResultStale()
    markMotionSettingsChanged()
  })
  bindGuidedValue('#motion-guide-target', '#motion-source-target-frames', 'input')
  bindGuidedValue('#motion-guide-selection-recipe', '#motion-source-selection-recipe', 'change', () => {
    syncMotionSelectionDependencies()
    markMotionSettingsChanged()
  })
  bindGuidedValue('#motion-guide-loop-expectation', '#motion-source-loop-expectation')
  bindGuidedValue('#motion-guide-temporal-matte', '#motion-source-temporal-matte')
  bindGuidedValue('#motion-guide-background-method', '#motion-source-background-method')
  bindGuidedValue('#motion-guide-tolerance', '#motion-source-tolerance', 'input', (event) => {
    $('#motion-source-tolerance-value').textContent = event.currentTarget.value
    $('#motion-guide-tolerance-value').textContent = event.currentTarget.value
    markMotionSettingsChanged()
  })
  bindGuidedValue('#motion-guide-pixel-grid-recipe', '#motion-source-pixel-grid-recipe')
  bindGuidedValue('#motion-guide-resample', '#motion-source-resample-strategy', 'change', () => {
    markApplyResultStale()
    markMotionSettingsChanged()
  })
  $('#motion-guide-selection-mode').addEventListener('change', (event) => {
    if (state.motionSource.uiOperation) {
      event.currentTarget.value = selectionMode()
      return
    }
    setSelectionMode(event.currentTarget.value, {
      clearManual: event.currentTarget.value === 'auto',
    })
    renderFramePicker()
  })

  $('#motion-source-view-guided')?.addEventListener('click', () => {
    setMotionView('guided')
  })
  $('#motion-source-view-advanced')?.addEventListener('click', () => {
    setMotionView('advanced')
  })
  $('#motion-guide-open-advanced')?.addEventListener('click', () => {
    setMotionView('advanced', { focus: true })
  })
  $('#motion-guide-open-artifacts')?.addEventListener('click', () => {
    const artifacts = $('#motion-source-artifacts')
    artifacts?.focus({ preventScroll: true })
    artifacts?.scrollIntoView({ block: 'start', behavior: 'auto' })
  })
  $('#motion-guide-choose-source')?.addEventListener('click', () => {
    if (!state.motionSource.uiOperation) $('#motion-source-file').click()
  })
  $('#motion-guide-choose-sheet')?.addEventListener('click', () => {
    if (!state.motionSource.uiOperation) $('#motion-source-sheet-file').click()
  })

  $('#motion-source-frame-picker').addEventListener('change', (event) => {
    if (state.motionSource.uiOperation) return
    const action = event.target?.dataset?.frameAction
    if (action !== 'toggle') return
    const index = Number(event.target.dataset.index)
    if (!state.motionSource.frameSelection[index]) return
    const focus = framePickerFocusDescriptor()
    setSelectionMode('manual', { clearManual: false })
    state.motionSource.frameSelection[index].selected = event.target.checked
    renderFramePicker({ focus })
    setStatus(t('motion.frame.manualUpdated'), 'idle')
  })
  $('#motion-source-frame-picker').addEventListener('click', (event) => {
    if (state.motionSource.uiOperation) return
    const action = event.target?.dataset?.frameAction
    if (!action || action === 'toggle') return
    const index = Number(event.target.dataset.index)
    const frames = state.motionSource.frameSelection
    if (!frames[index]) return
    const candidateIndex = frames[index].candidate_index ?? frames[index].source_index
    let focus = { action, candidateIndex }
    setSelectionMode('manual', { clearManual: false })
    if (action === 'remove') {
      frames.splice(index, 1)
      const nearest = frames[Math.min(index, frames.length - 1)]
      focus = nearest
        ? {
            action: 'toggle',
            candidateIndex: nearest.candidate_index ?? nearest.source_index,
          }
        : { action: 'restore', candidateIndex: -1 }
    } else if (action === 'up' && index > 0) {
      const [frame] = frames.splice(index, 1)
      frames.splice(index - 1, 0, frame)
    } else if (action === 'down' && index < frames.length - 1) {
      const [frame] = frames.splice(index, 1)
      frames.splice(index + 1, 0, frame)
    }
    renderFramePicker({ focus })
    setStatus(
      t(action === 'remove' ? 'motion.frame.removed' : 'motion.frame.moved'),
      'idle'
    )
  })

  $('#language-select')?.addEventListener('change', () => {
    syncMotionSelectionDependencies()
    renderSelectedFrames(state.motionSource.reports.build?.frame_selection ?? null)
    renderFramePicker({ focus: framePickerFocusDescriptor() })
    renderGuidedMotionSource()
  })
}

function motionOptionsForAction() {
  try {
    return snapshotMotionOptions()
  } catch (error) {
    const message = error?.message || String(error)
    setStatus(message, 'failed')
    showToast(message)
    return null
  }
}

function startMotionAnalysis() {
  return runSourceJob(
    'Analyze source',
    (source, request) => analyzeMotionSource(source, request),
    'analysis'
  )
}

function startMotionPreview() {
  const options = motionOptionsForAction()
  if (!options) return null
  return runSourceJob(
    'Preview frames',
    (source, request) => previewMotionFrames(source, options, request),
    'preview',
    { optionsSnapshot: options }
  )
}

function startMotionBuild({ guided = false } = {}) {
  const options = motionOptionsForAction()
  if (!options) return null
  const hasManualFrames = state.motionSource.frameSelection.some((frame) => frame.selected)
  const requiresCurrentPreview = guided || selectionMode() === 'manual'
  if (
    requiresCurrentPreview &&
    (
      !previewBindingCurrent(options) ||
      artifactErrorFor('preview') ||
      (selectionMode() === 'manual' && !hasManualFrames)
    )
  ) {
    const message = t('motion.guide.previewRequired')
    setStatus(message, 'warning')
    showToast(message)
    syncActionButtons()
    return null
  }
  return runSourceJob(
    'Build strip',
    (source, request) => buildMotionStrip(source, options, request),
    'build',
    { optionsSnapshot: options }
  )
}

function startMotionApply() {
  const options = motionOptionsForAction()
  if (!options) return null
  const compatibility = currentApplyCompatibility(options)
  if (!compatibility.allowed) {
    const message = compatibility.reason === 'target_frame_count_mismatch'
      ? t('motion.guide.applyMismatch')
      : compatibility.reason === 'latest_build_stale'
        ? t('motion.guide.buildStale')
        : t('motion.guide.evidenceUnavailable')
    setStatus(message, 'warning')
    showToast(message)
    syncActionButtons()
    return null
  }
  const payload = {
    sheetFile: state.motionSource.sheetFile,
    stripFile: state.motionSource.stripFile,
    stripUrl: state.motionSource.stripUrl,
    options,
  }
  return runJob(
    'Apply strip',
    (signal) => applyMotionStrip(payload, { signal }),
    'apply'
  )
}

function startMotionEnginePacks() {
  const readiness = motionEnginePackExportReadiness({
    applyJob: state.motionSource.jobs.apply,
    applyReport: state.motionSource.reports.apply,
    applyResultStale: state.motionSource.applyResultStale,
    applyArtifactError: artifactErrorFor('apply'),
    enginePackBinding: state.motionSource.enginePackBinding,
    enginePackJob: state.motionSource.jobs.enginePacks,
  })
  if (!readiness.ready) {
    const message = t('motion.guide.enginePacksUnavailable')
    setStatus(message, 'warning')
    showToast(message)
    syncActionButtons()
    return null
  }
  const payload = {
    applyJob: state.motionSource.jobs.apply,
    applyReport: state.motionSource.reports.apply,
    applyResultStale: state.motionSource.applyResultStale,
    applyArtifactError: artifactErrorFor('apply'),
  }
  return runJob(
    t('motion.guide.enginePacks.action'),
    (signal) => buildMotionEnginePacksFromAppliedSheet(payload, { signal }),
    'enginePacks',
    { enginePackInputBinding: readiness.binding }
  )
}

export function initMotionSourceTab() {
  if (!$('#motion-source')) return
  populateMotionActions()
  const initialAction = motionAction('walk_down') ?? TOPDOWN_RPG_V0.animations[0]
  $('#motion-source-action').value = initialAction.name
  $('#motion-source-target-frames').value = String(initialAction.count)
  $('#motion-source-selection-recipe').value = 'motion_selection_recipe_v2'
  $('#motion-source-loop-expectation').value = 'auto'
  $('#motion-source-temporal-matte').value = 'disabled'
  syncGuidedControlsFromAdvanced()
  bindFileInputs()
  bindOptionControls()
  $('#motion-source-analyze').addEventListener('click', startMotionAnalysis)
  $('#motion-guide-analyze').addEventListener('click', startMotionAnalysis)
  $('#motion-source-preview-frames').addEventListener('click', startMotionPreview)
  $('#motion-guide-preview').addEventListener('click', startMotionPreview)
  $('#motion-source-build-strip').addEventListener('click', () => startMotionBuild())
  $('#motion-guide-build').addEventListener('click', () => startMotionBuild({ guided: true }))
  $('#motion-source-apply-strip').addEventListener('click', startMotionApply)
  $('#motion-guide-apply').addEventListener('click', startMotionApply)
  $('#motion-source-build-engine-packs').addEventListener('click', startMotionEnginePacks)
  $('#motion-guide-build-engine-packs').addEventListener('click', startMotionEnginePacks)
  $('#motion-source-analyze-set').addEventListener('click', () => {
    const payload = {
      manifestFile: state.motionSource.manifestFile,
      stripFiles: [...state.motionSource.setStripFiles],
    }
    return runJob(
      'Analyze source set',
      (signal) => analyzeMotionSourceSet(payload, { signal }),
      'set'
    )
  })
  $('#motion-source-apply-set').addEventListener('click', () => {
    const payload = {
      sheetFile: state.motionSource.sheetFile,
      manifestFile: state.motionSource.manifestFile,
      stripFiles: [...state.motionSource.setStripFiles],
      options: snapshotMotionOptions(),
    }
    return runJob(
      'Apply source set',
      (signal) => applyMotionSourceSet(payload, { signal }),
      'setApply'
    )
  })
  $('#motion-source-cancel').addEventListener('click', cancelActiveSourceJob)
  $('#motion-guide-cancel').addEventListener('click', cancelActiveSourceJob)
  $('#motion-source-resume').addEventListener('click', resumeMotionJob)
  $('#motion-guide-resume').addEventListener('click', resumeMotionJob)
  renderLinks({})
  renderJson('#motion-source-report', null)
  renderSelectedFrames(null)
  renderFramePicker()
  fetchMotionSourceToolStatus()
    .then((status) => {
      state.motionSource.toolStatus = status
      renderToolStatus(status)
      syncSourceHint()
    })
    .catch(() => {
      const status = {
        ffmpeg: { available: false },
        rembg: { available: false },
      }
      state.motionSource.toolStatus = status
      renderToolStatus(status)
      syncSourceHint()
    })
  renderSourceMeta()
  setSelectionMode('auto')
  syncMotionSelectionDependencies()
  setMotionView('guided')
  renderGuidedMotionSource()
  syncSourceHint()
}
