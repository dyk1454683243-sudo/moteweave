const VIDEO_EXT = /\.(mp4|mov|webm|mkv|avi|m4v)$/i
const GIF_ZIP_EXT = /\.(gif|zip)$/i
const SHA256_IDENTITY = /^sha256:[a-f0-9]{64}$/

export const MOTION_SOURCE_BYTE_LIMITS = Object.freeze({
  raster: 32 * 1024 * 1024,
  gifZip: 64 * 1024 * 1024,
  video: 200 * 1024 * 1024,
})

export const MOTION_TERMINAL_JOB_STATUSES = Object.freeze([
  'done',
  'failed_post_processing',
  'failed_model_error',
  'failed_safety_filter',
])

const TERMINAL_JOB_STATUS_SET = new Set(MOTION_TERMINAL_JOB_STATUSES)

export const MOTION_REQUIRED_ARTIFACTS = Object.freeze({
  analysis: Object.freeze(['motion_source_analysis_url']),
  preview: Object.freeze(['frame_preview_index_url', 'frame_preview_sheet_url']),
  build: Object.freeze([
    'motion_source_report_url',
    'selected_frames_url',
    'normalized_motion_strip_url',
  ]),
  apply: Object.freeze([
    'apply_motion_strip_report_url',
    'applied_normalized_sheet_url',
  ]),
  set: Object.freeze(['identity_consistency_report_url']),
  setApply: Object.freeze([
    'motion_source_set_apply_report_url',
    'applied_normalized_sheet_url',
  ]),
})

function motionBindingError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details })
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

export function isMotionSha256(value) {
  return typeof value === 'string' && SHA256_IDENTITY.test(value)
}

export function isMotionVideoFile(file) {
  return Boolean(
    file && (
      (file.name && VIDEO_EXT.test(file.name)) ||
      String(file.type || '').toLowerCase().startsWith('video/')
    )
  )
}

export function isMotionGifOrZipFile(file) {
  const type = String(file?.type || '').toLowerCase()
  return Boolean(
    file && (
      (file.name && GIF_ZIP_EXT.test(file.name)) ||
      type === 'image/gif' ||
      type === 'application/zip' ||
      type === 'application/x-zip-compressed'
    )
  )
}

export function motionSourceByteLimit(file) {
  if (isMotionVideoFile(file)) return MOTION_SOURCE_BYTE_LIMITS.video
  if (isMotionGifOrZipFile(file)) return MOTION_SOURCE_BYTE_LIMITS.gifZip
  return MOTION_SOURCE_BYTE_LIMITS.raster
}

export function isMotionSourceTooLarge(file) {
  return Boolean(file && file.size > motionSourceByteLimit(file))
}

/**
 * Verifies the server descriptor against the exact local File-like input and
 * operation id. The descriptor is returned unchanged so callers cannot
 * accidentally replace authoritative server fields with a client projection.
 */
export function assertUploadedMotionSourceDescriptor(descriptor, { file, operationId } = {}) {
  const sourceName = String(file?.name || '').trim()
  const byteLength = file?.size
  if (
    !nonEmptyString(descriptor?.upload_id) ||
    !nonEmptyString(operationId) ||
    descriptor.operation_id !== operationId ||
    !sourceName ||
    descriptor.source_name !== sourceName ||
    !Number.isSafeInteger(byteLength) ||
    byteLength < 0 ||
    descriptor.byte_length !== byteLength ||
    !isMotionSha256(descriptor.source_identity)
  ) {
    throw motionBindingError(
      'motion_source_binding_mismatch',
      'Uploaded Motion source descriptor did not match the selected file.'
    )
  }
  return descriptor
}

/**
 * Pure equivalent of the legacy operation-current check. Every piece of
 * mutable state is supplied explicitly by the caller.
 */
export function isMotionOperationCurrent(handle, current = {}) {
  if (!handle) return false
  if (handle.bound !== true && handle.bound !== false) return false
  if (current.uiOperation !== handle) return false
  if (current.renderToken !== handle.renderToken) return false
  if (handle.bound === false) return true
  if (current.sourceEpoch !== handle.epoch) return false
  if (!current.sourceFile) return false
  if (
    handle.sourceIdentity &&
    current.sourceDescriptor?.source_identity !== handle.sourceIdentity
  ) {
    return false
  }
  return true
}

/**
 * Binds a job response without mutating the caller's operation handle.
 * Bound source jobs require the complete operation/source/options identity.
 */
export function assertMotionJobBinding(handle, job) {
  if (
    !handle ||
    (handle.bound !== true && handle.bound !== false) ||
    !nonEmptyString(job?.id) ||
    (handle.jobId && job.id !== handle.jobId)
  ) {
    throw motionBindingError(
      'motion_job_binding_mismatch',
      'Motion job did not match the active UI operation.'
    )
  }

  const next = { ...handle, jobId: handle.jobId ?? job.id }
  if (handle.bound === false) return Object.freeze(next)

  if (
    !nonEmptyString(handle.operationId) ||
    !isMotionSha256(handle.sourceIdentity) ||
    job.operation_id !== handle.operationId ||
    job.source_identity !== handle.sourceIdentity ||
    !isMotionSha256(job.options_hash) ||
    (handle.optionsHash && handle.optionsHash !== job.options_hash)
  ) {
    throw motionBindingError(
      'motion_source_binding_mismatch',
      'Motion job identity did not match the active source operation.'
    )
  }

  next.optionsHash = handle.optionsHash ?? job.options_hash
  return Object.freeze(next)
}

// Compatibility alias for callers that prefer the returned-value semantics in
// the function name. Both exports are pure and return the same frozen snapshot.
export const bindMotionJob = assertMotionJobBinding

export function motionJobMatchesOperation(handle, current, job) {
  if (!isMotionOperationCurrent(handle, current)) return false
  if (!nonEmptyString(job?.id) || job.id !== handle.jobId) return false
  if (handle.bound === false) return true
  return nonEmptyString(handle.operationId) &&
    isMotionSha256(handle.sourceIdentity) &&
    isMotionSha256(handle.optionsHash) &&
    job.operation_id === handle.operationId &&
    job.source_identity === handle.sourceIdentity &&
    job.options_hash === handle.optionsHash
}

export function assertBoundMotionArtifact(handle, artifact) {
  if (
    !handle?.bound ||
    !nonEmptyString(handle.operationId) ||
    !isMotionSha256(handle.sourceIdentity) ||
    !isMotionSha256(handle.optionsHash) ||
    !artifact ||
    artifact.operation_id !== handle.operationId ||
    artifact.source_identity !== handle.sourceIdentity ||
    artifact.options_hash !== handle.optionsHash
  ) {
    throw motionBindingError(
      'motion_source_binding_mismatch',
      'Motion artifact identity did not match the active source operation.'
    )
  }
  return artifact
}

export const assertMotionArtifactBinding = assertBoundMotionArtifact

export function requiredMotionArtifacts(storeKey) {
  if (!Object.hasOwn(MOTION_REQUIRED_ARTIFACTS, storeKey)) {
    throw motionBindingError(
      'motion_job_store_unknown',
      `Unknown Motion job artifact store: ${String(storeKey)}`,
      { storeKey }
    )
  }
  return MOTION_REQUIRED_ARTIFACTS[storeKey]
}

export function missingMotionJobArtifact(job, storeKey) {
  return requiredMotionArtifacts(storeKey).find((name) => !job?.[name]) ?? null
}

/**
 * Mirrors the legacy completion gate: artifacts are mandatory only after the
 * job reports done. An unknown store key is always rejected.
 */
export function assertMotionJobCompletionArtifacts(job, storeKey) {
  const missing = missingMotionJobArtifact(job, storeKey)
  if (job?.status === 'done' && missing) {
    throw motionBindingError(
      'motion_job_artifact_missing',
      `Motion job completed without ${missing}.`,
      { storeKey, artifact: missing }
    )
  }
  return job
}

function optionValue(options, serializedName, modelName) {
  return options?.[serializedName] ?? options?.[modelName]
}

function backgroundMethod(options) {
  return options?.background?.method ?? options?.backgroundMethod ?? null
}

function selectionRecipe(options) {
  return options?.motion_selection?.recipe ??
    options?.selection_recipe ??
    options?.selectionRecipe ??
    null
}

/**
 * Derives all Action control gates from an explicit immutable-style snapshot.
 * Missing evidence disables dependent actions. No DOM or application singleton
 * is read, and the returned facts/control map is frozen.
 */
export function deriveMotionControlAvailability({
  sourceFile = null,
  uiBusy = false,
  frameSelection = [],
  sheetFile = null,
  manifestFile = null,
  sourceSetStripFiles = [],
  toolStatus = null,
  options = null,
  binding = null,
  previewCurrent = false,
  previewArtifactError = null,
  applyCompatibility = null,
  frameCandidates = [],
  activeOperation = null,
  resumableOperation = null,
  operationContext = null,
} = {}) {
  const hasSource = Boolean(sourceFile)
  const sourceBlocked = isMotionSourceTooLarge(sourceFile)
  const busy = Boolean(uiBusy)
  const hasManualFrames = Array.isArray(frameSelection) &&
    frameSelection.some((frame) => Boolean(frame?.selected))
  const hasSheet = Boolean(sheetFile)
  const hasManifest = Boolean(manifestFile)
  const hasSourceSetStrips = Array.isArray(sourceSetStripFiles) &&
    sourceSetStripFiles.length > 0
  const videoToolBlocked = isMotionVideoFile(sourceFile) &&
    toolStatus?.ffmpeg?.available !== true
  const rembgToolBlocked = backgroundMethod(options) === 'external_rembg' &&
    toolStatus?.rembg?.available !== true
  const previewOptionsValid = Boolean(
    binding?.candidate_fingerprint ?? binding?.candidateFingerprint
  )
  const buildOptionsValid = Boolean(
    binding?.build_fingerprint ?? binding?.buildFingerprint
  )
  const currentPreview = previewCurrent === true
  const previewArtifactBlocked = Boolean(previewArtifactError)
  const manualBlocked = optionValue(options, 'selection_mode', 'selectionMode') === 'manual' && (
    !hasManualFrames ||
    !currentPreview ||
    previewArtifactBlocked
  )
  const applyAllowed = applyCompatibility?.allowed === true
  const hasFrameCandidates = Array.isArray(frameCandidates) && frameCandidates.length > 0

  const cancellable = activeOperation ?? resumableOperation
  const operationSnapshot = operationContext ?? {}
  const cancel = Boolean(
    cancellable?.bound === true &&
    nonEmptyString(cancellable.jobId) &&
    isMotionOperationCurrent(cancellable, operationSnapshot) &&
    cancellable.status !== 'cancelling' &&
    !TERMINAL_JOB_STATUS_SET.has(cancellable.status)
  )
  const resume = isMotionOperationCurrent(resumableOperation, operationSnapshot) && (
    resumableOperation?.bound === true || nonEmptyString(resumableOperation?.jobId)
  )

  const analyze = hasSource && !sourceBlocked && !busy
  const previewFrames = hasSource &&
    !sourceBlocked &&
    !busy &&
    !videoToolBlocked &&
    previewOptionsValid
  const buildStrip = hasSource &&
    !sourceBlocked &&
    !busy &&
    !videoToolBlocked &&
    !rembgToolBlocked &&
    buildOptionsValid &&
    !manualBlocked
  const applyStrip = !busy && hasSheet && applyAllowed
  const analyzeSet = !busy && hasManifest && hasSourceSetStrips
  const applySet = !busy && hasSheet && hasManifest && hasSourceSetStrips
  const selectionV1 = selectionRecipe(options) ===
    'motion_selection_v1_compat'

  const facts = Object.freeze({
    hasSource,
    sourceBlocked,
    busy,
    hasManualFrames,
    hasSheet,
    hasManifest,
    hasSourceSetStrips,
    videoToolBlocked,
    rembgToolBlocked,
    previewOptionsValid,
    buildOptionsValid,
    previewCurrent: currentPreview,
    previewArtifactBlocked,
    manualBlocked,
    applyAllowed,
    hasFrameCandidates,
    selectionV1,
  })
  const controls = Object.freeze({
    analyze,
    previewFrames,
    buildStrip,
    applyStrip,
    analyzeSet,
    applySet,
    cancel,
    resume,
    guidedAnalyze: analyze,
    guidedPreview: previewFrames,
    guidedBuild: buildStrip && currentPreview && !previewArtifactBlocked,
    guidedApply: applyStrip,
    restoreAuto: !busy && hasFrameCandidates,
    chooseSource: !busy,
    chooseSheet: !busy,
    requestOptions: !busy,
    guidedOptions: !busy,
    keyColorPresets: !busy,
    loopExpectation: !busy && !selectionV1,
    temporalMatte: !busy && !selectionV1,
    navigation: true,
  })

  return Object.freeze({ facts, controls })
}

export function deriveMotionFrameControlAvailability({
  uiBusy = false,
  index,
  frameCount,
} = {}) {
  const valid = Number.isSafeInteger(index) &&
    Number.isSafeInteger(frameCount) &&
    frameCount > 0 &&
    index >= 0 &&
    index < frameCount
  if (!valid || uiBusy) {
    return Object.freeze({ toggle: false, up: false, down: false, remove: false })
  }
  return Object.freeze({
    toggle: true,
    up: index > 0,
    down: index < frameCount - 1,
    remove: true,
  })
}
