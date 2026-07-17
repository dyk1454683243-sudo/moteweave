import { createSceneDocument } from './scenes.js'
import { clonePlain } from './safety.js'
import { validateSceneDocument } from './validation.js'

const DEFAULT_NODE = Object.freeze({ x: 80, y: 60, w: 320, h: 180 })
const NODE_GAP = 380

function timestamp(now = new Date()) {
  return now instanceof Date ? now.toISOString() : new Date(now).toISOString()
}

function safeId(value, fallback = 'scene') {
  const safe = String(value || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')
  if (!safe) return fallback
  return /^[a-z0-9]/.test(safe) ? safe : `${fallback}_${safe}`
}

function uniqueId(existing, base) {
  const safe = safeId(base)
  if (!existing.has(safe)) return safe
  let index = 2
  while (existing.has(`${safe}_${index}`)) index += 1
  return `${safe}_${index}`
}

function nodeForIndex(index) {
  const col = index % 3
  const row = Math.floor(index / 3)
  return {
    ...DEFAULT_NODE,
    x: DEFAULT_NODE.x + col * NODE_GAP,
    y: DEFAULT_NODE.y + row * 240,
  }
}

function nextNode(project, sourceNode = null) {
  if (sourceNode) {
    return {
      x: (sourceNode.x ?? DEFAULT_NODE.x) + 40,
      y: (sourceNode.y ?? DEFAULT_NODE.y) + 40,
      w: sourceNode.w ?? DEFAULT_NODE.w,
      h: sourceNode.h ?? DEFAULT_NODE.h,
    }
  }
  return nodeForIndex(Object.keys(project?.scenes ?? {}).length)
}

function sceneFlow(project) {
  return {
    nodes: { ...(project?.scene_flow?.nodes ?? {}) },
    links: [...(project?.scene_flow?.links ?? [])],
  }
}

function withUpdatedFlow(project, flow, now = new Date()) {
  return {
    ...clonePlain(project),
    updated_at: timestamp(now),
    scene_flow: {
      nodes: clonePlain(flow.nodes ?? {}),
      links: clonePlain(flow.links ?? []),
    },
  }
}

function collectSceneLinkActions(project) {
  const links = []
  for (const scene of Object.values(project?.scenes ?? {})) {
    const owners = [
      ...(scene.layers ?? []).map((layer) => ({ type: 'layer', id: layer.id, interaction: layer.interaction })),
      ...(scene.entities ?? []).map((entity) => ({ type: 'entity', id: entity.id, interaction: entity.interaction })),
    ]
    for (const owner of owners) {
      for (const action of owner.interaction?.actions ?? []) {
        if (action?.type !== 'scene_link') continue
        links.push({
          from_scene_id: scene.id,
          to_scene_id: action.target_scene_id,
          target_spawn_id: action.target_spawn_id,
          owner_type: owner.type,
          owner_id: owner.id,
        })
      }
    }
  }
  return links
}

export function buildSceneFlowDiagnostics(project) {
  const scenes = project?.scenes ?? {}
  const flow = project?.scene_flow ?? { nodes: {}, links: [] }
  const missing_node_scene_ids = Object.keys(scenes).filter((sceneId) => !flow.nodes?.[sceneId])
  const orphan_node_ids = Object.keys(flow.nodes ?? {}).filter((sceneId) => !scenes[sceneId])
  const broken_links = (flow.links ?? []).filter((link) => !scenes[link.from_scene_id] || !scenes[link.to_scene_id])
  const seen = new Set()
  const duplicate_link_ids = []
  for (const link of flow.links ?? []) {
    if (!link?.id) continue
    if (seen.has(link.id)) duplicate_link_ids.push(link.id)
    seen.add(link.id)
  }
  const explicitPairs = new Set((flow.links ?? []).map((link) => `${link.from_scene_id}->${link.to_scene_id}`))
  const untracked_interaction_links = collectSceneLinkActions(project).filter((link) => {
    if (!link.to_scene_id || !scenes[link.to_scene_id]) return false
    return !explicitPairs.has(`${link.from_scene_id}->${link.to_scene_id}`)
  })

  return {
    missing_node_scene_ids,
    orphan_node_ids,
    broken_links,
    duplicate_link_ids,
    untracked_interaction_links,
    warning_count:
      missing_node_scene_ids.length +
      orphan_node_ids.length +
      broken_links.length +
      duplicate_link_ids.length +
      untracked_interaction_links.length,
  }
}

export function buildSceneFlowBoard(project) {
  const flow = project?.scene_flow ?? { nodes: {}, links: [] }
  const cards = Object.values(project?.scenes ?? {}).map((scene, index) => {
    const validation = validateSceneDocument(scene, {
      assets: project.assets,
      scenes: project.scenes,
    })
    const node = flow.nodes?.[scene.id] ?? nodeForIndex(index)
    const incoming = (flow.links ?? []).filter((link) => link.to_scene_id === scene.id)
    const outgoing = (flow.links ?? []).filter((link) => link.from_scene_id === scene.id)
    return {
      id: scene.id,
      name: scene.name ?? scene.id,
      active: project.active_scene_id === scene.id,
      node: clonePlain(node),
      validation,
      layer_count: scene.layers?.length ?? 0,
      entity_count: scene.entities?.length ?? 0,
      incoming_count: incoming.length,
      outgoing_count: outgoing.length,
    }
  })

  return {
    cards,
    links: clonePlain(flow.links ?? []),
    diagnostics: buildSceneFlowDiagnostics(project),
  }
}

export function normalizeSceneFlowLayout(project, { now = new Date() } = {}) {
  const next = clonePlain(project)
  const flow = sceneFlow(next)
  for (const [index, sceneId] of Object.keys(next.scenes ?? {}).entries()) {
    if (!flow.nodes[sceneId]) flow.nodes[sceneId] = nodeForIndex(index)
  }
  for (const nodeId of Object.keys(flow.nodes)) {
    if (!next.scenes?.[nodeId]) delete flow.nodes[nodeId]
  }
  flow.links = flow.links.filter((link) => next.scenes?.[link.from_scene_id] && next.scenes?.[link.to_scene_id])
  return withUpdatedFlow(next, flow, now)
}

export function updateSceneFlowNode(project, sceneId, nodePatch, { now = new Date() } = {}) {
  if (!project?.scenes?.[sceneId]) throw new Error(`scene not found: ${sceneId}`)
  const flow = sceneFlow(project)
  const current = flow.nodes[sceneId] ?? nextNode(project)
  flow.nodes[sceneId] = {
    x: Number.isFinite(nodePatch.x) ? nodePatch.x : current.x,
    y: Number.isFinite(nodePatch.y) ? nodePatch.y : current.y,
    w: Number.isFinite(nodePatch.w) && nodePatch.w > 0 ? nodePatch.w : current.w,
    h: Number.isFinite(nodePatch.h) && nodePatch.h > 0 ? nodePatch.h : current.h,
  }
  return withUpdatedFlow(project, flow, now)
}

export function addSceneFlowLink(project, { fromSceneId, toSceneId, label = '' } = {}, { now = new Date() } = {}) {
  if (!project?.scenes?.[fromSceneId]) throw new Error(`source scene not found: ${fromSceneId}`)
  if (!project?.scenes?.[toSceneId]) throw new Error(`target scene not found: ${toSceneId}`)
  const flow = sceneFlow(project)
  const ids = new Set(flow.links.map((link) => link.id))
  const id = uniqueId(ids, `link_${fromSceneId}_to_${toSceneId}`)
  flow.links.push({
    id,
    from_scene_id: fromSceneId,
    to_scene_id: toSceneId,
    label,
  })
  return withUpdatedFlow(project, flow, now)
}

export function removeSceneFlowLink(project, linkId, { now = new Date() } = {}) {
  const flow = sceneFlow(project)
  flow.links = flow.links.filter((link) => link.id !== linkId)
  return withUpdatedFlow(project, flow, now)
}

export function copySceneForClipboard(project, sceneId) {
  const scene = project?.scenes?.[sceneId]
  if (!scene) throw new Error(`scene not found: ${sceneId}`)
  return {
    source_scene_id: sceneId,
    scene: clonePlain(scene),
    node: clonePlain(project.scene_flow?.nodes?.[sceneId] ?? DEFAULT_NODE),
  }
}

export function pasteSceneFromClipboard(project, clipboard, {
  id,
  name,
  now = new Date(),
} = {}) {
  const source = clipboard?.scene
  if (!source) throw new Error('scene clipboard is empty')
  const next = clonePlain(project)
  const existing = new Set(Object.keys(next.scenes ?? {}))
  const sceneId = uniqueId(existing, id ?? `${source.id}_copy`)
  const createdAt = timestamp(now)
  const scene = {
    ...clonePlain(source),
    id: sceneId,
    name: name ?? `${source.name ?? source.id} Copy`,
    created_at: createdAt,
    updated_at: createdAt,
  }
  next.scenes[sceneId] = scene
  next.active_scene_id = sceneId
  next.scene_flow = sceneFlow(next)
  next.scene_flow.nodes[sceneId] = nextNode(project, clipboard.node)
  next.updated_at = createdAt
  return next
}

export function duplicateScene(project, sceneId, options = {}) {
  return pasteSceneFromClipboard(project, copySceneForClipboard(project, sceneId), options)
}

export function createBlankSceneInProject(project, {
  id,
  name = 'New Scene',
  now = new Date(),
} = {}) {
  const next = clonePlain(project)
  const existing = new Set(Object.keys(next.scenes ?? {}))
  const sceneId = uniqueId(existing, id ?? safeId(name, 'scene'))
  const createdAt = timestamp(now)
  const scene = createSceneDocument({
    id: sceneId,
    name,
    createdAt,
    updatedAt: createdAt,
    viewport: next.settings?.default_viewport ?? { w: 1280, h: 720 },
    world: next.settings?.default_viewport ?? { w: 1280, h: 720 },
  })
  next.scenes[sceneId] = scene
  next.active_scene_id = sceneId
  next.scene_flow = sceneFlow(next)
  next.scene_flow.nodes[sceneId] = nextNode(project)
  next.updated_at = createdAt
  return next
}
