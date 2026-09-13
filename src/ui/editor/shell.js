import {
  autosaveEditorProject, createEditorProject, deleteEditorAsset, exportEditorProjectPack,
  fetchEditorArtifactJson, importGeneratedJob, loadEditorProject,
  saveEditorProject, unlinkEditorAsset,
} from './api.js'
import { buildAssetLibraryEntry } from '../../editor-project/assetLibrary.js'
import {
  createAnimationRuntimeState, frameStateForLayer, resetLayerElapsed, resolveLayerClip,
  runtimeHasActiveClocks, setLayerClockPlaying, setLayerElapsed, setRuntimePlaying,
  syncAnimationRuntime, tickAnimationRuntime,
} from '../../editor-project/animationRuntime.js'
import { ACTION_TYPES, LOOP_MODES, PLAYBACK_ACTIVATIONS, TRIGGER_TYPES, ZONE_COORDINATE_SPACES } from '../../editor-project/constants.js'
import { createInteractionDocument } from '../../editor-project/interactions.js'
import { applyPlaytestLayerOverrides, createInteractionRuntimeState, triggerInteractions } from '../../editor-project/interactionRuntime.js'
import { createPlaytestControllerState, tickPlaytestController, transitionPlaytestControllerScene } from '../../editor-project/playtestController.js'
import {
  addSceneFlowLink, buildSceneFlowBoard, copySceneForClipboard, createBlankSceneInProject,
  duplicateScene, normalizeSceneFlowLayout, pasteSceneFromClipboard, removeSceneFlowLink,
  updateSceneFlowNode,
} from '../../editor-project/sceneFlow.js'
import { commitHistory, createCommandHistory, redoHistory, undoHistory } from '../../editor-project/history.js'
import { resolveFrameBatchRepairSelection } from '../../editor-project/frameBatchRepairSelection.js'
import {
  appendLayerToScene, canAddAssetToScene, clampPositionToScene, createLayerFromAsset,
  interactionZoneBoxInView, layerBoxInView, moveSceneLayer, snapPoint, updateSceneLayer,
} from './sceneCanvas.js'
import {
  $, button, checkboxControl, controlInline, keyValue, linkList, numberControl, rangeControl,
  selectControl, textControl,
} from './domControls.js'
import { renderExportPanel } from './exportPanel.js'
import {
  DEFAULT_PLAYTEST_OPTIONS, getPlaytestPanelState, playerLayerOptions, renderPlaytestPanel as renderPlaytestControls,
} from './playtestPanel.js'
import {
  bindPlaytestInputLifecycle,
  clearPlaytestInput as clearPlaytestPressedKeys,
} from './playtestInputLifecycle.js'
import { renderEditorSceneFrame } from './sceneRenderer.js'
import { createSceneRenderLifecycle } from './sceneRenderLifecycle.js'
import { createRepairArtifactClient } from './artifactClient.js'
import { createAiActionRepairWorkflow } from './aiActionRepairWorkflow.js'
import { createRepairWorkbenchController } from './repairWorkbenchController.js'
import { createRepairWorkbenchPanel } from './repairWorkbenchPanel.js'
import { addEditorLog, createEmptyActionRepairSelectionState, editorState } from './state.js'
let animationFrameRequest = null
let unbindPlaytestInput = null
let repairWorkbench = null
let repairController = null
let aiActionRepairWorkflow = null
let mountedRepairSelectionKey = null
let previousBottomPanel = null
const elements = {
  main: document.querySelector('.editor-main'),
  stagePanel: document.querySelector('.editor-stage-panel'),
}
const repairArtifactClient = createRepairArtifactClient()
function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value))
}
function runtimeNow() {
  return window.performance?.now?.() ?? Date.now()
}
function formatMs(value) {
  const ms = Math.max(0, Number(value) || 0)
  if (ms >= 1000) return `${(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)}s`
  return `${Math.round(ms)}ms`
}
function positiveNumber(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback
}
function setStatus(status, message = status) {
  const pill = $('#editor-status-pill')
  pill.dataset.status = status
  pill.textContent = message
}
function toast(message) {
  const node = $('#editor-toast')
  node.textContent = message
  node.classList.add('visible')
  window.setTimeout(() => node.classList.remove('visible'), 1800)
}
function activeScene() {
  const project = editorState.project
  return project?.scenes?.[project.active_scene_id] ?? null
}
function displayScene() {
  const project = editorState.project
  const runtime = editorState.playtest.runtime
  if (editorState.playtest.running && runtime?.activeSceneId && project?.scenes?.[runtime.activeSceneId]) {
    const scene = applyPlaytestLayerOverrides(project.scenes[runtime.activeSceneId], runtime)
    const player = runtime.player
    if (!player?.layer_id) return scene
    return {
      ...scene,
      layers: (scene.layers ?? []).map((layer) => {
        if (layer.id !== player.layer_id) return layer
        const animationRate = positiveNumber(runtime.options?.animationRate, 1)
        return {
          ...layer,
          ...(player.clip_id ? { clip_id: player.clip_id } : {}),
          transform: {
            ...layer.transform,
            position: { x: player.x, y: player.y },
          },
          playback: {
            ...normalizedPlayback(layer, activeAssets()[layer.asset_id]?.clips?.[player.clip_id]),
            rate: positiveNumber(layer.playback?.rate, 1) * animationRate,
          },
        }
      }),
    }
  }
  return activeScene()
}
function sceneLayers(scene = activeScene()) {
  return Array.isArray(scene?.layers) ? scene.layers : []
}
function selectedLayer() {
  return sceneLayers().find((layer) => layer.id === editorState.selectedLayerId) ?? null
}
function activeAssets() {
  return editorState.project?.assets ?? {}
}
const refreshSceneRenderAssets = createSceneRenderLifecycle({
  getProjectId: () => editorState.project?.id,
  getScene: displayScene,
  getAssets: activeAssets,
  getState: () => editorState.sceneRender,
  setState: (state) => { editorState.sceneRender = state },
  onSettled: () => renderAll(),
})
function hasPlayableLayers(scene = activeScene(), assets = activeAssets()) {
  return sceneLayers(scene).some((layer) => resolveLayerClip(layer, assets[layer.asset_id]).playable)
}
function normalizedPlayback(layer, clip) {
  return {
    activation: 'auto',
    loop_mode: clip?.loop_mode ?? 'loop',
    rate: 1,
    start_offset_ms: 0,
    initially_paused: false,
    ...(layer?.playback ?? {}),
  }
}
function syncRuntimeClocks() {
  const scene = editorState.playtest.running ? displayScene() : activeScene()
  const lastTick = editorState.animationRuntime?.last_tick_ms ?? runtimeNow()
  editorState.animationRuntime = syncAnimationRuntime(
    editorState.animationRuntime,
    scene,
    activeAssets(),
    lastTick,
  )
}
function scheduleAnimationTick() {
  const shouldTick = editorState.playtest.running || runtimeHasActiveClocks(
    editorState.animationRuntime,
    activeScene(),
    activeAssets(),
  )
  if (animationFrameRequest || !shouldTick) return
  animationFrameRequest = window.requestAnimationFrame((now) => {
    animationFrameRequest = null
    if (editorState.playtest.running) {
      tickPlaytestFrame(now)
    } else {
      editorState.animationRuntime = tickAnimationRuntime(
        editorState.animationRuntime,
        activeScene(),
        activeAssets(),
        now,
      )
      renderAll()
    }
    scheduleAnimationTick()
  })
}
function setPreviewPlaying(playing) {
  syncRuntimeClocks()
  editorState.animationRuntime = setRuntimePlaying(editorState.animationRuntime, playing, runtimeNow())
  if (!playing) {
    for (const clock of Object.values(editorState.animationRuntime.layer_clocks ?? {})) {
      clock.layer_playing = false
    }
  }
  addEditorLog(playing ? 'Animation preview playing' : 'Animation preview paused')
  renderAll()
  scheduleAnimationTick()
}
function sortedAssets() {
  return Object.values(editorState.project?.assets ?? {}).sort((a, b) => a.name.localeCompare(b.name))
}
function assetRevision(asset) {
  return asset?.revisions?.[asset.active_revision_id] ?? null
}
function artifactUrl(pathname) {
  if (!pathname) return null
  const value = String(pathname)
  if (value.startsWith('/')) return value
  return `/api/editor/artifact?path=${encodeURIComponent(value)}`
}
function assetProvenanceLabel(provenance = {}) {
  return [provenance.source_type, provenance.provider, provenance.model]
    .filter(Boolean)
    .join(' / ') || 'unrecorded'
}
function assetUsageLabel(usage) {
  const sceneCount = usage?.scene_count ?? 0
  const layerCount = usage?.layer_count ?? 0
  return `${sceneCount} scenes / ${layerCount} layers`
}
function assetMeta(label, value) {
  const item = document.createElement('span')
  item.className = 'editor-asset-meta'
  const key = document.createElement('b')
  key.textContent = label
  const val = document.createElement('span')
  val.textContent = value == null || value === '' ? '-' : String(value)
  item.append(key, val)
  return item
}
function renderAssetThumbnail(entry) {
  const thumb = document.createElement('div')
  thumb.className = 'editor-asset-thumb'
  const url = artifactUrl(entry.thumbnail_artifact)
  if (url) {
    const img = document.createElement('img')
    img.src = url
    img.alt = `${entry.name} thumbnail`
    img.loading = 'lazy'
    thumb.append(img)
  } else {
    const empty = document.createElement('span')
    empty.textContent = entry.kind
    thumb.append(empty)
  }
  return thumb
}
function selectedRepairAsset() {
  const layer = selectedLayer()
  const layerAsset = layer?.asset_id ? editorState.project?.assets?.[layer.asset_id] : null
  return layerAsset ?? editorState.project?.assets?.[editorState.selectedAssetId] ?? null
}
function repairContext(asset = selectedRepairAsset()) {
  const revision = assetRevision(asset)
  return {
    asset,
    revision,
    actions: Object.keys(asset?.clips ?? {}),
  }
}
function resetRepairStateForSelection(asset = selectedRepairAsset()) {
  const revision = assetRevision(asset)
  const ai = editorState.repair.aiAction
  const sameTarget =
    ai.assetId === (asset?.id ?? null) &&
    ai.revisionId === (revision?.id ?? null)
  if (sameTarget) return
  editorState.repair.aiAction = {
    ...ai,
    selectedAction: Object.keys(asset?.clips ?? {})[0] ?? '',
    selectedRegionKeys: [],
    instruction: 'Correct the selected action slots while preserving the character identity.',
    equipmentPolicy: 'none',
    plan: null,
    job: null,
    importResult: null,
    status: 'idle',
    message: '',
    assetId: asset?.id ?? null,
    revisionId: revision?.id ?? null,
  }
}
function preferredRepairAction() {
  const { actions } = repairContext()
  const ai = editorState.repair.aiAction
  if (actions.includes(ai.selectedAction)) return ai.selectedAction
  return actions[0] ?? ''
}
function selectedBatchRepairSelection() {
  return resolveFrameBatchRepairSelection({
    targets: editorState.repair.local.frameBatchRepairTargets,
    selectedRegionKeys: editorState.repair.aiAction.selectedRegionKeys,
  })
}
function ensureRepairController() {
  if (repairController) return repairController
  repairController = createRepairWorkbenchController({
    state: editorState,
    artifactClient: repairArtifactClient,
    getSelectedAsset: selectedRepairAsset,
    requestRender: renderAll,
    addLog: addEditorLog,
    renderAiActionContent: renderExistingAiActionRepair,
  })
  return repairController
}
function ensureRepairWorkbench() {
  if (repairWorkbench) return repairWorkbench
  repairWorkbench = createRepairWorkbenchPanel({
    root: $('#editor-panel-body'),
    announce: (message) => { $('#editor-stage-live').textContent = message },
  })
  ensureRepairController().attach(repairWorkbench)
  return repairWorkbench
}
function closeRepairSession(reason) {
  repairWorkbench?.close(reason)
  if (!repairWorkbench) repairController?.close(reason)
  mountedRepairSelectionKey = null
}
function activeSceneHistoryKey(sceneId = editorState.project?.active_scene_id) {
  return editorState.project && sceneId ? `${editorState.project.id}:${sceneId}` : null
}
function ensureSceneHistory(scene = activeScene()) {
  const key = activeSceneHistoryKey(scene?.id)
  if (!key || !scene) return null
  if (!editorState.sceneHistories[key]) {
    editorState.sceneHistories[key] = createCommandHistory({
      snapshot: scene,
      selection: { layer_id: editorState.selectedLayerId },
    })
  }
  return editorState.sceneHistories[key]
}
function acceptProject(project) {
  closeRepairSession('project_switch')
  stopPlaytest({ render: false, log: false })
  editorState.project = project
  editorState.dirty = false
  editorState.selectedAssetId = null
  editorState.selectedLayerId = null
  editorState.sceneHistories = {}
  editorState.animationRuntime = createAnimationRuntimeState(runtimeNow())
  editorState.repair = {
    local: createEmptyActionRepairSelectionState(),
    aiAction: {
      ...editorState.repair.aiAction,
      selectedAction: '',
      selectedRegionKeys: [],
      plan: null,
      job: null,
      importResult: null,
      status: 'idle',
      message: '',
      assetId: null,
      revisionId: null,
    },
  }
  editorState.playtest = {
    ...editorState.playtest,
    running: false,
    runtime: null,
    playerLayerId: '',
    pressedKeys: new Set(),
    lastTickMs: null,
    diagnostics: [],
    point: { x: 0, y: 0 },
  }
  editorState.exportPack = {
    status: 'idle',
    message: '',
    result: null,
    handoff: {
      manifest: null,
      godot: null,
      ldtk: null,
      error: '',
    },
    reviewTab: 'manifest',
    previewSceneId: '',
  }
  editorState.drag = null
  ensureSceneHistory()
  syncRuntimeClocks()
  refreshSceneRenderAssets()
}
function replaceActiveScene(nextScene, { commit = false, groupKey = null } = {}) {
  const project = editorState.project
  if (!project || !nextScene) return
  const key = activeSceneHistoryKey(nextScene.id)
  const history = ensureSceneHistory(activeScene())
  const now = new Date().toISOString()
  const scene = {
    ...nextScene,
    updated_at: nextScene.updated_at ?? now,
  }
  editorState.project = {
    ...project,
    updated_at: now,
    scenes: {
      ...project.scenes,
      [scene.id]: scene,
    },
  }
  editorState.dirty = true
  syncRuntimeClocks()
  refreshSceneRenderAssets()
  if (commit && key && history) {
    editorState.sceneHistories[key] = commitHistory(history, scene, {
      selection: { layer_id: editorState.selectedLayerId },
      groupKey,
    })
  }
}
function replaceProjectDraft(nextProject, label) {
  if (!nextProject) return
  editorState.project = nextProject
  editorState.dirty = true
  editorState.selectedAssetId = null
  editorState.selectedLayerId = null
  editorState.sceneHistories = {}
  ensureSceneHistory()
  syncRuntimeClocks()
  refreshSceneRenderAssets()
  if (label) addEditorLog(label)
  renderAll()
}
function historyState() {
  const history = ensureSceneHistory()
  return {
    canUndo: Boolean(history?.past?.length),
    canRedo: Boolean(history?.future?.length),
  }
}
function commitLayerUpdate(layerId, updater, label, { allowLocked = false, groupKey = null } = {}) {
  const scene = activeScene()
  const layer = sceneLayers(scene).find((item) => item.id === layerId)
  if (!scene || !layer) return
  if (layer.locked && !allowLocked) {
    toast('Layer is locked')
    return
  }
  const nextScene = updateSceneLayer(scene, layerId, updater)
  replaceActiveScene(nextScene, { commit: true, groupKey })
  addEditorLog(label)
  renderAll()
  return nextScene.layers?.find((item) => item.id === layerId) ?? null
}
function setSelectedLayer(layerId) {
  editorState.selectedLayerId = layerId
  const layer = selectedLayer()
  editorState.selectedAssetId = layer?.asset_id ?? editorState.selectedAssetId
}
function saveProjectDraft(project = editorState.project) {
  if (!project) return null
  return {
    ...project,
    name: $('#editor-project-name').value.trim() || project.name,
  }
}
async function saveCurrentProject() {
  const project = saveProjectDraft()
  if (!project) return null
  const result = await saveEditorProject(project, project.revision)
  if (result?.project) {
    editorState.project = result.project
    editorState.dirty = false
    renderAll()
  }
  return result?.project ?? null
}
async function exportCurrentProjectPack() {
  let project = editorState.project
  if (!project) return null
  if (editorState.dirty) {
    project = await saveCurrentProject()
    if (!project) return null
  }
  editorState.exportPack.status = 'running'
  editorState.exportPack.message = 'exporting pack'
  editorState.exportPack.result = null
  renderAll()
  try {
    const result = await exportEditorProjectPack({
      projectId: project.id,
      expectedRevision: project.revision,
    })
    const handoff = {
      manifest: null,
      godot: null,
      ldtk: null,
      error: '',
    }
    try {
      const urls = result.export?.urls ?? {}
      handoff.manifest = urls.engine_handoff_manifest_url
        ? await fetchEditorArtifactJson(urls.engine_handoff_manifest_url)
        : null
      handoff.godot = urls.godot_scene_handoff_url
        ? await fetchEditorArtifactJson(urls.godot_scene_handoff_url)
        : null
      handoff.ldtk = urls.ldtk_scene_handoff_url
        ? await fetchEditorArtifactJson(urls.ldtk_scene_handoff_url)
        : null
    } catch (error) {
      handoff.error = error.message || String(error)
    }
    editorState.exportPack = {
      status: result.export?.status ?? 'done',
      message: result.export?.status === 'fail' ? 'export validation failed' : 'export ready',
      result: result.export,
      handoff,
      reviewTab: editorState.exportPack.reviewTab,
      previewSceneId: handoff.manifest?.scenes?.[0]?.id ?? editorState.exportPack.previewSceneId,
    }
    addEditorLog(`Project pack exported: ${result.export?.id ?? project.id}`)
    return result.export
  } catch (error) {
    editorState.exportPack = {
      status: 'error',
      message: error.message || String(error),
      result: null,
    }
    throw error
  }
}
function renderAssetList() {
  const list = $('#editor-asset-list')
  list.replaceChildren()
  const assets = sortedAssets()
  $('#editor-asset-count').textContent = String(assets.length)
  if (!assets.length) {
    const empty = document.createElement('div')
    empty.className = 'editor-empty-line'
    empty.textContent = editorState.project ? 'No assets registered' : 'No project loaded'
    list.append(empty)
    return
  }
  for (const asset of assets) {
    const entry = buildAssetLibraryEntry(editorState.project, asset)
    const item = document.createElement('article')
    item.className = 'editor-asset-item'
    item.tabIndex = 0
    item.setAttribute('role', 'button')
    item.dataset.selected = String(editorState.selectedAssetId === asset.id)
    const selectAsset = () => {
      editorState.selectedAssetId = asset.id
      editorState.selectedLayerId = null
      renderAll()
    }
    item.addEventListener('click', selectAsset)
    item.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        selectAsset()
      }
    })
    const body = document.createElement('div')
    body.className = 'editor-asset-body'
    const titleRow = document.createElement('div')
    titleRow.className = 'editor-asset-title'
    const title = document.createElement('strong')
    title.textContent = entry.name
    const status = document.createElement('span')
    status.className = `editor-quality ${entry.quality_status}`
    status.textContent = `${entry.quality_status} / ${entry.production_status}`
    titleRow.append(title, status)
    const meta = document.createElement('div')
    meta.className = 'editor-asset-metas'
    meta.append(
      assetMeta('kind', entry.kind),
      assetMeta('profile', entry.profile ?? 'none'),
      assetMeta('source', entry.source_job_id ?? 'manual'),
      assetMeta('provenance', assetProvenanceLabel(entry.provenance)),
      assetMeta('clips', entry.clip_count),
      assetMeta('used', assetUsageLabel(entry.usage)),
    )
    const actions = document.createElement('div')
    actions.className = 'editor-row-actions'
    const inspect = button('Inspect', 'secondary')
    inspect.addEventListener('click', (event) => {
      event.stopPropagation()
      selectAsset()
    })
    const addLayer = button('Add layer', 'secondary', !editorState.project || !canAddAssetToScene(asset))
    addLayer.addEventListener('click', (event) => {
      event.stopPropagation()
      addAssetLayer(asset)
    })
    const repair = button('Repair', 'secondary', !entry.can_repair)
    repair.title = entry.can_repair ? 'Open visual repair' : 'Repair is available for character assets'
    repair.addEventListener('click', (event) => {
      event.stopPropagation()
      openRepairForAsset(asset)
    })
    const exportAction = button('Export later', 'secondary is-future', true)
    const unlink = button('Unlink', 'secondary', !entry.can_unlink)
    unlink.title = entry.can_unlink ? 'Remove this asset from every scene layer' : 'Asset is not used by any scene layer'
    unlink.addEventListener('click', (event) => {
      event.stopPropagation()
      unlinkAssetUsage(asset)
    })
    const remove = button('Delete', 'secondary', !entry.can_delete)
    remove.title = entry.can_delete ? 'Remove this asset record from the project' : 'Unlink scene layers before deleting this asset'
    remove.addEventListener('click', (event) => {
      event.stopPropagation()
      deleteAssetRecord(asset)
    })
    actions.append(inspect, addLayer, repair, exportAction, unlink, remove)
    body.append(titleRow, meta, actions)
    item.append(renderAssetThumbnail(entry), body)
    list.append(item)
  }
}
function syncStageCanvasSize() {
  const canvas = $('#editor-scene-canvas')
  const width = Math.max(1, Math.round(editorState.stage.width || 1))
  const height = Math.max(1, Math.round(editorState.stage.height || 1))
  if (canvas.width !== width) canvas.width = width
  if (canvas.height !== height) canvas.height = height
  return canvas
}
function updatePlaytestHud() {
  const running = Boolean(editorState.playtest.running)
  const runtime = editorState.playtest.runtime
  const player = runtime?.player
  const stage = $('#editor-stage')
  const hud = $('#editor-playtest-hud')
  const diagnostic = runtime?.diagnostics?.[0] ?? ''
  stage.dataset.playtestRunning = String(running)
  hud.hidden = !running
  hud.dataset.diagnostic = diagnostic
  $('#editor-playtest-hud-clip').textContent = diagnostic === 'missing_directional_clip'
    ? `${player?.clip_id ?? '-'} (fallback)`
    : player?.clip_id ?? '-'
  $('#editor-playtest-hud-direction').textContent = player?.direction ?? '-'
  $('#editor-playtest-hud-coordinates').textContent = player
    ? `${player.x.toFixed(1)}, ${player.y.toFixed(1)}`
    : '-'
  if (running && diagnostic && $('#editor-stage-live').dataset.diagnostic !== diagnostic) {
    $('#editor-stage-live').dataset.diagnostic = diagnostic
    announcePlaytest(`Playtest diagnostic: ${diagnostic}.`)
  }
}
function renderStageCanvas(scene = displayScene()) {
  const canvas = syncStageCanvasSize()
  if (!scene) {
    canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
    editorState.sceneRender.diagnostics = []
    updatePlaytestHud()
    return null
  }
  const runtime = editorState.playtest.running
    ? { ...editorState.playtest.runtime, running: true }
    : null
  const frame = renderEditorSceneFrame(
    canvas,
    scene,
    editorState.sceneRender.result ?? { byAssetId: {}, diagnostics: [] },
    editorState.animationRuntime,
    runtime,
  )
  editorState.sceneRender.diagnostics = frame.diagnostics
  updatePlaytestHud()
  return frame.view
}
function renderStage() {
  const scene = displayScene()
  const layers = sceneLayers(scene)
  const empty = $('#editor-stage-empty')
  const grid = $('.editor-stage-grid')
  const preview = $('#editor-layer-preview')
  preview.replaceChildren()
  $('#editor-active-scene-label').textContent = editorState.project
    ? `${editorState.project.id} / rev ${editorState.project.revision}${editorState.playtest.running ? ' / playtest' : ''}`
    : 'No project'
  $('#editor-active-scene-name').textContent = scene?.name ?? 'Scene Stage'
  const view = renderStageCanvas(scene)
  if (!scene || !view) {
    empty.hidden = false
    empty.textContent = 'No project loaded'
    grid.hidden = true
    return
  }
  grid.hidden = !editorState.stage.gridVisible || editorState.playtest.running
  grid.style.left = `${view.offsetX}px`
  grid.style.top = `${view.offsetY}px`
  grid.style.width = `${view.worldWidth}px`
  grid.style.height = `${view.worldHeight}px`
  grid.style.backgroundSize = `${Math.max(4, editorState.stage.snapSize * view.scale)}px ${Math.max(4, editorState.stage.snapSize * view.scale)}px`
  if (editorState.playtest.running) {
    empty.hidden = true
    return
  }
  const world = document.createElement('div')
  world.className = 'editor-stage-world'
  world.style.left = `${view.offsetX}px`
  world.style.top = `${view.offsetY}px`
  world.style.width = `${view.worldWidth}px`
  world.style.height = `${view.worldHeight}px`
  preview.append(world)
  const loading = editorState.sceneRender.status === 'loading'
  empty.hidden = layers.length > 0 && !loading
  empty.textContent = loading ? 'Loading scene assets' : layers.length ? '' : 'No layers in active scene'
  const renderedLayers = [...layers].sort((a, b) => (a.render?.z_index ?? 0) - (b.render?.z_index ?? 0))
  for (const layer of renderedLayers) {
    const asset = editorState.project?.assets?.[layer.asset_id]
    const box = layerBoxInView(layer, scene, asset, view)
    const frameState = frameStateForLayer(editorState.animationRuntime, layer, asset)
    const marker = document.createElement('div')
    marker.className = 'editor-layer-marker'
    marker.tabIndex = 0
    marker.setAttribute('role', 'button')
    marker.dataset.selected = String(editorState.selectedLayerId === layer.id)
    marker.dataset.locked = String(layer.locked)
    marker.dataset.visible = String(layer.visible)
    marker.dataset.frameIndex = String(frameState.frame_index)
    marker.style.left = `${box.left}px`
    marker.style.top = `${box.top}px`
    marker.style.width = `${box.width}px`
    marker.style.height = `${box.height}px`
    marker.style.zIndex = String((layer.render?.z_index ?? 0) + 2)
    marker.style.opacity = String(layer.visible ? layer.render?.opacity ?? 1 : 0.28)
    const label = document.createElement('span')
    label.textContent = frameState.playable
      ? `${layer.name ?? layer.id} / f${frameState.frame_number}`
      : layer.name ?? layer.id
    const anchor = document.createElement('i')
    anchor.className = 'editor-layer-anchor'
    anchor.style.left = `${box.anchorX}px`
    anchor.style.top = `${box.anchorY}px`
    marker.append(label, anchor)
    if (editorState.selectedLayerId === layer.id && !layer.locked) {
      const handle = document.createElement('span')
      handle.className = 'editor-resize-handle'
      handle.addEventListener('pointerdown', (event) => {
        event.stopPropagation()
        startLayerPointer(event, layer.id, 'resize', view)
      })
      marker.append(handle)
    }
    marker.addEventListener('click', () => {
      setSelectedLayer(layer.id)
      renderAll()
    })
    marker.addEventListener('keydown', (event) => handleLayerKeydown(event, layer.id))
    marker.addEventListener('pointerdown', (event) => startLayerPointer(event, layer.id, 'move', view))
    preview.append(marker)
    const zoneBox = interactionZoneBoxInView(layer, scene, view)
    if (zoneBox && layer.interaction?.enabled) {
      const zone = document.createElement('div')
      zone.className = 'editor-interaction-zone'
      zone.dataset.selected = String(editorState.selectedLayerId === layer.id)
      zone.style.left = `${zoneBox.left}px`
      zone.style.top = `${zoneBox.top}px`
      zone.style.width = `${zoneBox.width}px`
      zone.style.height = `${zoneBox.height}px`
      zone.style.zIndex = String((layer.render?.z_index ?? 0) + 1)
      preview.append(zone)
    }
  }
}
function renderLayersPanel(scene) {
  const wrap = document.createElement('div')
  wrap.className = 'editor-layer-list'
  const layers = Array.isArray(scene?.layers) ? scene.layers : []
  if (!layers.length) {
    const empty = document.createElement('div')
    empty.className = 'editor-empty-line'
    empty.textContent = scene ? 'No layers' : 'No scene'
    wrap.append(empty)
    return wrap
  }
  for (const layer of layers) {
    const row = document.createElement('div')
    row.className = 'editor-layer-row'
    row.dataset.selected = String(editorState.selectedLayerId === layer.id)
    row.addEventListener('click', () => {
      setSelectedLayer(layer.id)
      renderAll()
    })
    const visible = document.createElement('input')
    visible.type = 'checkbox'
    visible.checked = layer.visible
    visible.disabled = layer.locked
    visible.addEventListener('click', (event) => event.stopPropagation())
    visible.addEventListener('change', () => {
      commitLayerUpdate(layer.id, (draft) => ({ ...draft, visible: visible.checked }), 'Layer visibility changed')
    })
    const locked = document.createElement('input')
    locked.type = 'checkbox'
    locked.checked = layer.locked
    locked.addEventListener('click', (event) => event.stopPropagation())
    locked.addEventListener('change', () => {
      commitLayerUpdate(layer.id, (draft) => ({ ...draft, locked: locked.checked }), 'Layer lock changed', { allowLocked: true })
    })
    const actions = document.createElement('div')
    actions.className = 'editor-row-actions'
    const up = button('Up', 'secondary', layer.locked)
    const down = button('Down', 'secondary', layer.locked)
    up.addEventListener('click', (event) => {
      event.stopPropagation()
      reorderLayer(layer.id, -1)
    })
    down.addEventListener('click', (event) => {
      event.stopPropagation()
      reorderLayer(layer.id, 1)
    })
    actions.append(up, down)
    row.append(
      keyValue(layer.name ?? layer.id, `${layer.type} / z ${layer.render?.z_index ?? 0}`),
      keyValue('asset', layer.asset_id),
      controlInline('visible', visible),
      controlInline('locked', locked),
      actions,
    )
    wrap.append(row)
  }
  return wrap
}
function renderTimelinePanel() {
  const wrap = document.createElement('div')
  wrap.className = 'editor-timeline'
  const scene = activeScene()
  const layers = sceneLayers(scene)
  if (!scene) {
    const empty = document.createElement('div')
    empty.className = 'editor-empty-line'
    empty.textContent = 'No scene'
    wrap.append(empty)
    return wrap
  }
  if (!layers.length) {
    const empty = document.createElement('div')
    empty.className = 'editor-empty-line'
    empty.textContent = 'No layers'
    wrap.append(empty)
    return wrap
  }
  for (const layer of layers) {
    const asset = editorState.project?.assets?.[layer.asset_id]
    const frameState = frameStateForLayer(editorState.animationRuntime, layer, asset)
    const row = document.createElement('div')
    row.className = 'editor-timeline-row'
    row.dataset.selected = String(editorState.selectedLayerId === layer.id)
    row.addEventListener('click', () => {
      setSelectedLayer(layer.id)
      renderAll()
    })
    const title = document.createElement('div')
    title.className = 'editor-timeline-title'
    const name = document.createElement('strong')
    name.textContent = layer.name ?? layer.id
    const meta = document.createElement('span')
    meta.textContent = frameState.playable
      ? `${frameState.clip_id} / ${frameState.frame_count} frames / ${frameState.clip.fps} fps`
      : frameState.issue ?? 'static layer'
    title.append(name, meta)
    const current = document.createElement('div')
    current.className = 'editor-timeline-frame'
    current.textContent = frameState.playable
      ? `Frame ${frameState.frame_index + 1}/${frameState.frame_count} (${frameState.frame_number})`
      : '-'
    const scrub = document.createElement('input')
    scrub.type = 'range'
    scrub.min = '0'
    scrub.max = String(Math.max(0, Math.round(frameState.duration_ms)))
    scrub.step = String(frameState.playable ? Math.max(1, Math.round(1000 / frameState.clip.fps)) : 1)
    scrub.value = String(Math.min(Math.round(frameState.elapsed_ms), Math.round(frameState.duration_ms)))
    scrub.disabled = !frameState.playable
    scrub.addEventListener('click', (event) => event.stopPropagation())
    scrub.addEventListener('input', () => {
      editorState.animationRuntime = setLayerElapsed(editorState.animationRuntime, layer.id, Number(scrub.value))
      setSelectedLayer(layer.id)
      renderAll()
    })
    const controls = document.createElement('div')
    controls.className = 'editor-row-actions'
    const layerPlay = button(frameState.running ? 'Pause' : 'Play', 'secondary', !frameState.playable)
    layerPlay.addEventListener('click', (event) => {
      event.stopPropagation()
      editorState.animationRuntime = setLayerClockPlaying(editorState.animationRuntime, layer.id, !frameState.running)
      setSelectedLayer(layer.id)
      renderAll()
      scheduleAnimationTick()
    })
    const reset = button('Reset', 'secondary', !frameState.playable)
    reset.addEventListener('click', (event) => {
      event.stopPropagation()
      editorState.animationRuntime = resetLayerElapsed(editorState.animationRuntime, layer.id, frameState.playback)
      setSelectedLayer(layer.id)
      renderAll()
    })
    const duration = document.createElement('span')
    duration.className = 'editor-timeline-duration'
    duration.textContent = frameState.playable
      ? `${formatMs(frameState.elapsed_ms)} / ${formatMs(frameState.duration_ms)}`
      : 'not animated'
    controls.append(layerPlay, reset, duration)
    row.append(title, current, scrub, controls)
    wrap.append(row)
  }
  return wrap
}
function renderQualityPanel() {
  const wrap = document.createElement('div')
  wrap.className = 'editor-quality-list'
  const assets = sortedAssets()
  if (!assets.length) {
    const empty = document.createElement('div')
    empty.className = 'editor-empty-line'
    empty.textContent = 'No asset quality records'
    wrap.append(empty)
    return wrap
  }
  for (const asset of assets) {
    const revision = assetRevision(asset)
    wrap.append(keyValue(asset.name, `${revision?.quality_status ?? 'unknown'} / ${revision?.production_status ?? 'review_required'}`))
  }
  return wrap
}
function renderRepairPlan(wrap) {
  const ai = editorState.repair.aiAction
  const { plan, job } = ai
  if (!plan && !job && !ai.message) return
  const { asset, revision } = repairContext()
  const batch = selectedBatchRepairSelection()
  const selected = plan?.selected_region_keys?.join(', ') ??
    job?.selected_region_keys?.join(', ') ??
    (batch.available ? batch.regionKeys.join(', ') : preferredRepairAction())
  const sourceMask = plan?.preflight?.source_region_mask
  const sourceMaskSummary = Array.isArray(sourceMask?.regions)
    ? `${sourceMask.width}x${sourceMask.height}: ${sourceMask.regions.map((region) => `${region.key}[${region.x},${region.y},${region.w},${region.h}]`).join(' ')}`
    : 'pending'
  const status = document.createElement('div')
  status.className = 'editor-repair-status'
  status.dataset.status = ai.status
  status.append(
    keyValue('status', ai.message || ai.status),
    keyValue('asset / parent', `${asset?.id ?? '-'} / ${revision?.id ?? '-'}`),
    keyValue('selected action slots', selected || '-'),
    keyValue('exact source-region mask', sourceMaskSummary),
    keyValue('reference inputs', plan?.preflight?.reference_roles?.join(', ') ?? 'identity atlas, pose guide atlas, empty output atlas'),
    keyValue('source target slots holed', plan?.reference_policy?.source_target_regions_holed === false ? 'no' : '-'),
    keyValue('provider / model', `${plan?.provider?.provider ?? job?.provider ?? '-'} / ${plan?.provider?.model ?? job?.model ?? '-'}`),
    keyValue('image size', plan?.image_config?.image_size ?? job?.image_config?.image_size ?? ai.imageSize),
    keyValue('provider calls planned / used', `${plan?.estimated_provider_calls ?? job?.estimated_provider_calls ?? '-'} / ${job?.provider_call_budget?.used_provider_calls ?? '-'}`),
    keyValue('review id / plan hash', `${plan?.review_id ?? job?.action_repair_review_id ?? '-'} / ${plan?.plan_hash ?? job?.action_repair_plan_hash ?? '-'}`),
    keyValue('reference manifest', plan?.reference_manifest_sha256 ?? job?.action_repair_reference_manifest_sha256 ?? '-'),
    keyValue('pixel scope', job?.source_scope_status
      ? `${job.source_scope_status}; outside selected = ${job.outside_selected_changed_pixels ?? '-'}`
      : 'pending'),
    keyValue('acceptance', ai.importResult ? `accepted as ${ai.importResult.revision?.id ?? 'revision'}` : 'manual confirmation required'),
  )
  const links = linkList([
    ['plan', plan?.repair_plan_url ?? job?.repair_plan_url],
    ['sealed review contract', plan?.action_repair_review_contract_url ?? job?.action_repair_review_contract_url],
    ['prompt', plan?.repair_prompt_url ?? job?.repair_prompt_url],
    ['identity anchors', plan?.repair_identity_anchor_atlas_url ?? job?.repair_identity_anchor_atlas_url],
    ['pose guide', plan?.repair_pose_guide_atlas_url ?? job?.repair_pose_guide_atlas_url],
    ['empty output atlas', plan?.repair_empty_output_atlas_url ?? job?.repair_empty_output_atlas_url],
    ['summary', job?.repair_summary_url],
    ['raw provider atlas', job?.raw_provider_repair_output_url],
    ['atlas extraction', job?.atlas_extraction_report_url],
    ['review candidate', job?.review_candidate_source_sheet_url],
    ['scope validation', job?.source_scope_report_url],
    ['equipment validation', job?.equipment_quality_report_url],
    ['validation', job?.candidate_validation_report_url],
    ['sealed acceptance manifest', job?.action_repair_acceptance_manifest_url],
  ])
  status.append(links)
  wrap.append(status)
}
function renderExistingAiActionRepair(container) {
  container.replaceChildren()
  const { asset, revision, actions } = repairContext()
  resetRepairStateForSelection(asset)
  const ai = editorState.repair.aiAction
  const action = preferredRepairAction()
  const batch = selectedBatchRepairSelection()
  const busy = ['planning', 'running', 'accepting'].includes(ai.status)
  const body = document.createElement('div')
  body.className = 'editor-repair-ai-action-body'
  if (batch.available) {
    const selection = document.createElement('p')
    selection.className = 'editor-repair-batch-summary'
    selection.textContent = batch.canPlan
      ? `${batch.outputFrameCount} linked output frame(s) → ${batch.sourceRegionCount} source action slot(s) in ${batch.actions.length} action group(s) → exactly 1 provider call. The model receives only an identity-anchor atlas, grayscale pose-guide atlas, and independent empty output atlas.`
      : 'Select every incorrect action frame with the checkboxes below. Mirrored or repeated output frames that share one source slot are linked automatically.'
    body.append(selection)
    if (batch.canPlan) {
      const clearButton = button('Clear selected frames', 'secondary', busy)
      clearButton.addEventListener('click', () => {
        editorState.repair.aiAction = {
          ...editorState.repair.aiAction,
          selectedRegionKeys: [],
          plan: null,
          job: null,
          importResult: null,
          status: 'idle',
          message: '',
        }
        renderAll()
      })
      body.append(clearButton)
    }
  } else {
    body.append(selectControl('action', action, actions.length ? actions : [''], {
      disabled: !actions.length || busy,
      onChange: (value) => {
        ai.selectedAction = value
        ai.plan = null
        ai.job = null
        ai.importResult = null
        renderAll()
      },
    }))
  }
  const instructionLabel = document.createElement('label')
  instructionLabel.className = 'editor-field'
  const instructionTitle = document.createElement('span')
  instructionTitle.textContent = 'action correction instruction'
  const instruction = document.createElement('textarea')
  instruction.rows = 3
  instruction.maxLength = 500
  instruction.value = ai.instruction
  instruction.disabled = busy
  instruction.addEventListener('change', () => {
    ai.instruction = instruction.value.trim()
    ai.plan = null
    ai.job = null
    ai.importResult = null
    renderAll()
  })
  instructionLabel.append(instructionTitle, instruction)
  body.append(
    instructionLabel,
    selectControl('equipment / held-object policy', ai.equipmentPolicy, ['none', 'preserve', 'separate'], {
      disabled: busy,
      onChange: (value) => {
        ai.equipmentPolicy = value
        ai.plan = null
        ai.job = null
        ai.importResult = null
        renderAll()
      },
    }),
    selectControl('image size', ai.imageSize, ['1K', '2K'], {
      disabled: busy,
      onChange: (value) => {
        ai.imageSize = value
        ai.plan = null
        renderAll()
      },
    }),
  )
  const provider = document.createElement('label')
  provider.className = 'editor-field'
  const providerLabel = document.createElement('span')
  providerLabel.textContent = 'provider preset'
  const providerInput = document.createElement('input')
  providerInput.type = 'text'
  providerInput.value = ai.providerPresetId
  providerInput.placeholder = 'default'
  providerInput.disabled = busy
  providerInput.addEventListener('change', () => {
    ai.providerPresetId = providerInput.value.trim()
    ai.plan = null
    renderAll()
  })
  provider.append(providerLabel, providerInput)
  body.append(provider)
  const actionsRow = document.createElement('div')
  actionsRow.className = 'editor-row-actions'
  const canPlan = Boolean(
    revision?.source_job_id && String(ai.instruction ?? '').trim() &&
    (batch.available ? batch.canPlan : action),
  )
  const planButton = button(batch.available ? 'Review selected action repair' : 'Review action repair', 'secondary', !canPlan || busy)
  planButton.addEventListener('click', planRepairAction)
  const runButton = button('Generate one candidate', '', !ai.plan?.can_run || busy || ai.status === 'candidate_ready')
  runButton.addEventListener('click', runRepairAction)
  const acceptButton = button(
    'Accept candidate as revision',
    '',
    ai.status !== 'candidate_ready' || ai.job?.status !== 'done' || Boolean(ai.importResult),
  )
  acceptButton.addEventListener('click', acceptRepairActionCandidate)
  actionsRow.append(planButton, runButton, acceptButton)
  body.append(actionsRow)
  container.append(body)
  renderRepairPlan(body)
}
function renderRepairUnavailableState(root, asset, local = null) {
  const state = local?.status ?? (!editorState.project ? 'no_project' : !asset ? 'no_asset' : 'unsupported_asset')
  const messages = {
    no_project: 'Load a project to use three-atlas action repair.',
    no_asset: 'Select a Character Pack asset to begin.',
    unsupported_asset: 'Three-atlas action repair is available for Character Pack assets.',
    loading: 'Loading authoritative action-slot mapping…',
  }
  const wrap = document.createElement('div')
  wrap.className = 'editor-repair-load-state'
  wrap.dataset.status = state
  wrap.setAttribute('aria-live', 'polite')
  const message = document.createElement('p')
  message.textContent = local?.message || messages[state] || 'Three-atlas action repair is unavailable.'
  wrap.append(message)
  if (asset && local?.status === 'failed') {
    const retryButton = button('Retry', 'secondary')
    retryButton.addEventListener('click', () => { void ensureRepairController().openAsset(asset) })
    wrap.append(retryButton)
  }
  root.replaceChildren(wrap)
}
function renderRepairPanel() {
  const root = $('#editor-panel-body')
  const { asset, revision } = repairContext()
  if (!asset) {
    closeRepairSession(editorState.project ? 'selection_cleared' : 'project_switch')
    renderRepairUnavailableState(root, asset)
    return
  }
  if (asset.kind !== 'character_pack' || !revision) {
    ensureRepairController().close('unsupported_selection')
    renderRepairUnavailableState(root, asset)
    return
  }
  resetRepairStateForSelection(asset)
  const local = editorState.repair.local
  const selectionMatches = local.selection?.projectId === editorState.project.id &&
    local.selection?.projectRevision === editorState.project.revision &&
    local.selection?.assetId === asset.id &&
    local.selection?.revisionId === revision.id
  if (!selectionMatches || local.status !== 'ready') {
    if (!selectionMatches || local.status === 'idle') {
      void ensureRepairController().openAsset(asset)
    }
    renderRepairUnavailableState(root, asset, editorState.repair.local)
    return
  }
  const panel = ensureRepairWorkbench()
  const context = ensureRepairController().contextFor(asset, revision)
  const selectionKey = `${editorState.project.id}:${editorState.project.revision}:${asset.id}:${revision.id}`
  if (mountedRepairSelectionKey !== selectionKey) {
    mountedRepairSelectionKey = selectionKey
    panel.open(context)
  } else {
    panel.render(context.viewModel())
  }
}
function selectedPlayerLayer(scene = activeScene()) {
  const options = playerLayerOptions(scene, activeAssets())
  const layerId = editorState.playtest.playerLayerId || editorState.selectedLayerId
  const resolvedId = options.some((option) => option.value === layerId) ? layerId : options[0]?.value
  return sceneLayers(scene).find((layer) => layer.id === resolvedId) ?? null
}
function resetPlaytestPointFromLayer(layer = selectedPlayerLayer()) {
  if (!layer) return
  editorState.playtest.point = {
    x: layer.transform?.position?.x ?? 0,
    y: layer.transform?.position?.y ?? 0,
  }
}
function clearPlaytestInput() {
  clearPlaytestPressedKeys(editorState.playtest)
}
function announcePlaytest(message) {
  const node = $('#editor-stage-live')
  if (node) node.textContent = message
}
function playtestControllerScene(scene) {
  const selectedZoom = Number(editorState.playtest.options?.cameraZoom)
  const zoom = positiveNumber(selectedZoom, positiveNumber(scene?.camera?.zoom, 1))
  return {
    ...scene,
    camera: { ...(scene?.camera ?? {}), zoom },
  }
}
function startPlaytest() {
  const project = editorState.project
  const scene = activeScene()
  if (!project || !scene) return
  const availability = getPlaytestPanelState({
    project,
    scene,
    assets: activeAssets(),
    playtest: editorState.playtest,
    sceneRender: editorState.sceneRender,
    selectedLayerId: editorState.selectedLayerId,
  })
  if (!availability.canStart) {
    announcePlaytest(`Playtest blocked: ${availability.message}`)
    return
  }
  const player = availability.playerLayer
  const playerEntry = player ? editorState.sceneRender.result?.byAssetId?.[player.asset_id] : null
  if (!player || playerEntry?.status !== 'ready') {
    announcePlaytest('Playtest blocked: the player asset is not ready.')
    return
  }
  editorState.playtest.playerLayerId = player.id
  resetPlaytestPointFromLayer(player)
  clearPlaytestInput()
  const controllerScene = playtestControllerScene(scene)
  const { cameraZoom: _cameraZoom, ...controllerOptions } = editorState.playtest.options ?? {}
  const interactionRuntime = createInteractionRuntimeState({
    project,
    activeSceneId: project.active_scene_id,
    playerLayerId: player.id,
    playerPosition: editorState.playtest.point,
  })
  const controllerRuntime = createPlaytestControllerState({
    scene: controllerScene,
    playerLayerId: player.id,
    options: controllerOptions,
  })
  editorState.playtest.running = true
  $('#editor-stage-live').dataset.diagnostic = ''
  editorState.playtest.runtime = {
    ...interactionRuntime,
    ...controllerRuntime,
    activeSceneId: project.active_scene_id,
    running: true,
  }
  const now = runtimeNow()
  editorState.playtest.lastTickMs = now
  editorState.animationRuntime = createAnimationRuntimeState(now)
  syncRuntimeClocks()
  editorState.animationRuntime = setRuntimePlaying(editorState.animationRuntime, true, now)
  addEditorLog('Playtest started')
  renderAll()
  $('#editor-stage').focus({ preventScroll: true })
  announcePlaytest('Playtest started. Use WASD or arrow keys. Press Escape to stop.')
  scheduleAnimationTick()
}
function stopPlaytest({ render = true, log = true } = {}) {
  const wasRunning = editorState.playtest.running
  if (animationFrameRequest != null) {
    window.cancelAnimationFrame(animationFrameRequest)
    animationFrameRequest = null
  }
  clearPlaytestInput()
  editorState.playtest.running = false
  const liveRegion = $('#editor-stage-live')
  if (liveRegion) liveRegion.dataset.diagnostic = ''
  editorState.playtest.runtime = null
  editorState.animationRuntime = createAnimationRuntimeState(runtimeNow())
  if (wasRunning && log) addEditorLog('Playtest stopped')
  if (wasRunning) announcePlaytest('Playtest stopped. Editing controls restored.')
  if (render) renderAll()
}
function eventForPlaytest(type = editorState.playtest.eventType) {
  const runtime = editorState.playtest.runtime
  return {
    type,
    key: editorState.playtest.key || 'KeyE',
    point: {
      x: Number.isFinite(runtime?.player?.x) ? runtime.player.x : Number(editorState.playtest.point?.x) || 0,
      y: Number.isFinite(runtime?.player?.y) ? runtime.player.y : Number(editorState.playtest.point?.y) || 0,
    },
  }
}
function applyPlaytestAnimationEvents(events) {
  if (!events.some((event) => event.type === 'play_animation')) return
  syncRuntimeClocks()
  for (const event of events) {
    if (event.type !== 'play_animation') continue
    editorState.animationRuntime = resetLayerElapsed(editorState.animationRuntime, event.target_layer_id, { start_offset_ms: 0 })
    editorState.animationRuntime = setLayerClockPlaying(editorState.animationRuntime, event.target_layer_id, true)
  }
  scheduleAnimationTick()
}
function triggerPlaytest(type = editorState.playtest.eventType) {
  if (!editorState.project) return
  if (!editorState.playtest.running || !editorState.playtest.runtime) startPlaytest()
  const runtime = editorState.playtest.runtime
  if (!runtime) return
  const event = eventForPlaytest(type)
  const result = triggerInteractions(editorState.project, runtime, event)
  const sceneChanged = result.runtime.activeSceneId !== runtime.activeSceneId
  let nextRuntime = { ...result.runtime, running: true }
  if (sceneChanged) {
    const targetScene = editorState.project.scenes?.[result.runtime.activeSceneId]
    const transitioned = transitionPlaytestControllerScene(
      result.runtime,
      editorState.project.scenes?.[runtime.activeSceneId],
      playtestControllerScene(targetScene),
      activeAssets(),
    )
    if (!transitioned) {
      stopPlaytest({ render: false, log: false })
      addEditorLog('Playtest stopped: target scene has no compatible visible player layer')
      renderAll()
      announcePlaytest('Playtest stopped: target scene has no compatible visible player layer.')
      return
    }
    nextRuntime = { ...transitioned, running: true }
    clearPlaytestInput()
    editorState.playtest.lastTickMs = runtimeNow()
    editorState.animationRuntime = createAnimationRuntimeState(editorState.playtest.lastTickMs)
  }
  editorState.playtest.runtime = nextRuntime
  editorState.playtest.point = {
    x: nextRuntime.player?.x ?? event.point.x,
    y: nextRuntime.player?.y ?? event.point.y,
  }
  if (!sceneChanged) applyPlaytestAnimationEvents(result.events)
  if (sceneChanged) refreshSceneRenderAssets({ force: true })
  addEditorLog(`Playtest ${type}: ${result.events.length} events`)
  renderAll()
}
function tickPlaytestFrame(now) {
  const runtime = editorState.playtest.runtime
  const scene = runtime?.activeSceneId ? editorState.project?.scenes?.[runtime.activeSceneId] : null
  if (!runtime || !scene) {
    stopPlaytest()
    return
  }
  const lastTick = editorState.playtest.lastTickMs ?? now
  const controller = tickPlaytestController(
    runtime,
    editorState.playtest.pressedKeys,
    Math.max(0, now - lastTick),
    scene,
    activeAssets(),
  )
  editorState.playtest.lastTickMs = now
  editorState.playtest.runtime = { ...runtime, ...controller, running: true }
  editorState.playtest.point = { x: controller.player.x, y: controller.player.y }
  const runtimeScene = displayScene()
  editorState.animationRuntime = tickAnimationRuntime(
    syncAnimationRuntime(
      editorState.animationRuntime,
      runtimeScene,
      activeAssets(),
      editorState.animationRuntime?.last_tick_ms ?? now,
    ),
    runtimeScene,
    activeAssets(),
    now,
  )
  renderStageCanvas(runtimeScene)
}
function updatePlaytestOption(name, value) {
  editorState.playtest.options = { ...editorState.playtest.options, [name]: value }
  const runtime = editorState.playtest.runtime
  if (runtime) {
    if (name === 'cameraZoom') runtime.camera = { ...runtime.camera, zoom: positiveNumber(value, runtime.camera?.zoom ?? 1) }
    else runtime.options = { ...runtime.options, [name]: value }
  }
  renderAll()
}
function resetPlaytestOptions() {
  editorState.playtest.options = {
    ...DEFAULT_PLAYTEST_OPTIONS,
    cameraZoom: null,
  }
  if (editorState.playtest.runtime) {
    const runtimeScene = editorState.project?.scenes?.[editorState.playtest.runtime?.activeSceneId] ?? activeScene()
    editorState.playtest.runtime.options = { ...DEFAULT_PLAYTEST_OPTIONS }
    editorState.playtest.runtime.camera = {
      ...editorState.playtest.runtime.camera,
      zoom: positiveNumber(runtimeScene?.camera?.zoom, 1),
    }
  }
  renderAll()
}
function renderPlaytestPanel() {
  return renderPlaytestControls({
    project: editorState.project,
    scene: activeScene(),
    assets: activeAssets(),
    playtest: editorState.playtest,
    sceneRender: editorState.sceneRender,
    selectedLayerId: editorState.selectedLayerId,
    onPlayerLayerChange: (value) => {
      editorState.playtest.playerLayerId = value
      resetPlaytestPointFromLayer(sceneLayers().find((layer) => layer.id === value))
      renderAll()
    },
    onOptionChange: updatePlaytestOption,
    onStart: startPlaytest,
    onStop: () => stopPlaytest(),
    onResetOptions: resetPlaytestOptions,
    interaction: {
      eventType: editorState.playtest.eventType,
      key: editorState.playtest.key,
      onEventTypeChange: (value) => {
        editorState.playtest.eventType = value
        renderAll()
      },
      onKeyChange: (value) => {
        editorState.playtest.key = value || 'KeyE'
        renderAll()
      },
      onTrigger: () => triggerPlaytest(),
      onAuto: () => triggerPlaytest('auto'),
      onState: () => triggerPlaytest('state'),
    },
  })
}
function activateScene(sceneId) {
  const project = editorState.project
  if (!project?.scenes?.[sceneId]) return
  stopPlaytest({ render: false })
  editorState.project = {
    ...project,
    active_scene_id: sceneId,
  }
  editorState.selectedAssetId = null
  editorState.selectedLayerId = null
  ensureSceneHistory(project.scenes[sceneId])
  refreshSceneRenderAssets()
  addEditorLog(`Scene selected: ${sceneId}`)
  renderAll()
}
function flowSceneOptions(project = editorState.project) {
  return Object.values(project?.scenes ?? {}).map((scene) => ({
    value: scene.id,
    label: scene.name ? `${scene.name} (${scene.id})` : scene.id,
  }))
}
function flowNodePatch(node, patch) {
  return {
    x: patch.x ?? node.x,
    y: patch.y ?? node.y,
    w: patch.w ?? node.w,
    h: patch.h ?? node.h,
  }
}
function updateFlowNode(sceneId, patch, label = 'Scene flow layout changed') {
  const project = editorState.project
  if (!project) return
  replaceProjectDraft(updateSceneFlowNode(project, sceneId, patch), label)
}
function duplicateFlowScene(sceneId) {
  const project = editorState.project
  if (!project?.scenes?.[sceneId]) return
  replaceProjectDraft(duplicateScene(project, sceneId), 'Scene duplicated')
}
function copyFlowScene(sceneId) {
  const project = editorState.project
  if (!project?.scenes?.[sceneId]) return
  editorState.sceneClipboard = copySceneForClipboard(project, sceneId)
  addEditorLog(`Scene copied: ${sceneId}`)
  renderAll()
}
function pasteFlowScene() {
  const project = editorState.project
  if (!project || !editorState.sceneClipboard) return
  replaceProjectDraft(pasteSceneFromClipboard(project, editorState.sceneClipboard), 'Scene pasted')
}
function createFlowScene() {
  const project = editorState.project
  if (!project) return
  replaceProjectDraft(createBlankSceneInProject(project), 'Scene created')
}
function normalizeFlowLayout() {
  const project = editorState.project
  if (!project) return
  replaceProjectDraft(normalizeSceneFlowLayout(project), 'Scene flow normalized')
}
function addFlowLink(fromSceneId, toSceneId, label = '') {
  const project = editorState.project
  if (!project || !fromSceneId || !toSceneId) return
  replaceProjectDraft(addSceneFlowLink(project, { fromSceneId, toSceneId, label }), 'Scene flow link added')
}
function removeFlowLink(linkId) {
  const project = editorState.project
  if (!project) return
  replaceProjectDraft(removeSceneFlowLink(project, linkId), 'Scene flow link removed')
}
function renderFlowLinkLine(board, link) {
  const from = board.cards.find((card) => card.id === link.from_scene_id)
  const to = board.cards.find((card) => card.id === link.to_scene_id)
  if (!from || !to) return null
  const start = {
    x: from.node.x + from.node.w / 2,
    y: from.node.y + from.node.h / 2,
  }
  const end = {
    x: to.node.x + to.node.w / 2,
    y: to.node.y + to.node.h / 2,
  }
  const dx = end.x - start.x
  const dy = end.y - start.y
  const line = document.createElement('div')
  line.className = 'editor-flow-link-line'
  line.style.left = `${start.x}px`
  line.style.top = `${start.y}px`
  line.style.width = `${Math.max(1, Math.hypot(dx, dy))}px`
  line.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`
  return line
}
function renderFlowCard(card) {
  const article = document.createElement('article')
  article.className = 'editor-flow-card'
  article.dataset.active = String(card.active)
  article.dataset.status = card.validation.status
  article.style.left = `${card.node.x}px`
  article.style.top = `${card.node.y}px`
  article.style.width = `${card.node.w}px`
  article.style.minHeight = `${card.node.h}px`
  const title = document.createElement('div')
  title.className = 'editor-flow-card-title'
  const name = document.createElement('strong')
  name.textContent = card.name
  const badge = document.createElement('span')
  badge.className = `editor-flow-badge ${card.validation.status}`
  badge.textContent = card.validation.status
  title.append(name, badge)
  const stats = document.createElement('div')
  stats.className = 'editor-flow-stats'
  stats.append(
    keyValue('id', card.id),
    keyValue('layers', card.layer_count),
    keyValue('entities', card.entity_count),
    keyValue('links', `${card.incoming_count} in / ${card.outgoing_count} out`),
  )
  const layout = document.createElement('div')
  layout.className = 'editor-flow-card-layout'
  layout.append(
    numberControl('x', card.node.x, {
      step: 1,
      onChange: (value) => updateFlowNode(card.id, flowNodePatch(card.node, { x: Math.round(value || 0) })),
    }),
    numberControl('y', card.node.y, {
      step: 1,
      onChange: (value) => updateFlowNode(card.id, flowNodePatch(card.node, { y: Math.round(value || 0) })),
    }),
    numberControl('w', card.node.w, {
      min: 160,
      step: 1,
      onChange: (value) => updateFlowNode(card.id, flowNodePatch(card.node, { w: Math.max(160, Math.round(value || card.node.w)) })),
    }),
    numberControl('h', card.node.h, {
      min: 120,
      step: 1,
      onChange: (value) => updateFlowNode(card.id, flowNodePatch(card.node, { h: Math.max(120, Math.round(value || card.node.h)) })),
    }),
  )
  const actions = document.createElement('div')
  actions.className = 'editor-row-actions'
  const open = button('Open', 'secondary')
  open.addEventListener('click', () => activateScene(card.id))
  const duplicate = button('Duplicate', 'secondary')
  duplicate.addEventListener('click', () => duplicateFlowScene(card.id))
  const copy = button('Copy', 'secondary')
  copy.addEventListener('click', () => copyFlowScene(card.id))
  const nudge = button('Nudge', 'secondary')
  nudge.addEventListener('click', () => updateFlowNode(card.id, flowNodePatch(card.node, { x: card.node.x + 32, y: card.node.y + 24 })))
  actions.append(open, duplicate, copy, nudge)
  if (card.validation.blocking_errors.length) {
    const errors = document.createElement('div')
    errors.className = 'editor-flow-card-errors'
    errors.textContent = card.validation.blocking_errors.slice(0, 3).join(', ')
    article.append(title, stats, errors, layout, actions)
    return article
  }
  article.append(title, stats, layout, actions)
  return article
}
function renderFlowDiagnostics(diagnostics) {
  const wrap = document.createElement('div')
  wrap.className = 'editor-flow-diagnostics'
  if (!diagnostics.warning_count) {
    const clean = document.createElement('div')
    clean.className = 'editor-empty-line'
    clean.textContent = 'No scene flow warnings'
    wrap.append(clean)
    return wrap
  }
  const addWarning = (label, value) => {
    if (!value) return
    wrap.append(keyValue(label, value))
  }
  addWarning('missing cards', diagnostics.missing_node_scene_ids.join(', '))
  addWarning('orphan cards', diagnostics.orphan_node_ids.join(', '))
  addWarning('broken links', diagnostics.broken_links.map((link) => link.id).join(', '))
  addWarning('duplicate link ids', diagnostics.duplicate_link_ids.join(', '))
  for (const link of diagnostics.untracked_interaction_links) {
    const row = document.createElement('div')
    row.className = 'editor-flow-warning-row'
    row.append(keyValue('untracked scene_link', `${link.from_scene_id} -> ${link.to_scene_id} / ${link.owner_type}:${link.owner_id}`))
    const track = button('Track', 'secondary')
    track.addEventListener('click', () => addFlowLink(link.from_scene_id, link.to_scene_id, `${link.owner_type}:${link.owner_id}`))
    row.append(track)
    wrap.append(row)
  }
  return wrap
}
function renderSceneFlowPanel() {
  const wrap = document.createElement('div')
  wrap.className = 'editor-flow'
  const project = editorState.project
  if (!project) {
    const empty = document.createElement('div')
    empty.className = 'editor-empty-line'
    empty.textContent = 'No project loaded'
    wrap.append(empty)
    return wrap
  }
  const board = buildSceneFlowBoard(project)
  const sceneOptions = flowSceneOptions(project)
  const fromSceneId = editorState.flow.linkFromSceneId || project.active_scene_id || sceneOptions[0]?.value || ''
  const toSceneId = editorState.flow.linkToSceneId || sceneOptions.find((option) => option.value !== fromSceneId)?.value || sceneOptions[0]?.value || ''
  const toolbar = document.createElement('div')
  toolbar.className = 'editor-flow-toolbar'
  toolbar.append(
    selectControl('from', fromSceneId, sceneOptions, {
      onChange: (value) => {
        editorState.flow.linkFromSceneId = value
        renderAll()
      },
    }),
    selectControl('to', toSceneId, sceneOptions, {
      onChange: (value) => {
        editorState.flow.linkToSceneId = value
        renderAll()
      },
    }),
    textControl('label', editorState.flow.linkLabel, {
      placeholder: 'Door',
      onChange: (value) => {
        editorState.flow.linkLabel = value
      },
    }),
  )
  const toolbarActions = document.createElement('div')
  toolbarActions.className = 'editor-row-actions'
  const addScene = button('New Scene', 'secondary')
  addScene.addEventListener('click', createFlowScene)
  const paste = button('Paste Scene', 'secondary', !editorState.sceneClipboard)
  paste.addEventListener('click', pasteFlowScene)
  const addLink = button('Add Link', '', !fromSceneId || !toSceneId)
  addLink.addEventListener('click', () => addFlowLink(fromSceneId, toSceneId, editorState.flow.linkLabel.trim()))
  const normalize = button('Repair Layout', 'secondary', !board.diagnostics.warning_count)
  normalize.addEventListener('click', normalizeFlowLayout)
  toolbarActions.append(addScene, paste, addLink, normalize)
  toolbar.append(toolbarActions)
  wrap.append(toolbar)
  const boardNode = document.createElement('div')
  boardNode.className = 'editor-flow-board'
  for (const link of board.links) {
    const line = renderFlowLinkLine(board, link)
    if (line) boardNode.append(line)
  }
  for (const card of board.cards) boardNode.append(renderFlowCard(card))
  wrap.append(boardNode)
  const linkList = document.createElement('div')
  linkList.className = 'editor-flow-links'
  if (!board.links.length) {
    const empty = document.createElement('div')
    empty.className = 'editor-empty-line'
    empty.textContent = 'No explicit scene links'
    linkList.append(empty)
  }
  for (const link of board.links) {
    const row = document.createElement('div')
    row.className = 'editor-flow-link-row'
    row.append(keyValue(link.label || link.id, `${link.from_scene_id} -> ${link.to_scene_id}`))
    const remove = button('Remove', 'secondary')
    remove.addEventListener('click', () => removeFlowLink(link.id))
    row.append(remove)
    linkList.append(row)
  }
  wrap.append(linkList, renderFlowDiagnostics(board.diagnostics))
  return wrap
}
function renderLogPanel() {
  const wrap = document.createElement('div')
  wrap.className = 'editor-log-list'
  if (!editorState.log.length) {
    const empty = document.createElement('div')
    empty.className = 'editor-empty-line'
    empty.textContent = 'No events'
    wrap.append(empty)
    return wrap
  }
  for (const item of editorState.log) {
    wrap.append(keyValue(item.time, item.message))
  }
  return wrap
}
function renderBottomPanel() {
  document.querySelectorAll('[data-editor-panel]').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.editorPanel === editorState.activePanel)
  })
  const scene = activeScene()
  const body = $('#editor-panel-body')
  if (editorState.activePanel === 'repair') {
    elements.main.dataset.workspaceMode = 'repair'
    elements.stagePanel.dataset.workspaceMode = 'repair'
    previousBottomPanel = 'repair'
    renderRepairPanel()
    return
  }
  if (previousBottomPanel === 'repair') closeRepairSession('panel_switch')
  previousBottomPanel = editorState.activePanel
  delete elements.main.dataset.workspaceMode
  delete elements.stagePanel.dataset.workspaceMode
  const panels = {
    layers: () => renderLayersPanel(scene),
    timeline: renderTimelinePanel,
    flow: renderSceneFlowPanel,
    playtest: renderPlaytestPanel,
    export: () => renderExportPanel({
      exportCurrentProjectPack,
      runAction,
      renderAll,
    }),
    quality: renderQualityPanel,
    logs: renderLogPanel,
  }
  body.replaceChildren((panels[editorState.activePanel] ?? panels.layers)())
}
function renderInspector() {
  const node = $('#editor-inspector')
  node.replaceChildren()
  const project = editorState.project
  if (!project) {
    node.append(keyValue('Project', 'not loaded'))
    return
  }
  const layer = selectedLayer()
  if (layer) {
    renderLayerInspector(node, layer)
    return
  }
  const asset = project.assets?.[editorState.selectedAssetId]
  if (asset) {
    const revision = assetRevision(asset)
    const entry = buildAssetLibraryEntry(project, asset)
    node.append(
      keyValue('Asset', asset.name),
      keyValue('Kind', asset.kind),
      keyValue('Profile', asset.profile),
      keyValue('Revision', asset.active_revision_id),
      keyValue('Quality', revision?.quality_status),
      keyValue('Production', revision?.production_status),
      keyValue('Source job', revision?.source_job_id),
      keyValue('Provenance', assetProvenanceLabel(entry.provenance)),
      keyValue('Used scenes', entry.usage.scene_count),
      keyValue('Used layers', entry.usage.layer_count),
      keyValue('Clip count', entry.clip_count),
      keyValue('Export', 'Coming later'),
    )
    if (entry.usage.usages.length) {
      const usageHead = document.createElement('div')
      usageHead.className = 'editor-inspector-subhead'
      usageHead.textContent = 'Asset Usage'
      const usageList = document.createElement('div')
      usageList.className = 'editor-artifact-list'
      for (const usage of entry.usage.usages) {
        usageList.append(keyValue(usage.scene_name, `${usage.layer_name} / ${usage.layer_type}`))
      }
      node.append(usageHead, usageList)
    }
    const artifacts = document.createElement('div')
    artifacts.className = 'editor-artifact-list'
    for (const [key, value] of Object.entries(revision?.artifacts ?? {})) {
      artifacts.append(keyValue(key, value))
    }
    node.append(artifacts)
    return
  }
  const scene = activeScene()
  const layers = Array.isArray(scene?.layers) ? scene.layers : []
  node.append(
    keyValue('Project', project.name),
    keyValue('Revision', project.revision),
    keyValue('Active scene', project.active_scene_id),
    keyValue('Scene size', scene ? `${scene.world.w} x ${scene.world.h}` : '-'),
    keyValue('Assets', Object.keys(project.assets ?? {}).length),
    keyValue('Layers', layers.length),
    keyValue('Export pack', editorState.exportPack.message || editorState.exportPack.status),
  )
  if (editorState.exportPack.result?.urls) {
    node.append(linkList([
      ['manifest', editorState.exportPack.result.urls.manifest_url],
      ['validation', editorState.exportPack.result.urls.validation_url],
      ['asset refs', editorState.exportPack.result.urls.asset_references_url],
      ['engine payloads', editorState.exportPack.result.urls.engine_payloads_url],
      ['zip', editorState.exportPack.result.urls.zip_url],
    ]))
  }
}
function syncControls() {
  const project = editorState.project
  const sceneSelect = $('#editor-scene-select')
  const history = historyState()
  sceneSelect.replaceChildren()
  $('#editor-save-project').disabled = !project
  $('#editor-autosave-project').disabled = !project
  $('#editor-export-project-pack').disabled = !project || editorState.exportPack.status === 'running'
  $('#editor-undo-project').disabled = !project || !history.canUndo
  $('#editor-redo-project').disabled = !project || !history.canRedo
  $('#editor-import-job').disabled = !project || !$('#editor-import-job-id').value.trim()
  const playbackToggle = $('#editor-playback-toggle')
  const previewActive = Boolean(editorState.animationRuntime?.playing)
  playbackToggle.disabled = editorState.playtest.running || !project || !hasPlayableLayers()
  playbackToggle.textContent = previewActive ? 'Pause Preview' : 'Preview'
  playbackToggle.classList.toggle('active', previewActive)
  playbackToggle.setAttribute('aria-pressed', String(previewActive))
  $('#editor-toggle-grid').classList.toggle('active', editorState.stage.gridVisible)
  $('#editor-toggle-grid').setAttribute('aria-pressed', String(editorState.stage.gridVisible))
  $('#editor-toggle-grid').disabled = editorState.playtest.running
  $('#editor-toggle-snap').classList.toggle('active', editorState.stage.snapEnabled)
  $('#editor-toggle-snap').setAttribute('aria-pressed', String(editorState.stage.snapEnabled))
  $('#editor-toggle-snap').disabled = editorState.playtest.running
  $('#editor-snap-size').disabled = editorState.playtest.running
  $('#editor-snap-size').value = String(editorState.stage.snapSize)
  if (project) {
    $('#editor-project-id').value = project.id
    $('#editor-project-name').value = project.name
    const scenes = Object.values(project.scenes ?? {})
    for (const scene of scenes) {
      const option = document.createElement('option')
      option.value = scene.id
      option.textContent = scene.name
      sceneSelect.append(option)
    }
    sceneSelect.value = project.active_scene_id
    sceneSelect.disabled = scenes.length < 2
  } else {
    const option = document.createElement('option')
    option.value = ''
    option.textContent = 'No project'
    sceneSelect.append(option)
    sceneSelect.disabled = true
  }
}
function renderAll() {
  syncRuntimeClocks()
  syncControls()
  renderAssetList()
  renderStage()
  renderBottomPanel()
  renderInspector()
  scheduleAnimationTick()
}
async function runAction(label, action) {
  setStatus('busy', 'working')
  try {
    const result = await action()
    addEditorLog(label)
    setStatus('ready', 'ready')
    toast(label)
    renderAll()
    return result
  } catch (error) {
    addEditorLog(error.message || String(error))
    setStatus('error', 'error')
    toast(error.message || String(error))
    renderAll()
    return null
  }
}
function safeEditorId(value, fallback = 'item') {
  const safe = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, '_')
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')
  if (!safe) return fallback
  return /^[a-z0-9]/.test(safe) ? safe : `${fallback}_${safe}`
}
function safeObjectId(value, fallback = 'item') {
  const safe = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')
  if (!safe) return fallback
  return /^[a-z0-9]/.test(safe) ? safe : `${fallback}_${safe}`
}
function clipOptions(asset) {
  return Object.values(asset?.clips ?? {}).map((clip) => ({
    value: clip.id,
    label: `${clip.id} / ${clip.frames?.length ?? 0} frames`,
  }))
}
function commitLayerPlaybackUpdate(layerId, updater, label, { resetClock = false } = {}) {
  const nextLayer = commitLayerUpdate(layerId, (draft) => {
    const asset = activeAssets()[draft.asset_id]
    const clip = asset?.clips?.[draft.clip_id]
    const playback = normalizedPlayback(draft, clip)
    const nextPlayback = typeof updater === 'function'
      ? updater(playback, draft, asset)
      : { ...playback, ...updater }
    return {
      ...draft,
      playback: nextPlayback,
    }
  }, label)
  if (resetClock && nextLayer) {
    const asset = activeAssets()[nextLayer.asset_id]
    const frameState = frameStateForLayer(editorState.animationRuntime, nextLayer, asset)
    editorState.animationRuntime = resetLayerElapsed(editorState.animationRuntime, layerId, frameState.playback)
    renderAll()
  }
}
function firstClipId(asset) {
  return Object.keys(asset?.clips ?? {})[0] ?? ''
}
function sceneLayerOptions(scene, { includeEmpty = false } = {}) {
  const options = (scene?.layers ?? []).map((layer) => ({
    value: layer.id,
    label: layer.name ? `${layer.name} (${layer.id})` : layer.id,
  }))
  return includeEmpty ? [{ value: '', label: '-' }, ...options] : options
}
function sceneOptions(project, { excludeSceneId = null } = {}) {
  return Object.values(project?.scenes ?? {})
    .filter((scene) => scene.id !== excludeSceneId)
    .map((scene) => ({
      value: scene.id,
      label: scene.name ? `${scene.name} (${scene.id})` : scene.id,
    }))
}
function spawnOptions(scene) {
  return (scene?.entities ?? [])
    .filter((entity) => entity.type === 'spawn_point')
    .map((entity) => ({
      value: entity.id,
      label: entity.id,
    }))
}
function defaultInteractionForLayer(layer) {
  return createInteractionDocument({
    enabled: true,
    trigger: {
      type: 'near_key',
      key: 'KeyE',
      radius: 96,
      zone: { coordinate_space: 'owner_local', x: -32, y: -48, w: 64, h: 64 },
    },
    actions: [
      { type: 'show_text', text: `${layer.name ?? layer.id} triggered`, duration_ms: 1600 },
    ],
  })
}
function normalizedInteraction(layer) {
  return layer?.interaction ?? defaultInteractionForLayer(layer)
}
function commitLayerInteractionUpdate(layerId, updater, label) {
  return commitLayerUpdate(layerId, (draft) => {
    const current = normalizedInteraction(draft)
    const interaction = typeof updater === 'function'
      ? updater(clone(current), draft)
      : { ...current, ...clone(updater) }
    return {
      ...draft,
      interaction,
    }
  }, label, { allowLocked: true })
}
function actionTemplate(type, layer, scene, project) {
  const asset = project?.assets?.[layer.asset_id]
  if (type === 'show_text') return { type, text: 'Hello', duration_ms: 1600 }
  if (type === 'play_animation') return { type, target_layer_id: layer.id, clip_id: layer.clip_id ?? firstClipId(asset), restart: true }
  if (type === 'toggle_layer') return { type, target_layer_id: layer.id, visible: !layer.visible }
  if (type === 'set_state') return { type, key: safeEditorId(`${layer.id}_state`, 'state'), value: true }
  if (type === 'pickup_item') return { type, item_id: safeObjectId(layer.name ?? layer.id, 'item'), quantity: 1, hide_layer_id: layer.id }
  if (type === 'scene_link') {
    const targetScene = sceneOptions(project, { excludeSceneId: scene?.id })[0]
    const targetSpawn = targetScene ? spawnOptions(project.scenes[targetScene.value])[0] : null
    return { type, target_scene_id: targetScene?.value ?? '', target_spawn_id: targetSpawn?.value ?? '' }
  }
  return { type }
}
function canAddActionType(type, layer, scene, project) {
  if (type === 'play_animation') return Boolean(firstClipId(project?.assets?.[layer.asset_id]))
  if (type === 'scene_link') {
    return sceneOptions(project, { excludeSceneId: scene?.id })
      .some((option) => spawnOptions(project.scenes[option.value]).length > 0)
  }
  return true
}
function replaceInteractionAction(layerId, index, updater) {
  commitLayerInteractionUpdate(layerId, (interaction) => {
    interaction.actions = (interaction.actions ?? []).map((action, actionIndex) => {
      if (actionIndex !== index) return action
      return typeof updater === 'function' ? updater(clone(action)) : { ...action, ...clone(updater) }
    })
    return interaction
  }, 'Interaction action changed')
}
function removeInteractionAction(layerId, index) {
  commitLayerInteractionUpdate(layerId, (interaction) => {
    interaction.actions = (interaction.actions ?? []).filter((_, actionIndex) => actionIndex !== index)
    return interaction
  }, 'Interaction action removed')
}
function moveInteractionAction(layerId, index, direction) {
  commitLayerInteractionUpdate(layerId, (interaction) => {
    const actions = [...(interaction.actions ?? [])]
    const target = index + direction
    if (target < 0 || target >= actions.length) return interaction
    const [action] = actions.splice(index, 1)
    actions.splice(target, 0, action)
    interaction.actions = actions
    return interaction
  }, 'Interaction action reordered')
}
function renderInteractionActionFields(wrap, layer, action, index, scene, project, disabled) {
  if (action.type === 'show_text') {
    wrap.append(
      textControl('text', action.text, {
        disabled,
        onChange: (value) => replaceInteractionAction(layer.id, index, { text: value || 'Hello' }),
      }),
      numberControl('duration ms', action.duration_ms ?? 1600, {
        min: 0,
        step: 100,
        disabled,
        onChange: (value) => replaceInteractionAction(layer.id, index, { duration_ms: Math.max(0, Math.round(value || 0)) }),
      }),
    )
  }
  if (action.type === 'play_animation') {
    const targetLayer = sceneLayers(scene).find((item) => item.id === action.target_layer_id) ?? layer
    const targetAsset = project?.assets?.[targetLayer.asset_id]
    const clips = clipOptions(targetAsset)
    wrap.append(
      selectControl('target layer', action.target_layer_id, sceneLayerOptions(scene), {
        disabled,
        onChange: (value) => {
          const nextLayer = sceneLayers(scene).find((item) => item.id === value)
          const nextAsset = project?.assets?.[nextLayer?.asset_id]
          replaceInteractionAction(layer.id, index, { target_layer_id: value, clip_id: firstClipId(nextAsset), restart: true })
        },
      }),
      selectControl('clip', action.clip_id, clips.length ? clips : [{ value: '', label: '-' }], {
        disabled: disabled || !clips.length,
        onChange: (value) => replaceInteractionAction(layer.id, index, { clip_id: value }),
      }),
      checkboxControl('restart', action.restart, {
        disabled,
        onChange: (value) => replaceInteractionAction(layer.id, index, { restart: value }),
      }),
    )
  }
  if (action.type === 'toggle_layer') {
    wrap.append(
      selectControl('target layer', action.target_layer_id, sceneLayerOptions(scene), {
        disabled,
        onChange: (value) => replaceInteractionAction(layer.id, index, { target_layer_id: value }),
      }),
      checkboxControl('visible', action.visible, {
        disabled,
        onChange: (value) => replaceInteractionAction(layer.id, index, { visible: value }),
      }),
    )
  }
  if (action.type === 'set_state') {
    wrap.append(
      textControl('state key', action.key, {
        disabled,
        placeholder: 'door_open',
        onChange: (value) => replaceInteractionAction(layer.id, index, { key: safeEditorId(value, 'state') }),
      }),
      selectControl('value', String(Boolean(action.value)), ['true', 'false'], {
        disabled,
        onChange: (value) => replaceInteractionAction(layer.id, index, { value: value === 'true' }),
      }),
    )
  }
  if (action.type === 'pickup_item') {
    wrap.append(
      textControl('item id', action.item_id, {
        disabled,
        onChange: (value) => replaceInteractionAction(layer.id, index, { item_id: safeObjectId(value, 'item') }),
      }),
      numberControl('quantity', action.quantity ?? 1, {
        min: 1,
        step: 1,
        disabled,
        onChange: (value) => replaceInteractionAction(layer.id, index, { quantity: Math.max(1, Math.round(value || 1)) }),
      }),
      selectControl('hide layer', action.hide_layer_id ?? '', sceneLayerOptions(scene, { includeEmpty: true }), {
        disabled,
        onChange: (value) => replaceInteractionAction(layer.id, index, value ? { hide_layer_id: value } : { hide_layer_id: null }),
      }),
    )
  }
  if (action.type === 'scene_link') {
    const targets = sceneOptions(project, { excludeSceneId: scene?.id })
    const targetSceneId = action.target_scene_id || targets[0]?.value || ''
    const spawns = targetSceneId ? spawnOptions(project?.scenes?.[targetSceneId]) : []
    wrap.append(
      selectControl('target scene', targetSceneId, targets.length ? targets : [{ value: '', label: '-' }], {
        disabled: disabled || !targets.length,
        onChange: (value) => {
          const nextSpawn = spawnOptions(project.scenes[value])[0]
          replaceInteractionAction(layer.id, index, { target_scene_id: value, target_spawn_id: nextSpawn?.value ?? '' })
        },
      }),
      selectControl('target spawn', action.target_spawn_id, spawns.length ? spawns : [{ value: '', label: '-' }], {
        disabled: disabled || !spawns.length,
        onChange: (value) => replaceInteractionAction(layer.id, index, { target_spawn_id: value }),
      }),
    )
  }
}
function renderLayerInteractionInspector(node, layer, asset, scene, locked) {
  const interaction = normalizedInteraction(layer)
  const disabled = Boolean(locked)
  const head = document.createElement('div')
  head.className = 'editor-inspector-subhead'
  head.textContent = 'Interaction'
  const form = document.createElement('div')
  form.className = 'editor-inspector-form editor-interaction-fields'
  form.append(
    checkboxControl('enabled', interaction.enabled, {
      disabled,
      onChange: (value) => commitLayerInteractionUpdate(layer.id, (draft) => ({ ...draft, enabled: value }), 'Interaction enabled changed'),
    }),
    selectControl('trigger', interaction.trigger?.type ?? 'near_key', TRIGGER_TYPES, {
      disabled,
      onChange: (value) => commitLayerInteractionUpdate(layer.id, (draft) => ({
        ...draft,
        trigger: {
          ...draft.trigger,
          type: value,
          ...(value === 'near_key' && !draft.trigger?.key ? { key: 'KeyE' } : {}),
        },
      }), 'Interaction trigger changed'),
    }),
    textControl('key', interaction.trigger?.key ?? 'KeyE', {
      disabled: disabled || interaction.trigger?.type !== 'near_key',
      onChange: (value) => commitLayerInteractionUpdate(layer.id, (draft) => ({
        ...draft,
        trigger: { ...draft.trigger, key: value || 'KeyE' },
      }), 'Interaction key changed'),
    }),
    numberControl('radius', interaction.trigger?.radius ?? 96, {
      min: 0,
      step: 8,
      disabled: disabled || !['near_click', 'near_key'].includes(interaction.trigger?.type),
      onChange: (value) => commitLayerInteractionUpdate(layer.id, (draft) => ({
        ...draft,
        trigger: { ...draft.trigger, radius: Math.max(0, Math.round(value || 0)) },
      }), 'Interaction radius changed'),
    }),
    textControl('condition key', interaction.trigger?.condition?.state_key ?? '', {
      disabled,
      placeholder: 'optional',
      onChange: (value) => commitLayerInteractionUpdate(layer.id, (draft) => {
        const trigger = { ...draft.trigger }
        if (value) trigger.condition = { state_key: safeEditorId(value, 'state'), equals: trigger.condition?.equals ?? true }
        else delete trigger.condition
        return { ...draft, trigger }
      }, 'Interaction condition changed'),
    }),
    selectControl('condition equals', String(interaction.trigger?.condition?.equals ?? true), ['true', 'false'], {
      disabled: disabled || !interaction.trigger?.condition?.state_key,
      onChange: (value) => commitLayerInteractionUpdate(layer.id, (draft) => ({
        ...draft,
        trigger: {
          ...draft.trigger,
          condition: {
            state_key: draft.trigger?.condition?.state_key ?? 'state',
            equals: value === 'true',
          },
        },
      }), 'Interaction condition changed'),
    }),
    selectControl('zone space', interaction.trigger?.zone?.coordinate_space ?? 'owner_local', ZONE_COORDINATE_SPACES, {
      disabled,
      onChange: (value) => commitLayerInteractionUpdate(layer.id, (draft) => ({
        ...draft,
        trigger: {
          ...draft.trigger,
          zone: { ...(draft.trigger?.zone ?? { x: -32, y: -48, w: 64, h: 64 }), coordinate_space: value },
        },
      }), 'Interaction zone changed'),
    }),
    numberControl('zone x', interaction.trigger?.zone?.x ?? -32, {
      step: 1,
      disabled,
      onChange: (value) => commitLayerInteractionUpdate(layer.id, (draft) => ({
        ...draft,
        trigger: { ...draft.trigger, zone: { ...(draft.trigger?.zone ?? {}), coordinate_space: draft.trigger?.zone?.coordinate_space ?? 'owner_local', x: Math.round(value || 0), y: draft.trigger?.zone?.y ?? -48, w: draft.trigger?.zone?.w ?? 64, h: draft.trigger?.zone?.h ?? 64 } },
      }), 'Interaction zone changed'),
    }),
    numberControl('zone y', interaction.trigger?.zone?.y ?? -48, {
      step: 1,
      disabled,
      onChange: (value) => commitLayerInteractionUpdate(layer.id, (draft) => ({
        ...draft,
        trigger: { ...draft.trigger, zone: { ...(draft.trigger?.zone ?? {}), coordinate_space: draft.trigger?.zone?.coordinate_space ?? 'owner_local', x: draft.trigger?.zone?.x ?? -32, y: Math.round(value || 0), w: draft.trigger?.zone?.w ?? 64, h: draft.trigger?.zone?.h ?? 64 } },
      }), 'Interaction zone changed'),
    }),
    numberControl('zone w', interaction.trigger?.zone?.w ?? 64, {
      min: 1,
      step: 1,
      disabled,
      onChange: (value) => commitLayerInteractionUpdate(layer.id, (draft) => ({
        ...draft,
        trigger: { ...draft.trigger, zone: { ...(draft.trigger?.zone ?? {}), coordinate_space: draft.trigger?.zone?.coordinate_space ?? 'owner_local', x: draft.trigger?.zone?.x ?? -32, y: draft.trigger?.zone?.y ?? -48, w: Math.max(1, Math.round(value || 1)), h: draft.trigger?.zone?.h ?? 64 } },
      }), 'Interaction zone changed'),
    }),
    numberControl('zone h', interaction.trigger?.zone?.h ?? 64, {
      min: 1,
      step: 1,
      disabled,
      onChange: (value) => commitLayerInteractionUpdate(layer.id, (draft) => ({
        ...draft,
        trigger: { ...draft.trigger, zone: { ...(draft.trigger?.zone ?? {}), coordinate_space: draft.trigger?.zone?.coordinate_space ?? 'owner_local', x: draft.trigger?.zone?.x ?? -32, y: draft.trigger?.zone?.y ?? -48, w: draft.trigger?.zone?.w ?? 64, h: Math.max(1, Math.round(value || 1)) } },
      }), 'Interaction zone changed'),
    }),
  )
  const actions = document.createElement('div')
  actions.className = 'editor-interaction-actions'
  const addRow = document.createElement('div')
  addRow.className = 'editor-row-actions'
  for (const type of ACTION_TYPES) {
    const canAdd = canAddActionType(type, layer, scene, editorState.project)
    const add = button(`Add ${type}`, 'secondary', disabled || !canAdd)
    add.addEventListener('click', () => {
      commitLayerInteractionUpdate(layer.id, (draft) => ({
        ...draft,
        actions: [...(draft.actions ?? []), actionTemplate(type, layer, scene, editorState.project)],
      }), 'Interaction action added')
    })
    addRow.append(add)
  }
  actions.append(addRow)
  for (const [index, action] of (interaction.actions ?? []).entries()) {
    const row = document.createElement('article')
    row.className = 'editor-interaction-action'
    const rowHead = document.createElement('div')
    rowHead.className = 'editor-interaction-action-head'
    rowHead.append(keyValue(`Action ${index + 1}`, action.type))
    const rowActions = document.createElement('div')
    rowActions.className = 'editor-row-actions'
    const up = button('Up', 'secondary', disabled || index === 0)
    up.addEventListener('click', () => moveInteractionAction(layer.id, index, -1))
    const down = button('Down', 'secondary', disabled || index === (interaction.actions?.length ?? 0) - 1)
    down.addEventListener('click', () => moveInteractionAction(layer.id, index, 1))
    const remove = button('Remove', 'secondary', disabled)
    remove.addEventListener('click', () => removeInteractionAction(layer.id, index))
    rowActions.append(up, down, remove)
    rowHead.append(rowActions)
    const fields = document.createElement('div')
    fields.className = 'editor-inspector-form editor-interaction-action-fields'
    fields.append(
      selectControl('type', action.type, ACTION_TYPES, {
        disabled,
        onChange: (value) => {
          if (!canAddActionType(value, layer, scene, editorState.project)) {
            toast(`${value} needs a valid target`)
            renderAll()
            return
          }
          replaceInteractionAction(layer.id, index, actionTemplate(value, layer, scene, editorState.project))
        },
      }),
    )
    renderInteractionActionFields(fields, layer, action, index, scene, editorState.project, disabled)
    row.append(rowHead, fields)
    actions.append(row)
  }
  node.append(head, form, actions)
}
function renderLayerInspector(node, layer) {
  const asset = editorState.project?.assets?.[layer.asset_id]
  const locked = Boolean(layer.locked)
  node.append(
    keyValue('Layer', layer.name ?? layer.id),
    keyValue('Type', layer.type),
    keyValue('Asset', asset?.name ?? layer.asset_id),
    keyValue('Coordinate space', layer.transform?.coordinate_space ?? 'world'),
  )
  const form = document.createElement('div')
  form.className = 'editor-inspector-form'
  form.append(
    checkboxControl('visible', layer.visible, {
      disabled: locked,
      onChange: (value) => commitLayerUpdate(layer.id, (draft) => ({ ...draft, visible: value }), 'Layer visibility changed'),
    }),
    checkboxControl('locked', layer.locked, {
      onChange: (value) => commitLayerUpdate(layer.id, (draft) => ({ ...draft, locked: value }), 'Layer lock changed', { allowLocked: true }),
    }),
    checkboxControl('flip x', layer.transform?.flip_x, {
      disabled: locked,
      onChange: (value) => commitLayerUpdate(layer.id, (draft) => ({
        ...draft,
        transform: { ...draft.transform, flip_x: value },
      }), 'Layer flip changed'),
    }),
    checkboxControl('flip y', layer.transform?.flip_y, {
      disabled: locked,
      onChange: (value) => commitLayerUpdate(layer.id, (draft) => ({
        ...draft,
        transform: { ...draft.transform, flip_y: value },
      }), 'Layer flip changed'),
    }),
    numberControl('x', layer.transform?.position?.x, {
      step: 1,
      disabled: locked,
      onChange: (value) => commitLayerPosition(layer.id, { x: value, y: layer.transform.position.y }),
    }),
    numberControl('y', layer.transform?.position?.y, {
      step: 1,
      disabled: locked,
      onChange: (value) => commitLayerPosition(layer.id, { x: layer.transform.position.x, y: value }),
    }),
    numberControl('scale x', layer.transform?.scale?.x, {
      min: 0.1,
      step: 0.1,
      disabled: locked,
      onChange: (value) => commitLayerUpdate(layer.id, (draft) => ({
        ...draft,
        transform: { ...draft.transform, scale: { ...draft.transform.scale, x: Math.max(0.1, value) } },
      }), 'Layer scale changed'),
    }),
    numberControl('scale y', layer.transform?.scale?.y, {
      min: 0.1,
      step: 0.1,
      disabled: locked,
      onChange: (value) => commitLayerUpdate(layer.id, (draft) => ({
        ...draft,
        transform: { ...draft.transform, scale: { ...draft.transform.scale, y: Math.max(0.1, value) } },
      }), 'Layer scale changed'),
    }),
    numberControl('z-index', layer.render?.z_index, {
      step: 1,
      disabled: locked,
      onChange: (value) => commitLayerUpdate(layer.id, (draft) => ({
        ...draft,
        render: { ...draft.render, z_index: Math.round(value) },
      }), 'Layer z-index changed'),
    }),
    rangeControl('opacity', layer.render?.opacity, {
      disabled: locked,
      onChange: (value) => commitLayerUpdate(layer.id, (draft) => ({
        ...draft,
        render: { ...draft.render, opacity: Math.max(0, Math.min(1, value)) },
      }), 'Layer opacity changed'),
    }),
    numberControl('parallax', layer.render?.parallax, {
      min: 0,
      step: 0.1,
      disabled: locked || layer.transform?.coordinate_space === 'viewport',
      onChange: (value) => commitLayerUpdate(layer.id, (draft) => ({
        ...draft,
        render: { ...draft.render, parallax: Math.max(0, value) },
      }), 'Layer parallax changed'),
    }),
  )
  node.append(form)
  renderLayerInteractionInspector(node, layer, asset, activeScene(), locked)
  const clips = Object.values(asset?.clips ?? {})
  if (!clips.length) return
  const selectedClipId = layer.clip_id ?? clips[0].id
  const selectedClip = asset.clips?.[selectedClipId] ?? clips[0]
  const playback = normalizedPlayback(layer, selectedClip)
  const playbackHead = document.createElement('div')
  playbackHead.className = 'editor-inspector-subhead'
  playbackHead.textContent = 'Playback'
  const playbackForm = document.createElement('div')
  playbackForm.className = 'editor-inspector-form editor-playback-fields'
  playbackForm.append(
    selectControl('clip', selectedClipId, clipOptions(asset), {
      disabled: locked || clips.length < 2,
      onChange: (value) => {
        const nextClip = asset.clips?.[value]
        const nextLayer = commitLayerUpdate(layer.id, (draft) => {
          const previous = normalizedPlayback(draft, nextClip)
          return {
            ...draft,
            clip_id: value,
            playback: {
              activation: previous.activation,
              loop_mode: nextClip?.loop_mode ?? previous.loop_mode,
              rate: previous.rate,
              start_offset_ms: 0,
              initially_paused: previous.initially_paused,
            },
          }
        }, 'Layer clip changed')
        if (nextLayer) {
          const frameState = frameStateForLayer(editorState.animationRuntime, nextLayer, asset)
          editorState.animationRuntime = resetLayerElapsed(editorState.animationRuntime, layer.id, frameState.playback)
          renderAll()
        }
      },
    }),
    selectControl('activation', playback.activation, PLAYBACK_ACTIVATIONS, {
      disabled: locked,
      onChange: (value) => commitLayerPlaybackUpdate(layer.id, { activation: value }, 'Layer playback activation changed'),
    }),
    selectControl('loop mode', playback.loop_mode, LOOP_MODES, {
      disabled: locked,
      onChange: (value) => commitLayerPlaybackUpdate(layer.id, { loop_mode: value }, 'Layer loop mode changed'),
    }),
    numberControl('rate', playback.rate, {
      min: 0.01,
      step: 0.1,
      disabled: locked,
      onChange: (value) => commitLayerPlaybackUpdate(layer.id, {
        rate: positiveNumber(value, playback.rate || 1),
      }, 'Layer playback rate changed'),
    }),
    numberControl('start offset ms', playback.start_offset_ms, {
      min: 0,
      step: 10,
      disabled: locked,
      onChange: (value) => commitLayerPlaybackUpdate(layer.id, {
        start_offset_ms: Math.max(0, Number.isFinite(value) ? value : playback.start_offset_ms ?? 0),
      }, 'Layer playback offset changed', { resetClock: true }),
    }),
    checkboxControl('initially paused', playback.initially_paused, {
      disabled: locked,
      onChange: (value) => commitLayerPlaybackUpdate(layer.id, {
        initially_paused: value,
      }, 'Layer initial playback state changed'),
    }),
  )
  node.append(playbackHead, playbackForm)
}
function commitLayerPosition(layerId, position) {
  const scene = activeScene()
  const layer = selectedLayer()
  if (!scene || !layer) return
  const nextPosition = clampPositionToScene(
    snapPoint(position, {
      enabled: editorState.stage.snapEnabled,
      snapSize: editorState.stage.snapSize,
    }),
    scene,
    layer,
  )
  commitLayerUpdate(layerId, (draft) => ({
    ...draft,
    transform: { ...draft.transform, position: nextPosition },
  }), 'Layer position changed', { groupKey: `position:${layerId}` })
}
function addAssetLayer(asset) {
  const scene = activeScene()
  if (!scene || !canAddAssetToScene(asset)) return
  const layer = createLayerFromAsset(asset, scene, { snapSize: editorState.stage.snapSize })
  if (!layer) return
  editorState.selectedAssetId = asset.id
  editorState.selectedLayerId = layer.id
  const nextScene = appendLayerToScene(scene, layer)
  replaceActiveScene(nextScene, { commit: true, groupKey: `add:${layer.id}` })
  editorState.activePanel = 'layers'
  addEditorLog(`Layer added: ${layer.id}`)
  renderAll()
}
function openRepairForAsset(asset) {
  if (asset?.kind !== 'character_pack') return
  addEditorLog(`Repair selected: ${asset.id}`)
  mountedRepairSelectionKey = null
  void ensureRepairController().openAsset(asset)
}
async function ensureSavedProjectForAssetWrite() {
  let project = editorState.project
  if (!project) throw new Error('No project loaded')
  const projectName = $('#editor-project-name').value.trim()
  const nameChanged = projectName && projectName !== project.name
  if (editorState.dirty || nameChanged) {
    project = await saveCurrentProject()
    if (!project) throw new Error('Project save failed')
  }
  return project
}
async function unlinkAssetUsage(asset) {
  if (!asset) return
  const entry = buildAssetLibraryEntry(editorState.project, asset)
  if (!entry.can_unlink) return
  const ok = window.confirm(`Remove ${entry.usage.layer_count} layer references to ${entry.name}?`)
  if (!ok) return
  await runAction('Asset unlinked from scenes', async () => {
    const project = await ensureSavedProjectForAssetWrite()
    const result = await unlinkEditorAsset({
      projectId: project.id,
      expectedRevision: project.revision,
      assetId: asset.id,
    })
    if (result?.project) {
      acceptProject(result.project)
      editorState.selectedAssetId = asset.id
      editorState.activePanel = 'layers'
    }
    return result
  })
}
async function deleteAssetRecord(asset) {
  if (!asset) return
  const entry = buildAssetLibraryEntry(editorState.project, asset)
  if (!entry.can_delete) return
  const ok = window.confirm(`Delete ${entry.name} from this project? Managed artifact files will remain on disk.`)
  if (!ok) return
  await runAction('Asset deleted', async () => {
    const project = await ensureSavedProjectForAssetWrite()
    const result = await deleteEditorAsset({
      projectId: project.id,
      expectedRevision: project.revision,
      assetId: asset.id,
    })
    if (result?.project) acceptProject(result.project)
    return result
  })
}
function reorderLayer(layerId, direction) {
  const scene = activeScene()
  if (!scene) return
  const layer = sceneLayers(scene).find((item) => item.id === layerId)
  if (layer?.locked) {
    toast('Layer is locked')
    return
  }
  const nextScene = moveSceneLayer(scene, layerId, direction)
  replaceActiveScene(nextScene, { commit: true, groupKey: `reorder:${layerId}:${direction}` })
  setSelectedLayer(layerId)
  addEditorLog('Layer reordered')
  renderAll()
}
function startLayerPointer(event, layerId, mode, view) {
  if (editorState.playtest.running) {
    toast('Stop playtest to edit layers')
    return
  }
  const scene = activeScene()
  const layer = sceneLayers(scene).find((item) => item.id === layerId)
  if (!scene || !layer) return
  setSelectedLayer(layerId)
  ensureSceneHistory(scene)
  if (layer.locked) {
    renderAll()
    return
  }
  event.preventDefault()
  editorState.drag = {
    layerId,
    mode,
    startX: event.clientX,
    startY: event.clientY,
    startLayer: clone(layer),
    viewScale: view.scale,
    groupKey: `${mode}:${layerId}:${Date.now()}`,
    moved: false,
  }
  renderAll()
}
function handlePointerMove(event) {
  const drag = editorState.drag
  if (!drag) return
  const scene = activeScene()
  const layer = sceneLayers(scene).find((item) => item.id === drag.layerId)
  if (!scene || !layer) return
  const zoom = layer.transform?.coordinate_space === 'world' ? scene.camera?.zoom ?? 1 : 1
  const denominator = Math.max(0.001, drag.viewScale * zoom)
  const dx = (event.clientX - drag.startX) / denominator
  const dy = (event.clientY - drag.startY) / denominator
  let nextScene = scene
  if (drag.mode === 'move') {
    const position = clampPositionToScene(snapPoint({
      x: drag.startLayer.transform.position.x + dx,
      y: drag.startLayer.transform.position.y + dy,
    }, {
      enabled: editorState.stage.snapEnabled,
      snapSize: editorState.stage.snapSize,
    }), scene, layer)
    nextScene = updateSceneLayer(scene, drag.layerId, (draft) => ({
      ...draft,
      transform: { ...draft.transform, position },
    }))
  }
  if (drag.mode === 'resize') {
    const delta = Math.max(dx, dy)
    const nextScale = Math.max(0.1, Math.round((drag.startLayer.transform.scale.x + delta / 96) * 10) / 10)
    nextScene = updateSceneLayer(scene, drag.layerId, (draft) => ({
      ...draft,
      transform: { ...draft.transform, scale: { x: nextScale, y: nextScale } },
    }))
  }
  drag.moved = true
  replaceActiveScene(nextScene)
  renderAll()
}
function handlePointerUp() {
  const drag = editorState.drag
  if (!drag) return
  editorState.drag = null
  if (drag.moved) {
    const scene = activeScene()
    replaceActiveScene(scene, { commit: true, groupKey: drag.groupKey })
    addEditorLog(drag.mode === 'resize' ? 'Layer resized' : 'Layer moved')
  }
  renderAll()
}
function handleLayerKeydown(event, layerId) {
  const step = event.shiftKey ? editorState.stage.snapSize : 1
  const deltas = {
    ArrowLeft: { x: -step, y: 0 },
    ArrowRight: { x: step, y: 0 },
    ArrowUp: { x: 0, y: -step },
    ArrowDown: { x: 0, y: step },
  }
  const delta = deltas[event.key]
  if (!delta) return
  event.preventDefault()
  const layer = sceneLayers().find((item) => item.id === layerId)
  if (!layer || layer.locked) return
  commitLayerPosition(layerId, {
    x: layer.transform.position.x + delta.x,
    y: layer.transform.position.y + delta.y,
  })
}
function currentProjectFields() {
  return {
    id: $('#editor-project-id').value.trim(),
    name: $('#editor-project-name').value.trim(),
  }
}
function ensureAiActionRepairWorkflow() {
  if (!aiActionRepairWorkflow) aiActionRepairWorkflow = createAiActionRepairWorkflow({
    state: editorState,
    getRepairContext: repairContext,
    getPreferredAction: preferredRepairAction,
    getBatchSelection: selectedBatchRepairSelection,
    getAssetRevision: assetRevision,
    saveProject: saveCurrentProject,
    adoptProject: acceptProject,
    render: renderAll,
    log: addEditorLog,
    confirm: (message) => window.confirm(message),
  })
  return aiActionRepairWorkflow
}
function planRepairAction() { return ensureAiActionRepairWorkflow().plan() }
function runRepairAction() { return ensureAiActionRepairWorkflow().run() }
function acceptRepairActionCandidate() { return ensureAiActionRepairWorkflow().accept() }
function cleanupEditorShell() {
  if (animationFrameRequest != null) {
    window.cancelAnimationFrame(animationFrameRequest)
    animationFrameRequest = null
  }
  unbindPlaytestInput?.()
  unbindPlaytestInput = null
  aiActionRepairWorkflow = null
  repairWorkbench?.destroy()
  repairWorkbench = null
  repairController?.dispose()
  repairController = null
  mountedRepairSelectionKey = null
  editorState.sceneRender.token += 1
}
function bindEvents() {
  const stage = $('#editor-stage')
  unbindPlaytestInput = bindPlaytestInputLifecycle({
    stage,
    hudStop: $('#editor-playtest-hud-stop'),
    getPlaytest: () => editorState.playtest,
    onStop: () => stopPlaytest(),
    onTrigger: () => triggerPlaytest('near_key'),
    onResize: (width, height) => {
      if (width === editorState.stage.width && height === editorState.stage.height) return
      editorState.stage.width = width
      editorState.stage.height = height
      renderStage()
    },
  })
  window.addEventListener('beforeunload', cleanupEditorShell, { once: true })
  $('#editor-project-form').addEventListener('submit', async (event) => {
    event.preventDefault()
    const fields = currentProjectFields()
    const result = await runAction('Project created', () => createEditorProject(fields))
    if (result?.project) {
      acceptProject(result.project)
      renderAll()
    }
  })
  $('#editor-load-project').addEventListener('click', async () => {
    const { id } = currentProjectFields()
    const result = await runAction('Project loaded', () => loadEditorProject(id))
    if (result?.project) {
      acceptProject(result.project)
      renderAll()
    }
  })
  $('#editor-save-project').addEventListener('click', async () => {
    await runAction('Project saved', () => saveCurrentProject())
  })
  $('#editor-autosave-project').addEventListener('click', async () => {
    const result = await runAction('Autosaved', () => autosaveEditorProject(saveProjectDraft()))
    if (result?.project) {
      editorState.project = result.project
      editorState.dirty = false
      renderAll()
    }
  })
  $('#editor-export-project-pack').addEventListener('click', async () => {
    await runAction('Project pack exported', () => exportCurrentProjectPack())
  })
  $('#editor-playback-toggle').addEventListener('click', () => {
    setPreviewPlaying(!editorState.animationRuntime?.playing)
  })
  $('#editor-import-form').addEventListener('submit', async (event) => {
    event.preventDefault()
    let project = editorState.project
    if (!project) return
    const nameChanged = $('#editor-project-name').value.trim() && $('#editor-project-name').value.trim() !== project.name
    if (editorState.dirty || nameChanged) {
      const savedProject = await runAction('Project saved before import', () => saveCurrentProject())
      if (!savedProject) return
      project = savedProject
    }
    const result = await runAction('Asset imported', () => importGeneratedJob({
      projectId: project.id,
      expectedRevision: project.revision,
      kind: $('#editor-import-kind').value,
      jobId: $('#editor-import-job-id').value.trim(),
      assetId: $('#editor-import-asset-id').value.trim(),
    }))
    if (result?.project) {
      acceptProject(result.project)
      editorState.selectedAssetId = result.asset?.id ?? editorState.selectedAssetId
      renderAll()
    }
  })
  $('#editor-undo-project').addEventListener('click', () => {
    const history = ensureSceneHistory()
    if (!history?.past?.length) return
    const next = undoHistory(history)
    editorState.sceneHistories[activeSceneHistoryKey()] = next
    editorState.selectedLayerId = next.selection?.layer_id ?? null
    replaceActiveScene(next.present)
    addEditorLog('Undo')
    renderAll()
  })
  $('#editor-redo-project').addEventListener('click', () => {
    const history = ensureSceneHistory()
    if (!history?.future?.length) return
    const next = redoHistory(history)
    editorState.sceneHistories[activeSceneHistoryKey()] = next
    editorState.selectedLayerId = next.selection?.layer_id ?? null
    replaceActiveScene(next.present)
    addEditorLog('Redo')
    renderAll()
  })
  $('#editor-toggle-grid').addEventListener('click', () => {
    editorState.stage.gridVisible = !editorState.stage.gridVisible
    renderAll()
  })
  $('#editor-toggle-snap').addEventListener('click', () => {
    editorState.stage.snapEnabled = !editorState.stage.snapEnabled
    renderAll()
  })
  $('#editor-snap-size').addEventListener('change', () => {
    const value = Number($('#editor-snap-size').value)
    editorState.stage.snapSize = Number.isFinite(value) && value > 0 ? Math.round(value) : 16
    renderAll()
  })
  $('#editor-import-job-id').addEventListener('input', syncControls)
  $('#editor-project-name').addEventListener('input', () => {
    if (editorState.activePanel === 'repair') renderBottomPanel()
  })
  $('#editor-scene-select').addEventListener('change', () => {
    const project = editorState.project
    const sceneId = $('#editor-scene-select').value
    if (!project?.scenes?.[sceneId]) return
    stopPlaytest({ render: false })
    editorState.project = {
      ...project,
      active_scene_id: sceneId,
    }
    editorState.selectedAssetId = null
    editorState.selectedLayerId = null
    ensureSceneHistory()
    refreshSceneRenderAssets()
    addEditorLog(`Scene selected: ${sceneId}`)
    renderAll()
  })
  document.querySelectorAll('[data-editor-panel]').forEach((tab) => {
    tab.addEventListener('click', () => {
      editorState.activePanel = tab.dataset.editorPanel
      renderAll()
    })
  })
  document.addEventListener('pointermove', handlePointerMove)
  document.addEventListener('pointerup', handlePointerUp)
}
export function initEditorShell() {
  bindEvents()
  addEditorLog('Editor ready')
  renderAll()
}
