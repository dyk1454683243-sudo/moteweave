import { createHash } from 'node:crypto'

import {
  actionRepairActionForRegion,
  actionRepairRegionKeyForFrameIndex,
  resolveActionRepairLayout,
  scaleActionRepairRegion,
} from './actionRepairLayouts.js'
import { cloneRgba, pixelOffset } from './imageMath.js'

export const SUBJECT_COUNT_GATE_MODE = 'subject_count_gate_v1'
export const SUBJECT_COUNT_ALPHA_THRESHOLD = 8

export const SUBJECT_COUNT_OVERLAY_COLORS = Object.freeze({
  main: Object.freeze([0, 210, 90, 255]),
  accessory: Object.freeze([255, 220, 0, 255]),
  second_subject: Object.freeze([245, 45, 45, 255]),
  suspicious: Object.freeze([255, 145, 0, 255]),
})

const STATUS_RANK = Object.freeze({ pass: 0, needs_review: 1, empty: 2, blocked: 3 })
const ANOMALY_EXEMPT_ACTIONS = new Set(['die', 'death', 'hurt', 'sit', 'sitdown'])

function round(value, digits = 4) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function median(values) {
  const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b)
  if (!sorted.length) return null
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function hashPixels(image) {
  return createHash('sha256')
    .update(`${image.width}x${image.height}:`)
    .update(Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength))
    .digest('hex')
}

function componentRecord(pixels, width) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -1
  let maxY = -1
  for (const index of pixels) {
    const x = index % width
    const y = Math.floor(index / width)
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  const w = maxX - minX + 1
  const h = maxY - minY + 1
  return {
    pixels,
    area: pixels.length,
    bbox: {
      x: minX,
      y: minY,
      w,
      h,
      right: maxX,
      bottom: maxY,
      center_x: minX + w / 2,
      center_y: minY + h / 2,
    },
    fill_ratio: round(pixels.length / (w * h)),
    slenderness: round(Math.min(w, h) / Math.max(w, h)),
  }
}

export function collectSubjectComponents(image, {
  alphaThreshold = SUBJECT_COUNT_ALPHA_THRESHOLD,
  minArea = Math.max(4, image.width * image.height * 0.0005),
} = {}) {
  const seen = new Uint8Array(image.width * image.height)
  const components = []
  const queue = []
  const threshold = Math.max(4, Math.ceil(Number(minArea) || 0))
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const start = y * image.width + x
      if (seen[start]) continue
      seen[start] = 1
      if (image.data[start * 4 + 3] <= alphaThreshold) continue
      const pixels = []
      queue.length = 0
      queue.push(start)
      for (let cursor = 0; cursor < queue.length; cursor += 1) {
        const index = queue[cursor]
        pixels.push(index)
        const cx = index % image.width
        const cy = Math.floor(index / image.width)
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (!dx && !dy) continue
            const nx = cx + dx
            const ny = cy + dy
            if (nx < 0 || ny < 0 || nx >= image.width || ny >= image.height) continue
            const next = ny * image.width + nx
            if (seen[next]) continue
            seen[next] = 1
            if (image.data[next * 4 + 3] > alphaThreshold) queue.push(next)
          }
        }
      }
      if (pixels.length >= threshold) components.push(componentRecord(pixels, image.width))
    }
  }
  return components.sort((left, right) => right.area - left.area || left.bbox.x - right.bbox.x)
}

function componentEvidence(component, classification, main, image) {
  const diagonal = Math.max(1, Math.hypot(image.width, image.height))
  const areaRatio = main ? component.area / main.area : 1
  const heightRatio = main ? component.bbox.h / main.bbox.h : 1
  const centerDistanceRatio = main
    ? Math.hypot(
      component.bbox.center_x - main.bbox.center_x,
      component.bbox.center_y - main.bbox.center_y,
    ) / diagonal
    : 0
  return {
    classification,
    area: component.area,
    bbox: { ...component.bbox },
    fill_ratio: component.fill_ratio,
    slenderness: component.slenderness,
    area_ratio_to_main: round(areaRatio),
    height_ratio_to_main: round(heightRatio),
    center_distance_ratio: round(centerDistanceRatio),
  }
}

function classifySecondary(component, main, image) {
  const diagonal = Math.max(1, Math.hypot(image.width, image.height))
  const areaRatio = component.area / main.area
  const heightRatio = component.bbox.h / main.bbox.h
  const centerDistanceRatio = Math.hypot(
    component.bbox.center_x - main.bbox.center_x,
    component.bbox.center_y - main.bbox.center_y,
  ) / diagonal
  const thin = component.slenderness <= 0.22 || (component.fill_ratio <= 0.2 && component.slenderness <= 0.35)
  const belowReviewScale = areaRatio < 0.18
  const lowFillEquipment = areaRatio < 0.3 && component.fill_ratio <= 0.3
  if (thin || belowReviewScale || lowFillEquipment) return 'accessory'
  if (areaRatio >= 0.45 || (areaRatio >= 0.3 && heightRatio >= 0.45 && centerDistanceRatio >= 0.12)) {
    return 'second_subject'
  }
  if ((areaRatio >= 0.18 && areaRatio < 0.3 && heightRatio >= 0.45) ||
      (areaRatio >= 0.3 && heightRatio >= 0.45)) {
    return 'suspicious'
  }
  return 'accessory'
}

function touchesEdge(bbox, image) {
  return bbox.x <= 0 || bbox.y <= 0 || bbox.right >= image.width - 1 || bbox.bottom >= image.height - 1
}

export function analyzeSubjectCountCell(image, metadata = {}) {
  const inputHash = hashPixels(image)
  const components = collectSubjectComponents(image)
  if (!components.length) {
    return {
      ...metadata,
      status: 'empty',
      reason_codes: ['subject_missing'],
      main_subject: null,
      components: [],
      accessory_edge_contact: false,
      input_pixels_sha256: inputHash,
      output_pixels_sha256: hashPixels(image),
      _components: [],
    }
  }
  const main = components[0]
  const evidence = [componentEvidence(main, 'main', main, image)]
  let status = 'pass'
  const reasonCodes = []
  let accessoryEdgeContact = false
  for (const component of components.slice(1)) {
    const classification = classifySecondary(component, main, image)
    evidence.push(componentEvidence(component, classification, main, image))
    if (classification === 'second_subject') {
      status = 'blocked'
      reasonCodes.push('multiple_subjects_high_confidence')
    } else if (classification === 'suspicious' && STATUS_RANK[status] < STATUS_RANK.needs_review) {
      status = 'needs_review'
      reasonCodes.push('subject_or_accessory_uncertain')
    } else if (classification === 'accessory' && touchesEdge(component.bbox, image)) {
      accessoryEdgeContact = true
    }
  }
  return {
    ...metadata,
    status,
    reason_codes: [...new Set(reasonCodes)],
    main_subject: evidence[0],
    components: evidence,
    accessory_edge_contact: accessoryEdgeContact,
    input_pixels_sha256: inputHash,
    output_pixels_sha256: hashPixels(image),
    _components: components.map((component, index) => ({
      ...component,
      classification: evidence[index].classification,
    })),
  }
}

function applyContourAnomalyEvidence(cells) {
  const byAction = new Map()
  for (const cell of cells) {
    if (!cell.main_subject || ANOMALY_EXEMPT_ACTIONS.has(cell.action)) continue
    const group = byAction.get(cell.action) ?? []
    group.push(cell)
    byAction.set(cell.action, group)
  }
  for (const group of byAction.values()) {
    if (group.length < 3) continue
    const medianArea = median(group.map((cell) => cell.main_subject.area))
    const medianWidth = median(group.map((cell) => cell.main_subject.bbox.w))
    if (!medianArea || !medianWidth) continue
    for (const cell of group) {
      if (cell.status === 'blocked') continue
      const bbox = cell.main_subject.bbox
      const areaRatio = cell.main_subject.area / medianArea
      const widthRatio = bbox.w / medianWidth
      cell.contour_anomaly = {
        area_ratio_to_action_median: round(areaRatio),
        width_ratio_to_action_median: round(widthRatio),
      }
      if (areaRatio >= 2 && widthRatio >= 1.7) {
        cell.status = 'blocked'
        cell.reason_codes = [...new Set([...cell.reason_codes, 'connected_multiple_subjects_high_confidence'])]
      } else if (areaRatio >= 1.45 && widthRatio >= 1.35 && cell.status === 'pass') {
        cell.status = 'needs_review'
        cell.reason_codes = [...new Set([...cell.reason_codes, 'connected_contour_abnormal'])]
      }
    }
  }
}

function publicCell(cell) {
  const { _components, ...value } = cell
  return value
}

function aggregateStatus(cells) {
  return cells.reduce((status, cell) => (
    STATUS_RANK[cell.status] > STATUS_RANK[status] ? cell.status : status
  ), 'pass')
}

function drawBox(image, bbox, origin, color, thickness = 2) {
  const left = Math.max(0, Math.min(image.width - 1, origin.x + bbox.x))
  const top = Math.max(0, Math.min(image.height - 1, origin.y + bbox.y))
  const right = Math.max(left, Math.min(image.width - 1, origin.x + bbox.right))
  const bottom = Math.max(top, Math.min(image.height - 1, origin.y + bbox.bottom))
  for (let inset = 0; inset < thickness; inset += 1) {
    for (let x = left; x <= right; x += 1) {
      for (const y of [top + inset, bottom - inset]) {
        if (y < top || y > bottom) continue
        image.data.set(color, pixelOffset(image.width, x, y))
      }
    }
    for (let y = top; y <= bottom; y += 1) {
      for (const x of [left + inset, right - inset]) {
        if (x < left || x > right) continue
        image.data.set(color, pixelOffset(image.width, x, y))
      }
    }
  }
}

function overlayForCells(canvas, cells) {
  const overlay = cloneRgba(canvas)
  for (const cell of cells) {
    for (const component of cell._components) {
      const color = SUBJECT_COUNT_OVERLAY_COLORS[component.classification] ?? SUBJECT_COUNT_OVERLAY_COLORS.suspicious
      drawBox(overlay, component.bbox, cell.rect ?? { x: 0, y: 0 }, color)
    }
    if (cell.contour_anomaly && cell.main_subject) {
      const color = cell.status === 'blocked'
        ? SUBJECT_COUNT_OVERLAY_COLORS.second_subject
        : SUBJECT_COUNT_OVERLAY_COLORS.suspicious
      drawBox(overlay, cell.main_subject.bbox, cell.rect ?? { x: 0, y: 0 }, color, 3)
    }
  }
  return overlay
}

function cropImage(image, rect) {
  const output = { width: rect.w, height: rect.h, data: new Uint8ClampedArray(rect.w * rect.h * 4) }
  for (let y = 0; y < rect.h; y += 1) {
    const sourceOffset = pixelOffset(image.width, rect.x, rect.y + y)
    output.data.set(image.data.subarray(sourceOffset, sourceOffset + rect.w * 4), y * rect.w * 4)
  }
  return output
}

export function buildSourceSubjectCountCells(image, sourceLayoutId) {
  const layout = resolveActionRepairLayout(sourceLayoutId)
  return Object.keys(layout.regions).map((regionKey) => {
    const rect = scaleActionRepairRegion(layout.id, regionKey, image)
    return {
      image: cropImage(image, rect),
      rect,
      region_key: regionKey,
      action: actionRepairActionForRegion(layout.id, regionKey),
    }
  })
}

export function evaluateSubjectCountCells(cells, {
  canvas,
  stage,
  sourceLayoutId,
} = {}) {
  const analyzed = cells.map((cell, index) => analyzeSubjectCountCell(cell.image, {
    frame_index: Number.isInteger(cell.frame_index) ? cell.frame_index : null,
    region_key: cell.region_key ?? null,
    action: cell.action ?? null,
    rect: cell.rect ?? null,
    cell_index: index,
  }))
  applyContourAnomalyEvidence(analyzed)
  const suggestedRegionKeys = [...new Set(analyzed
    .filter((cell) => cell.status === 'blocked')
    .map((cell) => cell.region_key)
    .filter(Boolean))]
  const needsReviewRegionKeys = [...new Set(analyzed
    .filter((cell) => cell.status === 'needs_review')
    .map((cell) => cell.region_key)
    .filter(Boolean))]
  const accessoryEdgeRegionKeys = [...new Set(analyzed
    .filter((cell) => cell.accessory_edge_contact)
    .map((cell) => cell.region_key)
    .filter(Boolean))]
  const status = aggregateStatus(analyzed)
  const report = {
    schema_version: 1,
    mode: SUBJECT_COUNT_GATE_MODE,
    provider_free: true,
    output_mutation: 'none',
    stage,
    source_layout: sourceLayoutId,
    status,
    blocking_errors: status === 'blocked' || status === 'empty'
      ? analyzed.filter((cell) => cell.status === status).map((cell) => `${cell.status}:${cell.region_key ?? cell.frame_index}`)
      : [],
    warnings: status === 'needs_review'
      ? analyzed.filter((cell) => cell.status === 'needs_review').map((cell) => `needs_review:${cell.region_key ?? cell.frame_index}`)
      : [],
    suggested_region_keys: suggestedRegionKeys,
    needs_review_region_keys: needsReviewRegionKeys,
    advisory_region_keys: accessoryEdgeRegionKeys,
    summary: {
      cell_count: analyzed.length,
      pass_count: analyzed.filter((cell) => cell.status === 'pass').length,
      needs_review_count: analyzed.filter((cell) => cell.status === 'needs_review').length,
      blocked_count: analyzed.filter((cell) => cell.status === 'blocked').length,
      empty_count: analyzed.filter((cell) => cell.status === 'empty').length,
      accessory_edge_advisory_count: accessoryEdgeRegionKeys.length,
    },
    cells: analyzed.map(publicCell),
  }
  return {
    report,
    overlay: canvas ? overlayForCells(canvas, analyzed) : null,
    analyzed,
  }
}

export function evaluateSourceSubjectCount(image, sourceLayoutId, { stage = 'calibrated_source' } = {}) {
  return evaluateSubjectCountCells(buildSourceSubjectCountCells(image, sourceLayoutId), {
    canvas: image,
    stage,
    sourceLayoutId,
  })
}

function composeNormalizedCanvas(frames, profile) {
  const image = { width: profile.sheet.w, height: profile.sheet.h, data: new Uint8ClampedArray(profile.sheet.w * profile.sheet.h * 4) }
  for (const frame of frames) {
    const col = frame.index % profile.grid.columns
    const row = Math.floor(frame.index / profile.grid.columns)
    for (let y = 0; y < profile.frame.h; y += 1) {
      const sourceOffset = y * profile.frame.w * 4
      const targetOffset = pixelOffset(image.width, col * profile.frame.w, row * profile.frame.h + y)
      image.data.set(frame.image.data.subarray(sourceOffset, sourceOffset + profile.frame.w * 4), targetOffset)
    }
  }
  return image
}

export function evaluateNormalizedSubjectCount(frames, profile, sourceLayoutId) {
  const canvas = composeNormalizedCanvas(frames, profile)
  const cells = frames.map((frame) => {
    const col = frame.index % profile.grid.columns
    const row = Math.floor(frame.index / profile.grid.columns)
    return {
      image: frame.image,
      rect: { x: col * profile.frame.w, y: row * profile.frame.h, w: profile.frame.w, h: profile.frame.h },
      frame_index: frame.index,
      region_key: frame.source_meta?.source_region_key ?? actionRepairRegionKeyForFrameIndex(sourceLayoutId, frame.index),
      action: frame.source_meta?.source_action ?? frame.source_meta?.runtime_action ?? null,
    }
  })
  return evaluateSubjectCountCells(cells, {
    canvas,
    stage: 'normalized_frames',
    sourceLayoutId,
  })
}

export function mergeSubjectCountStageReports(reports = [], { sourceLayoutId } = {}) {
  const stages = reports.filter(Boolean)
  const status = stages.reduce((current, report) => (
    STATUS_RANK[report.status] > STATUS_RANK[current] ? report.status : current
  ), 'pass')
  return {
    schema_version: 1,
    mode: SUBJECT_COUNT_GATE_MODE,
    provider_free: true,
    output_mutation: 'none',
    source_layout: sourceLayoutId ?? stages[0]?.source_layout ?? null,
    status,
    blocking_errors: [...new Set(stages.flatMap((report) => report.blocking_errors ?? []))],
    warnings: [...new Set(stages.flatMap((report) => report.warnings ?? []))],
    suggested_region_keys: [...new Set(stages.flatMap((report) => report.suggested_region_keys ?? []))],
    needs_review_region_keys: [...new Set(stages.flatMap((report) => report.needs_review_region_keys ?? []))],
    advisory_region_keys: [...new Set(stages.flatMap((report) => report.advisory_region_keys ?? []))],
    stages,
  }
}
