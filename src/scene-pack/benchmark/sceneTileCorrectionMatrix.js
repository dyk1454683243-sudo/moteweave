import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { encodeRgbaPng, loadRgba } from '../../character-pack/imageCodec.js'
import { applyPixelStyleCorrection } from '../../character-pack/stylePipeline.js'
import { writeScenePackArtifacts } from '../artifactWriter.js'
import {
  buildTileConditioningReview,
  renderTileConditioningContactSheet,
} from '../tileConditioningReview.js'
import { conditionTileSheetEdges } from '../tileEdgeConditioning.js'
import { buildScenePackFromTileSheet } from '../tileSheetIngestion.js'
import { buildSceneTileReport } from './sceneTileReport.js'

const DEFAULT_VARIANTS = Object.freeze([
  { id: 'raw', label: 'Raw', style: false, edge: false },
  { id: 'style_snap', label: 'Style Snap', style: true, edge: false },
  { id: 'style_snap_edge_aware', label: 'Style Snap + Edge Aware', style: true, edge: true },
])

const STATUS_RANK = Object.freeze({
  unknown: 0,
  not_run: 0,
  fail: 1,
  warning: 2,
  pass: 3,
})

function round(value, digits = 4) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function safePathSegment(value, fallback = 'scene') {
  return (
    String(value ?? fallback)
      .replace(/[^a-zA-Z0-9._-]+/g, '_')
      .replace(/^\.+/, '')
      .replace(/\.+$/, '') || fallback
  )
}

function normalizeStatus(value) {
  return ['pass', 'warning', 'fail'].includes(value) ? value : 'unknown'
}

function normalizeGateStatus(value) {
  return ['pass', 'warning', 'fail', 'not_run'].includes(value) ? value : 'unknown'
}

function incrementStatus(counts, status) {
  counts[normalizeStatus(status)] += 1
}

function statusCounts() {
  return { pass: 0, warning: 0, fail: 0, unknown: 0 }
}

function compareStatuses(fromStatus, toStatus) {
  const from = STATUS_RANK[normalizeGateStatus(fromStatus)]
  const to = STATUS_RANK[normalizeGateStatus(toStatus)]
  if (to > from) return 'improved'
  if (to < from) return 'regressed'
  return 'same'
}

function transitionCounts() {
  return { improved: 0, same: 0, regressed: 0, missing: 0 }
}

function incrementTransition(counts, fromStatus, toStatus) {
  if (!fromStatus || !toStatus) {
    counts.missing += 1
    return
  }
  counts[compareStatuses(fromStatus, toStatus)] += 1
}

function numericMetric(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function summarizeNumbers(values) {
  const numbers = values.map(numericMetric).filter((value) => value !== null)
  if (!numbers.length) return { count: 0, min: null, average: null, max: null }
  return {
    count: numbers.length,
    min: round(Math.min(...numbers)),
    average: round(numbers.reduce((sum, value) => sum + value, 0) / numbers.length),
    max: round(Math.max(...numbers)),
  }
}

function incrementCategory(map, key, example) {
  const entry = map.get(key) ?? { id: key, count: 0, examples: [] }
  entry.count += 1
  if (example && entry.examples.length < 3) entry.examples.push(example)
  map.set(key, entry)
}

function sortedCategories(map) {
  return [...map.values()].sort((a, b) => b.count - a.count || a.id.localeCompare(b.id))
}

function normalizeInputs(inputs = []) {
  const samples = inputs.map((input, index) => {
    const file = typeof input === 'string' ? input : input.file
    if (!file) throw new Error('scene tile correction matrix input requires a file')
    const fallbackId = path.basename(String(file), path.extname(String(file))) || `sample_${index + 1}`
    return {
      file: String(file),
      id: safePathSegment(typeof input === 'string' ? fallbackId : input.id ?? fallbackId, `sample_${index + 1}`),
      index,
    }
  })
  if (!samples.length) throw new Error('scene tile correction matrix requires at least one input')
  const seen = new Map()
  return samples.map((sample) => {
    const count = (seen.get(sample.id) ?? 0) + 1
    seen.set(sample.id, count)
    return {
      ...sample,
      id: count === 1 ? sample.id : `${sample.id}_${count}`,
    }
  })
}

function defaultStyleCorrection(options = {}) {
  return {
    mode: 'palette_snap',
    maxColors: Number(options.styleMaxColors ?? options.maxColors ?? 16),
  }
}

function defaultEdgeConditioning(options = {}) {
  return {
    enabled: true,
    band: Number(options.edgeBand ?? options.band ?? 3),
    mode: options.edgeMode ?? options.mode ?? 'edge-aware-v1',
  }
}

async function attachTileConditioningReview(result, conditioned) {
  if (!conditioned?.report?.enabled) return result
  const review = buildTileConditioningReview({
    rawTiles: conditioned.rawTiles,
    conditionedTiles: conditioned.tiles,
    edgeConditioning: conditioned.report,
    qualityGate: result.qualityGate,
  })
  return {
    ...result,
    tileConditioningReview: review,
    files: {
      ...(result.files ?? {}),
      tileConditioningReviewPng: await encodeRgbaPng(renderTileConditioningContactSheet({
        rawTiles: conditioned.rawTiles,
        conditionedTiles: conditioned.tiles,
      })),
    },
  }
}

async function buildVariantResult({
  source,
  sample,
  variant,
  options,
}) {
  let sourceForIngestion = source
  let styleCorrectionReport
  let conditioned
  const styleOptions = options.styleCorrection ?? defaultStyleCorrection(options)
  const edgeOptions = options.edgeConditioning ?? defaultEdgeConditioning(options)

  if (variant.style) {
    const corrected = applyPixelStyleCorrection(sourceForIngestion, styleOptions)
    sourceForIngestion = corrected.image
    styleCorrectionReport = corrected.report
  }

  if (variant.edge) {
    conditioned = conditionTileSheetEdges(sourceForIngestion, edgeOptions)
    sourceForIngestion = conditioned.source
  }

  const result = buildScenePackFromTileSheet({
    source: sourceForIngestion,
    tilesetPng: await encodeRgbaPng(sourceForIngestion),
    projectId: options.projectId ?? 'scene_tile_correction_matrix',
    identifier: `${sample.id}_${variant.id}`,
    width: options.width ?? 3,
    height: options.height ?? 3,
    pattern: options.pattern ?? 'rule',
    seed: Number(options.seed ?? 7) + sample.index,
    density: options.density ?? 0.55,
    tilesetRelPath: 'tileset.png',
    gatePolicy: options.gatePolicy ?? { raw_tile_quality: 'strict' },
    styleCorrectionReport,
    edgeConditioningReport: conditioned?.report,
  })

  return attachTileConditioningReview({
    ...result,
    files: {
      ...(result.files ?? {}),
      generationJson: {
        schema_version: 1,
        mode: 'scene_tile_correction_matrix_variant_v0',
        sample_id: sample.id,
        source_file: sample.file,
        variant_id: variant.id,
        variant_label: variant.label,
        gate_policy: options.gatePolicy ?? { raw_tile_quality: 'strict' },
        style_correction: styleCorrectionReport ?? null,
        edge_conditioning: conditioned?.report ?? null,
      },
    },
  }, conditioned)
}

function itemMetrics(item) {
  const issueCategories = new Set([
    ...(item.quality_gate?.blocking_errors ?? []),
    ...(item.quality_gate?.warnings ?? []),
    ...(item.quality_gate?.failure_taxonomy ?? []).map((category) => category.category ?? category.id).filter(Boolean),
  ])
  return {
    status: normalizeStatus(item.quality_gate?.status),
    warnings: item.quality_gate?.warnings ?? [],
    blocking_errors: item.quality_gate?.blocking_errors ?? [],
    issue_categories: [...issueCategories].sort(),
    gate_statuses: Object.fromEntries((item.quality_gate?.gates ?? []).map((gate) => [gate.id, normalizeGateStatus(gate.status)])),
    style_changed_pixel_ratio: numericMetric(item.style_correction?.changed_pixel_ratio),
    edge_changed_pixel_ratio: numericMetric(item.edge_conditioning?.changed_pixel_ratio),
    tile_conditioning_status: item.tile_conditioning_review?.status ?? null,
    tile_conditioning_warnings: item.tile_conditioning_review?.warnings ?? [],
  }
}

function buildVariantIssueTaxonomy(items) {
  const byVariant = new Map(DEFAULT_VARIANTS.map((variant) => [variant.id, new Map()]))
  for (const item of items) {
    const categories = byVariant.get(item.variant_id)
    if (!categories) continue
    for (const category of itemMetrics(item).issue_categories) {
      incrementCategory(categories, category, item.sample_id)
    }
  }
  return DEFAULT_VARIANTS.map((variant) => ({
    variant_id: variant.id,
    label: variant.label,
    top_categories: sortedCategories(byVariant.get(variant.id) ?? new Map()),
  }))
}

function issueTransitionCounts() {
  return { resolved: 0, persisted: 0, introduced: 0, absent: 0, missing: 0 }
}

function summarizeIssueTransitions(samples) {
  const pairs = {
    raw_to_style_snap: ['raw', 'style_snap'],
    style_snap_to_style_snap_edge_aware: ['style_snap', 'style_snap_edge_aware'],
    raw_to_style_snap_edge_aware: ['raw', 'style_snap_edge_aware'],
  }
  const result = {}
  for (const [id, [fromVariant, toVariant]] of Object.entries(pairs)) {
    const categories = new Map()
    for (const sample of samples) {
      const from = sample.variants[fromVariant]
      const to = sample.variants[toVariant]
      if (!from || !to) continue
      for (const category of new Set([...(from.issue_categories ?? []), ...(to.issue_categories ?? [])])) {
        const entry = categories.get(category) ?? { id: category, ...issueTransitionCounts(), examples: [] }
        const fromHas = from.issue_categories.includes(category)
        const toHas = to.issue_categories.includes(category)
        if (fromHas && toHas) entry.persisted += 1
        else if (fromHas && !toHas) entry.resolved += 1
        else if (!fromHas && toHas) entry.introduced += 1
        else entry.absent += 1
        if ((fromHas || toHas) && entry.examples.length < 3) entry.examples.push(sample.sample_id)
        categories.set(category, entry)
      }
    }
    result[id] = [...categories.values()].sort((a, b) => {
      const weightA = b.resolved - a.resolved
      if (weightA) return weightA
      const persisted = b.persisted - a.persisted
      if (persisted) return persisted
      return a.id.localeCompare(b.id)
    })
  }
  return result
}

function gateTransitionCounts() {
  return { improved: 0, same: 0, regressed: 0, missing: 0 }
}

function summarizeGateTransitions(samples) {
  const pairs = {
    raw_to_style_snap: ['raw', 'style_snap'],
    style_snap_to_style_snap_edge_aware: ['style_snap', 'style_snap_edge_aware'],
    raw_to_style_snap_edge_aware: ['raw', 'style_snap_edge_aware'],
  }
  const result = {}
  for (const [id, [fromVariant, toVariant]] of Object.entries(pairs)) {
    const gates = new Map()
    for (const sample of samples) {
      const from = sample.variants[fromVariant]
      const to = sample.variants[toVariant]
      const gateIds = new Set([
        ...Object.keys(from?.gate_statuses ?? {}),
        ...Object.keys(to?.gate_statuses ?? {}),
      ])
      for (const gateId of gateIds) {
        const entry = gates.get(gateId) ?? { id: gateId, ...gateTransitionCounts() }
        const fromStatus = from?.gate_statuses?.[gateId]
        const toStatus = to?.gate_statuses?.[gateId]
        if (!fromStatus || !toStatus) entry.missing += 1
        else entry[compareStatuses(fromStatus, toStatus)] += 1
        gates.set(gateId, entry)
      }
    }
    result[id] = [...gates.values()].sort((a, b) => b.improved - a.improved || b.regressed - a.regressed || a.id.localeCompare(b.id))
  }
  return result
}

function buildRawQualityReadiness({ byVariant, blockerTaxonomyByVariant, gateTransitions }) {
  const raw = byVariant.find((variant) => variant.id === 'raw')
  const rawBlockers = blockerTaxonomyByVariant.find((item) => item.variant_id === 'raw')?.top_categories ?? []
  const rawGateTransitions = gateTransitions.raw_to_style_snap_edge_aware ?? []
  const blockers = []

  if (!raw || raw.validation.fail > 0 || raw.validation.warning > 0 || raw.validation.unknown > 0) {
    blockers.push('raw_variant_failures')
  }
  if (rawBlockers.some((item) => item.id === 'tile.source_atlas_continuity')) {
    blockers.push('raw_source_atlas_continuity')
  }
  if (rawBlockers.some((item) => item.id === 'tile.visual_seam_mismatch')) {
    blockers.push('raw_visual_seam_failures')
  }
  if (rawBlockers.some((item) => item.id === 'tile.self_loop_mismatch')) {
    blockers.push('raw_self_loop_failures')
  }
  if (rawGateTransitions.some((gate) => gate.id === 'visual_seams' && gate.improved > 0)) {
    blockers.push('correction_masks_visual_seams')
  }
  if (rawGateTransitions.some((gate) => gate.id === 'tile_self_loops' && gate.improved > 0)) {
    blockers.push('correction_masks_self_loops')
  }

  return {
    status: blockers.length ? 'not_ready' : 'ready',
    blockers,
    raw_validation: raw?.validation ?? { pass: 0, warning: 0, fail: 0, unknown: 0 },
  }
}

function gateById(item, id) {
  return item.quality_gate?.gates?.find((gate) => gate.id === id) ?? null
}

function buildRawQualityDiagnostics(items) {
  const rawItems = items.filter((item) => item.variant_id === 'raw')
  const perSample = []
  const visualSeams = []
  const selfLoops = []
  const sourceAtlasContinuities = []
  const duplicateTilePairs = []

  for (const item of rawItems) {
    const visualGate = gateById(item, 'visual_seams')
    const selfLoopGate = gateById(item, 'tile_self_loops')
    const sourceGate = gateById(item, 'source_atlas_structure')
    const distinctnessGate = gateById(item, 'tile_distinctness')
    const failedPairs = visualGate?.details?.failed_pairs ?? []
    const failedTiles = selfLoopGate?.details?.failed_tiles ?? []
    const continuousBoundaries = sourceGate?.details?.continuous_boundaries ?? []
    const duplicatePairs = distinctnessGate?.details?.duplicate_pairs ?? []

    for (const pair of failedPairs) visualSeams.push({ sample_id: item.sample_id, ...pair })
    for (const tile of failedTiles) selfLoops.push({ sample_id: item.sample_id, ...tile })
    for (const boundary of continuousBoundaries) sourceAtlasContinuities.push({ sample_id: item.sample_id, ...boundary })
    for (const pair of duplicatePairs) duplicateTilePairs.push({ sample_id: item.sample_id, ...pair })

    perSample.push({
      sample_id: item.sample_id,
      status: normalizeStatus(item.quality_gate?.status),
      visual_seam_failure_count: failedPairs.length,
      self_loop_failure_count: failedTiles.length,
      source_atlas_continuity_count: continuousBoundaries.length,
      duplicate_runtime_tile_pair_count: duplicatePairs.length,
      max_visual_seam_delta: visualGate?.observed?.max_edge_delta ?? 0,
      max_self_loop_delta: selfLoopGate?.observed?.max_edge_delta ?? 0,
      continuous_source_boundary_ids: continuousBoundaries.slice(0, 8).map((boundary) => boundary.id),
    })
  }

  const issueCounts = {
    visual_seam_failures: visualSeams.length,
    self_loop_failures: selfLoops.length,
    source_atlas_continuities: sourceAtlasContinuities.length,
    duplicate_runtime_tile_pairs: duplicateTilePairs.length,
  }

  return {
    schema_version: 1,
    status: Object.values(issueCounts).some((count) => count > 0) ? 'fail' : 'pass',
    sample_count: rawItems.length,
    issue_counts: issueCounts,
    per_sample: perSample.sort((a, b) => a.sample_id.localeCompare(b.sample_id)),
    worst_visual_seams: visualSeams.sort((a, b) => b.average_delta - a.average_delta).slice(0, 12),
    worst_self_loops: selfLoops.sort((a, b) => b.average_delta - a.average_delta).slice(0, 12),
    continuous_source_boundaries: sourceAtlasContinuities.slice(0, 24),
    duplicate_runtime_tile_pairs: duplicateTilePairs.slice(0, 24),
  }
}

function summarizeMatrixItems({ items, report }) {
  const byVariantMap = new Map(DEFAULT_VARIANTS.map((variant) => [variant.id, {
    id: variant.id,
    label: variant.label,
    validation: statusCounts(),
    style_changed_pixel_ratio: [],
    edge_changed_pixel_ratio: [],
    tile_conditioning_review: statusCounts(),
    tile_conditioning_review_missing: 0,
  }]))
  const bySample = new Map()

  for (const item of items) {
    const metrics = itemMetrics(item)
    const variant = byVariantMap.get(item.variant_id)
    if (variant) {
      incrementStatus(variant.validation, metrics.status)
      if (metrics.style_changed_pixel_ratio !== null) {
        variant.style_changed_pixel_ratio.push(metrics.style_changed_pixel_ratio)
      }
      if (metrics.edge_changed_pixel_ratio !== null) {
        variant.edge_changed_pixel_ratio.push(metrics.edge_changed_pixel_ratio)
      }
      if (metrics.tile_conditioning_status) {
        incrementStatus(variant.tile_conditioning_review, metrics.tile_conditioning_status)
      } else {
        variant.tile_conditioning_review_missing += 1
      }
    }
    const sample = bySample.get(item.sample_id) ?? {
      sample_id: item.sample_id,
      source_file: item.source_file,
      variants: {},
    }
    sample.variants[item.variant_id] = metrics
    bySample.set(item.sample_id, sample)
  }

  const transitions = {
    raw_to_style_snap: transitionCounts(),
    style_snap_to_style_snap_edge_aware: transitionCounts(),
    raw_to_style_snap_edge_aware: transitionCounts(),
  }

  for (const sample of bySample.values()) {
    incrementTransition(
      transitions.raw_to_style_snap,
      sample.variants.raw?.status,
      sample.variants.style_snap?.status
    )
    incrementTransition(
      transitions.style_snap_to_style_snap_edge_aware,
      sample.variants.style_snap?.status,
      sample.variants.style_snap_edge_aware?.status
    )
    incrementTransition(
      transitions.raw_to_style_snap_edge_aware,
      sample.variants.raw?.status,
      sample.variants.style_snap_edge_aware?.status
    )
  }

  const byVariant = [...byVariantMap.values()].map((variant) => ({
    ...variant,
    style_changed_pixel_ratio: summarizeNumbers(variant.style_changed_pixel_ratio),
    edge_changed_pixel_ratio: summarizeNumbers(variant.edge_changed_pixel_ratio),
  }))
  const gateTransitions = summarizeGateTransitions([...bySample.values()])
  const blockerTaxonomyByVariant = buildVariantIssueTaxonomy(items)
  const blockerTransitions = summarizeIssueTransitions([...bySample.values()])

  return {
    input_count: bySample.size,
    variant_count: DEFAULT_VARIANTS.length,
    total_items: items.length,
    by_variant: byVariant,
    transitions,
    gate_transitions: gateTransitions,
    blocker_taxonomy_by_variant: blockerTaxonomyByVariant,
    blocker_transitions: blockerTransitions,
    raw_quality_readiness: buildRawQualityReadiness({
      byVariant,
      blockerTaxonomyByVariant,
      gateTransitions,
    }),
    raw_quality_diagnostics: buildRawQualityDiagnostics(items),
    correction_dependency: report.summary.correction_dependency,
  }
}

function markdownForMatrix(matrix) {
  const lines = [
    `# Scene Tile Correction Matrix: ${matrix.run_id}`,
    '',
    `- Inputs: ${matrix.summary.input_count}`,
    `- Variants: ${matrix.summary.variant_count}`,
    `- Total items: ${matrix.summary.total_items}`,
    `- Correction dependency: ${matrix.summary.correction_dependency.dependency_level}`,
    `- Signals: ${matrix.summary.correction_dependency.signals.join(', ') || 'none'}`,
    `- Raw quality readiness: ${matrix.summary.raw_quality_readiness.status}`,
    `- Raw readiness blockers: ${matrix.summary.raw_quality_readiness.blockers.join(', ') || 'none'}`,
    '',
    '## Variant Summary',
    '',
    '| Variant | Pass | Warning | Fail | Unknown | Style avg changed | Edge avg changed | Review warnings |',
    '|---|---:|---:|---:|---:|---:|---:|---:|',
    ...matrix.summary.by_variant.map((variant) => (
      `| ${variant.id} | ${variant.validation.pass} | ${variant.validation.warning} | ${variant.validation.fail} | ${variant.validation.unknown} | ${variant.style_changed_pixel_ratio.average ?? 'n/a'} | ${variant.edge_changed_pixel_ratio.average ?? 'n/a'} | ${variant.tile_conditioning_review.warning} |`
    )),
    '',
    '## Transitions',
    '',
    '| Transition | Improved | Same | Regressed | Missing |',
    '|---|---:|---:|---:|---:|',
    ...Object.entries(matrix.summary.transitions).map(([id, counts]) => (
      `| ${id} | ${counts.improved} | ${counts.same} | ${counts.regressed} | ${counts.missing} |`
    )),
    '',
    '## Raw Blockers',
    '',
    '| Category | Count | Examples |',
    '|---|---:|---|',
    ...(matrix.summary.blocker_taxonomy_by_variant.find((item) => item.variant_id === 'raw')?.top_categories ?? [])
      .map((item) => `| ${item.id} | ${item.count} | ${item.examples.join(', ')} |`),
    '',
    '## Raw Diagnostics',
    '',
    '| Sample | Status | Visual seam failures | Self-loop failures | Source-atlas continuities | Duplicate runtime tile pairs | Max visual seam delta | Max self-loop delta |',
    '|---|---|---:|---:|---:|---:|---:|---:|',
    ...matrix.summary.raw_quality_diagnostics.per_sample.map((item) => (
      `| ${item.sample_id} | ${item.status} | ${item.visual_seam_failure_count} | ${item.self_loop_failure_count} | ${item.source_atlas_continuity_count} | ${item.duplicate_runtime_tile_pair_count} | ${item.max_visual_seam_delta} | ${item.max_self_loop_delta} |`
    )),
    '',
    '## Gate Transitions',
    '',
    '| Transition | Gate | Improved | Same | Regressed | Missing |',
    '|---|---|---:|---:|---:|---:|',
    ...Object.entries(matrix.summary.gate_transitions).flatMap(([id, gates]) => (
      gates.map((gate) => `| ${id} | ${gate.id} | ${gate.improved} | ${gate.same} | ${gate.regressed} | ${gate.missing} |`)
    )),
    '',
    '## Samples',
    '',
    '| Sample | Raw | Style Snap | Style + Edge |',
    '|---|---|---|---|',
    ...matrix.samples.map((sample) => (
      `| ${sample.sample_id} | ${sample.variants.raw?.status ?? 'missing'} | ${sample.variants.style_snap?.status ?? 'missing'} | ${sample.variants.style_snap_edge_aware?.status ?? 'missing'} |`
    )),
    '',
  ]
  return lines.join('\n')
}

export async function runSceneTileCorrectionMatrix({
  inputs = [],
  outputDir = 'generated/scene-tile-correction-matrix',
  runId = 'scene_tile_correction_matrix',
  ...options
} = {}) {
  const samples = normalizeInputs(inputs)
  const runDir = path.join(outputDir, runId)
  const itemOutputDir = path.join(runDir, 'items')
  await mkdir(itemOutputDir, { recursive: true })

  const items = []
  const sceneDirs = []

  for (const sample of samples) {
    const inputBuffer = await readFile(sample.file)
    const source = await loadRgba(inputBuffer)
    for (const variant of DEFAULT_VARIANTS) {
      const result = await buildVariantResult({ source, sample, variant, options })
      const jobId = `${sample.id}_${variant.id}`
      const written = await writeScenePackArtifacts({ jobId, outputDir: itemOutputDir, result })
      sceneDirs.push(written.dir)
      items.push({
        sample_id: sample.id,
        source_file: sample.file,
        variant_id: variant.id,
        variant_label: variant.label,
        output_dir: written.dir,
        artifact_status: written.status,
        urls: written.urls,
        quality_gate: result.qualityGate,
        style_correction: result.styleCorrection ?? null,
        edge_conditioning: result.edgeConditioning ?? null,
        tile_conditioning_review: result.tileConditioningReview ?? null,
      })
    }
  }

  const report = await buildSceneTileReport({ sceneDirs, runId })
  const samplesSummary = [...new Map(items.map((item) => [item.sample_id, {
    sample_id: item.sample_id,
    source_file: item.source_file,
    variants: {},
  }])).values()]
  for (const sample of samplesSummary) {
    for (const item of items.filter((candidate) => candidate.sample_id === sample.sample_id)) {
      sample.variants[item.variant_id] = itemMetrics(item)
    }
  }

  const matrix = {
    schema_version: 1,
    mode: 'scene_tile_correction_matrix_v0',
    run_id: runId,
    created_at: new Date().toISOString(),
    output_dir: runDir,
    variants: DEFAULT_VARIANTS,
    items,
    samples: samplesSummary,
    summary: summarizeMatrixItems({ items, report }),
    report: {
      file: 'scene_tile_report.json',
      summary: report.summary,
    },
  }
  const markdown = markdownForMatrix(matrix)

  await writeFile(path.join(runDir, 'scene_tile_report.json'), JSON.stringify(report, null, 2))
  await writeFile(path.join(runDir, 'scene_tile_report.md'), report.markdown)
  await writeFile(path.join(runDir, 'scene_tile_correction_matrix.json'), JSON.stringify(matrix, null, 2))
  await writeFile(path.join(runDir, 'scene_tile_correction_matrix.md'), markdown)

  return {
    ...matrix,
    markdown,
    report,
  }
}
