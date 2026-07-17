import {
  getAnimationNameForIntent,
  getMovementIntent,
  movePreviewActor,
} from '../character-pack/playablePreview.js'

const DEFAULT_OPTIONS = Object.freeze({
  moveSpeed: 72,
  animationRate: 1,
  movingFollowSeconds: 0.18,
  stoppedSettleSeconds: 0.3,
  cameraClamp: true,
})

const MAX_DELTA_MS = 100
const MIN_CAMERA_RESPONSE_SECONDS = 0.001
const DIRECTIONS = new Set(['down', 'up', 'left', 'right'])

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback
}

function positive(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function normalizeOptions(options = {}) {
  return {
    moveSpeed: positive(options.moveSpeed, DEFAULT_OPTIONS.moveSpeed),
    animationRate: positive(options.animationRate, DEFAULT_OPTIONS.animationRate),
    movingFollowSeconds: Math.max(
      MIN_CAMERA_RESPONSE_SECONDS,
      positive(options.movingFollowSeconds, DEFAULT_OPTIONS.movingFollowSeconds),
    ),
    stoppedSettleSeconds: Math.max(
      MIN_CAMERA_RESPONSE_SECONDS,
      positive(options.stoppedSettleSeconds, DEFAULT_OPTIONS.stoppedSettleSeconds),
    ),
    cameraClamp: options.cameraClamp !== false,
  }
}

function worldBounds(scene) {
  return {
    maxX: Math.max(0, finite(scene?.world?.w)),
    maxY: Math.max(0, finite(scene?.world?.h)),
  }
}

function cameraBounds(scene, zoom) {
  const world = worldBounds(scene)
  return {
    maxX: Math.max(0, world.maxX - positive(scene?.viewport?.w, 0) / zoom),
    maxY: Math.max(0, world.maxY - positive(scene?.viewport?.h, 0) / zoom),
  }
}

function clampCamera(camera, scene, enabled) {
  const next = {
    ...camera,
    velocity: {
      x: finite(camera?.velocity?.x),
      y: finite(camera?.velocity?.y),
    },
  }
  if (!enabled) return next
  const bounds = cameraBounds(scene, camera.zoom)
  next.x = clamp(camera.x, 0, bounds.maxX)
  next.y = clamp(camera.y, 0, bounds.maxY)
  if ((next.x === 0 && next.velocity.x < 0) || (next.x === bounds.maxX && next.velocity.x > 0)) {
    next.velocity.x = 0
  }
  if ((next.y === 0 && next.velocity.y < 0) || (next.y === bounds.maxY && next.velocity.y > 0)) {
    next.velocity.y = 0
  }
  return next
}

function playerLayer(scene, playerLayerId) {
  return scene?.layers?.find((layer) => layer.id === playerLayerId) ?? null
}

function playableCharacterLayer(layer, assets) {
  return Boolean(
    layer &&
    layer.visible !== false &&
    layer.type === 'character' &&
    assets?.[layer.asset_id]?.kind === 'character_pack'
  )
}

export function resolvePlaytestScenePlayerLayer(sourceScene, targetScene, playerLayerId, assets = {}) {
  const sourcePlayer = playerLayer(sourceScene, playerLayerId)
  if (!playableCharacterLayer(sourcePlayer, assets)) return null
  const candidates = (targetScene?.layers ?? []).filter((layer) => (
    playableCharacterLayer(layer, assets) && layer.asset_id === sourcePlayer.asset_id
  ))
  return candidates.find((layer) => layer.id === playerLayerId) ?? candidates[0] ?? null
}

function directionFromClip(clipId) {
  const direction = typeof clipId === 'string' ? clipId.match(/_(down|up|left|right)$/)?.[1] : null
  return DIRECTIONS.has(direction) ? direction : 'down'
}

function pressedKeySet(pressedKeys) {
  if (pressedKeys instanceof Set) return pressedKeys
  if (Array.isArray(pressedKeys)) return new Set(pressedKeys)
  if (pressedKeys && typeof pressedKeys[Symbol.iterator] === 'function') return new Set(pressedKeys)
  return new Set()
}

function collectAnimationIds(value, target, { mapped = false } = {}) {
  if (!value) return
  if (typeof value === 'string') {
    target.add(value)
    return
  }
  if (Array.isArray(value)) {
    for (const descriptor of value) collectAnimationIds(descriptor, target)
    return
  }
  if (typeof value !== 'object') return

  const descriptorId = value.id ?? value.name ?? value.clip_id
  if (typeof descriptorId === 'string') target.add(descriptorId)

  for (const [key, descriptor] of Object.entries(value)) {
    if (['animations', 'clips', 'animation_descriptors'].includes(key)) {
      collectAnimationIds(descriptor, target, { mapped: true })
      continue
    }
    if (mapped) target.add(key)
    if (descriptor && typeof descriptor === 'object' && !Array.isArray(descriptor)) {
      const id = descriptor.id ?? descriptor.name ?? descriptor.clip_id
      if (typeof id === 'string') target.add(id)
    }
  }
}

function availableAnimationIds(asset) {
  const ids = new Set()
  collectAnimationIds(asset?.clips, ids, { mapped: !Array.isArray(asset?.clips) })
  collectAnimationIds(asset?.animations, ids, { mapped: !Array.isArray(asset?.animations) })
  collectAnimationIds(asset?.animation_descriptors, ids, {
    mapped: !Array.isArray(asset?.animation_descriptors),
  })
  return ids
}

function stepCriticalDamping(current, velocity, target, deltaSeconds, responseSeconds) {
  const distance = target - current
  let resolvedVelocity = finite(velocity)
  if (!distance || resolvedVelocity * distance < 0) resolvedVelocity = 0
  if (!deltaSeconds) return { value: current, velocity: resolvedVelocity }

  const omega = 1 / responseSeconds
  const displacement = current - target
  const coefficient = resolvedVelocity + omega * displacement
  const decay = Math.exp(-omega * deltaSeconds)
  const nextDisplacement = (displacement + coefficient * deltaSeconds) * decay
  const nextVelocity = (resolvedVelocity - omega * coefficient * deltaSeconds) * decay
  const nextValue = target + nextDisplacement

  if (distance * (target - nextValue) < 0) {
    return { value: target, velocity: 0 }
  }
  return { value: nextValue, velocity: nextVelocity }
}

export function resolveDirectionalClip(asset, direction, moving, fallbackClipId = null) {
  const resolvedDirection = DIRECTIONS.has(direction) ? direction : 'down'
  const requestedClipId = getAnimationNameForIntent({ direction: resolvedDirection, moving }, 'down')
  const available = availableAnimationIds(asset)
  if (available.has(requestedClipId)) {
    return {
      clip_id: requestedClipId,
      requested_clip_id: requestedClipId,
      issue: null,
    }
  }
  return {
    clip_id: typeof fallbackClipId === 'string' && available.has(fallbackClipId) ? fallbackClipId : null,
    requested_clip_id: requestedClipId,
    issue: 'missing_directional_clip',
  }
}

export function createPlaytestControllerState({ scene, playerLayerId, options } = {}) {
  const resolvedOptions = normalizeOptions(options)
  const layer = playerLayer(scene, playerLayerId)
  const bounds = worldBounds(scene)
  const position = layer?.transform?.position ?? { x: 0, y: 0 }
  const zoom = positive(scene?.camera?.zoom, 1)
  const camera = clampCamera({
    x: finite(scene?.camera?.x),
    y: finite(scene?.camera?.y),
    zoom,
    velocity: { x: 0, y: 0 },
  }, scene, resolvedOptions.cameraClamp)

  return {
    player: {
      layer_id: playerLayerId ?? null,
      x: clamp(finite(position.x), 0, bounds.maxX),
      y: clamp(finite(position.y), 0, bounds.maxY),
      direction: directionFromClip(layer?.clip_id),
      moving: false,
      clip_id: layer?.clip_id ?? null,
    },
    camera,
    options: resolvedOptions,
    diagnostics: layer ? [] : ['missing_player_layer'],
  }
}

export function transitionPlaytestControllerScene(runtime, sourceScene, targetScene, assets = {}) {
  const layer = resolvePlaytestScenePlayerLayer(
    sourceScene,
    targetScene,
    runtime?.player?.layer_id,
    assets,
  )
  if (!layer) return null
  const controller = createPlaytestControllerState({
    scene: targetScene,
    playerLayerId: layer.id,
    options: runtime?.options,
  })
  return {
    ...runtime,
    ...controller,
    activeSceneId: targetScene.id,
    player: {
      ...controller.player,
      x: finite(runtime?.player?.x, controller.player.x),
      y: finite(runtime?.player?.y, controller.player.y),
    },
  }
}

export function tickPlaytestController(state, pressedKeys, deltaMs, scene, assets = {}) {
  const current = state ?? createPlaytestControllerState({ scene })
  const options = normalizeOptions(current.options)
  const layer = playerLayer(scene, current.player?.layer_id)
  const bounds = worldBounds(scene)
  const safeDeltaMs = Number.isFinite(deltaMs) ? clamp(deltaMs, 0, MAX_DELTA_MS) : 0
  const intent = getMovementIntent(pressedKeySet(pressedKeys), current.player?.direction ?? 'down')
  const position = movePreviewActor({
    x: finite(current.player?.x),
    y: finite(current.player?.y),
  }, intent, {
    deltaMs: safeDeltaMs,
    speed: options.moveSpeed,
    minX: 0,
    maxX: bounds.maxX,
    minY: 0,
    maxY: bounds.maxY,
  })

  const asset = layer ? assets?.[layer.asset_id] : null
  const clip = resolveDirectionalClip(asset, intent.direction, intent.moving, current.player?.clip_id)
  const zoom = positive(current.camera?.zoom, positive(scene?.camera?.zoom, 1))
  const cameraLimit = cameraBounds(scene, zoom)
  const cameraTarget = {
    x: position.x - positive(scene?.viewport?.w, 0) / (2 * zoom),
    y: position.y - positive(scene?.viewport?.h, 0) / (2 * zoom),
  }
  if (options.cameraClamp) {
    cameraTarget.x = clamp(cameraTarget.x, 0, cameraLimit.maxX)
    cameraTarget.y = clamp(cameraTarget.y, 0, cameraLimit.maxY)
  }
  const responseSeconds = intent.moving
    ? options.movingFollowSeconds
    : options.stoppedSettleSeconds
  const deltaSeconds = safeDeltaMs / 1000
  const nextCameraX = stepCriticalDamping(
    finite(current.camera?.x, finite(scene?.camera?.x)),
    current.camera?.velocity?.x,
    cameraTarget.x,
    deltaSeconds,
    responseSeconds,
  )
  const nextCameraY = stepCriticalDamping(
    finite(current.camera?.y, finite(scene?.camera?.y)),
    current.camera?.velocity?.y,
    cameraTarget.y,
    deltaSeconds,
    responseSeconds,
  )
  const camera = clampCamera({
    x: nextCameraX.value,
    y: nextCameraY.value,
    zoom,
    velocity: {
      x: nextCameraX.velocity,
      y: nextCameraY.velocity,
    },
  }, scene, options.cameraClamp)

  const diagnostics = []
  if (!layer) diagnostics.push('missing_player_layer')
  else if (!asset) diagnostics.push('missing_player_asset')
  if (clip.issue) diagnostics.push(clip.issue)

  return {
    player: {
      layer_id: current.player?.layer_id ?? null,
      x: position.x,
      y: position.y,
      direction: intent.direction,
      moving: intent.moving,
      clip_id: clip.clip_id,
    },
    camera,
    options,
    diagnostics,
  }
}
