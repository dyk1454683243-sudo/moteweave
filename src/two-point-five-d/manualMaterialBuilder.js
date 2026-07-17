import sharp from 'sharp'

import { extractMaterialPatchSet } from './materialPatchExtractor.js'

const REQUIRED_RENDER_SLOTS = Object.freeze([
  'top_material',
  'side_material',
  'edge_material',
  'corner_material',
  'transition_detail',
  'shadow_material',
])

const DEFAULT_MATERIAL_SAMPLE_LAYOUT = Object.freeze({
  top_material: Object.freeze({ role: 'top', x: 0, y: 0, w: 1 / 3, h: 1 / 2 }),
  side_material: Object.freeze({ role: 'side', x: 1 / 3, y: 0, w: 1 / 3, h: 1 / 2 }),
  edge_material: Object.freeze({ role: 'edge', x: 2 / 3, y: 0, w: 1 / 3, h: 1 / 2 }),
  corner_material: Object.freeze({ role: 'corner', x: 0, y: 1 / 2, w: 1 / 3, h: 1 / 2 }),
  transition_detail: Object.freeze({ role: 'transition', x: 1 / 3, y: 1 / 2, w: 1 / 3, h: 1 / 2 }),
  shadow_material: Object.freeze({ role: 'shadow', x: 2 / 3, y: 1 / 2, w: 1 / 3, h: 1 / 2 }),
  decal_material: Object.freeze({ role: 'decal', x: 2 / 3, y: 1 / 2, w: 1 / 3, h: 1 / 2 }),
})

const BASELINE_LAYOUT_ID = 'six_region_material_grid_v0'
const LAYOUT_ASSIST_MODE = 'semantic_material_layout_assist_v1'
const EXPLICIT_LAYOUT_MODE = 'explicit_material_layout_v1'
const SEMANTIC_SLOT_MODE = 'semantic_slot_extraction_v1'
const EXPLICIT_SLOT_MODE = 'explicit_slot_regions_v1'
const SLOT_SEPARATION_MODE = 'material_slot_separation_v1'
const SLOT_DISTINCTION_THRESHOLD = 18
const SLOT_SELECTION_ORDER = Object.freeze([
  'top_material',
  'side_material',
  'edge_material',
  'corner_material',
  'transition_detail',
  'shadow_material',
  'decal_material',
])
const SLOT_SEPARATION_TARGETS = Object.freeze({
  top_material: Object.freeze({ reference: '#5f9f4c', luma: 112, mix: 0.34, shadow_delta: -34, highlight_delta: 34, detail: '#c7d66c' }),
  side_material: Object.freeze({ reference: '#6e4b32', luma: 72, mix: 0.46, shadow_delta: -26, highlight_delta: 24, detail: '#b08455' }),
  edge_material: Object.freeze({ reference: '#b6d46d', luma: 158, mix: 0.52, shadow_delta: -34, highlight_delta: 28, detail: '#f0f0a0' }),
  corner_material: Object.freeze({ reference: '#79b957', luma: 128, mix: 0.45, shadow_delta: -30, highlight_delta: 30, detail: '#d7e88b' }),
  transition_detail: Object.freeze({ reference: '#9a693f', luma: 104, mix: 0.62, shadow_delta: -28, highlight_delta: 26, detail: '#6e4b32' }),
  shadow_material: Object.freeze({ reference: '#242820', luma: 34, mix: 0.72, shadow_delta: -14, highlight_delta: 20, detail: '#1d2119' }),
  decal_material: Object.freeze({ reference: '#d7e88b', luma: 168, mix: 0.42, shadow_delta: -28, highlight_delta: 24, detail: '#ffffff' }),
})

function tileSheetCellLayout(role, col, row) {
  const cell = 1 / 4
  const inset = 1 / 16
  const size = 1 / 8
  return Object.freeze({
    role,
    x: col * cell + inset,
    y: row * cell + inset,
    w: size,
    h: size,
  })
}

const TILE_SHEET_4X4_CENTER_LAYOUT = Object.freeze({
  top_material: tileSheetCellLayout('top', 0, 0),
  side_material: tileSheetCellLayout('side', 1, 0),
  edge_material: tileSheetCellLayout('edge', 2, 0),
  corner_material: tileSheetCellLayout('corner', 0, 1),
  transition_detail: tileSheetCellLayout('transition', 1, 1),
  shadow_material: tileSheetCellLayout('shadow', 2, 2),
  decal_material: tileSheetCellLayout('decal', 3, 3),
})

const CONNECTED_TERRAIN_PROBE_LAYOUT = Object.freeze({
  top_material: Object.freeze({ role: 'top', x: 0.12, y: 0.12, w: 0.14, h: 0.14 }),
  side_material: Object.freeze({ role: 'side', x: 0.42, y: 0.42, w: 0.14, h: 0.14 }),
  edge_material: Object.freeze({ role: 'edge', x: 0.7, y: 0.18, w: 0.14, h: 0.14 }),
  corner_material: Object.freeze({ role: 'corner', x: 0.18, y: 0.68, w: 0.14, h: 0.14 }),
  transition_detail: Object.freeze({ role: 'transition', x: 0.62, y: 0.64, w: 0.14, h: 0.14 }),
  shadow_material: Object.freeze({ role: 'shadow', x: 0.74, y: 0.74, w: 0.14, h: 0.14 }),
  decal_material: Object.freeze({ role: 'decal', x: 0.46, y: 0.18, w: 0.14, h: 0.14 }),
})

const DEFAULT_LAYOUT_CANDIDATES = Object.freeze([
  Object.freeze({
    id: BASELINE_LAYOUT_ID,
    order: 0,
    source_kind: 'explicit_material_grid',
    description: 'Baseline 3 x 2 material-source grid.',
    sample_layout: DEFAULT_MATERIAL_SAMPLE_LAYOUT,
  }),
  Object.freeze({
    id: 'tile_sheet_4x4_center_patches_v0',
    order: 1,
    source_kind: 'tile_sheet_4x4',
    description: 'Samples compact center regions from a 4 x 4 tile-sheet style source.',
    sample_layout: TILE_SHEET_4X4_CENTER_LAYOUT,
  }),
  Object.freeze({
    id: 'connected_terrain_probe_v0',
    order: 2,
    source_kind: 'connected_or_map_like_terrain',
    description: 'Samples compact probes from common connected-terrain source areas.',
    sample_layout: CONNECTED_TERRAIN_PROBE_LAYOUT,
  }),
])

function sanitizeId(value) {
  return String(value || 'manual_material').replace(/[^a-zA-Z0-9_-]/g, '_')
}

function svgEscape(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function svgBuffer(svg) {
  return Buffer.from(svg)
}

function hashBuffer(buffer) {
  let hash = 2166136261
  for (const byte of buffer) {
    hash ^= byte
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function toHex(value) {
  return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')
}

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)))
}

function pixelToHex(pixel) {
  return `#${toHex(pixel.r)}${toHex(pixel.g)}${toHex(pixel.b)}`
}

function hexToPixel(hex) {
  const normalized = String(hex).replace('#', '')
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  }
}

function colorDistance(a, b) {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2)
}

function mixPixel(a, b, amount = 0.5) {
  const t = Math.max(0, Math.min(1, amount))
  return {
    r: clampByte(a.r * (1 - t) + b.r * t),
    g: clampByte(a.g * (1 - t) + b.g * t),
    b: clampByte(a.b * (1 - t) + b.b * t),
    a: a.a ?? b.a ?? 255,
  }
}

function shiftPixelLuma(pixel, delta) {
  return {
    r: clampByte(pixel.r + delta),
    g: clampByte(pixel.g + delta),
    b: clampByte(pixel.b + delta),
    a: pixel.a ?? 255,
  }
}

function movePixelToLuma(pixel, targetLuma) {
  return shiftPixelLuma(pixel, targetLuma - luma(pixel))
}

function colorSaturation(pixel) {
  return Math.max(pixel.r, pixel.g, pixel.b) - Math.min(pixel.r, pixel.g, pixel.b)
}

function luma(pixel) {
  return pixel.r * 0.2126 + pixel.g * 0.7152 + pixel.b * 0.0722
}

function rectFromLayout(layout, width, height) {
  const x = Math.floor(layout.x * width)
  const y = Math.floor(layout.y * height)
  const w = Math.max(1, Math.min(width - x, Math.floor(layout.w * width)))
  const h = Math.max(1, Math.min(height - y, Math.floor(layout.h * height)))
  return { x, y, w, h }
}

function normalizeSampleLayout(sampleLayout = {}) {
  const merged = {}
  for (const [slot, fallback] of Object.entries(DEFAULT_MATERIAL_SAMPLE_LAYOUT)) {
    const candidate = sampleLayout[slot] ?? fallback
    merged[slot] = {
      role: typeof candidate.role === 'string' && candidate.role.trim() ? candidate.role : fallback.role,
      x: Number.isFinite(candidate.x) ? candidate.x : fallback.x,
      y: Number.isFinite(candidate.y) ? candidate.y : fallback.y,
      w: Number.isFinite(candidate.w) && candidate.w > 0 ? candidate.w : fallback.w,
      h: Number.isFinite(candidate.h) && candidate.h > 0 ? candidate.h : fallback.h,
    }
  }
  for (const [slot, candidate] of Object.entries(sampleLayout)) {
    if (merged[slot]) continue
    if (!candidate || typeof candidate !== 'object') continue
    merged[slot] = {
      role: typeof candidate.role === 'string' && candidate.role.trim() ? candidate.role : 'detail',
      x: Number.isFinite(candidate.x) ? candidate.x : 0,
      y: Number.isFinite(candidate.y) ? candidate.y : 0,
      w: Number.isFinite(candidate.w) && candidate.w > 0 ? candidate.w : 1 / 3,
      h: Number.isFinite(candidate.h) && candidate.h > 0 ? candidate.h : 1 / 2,
    }
  }
  return merged
}

function readPixel(data, width, x, y) {
  const index = (y * width + x) * 4
  return {
    r: data[index],
    g: data[index + 1],
    b: data[index + 2],
    a: data[index + 3],
  }
}

function sampleRegionColors(data, width, rect) {
  const stride = Math.max(1, Math.floor(Math.sqrt((rect.w * rect.h) / 4096)))
  const pixels = []
  let visiblePixelCount = 0
  let alphaTotal = 0
  const colorSet = new Set()
  for (let y = rect.y; y < rect.y + rect.h; y += stride) {
    for (let x = rect.x; x < rect.x + rect.w; x += stride) {
      const pixel = readPixel(data, width, x, y)
      if (!pixel.a) continue
      visiblePixelCount += 1
      alphaTotal += pixel.a
      pixels.push(pixel)
      colorSet.add(pixelToHex(pixel).toLowerCase())
    }
  }
  const sampledPixelCount = Math.max(1, Math.ceil(rect.w / stride) * Math.ceil(rect.h / stride))
  if (!pixels.length) {
    const fallback = { r: 128, g: 128, b: 128, a: 255 }
    return {
      visible_pixel_count: 0,
      sampled_pixel_count: sampledPixelCount,
      visible_coverage_ratio: 0,
      mean_alpha: 0,
      luma_min: 0,
      luma_max: 0,
      luma_range: 0,
      luma_median: 0,
      unique_color_count: 0,
      saturation_median: 0,
      green_bias: 0,
      colors: {
        base: pixelToHex(fallback),
        highlight: '#a0a0a0',
        shadow: '#606060',
        detail: '#c0c0c0',
      },
    }
  }

  pixels.sort((a, b) => luma(a) - luma(b))
  const pick = (ratio) => pixels[Math.min(pixels.length - 1, Math.max(0, Math.floor((pixels.length - 1) * ratio)))]
  const minLuma = luma(pixels[0])
  const maxLuma = luma(pixels[pixels.length - 1])
  const medianPixel = pick(0.5)
  const medianLuma = luma(medianPixel)
  return {
    visible_pixel_count: visiblePixelCount,
    sampled_pixel_count: sampledPixelCount,
    visible_coverage_ratio: Number((visiblePixelCount / sampledPixelCount).toFixed(4)),
    mean_alpha: Number((alphaTotal / visiblePixelCount).toFixed(2)),
    luma_min: Number(minLuma.toFixed(2)),
    luma_max: Number(maxLuma.toFixed(2)),
    luma_range: Number((maxLuma - minLuma).toFixed(2)),
    luma_median: Number(medianLuma.toFixed(2)),
    unique_color_count: colorSet.size,
    saturation_median: Number(colorSaturation(medianPixel).toFixed(2)),
    green_bias: Number((medianPixel.g - Math.max(medianPixel.r, medianPixel.b)).toFixed(2)),
    colors: {
      base: pixelToHex(pick(0.5)),
      highlight: pixelToHex(pick(0.85)),
      shadow: pixelToHex(pick(0.15)),
      detail: pixelToHex(pick(0.68)),
    },
  }
}

function diagnosticsForSample(slot, sampled, { areaRatio = 0 } = {}) {
  const warnings = []
  if (sampled.visible_pixel_count === 0) warnings.push(`sample_region_empty_${slot}`)
  else {
    if (sampled.visible_coverage_ratio < 0.05) warnings.push(`sample_region_low_visible_coverage_${slot}`)
    if (sampled.luma_range < 8) warnings.push(`sample_region_low_contrast_${slot}`)
    if (sampled.luma_median > 240) warnings.push(`sample_region_overexposed_${slot}`)
    if (sampled.luma_median < 15) warnings.push(`sample_region_underexposed_${slot}`)
    if (areaRatio > 0.08 && sampled.unique_color_count > 8) warnings.push(`sample_region_overmixed_${slot}`)
  }
  return {
    status: warnings.length ? 'warning' : 'pass',
    warnings,
    metrics: {
      visible_coverage_ratio: sampled.visible_coverage_ratio,
      mean_alpha: sampled.mean_alpha,
      luma_min: sampled.luma_min,
      luma_max: sampled.luma_max,
      luma_range: sampled.luma_range,
      luma_median: sampled.luma_median,
      unique_color_count: sampled.unique_color_count,
      saturation_median: sampled.saturation_median,
      green_bias: sampled.green_bias,
      area_ratio: Number(areaRatio.toFixed(4)),
    },
  }
}

function clampLayout(layout) {
  const x = Math.max(0, Math.min(0.98, layout.x))
  const y = Math.max(0, Math.min(0.98, layout.y))
  const w = Math.max(0.01, Math.min(1 - x, layout.w))
  const h = Math.max(0.01, Math.min(1 - y, layout.h))
  return { ...layout, x, y, w, h }
}

function candidateKey(layout) {
  return [
    layout.x.toFixed(4),
    layout.y.toFixed(4),
    layout.w.toFixed(4),
    layout.h.toFixed(4),
  ].join(':')
}

function addCandidate(pool, seen, candidate) {
  const layout = clampLayout(candidate.layout)
  const key = candidateKey(layout)
  if (seen.has(key)) return
  seen.add(key)
  pool.push({ ...candidate, layout })
}

function semanticTileCellCandidate(col, row, { role = 'detail', originSlot = null } = {}) {
  return {
    id: `tile_cell_${row}_${col}`,
    role,
    origin_slot: originSlot,
    source_kind: 'tile_sheet_cell',
    layout: tileSheetCellLayout(role, col, row),
  }
}

function buildSemanticSlotCandidatePool(normalizedLayout, layoutId) {
  const pool = []
  const seen = new Set()
  for (const [slot, layout] of Object.entries(normalizedLayout)) {
    addCandidate(pool, seen, {
      id: `layout_${slot}`,
      role: layout.role,
      origin_slot: slot,
      source_kind: 'layout_slot',
      layout,
    })
  }

  if (layoutId === 'tile_sheet_4x4_center_patches_v0') {
    const originByCell = new Map([
      ['0:0', ['top_material', 'top']],
      ['1:0', ['side_material', 'side']],
      ['2:0', ['edge_material', 'edge']],
      ['0:1', ['corner_material', 'corner']],
      ['1:1', ['transition_detail', 'transition']],
      ['2:2', ['shadow_material', 'shadow']],
      ['3:3', ['decal_material', 'decal']],
    ])
    for (let row = 0; row < 4; row += 1) {
      for (let col = 0; col < 4; col += 1) {
        const [originSlot, role] = originByCell.get(`${col}:${row}`) ?? [null, 'detail']
        addCandidate(pool, seen, semanticTileCellCandidate(col, row, { role, originSlot }))
      }
    }
  } else if (layoutId === 'connected_terrain_probe_v0') {
    const probeSize = 0.14
    for (let row = 0; row < 5; row += 1) {
      for (let col = 0; col < 5; col += 1) {
        addCandidate(pool, seen, {
          id: `terrain_probe_${row}_${col}`,
          role: 'detail',
          origin_slot: null,
          source_kind: 'connected_terrain_probe',
          layout: {
            role: 'detail',
            x: 0.08 + col * 0.2,
            y: 0.08 + row * 0.2,
            w: probeSize,
            h: probeSize,
          },
        })
      }
    }
  }

  return pool
}

function evaluateSemanticSlotCandidates({ normalizedLayout, layoutId, image }) {
  return buildSemanticSlotCandidatePool(normalizedLayout, layoutId).map((candidate) => {
    const rect = rectFromLayout(candidate.layout, image.info.width, image.info.height)
    const sampled = sampleRegionColors(image.data, image.info.width, rect)
    const areaRatio = (rect.w * rect.h) / Math.max(1, image.info.width * image.info.height)
    return {
      ...candidate,
      sample_region: rect,
      sampled,
      diagnostics: diagnosticsForSample(candidate.id, sampled, { areaRatio }),
      base_pixel: hexToPixel(sampled.colors.base),
    }
  })
}

function roleScore(slot, candidate) {
  const metrics = candidate.sampled
  let score = 0
  score += Math.min(metrics.luma_range, 96) * 0.65
  score += Math.min(metrics.unique_color_count, 24) * 1.2
  score += metrics.visible_coverage_ratio * 18
  score += Math.min(metrics.saturation_median, 96) * 0.08
  if (candidate.origin_slot === slot) score += 34
  if (candidate.role === (DEFAULT_MATERIAL_SAMPLE_LAYOUT[slot]?.role ?? 'detail')) score += 8
  if (candidate.role === 'shadow' && slot !== 'shadow_material' && slot !== 'decal_material') score -= 80
  if (candidate.role !== 'shadow' && slot === 'shadow_material') score -= 22
  if (metrics.visible_pixel_count === 0) score -= 500
  if (metrics.luma_median > 245 || metrics.luma_median < 8) score -= 18

  if (slot === 'top_material') {
    score += Math.max(0, 28 - Math.abs(metrics.luma_median - 115) * 0.22)
    if (metrics.green_bias > 0) score += Math.min(14, metrics.green_bias * 0.18)
  } else if (slot === 'side_material') {
    score += Math.max(0, 24 - Math.abs(metrics.luma_median - 75) * 0.18)
  } else if (slot === 'edge_material' || slot === 'corner_material' || slot === 'transition_detail') {
    score += Math.min(metrics.luma_range, 96) * 0.45
    score += Math.min(metrics.unique_color_count, 24) * 0.8
    if (candidate.origin_slot === slot) score += 24
  } else if (slot === 'shadow_material') {
    score += Math.max(0, 38 - Math.abs(metrics.luma_median - 35) * 0.35)
    if (candidate.origin_slot === slot) score += 30
    if (metrics.luma_median < 95) score += 18
  } else if (slot === 'decal_material') {
    score += Math.min(metrics.luma_range, 96) * 0.25
  }
  return score
}

function relationshipScore(slot, candidate, selected) {
  const selectedItems = Object.values(selected)
  if (!selectedItems.length) return 0
  const distances = selectedItems.map((item) => colorDistance(candidate.base_pixel, item.base_pixel))
  let score = Math.min(...distances) * 0.2
  const top = selected.top_material
  if (top && slot === 'side_material' && candidate.sampled.luma_median < top.sampled.luma_median) score += 18
  if (top && slot === 'shadow_material' && candidate.sampled.luma_median < top.sampled.luma_median - 25) score += 26
  if ((slot === 'edge_material' || slot === 'corner_material' || slot === 'transition_detail') && top) {
    score += Math.min(24, colorDistance(candidate.base_pixel, top.base_pixel) * 0.18)
  }
  return score
}

function scoreSemanticCandidate(slot, candidate, selected, usedCandidateIds) {
  if (slot !== 'decal_material' && usedCandidateIds.has(candidate.id)) return Number.NEGATIVE_INFINITY
  return roleScore(slot, candidate) + relationshipScore(slot, candidate, selected)
}

function selectSemanticSlotCandidates({ slots, normalizedLayout, layoutId, image }) {
  const candidates = evaluateSemanticSlotCandidates({ normalizedLayout, layoutId, image })
  const selected = {}
  const usedCandidateIds = new Set()
  const slotOrder = [
    ...SLOT_SELECTION_ORDER.filter((slot) => slots[slot]),
    ...Object.keys(slots).filter((slot) => !SLOT_SELECTION_ORDER.includes(slot)),
  ]
  const slotReports = []

  for (const slot of slotOrder) {
    const ranked = candidates
      .map((candidate) => ({
        candidate,
        score: scoreSemanticCandidate(slot, candidate, selected, usedCandidateIds),
      }))
      .filter((item) => Number.isFinite(item.score))
      .sort((a, b) => b.score - a.score || a.candidate.id.localeCompare(b.candidate.id))
    const winner = ranked[0] ?? candidates[0]
    selected[slot] = winner.candidate
    if (slot !== 'decal_material') usedCandidateIds.add(winner.candidate.id)
    slotReports.push({
      slot,
      selected: {
        candidate_id: winner.candidate.id,
        score: Number(winner.score.toFixed(2)),
        role: winner.candidate.role,
        source_kind: winner.candidate.source_kind,
        origin_slot: winner.candidate.origin_slot,
        sample_region: winner.candidate.sample_region,
        colors: winner.candidate.sampled.colors,
        metrics: {
          luma_median: winner.candidate.sampled.luma_median,
          luma_range: winner.candidate.sampled.luma_range,
          unique_color_count: winner.candidate.sampled.unique_color_count,
          green_bias: winner.candidate.sampled.green_bias,
        },
      },
      rejected: ranked.slice(1, 4).map((item) => ({
        candidate_id: item.candidate.id,
        score: Number(item.score.toFixed(2)),
        role: item.candidate.role,
        origin_slot: item.candidate.origin_slot,
        sample_region: item.candidate.sample_region,
        colors: item.candidate.sampled.colors,
      })),
    })
  }

  return {
    schema_version: 1,
    mode: SEMANTIC_SLOT_MODE,
    layout_id: layoutId,
    candidate_count: candidates.length,
    slots: slotReports,
    selected_by_slot: selected,
  }
}

function explicitSlotSelection(normalizedLayout, layoutId, image, slots) {
  const slotReports = Object.keys(slots).map((slot) => {
    const layout = normalizedLayout[slot] ?? DEFAULT_MATERIAL_SAMPLE_LAYOUT.decal_material
    const rect = rectFromLayout(layout, image.info.width, image.info.height)
    return {
      slot,
      selected: {
        candidate_id: `explicit_${slot}`,
        score: null,
        role: layout.role,
        source_kind: 'explicit_layout_slot',
        origin_slot: slot,
        sample_region: rect,
        colors: null,
        metrics: null,
      },
      rejected: [],
    }
  })
  return {
    schema_version: 1,
    mode: EXPLICIT_SLOT_MODE,
    layout_id: layoutId,
    candidate_count: slotReports.length,
    slots: slotReports,
    selected_by_slot: null,
  }
}

function decodePatchDataUrl(dataUrl) {
  return Buffer.from(String(dataUrl).replace(/^data:image\/png;base64,/, ''), 'base64')
}

function roleSeparatedColors(slot, colors) {
  const target = SLOT_SEPARATION_TARGETS[slot] ?? SLOT_SEPARATION_TARGETS.decal_material
  const sourceBase = hexToPixel(colors.base)
  const reference = hexToPixel(target.reference)
  const base = movePixelToLuma(mixPixel(sourceBase, reference, target.mix), target.luma)
  const shadow = movePixelToLuma(mixPixel(hexToPixel(colors.shadow), base, 0.55), target.luma + target.shadow_delta)
  const highlight = movePixelToLuma(mixPixel(hexToPixel(colors.highlight), base, 0.45), target.luma + target.highlight_delta)
  const detail = movePixelToLuma(mixPixel(hexToPixel(colors.detail), hexToPixel(target.detail), 0.58), target.luma + target.highlight_delta * 0.65)
  return {
    base: pixelToHex(base),
    highlight: pixelToHex(highlight),
    shadow: pixelToHex(shadow),
    detail: pixelToHex(detail),
  }
}

async function recolorPatchDataUrl(patch, colors) {
  if (!patch?.image_data_url) return null
  const sourcePng = decodePatchDataUrl(patch.image_data_url)
  const raw = await sharp(sourcePng).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const data = Buffer.from(raw.data)
  const visibleLumas = []
  for (let index = 0; index < data.length; index += 4) {
    if (!data[index + 3]) continue
    visibleLumas.push(luma({ r: data[index], g: data[index + 1], b: data[index + 2] }))
  }
  if (!visibleLumas.length) return null
  const minLuma = Math.min(...visibleLumas)
  const maxLuma = Math.max(...visibleLumas)
  const range = Math.max(1, maxLuma - minLuma)
  const shadow = hexToPixel(colors.shadow)
  const base = hexToPixel(colors.base)
  const highlight = hexToPixel(colors.highlight)
  const detail = hexToPixel(colors.detail)
  for (let index = 0; index < data.length; index += 4) {
    if (!data[index + 3]) continue
    const current = { r: data[index], g: data[index + 1], b: data[index + 2] }
    const t = Math.max(0, Math.min(1, (luma(current) - minLuma) / range))
    let next
    if (t < 0.5) next = mixPixel(shadow, base, t * 2)
    else if (t < 0.85) next = mixPixel(base, highlight, (t - 0.5) / 0.35)
    else next = mixPixel(highlight, detail, (t - 0.85) / 0.15)
    data[index] = next.r
    data[index + 1] = next.g
    data[index + 2] = next.b
  }
  const png = await sharp(data, { raw: { width: raw.info.width, height: raw.info.height, channels: 4 } }).png().toBuffer()
  const hash = hashBuffer(png).toString(16)
  return {
    image_data_url: `data:image/png;base64,${png.toString('base64')}`,
    png_sha: hash,
    id: `patch_${sanitizeId(patch.slot)}_${hash}`,
  }
}

async function applyMaterialSlotSeparation({
  samples,
  materialEntries,
  slotEntries,
  enabled = true,
} = {}) {
  const initialWarnings = slotDistinctionWarnings(samples)
  if (!enabled) {
    return {
      schema_version: 1,
      mode: SLOT_SEPARATION_MODE,
      status: 'disabled',
      reason: 'explicit_layout_preserves_user_slot_colors',
      threshold: SLOT_DISTINCTION_THRESHOLD,
      initial_warning_count: initialWarnings.length,
      remaining_warning_count: initialWarnings.length,
      initial_warnings: initialWarnings,
      remaining_warnings: initialWarnings,
      changed_slot_count: 0,
      changed_slots: [],
    }
  }
  if (!initialWarnings.length) {
    return {
      schema_version: 1,
      mode: SLOT_SEPARATION_MODE,
      status: 'pass',
      reason: 'source_slots_already_distinct',
      threshold: SLOT_DISTINCTION_THRESHOLD,
      initial_warning_count: 0,
      remaining_warning_count: 0,
      initial_warnings: [],
      remaining_warnings: [],
      changed_slot_count: 0,
      changed_slots: [],
    }
  }

  const changedSlots = []
  for (const sample of samples) {
    if (!SLOT_SEPARATION_TARGETS[sample.slot]) continue
    const material = materialEntries[sample.material_id]
    if (!material) continue
    const sourceColors = { ...sample.colors }
    const separatedColors = roleSeparatedColors(sample.slot, sourceColors)
    sample.source_colors = sourceColors
    sample.colors = separatedColors
    material.source_colors = sourceColors
    material.base = separatedColors.base
    material.highlight = separatedColors.highlight
    material.shadow = separatedColors.shadow
    material.detail = separatedColors.detail
    const changed = {
      slot: sample.slot,
      material_id: sample.material_id,
      source_colors: sourceColors,
      separated_colors: separatedColors,
      base_distance_from_source: Number(colorDistance(hexToPixel(sourceColors.base), hexToPixel(separatedColors.base)).toFixed(2)),
    }
    if (material.patch?.image_data_url) {
      const recolored = await recolorPatchDataUrl(material.patch, separatedColors)
      if (recolored) {
        material.patch = {
          ...material.patch,
          ...recolored,
          slot_separation: {
            mode: SLOT_SEPARATION_MODE,
            source_colors: sourceColors,
            separated_colors: separatedColors,
          },
        }
        sample.patch = material.patch
        if (slotEntries[sample.slot]) slotEntries[sample.slot].patch_id = material.patch.id
        changed.patch_recolored = true
      }
    }
    changedSlots.push(changed)
  }

  const remainingWarnings = slotDistinctionWarnings(samples)
  return {
    schema_version: 1,
    mode: SLOT_SEPARATION_MODE,
    status: remainingWarnings.length ? 'warning' : 'active',
    reason: remainingWarnings.length ? 'slot_distinction_remaining_after_separation' : 'role_palette_separation_applied',
    threshold: SLOT_DISTINCTION_THRESHOLD,
    initial_warning_count: initialWarnings.length,
    remaining_warning_count: remainingWarnings.length,
    initial_warnings: initialWarnings,
    remaining_warnings: remainingWarnings,
    changed_slot_count: changedSlots.length,
    changed_slots: changedSlots,
  }
}

function slotDistinctionWarnings(samples) {
  const samplesBySlot = new Map(samples.map((sample) => [sample.slot, sample]))
  const warnings = []
  for (let leftIndex = 0; leftIndex < REQUIRED_RENDER_SLOTS.length; leftIndex += 1) {
    const leftSlot = REQUIRED_RENDER_SLOTS[leftIndex]
    const left = samplesBySlot.get(leftSlot)
    if (!left) continue
    for (let rightIndex = leftIndex + 1; rightIndex < REQUIRED_RENDER_SLOTS.length; rightIndex += 1) {
      const rightSlot = REQUIRED_RENDER_SLOTS[rightIndex]
      const right = samplesBySlot.get(rightSlot)
      if (!right) continue
      const distance = colorDistance(hexToPixel(left.colors.base), hexToPixel(right.colors.base))
      if (distance < SLOT_DISTINCTION_THRESHOLD) warnings.push(`material_slot_low_distinction_${leftSlot}_${rightSlot}`)
    }
  }
  return warnings
}

function warningCounts(warnings, report = null) {
  const patchWarnings = warnings.filter((warning) => warning.startsWith('material_patch_'))
  const patchLowColorVariety = warnings.filter((warning) => warning.startsWith('material_patch_low_color_variety_')).length
  const patchLowContrast = warnings.filter((warning) => warning.startsWith('material_patch_low_contrast_')).length
  const patchRepeatEdge = warnings.filter((warning) => warning.startsWith('material_patch_repeat_edge_delta_')).length
  const reportedSlotDistinction = warnings.filter((warning) => warning.startsWith('material_slot_low_distinction_')).length
  const initialSlotDistinction = report?.slot_separation?.initial_warning_count ?? 0
  return {
    total: warnings.length,
    sample: warnings.filter((warning) => warning.startsWith('sample_region_')).length,
    patch: patchWarnings.length,
    patch_repeat_edge: patchRepeatEdge,
    patch_low_color_variety: patchLowColorVariety,
    patch_low_contrast: patchLowContrast,
    patch_other: Math.max(0, patchWarnings.length - patchRepeatEdge - patchLowColorVariety - patchLowContrast),
    slot_distinction: Math.max(reportedSlotDistinction, initialSlotDistinction),
  }
}

function scoreReasons(counts) {
  return [
    `${counts.sample} sample warnings`,
    `${counts.patch} patch warnings`,
    `${counts.patch_repeat_edge} repeated-edge patch warnings`,
    `${counts.slot_distinction} slot-distinction warnings`,
  ]
}

function scoreLayoutReport(report, candidate) {
  const counts = warningCounts(report.quality_gates.warnings ?? [], report)
  const priorityPenalty = candidate.order
  return {
    score:
      counts.sample * 4 +
      counts.patch_repeat_edge * 45 +
      counts.patch_low_color_variety * 4 +
      counts.patch_low_contrast * 4 +
      counts.patch_other * 12 +
      counts.slot_distinction * 18 +
      priorityPenalty,
    counts,
    reasons: scoreReasons(counts),
  }
}

function summarizeCandidate(candidate, report, score) {
  return {
    id: candidate.id,
    source_kind: candidate.source_kind,
    status: report.status,
    score: score.score,
    score_reasons: score.reasons,
    warning_counts: score.counts,
    quality_gates: {
      warning_sample_count: report.quality_gates.warning_sample_count,
      warning_patch_count: report.quality_gates.warning_patch_count,
      slot_distinction_warning_count: report.quality_gates.slot_distinction_warning_count,
      warning_count: report.quality_gates.warnings.length,
    },
    sample_regions: report.sampling.samples.map((sample) => ({
      slot: sample.slot,
      role: sample.role,
      semantic_candidate_id: sample.semantic_candidate_id,
      sample_region: sample.sample_region,
      status: sample.diagnostics.status === 'warning' || sample.patch_diagnostics?.status === 'warning' ? 'warning' : 'pass',
    })),
    description: candidate.description,
  }
}

function attachLayoutSelection(result, layoutSelection) {
  return {
    materialProfile: {
      ...result.materialProfile,
      layout_selection: {
        mode: layoutSelection.mode,
        selected_id: layoutSelection.selected.id,
        selected_score: layoutSelection.selected.score,
        candidate_count: layoutSelection.candidates.length,
      },
    },
    report: {
      ...result.report,
      layout_selection: layoutSelection,
    },
  }
}

async function buildMaterialProfileForLayout({
  normalizedSourcePng,
  image,
  sourceHash,
  contract,
  sourceNormalization,
  sampleLayout,
  layoutId,
  semanticSlotSelection = true,
  slotSeparation = true,
} = {}) {
  const patternSize = contract.materials?.procedural_profile?.pattern_size ?? [16, 16]
  const slots = contract.materials?.slots ?? {}
  const normalizedLayout = normalizeSampleLayout(sampleLayout)
  const slotSelection = semanticSlotSelection
    ? selectSemanticSlotCandidates({ slots, normalizedLayout, layoutId, image })
    : explicitSlotSelection(normalizedLayout, layoutId, image, slots)
  const materialEntries = {}
  const slotEntries = {}
  const samples = []
  const warnings = []

  for (const [slot, materialId] of Object.entries(slots)) {
    const selectedCandidate = slotSelection.selected_by_slot?.[slot]
    const layout = selectedCandidate?.layout ?? normalizedLayout[slot] ?? DEFAULT_MATERIAL_SAMPLE_LAYOUT.decal_material
    const rect = rectFromLayout(layout, image.info.width, image.info.height)
    const sampled = selectedCandidate?.sampled ?? sampleRegionColors(image.data, image.info.width, rect)
    const areaRatio = (rect.w * rect.h) / Math.max(1, image.info.width * image.info.height)
    const diagnostics = diagnosticsForSample(slot, sampled, { areaRatio })
    warnings.push(...diagnostics.warnings)
    const safeMaterialId = sanitizeId(materialId)
    materialEntries[materialId] = {
      id: materialId,
      pattern_id: `mat_${safeMaterialId}`,
      role: layout.role,
      ...sampled.colors,
    }
    slotEntries[slot] = {
      slot,
      material_id: materialId,
      pattern_id: `mat_${safeMaterialId}`,
      role: layout.role,
    }
    samples.push({
      slot,
      material_id: materialId,
      role: layout.role,
      sample_region: rect,
      semantic_candidate_id: selectedCandidate?.id ?? `explicit_${slot}`,
      visible_pixel_count: sampled.visible_pixel_count,
      sampled_pixel_count: sampled.sampled_pixel_count,
      diagnostics,
      colors: sampled.colors,
    })
  }

  const extraction = await extractMaterialPatchSet({
    normalizedSourcePng,
    samples,
    patchSize: patternSize,
    paletteMaxColors: contract.palette?.mode === 'limited' ? contract.palette?.max_colors : null,
  })
  const patchesBySlot = new Map(extraction.patches.map((patch) => [patch.slot, patch]))
  for (const sample of samples) {
    const extracted = patchesBySlot.get(sample.slot)
    if (!extracted) continue
    sample.patch = extracted.patch
    sample.patch_diagnostics = extracted.diagnostics
    materialEntries[sample.material_id].patch = extracted.patch
    slotEntries[sample.slot].patch_id = extracted.patch.id
  }

  const slotSeparationReport = await applyMaterialSlotSeparation({
    samples,
    materialEntries,
    slotEntries,
    enabled: slotSeparation && semanticSlotSelection,
  })
  const slotWarnings = slotSeparationReport.remaining_warnings
  warnings.push(...extraction.warnings, ...slotWarnings)

  const palette = new Set()
  for (const material of Object.values(materialEntries)) {
    for (const key of ['base', 'highlight', 'shadow', 'detail']) palette.add(material[key].toLowerCase())
  }

  return {
    materialProfile: {
      schema_version: 1,
      id: `manual_material_profile_${sourceHash.toString(16)}`,
      generator: 'manual_material_extraction_v1',
      source_id: sourceNormalization?.source_id ?? 'manual_material_source',
      seed: sourceHash,
      pattern_size: patternSize,
      required_slots: [...REQUIRED_RENDER_SLOTS],
      extraction: {
        mode: extraction.mode,
        patch_size: extraction.patch_size,
        palette_limit: extraction.palette_limit,
        tileability: extraction.tileability,
        patch_count: extraction.patch_count,
        warning_patch_count: extraction.warning_patch_count,
      },
      semantic_slot_selection: {
        mode: slotSelection.mode,
        layout_id: slotSelection.layout_id,
        candidate_count: slotSelection.candidate_count,
      },
      slot_separation: {
        mode: slotSeparationReport.mode,
        status: slotSeparationReport.status,
        threshold: slotSeparationReport.threshold,
        initial_warning_count: slotSeparationReport.initial_warning_count,
        remaining_warning_count: slotSeparationReport.remaining_warning_count,
        changed_slot_count: slotSeparationReport.changed_slot_count,
      },
      materials: materialEntries,
      slots: slotEntries,
      palette: {
        mode: 'sampled_limited',
        color_count: palette.size,
        colors: [...palette].sort(),
      },
    },
    report: {
      schema_version: 1,
      mode: 'two_point_five_d_manual_material_extraction_v1',
      status: warnings.length ? 'warning' : 'pass',
      source_id: sourceNormalization?.source_id ?? 'manual_material_source',
      material_profile_id: `manual_material_profile_${sourceHash.toString(16)}`,
      extraction,
      slot_separation: slotSeparationReport,
      semantic_slot_selection: {
        schema_version: slotSelection.schema_version,
        mode: slotSelection.mode,
        layout_id: slotSelection.layout_id,
        candidate_count: slotSelection.candidate_count,
        slots: slotSelection.slots,
      },
      sampling: {
        layout: layoutId,
        source_size: { width: image.info.width, height: image.info.height },
        samples,
      },
      quality_gates: {
        sample_count: samples.length,
        warning_sample_count: samples.filter((sample) => sample.diagnostics.status === 'warning').length,
        patch_count: extraction.patch_count,
        warning_patch_count: extraction.warning_patch_count,
        slot_distinction_warning_count: slotWarnings.length,
        warnings: [...new Set(warnings)],
      },
      palette: {
        color_count: palette.size,
        colors: [...palette].sort(),
      },
      warnings,
    },
  }
}

function buildExplicitLayoutSelection(report) {
  const candidate = {
    id: 'explicit_material_layout',
    order: 0,
    source_kind: 'user_configured',
    description: 'User-provided material layout.',
  }
  const score = scoreLayoutReport(report, candidate)
  const selected = summarizeCandidate(candidate, report, score)
  return {
    schema_version: 1,
    mode: EXPLICIT_LAYOUT_MODE,
    selected,
    candidates: [selected],
    rejected: [],
    decision: 'Using explicit material layout from caller.',
  }
}

async function buildAutoLayoutSelection({
  normalizedSourcePng,
  image,
  sourceHash,
  contract,
  sourceNormalization,
} = {}) {
  const evaluated = []
  for (const candidate of DEFAULT_LAYOUT_CANDIDATES) {
    const result = await buildMaterialProfileForLayout({
      normalizedSourcePng,
      image,
      sourceHash,
      contract,
      sourceNormalization,
      sampleLayout: candidate.sample_layout,
      layoutId: candidate.id,
    })
    const score = scoreLayoutReport(result.report, candidate)
    evaluated.push({
      candidate,
      result,
      summary: summarizeCandidate(candidate, result.report, score),
    })
  }
  evaluated.sort((left, right) =>
    left.summary.score - right.summary.score ||
    left.candidate.order - right.candidate.order ||
    left.summary.id.localeCompare(right.summary.id)
  )
  const selected = evaluated[0]
  const candidates = evaluated.map((item) => item.summary)
  return attachLayoutSelection(selected.result, {
    schema_version: 1,
    mode: LAYOUT_ASSIST_MODE,
    selected: selected.summary,
    candidates,
    rejected: candidates.filter((candidate) => candidate.id !== selected.summary.id),
    decision: `Selected ${selected.summary.id} with the lowest source-layout score.`,
  })
}

export async function buildManualMaterialProfileFromSource({
  normalizedSourcePng,
  contract,
  sourceNormalization,
  sampleLayout = null,
} = {}) {
  if (!Buffer.isBuffer(normalizedSourcePng)) {
    throw new Error('normalizedSourcePng is required for manual 2.5D material building')
  }
  const image = await sharp(normalizedSourcePng).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const sourceHash = hashBuffer(normalizedSourcePng)
  if (sampleLayout) {
    const explicit = await buildMaterialProfileForLayout({
      normalizedSourcePng,
      image,
      sourceHash,
      contract,
      sourceNormalization,
      sampleLayout,
      layoutId: 'explicit_material_layout',
      semanticSlotSelection: false,
    })
    return attachLayoutSelection(explicit, buildExplicitLayoutSelection(explicit.report))
  }
  return buildAutoLayoutSelection({
    normalizedSourcePng,
    image,
    sourceHash,
    contract,
    sourceNormalization,
  })
}

export async function renderMaterialSourceSamplesPreviewPng(normalizedSourcePng, materialSourceReport) {
  const metadata = await sharp(normalizedSourcePng).metadata()
  const width = metadata.width ?? materialSourceReport.sampling.source_size.width
  const height = metadata.height ?? materialSourceReport.sampling.source_size.height
  const colors = ['#52d273', '#ffcb47', '#45aaf2', '#fd5e53', '#a55eea', '#26de81', '#f7b731']
  const overlays = materialSourceReport.sampling.samples.map((sample, index) => {
    const rect = sample.sample_region
    const stroke = colors[index % colors.length]
    const fill = sample.diagnostics.status === 'warning' ? 'rgba(253, 94, 83, 0.16)' : 'rgba(82, 210, 115, 0.12)'
    const labelY = Math.max(12, rect.y + 14)
    return [
      `<rect x="${rect.x}" y="${rect.y}" width="${rect.w}" height="${rect.h}" fill="${fill}" stroke="${stroke}" stroke-width="4"/>`,
      `<rect x="${rect.x}" y="${Math.max(0, labelY - 12)}" width="${Math.min(rect.w, 220)}" height="18" fill="rgba(0,0,0,0.55)"/>`,
      `<text x="${rect.x + 6}" y="${labelY}" font-family="monospace" font-size="12" fill="#ffffff">${svgEscape(sample.slot)}</text>`,
    ].join('')
  })
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    ...overlays,
    '</svg>',
  ].join('')
  return sharp(normalizedSourcePng)
    .composite([{ input: svgBuffer(svg), blend: 'over' }])
    .png()
    .toBuffer()
}

export async function renderMaterialLayoutCandidatesPreviewPng(normalizedSourcePng, materialSourceReport) {
  const selection = materialSourceReport?.layout_selection
  if (!selection?.candidates?.length) return null
  const metadata = await sharp(normalizedSourcePng).metadata()
  const sourceW = metadata.width ?? materialSourceReport.sampling.source_size.width
  const sourceH = metadata.height ?? materialSourceReport.sampling.source_size.height
  const panelW = 240
  const panelH = 240
  const labelH = 46
  const gap = 8
  const candidates = selection.candidates
  const width = candidates.length * panelW + (candidates.length + 1) * gap
  const height = panelH + labelH + gap * 2
  const base = await sharp({
    create: { width, height, channels: 4, background: '#202426ff' },
  }).png().toBuffer()
  const composites = []
  const textParts = []
  const colors = ['#52d273', '#ffcb47', '#45aaf2', '#fd5e53', '#a55eea', '#26de81', '#f7b731']
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index]
    const x = gap + index * (panelW + gap)
    const y = gap + labelH
    composites.push({
      input: await sharp(normalizedSourcePng)
        .resize(panelW, panelH, { fit: 'fill', kernel: 'nearest' })
        .png()
        .toBuffer(),
      left: x,
      top: y,
    })
    const selected = candidate.id === selection.selected.id
    const label = selected ? `selected ${candidate.id}` : candidate.id
    const safeLabel = svgEscape(label).slice(0, 30)
    textParts.push(`<text x="${x}" y="18" font-family="monospace" font-size="12" fill="${selected ? '#52d273' : '#edf2f7'}">${safeLabel}</text>`)
    textParts.push(`<text x="${x}" y="36" font-family="monospace" font-size="11" fill="#9aa7b5">score ${candidate.score}; patch ${candidate.warning_counts.patch}; slot ${candidate.warning_counts.slot_distinction}</text>`)
    candidate.sample_regions.forEach((sample, sampleIndex) => {
      const rect = sample.sample_region
      const stroke = colors[sampleIndex % colors.length]
      const left = x + Math.round((rect.x / sourceW) * panelW)
      const top = y + Math.round((rect.y / sourceH) * panelH)
      const w = Math.max(1, Math.round((rect.w / sourceW) * panelW))
      const h = Math.max(1, Math.round((rect.h / sourceH) * panelH))
      textParts.push(`<rect x="${left}" y="${top}" width="${w}" height="${h}" fill="rgba(0,0,0,0.08)" stroke="${stroke}" stroke-width="2"/>`)
    })
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${textParts.join('')}</svg>`
  return sharp(base).composite([...composites, { input: svgBuffer(svg), left: 0, top: 0 }]).png().toBuffer()
}

export async function renderMaterialSlotCandidatesPreviewPng(normalizedSourcePng, materialSourceReport) {
  const selection = materialSourceReport?.semantic_slot_selection
  if (!selection?.slots?.length || selection.mode !== SEMANTIC_SLOT_MODE) return null
  const metadata = await sharp(normalizedSourcePng).metadata()
  const sourceW = metadata.width ?? materialSourceReport.sampling.source_size.width
  const sourceH = metadata.height ?? materialSourceReport.sampling.source_size.height
  const panelW = 160
  const panelH = 160
  const labelH = 50
  const gap = 8
  const slots = selection.slots
  const width = slots.length * panelW + (slots.length + 1) * gap
  const height = panelH + labelH + gap * 2
  const base = await sharp({
    create: { width, height, channels: 4, background: '#202426ff' },
  }).png().toBuffer()
  const composites = []
  const textParts = []
  for (let index = 0; index < slots.length; index += 1) {
    const slot = slots[index]
    const x = gap + index * (panelW + gap)
    const y = gap + labelH
    composites.push({
      input: await sharp(normalizedSourcePng)
        .resize(panelW, panelH, { fit: 'fill', kernel: 'nearest' })
        .png()
        .toBuffer(),
      left: x,
      top: y,
    })
    textParts.push(`<text x="${x}" y="18" font-family="monospace" font-size="12" fill="#edf2f7">${svgEscape(slot.slot).slice(0, 20)}</text>`)
    textParts.push(`<text x="${x}" y="36" font-family="monospace" font-size="11" fill="#9aa7b5">${svgEscape(slot.selected.candidate_id).slice(0, 22)}</text>`)
    for (const rejected of slot.rejected.slice(0, 2)) {
      const rect = rejected.sample_region
      const left = x + Math.round((rect.x / sourceW) * panelW)
      const top = y + Math.round((rect.y / sourceH) * panelH)
      const w = Math.max(1, Math.round((rect.w / sourceW) * panelW))
      const h = Math.max(1, Math.round((rect.h / sourceH) * panelH))
      textParts.push(`<rect x="${left}" y="${top}" width="${w}" height="${h}" fill="rgba(255,203,71,0.08)" stroke="#ffcb47" stroke-width="1"/>`)
    }
    const rect = slot.selected.sample_region
    const left = x + Math.round((rect.x / sourceW) * panelW)
    const top = y + Math.round((rect.y / sourceH) * panelH)
    const w = Math.max(1, Math.round((rect.w / sourceW) * panelW))
    const h = Math.max(1, Math.round((rect.h / sourceH) * panelH))
    textParts.push(`<rect x="${left}" y="${top}" width="${w}" height="${h}" fill="rgba(82,210,115,0.12)" stroke="#52d273" stroke-width="2"/>`)
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${textParts.join('')}</svg>`
  return sharp(base).composite([...composites, { input: svgBuffer(svg), left: 0, top: 0 }]).png().toBuffer()
}
