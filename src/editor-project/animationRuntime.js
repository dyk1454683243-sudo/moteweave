const DEFAULT_PLAYBACK = {
  activation: 'auto',
  loop_mode: 'loop',
  rate: 1,
  start_offset_ms: 0,
  initially_paused: false,
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value))
}

function firstKey(value) {
  return Object.keys(value ?? {})[0] ?? null
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function positive(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function playbackSignature(playback) {
  return [
    playback.activation,
    playback.loop_mode,
    playback.rate,
    playback.start_offset_ms,
    playback.initially_paused,
  ].join(':')
}

export function createAnimationRuntimeState(nowMs = 0) {
  return {
    playing: false,
    last_tick_ms: nowMs,
    layer_clocks: {},
  }
}

export function resolveLayerClip(layer, asset) {
  const clipId = layer?.clip_id ?? firstKey(asset?.clips)
  const clip = clipId ? asset?.clips?.[clipId] : null
  if (!layer || !asset || !clip) {
    return {
      playable: false,
      layer,
      asset,
      clip: null,
      clip_id: clipId ?? null,
      playback: clone(layer?.playback ?? DEFAULT_PLAYBACK),
      frame_count: 0,
      duration_ms: 0,
      issue: !asset ? 'missing_asset' : 'missing_clip',
    }
  }
  const frames = Array.isArray(clip.frames) ? clip.frames : []
  const fps = positive(clip.fps, 1)
  const durationMs = frames.length ? (frames.length / fps) * 1000 : 0
  return {
    playable: frames.length > 0,
    layer,
    asset,
    clip,
    clip_id: clip.id,
    playback: {
      ...DEFAULT_PLAYBACK,
      loop_mode: clip.loop_mode ?? DEFAULT_PLAYBACK.loop_mode,
      ...clone(layer.playback ?? {}),
    },
    frame_count: frames.length,
    duration_ms: durationMs,
    issue: frames.length ? null : 'empty_clip',
  }
}

export function syncAnimationRuntime(runtime, scene, assets = {}, nowMs = runtime?.last_tick_ms ?? 0) {
  const next = runtime ? clone(runtime) : createAnimationRuntimeState(nowMs)
  next.layer_clocks = {}
  next.last_tick_ms = nowMs
  for (const layer of scene?.layers ?? []) {
    const resolved = resolveLayerClip(layer, assets[layer.asset_id])
    if (!resolved.playable) continue
    const previous = runtime?.layer_clocks?.[layer.id]
    const resetElapsed = resolved.playback.start_offset_ms ?? 0
    const previousMatches = previous?.clip_id === resolved.clip_id
    next.layer_clocks[layer.id] = previousMatches
      ? {
          ...previous,
          playback_signature: playbackSignature(resolved.playback),
        }
      : {
          layer_id: layer.id,
          clip_id: resolved.clip_id,
          elapsed_ms: resetElapsed,
          layer_playing: false,
          last_frame_index: 0,
          playback_signature: playbackSignature(resolved.playback),
        }
  }
  return next
}

export function setRuntimePlaying(runtime, playing, nowMs = runtime?.last_tick_ms ?? 0) {
  return {
    ...clone(runtime ?? createAnimationRuntimeState(nowMs)),
    playing: Boolean(playing),
    last_tick_ms: nowMs,
  }
}

export function setLayerClockPlaying(runtime, layerId, playing) {
  const next = clone(runtime ?? createAnimationRuntimeState())
  if (!next.layer_clocks?.[layerId]) return next
  next.layer_clocks[layerId].layer_playing = Boolean(playing)
  return next
}

export function setLayerElapsed(runtime, layerId, elapsedMs) {
  const next = clone(runtime ?? createAnimationRuntimeState())
  if (!next.layer_clocks?.[layerId]) return next
  next.layer_clocks[layerId].elapsed_ms = Math.max(0, Number(elapsedMs) || 0)
  next.layer_clocks[layerId].layer_playing = false
  return next
}

export function resetLayerElapsed(runtime, layerId, playback = DEFAULT_PLAYBACK) {
  return setLayerElapsed(runtime, layerId, playback.start_offset_ms ?? 0)
}

export function isLayerClockRunning(runtime, layer, playback = DEFAULT_PLAYBACK) {
  const clock = runtime?.layer_clocks?.[layer?.id]
  if (!clock) return false
  if (clock.layer_playing) return true
  return Boolean(runtime.playing && playback.activation === 'auto' && !playback.initially_paused)
}

export function runtimeHasActiveClocks(runtime, scene, assets = {}) {
  return (scene?.layers ?? []).some((layer) => {
    const resolved = resolveLayerClip(layer, assets[layer.asset_id])
    return resolved.playable && isLayerClockRunning(runtime, layer, resolved.playback)
  })
}

export function tickAnimationRuntime(runtime, scene, assets = {}, nowMs) {
  const synced = syncAnimationRuntime(runtime, scene, assets, runtime?.last_tick_ms ?? nowMs)
  const delta = Math.max(0, nowMs - (synced.last_tick_ms ?? nowMs))
  const next = clone(synced)
  next.last_tick_ms = nowMs
  if (!delta) return next
  for (const layer of scene?.layers ?? []) {
    const resolved = resolveLayerClip(layer, assets[layer.asset_id])
    const clock = next.layer_clocks[layer.id]
    if (!resolved.playable || !clock) continue
    if (!isLayerClockRunning(next, layer, resolved.playback)) continue
    clock.elapsed_ms += delta * positive(resolved.playback.rate, 1)
    clock.last_frame_index = resolveFrameIndex(resolved, clock.elapsed_ms)
  }
  return next
}

export function resolveFrameIndex(resolved, elapsedMs) {
  const frameCount = resolved?.frame_count ?? 0
  if (!frameCount) return 0
  const fps = positive(resolved.clip?.fps, 1)
  const frame = Math.floor(Math.max(0, elapsedMs) / (1000 / fps))
  if (resolved.playback.loop_mode === 'once') return clamp(frame, 0, frameCount - 1)
  if (resolved.playback.loop_mode === 'ping_pong') {
    if (frameCount === 1) return 0
    const cycle = frameCount * 2 - 2
    const position = frame % cycle
    return position >= frameCount ? cycle - position : position
  }
  return frame % frameCount
}

export function frameStateForLayer(runtime, layer, asset) {
  const resolved = resolveLayerClip(layer, asset)
  const clock = runtime?.layer_clocks?.[layer?.id]
  if (!resolved.playable || !clock) {
    return {
      ...resolved,
      frame_index: 0,
      frame_number: null,
      elapsed_ms: 0,
      running: false,
    }
  }
  const frameIndex = resolveFrameIndex(resolved, clock.elapsed_ms)
  return {
    ...resolved,
    frame_index: frameIndex,
    frame_number: resolved.clip.frames[frameIndex],
    elapsed_ms: clock.elapsed_ms,
    running: isLayerClockRunning(runtime, layer, resolved.playback),
  }
}
