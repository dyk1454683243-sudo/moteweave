import {
  buildFrameBatchRepairTargets,
  resolveFrameBatchRepairSelection,
  toggleFrameBatchRepairRegion,
} from '../../editor-project/frameBatchRepairSelection.js'
import { createEmptyActionRepairSelectionState } from './state.js'

function managedArtifactUrl(ref) {
  return `/api/editor/artifact?path=${encodeURIComponent(ref)}`
}

function currentRevision(asset) {
  return asset?.revisions?.[asset.active_revision_id] ?? null
}

function repairSelection(state, asset, revision) {
  return {
    projectId: state.project?.id ?? null,
    projectRevision: state.project?.revision ?? null,
    assetId: asset?.id ?? null,
    revisionId: revision?.id ?? null,
  }
}

function sameSelection(left, right) {
  return Boolean(left && right) &&
    left.projectId === right.projectId &&
    left.projectRevision === right.projectRevision &&
    left.assetId === right.assetId &&
    left.revisionId === right.revisionId
}

function clipEntries(asset) {
  return Object.entries(asset?.clips ?? {}).filter(([, clip]) => Array.isArray(clip?.frames))
}

function resetCandidate(ai, patch = {}) {
  return {
    ...ai,
    ...patch,
    plan: null,
    job: null,
    importResult: null,
    status: 'idle',
    message: '',
  }
}

export function createRepairWorkbenchController({
  state,
  artifactClient,
  getSelectedAsset,
  requestRender,
  addLog = () => {},
  renderAiActionContent,
} = {}) {
  if (!state || !artifactClient || typeof requestRender !== 'function' ||
      typeof renderAiActionContent !== 'function') {
    throw new TypeError('action repair workbench dependencies are required')
  }

  let panel = null
  let openAbortController = null
  let openGeneration = 0
  let disposed = false

  function renderWorkbench() {
    const asset = getSelectedAsset()
    const revision = currentRevision(asset)
    const local = state.repair.local
    if (!panel || !asset || !revision || local.status !== 'ready' ||
        !sameSelection(local.selection, repairSelection(state, asset, revision))) return
    panel.render(contextFor(asset, revision).viewModel())
  }

  function selectClip(clipId) {
    const local = state.repair.local
    const clip = local.clips?.[clipId]
    if (!clip) return false
    local.view = { clipId, frameIndex: clip.frames[0] ?? null }
    local.filmstrip = { frames: [...clip.frames], selectedIndex: 0, playing: false }
    if (!local.frameBatchRepairTargets?.available) {
      state.repair.aiAction = resetCandidate(state.repair.aiAction, { selectedAction: clipId })
    }
    requestRender()
    return true
  }

  function toggleRegion(regionKey, checked) {
    const local = state.repair.local
    const ai = state.repair.aiAction
    if (['planning', 'running', 'accepting'].includes(ai.status)) return false
    const selectedRegionKeys = toggleFrameBatchRepairRegion({
      targets: local.frameBatchRepairTargets,
      selectedRegionKeys: ai.selectedRegionKeys,
      regionKey,
      checked,
    })
    if (JSON.stringify(selectedRegionKeys) === JSON.stringify(ai.selectedRegionKeys ?? [])) return false
    state.repair.aiAction = resetCandidate(ai, { selectedRegionKeys })
    requestRender()
    return true
  }

  function clearSelection() {
    const ai = state.repair.aiAction
    if (['planning', 'running', 'accepting'].includes(ai.status) || !ai.selectedRegionKeys?.length) return false
    state.repair.aiAction = resetCandidate(ai, { selectedRegionKeys: [] })
    requestRender()
    return true
  }

  function contextFor(asset, revision = currentRevision(asset)) {
    const local = state.repair.local
    return {
      selection: repairSelection(state, asset, revision),
      viewModel() {
        const batch = resolveFrameBatchRepairSelection({
          targets: local.frameBatchRepairTargets,
          selectedRegionKeys: state.repair.aiAction.selectedRegionKeys,
        })
        return {
          asset,
          revision,
          status: local.status,
          message: local.message,
          error: local.error,
          clips: local.clips,
          clipId: local.view.clipId,
          frames: local.filmstrip.frames.map((frameIndex) => ({
            frameIndex,
            target: local.frameBatchRepairTargets?.byFrame?.[String(frameIndex)] ?? null,
          })),
          sourceSheetUrl: local.sourceSheetUrl,
          selectedRegionKeys: state.repair.aiAction.selectedRegionKeys ?? [],
          busy: ['planning', 'running', 'accepting'].includes(state.repair.aiAction.status),
          batch,
        }
      },
      selectClip,
      toggleBatchRepairRegion: toggleRegion,
      clearBatchRepairSelection: clearSelection,
      renderAiAction(container) { renderAiActionContent(container) },
      onClose: close,
    }
  }

  async function openAsset(asset = getSelectedAsset()) {
    if (disposed || asset?.kind !== 'character_pack') return
    const revision = currentRevision(asset)
    if (!revision) return

    openAbortController?.abort()
    const controller = new AbortController()
    openAbortController = controller
    const generation = ++openGeneration
    const local = createEmptyActionRepairSelectionState()
    local.selection = repairSelection(state, asset, revision)
    local.clips = Object.fromEntries(clipEntries(asset))
    const preferredClip = Object.hasOwn(local.clips, state.repair.aiAction.selectedAction)
      ? state.repair.aiAction.selectedAction
      : Object.keys(local.clips)[0] ?? ''
    const frames = local.clips[preferredClip]?.frames ?? []
    local.view = { clipId: preferredClip, frameIndex: frames[0] ?? null }
    local.filmstrip = { frames: [...frames], selectedIndex: 0, playing: false }
    local.sourceSheetUrl = revision.artifacts?.sheet
      ? managedArtifactUrl(revision.artifacts.sheet)
      : null
    local.status = 'loading'
    local.message = 'Loading authoritative action-slot mapping…'
    state.repair.local = local
    state.selectedAssetId = asset.id
    state.selectedLayerId = null
    state.activePanel = 'repair'
    requestRender()

    try {
      const debugRef = revision.artifacts?.debug_report
      if (!debugRef || !local.sourceSheetUrl) throw new Error('managed action-repair artifacts are incomplete')
      const debugUrl = managedArtifactUrl(debugRef)
      const debugReport = await artifactClient.loadJson({
        identity: `${asset.id}:${revision.id}`,
        url: debugUrl,
        allowedManagedUrls: new Set([debugUrl]),
        signal: controller.signal,
      })
      if (disposed || controller.signal.aborted || generation !== openGeneration) return
      local.frameBatchRepairTargets = buildFrameBatchRepairTargets(debugReport)
      if (!local.frameBatchRepairTargets.available) {
        throw new Error(local.frameBatchRepairTargets.reason)
      }
      const allowed = new Set(local.frameBatchRepairTargets.regionKeys)
      const selectedRegionKeys = (state.repair.aiAction.selectedRegionKeys ?? []).filter((key) => allowed.has(key))
      if (selectedRegionKeys.length !== (state.repair.aiAction.selectedRegionKeys ?? []).length) {
        state.repair.aiAction = resetCandidate(state.repair.aiAction, { selectedRegionKeys })
      }
      local.status = 'ready'
      local.message = 'Select incorrect frames; linked output frames share one source slot automatically.'
      local.error = null
      addLog(`Three-atlas action repair ready: ${asset.id} ${revision.id}`)
    } catch (error) {
      if (controller.signal.aborted || generation !== openGeneration) return
      local.status = 'failed'
      local.message = error?.message || String(error)
      local.error = error
    } finally {
      if (openAbortController === controller) openAbortController = null
      requestRender()
    }
  }

  function attach(value) {
    panel = value
    renderWorkbench()
  }

  function close(reason = 'panel_switch') {
    openAbortController?.abort()
    openAbortController = null
    openGeneration += 1
    panel?.close(reason)
  }

  function dispose() {
    if (disposed) return
    disposed = true
    close('dispose')
    panel = null
  }

  return Object.freeze({ attach, close, contextFor, dispose, openAsset })
}
