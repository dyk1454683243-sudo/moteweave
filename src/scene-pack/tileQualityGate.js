import { pixelOffset } from '../character-pack/imageMath.js'
import { measureStyleDrift } from '../character-pack/stylePipeline.js'
import { validateTileMap } from './tileArrangement.js'
import { TOPDOWN_TILE_DUAL_GRID_V0 } from './tileProfile.js'

const DEFAULT_THRESHOLDS = Object.freeze({
  maxVisualSeamDelta: 8,
  maxSelfLoopDelta: 8,
  maxOffPaletteRatio: 0.1,
  maxSourceAtlasBoundaryDelta: 8,
  minSourceAtlasOpaquePairRatio: 0.75,
  minSourceAtlasBoundaryColorCount: 4,
  maxContinuousSourceBoundaryCount: 0,
  sourceAtlasAlphaThreshold: 8,
  maxDuplicateTileDelta: 1,
  maxDuplicateTilePairs: 0,
})

const RAW_TILE_QUALITY_POLICIES = new Set(['warn', 'strict'])

function round(value, digits = 4) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function sideSample(image, side, position) {
  const x = side === 'west' ? 0 : side === 'east' ? image.width - 1 : position
  const y = side === 'north' ? 0 : side === 'south' ? image.height - 1 : position
  return pixelOffset(image.width, x, y)
}

function oppositeSide(side) {
  return {
    north: 'south',
    east: 'west',
    south: 'north',
    west: 'east',
  }[side]
}

function edgeLength(image, side) {
  return side === 'north' || side === 'south' ? image.width : image.height
}

function edgePositions(image, side) {
  const length = edgeLength(image, side)
  if (length <= 2) return Array.from({ length }, (_, index) => index)
  return Array.from({ length: length - 2 }, (_, index) => index + 1)
}

function channelDelta(a, offsetA, b, offsetB) {
  return Math.max(
    Math.abs(a[offsetA] - b[offsetB]),
    Math.abs(a[offsetA + 1] - b[offsetB + 1]),
    Math.abs(a[offsetA + 2] - b[offsetB + 2]),
    Math.abs(a[offsetA + 3] - b[offsetB + 3])
  )
}

function rgbaKey(data, offset) {
  return `${data[offset]},${data[offset + 1]},${data[offset + 2]},${data[offset + 3]}`
}

function imageForTile(tiles, mask) {
  if (!tiles) return null
  if (tiles instanceof Map) return tiles.get(mask) ?? tiles.get(String(mask)) ?? null
  return tiles[mask] ?? tiles[String(mask)] ?? null
}

function tileEntries(tiles) {
  if (!tiles) return []
  const entries = tiles instanceof Map ? [...tiles.entries()] : Object.entries(tiles)
  return entries.map(([mask, image]) => ({ mask: Number(mask), image, tile_id: `mask_${mask}` }))
}

function referencedTileEntries({ map, tiles }) {
  if (!map) return tileEntries(tiles)
  const masks = [...new Set(map.cells.map((cell) => Number(cell.mask)))]
    .filter((mask) => Number.isInteger(mask))
    .sort((a, b) => a - b)
  return masks
    .map((mask) => ({ mask, image: imageForTile(tiles, mask), tile_id: `mask_${mask}` }))
    .filter((entry) => entry.image)
}

function mapCellAt(map, x, y) {
  if (!map || x < 0 || y < 0 || x >= map.width || y >= map.height) return null
  return map.cells[y * map.width + x]
}

function addCategory(categories, category, example) {
  const item = categories.get(category) ?? { category, count: 0, examples: [] }
  item.count += 1
  if (example && item.examples.length < 3) item.examples.push(example)
  categories.set(category, item)
}

function sortedTaxonomy(categories) {
  return [...categories.values()].sort((a, b) => b.count - a.count || a.category.localeCompare(b.category))
}

function normalizeThresholds(thresholds = {}) {
  const { maxSeamDelta, ...rest } = thresholds
  return {
    ...DEFAULT_THRESHOLDS,
    ...rest,
    maxVisualSeamDelta: thresholds.maxVisualSeamDelta ?? maxSeamDelta ?? DEFAULT_THRESHOLDS.maxVisualSeamDelta,
  }
}

function normalizeRawTileQualityPolicy(value) {
  const policy = String(value ?? 'warn').trim().toLowerCase()
  return RAW_TILE_QUALITY_POLICIES.has(policy) ? policy : 'warn'
}

function normalizeGatePolicy({ gatePolicy, rawTilePolicy } = {}) {
  const policy = typeof gatePolicy === 'string'
    ? { raw_tile_quality: gatePolicy }
    : gatePolicy ?? {}
  return {
    raw_tile_quality: normalizeRawTileQualityPolicy(
      rawTilePolicy ??
      policy.raw_tile_quality ??
      policy.rawTileQuality ??
      policy.raw_tile_policy ??
      policy.rawTilePolicy
    ),
  }
}

function rawTileIssueStatus(hasIssue, gatePolicy) {
  if (!hasIssue) return 'pass'
  return gatePolicy.raw_tile_quality === 'strict' ? 'fail' : 'warning'
}

export function measureSharedEdgeDelta(source, neighbor, side) {
  const neighborSide = oppositeSide(side)
  if (!neighborSide) throw new Error(`Unknown tile side: ${side}`)
  const positions = edgePositions(source, side)
  const neighborPositions = edgePositions(neighbor, neighborSide)
  const length = Math.min(positions.length, neighborPositions.length)
  let total = 0
  let max_delta = 0
  for (let i = 0; i < length; i++) {
    const delta = channelDelta(
      source.data,
      sideSample(source, side, positions[i]),
      neighbor.data,
      sideSample(neighbor, neighborSide, neighborPositions[i])
    )
    total += delta
    max_delta = Math.max(max_delta, delta)
  }
  return {
    side,
    compared_pixels: length,
    average_delta: length ? round(total / length) : 0,
    max_delta,
  }
}

function measureTileImageDelta(a, b) {
  const pixelCount = Math.floor(Math.min(a.data.length, b.data.length) / 4)
  let total = 0
  let max_delta = 0
  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * 4
    const delta = channelDelta(a.data, offset, b.data, offset)
    total += delta
    max_delta = Math.max(max_delta, delta)
  }
  return {
    compared_pixels: pixelCount,
    average_delta: pixelCount ? round(total / pixelCount) : 0,
    max_delta,
  }
}

function exampleForMismatch(mismatch) {
  return `${mismatch.at.x},${mismatch.at.y} ${mismatch.side} -> ${mismatch.neighbor.x},${mismatch.neighbor.y}`
}

function buildMetadataSeamGate({ map, categories }) {
  if (!map) {
    return {
      id: 'metadata_seams',
      status: 'not_run',
      threshold: { max_edge_mismatch_count: 0 },
      observed: {},
      details: { edge_mismatches: [] },
    }
  }
  const validation = validateTileMap(map)
  for (const mismatch of validation.edge_mismatches) {
    addCategory(categories, 'tile.metadata_seam_mismatch', exampleForMismatch(mismatch))
  }
  return {
    id: 'metadata_seams',
    status: validation.edge_mismatches.length ? 'fail' : 'pass',
    threshold: { max_edge_mismatch_count: 0 },
    observed: {
      edge_mismatch_count: validation.edge_mismatches.length,
      checked_adjacencies: validation.metrics.checked_adjacencies,
      width: validation.metrics.width,
      height: validation.metrics.height,
      tile_count: validation.metrics.tile_count,
    },
    details: {
      edge_mismatches: validation.edge_mismatches,
    },
  }
}

function evaluateVisualSeams({ map, tiles, thresholds, categories }) {
  const failed_pairs = []
  const missing_images = []
  let checked_pairs = 0
  let max_edge_delta = 0
  if (!map) {
    return {
      id: 'visual_seams',
      status: 'not_run',
      threshold: { max_average_edge_delta: thresholds.maxVisualSeamDelta },
      observed: {},
      details: { failed_pairs, missing_images },
    }
  }

  for (const cell of map.cells) {
    const source = imageForTile(tiles, cell.mask)
    for (const [side, dx, dy] of [
      ['east', 1, 0],
      ['south', 0, 1],
    ]) {
      const neighborCell = mapCellAt(map, cell.x + dx, cell.y + dy)
      if (!neighborCell) continue
      checked_pairs += 1
      const neighbor = imageForTile(tiles, neighborCell.mask)
      if (!source || !neighbor) {
        const missing = { at: { x: cell.x, y: cell.y, index: cell.index, mask: cell.mask }, neighbor: { x: neighborCell.x, y: neighborCell.y, index: neighborCell.index, mask: neighborCell.mask }, side }
        missing_images.push(missing)
        addCategory(categories, 'tile.missing_image', `${cell.x},${cell.y} ${side}`)
        continue
      }
      const delta = measureSharedEdgeDelta(source, neighbor, side)
      max_edge_delta = Math.max(max_edge_delta, delta.average_delta)
      if (delta.average_delta <= thresholds.maxVisualSeamDelta) continue
      const item = {
        at: { x: cell.x, y: cell.y, index: cell.index, mask: cell.mask },
        neighbor: { x: neighborCell.x, y: neighborCell.y, index: neighborCell.index, mask: neighborCell.mask },
        side,
        average_delta: delta.average_delta,
        max_delta: delta.max_delta,
      }
      failed_pairs.push(item)
      addCategory(categories, 'tile.visual_seam_mismatch', `${cell.x},${cell.y} ${side} -> ${neighborCell.x},${neighborCell.y}`)
    }
  }

  return {
    id: 'visual_seams',
    status: failed_pairs.length || missing_images.length ? 'fail' : 'pass',
    threshold: { max_average_edge_delta: thresholds.maxVisualSeamDelta },
    observed: {
      checked_pair_count: checked_pairs,
      failed_pair_count: failed_pairs.length,
      missing_image_count: missing_images.length,
      max_edge_delta: round(max_edge_delta),
    },
    details: { failed_pairs, missing_images },
  }
}

function evaluateSelfLoops({ tiles, thresholds, categories }) {
  const failed_tiles = []
  let checked_tiles = 0
  let max_edge_delta = 0
  for (const tile of tileEntries(tiles)) {
    checked_tiles += 1
    for (const [axis, side] of [
      ['horizontal', 'east'],
      ['vertical', 'south'],
    ]) {
      const delta = measureSharedEdgeDelta(tile.image, tile.image, side)
      max_edge_delta = Math.max(max_edge_delta, delta.average_delta)
      if (delta.average_delta <= thresholds.maxSelfLoopDelta) continue
      failed_tiles.push({ tile_id: tile.tile_id, mask: tile.mask, axis, average_delta: delta.average_delta, max_delta: delta.max_delta })
      addCategory(categories, 'tile.self_loop_mismatch', `${tile.tile_id} ${axis}`)
    }
  }
  return {
    id: 'tile_self_loops',
    status: failed_tiles.length ? 'fail' : 'pass',
    threshold: { max_average_edge_delta: thresholds.maxSelfLoopDelta },
    observed: {
      checked_tile_count: checked_tiles,
      checked_axis_count: checked_tiles * 2,
      failed_tile_count: failed_tiles.length,
      max_edge_delta: round(max_edge_delta),
    },
    details: { failed_tiles },
  }
}

function evaluateTileDistinctness({ map, tiles, thresholds, categories, gatePolicy }) {
  if (!map) return null
  const entries = referencedTileEntries({ map, tiles })
  const duplicate_pairs = []
  let checkedPairs = 0
  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      checkedPairs += 1
      const delta = measureTileImageDelta(entries[i].image, entries[j].image)
      if (delta.average_delta > thresholds.maxDuplicateTileDelta) continue
      const pair = {
        a: entries[i].tile_id,
        b: entries[j].tile_id,
        average_delta: delta.average_delta,
        max_delta: delta.max_delta,
      }
      duplicate_pairs.push(pair)
      addCategory(categories, 'tile.duplicate_runtime_tile', `${pair.a} ~= ${pair.b}`)
    }
  }
  const hasIssue = duplicate_pairs.length > thresholds.maxDuplicateTilePairs
  return {
    id: 'tile_distinctness',
    policy: { raw_tile_quality: gatePolicy.raw_tile_quality },
    status: rawTileIssueStatus(hasIssue, gatePolicy),
    threshold: {
      max_duplicate_pair_count: thresholds.maxDuplicateTilePairs,
      max_average_tile_delta: thresholds.maxDuplicateTileDelta,
    },
    observed: {
      checked_tile_count: entries.length,
      checked_pair_count: checkedPairs,
      duplicate_pair_count: duplicate_pairs.length,
    },
    details: { duplicate_pairs },
  }
}

function evaluateStyle({ tiles, palette, thresholds }) {
  const reports = []
  let max_off_palette_ratio = 0
  if (!palette?.length) {
    return {
      id: 'style_drift',
      mode: 'report_only',
      status: 'not_run',
      threshold: { max_off_palette_ratio: thresholds.maxOffPaletteRatio },
      observed: {},
      details: { output_mutation: 'none', reports },
    }
  }
  for (const tile of tileEntries(tiles)) {
    const drift = measureStyleDrift(tile.image, { palette })
    max_off_palette_ratio = Math.max(max_off_palette_ratio, drift.off_palette_ratio)
    reports.push({ tile_id: tile.tile_id, mask: tile.mask, ...drift })
  }
  return {
    id: 'style_drift',
    mode: 'report_only',
    status: max_off_palette_ratio <= thresholds.maxOffPaletteRatio ? 'pass' : 'warning',
    threshold: { max_off_palette_ratio: thresholds.maxOffPaletteRatio },
    observed: {
      checked_tile_count: reports.length,
      max_off_palette_ratio: round(max_off_palette_ratio),
      max_average_nearest_palette_distance: reports.length ? Math.max(...reports.map((report) => report.average_nearest_palette_distance)) : 0,
      max_nearest_palette_distance: reports.length ? Math.max(...reports.map((report) => report.max_nearest_palette_distance)) : 0,
    },
    details: { output_mutation: 'none', reports },
  }
}

function sourceBoundaryPairs({ source, profile, orientation, row, col }) {
  const cell = profile.source.cell
  const pairs = []
  if (orientation === 'vertical') {
    const boundaryX = (col + 1) * cell.w
    const startY = row * cell.h
    for (let i = 1; i < cell.h - 1; i += 1) {
      pairs.push({
        left: pixelOffset(source.width, boundaryX - 1, startY + i),
        right: pixelOffset(source.width, boundaryX, startY + i),
      })
    }
    return pairs
  }
  const boundaryY = (row + 1) * cell.h
  const startX = col * cell.w
  for (let i = 1; i < cell.w - 1; i += 1) {
    pairs.push({
      left: pixelOffset(source.width, startX + i, boundaryY - 1),
      right: pixelOffset(source.width, startX + i, boundaryY),
    })
  }
  return pairs
}

function measureSourceBoundaryContinuity({ source, profile, orientation, row, col, thresholds }) {
  const pairs = sourceBoundaryPairs({ source, profile, orientation, row, col })
  const colors = new Set()
  let compared = 0
  let totalDelta = 0
  let maxDelta = 0
  for (const pair of pairs) {
    if (source.data[pair.left + 3] < thresholds.sourceAtlasAlphaThreshold || source.data[pair.right + 3] < thresholds.sourceAtlasAlphaThreshold) continue
    compared += 1
    colors.add(rgbaKey(source.data, pair.left))
    colors.add(rgbaKey(source.data, pair.right))
    const delta = channelDelta(source.data, pair.left, source.data, pair.right)
    totalDelta += delta
    maxDelta = Math.max(maxDelta, delta)
  }
  const averageDelta = compared ? round(totalDelta / compared) : 0
  return {
    id: orientation === 'vertical'
      ? `cell_${row}_${col} east -> cell_${row}_${col + 1}`
      : `cell_${row}_${col} south -> cell_${row + 1}_${col}`,
    orientation,
    at: { row, col },
    compared_pixel_count: compared,
    opaque_pair_ratio: pairs.length ? round(compared / pairs.length) : 0,
    average_delta: averageDelta,
    max_delta: maxDelta,
    distinct_color_count: colors.size,
    continuous:
      compared > 0 &&
      averageDelta <= thresholds.maxSourceAtlasBoundaryDelta &&
      (pairs.length ? compared / pairs.length : 0) >= thresholds.minSourceAtlasOpaquePairRatio &&
      colors.size >= thresholds.minSourceAtlasBoundaryColorCount,
  }
}

function evaluateSourceAtlasStructure({ source, profile, thresholds, categories, gatePolicy }) {
  if (!source) return null
  const expected = profile.source.sheet
  if (source.width !== expected.w || source.height !== expected.h || !source.data) {
    return {
      id: 'source_atlas_structure',
      status: 'not_run',
      threshold: {
        max_continuous_boundary_count: thresholds.maxContinuousSourceBoundaryCount,
        max_average_boundary_delta: thresholds.maxSourceAtlasBoundaryDelta,
      },
      observed: {},
      details: { continuous_boundaries: [], checked_boundaries: [] },
    }
  }

  const checked = []
  for (let row = 0; row < profile.grid.rows; row += 1) {
    for (let col = 0; col < profile.grid.columns - 1; col += 1) {
      checked.push(measureSourceBoundaryContinuity({ source, profile, orientation: 'vertical', row, col, thresholds }))
    }
  }
  for (let row = 0; row < profile.grid.rows - 1; row += 1) {
    for (let col = 0; col < profile.grid.columns; col += 1) {
      checked.push(measureSourceBoundaryContinuity({ source, profile, orientation: 'horizontal', row, col, thresholds }))
    }
  }

  const continuous = checked.filter((boundary) => boundary.continuous)
  for (const boundary of continuous) addCategory(categories, 'tile.source_atlas_continuity', boundary.id)
  const hasIssue = continuous.length > thresholds.maxContinuousSourceBoundaryCount
  return {
    id: 'source_atlas_structure',
    policy: { raw_tile_quality: gatePolicy.raw_tile_quality },
    status: rawTileIssueStatus(hasIssue, gatePolicy),
    threshold: {
      max_continuous_boundary_count: thresholds.maxContinuousSourceBoundaryCount,
      max_average_boundary_delta: thresholds.maxSourceAtlasBoundaryDelta,
      min_opaque_pair_ratio: thresholds.minSourceAtlasOpaquePairRatio,
      min_boundary_color_count: thresholds.minSourceAtlasBoundaryColorCount,
    },
    observed: {
      checked_boundary_count: checked.length,
      continuous_boundary_count: continuous.length,
      max_opaque_pair_ratio: checked.length ? round(Math.max(...checked.map((boundary) => boundary.opaque_pair_ratio))) : 0,
      min_continuous_average_delta: continuous.length ? round(Math.min(...continuous.map((boundary) => boundary.average_delta))) : 0,
    },
    details: {
      continuous_boundaries: continuous,
      checked_boundaries: checked,
    },
  }
}

function aggregateStatus(gates) {
  if (gates.some((gate) => gate.status === 'fail')) return 'fail'
  if (gates.some((gate) => gate.status === 'warning')) return 'warning'
  return 'pass'
}

export function evaluateSceneTileQualityGate({
  map,
  tiles,
  source,
  palette,
  thresholds = {},
  gatePolicy,
  rawTilePolicy,
  profile = TOPDOWN_TILE_DUAL_GRID_V0,
} = {}) {
  const effectiveThresholds = normalizeThresholds(thresholds)
  const effectiveGatePolicy = normalizeGatePolicy({ gatePolicy, rawTilePolicy })
  const categories = new Map()
  const metadataSeams = buildMetadataSeamGate({ map, categories })
  const visualSeams = evaluateVisualSeams({ map, tiles, thresholds: effectiveThresholds, categories })
  const selfLoop = evaluateSelfLoops({ tiles, thresholds: effectiveThresholds, categories })
  const tileDistinctness = evaluateTileDistinctness({ map, tiles, thresholds: effectiveThresholds, categories, gatePolicy: effectiveGatePolicy })
  const sourceAtlasStructure = evaluateSourceAtlasStructure({ source, profile, thresholds: effectiveThresholds, categories, gatePolicy: effectiveGatePolicy })
  const style = evaluateStyle({ tiles, palette, thresholds: effectiveThresholds })
  const gates = [metadataSeams, visualSeams, selfLoop, ...(tileDistinctness ? [tileDistinctness] : []), ...(sourceAtlasStructure ? [sourceAtlasStructure] : []), style]
  const blocking_errors = [
    ...(metadataSeams.status === 'fail' ? ['tile.metadata_seam_mismatch'] : []),
    ...(visualSeams.status === 'fail' ? ['tile.visual_seam_mismatch'] : []),
    ...(selfLoop.status === 'fail' ? ['tile.self_loop_mismatch'] : []),
    ...(tileDistinctness?.status === 'fail' ? ['tile.duplicate_runtime_tile'] : []),
    ...(sourceAtlasStructure?.status === 'fail' ? ['tile.source_atlas_continuity'] : []),
  ]
  const warnings = [
    ...(tileDistinctness?.status === 'warning' ? ['tile.duplicate_runtime_tile'] : []),
    ...(sourceAtlasStructure?.status === 'warning' ? ['tile.source_atlas_continuity'] : []),
    ...(style.status === 'warning' ? ['tile.style_drift'] : []),
  ]

  return {
    schema_version: 1,
    profile: map?.profile ?? 'topdown_tile_dual_grid_v0',
    status: aggregateStatus(gates),
    blocking_errors,
    warnings,
    thresholds: effectiveThresholds,
    gate_policy: effectiveGatePolicy,
    gates,
    failure_taxonomy: sortedTaxonomy(categories),
    metrics: {
      metadata_seams: metadataSeams,
      visual_seams: visualSeams,
      self_loop: selfLoop,
      ...(tileDistinctness ? { tile_distinctness: tileDistinctness } : {}),
      ...(sourceAtlasStructure ? { source_atlas_structure: sourceAtlasStructure } : {}),
      style,
    },
  }
}
