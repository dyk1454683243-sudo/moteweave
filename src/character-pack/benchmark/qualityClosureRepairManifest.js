import path from 'node:path'

import { ACTION_REPAIR_MODE, repairModeForAnimation } from '../actionRepairMode.js'
import { TOPDOWN_RPG_V0, getAnimationFrameIndexes } from '../profile.js'
import { CHARACTER_QUALITY_CLOSURE_MODE } from '../qualityClosureGate.js'

export const CHARACTER_QUALITY_CLOSURE_REPAIR_MANIFEST_MODE = 'character_quality_closure_repair_manifest_v1'

const ACTION_DEFINITIONS = Object.freeze({
  local_halo_cleanup: {
    stage: 'local',
    strategy: 'edge_residue_cleanup',
    issue: 'white_edge_halo',
    guidance: 'Remove near-white edge residue around transparent silhouettes, then rerun validation and quality closure.',
  },
  local_anchor_stabilization: {
    stage: 'local',
    strategy: 'anchor_baseline_stabilization',
    issue: 'anchor_or_baseline_drift',
    guidance: 'Normalize feet-center anchors and baselines before any semantic provider repair. Bbox half-pixel center jitter is retained as advisory evidence unless validator warnings show anchor or baseline drift.',
  },
  single_animation_repair: {
    stage: 'provider',
    strategy: 'animation_motion_repair',
    issue: 'motion_inconsistent',
    guidance: 'Repair one animation group so the target frames keep consistent identity, pose rhythm, scale, palette, and anchors.',
  },
  semantic_frame_repair: {
    stage: 'provider',
    strategy: 'animation_semantic_consistency_repair',
    issue: 'prop_side_flip_suspected',
    guidance: 'Repair one animation group so held props, accessories, silhouette side, costume details, and pose intent remain consistent across frames.',
  },
})

function safeIdPart(value, fallback = 'item') {
  return (
    String(value ?? fallback)
      .replace(/[^a-zA-Z0-9._-]+/g, '_')
      .replace(/^\.+/, '')
      .replace(/\.+$/, '') || fallback
  )
}

function itemIdFor({ item = {}, debugReport = {}, itemId = null } = {}) {
  if (itemId) return String(itemId)
  if (item.item_id) return String(item.item_id)
  if (item.id) return String(item.id)
  const caseId = item.case?.id ?? debugReport.case_id ?? debugReport.id ?? 'debug_report'
  const variant = item.variant ?? debugReport.variant
  return variant === undefined ? String(caseId) : `${caseId}_v${variant}`
}

function artifactPath(artifactDir, fileName) {
  return artifactDir ? path.join(artifactDir, fileName) : null
}

function artifactsFor({ item = {}, artifactDir = null, debugReportPath = null } = {}) {
  const dir = artifactDir ?? item.artifacts?.dir ?? (debugReportPath ? path.dirname(debugReportPath) : null)
  return {
    dir,
    source_sheet: artifactPath(dir, 'source.png'),
    normalized_sheet: artifactPath(dir, 'normalized_sheet.png'),
    debug_report: debugReportPath ?? artifactPath(dir, 'debug_report.json'),
    prompt: artifactPath(dir, 'prompt.txt'),
  }
}

function frameRect(frame, profile = TOPDOWN_RPG_V0) {
  const columns = profile.grid.columns
  const row = Math.floor(frame / columns)
  const col = frame % columns
  return {
    x: col * profile.frame.w,
    y: row * profile.frame.h,
    w: profile.frame.w,
    h: profile.frame.h,
  }
}

function frameSemantics(frame, profile = TOPDOWN_RPG_V0) {
  const columns = profile.grid.columns
  const row = Math.floor(frame / columns)
  const col = frame % columns
  const animation = profile.animations.find((item) => item.row === row && col >= item.startCol && col < item.startCol + item.count)
  return {
    frame,
    row,
    col,
    animation: animation?.name ?? null,
    frame_in_animation: animation ? col - animation.startCol : null,
    rect: frameRect(frame, profile),
  }
}

function framesByIndex(debugReport = {}) {
  return new Map((debugReport.frames ?? []).map((frame) => [frame.index, frame]))
}

function expandAnimationFrames(task = {}, profile = TOPDOWN_RPG_V0) {
  if (Array.isArray(task.frames) && task.frames.length) return task.frames
  if (task.animation) return getAnimationFrameIndexes(task.animation, profile)
  if (Array.isArray(task.animations) && task.animations.length) {
    return task.animations.flatMap((animation) => getAnimationFrameIndexes(animation, profile))
  }
  return []
}

function targetFramesFor(task = {}, debugReport = {}, profile = TOPDOWN_RPG_V0) {
  const byIndex = framesByIndex(debugReport)
  return expandAnimationFrames(task, profile)
    .filter(Number.isInteger)
    .map((frame) => {
      const reportFrame = byIndex.get(frame) ?? {}
      return {
        ...frameSemantics(frame, profile),
        runtime_action: reportFrame.runtime_action ?? null,
        source_frame: reportFrame.source_frame ?? null,
        normalized_bbox: reportFrame.normalized_bbox ?? null,
        normalized_anchor: reportFrame.normalized_anchor ?? null,
        warnings: reportFrame.warnings ?? [],
      }
    })
}

function derivedTargetFramesFor(task = {}, debugReport = {}, primaryTargetFrames = [], profile = TOPDOWN_RPG_V0) {
  const byIndex = framesByIndex(debugReport)
  const derivedTargets = Array.isArray(task.derived_targets) ? task.derived_targets : []
  return derivedTargets.flatMap((target) => {
    if (!target?.animation) return []
    return getAnimationFrameIndexes(target.animation, profile).map((frame, index) => {
      const reportFrame = byIndex.get(frame) ?? {}
      const semantics = frameSemantics(frame, profile)
      return {
        ...semantics,
        runtime_action: reportFrame.runtime_action ?? null,
        source_frame: reportFrame.source_frame ?? null,
        normalized_bbox: reportFrame.normalized_bbox ?? null,
        normalized_anchor: reportFrame.normalized_anchor ?? null,
        warnings: reportFrame.warnings ?? [],
        transform: target.transform ?? null,
        source_index: Math.min(index, Math.max(0, primaryTargetFrames.length - 1)),
        source_target_frame: primaryTargetFrames[Math.min(index, Math.max(0, primaryTargetFrames.length - 1))]?.frame ?? null,
      }
    })
  })
}

function unique(values) {
  return [...new Set(values.filter((value) => value !== null && value !== undefined && value !== ''))]
}

function definitionFor(action) {
  return ACTION_DEFINITIONS[action] ?? {
    stage: 'manual',
    strategy: String(action || 'manual_review'),
    issue: String(action || 'quality_closure_issue'),
    guidance: 'Review this quality closure task manually before deciding whether local or provider repair is appropriate.',
  }
}

function repairModeForClosureTask(task = {}) {
  return task.repair_mode ?? (
    task.action === 'single_animation_repair'
      ? repairModeForAnimation(task.animation)
      : ACTION_REPAIR_MODE.ANIMATION_STRIP
  )
}

function providerOutputCellCount(task = {}, targetFrames = []) {
  return repairModeForClosureTask(task) === ACTION_REPAIR_MODE.STATIC_POSE
    ? 1
    : Math.max(1, targetFrames.length)
}

function buildProviderPrompt({ task, item, targetFrames, profile, definition }) {
  const animation = task.animation ?? (unique(targetFrames.map((frame) => frame.animation)).join(', ') || 'unknown')
  const sourceAction = task.source_action ?? null
  const description = item.case?.description ?? item.description ?? 'the same character shown in the source sheet'
  const frameList = targetFrames.map((frame) => `${frame.frame} (row ${frame.row}, column ${frame.col})`).join(', ')
  const repairMode = repairModeForClosureTask(task)
  const outputCellCount = providerOutputCellCount(task, targetFrames)
  const derivedTargets = Array.isArray(task.derived_targets) ? task.derived_targets : []
  const outputInstruction = repairMode === ACTION_REPAIR_MODE.STATIC_POSE
    ? `Output one full transparent ${profile.sheet.w}x${profile.sheet.h} normalized sheet with the same 8x8 grid. Edit only the listed target frames. The app will crop the first target cell from your returned sheet and paste that same repaired pose into the target frames locally.`
    : `Output a transparent PNG strip containing exactly ${outputCellCount} repaired ${profile.frame.w}x${profile.frame.h} cells in the same order as the target frames, with no text, scenery, UI, border, watermark, helper marks, or extra cells.`
  return [
    `Repair one ${profile.id} animation group from an existing character sprite sheet.`,
    `Character identity: ${description}. Preserve the same character, scale, palette, outline weight, lighting, costume, and pixel density from the source sheet.`,
    `Target ${sourceAction ? `source action: ${sourceAction}; mapped runtime animation: ${animation}` : `animation: ${animation}`}. Target frames: ${frameList || 'unknown'}.`,
    `Known issue: ${task.action}. ${definition.guidance}`,
    `Task rationale: ${task.rationale ?? 'quality closure requested a targeted repair'}.`,
    `Keep feet-center anchors at x=${profile.anchor.x}, y=${profile.anchor.y}, and keep visible pixels inside each ${profile.frame.w}x${profile.frame.h} cell with clear padding.`,
    'Use the normalized sheet and same-animation frames as visual references. Do not change unrelated animations or character identity.',
    derivedTargets.length ? `Local post-processing will derive ${derivedTargets.map((target) => `${target.animation}:${target.transform}`).join(', ')} from this output. Do not generate separate mirrored cells.` : null,
    outputInstruction,
  ].filter(Boolean).join('\n')
}

function localPayloadFor({ task, artifacts, definition }) {
  return {
    mode: task.action,
    strategy: definition.strategy,
    input_images: {
      normalized_sheet: artifacts.normalized_sheet,
    },
    input_reports: {
      debug_report: artifacts.debug_report,
    },
    instructions: definition.guidance,
    expected_output: {
      kind: 'updated_normalized_sheet_png',
      preserve_grid: true,
    },
  }
}

function providerPayloadFor({ task, item, artifacts, targetFrames, profile, definition }) {
  const repairMode = repairModeForClosureTask(task)
  const outputCellCount = providerOutputCellCount(task, targetFrames)
  return {
    mode: 'animation_group_repair_prompt',
    strategy: definition.strategy,
    input_images: {
      normalized_sheet: artifacts.normalized_sheet,
      source_sheet: artifacts.source_sheet,
    },
    input_reports: {
      debug_report: artifacts.debug_report,
    },
    output: {
      kind: repairMode === ACTION_REPAIR_MODE.STATIC_POSE ? 'patched_normalized_sheet_png' : 'repaired_animation_strip_png',
      repair_mode: repairMode,
      cell_width: profile.frame.w,
      cell_height: profile.frame.h,
      cell_count: outputCellCount,
      target_cell_count: Math.max(1, targetFrames.length),
      paste_rects: targetFrames.map((frame) => ({ frame: frame.frame, rect: frame.rect })),
    },
    prompt: buildProviderPrompt({ task, item, targetFrames, profile, definition }),
  }
}

function buildRepairTask({ source, closureTask, index, profile = TOPDOWN_RPG_V0 }) {
  const { debugReport = {}, item = {} } = source
  const itemId = itemIdFor({ item, debugReport, itemId: source.itemId })
  const artifacts = artifactsFor(source)
  const definition = definitionFor(closureTask.action)
  const targetFrames = targetFramesFor(closureTask, debugReport, profile)
  const derivedFrames = derivedTargetFramesFor(closureTask, debugReport, targetFrames, profile)
  const providerRequired = Boolean(closureTask.provider_required)
  const repairMode = repairModeForClosureTask(closureTask)
  const taskId = `${safeIdPart(itemId)}_${safeIdPart(closureTask.id ?? closureTask.action ?? `task_${index + 1}`)}`

  return {
    schema_version: 1,
    task_id: taskId,
    source_task_id: closureTask.id ?? null,
    run_id: source.runId ?? null,
    item_id: itemId,
    case_id: item.case?.id ?? source.caseId ?? null,
    preset: debugReport.profile ?? source.preset ?? profile.id,
    stage: providerRequired ? 'provider' : definition.stage,
    provider_required: providerRequired,
    action: closureTask.action,
    requested_action: closureTask.requested_action ?? closureTask.animation ?? null,
    source_action: closureTask.source_action ?? null,
    source_layout: closureTask.source_layout ?? null,
    repair_mode: repairMode,
    strategy: definition.strategy,
    issue: {
      type: definition.issue,
      source_action: closureTask.action,
    },
    target: {
      animation: closureTask.animation ?? unique(targetFrames.map((frame) => frame.animation))[0] ?? null,
      requested_action: closureTask.requested_action ?? closureTask.animation ?? null,
      source_action: closureTask.source_action ?? null,
      source_layout: closureTask.source_layout ?? null,
      repair_mode: repairMode,
      animations: unique([
        ...(Array.isArray(closureTask.animations) ? closureTask.animations : []),
        ...targetFrames.map((frame) => frame.animation),
      ]),
      frames: targetFrames,
      derived_frames: derivedFrames,
    },
    context: {
      rationale: closureTask.rationale ?? null,
      closure_status: debugReport.quality_closure?.status ?? null,
      validation_status: debugReport.validation?.status ?? null,
      original_blocking_errors: debugReport.validation?.blocking_errors ?? [],
      original_warnings: debugReport.validation?.warnings ?? [],
    },
    artifacts,
    ...(providerRequired
      ? { provider_payload: providerPayloadFor({ task: closureTask, item, artifacts, targetFrames, profile, definition }) }
      : { local_payload: localPayloadFor({ task: closureTask, artifacts, definition }) }),
    validation_after_repair: {
      rerun: 'character-pack validation and character quality closure',
      expected: providerRequired
        ? 'target animation quality closure warning is removed without adding structure failures, halo warnings, or anchor drift'
        : 'local quality gate warning is removed before any provider semantic repair',
    },
  }
}

function increment(object, key, count = 1) {
  object[key] = (object[key] ?? 0) + count
}

function sortedCounts(counts, keyName) {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .map(([key, count]) => ({ [keyName]: key, count }))
}

function hasValidatorAnchorOrBaselineWarning(warnings = []) {
  return warnings.some((warning) => /^frame_\d+_(anchor|baseline)_drift$/.test(String(warning)))
}

function staleAnimationOnlyLocalAnchorTask(task = {}, debugReport = {}) {
  return task.action === 'local_anchor_stabilization' &&
    !(Array.isArray(task.frames) && task.frames.length) &&
    Array.isArray(task.animations) &&
    task.animations.length > 0 &&
    !hasValidatorAnchorOrBaselineWarning(debugReport.validation?.warnings ?? [])
}

export function summarizeCharacterQualityClosureRepairManifest(tasks = [], blockers = []) {
  const byStage = {}
  const byAction = {}
  const byIssue = {}
  const byAnimation = {}
  const itemIds = new Set()

  for (const task of tasks) {
    itemIds.add(task.item_id)
    increment(byStage, task.stage)
    increment(byAction, task.action ?? 'unknown')
    increment(byIssue, task.issue?.type ?? 'unknown')
    const animation = task.target?.animation ?? 'unknown'
    increment(byAnimation, animation)
  }

  return {
    task_count: tasks.length,
    item_count: itemIds.size,
    blocker_count: blockers.length,
    local_task_count: tasks.filter((task) => !task.provider_required).length,
    provider_task_count: tasks.filter((task) => task.provider_required).length,
    estimated_provider_calls: tasks.filter((task) => task.provider_required).length,
    by_stage: byStage,
    by_action: byAction,
    by_issue: byIssue,
    top_animations: sortedCounts(byAnimation, 'animation'),
  }
}

function sourceBlocker(source, reason) {
  return {
    item_id: itemIdFor({ item: source.item ?? {}, debugReport: source.debugReport ?? {}, itemId: source.itemId }),
    debug_report: source.debugReportPath ?? null,
    reason,
  }
}

export function buildCharacterQualityClosureRepairManifestForSources(sources = [], {
  runId = null,
  preset = TOPDOWN_RPG_V0.id,
  profile = TOPDOWN_RPG_V0,
} = {}) {
  const tasks = []
  const blockers = []

  for (const source of sources) {
    if (source.blocker) {
      blockers.push(sourceBlocker(source, source.blocker))
      continue
    }
    const closure = source.debugReport?.quality_closure
    if (!closure) {
      blockers.push(sourceBlocker(source, 'debug_report is missing quality_closure; reprocess the source with the current pipeline before repair planning'))
      continue
    }
    if (closure.mode && closure.mode !== CHARACTER_QUALITY_CLOSURE_MODE) {
      blockers.push(sourceBlocker(source, `unsupported quality_closure mode: ${closure.mode}`))
      continue
    }
    const repairTasks = Array.isArray(closure.repair_tasks) ? closure.repair_tasks : []
    const staleLocalAnchorTask = repairTasks.find((task) => staleAnimationOnlyLocalAnchorTask(task, source.debugReport))
    if (staleLocalAnchorTask) {
      blockers.push(sourceBlocker(
        source,
        `quality_closure task ${staleLocalAnchorTask.id ?? 'local_anchor_stabilization'} uses animation-only local anchor semantics without validator anchor/baseline drift; reprocess the source with the current pipeline before repair planning`
      ))
      continue
    }
    repairTasks.forEach((closureTask, index) => {
      tasks.push(buildRepairTask({
        source: {
          ...source,
          runId: source.runId ?? runId,
          preset,
        },
        closureTask,
        index,
        profile,
      }))
    })
  }

  const summary = summarizeCharacterQualityClosureRepairManifest(tasks, blockers)
  return {
    schema_version: 1,
    mode: CHARACTER_QUALITY_CLOSURE_REPAIR_MANIFEST_MODE,
    run_id: runId,
    preset,
    status: blockers.length ? 'blocked' : tasks.length ? 'needs_repair' : 'ready',
    release_ready: blockers.length === 0 && tasks.length === 0,
    summary,
    blockers,
    tasks,
    claim_boundary: 'This manifest converts local quality-closure evidence into repair tasks only. It does not call a provider, patch images, or claim the asset is production-ready.',
  }
}

export function buildCharacterQualityClosureRepairManifestForDebugReport(debugReport = {}, options = {}) {
  return buildCharacterQualityClosureRepairManifestForSources([{ debugReport, ...options }], options)
}

export function renderCharacterQualityClosureRepairManifestMarkdown(manifest = {}) {
  const lines = [
    '# Character Quality Closure Repair Manifest',
    '',
    `Status: \`${manifest.status ?? 'unknown'}\``,
    `Run: \`${manifest.run_id ?? 'n/a'}\``,
    `Preset: \`${manifest.preset ?? 'n/a'}\``,
    `Tasks: ${manifest.summary?.task_count ?? 0}`,
    `Local tasks: ${manifest.summary?.local_task_count ?? 0}`,
    `Provider tasks: ${manifest.summary?.provider_task_count ?? 0}`,
    `Estimated provider calls: ${manifest.summary?.estimated_provider_calls ?? 0}`,
    '',
    '## Claim Boundary',
    '',
    manifest.claim_boundary ?? '',
    '',
  ]

  if (manifest.blockers?.length) {
    lines.push('## Blockers', '')
    lines.push('| Item | Debug report | Reason |')
    lines.push('| --- | --- | --- |')
    for (const blocker of manifest.blockers) {
      lines.push(`| ${blocker.item_id ?? 'n/a'} | ${blocker.debug_report ?? 'n/a'} | ${blocker.reason ?? 'n/a'} |`)
    }
    lines.push('')
  }

  lines.push('## Tasks', '')
  if (!manifest.tasks?.length) {
    lines.push('No repair tasks.')
  } else {
    lines.push('| Task | Stage | Action | Animation | Frames | Provider |')
    lines.push('| --- | --- | --- | --- | --- | --- |')
    for (const task of manifest.tasks) {
      const frames = (task.target?.frames ?? []).map((frame) => frame.frame).join(', ')
      lines.push(`| ${task.task_id} | ${task.stage} | ${task.action} | ${task.target?.animation ?? 'n/a'} | ${frames || 'n/a'} | ${task.provider_required ? 'yes' : 'no'} |`)
    }
  }

  return `${lines.join('\n')}\n`
}
