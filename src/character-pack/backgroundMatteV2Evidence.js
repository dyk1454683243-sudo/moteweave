import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'

import {
  applyDeterministicPixelMatteV2,
  assertBackgroundMatteV2ImageBudget,
  BACKGROUND_MATTE_V2_ALGORITHM,
  BACKGROUND_MATTE_V2_ARTIFACT_FILES,
  BACKGROUND_MATTE_V2_IMAGE_LIMITS,
  BACKGROUND_SPILL_OVERLAY_LEGEND,
  buildBackgroundMatteV2ArtifactBundle,
  hashBackgroundContractMask,
  hashRgbaForBackgroundContract,
} from './backgroundMatteV2.js'
import { loadRgba } from './imageCodec.js'

const HASH_PATTERN = /^[a-f0-9]{64}$/
const ARTIFACT_FILES = Object.freeze(Object.values(BACKGROUND_MATTE_V2_ARTIFACT_FILES))
const JSON_ARTIFACTS = new Set([
  BACKGROUND_MATTE_V2_ARTIFACT_FILES.QUALITY,
  BACKGROUND_MATTE_V2_ARTIFACT_FILES.REVIEW,
  BACKGROUND_MATTE_V2_ARTIFACT_FILES.CONTRACT_MASKS,
])
const FORBIDDEN_REVIEW_KEYS = new Set([
  'acceptance_status',
  'human_decision_status',
  'accepted_at',
  'rejected_at',
])
const REVIEW_KEYS = Object.freeze([
  'schema_version',
  'algorithm',
  'review_recommendation',
  'reasons',
  'confidence',
  'spill_overlay_legend',
  'affected_regions',
  'hashes',
  'artifacts',
  'urls',
])
const REVIEW_ARTIFACT_FILES = Object.freeze({
  output: BACKGROUND_MATTE_V2_ARTIFACT_FILES.OUTPUT,
  preview: BACKGROUND_MATTE_V2_ARTIFACT_FILES.PREVIEW,
  spill_overlay: BACKGROUND_MATTE_V2_ARTIFACT_FILES.SPILL_OVERLAY,
  contract_masks: BACKGROUND_MATTE_V2_ARTIFACT_FILES.CONTRACT_MASKS,
  alpha_estimate: BACKGROUND_MATTE_V2_ARTIFACT_FILES.ALPHA_ESTIMATE,
  foreground_reconstruction: BACKGROUND_MATTE_V2_ARTIFACT_FILES.FOREGROUND_RECONSTRUCTION,
})
const REVIEW_URL_FILES = Object.freeze({
  background_removed_provider_output_url: BACKGROUND_MATTE_V2_ARTIFACT_FILES.OUTPUT,
  background_preview_url: BACKGROUND_MATTE_V2_ARTIFACT_FILES.PREVIEW,
  background_spill_overlay_url: BACKGROUND_MATTE_V2_ARTIFACT_FILES.SPILL_OVERLAY,
  background_contract_masks_url: BACKGROUND_MATTE_V2_ARTIFACT_FILES.CONTRACT_MASKS,
  background_alpha_estimate_url: BACKGROUND_MATTE_V2_ARTIFACT_FILES.ALPHA_ESTIMATE,
  background_foreground_reconstruction_url: BACKGROUND_MATTE_V2_ARTIFACT_FILES.FOREGROUND_RECONSTRUCTION,
})

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function exactKeys(value, expected) {
  if (!isRecord(value)) return false
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index])
}

function expectedMimeType(file) {
  return JSON_ARTIFACTS.has(file) ? 'application/json' : 'image/png'
}

function isArtifactEntry(entry, file) {
  return (
    isRecord(entry) &&
    entry.file === file &&
    Number.isSafeInteger(entry.byte_length) &&
    entry.byte_length > 0 &&
    HASH_PATTERN.test(String(entry.sha256 ?? '')) &&
    entry.mime_type === expectedMimeType(file)
  )
}

function sameArtifactEntry(left, right) {
  return Boolean(left && right) &&
    left.file === right.file &&
    left.byte_length === right.byte_length &&
    left.sha256 === right.sha256 &&
    left.mime_type === right.mime_type
}

function parseJson(buffer, label) {
  try {
    return JSON.parse(buffer.toString('utf8'))
  } catch {
    throw new Error(`Background Matte V2 ${label} is not valid JSON`)
  }
}

function assertNoDecisionState(value) {
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_REVIEW_KEYS.has(key)) {
      throw new Error(`Background Matte V2 review contains forbidden decision field: ${key}`)
    }
    assertNoDecisionState(child)
  }
}

function canonicalJsonHash(value) {
  return sha256(Buffer.from(JSON.stringify(value), 'utf8'))
}

function reviewUrlsAreBound(urls, expectedArtifactUrlPrefix) {
  if (!exactKeys(urls, Object.keys(REVIEW_URL_FILES))) return false
  const prefix = String(expectedArtifactUrlPrefix ?? '').replace(/\/$/, '')
  if (!prefix) return false
  return Object.entries(REVIEW_URL_FILES).every(
    ([key, file]) => urls[key] === `${prefix}/${file}`,
  )
}

export function parseBackgroundMatteV2Evidence(
  generation,
  { backgroundRemovedProviderOutput = null } = {},
) {
  const evidence = generation?.background_matte_v2
  if (evidence == null) return null
  if (
    !exactKeys(evidence, [
      'schema_version',
      'recipe_id',
      'source_rgba_sha256',
      'output_rgba_sha256',
      'provider_calls_used',
      'artifacts',
    ]) ||
    evidence.schema_version !== 1 ||
    evidence.recipe_id !== BACKGROUND_MATTE_V2_ALGORITHM ||
    evidence.provider_calls_used !== 0 ||
    !HASH_PATTERN.test(String(evidence.source_rgba_sha256 ?? '')) ||
    !HASH_PATTERN.test(String(evidence.output_rgba_sha256 ?? '')) ||
    !exactKeys(evidence.artifacts, ARTIFACT_FILES)
  ) {
    throw new Error('Background Matte V2 generation evidence is malformed')
  }
  for (const file of ARTIFACT_FILES) {
    if (!isArtifactEntry(evidence.artifacts[file], file)) {
      throw new Error(`Background Matte V2 Artifact evidence is malformed: ${file}`)
    }
  }
  const output = evidence.artifacts[BACKGROUND_MATTE_V2_ARTIFACT_FILES.OUTPUT]
  if (
    !backgroundRemovedProviderOutput ||
    output.file !== backgroundRemovedProviderOutput.file ||
    output.byte_length !== backgroundRemovedProviderOutput.byte_length ||
    output.sha256 !== backgroundRemovedProviderOutput.sha256 ||
    output.mime_type !== backgroundRemovedProviderOutput.mime_type
  ) {
    throw new Error('Background Matte V2 output binding changed')
  }
  return evidence
}

export async function validateBackgroundMatteV2EvidenceBuffers({
  evidence,
  buffers,
  rawProviderBuffer,
  backgroundRemovedProviderBuffer,
  expectedArtifactUrlPrefix,
} = {}) {
  if (!evidence) return null
  if (!exactKeys(buffers, ARTIFACT_FILES)) {
    throw new Error('Background Matte V2 Artifact buffer set is incomplete')
  }
  for (const file of ARTIFACT_FILES) {
    const buffer = buffers[file]
    const expected = evidence.artifacts[file]
    if (
      !Buffer.isBuffer(buffer) ||
      buffer.length !== expected.byte_length ||
      sha256(buffer) !== expected.sha256
    ) {
      throw new Error(`Background Matte V2 Artifact bytes changed: ${file}`)
    }
  }
  if (!buffers[BACKGROUND_MATTE_V2_ARTIFACT_FILES.OUTPUT].equals(backgroundRemovedProviderBuffer)) {
    throw new Error('Background Matte V2 output bytes changed')
  }
  const [source, output] = await Promise.all([
    loadRgba(rawProviderBuffer, { limitInputPixels: BACKGROUND_MATTE_V2_IMAGE_LIMITS.max_pixels }),
    loadRgba(backgroundRemovedProviderBuffer, { limitInputPixels: BACKGROUND_MATTE_V2_IMAGE_LIMITS.max_pixels }),
  ])
  assertBackgroundMatteV2ImageBudget(source)
  assertBackgroundMatteV2ImageBudget(output)
  if (
    source.width !== output.width ||
    source.height !== output.height ||
    hashRgbaForBackgroundContract(source) !== evidence.source_rgba_sha256 ||
    hashRgbaForBackgroundContract(output) !== evidence.output_rgba_sha256
  ) {
    throw new Error('Background Matte V2 decoded image binding changed')
  }

  const quality = parseJson(
    buffers[BACKGROUND_MATTE_V2_ARTIFACT_FILES.QUALITY],
    'quality evidence',
  )
  const review = parseJson(
    buffers[BACKGROUND_MATTE_V2_ARTIFACT_FILES.REVIEW],
    'review evidence',
  )
  const contractMasks = parseJson(
    buffers[BACKGROUND_MATTE_V2_ARTIFACT_FILES.CONTRACT_MASKS],
    'contract-mask evidence',
  )
  assertNoDecisionState(review)

  const decodedDiagnosticHash = async (file) => {
    const image = await loadRgba(buffers[file], {
      limitInputPixels: BACKGROUND_MATTE_V2_IMAGE_LIMITS.max_pixels,
    })
    assertBackgroundMatteV2ImageBudget(image)
    if (image.width !== source.width || image.height !== source.height) {
      throw new Error(`Background Matte V2 diagnostic dimensions changed: ${file}`)
    }
    return { image, rgbaSha256: hashRgbaForBackgroundContract(image) }
  }
  const alphaEstimate = await decodedDiagnosticHash(
    BACKGROUND_MATTE_V2_ARTIFACT_FILES.ALPHA_ESTIMATE,
  )
  const foregroundReconstruction = await decodedDiagnosticHash(
    BACKGROUND_MATTE_V2_ARTIFACT_FILES.FOREGROUND_RECONSTRUCTION,
  )
  for (const [file, maskName] of [
    [BACKGROUND_MATTE_V2_ARTIFACT_FILES.SURE_BACKGROUND_MASK, 'sure_background'],
    [BACKGROUND_MATTE_V2_ARTIFACT_FILES.UNKNOWN_BAND_MASK, 'unknown_band'],
    [BACKGROUND_MATTE_V2_ARTIFACT_FILES.SURE_FOREGROUND_MASK, 'sure_foreground'],
  ]) {
    const decoded = await decodedDiagnosticHash(file)
    const mask = new Uint8Array(source.width * source.height)
    for (let index = 0; index < mask.length; index += 1) {
      if (decoded.image.data[index * 4 + 3] > 0) mask[index] = 1
    }
    if (
      hashBackgroundContractMask(mask, source.width, source.height) !==
      contractMasks.masks?.[maskName]?.sha256
    ) {
      throw new Error(`Background Matte V2 diagnostic mask changed: ${file}`)
    }
  }

  const analysis = quality.background_analysis
  const { sha256: analysisSha256, ...analysisWithoutHash } = isRecord(analysis) ? analysis : {}
  const contractMasksForHash = { ...contractMasks }
  delete contractMasksForHash.diagnostic_mask_artifacts
  const scopeMetrics = quality.scope_integrity?.metrics
  if (
    quality.schema_version !== 1 ||
    quality.algorithm !== BACKGROUND_MATTE_V2_ALGORITHM ||
    quality.provider_calls_used !== 0 ||
    quality.alpha_integrity?.status !== 'pass' ||
    quality.alpha_integrity?.transparent_nonzero_rgb_pixels !== 0 ||
    quality.source_sha256 !== evidence.source_rgba_sha256 ||
    quality.output_sha256 !== evidence.output_rgba_sha256 ||
    quality.scope_integrity?.status !== 'pass' ||
    scopeMetrics?.sure_foreground_changed_pixels !== 0 ||
    scopeMetrics?.outside_allowed_mutation_mask_changed_pixels !== 0 ||
    scopeMetrics?.unclassified_pixel_count !== 0 ||
    scopeMetrics?.sure_background_remaining_visible_pixels !== 0 ||
    scopeMetrics?.sure_background_nonzero_rgb_pixels !== 0 ||
    scopeMetrics?.background_supported_clear_remaining_visible_pixels !== 0 ||
    scopeMetrics?.background_supported_clear_nonzero_rgb_pixels !== 0 ||
    canonicalJsonHash(analysisWithoutHash) !== analysisSha256 ||
    contractMasks.background_analysis_sha256 !== analysisSha256 ||
    contractMasks.source_sha256 !== evidence.source_rgba_sha256 ||
    contractMasks.unclassified_pixel_count !== 0 ||
    contractMasks.multiply_classified_pixel_count !== 0 ||
    canonicalJsonHash(contractMasksForHash) !== quality.contract_masks_sha256 ||
    quality.boundary_diagnostics?.diagnostic_only !== true ||
    quality.boundary_diagnostics?.participates_in_scope_gate !== false ||
    !isRecord(quality.diagnostic_integrity) ||
    !Object.values(quality.diagnostic_integrity).every((hash) => HASH_PATTERN.test(String(hash))) ||
    quality.diagnostic_integrity.alpha_estimate_rgba_sha256 !== alphaEstimate.rgbaSha256 ||
    quality.diagnostic_integrity.foreground_reconstruction_rgba_sha256 !==
      foregroundReconstruction.rgbaSha256 ||
    !sameArtifactEntry(quality.output_artifact, evidence.artifacts[BACKGROUND_MATTE_V2_ARTIFACT_FILES.OUTPUT]) ||
    !sameArtifactEntry(quality.contract_masks_artifact, evidence.artifacts[BACKGROUND_MATTE_V2_ARTIFACT_FILES.CONTRACT_MASKS]) ||
    !sameArtifactEntry(quality.review_artifact, evidence.artifacts[BACKGROUND_MATTE_V2_ARTIFACT_FILES.REVIEW])
  ) {
    throw new Error('Background Matte V2 mandatory quality evidence changed')
  }

  if (
    !exactKeys(review, REVIEW_KEYS) ||
    review.schema_version !== 1 ||
    review.algorithm !== BACKGROUND_MATTE_V2_ALGORITHM ||
    !Array.isArray(review.reasons) ||
    !isRecord(review.confidence) ||
    !isDeepStrictEqual(review.spill_overlay_legend, BACKGROUND_SPILL_OVERLAY_LEGEND) ||
    !isRecord(review.affected_regions) ||
    !exactKeys(review.hashes, [
      'source_sha256',
      'output_sha256',
      'background_analysis_sha256',
      'background_contract_masks_sha256',
    ]) ||
    !exactKeys(review.artifacts, Object.keys(REVIEW_ARTIFACT_FILES)) ||
    !reviewUrlsAreBound(review.urls, expectedArtifactUrlPrefix) ||
    review.hashes?.source_sha256 !== evidence.source_rgba_sha256 ||
    review.hashes?.output_sha256 !== evidence.output_rgba_sha256 ||
    review.hashes?.background_analysis_sha256 !== analysisSha256 ||
    review.hashes?.background_contract_masks_sha256 !== quality.contract_masks_sha256 ||
    !Object.entries(REVIEW_ARTIFACT_FILES).every(([key, file]) =>
      sameArtifactEntry(review.artifacts?.[key], evidence.artifacts[file])) ||
    !isDeepStrictEqual(
      contractMasks.diagnostic_mask_artifacts?.sure_background,
      evidence.artifacts[BACKGROUND_MATTE_V2_ARTIFACT_FILES.SURE_BACKGROUND_MASK],
    ) ||
    !isDeepStrictEqual(
      contractMasks.diagnostic_mask_artifacts?.unknown_band,
      evidence.artifacts[BACKGROUND_MATTE_V2_ARTIFACT_FILES.UNKNOWN_BAND_MASK],
    ) ||
    !isDeepStrictEqual(
      contractMasks.diagnostic_mask_artifacts?.sure_foreground,
      evidence.artifacts[BACKGROUND_MATTE_V2_ARTIFACT_FILES.SURE_FOREGROUND_MASK],
    )
  ) {
    throw new Error('Background Matte V2 review evidence changed')
  }

  let replayBundle
  try {
    const replay = applyDeterministicPixelMatteV2(source, {
      decode: source.decode ?? null,
    })
    replayBundle = await buildBackgroundMatteV2ArtifactBundle(replay, {
      rawSource: source,
      artifactUrlPrefix: expectedArtifactUrlPrefix,
    })
  } catch (error) {
    throw new Error(`Background Matte V2 deterministic replay failed: ${error.message}`)
  }
  for (const file of ARTIFACT_FILES) {
    if (!replayBundle.files[file].equals(buffers[file])) {
      throw new Error(`Background Matte V2 Artifact does not match deterministic replay: ${file}`)
    }
  }
  return { evidence, quality, review, contractMasks, source, output }
}

export const BACKGROUND_MATTE_V2_EVIDENCE_FILES = ARTIFACT_FILES
