export const TWO_POINT_FIVE_D_MATERIAL_SOURCE_BENCHMARK_REVIEW_MODE = 'two_point_five_d_material_source_benchmark_review_v1'

const EXPECTED_BENCHMARK_MODE = 'two_point_five_d_material_source_benchmark_v1'
const EMPTY_COUNTS = Object.freeze({ pass: 0, warning: 0, fail: 0, error: 0 })

function countByStatus(items = []) {
  const counts = { ...EMPTY_COUNTS }
  for (const item of items) {
    const status = counts[item?.status] === undefined ? 'error' : item.status
    counts[status] += 1
  }
  return counts
}

function normalizeCounts(value = {}) {
  return {
    pass: Number(value.pass ?? 0),
    warning: Number(value.warning ?? 0),
    fail: Number(value.fail ?? 0),
    error: Number(value.error ?? 0),
  }
}

function round(value, digits = 4) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function selectedCandidateForCase(caseItem = {}) {
  const rankingSelected = caseItem.candidate_selection?.ranking?.[0]
  if (rankingSelected) return rankingSelected
  const selectedId = caseItem.candidate_selection?.selected_candidate_id
  return (caseItem.candidates ?? []).find((candidate) => candidate.id === selectedId) ?? null
}

function selectedCaseSummary(caseItem = {}) {
  const selected = selectedCandidateForCase(caseItem)
  const warnings = [...new Set(selected?.warnings ?? [])]
  const blockingErrors = [...new Set(selected?.blocking_errors ?? [])]
  return {
    case_id: caseItem.id ?? 'unknown_case',
    selected_candidate_id: selected?.id ?? null,
    selected_status: selected?.status ?? caseItem.candidate_selection?.selected_status ?? 'error',
    warning_count: warnings.length,
    blocking_error_count: blockingErrors.length,
    warnings,
    blocking_errors: blockingErrors,
    output_dir: selected?.output_dir ?? null,
    selection_reason: caseItem.candidate_selection?.selection_reason ?? '',
  }
}

function isProviderIssue(issueId = '') {
  return /provider|quota|route|api_key|model|generation_failed|configuration_error|safety_filter/i.test(issueId)
}

function issueSeverity(issueId = '') {
  if (isProviderIssue(issueId)) return 'blocking'
  if (issueId.includes('blocking') || issueId.includes('failed') || issueId.includes('error')) return 'blocking'
  return 'warning'
}

function topIssuesFromReport(report = {}, selectedCases = []) {
  const configured = report.summary?.failure_taxonomy?.top_categories ?? []
  const map = new Map()
  const configuredIds = new Set()

  for (const item of configured) {
    const id = String(item.id ?? 'unknown_issue')
    configuredIds.add(id)
    map.set(id, {
      id,
      count: Number(item.count ?? 0),
      examples: Array.isArray(item.examples) ? item.examples.slice(0, 3).map(String) : [],
      severity: issueSeverity(id),
    })
  }

  for (const caseItem of selectedCases) {
    for (const issueId of [...caseItem.warnings, ...caseItem.blocking_errors]) {
      const id = String(issueId)
      const entry = map.get(id) ?? { id, count: 0, examples: [], severity: issueSeverity(id) }
      if (!configuredIds.has(id)) entry.count += 1
      if (entry.examples.length < 3) entry.examples.push(`${caseItem.case_id}/${caseItem.selected_candidate_id ?? 'none'}`)
      map.set(id, entry)
    }
  }

  return [...map.values()]
    .filter((item) => item.count > 0 || item.examples.length)
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id))
}

function isSourceNormalizationIssue(issueId = '') {
  return /source_normalization|normalize|source_format|source_sheet_size|png|jpeg/i.test(issueId)
}

function isMaterialExtractionIssue(issueId = '') {
  return /material_source|quality_gate|guidance|material_patch|slot_distinction|tileable|palette/i.test(issueId)
}

function actionForIssues(topIssues = [], { allowProviderAction = true } = {}) {
  if (allowProviderAction && topIssues.some((issue) => isProviderIssue(issue.id))) return 'fix_provider_route'
  if (topIssues.some((issue) => isSourceNormalizationIssue(issue.id))) return 'improve_source_normalization'
  if (topIssues.some((issue) => isMaterialExtractionIssue(issue.id))) return 'improve_material_extraction'
  return 'review_warning_taxonomy'
}

function decisionForReview({
  validReport,
  selectedCounts,
  selectedUsableRate,
  selectedPassRate,
  selectedWarningCount,
  selectedBlockingErrorCount,
  providerErrorCount,
  completedCandidateCount,
  topIssues,
} = {}) {
  if (!validReport) {
    return {
      status: 'invalid_report',
      release_ready: false,
      decision: {
        next_action: 'inspect_report',
        priority: 'P0',
        rationale: 'Benchmark review needs a material-source benchmark report with the expected schema.',
      },
    }
  }

  if (providerErrorCount > 0 && (completedCandidateCount === 0 || selectedCounts.error > 0 || selectedUsableRate === 0)) {
    return {
      status: 'provider_blocked',
      release_ready: false,
      decision: {
        next_action: 'fix_provider_route',
        priority: 'P0',
        rationale: 'Provider route or quota failures prevented usable raw material-source evidence; fix provider access before judging quality.',
      },
    }
  }

  if (selectedCounts.fail > 0 || selectedCounts.error > 0 || selectedUsableRate < 1 || selectedBlockingErrorCount > 0) {
    const nextAction = actionForIssues(topIssues)
    return {
      status: 'needs_quality_work',
      release_ready: false,
      decision: {
        next_action: nextAction,
        priority: 'P0',
        rationale: nextAction === 'fix_provider_route'
          ? 'Provider failures are mixed with local quality evidence; separate route access before expanding the benchmark.'
          : 'At least one selected candidate is not locally usable; improve the failing stage before expanding the sample.',
      },
    }
  }

  if (selectedCounts.warning > 0 || selectedPassRate < 1 || selectedWarningCount > 0 || topIssues.length > 0) {
    const nextAction = actionForIssues(topIssues, { allowProviderAction: false })
    return {
      status: 'review_warnings',
      release_ready: false,
      decision: {
        next_action: nextAction,
        priority: 'P1',
        rationale: nextAction === 'improve_material_extraction'
          ? 'Selected candidates are usable, but local material extraction or quality gates still report warnings.'
          : 'Selected candidates are usable, but warning taxonomy should be reviewed before making broader quality claims.',
      },
    }
  }

  return {
    status: 'ready_to_expand',
    release_ready: true,
    decision: {
      next_action: 'run_larger_sample',
      priority: 'P2',
      rationale: 'Selected candidates passed local gates with no reported issues; the next useful evidence is a larger sampled benchmark.',
    },
  }
}

export function buildTwoPointFiveDMaterialSourceBenchmarkReview(report = {}) {
  const validReport = report?.mode === EXPECTED_BENCHMARK_MODE
  const cases = Array.isArray(report?.cases) ? report.cases : []
  const selectedCases = cases.map(selectedCaseSummary)
  const allCandidates = cases.flatMap((caseItem) => caseItem.candidates ?? [])
  const selectedStatuses = selectedCases.map((item) => ({ status: item.selected_status }))
  const selectedCounts = normalizeCounts(report?.summary?.selected_validation ?? countByStatus(selectedStatuses))
  const candidateCounts = normalizeCounts(report?.summary?.candidate_validation ?? countByStatus(allCandidates))
  const selectedTotal = selectedCounts.pass + selectedCounts.warning + selectedCounts.fail + selectedCounts.error
  const selectedPassRate = Number(report?.summary?.selected_pass_rate ?? (selectedTotal ? round(selectedCounts.pass / selectedTotal) : 0))
  const selectedUsableRate = Number(report?.summary?.selected_usable_rate ?? (selectedTotal ? round((selectedCounts.pass + selectedCounts.warning) / selectedTotal) : 0))
  const topIssues = topIssuesFromReport(report, selectedCases)
  const selectedWarningCount = selectedCases.reduce((total, item) => total + item.warning_count, 0)
  const selectedBlockingErrorCount = selectedCases.reduce((total, item) => total + item.blocking_error_count, 0)
  const providerErrorCount = topIssues
    .filter((issue) => isProviderIssue(issue.id))
    .reduce((total, issue) => total + issue.count, 0)
  const completedCandidateCount = allCandidates.filter((candidate) => candidate.status !== 'error').length
  const decision = decisionForReview({
    validReport,
    selectedCounts,
    selectedUsableRate,
    selectedPassRate,
    selectedWarningCount,
    selectedBlockingErrorCount,
    providerErrorCount,
    completedCandidateCount,
    topIssues,
  })

  return {
    schema_version: 1,
    mode: TWO_POINT_FIVE_D_MATERIAL_SOURCE_BENCHMARK_REVIEW_MODE,
    status: decision.status,
    release_ready: decision.release_ready,
    decision: decision.decision,
    summary: {
      case_count: Number(report?.summary?.case_count ?? cases.length),
      candidate_count: Number(report?.summary?.candidate_count ?? allCandidates.length),
      selected_usable_rate: selectedUsableRate,
      selected_pass_rate: selectedPassRate,
      selected_counts: selectedCounts,
      candidate_counts: candidateCounts,
      top_issue_count: topIssues.reduce((total, item) => total + item.count, 0),
      selected_warning_count: selectedWarningCount,
      selected_blocking_error_count: selectedBlockingErrorCount,
      provider_error_count: providerErrorCount,
      completed_candidate_count: completedCandidateCount,
      stopped_early: Boolean(report?.summary?.stopped_early),
    },
    top_issues: topIssues,
    selected_cases: selectedCases,
    claim_boundary: report?.claim_boundary
      ?? 'Provider output is reviewed as raw material source only; local deterministic code owns final atlas structure.',
  }
}
