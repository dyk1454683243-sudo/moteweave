import { encodeGifFromRgbaFrames } from '../gifExport.js'
import { encodeRgbaPng, loadRgba } from '../imageCodec.js'
import { classifyValidationMessages } from '../failureTaxonomy.js'
import { detectAlphaBBox, detectFootAnchor } from '../normalizer.js'
import { composeSheet } from '../processArtifacts.js'
import { TOPDOWN_RPG_V0 } from '../profile.js'
import { buildRowPreviewIndex } from '../rowPreview.js'
import { computeGridBoundaries, sliceRgbaCells } from '../sheetSlicer.js'
import { validateNormalizedFrames } from '../validator.js'

function assertNormalizedSheetSize(image, profile) {
  if (image.width !== profile.sheet.w || image.height !== profile.sheet.h) {
    throw new Error(`normalized sheet must be ${profile.sheet.w}x${profile.sheet.h}, got ${image.width}x${image.height}`)
  }
}

function assertTaskFrame(task, profile) {
  const frame = Number(task?.target?.frame)
  const frameCount = profile.grid.columns * profile.grid.rows
  if (!Number.isInteger(frame) || frame < 0 || frame >= frameCount) {
    throw new Error(`repair task has invalid target frame: ${task?.target?.frame}`)
  }
  return frame
}

function frameFromCell(cell) {
  const bbox = detectAlphaBBox(cell.image)
  return {
    index: cell.meta.index,
    source_meta: cell.meta ?? null,
    source_bbox: bbox,
    source_anchor: detectFootAnchor(cell.image, bbox),
    normalized_bbox: bbox,
    normalized_anchor: detectFootAnchor(cell.image, bbox),
    image: cell.image,
    warnings: bbox ? [] : ['empty_frame'],
  }
}

function framesFromNormalizedSheet(image, profile) {
  assertNormalizedSheetSize(image, profile)
  const grid = computeGridBoundaries({
    width: image.width,
    height: image.height,
    columns: profile.grid.columns,
    rows: profile.grid.rows,
  })
  return sliceRgbaCells(image, grid).map(frameFromCell)
}

async function normalizeRepairCellImage(buffer, profile) {
  const image = await loadRgba(buffer)
  if (image.width === profile.sheet.w && image.height === profile.sheet.h) {
    throw new Error('repair cell input looks like a full normalized sheet; expected one cell image')
  }
  if (image.width === profile.frame.w && image.height === profile.frame.h) {
    return { image, resized: false, original_size: { w: image.width, h: image.height } }
  }
  throw new Error(`repair cell must be ${profile.frame.w}x${profile.frame.h}, got ${image.width}x${image.height}`)
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function shiftImage(image, dx, dy) {
  if (!dx && !dy) return image
  const shifted = {
    width: image.width,
    height: image.height,
    data: new Uint8ClampedArray(image.width * image.height * 4),
  }
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const targetX = x + dx
      const targetY = y + dy
      if (targetX < 0 || targetY < 0 || targetX >= image.width || targetY >= image.height) continue
      const src = (y * image.width + x) * 4
      if (!image.data[src + 3]) continue
      const dst = (targetY * image.width + targetX) * 4
      shifted.data[dst] = image.data[src]
      shifted.data[dst + 1] = image.data[src + 1]
      shifted.data[dst + 2] = image.data[src + 2]
      shifted.data[dst + 3] = image.data[src + 3]
    }
  }
  return shifted
}

function pasteScaledBBox(src, dst, bbox, dstX, dstY, scale) {
  const outW = Math.max(1, Math.round(bbox.w * scale))
  const outH = Math.max(1, Math.round(bbox.h * scale))
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const sx = bbox.x + Math.min(bbox.w - 1, Math.floor(x / scale))
      const sy = bbox.y + Math.min(bbox.h - 1, Math.floor(y / scale))
      const srcOffset = (sy * src.width + sx) * 4
      if (!src.data[srcOffset + 3]) continue
      const dstOffset = ((dstY + y) * dst.width + dstX + x) * 4
      dst.data[dstOffset] = src.data[srcOffset]
      dst.data[dstOffset + 1] = src.data[srcOffset + 1]
      dst.data[dstOffset + 2] = src.data[srcOffset + 2]
      dst.data[dstOffset + 3] = src.data[srcOffset + 3]
    }
  }
}

function compactRepairCellForEdgePressure(image, profile, { edgePadding = 1 } = {}) {
  const beforeBBox = detectAlphaBBox(image)
  const beforeAnchor = detectFootAnchor(image, beforeBBox)
  if (!beforeBBox || !beforeAnchor) {
    return {
      image,
      applied: false,
      scale: 1,
      before_bbox: beforeBBox,
      after_bbox: beforeBBox,
      before_anchor: beforeAnchor,
      after_anchor: beforeAnchor,
    }
  }
  const maxComfortableWidth = Math.floor(profile.frame.w * 0.82)
  if (beforeBBox.w <= maxComfortableWidth) {
    return {
      image,
      applied: false,
      scale: 1,
      before_bbox: beforeBBox,
      after_bbox: beforeBBox,
      before_anchor: beforeAnchor,
      after_anchor: beforeAnchor,
    }
  }

  const scale = Math.min(1, maxComfortableWidth / beforeBBox.w, (profile.frame.h - edgePadding * 2) / beforeBBox.h)
  const scaledW = Math.max(1, Math.round(beforeBBox.w * scale))
  const scaledH = Math.max(1, Math.round(beforeBBox.h * scale))
  const anchorOffsetX = (beforeAnchor.x - beforeBBox.x) * scale
  const anchorOffsetY = (beforeAnchor.y - beforeBBox.y) * scale
  const dstX = clamp(
    Math.round(profile.anchor.x - anchorOffsetX),
    edgePadding,
    Math.max(edgePadding, profile.frame.w - edgePadding - scaledW)
  )
  const dstY = clamp(
    Math.round(profile.anchor.y - anchorOffsetY),
    edgePadding,
    Math.max(edgePadding, profile.frame.h - edgePadding - scaledH)
  )
  const compacted = {
    width: image.width,
    height: image.height,
    data: new Uint8ClampedArray(image.width * image.height * 4),
  }
  pasteScaledBBox(image, compacted, beforeBBox, dstX, dstY, scale)
  const afterBBox = detectAlphaBBox(compacted)
  const afterAnchor = detectFootAnchor(compacted, afterBBox)
  return {
    image: compacted,
    applied: true,
    scale,
    before_bbox: beforeBBox,
    after_bbox: afterBBox,
    before_anchor: beforeAnchor,
    after_anchor: afterAnchor,
  }
}

function fitRepairCellToReferenceFrame(image, referenceFrame, profile, { edgePadding = 1, maxSizeRatio = 1.12 } = {}) {
  const referenceBBox = referenceFrame?.normalized_bbox
  if (!referenceBBox?.w || !referenceBBox?.h) {
    return {
      image,
      applied: false,
      scale: 1,
      before_bbox: detectAlphaBBox(image),
      after_bbox: detectAlphaBBox(image),
      reference_bbox: referenceBBox ?? null,
      reference_anchor: referenceFrame?.normalized_anchor ?? null,
    }
  }
  const beforeBBox = detectAlphaBBox(image)
  const beforeAnchor = detectFootAnchor(image, beforeBBox)
  const referenceAnchor = referenceFrame?.normalized_anchor ?? profile.anchor
  if (!beforeBBox || !beforeAnchor || !referenceAnchor) {
    return {
      image,
      applied: false,
      scale: 1,
      before_bbox: beforeBBox,
      after_bbox: beforeBBox,
      reference_bbox: referenceBBox,
      reference_anchor: referenceAnchor,
    }
  }

  const targetW = Math.max(1, referenceBBox.w * maxSizeRatio)
  const targetH = Math.max(1, referenceBBox.h * maxSizeRatio)
  const scale = Math.min(1, targetW / beforeBBox.w, targetH / beforeBBox.h)
  if (scale >= 0.995) {
    return {
      image,
      applied: false,
      scale: 1,
      before_bbox: beforeBBox,
      after_bbox: beforeBBox,
      reference_bbox: referenceBBox,
      reference_anchor: referenceAnchor,
    }
  }

  const scaledW = Math.max(1, Math.round(beforeBBox.w * scale))
  const scaledH = Math.max(1, Math.round(beforeBBox.h * scale))
  const anchorOffsetX = (beforeAnchor.x - beforeBBox.x) * scale
  const anchorOffsetY = (beforeAnchor.y - beforeBBox.y) * scale
  const dstX = clamp(
    Math.round(referenceAnchor.x - anchorOffsetX),
    edgePadding,
    Math.max(edgePadding, profile.frame.w - edgePadding - scaledW)
  )
  const dstY = clamp(
    Math.round(referenceAnchor.y - anchorOffsetY),
    edgePadding,
    Math.max(edgePadding, profile.frame.h - edgePadding - scaledH)
  )
  const fitted = {
    width: image.width,
    height: image.height,
    data: new Uint8ClampedArray(image.width * image.height * 4),
  }
  pasteScaledBBox(image, fitted, beforeBBox, dstX, dstY, scale)
  const afterBBox = detectAlphaBBox(fitted)
  return {
    image: fitted,
    applied: true,
    scale,
    before_bbox: beforeBBox,
    after_bbox: afterBBox,
    reference_bbox: referenceBBox,
    reference_anchor: referenceAnchor,
  }
}

function alignRepairCellToProfileAnchor(image, profile, { edgePadding = 1 } = {}) {
  const beforeBBox = detectAlphaBBox(image)
  const beforeAnchor = detectFootAnchor(image, beforeBBox)
  if (!beforeBBox || !beforeAnchor) {
    return {
      image,
      applied: false,
      dx: 0,
      dy: 0,
      before_bbox: beforeBBox,
      after_bbox: beforeBBox,
      before_anchor: beforeAnchor,
      after_anchor: beforeAnchor,
    }
  }
  const desiredDx = profile.anchor.x - beforeAnchor.x
  const desiredDy = profile.anchor.y - beforeAnchor.y
  const minDx = edgePadding - beforeBBox.x
  const maxDx = (profile.frame.w - 1 - edgePadding) - beforeBBox.right
  const minDy = edgePadding - beforeBBox.y
  const maxDy = (profile.frame.h - 1 - edgePadding) - beforeBBox.bottom
  const dx = clamp(desiredDx, minDx, maxDx)
  const dy = clamp(desiredDy, minDy, maxDy)
  const aligned = shiftImage(image, dx, dy)
  const afterBBox = detectAlphaBBox(aligned)
  const afterAnchor = detectFootAnchor(aligned, afterBBox)
  return {
    image: aligned,
    applied: dx !== 0 || dy !== 0,
    dx,
    dy,
    before_bbox: beforeBBox,
    after_bbox: afterBBox,
    before_anchor: beforeAnchor,
    after_anchor: afterAnchor,
  }
}

function prepareRepairCellForPaste(image, profile, referenceFrame = null) {
  const referenceFit = fitRepairCellToReferenceFrame(image, referenceFrame, profile)
  const compact = compactRepairCellForEdgePressure(referenceFit.image, profile)
  const alignment = alignRepairCellToProfileAnchor(compact.image, profile)
  return {
    image: alignment.image,
    referenceFit,
    compact,
    alignment,
  }
}

function pasteFrame(frames, frameIndex, image, profile) {
  frames[frameIndex] = frameFromCell({
    image,
    meta: {
      ...(frames[frameIndex]?.source_meta ?? {}),
      index: frameIndex,
      row: Math.floor(frameIndex / profile.grid.columns),
      col: frameIndex % profile.grid.columns,
      repair_applied: true,
    },
  })
}

function buildRowGifBuffers(frames, profile) {
  const previews = buildRowPreviewIndex(profile)
  return Object.fromEntries(
    previews.map((preview) => [
      preview.fileName,
      encodeGifFromRgbaFrames(preview.frames.map((index) => frames[index].image), { delay: Math.round(1000 / preview.fps) }),
    ])
  )
}

function validateFrames(frames, profile) {
  const validation = validateNormalizedFrames(frames, profile)
  return {
    ...validation,
    failure_taxonomy: classifyValidationMessages(validation),
  }
}

function buildTargetResults(repairs, validationBefore, validationAfter) {
  const beforeErrors = new Set(validationBefore.blocking_errors)
  const afterErrors = new Set(validationAfter.blocking_errors)
  return repairs.map(({ task }) => {
    const issueMessage = task.issue?.message ?? `frame_${task.target?.frame}_${task.issue?.type === 'empty_frame' ? 'empty' : 'cropped'}`
    const beforeHasIssue = beforeErrors.has(issueMessage)
    const afterHasIssue = afterErrors.has(issueMessage)
    return {
      task_id: task.task_id,
      frame: task.target?.frame,
      issue: task.issue?.type ?? null,
      issue_message: issueMessage,
      before_has_issue: beforeHasIssue,
      after_has_issue: afterHasIssue,
      resolved: beforeHasIssue && !afterHasIssue,
    }
  })
}

export async function applyTopdownRepairCells({
  normalizedSheetBuffer,
  repairs = [],
  profile = TOPDOWN_RPG_V0,
} = {}) {
  if (!normalizedSheetBuffer) throw new Error('normalizedSheetBuffer is required')
  if (!Array.isArray(repairs) || repairs.length === 0) throw new Error('at least one repair is required')

  const normalizedSheet = await loadRgba(normalizedSheetBuffer)
  const framesBefore = framesFromNormalizedSheet(normalizedSheet, profile)
  const validationBefore = validateFrames(framesBefore, profile)
  const framesAfter = framesBefore.map((frame) => ({
    ...frame,
    image: { ...frame.image, data: new Uint8ClampedArray(frame.image.data) },
  }))

  const appliedTasks = []
  const seenFrames = new Set()
  for (const repair of repairs) {
    const frame = assertTaskFrame(repair.task, profile)
    if (seenFrames.has(frame)) throw new Error(`duplicate repair target frame: ${frame}`)
    seenFrames.add(frame)
    const cell = await normalizeRepairCellImage(repair.cellBuffer, profile)
    const prepared = prepareRepairCellForPaste(cell.image, profile, framesBefore[frame])
    pasteFrame(framesAfter, frame, prepared.image, profile)
    appliedTasks.push({
      task_id: repair.task.task_id,
      frame,
      cell_resized: cell.resized,
      original_cell_size: cell.original_size,
      cell_reference_fit: {
        applied: prepared.referenceFit.applied,
        scale: prepared.referenceFit.scale,
        reference_bbox: prepared.referenceFit.reference_bbox,
        reference_anchor: prepared.referenceFit.reference_anchor,
        before_bbox: prepared.referenceFit.before_bbox,
        after_bbox: prepared.referenceFit.after_bbox,
      },
      cell_compaction: {
        applied: prepared.compact.applied,
        scale: prepared.compact.scale,
        before_anchor: prepared.compact.before_anchor,
        after_anchor: prepared.compact.after_anchor,
        before_bbox: prepared.compact.before_bbox,
        after_bbox: prepared.compact.after_bbox,
      },
      cell_alignment: {
        applied: prepared.alignment.applied,
        dx: prepared.alignment.dx,
        dy: prepared.alignment.dy,
        before_anchor: prepared.alignment.before_anchor,
        after_anchor: prepared.alignment.after_anchor,
        before_bbox: prepared.alignment.before_bbox,
        after_bbox: prepared.alignment.after_bbox,
      },
    })
  }

  const validationAfter = validateFrames(framesAfter, profile)
  const repairedSheet = composeSheet(framesAfter, profile)
  const rowGifBuffers = buildRowGifBuffers(framesAfter, profile)

  return {
    schema_version: 1,
    preset: profile.id,
    applied_tasks: appliedTasks,
    target_results: buildTargetResults(repairs, validationBefore, validationAfter),
    validation_before: validationBefore,
    validation_after: validationAfter,
    repaired_normalized_sheet_png: await encodeRgbaPng(repairedSheet),
    row_gif_buffers: rowGifBuffers,
  }
}
