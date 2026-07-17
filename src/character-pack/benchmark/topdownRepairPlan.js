import { TOPDOWN_RPG_V0 } from '../profile.js'

const ISSUE_BY_SUFFIX = Object.freeze({
  empty: 'empty_frame',
  cropped: 'cropped_frame',
})

const STRATEGY_BY_ISSUE = Object.freeze({
  empty_frame: 'regenerate_missing_pose_in_cell',
  cropped_frame: 'regenerate_pose_with_more_padding',
})

function parseFrameIssue(message) {
  const match = String(message || '').match(/^frame_(\d+)_(empty|cropped)$/)
  if (!match) return null
  return {
    frame: Number(match[1]),
    issue: ISSUE_BY_SUFFIX[match[2]],
    message: String(message),
  }
}

function frameSemantics(frame, profile = TOPDOWN_RPG_V0) {
  const columns = profile.grid.columns
  const row = Math.floor(frame / columns)
  const col = frame % columns
  const animation = profile.animations.find((item) => item.row === row && col >= item.startCol && col < item.startCol + item.count)
  return {
    row,
    col,
    animation: animation?.name ?? null,
    frame_in_animation: animation ? col - animation.startCol : null,
  }
}

function addActionGroup(groups, issue) {
  const key = issue.animation ?? 'unknown'
  const existing = groups[key] ?? { empty_frame: 0, cropped_frame: 0, frames: [] }
  existing[issue.issue] = (existing[issue.issue] ?? 0) + 1
  if (!existing.frames.includes(issue.frame)) existing.frames.push(issue.frame)
  existing.frames.sort((a, b) => a - b)
  groups[key] = existing
}

function normalizeValidation(validation = {}) {
  return {
    status: validation.status ?? 'unknown',
    blocking_errors: Array.isArray(validation.blocking_errors) ? validation.blocking_errors : [],
    warnings: Array.isArray(validation.warnings) ? validation.warnings : [],
  }
}

export function buildTopdownRepairPlan({ itemId = null, caseId = null, validation = {}, profile = TOPDOWN_RPG_V0 } = {}) {
  const normalizedValidation = normalizeValidation(validation)
  const issues = normalizedValidation.blocking_errors
    .map(parseFrameIssue)
    .filter(Boolean)
    .map((issue) => ({
      ...issue,
      ...frameSemantics(issue.frame, profile),
      repair_scope: 'single_cell',
      strategy: STRATEGY_BY_ISSUE[issue.issue],
    }))
    .sort((a, b) => a.frame - b.frame || a.issue.localeCompare(b.issue))

  const groupsByAction = {}
  for (const issue of issues) addActionGroup(groupsByAction, issue)

  return {
    schema_version: 1,
    preset: profile.id,
    item_id: itemId,
    case_id: caseId,
    validation_status: normalizedValidation.status,
    issue_count: issues.length,
    issues,
    groups_by_action: groupsByAction,
  }
}

function increment(object, key, count = 1) {
  object[key] = (object[key] ?? 0) + count
}

function sortedCounts(counts, keyName) {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || Number(a[0]) - Number(b[0]) || String(a[0]).localeCompare(String(b[0])))
    .map(([key, count]) => ({ [keyName]: Number.isNaN(Number(key)) ? key : Number(key), count }))
}

export function summarizeTopdownRepairPlans(plans = []) {
  const byIssue = {}
  const byFrame = {}
  const byAction = {}
  let issueCount = 0
  let itemsWithRepairs = 0

  for (const plan of plans) {
    const issues = Array.isArray(plan?.issues) ? plan.issues : []
    if (issues.length) itemsWithRepairs += 1
    for (const issue of issues) {
      issueCount += 1
      increment(byIssue, issue.issue)
      increment(byFrame, String(issue.frame))
      const actionKey = issue.animation ?? 'unknown'
      const action = byAction[actionKey] ?? { empty_frame: 0, cropped_frame: 0, frames: [] }
      action[issue.issue] = (action[issue.issue] ?? 0) + 1
      if (!action.frames.includes(issue.frame)) action.frames.push(issue.frame)
      action.frames.sort((a, b) => a - b)
      byAction[actionKey] = action
    }
  }

  return {
    item_count: plans.length,
    items_with_repairs: itemsWithRepairs,
    issue_count: issueCount,
    by_issue: byIssue,
    by_action: byAction,
    top_frames: sortedCounts(byFrame, 'frame'),
  }
}

export function buildTopdownRepairPlansForBenchmarkReport(report = {}) {
  const plans = (report.items ?? []).map((item) =>
    buildTopdownRepairPlan({
      itemId: `${item.case?.id ?? 'case'}_v${item.variant ?? 1}`,
      caseId: item.case?.id ?? null,
      validation: item.validation,
    })
  )
  return {
    schema_version: 1,
    run_id: report.run_id ?? null,
    preset: report.preset ?? TOPDOWN_RPG_V0.id,
    plans,
    summary: summarizeTopdownRepairPlans(plans),
  }
}
