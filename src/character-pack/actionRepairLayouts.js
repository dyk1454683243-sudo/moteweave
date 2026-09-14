import {
  FIXED_REGION_SOURCE_ACTION_REGION_KEYS,
  FIXED_REGION_SOURCE_REGIONS,
  FIXED_REGION_SOURCE_SHEET,
} from './fixedRegionGeometry.js'
import { OCAD_SOURCE_ACTIONS, OCAD_SOURCE_ACTION_ORDER } from './ocadSourceActions.js'
import { TOPDOWN_RPG_V0 } from './profile.js'
import {
  FIXED_REGION_MOTION_LAYOUT_ID,
  LEGACY_OCAD_MOTION_LAYOUT_ID,
  TOPDOWN_RPG_SOURCE_LAYOUT_ID,
} from './sourceLayoutIds.js'

function facingForAction(action = '') {
  if (action.endsWith('_up') || action === 'idleup' || action === 'walkup' || action === 'runup' || action === 'climb') return 'back'
  if (action.endsWith('_left') || action === 'idleL' || action === 'walkL' || action === 'runL' || action === 'attractL') return 'left'
  if (action.endsWith('_right')) return 'right'
  return 'front'
}

const TOPDOWN_ACTION_REGION_KEYS = Object.freeze(Object.fromEntries(
  TOPDOWN_RPG_V0.animations.map((animation) => [
    animation.name,
    Object.freeze(Array.from({ length: animation.count }, (_, slot) => `${animation.name}_${slot}`)),
  ]),
))

const TOPDOWN_REGIONS = Object.freeze(Object.fromEntries(
  TOPDOWN_RPG_V0.animations.flatMap((animation) => (
    TOPDOWN_ACTION_REGION_KEYS[animation.name].map((key, slot) => [
      key,
      Object.freeze({
        x: (animation.startCol + slot) * TOPDOWN_RPG_V0.frame.w,
        y: animation.row * TOPDOWN_RPG_V0.frame.h,
        w: TOPDOWN_RPG_V0.frame.w,
        h: TOPDOWN_RPG_V0.frame.h,
      }),
    ])
  )),
))

const TOPDOWN_ACTIONS = Object.freeze(Object.fromEntries(
  TOPDOWN_RPG_V0.animations.map((animation) => [
    animation.name,
    Object.freeze({
      action: animation.name,
      label: animation.name.replaceAll('_', ' '),
      loop: animation.loop,
      fps: animation.fps,
    }),
  ]),
))

function actionByRegion(actionRegionKeys) {
  return Object.freeze(Object.fromEntries(
    Object.entries(actionRegionKeys).flatMap(([action, keys]) => keys.map((key) => [key, action])),
  ))
}

const FIXED_REGION_ANCHOR_PRIORITY = Object.freeze([
  'rundown0', 'rundown2', 'rundown3', 'rundown5',
  'walkdown0', 'walkdown2', 'walkdown3', 'walkdown5', 'idledown',
  'runup4', 'runup2', 'walkup2', 'walkup4', 'idleup', 'climb2', 'climb4',
  'runL2', 'runL4', 'walkL2', 'walkL4', 'idleL', 'attractL2', 'attractL5',
])

const TOPDOWN_ANCHOR_PRIORITY = Object.freeze([
  ...['idle_down', 'idle_up', 'idle_left', 'idle_right'],
  ...['walk_down', 'walk_up', 'walk_left', 'walk_right'],
  ...TOPDOWN_RPG_V0.animations.map((animation) => animation.name),
].flatMap((action) => TOPDOWN_ACTION_REGION_KEYS[action] ?? []))

const ACTION_REPAIR_LAYOUTS = Object.freeze({
  [TOPDOWN_RPG_SOURCE_LAYOUT_ID]: Object.freeze({
    id: TOPDOWN_RPG_SOURCE_LAYOUT_ID,
    sheet: Object.freeze({ ...TOPDOWN_RPG_V0.sheet }),
    template_size: Object.freeze({ w: 256, h: 256 }),
    template_preset: TOPDOWN_RPG_SOURCE_LAYOUT_ID,
    actions: TOPDOWN_ACTIONS,
    action_order: Object.freeze(TOPDOWN_RPG_V0.animations.map((animation) => animation.name)),
    action_region_keys: TOPDOWN_ACTION_REGION_KEYS,
    regions: TOPDOWN_REGIONS,
    action_by_region: actionByRegion(TOPDOWN_ACTION_REGION_KEYS),
    anchor_priority: TOPDOWN_ANCHOR_PRIORITY,
  }),
  [FIXED_REGION_MOTION_LAYOUT_ID]: Object.freeze({
    id: FIXED_REGION_MOTION_LAYOUT_ID,
    sheet: FIXED_REGION_SOURCE_SHEET,
    template_size: FIXED_REGION_SOURCE_SHEET,
    template_preset: FIXED_REGION_MOTION_LAYOUT_ID,
    actions: OCAD_SOURCE_ACTIONS,
    action_order: OCAD_SOURCE_ACTION_ORDER,
    action_region_keys: FIXED_REGION_SOURCE_ACTION_REGION_KEYS,
    regions: FIXED_REGION_SOURCE_REGIONS,
    action_by_region: actionByRegion(FIXED_REGION_SOURCE_ACTION_REGION_KEYS),
    anchor_priority: FIXED_REGION_ANCHOR_PRIORITY,
  }),
})

export const ACTION_REPAIR_SOURCE_LAYOUT_IDS = Object.freeze(Object.keys(ACTION_REPAIR_LAYOUTS))

export function canonicalActionRepairSourceLayoutId(value = '') {
  const id = String(value || '').trim()
  return id === LEGACY_OCAD_MOTION_LAYOUT_ID ? FIXED_REGION_MOTION_LAYOUT_ID : id
}

export function isActionRepairSourceLayoutId(value) {
  return Object.hasOwn(ACTION_REPAIR_LAYOUTS, canonicalActionRepairSourceLayoutId(value))
}

export function resolveActionRepairLayout(value) {
  const id = canonicalActionRepairSourceLayoutId(value)
  const layout = ACTION_REPAIR_LAYOUTS[id]
  if (!layout) throw new Error(`unsupported action repair source layout: ${id || '(empty)'}`)
  return layout
}

export function normalizeActionRepairActions(sourceLayoutId, actions = []) {
  const layout = resolveActionRepairLayout(sourceLayoutId)
  const raw = Array.isArray(actions) ? actions : [actions]
  const unique = []
  for (const action of raw.map((item) => String(item ?? '').trim()).filter(Boolean)) {
    if (!Object.hasOwn(layout.actions, action)) {
      throw new Error(`unknown ${layout.id} source action: ${action}`)
    }
    if (!unique.includes(action)) unique.push(action)
  }
  if (!unique.length) throw new Error(`at least one ${layout.id} source action is required`)
  return unique
}

export function normalizeActionRepairRegionKeys(sourceLayoutId, regionKeys = []) {
  const layout = resolveActionRepairLayout(sourceLayoutId)
  const raw = Array.isArray(regionKeys) ? regionKeys : [regionKeys]
  const unique = []
  for (const key of raw.map((item) => String(item ?? '').trim()).filter(Boolean)) {
    if (!Object.hasOwn(layout.regions, key)) {
      throw new Error(`unknown ${layout.id} source region: ${key}`)
    }
    if (!unique.includes(key)) unique.push(key)
  }
  if (!unique.length) throw new Error(`at least one ${layout.id} source region is required`)
  return unique
}

export function actionRepairRegionKeysForActions(sourceLayoutId, actions = []) {
  const layout = resolveActionRepairLayout(sourceLayoutId)
  return normalizeActionRepairActions(sourceLayoutId, actions)
    .flatMap((action) => layout.action_region_keys[action] ?? [])
}

export function selectedActionRepairRegionKeys(sourceLayoutId, actions, regionKeys = null) {
  const expanded = actionRepairRegionKeysForActions(sourceLayoutId, actions)
  if (regionKeys == null) return expanded
  const exact = normalizeActionRepairRegionKeys(sourceLayoutId, regionKeys)
  const allowed = new Set(expanded)
  if (exact.some((key) => !allowed.has(key))) {
    throw new Error(`${sourceLayoutId} source regions must belong to the selected actions`)
  }
  return exact
}

export function actionRepairActionForRegion(sourceLayoutId, regionKey) {
  return resolveActionRepairLayout(sourceLayoutId).action_by_region[regionKey] ?? null
}

export function actionRepairFacingForRegion(sourceLayoutId, regionKey) {
  return facingForAction(actionRepairActionForRegion(sourceLayoutId, regionKey) ?? '')
}

export function actionRepairActionLabel(sourceLayoutId, action) {
  const info = resolveActionRepairLayout(sourceLayoutId).actions[action]
  return info?.zh ? `${action} (${info.label}, ${info.zh})` : info?.label ? `${action} (${info.label})` : action
}

export function scaleActionRepairRegion(sourceLayoutId, regionKey, image) {
  const layout = resolveActionRepairLayout(sourceLayoutId)
  const region = layout.regions[regionKey]
  if (!region || !image?.width || !image?.height) throw new Error('action repair region and image are required')
  const scaleX = image.width / layout.sheet.w
  const scaleY = image.height / layout.sheet.h
  const x = Math.round(region.x * scaleX)
  const y = Math.round(region.y * scaleY)
  const right = Math.round((region.x + region.w) * scaleX)
  const bottom = Math.round((region.y + region.h) * scaleY)
  return {
    x: Math.max(0, Math.min(image.width - 1, x)),
    y: Math.max(0, Math.min(image.height - 1, y)),
    w: Math.max(1, Math.min(image.width - x, right - x)),
    h: Math.max(1, Math.min(image.height - y, bottom - y)),
  }
}

export function actionRepairRegionKeyForFrameIndex(sourceLayoutId, frameIndex) {
  if (!Number.isInteger(frameIndex) || frameIndex < 0 || frameIndex >= 64) return null
  const layout = resolveActionRepairLayout(sourceLayoutId)
  if (layout.id !== TOPDOWN_RPG_SOURCE_LAYOUT_ID) return null
  const row = Math.floor(frameIndex / TOPDOWN_RPG_V0.grid.columns)
  const col = frameIndex % TOPDOWN_RPG_V0.grid.columns
  const animation = TOPDOWN_RPG_V0.animations.find((item) => (
    item.row === row && col >= item.startCol && col < item.startCol + item.count
  ))
  return animation ? TOPDOWN_ACTION_REGION_KEYS[animation.name][col - animation.startCol] : null
}

export function actionRepairIdentityAnchorKeys(sourceLayoutId, selectedRegionKeys = [], requiredFacings = [], limit = 8) {
  const layout = resolveActionRepairLayout(sourceLayoutId)
  const selected = new Set(selectedRegionKeys)
  const result = []
  for (const facing of requiredFacings) {
    for (const key of layout.anchor_priority) {
      if (selected.has(key) || result.includes(key) || actionRepairFacingForRegion(layout.id, key) !== facing) continue
      result.push(key)
      if (result.filter((item) => actionRepairFacingForRegion(layout.id, item) === facing).length >= 2) break
    }
  }
  for (const key of layout.anchor_priority) {
    if (!selected.has(key) && !result.includes(key)) result.push(key)
    if (result.length >= limit) break
  }
  return result.slice(0, limit)
}

export function actionRepairEquipmentLayout(sourceLayoutId) {
  const layout = resolveActionRepairLayout(sourceLayoutId)
  return {
    id: layout.id,
    kind: 'action_repair_regions',
    sheet: layout.sheet,
    regions: layout.regions,
  }
}
