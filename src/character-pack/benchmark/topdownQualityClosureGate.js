import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { runOpenRouterCharacterBenchmark, selectOpenRouterBenchmarkCases } from './openRouterBenchmark.js'
import { buildTopdownRepairPlan, summarizeTopdownRepairPlans } from './topdownRepairPlan.js'

export const TOPDOWN_QUALITY_CLOSURE_CASE_IDS = Object.freeze([
  'blue_wizard',
  'frog_knight',
  'silver_swordswoman',
  'desert_merchant',
  'thunder_drummer',
])

const DEFAULT_IMAGE_SIZES = Object.freeze(['1K', '2K'])

function buildRunId(date = new Date()) {
  return `topdown_quality_closure_${date.toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '_')}`
}

function sizeSlug(imageSize) {
  return String(imageSize).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

function normalizeImageSizes(imageSizes = DEFAULT_IMAGE_SIZES) {
  const sizes = Array.isArray(imageSizes) ? imageSizes.map(String).filter(Boolean) : [String(imageSizes)]
  if (!sizes.length) throw new Error('At least one image size is required')
  return [...new Set(sizes)]
}

function runSummary(imageSize, report, outputDir) {
  const repairPlans = (report.items ?? []).map((item) =>
    buildTopdownRepairPlan({
      itemId: `${item.case?.id ?? 'case'}_v${item.variant ?? 1}`,
      caseId: item.case?.id ?? null,
      validation: item.validation,
    })
  )
  return {
    image_size: imageSize,
    run_id: report.run_id,
    output_dir: path.join(outputDir, report.run_id),
    preset: report.preset,
    template_file: report.template_file ?? null,
    image_config: report.image_config,
    total: report.summary.total,
    validation: report.summary.validation,
    failures: report.summary.failures,
    failure_taxonomy: report.summary.failure_taxonomy,
    pass_rate: report.summary.pass_rate,
    usable_rate: report.summary.usable_rate,
    repair_summary: summarizeTopdownRepairPlans(repairPlans),
  }
}

function markdownReport(report) {
  const lines = [
    '# Topdown Quality Closure Gate',
    '',
    `Run: \`${report.run_id}\``,
    `Created: ${report.created_at}`,
    `Preset: \`${report.preset}\``,
    `Cases: ${report.case_ids.join(', ')}`,
    `Image sizes: ${report.image_sizes.join(', ')}`,
    '',
    '## Comparison',
    '',
    '| Image size | Run | Pass rate | Usable rate | Pass | Warning | Fail | Unknown | Top taxonomy |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
  ]
  for (const item of report.comparison) {
    lines.push(
      `| ${item.image_size} | ${item.run_id} | ${item.pass_rate} | ${item.usable_rate} | ${item.validation.pass} | ${item.validation.warning} | ${item.validation.fail} | ${item.validation.unknown} | ${item.top_taxonomy.join(', ') || 'none'} |`
    )
  }
  lines.push(
    '',
    '## Repair Candidates',
    '',
    '| Image size | Issue count | Items with repairs | Top frames |',
    '| --- | ---: | ---: | --- |'
  )
  for (const item of report.comparison) {
    lines.push(`| ${item.image_size} | ${item.repair_issue_count} | ${item.items_with_repairs} | ${item.repair_top_frames.map((frame) => `frame_${frame.frame}:${frame.count}`).join(', ') || 'none'} |`)
  }
  lines.push(
    '',
    '## Notes',
    '',
    'Use this matrix before claiming the topdown prompt/template fixes improved live generation quality.',
    'If the high-risk small gate improves fixed empty-frame failures, rerun the full 20-case topdown gate and record the new run id.'
  )
  return `${lines.join('\n')}\n`
}

function topTaxonomy(summary) {
  return (summary.failure_taxonomy?.top_categories ?? []).slice(0, 3).map((item) => `${item.id}:${item.count}`)
}

export function buildTopdownQualityClosurePlan({
  runId = buildRunId(),
  caseIds = TOPDOWN_QUALITY_CLOSURE_CASE_IDS,
  imageSizes = DEFAULT_IMAGE_SIZES,
  variantsPerCase = 1,
  preset = 'topdown_rpg_v0',
} = {}) {
  const sizes = normalizeImageSizes(imageSizes)
  const cases = selectOpenRouterBenchmarkCases({ caseIds })
  return {
    run_id: runId,
    preset,
    case_ids: cases.map((item) => item.id),
    image_sizes: sizes,
    variants_per_case: variantsPerCase,
    runs: sizes.map((imageSize) => ({
      run_id: `${runId}_${sizeSlug(imageSize)}`,
      preset,
      image_size: imageSize,
      sample_size: cases.length,
      case_ids: cases.map((item) => item.id),
      variants_per_case: variantsPerCase,
    })),
  }
}

export async function runTopdownQualityClosureGate({
  outputDir = 'generated/openrouter-benchmarks',
  runId = buildRunId(),
  caseIds = TOPDOWN_QUALITY_CLOSURE_CASE_IDS,
  imageSizes = DEFAULT_IMAGE_SIZES,
  variantsPerCase = 1,
  providerPresetId = undefined,
  backgroundMode = 'auto',
  aspectRatio = '1:1',
  rootDir = process.cwd(),
  runBenchmark = runOpenRouterCharacterBenchmark,
  generateSource,
  processSheet,
  loadTemplate,
} = {}) {
  const plan = buildTopdownQualityClosurePlan({ runId, caseIds, imageSizes, variantsPerCase })
  const aggregateDir = path.join(outputDir, runId)
  await mkdir(aggregateDir, { recursive: true })

  const runs = []
  for (const plannedRun of plan.runs) {
    const report = await runBenchmark({
      cases: selectOpenRouterBenchmarkCases({ caseIds: plannedRun.case_ids }),
      variantsPerCase,
      outputDir: aggregateDir,
      runId: plannedRun.run_id,
      preset: plannedRun.preset,
      providerPresetId,
      backgroundMode,
      rootDir,
      imageConfig: {
        image_size: plannedRun.image_size,
        aspect_ratio: aspectRatio,
      },
      ...(generateSource ? { generateSource } : {}),
      ...(processSheet ? { processSheet } : {}),
      ...(loadTemplate ? { loadTemplate } : {}),
    })
    runs.push(runSummary(plannedRun.image_size, report, aggregateDir))
  }

  const report = {
    schema_version: 1,
    run_id: runId,
    created_at: new Date().toISOString(),
    preset: plan.preset,
    case_ids: plan.case_ids,
    image_sizes: plan.image_sizes,
    variants_per_case: variantsPerCase,
    runs,
    comparison: runs.map((item) => ({
      image_size: item.image_size,
      run_id: item.run_id,
      pass_rate: item.pass_rate,
      usable_rate: item.usable_rate,
      validation: item.validation,
      top_taxonomy: topTaxonomy(item),
      repair_issue_count: item.repair_summary.issue_count,
      items_with_repairs: item.repair_summary.items_with_repairs,
      repair_top_frames: item.repair_summary.top_frames.slice(0, 5),
    })),
  }
  report.markdown = markdownReport(report)
  await writeFile(path.join(aggregateDir, 'quality_closure_report.json'), JSON.stringify(report, null, 2))
  await writeFile(path.join(aggregateDir, 'quality_closure_report.md'), report.markdown)
  return report
}
