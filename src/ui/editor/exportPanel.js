import { editorState } from './state.js'
import {
  button,
  keyValue,
  linkList,
  selectControl,
} from './domControls.js'

function statusClass(status) {
  if (status === 'pass' || status === 'ready' || status === 'done') return 'pass'
  if (status === 'warning' || status === 'running' || status === 'idle') return 'warning'
  if (status === 'fail' || status === 'error') return 'fail'
  return 'unknown'
}

function statusBadge(status, label = status) {
  const badge = document.createElement('span')
  badge.className = `editor-export-badge ${statusClass(status)}`
  badge.textContent = label ?? '-'
  return badge
}

function metricValue(metrics, key) {
  return metrics?.[key] == null ? '-' : metrics[key]
}

function emptyExportLine(message) {
  const empty = document.createElement('div')
  empty.className = 'editor-empty-line'
  empty.textContent = message
  return empty
}

function renderExportLinks(result) {
  const urls = result?.urls ?? {}
  const links = linkList([
    ['pack manifest', urls.manifest_url],
    ['validation', urls.validation_url],
    ['asset refs', urls.asset_references_url],
    ['engine payloads', urls.engine_payloads_url],
    ['handoff manifest', urls.engine_handoff_manifest_url],
    ['Godot preview', urls.godot_scene_handoff_url],
    ['LDtk preview', urls.ldtk_scene_handoff_url],
    ['zip', urls.zip_url],
  ])
  links.classList.add('editor-export-links')
  return links
}

function renderExportOverview({ exportCurrentProjectPack, runAction }) {
  const result = editorState.exportPack.result
  const validation = result?.validation
  const reviewStatus = result?.review_status
  const metrics = validation?.metrics ?? {}
  const wrap = document.createElement('section')
  wrap.className = 'editor-export-overview'

  const status = document.createElement('div')
  status.className = 'editor-export-status'
  status.append(
    keyValue('export', result?.id ?? 'not exported'),
    keyValue('state', editorState.exportPack.message || editorState.exportPack.status),
    keyValue('validation', validation?.status ?? '-'),
    keyValue('review', reviewStatus?.consumer_readiness ?? '-'),
    keyValue('unsupported status', reviewStatus?.unsupported_items_status ?? '-'),
    keyValue('scenes', metricValue(metrics, 'scene_count')),
    keyValue('assets', metricValue(metrics, 'asset_count')),
    keyValue('engine payloads', metricValue(metrics, 'engine_payload_count')),
    keyValue('unsupported', metricValue(metrics, 'engine_handoff_unsupported_item_count')),
  )

  const actions = document.createElement('div')
  actions.className = 'editor-row-actions editor-export-actions'
  const run = button(editorState.exportPack.status === 'running' ? 'Exporting' : 'Export Pack', '', !editorState.project || editorState.exportPack.status === 'running')
  run.addEventListener('click', async () => {
    await runAction('Project pack exported', () => exportCurrentProjectPack())
  })
  actions.append(run)
  status.append(actions)
  wrap.append(status)

  if (result?.urls) wrap.append(renderExportLinks(result))
  if (editorState.exportPack.handoff?.error) {
    const error = document.createElement('div')
    error.className = 'editor-export-warning'
    error.textContent = editorState.exportPack.handoff.error
    wrap.append(error)
  }
  return wrap
}

function handoffTabs({ renderAll }) {
  const tabs = document.createElement('div')
  tabs.className = 'editor-handoff-tabs'
  const labels = [
    ['manifest', 'Neutral Manifest'],
    ['godot', 'Godot Preview'],
    ['ldtk', 'LDtk Preview'],
  ]
  for (const [value, label] of labels) {
    const tab = button(label, editorState.exportPack.reviewTab === value ? 'active secondary' : 'secondary')
    tab.setAttribute('aria-pressed', String(editorState.exportPack.reviewTab === value))
    tab.addEventListener('click', () => {
      editorState.exportPack.reviewTab = value
      renderAll()
    })
    tabs.append(tab)
  }
  return tabs
}

function renderManifestInspector(manifest) {
  const wrap = document.createElement('div')
  wrap.className = 'editor-handoff-inspector-grid'
  if (!manifest) {
    wrap.append(emptyExportLine('Export a project pack to inspect the neutral handoff manifest'))
    return wrap
  }
  wrap.append(
    keyValue('version', manifest.version),
    keyValue('mapping', manifest.mapping_version),
    keyValue('project', `${manifest.project_id} / rev ${manifest.project_revision}`),
    keyValue('status', manifest.status),
    keyValue('assets', manifest.assets?.length ?? 0),
    keyValue('scenes', manifest.scenes?.length ?? 0),
    keyValue('unsupported', manifest.unsupported_items?.length ?? 0),
    keyValue('coordinate model', manifest.coordinate_model?.layer_position_semantics),
  )
  return wrap
}

function renderGodotInspector(godot) {
  const wrap = document.createElement('div')
  wrap.className = 'editor-handoff-inspector-grid'
  if (!godot) {
    wrap.append(emptyExportLine('Export a project pack to inspect the Godot preview handoff'))
    return wrap
  }
  const nodeCount = (godot.scenes ?? []).reduce((sum, scene) => (
    sum + (scene.nodes?.length ?? 0) + (scene.ui_nodes?.length ?? 0) + (scene.entity_nodes?.length ?? 0)
  ), 0)
  wrap.append(
    keyValue('version', godot.version),
    keyValue('status', godot.status),
    keyValue('claim', godot.claim_boundary),
    keyValue('scenes', godot.scenes?.length ?? 0),
    keyValue('metadata nodes', nodeCount),
    keyValue('unsupported', godot.unsupported_items?.length ?? 0),
    keyValue('world mapping', godot.coordinate_mapping?.world),
    keyValue('pivot mapping', godot.coordinate_mapping?.pivot),
  )
  return wrap
}

function renderLdtkInspector(ldtk) {
  const wrap = document.createElement('div')
  wrap.className = 'editor-handoff-inspector-grid'
  if (!ldtk) {
    wrap.append(emptyExportLine('Export a project pack to inspect the LDtk preview handoff'))
    return wrap
  }
  const entityCount = (ldtk.levels ?? []).reduce((sum, level) => (
    sum + (level.layer_instances ?? []).reduce((inner, layer) => inner + (layer.entity_instances?.length ?? 0), 0)
  ), 0)
  wrap.append(
    keyValue('version', ldtk.version),
    keyValue('status', ldtk.status),
    keyValue('claim', ldtk.claim_boundary),
    keyValue('levels', ldtk.levels?.length ?? 0),
    keyValue('entity metadata', entityCount),
    keyValue('unsupported', ldtk.unsupported_items?.length ?? 0),
    keyValue('payload policy', ldtk.existing_scene_pack_payload_policy),
    keyValue('world mapping', ldtk.coordinate_mapping?.world),
  )
  return wrap
}

function renderHandoffInspector({ renderAll }) {
  const wrap = document.createElement('section')
  wrap.className = 'editor-handoff-inspector'
  const head = document.createElement('div')
  head.className = 'editor-export-section-head'
  head.append(statusBadge(editorState.exportPack.handoff?.manifest?.status ?? editorState.exportPack.status, 'handoff'))
  const title = document.createElement('strong')
  title.textContent = 'Handoff Inspector'
  head.append(title)
  wrap.append(head, handoffTabs({ renderAll }))

  const handoff = editorState.exportPack.handoff ?? {}
  const panel = {
    manifest: () => renderManifestInspector(handoff.manifest),
    godot: () => renderGodotInspector(handoff.godot),
    ldtk: () => renderLdtkInspector(handoff.ldtk),
  }[editorState.exportPack.reviewTab] ?? (() => renderManifestInspector(handoff.manifest))
  wrap.append(panel())
  return wrap
}

function renderUnsupportedItems() {
  const wrap = document.createElement('section')
  wrap.className = 'editor-unsupported-items'
  const items = editorState.exportPack.handoff?.manifest?.unsupported_items ?? []
  const head = document.createElement('div')
  head.className = 'editor-export-section-head'
  head.append(statusBadge(items.length ? 'warning' : 'pass', `${items.length} unsupported`))
  const title = document.createElement('strong')
  title.textContent = 'Unsupported Items'
  head.append(title)
  wrap.append(head)

  if (!editorState.exportPack.result) {
    wrap.append(emptyExportLine('Export a project pack to review unsupported engine items'))
    return wrap
  }
  if (!items.length) {
    wrap.append(emptyExportLine('No unsupported engine handoff items'))
    return wrap
  }
  const list = document.createElement('div')
  list.className = 'editor-unsupported-list'
  for (const item of items) {
    const row = document.createElement('article')
    row.className = 'editor-unsupported-row'
    row.append(
      keyValue(`${item.engine} / ${item.action_type ?? item.item_type}`, item.reason),
      keyValue('owner', `${item.scene_id ?? '-'} / ${item.owner_type ?? '-'}:${item.owner_id ?? '-'}`),
      keyValue('omitted from', item.omitted_from ?? '-'),
    )
    list.append(row)
  }
  wrap.append(list)
  return wrap
}

function previewSceneOptions(manifest) {
  return (manifest?.scenes ?? []).map((scene) => ({
    value: scene.id,
    label: scene.name ? `${scene.name} (${scene.id})` : scene.id,
  }))
}

function activePreviewScene(manifest) {
  const scenes = manifest?.scenes ?? []
  const id = editorState.exportPack.previewSceneId || scenes[0]?.id || ''
  return scenes.find((scene) => scene.id === id) ?? scenes[0] ?? null
}

function godotLayerMap(godot, sceneId) {
  const scene = (godot?.scenes ?? []).find((item) => item.id === sceneId)
  const map = new Map()
  for (const node of [...(scene?.nodes ?? []), ...(scene?.ui_nodes ?? [])]) {
    map.set(node.layer_id, node)
  }
  return map
}

function ldtkLayerMap(ldtk, sceneId) {
  const level = (ldtk?.levels ?? []).find((item) => item.identifier === sceneId)
  const map = new Map()
  for (const layer of level?.layer_instances ?? []) {
    for (const entity of layer.entity_instances ?? []) {
      const layerId = entity.custom_fields?.editor_layer_id
      if (layerId) map.set(layerId, entity)
    }
  }
  return {
    map,
    omitted: new Set((level?.omitted_layers ?? []).map((item) => item.layer_id)),
  }
}

function exportCell(value) {
  const cell = document.createElement('span')
  cell.textContent = value == null || value === '' ? '-' : String(value)
  return cell
}

function renderLayerExportPreviewTable(scene, handoff) {
  const table = document.createElement('div')
  table.className = 'editor-export-layer-table'
  if (!scene?.layers?.length) {
    table.append(emptyExportLine(scene ? 'No layers in selected scene' : 'No handoff scene selected'))
    return table
  }
  const godotMap = godotLayerMap(handoff.godot, scene.id)
  const ldtk = ldtkLayerMap(handoff.ldtk, scene.id)
  const header = document.createElement('div')
  header.className = 'editor-export-layer-row editor-export-layer-head'
  for (const label of ['Layer', 'Asset', 'Pivot', 'Top-left', 'Godot', 'LDtk']) {
    const cell = document.createElement('strong')
    cell.textContent = label
    header.append(cell)
  }
  table.append(header)
  for (const layer of scene.layers) {
    const godotNode = godotMap.get(layer.id)
    const ldtkEntity = ldtk.map.get(layer.id)
    const pivot = layer.transform?.pivot_position
    const topLeft = layer.transform?.top_left_position
    const row = document.createElement('div')
    row.className = 'editor-export-layer-row'
    row.append(
      exportCell(`${layer.name ?? layer.id}\n${layer.type} / ${layer.transform?.coordinate_space}`),
      exportCell(`${layer.asset_id ?? '-'}\n${layer.active_revision_id ?? '-'}`),
      exportCell(pivot ? `${pivot.x}, ${pivot.y}` : '-'),
      exportCell(topLeft ? `${topLeft.x}, ${topLeft.y}` : '-'),
      exportCell(godotNode ? `${godotNode.node_type}\n${godotNode.transform?.coordinate_space}` : 'omitted'),
      exportCell(ldtkEntity ? `${ldtkEntity.entity_type}\nmetadata` : ldtk.omitted.has(layer.id) ? 'omitted / viewport' : 'omitted'),
    )
    table.append(row)
  }
  return table
}

function renderSceneLayerExportPreview({ renderAll }) {
  const wrap = document.createElement('section')
  wrap.className = 'editor-export-preview'
  const handoff = editorState.exportPack.handoff ?? {}
  const manifest = handoff.manifest
  const selectedScene = activePreviewScene(manifest)
  const head = document.createElement('div')
  head.className = 'editor-export-section-head'
  head.append(statusBadge(selectedScene ? 'pass' : 'idle', 'scene preview'))
  const title = document.createElement('strong')
  title.textContent = 'Scene / Layer Export Preview'
  head.append(title)
  wrap.append(head)

  if (!manifest) {
    wrap.append(emptyExportLine('Export a project pack to inspect scene and layer engine mapping'))
    return wrap
  }

  const selector = selectControl('scene', selectedScene?.id ?? '', previewSceneOptions(manifest), {
    onChange: (value) => {
      editorState.exportPack.previewSceneId = value
      renderAll()
    },
  })
  selector.classList.add('editor-export-scene-select')
  wrap.append(selector)

  const sceneSummary = document.createElement('div')
  sceneSummary.className = 'editor-export-status'
  sceneSummary.append(
    keyValue('scene', selectedScene?.name ?? selectedScene?.id),
    keyValue('world', selectedScene ? `${selectedScene.world?.w} x ${selectedScene.world?.h}` : '-'),
    keyValue('viewport', selectedScene ? `${selectedScene.viewport?.w} x ${selectedScene.viewport?.h}` : '-'),
    keyValue('layers', selectedScene?.layers?.length ?? 0),
    keyValue('entities', selectedScene?.entities?.length ?? 0),
  )
  wrap.append(sceneSummary, renderLayerExportPreviewTable(selectedScene, handoff))
  return wrap
}

function reviewChecklistItems() {
  const result = editorState.exportPack.result
  const validation = result?.validation
  const handoff = editorState.exportPack.handoff ?? {}
  const unsupported = handoff.manifest?.unsupported_items?.length ?? 0
  const metrics = validation?.metrics ?? {}
  return [
    {
      label: 'Project pack exported',
      status: result ? 'pass' : 'idle',
      detail: result?.id ?? 'not exported',
    },
    {
      label: 'Pack validation reviewed',
      status: validation?.status ?? 'idle',
      detail: validation ? `${validation.blocking_errors?.length ?? 0} blocking / ${validation.warnings?.length ?? 0} warnings` : 'waiting for export',
    },
    {
      label: 'Neutral handoff manifest loaded',
      status: handoff.manifest ? handoff.manifest.status : result ? 'fail' : 'idle',
      detail: handoff.manifest?.version ?? 'missing',
    },
    {
      label: 'Godot preview loaded',
      status: handoff.godot ? handoff.godot.status : result ? 'fail' : 'idle',
      detail: handoff.godot?.claim_boundary ?? 'missing',
    },
    {
      label: 'LDtk preview loaded',
      status: handoff.ldtk ? handoff.ldtk.status : result ? 'fail' : 'idle',
      detail: handoff.ldtk?.claim_boundary ?? 'missing',
    },
    {
      label: 'Unsupported items reviewed',
      status: unsupported ? 'warning' : result ? 'pass' : 'idle',
      detail: `${unsupported} item${unsupported === 1 ? '' : 's'}`,
    },
    {
      label: 'Existing engine payloads preserved',
      status: result ? (metrics.engine_payload_count ? 'pass' : 'warning') : 'idle',
      detail: `${metrics.engine_payload_count ?? 0} payload${metrics.engine_payload_count === 1 ? '' : 's'}`,
    },
  ]
}

function renderReviewChecklist() {
  const wrap = document.createElement('section')
  wrap.className = 'editor-review-checklist'
  const head = document.createElement('div')
  head.className = 'editor-export-section-head'
  head.append(statusBadge(editorState.exportPack.result ? 'pass' : 'idle', 'checklist'))
  const title = document.createElement('strong')
  title.textContent = 'Review Checklist'
  head.append(title)
  wrap.append(head)

  const list = document.createElement('div')
  list.className = 'editor-review-list'
  for (const item of reviewChecklistItems()) {
    const row = document.createElement('div')
    row.className = 'editor-review-row'
    row.append(statusBadge(item.status, item.status), keyValue(item.label, item.detail))
    list.append(row)
  }
  wrap.append(list)
  return wrap
}

export function renderExportPanel({ exportCurrentProjectPack, runAction, renderAll }) {
  const wrap = document.createElement('div')
  wrap.className = 'editor-export-console'
  if (!editorState.project) {
    wrap.append(emptyExportLine('No project loaded'))
    return wrap
  }
  wrap.append(
    renderExportOverview({ exportCurrentProjectPack, runAction }),
    renderHandoffInspector({ renderAll }),
    renderUnsupportedItems(),
    renderSceneLayerExportPreview({ renderAll }),
    renderReviewChecklist(),
  )
  return wrap
}
