import { encodeRgbaPng, loadRgba } from '../character-pack/imageCodec.js'
import { requestGeminiPromptImage } from '../character-pack/providers/geminiAdapter.js'
import { requestOpenRouterPromptImage } from '../character-pack/providers/openRouterAdapter.js'
import { getExplicitImageConfig, resolveProviderPreset } from '../character-pack/providers/providerConfig.js'
import { applyPixelStyleCorrection } from '../character-pack/stylePipeline.js'
import {
  buildSceneTilePromptContract,
  compileSceneTilePromptContract,
  summarizeSceneTilePromptContract,
} from './tilePromptContracts.js'
import {
  buildTileConditioningReview,
  renderTileConditioningContactSheet,
} from './tileConditioningReview.js'
import { conditionTileSheetEdges } from './tileEdgeConditioning.js'
import { buildScenePackFromTileSheet } from './tileSheetIngestion.js'

const MAX_SCENE_TILE_CANDIDATES = 8

function requireProviderRuntime(providerPreset, fetchImpl) {
  const apiKey = providerPreset?.apiKey || ''
  if (!apiKey) {
    const keyHint = providerPreset?.apiKeyEnv || 'OPENROUTER_API_KEY'
    throw Object.assign(new Error(`${keyHint} is not configured for ${providerPreset?.label || 'the selected provider'}`), {
      status: 'failed_model_error',
      retry_hint: 'manual_inspect',
    })
  }
  if (!fetchImpl) {
    throw Object.assign(new Error('fetch is unavailable in this runtime'), {
      status: 'failed_model_error',
      retry_hint: 'manual_inspect',
    })
  }
  return apiKey
}

function consumeProviderBudget(providerBudget) {
  if (!providerBudget) return null
  const max = Number(providerBudget.max ?? providerBudget.maxProviderCalls ?? 0)
  const used = Number(providerBudget.used ?? providerBudget.providerCallsUsed ?? 0)
  if (!Number.isFinite(max) || max < 1) return null
  if (used >= max) {
    throw Object.assign(new Error(`Provider call budget exceeded (${used}/${max})`), {
      status: 'failed_model_error',
      retry_hint: 'increase_max_provider_calls',
    })
  }
  providerBudget.used = used + 1
  providerBudget.providerCallsUsed = providerBudget.used
  return {
    used: providerBudget.used,
    max,
  }
}

function normalizeCandidateCount(value = 1) {
  const count = Number(value ?? 1)
  if (!Number.isInteger(count) || count < 1) throw new Error('candidateCount must be a positive integer')
  if (count > MAX_SCENE_TILE_CANDIDATES) throw new Error(`candidateCount must be ${MAX_SCENE_TILE_CANDIDATES} or less`)
  return count
}

function resolveImageConfig(providerPreset, imageConfig = {}) {
  return {
    ...providerPreset.imageConfig,
    ...getExplicitImageConfig(imageConfig),
  }
}

function gateById(qualityGate, id) {
  return qualityGate?.gates?.find((gate) => gate.id === id)
}

function observedNumber(gate, key) {
  const value = Number(gate?.observed?.[key] ?? 0)
  return Number.isFinite(value) ? value : 0
}

function statusRank(status) {
  if (status === 'pass') return 0
  if (status === 'warning') return 1
  if (status === 'fail') return 2
  return 3
}

function buildCandidateScore(qualityGate, index) {
  const visualSeams = gateById(qualityGate, 'visual_seams')
  const selfLoop = gateById(qualityGate, 'tile_self_loops')
  const distinctness = gateById(qualityGate, 'tile_distinctness')
  const sourceAtlas = gateById(qualityGate, 'source_atlas_structure')
  return {
    status_rank: statusRank(qualityGate?.status),
    blocking_error_count: qualityGate?.blocking_errors?.length ?? 0,
    warning_count: qualityGate?.warnings?.length ?? 0,
    visual_failed_pair_count: observedNumber(visualSeams, 'failed_pair_count'),
    self_loop_failed_tile_count: observedNumber(selfLoop, 'failed_tile_count'),
    duplicate_pair_count: observedNumber(distinctness, 'duplicate_pair_count'),
    continuous_source_boundary_count: observedNumber(sourceAtlas, 'continuous_boundary_count'),
    max_visual_seam_delta: observedNumber(visualSeams, 'max_edge_delta'),
    max_self_loop_delta: observedNumber(selfLoop, 'max_edge_delta'),
    candidate_index: index,
  }
}

function compareCandidateSummaries(a, b) {
  for (const key of [
    'status_rank',
    'blocking_error_count',
    'warning_count',
    'visual_failed_pair_count',
    'self_loop_failed_tile_count',
    'duplicate_pair_count',
    'continuous_source_boundary_count',
    'max_visual_seam_delta',
    'max_self_loop_delta',
    'candidate_index',
  ]) {
    const delta = a.score[key] - b.score[key]
    if (delta) return delta
  }
  return 0
}

function summarizeCandidate({ id, index, qualityGate, score }) {
  return {
    id,
    index,
    status: qualityGate.status,
    blocking_errors: qualityGate.blocking_errors ?? [],
    warnings: qualityGate.warnings ?? [],
    failure_taxonomy: qualityGate.failure_taxonomy ?? [],
    score,
  }
}

function selectionReason(selected, candidates) {
  const statusLabel = selected.status === 'pass'
    ? 'passed strict quality gate'
    : selected.status === 'warning'
      ? 'had the lowest warning score'
      : 'had the lowest failure score'
  return candidates.length === 1
    ? `${selected.id} selected as the only candidate; ${statusLabel}`
    : `${selected.id} selected from ${candidates.length} candidates; ${statusLabel}`
}

function buildCandidateArtifacts(candidate) {
  const prefix = `candidates/${candidate.id}`
  return [
    { name: `${prefix}/tileset.png`, content: candidate.result.files?.tilesetPng },
    { name: `${prefix}/quality_gate.json`, content: candidate.result.qualityGate },
    { name: `${prefix}/generation.json`, content: candidate.generationJson },
    ...(candidate.result.styleCorrection ? [{ name: `${prefix}/style_correction.json`, content: candidate.result.styleCorrection }] : []),
    ...(candidate.result.edgeConditioning ? [{ name: `${prefix}/edge_conditioning.json`, content: candidate.result.edgeConditioning }] : []),
    ...(candidate.result.tileConditioningReview ? [{ name: `${prefix}/tile_conditioning_review.json`, content: candidate.result.tileConditioningReview }] : []),
    ...(candidate.result.files?.tileConditioningReviewPng ? [{ name: `${prefix}/tile_conditioning_review.png`, content: candidate.result.files.tileConditioningReviewPng }] : []),
  ].filter((file) => file.content !== undefined && file.content !== null)
}

function resizeNearest(image, { width, height }) {
  const output = { width, height, data: new Uint8ClampedArray(width * height * 4) }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sx = Math.min(image.width - 1, Math.floor((x * image.width) / width))
      const sy = Math.min(image.height - 1, Math.floor((y * image.height) / height))
      const src = (sy * image.width + sx) * 4
      const dst = (y * width + x) * 4
      output.data[dst] = image.data[src]
      output.data[dst + 1] = image.data[src + 1]
      output.data[dst + 2] = image.data[src + 2]
      output.data[dst + 3] = image.data[src + 3]
    }
  }
  return output
}

async function normalizeProviderSourceImage(image, buffer, contract) {
  const target = contract.atlas_contract.source.sheet
  const sourceSize = { w: image.width, h: image.height }
  if (image.width === target.w && image.height === target.h) {
    return {
      source: image,
      tilesetPng: buffer,
      postprocess: {
        source_size: sourceSize,
        output_size: { w: target.w, h: target.h },
        resize_method: 'none',
      },
    }
  }
  const source = resizeNearest(image, { width: target.w, height: target.h })
  return {
    source,
    tilesetPng: await encodeRgbaPng(source),
    postprocess: {
      source_size: sourceSize,
      output_size: { w: target.w, h: target.h },
      resize_method: 'nearest',
    },
  }
}

export async function generateSceneTilePack({
  description = '',
  providerPresetId = '',
  imageConfig = {},
  candidateCount = 1,
  providerBudget = null,
  env = process.env,
  fetchImpl = globalThis.fetch,
  projectId = 'generated_scene_project',
  identifier = 'generated_scene',
  width = 6,
  height = 4,
  pattern = 'island',
  seed = 1,
  density = 0.5,
  tilesetRelPath = 'tileset.png',
  palette,
  thresholds,
  gatePolicy,
  rawTilePolicy,
  profile,
  styleCorrection,
  edgeConditioning,
} = {}) {
  const providerPreset = resolveProviderPreset(env, providerPresetId)
  const apiKey = requireProviderRuntime(providerPreset, fetchImpl)
  const contract = buildSceneTilePromptContract({ description, profile })
  const prompt = compileSceneTilePromptContract(contract)
  const resolvedImageConfig = resolveImageConfig(providerPreset, imageConfig)
  const resolvedCandidateCount = normalizeCandidateCount(candidateCount)
  const candidates = []

  for (let index = 0; index < resolvedCandidateCount; index += 1) {
    const request = {
      providerPreset,
      apiKey,
      prompt,
      imageConfig: resolvedImageConfig,
      fetchImpl,
    }
    consumeProviderBudget(providerBudget)
    const generated = providerPreset.provider === 'gemini'
      ? await requestGeminiPromptImage(request)
      : await requestOpenRouterPromptImage(request)
    const rawSource = await loadRgba(generated.buffer)
    const providerSource = await normalizeProviderSourceImage(rawSource, generated.buffer, contract)
    const correctedSource = styleCorrection
      ? applyPixelStyleCorrection(providerSource.source, styleCorrection)
      : null
    const conditionedSource = edgeConditioning
      ? conditionTileSheetEdges(correctedSource?.image ?? providerSource.source, { ...edgeConditioning, profile })
      : null
    const sourceForIngestion = conditionedSource?.source ?? correctedSource?.image ?? providerSource.source
    const tilesetPng = conditionedSource?.report?.enabled || correctedSource
      ? await encodeRgbaPng(sourceForIngestion)
      : providerSource.tilesetPng
    const result = buildScenePackFromTileSheet({
      source: sourceForIngestion,
      tilesetPng,
      projectId,
      identifier,
      width,
      height,
      pattern,
      seed,
      density,
      tilesetRelPath,
      palette,
      thresholds,
      gatePolicy,
      rawTilePolicy,
      profile,
      styleCorrectionReport: correctedSource?.report,
      edgeConditioningReport: conditionedSource?.report,
    })
    const tileConditioningReview = conditionedSource?.report?.enabled
      ? buildTileConditioningReview({
        rawTiles: conditionedSource.rawTiles,
        conditionedTiles: conditionedSource.tiles,
        edgeConditioning: conditionedSource.report,
        qualityGate: result.qualityGate,
      })
      : null
    const tileConditioningReviewPng = tileConditioningReview
      ? await encodeRgbaPng(renderTileConditioningContactSheet({
        rawTiles: conditionedSource.rawTiles,
        conditionedTiles: conditionedSource.tiles,
      }))
      : null
    const candidateId = `candidate_${String(index + 1).padStart(2, '0')}`
    const candidateResult = {
      ...result,
      ...(tileConditioningReview ? { tileConditioningReview } : {}),
      files: {
        ...(result.files ?? {}),
        ...(tileConditioningReviewPng ? { tileConditioningReviewPng } : {}),
      },
    }
    const score = buildCandidateScore(candidateResult.qualityGate, index)
    const generationJson = {
      mode: 'live_tile_generation_candidate',
      candidate_id: candidateId,
      candidate_index: index,
      provider: providerPreset.provider,
      provider_preset_id: providerPreset.id,
      provider_label: providerPreset.label,
      model: providerPreset.model,
      image_config: resolvedImageConfig,
      gate_policy: candidateResult.qualityGate.gate_policy,
      postprocess: providerSource.postprocess,
      prompt_contract: summarizeSceneTilePromptContract(contract),
      quality_gate_status: candidateResult.qualityGate.status,
      blocking_errors: candidateResult.qualityGate.blocking_errors ?? [],
      warnings: candidateResult.qualityGate.warnings ?? [],
      score,
      ...(correctedSource?.report ? { style_correction: correctedSource.report } : {}),
      ...(conditionedSource?.report ? { edge_conditioning: conditionedSource.report } : {}),
      ...(tileConditioningReview ? { tile_conditioning_review: tileConditioningReview } : {}),
      prompt_file: '../../prompt.txt',
      source_file: 'tileset.png',
    }
    candidates.push({
      id: candidateId,
      index,
      result: candidateResult,
      generationJson,
      summary: summarizeCandidate({
        id: candidateId,
        index,
        qualityGate: candidateResult.qualityGate,
        score,
      }),
    })
  }

  const rankedSummaries = candidates
    .map((candidate) => candidate.summary)
    .sort(compareCandidateSummaries)
  const selectedSummary = rankedSummaries[0]
  const selectedCandidate = candidates.find((candidate) => candidate.id === selectedSummary.id)
  const candidateSelection = {
    schema_version: 1,
    mode: 'scene_tile_candidate_selection_v0',
    candidate_count: candidates.length,
    selected_candidate_id: selectedCandidate.id,
    selected_candidate_index: selectedCandidate.index,
    selected_status: selectedCandidate.result.qualityGate.status,
    selection_reason: selectionReason(selectedSummary, candidates),
    ranking: rankedSummaries,
  }
  const candidateArtifacts = candidates.flatMap(buildCandidateArtifacts)

  return {
    ...selectedCandidate.result,
    candidateSelection,
    files: {
      ...(selectedCandidate.result.files ?? {}),
      promptTxt: Buffer.from(prompt, 'utf8'),
      candidateSelectionJson: candidateSelection,
      candidateArtifacts,
      generationJson: {
        mode: 'live_tile_generation',
        provider: providerPreset.provider,
        provider_preset_id: providerPreset.id,
        provider_label: providerPreset.label,
        model: providerPreset.model,
        image_config: resolvedImageConfig,
        candidate_count: candidates.length,
        selected_candidate_id: selectedCandidate.id,
        gate_policy: selectedCandidate.result.qualityGate.gate_policy,
        postprocess: selectedCandidate.generationJson.postprocess,
        prompt_contract: summarizeSceneTilePromptContract(contract),
        candidate_selection: candidateSelection,
        ...(selectedCandidate.result.styleCorrection ? { style_correction: selectedCandidate.result.styleCorrection } : {}),
        ...(selectedCandidate.result.edgeConditioning ? { edge_conditioning: selectedCandidate.result.edgeConditioning } : {}),
        ...(selectedCandidate.result.tileConditioningReview ? { tile_conditioning_review: selectedCandidate.result.tileConditioningReview } : {}),
        prompt_file: 'prompt.txt',
        source_file: 'tileset.png',
        candidate_selection_file: 'candidate_selection.json',
      },
    },
  }
}
