import { createHash, randomUUID } from 'node:crypto'
import { access, readFile, rename, stat } from 'node:fs/promises'
import { isDeepStrictEqual } from 'node:util'

import JSZip from 'jszip'

import {
  buildCharacterPackArtifactManifest,
  encodeCharacterPackArtifactContent,
} from '../character-pack/artifactManifest.js'
import { writeCharacterPackArtifacts } from '../character-pack/artifactWriter.js'
import {
  BACKGROUND_MATTE_V2_ARTIFACT_FILES,
  BACKGROUND_MATTE_V2_AUXILIARY_ARTIFACT_FILES,
} from '../character-pack/backgroundMatteV2.js'
import {
  parseBackgroundMatteV2Evidence,
  validateBackgroundMatteV2EvidenceBuffers,
} from '../character-pack/backgroundMatteV2Evidence.js'
import { BACKGROUND_RECIPE_IDS } from '../character-pack/backgroundProcessingContract.js'
import {
  evaluateProductionSheetReleaseGate,
  FULL_SHEET_DYNAMIC_CHARACTER_PACK_ENTRIES,
  FULL_SHEET_DYNAMIC_STANDALONE_PUBLICATION_FILES,
  FULL_SHEET_MANUAL_ACCEPTANCE_PROTOCOL,
  isCanonicalFullSheetManualAcceptance,
  isCanonicalGenerationReleaseGate,
} from '../character-pack/generationReleaseGate.js'
import {
  assertFullSheetGenerationReferenceManifest,
  assertFullSheetGenerationRequestManifest,
  assertFullSheetGenerationReview,
  GENERATION_PROMPT_FILE,
  GENERATION_REFERENCE_MANIFEST_FILE,
  GENERATION_REQUEST_MANIFEST_FILE,
  GENERATION_REVIEW_FILE,
} from '../character-pack/generationReview.js'
import {
  FULL_SHEET_GENERATION_PROFILE_IDS,
  FULL_SHEET_GENERATION_PROFILES,
} from '../character-pack/generationProfiles.js'
import { processSheetBuffer } from '../character-pack/processSheet.js'
import { TEXT_TO_IMAGE_MODE_PRODUCTION_SHEET } from '../character-pack/textToImagePrompt.js'
import {
  resolveGeneratedJobArtifactFile,
  resolveGeneratedJobDir,
} from '../editor-project/paths.js'

export const FULL_SHEET_MANUAL_ACCEPTANCE_FILE = 'manual_acceptance.json'

const JSON_LIMIT_BYTES = 16 * 1024 * 1024
const IMAGE_LIMIT_BYTES = 64 * 1024 * 1024
const ZIP_LIMIT_BYTES = 512 * 1024 * 1024
const HASH_PATTERN = /^[a-f0-9]{64}$/
const RAW_PROVIDER_FILE_PATTERN = /^raw_provider_output\.(?:png|jpg|webp|gif|bin)$/
const BACKGROUND_REMOVED_PROVIDER_FILE = 'background_removed_provider_output.png'
const SUPPORTED_PROFILE_IDS = new Set(Object.values(FULL_SHEET_GENERATION_PROFILE_IDS))
const ENGINE_ZIP_ARTIFACTS = Object.freeze([
  Object.freeze({
    key: 'godot_npc',
    file: 'godot_npc_pack.zip',
    resultKey: 'godotNpcZipBuffer',
    label: 'Godot NPC Pack',
  }),
  Object.freeze({
    key: 'rpgmaker',
    file: 'rpgmaker_pack.zip',
    resultKey: 'rpgmakerZipBuffer',
    label: 'RPG Maker Pack',
  }),
  Object.freeze({
    key: 'ocad',
    file: 'ocad_pack.zip',
    resultKey: 'ocadZipBuffer',
    label: 'OCAD Pack',
  }),
])
const DYNAMIC_STANDALONE_PUBLICATION_FILES = new Set(
  FULL_SHEET_DYNAMIC_STANDALONE_PUBLICATION_FILES,
)
const DYNAMIC_CHARACTER_PACK_ENTRIES = new Set(
  FULL_SHEET_DYNAMIC_CHARACTER_PACK_ENTRIES,
)
const FORBIDDEN_CHARACTER_PACK_ENTRIES = new Set([
  ...DYNAMIC_CHARACTER_PACK_ENTRIES,
  'character_pack.zip',
])
const REQUIRED_DYNAMIC_CHARACTER_PACK_ENTRIES = Object.freeze(
  [...DYNAMIC_CHARACTER_PACK_ENTRIES].sort(),
)
const ACCEPT_REQUEST_FIELDS = new Set([
  'confirmManualAcceptance',
  'expectedPlanHash',
  'expectedReferenceManifestSha256',
  'expectedRawProviderOutputSha256',
  'expectedBackgroundRemovedProviderOutputSha256',
  'expectedSourceSha256',
  'expectedNormalizedSheetSha256',
  'humanReviewedIssueCount',
])
const publicationLocks = new Map()

async function withPublicationLock(publicationId, task) {
  const previous = publicationLocks.get(publicationId) ?? Promise.resolve()
  let release
  const current = new Promise((resolve) => {
    release = resolve
  })
  publicationLocks.set(publicationId, current)
  await previous
  try {
    return await task()
  } finally {
    release()
    if (publicationLocks.get(publicationId) === current) publicationLocks.delete(publicationId)
  }
}

function acceptanceError(code, reason, httpStatus = 400) {
  return Object.assign(new Error(reason), {
    code,
    reason,
    http_status: httpStatus,
    provider_calls_used: 0,
  })
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value))
}

function publicationEvidenceEntry(file, buffer) {
  return {
    file,
    sha256: sha256(buffer),
    byte_length: buffer.byteLength,
  }
}

function buildStandalonePublicationEvidence(result) {
  const manifest = buildCharacterPackArtifactManifest('publication_integrity', {
    ...result,
    generationReleaseGate: null,
  })
  const seen = new Set()
  return manifest.files
    .filter(({ name }) => !DYNAMIC_STANDALONE_PUBLICATION_FILES.has(name))
    .map(({ name, content }) => {
      if (seen.has(name)) {
        throw acceptanceError(
          'publication_integrity_failed',
          `duplicate release artifact in publication manifest: ${name}`,
          409,
        )
      }
      seen.add(name)
      return publicationEvidenceEntry(name, encodeCharacterPackArtifactContent(content))
    })
    .sort((left, right) => (left.file < right.file ? -1 : left.file > right.file ? 1 : 0))
}

function metadataWithoutGenerationBuffer(metadata) {
  const projection = cloneJson(metadata)
  delete projection.generation
  return encodeCharacterPackArtifactContent(projection)
}

function publicationArtifactLimit(fileName) {
  if (fileName.endsWith('.zip')) return ZIP_LIMIT_BYTES
  if (fileName.endsWith('.json') || fileName.endsWith('.txt')) return JSON_LIMIT_BYTES
  return IMAGE_LIMIT_BYTES
}

function backgroundRemovedProviderEvidence(generation) {
  const evidence = generation?.background_removed_provider_output
  if (evidence == null) return null
  if (
    !isRecord(evidence) ||
    evidence.file !== BACKGROUND_REMOVED_PROVIDER_FILE ||
    !HASH_PATTERN.test(String(evidence.sha256 ?? '')) ||
    !Number.isSafeInteger(evidence.byte_length) ||
    evidence.byte_length <= 0 ||
    !Number.isSafeInteger(evidence.width) ||
    evidence.width <= 0 ||
    !Number.isSafeInteger(evidence.height) ||
    evidence.height <= 0 ||
    evidence.mime_type !== 'image/png' ||
    evidence.processing !== 'background_removal_only' ||
    !RAW_PROVIDER_FILE_PATTERN.test(String(evidence.source_file ?? '')) ||
    !HASH_PATTERN.test(String(evidence.source_sha256 ?? ''))
  ) {
    throw acceptanceError(
      'artifact_integrity_failed',
      'background-removed Provider output evidence is malformed',
      409,
    )
  }
  return evidence
}

function backgroundMatteV2Evidence(generation, backgroundRemovedProviderOutput) {
  try {
    return parseBackgroundMatteV2Evidence(generation, { backgroundRemovedProviderOutput })
  } catch (error) {
    throw acceptanceError('artifact_integrity_failed', error.message, 409)
  }
}

function currentFullSheetGenerationProfile(profileId) {
  const profile = FULL_SHEET_GENERATION_PROFILES[profileId]
  if (!profile) {
    throw acceptanceError('source_not_reviewable', 'source generation Profile is unsupported', 409)
  }
  return profile
}

export function assertProfileBackgroundEvidence({
  profile,
  backgroundRemovedProviderOutput,
  backgroundMatteV2,
}) {
  const requiresBackgroundMatteV2 =
    profile.background_recipe_id === BACKGROUND_RECIPE_IDS.DETERMINISTIC_PIXEL_MATTE_V2
  if (requiresBackgroundMatteV2 && (!backgroundRemovedProviderOutput || !backgroundMatteV2)) {
    throw acceptanceError(
      'artifact_integrity_failed',
      'strict fixed-region Profile requires complete Background Matte V2 evidence',
      409,
    )
  }
  if (!requiresBackgroundMatteV2 && backgroundMatteV2) {
    throw acceptanceError(
      'artifact_integrity_failed',
      'Background Matte V2 evidence does not match the sealed generation Profile recipe',
      409,
    )
  }
}

async function readBackgroundMatteV2Buffers({
  evidence,
  outputBuffer,
  readArtifact,
}) {
  if (!evidence) return null
  const entries = await Promise.all(BACKGROUND_MATTE_V2_AUXILIARY_ARTIFACT_FILES.map(async (file) => [
    file,
    await readArtifact(
      file,
      file.endsWith('.json') ? JSON_LIMIT_BYTES : IMAGE_LIMIT_BYTES,
      `Background Matte V2 Artifact ${file}`,
    ),
  ]))
  return {
    [BACKGROUND_MATTE_V2_ARTIFACT_FILES.OUTPUT]: outputBuffer,
    ...Object.fromEntries(entries),
  }
}

async function assertBackgroundMatteV2EvidenceBuffers(options) {
  if (!options.evidence) return null
  try {
    return await validateBackgroundMatteV2EvidenceBuffers(options)
  } catch (error) {
    throw acceptanceError('artifact_integrity_failed', error.message, 409)
  }
}

function hasSingleSuccessfulProviderAttemptLedger(attempts) {
  return (
    Array.isArray(attempts) &&
    attempts.length === 1 &&
    attempts[0]?.attempt_number === 1 &&
    attempts[0]?.status === 'success' &&
    attempts[0]?.provider_call_budget_before?.used_provider_calls === 0 &&
    attempts[0]?.provider_call_budget_before?.max_provider_calls === 1 &&
    attempts[0]?.provider_call_budget_after?.used_provider_calls === 1 &&
    attempts[0]?.provider_call_budget_after?.max_provider_calls === 1
  )
}

function assertHash(value, field) {
  const normalized = String(value ?? '').trim()
  if (!HASH_PATTERN.test(normalized)) {
    throw acceptanceError('invalid_acceptance_request', `${field} must be a SHA-256 hash`)
  }
  return normalized
}

export function parseFullSheetManualAcceptanceRequest(input) {
  if (!isRecord(input)) {
    throw acceptanceError('invalid_acceptance_request', 'manual acceptance body must be an object')
  }
  const unknown = Object.keys(input).filter((key) => !ACCEPT_REQUEST_FIELDS.has(key))
  if (unknown.length) {
    throw acceptanceError('invalid_acceptance_request', `unsupported manual acceptance field: ${unknown[0]}`)
  }
  if (input.confirmManualAcceptance !== true) {
    throw acceptanceError('manual_confirmation_required', 'confirmManualAcceptance: true is required')
  }
  const humanReviewedIssueCount = Number(input.humanReviewedIssueCount)
  if (!Number.isInteger(humanReviewedIssueCount) || humanReviewedIssueCount < 0) {
    throw acceptanceError('invalid_acceptance_request', 'humanReviewedIssueCount must be a non-negative integer')
  }
  return Object.freeze({
    confirmManualAcceptance: true,
    expectedPlanHash: assertHash(input.expectedPlanHash, 'expectedPlanHash'),
    expectedReferenceManifestSha256: assertHash(
      input.expectedReferenceManifestSha256,
      'expectedReferenceManifestSha256',
    ),
    expectedRawProviderOutputSha256: assertHash(
      input.expectedRawProviderOutputSha256,
      'expectedRawProviderOutputSha256',
    ),
    expectedBackgroundRemovedProviderOutputSha256:
      input.expectedBackgroundRemovedProviderOutputSha256 == null
        ? null
        : assertHash(
            input.expectedBackgroundRemovedProviderOutputSha256,
            'expectedBackgroundRemovedProviderOutputSha256',
          ),
    expectedSourceSha256: assertHash(input.expectedSourceSha256, 'expectedSourceSha256'),
    expectedNormalizedSheetSha256: assertHash(
      input.expectedNormalizedSheetSha256,
      'expectedNormalizedSheetSha256',
    ),
    humanReviewedIssueCount,
  })
}

function publishedJobId(sourceJobId) {
  const id = String(sourceJobId ?? '')
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(id) || id.includes('..')) {
    throw acceptanceError('invalid_source_job_id', 'source generation job id is unsafe')
  }
  return `accepted_v1_${id}`
}

async function readBounded(filePath, maxBytes, label) {
  const details = await stat(filePath)
  if (!details.isFile() || details.size <= 0 || details.size > maxBytes) {
    throw acceptanceError('artifact_integrity_failed', `${label} exceeds its accepted file contract`, 409)
  }
  return readFile(filePath)
}

async function readSourceArtifact({ sourceJobId, fileName, generatedDir, maxBytes, label }) {
  let filePath
  try {
    filePath = await resolveGeneratedJobArtifactFile({
      jobId: sourceJobId,
      fileName,
      allowedFiles: new Set([fileName]),
      generatedDir,
    })
  } catch (error) {
    throw acceptanceError(
      error?.code === 'artifact_not_found' ? 'source_job_not_found' : 'artifact_integrity_failed',
      `${label} is unavailable or unsafe`,
      error?.code === 'artifact_not_found' ? 404 : 409,
    )
  }
  return readBounded(filePath, maxBytes, label)
}

async function readJsonArtifact(options) {
  const buffer = await readSourceArtifact({ ...options, maxBytes: JSON_LIMIT_BYTES })
  try {
    return { buffer, value: JSON.parse(buffer.toString('utf8')) }
  } catch {
    throw acceptanceError('artifact_integrity_failed', `${options.label} is not valid JSON`, 409)
  }
}

async function readAndAssertGenerationReviewBinding({ generation, request, generatedDir }) {
  const reviewedRunId = String(generation?.generation_review?.reviewed_run_id ?? '')
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(reviewedRunId) || reviewedRunId.includes('..')) {
    throw acceptanceError('artifact_integrity_failed', 'source generation Review id is invalid', 409)
  }
  let reviewArtifact
  let requestArtifact
  let referenceArtifact
  let reviewedPromptBuffer
  let reviewedReferenceBuffers
  try {
    [reviewArtifact, requestArtifact, referenceArtifact, reviewedPromptBuffer] = await Promise.all([
      readJsonArtifact({
        sourceJobId: reviewedRunId,
        fileName: GENERATION_REVIEW_FILE,
        generatedDir,
        label: 'sealed generation Review',
      }),
      readJsonArtifact({
        sourceJobId: reviewedRunId,
        fileName: GENERATION_REQUEST_MANIFEST_FILE,
        generatedDir,
        label: 'sealed generation request manifest',
      }),
      readJsonArtifact({
        sourceJobId: reviewedRunId,
        fileName: GENERATION_REFERENCE_MANIFEST_FILE,
        generatedDir,
        label: 'sealed generation reference manifest',
      }),
      readSourceArtifact({
        sourceJobId: reviewedRunId,
        fileName: GENERATION_PROMPT_FILE,
        generatedDir,
        maxBytes: JSON_LIMIT_BYTES,
        label: 'sealed generation prompt',
      }),
    ])
    assertFullSheetGenerationReview(reviewArtifact.value)
    assertFullSheetGenerationRequestManifest(requestArtifact.value)
    const referenceManifest = assertFullSheetGenerationReferenceManifest(
      referenceArtifact.value,
      requestArtifact.value.reference_manifest_sha256,
      requestArtifact.value.generation_profile,
    )
    reviewedReferenceBuffers = await Promise.all(referenceManifest.items.map((item) => (
      readSourceArtifact({
        sourceJobId: reviewedRunId,
        fileName: item.name,
        generatedDir,
        maxBytes: IMAGE_LIMIT_BYTES,
        label: `sealed generation ${item.role} reference`,
      })
    )))
    if (referenceManifest.items.some((item, index) => (
      reviewedReferenceBuffers[index].byteLength !== item.byte_length ||
      sha256(reviewedReferenceBuffers[index]) !== item.sha256
    ))) {
      throw new Error('generation reference bytes changed')
    }
  } catch (error) {
    throw acceptanceError(
      'artifact_integrity_failed',
      `sealed generation Review is unavailable or changed: ${String(error?.reason ?? error?.message ?? error)}`,
      409,
    )
  }

  const review = reviewArtifact.value
  const requestManifest = requestArtifact.value
  const referenceManifest = referenceArtifact.value
  currentFullSheetGenerationProfile(generation.generation_profile_id)
  const profile = requestManifest.generation_profile
  const referenceOrder = referenceManifest.items.map(({ name, role }) => ({ name, role }))
  const referencesByRole = Object.fromEntries(
    referenceManifest.items.map((item) => [item.role, item]),
  )
  const expectedInputImages = {
    template: Boolean(referencesByRole.structure),
    reference: Boolean(referencesByRole.identity),
    palette: Boolean(referencesByRole.palette),
  }
  const reviewedPromptSha256 = sha256(reviewedPromptBuffer)
  if (
    review.review_id !== reviewedRunId ||
    review.generation_profile_id !== generation.generation_profile_id ||
    review.plan_hash !== request.expectedPlanHash ||
    review.reference_manifest_sha256 !== request.expectedReferenceManifestSha256 ||
    review.request_manifest_file !== GENERATION_REQUEST_MANIFEST_FILE ||
    review.reference_manifest_file !== GENERATION_REFERENCE_MANIFEST_FILE ||
    review.prompt_file !== GENERATION_PROMPT_FILE ||
    requestManifest.review_id !== reviewedRunId ||
    requestManifest.plan_hash !== request.expectedPlanHash ||
    requestManifest.reference_manifest_sha256 !== request.expectedReferenceManifestSha256 ||
    requestManifest.generation_profile?.id !== generation.generation_profile_id ||
    !isDeepStrictEqual(requestManifest.reference_order, referenceOrder) ||
    referenceManifest.generation_profile_id !== profile.id ||
    !isDeepStrictEqual(referenceManifest.reference_size, profile.reference_size) ||
    reviewedPromptSha256 !== requestManifest.prompt_text_sha256 ||
    !isDeepStrictEqual(generation.generation_review, {
      reviewed_run_id: reviewedRunId,
      plan_hash: request.expectedPlanHash,
      reference_manifest_sha256: request.expectedReferenceManifestSha256,
    }) ||
    generation.provider !== requestManifest.provider.provider ||
    generation.provider_preset_id !== requestManifest.provider.preset_id ||
    generation.model !== requestManifest.provider.model ||
    generation.route_kind !== requestManifest.provider.route_kind ||
    !isDeepStrictEqual(generation.image_config, requestManifest.image_config) ||
    !isDeepStrictEqual(generation.generation_options, requestManifest.generation_options) ||
    !isDeepStrictEqual(generation.prompt_contract, requestManifest.prompt_contract) ||
    generation.prompt_file !== 'prompt.txt' ||
    generation.template_file !== referencesByRole.structure?.name ||
    generation.reference_file !== (referencesByRole.identity?.name ?? null) ||
    generation.palette_file !== (referencesByRole.palette?.name ?? null) ||
    !isDeepStrictEqual(generation.input_images, expectedInputImages)
  ) {
    throw acceptanceError('acceptance_binding_stale', 'sealed generation Review binding changed', 409)
  }
  return {
    profile,
    reviewedRunId,
    promptSha256: reviewedPromptSha256,
    reviewedPromptBuffer,
  }
}

function assertReviewRequiredGeneration({
  generation,
  gate,
  debugReport,
  sourceSubjectCountReport,
  normalizedSubjectCountReport,
  request,
}) {
  const profileId = generation?.generation_profile_id
  const review = generation?.generation_review
  const selection = generation?.candidate_selection
  const attempts = generation?.provider_attempts
  const recomputedGate = evaluateProductionSheetReleaseGate({ debugReport })
  const selectedCandidate = Array.isArray(selection?.candidates) && selection.candidates.length === 1
    ? selection.candidates[0]
    : null
  if (
    !SUPPORTED_PROFILE_IDS.has(profileId) ||
    generation?.mode !== TEXT_TO_IMAGE_MODE_PRODUCTION_SHEET ||
    generation?.prompt_contract?.contract_version !== 'character_prompt_contract_v1_18' ||
    debugReport?.generation_profile?.id !== profileId ||
    !isDeepStrictEqual(recomputedGate, gate) ||
    !isDeepStrictEqual(debugReport?.subject_count?.source, sourceSubjectCountReport) ||
    !isDeepStrictEqual(debugReport?.subject_count?.normalized, normalizedSubjectCountReport) ||
    selection?.artifact_disposition !== 'review_required' ||
    selection?.manual_review_required !== true ||
    selection?.human_decision_status !== 'pending' ||
    selection?.release_ready !== false ||
    selection?.release_selected_index !== null ||
    selection?.release_selected_score !== null ||
    selection?.candidate_count !== 1 ||
    selection?.generation_options?.candidateCount !== 1 ||
    !Number.isInteger(selection?.selected_index) ||
    selection.selected_index !== 1 ||
    selectedCandidate?.index !== 1 ||
    selectedCandidate?.release_ready !== false ||
    selectedCandidate?.manual_review_required !== true ||
    selectedCandidate?.human_decision_status !== 'pending' ||
    !isDeepStrictEqual(selectedCandidate?.release_gate, gate) ||
    !isDeepStrictEqual(selectedCandidate?.provider_attempts, attempts) ||
    !isDeepStrictEqual(selectedCandidate?.prompt_contract, generation?.prompt_contract) ||
    !hasSingleSuccessfulProviderAttemptLedger(attempts) ||
    !isCanonicalGenerationReleaseGate(gate) ||
    gate.status !== 'needs_review' ||
    gate.release_ready !== false ||
    gate.manual_review_required !== true ||
    gate.human_decision_status !== 'pending' ||
    gate.blocking_errors.length !== 0
  ) {
    throw acceptanceError(
      'source_not_reviewable',
      'source job is not a complete strict full-sheet review candidate',
      409,
    )
  }
  if (
    review?.plan_hash !== request.expectedPlanHash ||
    review?.reference_manifest_sha256 !== request.expectedReferenceManifestSha256
  ) {
    throw acceptanceError('acceptance_binding_stale', 'generation Review binding changed', 409)
  }
}

function acceptedReleaseGate(originalGate, manualAcceptance) {
  return {
    ...cloneJson(originalGate),
    status: 'accepted',
    release_ready: true,
    manual_review_required: false,
    human_decision_status: 'accepted',
    generation_profile_id: manualAcceptance.generation_profile_id,
    prompt_contract_version: manualAcceptance.prompt_contract_version,
    manual_acceptance: manualAcceptance,
  }
}

function acceptedCandidateSelection(originalSelection, acceptedGate) {
  const selection = cloneJson(originalSelection)
  selection.release_selected_index = selection.selected_index
  selection.release_selected_score = selection.selected_score ?? null
  selection.release_ready = true
  selection.artifact_disposition = 'release'
  selection.manual_review_required = false
  selection.human_decision_status = 'accepted'
  selection.review_status = 'accepted'
  selection.candidates = (selection.candidates ?? []).map((candidate) => (
    candidate.index === selection.selected_index
      ? {
          ...candidate,
          status: 'accepted',
          reason: null,
          release_ready: true,
          manual_review_required: false,
          human_decision_status: 'accepted',
          release_gate: acceptedGate,
        }
      : candidate
  ))
  return selection
}

async function patchReleaseZip(result, {
  acceptedGate,
  generation,
  manualAcceptanceBuffer,
  promptBuffer,
  backgroundMatteV2Buffers = null,
}) {
  const zip = await loadCharacterPackZip(result.files.zipBuffer, 'rebuilt Character Pack')
  zip.file('metadata.json', encodeCharacterPackArtifactContent(result.metadataJson))
  zip.file('generation.json', encodeCharacterPackArtifactContent(generation))
  zip.file('generation_release_gate.json', encodeCharacterPackArtifactContent(acceptedGate))
  zip.file(FULL_SHEET_MANUAL_ACCEPTANCE_FILE, manualAcceptanceBuffer)
  zip.file('prompt.txt', promptBuffer)
  if (backgroundMatteV2Buffers) {
    for (const file of Object.values(BACKGROUND_MATTE_V2_ARTIFACT_FILES)) {
      zip.file(file, backgroundMatteV2Buffers[file])
    }
  }
  result.files.zipBuffer = await zip.generateAsync({ type: 'nodebuffer' })
}

function publicationUrls(
  publicationId,
  rawProviderFile,
  backgroundRemovedProviderFile = null,
  backgroundMatteV2 = false,
) {
  const url = (file) => `/generated/${publicationId}/${file}`
  return {
    result_url: url('metadata.json'),
    raw_provider_output_url: url(rawProviderFile),
    ...(backgroundRemovedProviderFile
      ? { background_removed_provider_output_url: url(backgroundRemovedProviderFile) }
      : {}),
    ...(backgroundMatteV2
      ? {
          background_quality_url: url(BACKGROUND_MATTE_V2_ARTIFACT_FILES.QUALITY),
          background_review_url: url(BACKGROUND_MATTE_V2_ARTIFACT_FILES.REVIEW),
          background_contract_masks_url: url(BACKGROUND_MATTE_V2_ARTIFACT_FILES.CONTRACT_MASKS),
          background_preview_url: url(BACKGROUND_MATTE_V2_ARTIFACT_FILES.PREVIEW),
          background_spill_overlay_url: url(BACKGROUND_MATTE_V2_ARTIFACT_FILES.SPILL_OVERLAY),
          background_sure_background_mask_url: url(BACKGROUND_MATTE_V2_ARTIFACT_FILES.SURE_BACKGROUND_MASK),
          background_unknown_band_mask_url: url(BACKGROUND_MATTE_V2_ARTIFACT_FILES.UNKNOWN_BAND_MASK),
          background_sure_foreground_mask_url: url(BACKGROUND_MATTE_V2_ARTIFACT_FILES.SURE_FOREGROUND_MASK),
          background_alpha_estimate_url: url(BACKGROUND_MATTE_V2_ARTIFACT_FILES.ALPHA_ESTIMATE),
          background_foreground_reconstruction_url: url(BACKGROUND_MATTE_V2_ARTIFACT_FILES.FOREGROUND_RECONSTRUCTION),
        }
      : {}),
    source_url: url('source.png'),
    normalized_sheet_url: url('normalized_sheet.png'),
    animations_url: url('animations.json'),
    metadata_url: url('metadata.json'),
    editor_metadata_url: url('editor_metadata.json'),
    generation_release_gate_url: url('generation_release_gate.json'),
    manual_acceptance_url: url(FULL_SHEET_MANUAL_ACCEPTANCE_FILE),
    generation_url: url('generation.json'),
    zip_url: url('character_pack.zip'),
    godot_npc_zip_url: url('godot_npc_pack.zip'),
    rpgmaker_zip_url: url('rpgmaker_pack.zip'),
    ocad_zip_url: url('ocad_pack.zip'),
  }
}

function parseJsonBuffer(buffer, label) {
  try {
    return JSON.parse(buffer.toString('utf8'))
  } catch {
    throw acceptanceError('artifact_integrity_failed', `${label} is not valid JSON`, 409)
  }
}

async function readBoundedZipEntry(zip, fileName, maxBytes, label) {
  const entry = zip.file(fileName)
  const declaredSize = Number(entry?._data?.uncompressedSize)
  if (
    !entry ||
    !Number.isSafeInteger(declaredSize) ||
    declaredSize <= 0 ||
    declaredSize > maxBytes
  ) {
    throw acceptanceError('artifact_integrity_failed', `${label} exceeds its ZIP entry contract`, 409)
  }
  const buffer = await entry.async('nodebuffer')
  if (buffer.byteLength !== declaredSize || buffer.byteLength > maxBytes) {
    throw acceptanceError('artifact_integrity_failed', `${label} changed during ZIP decode`, 409)
  }
  return buffer
}

async function loadCharacterPackZip(buffer, label) {
  if (!Buffer.isBuffer(buffer) || buffer.byteLength <= 0 || buffer.byteLength > ZIP_LIMIT_BYTES) {
    throw acceptanceError('artifact_integrity_failed', `${label} exceeds its ZIP contract`, 409)
  }
  let directory
  try {
    directory = await JSZip.loadAsync(buffer)
  } catch {
    throw acceptanceError('artifact_integrity_failed', `${label} is not a valid ZIP`, 409)
  }
  const entries = Object.values(directory.files)
  const files = entries.filter((entry) => !entry.dir)
  let totalUncompressedBytes = 0
  if (files.length === 0 || entries.length > 1024) {
    throw acceptanceError('artifact_integrity_failed', `${label} exceeds its entry contract`, 409)
  }
  for (const entry of files) {
    const declaredSize = Number(entry?._data?.uncompressedSize)
    if (
      !Number.isSafeInteger(declaredSize) ||
      declaredSize <= 0 ||
      declaredSize > publicationArtifactLimit(entry.name)
    ) {
      throw acceptanceError(
        'artifact_integrity_failed',
        `${label} entry exceeds its size contract: ${entry.name}`,
        409,
      )
    }
    totalUncompressedBytes += declaredSize
    if (totalUncompressedBytes > ZIP_LIMIT_BYTES) {
      throw acceptanceError('artifact_integrity_failed', `${label} expands beyond its ZIP contract`, 409)
    }
  }
  try {
    return await JSZip.loadAsync(buffer, { checkCRC32: true })
  } catch {
    throw acceptanceError('artifact_integrity_failed', `${label} failed CRC validation`, 409)
  }
}

function characterPackFileNames(zip) {
  return Object.values(zip.files)
    .filter((entry) => !entry.dir)
    .map((entry) => entry.name)
    .sort()
}

function characterPackDirectoryNames(zip) {
  return Object.values(zip.files)
    .filter((entry) => entry.dir)
    .map((entry) => entry.name)
    .sort()
}

function impliedCharacterPackDirectoryNames(files) {
  const directories = new Set()
  for (const file of files) {
    const segments = file.split('/')
    for (let index = 1; index < segments.length; index += 1) {
      directories.add(`${segments.slice(0, index).join('/')}/`)
    }
  }
  return [...directories].sort()
}

async function buildCharacterPackEntryEvidence(zip) {
  const evidence = []
  for (const file of characterPackFileNames(zip)) {
    if (DYNAMIC_CHARACTER_PACK_ENTRIES.has(file)) continue
    if (FORBIDDEN_CHARACTER_PACK_ENTRIES.has(file)) {
      throw acceptanceError(
        'artifact_integrity_failed',
        `forbidden Character Pack entry: ${file}`,
        409,
      )
    }
    const buffer = await readBoundedZipEntry(
      zip,
      file,
      publicationArtifactLimit(file),
      `Character Pack entry ${file}`,
    )
    evidence.push(publicationEvidenceEntry(file, buffer))
  }
  return evidence
}

async function buildPreparedCharacterPackEntryEvidence({
  zipBuffer,
  promptBuffer,
  backgroundMatteV2Buffers,
}) {
  const zip = await loadCharacterPackZip(zipBuffer, 'rebuilt Character Pack')
  zip.file('prompt.txt', promptBuffer)
  if (backgroundMatteV2Buffers) {
    for (const file of Object.values(BACKGROUND_MATTE_V2_ARTIFACT_FILES)) {
      zip.file(file, backgroundMatteV2Buffers[file])
    }
  }
  const preparedBuffer = await zip.generateAsync({ type: 'nodebuffer' })
  const preparedZip = await loadCharacterPackZip(preparedBuffer, 'prepared Character Pack')
  return buildCharacterPackEntryEvidence(preparedZip)
}

async function assertPreparedPublicationIntegrity(result, acceptance) {
  const releaseFiles = buildStandalonePublicationEvidence(result)
  if (!isDeepStrictEqual(releaseFiles, acceptance.publication_artifacts.release_files)) {
    throw acceptanceError(
      'publication_integrity_failed',
      'release artifacts changed while sealing manual acceptance',
      409,
    )
  }
  if (
    sha256(metadataWithoutGenerationBuffer(result.metadataJson)) !==
      acceptance.publication_artifacts.metadata_without_generation_sha256
  ) {
    throw acceptanceError(
      'publication_integrity_failed',
      'metadata changed while sealing manual acceptance',
      409,
    )
  }

  const zip = await loadCharacterPackZip(result.files.zipBuffer, 'sealed Character Pack')
  assertExactCharacterPackEntrySet(
    zip,
    acceptance.publication_artifacts.character_pack_entries,
  )
  const characterPackEntries = await buildCharacterPackEntryEvidence(zip)
  if (
    !isDeepStrictEqual(
      characterPackEntries,
      acceptance.publication_artifacts.character_pack_entries,
    )
  ) {
    throw acceptanceError(
      'publication_integrity_failed',
      'Character Pack entries changed while sealing manual acceptance',
      409,
    )
  }

  const expectedDynamicEntries = new Map([
    [FULL_SHEET_MANUAL_ACCEPTANCE_FILE, result.files.manualAcceptanceJson],
    ['generation_release_gate.json', encodeCharacterPackArtifactContent(result.generationReleaseGate)],
    ['generation.json', result.files.generationJson],
    ['metadata.json', encodeCharacterPackArtifactContent(result.metadataJson)],
  ])
  for (const [file, expected] of expectedDynamicEntries) {
    const actual = await readBoundedZipEntry(
      zip,
      file,
      JSON_LIMIT_BYTES,
      `sealed Character Pack entry ${file}`,
    )
    if (!Buffer.isBuffer(expected) || !actual.equals(expected)) {
      throw acceptanceError(
        'publication_integrity_failed',
        `dynamic Character Pack entry changed while sealing manual acceptance: ${file}`,
        409,
      )
    }
  }
}

function assertExactCharacterPackEntrySet(zip, staticEvidence) {
  const expectedFiles = [
    ...staticEvidence.map((entry) => entry.file),
    ...REQUIRED_DYNAMIC_CHARACTER_PACK_ENTRIES,
  ].sort()
  const actualFiles = characterPackFileNames(zip)
  const expectedDirectories = impliedCharacterPackDirectoryNames(expectedFiles)
  const actualDirectories = characterPackDirectoryNames(zip)
  if (
    !isDeepStrictEqual(actualFiles, expectedFiles) ||
    !isDeepStrictEqual(actualDirectories, expectedDirectories)
  ) {
    throw acceptanceError(
      'artifact_integrity_failed',
      'published Character Pack entry set changed',
      409,
    )
  }
}

function assertCanonicalJsonBuffer(value, buffer, label) {
  if (!encodeCharacterPackArtifactContent(value).equals(buffer)) {
    throw acceptanceError('artifact_integrity_failed', `${label} encoding changed`, 409)
  }
}

async function assertValidEngineZip(buffer, label) {
  if (!Buffer.isBuffer(buffer) || buffer.byteLength <= 0 || buffer.byteLength > ZIP_LIMIT_BYTES) {
    throw acceptanceError('artifact_integrity_failed', `${label} exceeds its ZIP contract`, 409)
  }
  let zip
  try {
    zip = await JSZip.loadAsync(buffer, { checkCRC32: true })
  } catch {
    throw acceptanceError('artifact_integrity_failed', `${label} is not a valid ZIP`, 409)
  }
  if (!Object.values(zip.files).some((entry) => !entry.dir)) {
    throw acceptanceError('artifact_integrity_failed', `${label} contains no files`, 409)
  }
}

async function buildEngineZipPublicationEvidence(files) {
  const entries = await Promise.all(ENGINE_ZIP_ARTIFACTS.map(async (artifact) => {
    const buffer = files?.[artifact.resultKey]
    await assertValidEngineZip(buffer, artifact.label)
    return [artifact.key, {
      file: artifact.file,
      sha256: sha256(buffer),
      byte_length: buffer.byteLength,
    }]
  }))
  return Object.fromEntries(entries)
}

async function loadExistingPublication({ generatedDir, publicationId, sourceJobId, request }) {
  const publicationDir = resolveGeneratedJobDir(publicationId, { generatedDir })
  try {
    await access(publicationDir)
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw acceptanceError('acceptance_conflict', 'published acceptance directory is inaccessible', 409)
  }
  const readPublished = async (fileName, maxBytes, label) => {
    try {
      return await readSourceArtifact({
        sourceJobId: publicationId,
        fileName,
        generatedDir,
        maxBytes,
        label,
      })
    } catch (error) {
      if (error?.code === 'source_job_not_found') {
        throw acceptanceError('acceptance_conflict', 'published acceptance is incomplete', 409)
      }
      throw error
    }
  }
  const [acceptanceBuffer, gateBuffer, generationBuffer] = await Promise.all([
    readPublished(FULL_SHEET_MANUAL_ACCEPTANCE_FILE, JSON_LIMIT_BYTES, 'manual acceptance manifest'),
    readPublished('generation_release_gate.json', JSON_LIMIT_BYTES, 'published generation release gate'),
    readPublished('generation.json', JSON_LIMIT_BYTES, 'published generation evidence'),
  ])
  const acceptance = parseJsonBuffer(acceptanceBuffer, 'published manual acceptance manifest')
  const acceptedGate = parseJsonBuffer(gateBuffer, 'published generation release gate')
  const acceptedGeneration = parseJsonBuffer(generationBuffer, 'published generation evidence')
  const sealedReview = await readAndAssertGenerationReviewBinding({
    generation: acceptedGeneration,
    request,
    generatedDir,
  })
  const backgroundRemovedEvidence = backgroundRemovedProviderEvidence(acceptedGeneration)
  const matteV2Evidence = backgroundMatteV2Evidence(
    acceptedGeneration,
    backgroundRemovedEvidence,
  )
  assertProfileBackgroundEvidence({
    profile: sealedReview.profile,
    backgroundRemovedProviderOutput: backgroundRemovedEvidence,
    backgroundMatteV2: matteV2Evidence,
  })
  const acceptedSelection = acceptedGeneration.candidate_selection
  const acceptedAttempts = acceptedGeneration.provider_attempts
  const acceptedCandidate = Array.isArray(acceptedSelection?.candidates) &&
    acceptedSelection.candidates.length === 1
    ? acceptedSelection.candidates[0]
    : null
  if (
    !isCanonicalFullSheetManualAcceptance(acceptance) ||
    acceptance.acceptance_id !== publicationId ||
    acceptance.source_job_id !== sourceJobId ||
    acceptance.published_job_id !== publicationId ||
    acceptance.human_reviewed_issue_count !== request.humanReviewedIssueCount ||
    acceptance.generation_review.plan_hash !== request.expectedPlanHash ||
    acceptance.generation_review.reference_manifest_sha256 !== request.expectedReferenceManifestSha256 ||
    acceptance.generation_review.reviewed_run_id !== sealedReview.reviewedRunId ||
    acceptance.generation_review.prompt_text_sha256 !== sealedReview.promptSha256 ||
    acceptance.generation_review.prompt_text_sha256 !==
      acceptance.source_artifacts.prompt_sha256 ||
    acceptance.source_artifacts.raw_provider_output_sha256 !== request.expectedRawProviderOutputSha256 ||
    acceptance.source_artifacts.source_sha256 !== request.expectedSourceSha256 ||
    acceptance.source_artifacts.normalized_sheet_sha256 !== request.expectedNormalizedSheetSha256 ||
    (backgroundRemovedEvidence !== null && (
      request.expectedBackgroundRemovedProviderOutputSha256 !==
        backgroundRemovedEvidence.sha256 ||
      acceptance.source_artifacts.background_removed_provider_output_file !==
        backgroundRemovedEvidence.file ||
      acceptance.source_artifacts.background_removed_provider_output_sha256 !==
        backgroundRemovedEvidence.sha256 ||
      acceptance.source_artifacts.background_removed_provider_output_byte_length !==
        backgroundRemovedEvidence.byte_length
    )) ||
    (backgroundRemovedEvidence === null &&
      request.expectedBackgroundRemovedProviderOutputSha256 !== null) ||
    !RAW_PROVIDER_FILE_PATTERN.test(acceptance.source_artifacts.raw_provider_output_file) ||
    !isCanonicalGenerationReleaseGate(acceptedGate) ||
    acceptedGate.status !== 'accepted' ||
    acceptedGate.release_ready !== true ||
    acceptedGate.manual_review_required !== false ||
    acceptedGate.human_decision_status !== 'accepted' ||
    acceptedGate.blocking_errors.length !== 0 ||
    !isDeepStrictEqual(acceptedGate.manual_acceptance, acceptance) ||
    acceptedGeneration.generation_profile_id !== acceptance.generation_profile_id ||
    acceptedGeneration.prompt_contract?.contract_version !== acceptance.prompt_contract_version ||
    acceptedGeneration.generation_review?.plan_hash !== acceptance.generation_review.plan_hash ||
    acceptedGeneration.generation_review?.reference_manifest_sha256 !==
      acceptance.generation_review.reference_manifest_sha256 ||
    !isDeepStrictEqual(acceptedGeneration.manual_acceptance, acceptance) ||
    acceptedSelection?.artifact_disposition !== 'release' ||
    acceptedSelection?.review_status !== 'accepted' ||
    acceptedSelection?.candidate_count !== 1 ||
    acceptedSelection?.generation_options?.candidateCount !== 1 ||
    acceptedSelection?.selected_index !== 1 ||
    acceptedSelection?.release_selected_index !== 1 ||
    acceptedSelection?.release_selected_score !== (acceptedSelection?.selected_score ?? null) ||
    acceptedSelection?.release_ready !== true ||
    acceptedSelection?.manual_review_required !== false ||
    acceptedSelection?.human_decision_status !== 'accepted' ||
    acceptedCandidate?.index !== 1 ||
    acceptedCandidate?.status !== 'accepted' ||
    acceptedCandidate?.reason !== null ||
    acceptedCandidate?.release_ready !== true ||
    acceptedCandidate?.manual_review_required !== false ||
    acceptedCandidate?.human_decision_status !== 'accepted' ||
    !isDeepStrictEqual(acceptedCandidate?.release_gate, acceptedGate) ||
    !isDeepStrictEqual(acceptedCandidate?.provider_attempts, acceptedAttempts) ||
    !isDeepStrictEqual(acceptedCandidate?.prompt_contract, acceptedGeneration.prompt_contract) ||
    !hasSingleSuccessfulProviderAttemptLedger(acceptedAttempts)
  ) {
    throw acceptanceError('acceptance_conflict', 'published manual acceptance identity changed', 409)
  }
  const [
    rawProvider,
    source,
    normalized,
    prompt,
    metadata,
    releaseZip,
    godotNpcZip,
    rpgmakerZip,
    ocadZip,
  ] = await Promise.all([
    readPublished(acceptance.source_artifacts.raw_provider_output_file, IMAGE_LIMIT_BYTES, 'published raw Provider output'),
    readPublished('source.png', IMAGE_LIMIT_BYTES, 'published source image'),
    readPublished('normalized_sheet.png', IMAGE_LIMIT_BYTES, 'published normalized sheet'),
    readPublished('prompt.txt', JSON_LIMIT_BYTES, 'published generation prompt'),
    readPublished('metadata.json', JSON_LIMIT_BYTES, 'published metadata'),
    readPublished('character_pack.zip', ZIP_LIMIT_BYTES, 'published Character Pack'),
    readPublished('godot_npc_pack.zip', ZIP_LIMIT_BYTES, 'published Godot NPC Pack'),
    readPublished('rpgmaker_pack.zip', ZIP_LIMIT_BYTES, 'published RPG Maker Pack'),
    readPublished('ocad_pack.zip', ZIP_LIMIT_BYTES, 'published OCAD Pack'),
  ])
  const publishedMetadata = parseJsonBuffer(metadata, 'published metadata')
  if (!isRecord(publishedMetadata)) {
    throw acceptanceError('artifact_integrity_failed', 'published metadata is malformed', 409)
  }
  assertCanonicalJsonBuffer(acceptance, acceptanceBuffer, 'published manual acceptance manifest')
  assertCanonicalJsonBuffer(acceptedGate, gateBuffer, 'published generation release gate')
  assertCanonicalJsonBuffer(acceptedGeneration, generationBuffer, 'published generation evidence')
  assertCanonicalJsonBuffer(publishedMetadata, metadata, 'published metadata')
  if (
    !isDeepStrictEqual(publishedMetadata.generation, acceptedGeneration) ||
    sha256(metadataWithoutGenerationBuffer(publishedMetadata)) !==
      acceptance.publication_artifacts.metadata_without_generation_sha256
  ) {
    throw acceptanceError('artifact_integrity_failed', 'published metadata changed', 409)
  }
  for (const evidence of acceptance.publication_artifacts.release_files) {
    const buffer = await readPublished(
      evidence.file,
      publicationArtifactLimit(evidence.file),
      `published release artifact ${evidence.file}`,
    )
    if (buffer.byteLength !== evidence.byte_length || sha256(buffer) !== evidence.sha256) {
      throw acceptanceError(
        'artifact_integrity_failed',
        `published release artifact changed: ${evidence.file}`,
        409,
      )
    }
  }
  const publishedEngineZips = { godot_npc: godotNpcZip, rpgmaker: rpgmakerZip, ocad: ocadZip }
  const backgroundRemovedProvider = backgroundRemovedEvidence
    ? await readPublished(
        backgroundRemovedEvidence.file,
        IMAGE_LIMIT_BYTES,
        'published background-removed Provider output',
      )
    : null
  const backgroundMatteV2Buffers = await readBackgroundMatteV2Buffers({
    evidence: matteV2Evidence,
    outputBuffer: backgroundRemovedProvider,
    readArtifact: (file, maxBytes, label) => readPublished(file, maxBytes, label),
  })
  await assertBackgroundMatteV2EvidenceBuffers({
    evidence: matteV2Evidence,
    buffers: backgroundMatteV2Buffers,
    rawProviderBuffer: rawProvider,
    backgroundRemovedProviderBuffer: backgroundRemovedProvider,
    expectedArtifactUrlPrefix: `/generated/${sourceJobId}`,
  })
  if (
    sha256(rawProvider) !== request.expectedRawProviderOutputSha256 ||
    sha256(source) !== request.expectedSourceSha256 ||
    sha256(normalized) !== request.expectedNormalizedSheetSha256 ||
    sha256(prompt) !== acceptance.source_artifacts.prompt_sha256 ||
    rawProvider.byteLength !== acceptance.source_artifacts.raw_provider_output_byte_length ||
    source.byteLength !== acceptance.source_artifacts.source_byte_length ||
    normalized.byteLength !== acceptance.source_artifacts.normalized_sheet_byte_length ||
    prompt.byteLength !== acceptance.source_artifacts.prompt_byte_length ||
    acceptedGeneration.raw_provider_output?.sha256 !== request.expectedRawProviderOutputSha256 ||
    acceptedGeneration.raw_provider_output?.byte_length !== rawProvider.byteLength ||
    acceptedGeneration.raw_provider_output?.processing !== 'none' ||
    (backgroundRemovedEvidence !== null && (
      sha256(backgroundRemovedProvider) !== request.expectedBackgroundRemovedProviderOutputSha256 ||
      backgroundRemovedProvider.byteLength !== backgroundRemovedEvidence.byte_length ||
      backgroundRemovedEvidence.source_file !== acceptance.source_artifacts.raw_provider_output_file ||
      backgroundRemovedEvidence.source_sha256 !== request.expectedRawProviderOutputSha256
    )) ||
    ENGINE_ZIP_ARTIFACTS.some((artifact) => {
      const buffer = publishedEngineZips[artifact.key]
      const evidence = acceptance.publication_artifacts.engine_zips[artifact.key]
      return evidence.file !== artifact.file ||
        evidence.sha256 !== sha256(buffer) ||
        evidence.byte_length !== buffer.byteLength
    }) ||
    releaseZip.byteLength === 0
  ) {
    throw acceptanceError('artifact_integrity_failed', 'published manual acceptance artifacts changed', 409)
  }
  await Promise.all(ENGINE_ZIP_ARTIFACTS.map((artifact) => (
    assertValidEngineZip(publishedEngineZips[artifact.key], `published ${artifact.label}`)
  )))
  const zip = await loadCharacterPackZip(releaseZip, 'published Character Pack')
  assertExactCharacterPackEntrySet(
    zip,
    acceptance.publication_artifacts.character_pack_entries,
  )
  for (const evidence of acceptance.publication_artifacts.character_pack_entries) {
    const buffer = await readBoundedZipEntry(
      zip,
      evidence.file,
      publicationArtifactLimit(evidence.file),
      `published Character Pack entry ${evidence.file}`,
    )
    if (buffer.byteLength !== evidence.byte_length || sha256(buffer) !== evidence.sha256) {
      throw acceptanceError(
        'artifact_integrity_failed',
        `published Character Pack entry changed: ${evidence.file}`,
        409,
      )
    }
  }
  const [
    zipAcceptance,
    zipGate,
    zipGeneration,
    zipMetadata,
    zipSource,
    zipNormalized,
    zipPrompt,
  ] = await Promise.all([
    readBoundedZipEntry(zip, FULL_SHEET_MANUAL_ACCEPTANCE_FILE, JSON_LIMIT_BYTES, 'zipped manual acceptance'),
    readBoundedZipEntry(zip, 'generation_release_gate.json', JSON_LIMIT_BYTES, 'zipped generation release gate'),
    readBoundedZipEntry(zip, 'generation.json', JSON_LIMIT_BYTES, 'zipped generation evidence'),
    readBoundedZipEntry(zip, 'metadata.json', JSON_LIMIT_BYTES, 'zipped metadata'),
    readBoundedZipEntry(zip, 'source.png', IMAGE_LIMIT_BYTES, 'zipped source image'),
    readBoundedZipEntry(zip, 'normalized_sheet.png', IMAGE_LIMIT_BYTES, 'zipped normalized sheet'),
    readBoundedZipEntry(zip, 'prompt.txt', JSON_LIMIT_BYTES, 'zipped generation prompt'),
  ])
  const zipBackgroundMatteV2Buffers = matteV2Evidence
    ? Object.fromEntries(await Promise.all(Object.values(BACKGROUND_MATTE_V2_ARTIFACT_FILES).map(async (file) => [
        file,
        await readBoundedZipEntry(
          zip,
          file,
          file.endsWith('.json') ? JSON_LIMIT_BYTES : IMAGE_LIMIT_BYTES,
          `zipped Background Matte V2 Artifact ${file}`,
        ),
      ])))
    : null
  if (
    !zipAcceptance.equals(acceptanceBuffer) ||
    !zipGate.equals(gateBuffer) ||
    !zipGeneration.equals(generationBuffer) ||
    !zipMetadata.equals(metadata) ||
    !zipSource.equals(source) ||
    !zipNormalized.equals(normalized) ||
    !zipPrompt.equals(prompt) ||
    (backgroundMatteV2Buffers && Object.values(BACKGROUND_MATTE_V2_ARTIFACT_FILES).some(
      (file) => !zipBackgroundMatteV2Buffers[file].equals(backgroundMatteV2Buffers[file]),
    ))
  ) {
    throw acceptanceError('artifact_integrity_failed', 'published Character Pack contents changed', 409)
  }
  return {
    mode: FULL_SHEET_MANUAL_ACCEPTANCE_PROTOCOL,
    status: 'done',
    saved: 'already_accepted',
    source_job_id: sourceJobId,
    publication_id: publicationId,
    manual_acceptance_status: 'accepted',
    human_reviewed_issue_count: acceptance.human_reviewed_issue_count,
    manual_acceptance_sha256: sha256(acceptanceBuffer),
    provider_call_budget: {
      planned_provider_calls: 0,
      max_provider_calls: 0,
      used_provider_calls: 0,
    },
    ...publicationUrls(
      publicationId,
      acceptance.source_artifacts.raw_provider_output_file,
      backgroundRemovedEvidence?.file ?? null,
      Boolean(matteV2Evidence),
    ),
  }
}

async function acceptFullSheetGenerationLocked({
  sourceJobId,
  request,
  publicationId,
  generatedDir,
  now = new Date(),
  processSheet = processSheetBuffer,
  writeArtifacts = writeCharacterPackArtifacts,
} = {}) {
  resolveGeneratedJobDir(sourceJobId, { generatedDir })
  const existing = await loadExistingPublication({
    generatedDir,
    publicationId,
    sourceJobId,
    request,
  })
  if (existing) return existing

  const generationArtifact = await readJsonArtifact({
    sourceJobId,
    fileName: 'generation.json',
    generatedDir,
    label: 'generation evidence',
  })
  const gateArtifact = await readJsonArtifact({
    sourceJobId,
    fileName: 'generation_release_gate.json',
    generatedDir,
    label: 'generation release gate',
  })
  const debugArtifact = await readJsonArtifact({
    sourceJobId,
    fileName: 'debug_report.json',
    generatedDir,
    label: 'debug report',
  })
  const subjectCountArtifact = await readJsonArtifact({
    sourceJobId,
    fileName: 'source_subject_count_report.json',
    generatedDir,
    label: 'source subject-count report',
  })
  const normalizedSubjectCountArtifact = await readJsonArtifact({
    sourceJobId,
    fileName: 'normalized_subject_count_report.json',
    generatedDir,
    label: 'normalized subject-count report',
  })
  assertReviewRequiredGeneration({
    generation: generationArtifact.value,
    gate: gateArtifact.value,
    debugReport: debugArtifact.value,
    sourceSubjectCountReport: subjectCountArtifact.value,
    normalizedSubjectCountReport: normalizedSubjectCountArtifact.value,
    request,
  })
  const sealedReview = await readAndAssertGenerationReviewBinding({
    generation: generationArtifact.value,
    request,
    generatedDir,
  })

  const rawProviderFile = generationArtifact.value?.raw_provider_output?.file
  if (!RAW_PROVIDER_FILE_PATTERN.test(String(rawProviderFile ?? ''))) {
    throw acceptanceError('artifact_integrity_failed', 'raw Provider output identity is invalid', 409)
  }
  const backgroundRemovedEvidence = backgroundRemovedProviderEvidence(generationArtifact.value)
  const matteV2Evidence = backgroundMatteV2Evidence(
    generationArtifact.value,
    backgroundRemovedEvidence,
  )
  assertProfileBackgroundEvidence({
    profile: sealedReview.profile,
    backgroundRemovedProviderOutput: backgroundRemovedEvidence,
    backgroundMatteV2: matteV2Evidence,
  })
  const [
    rawProviderBuffer,
    backgroundRemovedProviderBuffer,
    sourceBuffer,
    normalizedBuffer,
    promptBuffer,
  ] = await Promise.all([
    readSourceArtifact({
      sourceJobId,
      fileName: rawProviderFile,
      generatedDir,
      maxBytes: IMAGE_LIMIT_BYTES,
      label: 'raw Provider output',
    }),
    backgroundRemovedEvidence
      ? readSourceArtifact({
          sourceJobId,
          fileName: backgroundRemovedEvidence.file,
          generatedDir,
          maxBytes: IMAGE_LIMIT_BYTES,
          label: 'background-removed Provider output',
        })
      : Promise.resolve(null),
    readSourceArtifact({
      sourceJobId,
      fileName: 'source.png',
      generatedDir,
      maxBytes: IMAGE_LIMIT_BYTES,
      label: 'processed source image',
    }),
    readSourceArtifact({
      sourceJobId,
      fileName: 'normalized_sheet.png',
      generatedDir,
      maxBytes: IMAGE_LIMIT_BYTES,
      label: 'normalized sheet',
    }),
    readSourceArtifact({
      sourceJobId,
      fileName: 'prompt.txt',
      generatedDir,
      maxBytes: JSON_LIMIT_BYTES,
      label: 'generation prompt',
    }),
  ])
  const actualHashes = {
    raw: sha256(rawProviderBuffer),
    source: sha256(sourceBuffer),
    normalized: sha256(normalizedBuffer),
    backgroundRemoved: backgroundRemovedProviderBuffer
      ? sha256(backgroundRemovedProviderBuffer)
      : null,
    prompt: sha256(promptBuffer),
    gate: sha256(gateArtifact.buffer),
  }
  const backgroundMatteV2Buffers = await readBackgroundMatteV2Buffers({
    evidence: matteV2Evidence,
    outputBuffer: backgroundRemovedProviderBuffer,
    readArtifact: (file, maxBytes, label) => readSourceArtifact({
      sourceJobId,
      fileName: file,
      generatedDir,
      maxBytes,
      label,
    }),
  })
  await assertBackgroundMatteV2EvidenceBuffers({
    evidence: matteV2Evidence,
    buffers: backgroundMatteV2Buffers,
    rawProviderBuffer,
    backgroundRemovedProviderBuffer,
    expectedArtifactUrlPrefix: `/generated/${sourceJobId}`,
  })
  if (
    actualHashes.raw !== request.expectedRawProviderOutputSha256 ||
    actualHashes.source !== request.expectedSourceSha256 ||
    actualHashes.normalized !== request.expectedNormalizedSheetSha256 ||
    actualHashes.prompt !== sealedReview.promptSha256 ||
    generationArtifact.value.raw_provider_output.sha256 !== actualHashes.raw ||
    generationArtifact.value.raw_provider_output.byte_length !== rawProviderBuffer.byteLength ||
    generationArtifact.value.raw_provider_output.processing !== 'none' ||
    (backgroundRemovedEvidence !== null && (
      request.expectedBackgroundRemovedProviderOutputSha256 !==
        backgroundRemovedEvidence.sha256 ||
      actualHashes.backgroundRemoved !== request.expectedBackgroundRemovedProviderOutputSha256 ||
      backgroundRemovedProviderBuffer.byteLength !== backgroundRemovedEvidence.byte_length ||
      backgroundRemovedEvidence.source_file !== rawProviderFile ||
      backgroundRemovedEvidence.source_sha256 !== actualHashes.raw
    )) ||
    (backgroundRemovedEvidence === null &&
      request.expectedBackgroundRemovedProviderOutputSha256 !== null)
  ) {
    throw acceptanceError('acceptance_binding_stale', 'source generation artifacts changed', 409)
  }

  const acceptedAt = now instanceof Date ? now.toISOString() : new Date(now).toISOString()
  const preCalibrationReport = subjectCountArtifact.value?.stages?.find(
    (stage) => stage?.stage === 'pre_calibration_source',
  )
  if (!preCalibrationReport) {
    throw acceptanceError('artifact_integrity_failed', 'pre-calibration subject-count evidence is missing', 409)
  }
  const promptContract = generationArtifact.value.prompt_contract
  const rebuilt = await processSheet(sourceBuffer, {
    name: `accepted_${sourceJobId}`,
    description: promptContract.subject,
    createdAt: acceptedAt,
    backgroundMode: debugArtifact.value.canonical_background_mode ?? debugArtifact.value.requested_background_mode ?? promptContract.background_mode ?? 'auto',
    backgroundRequestMode: debugArtifact.value.requested_background_mode ?? promptContract.background_mode ?? 'auto',
    sourceLayout: promptContract.layout_id,
    sourceType: 'accepted_full_sheet_generation',
    sourceFileName: 'source.png',
    fixedRegionSourceStaging: 'none',
    subjectCountGate: true,
    subjectCountPreCalibrationReport: preCalibrationReport,
    generationProfile: { id: generationArtifact.value.generation_profile_id },
    generation: cloneJson(generationArtifact.value),
    promptText: promptBuffer.toString('utf8'),
  })
  if (
    sha256(rebuilt.files.sourcePng) !== actualHashes.source ||
    sha256(rebuilt.files.normalizedSheetPng) !== actualHashes.normalized
  ) {
    throw acceptanceError(
      'deterministic_rebuild_mismatch',
      'local publication rebuild changed the human-reviewed source or normalized sheet',
      409,
    )
  }

  rebuilt.files.rawProviderOutputBuffer = rawProviderBuffer
  rebuilt.files.rawProviderOutputFileName = rawProviderFile
  rebuilt.files.promptTxt = promptBuffer
  if (backgroundRemovedEvidence) {
    rebuilt.files.backgroundRemovedProviderOutputBuffer = backgroundRemovedProviderBuffer
    rebuilt.files.backgroundRemovedProviderOutputFileName = backgroundRemovedEvidence.file
  }
  if (backgroundMatteV2Buffers) {
    rebuilt.files.backgroundMatteV2ArtifactBuffers = Object.fromEntries(
      BACKGROUND_MATTE_V2_AUXILIARY_ARTIFACT_FILES.map((file) => [
        file,
        backgroundMatteV2Buffers[file],
      ]),
    )
  }

  const engineZipEvidence = await buildEngineZipPublicationEvidence(rebuilt.files)
  const releaseFileEvidence = buildStandalonePublicationEvidence(rebuilt)
  const characterPackEntryEvidence = await buildPreparedCharacterPackEntryEvidence({
    zipBuffer: rebuilt.files.zipBuffer,
    promptBuffer,
    backgroundMatteV2Buffers,
  })
  const metadataWithoutGenerationSha256 = sha256(
    metadataWithoutGenerationBuffer(rebuilt.metadataJson),
  )
  const manualAcceptance = {
    schema_version: 1,
    protocol: FULL_SHEET_MANUAL_ACCEPTANCE_PROTOCOL,
    acceptance_id: publicationId,
    source_job_id: sourceJobId,
    published_job_id: publicationId,
    decision: 'accepted',
    decision_authority: 'human',
    generation_profile_id: generationArtifact.value.generation_profile_id,
    prompt_contract_version: generationArtifact.value.prompt_contract.contract_version,
    accepted_at: acceptedAt,
    human_reviewed_issue_count: request.humanReviewedIssueCount,
    provider_calls_used: 0,
    generation_review: {
      reviewed_run_id: generationArtifact.value.generation_review.reviewed_run_id,
      plan_hash: request.expectedPlanHash,
      reference_manifest_sha256: request.expectedReferenceManifestSha256,
      prompt_text_sha256: actualHashes.prompt,
    },
    source_artifacts: {
      raw_provider_output_file: rawProviderFile,
      raw_provider_output_sha256: actualHashes.raw,
      raw_provider_output_byte_length: rawProviderBuffer.byteLength,
      source_sha256: actualHashes.source,
      source_byte_length: sourceBuffer.byteLength,
      normalized_sheet_sha256: actualHashes.normalized,
      normalized_sheet_byte_length: normalizedBuffer.byteLength,
      prompt_sha256: actualHashes.prompt,
      prompt_byte_length: promptBuffer.byteLength,
      generation_release_gate_sha256: actualHashes.gate,
      ...(backgroundRemovedEvidence
        ? {
            background_removed_provider_output_file: backgroundRemovedEvidence.file,
            background_removed_provider_output_sha256: actualHashes.backgroundRemoved,
            background_removed_provider_output_byte_length:
              backgroundRemovedProviderBuffer.byteLength,
          }
        : {}),
    },
    publication_artifacts: {
      engine_zips: engineZipEvidence,
      release_files: releaseFileEvidence,
      character_pack_entries: characterPackEntryEvidence,
      metadata_without_generation_sha256: metadataWithoutGenerationSha256,
    },
  }
  if (!isCanonicalFullSheetManualAcceptance(manualAcceptance)) {
    throw acceptanceError('artifact_integrity_failed', 'manual acceptance evidence is incomplete', 409)
  }
  const acceptedGate = acceptedReleaseGate(gateArtifact.value, manualAcceptance)
  const acceptedGeneration = {
    ...cloneJson(generationArtifact.value),
    candidate_selection: acceptedCandidateSelection(
      generationArtifact.value.candidate_selection,
      acceptedGate,
    ),
    manual_acceptance: manualAcceptance,
  }
  const manualAcceptanceBuffer = encodeCharacterPackArtifactContent(manualAcceptance)
  rebuilt.metadataJson = { ...rebuilt.metadataJson, generation: acceptedGeneration }
  rebuilt.generationReleaseGate = acceptedGate
  rebuilt.releaseReady = true
  rebuilt.artifactDisposition = 'release'
  rebuilt.manualReviewRequired = false
  rebuilt.humanDecisionStatus = 'accepted'
  rebuilt.generationProfileId = manualAcceptance.generation_profile_id
  rebuilt.promptContractVersion = manualAcceptance.prompt_contract_version
  rebuilt.files.generationJson = encodeCharacterPackArtifactContent(acceptedGeneration)
  rebuilt.files.manualAcceptanceJson = manualAcceptanceBuffer
  await patchReleaseZip(rebuilt, {
    acceptedGate,
    generation: acceptedGeneration,
    manualAcceptanceBuffer,
    promptBuffer,
    backgroundMatteV2Buffers,
  })
  await assertPreparedPublicationIntegrity(rebuilt, manualAcceptance)

  const stagingId = `accept_stage_${randomUUID().replaceAll('-', '')}`
  const stagingDir = resolveGeneratedJobDir(stagingId, { generatedDir })
  const publicationDir = resolveGeneratedJobDir(publicationId, { generatedDir })
  let written
  try {
    written = await writeArtifacts({
      jobId: stagingId,
      outputDir: generatedDir,
      result: rebuilt,
    })
    if (written.status !== 'done' || written.artifact_disposition !== 'release') {
      throw acceptanceError(
        'publication_integrity_failed',
        'manual acceptance did not produce a release publication',
        409,
      )
    }
    await rename(stagingDir, publicationDir)
  } catch (error) {
    if (error?.code === 'EEXIST' || error?.code === 'ENOTEMPTY') {
      const raced = await loadExistingPublication({
        generatedDir,
        publicationId,
        sourceJobId,
        request,
      })
      if (raced) return raced
    }
    throw error
  }
  const publishedUrls = buildCharacterPackArtifactManifest(publicationId, rebuilt).urls
  return {
    mode: FULL_SHEET_MANUAL_ACCEPTANCE_PROTOCOL,
    status: written.status,
    saved: 'accepted',
    source_job_id: sourceJobId,
    publication_id: publicationId,
    manual_acceptance_status: 'accepted',
    human_reviewed_issue_count: request.humanReviewedIssueCount,
    manual_acceptance_sha256: sha256(manualAcceptanceBuffer),
    provider_call_budget: {
      planned_provider_calls: 0,
      max_provider_calls: 0,
      used_provider_calls: 0,
    },
    ...publishedUrls,
  }
}

export async function acceptFullSheetGeneration({
  sourceJobId,
  request: requestInput,
  generatedDir,
  now = new Date(),
  processSheet = processSheetBuffer,
  writeArtifacts = writeCharacterPackArtifacts,
} = {}) {
  const request = parseFullSheetManualAcceptanceRequest(requestInput)
  const publicationId = publishedJobId(sourceJobId)
  return withPublicationLock(publicationId, () => acceptFullSheetGenerationLocked({
    sourceJobId,
    request,
    publicationId,
    generatedDir,
    now,
    processSheet,
    writeArtifacts,
  }))
}
