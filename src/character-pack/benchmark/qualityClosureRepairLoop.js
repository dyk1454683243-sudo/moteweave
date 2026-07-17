import path from 'node:path'

import { encodeRgbaPng, loadRgba } from '../imageCodec.js'
import { classifyValidationMessages } from '../failureTaxonomy.js'
import { detectAlphaBBox, detectFootAnchor } from '../normalizer.js'
import { composeSheet } from '../processArtifacts.js'
import { TOPDOWN_RPG_V0 } from '../profile.js'
import { computeGridBoundaries, sliceRgbaCells } from '../sheetSlicer.js'
import { stabilizeAnimationGroups } from '../motionStabilizer.js'
import { buildCharacterQualityClosure } from '../qualityClosureGate.js'
import { validateNormalizedFrames } from '../validator.js'

export const CHARACTER_QUALITY_CLOSURE_REPAIR_LOOP_MODE = 'character_quality_closure_repair_loop_v1'

function asList(value) {
  if (value === undefined || value === null) return []
  return Array.isArray(value) ? value.map(String) : [String(value)]
}

function safeRepairPathSegment(value, fallback = 'item') {
  return (
    String(value ?? fallback)
      .replace(/[^a-zA-Z0-9._-]+/g, '_')
      .replace(/^\.+/, '')
      .replace(/\.+$/, '') || fallback
  )
}

function unique(values) {
  return [...new Set(values.filter((value) => value !== null && value !== undefined && value !== ''))]
}

function findDuplicateValues(values) {
  const seen = new Set()
  const duplicates = new Set()
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value)
    seen.add(value)
  }
  return [...duplicates]
}

function hasValidatorAnchorOrBaselineWarning(warnings = []) {
  return warnings.some((warning) => /^frame_\d+_(anchor|baseline)_drift$/.test(String(warning)))
}

function staleLocalAnchorTask(task = {}) {
  return task.action === 'local_anchor_stabilization' &&
    !hasValidatorAnchorOrBaselineWarning(task.context?.original_warnings ?? [])
}

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

function cloneFrame(frame) {
  return {
    ...frame,
    image: {
      ...frame.image,
      data: new Uint8ClampedArray(frame.image.data),
    },
    normalized_bbox: frame.normalized_bbox ? { ...frame.normalized_bbox } : null,
    normalized_anchor: frame.normalized_anchor ? { ...frame.normalized_anchor } : null,
  }
}

function refreshFrame(frame, image, repairMeta = {}) {
  const bbox = detectAlphaBBox(image)
  return {
    ...frame,
    source_meta: {
      ...(frame.source_meta ?? {}),
      ...repairMeta,
    },
    image,
    normalized_bbox: bbox,
    normalized_anchor: detectFootAnchor(image, bbox),
    warnings: bbox ? [] : ['empty_frame'],
  }
}

function hasTransparentNeighbor(image, x, y) {
  const offsets = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ]
  return offsets.some(([dx, dy]) => {
    const nx = x + dx
    const ny = y + dy
    if (nx < 0 || ny < 0 || nx >= image.width || ny >= image.height) return true
    return image.data[(ny * image.width + nx) * 4 + 3] === 0
  })
}

function targetFrameIndexes(task = {}) {
  return unique((task.target?.frames ?? []).map((frame) => Number(frame.frame)).filter(Number.isInteger))
}

function targetAnimations(task = {}) {
  return unique([
    ...(task.target?.animations ?? []),
    task.target?.animation,
    ...(task.target?.frames ?? []).map((frame) => frame.animation),
  ])
}

function cleanHaloFrame(frame) {
  const image = {
    width: frame.image.width,
    height: frame.image.height,
    data: new Uint8ClampedArray(frame.image.data),
  }
  let cleared_pixel_count = 0
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const offset = (y * image.width + x) * 4
      const alpha = image.data[offset + 3]
      if (!alpha) continue
      const nearWhite = image.data[offset] >= 240 && image.data[offset + 1] >= 240 && image.data[offset + 2] >= 240
      if (!nearWhite || !hasTransparentNeighbor(image, x, y)) continue
      image.data[offset] = 0
      image.data[offset + 1] = 0
      image.data[offset + 2] = 0
      image.data[offset + 3] = 0
      cleared_pixel_count++
    }
  }
  return {
    frame: refreshFrame(frame, image, { quality_closure_local_repair: 'local_halo_cleanup' }),
    cleared_pixel_count,
  }
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

function alignFrameToProfileAnchor(frame, profile, { edgePadding = 1 } = {}) {
  const bbox = frame.normalized_bbox
  const anchor = frame.normalized_anchor ?? detectFootAnchor(frame.image, bbox)
  if (!bbox || !anchor) {
    return {
      frame,
      applied: false,
      dx: 0,
      dy: 0,
      before_bbox: bbox,
      after_bbox: bbox,
      before_anchor: anchor,
      after_anchor: anchor,
    }
  }
  const desiredDx = profile.anchor.x - anchor.x
  const desiredDy = profile.anchor.y - anchor.y
  const minDx = edgePadding - bbox.x
  const maxDx = (profile.frame.w - 1 - edgePadding) - bbox.right
  const minDy = edgePadding - bbox.y
  const maxDy = (profile.frame.h - 1 - edgePadding) - bbox.bottom
  const dx = clamp(desiredDx, minDx, maxDx)
  const dy = clamp(desiredDy, minDy, maxDy)
  const image = shiftImage(frame.image, dx, dy)
  const shifted = refreshFrame(frame, image, { quality_closure_local_repair: 'local_anchor_stabilization' })
  return {
    frame: shifted,
    applied: dx !== 0 || dy !== 0,
    dx,
    dy,
    before_bbox: bbox,
    after_bbox: shifted.normalized_bbox,
    before_anchor: anchor,
    after_anchor: shifted.normalized_anchor,
  }
}

function validateFrames(frames, profile) {
  const validation = validateNormalizedFrames(frames, profile)
  return {
    ...validation,
    failure_taxonomy: classifyValidationMessages(validation),
  }
}

function selectedTasks(manifest, filters = {}) {
  let tasks = manifest.tasks ?? []
  const taskIds = new Set(asList(filters.taskIds))
  const itemIds = new Set(asList(filters.itemIds))
  const stages = new Set(asList(filters.stages))
  const actions = new Set(asList(filters.actions))
  const errors = []

  if (taskIds.size) {
    const byId = new Map(tasks.map((task) => [task.task_id, task]))
    tasks = [...taskIds].map((taskId) => {
      const task = byId.get(taskId)
      if (!task) errors.push(`unknown quality closure repair task id: ${taskId}`)
      return task
    }).filter(Boolean)
  }
  if (itemIds.size) tasks = tasks.filter((task) => itemIds.has(task.item_id))
  if (stages.size) tasks = tasks.filter((task) => stages.has(task.stage))
  if (actions.size) tasks = tasks.filter((task) => actions.has(task.action))

  const limit = filters.limit === undefined ? undefined : Number(filters.limit)
  if (limit !== undefined) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('--limit must be a positive integer')
    tasks = tasks.slice(0, limit)
  }

  return { tasks, errors }
}

function buildPreflight({ tasks, selectionErrors }) {
  const errors = [...selectionErrors]
  const duplicateTaskIds = findDuplicateValues(tasks.map((task) => task.task_id))
  if (duplicateTaskIds.length) errors.push(`duplicate quality closure repair task ids in manifest: ${duplicateTaskIds.join(', ')}`)

  const itemIds = unique(tasks.map((task) => task.item_id))
  const presets = unique(tasks.map((task) => task.preset))
  const normalizedSheets = unique(tasks.map((task) => task.artifacts?.normalized_sheet))
  const missingSheetTasks = tasks.filter((task) => !task.artifacts?.normalized_sheet).map((task) => task.task_id)
  const staleLocalAnchorTasks = tasks
    .filter(staleLocalAnchorTask)
    .map((task) => task.task_id)

  if (!tasks.length) errors.push('no quality closure repair tasks selected')
  if (itemIds.length > 1) errors.push(`selected tasks must share one item_id for one-sheet quality repair: ${itemIds.join(', ')}`)
  if (presets.length > 1) errors.push(`selected tasks must share one preset: ${presets.join(', ')}`)
  if (missingSheetTasks.length) errors.push(`selected tasks are missing normalized_sheet artifacts: ${missingSheetTasks.join(', ')}`)
  if (normalizedSheets.length > 1) errors.push('selected tasks must share one normalized_sheet artifact path')
  if (staleLocalAnchorTasks.length) {
    errors.push(`local_anchor_stabilization tasks require validator anchor/baseline drift warnings; rebuild the quality closure repair manifest: ${staleLocalAnchorTasks.join(', ')}`)
  }

  return {
    can_run: errors.length === 0,
    errors,
    item_ids: itemIds,
    presets,
    normalized_sheets: normalizedSheets,
    missing_normalized_sheet_tasks: missingSheetTasks,
    stale_local_anchor_tasks: staleLocalAnchorTasks,
  }
}

function providerTaskOutput(outputDir, index, task) {
  const prefix = String(index + 1).padStart(2, '0')
  const dir = path.join(outputDir, 'provider_tasks', `${prefix}_${safeRepairPathSegment(task.task_id, 'task')}`)
  return {
    task_id: task.task_id,
    item_id: task.item_id,
    action: task.action,
    animation: task.target?.animation ?? null,
    frames: (task.target?.frames ?? []).map((frame) => frame.frame),
    output_dir: dir,
    files: {
      prompt: path.join(dir, 'prompt.txt'),
      contract: path.join(dir, 'provider_repair_contract.json'),
    },
    provider_payload: task.provider_payload ?? null,
  }
}

export function buildQualityClosureRepairLoopPlan({
  manifest = {},
  taskIds,
  itemIds,
  stages,
  actions,
  limit,
  outputDir = path.join('generated', 'quality-closure-repairs', safeRepairPathSegment(manifest.run_id ?? 'run'), 'repair_loop'),
} = {}) {
  const selected = selectedTasks(manifest, { taskIds, itemIds, stages, actions, limit })
  const preflight = buildPreflight({ tasks: selected.tasks, selectionErrors: selected.errors })
  const localTasks = selected.tasks.filter((task) => !task.provider_required)
  const providerTasks = selected.tasks.filter((task) => task.provider_required)
  const itemId = preflight.item_ids[0] ?? null
  const itemOutputDir = path.join(outputDir, safeRepairPathSegment(itemId, 'item'))

  return {
    schema_version: 1,
    mode: `${CHARACTER_QUALITY_CLOSURE_REPAIR_LOOP_MODE}_plan`,
    run_id: manifest.run_id ?? null,
    preset: manifest.preset ?? TOPDOWN_RPG_V0.id,
    output_dir: outputDir,
    input_normalized_sheet: preflight.normalized_sheets[0] ?? null,
    selected_task_count: selected.tasks.length,
    local_task_count: localTasks.length,
    provider_task_count: providerTasks.length,
    estimated_provider_calls: providerTasks.length,
    preflight,
    can_run: preflight.can_run,
    tasks: selected.tasks,
    local_tasks: localTasks,
    provider_tasks: providerTasks.map((task, index) => providerTaskOutput(outputDir, index, task)),
    files: {
      plan: path.join(outputDir, 'quality_closure_repair_loop_plan.json'),
      report: path.join(outputDir, 'quality_closure_repair_report.json'),
      markdown: path.join(outputDir, 'quality_closure_repair_report.md'),
      before_after_preview: path.join(outputDir, 'quality_closure_before_after.png'),
      item_output_dir: itemOutputDir,
      repaired_normalized_sheet: path.join(itemOutputDir, 'repaired_normalized_sheet.png'),
    },
    claim_boundary: 'This plan applies provider-free local quality repairs and writes provider repair prompts only; it does not call a provider.',
  }
}

function applyHaloTask(frames, task) {
  const byIndex = new Map(frames.map((frame, index) => [frame.index, index]))
  const indexes = targetFrameIndexes(task)
  const results = []
  for (const frameIndex of indexes) {
    const order = byIndex.get(frameIndex)
    if (order === undefined) continue
    const cleaned = cleanHaloFrame(frames[order])
    frames[order] = cleaned.frame
    results.push({
      frame: frameIndex,
      cleared_pixel_count: cleaned.cleared_pixel_count,
      applied: cleaned.cleared_pixel_count > 0,
    })
  }
  return results
}

function applyAnchorTask(frames, task, profile) {
  const byIndex = new Map(frames.map((frame, index) => [frame.index, index]))
  const indexes = targetFrameIndexes(task)
  const results = []
  for (const frameIndex of indexes) {
    const order = byIndex.get(frameIndex)
    if (order === undefined) continue
    const aligned = alignFrameToProfileAnchor(frames[order], profile)
    frames[order] = aligned.frame
    results.push({
      frame: frameIndex,
      applied: aligned.applied,
      dx: aligned.dx,
      dy: aligned.dy,
      before_anchor: aligned.before_anchor,
      after_anchor: aligned.after_anchor,
      before_bbox: aligned.before_bbox,
      after_bbox: aligned.after_bbox,
    })
  }

  const animations = targetAnimations(task)
  if (animations.length) {
    const lockedAnimations = (profile.animations ?? [])
      .map((animation) => animation.name)
      .filter((animation) => !animations.includes(animation))
    const stabilized = stabilizeAnimationGroups(frames, profile, { lockedAnimations })
    frames.splice(0, frames.length, ...stabilized.frames)
    for (const correction of stabilized.corrections) {
      results.push({
        frame: correction.frame,
        applied: true,
        dx: correction.dx,
        dy: correction.dy,
        animation: correction.animation,
        reference_frame: correction.reference_frame,
        mode: 'motion_stabilization',
      })
    }
  }

  return results
}

export function applyLocalQualityClosureRepairs(frames, tasks = [], profile = TOPDOWN_RPG_V0) {
  const nextFrames = frames.map(cloneFrame)
  const appliedTasks = []

  for (const task of tasks) {
    let frameResults = []
    if (task.action === 'local_halo_cleanup') frameResults = applyHaloTask(nextFrames, task)
    else if (task.action === 'local_anchor_stabilization') frameResults = applyAnchorTask(nextFrames, task, profile)
    else {
      appliedTasks.push({
        task_id: task.task_id,
        action: task.action,
        applied: false,
        reason: 'unsupported_local_quality_closure_action',
        frame_results: [],
      })
      continue
    }
    appliedTasks.push({
      task_id: task.task_id,
      action: task.action,
      applied: frameResults.some((result) => result.applied),
      frame_results: frameResults,
    })
  }

  return {
    frames: nextFrames,
    applied_tasks: appliedTasks,
  }
}

function taskActionSet(closure = {}) {
  return new Set((closure.repair_tasks ?? []).map((task) => task.action))
}

function buildLocalTargetResults(localTasks, closureBefore, closureAfter) {
  const beforeActions = taskActionSet(closureBefore)
  const afterActions = taskActionSet(closureAfter)
  return localTasks.map((task) => ({
    task_id: task.task_id,
    action: task.action,
    before_has_action: beforeActions.has(task.action),
    after_has_action: afterActions.has(task.action),
    resolved: beforeActions.has(task.action) && !afterActions.has(task.action),
  }))
}

function buildBeforeAfterPreview(beforeSheet, afterSheet) {
  const dividerWidth = 4
  const width = beforeSheet.width + dividerWidth + afterSheet.width
  const height = Math.max(beforeSheet.height, afterSheet.height)
  const image = { width, height, data: new Uint8ClampedArray(width * height * 4) }
  function paste(src, dstX) {
    for (let y = 0; y < src.height; y++) {
      for (let x = 0; x < src.width; x++) {
        const srcOffset = (y * src.width + x) * 4
        const dstOffset = (y * width + dstX + x) * 4
        image.data[dstOffset] = src.data[srcOffset]
        image.data[dstOffset + 1] = src.data[srcOffset + 1]
        image.data[dstOffset + 2] = src.data[srcOffset + 2]
        image.data[dstOffset + 3] = src.data[srcOffset + 3]
      }
    }
  }
  paste(beforeSheet, 0)
  for (let y = 0; y < height; y++) {
    for (let x = beforeSheet.width; x < beforeSheet.width + dividerWidth; x++) {
      const offset = (y * width + x) * 4
      image.data[offset] = 20
      image.data[offset + 1] = 184
      image.data[offset + 2] = 166
      image.data[offset + 3] = 255
    }
  }
  paste(afterSheet, beforeSheet.width + dividerWidth)
  return image
}

function providerDryRunContracts(plan) {
  return plan.provider_tasks.map((entry) => ({
    task_id: entry.task_id,
    item_id: entry.item_id,
    action: entry.action,
    animation: entry.animation,
    frames: entry.frames,
    output_dir: entry.output_dir,
    files: entry.files,
    provider_payload: entry.provider_payload,
    quota: {
      provider_call_required: true,
      dry_run_only: true,
      estimated_calls: 1,
    },
  }))
}

function compactValidation(validation) {
  return {
    status: validation.status,
    blocking_errors: validation.blocking_errors,
    warnings: validation.warnings,
    failure_taxonomy: validation.failure_taxonomy,
    metrics: {
      halo_score: validation.metrics?.halo_score,
      background_residue: validation.metrics?.background_residue,
      subpixel_jitter: validation.metrics?.subpixel_jitter,
      action_motion: validation.metrics?.action_motion,
      walk_cycles: validation.metrics?.walk_cycles,
    },
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

function markdownReport(result) {
  const lines = [
    '# Character Quality Closure Repair Report',
    '',
    `Run: \`${result.run_id ?? 'n/a'}\``,
    `Status: \`${result.status}\``,
    `Local tasks: ${result.summary.local_task_count}`,
    `Local applied: ${result.summary.local_applied_count}`,
    `Provider dry-run tasks: ${result.summary.provider_task_count}`,
    `Estimated provider calls: ${result.summary.estimated_provider_calls}`,
    `Before closure: \`${result.quality_closure_before.status}\``,
    `After closure: \`${result.quality_closure_after.status}\``,
    '',
    '## Local Results',
    '',
  ]
  if (!result.local_target_results.length) lines.push('No local tasks selected.')
  else {
    lines.push('| Task | Action | Resolved |')
    lines.push('| --- | --- | --- |')
    for (const item of result.local_target_results) {
      lines.push(`| ${item.task_id} | ${item.action} | ${item.resolved ? 'yes' : 'no'} |`)
    }
  }
  lines.push('', '## Provider Dry-Run Tasks', '')
  if (!result.provider_dry_run.tasks.length) lines.push('No provider repair tasks.')
  else {
    lines.push('| Task | Action | Animation | Frames | Prompt |')
    lines.push('| --- | --- | --- | --- | --- |')
    for (const task of result.provider_dry_run.tasks) {
      lines.push(`| ${task.task_id} | ${task.action} | ${task.animation ?? 'n/a'} | ${task.frames.join(', ') || 'n/a'} | ${task.files.prompt} |`)
    }
  }
  lines.push('', '## Remaining Quality Tasks', '')
  if (!result.remaining_repair_tasks.length) lines.push('No remaining repair tasks.')
  else {
    lines.push('| Action | Provider Required | Target |')
    lines.push('| --- | --- | --- |')
    for (const task of result.remaining_repair_tasks) {
      lines.push(`| ${task.action} | ${task.provider_required ? 'yes' : 'no'} | ${task.animation ?? (task.frames ?? []).join(', ') ?? 'n/a'} |`)
    }
  }
  return `${lines.join('\n')}\n`
}

export async function runQualityClosureRepairLoop({
  plan,
  normalizedSheetBuffer,
  profile = TOPDOWN_RPG_V0,
} = {}) {
  if (!plan) throw new Error('quality closure repair loop plan is required')
  if (!plan.can_run) throw new Error(`quality closure repair loop preflight failed: ${plan.preflight.errors.join('; ')}`)
  if (!normalizedSheetBuffer) throw new Error('normalizedSheetBuffer is required')

  const beforeSheet = await loadRgba(normalizedSheetBuffer)
  const framesBefore = framesFromNormalizedSheet(beforeSheet, profile)
  const validationBefore = validateFrames(framesBefore, profile)
  const qualityClosureBefore = buildCharacterQualityClosure({ frames: framesBefore, profile, validation: validationBefore })
  const localRepair = applyLocalQualityClosureRepairs(framesBefore, plan.local_tasks, profile)
  const validationAfter = validateFrames(localRepair.frames, profile)
  const qualityClosureAfter = buildCharacterQualityClosure({ frames: localRepair.frames, profile, validation: validationAfter })
  const afterSheet = composeSheet(localRepair.frames, profile)
  const providerContracts = providerDryRunContracts(plan)
  const localTargetResults = buildLocalTargetResults(plan.local_tasks, qualityClosureBefore, qualityClosureAfter)
  const remainingRepairTasks = qualityClosureAfter.repair_tasks ?? []
  const localAppliedCount = localRepair.applied_tasks.filter((task) => task.applied).length

  const result = {
    schema_version: 1,
    mode: CHARACTER_QUALITY_CLOSURE_REPAIR_LOOP_MODE,
    status: remainingRepairTasks.length ? 'needs_followup' : 'passed',
    run_id: plan.run_id,
    preset: plan.preset,
    summary: {
      selected_task_count: plan.selected_task_count,
      local_task_count: plan.local_task_count,
      local_applied_count: localAppliedCount,
      provider_task_count: plan.provider_task_count,
      estimated_provider_calls: plan.estimated_provider_calls,
      remaining_repair_task_count: remainingRepairTasks.length,
      before_validation_status: validationBefore.status,
      after_validation_status: validationAfter.status,
      before_quality_closure_status: qualityClosureBefore.status,
      after_quality_closure_status: qualityClosureAfter.status,
    },
    validation_before: compactValidation(validationBefore),
    validation_after: compactValidation(validationAfter),
    quality_closure_before: compactClosure(qualityClosureBefore),
    quality_closure_after: compactClosure(qualityClosureAfter),
    local_repair: localRepair.applied_tasks,
    local_target_results: localTargetResults,
    provider_dry_run: {
      mode: 'provider_repair_dry_run_contracts',
      estimated_provider_calls: plan.estimated_provider_calls,
      tasks: providerContracts,
    },
    remaining_repair_tasks: remainingRepairTasks,
    files: plan.files,
    repaired_normalized_sheet_png: await encodeRgbaPng(afterSheet),
    before_after_preview_png: await encodeRgbaPng(buildBeforeAfterPreview(beforeSheet, afterSheet)),
    markdown: null,
    claim_boundary: 'Local repairs are applied and revalidated; provider tasks are dry-run contracts only and do not spend quota.',
  }
  result.markdown = markdownReport(result)
  return result
}

export function serializeQualityClosureRepairLoopPlan(plan) {
  return {
    ...plan,
    tasks: plan.tasks.map((task) => ({
      task_id: task.task_id,
      item_id: task.item_id,
      stage: task.stage,
      provider_required: task.provider_required,
      action: task.action,
      target: task.target,
      artifacts: task.artifacts,
      provider_payload: task.provider_payload,
      local_payload: task.local_payload,
    })),
  }
}

export function serializeQualityClosureRepairLoopResult(result) {
  return {
    ...result,
    repaired_normalized_sheet_png: undefined,
    before_after_preview_png: undefined,
    markdown: undefined,
  }
}
