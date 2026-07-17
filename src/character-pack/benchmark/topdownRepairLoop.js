import path from 'node:path'

import { applyTopdownRepairCells } from './topdownRepairApply.js'
import {
  buildTopdownRepairReferenceImages,
  generateTopdownRepairCell,
} from './topdownRepairGenerate.js'
import { TOPDOWN_RPG_V0 } from '../profile.js'

function asList(value) {
  if (value === undefined || value === null) return []
  return Array.isArray(value) ? value.map(String) : [String(value)]
}

function asNumberList(value) {
  return asList(value).map((item) => {
    const number = Number(item)
    if (!Number.isInteger(number)) throw new Error(`repair loop frame filter must be an integer, got ${item}`)
    return number
  })
}

export function safeRepairPathSegment(value, fallback = 'item') {
  return (
    String(value ?? fallback)
      .replace(/[^a-zA-Z0-9._-]+/g, '_')
      .replace(/^\.+/, '')
      .replace(/\.+$/, '') || fallback
  )
}

function uniqueValues(values) {
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

function selectTasks(manifest, filters) {
  const taskIds = asList(filters.taskIds)
  const itemIds = new Set(asList(filters.itemIds))
  const caseIds = new Set(asList(filters.caseIds))
  const frames = new Set(asNumberList(filters.frames))
  const actions = new Set(asList(filters.actions))
  const issues = new Set(asList(filters.issues))

  let tasks = manifest.tasks ?? []
  const errors = []
  const duplicateTaskIds = findDuplicateValues(tasks.map((task) => task.task_id))
  if (duplicateTaskIds.length) errors.push(`duplicate repair task ids in manifest: ${duplicateTaskIds.join(', ')}`)

  if (taskIds.length) {
    const selected = []
    for (const taskId of taskIds) {
      const matches = tasks.filter((task) => task.task_id === taskId)
      if (!matches.length) errors.push(`unknown repair task id: ${taskId}`)
      selected.push(...matches)
    }
    tasks = selected
  }

  if (itemIds.size) tasks = tasks.filter((task) => itemIds.has(task.item_id))
  if (caseIds.size) tasks = tasks.filter((task) => caseIds.has(task.case_id))
  if (frames.size) tasks = tasks.filter((task) => frames.has(Number(task.target?.frame)))
  if (actions.size) tasks = tasks.filter((task) => actions.has(task.target?.animation))
  if (issues.size) tasks = tasks.filter((task) => issues.has(task.issue?.type))

  const limit = filters.limit === undefined ? undefined : Number(filters.limit)
  if (limit !== undefined) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('--limit must be a positive integer')
    tasks = tasks.slice(0, limit)
  }

  return { tasks, errors }
}

function parseFrameIssue(message) {
  const match = String(message || '').match(/^frame_(\d+)_(empty|cropped)$/)
  return match ? Number(match[1]) : null
}

function knownBadFramesFor(tasks) {
  const frames = new Set()
  for (const task of tasks) {
    const messages = task.context?.original_blocking_errors ?? []
    for (const message of messages) {
      const frame = parseFrameIssue(message)
      if (frame !== null) frames.add(frame)
    }
    if (Number.isInteger(task.target?.frame)) frames.add(task.target.frame)
  }
  return frames
}

function referencePolicyFor(task, knownBadFrames) {
  const allFrames = (task.context?.same_animation_frames ?? []).map((item) => item.frame)
  const preferredFrames = allFrames.filter((frame) => !knownBadFrames.has(frame))
  const usedFrames = preferredFrames.length ? preferredFrames : allFrames
  return {
    all_frames: allFrames,
    used_frames: usedFrames,
    excluded_known_bad_frames: allFrames.filter((frame) => !usedFrames.includes(frame)),
    fallback_to_known_bad_neighbors: preferredFrames.length === 0 && allFrames.length > 0,
  }
}

function taskWithReferenceFrames(task, frames) {
  const byFrame = new Map((task.context?.same_animation_frames ?? []).map((item) => [item.frame, item]))
  return {
    ...task,
    context: {
      ...task.context,
      same_animation_frames: frames.map((frame) => byFrame.get(frame)).filter(Boolean),
    },
  }
}

function buildImageConfig(manifest, tasks, imageConfig = {}) {
  const firstTaskConfig = tasks[0]?.provider_payload?.image_config ?? {}
  return {
    image_size: imageConfig.image_size || imageConfig.imageSize || firstTaskConfig.image_size || manifest.image_config?.image_size || '1K',
    aspect_ratio: imageConfig.aspect_ratio || imageConfig.aspectRatio || firstTaskConfig.aspect_ratio || manifest.image_config?.aspect_ratio || '1:1',
  }
}

function buildTaskOutput({ outputDir, index, task, referencePolicy }) {
  const prefix = String(index + 1).padStart(2, '0')
  const dir = path.join(outputDir, 'cells', `${prefix}_${safeRepairPathSegment(task.task_id, 'task')}`)
  return {
    task,
    task_id: task.task_id,
    item_id: task.item_id,
    case_id: task.case_id,
    frame: task.target?.frame,
    issue: task.issue?.type ?? null,
    action: task.target?.animation ?? null,
    reference_policy: referencePolicy,
    output_dir: dir,
    files: {
      prompt: path.join(dir, 'prompt.txt'),
      same_animation_reference: path.join(dir, 'same_animation_reference.png'),
      raw_provider_output: path.join(dir, 'raw_provider_output.png'),
      repaired_cell: path.join(dir, 'repaired_cell.png'),
      generation: path.join(dir, 'repair_generation.json'),
      generation_error: path.join(dir, 'generation_error.json'),
    },
  }
}

function buildPreflight({ tasks, selectionErrors }) {
  const errors = [...selectionErrors]
  if (!tasks.length) errors.push('no topdown repair tasks selected')

  const itemIds = uniqueValues(tasks.map((task) => task.item_id))
  const presets = uniqueValues(tasks.map((task) => task.preset))
  const normalizedSheets = uniqueValues(tasks.map((task) => task.artifacts?.normalized_sheet))
  const missingSheetTasks = tasks.filter((task) => !task.artifacts?.normalized_sheet).map((task) => task.task_id)
  const duplicateFrames = findDuplicateValues(tasks.map((task) => task.target?.frame).filter(Number.isInteger))

  if (itemIds.length > 1) errors.push(`selected tasks must share one item_id for one-sheet repair loop: ${itemIds.join(', ')}`)
  if (presets.length > 1) errors.push(`selected tasks must share one preset: ${presets.join(', ')}`)
  if (missingSheetTasks.length) errors.push(`selected tasks are missing normalized_sheet artifacts: ${missingSheetTasks.join(', ')}`)
  if (normalizedSheets.length > 1) errors.push('selected tasks must share one normalized_sheet artifact path')
  if (duplicateFrames.length) errors.push(`duplicate target frames selected: ${duplicateFrames.join(', ')}`)

  return {
    can_run: errors.length === 0,
    errors,
    item_ids: itemIds,
    presets,
    normalized_sheets: normalizedSheets,
    duplicate_frames: duplicateFrames,
    missing_normalized_sheet_tasks: missingSheetTasks,
  }
}

export function buildTopdownRepairLoopPlan({
  manifest = {},
  taskIds,
  itemIds,
  caseIds,
  frames,
  actions,
  issues,
  limit,
  outputDir = path.join('generated', 'topdown-repairs', safeRepairPathSegment(manifest.run_id ?? 'run'), 'repair_loop'),
  providerPresetId = '',
  imageConfig = {},
} = {}) {
  const selected = selectTasks(manifest, { taskIds, itemIds, caseIds, frames, actions, issues, limit })
  const knownBadFrames = knownBadFramesFor(selected.tasks)
  const preflight = buildPreflight({ tasks: selected.tasks, selectionErrors: selected.errors })
  const providerPreset = providerPresetId || selected.tasks[0]?.provider_payload?.provider_preset_id || manifest.provider_preset_id || null
  const resolvedImageConfig = buildImageConfig(manifest, selected.tasks, imageConfig)
  const taskEntries = selected.tasks.map((task, index) =>
    buildTaskOutput({
      outputDir,
      index,
      task,
      referencePolicy: referencePolicyFor(task, knownBadFrames),
    })
  )
  const itemId = preflight.item_ids[0] ?? null
  const itemOutputDir = path.join(outputDir, safeRepairPathSegment(itemId, 'item'))

  return {
    schema_version: 1,
    run_id: manifest.run_id ?? null,
    preset: manifest.preset ?? TOPDOWN_RPG_V0.id,
    mode: 'topdown_repair_loop_plan',
    output_dir: outputDir,
    provider_preset_id: providerPreset,
    image_config: resolvedImageConfig,
    estimated_provider_calls: taskEntries.length,
    input_normalized_sheet: preflight.normalized_sheets[0] ?? null,
    preflight,
    can_run: preflight.can_run,
    tasks: taskEntries,
    files: {
      plan: path.join(outputDir, 'loop_plan.json'),
      summary: path.join(outputDir, 'loop_summary.json'),
      item_output_dir: itemOutputDir,
      repaired_normalized_sheet: path.join(itemOutputDir, 'repaired_normalized_sheet.png'),
      validation_report: path.join(itemOutputDir, 'repair_validation.json'),
    },
  }
}

function compactValidation(validation) {
  return {
    status: validation.status,
    blocking_errors: validation.blocking_errors,
    warnings: validation.warnings,
    failure_taxonomy: validation.failure_taxonomy,
  }
}

function buildValidationGate(applied) {
  const beforeErrors = new Set(applied.validation_before.blocking_errors)
  const afterErrors = new Set(applied.validation_after.blocking_errors)
  const newBlockingErrors = [...afterErrors].filter((error) => !beforeErrors.has(error))
  const unresolvedTargets = applied.target_results.filter((target) => !target.resolved)
  const staleTargets = applied.target_results.filter((target) => !target.before_has_issue)
  return {
    passed: unresolvedTargets.length === 0 && newBlockingErrors.length === 0,
    resolved_count: applied.target_results.filter((target) => target.resolved).length,
    unresolved_count: unresolvedTargets.length,
    stale_count: staleTargets.length,
    new_blocking_errors: newBlockingErrors,
    unresolved_targets: unresolvedTargets,
    stale_targets: staleTargets,
  }
}

function generationError(error) {
  return {
    message: String(error?.message || error),
    status: error?.status ?? 'failed_model_error',
    retry_hint: error?.retry_hint ?? 'manual_inspect',
  }
}

export async function runTopdownRepairLoop({
  plan,
  normalizedSheetBuffer,
  env = process.env,
  fetchImpl = globalThis.fetch,
  profile = TOPDOWN_RPG_V0,
  backgroundMode = 'auto',
} = {}) {
  if (!plan) throw new Error('repair loop plan is required')
  if (!plan.can_run) throw new Error(`repair loop preflight failed: ${plan.preflight.errors.join('; ')}`)
  if (!normalizedSheetBuffer) throw new Error('normalizedSheetBuffer is required')

  const generationResults = []
  const repairs = []

  for (const entry of plan.tasks) {
    const referenceTask = taskWithReferenceFrames(entry.task, entry.reference_policy.used_frames)
    const referenceImages = await buildTopdownRepairReferenceImages({ task: referenceTask, normalizedSheetBuffer, profile })
    try {
      const generated = await generateTopdownRepairCell({
        task: entry.task,
        providerPresetId: plan.provider_preset_id,
        imageConfig: plan.image_config,
        referenceImages,
        env,
        fetchImpl,
        profile,
        backgroundMode,
      })
      generationResults.push({
        status: 'generated',
        task_id: entry.task_id,
        task: entry.task,
        reference_policy: entry.reference_policy,
        reference_images: referenceImages,
        generated,
      })
      repairs.push({ task: entry.task, cellBuffer: generated.repaired_cell_png })
    } catch (error) {
      generationResults.push({
        status: 'failed',
        task_id: entry.task_id,
        task: entry.task,
        reference_policy: entry.reference_policy,
        reference_images: referenceImages,
        error: generationError(error),
      })
      return {
        schema_version: 1,
        status: 'failed_generation',
        run_id: plan.run_id,
        preset: plan.preset,
        generated_count: repairs.length,
        failed_task_id: entry.task_id,
        generation_results: generationResults,
        apply_result: null,
        validation_gate: null,
        summary: {
          task_count: plan.tasks.length,
          generated_count: repairs.length,
          failed_count: 1,
          applied: false,
        },
      }
    }
  }

  const applied = await applyTopdownRepairCells({ normalizedSheetBuffer, repairs, profile })
  const validationGate = buildValidationGate(applied)

  return {
    schema_version: 1,
    status: validationGate.passed ? 'passed' : 'failed_validation',
    run_id: plan.run_id,
    preset: plan.preset,
    generated_count: repairs.length,
    generation_results: generationResults,
    apply_result: {
      schema_version: applied.schema_version,
      preset: applied.preset,
      applied_tasks: applied.applied_tasks,
      target_results: applied.target_results,
      validation_before: compactValidation(applied.validation_before),
      validation_after: compactValidation(applied.validation_after),
      repaired_normalized_sheet_png: applied.repaired_normalized_sheet_png,
      row_gif_buffers: applied.row_gif_buffers,
    },
    validation_gate: validationGate,
    summary: {
      task_count: plan.tasks.length,
      generated_count: repairs.length,
      failed_count: 0,
      applied: true,
      resolved_count: validationGate.resolved_count,
      unresolved_count: validationGate.unresolved_count,
      new_blocking_error_count: validationGate.new_blocking_errors.length,
    },
  }
}

export function serializeTopdownRepairLoopPlan(plan) {
  return {
    ...plan,
    tasks: plan.tasks.map((entry) => ({
      task_id: entry.task_id,
      item_id: entry.item_id,
      case_id: entry.case_id,
      frame: entry.frame,
      issue: entry.issue,
      action: entry.action,
      reference_policy: entry.reference_policy,
      output_dir: entry.output_dir,
      files: entry.files,
      provider_payload: entry.task.provider_payload,
    })),
  }
}

export function serializeTopdownRepairLoopResult(result) {
  return {
    ...result,
    generation_results: result.generation_results.map((entry) => ({
      status: entry.status,
      task_id: entry.task_id,
      reference_policy: entry.reference_policy,
      input_images: entry.generated?.input_images ?? entry.reference_images.map((image) => image.name),
      provider: entry.generated?.provider,
      provider_preset_id: entry.generated?.provider_preset_id,
      provider_label: entry.generated?.provider_label,
      model: entry.generated?.model,
      image_config: entry.generated?.image_config,
      postprocess: entry.generated?.postprocess,
      error: entry.error,
    })),
    apply_result: result.apply_result
      ? {
          ...result.apply_result,
          repaired_normalized_sheet_png: undefined,
          row_gif_buffers: undefined,
          row_gif_count: Object.keys(result.apply_result.row_gif_buffers ?? {}).length,
        }
      : null,
  }
}
