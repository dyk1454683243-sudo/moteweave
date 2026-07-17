import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { classifyValidationMessages, summarizeFailureTaxonomy } from '../failureTaxonomy.js'
import { canonicalSourceLayoutId } from '../sourceLayouts.js'

function buildRunId(date = new Date()) {
  return `processed_bench_${date.toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '_')}`
}

function round(value, digits = 4) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function metricStats(values) {
  const finite = values.filter((value) => Number.isFinite(value))
  if (!finite.length) return { avg: null, min: null, max: null }
  return {
    avg: round(finite.reduce((sum, value) => sum + value, 0) / finite.length),
    min: round(Math.min(...finite)),
    max: round(Math.max(...finite)),
  }
}

function countBy(items, getKey) {
  const out = {}
  for (const item of items) {
    const key = getKey(item) ?? 'unknown'
    out[key] = (out[key] ?? 0) + 1
  }
  return out
}

function countMessages(items, getMessages) {
  const counts = new Map()
  for (const item of items) {
    for (const message of getMessages(item) ?? []) {
      counts.set(message, (counts.get(message) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([message, count]) => ({ message, count }))
}

function anchorSpread(report, axis) {
  const values = (report.frames ?? [])
    .map((frame) => frame.normalized_anchor?.[axis])
    .filter((value) => Number.isFinite(value))
  return values.length ? Math.max(...values) - Math.min(...values) : null
}

function subpixelJitterMetric(report, key) {
  const value = report.validation?.metrics?.subpixel_jitter?.[key]
  return Number.isFinite(value) ? value : null
}

function validationForReport(report) {
  const validation = report.validation ?? {}
  return {
    ...validation,
    warnings: [...(validation.warnings ?? []), ...(report.background_warnings ?? [])],
    blocking_errors: validation.blocking_errors ?? [],
  }
}

function taxonomyForReport(report) {
  const existing = report.validation?.failure_taxonomy
  if (existing?.categories) return existing
  return classifyValidationMessages(validationForReport(report))
}

function classifyFailureModes(report) {
  const counts = {
    cropped: 0,
    empty_frames: 0,
    frame_count: 0,
    anchor_drift: 0,
    baseline_drift: 0,
    subpixel_jitter: 0,
    low_motion: 0,
    duplicate_frames: 0,
    halo: 0,
    edge_pressure: 0,
    source_region_edge_pressure: 0,
    dual_matte: 0,
    background: (report.background_warnings ?? []).length,
  }
  const taxonomy = taxonomyForReport(report)
  const keyByCategory = {
    'structure.cropped': 'cropped',
    'structure.empty_frame': 'empty_frames',
    'structure.frame_count': 'frame_count',
    'alignment.anchor_drift': 'anchor_drift',
    'alignment.baseline_drift': 'baseline_drift',
    'alignment.subpixel_jitter': 'subpixel_jitter',
    'motion.low_motion': 'low_motion',
    'motion.duplicate_frames': 'duplicate_frames',
    'background.halo': 'halo',
    'composition.edge_pressure': 'edge_pressure',
    'layout.source_region_edge_pressure': 'source_region_edge_pressure',
    'background.dual_matte': 'dual_matte',
  }
  for (const category of taxonomy.categories ?? []) {
    const key = keyByCategory[category.id]
    if (key) counts[key] += category.count
  }
  return counts
}

function addFailureModes(acc, report) {
  const modes = classifyFailureModes(report)
  for (const [key, count] of Object.entries(modes)) acc[key] = (acc[key] ?? 0) + count
}

function reportSourceLayoutId(report) {
  const id = report.source_layout?.id ?? report.profile
  return id ? canonicalSourceLayoutId(id) : null
}

export function summarizeProcessedReports(items) {
  const validation = { pass: 0, warning: 0, fail: 0, unknown: 0 }
  const failure_modes = {
    cropped: 0,
    empty_frames: 0,
    frame_count: 0,
    anchor_drift: 0,
    baseline_drift: 0,
    subpixel_jitter: 0,
    low_motion: 0,
    duplicate_frames: 0,
    halo: 0,
    edge_pressure: 0,
    source_region_edge_pressure: 0,
    dual_matte: 0,
    background: 0,
  }
  for (const item of items) {
    const status = item.report.validation?.status ?? 'unknown'
    validation[status in validation ? status : 'unknown'] += 1
    addFailureModes(failure_modes, item.report)
  }

  return {
    total: items.length,
    validation,
    pass_rate: items.length ? round(validation.pass / items.length) : 0,
    usable_rate: items.length ? round((validation.pass + validation.warning) / items.length) : 0,
    source_layouts: countBy(items, (item) => reportSourceLayoutId(item.report)),
    background_modes: countBy(items, (item) => item.report.background_mode),
    top_warnings: countMessages(items, (item) => item.report.validation?.warnings),
    top_blocking_errors: countMessages(items, (item) => item.report.validation?.blocking_errors),
    failure_modes,
    failure_taxonomy: summarizeFailureTaxonomy(items.map((item) => ({ failure_taxonomy: taxonomyForReport(item.report), validation: validationForReport(item.report) }))),
    metrics: {
      halo_score: metricStats(items.map((item) => item.report.validation?.metrics?.halo_score)),
      edge_pressure_severe_frame_count: metricStats(items.map((item) => item.report.validation?.metrics?.edge_pressure?.severe_frame_count)),
      auto_correction_applied_count: metricStats(items.map((item) => item.report.normalization?.auto_correction?.applied_count)),
      motion_stabilization_applied_count: metricStats(items.map((item) => item.report.normalization?.motion_stabilization?.applied_count)),
      anchor_spread_x: metricStats(items.map((item) => anchorSpread(item.report, 'x'))),
      anchor_spread_y: metricStats(items.map((item) => anchorSpread(item.report, 'y'))),
      subpixel_jitter_max_center_x_fractional_spread: metricStats(items.map((item) => subpixelJitterMetric(item.report, 'max_center_x_fractional_spread'))),
      subpixel_jitter_max_half_pixel_x_transitions: metricStats(items.map((item) => subpixelJitterMetric(item.report, 'max_half_pixel_x_transitions'))),
    },
  }
}

function shouldSkipDir(name) {
  return ['benchmarks', 'openrouter-benchmarks', 'processed-sample-benchmarks', 'real-world-benchmarks'].includes(name)
}

async function collectDebugReports(rootDir) {
  const entries = await readdir(rootDir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    if (!entry.isDirectory() || shouldSkipDir(entry.name)) continue
    const reportPath = path.join(rootDir, entry.name, 'debug_report.json')
    try {
      const raw = await readFile(reportPath, 'utf8')
      files.push({ id: entry.name, path: reportPath, report: JSON.parse(raw) })
    } catch {
      // Generated folders without debug reports are not benchmark samples.
    }
  }
  return files.sort((a, b) => a.id.localeCompare(b.id))
}

function itemSummary(item) {
  const validation = item.report.validation ?? {}
  const failureTaxonomy = taxonomyForReport(item.report)
  return {
    id: item.id,
    path: item.path,
    profile: item.report.profile ?? null,
    source_layout: reportSourceLayoutId(item.report),
    background_mode: item.report.background_mode ?? null,
    validation: {
      status: validation.status ?? 'unknown',
      warnings: validation.warnings ?? [],
      blocking_errors: validation.blocking_errors ?? [],
      failure_taxonomy: failureTaxonomy,
    },
    failure_taxonomy: failureTaxonomy,
    metrics: {
      halo_score: validation.metrics?.halo_score ?? null,
      edge_pressure_severe_frame_count: validation.metrics?.edge_pressure?.severe_frame_count ?? null,
      auto_correction_applied_count: item.report.normalization?.auto_correction?.applied_count ?? null,
      motion_stabilization_applied_count: item.report.normalization?.motion_stabilization?.applied_count ?? null,
      anchor_spread_x: anchorSpread(item.report, 'x'),
      anchor_spread_y: anchorSpread(item.report, 'y'),
      subpixel_jitter_max_center_x_fractional_spread: subpixelJitterMetric(item.report, 'max_center_x_fractional_spread'),
      subpixel_jitter_max_half_pixel_x_transitions: subpixelJitterMetric(item.report, 'max_half_pixel_x_transitions'),
    },
  }
}

function markdownReport(report) {
  const lines = [
    '# Processed Character Pack Benchmark',
    '',
    `Run: \`${report.run_id}\``,
    `Created: ${report.created_at}`,
    `Root: \`${report.root_dir}\``,
    '',
    '## Summary',
    '',
    `- Total: ${report.summary.total}`,
    `- Pass: ${report.summary.validation.pass}`,
    `- Warning: ${report.summary.validation.warning}`,
    `- Fail: ${report.summary.validation.fail}`,
    `- Pass rate: ${report.summary.pass_rate}`,
    `- Usable rate: ${report.summary.usable_rate}`,
    '',
    '## Failure Modes',
    '',
    ...Object.entries(report.summary.failure_modes).map(([key, count]) => `- ${key}: ${count}`),
    '',
    '## Top Warnings',
    '',
    ...(report.summary.top_warnings.length ? report.summary.top_warnings.slice(0, 10).map((item) => `- ${item.message}: ${item.count}`) : ['- none']),
    '',
    '## Items',
    '',
    '| ID | Validation | Layout | Background | Anchor X Spread | Half-Pixel Jitter | Motion Fixes |',
    '| --- | --- | --- | --- | ---: | ---: | ---: |',
  ]
  for (const item of report.items) {
    lines.push(
      `| ${item.id} | ${item.validation.status} | ${item.source_layout ?? ''} | ${item.background_mode ?? ''} | ${item.metrics.anchor_spread_x ?? ''} | ${item.metrics.subpixel_jitter_max_half_pixel_x_transitions ?? ''} | ${item.metrics.motion_stabilization_applied_count ?? ''} |`
    )
  }
  return `${lines.join('\n')}\n`
}

export async function runProcessedSampleBenchmark({ rootDir = 'generated', outputDir = 'generated/processed-sample-benchmarks', runId = buildRunId(), limit = null } = {}) {
  const collected = await collectDebugReports(rootDir)
  const selected = Number.isInteger(limit) && limit > 0 ? collected.slice(0, limit) : collected
  if (!selected.length) throw new Error(`No debug_report.json files found under ${rootDir}`)

  const report = {
    schema_version: 1,
    run_id: runId,
    created_at: new Date().toISOString(),
    root_dir: rootDir,
    summary: summarizeProcessedReports(selected),
    items: selected.map(itemSummary),
  }
  report.markdown = markdownReport(report)

  const runDir = path.join(outputDir, runId)
  await mkdir(runDir, { recursive: true })
  await writeFile(path.join(runDir, 'processed_sample_benchmark.json'), JSON.stringify(report, null, 2))
  await writeFile(path.join(runDir, 'processed_sample_benchmark.md'), report.markdown)
  return report
}
