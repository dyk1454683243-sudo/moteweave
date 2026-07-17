import path from 'node:path'

import { TOPDOWN_RPG_V0, getAnimationFrameIndexes } from '../profile.js'
import { buildTopdownRepairPlan } from './topdownRepairPlan.js'

const REPAIR_GUIDANCE_BY_ISSUE = Object.freeze({
  empty_frame: 'Create the missing complete character pose for this required cell.',
  cropped_frame: 'Regenerate the pose with the full head, feet, hands, hair, costume, and silhouette inside the cell with clear padding.',
})

function itemIdFor(item = {}) {
  return `${item.case?.id ?? 'case'}_v${item.variant ?? 1}`
}

function issueSlug(issue) {
  return String(issue?.issue ?? 'issue').replace(/_frame$/, '')
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

function animationForIssue(issue, profile = TOPDOWN_RPG_V0) {
  if (!issue.animation) return null
  return profile.animations.find((item) => item.name === issue.animation) ?? null
}

function referenceFramesFor(issue, profile = TOPDOWN_RPG_V0) {
  const animation = animationForIssue(issue, profile)
  if (!animation) return []
  return getAnimationFrameIndexes(animation.name, profile)
    .filter((frame) => frame !== issue.frame)
    .map((frame) => ({
      frame,
      rect: frameRect(frame, profile),
    }))
}

function artifactPath(artifactDir, fileName) {
  return artifactDir ? path.join(artifactDir, fileName) : null
}

function buildArtifacts(item = {}) {
  const artifactDir = item.artifacts?.dir ?? null
  return {
    dir: artifactDir,
    source_sheet: artifactPath(artifactDir, 'source.png'),
    normalized_sheet: artifactPath(artifactDir, 'normalized_sheet.png'),
    debug_report: artifactPath(artifactDir, 'debug_report.json'),
    prompt: artifactPath(artifactDir, 'prompt.txt'),
  }
}

function readableAction(action) {
  return String(action || 'unknown action').replace(/_/g, ' ')
}

function buildRepairPrompt({ item, issue, profile = TOPDOWN_RPG_V0 }) {
  const animation = animationForIssue(issue, profile)
  const frameCount = animation?.count ?? 1
  const frameNumber = issue.frame_in_animation === null || issue.frame_in_animation === undefined
    ? 'unknown'
    : `${issue.frame_in_animation} of ${frameCount}`
  const guidance = REPAIR_GUIDANCE_BY_ISSUE[issue.issue] ?? 'Create a complete replacement pose for this required cell.'
  const description = item.case?.description ?? 'the same character shown in the source sheet'
  return [
    `Repair exactly one ${profile.id} cell from an existing character sprite sheet.`,
    `Character identity: ${description}. Preserve the same character, scale, palette, outline weight, lighting, costume, and pixel density from the source sheet.`,
    `Target cell: frame ${issue.frame}, row ${issue.row}, column ${issue.col}, action ${readableAction(issue.animation)}, animation frame ${frameNumber}.`,
    `Known issue: ${issue.issue}. ${guidance}`,
    `Use same-animation neighboring cells as pose and identity references. Keep the feet-center anchor at x=${profile.anchor.x}, y=${profile.anchor.y}.`,
    `Only repair this one target cell. Do not redraw, shift, crop, merge, relabel, or alter any other cell from the sheet.`,
    `Output one repaired ${profile.frame.w}x${profile.frame.h} cell PNG with the complete character visible and no scenery, text, UI, border, watermark, helper marks, or separate props.`,
  ].join('\n')
}

function increment(object, key, count = 1) {
  object[key] = (object[key] ?? 0) + count
}

function sortedCounts(counts, keyName) {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || Number(a[0]) - Number(b[0]) || String(a[0]).localeCompare(String(b[0])))
    .map(([key, count]) => ({ [keyName]: Number.isNaN(Number(key)) ? key : Number(key), count }))
}

export function buildTopdownRepairTask({
  runId = null,
  item = {},
  issue,
  profile = TOPDOWN_RPG_V0,
  providerPresetId = null,
  templateFile = null,
  imageConfig = {},
} = {}) {
  if (!issue) throw new Error('repair issue is required')
  const itemId = itemIdFor(item)
  const artifacts = buildArtifacts(item)
  const targetRect = frameRect(issue.frame, profile)
  const sameAnimationFrames = referenceFramesFor(issue, profile)
  const resolvedImageConfig = item.generation?.image_config ?? imageConfig ?? {}
  return {
    schema_version: 1,
    task_id: `${itemId}_frame_${issue.frame}_${issueSlug(issue)}`,
    run_id: runId,
    item_id: itemId,
    case_id: item.case?.id ?? null,
    preset: profile.id,
    repair_scope: issue.repair_scope,
    strategy: issue.strategy,
    issue: {
      message: issue.message,
      type: issue.issue,
    },
    target: {
      frame: issue.frame,
      row: issue.row,
      col: issue.col,
      animation: issue.animation,
      frame_in_animation: issue.frame_in_animation,
      rect: targetRect,
      anchor: profile.anchor,
    },
    context: {
      same_animation_frames: sameAnimationFrames,
      validation_status: item.validation?.status ?? null,
      original_blocking_errors: item.validation?.blocking_errors ?? [],
    },
    artifacts,
    provider_payload: {
      mode: 'single_cell_repair_prompt',
      provider_preset_id: item.generation?.provider_preset_id ?? providerPresetId,
      model: item.generation?.model ?? null,
      prompt_contract: item.generation?.prompt_contract ?? null,
      template_file: item.generation?.template_file ?? templateFile,
      image_config: resolvedImageConfig,
      input_images: {
        normalized_sheet: artifacts.normalized_sheet,
        same_animation_frames: sameAnimationFrames,
      },
      output: {
        kind: 'repaired_cell_png',
        width: profile.frame.w,
        height: profile.frame.h,
        paste_rect: targetRect,
      },
      prompt: buildRepairPrompt({ item, issue, profile }),
    },
    validation_after_repair: {
      paste_output_into: artifacts.normalized_sheet,
      rerun: 'character-pack validation and Row GIF previews',
      expected: 'target issue removed without introducing new structure.empty_frame or structure.cropped failures',
    },
  }
}

export function summarizeTopdownRepairManifest(tasks = []) {
  const byStrategy = {}
  const byIssue = {}
  const byFrame = {}
  const byAction = {}
  const itemIds = new Set()

  for (const task of tasks) {
    itemIds.add(task.item_id)
    increment(byStrategy, task.strategy)
    increment(byIssue, task.issue?.type ?? 'unknown')
    increment(byFrame, String(task.target?.frame ?? 'unknown'))
    increment(byAction, task.target?.animation ?? 'unknown')
  }

  return {
    task_count: tasks.length,
    item_count: itemIds.size,
    by_strategy: byStrategy,
    by_issue: byIssue,
    by_action: byAction,
    top_frames: sortedCounts(byFrame, 'frame'),
  }
}

export function buildTopdownRepairManifestForBenchmarkReport(report = {}, { profile = TOPDOWN_RPG_V0 } = {}) {
  const tasks = []
  for (const item of report.items ?? []) {
    const plan = buildTopdownRepairPlan({
      itemId: itemIdFor(item),
      caseId: item.case?.id ?? null,
      validation: item.validation,
      profile,
    })
    for (const issue of plan.issues) {
      tasks.push(buildTopdownRepairTask({
        runId: report.run_id ?? null,
        item,
        issue,
        profile,
        providerPresetId: report.provider_preset_id ?? null,
        templateFile: report.template_file ?? null,
        imageConfig: report.image_config ?? {},
      }))
    }
  }

  return {
    schema_version: 1,
    run_id: report.run_id ?? null,
    preset: report.preset ?? profile.id,
    provider_preset_id: report.provider_preset_id ?? null,
    template_file: report.template_file ?? null,
    image_config: report.image_config ?? {},
    tasks,
    summary: summarizeTopdownRepairManifest(tasks),
  }
}
