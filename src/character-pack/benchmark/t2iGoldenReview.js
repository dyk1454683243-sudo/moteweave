import { QUALITY_CHARACTER_RELEASE_THRESHOLDS } from '../generationReleaseGate.js'

export const DEFAULT_T2I_GOLDEN_REVIEW_THRESHOLDS = QUALITY_CHARACTER_RELEASE_THRESHOLDS

function round(value, digits = 4) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function numberOrFallback(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function normalizeThresholds(thresholds = {}) {
  return {
    usable_score: numberOrFallback(thresholds.usable_score, DEFAULT_T2I_GOLDEN_REVIEW_THRESHOLDS.usable_score),
    warning_score: numberOrFallback(thresholds.warning_score, DEFAULT_T2I_GOLDEN_REVIEW_THRESHOLDS.warning_score),
    target_usable_rate: numberOrFallback(thresholds.target_usable_rate, DEFAULT_T2I_GOLDEN_REVIEW_THRESHOLDS.target_usable_rate),
    min_visible_pixel_count: numberOrFallback(thresholds.min_visible_pixel_count, DEFAULT_T2I_GOLDEN_REVIEW_THRESHOLDS.min_visible_pixel_count),
    min_unique_color_count: numberOrFallback(thresholds.min_unique_color_count, DEFAULT_T2I_GOLDEN_REVIEW_THRESHOLDS.min_unique_color_count),
    max_palette_changed_pixel_ratio: numberOrFallback(thresholds.max_palette_changed_pixel_ratio, DEFAULT_T2I_GOLDEN_REVIEW_THRESHOLDS.max_palette_changed_pixel_ratio),
    max_outline_pixel_ratio: numberOrFallback(thresholds.max_outline_pixel_ratio, DEFAULT_T2I_GOLDEN_REVIEW_THRESHOLDS.max_outline_pixel_ratio),
    max_visible_pixel_count: numberOrFallback(thresholds.max_visible_pixel_count, DEFAULT_T2I_GOLDEN_REVIEW_THRESHOLDS.max_visible_pixel_count),
    max_bbox_width_ratio: numberOrFallback(thresholds.max_bbox_width_ratio, DEFAULT_T2I_GOLDEN_REVIEW_THRESHOLDS.max_bbox_width_ratio),
    max_bbox_height_ratio: numberOrFallback(thresholds.max_bbox_height_ratio, DEFAULT_T2I_GOLDEN_REVIEW_THRESHOLDS.max_bbox_height_ratio),
    max_bbox_area_ratio: numberOrFallback(thresholds.max_bbox_area_ratio, DEFAULT_T2I_GOLDEN_REVIEW_THRESHOLDS.max_bbox_area_ratio),
    max_center_offset_ratio: numberOrFallback(thresholds.max_center_offset_ratio, DEFAULT_T2I_GOLDEN_REVIEW_THRESHOLDS.max_center_offset_ratio),
    min_edge_margin_ratio: numberOrFallback(thresholds.min_edge_margin_ratio, DEFAULT_T2I_GOLDEN_REVIEW_THRESHOLDS.min_edge_margin_ratio),
  }
}

function selectionEvidenceForItem(item) {
  const selection = item?.candidate_selection ?? {}
  const candidates = selection.candidates ?? []
  const diagnosticSelectedIndex = item?.selected_index ?? selection.selected_index ?? candidates[0]?.index ?? null
  const diagnosticCandidate = candidates.find((candidate) => candidate.index === diagnosticSelectedIndex) ?? candidates[0] ?? null
  const diagnosticSelectedScore = item?.selected_score ?? selection.selected_score ?? diagnosticCandidate?.score ?? null
  const hasTopLevelReleaseIndex = Object.hasOwn(item ?? {}, 'release_selected_index')
  const hasTopLevelReleaseScore = Object.hasOwn(item ?? {}, 'release_selected_score')
  const releaseSelectedIndex = hasTopLevelReleaseIndex
    ? item.release_selected_index
    : selection.release_selected_index ?? null
  const releaseCandidate = releaseSelectedIndex === null
    ? null
    : candidates.find((candidate) => candidate.index === releaseSelectedIndex) ?? null
  const releaseSelectedScore = releaseSelectedIndex === null
    ? null
    : hasTopLevelReleaseScore
      ? item.release_selected_score
      : selection.release_selected_score ?? releaseCandidate?.score ?? null
  const reviewedSelectionRole = releaseSelectedIndex === null ? 'diagnostic' : 'release'
  const nestedReleaseIndex = selection.release_selected_index ?? null
  const nestedReleaseScore = selection.release_selected_score ?? null
  const integrityIssues = []
  if (hasTopLevelReleaseIndex && releaseSelectedIndex !== nestedReleaseIndex) {
    integrityIssues.push('release_selection_index_mismatch')
  }
  if (
    releaseSelectedIndex !== null &&
    hasTopLevelReleaseScore &&
    nestedReleaseScore !== null &&
    Number.isFinite(Number(releaseSelectedScore)) &&
    Number.isFinite(Number(nestedReleaseScore)) &&
    Math.abs(Number(releaseSelectedScore) - Number(nestedReleaseScore)) > 0.000001
  ) {
    integrityIssues.push('release_selection_score_mismatch')
  }
  if (releaseSelectedIndex === null && (item?.release_selected_score != null || nestedReleaseScore !== null)) {
    integrityIssues.push('release_selection_score_without_index')
  }
  if (releaseSelectedIndex !== null && !releaseCandidate) {
    integrityIssues.push('release_candidate_missing')
  } else if (
    releaseCandidate &&
    (releaseCandidate.release_ready !== true || releaseCandidate.status !== 'pass')
  ) {
    integrityIssues.push('release_candidate_not_ready')
  }

  return {
    diagnosticSelectedIndex,
    diagnosticSelectedScore,
    diagnosticCandidate,
    releaseSelectedIndex,
    releaseSelectedScore,
    releaseCandidate,
    reviewedSelectionRole,
    reviewedIndex: releaseSelectedIndex ?? diagnosticSelectedIndex,
    reviewedScore: releaseSelectedScore ?? diagnosticSelectedScore,
    reviewedCandidate: releaseSelectedIndex === null ? diagnosticCandidate : releaseCandidate,
    integrityIssues,
  }
}

function artifactIssue(name, artifact, issues) {
  if (artifact?.exists === false) issues.push(`missing_${name}_file`)
}

function candidateScores(item, artifactStatus = {}) {
  const artifactsByIndex = new Map((artifactStatus.candidates ?? []).map((candidate) => [candidate.index, candidate]))
  return (item?.candidate_selection?.candidates ?? []).map((candidate) => ({
    index: candidate.index,
    score: candidate.score,
    status: candidate.status,
    reason: candidate.reason ?? null,
    metrics: candidate.metrics ?? {},
    artifact: artifactsByIndex.get(candidate.index)?.artifact ?? null,
  }))
}

function artifactRecordsForItem(artifactStatus = {}) {
  return {
    source: artifactStatus.source ?? null,
    result: artifactStatus.result ?? null,
    prompt: artifactStatus.prompt ?? null,
    generation: artifactStatus.generation ?? null,
    candidates: artifactStatus.candidates ?? [],
  }
}

function classifyReviewItem(item, { thresholds, artifactStatus }) {
  const selectionEvidence = selectionEvidenceForItem(item)
  const selected = selectionEvidence.reviewedCandidate
  const metrics = selected?.metrics ?? {}
  const score = numberOrFallback(selectionEvidence.reviewedScore ?? selected?.score, 0)
  const issues = [...selectionEvidence.integrityIssues]
  const artifacts = artifactRecordsForItem(artifactStatus)

  if (item?.status && item.status !== 'done') issues.push(`item_status_${item.status}`)
  if (selected?.status === 'error') issues.push('selected_candidate_error')
  artifactIssue('source', artifacts.source, issues)
  artifactIssue('result', artifacts.result, issues)
  artifactIssue('generation', artifacts.generation, issues)
  artifactIssue('prompt', artifacts.prompt, issues)

  if (score < thresholds.warning_score) issues.push('score_below_warning')
  else if (score < thresholds.usable_score) issues.push('score_below_usable')

  const visiblePixels = numberOrFallback(metrics.visible_pixel_count, 0)
  const uniqueColors = numberOrFallback(metrics.unique_color_count, 0)
  const paletteChange = numberOrFallback(metrics.palette_changed_pixel_ratio, 0)
  const outlineRatio = numberOrFallback(metrics.outline_pixel_ratio, 0)
  const bboxWidthRatio = numberOrFallback(metrics.bbox_width_ratio, 0)
  const bboxHeightRatio = numberOrFallback(metrics.bbox_height_ratio, 0)
  const bboxAreaRatio = numberOrFallback(metrics.bbox_area_ratio, 0)
  const centerOffsetRatio = numberOrFallback(metrics.center_offset_ratio, 0)
  const edgeMarginRatio = numberOrFallback(metrics.edge_margin_ratio, 0)

  // Minimum checks only apply when the metric was actually recorded; a recorded
  // zero is a real failure (e.g. background removal erased the whole subject),
  // not a missing measurement.
  if (metrics.visible_pixel_count != null && visiblePixels < thresholds.min_visible_pixel_count) issues.push('low_visible_pixel_count')
  if (visiblePixels > thresholds.max_visible_pixel_count) issues.push('high_visible_pixel_count')
  if (metrics.unique_color_count != null && uniqueColors < thresholds.min_unique_color_count) issues.push('low_unique_color_count')
  if (paletteChange > thresholds.max_palette_changed_pixel_ratio) issues.push('high_palette_change')
  if (outlineRatio > thresholds.max_outline_pixel_ratio) issues.push('high_outline_ratio')
  if (bboxWidthRatio > thresholds.max_bbox_width_ratio) issues.push('bbox_too_wide')
  if (bboxHeightRatio > thresholds.max_bbox_height_ratio) issues.push('bbox_too_tall')
  if (bboxAreaRatio > thresholds.max_bbox_area_ratio) issues.push('bbox_too_large')
  if (centerOffsetRatio > thresholds.max_center_offset_ratio) issues.push('off_center_subject')
  if (metrics.edge_margin_ratio != null && edgeMarginRatio < thresholds.min_edge_margin_ratio) issues.push('tight_edge_margin')

  const hardIssue = issues.some((issue) => (
    issue.startsWith('missing_') ||
    issue.startsWith('item_status_') ||
    issue === 'selected_candidate_error' ||
    issue === 'score_below_warning' ||
    issue === 'high_visible_pixel_count' ||
    issue === 'bbox_too_wide' ||
    issue === 'bbox_too_tall' ||
    issue === 'bbox_too_large' ||
    issue === 'off_center_subject' ||
    issue === 'tight_edge_margin' ||
    issue.startsWith('release_selection_') ||
    issue.startsWith('release_candidate_')
  ))
  const usable = !hardIssue && score >= thresholds.usable_score
  const reviewStatus = usable && issues.length === 0 ? 'pass' : (hardIssue ? 'fail' : 'warning')

  return {
    case_id: item?.case_id ?? null,
    locale: item?.locale ?? null,
    description: item?.description ?? null,
    review_status: reviewStatus,
    usable,
    selected_index: selectionEvidence.diagnosticSelectedIndex,
    selected_score: numberOrFallback(selectionEvidence.diagnosticSelectedScore, 0),
    diagnostic_selected_index: selectionEvidence.diagnosticSelectedIndex,
    diagnostic_selected_score: numberOrFallback(selectionEvidence.diagnosticSelectedScore, 0),
    release_selected_index: selectionEvidence.releaseSelectedIndex,
    release_selected_score: selectionEvidence.releaseSelectedScore,
    reviewed_selection_role: selectionEvidence.reviewedSelectionRole,
    reviewed_index: selectionEvidence.reviewedIndex,
    reviewed_score: score,
    provider_status: item?.status ?? null,
    issues,
    metrics: {
      visible_pixel_count: visiblePixels,
      unique_color_count: uniqueColors,
      palette_changed_pixel_ratio: paletteChange,
      outline_pixel_ratio: outlineRatio,
      bbox_width_ratio: bboxWidthRatio,
      bbox_height_ratio: bboxHeightRatio,
      bbox_area_ratio: bboxAreaRatio,
      center_offset_ratio: centerOffsetRatio,
      edge_margin_ratio: edgeMarginRatio,
    },
    artifacts,
    candidate_scores: candidateScores(item, artifactStatus),
  }
}

function issueTaxonomy(items) {
  const counts = new Map()
  for (const item of items) {
    for (const issue of item.issues) counts.set(issue, (counts.get(issue) ?? 0) + 1)
  }
  return Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
}

function issueEvidence(items, predicate) {
  const issueCounts = new Map()
  const caseIds = []
  for (const item of items) {
    let matched = false
    for (const issue of item.issues ?? []) {
      if (!predicate(issue)) continue
      issueCounts.set(issue, (issueCounts.get(issue) ?? 0) + 1)
      matched = true
    }
    if (matched) caseIds.push(item.case_id)
  }
  return {
    case_count: caseIds.length,
    affected_cases: caseIds.slice(0, 8),
    truncated_cases: Math.max(0, caseIds.length - 8),
    issue_counts: Object.fromEntries([...issueCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))),
  }
}

function priorityForEvidence(evidence, total, { p0Any = false, p0Ratio = 0.5 } = {}) {
  if (!evidence.case_count) return null
  if (p0Any || (total > 0 && evidence.case_count / total >= p0Ratio)) return 'P0'
  return 'P1'
}

function selectedNonBestEvidence(items) {
  const caseIds = []
  for (const item of items) {
    const selectedScore = numberOrFallback(item.diagnostic_selected_score ?? item.selected_score, -Infinity)
    const candidates = Array.isArray(item.candidate_scores) ? item.candidate_scores : []
    const hasBetterCandidate = candidates.some((candidate) => (
      Number.isFinite(Number(candidate.score)) && Number(candidate.score) > selectedScore + 0.01
    ))
    if (hasBetterCandidate) caseIds.push(item.case_id)
  }
  return {
    case_count: caseIds.length,
    affected_cases: caseIds.slice(0, 8),
    truncated_cases: Math.max(0, caseIds.length - 8),
    issue_counts: caseIds.length ? { selected_non_best_score: caseIds.length } : {},
  }
}

function mergeEvidence(...entries) {
  const caseSet = new Set()
  const issueCounts = new Map()
  for (const entry of entries) {
    for (const caseId of entry.affected_cases ?? []) caseSet.add(caseId)
    for (const [issue, count] of Object.entries(entry.issue_counts ?? {})) {
      issueCounts.set(issue, (issueCounts.get(issue) ?? 0) + Number(count))
    }
  }
  const affectedCases = [...caseSet]
  return {
    case_count: affectedCases.length,
    affected_cases: affectedCases.slice(0, 8),
    truncated_cases: Math.max(0, affectedCases.length - 8),
    issue_counts: Object.fromEntries([...issueCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))),
  }
}

function action(id, {
  priority,
  layer,
  evidence,
  recommendation,
  verification,
}) {
  return {
    id,
    priority,
    layer,
    case_count: evidence.case_count,
    affected_cases: evidence.affected_cases,
    truncated_cases: evidence.truncated_cases,
    issue_counts: evidence.issue_counts,
    recommendation,
    verification,
  }
}

export function buildT2iGoldenClosureAnalysis(reviewCore) {
  const items = reviewCore.items ?? []
  const total = reviewCore.summary?.total ?? items.length
  const promptScaleIssues = new Set([
    'high_visible_pixel_count',
    'low_visible_pixel_count',
    'bbox_too_wide',
    'bbox_too_tall',
    'bbox_too_large',
    'off_center_subject',
    'tight_edge_margin',
  ])
  const pixelStyleIssues = new Set([
    'low_unique_color_count',
    'high_palette_change',
    'high_outline_ratio',
  ])
  const scoreIssues = new Set(['score_below_warning', 'score_below_usable'])

  const artifactEvidence = issueEvidence(items, (issue) => (
    issue.startsWith('missing_') ||
    issue.startsWith('item_status_') ||
    issue === 'selected_candidate_error'
  ))
  const promptEvidence = issueEvidence(items, (issue) => promptScaleIssues.has(issue))
  const pixelEvidence = issueEvidence(items, (issue) => pixelStyleIssues.has(issue))
  const candidateEvidence = mergeEvidence(
    issueEvidence(items, (issue) => scoreIssues.has(issue)),
    selectedNonBestEvidence(items)
  )

  const priorityActions = []
  const artifactPriority = priorityForEvidence(artifactEvidence, total, { p0Any: true })
  if (artifactPriority) {
    priorityActions.push(action('artifact_and_provider_reliability', {
      priority: artifactPriority,
      layer: 'provider_or_artifact_pipeline',
      evidence: artifactEvidence,
      recommendation: 'Fix provider failures or missing review artifacts before judging image quality.',
      verification: 'Rerun t2i-golden-review and confirm missing_* and item_status_* issues are zero.',
    }))
  }
  const promptPriority = priorityForEvidence(promptEvidence, total, { p0Ratio: 0.3 })
  if (promptPriority) {
    priorityActions.push(action('prompt_scale_contract', {
      priority: promptPriority,
      layer: 'prompt_contract',
      evidence: promptEvidence,
      recommendation: 'Tighten the text-to-image contract around production sprite scale, centered full-body silhouette, and safe empty margins.',
      verification: 'BBox, visible-pixel, center-offset, and edge-margin metrics fall within thresholds on the next review.',
    }))
  }
  const pixelPriority = priorityForEvidence(pixelEvidence, total, { p0Ratio: 0.5 })
  if (pixelPriority) {
    priorityActions.push(action('pixel_finishing_calibration', {
      priority: pixelPriority,
      layer: 'pixel_finishing',
      evidence: pixelEvidence,
      recommendation: 'Tune palette snap, outline, and downsample settings so finishing improves pixel style without excessive mutation.',
      verification: 'Palette-change, outline-ratio, and unique-color issues disappear while usable rate does not regress.',
    }))
  }
  const candidatePriority = priorityForEvidence(candidateEvidence, total, { p0Ratio: 0.5 })
  if (candidatePriority) {
    priorityActions.push(action('candidate_selection_and_sampling', {
      priority: candidatePriority,
      layer: 'candidate_selection',
      evidence: candidateEvidence,
      recommendation: 'Inspect candidate scores and keep enough candidates for local ranking to recover from weak generations.',
      verification: 'Selected candidates are the highest scored candidates and score_below_* issues decline in the next run.',
    }))
  }

  priorityActions.sort((a, b) => (
    a.priority.localeCompare(b.priority) ||
    b.case_count - a.case_count ||
    a.id.localeCompare(b.id)
  ))

  if (!priorityActions.length) {
    priorityActions.push({
      id: 'monitor_quality_gate',
      priority: 'P2',
      layer: 'quality_gate',
      case_count: 0,
      affected_cases: [],
      truncated_cases: 0,
      issue_counts: {},
      recommendation: 'Keep the current contract and rerun the review after any provider, prompt, or pixel-finishing change.',
      verification: 'Quality gate remains pass and usable_rate stays at or above the target.',
    })
  }

  return {
    status: reviewCore.quality_gate?.status === 'pass' ? 'pass' : 'needs_action',
    primary_action: priorityActions[0]?.id ?? null,
    priority_actions: priorityActions,
  }
}

export function buildT2iGoldenReview(report, {
  thresholds = {},
  artifactStatusByCaseId = {},
  sourceReport = null,
} = {}) {
  const normalizedThresholds = normalizeThresholds(thresholds)
  const items = (report?.items ?? []).map((item) => classifyReviewItem(item, {
    thresholds: normalizedThresholds,
    artifactStatus: artifactStatusByCaseId[item.case_id] ?? {},
  }))
  const total = items.length
  const passCount = items.filter((item) => item.review_status === 'pass').length
  const warningCount = items.filter((item) => item.review_status === 'warning').length
  const failCount = items.filter((item) => item.review_status === 'fail').length
  const usableCount = items.filter((item) => item.usable).length
  const scoreSum = items.reduce((sum, item) => sum + item.selected_score, 0)
  const reviewedScoreSum = items.reduce((sum, item) => sum + item.reviewed_score, 0)
  const usableRate = total ? round(usableCount / total, 4) : 0
  const qualityGateStatus = total > 0 && usableRate >= normalizedThresholds.target_usable_rate ? 'pass' : 'fail'
  const summary = {
    total,
    pass_count: passCount,
    warning_count: warningCount,
    fail_count: failCount,
    usable_count: usableCount,
    usable_rate: usableRate,
    average_selected_score: total ? round(scoreSum / total, 2) : 0,
    average_reviewed_score: total ? round(reviewedScoreSum / total, 2) : 0,
    issue_taxonomy: issueTaxonomy(items),
  }
  const qualityGate = {
    status: qualityGateStatus,
    target_usable_rate: normalizedThresholds.target_usable_rate,
    usable_rate: usableRate,
    reason: qualityGateStatus === 'pass' ? null : 'usable_rate_below_target',
  }
  const review = {
    schema_version: 't2i_golden_review_v0_2',
    source_report: sourceReport,
    source_run_id: report?.run_id ?? null,
    t2i_mode: report?.t2i_mode ?? null,
    candidate_count: report?.candidate_count ?? null,
    image_config: report?.image_config ?? null,
    generation_options: report?.generation_options ?? null,
    thresholds: normalizedThresholds,
    quality_gate: qualityGate,
    summary,
    items,
  }
  return {
    ...review,
    closure_analysis: buildT2iGoldenClosureAnalysis(review),
  }
}

function md(value) {
  return String(value ?? '').replace(/\|/g, '\\|')
}

export function buildT2iGoldenReviewMarkdown(review) {
  const lines = [
    `# T2I Golden Review ${review.source_run_id ?? 'unknown_run'}`,
    '',
    `Quality gate: \`${review.quality_gate.status}\``,
    `T2I mode: \`${review.t2i_mode ?? 'unknown'}\``,
    `Cases: ${review.summary.total}`,
    `Usable rate: ${review.summary.usable_rate}`,
    `Average reviewed score: ${review.summary.average_reviewed_score}`,
    '',
    '| Case | Locale | Review | Usable | Reviewed | Score | Diagnostic | Release | Issues |',
    '|---|---:|---|---:|---|---:|---:|---:|---|',
    ...review.items.map((item) => `| ${md(item.case_id)} | ${md(item.locale)} | ${item.review_status} | ${item.usable ? 'yes' : 'no'} | ${md(item.reviewed_selection_role)} #${item.reviewed_index ?? ''} | ${item.reviewed_score} | ${item.diagnostic_selected_index ?? ''} | ${item.release_selected_index ?? ''} | ${md(item.issues.join(', ') || 'none')} |`),
    '',
    '## Issue Taxonomy',
    '',
    ...Object.entries(review.summary.issue_taxonomy).map(([issue, count]) => `- ${issue}: ${count}`),
    '',
    '## Closure Analysis',
    '',
    `Primary action: ${review.closure_analysis?.primary_action ?? 'none'}`,
    '',
    '| Priority | Layer | Action | Cases | Issues |',
    '|---|---|---|---:|---|',
    ...(review.closure_analysis?.priority_actions ?? []).map((item) => `| ${md(item.priority)} | ${md(item.layer)} | ${md(item.id)} | ${item.case_count} | ${md(Object.entries(item.issue_counts ?? {}).map(([issue, count]) => `${issue}:${count}`).join(', ') || 'none')} |`),
  ]
  return `${lines.join('\n')}\n`
}

function html(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function imageTag(artifact, alt, className = '') {
  if (!artifact?.href) return '<div class="missing-image">missing image</div>'
  return `<img class="${className}" src="${html(encodeURI(artifact.href))}" alt="${html(alt)}">`
}

function renderCandidate(candidate) {
  const artifact = candidate.artifact ?? {}
  return `
    <figure class="candidate">
      ${imageTag(artifact, `candidate ${candidate.index}`)}
      <figcaption>#${html(candidate.index)} score ${html(candidate.score ?? '')}</figcaption>
    </figure>`
}

export function buildT2iGoldenReviewHtml(review) {
  const taxonomy = Object.entries(review.summary.issue_taxonomy)
    .map(([issue, count]) => `<li><span>${html(issue)}</span><strong>${html(count)}</strong></li>`)
    .join('')
  const actions = (review.closure_analysis?.priority_actions ?? [])
    .map((item) => `
      <li>
        <span><strong>${html(item.priority)}</strong> ${html(item.layer)} / ${html(item.id)}</span>
        <p>${html(item.recommendation)}</p>
      </li>`)
    .join('')
  const cards = review.items.map((item) => `
    <section class="case-card ${html(item.review_status)}">
      <header>
        <div>
          <h2>${html(item.case_id)}</h2>
          <p>${html(item.description ?? '')}</p>
        </div>
        <div class="status">
          <strong>${html(item.review_status)}</strong>
          <span>${html(item.reviewed_selection_role)} #${html(item.reviewed_index ?? '')} score ${html(item.reviewed_score)}</span>
          <span>diagnostic #${html(item.diagnostic_selected_index ?? '')} / release #${html(item.release_selected_index ?? '')}</span>
        </div>
      </header>
      <div class="image-row">
        <figure>
          ${imageTag(item.artifacts.source, `${item.case_id} source`, 'main-image')}
          <figcaption>source</figcaption>
        </figure>
        <figure>
          ${imageTag(item.artifacts.result, `${item.case_id} result`, 'main-image')}
          <figcaption>finished result</figcaption>
        </figure>
      </div>
      <div class="issues">${item.issues.length ? item.issues.map((issue) => `<span>${html(issue)}</span>`).join('') : '<span>none</span>'}</div>
      <div class="candidates">${item.candidate_scores.map(renderCandidate).join('')}</div>
    </section>`).join('')

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>T2I Golden Review ${html(review.source_run_id ?? '')}</title>
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #f7f4ee; color: #1f2428; }
    main { max-width: 1180px; margin: 0 auto; padding: 32px 20px 48px; }
    h1 { margin: 0 0 8px; font-size: 30px; letter-spacing: 0; }
    h2 { margin: 0; font-size: 18px; letter-spacing: 0; }
    p { margin: 4px 0 0; color: #5c6268; }
    .summary { display: grid; grid-template-columns: repeat(5, minmax(120px, 1fr)); gap: 12px; margin: 20px 0; }
    .metric, .taxonomy, .case-card { background: #fff; border: 1px solid #ded8cf; border-radius: 8px; }
    .metric { padding: 14px; }
    .metric span { display: block; color: #687078; font-size: 12px; }
    .metric strong { display: block; margin-top: 6px; font-size: 20px; }
    .taxonomy { padding: 16px; margin-bottom: 16px; }
    .taxonomy ul { margin: 10px 0 0; padding: 0; list-style: none; display: grid; gap: 6px; }
    .taxonomy li { display: flex; justify-content: space-between; border-top: 1px solid #ece7df; padding-top: 6px; }
    .actions li { display: block; }
    .actions p { margin-top: 4px; }
    .case-card { padding: 16px; margin: 16px 0; }
    .case-card header { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; }
    .status { text-align: right; min-width: 120px; }
    .status strong { display: block; text-transform: uppercase; }
    .status span { color: #687078; font-size: 13px; }
    .pass .status strong { color: #126a3a; }
    .warning .status strong { color: #9a5a00; }
    .fail .status strong { color: #a8302f; }
    .image-row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 14px; }
    figure { margin: 0; }
    figcaption { margin-top: 6px; color: #687078; font-size: 12px; }
    img { display: block; width: 100%; image-rendering: pixelated; background: #f1eee8; border: 1px solid #e3ddd4; border-radius: 6px; object-fit: contain; }
    .main-image { height: 280px; }
    .issues { display: flex; flex-wrap: wrap; gap: 6px; margin: 12px 0; }
    .issues span { background: #f1eee8; border: 1px solid #e1dbd2; border-radius: 999px; padding: 4px 8px; font-size: 12px; }
    .candidates { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 10px; }
    .candidate img { height: 120px; }
    .missing-image { display: grid; place-items: center; min-height: 120px; border: 1px dashed #b8afa3; border-radius: 6px; color: #7a7168; }
    @media (max-width: 720px) {
      .summary, .image-row { grid-template-columns: 1fr; }
      .case-card header { flex-direction: column; }
      .status { text-align: left; }
    }
  </style>
</head>
<body>
<main>
  <h1>T2I Golden Review ${html(review.source_run_id ?? '')}</h1>
  <p>${html(review.t2i_mode ?? 'unknown mode')}</p>
  <div class="summary">
    <div class="metric"><span>quality gate</span><strong>${html(review.quality_gate.status)}</strong></div>
    <div class="metric"><span>usable rate</span><strong>${html(review.summary.usable_rate)}</strong></div>
    <div class="metric"><span>usable cases</span><strong>${html(review.summary.usable_count)} / ${html(review.summary.total)}</strong></div>
    <div class="metric"><span>average reviewed score</span><strong>${html(review.summary.average_reviewed_score)}</strong></div>
    <div class="metric"><span>candidate count</span><strong>${html(review.candidate_count ?? '')}</strong></div>
  </div>
  <section class="taxonomy">
    <h2>Issue Taxonomy</h2>
    <ul>${taxonomy || '<li><span>none</span><strong>0</strong></li>'}</ul>
  </section>
  <section class="taxonomy actions">
    <h2>Closure Analysis</h2>
    <ul>${actions || '<li><span>none</span><strong>0</strong></li>'}</ul>
  </section>
  ${cards}
</main>
</body>
</html>
`
}
