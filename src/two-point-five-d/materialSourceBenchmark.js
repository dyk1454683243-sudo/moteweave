import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { normalizeGenerationOptions } from '../character-pack/textToImagePrompt.js'
import { isNonRetryableProviderError, providerErrorFailureStatus } from '../character-pack/providers/providerErrors.js'
import { generateTwoPointFiveDMaterialSource } from './aiMaterialSourceBridge.js'
import { writeTwoPointFiveDTilesetArtifacts } from './atlasExporter.js'
import { buildTwoPointFiveDMaterialSourceBenchmarkReview } from './materialSourceBenchmarkReview.js'
import { DEFAULT_TWO_POINT_FIVE_D_TILESET_CONTRACT } from './tilesetContract.js'

export const TWO_POINT_FIVE_D_MATERIAL_SOURCE_BENCHMARK_MODE = 'two_point_five_d_material_source_benchmark_v1'
export const MAX_TWO_POINT_FIVE_D_MATERIAL_SOURCE_CANDIDATES = 8

export const DEFAULT_TWO_POINT_FIVE_D_MATERIAL_SOURCE_BENCHMARK_CASES = Object.freeze([
  {
    id: 'mossy_cliff_grass_block',
    description: 'mossy cliff grass block material source, lush top surface, dark stone and soil side walls, crisp 2.5D pixel terrain materials',
  },
  {
    id: 'dry_rocky_plateau',
    description: 'dry rocky plateau block material source, dusty top surface, layered sandstone sides, crisp 2.5D pixel terrain materials',
  },
  {
    id: 'snowy_ruins_ledge',
    description: 'snowy ruined stone ledge material source, snow top surface, cold stone sides, crisp 2.5D pixel terrain materials',
  },
  {
    id: 'wet_cave_floor_block',
    description: 'wet cave floor block material source, slick mossy top surface, dark cave wall sides, crisp 2.5D pixel terrain materials',
  },
  {
    id: 'sandstone_desert_block',
    description: 'sandstone desert block material source, pale sand top surface, warm carved rock sides, crisp 2.5D pixel terrain materials',
  },
])

const STATUS_RANK = Object.freeze({ pass: 0, warning: 1, fail: 2, error: 3 })

function safePathSegment(value = 'item', fallback = 'item') {
  return String(value || fallback)
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '') || fallback
}

function round(value, digits = 4) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function normalizeCandidateCount(value = 1) {
  const count = Number(value ?? 1)
  if (!Number.isInteger(count) || count < 1) throw new Error('candidateCount must be a positive integer')
  if (count > MAX_TWO_POINT_FIVE_D_MATERIAL_SOURCE_CANDIDATES) {
    throw new Error(`candidateCount must be ${MAX_TWO_POINT_FIVE_D_MATERIAL_SOURCE_CANDIDATES} or less`)
  }
  return count
}

function statusRank(status) {
  return STATUS_RANK[status] ?? STATUS_RANK.error
}

function warningList(result) {
  return [
    ...(result.validation?.warnings ?? []),
    ...(result.plan?.source_normalization?.warnings ?? []).map((code) => `source_normalization.${code}`),
    ...(result.plan?.material_source?.warnings ?? []).map((code) => `material_source.${code}`),
    ...(result.plan?.material_source?.quality_gates?.warnings ?? []).map((code) => `quality_gate.${code}`),
    ...(result.plan?.material_source_guidance?.issues ?? [])
      .filter((item) => item.severity !== 'info')
      .map((item) => `guidance.${item.code}`),
  ]
}

function blockingErrorList(result) {
  return [
    ...(result.validation?.blocking_errors ?? []),
  ]
}

function candidateStatus({ result, warnings, blockingErrors }) {
  if (result.status === 'fail' || blockingErrors.length) return 'fail'
  if (warnings.length) return 'warning'
  return 'pass'
}

function scoreCandidate({ status, result, warnings, blockingErrors, index }) {
  const materialSource = result.plan?.material_source
  const extraction = materialSource?.extraction
  const qualityGates = materialSource?.quality_gates
  const slotSeparation = materialSource?.slot_separation
  return {
    status_rank: statusRank(status),
    deterministic_blocking_error_count: blockingErrors.length,
    total_warning_count: warnings.length,
    validation_warning_count: result.validation?.warnings?.length ?? 0,
    source_normalization_warning_count: result.plan?.source_normalization?.warnings?.length ?? 0,
    material_source_warning_count: materialSource?.warnings?.length ?? 0,
    quality_gate_warning_count: qualityGates?.warnings?.length ?? 0,
    guidance_issue_count: (result.plan?.material_source_guidance?.issues ?? []).filter((item) => item.severity !== 'info').length,
    warning_sample_count: qualityGates?.warning_sample_count ?? 0,
    warning_patch_count: extraction?.warning_patch_count ?? 0,
    slot_distinction_remaining_warning_count: slotSeparation?.remaining_warning_count ?? 0,
    slot_distinction_initial_warning_count: slotSeparation?.initial_warning_count ?? 0,
    candidate_index: index,
  }
}

function compareCandidateSummaries(a, b) {
  for (const key of [
    'status_rank',
    'deterministic_blocking_error_count',
    'total_warning_count',
    'validation_warning_count',
    'source_normalization_warning_count',
    'material_source_warning_count',
    'quality_gate_warning_count',
    'guidance_issue_count',
    'warning_sample_count',
    'warning_patch_count',
    'slot_distinction_remaining_warning_count',
    'slot_distinction_initial_warning_count',
    'candidate_index',
  ]) {
    const delta = (a.score?.[key] ?? 0) - (b.score?.[key] ?? 0)
    if (delta) return delta
  }
  return String(a.id).localeCompare(String(b.id))
}

function providerBudgetSummary(providerBudget, plannedProviderCalls) {
  if (!providerBudget) return null
  return {
    planned_provider_calls: plannedProviderCalls,
    max_provider_calls: Number(providerBudget.max ?? providerBudget.maxProviderCalls ?? 0),
    used_provider_calls: Number(providerBudget.used ?? providerBudget.providerCallsUsed ?? 0),
  }
}

function generationOptionsForCandidate(baseOptions = {}, caseIndex, candidateIndex) {
  const normalized = normalizeGenerationOptions({
    ...baseOptions,
    candidateCount: 1,
  })
  const baseSeed = Number(normalized.seed)
  return {
    ...normalized,
    candidateCount: 1,
    ...(Number.isFinite(baseSeed) ? { seed: baseSeed + caseIndex * 100 + candidateIndex } : {}),
  }
}

function relativeArtifacts(outputDir, artifacts = {}) {
  return Object.fromEntries(Object.entries(artifacts).map(([key, value]) => [
    key,
    path.relative(outputDir, value).split(path.sep).join('/'),
  ]))
}

function successfulCandidateSummary({ candidateId, index, caseItem, generated, result, outputDir }) {
  const warnings = [...new Set(warningList(result))]
  const blockingErrors = [...new Set(blockingErrorList(result))]
  const status = candidateStatus({ result, warnings, blockingErrors })
  const score = scoreCandidate({ status, result, warnings, blockingErrors, index })
  return {
    id: candidateId,
    case_id: caseItem.id,
    index,
    status,
    validation_status: result.validation.status,
    source_normalization_status: result.plan?.source_normalization?.status ?? null,
    material_source_status: result.plan?.material_source?.status ?? null,
    warnings,
    blocking_errors: blockingErrors,
    score,
    provider: generated.report.provider,
    provider_preset_id: generated.report.provider_preset_id,
    model: generated.report.model,
    prompt_contract_version: generated.report.prompt_contract.contract_version,
    generated_source: generated.report.generated_source,
    artifacts: relativeArtifacts(outputDir, result.artifacts),
    output_dir: path.relative(outputDir, result.output_dir).split(path.sep).join('/'),
  }
}

function failedCandidateSummary({ candidateId, index, caseItem, error }) {
  return {
    id: candidateId,
    case_id: caseItem.id,
    index,
    status: 'error',
    validation_status: 'not_run',
    source_normalization_status: 'not_run',
    material_source_status: 'not_run',
    warnings: [],
    blocking_errors: ['provider_material_source_generation_failed'],
    score: {
      status_rank: statusRank('error'),
      deterministic_blocking_error_count: 1,
      total_warning_count: 0,
      candidate_index: index,
    },
    provider: null,
    provider_preset_id: null,
    model: null,
    failure_status: providerErrorFailureStatus(error) ?? error.status ?? null,
    retry_hint: error.retry_hint ?? 'inspect_provider_route',
    error: String(error.message || error),
    provider_attempts: error.providerAttempts ?? [],
    non_retryable: isNonRetryableProviderError(error),
    artifacts: {},
    output_dir: null,
  }
}

function selectionReason(selected, candidateCount) {
  if (!selected) return 'no candidate completed provider generation'
  const label = selected.status === 'pass'
    ? 'passed local material-source and atlas validation'
    : selected.status === 'warning'
      ? 'had the lowest local warning score'
      : selected.status === 'fail'
        ? 'had the lowest deterministic failure score'
        : 'had the lowest provider/runtime error score'
  return candidateCount === 1
    ? `${selected.id} selected as the only completed candidate; ${label}`
    : `${selected.id} selected from ${candidateCount} candidates; ${label}`
}

function buildCandidateSelection(candidates) {
  const ranking = [...candidates].sort(compareCandidateSummaries)
  const selected = ranking[0] ?? null
  return {
    schema_version: 1,
    mode: 'two_point_five_d_material_source_candidate_selection_v1',
    candidate_count: candidates.length,
    selected_candidate_id: selected?.id ?? null,
    selected_candidate_index: selected?.index ?? null,
    selected_status: selected?.status ?? 'error',
    selection_reason: selectionReason(selected, candidates.length),
    ranking,
  }
}

function statusCounts(items) {
  const counts = { pass: 0, warning: 0, fail: 0, error: 0 }
  for (const item of items) {
    const status = counts[item.status] === undefined ? 'error' : item.status
    counts[status] += 1
  }
  return counts
}

function topWarnings(cases) {
  const map = new Map()
  for (const item of cases.flatMap((caseItem) => caseItem.candidates)) {
    for (const warning of [...(item.warnings ?? []), ...(item.blocking_errors ?? [])]) {
      const entry = map.get(warning) ?? { id: warning, count: 0, examples: [] }
      entry.count += 1
      if (entry.examples.length < 3) entry.examples.push(`${item.case_id}/${item.id}`)
      map.set(warning, entry)
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.id.localeCompare(b.id))
}

function buildSummary({ cases, providerBudget, plannedProviderCalls, stoppedEarly }) {
  const selected = cases.map((caseItem) => caseItem.candidate_selection.ranking[0]).filter(Boolean)
  const allCandidates = cases.flatMap((caseItem) => caseItem.candidates)
  const selectedCounts = statusCounts(selected)
  const candidateCounts = statusCounts(allCandidates)
  const status = stoppedEarly || selectedCounts.fail || selectedCounts.error
    ? 'fail'
    : selectedCounts.warning
      ? 'warning'
      : 'pass'
  return {
    status,
    case_count: cases.length,
    candidate_count: allCandidates.length,
    selected_validation: selectedCounts,
    candidate_validation: candidateCounts,
    selected_pass_rate: selected.length ? round(selectedCounts.pass / selected.length) : 0,
    selected_usable_rate: selected.length ? round((selectedCounts.pass + selectedCounts.warning) / selected.length) : 0,
    provider_call_budget: providerBudgetSummary(providerBudget, plannedProviderCalls),
    stopped_early: Boolean(stoppedEarly),
    failure_taxonomy: {
      top_categories: topWarnings(cases),
    },
  }
}

export function selectTwoPointFiveDMaterialSourceBenchmarkCases({ caseIds = [], sampleSize, description } = {}) {
  if (description) {
    return [{
      id: 'custom_material_source',
      description: String(description),
    }]
  }
  const requested = Array.isArray(caseIds) ? caseIds.filter(Boolean).map(String) : []
  const byId = new Map(DEFAULT_TWO_POINT_FIVE_D_MATERIAL_SOURCE_BENCHMARK_CASES.map((item) => [item.id, item]))
  if (requested.length) {
    const missing = requested.filter((id) => !byId.has(id))
    if (missing.length) throw new Error(`Unknown material source benchmark case id: ${missing.join(', ')}`)
    return requested.map((id) => byId.get(id))
  }
  const limit = sampleSize === undefined ? DEFAULT_TWO_POINT_FIVE_D_MATERIAL_SOURCE_BENCHMARK_CASES.length : Number(sampleSize)
  if (!Number.isInteger(limit) || limit < 1) throw new Error('sampleSize must be a positive integer')
  return DEFAULT_TWO_POINT_FIVE_D_MATERIAL_SOURCE_BENCHMARK_CASES.slice(0, limit)
}

export function buildTwoPointFiveDMaterialSourceBenchmarkPlan({
  runId = 'two_point_five_d_material_source_benchmark',
  outputDir = 'generated/two-point-five-d-material-source-benchmarks',
  caseIds,
  sampleSize,
  description,
  providerPresetId = '',
  imageConfig = {},
  generationOptions = {},
  candidateCount = 3,
  contract = DEFAULT_TWO_POINT_FIVE_D_TILESET_CONTRACT,
  materialSampleLayout = null,
  mapOptions = {},
} = {}) {
  const cases = selectTwoPointFiveDMaterialSourceBenchmarkCases({ caseIds, sampleSize, description })
  const resolvedCandidateCount = normalizeCandidateCount(candidateCount)
  return {
    schema_version: 1,
    mode: `${TWO_POINT_FIVE_D_MATERIAL_SOURCE_BENCHMARK_MODE}_plan`,
    run_id: runId,
    output_dir: path.join(outputDir, runId),
    provider_preset_id: providerPresetId || null,
    image_config: imageConfig,
    generation_options: normalizeGenerationOptions({ ...generationOptions, candidateCount: 1 }),
    candidate_count: resolvedCandidateCount,
    estimated_provider_calls: cases.length * resolvedCandidateCount,
    contract,
    material_sample_layout: materialSampleLayout,
    map_options: mapOptions,
    cases: cases.map((item, index) => ({
      id: item.id,
      item_id: `${safePathSegment(item.id)}_v1`,
      description: item.description,
      index,
    })),
    claim_boundary: 'This plan benchmarks provider raw material-source candidates only. Final tileset structure, validation, and exports remain owned by local deterministic code.',
  }
}

export function renderTwoPointFiveDMaterialSourceBenchmarkMarkdown(report) {
  const review = report.review ?? buildTwoPointFiveDMaterialSourceBenchmarkReview(report)
  const lines = [
    `# 2.5D Material Source Benchmark: ${report.run_id}`,
    '',
    `Status: ${report.status}`,
    `Cases: ${report.summary.case_count}`,
    `Candidates attempted: ${report.summary.candidate_count}`,
    `Selected usable rate: ${report.summary.selected_usable_rate}`,
    '',
    '## Decision Summary',
    '',
    `Review status: ${review.status}`,
    `Release ready: ${review.release_ready ? 'yes' : 'no'}`,
    `Next action: ${review.decision.next_action}`,
    `Priority: ${review.decision.priority}`,
    `Rationale: ${review.decision.rationale}`,
    '',
    '## Selected Candidates',
    '',
    '| Case | Selected | Status | Warnings | Output |',
    '| --- | --- | --- | ---: | --- |',
  ]
  for (const item of report.cases) {
    const selected = item.candidate_selection.ranking[0]
    lines.push(`| ${item.id} | ${selected?.id ?? 'none'} | ${selected?.status ?? 'error'} | ${selected?.warnings?.length ?? 0} | ${selected?.output_dir ?? ''} |`)
  }
  lines.push('', '## Top Issues', '')
  for (const issue of report.summary.failure_taxonomy.top_categories.slice(0, 10)) {
    lines.push(`- ${issue.id}: ${issue.count}`)
  }
  lines.push('', `Claim boundary: ${report.claim_boundary}`)
  return `${lines.join('\n')}\n`
}

export async function runTwoPointFiveDMaterialSourceBenchmark({
  plan,
  providerBudget = null,
  env = process.env,
  fetchImpl = globalThis.fetch,
  requestPromptImage = null,
} = {}) {
  if (!plan) throw new Error('plan is required')
  await mkdir(plan.output_dir, { recursive: true })
  const itemsDir = path.join(plan.output_dir, 'items')
  await mkdir(itemsDir, { recursive: true })
  const cases = []
  let stoppedEarly = false

  for (const caseItem of plan.cases) {
    const caseOutputDir = path.join(itemsDir, caseItem.item_id)
    await mkdir(caseOutputDir, { recursive: true })
    const candidates = []

    for (let index = 0; index < plan.candidate_count; index += 1) {
      const candidateId = `candidate_${String(index + 1).padStart(2, '0')}`
      try {
        const generated = await generateTwoPointFiveDMaterialSource({
          description: caseItem.description,
          contract: plan.contract,
          providerPresetId: plan.provider_preset_id,
          imageConfig: plan.image_config,
          generationOptions: generationOptionsForCandidate(plan.generation_options, caseItem.index, index),
          providerBudget,
          env,
          fetchImpl,
          requestPromptImage,
        })
        const result = await writeTwoPointFiveDTilesetArtifacts({
          contract: plan.contract,
          materialSource: {
            id: `${caseItem.id}_${candidateId}_provider_material_source.png`,
            path: `${caseItem.id}_${candidateId}_provider_material_source.png`,
            buffer: generated.buffer,
          },
          materialSourceBridge: generated.report,
          materialSampleLayout: plan.material_sample_layout,
          mapOptions: plan.map_options,
          outputDir: caseOutputDir,
          runId: candidateId,
        })
        candidates.push(successfulCandidateSummary({
          candidateId,
          index,
          caseItem,
          generated,
          result,
          outputDir: plan.output_dir,
        }))
      } catch (error) {
        const failed = failedCandidateSummary({ candidateId, index, caseItem, error })
        candidates.push(failed)
        if (failed.non_retryable) {
          stoppedEarly = true
          break
        }
      }
    }

    cases.push({
      id: caseItem.id,
      item_id: caseItem.item_id,
      description: caseItem.description,
      output_dir: path.relative(plan.output_dir, caseOutputDir).split(path.sep).join('/'),
      candidates,
      candidate_selection: buildCandidateSelection(candidates),
    })
    if (stoppedEarly) break
  }

  const summary = buildSummary({
    cases,
    providerBudget,
    plannedProviderCalls: plan.estimated_provider_calls,
    stoppedEarly,
  })
  const report = {
    schema_version: 1,
    mode: TWO_POINT_FIVE_D_MATERIAL_SOURCE_BENCHMARK_MODE,
    status: summary.status,
    run_id: plan.run_id,
    output_dir: plan.output_dir,
    plan,
    summary,
    cases,
    claim_boundary: 'This benchmark compares provider raw material-source candidates after local normalization, material extraction, atlas composition, validation, and export. It does not claim providers can emit final strict atlases or that arbitrary raw sources are production-ready.',
  }
  report.review = buildTwoPointFiveDMaterialSourceBenchmarkReview(report)
  const markdown = renderTwoPointFiveDMaterialSourceBenchmarkMarkdown(report)
  report.markdown = markdown
  await writeFile(path.join(plan.output_dir, 'material_source_benchmark_plan.json'), JSON.stringify(plan, null, 2))
  await writeFile(path.join(plan.output_dir, 'material_source_benchmark.json'), JSON.stringify(report, null, 2))
  await writeFile(path.join(plan.output_dir, 'material_source_benchmark.md'), markdown)
  return report
}
