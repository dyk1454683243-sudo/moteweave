import { EDITOR_SCENE_VERSION } from './constants.js'
import { clonePlain } from './safety.js'

export function createLayerDocument({
  id,
  name,
  type,
  assetId,
  clipId = null,
  visible = true,
  locked = false,
  transform,
  render,
  playback = null,
  interaction = null,
} = {}) {
  return {
    id,
    name: name ?? id,
    type,
    asset_id: assetId,
    ...(clipId ? { clip_id: clipId } : {}),
    visible,
    locked,
    transform: {
      position: { x: 0, y: 0 },
      scale: { x: 1, y: 1 },
      rotation_deg: 0,
      pivot: { mode: 'artifact_anchor', name: null, x: null, y: null },
      coordinate_space: type === 'ui' ? 'viewport' : 'world',
      flip_x: false,
      flip_y: false,
      ...clonePlain(transform),
    },
    render: {
      z_index: 0,
      opacity: 1,
      parallax: 1,
      blend_mode: 'normal',
      ...clonePlain(render),
    },
    ...(playback ? { playback: clonePlain(playback) } : {}),
    interaction: interaction == null ? null : clonePlain(interaction),
  }
}

export function createSceneDocument({
  id,
  name,
  world = { w: 1280, h: 720 },
  viewport = { w: 1280, h: 720 },
  camera = { x: 0, y: 0, zoom: 1 },
  background = '#101418',
  stateDefaults = {},
  entities = [],
  layers = [],
  createdAt,
  updatedAt = createdAt,
} = {}) {
  const created_at = createdAt ?? new Date().toISOString()
  return {
    id,
    version: EDITOR_SCENE_VERSION,
    name: name ?? id,
    world: clonePlain(world),
    viewport: clonePlain(viewport),
    camera: clonePlain(camera),
    background,
    state_defaults: clonePlain(stateDefaults),
    entities: clonePlain(entities),
    layers: clonePlain(layers),
    created_at,
    updated_at: updatedAt ?? created_at,
  }
}

export function getSceneLayer(scene, layerId) {
  return scene?.layers?.find((layer) => layer.id === layerId) ?? null
}

export function getSceneEntity(scene, entityId) {
  return scene?.entities?.find((entity) => entity.id === entityId) ?? null
}

export function withSceneLayer(scene, layer, { index = scene?.layers?.length ?? 0 } = {}) {
  const next = clonePlain(scene)
  next.layers.splice(index, 0, clonePlain(layer))
  return next
}

export function updateSceneLayer(scene, layerId, updater) {
  const next = clonePlain(scene)
  const index = next.layers.findIndex((layer) => layer.id === layerId)
  if (index === -1) return next
  next.layers[index] = typeof updater === 'function'
    ? updater(clonePlain(next.layers[index]))
    : { ...next.layers[index], ...clonePlain(updater) }
  return next
}

export function removeSceneLayer(scene, layerId) {
  const next = clonePlain(scene)
  next.layers = next.layers.filter((layer) => layer.id !== layerId)
  return next
}
