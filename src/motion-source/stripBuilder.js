import {
  cleanupAlphaArtifactsFromRgba,
  cleanupEdgeMatteResidueFromRgba,
  decontaminateEdgeColorsFromRgba,
  detectEdgeBackgroundPalette,
  floodRemoveBackgroundFromRgba,
} from '../character-pack/backgroundRemoval.js'
import { encodeRgbaPng } from '../character-pack/imageCodec.js'
import { cloneRgba, colorDistanceSq, pixelOffset } from '../character-pack/imageMath.js'
import { detectAlphaBBox } from '../character-pack/normalizer.js'
import {
  normalizePixelGridRefinementOptions,
  PIXEL_GRID_RECIPE_IDS,
  refinePixelFramesAsync,
} from '../character-pack/pixelGridRefinement.js'
import { createMotionSourceContract, validateMotionSourceContract } from './contract.js'
import {
  MOTION_SELECTION_RECIPE_IDS,
  normalizeMotionSelectionOptions,
  selectMotionFramesAsync,
} from './frameSelector.js'
import { normalizeMotionSelectionRequest } from './selectionMode.js'
import JSZip from 'jszip'

function round(value, digits = 4) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function throwIfMotionBuildAborted(signal) {
  if (!signal?.aborted) return
  const error = new Error('motion strip build cancelled')
  error.code = 'cancelled'
  error.failure_status = 'cancelled'
  error.cause = signal.reason
  throw error
}

async function yieldMotionBuild(signal) {
  if (!signal) return
  await new Promise((resolve) => setTimeout(resolve, 0))
  throwIfMotionBuildAborted(signal)
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function ensureContract(contract) {
  if (!contract) return createMotionSourceContract()
  if (contract.contract_version) return validateMotionSourceContract(contract)
  return createMotionSourceContract(contract)
}

function motionSelectionSettings(contract) {
  return normalizeMotionSelectionOptions(
    contract?.motion_selection ?? contract?.motionSelection ?? false
  )
}

function frameProvenanceRecord(frameProvenance, candidateIndex) {
  const source = Array.isArray(frameProvenance)
    ? frameProvenance[candidateIndex]
    : null
  return {
    candidate_index: candidateIndex,
    raw_index: Number.isInteger(source?.raw_index)
      ? source.raw_index
      : candidateIndex,
    timestamp_ms: Number.isFinite(source?.timestamp_ms)
      ? Number(source.timestamp_ms)
      : null,
    duration_ms: Number.isFinite(source?.duration_ms)
      ? Number(source.duration_ms)
      : null,
    timing_source: typeof source?.timing_source === 'string'
      ? source.timing_source
      : 'unavailable',
    source_entry: typeof source?.source_entry === 'string'
      ? source.source_entry
      : null,
  }
}

function frameProvenanceFields(frameProvenance, candidateIndex) {
  const provenance = frameProvenanceRecord(frameProvenance, candidateIndex)
  return {
    candidate_index: provenance.candidate_index,
    raw_index: provenance.raw_index,
    timestamp_ms: provenance.timestamp_ms,
    duration_ms: provenance.duration_ms,
    timing_source: provenance.timing_source,
    source_entry: provenance.source_entry,
    provenance,
  }
}

function assertFrame(frame, index) {
  if (!frame || !Number.isInteger(frame.width) || !Number.isInteger(frame.height) || frame.width <= 0 || frame.height <= 0) {
    throw new Error(`invalid_motion_frame:${index}`)
  }
  if (!frame.data || frame.data.length !== frame.width * frame.height * 4) throw new Error(`invalid_motion_frame:${index}`)
}

function dedupeColors(colors) {
  const seen = new Set()
  const result = []
  for (const color of colors) {
    if (!Array.isArray(color) || color.length < 3) continue
    const normalized = color.slice(0, 3).map((channel) => clamp(Math.round(channel), 0, 255))
    const key = normalized.join(',')
    if (seen.has(key)) continue
    seen.add(key)
    result.push(normalized)
  }
  return result
}

function edgeOffsets(image) {
  const offsets = []
  for (let x = 0; x < image.width; x += 1) {
    offsets.push(pixelOffset(image.width, x, 0), pixelOffset(image.width, x, image.height - 1))
  }
  for (let y = 1; y < image.height - 1; y += 1) {
    offsets.push(pixelOffset(image.width, 0, y), pixelOffset(image.width, image.width - 1, y))
  }
  return offsets
}

function edgeBackgroundStats(image, keyColor, tolerance) {
  const buckets = new Map()
  let total = 0
  let nearKey = 0
  for (const offset of edgeOffsets(image)) {
    if (image.data[offset + 3] === 0) continue
    total += 1
    if (colorDistanceSq(image.data, offset, keyColor) <= tolerance * tolerance) nearKey += 1
    const key = [
      Math.floor(image.data[offset] / 16),
      Math.floor(image.data[offset + 1] / 16),
      Math.floor(image.data[offset + 2] / 16),
    ].join(',')
    buckets.set(key, (buckets.get(key) ?? 0) + 1)
  }
  const counts = [...buckets.values()]
  const dominant = counts.length ? Math.max(...counts) : 0
  return {
    edge_pixel_count: total,
    quantized_color_count: buckets.size,
    dominant_share: total ? round(dominant / total, 6) : 1,
    key_color_share: total ? round(nearKey / total, 6) : 0,
  }
}

function sourceWarningsForFrame(image, keyColor, tolerance) {
  const stats = edgeBackgroundStats(image, keyColor, tolerance)
  const warnings = []
  if (stats.edge_pixel_count > 0 && stats.quantized_color_count > 1 && stats.dominant_share < 0.96) {
    warnings.push('non_flat_edge_background')
  }
  return { stats, warnings }
}

function hasForegroundNeighbor(image, x, y, keyColor, tolerance) {
  const threshold = tolerance * tolerance
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (!dx && !dy) continue
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || ny < 0 || nx >= image.width || ny >= image.height) continue
      const offset = pixelOffset(image.width, nx, ny)
      if (image.data[offset + 3] === 0) continue
      if (colorDistanceSq(image.data, offset, keyColor) > threshold) return true
    }
  }
  return false
}

function measureKeyHaloScore(image, keyColor, tolerance) {
  const keyThreshold = tolerance * tolerance
  const residueThreshold = Math.max(tolerance + 16, 40) ** 2
  let foregroundPixels = 0
  let residuePixels = 0
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const offset = pixelOffset(image.width, x, y)
      if (image.data[offset + 3] === 0) continue
      const distance = colorDistanceSq(image.data, offset, keyColor)
      if (distance > keyThreshold) foregroundPixels += 1
      if (distance <= residueThreshold && hasForegroundNeighbor(image, x, y, keyColor, tolerance)) residuePixels += 1
    }
  }
  return foregroundPixels ? round(residuePixels / foregroundPixels, 6) : 0
}

function cleanFrameBackground(raw, contract) {
  const keyColor = contract.background.key_color
  const tolerance = Number(contract.background.tolerance)
  const source = cloneRgba(raw)
  const hasSourceAlpha = source.data.some((_, index) => index % 4 === 3 && source.data[index] < 255)
  const warnings = sourceWarningsForFrame(source, keyColor, tolerance)
  const haloScoreBefore = measureKeyHaloScore(source, keyColor, tolerance)
  let image
  let mode

  if (hasSourceAlpha && contract.background.source_requirement === 'transparent_alpha') {
    image = cleanupAlphaArtifactsFromRgba(source, { minAlpha: 18 })
    mode = 'alpha_cleanup'
  } else {
    const colors = dedupeColors([
      keyColor,
      ...detectEdgeBackgroundPalette(source, { maxColors: 4 }),
    ])
    const flooded = floodRemoveBackgroundFromRgba(source, { color: keyColor, tolerance })
    const residueCleaned = cleanupEdgeMatteResidueFromRgba(flooded, {
      colors,
      tolerance,
      minDistance: tolerance,
      residueTolerance: Math.max(40, tolerance + 16),
      passes: 2,
    })
    const decontaminated = contract.background.defringe
      ? decontaminateEdgeColorsFromRgba(residueCleaned, {
        colors,
        tolerance,
        maxBackgroundDistance: 112,
        strength: 0.55,
      })
      : residueCleaned
    image = cleanupAlphaArtifactsFromRgba(decontaminated, { minAlpha: 18 })
    mode = 'key_flood'
  }

  const haloScoreAfter = measureKeyHaloScore(image, keyColor, tolerance)
  return {
    image,
    report: {
      mode,
      warnings: warnings.warnings,
      edge_background: warnings.stats,
      halo_score_before: haloScoreBefore,
      halo_score_after: haloScoreAfter,
      visible_bbox_before: detectAlphaBBox(source),
      visible_bbox_after: detectAlphaBBox(image),
    },
  }
}

function pasteNearest(src, dst, srcBox, dstX, dstY, scale) {
  const outW = Math.max(1, Math.round(srcBox.w * scale))
  const outH = Math.max(1, Math.round(srcBox.h * scale))
  for (let y = 0; y < outH; y += 1) {
    for (let x = 0; x < outW; x += 1) {
      const sx = srcBox.x + Math.min(srcBox.w - 1, Math.floor(x / scale))
      const sy = srcBox.y + Math.min(srcBox.h - 1, Math.floor(y / scale))
      const tx = dstX + x
      const ty = dstY + y
      if (tx < 0 || ty < 0 || tx >= dst.width || ty >= dst.height) continue
      const s = pixelOffset(src.width, sx, sy)
      const d = pixelOffset(dst.width, tx, ty)
      dst.data[d] = src.data[s]
      dst.data[d + 1] = src.data[s + 1]
      dst.data[d + 2] = src.data[s + 2]
      dst.data[d + 3] = src.data[s + 3]
    }
  }
  return { width: outW, height: outH }
}

function blankImage(width, height) {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) }
}

function pasteImage(src, dst, dstX, dstY) {
  for (let y = 0; y < src.height; y += 1) {
    for (let x = 0; x < src.width; x += 1) {
      const tx = dstX + x
      const ty = dstY + y
      if (tx < 0 || ty < 0 || tx >= dst.width || ty >= dst.height) continue
      const s = pixelOffset(src.width, x, y)
      const d = pixelOffset(dst.width, tx, ty)
      dst.data[d] = src.data[s]
      dst.data[d + 1] = src.data[s + 1]
      dst.data[d + 2] = src.data[s + 2]
      dst.data[d + 3] = src.data[s + 3]
    }
  }
}

function positiveModulo(value, modulo) {
  return ((value % modulo) + modulo) % modulo
}

function scaledGridPlacementResidue({
  sourceOffset,
  bboxOrigin,
  sourceCellSize,
  normalizedCellSize,
  targetPhase,
}) {
  const sourcePhase = positiveModulo(sourceOffset - bboxOrigin, sourceCellSize)
  const scaledPhase = sourcePhase * normalizedCellSize / sourceCellSize
  if (!Number.isInteger(scaledPhase)) return null
  return positiveModulo(targetPhase - scaledPhase, normalizedCellSize)
}

function alignedCoordinateWithin(value, step, residue, min, max) {
  if (!step || min > max) return { value: clamp(value, min, max), aligned: false }
  const first = min + positiveModulo(residue - min, step)
  const last = max - positiveModulo(max - residue, step)
  if (first > last) return { value: clamp(value, min, max), aligned: false }
  const nearest = residue + Math.round((value - residue) / step) * step
  return {
    value: clamp(nearest, first, last),
    aligned: true,
  }
}

function normalizeSelectedFrames({ selected, cleanedFrames, contract, pixelGrid = null }) {
  const [cellW, cellH] = contract.frame_size.normalized_cell
  const padding = contract.anchor_policy.padding_px
  const baseBaseline = cellH - padding - 2
  const baselineY = clamp(Math.round(baseBaseline + Number(contract.anchor_policy.static_offset_y)), padding, cellH - 1)
  const selectedWithBboxes = selected.map((item) => ({
    ...item,
    source_image: cleanedFrames[item.original_index],
    source_bbox: detectAlphaBBox(cleanedFrames[item.original_index]),
  }))
  const boxes = selectedWithBboxes.map((item) => item.source_bbox).filter(Boolean)
  const maxW = Math.max(1, ...boxes.map((bbox) => bbox.w))
  const maxH = Math.max(1, ...boxes.map((bbox) => bbox.h))
  const requestedScale = Math.min(
    1,
    (cellW - padding * 2) / maxW,
    (baselineY - padding + 1) / maxH
  )
  const sourceCellSize = Number(pixelGrid?.cell_size ?? 0)
  const candidateGridCellSize = sourceCellSize > 0
    ? Math.floor(sourceCellSize * requestedScale)
    : null
  const normalizedGridCellSize = candidateGridCellSize >= 1
    ? candidateGridCellSize
    : null
  const scale = normalizedGridCellSize
    ? normalizedGridCellSize / sourceCellSize
    : requestedScale
  let allPlacementsGridAligned = Boolean(normalizedGridCellSize)

  const frames = selectedWithBboxes.map((item, index) => {
    const image = blankImage(cellW, cellH)
    const bbox = item.source_bbox
    if (!bbox) {
      return {
        index,
        original_index: item.original_index,
        candidate_index: item.candidate_index ?? item.original_index,
        raw_index: item.raw_index ?? item.original_index,
        timestamp_ms: item.timestamp_ms ?? null,
        duration_ms: item.duration_ms ?? null,
        timing_source: item.timing_source ?? 'unavailable',
        source_entry: item.source_entry ?? null,
        provenance: item.provenance ?? null,
        source_bbox: null,
        normalized_bbox: null,
        normalized_anchor: null,
        image,
        warnings: ['empty_frame'],
      }
    }

    const scaledW = Math.max(1, Math.round(bbox.w * scale))
    const scaledH = Math.max(1, Math.round(bbox.h * scale))
    const rawDstX = Math.round(cellW / 2 - scaledW / 2)
    const rawDstY = Math.round(baselineY - scaledH + 1)
    const xResidue = normalizedGridCellSize
      ? scaledGridPlacementResidue({
          sourceOffset: Number(pixelGrid.offset?.x ?? 0),
          bboxOrigin: bbox.x,
          sourceCellSize,
          normalizedCellSize: normalizedGridCellSize,
          targetPhase: 0,
        })
      : null
    const yResidue = normalizedGridCellSize
      ? scaledGridPlacementResidue({
          sourceOffset: Number(pixelGrid.offset?.y ?? 0),
          bboxOrigin: bbox.y,
          sourceCellSize,
          normalizedCellSize: normalizedGridCellSize,
          targetPhase: positiveModulo(baselineY + 1, normalizedGridCellSize),
        })
      : null
    const xPlacement = alignedCoordinateWithin(
      rawDstX,
      normalizedGridCellSize && xResidue !== null ? normalizedGridCellSize : null,
      xResidue ?? 0,
      padding,
      cellW - padding - scaledW
    )
    const yPlacement = alignedCoordinateWithin(
      rawDstY,
      normalizedGridCellSize && yResidue !== null ? normalizedGridCellSize : null,
      yResidue ?? 0,
      rawDstY,
      rawDstY
    )
    const dstX = xPlacement.value
    const dstY = yPlacement.value
    if (
      normalizedGridCellSize &&
      (!xPlacement.aligned || !yPlacement.aligned)
    ) {
      allPlacementsGridAligned = false
    }
    pasteNearest(item.source_image, image, bbox, dstX, dstY, scale)
    const normalizedBbox = detectAlphaBBox(image)
    return {
      index,
      original_index: item.original_index,
      candidate_index: item.candidate_index ?? item.original_index,
      raw_index: item.raw_index ?? item.original_index,
      timestamp_ms: item.timestamp_ms ?? null,
      duration_ms: item.duration_ms ?? null,
      timing_source: item.timing_source ?? 'unavailable',
      source_entry: item.source_entry ?? null,
      provenance: item.provenance ?? null,
      source_bbox: bbox,
      normalized_bbox: normalizedBbox,
      normalized_anchor: { x: Math.round(cellW / 2), y: baselineY, mode: contract.anchor_policy.baseline },
      image,
      placement: {
        dst_x: dstX,
        dst_y: dstY,
        scaled_w: scaledW,
        scaled_h: scaledH,
        pixel_grid_phase: normalizedGridCellSize
          ? {
              target: {
                x: 0,
                y: positiveModulo(baselineY + 1, normalizedGridCellSize),
              },
              required_destination_residue: {
                x: xResidue,
                y: yResidue,
              },
              aligned: xPlacement.aligned && yPlacement.aligned,
            }
          : null,
      },
      warnings: [],
    }
  })

  return {
    frames,
    normalization: {
      cell_size: { w: cellW, h: cellH },
      padding_px: padding,
      baseline_y: baselineY,
      anchor_x: Math.round(cellW / 2),
      scale: round(scale, 6),
      requested_scale: round(requestedScale, 6),
      source_max_bbox: { w: maxW, h: maxH },
      static_offset_y: Number(contract.anchor_policy.static_offset_y),
      pixel_grid: normalizedGridCellSize
        ? {
            status: allPlacementsGridAligned ? 'applied' : 'placement_unaligned',
            source_cell_size: sourceCellSize,
            normalized_cell_size: normalizedGridCellSize,
            phase_alignment: allPlacementsGridAligned
              ? 'normalized_cell_multiple'
              : 'bounded_fallback',
          }
        : sourceCellSize > 0
          ? {
              status: 'integer_cell_unavailable',
              source_cell_size: sourceCellSize,
              normalized_cell_size: null,
              phase_alignment: 'bounded_fallback',
            }
          : null,
    },
  }
}

function composeHorizontalStrip(frames, cellW, cellH) {
  const image = blankImage(cellW * frames.length, cellH)
  for (const [index, frame] of frames.entries()) pasteImage(frame.image, image, index * cellW, 0)
  return image
}

function thumbnailForFrame(source, cellW, cellH) {
  const image = blankImage(cellW, cellH)
  const scale = Math.min(cellW / source.width, cellH / source.height)
  const outW = Math.max(1, Math.round(source.width * scale))
  const outH = Math.max(1, Math.round(source.height * scale))
  const srcBox = { x: 0, y: 0, w: source.width, h: source.height }
  pasteNearest(source, image, srcBox, Math.floor((cellW - outW) / 2), Math.floor((cellH - outH) / 2), scale)
  return image
}

function composeContactSheet({ rawFrames, selected, normalizedFrames, cellW, cellH }) {
  const image = blankImage(cellW * selected.length, cellH * 2)
  for (const [index, selectedFrame] of selected.entries()) {
    const rawThumb = thumbnailForFrame(rawFrames[selectedFrame.original_index], cellW, cellH)
    pasteImage(rawThumb, image, index * cellW, 0)
    pasteImage(normalizedFrames[index].image, image, index * cellW, cellH)
  }
  return image
}

function summarizeBackground(frameReports, keyColor) {
  const haloBefore = frameReports.map((frame) => frame.halo_score_before)
  const haloAfter = frameReports.map((frame) => frame.halo_score_after)
  return {
    key_color: keyColor,
    frame_count: frameReports.length,
    halo_score_before: round(Math.max(0, ...haloBefore), 6),
    halo_score_after: round(Math.max(0, ...haloAfter), 6),
    frames: frameReports,
  }
}

function uniqueWarnings(frameReports, selectorWarnings) {
  return [...new Set([
    ...frameReports.flatMap((frame) => frame.warnings ?? []),
    ...selectorWarnings,
  ])].sort()
}

function publicNormalizedFrame(frame) {
  return {
    index: frame.index,
    original_index: frame.original_index,
    candidate_index: frame.candidate_index ?? frame.original_index,
    raw_index: frame.raw_index ?? frame.original_index,
    timestamp_ms: frame.timestamp_ms ?? null,
    duration_ms: frame.duration_ms ?? null,
    timing_source: frame.timing_source ?? 'unavailable',
    source_entry: frame.source_entry ?? null,
    provenance: frame.provenance ?? null,
    source_bbox: frame.source_bbox,
    normalized_bbox: frame.normalized_bbox,
    normalized_anchor: frame.normalized_anchor,
    placement: frame.placement ?? null,
    pixel_grid_refinement: frame.pixel_grid_refinement ?? null,
    warnings: frame.warnings,
  }
}

function manualFrameSelection(cleanedFrames, indexes, {
  frameProvenance = null,
  settings,
  targetFrameCount = indexes.length,
} = {}) {
  const selected = indexes.map((originalIndex, outputIndex) => ({
    output_index: outputIndex,
    original_index: originalIndex,
    source_position: originalIndex,
    ...frameProvenanceFields(frameProvenance, originalIndex),
    hash: null,
    bbox: detectAlphaBBox(cleanedFrames[originalIndex]),
    motion_delta: null,
    selection_reason: 'manual_user_selection',
  }))
  const selectedSet = new Set(indexes)
  const rejected = cleanedFrames
    .map((_, originalIndex) => ({
      original_index: originalIndex,
      source_position: originalIndex,
      ...frameProvenanceFields(frameProvenance, originalIndex),
      reason: selectedSet.has(originalIndex) ? 'selected' : 'manual_not_selected',
    }))
    .filter((item) => item.reason !== 'selected')
  const report = {
    selected,
    rejected,
    loop: {
      start_original_index: selected[0]?.original_index ?? null,
      end_original_index: selected[selected.length - 1]?.original_index ?? null,
      similarity: null,
      seamless: null,
      selection_mode: 'manual',
    },
    warnings: [],
    selection_mode: 'manual',
  }
  if (settings?.recipe !== MOTION_SELECTION_RECIPE_IDS.V2) return report
  const targetSatisfied = selected.length === targetFrameCount
  return {
    schema_version: 2,
    mode: 'motion_selection_report_v2',
    status: 'manual',
    recipe: settings.recipe,
    settings,
    selection_application_status: 'not_run_manual_authority',
    input_frame_count: cleanedFrames.length,
    distinct_frame_count: null,
    usable_frame_count: selected.length,
    target_frame_count: targetFrameCount,
    target: {
      status: targetSatisfied ? 'manual' : 'manual_target_mismatch',
      target_satisfied: targetSatisfied,
      target_frame_count: targetFrameCount,
      selected_frame_count: selected.length,
      shortfall_count: Math.max(0, targetFrameCount - selected.length),
    },
    provenance: cleanedFrames.map((_, index) => frameProvenanceRecord(frameProvenance, index)),
    registration: { status: 'not_run_manual_authority', frames: [] },
    clusters: { status: 'not_run_manual_authority', items: [] },
    static_gate: { status: 'not_run_manual_authority', static: null },
    periodicity: { status: 'not_run_manual_authority', candidates: [] },
    phase_selection: { status: 'not_run_manual_authority', mode: 'manual' },
    temporal_matte: { status: 'not_run_manual_authority', applied: false },
    ...report,
    warnings: targetSatisfied ? [] : ['manual_target_count_mismatch'],
  }
}

function sequenceArtifactBinding(value = null) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const binding = {}
  for (const key of [
    'source_upload_id',
    'source_identity',
    'operation_id',
    'options_hash',
    'session_scope',
  ]) {
    if (value[key] !== undefined && value[key] !== null) binding[key] = value[key]
  }
  return binding
}

async function buildSequenceArtifacts({
  normalizedFrames,
  stripPng,
  contract,
  artifactBinding,
  signal = null,
}) {
  const zip = new JSZip()
  const framePngs = []
  const frameEntries = []
  for (const frame of normalizedFrames) {
    throwIfMotionBuildAborted(signal)
    const fileName = `frames/frame_${String(frame.index + 1).padStart(5, '0')}.png`
    const png = await encodeRgbaPng(frame.image)
    await yieldMotionBuild(signal)
    framePngs.push({ fileName, png })
    frameEntries.push({
      sequence_index: frame.index,
      source_index: frame.original_index,
      candidate_index: frame.candidate_index ?? frame.original_index,
      raw_index: frame.raw_index ?? frame.original_index,
      timestamp_ms: frame.timestamp_ms ?? null,
      duration_ms: frame.duration_ms ?? null,
      timing_source: frame.timing_source ?? 'unavailable',
      source_entry: frame.source_entry ?? null,
      provenance: frame.provenance ?? null,
      file: fileName,
      source_bbox: frame.source_bbox,
      normalized_bbox: frame.normalized_bbox,
      normalized_anchor: frame.normalized_anchor,
      placement: frame.placement ?? null,
    })
  }
  const framesIndex = {
    schema_version: 1,
    mode: 'motion_sequence_frames_index_v1',
    source_kind: contract.source_kind,
    runtime_action: contract.runtime_action,
    frame_count: normalizedFrames.length,
    cell_size: {
      w: contract.frame_size.normalized_cell[0],
      h: contract.frame_size.normalized_cell[1],
    },
    sheet_file: 'video_frames_sheet.png',
    ...sequenceArtifactBinding(artifactBinding),
    frames: frameEntries,
  }
  zip.file('video_frames_sheet.png', stripPng)
  zip.file('frames_index.json', JSON.stringify(framesIndex, null, 2))
  for (const frame of framePngs) zip.file(frame.fileName, frame.png)
  throwIfMotionBuildAborted(signal)
  const framesZip = await zip.generateAsync({ type: 'nodebuffer' })
  throwIfMotionBuildAborted(signal)
  return {
    videoFramesSheetPng: stripPng,
    framesIndex,
    framesZip,
  }
}

export async function buildMotionStrip({
  frames,
  frameProvenance = null,
  contract,
  selectionMode,
  selectedFrameIndexes = null,
  pixelGridRefinement = false,
  artifactBinding = null,
  signal = null,
} = {}) {
  if (!Array.isArray(frames) || !frames.length) throw new Error('motion_frames_required')
  const resolvedContract = ensureContract(contract)
  frames.forEach(assertFrame)
  if (frameProvenance !== null && (
    !Array.isArray(frameProvenance) ||
    frameProvenance.length !== frames.length
  )) {
    throw new Error('invalid_motion_frame_provenance')
  }
  const selectionSettings = motionSelectionSettings(resolvedContract)
  const selectionRequest = normalizeMotionSelectionRequest({
    selectionMode,
    selectedFrameIndexes,
    frameCount: frames.length,
  })

  const cleaned = []
  await yieldMotionBuild(signal)
  for (const frame of frames) {
    throwIfMotionBuildAborted(signal)
    cleaned.push(cleanFrameBackground(frame, resolvedContract))
    await yieldMotionBuild(signal)
  }
  const cleanedFrames = cleaned.map((item) => item.image)
  const backgroundFrameReports = cleaned.map((item, index) => ({
    index,
    ...item.report,
  }))
  const frameSelection = selectionRequest.effectiveSelectionMode === 'manual'
    ? manualFrameSelection(cleanedFrames, selectionRequest.selectedFrameIndexes, {
      frameProvenance,
      settings: selectionSettings,
      targetFrameCount: resolvedContract.target_frame_count,
    })
    : await selectMotionFramesAsync(cleanedFrames, {
      targetFrameCount: resolvedContract.target_frame_count,
      motionSelection: selectionSettings,
      frameProvenance,
      signal,
    })
  throwIfMotionBuildAborted(signal)
  const pixelGridRefinementOptions = normalizePixelGridRefinementOptions(pixelGridRefinement)
  const legacyPixelGridRecipe =
    pixelGridRefinementOptions?.recipe === PIXEL_GRID_RECIPE_IDS.V1_COMPAT
  const baselineNormalization = normalizeSelectedFrames({
    selected: frameSelection.selected,
    cleanedFrames,
    contract: resolvedContract,
    pixelGrid: null,
  })
  throwIfMotionBuildAborted(signal)
  let pixelGridRefinementResult = null
  let normalizedFrames = baselineNormalization.frames
  let normalization = baselineNormalization.normalization
  let normalizationCompatible = true

  if (pixelGridRefinementOptions && legacyPixelGridRecipe) {
    pixelGridRefinementResult = await refinePixelFramesAsync(
      baselineNormalization.frames.map((frame) => frame.image),
      {
        maxColors: 16,
        minCell: 2,
        maxCell: 16,
        emitLogical: false,
        ...pixelGridRefinementOptions,
        signal,
      }
    )
  } else if (pixelGridRefinementOptions) {
    pixelGridRefinementResult = await refinePixelFramesAsync(
      frameSelection.selected.map((frame) => cleanedFrames[frame.original_index]),
      {
        maxColors: 16,
        minCell: 2,
        maxCell: 32,
        emitLogical: false,
        ...pixelGridRefinementOptions,
        signal,
      }
    )
    const normalizationSources = cleanedFrames.slice()
    if (pixelGridRefinementResult.status === 'refined') {
      frameSelection.selected.forEach((frame, index) => {
        normalizationSources[frame.original_index] = pixelGridRefinementResult.frames[index]
      })
    }
    const attemptedNormalization = normalizeSelectedFrames({
      selected: frameSelection.selected,
      cleanedFrames: normalizationSources,
      contract: resolvedContract,
      pixelGrid: pixelGridRefinementResult.status === 'refined'
        ? pixelGridRefinementResult.grid
        : null,
    })
    normalizationCompatible =
      pixelGridRefinementResult.status !== 'refined' ||
      attemptedNormalization.normalization.pixel_grid?.status === 'applied'
    if (normalizationCompatible) {
      normalizedFrames = attemptedNormalization.frames
      normalization = attemptedNormalization.normalization
    } else {
      normalizedFrames = baselineNormalization.frames
      normalization = {
        ...baselineNormalization.normalization,
        pixel_grid: {
          ...(attemptedNormalization.normalization.pixel_grid ?? {}),
          attempted_status:
            attemptedNormalization.normalization.pixel_grid?.status ?? 'not_applicable',
          status: 'passthrough_normalization_incompatible',
          source_refinement_status: 'refined',
          fallback: 'unrefined_source_frames',
        },
      }
    }
  }

  const outputFrames =
    pixelGridRefinementResult?.status === 'refined' &&
    (legacyPixelGridRecipe || normalizationCompatible)
      ? normalizedFrames.map((frame, index) => ({
          ...frame,
          ...(legacyPixelGridRecipe
            ? { image: pixelGridRefinementResult.frames[index] }
            : {}),
          pixel_grid_refinement: pixelGridRefinementResult.report.frames[index],
        }))
      : normalizedFrames
  const [cellW, cellH] = resolvedContract.frame_size.normalized_cell
  const stripImage = composeHorizontalStrip(outputFrames, cellW, cellH)
  const contactSheetImage = composeContactSheet({
    rawFrames: frames,
    selected: frameSelection.selected,
    normalizedFrames: outputFrames,
    cellW,
    cellH,
  })
  const selectedFrames = {
    ...frameSelection,
    selection_mode: selectionRequest.effectiveSelectionMode,
    requested_selection_mode: selectionRequest.requestedSelectionMode,
    effective_selection_mode: selectionRequest.effectiveSelectionMode,
  }
  const pixelGridReport = pixelGridRefinementResult?.report
    ? legacyPixelGridRecipe
      ? {
          ...pixelGridRefinementResult.report,
          warnings: [...(pixelGridRefinementResult.report.warnings ?? [])],
        }
      : {
        ...pixelGridRefinementResult.report,
        status:
          pixelGridRefinementResult.status === 'refined' && !normalizationCompatible
            ? 'passthrough_normalization_incompatible'
            : pixelGridRefinementResult.report.status,
        source_refinement_status: pixelGridRefinementResult.report.status,
        warnings: [...(pixelGridRefinementResult.report.warnings ?? [])],
        sequence: {
          ...(pixelGridRefinementResult.report.sequence ?? {}),
          normalized_grid_status: normalization.pixel_grid?.status ?? 'not_applicable',
          ...(
            pixelGridRefinementResult.status === 'refined' && !normalizationCompatible
              ? {
                  shared_palette: false,
                  shared_grid: false,
                  invariants: [],
                  logical_output_safe: false,
                }
              : {}
          ),
        },
        ...(
          pixelGridRefinementResult.status === 'refined' && !normalizationCompatible
            ? {
                source_refinement: {
                  status: pixelGridRefinementResult.report.status,
                  frames: pixelGridRefinementResult.report.frames ?? [],
                  sequence: pixelGridRefinementResult.report.sequence ?? null,
                  outline: pixelGridRefinementResult.report.outline ?? null,
                },
                frames: (pixelGridRefinementResult.report.frames ?? []).map((frame) => ({
                  index: frame.index,
                  applied: false,
                  reason: 'normalization_incompatible',
                  changed_pixel_ratio: 0,
                  alpha_hardened_pixel_count: 0,
                  empty_cell_count: 0,
                  detail_protected_cell_count: 0,
                  detail_protected_pixel_count: 0,
                  color_comparison_count: 0,
                })),
                outline: {
                  stage: 'after_refinement',
                  mode: 'none',
                  outline_cell_count: 0,
                  added_outline_cell_count: 0,
                  outline_logical_pixel_count: 0,
                  outline_logical_pixel_ratio: 0,
                  outline_pixel_count: 0,
                  outline_pixel_ratio: 0,
                },
              }
            : {}
        ),
        }
    : null
  if (
    pixelGridReport &&
    !legacyPixelGridRecipe &&
    normalization.pixel_grid &&
    normalization.pixel_grid.status !== 'applied'
  ) {
    pixelGridReport.warnings.push(`grid_normalization_${normalization.pixel_grid.status}`)
  }
  const sourceWarnings = uniqueWarnings(backgroundFrameReports, frameSelection.warnings)
  const warnings = [...new Set([
    ...sourceWarnings,
    ...(pixelGridReport?.warnings ?? []),
  ])].sort()
  const report = {
    schema_version: 1,
    mode: 'motion_source_strip_report_v1',
    contract: resolvedContract,
    status:
      normalizedFrames.some((frame) => !frame.normalized_bbox) ||
      frameSelection.target?.target_satisfied === false ||
      frameSelection.status === 'insufficient_target'
        ? 'warning'
        : 'done',
    runtime_action: resolvedContract.runtime_action,
    input_frame_count: frames.length,
    selected_frame_count: frameSelection.selected.length,
    requested_selection_mode: selectionRequest.requestedSelectionMode,
    effective_selection_mode: selectionRequest.effectiveSelectionMode,
    source_warnings: sourceWarnings,
    warnings,
    background: summarizeBackground(backgroundFrameReports, resolvedContract.background.key_color),
    normalization,
    pixel_grid_refinement: pixelGridReport ?? {
      schema_version: 1,
      mode: 'pixel_grid_refinement_v1',
      status: 'disabled',
      warnings: [],
    },
    frame_selection: selectedFrames,
    normalized_frames: outputFrames.map(publicNormalizedFrame),
  }
  throwIfMotionBuildAborted(signal)
  const normalizedMotionStripPng = await encodeRgbaPng(stripImage)
  await yieldMotionBuild(signal)
  const motionContactSheetPng = await encodeRgbaPng(contactSheetImage)
  await yieldMotionBuild(signal)
  const sequenceArtifacts = await buildSequenceArtifacts({
    normalizedFrames: outputFrames,
    stripPng: normalizedMotionStripPng,
    contract: resolvedContract,
    artifactBinding,
    signal,
  })

  return {
    contract: resolvedContract,
    stripImage,
    contactSheetImage,
    normalizedMotionStripPng,
    motionContactSheetPng,
    videoFramesSheetPng: sequenceArtifacts.videoFramesSheetPng,
    framesIndex: sequenceArtifacts.framesIndex,
    framesZip: sequenceArtifacts.framesZip,
    selectedFrames,
    report,
  }
}
