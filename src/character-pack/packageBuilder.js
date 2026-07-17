import { buildAnimations } from './animations.js'
import { TOPDOWN_RPG_V0 } from './profile.js'

function pad2(value) {
  return String(value).padStart(2, '0')
}

function slugify(value) {
  return String(value ?? 'character')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48) || 'character'
}

function timestampParts(value) {
  if (typeof value === 'string') {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2}):(\d{2})/)
    if (match) {
      const [, yyyy, mm, dd, hh, min, ss] = match
      return { yyyy, mm, dd, hh, min, ss }
    }
  }

  const date = value instanceof Date ? value : new Date(value)
  return {
    yyyy: date.getUTCFullYear(),
    mm: pad2(date.getUTCMonth() + 1),
    dd: pad2(date.getUTCDate()),
    hh: pad2(date.getUTCHours()),
    min: pad2(date.getUTCMinutes()),
    ss: pad2(date.getUTCSeconds()),
  }
}

export function buildPackageId(name, date = new Date()) {
  const { yyyy, mm, dd, hh, min, ss } = timestampParts(date)
  return `npc_${yyyy}${mm}${dd}_${hh}${min}${ss}_${slugify(name)}`
}

export function buildAnimationsJson(profile = TOPDOWN_RPG_V0, options = {}) {
  const animationSemantics = options.animationSemantics ?? {}
  const animations = buildAnimations(profile)
  for (const [name, semantics] of Object.entries(animationSemantics)) {
    if (!animations[name]) continue
    animations[name] = { ...animations[name], ...semantics }
  }
  return {
    version: profile.version,
    profile: profile.id,
    ...(options.sourceLayout ? { source_layout: options.sourceLayout } : {}),
    sheet: 'normalized_sheet.png',
    frame_size: { ...profile.frame },
    sheet_size: { ...profile.sheet },
    anchor: { x: profile.anchor.x, y: profile.anchor.y },
    animations,
  }
}

export function buildMetadataJson({
  id,
  name,
  description,
  createdAt,
  source,
  generation = { provider: null, model: null, prompt_file: null },
  quality = { status: 'pass', warnings: [], blocking_errors: [] },
  profile = TOPDOWN_RPG_V0,
}) {
  return {
    version: profile.version,
    id,
    name,
    description,
    created_at: createdAt,
    profile: profile.id,
    source,
    generation,
    quality,
  }
}

function frameKey(index) {
  return `frame_${String(index).padStart(3, '0')}`
}

function roundPoint(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.round(number) : fallback
}

function clampPoint(point, profile) {
  return {
    x: Math.max(0, Math.min(profile.frame.w - 1, roundPoint(point?.x, profile.anchor.x))),
    y: Math.max(0, Math.min(profile.frame.h - 1, roundPoint(point?.y, profile.anchor.y))),
  }
}

function findAnimationForFrame(index, animations = {}) {
  for (const [name, animation] of Object.entries(animations)) {
    if (animation.frames?.includes(index)) return { name, animation }
  }
  return null
}

function frameRect(index, profile) {
  const col = index % profile.grid.columns
  const row = Math.floor(index / profile.grid.columns)
  return {
    x: col * profile.frame.w,
    y: row * profile.frame.h,
    w: profile.frame.w,
    h: profile.frame.h,
  }
}

function sourceMetadata(frame) {
  const meta = frame.source_meta ?? {}
  const layout = meta.source_layout ?? null
  const source = layout ? { layout } : { layout: 'topdown_rpg_v0' }
  if (meta.runtime_action) source.runtime_action = meta.runtime_action
  if (meta.source_action) source.action = meta.source_action
  if (meta.source_region_key) source.region_key = meta.source_region_key
  if (Number.isFinite(meta.source_frame)) source.frame = meta.source_frame
  if (typeof meta.flip_h === 'boolean') source.flip_h = meta.flip_h
  return source
}

function bboxPoint(bbox, xRatio, yRatio) {
  if (!bbox) return null
  return {
    x: bbox.x + bbox.w * xRatio,
    y: bbox.y + bbox.h * yRatio,
  }
}

function attachmentsForFrame(frame, profile) {
  const bbox = frame.normalized_bbox
  const attachments = [
    { name: 'feet', point: clampPoint(frame.normalized_anchor ?? profile.anchor, profile), space: 'frame' },
  ]
  if (bbox) {
    attachments.push(
      { name: 'head', point: clampPoint({ x: bbox.centerX ?? bbox.x + bbox.w / 2, y: bbox.y }, profile), space: 'frame' },
      { name: 'hand_left', point: clampPoint(bboxPoint(bbox, 0.2, 0.55), profile), space: 'frame' },
      { name: 'hand_right', point: clampPoint(bboxPoint(bbox, 0.8, 0.55), profile), space: 'frame' }
    )
  }
  if (frame.source_anchor) {
    attachments.push({ name: 'source_feet', point: clampPoint(frame.source_anchor, profile), space: 'source_frame' })
  }
  return attachments.map((attachment) => ({ ...attachment, frame: frame.index }))
}

function boundsSliceForFrame(frame) {
  const bbox = frame.normalized_bbox
  if (!bbox) return null
  return {
    name: `${frameKey(frame.index)}_bounds`,
    frame: frame.index,
    rect: { x: bbox.x, y: bbox.y, w: bbox.w, h: bbox.h },
    space: 'frame',
  }
}

export function buildEditorMetadataJson({ metadata = {}, animationsJson = buildAnimationsJson(), frames = [], profile = TOPDOWN_RPG_V0 } = {}) {
  const animationEntries = Object.entries(animationsJson.animations ?? {})
  const frameTags = animationEntries
    .filter(([, animation]) => Array.isArray(animation.frames) && animation.frames.length)
    .map(([name, animation]) => ({
      name,
      from: animation.frames[0],
      to: animation.frames[animation.frames.length - 1],
      fps: animation.fps,
      loop: Boolean(animation.loop),
      mode: animation.mode ?? (animation.loop ? 'loop' : 'once'),
      direction: 'forward',
    }))

  const frameMap = {}
  const attachments = []
  const slices = []
  for (const frame of frames) {
    const animation = findAnimationForFrame(frame.index, animationsJson.animations)
    const fps = animation?.animation?.fps ?? 10
    frameMap[frameKey(frame.index)] = {
      index: frame.index,
      frame: frameRect(frame.index, profile),
      duration: Math.round(1000 / fps),
      runtime_action: frame.source_meta?.runtime_action ?? animation?.name ?? null,
      source: sourceMetadata(frame),
    }
    attachments.push(...attachmentsForFrame(frame, profile))
    const slice = boundsSliceForFrame(frame)
    if (slice) slices.push(slice)
  }

  return {
    version: profile.version,
    id: metadata.id ?? null,
    profile: profile.id,
    sheet: animationsJson.sheet ?? 'normalized_sheet.png',
    frame_size: { ...profile.frame },
    sheet_size: { ...profile.sheet },
    frame_tags: frameTags,
    frames: frameMap,
    attachments,
    slices,
  }
}
