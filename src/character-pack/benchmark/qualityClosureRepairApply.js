import { applyTopdownRepairCells } from './topdownRepairApply.js'
import { ACTION_REPAIR_MODE, isStaticPoseRepairTask, repairOutputFrameCountForTask } from '../actionRepairMode.js'
import { classifyValidationMessages } from '../failureTaxonomy.js'
import { encodeRgbaPng, loadRgba, resizeRgbaNearest } from '../imageCodec.js'
import { detectAlphaBBox, detectFootAnchor } from '../normalizer.js'
import { TOPDOWN_RPG_V0 } from '../profile.js'
import { computeGridBoundaries, sliceRgbaCells } from '../sheetSlicer.js'
import { buildCharacterQualityClosure } from '../qualityClosureGate.js'
import { validateNormalizedFrames } from '../validator.js'

export const CHARACTER_QUALITY_CLOSURE_PROVIDER_REPAIR_APPLY_MODE = 'character_quality_closure_provider_repair_apply_v1'

const PROVIDER_REPAIR_ACTIONS = new Set(['single_animation_repair', 'semantic_frame_repair'])

function assertNormalizedSheetSize(image, profile) {
  if (image.width !== profile.sheet.w || image.height !== profile.sheet.h) {
    throw new Error(`normalized sheet must be ${profile.sheet.w}x${profile.sheet.h}, got ${image.width}x${image.height}`)
  }
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

function validateFrames(frames, profile) {
  const validation = validateNormalizedFrames(frames, profile)
  return {
    ...validation,
    failure_taxonomy: classifyValidationMessages(validation),
  }
}

function targetFramesForTask(task = {}, profile = TOPDOWN_RPG_V0) {
  const frameCount = profile.grid.columns * profile.grid.rows
  const frames = (task.target?.frames ?? [])
    .map((frame) => Number(frame.frame ?? frame))
    .filter((frame) => Number.isInteger(frame) && frame >= 0 && frame < frameCount)
  if (!frames.length) throw new Error(`quality closure repair task ${task.task_id ?? 'unknown'} has no target frames`)
  return frames
}

function assertProviderRepairTask(task = {}, profile = TOPDOWN_RPG_V0) {
  if (!task.provider_required) throw new Error(`quality closure repair task ${task.task_id ?? 'unknown'} is not a provider/manual repair task`)
  if (!PROVIDER_REPAIR_ACTIONS.has(task.action)) {
    throw new Error(`unsupported quality closure provider repair action: ${task.action ?? 'unknown'}`)
  }
  return targetFramesForTask(task, profile)
}

function imageRatio(image) {
  return image.height ? image.width / image.height : 1
}

function stripTargetSize(count, profile, orientation) {
  return orientation === 'vertical'
    ? { w: profile.frame.w, h: profile.frame.h * count }
    : { w: profile.frame.w * count, h: profile.frame.h }
}

async function normalizeRepairStripImage(buffer, count, profile) {
  const image = await loadRgba(buffer)
  if (image.width === profile.sheet.w && image.height === profile.sheet.h) {
    throw new Error('repair strip input looks like a full normalized sheet; expected an animation strip')
  }

  const horizontalSize = stripTargetSize(count, profile, 'horizontal')
  const verticalSize = stripTargetSize(count, profile, 'vertical')
  if (image.width === horizontalSize.w && image.height === horizontalSize.h) {
    return {
      image,
      orientation: 'horizontal',
      resized: false,
      original_size: { w: image.width, h: image.height },
      normalized_size: horizontalSize,
    }
  }
  if (image.width === verticalSize.w && image.height === verticalSize.h) {
    return {
      image,
      orientation: 'vertical',
      resized: false,
      original_size: { w: image.width, h: image.height },
      normalized_size: verticalSize,
    }
  }

  const horizontalRatio = horizontalSize.w / horizontalSize.h
  const verticalRatio = verticalSize.w / verticalSize.h
  const ratio = imageRatio(image)
  const orientation = Math.abs(ratio - horizontalRatio) <= Math.abs(ratio - verticalRatio) ? 'horizontal' : 'vertical'
  const normalizedSize = stripTargetSize(count, profile, orientation)
  return {
    image: await resizeRgbaNearest(image, normalizedSize),
    orientation,
    resized: true,
    original_size: { w: image.width, h: image.height },
    normalized_size: normalizedSize,
  }
}

function cropCell(image, x, y, profile) {
  const cell = {
    width: profile.frame.w,
    height: profile.frame.h,
    data: new Uint8ClampedArray(profile.frame.w * profile.frame.h * 4),
  }
  for (let row = 0; row < profile.frame.h; row++) {
    for (let col = 0; col < profile.frame.w; col++) {
      const src = ((y + row) * image.width + x + col) * 4
      const dst = (row * cell.width + col) * 4
      cell.data[dst] = image.data[src]
      cell.data[dst + 1] = image.data[src + 1]
      cell.data[dst + 2] = image.data[src + 2]
      cell.data[dst + 3] = image.data[src + 3]
    }
  }
  return cell
}

function sliceRepairStrip(strip, count, profile) {
  return Array.from({ length: count }, (_, index) => {
    const x = strip.orientation === 'vertical' ? 0 : index * profile.frame.w
    const y = strip.orientation === 'vertical' ? index * profile.frame.h : 0
    return cropCell(strip.image, x, y, profile)
  })
}

function flipCellHorizontal(image) {
  const flipped = {
    width: image.width,
    height: image.height,
    data: new Uint8ClampedArray(image.width * image.height * 4),
  }
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const src = (y * image.width + x) * 4
      const dst = (y * image.width + (image.width - 1 - x)) * 4
      flipped.data[dst] = image.data[src]
      flipped.data[dst + 1] = image.data[src + 1]
      flipped.data[dst + 2] = image.data[src + 2]
      flipped.data[dst + 3] = image.data[src + 3]
    }
  }
  return flipped
}

function transformDerivedCell(image, transform) {
  if (transform === 'flip_h') return flipCellHorizontal(image)
  return image
}

function semanticTaskKey(task = {}) {
  const frames = (task.frames ?? task.target?.frames ?? [])
    .map((frame) => Number(frame.frame ?? frame))
    .filter(Number.isInteger)
    .join(',')
  return `${task.action ?? 'unknown'}:${task.animation ?? task.target?.animation ?? frames}`
}

function closureTaskKeys(closure = {}) {
  return new Set((closure.repair_tasks ?? []).map(semanticTaskKey))
}

function compactValidation(validation) {
  return {
    status: validation.status,
    blocking_errors: validation.blocking_errors,
    warnings: validation.warnings,
    failure_taxonomy: validation.failure_taxonomy,
  }
}

function compactClosure(closure) {
  return {
    mode: closure.mode,
    status: closure.status,
    release_ready: closure.release_ready,
    summary: closure.summary,
    gates: closure.gates,
    repair_tasks: closure.repair_tasks,
  }
}

function buildSemanticTargetResults(repairs, closureBefore, closureAfter) {
  const beforeKeys = closureTaskKeys(closureBefore)
  const afterKeys = closureTaskKeys(closureAfter)
  return repairs.map(({ task }) => {
    const key = semanticTaskKey(task)
    return {
      task_id: task.task_id,
      action: task.action,
      animation: task.target?.animation ?? null,
      frames: (task.target?.frames ?? []).map((frame) => frame.frame),
      before_has_task: beforeKeys.has(key),
      after_has_task: afterKeys.has(key),
      resolved: beforeKeys.has(key) && !afterKeys.has(key),
    }
  })
}

function derivedFramesForTask(task = {}, profile = TOPDOWN_RPG_V0) {
  const frameCount = profile.grid.columns * profile.grid.rows
  return (task.target?.derived_frames ?? [])
    .map((frame) => ({
      ...frame,
      frame: Number(frame.frame ?? frame),
      source_index: Number(frame.source_index ?? 0),
      transform: frame.transform ?? null,
    }))
    .filter((frame) => Number.isInteger(frame.frame) && frame.frame >= 0 && frame.frame < frameCount)
}

function markdownReport(result) {
  const lines = [
    '# Character Quality Closure Provider Repair Apply Report',
    '',
    `Status: \`${result.status}\``,
    `Provider/manual tasks applied: ${result.summary.provider_repair_task_count}`,
    `Cells pasted: ${result.summary.pasted_cell_count}`,
    `Before closure: \`${result.quality_closure_before.status}\``,
    `After closure: \`${result.quality_closure_after.status}\``,
    '',
    '## Target Results',
    '',
    '| Task | Action | Animation | Frames | Resolved |',
    '| --- | --- | --- | --- | --- |',
    ...result.semantic_target_results.map((item) => (
      `| ${item.task_id} | ${item.action} | ${item.animation ?? 'n/a'} | ${item.frames.join(', ') || 'n/a'} | ${item.resolved ? 'yes' : 'no'} |`
    )),
    '',
    '## Strip Normalization',
    '',
    '| Task | Mode | Orientation | Resized | Original | Normalized |',
    '| --- | --- | --- | --- | --- | --- |',
    ...result.applied_tasks.map((item) => (
      `| ${item.task_id} | ${item.repair_mode} | ${item.strip.orientation} | ${item.strip.resized ? 'yes' : 'no'} | ${item.strip.original_size.w}x${item.strip.original_size.h} | ${item.strip.normalized_size.w}x${item.strip.normalized_size.h} |`
    )),
  ]
  return `${lines.join('\n')}\n`
}

export async function applyQualityClosureProviderRepairs({
  normalizedSheetBuffer,
  repairs = [],
  profile = TOPDOWN_RPG_V0,
} = {}) {
  if (!normalizedSheetBuffer) throw new Error('normalizedSheetBuffer is required')
  if (!Array.isArray(repairs) || repairs.length === 0) throw new Error('at least one quality closure provider repair is required')

  const normalizedSheet = await loadRgba(normalizedSheetBuffer)
  const framesBefore = framesFromNormalizedSheet(normalizedSheet, profile)
  const validationBefore = validateFrames(framesBefore, profile)
  const qualityClosureBefore = buildCharacterQualityClosure({ frames: framesBefore, profile, validation: validationBefore })

  const appliedTasks = []
  const cellRepairs = []
  const seenFrames = new Set()
  for (const repair of repairs) {
    const frames = assertProviderRepairTask(repair.task, profile)
    const staticPose = isStaticPoseRepairTask(repair.task)
    const outputFrameCount = repairOutputFrameCountForTask(repair.task, frames.length)
    const strip = await normalizeRepairStripImage(repair.stripBuffer, outputFrameCount, profile)
    const cells = sliceRepairStrip(strip, outputFrameCount, profile)
    for (const [index, frame] of frames.entries()) {
      if (seenFrames.has(frame)) throw new Error(`duplicate quality closure provider repair target frame: ${frame}`)
      seenFrames.add(frame)
      const sourceCell = cells[staticPose ? 0 : index]
      cellRepairs.push({
        task: {
          task_id: `${repair.task.task_id}_frame_${frame}`,
          target: { frame },
          issue: { type: repair.task.action, message: null },
        },
        cellBuffer: await encodeRgbaPng(sourceCell),
      })
    }
    const derivedFrames = derivedFramesForTask(repair.task, profile)
    for (const derived of derivedFrames) {
      if (seenFrames.has(derived.frame)) throw new Error(`duplicate quality closure provider repair target frame: ${derived.frame}`)
      seenFrames.add(derived.frame)
      const sourceIndex = Math.max(0, Math.min(cells.length - 1, derived.source_index))
      const sourceCell = transformDerivedCell(cells[staticPose ? 0 : sourceIndex], derived.transform)
      cellRepairs.push({
        task: {
          task_id: `${repair.task.task_id}_derived_frame_${derived.frame}`,
          target: { frame: derived.frame },
          issue: { type: `${repair.task.action}_derived_${derived.transform ?? 'copy'}`, message: null },
        },
        cellBuffer: await encodeRgbaPng(sourceCell),
      })
    }
    appliedTasks.push({
      task_id: repair.task.task_id,
      action: repair.task.action,
      requested_action: repair.task.requested_action ?? null,
      source_action: repair.task.source_action ?? repair.task.target?.source_action ?? null,
      repair_mode: staticPose ? ACTION_REPAIR_MODE.STATIC_POSE : ACTION_REPAIR_MODE.ANIMATION_STRIP,
      animation: repair.task.target?.animation ?? null,
      frames,
      derived_frames: derivedFrames.map((frame) => ({
        frame: frame.frame,
        animation: frame.animation ?? null,
        transform: frame.transform,
        source_index: frame.source_index,
      })),
      output_cell_count: outputFrameCount,
      strip: {
        orientation: strip.orientation,
        resized: strip.resized,
        original_size: strip.original_size,
        normalized_size: strip.normalized_size,
      },
    })
  }

  const pasted = await applyTopdownRepairCells({ normalizedSheetBuffer, repairs: cellRepairs, profile })
  const repairedSheet = await loadRgba(pasted.repaired_normalized_sheet_png)
  const framesAfter = framesFromNormalizedSheet(repairedSheet, profile)
  const validationAfter = validateFrames(framesAfter, profile)
  const qualityClosureAfter = buildCharacterQualityClosure({ frames: framesAfter, profile, validation: validationAfter })
  const semanticTargetResults = buildSemanticTargetResults(repairs, qualityClosureBefore, qualityClosureAfter)
  const validationGate = {
    passed: validationAfter.status !== 'fail' && semanticTargetResults.every((item) => item.resolved),
    target_resolved_count: semanticTargetResults.filter((item) => item.resolved).length,
    target_count: semanticTargetResults.length,
    new_blocking_error_count: validationAfter.blocking_errors.length,
  }
  const status = !validationGate.passed
    ? 'needs_followup'
    : qualityClosureAfter.repair_tasks.length ? 'partial' : 'passed'

  const result = {
    schema_version: 1,
    mode: CHARACTER_QUALITY_CLOSURE_PROVIDER_REPAIR_APPLY_MODE,
    preset: profile.id,
    status,
    summary: {
      provider_repair_task_count: repairs.length,
      pasted_cell_count: cellRepairs.length,
      resolved_target_count: validationGate.target_resolved_count,
      remaining_repair_task_count: qualityClosureAfter.repair_tasks.length,
      before_validation_status: validationBefore.status,
      after_validation_status: validationAfter.status,
      before_quality_closure_status: qualityClosureBefore.status,
      after_quality_closure_status: qualityClosureAfter.status,
    },
    applied_tasks: appliedTasks,
    pasted_cell_results: pasted.applied_tasks,
    semantic_target_results: semanticTargetResults,
    validation_gate: validationGate,
    validation_before: compactValidation(validationBefore),
    validation_after: compactValidation(validationAfter),
    quality_closure_before: compactClosure(qualityClosureBefore),
    quality_closure_after: compactClosure(qualityClosureAfter),
    remaining_repair_tasks: qualityClosureAfter.repair_tasks,
    repaired_normalized_sheet_png: pasted.repaired_normalized_sheet_png,
    row_gif_buffers: pasted.row_gif_buffers,
    markdown: null,
    claim_boundary: 'Provider/manual repair strips are normalized, pasted into the existing sheet, and revalidated locally; this command does not call a provider.',
  }
  result.markdown = markdownReport(result)
  return result
}

export function serializeQualityClosureProviderRepairApplyResult(result) {
  return {
    ...result,
    repaired_normalized_sheet_png: undefined,
    row_gif_buffers: undefined,
    markdown: undefined,
  }
}
