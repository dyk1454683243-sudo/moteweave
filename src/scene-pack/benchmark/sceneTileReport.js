import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

function round(value, digits = 4) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

const HEAVY_STYLE_CHANGED_PIXEL_RATIO = 0.5
const DEFAULT_VISIBLE_EDGE_CHANGED_PIXEL_RATIO = 0.1

async function readJsonIfExists(dir, name) {
  const filePath = path.join(dir, name)
  if (!existsSync(filePath)) return undefined
  return JSON.parse(await readFile(filePath, 'utf8'))
}

function increment(map, key, example) {
  const entry = map.get(key) ?? { id: key, count: 0, examples: [] }
  entry.count += 1
  if (example && entry.examples.length < 3) entry.examples.push(example)
  map.set(key, entry)
}

function summarizeTaxonomy(items) {
  const categories = new Map()
  for (const item of items) {
    for (const category of item.quality_gate?.failure_taxonomy ?? []) {
      increment(categories, category.category ?? category.id, category.examples?.[0])
    }
    for (const warning of item.quality_gate?.warnings ?? []) increment(categories, warning, item.id)
    for (const error of item.quality_gate?.blocking_errors ?? []) increment(categories, error, item.id)
  }
  return [...categories.values()].sort((a, b) => b.count - a.count || a.id.localeCompare(b.id))
}

function summarizeGates(items) {
  const gates = new Map()
  for (const item of items) {
    for (const gate of item.quality_gate?.gates ?? []) {
      const entry = gates.get(gate.id) ?? { id: gate.id, pass: 0, warning: 0, fail: 0, not_run: 0, unknown: 0 }
      const status = ['pass', 'warning', 'fail', 'not_run'].includes(gate.status) ? gate.status : 'unknown'
      entry[status] += 1
      gates.set(gate.id, entry)
    }
  }
  return [...gates.values()].sort((a, b) => a.id.localeCompare(b.id))
}

function normalizeRawTilePolicy(value) {
  const policy = String(value ?? 'unknown').trim().toLowerCase()
  return ['warn', 'strict'].includes(policy) ? policy : 'unknown'
}

function itemGatePolicy(item) {
  return item.gate_policy ?? item.quality_gate?.gate_policy ?? item.generation?.gate_policy ?? null
}

function itemCorrectionPath(item) {
  const styleCorrection = item.style_correction ?? item.quality_gate?.style_correction ?? item.generation?.style_correction
  const edgeConditioning = item.edge_conditioning ?? item.quality_gate?.edge_conditioning ?? item.generation?.edge_conditioning
  const conditioningReview = item.tile_conditioning_review ?? item.generation?.tile_conditioning_review
  const steps = [
    styleCorrection ? `style:${styleCorrection.mode ?? 'present'}` : null,
    edgeConditioning?.enabled === false ? null : edgeConditioning ? `edge:${edgeConditioning.mode ?? 'present'}` : null,
  ].filter(Boolean)
  return {
    label: steps.join('+') || 'none',
    style_correction: styleCorrection
      ? {
        mode: styleCorrection.mode ?? 'present',
        output_mutation: styleCorrection.output_mutation ?? null,
        changed_pixel_ratio: styleCorrection.changed_pixel_ratio ?? null,
      }
      : null,
    edge_conditioning: edgeConditioning
      ? {
        mode: edgeConditioning.mode ?? 'present',
        enabled: edgeConditioning.enabled ?? true,
        band: edgeConditioning.band ?? null,
        changed_pixel_ratio: edgeConditioning.changed_pixel_ratio ?? null,
      }
      : null,
    raw_vs_conditioned_review: Boolean(conditioningReview),
  }
}

function numberOrNull(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function summarizeNumbers(values) {
  const numbers = values.map(numberOrNull).filter((value) => value !== null)
  if (!numbers.length) return { count: 0, min: null, average: null, max: null }
  return {
    count: numbers.length,
    min: round(Math.min(...numbers)),
    average: round(numbers.reduce((sum, value) => sum + value, 0) / numbers.length),
    max: round(Math.max(...numbers)),
  }
}

function emptyValidationCounts(extra = {}) {
  return { pass: 0, warning: 0, fail: 0, unknown: 0, ...extra }
}

function validationStatus(value) {
  return ['pass', 'warning', 'fail'].includes(value) ? value : 'unknown'
}

function incrementValidation(counts, value) {
  counts[validationStatus(value)] += 1
}

function itemTileConditioningReview(item) {
  return item.tile_conditioning_review ?? item.generation?.tile_conditioning_review ?? null
}

function itemStyleCorrectionReport(item) {
  return item.style_correction ?? item.quality_gate?.style_correction ?? item.generation?.style_correction ?? null
}

function summarizeGatePolicies(items) {
  const raw_tile_quality = { warn: 0, strict: 0, unknown: 0 }
  for (const item of items) {
    const policy = normalizeRawTilePolicy(itemGatePolicy(item)?.raw_tile_quality)
    raw_tile_quality[policy] += 1
  }
  return { raw_tile_quality }
}

function summarizeCorrectionPaths(items) {
  const paths = new Map()
  for (const item of items) {
    const pathInfo = item.correction_path ?? itemCorrectionPath(item)
    const entry = paths.get(pathInfo.label) ?? {
      label: pathInfo.label,
      count: 0,
      raw_vs_conditioned_review_count: 0,
    }
    entry.count += 1
    if (pathInfo.raw_vs_conditioned_review) entry.raw_vs_conditioned_review_count += 1
    paths.set(pathInfo.label, entry)
  }
  return [...paths.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

function summarizeCorrectionDependency(items) {
  const validationByCorrection = {
    corrected: emptyValidationCounts(),
    uncorrected: emptyValidationCounts(),
  }
  const styleRatios = []
  const styleBeforeOffPaletteRatios = []
  const styleAfterOffPaletteRatios = []
  const edgeRatios = []
  const edgeReviewStatus = emptyValidationCounts({ missing: 0 })
  let correctedItemCount = 0
  let styleSnapItemCount = 0
  let edgeConditioningItemCount = 0
  let styleAndEdgeCorrectionCount = 0
  let rawVsConditionedReviewCount = 0
  let heavyStyleMutationCount = 0
  let visibleEdgeMutationWarningCount = 0
  let edgeMutationOverReviewThresholdCount = 0

  for (const item of items) {
    const correctionPath = item.correction_path ?? itemCorrectionPath(item)
    const styleCorrection = correctionPath.style_correction
    const edgeConditioning = correctionPath.edge_conditioning
    const hasStyleCorrection = Boolean(styleCorrection)
    const hasEdgeConditioning = Boolean(edgeConditioning && edgeConditioning.enabled !== false)
    const hasCorrection = hasStyleCorrection || hasEdgeConditioning

    if (hasCorrection) correctedItemCount += 1
    if (hasStyleCorrection) styleSnapItemCount += 1
    if (hasEdgeConditioning) edgeConditioningItemCount += 1
    if (hasStyleCorrection && hasEdgeConditioning) styleAndEdgeCorrectionCount += 1
    if (correctionPath.raw_vs_conditioned_review) rawVsConditionedReviewCount += 1

    incrementValidation(
      hasCorrection ? validationByCorrection.corrected : validationByCorrection.uncorrected,
      item.quality_gate?.status
    )

    const styleRatio = numberOrNull(styleCorrection?.changed_pixel_ratio)
    if (styleRatio !== null) {
      styleRatios.push(styleRatio)
      if (styleRatio >= HEAVY_STYLE_CHANGED_PIXEL_RATIO) heavyStyleMutationCount += 1
    }
    const styleCorrectionReport = itemStyleCorrectionReport(item)
    const beforeOffPaletteRatio = numberOrNull(styleCorrectionReport?.metrics?.before?.off_palette_ratio)
    if (beforeOffPaletteRatio !== null) styleBeforeOffPaletteRatios.push(beforeOffPaletteRatio)
    const afterOffPaletteRatio = numberOrNull(styleCorrectionReport?.metrics?.after?.off_palette_ratio)
    if (afterOffPaletteRatio !== null) styleAfterOffPaletteRatios.push(afterOffPaletteRatio)

    const edgeRatio = numberOrNull(edgeConditioning?.changed_pixel_ratio)
    if (edgeRatio !== null) edgeRatios.push(edgeRatio)

    if (hasEdgeConditioning) {
      const review = itemTileConditioningReview(item)
      if (!review) {
        edgeReviewStatus.missing += 1
      } else {
        incrementValidation(edgeReviewStatus, review.status)
        if ((review.warnings ?? []).includes('tile.edge_conditioning_visible_mutation')) {
          visibleEdgeMutationWarningCount += 1
        }
        const reviewRatio = numberOrNull(review.metrics?.changed_pixel_ratio)
        const reviewThreshold = numberOrNull(review.thresholds?.max_changed_pixel_ratio)
        if (reviewRatio !== null && reviewThreshold !== null && reviewRatio > reviewThreshold) {
          edgeMutationOverReviewThresholdCount += 1
        }
      }
    }
  }

  const signals = []
  if (items.length && correctedItemCount === items.length) signals.push('all_items_use_correction')
  if (heavyStyleMutationCount > 0) signals.push('style_snap_heavy_mutation')
  if (visibleEdgeMutationWarningCount > 0) signals.push('edge_conditioning_visible_mutation')
  if (edgeConditioningItemCount > rawVsConditionedReviewCount) signals.push('missing_raw_vs_conditioned_review')

  let dependencyLevel = 'unknown'
  if (items.length) {
    if (correctedItemCount === 0) dependencyLevel = 'low'
    else if (heavyStyleMutationCount > 0 || visibleEdgeMutationWarningCount > 0) dependencyLevel = 'high'
    else dependencyLevel = 'medium'
  }

  return {
    dependency_level: dependencyLevel,
    thresholds: {
      heavy_style_changed_pixel_ratio: HEAVY_STYLE_CHANGED_PIXEL_RATIO,
      visible_edge_changed_pixel_ratio: DEFAULT_VISIBLE_EDGE_CHANGED_PIXEL_RATIO,
    },
    corrected_item_count: correctedItemCount,
    uncorrected_item_count: items.length - correctedItemCount,
    style_and_edge_correction_count: styleAndEdgeCorrectionCount,
    raw_vs_conditioned_review_count: rawVsConditionedReviewCount,
    validation_by_correction: validationByCorrection,
    style_snap: {
      item_count: styleSnapItemCount,
      heavy_mutation_count: heavyStyleMutationCount,
      changed_pixel_ratio: summarizeNumbers(styleRatios),
      before_off_palette_ratio: summarizeNumbers(styleBeforeOffPaletteRatios),
      after_off_palette_ratio: summarizeNumbers(styleAfterOffPaletteRatios),
    },
    edge_conditioning: {
      item_count: edgeConditioningItemCount,
      visible_mutation_warning_count: visibleEdgeMutationWarningCount,
      over_review_threshold_count: edgeMutationOverReviewThresholdCount,
      changed_pixel_ratio: summarizeNumbers(edgeRatios),
      review_status: edgeReviewStatus,
    },
    signals,
  }
}

function summarizeCandidateTaxonomy(items) {
  const categories = new Map()
  for (const item of items) {
    for (const candidate of item.candidate_selection?.ranking ?? []) {
      if (candidate.status !== 'fail') continue
      for (const category of candidate.failure_taxonomy ?? []) {
        increment(categories, category.category ?? category.id, category.examples?.[0] ?? candidate.id)
      }
      for (const error of candidate.blocking_errors ?? []) increment(categories, error, candidate.id)
      for (const warning of candidate.warnings ?? []) increment(categories, warning, candidate.id)
    }
  }
  return [...categories.values()].sort((a, b) => b.count - a.count || a.id.localeCompare(b.id))
}

function summarizeCandidateSelection(items) {
  const selected_status = { pass: 0, warning: 0, fail: 0, unknown: 0 }
  let cases_with_candidates = 0
  let total_candidates = 0
  let failed_candidate_count = 0
  for (const item of items) {
    const selection = item.candidate_selection
    if (!selection) continue
    cases_with_candidates += 1
    total_candidates += Number(selection.candidate_count ?? selection.ranking?.length ?? 0)
    const status = ['pass', 'warning', 'fail'].includes(selection.selected_status)
      ? selection.selected_status
      : 'unknown'
    selected_status[status] += 1
    failed_candidate_count += (selection.ranking ?? []).filter((candidate) => candidate.status === 'fail').length
  }
  return {
    cases_with_candidates,
    total_candidates,
    average_candidates_per_case: cases_with_candidates ? round(total_candidates / cases_with_candidates) : 0,
    failed_candidate_count,
    selected_status,
    failed_candidate_taxonomy: {
      top_categories: summarizeCandidateTaxonomy(items),
    },
  }
}

export function summarizeSceneTileReportItems(items = []) {
  const validation = { pass: 0, warning: 0, fail: 0, unknown: 0 }
  for (const item of items) {
    const status = item.quality_gate?.status
    if (status === 'pass') validation.pass += 1
    else if (status === 'warning') validation.warning += 1
    else if (status === 'fail') validation.fail += 1
    else validation.unknown += 1
  }
  const total = items.length
  return {
    total,
    sample_size: total,
    validation,
    pass_rate: total ? round(validation.pass / total) : 0,
    usable_rate: total ? round((validation.pass + validation.warning) / total) : 0,
    gates: summarizeGates(items),
    gate_policy: summarizeGatePolicies(items),
    correction_paths: summarizeCorrectionPaths(items),
    correction_dependency: summarizeCorrectionDependency(items),
    candidate_selection: summarizeCandidateSelection(items),
    failure_taxonomy: {
      top_categories: summarizeTaxonomy(items),
    },
  }
}

function markdownValue(value) {
  return value === null || value === undefined ? 'n/a' : value
}

function markdownForReport(report) {
  const dependency = report.summary.correction_dependency
  const lines = [
    `# Scene Tile Report: ${report.run_id}`,
    '',
    `- Total: ${report.summary.total}`,
    `- Sample size: ${report.summary.sample_size}`,
    `- Pass rate: ${report.summary.pass_rate}`,
    `- Usable rate: ${report.summary.usable_rate}`,
    `- Validation: pass=${report.summary.validation.pass}, warning=${report.summary.validation.warning}, fail=${report.summary.validation.fail}, unknown=${report.summary.validation.unknown}`,
    `- Raw tile policy: warn=${report.summary.gate_policy.raw_tile_quality.warn}, strict=${report.summary.gate_policy.raw_tile_quality.strict}, unknown=${report.summary.gate_policy.raw_tile_quality.unknown}`,
    `- Candidate selection: cases=${report.summary.candidate_selection.cases_with_candidates}, total_candidates=${report.summary.candidate_selection.total_candidates}, avg=${report.summary.candidate_selection.average_candidates_per_case}`,
    '',
    '## Gates',
    '',
    '| Gate | Pass | Warning | Fail | Not run | Unknown |',
    '|---|---:|---:|---:|---:|---:|',
    ...report.summary.gates.map((gate) => `| ${gate.id} | ${gate.pass} | ${gate.warning} | ${gate.fail} | ${gate.not_run} | ${gate.unknown} |`),
    '',
    '## Correction Paths',
    '',
    '| Path | Count | Raw-vs-conditioned reviews |',
    '|---|---:|---:|',
    ...report.summary.correction_paths.map((item) => `| ${item.label} | ${item.count} | ${item.raw_vs_conditioned_review_count} |`),
    '',
    '## Correction Dependency',
    '',
    `- Dependency level: ${dependency.dependency_level}`,
    `- Signals: ${dependency.signals.join(', ') || 'none'}`,
    '',
    '| Metric | Value |',
    '|---|---:|',
    `| Corrected items | ${dependency.corrected_item_count} |`,
    `| Uncorrected items | ${dependency.uncorrected_item_count} |`,
    `| Style snap items | ${dependency.style_snap.item_count} |`,
    `| Style snap avg changed-pixel ratio | ${markdownValue(dependency.style_snap.changed_pixel_ratio.average)} |`,
    `| Heavy style mutations | ${dependency.style_snap.heavy_mutation_count} |`,
    `| Edge-conditioned items | ${dependency.edge_conditioning.item_count} |`,
    `| Edge avg changed-pixel ratio | ${markdownValue(dependency.edge_conditioning.changed_pixel_ratio.average)} |`,
    `| Edge visible mutation warnings | ${dependency.edge_conditioning.visible_mutation_warning_count} |`,
    `| Raw-vs-conditioned reviews | ${dependency.raw_vs_conditioned_review_count} |`,
    '',
    '## Candidate Selection',
    '',
    '| Case | Candidates | Selected | Reason |',
    '|---|---:|---|---|',
    ...report.items.map((item) => `| ${item.id} | ${item.candidate_selection?.candidate_count ?? 0} | ${item.candidate_selection?.selected_candidate_id ?? 'none'} (${item.candidate_selection?.selected_status ?? 'unknown'}) | ${item.candidate_selection?.selection_reason ?? ''} |`),
    '',
    '### Failed Candidate Taxonomy',
    '',
    '| Category | Count | Examples |',
    '|---|---:|---|',
    ...report.summary.candidate_selection.failed_candidate_taxonomy.top_categories.map((item) => `| ${item.id} | ${item.count} | ${item.examples.join(', ')} |`),
    '',
    '## Top Taxonomy',
    '',
    '| Category | Count | Examples |',
    '|---|---:|---|',
    ...report.summary.failure_taxonomy.top_categories.map((item) => `| ${item.id} | ${item.count} | ${item.examples.join(', ')} |`),
    '',
    '## Items',
    '',
    '| Item | Status | Candidates | Raw Policy | Corrections | Warnings | Blocking Errors |',
    '|---|---|---:|---|---|---|---|',
    ...report.items.map((item) => `| ${item.id} | ${item.quality_gate?.status ?? 'unknown'} | ${item.candidate_selection?.candidate_count ?? 0} | ${item.gate_policy?.raw_tile_quality ?? 'unknown'} | ${item.correction_path?.label ?? 'none'} | ${(item.quality_gate?.warnings ?? []).join(', ')} | ${(item.quality_gate?.blocking_errors ?? []).join(', ')} |`),
    '',
  ]
  return lines.join('\n')
}

export async function loadSceneTileReportItemFromDir(dir) {
  const qualityGate = await readJsonIfExists(dir, 'quality_gate.json')
  const scene = await readJsonIfExists(dir, 'scene.json')
  const generation = await readJsonIfExists(dir, 'generation.json')
  const styleCorrection = await readJsonIfExists(dir, 'style_correction.json')
  const edgeConditioning = await readJsonIfExists(dir, 'edge_conditioning.json')
  const tileConditioningReview = await readJsonIfExists(dir, 'tile_conditioning_review.json')
  const candidateSelection = await readJsonIfExists(dir, 'candidate_selection.json')
  const item = {
    id: path.basename(dir),
    dir,
    profile: qualityGate?.profile ?? scene?.profile ?? null,
    mode: generation?.mode ?? 'artifact_dir',
    quality_gate: qualityGate,
    generation,
    style_correction: styleCorrection,
    edge_conditioning: edgeConditioning,
    tile_conditioning_review: tileConditioningReview,
    candidate_selection: candidateSelection,
  }
  return {
    ...item,
    gate_policy: itemGatePolicy(item) ?? { raw_tile_quality: 'unknown' },
    correction_path: itemCorrectionPath(item),
  }
}

export async function buildSceneTileReport({ sceneDirs = [], runId = 'scene_tile_report' } = {}) {
  const items = []
  for (const dir of sceneDirs) {
    const item = await loadSceneTileReportItemFromDir(String(dir))
    if (!item.quality_gate) {
      items.push({
        ...item,
        quality_gate: {
          status: 'unknown',
        warnings: ['missing_quality_gate'],
        blocking_errors: [],
        gates: [],
        failure_taxonomy: [{ category: 'artifact.missing_quality_gate', count: 1, examples: [item.id] }],
      },
      gate_policy: item.gate_policy ?? { raw_tile_quality: 'unknown' },
      correction_path: item.correction_path ?? itemCorrectionPath(item),
    })
    } else {
      items.push(item)
    }
  }
  const report = {
    schema_version: 1,
    run_id: runId,
    created_at: new Date().toISOString(),
    items,
    summary: summarizeSceneTileReportItems(items),
  }
  return {
    ...report,
    markdown: markdownForReport(report),
  }
}

export async function writeSceneTileReport({ sceneDirs = [], outputDir, runId = 'scene_tile_report' } = {}) {
  if (!outputDir) throw new Error('outputDir is required')
  const report = await buildSceneTileReport({ sceneDirs, runId })
  const runDir = path.join(outputDir, report.run_id)
  await mkdir(runDir, { recursive: true })
  await writeFile(path.join(runDir, 'scene_tile_report.json'), JSON.stringify(report, null, 2))
  await writeFile(path.join(runDir, 'scene_tile_report.md'), report.markdown)
  return {
    ...report,
    output_dir: runDir,
  }
}
