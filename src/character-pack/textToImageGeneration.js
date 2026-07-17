import {
  encodeRgbaPng,
  loadRgba,
} from './imageCodec.js'
import JSZip from 'jszip'
import { processSheetBuffer } from './processSheet.js'
import {
  normalizePixelGridRefinementOptions,
  PIXEL_GRID_RECIPE_IDS,
  refinePixelFrames,
} from './pixelGridRefinement.js'
import { generateCharacterSource } from './providers/geminiProvider.js'
import { isNonRetryableProviderError, providerErrorFailureStatus } from './providers/providerErrors.js'
import { prepareSourceForProcessing } from './sourcePreparation.js'
import {
  applyPixelStyleCorrection,
  buildPixelStyleReport,
  downsampleNearest,
  strengthenAlphaOutline,
} from './stylePipeline.js'
import {
  DEFAULT_T2I_CANDIDATE_COUNT,
  normalizeCandidateCount,
  normalizeGenerationOptions,
  normalizeTextToImageMode,
  resolveTextToImageAspectRatio,
  TEXT_TO_IMAGE_MODE_PRODUCTION_SHEET,
  TEXT_TO_IMAGE_MODE_QUALITY_CHARACTER,
} from './textToImagePrompt.js'
import { detectAlphaBBox } from './normalizer.js'
import { isFixedRegionMotionLayoutId } from './sourceLayouts.js'
import {
  evaluateProductionSheetReleaseGate,
  evaluateQualityCharacterReleaseGate,
} from './generationReleaseGate.js'

const STATUS_SCORE = Object.freeze({
  pass: 1000,
  warning: 650,
  fail: 0,
})

export const T2I_GOLDEN_CASES = Object.freeze([
  { id: 'silver_swordswoman_zh', locale: 'zh', description: '银发女剑士，深蓝披风，细长单手剑，金色护肩，小体型' },
  { id: 'blue_wizard_en', locale: 'en', description: 'blue wizard with crescent hat, tiny staff, readable robe silhouette' },
  { id: 'forest_ranger_zh', locale: 'zh', description: '森林游侠，绿色斗篷，皮甲，短弓，轻盈身形' },
  { id: 'crimson_knight_en', locale: 'en', description: 'crimson knight, compact armor, round shield, heroic readable silhouette' },
  { id: 'frog_paladin_zh', locale: 'zh', description: '青蛙圣骑士，小圆盾，金色边甲，友善表情' },
  { id: 'mushroom_mage_en', locale: 'en', description: 'mushroom mage with spotted cap, tiny lantern, warm earth palette' },
  { id: 'fox_assassin_zh', locale: 'zh', description: '狐狸刺客，黑红围巾，短匕首，敏捷小体型' },
  { id: 'ice_priestess_en', locale: 'en', description: 'ice priestess, pale blue robes, crystal charm, calm silhouette' },
  { id: 'boar_warrior_zh', locale: 'zh', description: '野猪战士，粗短身材，木槌，铜色护腕' },
  { id: 'clockwork_guard_en', locale: 'en', description: 'clockwork guard, brass plates, glowing teal core, sturdy compact body' },
  { id: 'xianxia_swordsman_zh', locale: 'zh', description: '修仙剑客，白衣蓝纹，背剑，发带飘动但轮廓紧凑' },
  { id: 'desert_merchant_en', locale: 'en', description: 'desert merchant, layered scarf, small satchel, warm readable palette' },
  { id: 'bunny_alchemist_zh', locale: 'zh', description: '兔子炼金术士，小药瓶，紫色围裙，圆润可爱' },
  { id: 'shadow_monk_en', locale: 'en', description: 'shadow monk, dark simple robe, prayer beads, compact fighting stance' },
  { id: 'coral_guardian_zh', locale: 'zh', description: '珊瑚守卫，海蓝盔甲，贝壳护肩，水下主题' },
  { id: 'pumpkin_jester_en', locale: 'en', description: 'pumpkin jester, orange mask, striped sleeves, playful small silhouette' },
  { id: 'thunder_archer_zh', locale: 'zh', description: '雷电弓手，黄色披肩，短弓，闪电纹饰但无特效背景' },
  { id: 'snow_golem_en', locale: 'en', description: 'snow golem, chunky friendly body, coal buttons, icy blue shadows' },
  { id: 'jade_healer_zh', locale: 'zh', description: '翡翠治疗师，绿色长袍，药草包，温和小体型' },
  { id: 'tiny_dragon_en', locale: 'en', description: 'tiny dragon companion, folded wings, bright eyes, readable compact body' },
])

function round(value, digits = 4) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function normalizeBackgroundForFinishing(backgroundMode) {
  const mode = String(backgroundMode || 'auto').trim()
  if (mode === 'flood_edge') return 'auto'
  if (mode === 'alpha' || mode === 'transparent') return 'auto'
  return mode || 'auto'
}

function validationStatus(result) {
  return result?.debugReport?.validation?.status ?? 'fail'
}

export function scoreProductionSheetCandidate({ result, error } = {}) {
  if (error || !result) {
    return {
      score: -1000,
      status: 'error',
      reason: error?.message ?? 'candidate_failed',
      failure_status: error?.failure_status ?? providerErrorFailureStatus(error),
      failure_stage: error?.failure_stage ?? 'provider',
      retry_hint: error?.retry_hint ?? null,
      warnings: [],
      blocking_errors: ['candidate_failed'],
      release_gate: null,
      release_ready: false,
    }
  }
  const validation = result.debugReport?.validation ?? {}
  const warnings = validation.warnings ?? []
  const blocking = validation.blocking_errors ?? []
  const metrics = validation.metrics ?? {}
  const sourceQuality = result.debugReport?.source_quality ?? null
  const sourceQualitySummary = sourceQuality?.summary ?? {}
  const sourceQualityWarnings = sourceQuality?.warnings ?? []
  const sourceQualityBlocking = sourceQuality?.blocking_errors ?? []
  const duplicateGroups = metrics.duplicate_frames?.unexpected_group_count ?? metrics.duplicate_frames?.group_count ?? 0
  const haloScore = Number(metrics.halo_score ?? 0)
  const edgeSevere = Number(metrics.edge_pressure?.severe_frame_count ?? 0)
  const sourceDuplicateMotion = Number(sourceQualitySummary.duplicate_motion_action_count ?? 0)
  const sourceHaloRegions = Number(sourceQualitySummary.halo_region_count ?? 0)
  const sourceEdgeSevere = Number(sourceQualitySummary.edge_pressure_severe_region_count ?? 0)
  const sourceEmptyRegions = Number(sourceQualitySummary.empty_region_count ?? 0)
  const status = validation.status ?? 'fail'
  const releaseGate = evaluateProductionSheetReleaseGate({ debugReport: result.debugReport })
  const score =
    (STATUS_SCORE[status] ?? 0) -
    warnings.length * 15 -
    blocking.length * 120 -
    duplicateGroups * 20 -
    haloScore * 5 -
    edgeSevere * 8 -
    sourceQualityWarnings.length * 25 -
    sourceQualityBlocking.length * 150 -
    sourceDuplicateMotion * 80 -
    sourceHaloRegions * 12 -
    sourceEdgeSevere * 10 -
    sourceEmptyRegions * 120
  return {
    score: round(score),
    status,
    reason: releaseGate.blocking_errors[0] ?? blocking[0] ?? sourceQualityBlocking[0] ?? warnings[0] ?? sourceQualityWarnings[0] ?? null,
    warnings: [...new Set([...warnings, ...sourceQualityWarnings, ...(releaseGate.warnings ?? [])])],
    blocking_errors: [...new Set([...blocking, ...sourceQualityBlocking, ...(releaseGate.blocking_errors ?? [])])],
    release_gate: releaseGate,
    release_ready: releaseGate.release_ready,
    metrics: {
      halo_score: haloScore,
      duplicate_groups: duplicateGroups,
      edge_pressure_severe_frames: edgeSevere,
      source_quality_status: sourceQuality?.status ?? null,
      source_quality_duplicate_motion_actions: sourceDuplicateMotion,
      source_quality_halo_regions: sourceHaloRegions,
      source_quality_edge_pressure_severe_regions: sourceEdgeSevere,
      source_quality_empty_regions: sourceEmptyRegions,
    },
  }
}

function finiteCandidateMetric(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

export function scoreQualityCharacterCandidate({ styleReport, finishReport, error } = {}) {
  if (error) {
    return {
      score: -1000,
      status: 'error',
      reason: error.message ?? 'candidate_failed',
      failure_status: error.failure_status ?? providerErrorFailureStatus(error),
      failure_stage: error.failure_stage ?? 'provider',
      retry_hint: error.retry_hint ?? null,
      warnings: [],
      blocking_errors: ['candidate_failed'],
      release_gate: null,
      release_ready: false,
    }
  }
  const metrics = styleReport?.metrics ?? {}
  const visible = finiteCandidateMetric(metrics.visible_pixel_count)
  const unique = finiteCandidateMetric(metrics.unique_color_count)
  const changed = finiteCandidateMetric(finishReport?.palette_snap?.changed_pixel_ratio)
  const outline = finiteCandidateMetric(finishReport?.outline?.outline_pixel_ratio)
  const spec = finishReport?.quality_spec?.metrics ?? {}
  const bboxWidth = finiteCandidateMetric(spec.bbox_width_ratio)
  const bboxHeight = finiteCandidateMetric(spec.bbox_height_ratio)
  const bboxArea = finiteCandidateMetric(spec.bbox_area_ratio)
  const centerOffset = finiteCandidateMetric(spec.center_offset_ratio)
  const edgeMargin = finiteCandidateMetric(spec.edge_margin_ratio)
  const score =
    650 +
    Math.min(70, (unique ?? 0) * 2) +
    Math.min(40, (visible ?? 0) / 5000) -
    Math.max(0, (visible ?? 0) - 220000) * 0.00035 -
    Math.max(0, (bboxWidth ?? 0) - 0.72) * 220 -
    Math.max(0, (bboxHeight ?? 0) - 0.86) * 220 -
    Math.max(0, (bboxArea ?? 0) - 0.42) * 320 -
    Math.max(0, (centerOffset ?? 0) - 0.1) * 260 -
    Math.max(0, 0.035 - (edgeMargin ?? 0)) * 180 -
    Math.max(0, (changed ?? 0) - 0.7) * 120 -
    Math.max(0, (outline ?? 0) - 0.08) * 200
  const roundedScore = round(score)
  const candidateMetrics = {
    visible_pixel_count: visible,
    unique_color_count: unique,
    palette_changed_pixel_ratio: changed,
    outline_pixel_ratio: outline,
    bbox_width_ratio: bboxWidth,
    bbox_height_ratio: bboxHeight,
    bbox_area_ratio: bboxArea,
    center_offset_ratio: centerOffset,
    edge_margin_ratio: edgeMargin,
  }
  const releaseGate = evaluateQualityCharacterReleaseGate({
    score: roundedScore,
    metrics: candidateMetrics,
    bbox: finishReport?.quality_spec?.bbox ?? null,
  })
  return {
    score: roundedScore,
    status: releaseGate.status,
    reason: releaseGate.blocking_errors[0] ?? releaseGate.warnings[0] ?? null,
    warnings: releaseGate.warnings,
    blocking_errors: releaseGate.blocking_errors,
    release_gate: releaseGate,
    release_ready: releaseGate.release_ready,
    metrics: candidateMetrics,
  }
}

function selectBestCandidate(candidates) {
  const sorted = candidates.slice().sort((a, b) => b.score - a.score || a.index - b.index)
  return sorted[0]
}

function selectDiagnosticCandidate(candidates) {
  const processed = candidates.filter((candidate) => candidate.result || candidate.finished)
  return selectBestCandidate(processed.length ? processed : candidates)
}

function selectReleaseCandidate(candidates) {
  return selectBestCandidate(candidates.filter((candidate) => candidate.release_ready === true))
}

function measureQualityCharacterSpec(image, { visiblePixelCount = null } = {}) {
  const bbox = detectAlphaBBox(image)
  const canvasArea = image.width * image.height
  if (!bbox || !canvasArea) {
    return {
      mode: 'quality_character_spec_v0',
      bbox: null,
      metrics: {
        bbox_width_ratio: 0,
        bbox_height_ratio: 0,
        bbox_area_ratio: 0,
        visible_area_ratio: 0,
        center_offset_x_ratio: 0,
        center_offset_y_ratio: 0,
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
  const visible = Number(visiblePixelCount ?? 0)
  return {
    mode: 'quality_character_spec_v0',
    bbox: { x: bbox.x, y: bbox.y, w: bbox.w, h: bbox.h, right: bbox.right, bottom: bbox.bottom },
    metrics: {
      bbox_width_ratio: round(bbox.w / image.width),
      bbox_height_ratio: round(bbox.h / image.height),
      bbox_area_ratio: round((bbox.w * bbox.h) / canvasArea),
      visible_area_ratio: visible ? round(visible / canvasArea) : 0,
      center_offset_x_ratio: round(centerOffsetX / image.width),
      center_offset_y_ratio: round(centerOffsetY / image.height),
      center_offset_ratio: round(Math.max(centerOffsetX / image.width, centerOffsetY / image.height)),
      edge_margin_ratio: round(edgeMargin / Math.min(image.width, image.height)),
    },
  }
}

function selectionReport({ mode, candidateCount, selected, releaseSelected, candidates, generationOptions }) {
  const hasProcessedCandidate = candidates.some((candidate) => candidate.result || candidate.finished)
  const artifactDisposition = releaseSelected ? 'release' : hasProcessedCandidate ? 'diagnostic_only' : 'none'
  return {
    mode,
    candidate_count: candidateCount,
    selected_index: selected?.index ?? null,
    selected_score: selected?.score ?? null,
    release_selected_index: releaseSelected?.index ?? null,
    release_selected_score: releaseSelected?.score ?? null,
    release_ready: Boolean(releaseSelected),
    artifact_disposition: artifactDisposition,
    generation_options: generationOptions,
    candidates: candidates.map((candidate) => ({
      index: candidate.index,
      score: candidate.score,
      status: candidate.status,
      reason: candidate.reason ?? null,
      failure_status: candidate.failure_status ?? null,
      failure_stage: candidate.failure_stage ?? null,
      retry_hint: candidate.retry_hint ?? null,
      prompt_contract: candidate.generated?.promptContract ?? null,
      provider: candidate.generated?.provider ?? null,
      provider_preset_id: candidate.generated?.providerPresetId ?? null,
      provider_label: candidate.generated?.providerLabel ?? null,
      model: candidate.generated?.model ?? null,
      provider_attempts: candidate.generated?.providerAttempts ?? [],
      generation_options: candidate.generated?.generationOptions ?? null,
      warnings: candidate.warnings ?? [],
      blocking_errors: candidate.blocking_errors ?? [],
      release_ready: candidate.release_ready === true,
      release_gate: candidate.release_gate ?? null,
      metrics: candidate.metrics ?? {},
    })),
  }
}

function allCandidatesFailedError(message, { status = 'failed_all_candidates', retryHint = 'regenerate', candidateSelection } = {}) {
  return Object.assign(new Error(message || 'all text-to-image candidates failed'), {
    status,
    failure_status: status,
    retry_hint: retryHint,
    candidate_selection: candidateSelection,
    candidateSelection,
  })
}

function terminalCandidateFailure(candidates) {
  return candidates.find((candidate) => candidate.failure_status && isNonRetryableProviderError({
    status: candidate.failure_status,
    failure_status: candidate.failure_status,
  })) ?? null
}

function candidateFailureForThrow(candidates) {
  return candidates.find((candidate) => candidate.failure_stage === 'post_processing') ??
    terminalCandidateFailure(candidates) ??
    null
}

function postProcessingCandidateError(error, { candidateSelection = null } = {}) {
  const wrapped = new Error(String(error?.message || error || 'candidate post-processing failed'))
  wrapped.name = error?.name || wrapped.name
  return Object.assign(wrapped, {
    cause: error,
    status: 'failed_post_processing',
    failure_status: 'failed_post_processing',
    failure_stage: 'post_processing',
    retry_hint: 'manual_inspect',
    ...(candidateSelection ? {
      candidate_selection: candidateSelection,
      candidateSelection,
    } : {}),
  })
}

function generationMetadata({
  generated,
  imageConfig,
  generationOptions,
  candidateSelection,
  mode,
}) {
  return {
    mode,
    provider: generated.provider,
    provider_preset_id: generated.providerPresetId,
    provider_label: generated.providerLabel,
    model: generated.model,
    image_config: imageConfig,
    generation_options: generationOptions,
    input_images: generated.inputImages,
    template_file: generated.templateName,
    reference_file: generated.referenceName,
    palette_file: generated.paletteName,
    provider_attempts: generated.providerAttempts ?? [],
    prompt_contract: generated.promptContract,
    prompt_file: 'prompt.txt',
    candidate_selection: candidateSelection,
  }
}

async function attachProductionGenerationEvidence(result, { generation, releaseGate, releaseReady, artifactDisposition }) {
  result.generationReleaseGate = releaseGate
  result.releaseReady = releaseReady
  result.artifactDisposition = artifactDisposition
  result.metadataJson = {
    ...result.metadataJson,
    generation,
  }
  const generationJson = Buffer.from(JSON.stringify(generation, null, 2), 'utf8')
  result.files.generationJson = generationJson
  if (releaseReady && result.files.zipBuffer) {
    const zip = await JSZip.loadAsync(result.files.zipBuffer)
    zip.file('metadata.json', JSON.stringify(result.metadataJson, null, 2))
    zip.file('generation.json', generationJson)
    zip.file('generation_release_gate.json', JSON.stringify(releaseGate, null, 2))
    result.files.zipBuffer = await zip.generateAsync({ type: 'nodebuffer' })
  }
}

function processOptionsForGeneratedProductionSheet(processOptions = {}, { sourceLayout }) {
  if (!isFixedRegionMotionLayoutId(sourceLayout)) return processOptions
  if (
    processOptions.fixedRegionSourceStaging !== undefined ||
    processOptions.fixed_region_source_staging !== undefined ||
    processOptions.sourceStaging !== undefined ||
    processOptions.source_staging !== undefined
  ) {
    return processOptions
  }
  return {
    ...processOptions,
    fixedRegionSourceStaging: 'fixed_region_256_crop',
    fixedRegionStageSize: 256,
    fixedRegionCropRight: 4,
    fixedRegionCropBottom: 4,
    fixedRegionMatteTolerance: 80,
  }
}

export async function runProductionSheetTextToImage({
  description = '',
  name = 'generated_character',
  preset,
  providerPresetId,
  imageConfig = {},
  generationOptions = {},
  promptFields = {},
  characterPreset,
  backgroundMode = 'auto',
  templateImage = null,
  referenceImage = null,
  paletteImage = null,
  providerBudget = null,
  processOptions = {},
  generateSource = generateCharacterSource,
  processSheet = processSheetBuffer,
  env = process.env,
} = {}) {
  const resolvedGenerationOptions = normalizeGenerationOptions(generationOptions)
  const candidateCount = normalizeCandidateCount(resolvedGenerationOptions.candidateCount)
  const candidates = []
  for (let index = 1; index <= candidateCount; index += 1) {
    let generated
    try {
      generated = await generateSource({
        description,
        preset,
        providerPresetId,
        imageConfig,
        generationOptions: resolvedGenerationOptions,
        candidateIndex: index,
        t2iMode: TEXT_TO_IMAGE_MODE_PRODUCTION_SHEET,
        characterPreset,
        promptFields,
        backgroundMode,
        templateImage,
        referenceImage,
        paletteImage,
        providerBudget,
        env,
      })
    } catch (error) {
      candidates.push({
        index,
        ...scoreProductionSheetCandidate({ error }),
      })
      if (isNonRetryableProviderError(error)) break
      continue
    }
    try {
      const result = await processSheet(generated.buffer, {
        ...processOptionsForGeneratedProductionSheet(processOptions, {
          sourceLayout: generated.promptContract?.layout_id ?? preset,
        }),
        name,
        description,
        backgroundMode,
        sourceLayout: generated.promptContract?.layout_id ?? preset,
        sourceType: 't2i_production_sheet',
        sourceFileName: `candidate_${index}.png`,
        generation: generationMetadata({
          generated,
          imageConfig,
          generationOptions: resolvedGenerationOptions,
          candidateSelection: null,
          mode: TEXT_TO_IMAGE_MODE_PRODUCTION_SHEET,
        }),
        promptText: generated.prompt,
      })
      candidates.push({
        index,
        generated,
        result,
        ...scoreProductionSheetCandidate({ result }),
      })
    } catch (error) {
      const processingError = postProcessingCandidateError(error)
      candidates.push({
        index,
        generated,
        ...scoreProductionSheetCandidate({ error: processingError }),
      })
    }
  }
  const selected = selectDiagnosticCandidate(candidates)
  const releaseSelected = selectReleaseCandidate(candidates)
  const candidateSelection = selectionReport({
    mode: TEXT_TO_IMAGE_MODE_PRODUCTION_SHEET,
    candidateCount,
    selected,
    releaseSelected,
    candidates,
    generationOptions: resolvedGenerationOptions,
  })
  if (!selected?.result) {
    const failure = candidateFailureForThrow(candidates)
    throw allCandidatesFailedError(failure?.reason || selected?.reason || 'all text-to-image candidates failed', {
      status: failure?.failure_status ?? 'failed_all_candidates',
      retryHint: failure?.retry_hint ?? 'regenerate',
      candidateSelection,
    })
  }
  const published = releaseSelected ?? selected
  const selectedGeneration = generationMetadata({
    generated: published.generated,
    imageConfig,
    generationOptions: resolvedGenerationOptions,
    candidateSelection,
    mode: TEXT_TO_IMAGE_MODE_PRODUCTION_SHEET,
  })
  try {
    await attachProductionGenerationEvidence(published.result, {
      generation: selectedGeneration,
      releaseGate: published.release_gate,
      releaseReady: published.release_ready === true,
      artifactDisposition: candidateSelection.artifact_disposition,
    })
  } catch (error) {
    throw postProcessingCandidateError(error, { candidateSelection })
  }
  published.result.files.promptTxt = Buffer.from(String(published.generated.prompt || ''), 'utf8')
  return {
    mode: TEXT_TO_IMAGE_MODE_PRODUCTION_SHEET,
    result: published.result,
    candidateSelection,
    releaseGate: published.release_gate,
    releaseReady: published.release_ready === true,
    artifactDisposition: candidateSelection.artifact_disposition,
  }
}

export async function finishQualityCharacterImage(buffer, {
  backgroundMode = 'auto',
  maxColors = 32,
  downsampleFactor = 2,
  outline = true,
  pixelGridRefinement = false,
} = {}) {
  const raw = await loadRgba(buffer)
  const prepared = await prepareSourceForProcessing(buffer, { id: 'quality_character_v0', kind: 'single_image' }, {
    backgroundMode: normalizeBackgroundForFinishing(backgroundMode),
  })
  const paletteSnap = applyPixelStyleCorrection(prepared.transparent, { maxColors })
  const gridRefinementOptions = normalizePixelGridRefinementOptions(pixelGridRefinement)
  const gridUsesOutlineLast = Boolean(
    gridRefinementOptions &&
    gridRefinementOptions.recipe !== PIXEL_GRID_RECIPE_IDS.V1_COMPAT
  )
  const outlined = gridUsesOutlineLast
    ? null
    : outline
      ? strengthenAlphaOutline(paletteSnap.image)
      : {
          image: paletteSnap.image,
          report: {
            mode: 'alpha_outline',
            output_mutation: 'none',
            outline_pixel_count: 0,
            outline_pixel_ratio: 0,
          },
        }
  let finalImage = outlined?.image ?? paletteSnap.image
  let outlineReport = outlined?.report ?? {
    mode: 'alpha_outline',
    stage: 'after_refinement',
    output_mutation: 'none',
    outline_pixel_count: 0,
    outline_pixel_ratio: 0,
  }
  const warnings = []
  const gridMaxColors = Math.min(16, Math.max(2, Math.round(Number(maxColors) || 16)))
  const gridRefinement = gridRefinementOptions
    ? refinePixelFrames([gridUsesOutlineLast ? paletteSnap.image : outlined.image], {
        ...gridRefinementOptions,
        maxColors: Math.min(
          gridMaxColors,
          Number(gridRefinementOptions.maxColors ?? gridMaxColors)
        ),
        outlineMode: gridUsesOutlineLast && outline ? 'outer' : 'none',
      })
    : null
  if (gridRefinement?.status === 'refined') {
    const usesLogicalGridOutput = Boolean(gridRefinement.logicalFrames?.[0])
    finalImage = gridRefinement.logicalFrames?.[0] ?? gridRefinement.frames[0]
    if (gridUsesOutlineLast) {
      outlineReport = {
        mode: 'alpha_outline',
        stage: gridRefinement.report.outline?.stage ?? 'after_refinement',
        output_mutation: (
          usesLogicalGridOutput
            ? gridRefinement.report.outline?.outline_logical_pixel_count
            : gridRefinement.report.outline?.outline_pixel_count
        ) > 0
          ? 'outline_strengthen'
          : 'none',
        outline_pixel_count: usesLogicalGridOutput
          ? gridRefinement.report.outline?.outline_logical_pixel_count ?? 0
          : gridRefinement.report.outline?.outline_pixel_count ?? 0,
        outline_pixel_ratio: usesLogicalGridOutput
          ? gridRefinement.report.outline?.outline_logical_pixel_ratio ?? 0
          : gridRefinement.report.outline?.outline_pixel_ratio ?? 0,
        color: gridRefinement.report.outline?.color ?? [24, 24, 32],
      }
    }
  } else {
    if (gridUsesOutlineLast && outline) {
      const fallbackOutline = strengthenAlphaOutline(paletteSnap.image)
      finalImage = fallbackOutline.image
      outlineReport = fallbackOutline.report
    }
  }
  if (gridRefinement?.status !== 'refined' && downsampleFactor && downsampleFactor > 1) {
    try {
      finalImage = downsampleNearest(finalImage, { factor: downsampleFactor })
    } catch (error) {
      warnings.push(`downsample_skipped:${error.message}`)
    }
  }
  const resultPng = await encodeRgbaPng(finalImage)
  const styleReport = buildPixelStyleReport(finalImage, { maxColors })
  const qualitySpec = measureQualityCharacterSpec(finalImage, {
    visiblePixelCount: styleReport.metrics?.visible_pixel_count,
  })
  return {
    sourcePng: await encodeRgbaPng(raw),
    resultPng,
    styleReport,
    report: {
      mode: 'pixel_finishing_v0',
      background: prepared.background,
      palette_snap: paletteSnap.report,
      outline: outlineReport,
      pixel_grid_refinement: gridRefinement?.report ?? {
        schema_version: 1,
        mode: 'pixel_grid_refinement_v1',
        status: 'disabled',
        warnings: [],
      },
      quality_spec: qualitySpec,
      downsample: {
        requested_factor: downsampleFactor,
        applied: finalImage.width !== paletteSnap.image.width || finalImage.height !== paletteSnap.image.height,
        skipped_by_grid_refinement: gridRefinement?.status === 'refined',
        output_size: { w: finalImage.width, h: finalImage.height },
      },
      warnings,
    },
  }
}

export async function runQualityCharacterTextToImage({
  description = '',
  providerPresetId,
  imageConfig = {},
  generationOptions = {},
  promptFields = {},
  characterPreset,
  backgroundMode = 'auto',
  referenceImage = null,
  paletteImage = null,
  pixelFinishing = {},
  providerBudget = null,
  generateSource = generateCharacterSource,
  env = process.env,
} = {}) {
  const resolvedGenerationOptions = normalizeGenerationOptions(generationOptions)
  const candidateCount = normalizeCandidateCount(resolvedGenerationOptions.candidateCount)
  const resolvedImageConfig = {
    image_size: imageConfig.image_size || imageConfig.imageSize || '2K',
    aspect_ratio: resolveTextToImageAspectRatio({
      mode: TEXT_TO_IMAGE_MODE_QUALITY_CHARACTER,
      characterPreset,
      imageConfig,
    }),
  }
  const candidates = []
  for (let index = 1; index <= candidateCount; index += 1) {
    let generated
    try {
      generated = await generateSource({
        description,
        providerPresetId,
        imageConfig: resolvedImageConfig,
        generationOptions: resolvedGenerationOptions,
        candidateIndex: index,
        t2iMode: TEXT_TO_IMAGE_MODE_QUALITY_CHARACTER,
        characterPreset,
        promptFields,
        backgroundMode,
        referenceImage,
        paletteImage,
        providerBudget,
        env,
      })
    } catch (error) {
      candidates.push({
        index,
        ...scoreQualityCharacterCandidate({ error }),
      })
      if (isNonRetryableProviderError(error)) break
      continue
    }
    try {
      const finished = await finishQualityCharacterImage(generated.buffer, {
        backgroundMode,
        maxColors: pixelFinishing.maxColors ?? pixelFinishing.max_colors ?? 32,
        downsampleFactor: pixelFinishing.downsampleFactor ?? pixelFinishing.downsample_factor ?? 2,
        outline: pixelFinishing.outline !== false,
        pixelGridRefinement: pixelFinishing.gridRefinement ?? pixelFinishing.grid_refinement ?? false,
      })
      candidates.push({
        index,
        generated,
        buffer: generated.buffer,
        finished,
        ...scoreQualityCharacterCandidate({ styleReport: finished.styleReport, finishReport: finished.report }),
      })
    } catch (error) {
      const processingError = postProcessingCandidateError(error)
      candidates.push({
        index,
        generated,
        buffer: generated.buffer,
        ...scoreQualityCharacterCandidate({ error: processingError }),
      })
    }
  }
  const selected = selectDiagnosticCandidate(candidates)
  const releaseSelected = selectReleaseCandidate(candidates)
  const candidateSelection = selectionReport({
    mode: TEXT_TO_IMAGE_MODE_QUALITY_CHARACTER,
    candidateCount,
    selected,
    releaseSelected,
    candidates,
    generationOptions: resolvedGenerationOptions,
  })
  if (!selected?.finished) {
    const failure = candidateFailureForThrow(candidates)
    throw allCandidatesFailedError(failure?.reason || selected?.reason || 'all quality character candidates failed', {
      status: failure?.failure_status ?? 'failed_all_candidates',
      retryHint: failure?.retry_hint ?? 'regenerate',
      candidateSelection,
    })
  }
  const published = releaseSelected ?? selected
  const generation = generationMetadata({
    generated: published.generated,
    imageConfig: resolvedImageConfig,
    generationOptions: resolvedGenerationOptions,
    candidateSelection,
    mode: TEXT_TO_IMAGE_MODE_QUALITY_CHARACTER,
  })
  return {
    mode: TEXT_TO_IMAGE_MODE_QUALITY_CHARACTER,
    sourcePng: published.finished.sourcePng,
    resultPng: published.finished.resultPng,
    promptTxt: Buffer.from(String(published.generated.prompt || ''), 'utf8'),
    generationJson: generation,
    generationReleaseGate: published.release_gate,
    releaseReady: published.release_ready === true,
    artifactDisposition: candidateSelection.artifact_disposition,
    report: {
      mode: TEXT_TO_IMAGE_MODE_QUALITY_CHARACTER,
      status: published.release_ready ? 'done' : 'failed_quality_gate',
      selected_index: selected.index,
      selected_score: selected.score,
      release_selected_index: releaseSelected?.index ?? null,
      release_selected_score: releaseSelected?.score ?? null,
      release_ready: published.release_ready === true,
      artifact_disposition: candidateSelection.artifact_disposition,
      release_gate: published.release_gate,
      style_report: published.finished.styleReport,
      pixel_finishing: published.finished.report,
      candidate_selection: candidateSelection,
    },
    candidates: candidates.map((candidate) => ({
      index: candidate.index,
      score: candidate.score,
      status: candidate.status,
      reason: candidate.reason ?? null,
      warnings: candidate.warnings ?? [],
      blocking_errors: candidate.blocking_errors ?? [],
      release_ready: candidate.release_ready === true,
      release_gate: candidate.release_gate ?? null,
      buffer: candidate.buffer,
      prompt: candidate.generated?.prompt ?? null,
      prompt_contract: candidate.generated?.promptContract ?? null,
    })),
  }
}

export async function runTextToImageGeneration(options = {}) {
  const mode = normalizeTextToImageMode(options.t2iMode ?? options.t2i_mode)
  if (mode === TEXT_TO_IMAGE_MODE_QUALITY_CHARACTER) return runQualityCharacterTextToImage(options)
  return runProductionSheetTextToImage(options)
}

export function buildT2iGoldenBenchmarkPlan({
  cases = T2I_GOLDEN_CASES,
  candidateCount = DEFAULT_T2I_CANDIDATE_COUNT,
  mode = TEXT_TO_IMAGE_MODE_QUALITY_CHARACTER,
  imageConfig = { image_size: '2K', aspect_ratio: '1:1' },
  generationOptions = {},
} = {}) {
  return {
    mode,
    case_count: cases.length,
    candidate_count: normalizeCandidateCount(candidateCount),
    image_config: imageConfig,
    generation_options: normalizeGenerationOptions({ ...generationOptions, candidateCount }),
    cases: cases.map((testCase) => ({
      id: testCase.id,
      locale: testCase.locale,
      description: testCase.description,
    })),
  }
}
