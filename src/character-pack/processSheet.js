import { buildEngineExportArtifacts, buildRowGifPreviewArtifacts, composeSheet } from './processArtifacts.js'
import { buildAnimationsJson, buildEditorMetadataJson, buildMetadataJson, buildPackageId } from './packageBuilder.js'
import { renderDebugOverlayPng, renderOnionSkinOverlayPng, renderSourceLayoutOverlayPng } from './debugOverlay.js'
import { encodeRgbaPng } from './imageCodec.js'
import { buildInspectionPreviewArtifacts } from './inspectionPreview.js'
import { buildMultiResolutionArtifacts } from './multiResolution.js'
import { buildFramePipeline } from './framePipeline.js'
import { applyAnchorOffset, resolveAnchorOffset } from './processingOptions.js'
import { buildDebugReport, buildValidationStage } from './processReport.js'
import { prepareSourceForProcessing } from './sourcePreparation.js'
import { applyPixelFinishing, buildPixelStyleReport } from './stylePipeline.js'
import { TOPDOWN_RPG_V0 } from './profile.js'
import {
  getRuntimeAnimationSemantics,
  getScaledSourceLayoutRegions,
  getSourceLayoutActions,
  resolveSourceLayout,
} from './sourceLayouts.js'
import { buildCharacterPackZip } from './zipExport.js'

const BACKGROUND_STATUS_RANK = Object.freeze({ pass: 3, warning: 2, fail: 1, error: 0 })

function backgroundMetricSummary(validation) {
  const metrics = validation.metrics ?? {}
  return {
    halo_score: metrics.halo_score ?? null,
    near_white_edge_pixels: metrics.background_residue?.near_white_edge_pixels ?? null,
    background_residue_passed: metrics.background_residue?.passed ?? null,
    edge_pressure_severe_frames: metrics.edge_pressure?.severe_frame_count ?? null,
    source_region_severe_count: metrics.source_region_edge_pressure?.severe_region_count ?? null,
    source_region_pressured_count: metrics.source_region_edge_pressure?.pressured_region_count ?? null,
    duplicate_group_count: Array.isArray(metrics.duplicate_frames) ? metrics.duplicate_frames.length : null,
  }
}

function backgroundCandidatePenalty(summary) {
  const metrics = summary.metrics ?? {}
  return (
    summary.blocking_error_count * 1000 +
    summary.warning_count * 20 +
    (metrics.background_residue_passed === false ? 80 : 0) +
    Number(metrics.halo_score ?? 0) * 3 +
    Number(metrics.near_white_edge_pixels ?? 0) * 0.01 +
    Number(metrics.edge_pressure_severe_frames ?? 0) * 8 +
    Number(metrics.source_region_severe_count ?? 0) * 2
  )
}

function summarizeBackgroundCandidate(candidate) {
  const validation = candidate.validationStage.validation
  const summary = {
    requested_mode: candidate.requestedMode,
    selected_mode: candidate.source.background.mode,
    status: validation.status,
    warning_count: (validation.warnings ?? []).length,
    blocking_error_count: (validation.blocking_errors ?? []).length,
    metrics: backgroundMetricSummary(validation),
  }
  return {
    ...summary,
    score: backgroundCandidatePenalty(summary),
  }
}

function chooseBackgroundCandidate(candidates) {
  const baseline = candidates[0]
  const ranked = candidates
    .slice()
    .sort((a, b) => {
      const statusDelta =
        (BACKGROUND_STATUS_RANK[b.summary.status] ?? 0) -
        (BACKGROUND_STATUS_RANK[a.summary.status] ?? 0)
      if (statusDelta) return statusDelta
      const scoreDelta = a.summary.score - b.summary.score
      if (Math.abs(scoreDelta) > 0.001) return scoreDelta
      return candidates.indexOf(a) - candidates.indexOf(b)
    })
  const winner = ranked[0]
  const baselineRank = BACKGROUND_STATUS_RANK[baseline.summary.status] ?? 0
  const winnerRank = BACKGROUND_STATUS_RANK[winner.summary.status] ?? 0
  if (winner === baseline) return baseline
  if (winnerRank > baselineRank) return winner
  if (winnerRank === baselineRank && winner.summary.score + 0.001 < baseline.summary.score) return winner
  return baseline
}

async function buildProcessingStage(buffer, { sourceLayout, profile, options }) {
  const source = await prepareSourceForProcessing(buffer, sourceLayout, options)
  const framesStage = buildFramePipeline({ transparent: source.transparent, profile, sourceLayout, options })
  const validationStage = buildValidationStage({
    frames: framesStage.frames,
    profile,
    sourceRegionEdgePressure: framesStage.sourceRegionEdgePressure,
    sourceQualityReport: framesStage.sourceQualityReport,
    backgroundWarnings: source.background.warnings,
  })
  return { source, framesStage, validationStage }
}

async function resolveBackgroundProcessingStage(buffer, { sourceLayout, profile, options }) {
  const requestedMode = options.backgroundMode ?? 'auto'
  const baseline = await buildProcessingStage(buffer, { sourceLayout, profile, options })
  if (requestedMode !== 'auto') return baseline
  if (baseline.source.background.mode === 'alpha_cleanup') {
    baseline.source.background.selection = {
      enabled: true,
      method: 'alpha_preservation',
      selected_mode: baseline.source.background.mode,
      candidates: [summarizeBackgroundCandidate({ ...baseline, requestedMode })],
    }
    return baseline
  }
  if (baseline.source.background.mode === 'edge_palette') {
    baseline.source.background.selection = {
      enabled: true,
      method: 'edge_palette_heuristic',
      selected_mode: baseline.source.background.mode,
      candidates: [summarizeBackgroundCandidate({ ...baseline, requestedMode })],
    }
    return baseline
  }

  const edgePalette = await buildProcessingStage(buffer, {
    sourceLayout,
    profile,
    options: { ...options, backgroundMode: 'edge_palette' },
  })
  const candidates = [
    { ...baseline, requestedMode },
    { ...edgePalette, requestedMode: 'edge_palette' },
  ].map((candidate) => ({
    ...candidate,
    summary: summarizeBackgroundCandidate(candidate),
  }))
  const selected = chooseBackgroundCandidate(candidates)
  selected.source.background.selection = {
    enabled: true,
    method: 'validation_candidate_score',
    selected_mode: selected.source.background.mode,
    selected_requested_mode: selected.requestedMode,
    candidates: candidates.map((candidate) => candidate.summary),
  }
  return selected
}

function shouldApplyPixelFinishing(options = {}) {
  return options.pixelFinishing === true || options.pixel_finishing === true
}

function pixelFinishingOptions(options = {}, profile = TOPDOWN_RPG_V0) {
  return {
    maxColors: Number(options.pixelFinishingMaxColors ?? options.pixel_finishing_max_colors ?? options.styleMaxColors ?? 16),
    cleanupMinAlpha: Number(options.pixelFinishingMinAlpha ?? options.pixel_finishing_min_alpha ?? options.cleanupMinAlpha ?? options.minAlpha ?? 18),
    componentCleanup: options.pixelFinishingComponentCleanup ?? options.pixel_finishing_component_cleanup ?? options.componentCleanup ?? true,
    componentCleanupMinArea: Number(options.pixelFinishingMinArea ?? options.pixel_finishing_min_area ?? options.componentCleanupMinArea ?? options.minArea ?? 4),
    componentCleanupMinAreaRatio: Number(options.pixelFinishingMinAreaRatio ?? options.pixel_finishing_min_area_ratio ?? options.componentCleanupMinAreaRatio ?? options.minAreaRatio ?? 0),
    outline: options.pixelFinishingOutline ?? options.pixel_finishing_outline ?? true,
    outlineMode: options.pixelFinishingOutlineMode ?? options.pixel_finishing_outline_mode ?? 'outer',
    outlineColor: options.pixelFinishingOutlineColor ?? options.pixel_finishing_outline_color ?? [24, 24, 32],
    gridMode: 'profile_cell_grid',
    cellSize: profile.frame,
  }
}

function frameImageFromSheet(sheet, frameIndex, profile) {
  const col = frameIndex % profile.grid.columns
  const row = Math.floor(frameIndex / profile.grid.columns)
  const image = { width: profile.frame.w, height: profile.frame.h, data: new Uint8ClampedArray(profile.frame.w * profile.frame.h * 4) }
  for (let y = 0; y < profile.frame.h; y++) {
    for (let x = 0; x < profile.frame.w; x++) {
      const src = ((row * profile.frame.h + y) * sheet.width + col * profile.frame.w + x) * 4
      const dst = (y * profile.frame.w + x) * 4
      image.data[dst] = sheet.data[src]
      image.data[dst + 1] = sheet.data[src + 1]
      image.data[dst + 2] = sheet.data[src + 2]
      image.data[dst + 3] = sheet.data[src + 3]
    }
  }
  return image
}

function replaceFrameImagesFromSheet(frames, sheet, profile) {
  return frames.map((frame) => ({
    ...frame,
    image: frameImageFromSheet(sheet, frame.index, profile),
  }))
}

export async function processSheetBuffer(buffer, options = {}) {
  const baseProfile = options.profile ?? TOPDOWN_RPG_V0
  const anchorOffset = resolveAnchorOffset(options)
  const profile = applyAnchorOffset(baseProfile, anchorOffset)
  const sourceLayout = resolveSourceLayout(options.sourceLayout ?? options.sourceProfile ?? profile.id)
  const processingStage = await resolveBackgroundProcessingStage(buffer, { sourceLayout, profile, options })
  const source = processingStage.source
  const framesStage = processingStage.framesStage
  let frames = framesStage.frames
  let normalizedSheet = composeSheet(frames, profile)
  let pixelStyleReport = null
  if (shouldApplyPixelFinishing(options)) {
    const finishing = applyPixelFinishing(normalizedSheet, pixelFinishingOptions(options, profile))
    normalizedSheet = finishing.image
    frames = replaceFrameImagesFromSheet(frames, normalizedSheet, profile)
    pixelStyleReport = finishing.report
  } else if (options.styleReport) {
    pixelStyleReport = buildPixelStyleReport(normalizedSheet, { maxColors: options.styleMaxColors ?? 16 })
  }
  const validationStage = shouldApplyPixelFinishing(options)
    ? buildValidationStage({
      frames,
      profile,
      sourceRegionEdgePressure: framesStage.sourceRegionEdgePressure,
      sourceQualityReport: framesStage.sourceQualityReport,
      backgroundWarnings: source.background.warnings,
    })
    : processingStage.validationStage
  const validationWithBackground = validationStage.validation
  const id = buildPackageId(options.name ?? 'character', options.createdAt ?? new Date())
  const sourceLayoutSummary = {
    id: sourceLayout.id,
    kind: sourceLayout.kind,
    label: sourceLayout.label,
    target_profile: profile.id,
    actions: getSourceLayoutActions(sourceLayout),
  }
  const animationsJson = buildAnimationsJson(profile, {
    sourceLayout: sourceLayoutSummary,
    animationSemantics: getRuntimeAnimationSemantics(sourceLayout, profile),
  })
  const metadataJson = buildMetadataJson({
    id,
    name: options.name ?? 'Character',
    description: options.description ?? '',
    createdAt: options.createdAt ?? new Date().toISOString(),
    source: options.source ?? { type: options.sourceType ?? 'upload', file_name: options.sourceFileName ?? 'source.png' },
    generation: options.generation,
    quality: {
      status: validationWithBackground.status,
      warnings: validationWithBackground.warnings,
      blocking_errors: validationWithBackground.blocking_errors,
    },
    profile,
  })
  const editorMetadataJson = buildEditorMetadataJson({
    metadata: metadataJson,
    animationsJson,
    frames,
    profile,
    sourceLayout: sourceLayoutSummary,
  })
  const rowGifArtifacts = buildRowGifPreviewArtifacts({
    transparent: source.transparent,
    sourceLayout,
    profile,
    animations: animationsJson.animations,
    frames,
    options,
  })
  const rowPreviews = rowGifArtifacts.rowPreviews
  const rowGifBuffers = rowGifArtifacts.rowGifBuffers
  const inspectionPreviewArtifacts = await buildInspectionPreviewArtifacts({
    rowPreviews,
    rowPreviewFrames: rowGifArtifacts.rowPreviewFrames,
  })
  const debugReport = buildDebugReport({
    profile,
    sourceLayoutSummary,
    sourceRegionEdgePressure: framesStage.sourceRegionEdgePressure,
    sourceQualityReport: framesStage.sourceQualityReport,
    sourceStagingReport: source.sourceStaging.report,
    sourcePreprocessReport: source.sourcePreprocess.report,
    grid: framesStage.grid,
    fixedSource: framesStage.fixedSource,
    options,
    background: source.background,
    componentCleanup: framesStage.componentCleanup,
    anchorOffset,
    baseProfile,
    normalized: framesStage.normalized,
    autoCorrection: framesStage.autoCorrection,
    lockedAnimations: framesStage.lockedAnimations,
    motionStabilization: framesStage.motionStabilization,
    manualAdjustments: framesStage.manualAdjustments,
    validation: validationWithBackground,
    frames,
    pixelStyleReport,
    inspectionPreview: inspectionPreviewArtifacts.report,
  })
  const normalizedSheetPng = await encodeRgbaPng(normalizedSheet)
  const multiResolution = await buildMultiResolutionArtifacts({
    normalizedSheet,
    normalizedSheetPng,
    profile,
    sizes: options.outputFrameSizes,
  })
  const exportArtifacts = await buildEngineExportArtifacts({
    metadataJson,
    frames,
    profile,
    normalizedSheetPng,
    sourcePng: source.sourcePng,
    sourceLayout,
  })
  const debugOverlayPng = await renderDebugOverlayPng({ profile, frames, baseSheet: normalizedSheetPng })
  const onionSkinOverlayPng = await renderOnionSkinOverlayPng({ profile, frames })
  const sourceLayoutOverlayPng = await renderSourceLayoutOverlayPng({
    sourcePng: source.sourcePng,
    width: source.raw.width,
    height: source.raw.height,
    grid: sourceLayout.kind === 'uniform_grid' ? framesStage.grid : null,
    regions: getScaledSourceLayoutRegions(source.raw, sourceLayout),
  })
  const promptTxt = options.promptText ? Buffer.from(String(options.promptText), 'utf8') : null
  const generationJson = options.generation ? Buffer.from(JSON.stringify(options.generation, null, 2), 'utf8') : null
  const sourceQualityReportJson = framesStage.sourceQualityReport
    ? Buffer.from(JSON.stringify(framesStage.sourceQualityReport, null, 2), 'utf8')
    : null
  const zipBuffer = await buildCharacterPackZip({
    'source.png': source.sourcePng,
    'source_layout_overlay.png': sourceLayoutOverlayPng,
    ...(sourceQualityReportJson ? { 'source_quality_report.json': sourceQualityReportJson } : {}),
    'normalized_sheet.png': normalizedSheetPng,
    'multi_resolution.json': multiResolution.manifest,
    ...Object.fromEntries(multiResolution.manifest.sheets.map((sheet) => [sheet.file, multiResolution.sheets[sheet.frame_size]])),
    'debug_overlay.png': debugOverlayPng,
    'onion_skin_overlay.png': onionSkinOverlayPng,
    'animations.json': animationsJson,
    'metadata.json': metadataJson,
    'editor_metadata.json': editorMetadataJson,
    'debug_report.json': debugReport,
    ...(promptTxt ? { 'prompt.txt': promptTxt } : {}),
    ...(generationJson ? { 'generation.json': generationJson } : {}),
    'inspection_index.json': inspectionPreviewArtifacts.indexJson,
    'inspection_sheet.png': inspectionPreviewArtifacts.sheetPng,
    ...inspectionPreviewArtifacts.gifBuffers,
    ...inspectionPreviewArtifacts.stripPngBuffers,
    ...rowGifBuffers,
    ...exportArtifacts.godotNpcExport.files,
    ...exportArtifacts.rpgmakerExport.files,
    ...exportArtifacts.ocadExport.files,
  })
  return {
    id,
    animationsJson,
    metadataJson,
    editorMetadataJson,
    debugReport,
    rowPreviews,
    inspectionPreviews: inspectionPreviewArtifacts.previews,
    files: {
      sourcePng: source.sourcePng,
      editorMetadataJson,
      sourceLayoutOverlayPng,
      sourceQualityReportJson,
      normalizedSheetPng,
      multiResolutionManifest: multiResolution.manifest,
      multiResolutionSheets: multiResolution.sheets,
      debugOverlayPng,
      onionSkinOverlayPng,
      godotNpcThumbPng: exportArtifacts.godotNpcThumbPng,
      godotNpcZipBuffer: exportArtifacts.godotNpcZipBuffer,
      godotNpcJson: exportArtifacts.godotNpcExport.npcJson,
      rpgmakerZipBuffer: exportArtifacts.rpgmakerZipBuffer,
      rpgmakerJson: exportArtifacts.rpgmakerExport.npcJson,
      rpgmakerSpritePng: exportArtifacts.rpgmakerExport.spritePng,
      rpgmakerThumbPng: exportArtifacts.rpgmakerExport.thumbPng,
      ocadZipBuffer: exportArtifacts.ocadZipBuffer,
      ocadJson: exportArtifacts.ocadExport.npcJson,
      ocadSpritePng: exportArtifacts.ocadExport.spritePng,
      ocadThumbPng: exportArtifacts.ocadExport.thumbPng,
      promptTxt,
      generationJson,
      inspectionIndexJson: inspectionPreviewArtifacts.indexJson,
      inspectionSheetPng: inspectionPreviewArtifacts.sheetPng,
      inspectionGifBuffers: inspectionPreviewArtifacts.gifBuffers,
      inspectionStripPngBuffers: inspectionPreviewArtifacts.stripPngBuffers,
      rowGifBuffers,
      zipBuffer,
    },
  }
}
