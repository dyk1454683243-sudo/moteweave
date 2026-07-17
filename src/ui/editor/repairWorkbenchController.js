import { resolveSourceLayout } from '../../character-pack/sourceLayouts.js'
import {
  applyRepairDraftSettingsHash,
  createRepairRecipeDraft,
  updateRepairRecipeDraft,
  validateRepairRecipeDraft,
} from '../../editor-project/repairRecipe.js'
import {
  createDraftSettingsHashInput,
  serializeCanonicalRecipe,
} from '../../editor-project/repairRecipeSerialization.js'
import {
  getRepairAcceptanceState,
  getRepairPreviewFreshness,
  reduceRepairFilmstrip,
} from '../../editor-project/repairState.js'
import { validateProcessingRecipe } from '../../editor-project/validation.js'
import {
  analyzeRepairDifferencePixels,
  buildDifferencePixels,
  createRepairDifferenceSource,
  getRepairComparisonAvailability,
  readRepairFramePixels,
  resolveSheetFrameRect,
} from './repairComparisonRenderer.js'
import { normalizeRepairEvidence } from './repairEvidence.js'
import { hashRepairRecipeBytes } from './repairHash.js'
import {
  buildRepairDraftOverlayCommands,
  buildRepairWorkbenchViewModel,
  createInitialRepairRenderFrame,
  createNoPreviewModel,
  repairInvalidPaths,
} from './repairWorkbenchPanel.js'
import { createEmptyLocalRepairState } from './state.js'

const PREVIEW_ARTIFACT_FILES = Object.freeze({
  normalized_sheet_url: 'normalized_sheet.png',
  animations_url: 'animations.json',
  metadata_url: 'metadata.json',
  editor_metadata_url: 'editor_metadata.json',
  debug_report_url: 'debug_report.json',
  processing_recipe_url: 'processing_recipe.json',
  reprocess_context_url: 'editor_reprocess_context.json',
})

const REPROCESS_CONTEXT_KEYS = Object.freeze([
  'version',
  'job_type',
  'preview_job_id',
  'submitted_at',
  'project_id',
  'project_revision',
  'asset_id',
  'parent_revision_id',
  'input_mode',
  'input_artifact_key',
  'input_artifact_ref',
  'input_artifact_sha256',
  'black_matte_artifact_sha256',
  'authoritative_source_layout',
  'recipe_hash',
  'draft_settings_hash',
  'implementation_revision',
])

const HYDRATABLE_TERMINAL_STATUSES = new Set([
  'done',
  'failed_quality_gate',
  'failed_post_processing',
])

const FAILED_TERMINAL_STATUSES = new Set([
  'failed',
  'failed_model_error',
  'failed_safety_filter',
  'not_found',
])

const HASH_PATTERN = /^[a-f0-9]{64}$/
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function sameSelection(left, right) {
  return Boolean(left && right) &&
    left.projectId === right.projectId &&
    left.projectRevision === right.projectRevision &&
    left.assetId === right.assetId &&
    left.revisionId === right.revisionId
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function controlledError(code, message, details = null) {
  const error = new Error(message)
  error.name = 'RepairWorkbenchError'
  error.code = code
  error.details = details
  return error
}

function integrityError(message, details = null) {
  return controlledError('artifact_integrity_failed', message, details)
}

function managedArtifactUrl(ref) {
  return `/api/editor/artifact?path=${encodeURIComponent(ref)}`
}

function uniformBoundaries(size, count) {
  return Array.from({ length: count + 1 }, (_, index) => Math.round((size * index) / count))
}

function exactKeys(value, keys) {
  if (!isRecord(value)) return false
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return sameJson(actual, expected)
}

function validSheetContract(value, profile) {
  return isRecord(value) &&
    value.profile === profile.id &&
    value.sheet === 'normalized_sheet.png' &&
    value.frame_size?.w === profile.frame.w &&
    value.frame_size?.h === profile.frame.h &&
    value.sheet_size?.w === profile.sheet.w &&
    value.sheet_size?.h === profile.sheet.h
}

function normalizePreviewClips(animations, profile) {
  if (!isRecord(animations)) throw integrityError('preview animations are invalid')
  const result = {}
  const frameCount = profile.grid.columns * profile.grid.rows
  for (const [id, clip] of Object.entries(animations)) {
    if (!ID_PATTERN.test(id) || !isRecord(clip) || !Array.isArray(clip.frames) ||
        !clip.frames.every((frame) => Number.isInteger(frame) && frame >= 0 && frame < frameCount) ||
        !Number.isFinite(clip.fps) || clip.fps <= 0) {
      throw integrityError('preview animation clip is invalid', { clipId: id })
    }
    result[id] = {
      id,
      label: typeof clip.label === 'string' && clip.label ? clip.label : id,
      frames: [...clip.frames],
      fps: clip.fps,
      loop_mode: clip.mode ?? (clip.loop ? 'loop' : 'once'),
    }
  }
  return result
}

function explicitPreviewArtifactUrls(job) {
  if (!isRecord(job) || !ID_PATTERN.test(String(job.id ?? ''))) {
    throw integrityError('preview job identity is invalid')
  }
  const entries = Object.entries(PREVIEW_ARTIFACT_FILES).map(([key, fileName]) => [
    key,
    job[key],
    `/generated/${job.id}/${fileName}`,
  ])
  const mismatch = entries.find(([, value, expected]) => value !== expected)
  if (mismatch) {
    throw integrityError('preview artifact set is incomplete', {
      field: mismatch[0],
      expected: mismatch[2],
    })
  }
  return {
    byKey: Object.fromEntries(entries.map(([key, value]) => [key, value])),
    allowlist: new Set(entries.map(([, value]) => value)),
  }
}

function safeFrameRect({ frameIndex, frameSize, image }) {
  if (!Number.isInteger(frameIndex) || !image) return null
  try {
    return resolveSheetFrameRect({
      frameIndex,
      frameSize,
      sheetSize: { w: image.width, h: image.height },
    })
  } catch {
    return null
  }
}

function defaultCreateFrameDifference({ beforeImage, beforeRect, afterImage, afterRect }) {
  const beforePixels = readRepairFramePixels(beforeImage, beforeRect)
  const afterPixels = readRepairFramePixels(afterImage, afterRect)
  const imageData = buildDifferencePixels(beforePixels, afterPixels)
  return {
    imageData,
    source: createRepairDifferenceSource(imageData),
    diagnostics: analyzeRepairDifferencePixels(beforePixels, afterPixels).diagnostics,
  }
}

function defaultUnsavedReason(state) {
  return state.dirty
    ? 'Save project changes before building or accepting a repair Preview'
    : null
}

export function createRepairWorkbenchController({
  state,
  profile,
  artifactClient,
  lifecycle,
  getSelectedAsset,
  requestRender,
  addLog,
  renderAiActionContent,
  hashDraft = hashRepairRecipeBytes,
  getUnsavedReason = () => defaultUnsavedReason(state),
  createFrameDifference = defaultCreateFrameDifference,
  frameRepairController = null,
  schedule = (callback, delay) => setTimeout(callback, delay),
  cancel = clearTimeout,
}) {
  const editorState = state
  const TOPDOWN_RPG_V0 = profile
  const repairArtifactClient = artifactClient
  const repairPreviewLifecycle = lifecycle
  const selectedRepairAsset = getSelectedAsset
  const renderAll = requestRender
  const addEditorLog = addLog
  const targetedFrameRepair = frameRepairController
  let repairWorkbench = null
  let repairPlaybackTimer = null
  let repairOpenGeneration = 0
  let repairHydrationGeneration = 0
  let openAbortController = null
  let hydrationAbortController = null
  let managedCacheIdentity = null
  const previewCacheIdentities = new Set()
  let disposed = false

  function attach(panel) {
    repairWorkbench = panel
  }

  function repairSelection(asset, revision) {
    return {
      projectId: editorState.project.id,
      projectRevision: editorState.project.revision,
      assetId: asset.id,
      revisionId: revision.id,
    }
  }

  function currentRevision(asset = selectedRepairAsset()) {
    return asset?.revisions?.[asset.active_revision_id] ?? null
  }

  function renderWorkbench() {
    const asset = selectedRepairAsset()
    const revision = currentRevision(asset)
    const local = editorState.repair.local
    if (!repairWorkbench || !asset || !revision || !local.draft ||
        !sameSelection(local.selection, repairSelection(asset, revision))) return
    repairWorkbench.render(repairWorkbenchContext(asset, revision).viewModel())
  }

  function stopRepairPlaybackTimer() {
    if (repairPlaybackTimer != null) cancel(repairPlaybackTimer)
    repairPlaybackTimer = null
  }

  function abortOpenAndHydration() {
    openAbortController?.abort()
    openAbortController = null
    hydrationAbortController?.abort()
    hydrationAbortController = null
    repairOpenGeneration += 1
    repairHydrationGeneration += 1
  }

  function clearPreviewCaches() {
    const localJobId = editorState.repair.local.preview?.jobId
    if (localJobId) previewCacheIdentities.add(`job:${localJobId}`)
    for (const identity of previewCacheIdentities) repairArtifactClient.clearRepairArtifactCache(identity)
    previewCacheIdentities.clear()
  }

  function clearManagedCache() {
    const local = editorState.repair.local
    if (local.selection) {
      repairArtifactClient.clearRepairArtifactCache(`${local.selection.assetId}:${local.selection.revisionId}`)
    }
    if (managedCacheIdentity) repairArtifactClient.clearRepairArtifactCache(managedCacheIdentity)
    managedCacheIdentity = null
  }

  function clearLocalRepairAsyncWork({ stopLifecycle = true, clearCaches = true } = {}) {
    abortOpenAndHydration()
    stopRepairPlaybackTimer()
    if (stopLifecycle) repairPreviewLifecycle.stop()
    if (clearCaches) {
      clearManagedCache()
      clearPreviewCaches()
    }
  }

  function close(reason = 'panel_switch') {
    targetedFrameRepair?.close(reason)
    stopRepairPlaybackTimer()
    openAbortController?.abort()
    openAbortController = null
    hydrationAbortController?.abort()
    hydrationAbortController = null
    repairOpenGeneration += 1
    repairHydrationGeneration += 1
    if (reason === 'panel_switch') {
      const local = editorState.repair.local
      if (local.status === 'loading') {
        local.status = 'paused'
        local.message = 'Repair loading paused; reopen Repair to retry.'
      }
      return
    }
    clearLocalRepairAsyncWork()
  }

  function dispose() {
    if (disposed) return
    targetedFrameRepair?.dispose?.()
    disposed = true
    clearLocalRepairAsyncWork()
    repairWorkbench = null
  }

  async function optionalManagedJson(identity, ref, allowedManagedUrls, signal) {
    if (!ref) return { present: false, value: null, diagnostic: null }
    try {
      return {
        present: true,
        value: await repairArtifactClient.loadJson({
          identity,
          url: managedArtifactUrl(ref),
          allowedManagedUrls,
          signal,
        }),
        diagnostic: null,
      }
    } catch (error) {
      if (error?.status === 404 || error?.code === 'artifact_not_found') {
        return { present: false, value: null, diagnostic: null }
      }
      if (error instanceof SyntaxError) {
        return { present: true, value: null, diagnostic: 'invalid_parent_recipe_defaulted' }
      }
      throw error
    }
  }

  function compatibleLayout(layoutId) {
    if (typeof layoutId !== 'string' || !layoutId) return null
    try {
      return resolveSourceLayout(layoutId)
    } catch {
      return null
    }
  }

  function validateManagedDocuments({ animations, metadata, editorMetadata, debugReport, inputMode }) {
    if (animations?.profile !== TOPDOWN_RPG_V0.id ||
        metadata?.profile !== TOPDOWN_RPG_V0.id ||
        editorMetadata?.profile !== TOPDOWN_RPG_V0.id ||
        debugReport?.profile !== TOPDOWN_RPG_V0.id) {
      throw controlledError('managed_profile_mismatch', 'managed Character Pack sidecars disagree with the supported profile')
    }
    if (!validSheetContract(animations, TOPDOWN_RPG_V0) ||
        !validSheetContract(editorMetadata, TOPDOWN_RPG_V0)) {
      throw controlledError('invalid_managed_metadata', 'managed Character Pack sheet metadata is invalid')
    }
    normalizePreviewClips(animations.animations, TOPDOWN_RPG_V0)
    const debugLayout = compatibleLayout(debugReport?.source_layout?.id)
    const animationLayout = compatibleLayout(animations?.source_layout?.id)
    if (inputMode === 'normalized_sheet_fallback') return resolveSourceLayout(TOPDOWN_RPG_V0.id)
    if (!debugLayout || !animationLayout) {
      throw controlledError('missing_source_layout', 'managed source layout evidence is missing or unregistered')
    }
    if (debugLayout.id !== animationLayout.id) {
      throw controlledError('managed_source_layout_mismatch', 'managed source layout sidecars disagree')
    }
    return debugLayout
  }

  function createRepairSourceContext({ inputMode, layout, revision, inputImage, beforeImage, blackMatteImage }) {
    const blackMatteRef = blackMatteImage ? revision.artifacts.black_matte : null
    return {
      inputMode,
      sourceLayout: layout.id,
      sourceLayoutKind: layout.kind,
      sourceFileName: (revision.artifacts.source ?? revision.artifacts.sheet).split('/').at(-1),
      sourceSize: { width: inputImage.width, height: inputImage.height },
      blackMatteArtifactRef: blackMatteRef,
      beforeImage,
      autoGrid: {
        columns: uniformBoundaries(inputImage.width, TOPDOWN_RPG_V0.grid.columns),
        rows: uniformBoundaries(inputImage.height, TOPDOWN_RPG_V0.grid.rows),
      },
      manualGrid: {
        enabled: inputMode === 'managed_source' && layout.kind === 'uniform_grid',
        reason: inputMode !== 'managed_source'
          ? 'Manual cuts are unavailable for normalized-sheet fallback'
          : layout.kind !== 'uniform_grid'
            ? 'Manual cuts are unavailable for fixed-region sources'
            : null,
      },
      dualMatte: {
        enabled: inputMode === 'managed_source' && Boolean(blackMatteRef),
        reason: inputMode !== 'managed_source'
          ? 'Dual matte is unavailable for normalized-sheet fallback'
          : !blackMatteRef
            ? 'No valid managed black matte is recorded'
            : null,
      },
    }
  }

  function managedOpenStillCurrent(generation, selection) {
    const asset = selectedRepairAsset()
    const revision = currentRevision(asset)
    return !disposed &&
      editorState.repair.local.openGeneration === generation &&
      sameSelection(editorState.repair.local.selection, selection) &&
      Boolean(asset && revision) &&
      sameSelection(selection, repairSelection(asset, revision))
  }

  async function openRepairForAsset(asset) {
    const revision = asset?.revisions?.[asset.active_revision_id]
    if (!editorState.project || asset?.kind !== 'character_pack' || !revision || disposed) return null

    targetedFrameRepair?.close('selection_switched')
    clearLocalRepairAsyncWork()
    const controller = new AbortController()
    openAbortController = controller
    const generation = ++repairOpenGeneration
    const selection = repairSelection(asset, revision)
    const loading = createEmptyLocalRepairState()
    loading.openGeneration = generation
    loading.selection = selection
    loading.status = 'loading'
    loading.message = 'Loading managed Character Pack artifacts…'
    editorState.repair.local = loading
    editorState.selectedAssetId = asset.id
    editorState.selectedLayerId = null
    editorState.activePanel = 'repair'
    repairPreviewLifecycle.setSelection(selection)
    renderAll()

    const identity = `${asset.id}:${revision.id}`
    managedCacheIdentity = identity
    const artifactRefs = [revision.processing_recipe_ref, ...Object.values(revision.artifacts ?? {})].filter(Boolean)
    const allowedManagedUrls = new Set(artifactRefs.map(managedArtifactUrl))
    const requiredRefs = [
      revision.artifacts?.sheet,
      revision.artifacts?.animations,
      revision.artifacts?.metadata,
      revision.artifacts?.editor_metadata,
      revision.artifacts?.debug_report,
    ]
    if (requiredRefs.some((ref) => typeof ref !== 'string' || !ref)) {
      const error = controlledError('invalid_managed_metadata', 'managed Character Pack artifacts are incomplete')
      loading.status = 'failed'
      loading.error = error
      loading.message = `${error.code}: ${error.message}`
      renderAll()
      return null
    }

    try {
      const inputMode = revision.artifacts.source ? 'managed_source' : 'normalized_sheet_fallback'
      const [recipeLoad, animations, metadata, editorMetadata, debugReport, beforeImage, inputImage, blackMatteImage] = await Promise.all([
        optionalManagedJson(identity, revision.processing_recipe_ref, allowedManagedUrls, controller.signal),
        repairArtifactClient.loadJson({ identity, url: managedArtifactUrl(revision.artifacts.animations), allowedManagedUrls, signal: controller.signal }),
        repairArtifactClient.loadJson({ identity, url: managedArtifactUrl(revision.artifacts.metadata), allowedManagedUrls, signal: controller.signal }),
        repairArtifactClient.loadJson({ identity, url: managedArtifactUrl(revision.artifacts.editor_metadata), allowedManagedUrls, signal: controller.signal }),
        repairArtifactClient.loadJson({ identity, url: managedArtifactUrl(revision.artifacts.debug_report), allowedManagedUrls, signal: controller.signal }),
        repairArtifactClient.loadImage({ identity, url: managedArtifactUrl(revision.artifacts.sheet), allowedManagedUrls, signal: controller.signal }),
        repairArtifactClient.loadImage({ identity, url: managedArtifactUrl(revision.artifacts.source ?? revision.artifacts.sheet), allowedManagedUrls, signal: controller.signal }),
        revision.artifacts.black_matte
          ? repairArtifactClient.loadImage({ identity, url: managedArtifactUrl(revision.artifacts.black_matte), allowedManagedUrls, signal: controller.signal })
          : Promise.resolve(null),
      ])
      if (!managedOpenStillCurrent(generation, selection)) return null

      if (beforeImage.width !== TOPDOWN_RPG_V0.sheet.w || beforeImage.height !== TOPDOWN_RPG_V0.sheet.h ||
          !Number.isInteger(inputImage.width) || inputImage.width <= 0 ||
          !Number.isInteger(inputImage.height) || inputImage.height <= 0) {
        throw controlledError('invalid_managed_metadata', 'managed Character Pack image dimensions are invalid')
      }
      const selectedLayout = validateManagedDocuments({ animations, metadata, editorMetadata, debugReport, inputMode })
      let loadedRecipe = recipeLoad.value
      let parentRecipeDiagnostic = recipeLoad.diagnostic
      if (loadedRecipe && validateProcessingRecipe(loadedRecipe).status === 'fail') {
        loadedRecipe = null
        parentRecipeDiagnostic = 'invalid_parent_recipe_defaulted'
      }
      if (loadedRecipe?.source?.source_layout &&
          compatibleLayout(loadedRecipe.source.source_layout)?.id !== selectedLayout.id) {
        loadedRecipe = null
        parentRecipeDiagnostic = 'invalid_parent_recipe_layout_defaulted'
      }

      const sourceContext = createRepairSourceContext({
        inputMode,
        layout: selectedLayout,
        revision,
        inputImage,
        beforeImage,
        blackMatteImage,
      })
      let draft = createRepairRecipeDraft({ asset, revision, loadedRecipe, sourceContext })
      draft = {
        ...draft,
        provenance: Object.freeze({
          ...draft.provenance,
          fixedRegionStaging: isRecord(debugReport.source_staging)
            ? structuredClone(debugReport.source_staging)
            : null,
        }),
        diagnostics: [
          ...draft.diagnostics,
          ...(parentRecipeDiagnostic ? [parentRecipeDiagnostic] : []),
        ],
      }
      const validationContext = {
        profile: TOPDOWN_RPG_V0,
        sourceSize: sourceContext.sourceSize,
        inputMode,
        sourceLayoutKind: sourceContext.sourceLayoutKind,
        hasBlackMatte: sourceContext.dualMatte.enabled,
        implementationRevision: null,
      }
      let validation = validateRepairRecipeDraft(draft, validationContext)
      if (validation.status === 'fail' && loadedRecipe) {
        draft = createRepairRecipeDraft({ asset, revision, loadedRecipe: null, sourceContext })
        draft = {
          ...draft,
          provenance: Object.freeze({
            ...draft.provenance,
            fixedRegionStaging: isRecord(debugReport.source_staging)
              ? structuredClone(debugReport.source_staging)
              : null,
          }),
          diagnostics: [...draft.diagnostics, 'invalid_parent_recipe_defaulted'],
        }
        validation = validateRepairRecipeDraft(draft, validationContext)
      }
      if (validation.status === 'fail' || !validation.canonical) {
        throw controlledError('invalid_recipe', 'a valid local Repair Recipe could not be initialized', {
          blocking_errors: validation.blocking_errors,
        })
      }
      const initialDraftSettingsHash = await hashDraft(
        serializeCanonicalRecipe(createDraftSettingsHashInput(validation.canonical)),
      )
      if (!managedOpenStillCurrent(generation, selection)) return null

      const clipId = Object.keys(asset.clips ?? {})[0] ?? ''
      const frames = Array.isArray(asset.clips?.[clipId]?.frames) ? [...asset.clips[clipId].frames] : []
      const local = createEmptyLocalRepairState()
      local.openGeneration = generation
      local.selection = selection
      local.sourceContext = sourceContext
      local.profile = TOPDOWN_RPG_V0
      local.validationContext = validationContext
      local.validation = { ...validation, invalidPaths: repairInvalidPaths(validation.blocking_errors) }
      local.lastValidCanonical = validation.canonical
      local.draft = applyRepairDraftSettingsHash(draft, initialDraftSettingsHash, { initialize: true })
      local.currentDraftSettingsHash = initialDraftSettingsHash
      local.filmstrip = { frames, selectedIndex: 0, playing: false }
      local.view.clipId = clipId
      local.view.frameIndex = frames[0] ?? null
      local.renderFrame = createInitialRepairRenderFrame({ local, beforeImage })
      local.previewModel = createNoPreviewModel({ beforeImage, frames })
      local.previewModel.clips = null
      local.previewModel.artifactsComplete = false
      local.status = 'idle'
      local.message = ''
      editorState.repair.local = local
      openAbortController = null
      renderAll()
      return local
    } catch (error) {
      if (error?.name === 'AbortError' || !managedOpenStillCurrent(generation, selection)) return null
      const local = editorState.repair.local
      local.status = 'failed'
      local.error = error
      local.message = `${error.code ?? 'repair_initialization_failed'}: ${error.message || error}`
      openAbortController = null
      renderAll()
      return null
    }
  }

  function validationWithPaths(validation) {
    return {
      ...validation,
      invalidPaths: repairInvalidPaths(validation.blocking_errors),
    }
  }

  function overlayCommands(local, recipe = local.lastValidCanonical ?? local.draft.recipe) {
    return buildRepairDraftOverlayCommands({
      recipe,
      profile: local.profile,
      frameIndex: local.view.frameIndex,
      sourceSize: local.sourceContext.sourceSize,
      sourceLayoutKind: local.sourceContext.sourceLayoutKind,
      bbox: local.previewModel.evidence?.framesByIndex?.[String(local.view.frameIndex)]?.bbox ?? null,
      debugAnchor: local.previewModel.evidence?.framesByIndex?.[String(local.view.frameIndex)]?.anchor ?? null,
    })
  }

  function markDraftHashPending(local, generation) {
    local.draftHashGeneration = generation
    local.currentDraftSettingsHash = null
    local.draft = { ...local.draft, currentDraftSettingsHash: null, hashStatus: 'pending', dirty: true }
    local.warningConfirmation = null
    local.previewModel = {
      ...local.previewModel,
      state: local.preview ? 'stale' : 'dirty',
      acceptance: { canAccept: false, reason: local.preview ? 'preview_stale' : 'no_preview' },
    }
  }

  function repairWorkbenchContext(asset, revision) {
    const local = editorState.repair.local
    return {
      selection: repairSelection(asset, revision),
      viewModel: () => {
        const unsavedReason = getUnsavedReason() ?? null
        const base = buildRepairWorkbenchViewModel({
          local,
          aiAction: editorState.repair.aiAction,
          asset,
          revision,
          sourceContext: local.sourceContext,
          profile: local.profile,
          validation: local.validation,
          previewModel: local.previewModel,
          renderFrame: local.renderFrame,
          unsavedReason,
        })
        const frameActive = editorState.repair.frame?.active === true
        const frameEntryReason = frameActive
          ? null
          : unsavedReason ??
            (!base.hasSelectedFrame ? 'Select one real clip frame' : null) ??
            (!local.sourceContext?.beforeImage ? 'The managed parent sheet is unavailable' : null) ??
            (!editorState.repair.frame?.providerState
              ? editorState.repair.frame?.error
                ? 'Safe provider state is unavailable; reload the Editor to retry'
                : 'Loading safe provider presets'
              : null) ??
            (['queued', 'processing', 'accepting'].includes(local.previewModel.state)
              ? 'Wait for the current Preview operation to finish'
              : null) ??
            (['planning', 'running'].includes(editorState.repair.aiAction.status)
              ? 'Wait for AI Action Repair to finish'
              : null)
        base.frameRepairEligibility = {
          enabled: frameActive || frameEntryReason == null,
          reason: frameEntryReason,
        }
        return targetedFrameRepair?.decorateWorkbenchView(base) ?? base
      },
      setView(patch) {
        local.view = { ...local.view, ...patch }
        local.renderFrame = {
          ...local.renderFrame,
          mode: local.view.mode,
          zoom: local.view.zoom,
          pan: local.view.pan,
        }
        renderWorkbench()
      },
      patchDraft(patch) {
        if (!local.draft || local.acceptInFlight) return
        const draftHashGeneration = repairPreviewLifecycle.invalidateDraft()
        markDraftHashPending(local, draftHashGeneration)
        try {
          const nextDraft = updateRepairRecipeDraft(local.draft, patch)
          const validation = validateRepairRecipeDraft(nextDraft, local.validationContext)
          local.draft = {
            ...nextDraft,
            currentDraftSettingsHash: null,
            hashStatus: 'pending',
          }
          local.validation = validationWithPaths(validation)
          if (validation.status !== 'fail') {
            local.lastValidCanonical = validation.canonical
            local.renderFrame = { ...local.renderFrame, overlayCommands: overlayCommands(local, validation.canonical) }
            void repairPreviewLifecycle.digestDraft(
              serializeCanonicalRecipe(createDraftSettingsHashInput(validation.canonical)),
              { generation: draftHashGeneration },
            )
          }
        } catch (error) {
          local.validation = validationWithPaths({ status: 'fail', blocking_errors: [error.code ?? 'invalid_recipe'], canonical: null })
          local.error = error
        }
        renderWorkbench()
      },
      resetDraft() {
        resetLocalRepairDraft()
        renderWorkbench()
      },
      buildPreview() { return buildLocalRepairPreview() },
      acceptPreview() { return acceptLocalRepairPreview() },
      discard() { discardLocalRepairSession() },
      handleFilmstripKey(key) {
        dispatchRepairFilmstrip({
          type: key === 'Home' ? 'first' : key === 'End' ? 'last' : key === ' ' ? 'toggle_play' : 'arrow',
          key,
          filmstripFocused: true,
        })
      },
      handleFilmstripAction(type) { dispatchRepairFilmstrip({ type }) },
      selectClip(clipId) { selectRepairClip(clipId) },
      selectFilmstripFrame(index) {
        if (Number.isInteger(index) && index >= 0 && index < local.filmstrip.frames.length &&
            index !== local.filmstrip.selectedIndex) {
          targetedFrameRepair?.close('selection_switched')
        }
        dispatchRepairFilmstrip({ type: 'select', index })
      },
      confirmWarning(confirmed) { confirmLocalRepairWarning(confirmed) },
      enterFrameRepair() { return targetedFrameRepair?.enter(frameRepairSnapshot(asset, revision)) ?? false },
      closeFrameRepair(reason) { targetedFrameRepair?.close(reason) },
      setFrameRepairInstruction(value) { return targetedFrameRepair?.setInstruction(value) ?? false },
      setFrameRepairProvider(value) { return targetedFrameRepair?.setProviderPreset(value) ?? false },
      setFrameRepairImageSize(value) { return targetedFrameRepair?.setImageSize(value) ?? false },
      setFrameRepairMaskMode(value) { return targetedFrameRepair?.setMaskMode(value) ?? false },
      addFrameRepairRectangle(value) { return targetedFrameRepair?.addRectangle(value) ?? false },
      removeFrameRepairRectangle(value) { return targetedFrameRepair?.removeRectangle(value) ?? false },
      selectFrameRepairEdit(index) { return targetedFrameRepair?.selectEdit(index) ?? false },
      updateFrameRepairEdit(value) { return targetedFrameRepair?.updateSelectedEdit(value) ?? false },
      deleteFrameRepairEdit() { return targetedFrameRepair?.deleteSelectedEdit() ?? false },
      undoFrameRepairEdit() { return targetedFrameRepair?.undoMaskEdit() ?? false },
      reviewFrameRepairCall() { return targetedFrameRepair?.reviewCall() ?? Promise.resolve(null) },
      generateFrameRepairCandidate() { return targetedFrameRepair?.generateOneCandidate() ?? Promise.resolve(null) },
      recoverFrameRepairOperation() { return targetedFrameRepair?.recoverOriginalOperation() ?? Promise.resolve(null) },
      acceptFrameRepairCandidate() { return targetedFrameRepair?.acceptCandidate() ?? Promise.resolve(null) },
      discardFrameRepairCandidate() { return targetedFrameRepair?.discardCandidate() ?? false },
      confirmFrameRepairWarning(value) { return targetedFrameRepair?.confirmWarning(value) ?? false },
      handleFrameRepairPointer(type, payload) { return targetedFrameRepair?.handlePointer(type, payload) ?? false },
      renderAiAction(container) { renderAiActionContent(container) },
      onClose(reason) { close(reason) },
    }
  }

  function frameRepairSnapshot(asset, revision) {
    const local = editorState.repair.local
    const clip = asset.clips?.[local.view.clipId] ?? null
    const clipFrames = Array.isArray(clip?.frames) ? [...clip.frames] : []
    const clipFramePosition = local.filmstrip.selectedIndex
    const sheetFrameIndex = clipFrames[clipFramePosition]
    const beforeImage = local.sourceContext.beforeImage
    return {
      selection: repairSelection(asset, revision),
      clipId: local.view.clipId,
      clipFrames,
      clipFramePosition,
      sheetFrameIndex,
      beforeImage,
      beforeRect: safeFrameRect({
        frameIndex: sheetFrameIndex,
        frameSize: local.profile.frame,
        image: beforeImage,
      }),
      providerState: editorState.repair.frame?.providerState ?? null,
      unsavedReason: getUnsavedReason() ?? null,
      workbenchView: {
        view: structuredClone(local.view),
        renderFrame: {
          ...local.renderFrame,
          pan: { ...local.renderFrame.pan },
          overlayCommands: [...(local.renderFrame.overlayCommands ?? [])],
        },
      },
    }
  }

  function clearCurrentPreviewForBuild() {
    const local = editorState.repair.local
    hydrationAbortController?.abort()
    hydrationAbortController = null
    repairHydrationGeneration += 1
    clearPreviewCaches()
    local.differenceCache.clear()
    local.preview = null
    local.warningConfirmation = null
    local.previewModel = {
      ...createNoPreviewModel({
        beforeImage: local.sourceContext.beforeImage,
        frames: local.filmstrip.frames,
      }),
      state: 'queued',
      clips: null,
      artifactsComplete: false,
      acceptance: { canAccept: false, reason: 'job_not_done' },
    }
    local.renderFrame = {
      ...local.renderFrame,
      after: null,
      afterSheet: null,
      afterRect: null,
      differenceImageData: null,
      differenceSource: null,
    }
  }

  function jobFailureDiagnostic(job) {
    return {
      code: job.status,
      message: job.reason || 'Preview processing failed',
      retry_hint: job.retry_hint ?? null,
    }
  }

  function setTerminalFailure(job) {
    const local = editorState.repair.local
    const diagnostic = jobFailureDiagnostic(job)
    local.status = job.status
    local.error = controlledError(job.status, diagnostic.message, { retry_hint: diagnostic.retry_hint })
    local.message = `${job.status}: ${diagnostic.message}`
    local.previewModel = {
      ...local.previewModel,
      state: 'failed',
      acceptance: { canAccept: false, reason: job.status },
      diagnostics: [
        ...(local.previewModel.diagnostics ?? []).filter((item) => item.code !== job.status),
        diagnostic,
      ],
    }
  }

  function hydrateCurrentRepairPreview(job, expectedSelection) {
    return hydrateRepairPreview(job, expectedSelection).catch((error) => {
      const local = editorState.repair.local
      if (error?.name === 'AbortError' || local.preview?.jobId !== job.id || !sameSelection(local.selection, expectedSelection)) return null
      handleRepairLifecycleUpdate({ type: 'error', phase: 'artifact_hydration', error })
      return null
    })
  }

  function handleRepairLifecycleUpdate(event) {
    const local = editorState.repair.local
    if (!local) return null
    if (event.type === 'build_started') {
      clearCurrentPreviewForBuild()
      local.status = 'queued'
      local.error = null
      local.message = ''
    }
    if (event.type === 'preview_created') {
      const preview = event.preview
      local.differenceCache.clear()
      local.warningConfirmation = null
      local.preview = {
        jobId: preview.id,
        buildGeneration: event.buildGeneration,
        recipeHash: preview.recipe_hash,
        submittedDraftSettingsHash: preview.draft_settings_hash,
        submittedCanonicalRecipe: isRecord(preview.canonical_recipe)
          ? structuredClone(preview.canonical_recipe)
          : null,
        selection: structuredClone(local.selection),
        job: structuredClone(preview),
      }
      local.status = preview.status
      local.previewModel = {
        ...local.previewModel,
        state: preview.status === 'queued' ? 'queued' : 'processing',
        artifactsComplete: false,
        acceptance: { canAccept: false, reason: 'job_not_done' },
      }
      if (HYDRATABLE_TERMINAL_STATUSES.has(preview.status)) {
        return hydrateCurrentRepairPreview(preview, local.preview.selection)
      }
      if (FAILED_TERMINAL_STATUSES.has(preview.status)) setTerminalFailure(preview)
    }
    if (event.type === 'job' &&
        local.preview?.jobId === event.job.id &&
        local.preview?.buildGeneration === event.buildGeneration) {
      local.preview.job = { ...local.preview.job, ...structuredClone(event.job) }
      local.status = event.job.status
      if (HYDRATABLE_TERMINAL_STATUSES.has(event.job.status)) {
        return hydrateCurrentRepairPreview(local.preview.job, local.preview.selection)
      }
      if (FAILED_TERMINAL_STATUSES.has(event.job.status)) {
        setTerminalFailure(event.job)
      } else {
        local.previewModel = {
          ...local.previewModel,
          state: event.job.status === 'queued' ? 'queued' : 'processing',
          acceptance: { canAccept: false, reason: 'job_not_done' },
        }
      }
    }
    if (event.type === 'draft_optimistically_stale') {
      if (event.draftHashGeneration >= local.draftHashGeneration) {
        markDraftHashPending(local, event.draftHashGeneration)
      }
    }
    if (event.type === 'draft_hash' && event.draftHashGeneration === local.draftHashGeneration && local.draft) {
      local.currentDraftSettingsHash = event.hash
      local.draft = applyRepairDraftSettingsHash(local.draft, event.hash)
      recomputeLocalRepairState()
    }
    if (event.type === 'accept_started') {
      local.acceptInFlight = true
      local.previewModel = {
        ...local.previewModel,
        state: 'accepting',
        acceptance: { canAccept: false, reason: 'accept_in_flight' },
      }
    }
    if (event.type === 'accepted') {
      local.acceptInFlight = false
      local.warningConfirmation = null
      local.previewModel = {
        ...local.previewModel,
        state: 'accepted',
        acceptance: { canAccept: false, reason: 'already_accepted' },
      }
    }
    if (event.type === 'error') {
      if (event.phase === 'accept') local.acceptInFlight = false
      local.error = event.error
      const errorState = event.error?.code === 'revision_conflict'
        ? 'revision_conflict'
        : event.error?.code === 'asset_revision_conflict'
          ? 'asset_revision_conflict'
          : event.error?.code === 'unsafe_artifact_path'
            ? 'unsafe_artifact_path'
            : event.error?.code === 'artifact_not_found'
              ? 'missing_artifact'
              : 'failed'
      local.status = errorState
      local.message = `${event.error?.code ?? `${event.phase}_failed`}: ${event.error?.message ?? event.error}`
      local.previewModel = {
        ...local.previewModel,
        state: errorState,
        acceptance: { canAccept: false, reason: event.error?.code ?? 'preview_failed' },
        diagnostics: [
          ...(local.previewModel.diagnostics ?? []),
          {
            code: event.error?.code ?? `${event.phase}_failed`,
            message: event.error?.message ?? String(event.error),
          },
        ],
      }
    }
    renderWorkbench()
    return null
  }

  async function buildLocalRepairPreview() {
    const local = editorState.repair.local
    const unsavedReason = getUnsavedReason()
    if (unsavedReason || local.validation?.status === 'fail' || local.acceptInFlight || !local.selection) return null
    const recipe = structuredClone(local.validation.canonical ?? local.draft.recipe)
    recipe.implementation_revision = null
    return repairPreviewLifecycle.build({
      projectId: local.selection.projectId,
      assetId: local.selection.assetId,
      expectedRevision: local.selection.projectRevision,
      expectedAssetRevisionId: local.selection.revisionId,
      recipe,
    })
  }

  async function acceptLocalRepairPreview() {
    const local = editorState.repair.local
    if (getUnsavedReason() || local.acceptInFlight) return null
    recomputeLocalRepairState()
    const preview = local.preview
    if (!preview || !local.previewModel.acceptance.canAccept) return null
    return repairPreviewLifecycle.accept({
      projectId: local.selection.projectId,
      assetId: local.selection.assetId,
      jobId: preview.jobId,
      expectedRevision: local.selection.projectRevision,
      expectedAssetRevisionId: local.selection.revisionId,
      expectedRecipeHash: preview.recipeHash,
      warningConfirmed: local.warningConfirmation?.confirmed === true &&
        local.warningConfirmation.jobId === preview.jobId &&
        local.warningConfirmation.recipeHash === preview.recipeHash,
    })
  }

  function resetLocalRepairDraft() {
    const local = editorState.repair.local
    if (!local.draft || local.acceptInFlight) return
    const generation = repairPreviewLifecycle.invalidateDraft()
    local.draft = {
      ...local.draft,
      recipe: structuredClone(local.draft.openingRecipe),
      currentDraftSettingsHash: null,
      dirty: true,
      hashStatus: 'pending',
    }
    markDraftHashPending(local, generation)
    const validation = validateRepairRecipeDraft(local.draft, local.validationContext)
    local.validation = validationWithPaths(validation)
    if (validation.status === 'fail') return
    local.lastValidCanonical = validation.canonical
    local.renderFrame = { ...local.renderFrame, overlayCommands: overlayCommands(local, validation.canonical) }
    void repairPreviewLifecycle.digestDraft(
      serializeCanonicalRecipe(createDraftSettingsHashInput(validation.canonical)),
      { generation },
    )
  }

  function recomputeLocalRepairState() {
    const local = editorState.repair.local
    if (!local.preview) return
    const evidence = local.previewModel.evidence
    const artifactsComplete = local.previewModel.artifactsComplete === true && Boolean(evidence)
    const freshness = getRepairPreviewFreshness({
      currentDraftSettingsHash: local.currentDraftSettingsHash,
      submittedDraftSettingsHash: local.preview.submittedDraftSettingsHash,
      selection: local.selection,
      submittedSelection: local.preview.selection,
      job: local.preview.job,
      artifacts: { complete: artifactsComplete },
      validation: { status: evidence?.validationStatus ?? 'unknown' },
      draftDirty: local.draft?.dirty === true,
    })
    let previewState = freshness.state
    if (local.preview.job.status === 'failed_quality_gate' && artifactsComplete && evidence?.validationStatus === 'fail') {
      previewState = 'blocked_quality'
    }
    const hashesMatch = local.preview.job.recipe_hash === local.preview.recipeHash &&
      local.preview.job.draft_settings_hash === local.preview.submittedDraftSettingsHash
    local.previewModel.state = previewState
    local.previewModel.acceptance = getRepairAcceptanceState({
      fresh: freshness.fresh,
      artifactsComplete,
      qualityStatus: evidence?.validationStatus ?? 'unknown',
      previewState,
      underlyingJobStatus: local.preview.job.status,
      jobId: local.preview.jobId,
      recipeHash: local.preview.recipeHash,
      warningConfirmation: local.warningConfirmation,
      hashesMatch,
    })
  }

  function reviewClip(local, clipId) {
    return local.previewModel.clips?.[clipId] ?? selectedRepairAsset()?.clips?.[clipId] ?? null
  }

  function repairDifferenceForFrame({ local, beforeRect, afterRect, afterSheet }) {
    if (!beforeRect || !afterRect || !afterSheet || !Number.isInteger(local.view.frameIndex)) {
      return { imageData: null, source: null, diagnostics: [] }
    }
    const key = [
      local.selection.assetId,
      local.selection.revisionId,
      local.preview?.jobId ?? 'no-preview',
      local.view.frameIndex,
    ].join(':')
    if (!local.differenceCache.has(key)) {
      try {
        local.differenceCache.set(key, createFrameDifference({
          beforeImage: local.sourceContext.beforeImage,
          beforeRect,
          afterImage: afterSheet,
          afterRect,
        }))
      } catch (error) {
        local.differenceCache.set(key, {
          imageData: null,
          source: null,
          diagnostics: [{ code: 'difference_unavailable', message: error.message || String(error) }],
        })
      }
    }
    return local.differenceCache.get(key)
  }

  function syncRepairSelectedFrame() {
    const local = editorState.repair.local
    local.view.frameIndex = local.filmstrip.frames[local.filmstrip.selectedIndex] ?? null
    const before = local.sourceContext.beforeImage
    const afterSheet = local.renderFrame.afterSheet ?? null
    const beforeRect = safeFrameRect({ frameIndex: local.view.frameIndex, frameSize: local.profile.frame, image: before })
    const afterRect = safeFrameRect({ frameIndex: local.view.frameIndex, frameSize: local.profile.frame, image: afterSheet })
    const difference = repairDifferenceForFrame({ local, beforeRect, afterRect, afterSheet })
    if (local.previewModel.evidence) {
      local.previewModel.evidence = {
        ...local.previewModel.evidence,
        differenceDiagnostics: difference.diagnostics ?? [],
      }
    }
    const hasFrame = Boolean(beforeRect)
    local.renderFrame = {
      ...local.renderFrame,
      mode: local.view.mode,
      playing: false,
      before: hasFrame ? before : null,
      after: hasFrame && afterRect ? afterSheet : null,
      afterSheet,
      emptyMessage: hasFrame ? null : 'The selected clip has no frames to display.',
      beforeRect,
      afterRect,
      differenceImageData: difference.imageData,
      differenceSource: difference.source,
      overlayCommands: hasFrame ? overlayCommands(local) : [],
    }
  }

  function scheduleRepairPlayback() {
    stopRepairPlaybackTimer()
    const local = editorState.repair.local
    const clip = reviewClip(local, local.view.clipId)
    if (!local.filmstrip.playing || local.filmstrip.frames.length < 2 ||
        !Number.isFinite(clip?.fps) || clip.fps <= 0) return
    repairPlaybackTimer = schedule(() => {
      repairPlaybackTimer = null
      dispatchRepairFilmstrip({ type: 'tick' })
    }, 1000 / clip.fps)
  }

  function dispatchRepairFilmstrip(event) {
    const local = editorState.repair.local
    if (!local.draft) return
    local.filmstrip = reduceRepairFilmstrip(local.filmstrip, event)
    if (local.filmstrip.frames.length < 2) local.filmstrip.playing = false
    syncRepairSelectedFrame()
    renderWorkbench()
    scheduleRepairPlayback()
  }

  function selectRepairClip(clipId) {
    const local = editorState.repair.local
    const clip = reviewClip(local, clipId)
    if (!clip) return
    if (clipId !== local.view.clipId) targetedFrameRepair?.close('selection_switched')
    stopRepairPlaybackTimer()
    const frames = Array.isArray(clip.frames) ? [...clip.frames] : []
    local.view.clipId = clipId
    local.filmstrip = { frames, selectedIndex: 0, playing: false }
    syncRepairSelectedFrame()
    local.previewModel = {
      ...local.previewModel,
      frames,
      modeAvailability: getRepairComparisonAvailability({
        before: local.renderFrame.before,
        beforeRect: local.renderFrame.beforeRect,
        after: local.renderFrame.after,
        afterRect: local.renderFrame.afterRect,
      }),
      diagnostics: [
        ...(local.previewModel.diagnostics ?? []).filter((item) => item.code !== 'selected_clip_has_no_frames'),
        ...(!frames.length ? [{ code: 'selected_clip_has_no_frames', message: 'The selected clip has no frames to display.' }] : []),
      ],
    }
    renderWorkbench()
  }

  function currentFrameRepairContext() {
    if (disposed) return null
    const asset = selectedRepairAsset()
    const revision = currentRevision(asset)
    const local = editorState.repair.local
    if (!asset || !revision || !local?.draft ||
        !sameSelection(local.selection, repairSelection(asset, revision))) return null
    return { asset, revision, local }
  }

  function currentFrameRepairSnapshot() {
    const context = currentFrameRepairContext()
    return context ? frameRepairSnapshot(context.asset, context.revision) : null
  }

  function setFrameRepairComparisonView(patch) {
    const context = currentFrameRepairContext()
    if (!context || !isRecord(patch)) return false
    const allowed = {}
    if (typeof patch.mode === 'string') allowed.mode = patch.mode
    if (Number.isFinite(patch.zoom)) allowed.zoom = patch.zoom
    if (isRecord(patch.pan) && Number.isFinite(patch.pan.x) && Number.isFinite(patch.pan.y)) {
      allowed.pan = { x: patch.pan.x, y: patch.pan.y }
    }
    if (Object.keys(allowed).length === 0) return false
    context.local.view = { ...context.local.view, ...allowed }
    context.local.renderFrame = {
      ...context.local.renderFrame,
      mode: context.local.view.mode,
      zoom: context.local.view.zoom,
      pan: context.local.view.pan,
    }
    renderWorkbench()
    return true
  }

  function selectFrameRepairClip(clipId) {
    if (!currentFrameRepairContext()) return false
    selectRepairClip(clipId)
    return editorState.repair.local.view.clipId === clipId
  }

  function selectFrameRepairFrame(clipFramePosition) {
    const context = currentFrameRepairContext()
    if (!context || !Number.isInteger(clipFramePosition) || clipFramePosition < 0 ||
        clipFramePosition >= context.local.filmstrip.frames.length) return false
    if (clipFramePosition !== context.local.filmstrip.selectedIndex) {
      targetedFrameRepair?.close('selection_switched')
    }
    dispatchRepairFilmstrip({ type: 'select', index: clipFramePosition })
    return context.local.filmstrip.selectedIndex === clipFramePosition
  }

  function enterQualityGateAuthoringCase() {
    const snapshot = currentFrameRepairSnapshot()
    return snapshot ? targetedFrameRepair?.enterQualityGateAuthoringCase(snapshot) ?? false : false
  }

  function enterLockedQualityGateCase(lockedCase) {
    const snapshot = currentFrameRepairSnapshot()
    return snapshot
      ? targetedFrameRepair?.enterLockedQualityGateCase(snapshot, lockedCase) ?? false
      : false
  }

  function exportQualityGateCaseDraft(metadata) {
    return targetedFrameRepair?.exportQualityGateCaseDraft(metadata) ?? null
  }

  function generateQualityGateCandidate(operationId) {
    return targetedFrameRepair?.generateOneCandidate({ operationId }) ?? Promise.resolve(null)
  }

  function acceptQualityGateCandidateDeferred() {
    return targetedFrameRepair?.acceptCandidate({ deferProjectAdoption: true }) ?? Promise.resolve(null)
  }

  function confirmLocalRepairWarning(confirmed) {
    const local = editorState.repair.local
    if (local.previewModel.state !== 'warning' || !local.preview) return
    local.warningConfirmation = confirmed ? {
      jobId: local.preview.jobId,
      recipeHash: local.preview.recipeHash,
      confirmed: true,
    } : null
    recomputeLocalRepairState()
    renderWorkbench()
  }

  function discardLocalRepairSession() {
    targetedFrameRepair?.close('selection_switched')
    clearLocalRepairAsyncWork()
    editorState.repair.local = createEmptyLocalRepairState()
    editorState.activePanel = 'layers'
    renderAll()
  }

  async function assertPreviewEvidenceIdentity({
    job,
    expectedSelection,
    animations,
    metadata,
    editorMetadata,
    report,
    processingRecipe,
    reprocessContext,
    afterImage,
    submittedCanonicalRecipe,
  }) {
    if (job.project_id !== expectedSelection.projectId ||
        (job.project_revision != null && job.project_revision !== expectedSelection.projectRevision) ||
        job.asset_id !== expectedSelection.assetId ||
        job.parent_revision_id !== expectedSelection.revisionId ||
        !HASH_PATTERN.test(String(job.recipe_hash ?? '')) ||
        !HASH_PATTERN.test(String(job.draft_settings_hash ?? '')) ||
        typeof job.implementation_revision !== 'string') {
      throw integrityError('preview job identity does not match the selected immutable revision')
    }
    if (!exactKeys(reprocessContext, REPROCESS_CONTEXT_KEYS) ||
        reprocessContext.version !== 'editor_reprocess_context_v0' ||
        reprocessContext.job_type !== 'editor_character_reprocess' ||
        reprocessContext.preview_job_id !== job.id ||
        reprocessContext.project_id !== expectedSelection.projectId ||
        reprocessContext.project_revision !== expectedSelection.projectRevision ||
        reprocessContext.asset_id !== expectedSelection.assetId ||
        reprocessContext.parent_revision_id !== expectedSelection.revisionId ||
        reprocessContext.recipe_hash !== job.recipe_hash ||
        reprocessContext.draft_settings_hash !== job.draft_settings_hash ||
        reprocessContext.implementation_revision !== job.implementation_revision ||
        !['managed_source', 'normalized_sheet_fallback'].includes(reprocessContext.input_mode)) {
      throw integrityError('preview reprocess context identity is invalid')
    }
    const expectedInputKey = reprocessContext.input_mode === 'managed_source' ? 'source' : 'sheet'
    const expectedInputFile = expectedInputKey === 'source' ? 'source.png' : 'normalized_sheet.png'
    const expectedInputSuffix = `/projects/${expectedSelection.projectId}/assets/${expectedSelection.assetId}/${expectedSelection.revisionId}/${expectedInputFile}`
    if (reprocessContext.input_artifact_key !== expectedInputKey ||
        !String(reprocessContext.input_artifact_ref ?? '').endsWith(expectedInputSuffix) ||
        !HASH_PATTERN.test(String(reprocessContext.input_artifact_sha256 ?? '')) ||
        !(reprocessContext.black_matte_artifact_sha256 === null || HASH_PATTERN.test(String(reprocessContext.black_matte_artifact_sha256)))) {
      throw integrityError('preview input evidence identity is invalid')
    }
    const expectedLayout = editorState.repair.local.sourceContext.sourceLayout
    if (reprocessContext.authoritative_source_layout !== expectedLayout ||
        report?.source_layout?.id !== expectedLayout ||
        animations?.source_layout?.id !== expectedLayout) {
      throw integrityError('preview source layout evidence does not match the open session')
    }
    if (!validSheetContract(animations, TOPDOWN_RPG_V0) ||
        !validSheetContract(editorMetadata, TOPDOWN_RPG_V0) ||
        metadata?.profile !== TOPDOWN_RPG_V0.id ||
        report?.profile !== TOPDOWN_RPG_V0.id ||
        afterImage.width !== TOPDOWN_RPG_V0.sheet.w ||
        afterImage.height !== TOPDOWN_RPG_V0.sheet.h) {
      throw integrityError('preview Character Pack sidecars disagree on profile or sheet geometry')
    }
    if (!isRecord(processingRecipe) || validateProcessingRecipe(processingRecipe).status === 'fail' ||
        processingRecipe.implementation_revision !== job.implementation_revision ||
        processingRecipe.source?.asset_id !== expectedSelection.assetId ||
        !submittedCanonicalRecipe ||
        !sameJson(processingRecipe, submittedCanonicalRecipe)) {
      throw integrityError('preview processing Recipe evidence is invalid')
    }
    const computedRecipeHash = await hashDraft(serializeCanonicalRecipe(processingRecipe))
    const computedDraftHash = await hashDraft(
      serializeCanonicalRecipe(createDraftSettingsHashInput(processingRecipe)),
    )
    if (computedRecipeHash !== job.recipe_hash || computedDraftHash !== job.draft_settings_hash) {
      throw integrityError('preview Recipe evidence hashes do not match the job')
    }
    const reportStatus = report?.validation?.status
    if (!['pass', 'warning', 'fail'].includes(reportStatus) || metadata?.quality?.status !== reportStatus) {
      throw integrityError('preview quality evidence is inconsistent')
    }
  }

  async function hydrateRepairPreview(job, expectedSelection) {
    const capture = repairPreviewLifecycle.capture()
    const localAtStart = editorState.repair.local
    if (!sameSelection(capture.selection, expectedSelection) ||
        !sameSelection(localAtStart.selection, expectedSelection) ||
        localAtStart.preview?.jobId !== job.id) return null

    hydrationAbortController?.abort()
    const controller = new AbortController()
    hydrationAbortController = controller
    const generation = ++repairHydrationGeneration
    const controlled = explicitPreviewArtifactUrls(job)
    const identity = `job:${job.id}`
    previewCacheIdentities.add(identity)
    const [afterImage, animations, metadata, editorMetadata, report, processingRecipe, reprocessContext] = await Promise.all([
      repairArtifactClient.loadImage({ identity, url: controlled.byKey.normalized_sheet_url, allowedGeneratedUrls: controlled.allowlist, signal: controller.signal }),
      repairArtifactClient.loadJson({ identity, url: controlled.byKey.animations_url, allowedGeneratedUrls: controlled.allowlist, signal: controller.signal }),
      repairArtifactClient.loadJson({ identity, url: controlled.byKey.metadata_url, allowedGeneratedUrls: controlled.allowlist, signal: controller.signal }),
      repairArtifactClient.loadJson({ identity, url: controlled.byKey.editor_metadata_url, allowedGeneratedUrls: controlled.allowlist, signal: controller.signal }),
      repairArtifactClient.loadJson({ identity, url: controlled.byKey.debug_report_url, allowedGeneratedUrls: controlled.allowlist, signal: controller.signal }),
      repairArtifactClient.loadJson({ identity, url: controlled.byKey.processing_recipe_url, allowedGeneratedUrls: controlled.allowlist, signal: controller.signal }),
      repairArtifactClient.loadJson({ identity, url: controlled.byKey.reprocess_context_url, allowedGeneratedUrls: controlled.allowlist, signal: controller.signal }),
    ])
    if (controller.signal.aborted || generation !== repairHydrationGeneration) return null
    const local = editorState.repair.local
    if (!sameSelection(local.selection, expectedSelection) || local.preview?.jobId !== job.id ||
        !repairPreviewLifecycle.isCurrentBuild(capture.token, capture.buildGeneration, expectedSelection)) return null

    await assertPreviewEvidenceIdentity({
      job,
      expectedSelection,
      animations,
      metadata,
      editorMetadata,
      report,
      processingRecipe,
      reprocessContext,
      afterImage,
      submittedCanonicalRecipe: local.preview.submittedCanonicalRecipe,
    })
    if (controller.signal.aborted || generation !== repairHydrationGeneration ||
        editorState.repair.local.preview?.jobId !== job.id) return null

    const clips = normalizePreviewClips(animations.animations, TOPDOWN_RPG_V0)
    const evidence = normalizeRepairEvidence(report)
    const selectedClip = clips[local.view.clipId] ?? Object.values(clips)[0] ?? null
    if (selectedClip) local.view.clipId = selectedClip.id
    const frames = selectedClip ? [...selectedClip.frames] : []
    local.filmstrip = {
      frames,
      selectedIndex: frames.length ? Math.min(local.filmstrip.selectedIndex, frames.length - 1) : 0,
      playing: frames.length > 1 && local.filmstrip.playing,
    }
    local.preview.job = { ...local.preview.job, ...structuredClone(job) }
    local.preview.artifacts = {
      animations,
      metadata,
      editorMetadata,
      report,
      processingRecipe,
      reprocessContext,
    }
    local.renderFrame = {
      ...local.renderFrame,
      afterSheet: afterImage,
    }
    local.previewModel = {
      ...local.previewModel,
      clips,
      frames,
      evidence,
      artifactsComplete: true,
      diagnostics: [
        ...evidence.missingMetrics,
        ...evidence.warnings.map((code) => ({ code, message: code })),
        ...(job.status !== 'done' ? [jobFailureDiagnostic(job)] : []),
        ...(!frames.length ? [{ code: 'selected_clip_has_no_frames', message: 'The selected clip has no frames to display.' }] : []),
      ],
    }
    syncRepairSelectedFrame()
    local.previewModel.modeAvailability = getRepairComparisonAvailability({
      before: local.renderFrame.before,
      beforeRect: local.renderFrame.beforeRect,
      after: local.renderFrame.after,
      afterRect: local.renderFrame.afterRect,
    })
    recomputeLocalRepairState()
    local.status = job.status
    local.message = job.status === 'done' ? '' : `${job.status}: ${job.reason || 'Preview blocked'}`
    hydrationAbortController = null
    renderWorkbench()
    return local.previewModel
  }

  return Object.freeze({
    attach,
    close,
    dispose,
    openAsset: openRepairForAsset,
    contextFor: repairWorkbenchContext,
    handleLifecycleUpdate: handleRepairLifecycleUpdate,
    frameRepairSnapshot: currentFrameRepairSnapshot,
    setFrameRepairComparisonView,
    selectFrameRepairClip,
    selectFrameRepairFrame,
    enterQualityGateAuthoringCase,
    enterLockedQualityGateCase,
    exportQualityGateCaseDraft,
    generateQualityGateCandidate,
    acceptQualityGateCandidateDeferred,
  })
}
