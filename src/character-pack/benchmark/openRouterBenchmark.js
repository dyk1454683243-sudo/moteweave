import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { buildCharacterPackArtifactManifest } from '../artifactManifest.js'
import { generateCharacterSource } from '../providers/geminiProvider.js'
import { processSheetBuffer } from '../processSheet.js'
import { loadTemplateImage } from '../templateStore.js'
import { classifyBenchmarkItem, summarizeFailureTaxonomy } from '../failureTaxonomy.js'
import { DEFAULT_GENERATION_PRESET } from '../generationDefaults.js'
import { canonicalSourceLayoutId, isFixedRegionMotionLayoutId } from '../sourceLayouts.js'
import { buildGodotProbeSummary } from './benchmarkRunner.js'

export const DEFAULT_OPENROUTER_BENCHMARK_CASES = Object.freeze([
  { id: 'blue_wizard', description: 'a small blue robed wizard with a wooden staff and clear walking animation' },
  { id: 'silver_swordswoman', description: 'a silver haired swordswoman in a dark cloak holding a short sword' },
  { id: 'forest_ranger', description: 'a green hooded forest ranger with a compact bow and leather boots' },
  { id: 'desert_merchant', description: 'a desert merchant with a small backpack, scarf, and warm travel clothes' },
  { id: 'clockwork_guard', description: 'a brass clockwork guard with a square shield and tiny helmet' },
  { id: 'mushroom_healer', description: 'a mushroom cap healer carrying a satchel of herbs and a lantern' },
  { id: 'snow_miner', description: 'a snow miner wearing goggles, a fur coat, and carrying a pickaxe' },
  { id: 'fire_monk', description: 'a red and gold fire monk with wrapped fists and a simple robe' },
  { id: 'frog_knight', description: 'a tiny frog knight with a round shield and leaf cape' },
  { id: 'neon_mechanic', description: 'a neon cyber mechanic with orange overalls and a glowing wrench' },
  { id: 'pirate_cook', description: 'a cheerful pirate cook with striped pants and a wooden spoon' },
  { id: 'moon_priest', description: 'a moon priest with pale robes, crescent ornaments, and a book' },
  { id: 'bee_farmer', description: 'a bee farmer with a veil hat, honey pouch, and small smoker tool' },
  { id: 'crystal_mage', description: 'a crystal mage with purple crystals on a staff and layered robes' },
  { id: 'cactus_bandit', description: 'a cactus themed bandit with a poncho and tiny revolver silhouette' },
  { id: 'plague_doctor', description: 'a plague doctor with a beaked mask, dark coat, and medicine bag' },
  { id: 'coral_diver', description: 'a coral reef diver with a bubble helmet and flippers' },
  { id: 'bakery_golem', description: 'a bread shaped bakery golem with mittens and a flour apron' },
  { id: 'thunder_drummer', description: 'a thunder drummer with a small drum, blue scarf, and energetic stance' },
  { id: 'library_cat', description: 'a librarian cat person with round glasses, vest, and a stack of books' },
  { id: 'samurai_beetle', description: 'a beetle samurai with lacquer armor and a short katana' },
  { id: 'ghost_mailman', description: 'a friendly ghost mailman with a cap, satchel, and floating feet' },
  { id: 'lava_blacksmith', description: 'a lava blacksmith with an apron, hammer, and glowing orange cracks' },
  { id: 'cloud_shepherd', description: 'a cloud shepherd with a crook, soft white cloak, and tiny boots' },
])

export function selectOpenRouterBenchmarkCases({ caseIds = [], sampleSize = null, cases = DEFAULT_OPENROUTER_BENCHMARK_CASES } = {}) {
  const sourceCases = Array.isArray(cases) ? cases : DEFAULT_OPENROUTER_BENCHMARK_CASES
  const requestedIds = Array.isArray(caseIds) ? caseIds.filter(Boolean).map(String) : []
  if (requestedIds.length) {
    const byId = new Map(sourceCases.map((item) => [item.id, item]))
    return requestedIds.map((id) => {
      const item = byId.get(id)
      if (!item) throw new Error(`Unknown OpenRouter benchmark case id: ${id}`)
      return item
    })
  }

  const size = sampleSize === null || sampleSize === undefined ? sourceCases.length : Number(sampleSize)
  if (!Number.isInteger(size) || size < 1) throw new Error('sampleSize must be a positive integer')
  const selected = sourceCases.slice(0, size)
  if (selected.length < size) throw new Error(`Requested ${size} cases but only ${selected.length} built-in cases are available`)
  return selected
}

function buildRunId(date = new Date()) {
  return `openrouter_bench_${date.toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '_')}`
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

function sortedCounts(counts) {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([id, count]) => ({ id, count }))
}

function validationBucket(item) {
  return item.validation?.status ?? 'unknown'
}

function countMessages(items, field) {
  const counts = new Map()
  for (const item of items) {
    for (const message of item.validation?.[field] ?? []) {
      counts.set(message, (counts.get(message) ?? 0) + 1)
    }
  }
  return sortedCounts(counts).map(({ id, count }) => ({ message: id, count }))
}

function suppressCategory(taxonomy, categoryId) {
  if (!taxonomy?.categories?.length) return taxonomy
  const categories = taxonomy.categories.filter((category) => category.id !== categoryId)
  if (categories.length === taxonomy.categories.length) return taxonomy
  return {
    primary: categories[0]?.id ?? null,
    severity: categories[0]?.severity ?? 'info',
    categories,
  }
}

function shouldSuppressExpectedDuplicateTaxonomy(item = {}) {
  const expected = Number(item.quality?.duplicate_expected_source_reuse_count) || 0
  const unexpected = Number(item.quality?.duplicate_unexpected_group_count) || 0
  return expected > 0 && unexpected === 0
}

function adjustedBenchmarkFailureTaxonomy(item) {
  const taxonomy = Array.isArray(item?.failure_taxonomy?.categories) ? item.failure_taxonomy : classifyBenchmarkItem(item)
  return shouldSuppressExpectedDuplicateTaxonomy(item) ? suppressCategory(taxonomy, 'motion.duplicate_frames') : taxonomy
}

function adjustedBenchmarkItem(item) {
  return {
    ...item,
    failure_taxonomy: adjustedBenchmarkFailureTaxonomy(item),
  }
}

export function summarizeOpenRouterBenchmark(items) {
  const validation = { pass: 0, warning: 0, fail: 0, unknown: 0 }
  const failures = { total: 0, model_error: 0, post_processing: 0, unexpected_error: 0 }
  for (const item of items) {
    const bucket = validationBucket(item)
    validation[bucket in validation ? bucket : 'unknown'] += 1
    if (item.failure?.mode) {
      failures.total += 1
      failures[item.failure.mode in failures ? item.failure.mode : 'unexpected_error'] += 1
    }
  }
  const qualityItems = items.map((item) => item.quality ?? {})
  const taxonomyItems = items.map(adjustedBenchmarkItem)
  return {
    total: items.length,
    validation,
    failures,
    top_warnings: countMessages(items, 'warnings'),
    top_blocking_errors: countMessages(items, 'blocking_errors'),
    failure_taxonomy: summarizeFailureTaxonomy(taxonomyItems),
    pass_rate: items.length ? round(validation.pass / items.length) : 0,
    usable_rate: items.length ? round((validation.pass + validation.warning) / items.length) : 0,
    metrics: {
      halo_score: metricStats(qualityItems.map((item) => item.halo_score)),
      duplicate_group_count: metricStats(qualityItems.map((item) => item.duplicate_group_count)),
      duplicate_expected_source_reuse_count: metricStats(qualityItems.map((item) => item.duplicate_expected_source_reuse_count)),
      duplicate_unexpected_group_count: metricStats(qualityItems.map((item) => item.duplicate_unexpected_group_count)),
      walk_low_motion_count: metricStats(qualityItems.map((item) => item.walk_low_motion_count)),
      direction_consistency_fail_count: metricStats(qualityItems.map((item) => item.direction_consistency_fail_count)),
      edge_pressure_severe_frame_count: metricStats(qualityItems.map((item) => item.edge_pressure_severe_frame_count)),
    },
  }
}

function exportAvailability(result) {
  return {
    json_grid: { available: Boolean(result.files?.godotNpcZipBuffer) },
    rpgmaker_v0: { available: Boolean(result.files?.rpgmakerZipBuffer) },
    ocad_v0: { available: Boolean(result.files?.ocadZipBuffer) },
  }
}

function sourceReuseKey(frame) {
  const source = frame?.source_frame
  if (!isFixedRegionMotionLayoutId(source?.layout)) return null
  if (!source.region_key) return null
  return `${canonicalSourceLayoutId(source.layout)}:${source.region_key}:${source.flip_h ? 'flip' : 'normal'}`
}

function actionKey(frames) {
  const actions = [...new Set(frames.map((frame) => frame?.source_frame?.action || frame?.runtime_action || 'unknown'))]
  return actions.sort().join('+') || 'unknown'
}

function exampleForDuplicateGroup(group, frames) {
  return {
    hash: group.hash,
    frames: group.frames,
    source_actions: [...new Set(frames.map((frame) => frame?.source_frame?.action).filter(Boolean))],
    source_region_keys: [...new Set(frames.map((frame) => frame?.source_frame?.region_key).filter(Boolean))],
    runtime_actions: [...new Set(frames.map((frame) => frame?.runtime_action).filter(Boolean))],
  }
}

export function summarizeDuplicateFrameReuse(duplicateFrames = [], frames = []) {
  const frameByIndex = new Map((frames ?? []).map((frame) => [frame.index, frame]))
  const expectedSourceReuseActions = new Map()
  const unexpectedDuplicateActions = new Map()
  const expectedSourceReuseExamples = []
  const unexpectedDuplicateExamples = []
  let expectedSourceReuseGroups = 0
  let unexpectedDuplicateGroups = 0

  for (const group of duplicateFrames ?? []) {
    const groupFrames = (group.frames ?? []).map((index) => frameByIndex.get(index)).filter(Boolean)
    const reuseKeys = [...new Set(groupFrames.map(sourceReuseKey).filter(Boolean))]
    const isExpectedSourceReuse = groupFrames.length === (group.frames?.length ?? 0) && reuseKeys.length === 1
    const key = actionKey(groupFrames)
    if (isExpectedSourceReuse) {
      expectedSourceReuseGroups += 1
      expectedSourceReuseActions.set(key, (expectedSourceReuseActions.get(key) ?? 0) + 1)
      if (expectedSourceReuseExamples.length < 5) expectedSourceReuseExamples.push(exampleForDuplicateGroup(group, groupFrames))
    } else {
      unexpectedDuplicateGroups += 1
      unexpectedDuplicateActions.set(key, (unexpectedDuplicateActions.get(key) ?? 0) + 1)
      if (unexpectedDuplicateExamples.length < 5) unexpectedDuplicateExamples.push(exampleForDuplicateGroup(group, groupFrames))
    }
  }

  return {
    total_groups: duplicateFrames?.length ?? 0,
    expected_source_reuse_groups: expectedSourceReuseGroups,
    unexpected_duplicate_groups: unexpectedDuplicateGroups,
    expected_source_reuse_actions: sortedCounts(expectedSourceReuseActions),
    unexpected_duplicate_actions: sortedCounts(unexpectedDuplicateActions),
    expected_source_reuse_examples: expectedSourceReuseExamples,
    unexpected_duplicate_examples: unexpectedDuplicateExamples,
  }
}

function qualitySummary(validation, frames = []) {
  const metrics = validation?.metrics ?? {}
  const direction = metrics.direction_consistency ?? {}
  const duplicateFrames = metrics.duplicate_frames ?? []
  const duplicateReuse = summarizeDuplicateFrameReuse(duplicateFrames, frames)
  return {
    halo_score: metrics.halo_score ?? null,
    duplicate_group_count: duplicateFrames.length,
    duplicate_expected_source_reuse_count: duplicateReuse.expected_source_reuse_groups,
    duplicate_unexpected_group_count: duplicateReuse.unexpected_duplicate_groups,
    duplicate_expected_source_reuse_actions: duplicateReuse.expected_source_reuse_actions,
    duplicate_unexpected_actions: duplicateReuse.unexpected_duplicate_actions,
    walk_low_motion_count: Object.values(metrics.walk_cycles ?? {}).filter((item) => item?.passed === false).length,
    direction_consistency_fail_count: Object.values(direction).filter((item) => item?.passed === false).length,
    edge_pressure_severe_frame_count: metrics.edge_pressure?.severe_frame_count ?? null,
    action_motion_passed: metrics.action_motion?.passed ?? null,
  }
}

function taxonomyCategoryCount(summary, categoryId) {
  const category = summary?.failure_taxonomy?.top_categories?.find((item) => item.id === categoryId)
  return Number(category?.count) || 0
}

function gateStatus(gates) {
  if (gates.some((item) => item.status === 'fail')) return 'fail'
  if (gates.some((item) => item.status === 'warning')) return 'warning'
  return 'pass'
}

export function evaluateOpenRouterQualityGate({ preset = DEFAULT_GENERATION_PRESET, summary = {} } = {}) {
  const resolvedPreset = canonicalSourceLayoutId(preset)
  const total = Number(summary.total) || 0
  const validation = summary.validation ?? {}
  const failures = summary.failures ?? {}
  const usableRate = Number(summary.usable_rate) || 0
  const failCount = Number(validation.fail) || 0
  const postProcessingFailures = Number(failures.post_processing) || 0
  const modelErrors = Number(failures.model_error) || 0
  const duplicateExamples = taxonomyCategoryCount(summary, 'motion.duplicate_frames')
  const duplicateExamplesPerItem = total ? round(duplicateExamples / total) : 0
  const avgDuplicateGroupCount = summary.metrics?.duplicate_group_count?.avg ?? null
  const avgExpectedSourceReuseCount = summary.metrics?.duplicate_expected_source_reuse_count?.avg ?? null
  const avgUnexpectedDuplicateGroupCount = summary.metrics?.duplicate_unexpected_group_count?.avg ?? null
  const hasUnexpectedMetric = avgUnexpectedDuplicateGroupCount !== null && avgUnexpectedDuplicateGroupCount !== undefined
  const hasDuplicateMotionDebt = hasUnexpectedMetric
    ? (Number(avgUnexpectedDuplicateGroupCount) || 0) > 0
    : duplicateExamples > 0 || (Number(avgDuplicateGroupCount) || 0) > 0
  const gates = [
    {
      id: 'structural_usability',
      status: usableRate >= 0.9 && failCount === 0 && postProcessingFailures === 0 ? 'pass' : 'fail',
      threshold: {
        min_usable_rate: 0.9,
        max_validation_fail_count: 0,
        max_post_processing_failures: 0,
      },
      observed: {
        usable_rate: usableRate,
        validation_fail_count: failCount,
        post_processing_failures: postProcessingFailures,
        model_errors: modelErrors,
      },
    },
    {
      id: 'motion_duplicate_frames',
      status: hasDuplicateMotionDebt ? 'warning' : 'pass',
      threshold: {
        target_duplicate_examples: 0,
      },
      observed: {
        duplicate_examples: duplicateExamples,
        duplicate_examples_per_item: duplicateExamplesPerItem,
        avg_duplicate_group_count: avgDuplicateGroupCount,
        avg_expected_source_reuse_count: avgExpectedSourceReuseCount,
        avg_unexpected_duplicate_group_count: avgUnexpectedDuplicateGroupCount,
      },
    },
  ]

  return {
    schema_version: 1,
    preset: resolvedPreset,
    status: gateStatus(gates),
    gates,
  }
}

async function writeArtifacts(itemDir, result) {
  await mkdir(itemDir, { recursive: true })
  const manifest = buildCharacterPackArtifactManifest(path.basename(itemDir), result)
  for (const file of manifest.files) {
    const content = Buffer.isBuffer(file.content) ? file.content : JSON.stringify(file.content, null, 2)
    const target = path.join(itemDir, file.name)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, content)
  }
  return {
    dir: itemDir,
    row_gif_previews: manifest.urls.row_gif_previews.map(({ name, animation, label }) => ({ name, animation, label })),
    files: {
      row_gif_count: Object.keys(result.files.rowGifBuffers ?? {}).length,
      has_zip: Boolean(result.files.zipBuffer),
      has_godot_npc_zip: Boolean(result.files.godotNpcZipBuffer),
      has_rpgmaker_zip: Boolean(result.files.rpgmakerZipBuffer),
      has_ocad_zip: Boolean(result.files.ocadZipBuffer),
    },
  }
}

function buildItemId(testCase, variant) {
  return `${testCase.id || 'case'}_v${variant}`
}

function markdownReport(report) {
  const lines = [
    '# Project Three OpenRouter Benchmark',
    '',
    `Run: \`${report.run_id}\``,
    `Created: ${report.created_at}`,
    `Preset: \`${report.preset}\``,
    `Template: \`${report.template_file ?? 'missing'}\``,
    '',
    '## Summary',
    '',
    `- Total: ${report.summary.total}`,
    `- Pass: ${report.summary.validation.pass}`,
    `- Warning: ${report.summary.validation.warning}`,
    `- Fail: ${report.summary.validation.fail}`,
    `- Model errors: ${report.summary.failures.model_error}`,
    `- Post-processing errors: ${report.summary.failures.post_processing}`,
    `- Pass rate: ${report.summary.pass_rate}`,
    `- Usable rate: ${report.summary.usable_rate}`,
    `- Quality gate: ${report.quality_gate?.status ?? 'unknown'}`,
    '',
    '## Quality Gate',
    '',
    ...(report.quality_gate?.gates?.length
      ? report.quality_gate.gates.map((item) => `- ${item.id}: ${item.status}`)
      : ['- none']),
    '',
    '## Top Warnings',
    '',
    ...(report.summary.top_warnings.length
      ? report.summary.top_warnings.slice(0, 10).map((item) => `- ${item.message}: ${item.count}`)
      : ['- none']),
    '',
    '## Top Blocking Errors',
    '',
    ...(report.summary.top_blocking_errors.length
      ? report.summary.top_blocking_errors.slice(0, 10).map((item) => `- ${item.message}: ${item.count}`)
      : ['- none']),
    '',
    '## Failure Taxonomy',
    '',
    ...(report.summary.failure_taxonomy?.top_categories?.length
      ? report.summary.failure_taxonomy.top_categories.slice(0, 10).map((item) => `- ${item.id}: ${item.count}`)
      : ['- none']),
    '',
    '## Items',
    '',
    '| Case | Variant | Status | Validation | Taxonomy | Halo | Expected reuse | Unexpected dupes | Failure |',
    '| --- | ---: | --- | --- | --- | ---: | ---: | ---: | --- |',
  ]
  for (const item of report.items) {
    lines.push(
      `| ${item.case.id} | ${item.variant} | ${item.status} | ${item.validation?.status ?? 'unknown'} | ${item.failure_taxonomy?.primary ?? ''} | ${item.quality?.halo_score ?? ''} | ${item.quality?.duplicate_expected_source_reuse_count ?? ''} | ${item.quality?.duplicate_unexpected_group_count ?? ''} | ${item.failure?.mode ?? ''} |`
    )
  }
  lines.push(
    '',
    '## Notes',
    '',
    'This benchmark records real or injected generated sources after they pass through the same post-processing, validation, export, and preview pipeline used by the app.',
    'A small sample proves the loop works. Treat template or prompt decisions as data-backed only after running the 20-30 case gate.'
  )
  return `${lines.join('\n')}\n`
}

export function recomputeOpenRouterBenchmarkReport(report, { runId, createdAt = new Date().toISOString() } = {}) {
  if (!report || !Array.isArray(report.items)) throw new Error('OpenRouter benchmark report items are required')
  const items = report.items.map(adjustedBenchmarkItem)
  const summary = summarizeOpenRouterBenchmark(items)
  const nextRunId = runId ?? report.run_id ?? buildRunId()
  const recomputed = {
    ...report,
    schema_version: report.schema_version ?? 1,
    source_run_id: report.source_run_id ?? report.run_id ?? null,
    run_id: nextRunId,
    created_at: createdAt,
    summary,
    quality_gate: evaluateOpenRouterQualityGate({ preset: report.preset ?? DEFAULT_GENERATION_PRESET, summary }),
    items,
  }
  recomputed.markdown = markdownReport(recomputed)
  return recomputed
}

async function processGeneratedSource({
  generated,
  itemId,
  testCase,
  variant,
  preset,
  providerPresetId,
  processSheet,
  backgroundMode,
}) {
  const sourceLayout = canonicalSourceLayoutId(generated.promptContract?.layout_id ?? preset)
  const result = await processSheet(generated.buffer, {
    name: itemId,
    description: testCase.description,
    backgroundMode,
    sourceType: 'openrouter_benchmark',
    sourceFileName: `${itemId}.png`,
    sourceLayout,
    generation: {
      provider: generated.provider,
      provider_preset_id: generated.providerPresetId ?? providerPresetId ?? null,
      model: generated.model,
      input_images: generated.inputImages,
      template_file: generated.templateName,
      reference_file: generated.referenceName,
      palette_file: generated.paletteName,
      prompt_contract: generated.promptContract,
      benchmark_case_id: testCase.id,
      benchmark_variant: variant,
    },
    promptText: generated.prompt,
  })
  return result
}

export async function runOpenRouterCharacterBenchmark({
  cases,
  variantsPerCase = 1,
  outputDir = 'generated/openrouter-benchmarks',
  runId = buildRunId(),
  preset = DEFAULT_GENERATION_PRESET,
  providerPresetId = undefined,
  imageConfig = { image_size: '1K', aspect_ratio: '1:1' },
  backgroundMode = 'auto',
  rootDir = process.cwd(),
  generateSource = generateCharacterSource,
  processSheet = processSheetBuffer,
  loadTemplate = loadTemplateImage,
  runGodotProbe = false,
} = {}) {
  if (!Array.isArray(cases) || cases.length === 0) throw new Error('benchmark cases are required')
  if (!Number.isInteger(variantsPerCase) || variantsPerCase < 1) throw new Error('variantsPerCase must be a positive integer')
  const resolvedPreset = canonicalSourceLayoutId(preset)

  const runDir = path.join(outputDir, runId)
  await mkdir(runDir, { recursive: true })
  const templateImage = await loadTemplate(resolvedPreset, { rootDir })
  const items = []

  for (const testCase of cases) {
    for (let variant = 1; variant <= variantsPerCase; variant++) {
      const itemId = buildItemId(testCase, variant)
      const itemDir = path.join(runDir, 'items', itemId)
      const started = Date.now()
      let generated = null
      try {
        generated = await generateSource({
          description: testCase.description,
          preset: resolvedPreset,
          providerPresetId,
          imageConfig,
          templateImage,
          referenceImage: testCase.referenceImage ?? null,
          paletteImage: testCase.paletteImage ?? null,
        })
        const result = await processGeneratedSource({ generated, itemId, testCase, variant, preset: resolvedPreset, providerPresetId, processSheet, backgroundMode })
        const validation = result.debugReport.validation
        const item = {
          case: { id: testCase.id, description: testCase.description },
          variant,
          status: validation.status === 'fail' ? 'failed_post_processing' : 'done',
          duration_ms: Date.now() - started,
          generation: {
            provider: generated.provider,
            provider_preset_id: generated.providerPresetId ?? providerPresetId ?? null,
            model: generated.model,
            template_file: generated.templateName,
            reference_file: generated.referenceName,
            palette_file: generated.paletteName,
            prompt_contract: generated.promptContract,
            input_images: generated.inputImages,
            image_config: imageConfig,
          },
          processing: {
            id: result.id,
            background_mode: result.debugReport.background_mode,
          },
          validation: {
            status: validation.status,
            warnings: validation.warnings,
            blocking_errors: validation.blocking_errors,
            failure_taxonomy: validation.failure_taxonomy,
          },
          quality: qualitySummary(validation, result.debugReport.frames),
          exports: exportAvailability(result),
          artifacts: await writeArtifacts(itemDir, result),
        }
        if (validation.status === 'fail') item.failure = { mode: 'post_processing', reason: validation.blocking_errors?.[0] ?? 'validation_failed' }
        item.failure_taxonomy = adjustedBenchmarkFailureTaxonomy(item)
        if (runGodotProbe) item.godot_probe = await buildGodotProbeSummary(result)
        items.push(item)
      } catch (error) {
        const item = {
          case: { id: testCase.id, description: testCase.description },
          variant,
          status: error.status ?? 'failed_model_error',
          duration_ms: Date.now() - started,
          generation: {
            provider: generated?.provider ?? null,
            provider_preset_id: generated?.providerPresetId ?? providerPresetId ?? null,
            model: generated?.model ?? null,
            template_file: generated?.templateName ?? templateImage?.name ?? null,
            reference_file: generated?.referenceName ?? null,
            palette_file: generated?.paletteName ?? null,
            prompt_contract: generated?.promptContract,
            input_images: generated?.inputImages,
            image_config: imageConfig,
          },
          validation: { status: 'unknown', warnings: [], blocking_errors: [] },
          failure: {
            mode: error.status === 'failed_post_processing' ? 'post_processing' : error.status ? 'model_error' : 'unexpected_error',
            reason: String(error.message || error),
          },
        }
        item.failure_taxonomy = classifyBenchmarkItem(item)
        items.push(item)
      }
    }
  }

  const summary = summarizeOpenRouterBenchmark(items)
  const report = {
    schema_version: 1,
    run_id: runId,
    created_at: new Date().toISOString(),
    preset: resolvedPreset,
    provider_preset_id: providerPresetId ?? null,
    template_file: templateImage?.name ?? null,
    image_config: imageConfig,
    cases: cases.map((item) => ({ id: item.id, description: item.description })),
    variants_per_case: variantsPerCase,
    summary,
    quality_gate: evaluateOpenRouterQualityGate({ preset: resolvedPreset, summary }),
    items,
  }
  report.markdown = markdownReport(report)
  await writeFile(path.join(runDir, 'benchmark_report.json'), JSON.stringify(report, null, 2))
  await writeFile(path.join(runDir, 'benchmark_report.md'), report.markdown)
  return report
}
