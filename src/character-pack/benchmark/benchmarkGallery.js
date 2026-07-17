import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const GALLERY_SCHEMA_VERSION = 1
const OPENROUTER_BENCHMARK_ROOT = 'openrouter-benchmarks'

async function readJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'))
  } catch {
    return null
  }
}

async function readDirectories(dir) {
  try {
    return (await readdir(dir, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
}

async function readFiles(dir) {
  try {
    return (await readdir(dir, { withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => entry.name)
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
}

function segment(value) {
  return encodeURIComponent(String(value))
}

function itemIdFor(item) {
  const artifactDir = item.artifacts?.dir ? path.basename(item.artifacts.dir) : ''
  if (artifactDir && artifactDir !== '.' && artifactDir !== path.sep) return artifactDir
  const caseId = item.case?.id ?? 'case'
  const variant = item.variant ?? 1
  return `${caseId}_v${variant}`
}

function itemBaseUrl(runId, itemId) {
  return `/generated/${OPENROUTER_BENCHMARK_ROOT}/${segment(runId)}/items/${segment(itemId)}`
}

function artifactUrl(runId, itemId, fileName) {
  return `${itemBaseUrl(runId, itemId)}/${segment(fileName)}`
}

function normalizePreview(runId, itemId, preview) {
  const name = preview.name ?? preview.fileName ?? `${preview.animation ?? 'preview'}.gif`
  const animation = preview.animation ?? name.replace(/\.gif$/i, '')
  return {
    name,
    url: preview.url ?? artifactUrl(runId, itemId, name),
    animation,
    label: preview.label ?? animation.replace(/_/g, ' '),
  }
}

async function rowGifPreviews({ runDir, runId, itemId, item }) {
  const recorded = item.artifacts?.row_gif_previews ?? item.row_gif_previews
  if (Array.isArray(recorded) && recorded.length) {
    return recorded.map((preview) => normalizePreview(runId, itemId, preview))
  }

  const itemDir = path.join(runDir, 'items', itemId)
  return (await readFiles(itemDir))
    .filter((name) => name.toLowerCase().endsWith('.gif'))
    .sort((a, b) => a.localeCompare(b))
    .map((name) => normalizePreview(runId, itemId, { name }))
}

async function mapBenchmarkItem({ runDir, runId, item }) {
  const id = itemIdFor(item)
  const hasArtifacts = Boolean(item.artifacts)
  const urls = hasArtifacts
    ? {
        source_url: artifactUrl(runId, id, 'source.png'),
        source_layout_overlay_url: artifactUrl(runId, id, 'source_layout_overlay.png'),
        normalized_sheet_url: artifactUrl(runId, id, 'normalized_sheet.png'),
        debug_overlay_url: artifactUrl(runId, id, 'debug_overlay.png'),
        onion_skin_overlay_url: artifactUrl(runId, id, 'onion_skin_overlay.png'),
        prompt_url: artifactUrl(runId, id, 'prompt.txt'),
        generation_url: artifactUrl(runId, id, 'generation.json'),
        debug_report_url: artifactUrl(runId, id, 'debug_report.json'),
        metadata_url: artifactUrl(runId, id, 'metadata.json'),
      }
    : {}
  return {
    id,
    case_id: item.case?.id ?? id,
    description: item.case?.description ?? '',
    variant: item.variant ?? null,
    status: item.status ?? 'unknown',
    validation_status: item.validation?.status ?? 'unknown',
    generation: item.generation ?? {},
    validation: item.validation ?? {},
    quality: item.quality ?? {},
    failure: item.failure ?? null,
    failure_taxonomy: item.failure_taxonomy ?? item.validation?.failure_taxonomy ?? null,
    ...urls,
    row_gif_previews: hasArtifacts ? await rowGifPreviews({ runDir, runId, itemId: id, item }) : [],
  }
}

async function readBenchmarkRun({ rootDir, runId }) {
  const runDir = path.join(rootDir, runId)
  const report = await readJson(path.join(runDir, 'benchmark_report.json'))
  return report ? { runDir, runId, report } : null
}

async function mapBenchmarkRun({ runDir, runId, report, maxItemsPerRun }) {
  const allItems = Array.isArray(report.items) ? report.items : []
  const visibleItems = allItems.slice(0, maxItemsPerRun)
  return {
    run_id: report.run_id ?? runId,
    created_at: report.created_at ?? null,
    preset: report.preset ?? null,
    template_file: report.template_file ?? null,
    image_config: report.image_config ?? {},
    summary: report.summary ?? {},
    item_count: allItems.length,
    visible_item_count: visibleItems.length,
    truncated_items: visibleItems.length < allItems.length,
    items: await Promise.all(visibleItems.map((item) => mapBenchmarkItem({ runDir, runId, item }))),
  }
}

function createdTime(run) {
  const time = Date.parse(run.report?.created_at ?? '')
  return Number.isFinite(time) ? time : 0
}

export async function buildBenchmarkGallery({ generatedDir = 'generated', maxRuns = 5, maxItemsPerRun = 12 } = {}) {
  const rootDir = path.join(generatedDir, OPENROUTER_BENCHMARK_ROOT)
  const runIds = await readDirectories(rootDir)
  const runReports = (await Promise.all(runIds.map((runId) => readBenchmarkRun({ rootDir, runId })))).filter(Boolean)
  runReports.sort((a, b) => createdTime(b) - createdTime(a) || b.runId.localeCompare(a.runId))
  const runs = await Promise.all(runReports.slice(0, maxRuns).map((run) => mapBenchmarkRun({ ...run, maxItemsPerRun })))
  return {
    schema_version: GALLERY_SCHEMA_VERSION,
    runs,
  }
}
