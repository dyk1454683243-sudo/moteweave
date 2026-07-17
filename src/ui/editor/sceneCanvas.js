import { interactionZoneRect } from '../../editor-project/interactionRuntime.js'

const DEFAULT_LAYER_SIZES = {
  background: { w: 320, h: 180 },
  tilemap: { w: 320, h: 180 },
  character: { w: 96, h: 96 },
  prop: { w: 96, h: 96 },
  effect: { w: 96, h: 96 },
  foreground: { w: 320, h: 180 },
  ui: { w: 240, h: 80 },
}

const ASSET_LAYER_TYPES = {
  character_pack: 'character',
  scene_pack: 'tilemap',
  tilemap: 'tilemap',
  static_image: 'prop',
  spritesheet: 'prop',
  effect: 'effect',
  ui: 'ui',
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value))
}

function sanitizeId(value, fallback = 'layer') {
  const base = String(value || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
  const safe = /^[a-z0-9]/.test(base) ? base : `${fallback}_${base}`
  return safe || fallback
}

function activeRevision(asset) {
  return asset?.revisions?.[asset.active_revision_id] ?? null
}

function firstKey(value) {
  return Object.keys(value ?? {})[0] ?? null
}

function nextLayerId(asset, scene) {
  const existing = new Set((scene?.layers ?? []).map((layer) => layer.id))
  const assetPart = sanitizeId(String(asset?.id ?? 'asset').replace(/^asset_/, ''), 'asset')
  const base = sanitizeId(`layer_${assetPart}`)
  if (!existing.has(base)) return base
  let index = 2
  while (existing.has(`${base}_${index}`)) index += 1
  return `${base}_${index}`
}

function nextZIndex(scene) {
  const zValues = (scene?.layers ?? []).map((layer) => layer.render?.z_index ?? 0)
  return zValues.length ? Math.max(...zValues) + 10 : 10
}

function defaultPivotForLayerType(type, clip) {
  if (type === 'character') return { mode: 'artifact_anchor', name: 'feet', x: null, y: null }
  if (type === 'background' || type === 'tilemap' || type === 'foreground') {
    return { mode: 'top_left', name: null, x: null, y: null }
  }
  if (clip?.anchor) return { mode: 'artifact_anchor', name: 'asset_anchor', x: null, y: null }
  return { mode: 'center', name: null, x: null, y: null }
}

export function layerTypeForAsset(asset) {
  if (asset?.tags?.includes('background')) return 'background'
  if (asset?.tags?.includes('foreground')) return 'foreground'
  return ASSET_LAYER_TYPES[asset?.kind] ?? 'prop'
}

export function canAddAssetToScene(asset) {
  const revision = activeRevision(asset)
  if (!asset || !revision) return false
  if (revision.production_status === 'blocked') return false
  return revision.quality_status !== 'fail'
}

export function createLayerFromAsset(asset, scene, { snapSize = 16 } = {}) {
  if (!canAddAssetToScene(asset)) return null
  const type = layerTypeForAsset(asset)
  const clipId = firstKey(asset.clips)
  const clip = clipId ? asset.clips[clipId] : null
  const position = snapPoint({
    x: Math.max(0, Math.round((scene?.world?.w ?? 1280) / 2)),
    y: Math.max(0, Math.round((scene?.world?.h ?? 720) / 2)),
  }, { snapSize, enabled: true })
  const layer = {
    id: nextLayerId(asset, scene),
    name: asset.name ?? asset.id,
    type,
    asset_id: asset.id,
    ...(clipId ? { clip_id: clipId } : {}),
    visible: true,
    locked: false,
    transform: {
      position,
      scale: { x: 1, y: 1 },
      rotation_deg: 0,
      pivot: defaultPivotForLayerType(type, clip),
      coordinate_space: type === 'ui' ? 'viewport' : 'world',
      flip_x: false,
      flip_y: false,
    },
    render: {
      z_index: nextZIndex(scene),
      opacity: 1,
      parallax: type === 'ui' ? 1 : 1,
      blend_mode: 'normal',
    },
    ...(clip ? {
      playback: {
        activation: 'auto',
        loop_mode: clip.loop_mode ?? 'loop',
        rate: 1,
        start_offset_ms: 0,
        initially_paused: false,
      },
    } : {}),
    interaction: null,
  }
  return layer
}

export function appendLayerToScene(scene, layer, now = new Date().toISOString()) {
  const next = clone(scene)
  next.layers = [...(next.layers ?? []), clone(layer)]
  next.updated_at = now
  return next
}

export function updateSceneLayer(scene, layerId, updater, now = new Date().toISOString()) {
  const next = clone(scene)
  next.layers = (next.layers ?? []).map((layer) => {
    if (layer.id !== layerId) return layer
    return typeof updater === 'function' ? updater(clone(layer)) : { ...layer, ...clone(updater) }
  })
  next.updated_at = now
  return next
}

export function moveSceneLayer(scene, layerId, direction, now = new Date().toISOString()) {
  const next = clone(scene)
  const index = next.layers.findIndex((layer) => layer.id === layerId)
  const target = index + direction
  if (index < 0 || target < 0 || target >= next.layers.length) return next
  const [layer] = next.layers.splice(index, 1)
  next.layers.splice(target, 0, layer)
  next.updated_at = now
  return next
}

export function getLayerFrameSpec(layer, asset) {
  const clip = asset?.clips?.[layer?.clip_id] ?? asset?.clips?.[firstKey(asset?.clips)]
  const frameSize = clone(clip?.frame_size ?? DEFAULT_LAYER_SIZES[layer?.type] ?? DEFAULT_LAYER_SIZES.prop)
  let anchor = { x: 0, y: 0 }
  const pivot = layer?.transform?.pivot
  if (pivot?.mode === 'center') anchor = { x: frameSize.w / 2, y: frameSize.h / 2 }
  if (pivot?.mode === 'explicit') anchor = { x: pivot.x ?? 0, y: pivot.y ?? 0 }
  if (pivot?.mode === 'artifact_anchor') {
    anchor = clip?.anchor
      ? clone(clip.anchor)
      : layer?.type === 'character'
        ? { x: frameSize.w / 2, y: frameSize.h }
        : { x: frameSize.w / 2, y: frameSize.h / 2 }
  }
  return { frameSize, anchor }
}

export function fitSceneToStage(scene, rect, padding = 24) {
  const world = scene?.world ?? { w: 1280, h: 720 }
  const safeWidth = Math.max(1, (rect?.width ?? world.w) - padding * 2)
  const safeHeight = Math.max(1, (rect?.height ?? world.h) - padding * 2)
  const scale = Math.max(0.05, Math.min(safeWidth / world.w, safeHeight / world.h))
  return {
    scale,
    offsetX: Math.max(padding, ((rect?.width ?? world.w) - world.w * scale) / 2),
    offsetY: Math.max(padding, ((rect?.height ?? world.h) - world.h * scale) / 2),
    worldWidth: world.w * scale,
    worldHeight: world.h * scale,
  }
}

export function layerBoxInView(layer, scene, asset, view) {
  const camera = scene?.camera ?? { x: 0, y: 0, zoom: 1 }
  const zoom = camera.zoom ?? 1
  const parallax = layer?.render?.parallax ?? 1
  const position = layer?.transform?.position ?? { x: 0, y: 0 }
  const screen = layer?.transform?.coordinate_space === 'viewport'
    ? position
    : {
        x: (position.x - (camera.x ?? 0) * parallax) * zoom,
        y: (position.y - (camera.y ?? 0) * parallax) * zoom,
      }
  const { frameSize, anchor } = getLayerFrameSpec(layer, asset)
  const scaleX = layer?.transform?.scale?.x ?? 1
  const scaleY = layer?.transform?.scale?.y ?? 1
  const width = frameSize.w * scaleX * zoom
  const height = frameSize.h * scaleY * zoom
  const left = screen.x - anchor.x * scaleX * zoom
  const top = screen.y - anchor.y * scaleY * zoom
  return {
    left: view.offsetX + left * view.scale,
    top: view.offsetY + top * view.scale,
    width: Math.max(12, width * view.scale),
    height: Math.max(12, height * view.scale),
    anchorX: anchor.x * scaleX * zoom * view.scale,
    anchorY: anchor.y * scaleY * zoom * view.scale,
  }
}

export function interactionZoneBoxInView(layer, scene, view) {
  const rect = interactionZoneRect(layer, layer?.interaction)
  if (!rect) return null
  const camera = scene?.camera ?? { x: 0, y: 0, zoom: 1 }
  const zoom = rect.coordinate_space === 'world' ? camera.zoom ?? 1 : 1
  const parallax = rect.coordinate_space === 'world' ? layer?.render?.parallax ?? 1 : 1
  const screen = rect.coordinate_space === 'world'
    ? {
        x: (rect.x - (camera.x ?? 0) * parallax) * zoom,
        y: (rect.y - (camera.y ?? 0) * parallax) * zoom,
      }
    : { x: rect.x, y: rect.y }
  return {
    left: view.offsetX + screen.x * view.scale,
    top: view.offsetY + screen.y * view.scale,
    width: Math.max(12, rect.w * zoom * view.scale),
    height: Math.max(12, rect.h * zoom * view.scale),
  }
}

export function snapValue(value, { snapSize = 16, enabled = true } = {}) {
  const size = Number(snapSize)
  if (!enabled || !Number.isFinite(size) || size <= 0) return value
  return Math.round(value / size) * size
}

export function snapPoint(point, options = {}) {
  return {
    x: snapValue(point.x, options),
    y: snapValue(point.y, options),
  }
}

export function clampPositionToScene(point, scene, layer) {
  const bounds = layer?.transform?.coordinate_space === 'viewport'
    ? scene?.viewport
    : scene?.world
  return {
    x: Math.max(0, Math.min(bounds?.w ?? point.x, point.x)),
    y: Math.max(0, Math.min(bounds?.h ?? point.y, point.y)),
  }
}
