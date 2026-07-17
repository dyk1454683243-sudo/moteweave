import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { encodeRgbaPng, loadRgba, resizeRgbaNearest } from '../imageCodec.js'
import { detectAlphaBBox } from '../normalizer.js'
import { processSheetBuffer } from '../processSheet.js'
import { removeBackground } from '../sourcePreparation.js'
import {
  FIXED_REGION_MOTION_LAYOUT_ID,
  LEGACY_OCAD_MOTION_LAYOUT_ID,
  TOPDOWN_RPG_SOURCE_LAYOUT_ID,
} from '../sourceLayoutIds.js'
import {
  applyPixelStyleCorrection,
  buildPixelStyleReport,
  downsampleNearest,
  strengthenAlphaOutline,
} from '../stylePipeline.js'
import {
  DEFAULT_LOCAL_IMAGE_MANIFEST,
  validateLocalImageManifest,
} from './localImageManifest.js'
import {
  assertProviderFreeQualityGateLayer,
  evaluateLocalImageQualityGate,
} from './qualityGateLayers.js'

export { DEFAULT_LOCAL_IMAGE_MANIFEST }

const SINGLE_CHARACTER_PROFILES = new Set(['quality_character_v0', 'single_character'])
const SHEET_PROFILES = new Set([
  TOPDOWN_RPG_SOURCE_LAYOUT_ID,
  FIXED_REGION_MOTION_LAYOUT_ID,
  LEGACY_OCAD_MOTION_LAYOUT_ID,
])
const DEFAULT_BACKGROUND_SWEEP_MODES = Object.freeze(['auto', 'flood', 'edge_palette', 'passthrough'])
const STATUS_RANK = Object.freeze({ pass: 3, warning: 2, fail: 1, error: 0, skipped: 0 })
const PREVIEW_MAX_SIDE = 256

function round(value, digits = 4) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function buildRunId(date = new Date()) {
  return `local_images_${date.toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '_')}`
}

function normalizeKind(kind = '') {
  return String(kind || '').trim().replace(/-/g, '_')
}

function normalizeModeList(modes = []) {
  const values = Array.isArray(modes) ? modes : [modes]
  const unique = []
  for (const mode of values) {
    const normalized = String(mode || '').trim()
    if (!normalized || unique.includes(normalized)) continue
    unique.push(normalized)
  }
  return unique
}

function benchmarkBackgroundMode(sample, options) {
  return options.backgroundModeOverride ?? sample.background_mode ?? options.backgroundMode ?? 'auto'
}

function safePreviewId(id = 'sample') {
  return String(id || 'sample')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'sample'
}

async function resizeForPreview(image, maxSide = PREVIEW_MAX_SIDE) {
  const longest = Math.max(image.width, image.height)
  if (!longest || longest <= maxSide) return image
  const scale = maxSide / longest
  return resizeRgbaNearest(image, {
    w: Math.max(1, Math.round(image.width * scale)),
    h: Math.max(1, Math.round(image.height * scale)),
  })
}

function flattenToChecker(image, { cellSize = 8 } = {}) {
  const out = { width: image.width, height: image.height, data: new Uint8ClampedArray(image.width * image.height * 4) }
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const offset = (y * image.width + x) * 4
      const light = (Math.floor(x / cellSize) + Math.floor(y / cellSize)) % 2 === 0
      const bg = light ? 236 : 196
      const alpha = image.data[offset + 3] / 255
      out.data[offset] = Math.round(image.data[offset] * alpha + bg * (1 - alpha))
      out.data[offset + 1] = Math.round(image.data[offset + 1] * alpha + bg * (1 - alpha))
      out.data[offset + 2] = Math.round(image.data[offset + 2] * alpha + bg * (1 - alpha))
      out.data[offset + 3] = 255
    }
  }
  return out
}

function composeHorizontalPreview(images, { gap = 8 } = {}) {
  const width = images.reduce((sum, image) => sum + image.width, 0) + gap * Math.max(0, images.length - 1)
  const height = Math.max(...images.map((image) => image.height))
  const out = { width, height, data: new Uint8ClampedArray(width * height * 4) }
  for (let i = 0; i < out.data.length; i += 4) {
    out.data[i] = 28
    out.data[i + 1] = 31
    out.data[i + 2] = 36
    out.data[i + 3] = 255
  }
  let cursor = 0
  for (const image of images) {
    const yOffset = Math.floor((height - image.height) / 2)
    for (let y = 0; y < image.height; y++) {
      for (let x = 0; x < image.width; x++) {
        const src = (y * image.width + x) * 4
        const dst = ((y + yOffset) * width + cursor + x) * 4
        out.data[dst] = image.data[src]
        out.data[dst + 1] = image.data[src + 1]
        out.data[dst + 2] = image.data[src + 2]
        out.data[dst + 3] = image.data[src + 3]
      }
    }
    cursor += image.width + gap
  }
  return out
}

async function writeBackgroundPreview({ before, after, itemId, options }) {
  if (options.visualPreviews === false || !options.visualsDir) return null
  await mkdir(options.visualsDir, { recursive: true })
  const beforePreview = flattenToChecker(await resizeForPreview(before))
  const afterPreview = flattenToChecker(await resizeForPreview(after))
  const preview = composeHorizontalPreview([beforePreview, afterPreview])
  const fileName = `${safePreviewId(itemId)}_background_before_after.png`
  await writeFile(path.join(options.visualsDir, fileName), await encodeRgbaPng(preview))
  return `visuals/${fileName}`
}

function statusCounts(items) {
  const counts = { pass: 0, warning: 0, fail: 0, error: 0, skipped: 0 }
  for (const item of items) {
    const status = counts[item.status] === undefined ? 'error' : item.status
    counts[status] += 1
  }
  return counts
}

function qualitySpec(image, { visiblePixelCount = 0 } = {}) {
  const bbox = detectAlphaBBox(image)
  const canvasArea = image.width * image.height
  if (!bbox || !canvasArea) {
    return {
      bbox: null,
      metrics: {
        bbox_width_ratio: 0,
        bbox_height_ratio: 0,
        bbox_area_ratio: 0,
        visible_area_ratio: 0,
        center_offset_ratio: 0,
        edge_margin_ratio: 0,
      },
    }
  }
  const edgeMargin = Math.min(
    bbox.x,
    bbox.y,
    image.width - 1 - bbox.right,
    image.height - 1 - bbox.bottom
  )
  const centerOffsetX = Math.abs(bbox.centerX - ((image.width - 1) / 2))
  const centerOffsetY = Math.abs(bbox.centerY - ((image.height - 1) / 2))
  return {
    bbox: { x: bbox.x, y: bbox.y, w: bbox.w, h: bbox.h, right: bbox.right, bottom: bbox.bottom },
    metrics: {
      bbox_width_ratio: round(bbox.w / image.width),
      bbox_height_ratio: round(bbox.h / image.height),
      bbox_area_ratio: round((bbox.w * bbox.h) / canvasArea),
      visible_area_ratio: visiblePixelCount ? round(visiblePixelCount / canvasArea) : 0,
      center_offset_x_ratio: round(centerOffsetX / image.width),
      center_offset_y_ratio: round(centerOffsetY / image.height),
      center_offset_ratio: round(Math.max(centerOffsetX / image.width, centerOffsetY / image.height)),
      edge_margin_ratio: round(edgeMargin / Math.min(image.width, image.height)),
    },
  }
}

function thresholdsFromOptions(options = {}) {
  return {
    max_bbox_width_ratio: options.maxBboxWidthRatio ?? 0.72,
    max_bbox_height_ratio: options.maxBboxHeightRatio ?? 0.86,
    max_bbox_area_ratio: options.maxBboxAreaRatio ?? 0.42,
    max_center_offset_ratio: options.maxCenterOffsetRatio ?? 0.1,
    min_edge_margin_ratio: options.minEdgeMarginRatio ?? 0.035,
    max_palette_change_ratio: options.maxPaletteChangeRatio ?? 0.7,
    max_outline_ratio: options.maxOutlineRatio ?? 0.08,
  }
}

function singleCharacterIssues({ spec, styleReport, paletteSnap, outline, downsample, background, thresholds }) {
  const warnings = [...(background.warnings ?? [])]
  const blocking = []
  if (!spec.bbox) blocking.push('image.empty_or_no_visible_character')
  const metrics = spec.metrics
  if (metrics.bbox_width_ratio > thresholds.max_bbox_width_ratio) warnings.push('single_character.bbox_width_high')
  if (metrics.bbox_height_ratio > thresholds.max_bbox_height_ratio) warnings.push('single_character.bbox_height_high')
  if (metrics.bbox_area_ratio > thresholds.max_bbox_area_ratio) warnings.push('single_character.bbox_area_high')
  if (metrics.center_offset_ratio > thresholds.max_center_offset_ratio) warnings.push('single_character.center_offset_high')
  if (metrics.edge_margin_ratio < thresholds.min_edge_margin_ratio) warnings.push('single_character.edge_margin_low')
  if ((paletteSnap.report.changed_pixel_ratio ?? 0) > thresholds.max_palette_change_ratio) warnings.push('single_character.palette_change_high')
  if ((outline.report.outline_pixel_ratio ?? 0) > thresholds.max_outline_ratio) warnings.push('single_character.outline_ratio_high')
  if (downsample.status === 'skipped') warnings.push('single_character.downsample_skipped')
  if (!styleReport.metrics?.visible_pixel_count) blocking.push('image.no_visible_pixels_after_background_cleanup')
  return { warnings, blocking_errors: [...new Set(blocking)] }
}

function runDownsample(image, factor) {
  if (!factor || factor < 2) return { status: 'disabled', factor: factor ?? null }
  if (image.width % factor !== 0 || image.height % factor !== 0) {
    return {
      status: 'skipped',
      factor,
      reason: 'image_dimensions_not_divisible_by_factor',
      input_size: { w: image.width, h: image.height },
    }
  }
  const output = downsampleNearest(image, { factor })
  return {
    status: 'done',
    factor,
    input_size: { w: image.width, h: image.height },
    output_size: { w: output.width, h: output.height },
  }
}

async function analyzeSingleCharacterSample({ sample, filePath, buffer, options }) {
  const raw = await loadRgba(buffer)
  const requestedBackgroundMode = benchmarkBackgroundMode(sample, options)
  const background = await removeBackground(raw, {
    backgroundMode: requestedBackgroundMode,
    backgroundTolerance: sample.background_tolerance ?? options.backgroundTolerance,
  })
  const styleReport = buildPixelStyleReport(background.image, { maxColors: options.styleMaxColors })
  const paletteSnap = applyPixelStyleCorrection(background.image, { maxColors: options.styleMaxColors })
  const downsample = runDownsample(paletteSnap.image, options.downsampleFactor)
  const outline = options.outline === false
    ? { report: { mode: 'alpha_outline', output_mutation: 'none', outline_pixel_count: 0, outline_pixel_ratio: 0 } }
    : strengthenAlphaOutline(paletteSnap.image)
  const spec = qualitySpec(paletteSnap.image, {
    visiblePixelCount: styleReport.metrics?.visible_pixel_count ?? 0,
  })
  const thresholds = thresholdsFromOptions(options)
  const issues = singleCharacterIssues({ spec, styleReport, paletteSnap, outline, downsample, background, thresholds })
  const status = issues.blocking_errors.length ? 'fail' : issues.warnings.length ? 'warning' : 'pass'
  const backgroundPreview = await writeBackgroundPreview({ before: raw, after: background.image, itemId: sample.id, options })
  return {
    id: sample.id,
    kind: 'single_character',
    profile: sample.profile ?? 'quality_character_v0',
    file: sample.file,
    file_path: filePath,
    status,
    expected_status: sample.expected_status ?? null,
    expectation_met: sample.expected_status ? sample.expected_status === status : null,
    image: { width: raw.width, height: raw.height },
    background: {
      requested_mode: requestedBackgroundMode,
      mode: background.mode,
      warnings: background.warnings ?? [],
    },
    visual_previews: backgroundPreview ? { background_before_after: backgroundPreview } : {},
    warnings: issues.warnings,
    blocking_errors: issues.blocking_errors,
    metrics: {
      ...styleReport.metrics,
      ...spec.metrics,
      palette_changed_pixel_ratio: paletteSnap.report.changed_pixel_ratio,
      outline_pixel_ratio: outline.report.outline_pixel_ratio,
    },
    bbox: spec.bbox,
    style: {
      palette_color_count: styleReport.palette.colors.length,
      palette: styleReport.palette.colors.slice(0, 12),
    },
    finishing: {
      palette_snap: {
        changed_pixel_count: paletteSnap.report.changed_pixel_count,
        changed_pixel_ratio: paletteSnap.report.changed_pixel_ratio,
      },
      downsample,
      outline: outline.report,
    },
    expected_checks: sample.expected_checks ?? [],
    notes: sample.notes ?? '',
  }
}

async function analyzeSheetSample({ sample, filePath, buffer, options }) {
  const sourceLayout = sample.source_layout ?? sample.profile
  const requestedBackgroundMode = benchmarkBackgroundMode(sample, options)
  const result = await processSheetBuffer(buffer, {
    name: sample.name ?? sample.id,
    description: sample.description ?? sample.notes ?? '',
    sourceFileName: path.basename(filePath),
    sourceLayout,
    backgroundMode: requestedBackgroundMode,
    styleReport: true,
    styleMaxColors: options.styleMaxColors,
  })
  const validation = result.debugReport.validation
  const backgroundPreview = await writeBackgroundPreview({
    before: await loadRgba(result.files.sourcePng),
    after: await loadRgba(result.files.normalizedSheetPng),
    itemId: sample.id,
    options,
  })
  return {
    id: sample.id,
    kind: normalizeKind(sample.kind),
    profile: sample.profile ?? sourceLayout,
    file: sample.file,
    file_path: filePath,
    status: validation.status,
    expected_status: sample.expected_status ?? null,
    expectation_met: sample.expected_status ? sample.expected_status === validation.status : null,
    processing: {
      id: result.id,
      source_layout: result.debugReport.source_layout?.id ?? sourceLayout,
      requested_background_mode: requestedBackgroundMode,
      background_mode: result.debugReport.background_mode,
      background_selection: result.debugReport.background_selection ?? null,
    },
    visual_previews: backgroundPreview ? { background_before_after: backgroundPreview } : {},
    warnings: validation.warnings ?? [],
    blocking_errors: validation.blocking_errors ?? [],
    metrics: validation.metrics ?? {},
    expected_checks: sample.expected_checks ?? [],
    notes: sample.notes ?? '',
  }
}

function resolveSamplePath(baseDir, sample) {
  if (!sample.file) throw new Error(`local image sample ${sample.id ?? '<missing-id>'} requires file`)
  const resolved = path.resolve(baseDir, sample.file)
  const normalizedBase = path.resolve(baseDir)
  if (resolved !== normalizedBase && !resolved.startsWith(`${normalizedBase}${path.sep}`)) {
    throw new Error(`local image sample ${sample.id ?? sample.file} must stay inside the manifest directory`)
  }
  return resolved
}

function shouldAnalyzeAsSingleCharacter(sample) {
  const kind = normalizeKind(sample.kind)
  if (kind === 'single_character') return true
  if (kind === 'bad_case' && SINGLE_CHARACTER_PROFILES.has(sample.profile)) return true
  return SINGLE_CHARACTER_PROFILES.has(sample.profile)
}

function shouldAnalyzeAsSheet(sample) {
  const kind = normalizeKind(sample.kind)
  if (kind === 'topdown_sheet' || kind === 'ocad_sheet') return true
  if (kind === 'bad_case' && SHEET_PROFILES.has(sample.profile)) return true
  return SHEET_PROFILES.has(sample.profile)
}

async function analyzeSample({ sample, baseDir, options }) {
  const filePath = resolveSamplePath(baseDir, sample)
  const buffer = await readFile(filePath)
  if (shouldAnalyzeAsSingleCharacter(sample)) return analyzeSingleCharacterSample({ sample, filePath, buffer, options })
  if (shouldAnalyzeAsSheet(sample)) return analyzeSheetSample({ sample, filePath, buffer, options })
  throw new Error(`Unsupported local image sample kind/profile: ${sample.kind ?? 'unknown'} / ${sample.profile ?? 'unknown'}`)
}

function compactSingleCharacterSweepItem(mode, item) {
  return {
    requested_mode: mode,
    selected_mode: item.background?.mode ?? null,
    status: item.status,
    warning_count: (item.warnings ?? []).length,
    blocking_error_count: (item.blocking_errors ?? []).length,
    warnings: item.warnings ?? [],
    blocking_errors: item.blocking_errors ?? [],
    background_warnings: item.background?.warnings ?? [],
    metrics: {
      visible_pixel_count: item.metrics?.visible_pixel_count ?? null,
      unique_color_count: item.metrics?.unique_color_count ?? null,
      bbox_width_ratio: item.metrics?.bbox_width_ratio ?? null,
      bbox_height_ratio: item.metrics?.bbox_height_ratio ?? null,
      bbox_area_ratio: item.metrics?.bbox_area_ratio ?? null,
      center_offset_ratio: item.metrics?.center_offset_ratio ?? null,
      edge_margin_ratio: item.metrics?.edge_margin_ratio ?? null,
      palette_changed_pixel_ratio: item.metrics?.palette_changed_pixel_ratio ?? null,
      outline_pixel_ratio: item.metrics?.outline_pixel_ratio ?? null,
    },
  }
}

function compactSheetSweepItem(mode, item) {
  const metrics = item.metrics ?? {}
  return {
    requested_mode: mode,
    selected_mode: item.processing?.background_mode ?? null,
    status: item.status,
    warning_count: (item.warnings ?? []).length,
    blocking_error_count: (item.blocking_errors ?? []).length,
    warnings: item.warnings ?? [],
    blocking_errors: item.blocking_errors ?? [],
    metrics: {
      halo_score: metrics.halo_score ?? null,
      near_white_edge_pixels: metrics.background_residue?.near_white_edge_pixels ?? null,
      background_residue_passed: metrics.background_residue?.passed ?? null,
      edge_pressure_severe_frames: metrics.edge_pressure?.severe_frame_count ?? null,
      source_region_pressured_count: metrics.source_region_edge_pressure?.pressured_region_count ?? null,
      source_region_severe_count: metrics.source_region_edge_pressure?.severe_region_count ?? null,
      duplicate_group_count: Array.isArray(metrics.duplicate_frames) ? metrics.duplicate_frames.length : null,
    },
  }
}

function compactSweepError(mode, error) {
  return {
    requested_mode: mode,
    selected_mode: null,
    status: 'error',
    warning_count: 0,
    blocking_error_count: 1,
    warnings: [],
    blocking_errors: ['background_sweep.error'],
    error: error.message ?? String(error),
    metrics: {},
  }
}

function sweepPenalty(item) {
  const metrics = item.metrics ?? {}
  return (
    (item.warning_count ?? 0) * 10 +
    (item.blocking_error_count ?? 0) * 100 +
    Number(metrics.halo_score ?? 0) * 3 +
    Number(metrics.near_white_edge_pixels ?? 0) * 0.01 +
    Number(metrics.edge_pressure_severe_frames ?? 0) * 5 +
    Number(metrics.source_region_severe_count ?? 0) * 2 +
    Number(metrics.bbox_area_ratio ?? 0) * 3 +
    Math.max(0, Number(metrics.palette_changed_pixel_ratio ?? 0) - 0.7) * 20
  )
}

function recommendedSweepMode(results) {
  if (!results.length) return null
  const sorted = results
    .slice()
    .sort((a, b) => {
      const statusDelta = (STATUS_RANK[b.status] ?? 0) - (STATUS_RANK[a.status] ?? 0)
      if (statusDelta) return statusDelta
      return sweepPenalty(a) - sweepPenalty(b)
    })
  return sorted[0].requested_mode
}

async function buildBackgroundSweep({ sample, baseDir, options }) {
  const modes = normalizeModeList(options.backgroundSweepModes)
  if (!modes.length) return null
  const filePath = resolveSamplePath(baseDir, sample)
  const buffer = await readFile(filePath)
  const results = []
  for (const mode of modes) {
    try {
      const item = shouldAnalyzeAsSingleCharacter(sample)
        ? await analyzeSingleCharacterSample({ sample, filePath, buffer, options: { ...options, backgroundModeOverride: mode, visualPreviews: false } })
        : await analyzeSheetSample({ sample, filePath, buffer, options: { ...options, backgroundModeOverride: mode, visualPreviews: false } })
      results.push(shouldAnalyzeAsSingleCharacter(sample) ? compactSingleCharacterSweepItem(mode, item) : compactSheetSweepItem(mode, item))
    } catch (error) {
      results.push(compactSweepError(mode, error))
    }
  }
  return {
    modes,
    recommended_mode: recommendedSweepMode(results),
    results,
  }
}

function failedItem(sample, error) {
  return {
    id: sample.id ?? sample.file ?? 'unknown',
    kind: normalizeKind(sample.kind),
    profile: sample.profile ?? null,
    file: sample.file ?? null,
    status: 'error',
    expected_status: sample.expected_status ?? null,
    expectation_met: sample.expected_status ? sample.expected_status === 'error' : null,
    warnings: [],
    blocking_errors: ['local_image_benchmark.error'],
    error: error.message ?? String(error),
    expected_checks: sample.expected_checks ?? [],
    notes: sample.notes ?? '',
  }
}

function selectSamples(manifest, { sampleIds = [], kinds = [] } = {}) {
  const idSet = new Set(sampleIds)
  const kindSet = new Set(kinds.map(normalizeKind))
  const samples = Array.isArray(manifest.samples) ? manifest.samples : []
  return samples.filter((sample) => {
    if (idSet.size && !idSet.has(sample.id)) return false
    if (kindSet.size && !kindSet.has(normalizeKind(sample.kind))) return false
    return true
  })
}

function summaryForItems(items) {
  const validation = statusCounts(items)
  const usable = validation.pass + validation.warning
  const expectationItems = items.filter((item) => item.expectation_met !== null)
  const expectationMet = expectationItems.filter((item) => item.expectation_met).length
  return {
    total: items.length,
    validation,
    usable_count: usable,
    usable_rate: items.length ? round(usable / items.length) : 0,
    expectation_count: expectationItems.length,
    expectation_met_count: expectationMet,
    expectation_met_rate: expectationItems.length ? round(expectationMet / expectationItems.length) : null,
  }
}

function markdownForReport(report) {
  return [
    `# Local Image Benchmark ${report.run_id}`,
    '',
    `Mode: \`${report.mode}\``,
    `Gate layer: \`${report.gate_layer.id}\``,
    `Quality gate: \`${report.quality_gate.status}\``,
    `Manifest: \`${report.manifest.path}\``,
    `Samples: ${report.summary.total}`,
    `Usable rate: ${report.summary.usable_rate}`,
    '',
    '## Gate Interpretation',
    '',
    `- pass: ${report.quality_gate.interpretation.pass}`,
    `- warning: ${report.quality_gate.interpretation.warning}`,
    `- fail: ${report.quality_gate.interpretation.fail}`,
    `- Claim boundary: ${report.quality_gate.claim_boundary}`,
    '',
    '## Gate Checks',
    '',
    '| Gate | Status | Message |',
    '|---|---|---|',
    ...report.quality_gate.gates.map((item) => `| ${item.id} | ${item.status} | ${item.message} |`),
    '',
    '| Sample | Kind | Profile | Status | Warnings | Blocking Errors | Preview |',
    '|---|---|---|---:|---:|---:|---|',
    ...report.items.map((item) => {
      const preview = item.visual_previews?.background_before_after
      return `| ${item.id} | ${item.kind} | ${item.profile ?? ''} | ${item.status} | ${(item.warnings ?? []).length} | ${(item.blocking_errors ?? []).length} | ${preview ? `[before/after](${preview})` : ''} |`
    }),
    '',
  ].join('\n')
}

function html(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function metricList(metrics = {}) {
  const keys = [
    'visible_pixel_count',
    'unique_color_count',
    'bbox_width_ratio',
    'bbox_height_ratio',
    'bbox_area_ratio',
    'center_offset_ratio',
    'edge_margin_ratio',
    'palette_changed_pixel_ratio',
    'outline_pixel_ratio',
    'halo_score',
  ]
  return keys
    .filter((key) => metrics[key] !== undefined && metrics[key] !== null)
    .map((key) => `<li><span>${html(key)}</span><strong>${html(metrics[key])}</strong></li>`)
    .join('')
}

function buildHtmlReport(report) {
  const itemCards = report.items.map((item) => {
    const preview = item.visual_previews?.background_before_after
    const warnings = (item.warnings ?? []).map((warning) => `<li>${html(warning)}</li>`).join('')
    const blocking = (item.blocking_errors ?? []).map((error) => `<li>${html(error)}</li>`).join('')
    return `
      <article class="item" data-status="${html(item.status)}">
        <header>
          <div>
            <h2>${html(item.id)}</h2>
            <p>${html(item.kind)} / ${html(item.profile ?? '')}</p>
          </div>
          <strong>${html(item.status)}</strong>
        </header>
        ${preview ? `<img src="${html(preview)}" alt="${html(item.id)} before and after preview">` : '<div class="no-preview">No visual preview</div>'}
        <section>
          <h3>Metrics</h3>
          <ul class="metrics">${metricList(item.metrics)}</ul>
        </section>
        <section class="issues">
          <div><h3>Warnings</h3><ul>${warnings || '<li>none</li>'}</ul></div>
          <div><h3>Blocking</h3><ul>${blocking || '<li>none</li>'}</ul></div>
        </section>
      </article>
    `
  }).join('\n')

  const gateRows = report.quality_gate.gates
    .map((gate) => `<tr><td>${html(gate.id)}</td><td>${html(gate.status)}</td><td>${html(gate.message)}</td></tr>`)
    .join('')

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Local Image Benchmark ${html(report.run_id)}</title>
  <style>
    :root { color-scheme: dark; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #101419; color: #edf2f7; }
    body { margin: 0; padding: 24px; }
    main { max-width: 1180px; margin: 0 auto; }
    .summary { border: 1px solid #2d3748; padding: 16px; border-radius: 8px; background: #151b22; }
    .summary dl { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin: 0; }
    dt { color: #9aa7b5; font-size: 12px; text-transform: uppercase; }
    dd { margin: 4px 0 0; font-size: 18px; font-weight: 700; }
    table { width: 100%; border-collapse: collapse; margin-top: 18px; }
    th, td { border-bottom: 1px solid #2d3748; padding: 8px; text-align: left; vertical-align: top; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; margin-top: 20px; }
    .item { border: 1px solid #2d3748; border-radius: 8px; background: #151b22; overflow: hidden; }
    .item header { display: flex; justify-content: space-between; gap: 12px; padding: 14px; border-bottom: 1px solid #2d3748; }
    .item h2, .item h3 { margin: 0; }
    .item p { margin: 4px 0 0; color: #9aa7b5; }
    .item img { display: block; width: 100%; image-rendering: pixelated; background: #0b0e12; }
    .no-preview { padding: 40px 14px; color: #9aa7b5; background: #0b0e12; }
    section { padding: 14px; }
    ul { margin: 8px 0 0; padding-left: 18px; }
    .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 8px; padding-left: 0; list-style: none; }
    .metrics li { display: flex; justify-content: space-between; gap: 8px; border-bottom: 1px solid #26313d; padding-bottom: 4px; }
    .metrics span { color: #9aa7b5; }
    .issues { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    [data-status="pass"] header strong { color: #72d391; }
    [data-status="warning"] header strong { color: #f6c85f; }
    [data-status="fail"], [data-status="error"] header strong { color: #ff7a7a; }
  </style>
</head>
<body>
<main>
  <h1>Local Image Benchmark ${html(report.run_id)}</h1>
  <section class="summary">
    <dl>
      <div><dt>Mode</dt><dd>${html(report.mode)}</dd></div>
      <div><dt>Gate Layer</dt><dd>${html(report.gate_layer.id)}</dd></div>
      <div><dt>Quality Gate</dt><dd>${html(report.quality_gate.status)}</dd></div>
      <div><dt>Samples</dt><dd>${html(report.summary.total)}</dd></div>
      <div><dt>Usable Rate</dt><dd>${html(report.summary.usable_rate)}</dd></div>
    </dl>
  </section>
  <h2>Gate Checks</h2>
  <table><thead><tr><th>Gate</th><th>Status</th><th>Message</th></tr></thead><tbody>${gateRows}</tbody></table>
  <h2>Samples</h2>
  <section class="grid">${itemCards}</section>
</main>
</body>
</html>
`
}

export async function runLocalImageBenchmark({
  manifestPath = DEFAULT_LOCAL_IMAGE_MANIFEST,
  outputDir = 'generated/local-image-benchmarks',
  runId = buildRunId(),
  sampleIds = [],
  kinds = [],
  backgroundMode = 'auto',
  backgroundSweep = false,
  backgroundSweepModes = DEFAULT_BACKGROUND_SWEEP_MODES,
  backgroundTolerance,
  styleMaxColors = 16,
  downsampleFactor = 2,
  outline = true,
  visualPreviews = true,
  gateLayer = 'local-golden',
} = {}) {
  const gateLayerDefinition = assertProviderFreeQualityGateLayer(gateLayer, 'benchmark local-images')
  const resolvedManifest = path.resolve(manifestPath)
  const baseDir = path.dirname(resolvedManifest)
  const manifest = JSON.parse(await readFile(resolvedManifest, 'utf8'))
  const manifestValidation = await validateLocalImageManifest({ manifestPath: resolvedManifest })
  const samples = selectSamples(manifest, { sampleIds, kinds })
  const runDir = path.join(outputDir, runId)
  await mkdir(runDir, { recursive: true })
  const options = {
    backgroundMode,
    backgroundSweep,
    backgroundSweepModes: normalizeModeList(backgroundSweepModes),
    backgroundTolerance,
    styleMaxColors,
    downsampleFactor,
    outline,
    visualPreviews,
  }
  const runtimeOptions = {
    ...options,
    visualsDir: path.join(runDir, 'visuals'),
  }
  const items = []
  for (const sample of samples) {
    try {
      const item = await analyzeSample({ sample, baseDir, options: runtimeOptions })
      if (backgroundSweep) item.background_sweep = await buildBackgroundSweep({ sample, baseDir, options: runtimeOptions })
      items.push(item)
    } catch (error) {
      items.push(failedItem(sample, error))
    }
  }
  const summary = summaryForItems(items)
  const qualityGate = evaluateLocalImageQualityGate({
    layer: gateLayerDefinition.id,
    summary,
    manifestValidation,
  })
  const report = {
    schema_version: 1,
    run_id: runId,
    created_at: new Date().toISOString(),
    mode: 'provider_free',
    gate_layer: {
      id: gateLayerDefinition.id,
      mode: gateLayerDefinition.mode,
      quota_required: gateLayerDefinition.quota_required,
      purpose: gateLayerDefinition.purpose,
    },
    manifest: {
      path: resolvedManifest,
      fixture_set: manifest.fixture_set ?? null,
      schema_version: manifest.schema_version ?? null,
      legacy_exclusions: manifest.legacy_exclusions ?? [],
    },
    manifest_validation: manifestValidation.summary,
    filters: {
      sample_ids: sampleIds,
      kinds: kinds.map(normalizeKind),
    },
    options,
    summary,
    quality_gate: qualityGate,
    items,
  }
  report.markdown = markdownForReport(report)
  const htmlReport = buildHtmlReport(report)
  await writeFile(path.join(runDir, 'local_image_benchmark.json'), JSON.stringify(report, null, 2))
  await writeFile(path.join(runDir, 'local_image_benchmark.md'), report.markdown)
  await writeFile(path.join(runDir, 'local_image_benchmark.html'), htmlReport)
  return report
}
