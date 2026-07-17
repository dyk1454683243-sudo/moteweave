import {
  FIXED_REGION_SOURCE_REGIONS,
  getFixedRegionSourceActionRegionKeys,
} from './fixedRegionGeometry.js'
import { pixelOffset } from './imageMath.js'
import { detectAlphaBBox } from './normalizer.js'
import {
  OCAD_SOURCE_ACTIONS,
  OCAD_SOURCE_ACTION_ORDER,
  OCAD_SOURCE_ACTION_REPAIR_TARGETS,
  OCAD_SOURCE_ACTION_RUNTIME_PREVIEW,
  getOcadSourceActionList,
  isOcadSourceAction,
} from './ocadSourceActions.js'
import { getOcadTemplateHints } from './ocadTemplateAnchors.js'
import { getAnimationFrameIndexes } from './profile.js'
import {
  FIXED_REGION_MOTION_LAYOUT_ID,
  LEGACY_OCAD_MOTION_LAYOUT_ID,
  TOPDOWN_RPG_SOURCE_LAYOUT_ID,
} from './sourceLayoutIds.js'

export {
  FIXED_REGION_MOTION_LAYOUT_ID,
  LEGACY_OCAD_MOTION_LAYOUT_ID,
  TOPDOWN_RPG_SOURCE_LAYOUT_ID,
} from './sourceLayoutIds.js'
export {
  OCAD_SOURCE_ACTIONS,
  OCAD_SOURCE_ACTION_ORDER,
  OCAD_SOURCE_ACTION_REPAIR_TARGETS,
  OCAD_SOURCE_ACTION_RUNTIME_PREVIEW,
  getOcadSourceActionList,
  isOcadSourceAction,
} from './ocadSourceActions.js'

const FIXED_REGION_MOTION_LAYOUT = Object.freeze({
  id: FIXED_REGION_MOTION_LAYOUT_ID,
  label: 'Fixed-region motion sheet',
  kind: 'fixed_regions',
  sheet: { w: 252, h: 252 },
  regions: FIXED_REGION_SOURCE_REGIONS,
})

export const SOURCE_LAYOUTS = Object.freeze({
  [TOPDOWN_RPG_SOURCE_LAYOUT_ID]: Object.freeze({
    id: TOPDOWN_RPG_SOURCE_LAYOUT_ID,
    label: '8x8 uniform grid',
    kind: 'uniform_grid',
  }),
  [FIXED_REGION_MOTION_LAYOUT_ID]: FIXED_REGION_MOTION_LAYOUT,
})

const SOURCE_LAYOUT_ALIASES = Object.freeze({
  [LEGACY_OCAD_MOTION_LAYOUT_ID]: FIXED_REGION_MOTION_LAYOUT_ID,
})

const OCAD_TARGET_FRAME_SPECS = Object.freeze({
  idle_down: ['idledown', 'idledown', 'idledown', 'idledown'],
  idle_up: ['idleup', 'idleup', 'idleup', 'idleup'],
  idle_left: ['idleL', 'idleL', 'idleL', 'idleL'],
  idle_right: [
    { key: 'idleL', flipH: true },
    { key: 'idleL', flipH: true },
    { key: 'idleL', flipH: true },
    { key: 'idleL', flipH: true },
  ],
  walk_down: ['walkdown0', 'walkdown1', 'walkdown2', 'walkdown3'],
  walk_up: ['walkup0', 'walkup1', 'walkup2', 'walkup3'],
  walk_left: ['walkL0', 'walkL1', 'walkL2', 'walkL3'],
  walk_right: [
    { key: 'walkL0', flipH: true },
    { key: 'walkL1', flipH: true },
    { key: 'walkL2', flipH: true },
    { key: 'walkL3', flipH: true },
  ],
  attack_down: ['item0', 'item1', 'item0', 'item1'],
  attack_up: ['climb0', 'climb1', 'climb2', 'climb3'],
  attack_left: ['attractL0', 'attractL1', 'attractL2', 'attractL3'],
  attack_right: [
    { key: 'attractL0', flipH: true },
    { key: 'attractL1', flipH: true },
    { key: 'attractL2', flipH: true },
    { key: 'attractL3', flipH: true },
  ],
  hurt: ['defence', 'die', 'defence', 'die'],
  happy: ['item1', 'item1', 'item1', 'item1'],
  sit: ['sitdown', 'sitdown', 'sitdown', 'sitdown'],
  talk: ['item0', 'item0', 'item0', 'item0'],
})

const OCAD_ROW_PREVIEW_SPECS = Object.freeze([
  ...OCAD_SOURCE_ACTION_ORDER.map((name) => {
    const action = OCAD_SOURCE_ACTIONS[name]
    return Object.freeze({
      name,
      label: action.label,
      keys: getFixedRegionSourceActionRegionKeys(name),
      fps: action.fps,
      mode: action.loop ? 'loop' : 'once',
    })
  }),
])

const OCAD_RUNTIME_UI_HIDDEN = new Set(['attack_down', 'attack_up', 'attack_left', 'attack_right', 'hurt'])

const OCAD_RUNTIME_SEMANTIC_OVERRIDES = Object.freeze({
  happy: Object.freeze({
    display_label: 'happy',
    semantic_status: 'visual_static_alias',
  }),
  talk: Object.freeze({
    display_label: 'talk',
    semantic_status: 'visual_static_alias',
  }),
})

function sourceActionForRegionKey(key) {
  if (OCAD_SOURCE_ACTIONS[key]) return { action: key, frame: null }
  const match = String(key).match(/^(.+?)(\d+)$/)
  if (!match) return { action: key, frame: null }
  return { action: match[1], frame: Number(match[2]) }
}

export function describeOcadRegionKey(key) {
  const { action, frame } = sourceActionForRegionKey(key)
  const info = OCAD_SOURCE_ACTIONS[action] ?? { action, label: action, zh: action, loop: false }
  return {
    ...info,
    frame,
    region_key: key,
    display_label: `${info.label}${frame === null ? '' : ` ${frame}`}`,
  }
}

export function getSourceLayoutActions(sourceLayout) {
  if (!isFixedRegionMotionLayout(sourceLayout)) return []
  return getOcadSourceActionList()
}

export function canonicalSourceLayoutId(id = TOPDOWN_RPG_SOURCE_LAYOUT_ID) {
  const normalized = String(id || TOPDOWN_RPG_SOURCE_LAYOUT_ID).trim() || TOPDOWN_RPG_SOURCE_LAYOUT_ID
  return SOURCE_LAYOUT_ALIASES[normalized] ?? normalized
}

export function isFixedRegionMotionLayout(sourceLayout) {
  return sourceLayout?.id === FIXED_REGION_MOTION_LAYOUT_ID
}

export function isFixedRegionMotionLayoutId(id) {
  return canonicalSourceLayoutId(id) === FIXED_REGION_MOTION_LAYOUT_ID
}

export function resolveSourceLayout(id = TOPDOWN_RPG_SOURCE_LAYOUT_ID) {
  const normalized = canonicalSourceLayoutId(id)
  const layout = SOURCE_LAYOUTS[normalized]
  if (!layout) throw new Error(`Unknown source layout: ${normalized}`)
  return layout
}

function scaleRegion(region, image, layout) {
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

function copyRegion(image, region, { flipH = false } = {}) {
  const out = { width: region.w, height: region.h, data: new Uint8ClampedArray(region.w * region.h * 4) }
  for (let y = 0; y < region.h; y++) {
    for (let x = 0; x < region.w; x++) {
      const sourceX = region.x + (flipH ? region.w - 1 - x : x)
      const sourceY = region.y + y
      const src = pixelOffset(image.width, sourceX, sourceY)
      const dst = pixelOffset(out.width, x, y)
      out.data[dst] = image.data[src]
      out.data[dst + 1] = image.data[src + 1]
      out.data[dst + 2] = image.data[src + 2]
      out.data[dst + 3] = image.data[src + 3]
    }
  }
  return out
}

function normalizeSpec(spec) {
  return typeof spec === 'string' ? { key: spec, flipH: false } : { key: spec.key, flipH: Boolean(spec.flipH) }
}

function directionAdjustedDescription(spec) {
  const normalizedSpec = normalizeSpec(spec)
  const description = describeOcadRegionKey(normalizedSpec.key)
  if (!normalizedSpec.flipH) return { ...description, flip_h: false }
  return {
    ...description,
    label: description.label.replace('left', 'right'),
    zh: description.zh.replace('左向', '右向'),
    display_label: description.display_label.replace('left', 'right'),
    flip_h: true,
  }
}

export function getRuntimeAnimationSemantics(sourceLayout, targetProfile) {
  if (!isFixedRegionMotionLayout(sourceLayout)) return {}
  return Object.fromEntries(
    targetProfile.animations.map((animation) => {
      const specs = OCAD_TARGET_FRAME_SPECS[animation.name] ?? []
      const seen = new Set()
      const sourceActions = []
      for (const spec of specs) {
        const description = directionAdjustedDescription(spec)
        const key = `${description.action}:${description.label}:${description.flip_h}`
        if (seen.has(key)) continue
        seen.add(key)
        sourceActions.push({
          action: description.action,
          label: description.label,
          zh: description.zh,
          flip_h: description.flip_h,
        })
      }
      return [
        animation.name,
        {
          label: sourceActions.map((item) => item.label).join(' / ') || animation.name,
          source_layout: sourceLayout.id,
          source_actions: sourceActions,
          ...(OCAD_RUNTIME_UI_HIDDEN.has(animation.name) ? { ui_hidden: true } : {}),
          ...(OCAD_RUNTIME_SEMANTIC_OVERRIDES[animation.name] ?? {}),
        },
      ]
    })
  )
}

function makeFixedRegionCell(image, layout, spec, index, animationName) {
  const normalizedSpec = normalizeSpec(spec)
  const sourceRegion = layout.regions[normalizedSpec.key]
  if (!sourceRegion) throw new Error(`Missing fixed source region: ${normalizedSpec.key}`)
  const scaledRegion = scaleRegion(sourceRegion, image, layout)
  const sourceAction = describeOcadRegionKey(normalizedSpec.key)
  const templateHints = getOcadTemplateHints(normalizedSpec.key, sourceRegion, {
    flipH: normalizedSpec.flipH,
    targetSize: { w: scaledRegion.w, h: scaledRegion.h },
  })
  return {
    image: copyRegion(image, scaledRegion, { flipH: normalizedSpec.flipH }),
    meta: {
      index,
      source_layout: layout.id,
      runtime_action: animationName,
      source_action: sourceAction.action,
      source_action_label: sourceAction.label,
      source_action_zh: sourceAction.zh,
      source_action_loop: sourceAction.loop,
      source_frame: sourceAction.frame,
      source_region_key: normalizedSpec.key,
      source_display_label: sourceAction.display_label,
      flip_h: normalizedSpec.flipH,
      x: scaledRegion.x,
      y: scaledRegion.y,
      w: scaledRegion.w,
      h: scaledRegion.h,
      template_anchor: templateHints.anchor,
      template_motion: templateHints.motion,
    },
  }
}

function sliceOcadMotionCells(image, targetProfile, layout) {
  const cells = Array.from({ length: targetProfile.grid.columns * targetProfile.grid.rows })
  for (const animation of targetProfile.animations) {
    const specs = OCAD_TARGET_FRAME_SPECS[animation.name]
    if (!specs) throw new Error(`Missing OCAD source mapping for target animation: ${animation.name}`)
    const indexes = getAnimationFrameIndexes(animation.name, targetProfile)
    indexes.forEach((frameIndex, i) => {
      cells[frameIndex] = makeFixedRegionCell(image, layout, specs[i % specs.length], frameIndex, animation.name)
    })
  }
  return {
    cells,
    grid: {
      columns: [],
      rows: [],
      correction: {
        applied: false,
        method: 'fixed_regions',
        columns_corrected: [],
        rows_corrected: [],
      },
      fixed_regions: {
        source_sheet: layout.sheet,
        region_count: Object.keys(layout.regions).length,
      },
    },
  }
}

export function buildSourceLayoutRowPreviewCells(image, sourceLayout) {
  if (!isFixedRegionMotionLayout(sourceLayout)) return null
  const cells = []
  const previews = OCAD_ROW_PREVIEW_SPECS.map((preview) => {
    const frames = preview.keys.map((spec) => {
      const index = cells.length
      cells.push(makeFixedRegionCell(image, sourceLayout, spec, index, preview.name))
      return index
    })
    return {
      name: preview.name,
      fileName: `${preview.name}.gif`,
      label: preview.label ?? preview.name,
      frames,
      fps: preview.fps,
      mode: preview.mode,
      source_layout: sourceLayout.id,
    }
  })
  return { cells, previews }
}

export function sliceCellsForSourceLayout(image, targetProfile, sourceLayout) {
  if (sourceLayout.kind === 'uniform_grid') return null
  if (isFixedRegionMotionLayout(sourceLayout)) return sliceOcadMotionCells(image, targetProfile, sourceLayout)
  throw new Error(`Unsupported source layout kind: ${sourceLayout.kind}`)
}

export function getScaledSourceLayoutRegions(image, sourceLayout) {
  if (sourceLayout.kind !== 'fixed_regions') return []
  return Object.entries(sourceLayout.regions).map(([key, region]) => {
    const description = describeOcadRegionKey(key)
    return {
      key,
      ...description,
      label: description.display_label,
      ...scaleRegion(region, image, sourceLayout),
    }
  })
}

function edgeNamesForMargins(margins, threshold) {
  return Object.entries(margins)
    .filter(([, value]) => value <= threshold)
    .map(([edge]) => edge)
}

function sourceRegionPressureItem(key, scaledRegion, bbox, { warningMarginPx, severeMarginPx }) {
  const description = describeOcadRegionKey(key)
  const margins = {
    left: bbox.x,
    top: bbox.y,
    right: scaledRegion.w - 1 - bbox.right,
    bottom: scaledRegion.h - 1 - bbox.bottom,
  }
  const minMargin = Math.min(margins.left, margins.top, margins.right, margins.bottom)
  const severity = minMargin <= severeMarginPx ? 'severe' : 'warning'
  return {
    region_key: key,
    action: description.action,
    frame: description.frame,
    label: description.display_label,
    rect: { x: scaledRegion.x, y: scaledRegion.y, w: scaledRegion.w, h: scaledRegion.h },
    bbox: { x: bbox.x, y: bbox.y, w: bbox.w, h: bbox.h, right: bbox.right, bottom: bbox.bottom },
    margins,
    min_margin: minMargin,
    severity,
    edges: edgeNamesForMargins(margins, severity === 'severe' ? severeMarginPx : warningMarginPx),
  }
}

export function evaluateSourceRegionEdgePressure(image, sourceLayout, options = {}) {
  const warningMarginPx = Number.isFinite(options.warningMarginPx) ? options.warningMarginPx : 1
  const severeMarginPx = Number.isFinite(options.severeMarginPx) ? options.severeMarginPx : 0
  if (sourceLayout.kind !== 'fixed_regions') return null

  const pressuredRegions = []
  const emptyRegions = []
  for (const [key, sourceRegion] of Object.entries(sourceLayout.regions)) {
    const scaledRegion = scaleRegion(sourceRegion, image, sourceLayout)
    const bbox = detectAlphaBBox(copyRegion(image, scaledRegion))
    if (!bbox) {
      emptyRegions.push(key)
      continue
    }
    const item = sourceRegionPressureItem(key, scaledRegion, bbox, { warningMarginPx, severeMarginPx })
    if (item.min_margin <= warningMarginPx) pressuredRegions.push(item)
  }

  const severeRegions = pressuredRegions.filter((item) => item.severity === 'severe')
  return {
    source_layout: sourceLayout.id,
    warning_margin_px: warningMarginPx,
    severe_margin_px: severeMarginPx,
    checked_region_count: Object.keys(sourceLayout.regions).length,
    empty_region_count: emptyRegions.length,
    empty_regions: emptyRegions,
    pressured_region_count: pressuredRegions.length,
    severe_region_count: severeRegions.length,
    severe_regions: severeRegions.map((item) => item.region_key),
    pressured_regions: pressuredRegions,
    passed: severeRegions.length === 0,
  }
}
