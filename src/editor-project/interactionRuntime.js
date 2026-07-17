import { clonePlain } from './safety.js'

function activeScene(project, runtime) {
  const sceneId = runtime?.activeSceneId ?? project?.active_scene_id
  return project?.scenes?.[sceneId] ?? null
}

function layerById(scene, layerId) {
  return scene?.layers?.find((layer) => layer.id === layerId) ?? null
}

function spawnById(scene, spawnId) {
  return scene?.entities?.find((entity) => entity.id === spawnId && entity.type === 'spawn_point') ?? null
}

function playerPosition(runtime) {
  return {
    x: Number(runtime?.player?.x) || 0,
    y: Number(runtime?.player?.y) || 0,
  }
}

function distance(a, b) {
  return Math.hypot((a.x ?? 0) - (b.x ?? 0), (a.y ?? 0) - (b.y ?? 0))
}

function pointInRect(point, rect) {
  if (!point || !rect) return false
  return (
    point.x >= rect.x &&
    point.y >= rect.y &&
    point.x <= rect.x + rect.w &&
    point.y <= rect.y + rect.h
  )
}

function readStateValue(scene, runtime, key) {
  if (!key) return undefined
  if (Object.hasOwn(runtime?.flags ?? {}, key)) return runtime.flags[key]
  return scene?.state_defaults?.[key]
}

function conditionMatches(scene, runtime, condition) {
  if (!condition?.state_key) return true
  return Object.is(readStateValue(scene, runtime, condition.state_key), condition.equals)
}

function normalizeInventory(items = []) {
  const totals = new Map()
  for (const item of items) {
    if (!item?.item_id) continue
    totals.set(item.item_id, (totals.get(item.item_id) ?? 0) + (Number(item.quantity) || 0))
  }
  return [...totals.entries()]
    .filter(([, quantity]) => quantity > 0)
    .map(([item_id, quantity]) => ({ item_id, quantity }))
}

export function interactionZoneRect(ownerLayer, interaction) {
  const zone = interaction?.trigger?.zone
  if (!zone) return null
  if (zone.coordinate_space === 'world') {
    return {
      x: zone.x,
      y: zone.y,
      w: zone.w,
      h: zone.h,
      coordinate_space: 'world',
    }
  }
  const position = ownerLayer?.transform?.position ?? { x: 0, y: 0 }
  return {
    x: position.x + zone.x,
    y: position.y + zone.y,
    w: zone.w,
    h: zone.h,
    coordinate_space: ownerLayer?.transform?.coordinate_space ?? 'world',
  }
}

export function createInteractionRuntimeState({
  project = null,
  activeSceneId = project?.active_scene_id ?? null,
  playerLayerId = null,
  playerPosition: explicitPosition = null,
} = {}) {
  const scene = project?.scenes?.[activeSceneId] ?? null
  const playerLayer = playerLayerId ? layerById(scene, playerLayerId) : null
  const position = explicitPosition ?? playerLayer?.transform?.position ?? { x: 0, y: 0 }
  return {
    activeSceneId,
    flags: {},
    inventory: [],
    player: {
      layer_id: playerLayerId,
      x: Number(position.x) || 0,
      y: Number(position.y) || 0,
    },
    camera: {},
    interactions: {},
    layerOverrides: {},
    messages: [],
    last_event: null,
  }
}

export function applyPlaytestLayerOverrides(scene, runtime) {
  const next = clonePlain(scene)
  if (!next) return next
  next.layers = (next.layers ?? []).map((layer) => {
    const override = runtime?.layerOverrides?.[layer.id]
    if (!override) return layer
    return {
      ...layer,
      ...(override.visible != null ? { visible: Boolean(override.visible) } : {}),
      ...(override.clip_id ? { clip_id: override.clip_id } : {}),
    }
  })
  return next
}

export function shouldTriggerInteraction(project, runtime, ownerLayer, event = {}) {
  const scene = activeScene(project, runtime)
  const interaction = ownerLayer?.interaction
  const trigger = interaction?.trigger
  if (!scene || !interaction?.enabled || !trigger) return false
  if (!conditionMatches(scene, runtime, trigger.condition)) return false
  if (trigger.type !== event.type) return false

  if (trigger.type === 'near_key' && trigger.key && trigger.key !== event.key) return false
  if (trigger.type === 'near_click' || trigger.type === 'near_key') {
    const point = event.point ?? playerPosition(runtime)
    const zone = interactionZoneRect(ownerLayer, interaction)
    if (zone) return pointInRect(point, zone)
    const radius = Number(trigger.radius) || 0
    return radius <= 0 || distance(point, ownerLayer?.transform?.position ?? { x: 0, y: 0 }) <= radius
  }

  return true
}

export function runInteractionActions(project, runtime, ownerLayer, interaction, event = {}) {
  const next = clonePlain(runtime)
  const scene = activeScene(project, next)
  const emitted = []
  const mark = (action) => {
    emitted.push(action)
    return action
  }
  const fail = (reason, action) => {
    mark({ type: 'error', reason, action })
    return { runtime: next, events: emitted }
  }

  for (const action of interaction?.actions ?? []) {
    if (action.type === 'show_text') {
      const message = {
        type: 'show_text',
        text: action.text,
        duration_ms: action.duration_ms ?? null,
        owner_layer_id: ownerLayer?.id ?? null,
      }
      next.messages = [message, ...(next.messages ?? [])].slice(0, 8)
      mark(message)
    }

    if (action.type === 'play_animation') {
      const targetLayer = layerById(scene, action.target_layer_id)
      if (!targetLayer) return fail('missing_target_layer', action)
      next.layerOverrides[action.target_layer_id] = {
        ...(next.layerOverrides[action.target_layer_id] ?? {}),
        clip_id: action.clip_id,
        playing: true,
        restart: Boolean(action.restart),
      }
      mark({ type: 'play_animation', target_layer_id: action.target_layer_id, clip_id: action.clip_id, restart: Boolean(action.restart) })
    }

    if (action.type === 'toggle_layer') {
      if (!layerById(scene, action.target_layer_id)) return fail('missing_target_layer', action)
      next.layerOverrides[action.target_layer_id] = {
        ...(next.layerOverrides[action.target_layer_id] ?? {}),
        visible: action.visible,
      }
      mark({ type: 'toggle_layer', target_layer_id: action.target_layer_id, visible: action.visible })
    }

    if (action.type === 'set_state') {
      next.flags[action.key] = clonePlain(action.value)
      mark({ type: 'set_state', key: action.key, value: clonePlain(action.value) })
    }

    if (action.type === 'pickup_item') {
      next.inventory = normalizeInventory([
        ...(next.inventory ?? []),
        { item_id: action.item_id, quantity: action.quantity },
      ])
      if (action.hide_layer_id) {
        next.layerOverrides[action.hide_layer_id] = {
          ...(next.layerOverrides[action.hide_layer_id] ?? {}),
          visible: false,
        }
      }
      mark({ type: 'pickup_item', item_id: action.item_id, quantity: action.quantity, hide_layer_id: action.hide_layer_id ?? null })
    }

    if (action.type === 'scene_link') {
      const targetScene = project?.scenes?.[action.target_scene_id]
      const spawn = spawnById(targetScene, action.target_spawn_id)
      if (!targetScene || !spawn) return fail('missing_target_scene_or_spawn', action)
      next.activeSceneId = targetScene.id
      next.player = {
        ...(next.player ?? {}),
        x: spawn.position?.x ?? next.player?.x ?? 0,
        y: spawn.position?.y ?? next.player?.y ?? 0,
      }
      mark({ type: 'scene_link', target_scene_id: targetScene.id, target_spawn_id: spawn.id })
      break
    }
  }

  next.interactions[ownerLayer.id] = {
    count: (next.interactions?.[ownerLayer.id]?.count ?? 0) + 1,
    last_trigger: event.type ?? null,
  }
  next.last_event = {
    owner_layer_id: ownerLayer.id,
    trigger: event.type ?? null,
    events: emitted,
  }
  return { runtime: next, events: emitted }
}

export function triggerInteractions(project, runtime, event = {}) {
  let next = clonePlain(runtime ?? createInteractionRuntimeState({ project }))
  const scene = activeScene(project, next)
  const emitted = []
  if (!scene) return { runtime: next, events: emitted }

  for (const layer of scene.layers ?? []) {
    if (!shouldTriggerInteraction(project, next, layer, event)) continue
    const result = runInteractionActions(project, next, layer, layer.interaction, event)
    next = result.runtime
    emitted.push(...result.events)
    if (result.events.some((item) => item.type === 'scene_link' || item.type === 'error')) break
  }

  return { runtime: next, events: emitted }
}
