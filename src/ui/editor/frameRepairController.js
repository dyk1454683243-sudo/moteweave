import {
  applyFrameRepairMaskEdits,
  deriveFrameRepairBaseMask,
  maskBitsToRuns,
} from '../../editor-project/frameRepairMask.js'
import {
  getRepairComparisonAvailability,
  readRepairFramePixels,
  resolveSheetFrameRect,
} from './repairComparisonRenderer.js'
import {
  clientPointToFramePoint,
  createFrameRepairMaskSource,
  drawFrameRepairOverlay,
  rectangleFromFramePoints,
} from './frameRepairCanvas.js'
import {
  createEmptyFrameRepairState,
  getFrameRepairUiState,
  hasExactFrameRepairWarningConfirmation,
} from './frameRepairState.js'

const SHA256_PATTERN = /^[a-f0-9]{64}$/
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/
const OPERATION_ID_PATTERN = /^[A-Za-z0-9_-]{16,80}$/
const GENERATE_ACTION_LABEL = 'Generate one candidate'
const EDITABLE_UI_STATES = new Set([
  'needs_scope', 'invalid_mask', 'planning', 'planned', 'provider_unavailable',
  'stale_plan',
])
const REVIEWABLE_UI_STATES = new Set([
  'needs_scope', 'invalid_mask', 'provider_unavailable', 'failed_model',
  'failed_processing', 'stale_plan',
])
const ARTIFACT_FILES = Object.freeze({
  patched_normalized_sheet: 'patched_normalized_sheet.png',
  animations: 'animations.json',
  metadata: 'metadata.json',
  editor_metadata: 'editor_metadata.json',
  debug_report: 'debug_report.json',
  frame_repair_plan: 'frame_repair_plan.json',
  frame_repair_context: 'editor_frame_repair_context.json',
  frame_repair_mask: 'frame_repair_mask.png',
  frame_repair_quality: 'frame_repair_quality.json',
  target_before: 'target_before.png',
  composited_candidate_frame: 'composited_candidate_frame.png',
  frame_repair_difference: 'frame_repair_difference.png',
})
const IMAGE_ARTIFACT_KEYS = Object.freeze([
  'patched_normalized_sheet',
  'frame_repair_mask',
  'target_before',
  'composited_candidate_frame',
  'frame_repair_difference',
])
const JSON_ARTIFACT_KEYS = Object.freeze([
  'animations',
  'metadata',
  'editor_metadata',
  'debug_report',
  'frame_repair_plan',
  'frame_repair_context',
  'frame_repair_quality',
])

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function safeId(value) {
  return typeof value === 'string' && value.length <= 120 && SAFE_ID_PATTERN.test(value)
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function sameSelection(left, right) {
  return Boolean(left && right) &&
    left.projectId === right.projectId &&
    left.projectRevision === right.projectRevision &&
    left.assetId === right.assetId &&
    left.revisionId === right.revisionId &&
    left.clipId === right.clipId &&
    left.clipFramePosition === right.clipFramePosition &&
    left.sheetFrameIndex === right.sheetFrameIndex
}

function controlledError(code, message, details = null) {
  const error = new Error(message)
  error.name = 'FrameRepairControllerError'
  error.code = code
  error.details = details
  return error
}

function countMaskPixels(runs) {
  return runs.reduce((total, run) => total + run.length, 0)
}

function bitsFromRuns(mask) {
  if (!Number.isInteger(mask?.width) || mask.width <= 0 ||
      !Number.isInteger(mask?.height) || mask.height <= 0 || !Array.isArray(mask.runs)) {
    throw controlledError('invalid_frame_repair_mask', 'canonical mask geometry is invalid')
  }
  const bits = new Uint8Array(mask.width * mask.height)
  let previousEnd = -1
  for (const run of mask.runs) {
    if (!Number.isInteger(run?.start) || run.start < 0 ||
        !Number.isInteger(run?.length) || run.length <= 0 ||
        (previousEnd >= 0 && run.start <= previousEnd + 1) ||
        run.start >= bits.length || run.length > bits.length - run.start) {
      throw controlledError('invalid_frame_repair_mask', 'canonical mask runs are invalid')
    }
    bits.fill(1, run.start, run.start + run.length)
    previousEnd = run.start + run.length - 1
  }
  if (mask.activePixelCount !== countMaskPixels(mask.runs)) {
    throw controlledError('invalid_frame_repair_mask', 'canonical mask pixel count is invalid')
  }
  return bits
}

function selectedProvider(providerState) {
  const presets = Array.isArray(providerState?.presets)
    ? providerState.presets.filter((preset) => isRecord(preset) && safeId(preset.id))
    : []
  return presets.find((preset) => preset.id === providerState?.active_preset_id) ??
    presets.find((preset) => preset.available === true) ?? presets[0] ?? null
}

function normalizedInstruction(value) {
  const instruction = String(value ?? '').normalize('NFC').trim()
  return instruction && [...instruction].length <= 500 ? instruction : null
}

function imageGeometry(image, expected) {
  return Boolean(image) && image.width === expected.w && image.height === expected.h
}

function artifactUrls(job) {
  if (!isRecord(job) || !safeId(job.id)) {
    throw controlledError('artifact_integrity_failed', 'Frame Repair job identity is invalid')
  }
  const urls = {}
  for (const [key, file] of Object.entries(ARTIFACT_FILES)) {
    const expected = `/generated/${job.id}/${file}`
    if (job[`${key}_url`] !== expected) {
      throw controlledError('artifact_integrity_failed', 'Frame Repair artifact URL set is incomplete', { key })
    }
    urls[key] = expected
  }
  return { urls, allowlist: new Set(Object.values(urls)) }
}

function cloneViewSnapshot(snapshot) {
  return {
    view: snapshot?.view ? structuredClone(snapshot.view) : null,
    renderFrame: snapshot?.renderFrame
      ? {
          ...snapshot.renderFrame,
          pan: snapshot.renderFrame.pan ? { ...snapshot.renderFrame.pan } : snapshot.renderFrame.pan,
          overlayCommands: Array.isArray(snapshot.renderFrame.overlayCommands)
            ? [...snapshot.renderFrame.overlayCommands]
            : snapshot.renderFrame.overlayCommands,
        }
      : null,
  }
}

function exactJobIdentity(job, selection, planHash) {
  return isRecord(job) && safeId(job.id) &&
    job.type === 'editor_character_frame_repair' &&
    job.project_id === selection.projectId &&
    job.asset_id === selection.assetId &&
    job.parent_revision_id === selection.revisionId &&
    (job.project_revision == null || job.project_revision === selection.projectRevision) &&
    job.plan_hash === planHash &&
    job.provider_call_budget === 1 &&
    (job.provider_calls_used === 0 || job.provider_calls_used === 1) &&
    (job.generated_candidate_count === 0 || job.generated_candidate_count === 1)
}

function uiStateForJob(job) {
  if (job?.recovery_state === 'outcome_unknown') return 'outcome_unknown'
  if (job?.status === 'queued') return 'queued'
  if (job?.status === 'generating') return 'generating'
  if (job?.status === 'post_processing') return 'post_processing'
  if (job?.status === 'failed_model_error' || job?.status === 'failed_safety_filter') return 'failed_model'
  if (job?.status === 'failed_post_processing') return 'failed_processing'
  return null
}

export function createFrameRepairController({
  state,
  lifecycle,
  artifactClient,
  profile,
  requestRender = () => {},
  onProjectAccepted = () => {},
  announce = () => {},
  readFramePixels = readRepairFramePixels,
  createDifference = null,
  createMaskSource = createFrameRepairMaskSource,
} = {}) {
  if (!state?.repair || !lifecycle || !artifactClient || !profile ||
      typeof lifecycle.setSelection !== 'function' ||
      typeof lifecycle.invalidatePlan !== 'function' ||
      typeof lifecycle.plan !== 'function' ||
      typeof lifecycle.generate !== 'function' ||
      typeof lifecycle.recoverFromSession !== 'function' ||
      typeof lifecycle.accept !== 'function' ||
      typeof lifecycle.stop !== 'function' ||
      typeof lifecycle.capture !== 'function' ||
      typeof artifactClient.loadImage !== 'function' ||
      typeof artifactClient.loadJson !== 'function') {
    throw new TypeError('Frame Repair controller dependencies are invalid')
  }

  let savedWorkbench = null
  let maskSource = null
  let hydrationController = null
  let hydrationGeneration = 0
  let hydrationPromise = null
  let hydrationJobId = null
  let recoveryPromise = null
  let acceptedNotified = false
  let entryUnsavedReason = null
  let qualityGateMode = null
  let lockedQualityGateCase = null
  let disposed = false

  const frameState = () => state.repair.frame

  function render(message = null) {
    if (message != null) announce(message)
    requestRender()
  }

  function abortHydration() {
    hydrationController?.abort()
    hydrationController = null
    hydrationGeneration += 1
    hydrationPromise = null
    hydrationJobId = null
  }

  function clearCandidateCache(jobId = frameState()?.job?.id) {
    if (safeId(jobId) && typeof artifactClient.clearRepairArtifactCache === 'function') {
      artifactClient.clearRepairArtifactCache(`job:${jobId}`)
    }
  }

  function refreshMaskSource(mask = frameState()?.plan?.plan?.mask ?? frameState()?.provisionalMask) {
    maskSource = null
    if (!mask || !Array.isArray(mask.runs)) return
    try {
      maskSource = createMaskSource(mask)
    } catch {
      maskSource = null
    }
  }

  function provisionalMask(frame) {
    const width = frame.baseMask.bits.length / profile.frame.h
    const height = profile.frame.h
    const bits = applyFrameRepairMaskEdits(frame.baseMask.bits, width, height, frame.maskEdits)
    const runs = maskBitsToRuns(bits)
    const activePixelCount = countMaskPixels(runs)
    const hasDiagnostic = frame.baseMask.activePixelCount > 0
    return {
      width,
      height,
      source: hasDiagnostic
        ? (frame.maskEdits.length ? 'localized_plus_user_edits' : 'localized_diagnostic')
        : 'user_scoped',
      confidence: hasDiagnostic
        ? (frame.maskEdits.length ? 'user_confirmed' : 'high')
        : activePixelCount > 0 ? 'user_confirmed' : 'needs_scope',
      runs,
      bits,
      activePixelCount,
      suggestedRectangle: frame.baseMask.suggestedRectangle
        ? { ...frame.baseMask.suggestedRectangle }
        : null,
    }
  }

  function recomputeProvisional(frame) {
    frame.provisionalMask = provisionalMask(frame)
    frame.uiState = frame.provisionalMask.activePixelCount > 0 ? 'invalid_mask' : 'needs_scope'
    refreshMaskSource(frame.provisionalMask)
  }

  function restoreWorkbench() {
    if (!savedWorkbench || !state.repair.local) return
    if (savedWorkbench.view) state.repair.local.view = structuredClone(savedWorkbench.view)
    if (savedWorkbench.renderFrame) {
      state.repair.local.renderFrame = {
        ...savedWorkbench.renderFrame,
        pan: savedWorkbench.renderFrame.pan ? { ...savedWorkbench.renderFrame.pan } : savedWorkbench.renderFrame.pan,
        overlayCommands: Array.isArray(savedWorkbench.renderFrame.overlayCommands)
          ? [...savedWorkbench.renderFrame.overlayCommands]
          : savedWorkbench.renderFrame.overlayCommands,
      }
    }
  }

  function invalidEntry(providerState, error = null, uiState = 'no_frame') {
    const frame = createEmptyFrameRepairState()
    frame.providerState = providerState ? structuredClone(providerState) : null
    frame.uiState = uiState
    frame.error = error
    state.repair.frame = frame
    render(getFrameRepairUiState(uiState).message)
    return false
  }

  function enter(snapshot = {}, { qualityMode = null } = {}) {
    if (disposed) return false
    if (frameState()?.active) close('selection_switched')
    const baseSelection = snapshot.selection
    const clipFrames = Array.isArray(snapshot.clipFrames) ? [...snapshot.clipFrames] : []
    const position = snapshot.clipFramePosition
    const sheetFrameIndex = snapshot.sheetFrameIndex
    if (!isRecord(baseSelection) || !safeId(baseSelection.projectId) ||
        !Number.isSafeInteger(baseSelection.projectRevision) || baseSelection.projectRevision < 0 ||
        !safeId(baseSelection.assetId) || !safeId(baseSelection.revisionId) ||
        !safeId(snapshot.clipId) || !Number.isSafeInteger(position) || position < 0 ||
        !Number.isSafeInteger(sheetFrameIndex) || sheetFrameIndex < 0 ||
        clipFrames[position] !== sheetFrameIndex ||
        state.project?.id !== baseSelection.projectId || state.project?.revision !== baseSelection.projectRevision) {
      return invalidEntry(snapshot.providerState)
    }
    const selectedAsset = state.project?.assets?.[baseSelection.assetId]
    if (!selectedAsset || selectedAsset.kind !== 'character_pack') {
      return invalidEntry(
        snapshot.providerState,
        controlledError('unsupported_asset', 'Frame Repair requires a Character Pack asset'),
        'unsupported_asset',
      )
    }
    if (selectedAsset.active_revision_id !== baseSelection.revisionId) {
      return invalidEntry(
        snapshot.providerState,
        controlledError('asset_revision_conflict', 'active asset revision changed'),
        'asset_revision_conflict',
      )
    }

    let pixels
    try {
      pixels = readFramePixels(snapshot.beforeImage, snapshot.beforeRect)
      if (!pixels || pixels.width !== profile.frame.w || pixels.height !== profile.frame.h ||
          !(pixels.data instanceof Uint8ClampedArray) ||
          pixels.data.length !== profile.frame.w * profile.frame.h * 4) {
        throw controlledError('no_frame', 'selected frame pixels are unavailable')
      }
    } catch (error) {
      return invalidEntry(snapshot.providerState, error)
    }

    const selection = {
      projectId: baseSelection.projectId,
      projectRevision: baseSelection.projectRevision,
      assetId: baseSelection.assetId,
      revisionId: baseSelection.revisionId,
      clipId: snapshot.clipId,
      clipFramePosition: position,
      sheetFrameIndex,
      clipFrames,
    }
    let baseMask
    try {
      baseMask = deriveFrameRepairBaseMask(pixels)
    } catch (error) {
      return invalidEntry(snapshot.providerState, error)
    }

    savedWorkbench = cloneViewSnapshot(snapshot.workbenchView)
    qualityGateMode = qualityMode
    lockedQualityGateCase = null
    acceptedNotified = false
    entryUnsavedReason = snapshot.unsavedReason ?? null
    abortHydration()
    const frame = createEmptyFrameRepairState()
    frame.active = true
    frame.selection = selection
    frame.providerState = snapshot.providerState ? structuredClone(snapshot.providerState) : null
    frame.providerPresetId = selectedProvider(frame.providerState)?.id ?? ''
    frame.baseMask = {
      mode: baseMask.mode,
      bits: new Uint8Array(baseMask.bits),
      activePixelCount: baseMask.activePixelCount,
      suggestedRectangle: baseMask.suggestedRectangle ? { ...baseMask.suggestedRectangle } : null,
    }
    frame.generation = 1
    state.repair.frame = frame
    recomputeProvisional(frame)
    lifecycle.setSelection(selection)
    if (qualityMode == null) void recoverOriginalOperation()
    render(getFrameRepairUiState(frame.uiState).message)
    return true
  }

  function canEdit(frame = frameState()) {
    return Boolean(frame?.active && qualityGateMode !== 'locked' && EDITABLE_UI_STATES.has(frame.uiState))
  }

  function enterQualityGateAuthoringCase(snapshot) {
    return enter(snapshot, { qualityMode: 'authoring' })
  }

  function enterLockedQualityGateCase(snapshot, lockedCase) {
    if (!isRecord(lockedCase) || !safeId(lockedCase.caseId) ||
        !OPERATION_ID_PATTERN.test(lockedCase.operationId ?? '') ||
        !safeId(lockedCase.assetId) || !safeId(lockedCase.expectedAssetRevisionId) ||
        !safeId(lockedCase.clipId) || !safeId(lockedCase.providerPresetId) ||
        !['1K', '2K'].includes(lockedCase.imageSize) || !Array.isArray(lockedCase.maskEdits)) return false
    if (!enter(snapshot, { qualityMode: 'locked' })) return false
    const frame = frameState()
    if (frame.selection.assetId !== lockedCase.assetId ||
        frame.selection.revisionId !== lockedCase.expectedAssetRevisionId ||
        frame.selection.clipId !== lockedCase.clipId ||
        frame.selection.clipFramePosition !== lockedCase.clipFramePosition ||
        frame.selection.sheetFrameIndex !== lockedCase.sheetFrameIndex) {
      close('quality_gate_identity_mismatch')
      return false
    }
    frame.instruction = normalizedInstruction(lockedCase.instruction) ?? ''
    frame.providerPresetId = lockedCase.providerPresetId
    frame.imageSize = lockedCase.imageSize
    frame.maskEdits = lockedCase.maskEdits.map((item) => ({ ...item }))
    frame.selectedEditIndex = null
    try {
      recomputeProvisional(frame)
    } catch {
      close('quality_gate_identity_mismatch')
      return false
    }
    lockedQualityGateCase = structuredClone(lockedCase)
    render()
    return true
  }

  function exportQualityGateCaseDraft(metadata = {}) {
    const frame = frameState()
    if (!frame?.active || qualityGateMode !== 'authoring' || !frame.provisionalMask ||
        frame.provisionalMask.activePixelCount < 1 || !normalizedInstruction(frame.instruction)) return null
    return {
      caseId: metadata.caseId,
      assetId: frame.selection.assetId,
      expectedAssetRevisionId: frame.selection.revisionId,
      clipId: frame.selection.clipId,
      clipFramePosition: frame.selection.clipFramePosition,
      sheetFrameIndex: frame.selection.sheetFrameIndex,
      instruction: normalizedInstruction(frame.instruction),
      maskEdits: frame.maskEdits.map((item) => ({ ...item })),
      difficulty: metadata.difficulty,
      defectCategory: metadata.defectCategory,
      expectedImprovement: metadata.expectedImprovement,
    }
  }

  function invalidatePlan(reason) {
    const frame = frameState()
    if (!canEdit(frame)) return false
    frame.generation += 1
    recoveryPromise = null
    lifecycle.invalidatePlan(reason)
    abortHydration()
    clearCandidateCache(frame.job?.id)
    frame.stage = 'target_mask'
    frame.plan = null
    frame.planHash = null
    frame.planInvalidReason = reason
    frame.operationId = null
    frame.job = null
    frame.candidate = null
    frame.quality = null
    frame.warningConfirmation = null
    frame.diagnostics = []
    frame.error = null
    recomputeProvisional(frame)
    return true
  }

  function setInstruction(value) {
    const frame = frameState()
    if (!canEdit(frame)) return false
    const instruction = [...String(value ?? '')].slice(0, 500).join('')
    if (frame.instruction === instruction) return true
    frame.instruction = instruction
    invalidatePlan('instruction_edit')
    render()
    return true
  }

  function setProviderPreset(value) {
    const frame = frameState()
    if (!canEdit(frame) || !safeId(value)) return false
    if (frame.providerPresetId === value) return true
    frame.providerPresetId = value
    invalidatePlan('provider_edit')
    render()
    return true
  }

  function setImageSize(value) {
    const frame = frameState()
    if (!canEdit(frame) || (value !== '1K' && value !== '2K')) return false
    if (frame.imageSize === value) return true
    frame.imageSize = value
    invalidatePlan('image_size_edit')
    render()
    return true
  }

  function setMaskMode(value) {
    const frame = frameState()
    if (!canEdit(frame) || (value !== 'add' && value !== 'remove' &&
        value !== 'add_rectangle' && value !== 'remove_rectangle')) return false
    frame.maskMode = value.startsWith('remove') ? 'remove_rectangle' : 'add_rectangle'
    render()
    return true
  }

  function appendRectangle(op, rectangle) {
    const frame = frameState()
    if (!canEdit(frame)) return false
    const edit = { op, ...rectangle }
    const previous = [...frame.maskEdits]
    frame.maskEdits.push(edit)
    try {
      provisionalMask(frame)
    } catch (error) {
      frame.maskEdits = previous
      frame.error = error
      frame.uiState = 'invalid_mask'
      render()
      return false
    }
    frame.selectedEditIndex = frame.maskEdits.length - 1
    invalidatePlan('mask_edit')
    render()
    return true
  }

  function addRectangle(rectangle) {
    return appendRectangle('add_rectangle', rectangle)
  }

  function removeRectangle(rectangle) {
    return appendRectangle('remove_rectangle', rectangle)
  }

  function selectEdit(index) {
    const frame = frameState()
    if (!canEdit(frame) || !Number.isInteger(index) || index < 0 || index >= frame.maskEdits.length) return false
    frame.selectedEditIndex = index
    render()
    return true
  }

  function updateSelectedEdit(rectangle) {
    const frame = frameState()
    if (!canEdit(frame) || !Number.isInteger(frame.selectedEditIndex)) return false
    const current = frame.maskEdits[frame.selectedEditIndex]
    if (!current) return false
    const previous = { ...current }
    frame.maskEdits[frame.selectedEditIndex] = { op: current.op, ...rectangle }
    try {
      provisionalMask(frame)
    } catch (error) {
      frame.maskEdits[frame.selectedEditIndex] = previous
      frame.error = error
      render()
      return false
    }
    invalidatePlan('mask_edit')
    render()
    return true
  }

  function deleteSelectedEdit() {
    const frame = frameState()
    if (!canEdit(frame) || !Number.isInteger(frame.selectedEditIndex) ||
        !frame.maskEdits[frame.selectedEditIndex]) return false
    frame.maskEdits.splice(frame.selectedEditIndex, 1)
    frame.selectedEditIndex = frame.maskEdits.length
      ? Math.min(frame.selectedEditIndex, frame.maskEdits.length - 1)
      : null
    invalidatePlan('mask_edit')
    render()
    return true
  }

  function undoMaskEdit() {
    const frame = frameState()
    if (!canEdit(frame) || frame.maskEdits.length === 0) return false
    frame.maskEdits.pop()
    frame.selectedEditIndex = frame.maskEdits.length ? frame.maskEdits.length - 1 : null
    invalidatePlan('mask_edit')
    render()
    return true
  }

  function requestBody(frame = frameState()) {
    return {
      expectedRevision: frame.selection.projectRevision,
      expectedAssetRevisionId: frame.selection.revisionId,
      clipId: frame.selection.clipId,
      clipFramePosition: frame.selection.clipFramePosition,
      sheetFrameIndex: frame.selection.sheetFrameIndex,
      instruction: normalizedInstruction(frame.instruction),
      maskEdits: frame.maskEdits.map((edit) => ({ ...edit })),
      providerPresetId: frame.providerPresetId,
      imageConfig: { image_size: frame.imageSize },
    }
  }

  function validatePlanResult(result, frame, body) {
    const plan = result?.plan
    if (!isRecord(result) || !isRecord(plan) || !SHA256_PATTERN.test(result.plan_hash ?? '') ||
        result.estimated_provider_calls !== 1 || result.max_provider_calls !== 1 ||
        plan.version !== 'frame_repair_plan_v1' ||
        plan.project?.id !== frame.selection.projectId ||
        plan.project?.revision !== frame.selection.projectRevision ||
        plan.asset?.id !== frame.selection.assetId ||
        plan.asset?.parent_revision_id !== frame.selection.revisionId ||
        plan.profile?.id !== profile.id ||
        !sameJson(plan.profile?.frame_size, profile.frame) ||
        plan.clip?.id !== frame.selection.clipId ||
        !sameJson(plan.clip?.frames, frame.selection.clipFrames) ||
        plan.clip?.position !== frame.selection.clipFramePosition ||
        plan.clip?.sheet_frame_index !== frame.selection.sheetFrameIndex ||
        plan.instruction !== body.instruction ||
        plan.provider?.id !== body.providerPresetId ||
        plan.provider?.image_config?.image_size !== body.imageConfig.image_size ||
        plan.estimated_provider_calls !== 1 || plan.max_provider_calls !== 1 ||
        plan.mask?.width !== profile.frame.w || plan.mask?.height !== profile.frame.h ||
        !SHA256_PATTERN.test(plan.mask?.sha256 ?? '')) {
      throw controlledError('invalid_frame_repair_plan', 'Frame Repair Plan identity is invalid')
    }
    bitsFromRuns(plan.mask)
    return result
  }

  function recoveredPlanEnvelope(plan, frame) {
    const instruction = normalizedInstruction(plan?.instruction)
    const providerPresetId = plan?.provider?.id
    const imageSize = plan?.provider?.image_config?.image_size
    if (!instruction || instruction !== plan.instruction || !safeId(providerPresetId) ||
        !['1K', '2K'].includes(imageSize)) {
      throw controlledError('artifact_integrity_failed', 'Recovered Frame Repair Plan fields are invalid')
    }
    const envelope = {
      plan,
      plan_hash: frame.planHash,
      can_run: false,
      diagnostics: ['recovered_operation'],
      estimated_provider_calls: 1,
      max_provider_calls: 1,
    }
    try {
      validatePlanResult(envelope, frame, {
        instruction,
        providerPresetId,
        imageConfig: { image_size: imageSize },
      })
    } catch (error) {
      throw controlledError('artifact_integrity_failed', 'Recovered Frame Repair Plan identity is invalid', {
        cause: error?.code ?? error?.message ?? String(error),
      })
    }
    return envelope
  }

  async function reviewCall() {
    const frame = frameState()
    if (qualityGateMode === 'authoring') return null
    const instruction = normalizedInstruction(frame?.instruction)
    if (!frame?.active || !REVIEWABLE_UI_STATES.has(frame.uiState)) return null
    if (entryUnsavedReason || !instruction || !frame.providerPresetId ||
        frame.provisionalMask?.activePixelCount <= 0) {
      if (frame?.active) {
        frame.uiState = frame.provisionalMask?.activePixelCount > 0 ? 'invalid_mask' : 'needs_scope'
        frame.error = entryUnsavedReason
          ? controlledError('project_conflict', entryUnsavedReason)
          : controlledError('invalid_frame_repair_request', 'instruction, mask, and provider are required')
        render(getFrameRepairUiState(frame.uiState).message)
      }
      return null
    }
    const body = requestBody(frame)
    body.instruction = instruction
    const generation = ++frame.generation
    const expectedSelection = structuredClone(frame.selection)
    frame.uiState = 'planning'
    frame.error = null
    render(getFrameRepairUiState('planning').message)
    const result = await lifecycle.plan({
      projectId: frame.selection.projectId,
      assetId: frame.selection.assetId,
      body,
    })
    if (!result || frame !== frameState() || !frame.active || frame.generation !== generation ||
        !sameSelection(frame.selection, expectedSelection)) return null
    try {
      validatePlanResult(result, frame, body)
      frame.plan = structuredClone(result)
      frame.planHash = result.plan_hash
      frame.planInvalidReason = null
      frame.provisionalMask = {
        ...structuredClone(result.plan.mask),
        bits: bitsFromRuns(result.plan.mask),
      }
      frame.diagnostics = Array.isArray(result.diagnostics) ? [...result.diagnostics] : []
      refreshMaskSource(result.plan.mask)
      if (result.can_run === true) {
        frame.stage = 'review_call'
        frame.uiState = 'planned'
      } else if (frame.diagnostics.includes('provider_unavailable')) {
        frame.stage = 'target_mask'
        frame.uiState = 'provider_unavailable'
      } else {
        frame.stage = 'target_mask'
        frame.uiState = result.plan.mask.activePixelCount > 0 ? 'invalid_mask' : 'needs_scope'
      }
      render(getFrameRepairUiState(frame.uiState).message)
      return result
    } catch (error) {
      frame.plan = null
      frame.planHash = null
      frame.error = error
      frame.uiState = 'failed_processing'
      frame.stage = 'target_mask'
      render(getFrameRepairUiState(frame.uiState).message)
      return null
    }
  }

  function validateJob(job, frame) {
    if (!exactJobIdentity(job, frame.selection, frame.planHash)) {
      const code = job?.parent_revision_id !== frame.selection.revisionId
        ? 'asset_revision_conflict'
        : job?.project_id !== frame.selection.projectId ||
            (job?.project_revision != null && job.project_revision !== frame.selection.projectRevision)
          ? 'project_conflict'
          : 'selection_switched'
      throw controlledError(code, 'Frame Repair job identity does not match the selected frame')
    }
    if (!OPERATION_ID_PATTERN.test(job.operation_id ?? '') ||
        (frame.operationId && frame.operationId !== job.operation_id) ||
        (job.status === 'done' &&
          (job.provider_calls_used !== 1 || job.generated_candidate_count !== 1 ||
            !['pass', 'warning', 'fail', 'unknown'].includes(job.quality_status)))) {
      throw controlledError('invalid_frame_repair_job', 'Frame Repair job accounting is invalid')
    }
    return job
  }

  function setControllerError(error, phase = 'processing', outcomeUnknown = false) {
    const frame = frameState()
    if (!frame) return
    frame.error = error
    frame.diagnostics = [
      ...(frame.diagnostics ?? []),
      { code: error?.code ?? `${phase}_failed`, message: error?.message ?? String(error) },
    ]
    frame.uiState = error?.code === 'stale_plan'
      ? 'stale_plan'
      : error?.code === 'revision_conflict' || error?.code === 'project_conflict'
        ? 'project_conflict'
        : error?.code === 'asset_revision_conflict'
          ? 'asset_revision_conflict'
          : error?.code === 'provider_unavailable'
            ? 'provider_unavailable'
            : error?.code === 'quality_blocked' || error?.code === 'artifact_integrity_failed'
              ? 'blocked_quality'
              : phase === 'model'
                ? 'failed_model'
                : 'failed_processing'
    if (outcomeUnknown || error?.outcomeUnknown === true) frame.uiState = 'outcome_unknown'
    render(getFrameRepairUiState(frame.uiState).message)
  }

  function validateHydratedEvidence({
    frame,
    job,
    images,
    documents,
    plan,
  }) {
    const context = documents.frame_repair_context
    const quality = documents.frame_repair_quality
    const animations = documents.animations
    if (!sameJson(documents.frame_repair_plan, plan) ||
        context?.version !== 'editor_frame_repair_context_v1' ||
        context?.job_type !== 'editor_character_frame_repair' ||
        context?.job_id !== job.id || context?.operation_id !== job.operation_id ||
        context?.project_id !== frame.selection.projectId ||
        context?.project_revision !== frame.selection.projectRevision ||
        context?.asset_id !== frame.selection.assetId ||
        context?.parent_revision_id !== frame.selection.revisionId ||
        context?.plan_hash !== frame.planHash || context?.mask_sha256 !== plan.mask.sha256 ||
        context?.clip_id !== frame.selection.clipId ||
        context?.clip_frame_position !== frame.selection.clipFramePosition ||
        context?.sheet_frame_index !== frame.selection.sheetFrameIndex ||
        context?.provider_call_budget !== 1 || context?.provider_calls_used !== 1 ||
        !sameJson(context?.frame_size, profile.frame) ||
        !sameJson(context?.sheet_size, profile.sheet) ||
        animations?.profile !== profile.id ||
        animations?.sheet !== 'normalized_sheet.png' ||
        !sameJson(animations?.frame_size, profile.frame) ||
        !sameJson(animations?.sheet_size, profile.sheet) ||
        !sameJson(animations?.animations?.[frame.selection.clipId]?.frames, frame.selection.clipFrames) ||
        documents.metadata?.profile !== profile.id ||
        documents.editor_metadata?.profile !== profile.id ||
        documents.debug_report?.profile !== profile.id ||
        documents.debug_report?.validation?.status !== quality?.validation?.status ||
        !imageGeometry(images.patched_normalized_sheet, profile.sheet) ||
        !IMAGE_ARTIFACT_KEYS.filter((key) => key !== 'patched_normalized_sheet')
          .every((key) => imageGeometry(images[key], profile.frame)) ||
        !isRecord(quality) || !['pass', 'warning', 'fail', 'unknown'].includes(quality.status) ||
        job.quality_status !== quality.status) {
      throw controlledError('artifact_integrity_failed', 'Frame Repair evidence identity is incomplete')
    }
    const integrity = quality.integrity
    if ((quality.status === 'pass' || quality.status === 'warning') &&
        (quality.complete !== true || integrity?.non_target_equal !== true ||
          integrity?.target_outside_mask_equal !== true ||
          integrity?.actual_non_target_changed !== 0 ||
          integrity?.actual_outside_mask_changed !== 0)) {
      throw controlledError('artifact_integrity_failed', 'Frame Repair pixel integrity failed')
    }
    return quality
  }

  async function performCandidateHydration(job) {
    const frame = frameState()
    if (!frame?.active || frame.candidate?.jobId === job.id) return frame?.candidate ?? null
    let controlled
    try {
      controlled = artifactUrls(job)
    } catch (error) {
      setControllerError(error)
      return null
    }
    abortHydration()
    const controller = new AbortController()
    hydrationController = controller
    const generation = ++hydrationGeneration
    const expectedSelection = structuredClone(frame.selection)
    const identity = `job:${job.id}`
    try {
      const imageEntries = await Promise.all(IMAGE_ARTIFACT_KEYS.map(async (key) => [
        key,
        await artifactClient.loadImage({
          identity,
          url: controlled.urls[key],
          allowedGeneratedUrls: controlled.allowlist,
          signal: controller.signal,
        }),
      ]))
      const documentEntries = await Promise.all(JSON_ARTIFACT_KEYS.map(async (key) => [
        key,
        await artifactClient.loadJson({
          identity,
          url: controlled.urls[key],
          allowedGeneratedUrls: controlled.allowlist,
          signal: controller.signal,
        }),
      ]))
      if (controller.signal.aborted || generation !== hydrationGeneration ||
          frame !== frameState() || !frame.active || !sameSelection(frame.selection, expectedSelection)) return null
      const images = Object.fromEntries(imageEntries)
      const documents = Object.fromEntries(documentEntries)
      const recoveredEnvelope = frame.plan ? null : recoveredPlanEnvelope(documents.frame_repair_plan, frame)
      const plan = frame.plan?.plan ?? recoveredEnvelope.plan
      const quality = validateHydratedEvidence({ frame, job, images, documents, plan })
      if (recoveredEnvelope) {
        frame.plan = structuredClone(recoveredEnvelope)
        frame.instruction = plan.instruction
        frame.providerPresetId = plan.provider.id
        frame.imageSize = plan.provider.image_config.image_size
        frame.provisionalMask = {
          ...structuredClone(plan.mask),
          bits: bitsFromRuns(plan.mask),
        }
        frame.diagnostics = [...(frame.diagnostics ?? []), 'recovered_operation']
      }
      frame.candidate = {
        jobId: job.id,
        planHash: frame.planHash,
        sheet: images.patched_normalized_sheet,
        maskImage: images.frame_repair_mask,
        targetBefore: images.target_before,
        candidateFrame: images.composited_candidate_frame,
        differenceImage: images.frame_repair_difference,
        animations: documents.animations,
        metadata: documents.metadata,
        editorMetadata: documents.editor_metadata,
        debugReport: documents.debug_report,
        context: documents.frame_repair_context,
      }
      frame.quality = quality
      frame.stage = 'result_validation'
      frame.uiState = quality.status === 'pass'
        ? 'ready'
        : quality.status === 'warning'
          ? 'warning'
          : 'blocked_quality'
      frame.error = null
      refreshMaskSource(frame.plan.plan.mask)
      hydrationController = null
      render(getFrameRepairUiState(frame.uiState).message)
      return frame.candidate
    } catch (error) {
      if (error?.name === 'AbortError' || controller.signal.aborted ||
          generation !== hydrationGeneration || frame !== frameState()) return null
      frame.candidate = null
      frame.quality = null
      setControllerError(error)
      return null
    }
  }

  function hydrateCandidate(job) {
    const frame = frameState()
    if (!frame?.active || frame.candidate?.jobId === job.id) {
      return Promise.resolve(frame?.candidate ?? null)
    }
    if (hydrationPromise && hydrationJobId === job.id) return hydrationPromise
    const operation = performCandidateHydration(job)
    let tracked
    tracked = operation.finally(() => {
      if (hydrationPromise === tracked) {
        hydrationPromise = null
        hydrationJobId = null
      }
    })
    hydrationPromise = tracked
    hydrationJobId = job.id
    return tracked
  }

  async function adoptJob(job) {
    const frame = frameState()
    try {
      validateJob(job, frame)
    } catch (error) {
      setControllerError(error)
      return null
    }
    frame.job = structuredClone(job)
    frame.operationId = job.operation_id
    const nextState = uiStateForJob(job)
    if (nextState) {
      frame.stage = 'processing'
      frame.uiState = nextState
      render(getFrameRepairUiState(nextState).message)
      return job
    }
    if (job.status === 'done') return hydrateCandidate(job)
    setControllerError(controlledError('failed_processing', 'Frame Repair job status is unsupported'))
    return null
  }

  function scopedRecoveryHandle(frame = frameState()) {
    const handle = lifecycle.capture()?.recoveryHandle
    return frame?.active && isRecord(handle) &&
      handle.projectId === frame.selection.projectId &&
      handle.assetId === frame.selection.assetId &&
      OPERATION_ID_PATTERN.test(handle.operationId ?? '') &&
      (handle.jobId == null || safeId(handle.jobId)) &&
      SHA256_PATTERN.test(handle.planHash ?? '')
      ? handle
      : null
  }

  function recoverOriginalOperation() {
    const frame = frameState()
    if (qualityGateMode === 'authoring') return Promise.resolve(null)
    const handle = scopedRecoveryHandle(frame)
    if (!handle || disposed) return Promise.resolve(null)
    if (recoveryPromise) return recoveryPromise
    const generation = frame.generation
    const expectedSelection = structuredClone(frame.selection)
    frame.planHash = handle.planHash
    frame.operationId = handle.operationId
    frame.stage = 'processing'
    frame.uiState = 'outcome_unknown'
    frame.error = null
    render(getFrameRepairUiState('outcome_unknown').message)
    const operation = (async () => {
      const job = await lifecycle.recoverFromSession()
      if (!job || frame !== frameState() || !frame.active || frame.generation !== generation ||
          !sameSelection(frame.selection, expectedSelection)) return null
      await adoptJob(job)
      return job.id ?? null
    })()
    let tracked
    tracked = operation.finally(() => {
      if (recoveryPromise === tracked) recoveryPromise = null
    })
    recoveryPromise = tracked
    return tracked
  }

  async function generateOneCandidate({ operationId = null } = {}) {
    const frame = frameState()
    if (qualityGateMode === 'authoring' ||
        (qualityGateMode === 'locked' && operationId !== lockedQualityGateCase?.operationId)) return null
    if (!frame?.active || frame.stage !== 'review_call' || frame.uiState !== 'planned' ||
        frame.plan?.can_run !== true || frame.planHash == null) return null
    const generation = ++frame.generation
    const expectedSelection = structuredClone(frame.selection)
    frame.stage = 'processing'
    frame.uiState = 'confirming'
    frame.error = null
    render(`${GENERATE_ACTION_LABEL}: submitting one confirmed call.`)
    const body = {
      ...requestBody(frame),
      expectedPlanHash: frame.planHash,
      confirmLiveGeneration: true,
      maxProviderCalls: 1,
    }
    const job = await lifecycle.generate({
      projectId: frame.selection.projectId,
      assetId: frame.selection.assetId,
      ...(qualityGateMode === 'locked' ? { operationId } : {}),
      body,
    })
    if (!job || frame !== frameState() || !frame.active || frame.generation !== generation ||
        !sameSelection(frame.selection, expectedSelection)) return null
    return adoptJob(job)
  }

  function notifyAccepted(result) {
    if (acceptedNotified) return
    acceptedNotified = true
    onProjectAccepted(result)
  }

  function confirmWarning(confirmed) {
    const frame = frameState()
    if (!frame?.candidate || frame.uiState !== 'warning') return false
    frame.warningConfirmation = confirmed ? {
      jobId: frame.candidate.jobId,
      planHash: frame.planHash,
      confirmed: true,
    } : null
    render()
    return true
  }

  async function acceptCandidate({ deferProjectAdoption = false } = {}) {
    const frame = frameState()
    if (qualityGateMode === 'authoring' ||
        (qualityGateMode === 'locked' && deferProjectAdoption !== true)) return null
    if (!frame?.active || !frame.candidate || !['ready', 'warning'].includes(frame.uiState)) return null
    const warningConfirmed = hasExactFrameRepairWarningConfirmation({
      warningConfirmation: frame.warningConfirmation,
      jobId: frame.candidate.jobId,
      planHash: frame.planHash,
    })
    if (frame.uiState === 'warning' && !warningConfirmed) return null
    const expectedSelection = structuredClone(frame.selection)
    frame.uiState = 'accepting'
    render(getFrameRepairUiState('accepting').message)
    const result = await lifecycle.accept({
      projectId: frame.selection.projectId,
      assetId: frame.selection.assetId,
      jobId: frame.candidate.jobId,
      body: {
        expectedRevision: frame.selection.projectRevision,
        expectedAssetRevisionId: frame.selection.revisionId,
        expectedPlanHash: frame.planHash,
        warningConfirmed,
      },
    }, { deferProjectAdoption })
    if (!result || frame !== frameState() || !frame.active || !sameSelection(frame.selection, expectedSelection)) return null
    frame.uiState = 'accepted'
    frame.warningConfirmation = null
    if (!deferProjectAdoption) notifyAccepted(result)
    render(getFrameRepairUiState('accepted').message)
    return result
  }

  function discardCandidate() {
    const frame = frameState()
    if (!frame?.active) return false
    abortHydration()
    recoveryPromise = null
    clearCandidateCache(frame.job?.id)
    lifecycle.stop('discarded')
    restoreWorkbench()
    frame.active = false
    frame.uiState = 'discarded'
    frame.stage = 'target_mask'
    frame.job = null
    frame.candidate = null
    frame.quality = null
    frame.warningConfirmation = null
    frame.pointerDraft = null
    maskSource = null
    entryUnsavedReason = null
    render(getFrameRepairUiState('discarded').message)
    return true
  }

  function close(reason = 'close') {
    const frame = frameState()
    if (!frame?.active) return
    abortHydration()
    recoveryPromise = null
    clearCandidateCache(frame.job?.id)
    lifecycle.stop(reason)
    restoreWorkbench()
    frame.active = false
    frame.pointerDraft = null
    if (reason === 'teardown') frame.uiState = 'teardown'
    if (['project_switch', 'asset_switch', 'revision_switch', 'selection_switched'].includes(reason)) {
      frame.uiState = 'selection_switched'
    }
    maskSource = null
    entryUnsavedReason = null
    qualityGateMode = null
    lockedQualityGateCase = null
    render()
  }

  function resolvePointerPoint(payload) {
    if (Number.isInteger(payload?.point?.x) && Number.isInteger(payload?.point?.y)) return payload.point
    if (Number.isFinite(payload?.clientX) && Number.isFinite(payload?.clientY) && payload.canvasRect) {
      return clientPointToFramePoint({
        clientX: payload.clientX,
        clientY: payload.clientY,
        canvasRect: payload.canvasRect,
        frameSize: profile.frame,
        zoom: payload.zoom ?? state.repair.local?.view?.zoom ?? 1,
        pan: payload.pan ?? state.repair.local?.view?.pan ?? { x: 0, y: 0 },
      })
    }
    return null
  }

  function handlePointer(type, payload = {}) {
    const frame = frameState()
    if (!canEdit(frame)) return false
    const point = resolvePointerPoint(payload)
    if (type === 'cancel') {
      frame.pointerDraft = null
      render()
      return true
    }
    if (!point) return false
    if (type === 'down') {
      frame.pointerDraft = {
        pointerId: payload.pointerId ?? null,
        start: { ...point },
        end: { ...point },
      }
      render()
      return true
    }
    if (!frame.pointerDraft ||
        (frame.pointerDraft.pointerId != null && payload.pointerId !== frame.pointerDraft.pointerId)) return false
    if (type === 'move') {
      frame.pointerDraft.end = { ...point }
      render()
      return true
    }
    if (type === 'up') {
      const rectangle = rectangleFromFramePoints(frame.pointerDraft.start, point)
      frame.pointerDraft = null
      return frame.maskMode === 'remove_rectangle'
        ? removeRectangle(rectangle)
        : addRectangle(rectangle)
    }
    return false
  }

  function viewModel(workbenchView = {}) {
    const frame = frameState()
    const ui = getFrameRepairUiState(frame?.uiState ?? 'no_frame')
    const instruction = normalizedInstruction(frame?.instruction)
    const canReview = Boolean(
      frame?.active && REVIEWABLE_UI_STATES.has(frame.uiState) && !entryUnsavedReason &&
      instruction && frame.providerPresetId && frame.provisionalMask?.activePixelCount > 0,
    )
    const warningConfirmed = hasExactFrameRepairWarningConfirmation({
      warningConfirmation: frame?.warningConfirmation,
      jobId: frame?.candidate?.jobId,
      planHash: frame?.planHash,
    })
    const canAccept = Boolean(
      frame?.active && frame.candidate &&
      (frame.uiState === 'ready' || (frame.uiState === 'warning' && warningConfirmed)),
    )
    return {
      active: frame?.active === true,
      stage: frame?.stage ?? 'target_mask',
      uiState: ui.state,
      message: ui.message,
      announcement: ui.announcement,
      actions: ui.actions,
      selection: frame?.selection ? structuredClone(frame.selection) : null,
      instruction: frame?.instruction ?? '',
      maskMode: frame?.maskMode ?? 'add_rectangle',
      maskEdits: frame?.maskEdits?.map((edit) => ({ ...edit })) ?? [],
      selectedEditIndex: frame?.selectedEditIndex ?? null,
      mask: frame?.plan?.plan?.mask ?? frame?.provisionalMask ?? null,
      providerState: frame?.providerState ?? null,
      providerPresetId: frame?.providerPresetId ?? '',
      imageSize: frame?.imageSize ?? '1K',
      plan: frame?.plan ?? null,
      planHash: frame?.planHash ?? null,
      job: frame?.job ?? null,
      candidate: frame?.candidate ?? null,
      quality: frame?.quality ?? null,
      diagnostics: frame?.diagnostics ?? [],
      error: frame?.error ?? null,
      canReview,
      canEdit: canEdit(frame),
      reviewReason: canReview ? null : entryUnsavedReason ?? 'instruction_and_non_empty_mask_required',
      canGenerate: frame?.uiState === 'planned' && frame?.plan?.can_run === true,
      generateReason: frame?.uiState === 'planned' && frame?.plan?.can_run === true ? null : 'provider_free_plan_required',
      canAccept,
      acceptReason: canAccept ? null : frame?.uiState === 'warning' ? 'warning_confirmation_required' : 'candidate_not_acceptable',
      warningConfirmed,
      workbenchView,
    }
  }

  function rectangleOverlayCommands(frame) {
    const commands = frame.maskEdits.map((edit, index) => ({
      type: 'frame_repair_rectangle',
      op: edit.op,
      rectangle: { x: edit.x, y: edit.y, width: edit.width, height: edit.height },
      selected: index === frame.selectedEditIndex,
      frameSize: profile.frame,
    }))
    if (frame.pointerDraft) {
      commands.push({
        type: 'frame_repair_rectangle',
        op: frame.maskMode,
        rectangle: rectangleFromFramePoints(frame.pointerDraft.start, frame.pointerDraft.end),
        selected: true,
        frameSize: profile.frame,
      })
    }
    return commands
  }

  function decorateWorkbenchView(workbenchView) {
    const frame = frameState()
    if (!frame?.active) return workbenchView
    const frameView = viewModel(workbenchView)
    const candidateSheet = frame.candidate?.sheet ?? null
    const currentFrameIndex = workbenchView.frameIndex
    let candidateRect = null
    if (candidateSheet && Number.isInteger(currentFrameIndex)) {
      try {
        candidateRect = resolveSheetFrameRect({
          frameIndex: currentFrameIndex,
          frameSize: profile.frame,
          sheetSize: { w: candidateSheet.width, h: candidateSheet.height },
        })
      } catch {
        candidateRect = null
      }
    }
    const showingTarget = currentFrameIndex === frame.selection.sheetFrameIndex
    const baseRender = workbenchView.renderFrame ?? {}
    const baseDrawOverlay = baseRender.drawOverlay
    const supportedBaseOverlays = (Array.isArray(baseRender.overlayCommands) ? baseRender.overlayCommands : [])
      .filter((command) => command?.overlay === 'anchor' || command?.overlay === 'bbox')
    const overlayCommands = [
      ...supportedBaseOverlays,
      ...(showingTarget && maskSource ? [{ type: 'frame_repair_mask', source: maskSource }] : []),
      ...(showingTarget ? rectangleOverlayCommands(frame) : []),
    ]
    const renderFrame = {
      ...baseRender,
      after: candidateRect ? candidateSheet : null,
      afterSheet: candidateSheet,
      afterRect: candidateRect,
      differenceSource: showingTarget && frame.candidate?.differenceImage
        ? frame.candidate.differenceImage
        : null,
      overlayCommands,
      drawOverlay(ctx, command, viewport, pixelRatio) {
        if (command.type === 'frame_repair_mask' || command.type === 'frame_repair_rectangle') {
          drawFrameRepairOverlay(ctx, command, viewport, pixelRatio)
        } else if (typeof baseDrawOverlay === 'function') {
          baseDrawOverlay(ctx, command, viewport, pixelRatio)
        }
      },
    }
    const filmstrip = workbenchView.filmstrip
      ? {
          ...workbenchView.filmstrip,
          items: (workbenchView.filmstrip.items ?? []).map((item) => ({
            ...item,
            source: candidateSheet ?? item.source,
            repaired: Boolean(candidateSheet) && item.frameIndex === frame.selection.sheetFrameIndex,
            repairedLabel: candidateSheet && item.frameIndex === frame.selection.sheetFrameIndex
              ? 'Repaired candidate'
              : null,
          })),
        }
      : workbenchView.filmstrip
    const modeAvailability = getRepairComparisonAvailability({
      before: renderFrame.before,
      beforeRect: renderFrame.beforeRect,
      after: renderFrame.after,
      afterRect: renderFrame.afterRect,
    })
    return {
      ...workbenchView,
      modeAvailability,
      renderFrame,
      filmstrip,
      frameRepair: frameView,
    }
  }

  function handleLifecycleUpdate(event) {
    const frame = frameState()
    if (!frame?.active || !event) return null
    if (event.type === 'planning') {
      frame.uiState = 'planning'
      render(getFrameRepairUiState('planning').message)
    }
    if (event.type === 'generation_started') {
      frame.operationId = event.operationId
      frame.stage = 'processing'
      frame.uiState = 'confirming'
      render()
    }
    if (event.type === 'job') return adoptJob(event.job)
    if (event.type === 'outcome_unknown') {
      frame.job = event.job ? structuredClone(event.job) : frame.job
      frame.stage = 'processing'
      frame.uiState = 'outcome_unknown'
      render(getFrameRepairUiState('outcome_unknown').message)
    }
    if (event.type === 'accepting') {
      frame.uiState = 'accepting'
      render(getFrameRepairUiState('accepting').message)
    }
    if (event.type === 'accepted') {
      frame.uiState = 'accepted'
      frame.warningConfirmation = null
      notifyAccepted(event.result)
      render(getFrameRepairUiState('accepted').message)
    }
    if (event.type === 'error') {
      const error = event.error ?? controlledError(`${event.phase}_failed`, 'Frame Repair request failed')
      setControllerError(
        error,
        event.phase === 'generate' ? 'model' : event.phase,
        event.outcomeUnknown === true,
      )
    }
    if (event.type === 'selection_switched') close('selection_switched')
    return null
  }

  function dispose() {
    if (disposed) return
    close('teardown')
    disposed = true
  }

  return Object.freeze({
    enter,
    enterQualityGateAuthoringCase,
    enterLockedQualityGateCase,
    exportQualityGateCaseDraft,
    close,
    dispose,
    viewModel,
    decorateWorkbenchView,
    setInstruction,
    setProviderPreset,
    setImageSize,
    setMaskMode,
    addRectangle,
    removeRectangle,
    selectEdit,
    updateSelectedEdit,
    deleteSelectedEdit,
    undoMaskEdit,
    reviewCall,
    generateOneCandidate,
    recoverOriginalOperation,
    acceptCandidate,
    discardCandidate,
    confirmWarning,
    handlePointer,
    handleLifecycleUpdate,
  })
}
