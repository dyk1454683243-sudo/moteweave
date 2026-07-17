import { lstat } from 'node:fs/promises'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'

import { encodeRgbaPng, loadRgba } from '../character-pack/imageCodec.js'

import {
  QUALITY_GATE_CHARACTER_ARTIFACT_KEYS,
  captureManagedCharacterRevisionForQualityGate,
  importCapturedCharacterRevisionForQualityGate,
} from './artifactRegistry.js'
import {
  buildFrameRepairQualityReport,
  extractFrameRgba,
  runsToBitset,
} from './frameRepairComposite.js'
import { verifySealedFrameRepairArtifacts } from './frameRepairArtifacts.js'
import { createDefaultEditorProject } from './defaults.js'
import { buildFrameRepairQualityGateControls } from './frameRepairQualityGateControls.js'
import {
  finalizeFrameRepairQualityGateEvidence,
  readFrameRepairQualityGateEvidence,
  readFrameRepairQualityGateSetupManifest,
  resolveFrameRepairQualityGateSessionPaths,
  resolveFrameRepairQualityGateSetupPaths,
  startFrameRepairQualityGateEvidence,
  writeFrameRepairQualityGateOutcome,
  writeFrameRepairQualityGateReview,
  writeFrameRepairQualityGateSetupManifest,
} from './frameRepairQualityGateEvidence.js'
import {
  buildFrameRepairQualityGateBlindOrder,
  buildFrameRepairQualityGateCaseFingerprint,
  buildFrameRepairQualityGatePlan,
  hashFrameRepairQualityGateValue,
  projectFrameRepairQualityGateHardGates,
} from './frameRepairQualityGatePlan.js'
import { hashFrameRepairPlan } from './frameRepairPlan.js'
import {
  FRAME_REPAIR_QUALITY_GATE_CONTROL_CASE_DEFAULTS,
  FrameRepairQualityGateError,
  assertQualityGatePlanRequest,
  assertQualityGateFinalizeRequest,
  assertQualityGateOutcomeRequest,
  assertQualityGateReviewRequest,
  assertQualityGateRouteIds,
  assertQualityGateSetupRequest,
  assertQualityGateStartRequest,
} from './frameRepairQualityGateProtocol.js'
import {
  EditorProjectStoreError,
  createPreparedEditorProject,
  loadEditorProject,
  withEditorProjectMutationLock,
} from './projectStore.js'
import { serializeEditorProject } from './serializer.js'

const SOURCE_CAPTURE_LIMIT = 128 * 1024 * 1024
const SAFE_CODE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/
const CONTROL_IDENTITIES = Object.freeze({
  control_outline_alpha: 'quality_gate_control_outline_alpha_v1',
  control_small_component: 'quality_gate_control_small_component_v1',
})
const PROVIDER_BLOCKED_REASONS = new Set([
  'provider_safety_filter',
  'provider_route_blocked',
  'provider_unavailable',
  'provider_configuration_error',
  'provider_output_invalid',
  'provider_candidate_invalid',
  'provider_authentication_failed',
  'provider_quota_or_payment_required',
  'provider_rate_limited',
  'provider_request_rejected',
  'provider_service_unavailable',
])

function fail(code, message = 'quality gate operation failed', details = null) {
  throw new FrameRepairQualityGateError(code, message, details)
}

function clone(value) {
  return structuredClone(value)
}

function assertDependencies({
  projectRoot,
  workspaceRoot,
  generatedDir,
  implementationRevision,
  frameRepairCoordinator,
  frameRepairService,
}) {
  if ([projectRoot, workspaceRoot, generatedDir, implementationRevision]
    .some((value) => typeof value !== 'string' || value.length === 0) ||
      !frameRepairCoordinator ||
      typeof frameRepairCoordinator.planFrameRepair !== 'function' ||
      typeof frameRepairCoordinator.getFrameRepairOperation !== 'function' ||
      !frameRepairService || typeof frameRepairService !== 'object') {
    throw new TypeError('frame repair quality gate coordinator dependencies are invalid')
  }
}

function sourceProjectAuthority(project) {
  return hashFrameRepairQualityGateValue({
    project,
    serialized: serializeEditorProject(project),
  })
}

function capturedAuthority(captured) {
  return {
    asset_id: captured.asset.id,
    revision_id: captured.revision.id,
    source_sha256: captured.source_sha256,
    artifacts: captured.artifacts.map(({ key, size, sha256 }) => ({ key, size, sha256 })),
  }
}

function fixedArtifactRecords(captured) {
  const byKey = new Map(captured.artifacts.map((item) => [item.key, item]))
  return QUALITY_GATE_CHARACTER_ARTIFACT_KEYS.map((key) => {
    const item = byKey.get(key)
    if (!item) fail('artifact_integrity_failed')
    return Object.freeze({ key, size: item.size, sha256: item.sha256 })
  })
}

function capturedBytes(captured) {
  return captured.artifacts.reduce((total, item) => total + item.size, 0)
}

async function fixedFileExists(filePath) {
  try {
    const stats = await lstat(filePath)
    if (stats.isSymbolicLink() || !stats.isFile()) fail('unsafe_artifact_path')
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    if (error instanceof FrameRepairQualityGateError) throw error
    fail('unsafe_artifact_path')
  }
}

async function assertSetupEvidenceAbsent(generatedDir, targetProjectId) {
  const paths = resolveFrameRepairQualityGateSetupPaths({ generatedDir, targetProjectId })
  for (const directory of [
    paths.generatedDir,
    path.join(paths.generatedDir, 'frame-repair-quality-gates'),
    paths.setupDir,
  ]) {
    try {
      const stats = await lstat(directory)
      if (stats.isSymbolicLink() || !stats.isDirectory()) fail('unsafe_artifact_path')
    } catch (error) {
      if (error?.code === 'ENOENT') break
      if (error instanceof FrameRepairQualityGateError) throw error
      fail('unsafe_artifact_path')
    }
  }
  try {
    await lstat(paths.setupManifest)
  } catch (error) {
    if (error?.code === 'ENOENT') return
    fail('unsafe_artifact_path')
  }
  fail('evidence_conflict', 'quality gate setup evidence already exists')
}

function assertSourceProject(project, request) {
  if (project.revision !== request.expectedRevision) {
    throw new EditorProjectStoreError('revision_conflict', 'editor project revision conflict', {
      expected_revision: request.expectedRevision,
      current_revision: project.revision,
    })
  }
  for (const item of request.sourceAssets) {
    const asset = project.assets?.[item.assetId]
    if (!asset || asset.kind !== 'character_pack') {
      fail('asset_not_found', 'quality gate source Character Pack was not found')
    }
    if (asset.active_revision_id !== item.expectedAssetRevisionId ||
        !asset.revisions?.[item.expectedAssetRevisionId]) {
      fail('asset_revision_conflict', 'quality gate source Character Pack revision changed')
    }
  }
}

async function captureSourceAssets({ request, project, projectRoot, workspaceRoot }) {
  const captures = []
  let aggregateBytes = 0
  for (const item of request.sourceAssets) {
    const captured = await captureManagedCharacterRevisionForQualityGate({
      project,
      assetId: item.assetId,
      expectedAssetRevisionId: item.expectedAssetRevisionId,
      projectRoot,
      workspaceRoot,
    })
    aggregateBytes += capturedBytes(captured)
    if (aggregateBytes > SOURCE_CAPTURE_LIMIT) {
      fail('artifact_integrity_failed', 'quality gate source capture exceeds its aggregate limit')
    }
    captures.push(captured)
  }
  return captures
}

async function verifySourceAuthority({
  sourceProjectId,
  request,
  initialAuthority,
  expectedCaptures,
  projectRoot,
  workspaceRoot,
}) {
  const loaded = await loadEditorProject({ projectId: sourceProjectId, projectRoot, workspaceRoot })
  assertSourceProject(loaded.project, request)
  if (sourceProjectAuthority(loaded.project) !== initialAuthority) {
    fail('quality_gate_identity_mismatch', 'quality gate source project changed')
  }
  for (let index = 0; index < request.sourceAssets.length; index += 1) {
    const item = request.sourceAssets[index]
    const recaptured = await captureManagedCharacterRevisionForQualityGate({
      project: loaded.project,
      assetId: item.assetId,
      expectedAssetRevisionId: item.expectedAssetRevisionId,
      projectRoot,
      workspaceRoot,
    })
    if (hashFrameRepairQualityGateValue(capturedAuthority(recaptured)) !==
        hashFrameRepairQualityGateValue(capturedAuthority(expectedCaptures[index]))) {
      fail('quality_gate_identity_mismatch', 'quality gate source artifact changed')
    }
  }
  return loaded.project
}

function targetAssetId(caseId) {
  return `asset_qg_${caseId}`
}

function setupEntries(request, controls, sourceCaptures) {
  const entries = [
    ...FRAME_REPAIR_QUALITY_GATE_CONTROL_CASE_DEFAULTS.map((definition, index) => ({
      caseId: definition.caseId,
      sourceAssetId: null,
      sourceRevisionId: null,
      targetAssetId: definition.assetId,
      targetRevisionId: 'rev_001',
      ownershipClass: 'repository_control',
      controlIdentity: CONTROL_IDENTITIES[definition.caseId],
      captured: controls[index],
    })),
    ...request.sourceAssets.map((item, index) => ({
      caseId: item.caseId,
      sourceAssetId: item.assetId,
      sourceRevisionId: item.expectedAssetRevisionId,
      targetAssetId: targetAssetId(item.caseId),
      targetRevisionId: 'rev_001',
      ownershipClass: 'user_owned',
      controlIdentity: null,
      captured: sourceCaptures[index],
    })),
  ]
  const caseIds = new Set(entries.map((item) => item.caseId))
  const assetIds = new Set(entries.map((item) => item.targetAssetId))
  if (caseIds.size !== 8 || assetIds.size !== 8) fail('invalid_quality_gate_request')
  return entries
}

function setupManifest({ sourceProject, targetProjectId, entries }) {
  return {
    protocol: 'frame_repair_quality_gate_setup_v1',
    source_project: { id: sourceProject.id, revision: sourceProject.revision },
    target_project: { id: targetProjectId, revision: 1 },
    ownership_confirmed: true,
    cases: entries.map((item) => {
      const artifacts = fixedArtifactRecords(item.captured)
      return {
        case_id: item.caseId,
        ownership_class: item.ownershipClass,
        source: {
          asset_id: item.sourceAssetId,
          revision_id: item.sourceRevisionId,
          source_sha256: hashFrameRepairQualityGateValue(artifacts),
          artifacts,
        },
        target: {
          asset_id: item.targetAssetId,
          revision_id: 'rev_001',
          artifacts: clone(artifacts),
        },
        control_identity: item.controlIdentity,
      }
    }),
  }
}

function publicMapping(entries) {
  return entries.map((item) => ({
    caseId: item.caseId,
    sourceAssetId: item.sourceAssetId,
    sourceRevisionId: item.sourceRevisionId,
    targetAssetId: item.targetAssetId,
    targetRevisionId: item.targetRevisionId,
    ownershipClass: item.ownershipClass,
  }))
}

function planRequestBody(requested) {
  return {
    sessionId: requested.sessionId,
    expectedRevision: requested.expectedRevision,
    setupManifestSha256: requested.setupManifestSha256,
    providerPresetId: requested.providerPresetId,
    imageConfig: requested.imageConfig,
    maxProviderCalls: requested.maxProviderCalls,
    cases: requested.cases,
  }
}

function framePlanBody(request, item) {
  return {
    expectedRevision: request.expectedRevision,
    expectedAssetRevisionId: item.expectedAssetRevisionId,
    clipId: item.clipId,
    clipFramePosition: item.clipFramePosition,
    sheetFrameIndex: item.sheetFrameIndex,
    instruction: item.instruction,
    maskEdits: item.maskEdits,
    providerPresetId: request.providerPresetId,
    imageConfig: request.imageConfig,
  }
}

function publicOperation(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const jobId = typeof value.id === 'string'
    ? value.id
    : typeof value.job_id === 'string' ? value.job_id : null
  const status = typeof value.status === 'string' && SAFE_CODE_PATTERN.test(value.status)
    ? value.status
    : 'outcome_unknown'
  const reason = typeof value.reason === 'string' && SAFE_CODE_PATTERN.test(value.reason)
    ? value.reason
    : null
  const providerCallsUsed = Number.isSafeInteger(value.provider_calls_used) &&
    value.provider_calls_used >= 0 ? value.provider_calls_used : 0
  const generatedCandidateCount = Number.isSafeInteger(value.generated_candidate_count) &&
    value.generated_candidate_count >= 0 ? value.generated_candidate_count : 0
  return { jobId, status, providerCallsUsed, generatedCandidateCount, reason }
}

function deriveCaseStatus(outcome, review, operation) {
  if (outcome) return outcome.outcome
  if (review) return 'awaiting_decision'
  if (!operation) return 'pending'
  if (['completed', 'done'].includes(operation.status)) return 'candidate_ready'
  if (operation.status === 'outcome_unknown') return 'outcome_unknown'
  return 'processing'
}

function artifactUrl(sessionId, fileName) {
  return `/generated/frame-repair-quality-gates/${sessionId}/${fileName}`
}

function projectProjectionSha256(project) {
  const projection = clone(project)
  delete projection.revision
  delete projection.updated_at
  return hashFrameRepairQualityGateValue(projection)
}

function findPlanCase(evidence, caseId) {
  const index = evidence.plan.cases.findIndex((item) => item.case_id === caseId)
  if (index < 0) fail('case_not_found')
  return { item: evidence.plan.cases[index], index }
}

function assertCaseRequestIdentity(evidence, item, request) {
  if (request.expectedPlanHash !== evidence.plan.session_plan_hash ||
      request.expectedCaseHash !== item.case_hash || request.operationId !== item.operation_id) {
    fail('quality_gate_identity_mismatch')
  }
}

function expectedChainBefore(evidence, index) {
  const outcomes = new Map(evidence.outcomes.map((item) => [item.case_id, item]))
  let revision = evidence.plan.project.initial_revision
  let projectionSha256 = evidence.plan.project.initial_projection_sha256
  for (let cursor = 0; cursor < index; cursor += 1) {
    const planned = evidence.plan.cases[cursor]
    const outcome = outcomes.get(planned.case_id)
    if (!outcome) fail('quality_gate_paused', 'the prior quality gate case is not terminal')
    if (outcome.project_before_revision !== revision ||
        outcome.project_before_projection_sha256 !== projectionSha256) {
      fail('quality_gate_paused', 'quality gate revision chain drifted')
    }
    revision = outcome.project_after_revision
    projectionSha256 = outcome.project_after_projection_sha256
  }
  return { revision, projectionSha256 }
}

function requestedCaseFromPlan(item) {
  return {
    caseId: item.case_id,
    assetId: item.asset_id,
    expectedAssetRevisionId: item.parent_revision_id,
    clipId: item.repair.clip_id,
    clipFramePosition: item.repair.clip_frame_position,
    sheetFrameIndex: item.repair.sheet_frame_index,
    instruction: item.repair.instruction,
    maskEdits: item.repair.mask_edits,
    difficulty: item.classification.difficulty,
    defectCategory: item.classification.defect_category,
    expectedImprovement: item.classification.expected_improvement,
  }
}

async function resolveDurableOperation({
  frameRepairCoordinator,
  frameRepairService,
  evidence,
  item,
  expectedRevision,
}) {
  const replanned = await frameRepairCoordinator.planFrameRepair({
    projectId: evidence.plan.project.id,
    assetId: item.asset_id,
    body: framePlanBody({
      expectedRevision,
      providerPresetId: evidence.plan.provider.preset_id,
      imageConfig: { image_size: evidence.plan.provider.image_size },
    }, requestedCaseFromPlan(item)),
  })
  let job
  try {
    job = await frameRepairService.getOperation({
      project_id: evidence.plan.project.id,
      asset_id: item.asset_id,
      operation_id: item.operation_id,
    })
  } catch (error) {
    if (error?.code === 'operation_not_found') fail('operation_not_found')
    throw error
  }
  if (!job || typeof job !== 'object' || Array.isArray(job) ||
      job.project_id !== evidence.plan.project.id || job.asset_id !== item.asset_id ||
      job.parent_revision_id !== item.parent_revision_id || job.operation_id !== item.operation_id ||
      job.plan_hash !== replanned.plan_hash ||
      job.implementation_revision !== evidence.plan.implementation_revision ||
      job.provider_call_budget !== 1 || !Number.isSafeInteger(job.provider_calls_used) ||
      job.provider_calls_used < 0 || !Number.isSafeInteger(job.generated_candidate_count) ||
      job.generated_candidate_count < 0) fail('quality_gate_identity_mismatch')
  return { job, replanned }
}

function capturedEntry(entries, key) {
  const entry = entries.find((item) => item.key === key)
  if (!entry || !Buffer.isBuffer(entry.content)) fail('artifact_integrity_failed')
  return entry
}

function parseCapturedJson(entries, key) {
  const entry = capturedEntry(entries, key)
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(entry.content)
    const value = JSON.parse(text)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('record required')
    return value
  } catch {
    fail('artifact_integrity_failed')
  }
}

function assertSafeCodes(values) {
  if (!Array.isArray(values) || values.some((item) => (
    typeof item !== 'string' || !SAFE_CODE_PATTERN.test(item)
  ))) fail('artifact_integrity_failed')
  return values
}

function expectedFingerprint(item) {
  return {
    case_id: item.case_id,
    asset_id: item.asset_id,
    parent_revision_id: item.parent_revision_id,
    clip_id: item.repair.clip_id,
    clip_frame_position: item.repair.clip_frame_position,
    sheet_frame_index: item.repair.sheet_frame_index,
    mask_sha256: item.repair.mask_sha256,
    instruction_sha256: item.repair.instruction_sha256,
    parent_sheet_sha256: item.authority.parent_sheet_sha256,
    target_frame_sha256: item.authority.target_frame_sha256,
    reference_context_sha256: item.authority.reference_context_sha256,
    provider_preset_id: item.provider.preset_id,
    image_size: item.provider.image_size,
    difficulty: item.classification.difficulty,
    defect_category: item.classification.defect_category,
    expected_improvement: item.classification.expected_improvement,
    ownership_class: item.classification.ownership_class,
    source_sha256: item.authority.source_sha256,
    max_provider_calls: item.provider.max_calls,
  }
}

function equalRgba(left, right) {
  return left.width === right.width && left.height === right.height &&
    Buffer.from(left.data).equals(Buffer.from(right.data))
}

function rgbaPixelDiffers(left, right, offset) {
  return left[offset] !== right[offset] || left[offset + 1] !== right[offset + 1] ||
    left[offset + 2] !== right[offset + 2] || left[offset + 3] !== right[offset + 3]
}

async function verifyCandidatePixels({ parentSheetBuffer, entries, framePlan }) {
  let parentSheet
  let patchedSheet
  let before
  let after
  try {
    ;[parentSheet, patchedSheet, before, after] = await Promise.all([
      loadRgba(parentSheetBuffer),
      loadRgba(capturedEntry(entries, 'patched_normalized_sheet').content),
      loadRgba(capturedEntry(entries, 'target_before').content),
      loadRgba(capturedEntry(entries, 'composited_candidate_frame').content),
    ])
  } catch {
    fail('artifact_integrity_failed')
  }
  const frameSize = framePlan.profile?.frame_size
  if (frameSize?.w !== 96 || frameSize?.h !== 96 || before.width !== 96 || before.height !== 96 ||
      after.width !== 96 || after.height !== 96 || parentSheet.width !== patchedSheet.width ||
      parentSheet.height !== patchedSheet.height) fail('artifact_integrity_failed')
  const parentFrame = extractFrameRgba(parentSheet, framePlan.clip.sheet_frame_index, frameSize)
  const patchedFrame = extractFrameRgba(patchedSheet, framePlan.clip.sheet_frame_index, frameSize)
  if (!equalRgba(parentFrame, before) || !equalRgba(patchedFrame, after)) {
    fail('artifact_integrity_failed')
  }
  const active = runsToBitset(framePlan.mask.runs, 96 * 96)
  let outsideMaskChanged = 0
  for (let pixel = 0; pixel < active.length; pixel += 1) {
    if (active[pixel]) continue
    const offset = pixel * 4
    if (rgbaPixelDiffers(before.data, after.data, offset)) outsideMaskChanged += 1
  }
  let nonTargetChanged = 0
  const targetColumn = framePlan.clip.sheet_frame_index % 8
  const targetRow = Math.floor(framePlan.clip.sheet_frame_index / 8)
  for (let y = 0; y < parentSheet.height; y += 1) {
    for (let x = 0; x < parentSheet.width; x += 1) {
      const inTarget = Math.floor(x / 96) === targetColumn && Math.floor(y / 96) === targetRow
      if (inTarget) continue
      const offset = (y * parentSheet.width + x) * 4
      if (rgbaPixelDiffers(parentSheet.data, patchedSheet.data, offset)) nonTargetChanged += 1
    }
  }
  return { before, after, outsideMaskChanged, nonTargetChanged }
}

async function deriveCandidateAuthority({
  generatedDir,
  projectRoot,
  workspaceRoot,
  evidence,
  setup,
  item,
  project,
  job,
  replanned,
}) {
  if (job.status !== 'done' || job.provider_calls_used !== 1 ||
      job.generated_candidate_count < 1 || job.quality_status === 'unknown') {
    fail('quality_gate_hard_gate_failed')
  }
  const entries = await verifySealedFrameRepairArtifacts({ generatedDir, job })
  const framePlan = parseCapturedJson(entries, 'frame_repair_plan')
  const context = parseCapturedJson(entries, 'frame_repair_context')
  const quality = parseCapturedJson(entries, 'frame_repair_quality')
  const setupCase = setup.cases.find((candidate) => candidate.case_id === item.case_id)
  const fingerprint = buildFrameRepairQualityGateCaseFingerprint({
    setupCase,
    requestedCase: requestedCaseFromPlan(item),
    frameRepairPlan: {
      plan: framePlan,
      plan_hash: job.plan_hash,
      can_run: true,
      diagnostics: [],
    },
  })
  if (!isDeepStrictEqual(fingerprint, expectedFingerprint(item)) ||
      !isDeepStrictEqual(framePlan, replanned.plan) || hashFrameRepairPlan(framePlan) !== job.plan_hash ||
      context.job_id !== job.id || context.operation_id !== item.operation_id ||
      context.project_id !== evidence.plan.project.id || context.asset_id !== item.asset_id ||
      context.parent_revision_id !== item.parent_revision_id || context.plan_hash !== job.plan_hash ||
      context.provider_preset?.id !== evidence.plan.provider.preset_id ||
      context.provider_calls_used !== job.provider_calls_used ||
      context.implementation_revision !== evidence.plan.implementation_revision) {
    fail('quality_gate_identity_mismatch')
  }
  const recomputedQuality = buildFrameRepairQualityReport({
    complete: quality.complete,
    before: quality.before,
    after: quality.after,
    integrity: quality.integrity,
    halo: quality.halo,
    alpha: quality.alpha,
    significant_components: quality.significant_components,
    continuity: quality.continuity,
    validation: quality.validation,
  })
  const capture = await captureManagedCharacterRevisionForQualityGate({
    project,
    assetId: item.asset_id,
    expectedAssetRevisionId: item.parent_revision_id,
    projectRoot,
    workspaceRoot,
  })
  const parentSheet = capture.artifacts.find((entry) => entry.key === 'sheet')
  const pixels = await verifyCandidatePixels({
    parentSheetBuffer: parentSheet.content,
    entries,
    framePlan,
  })
  const qualityComplete = isDeepStrictEqual(recomputedQuality, quality) && quality.complete === true &&
    quality.completeness?.complete === true && quality.completeness?.missing?.length === 0
  const outsideEqual = pixels.outsideMaskChanged === 0 && pixels.nonTargetChanged === 0 &&
    quality.integrity?.target_outside_mask_equal === true &&
    quality.integrity?.non_target_equal === true &&
    quality.integrity?.actual_outside_mask_changed === 0 &&
    quality.integrity?.actual_non_target_changed === 0
  const warnings = [...new Set([
    ...assertSafeCodes(quality.validation?.warnings),
    ...assertSafeCodes(quality.continuity?.warnings),
  ])]
  const hardGates = projectFrameRepairQualityGateHardGates({
    identityComplete: true,
    manifestVerified: true,
    outsideMaskEqual: outsideEqual,
    outsideMaskChangedPixels: pixels.outsideMaskChanged + pixels.nonTargetChanged,
    candidateAvailable: entries.some((entry) => entry.key === 'normalized_candidate_frame'),
    compositedFrameAvailable: entries.some((entry) => entry.key === 'composited_candidate_frame'),
    qualityEvidenceComplete: qualityComplete,
    validatorStatus: quality.validation?.status,
    validatorBlockingErrors: assertSafeCodes(quality.validation?.blocking_errors),
    continuityComplete: ['measured', 'pass', 'warning'].includes(quality.continuity?.status) &&
      Array.isArray(quality.continuity?.frames),
    revisionChainValid: true,
    unrelatedProjectMutation: false,
    providerCalls: job.provider_calls_used,
    warnings,
  })
  return { job, entries, framePlan, context, quality, hardGates, pixels }
}

async function buildFinalContactFrames({ generatedDir, evidence, frameRepairService }) {
  const reviews = new Map(evidence.reviews.map((item) => [item.case_id, item]))
  const frames = []
  for (const item of evidence.plan.cases) {
    const review = reviews.get(item.case_id)
    if (!review) continue
    let job
    try {
      job = await frameRepairService.getOperation({
        project_id: evidence.plan.project.id,
        asset_id: item.asset_id,
        operation_id: item.operation_id,
      })
    } catch (error) {
      if (error?.code === 'operation_not_found') fail('operation_not_found')
      throw error
    }
    if (!job || job.id !== review.job_id || job.plan_hash !== review.frame_repair_plan_hash ||
        job.artifact_manifest_sha256 !== review.frame_repair_artifact_manifest_sha256) {
      fail('quality_gate_identity_mismatch')
    }
    const entries = await verifySealedFrameRepairArtifacts({ generatedDir, job })
    const framePlan = parseCapturedJson(entries, 'frame_repair_plan')
    let before
    let patched
    try {
      before = await loadRgba(capturedEntry(entries, 'target_before').content)
      patched = await loadRgba(capturedEntry(entries, 'patched_normalized_sheet').content)
    } catch {
      fail('artifact_integrity_failed')
    }
    if (before.width !== 96 || before.height !== 96 ||
        framePlan.clip.sheet_frame_index !== item.repair.sheet_frame_index) {
      fail('artifact_integrity_failed')
    }
    const after = extractFrameRgba(patched, item.repair.sheet_frame_index, { w: 96, h: 96 })
    frames.push({
      case_id: item.case_id,
      before_png: await encodeRgbaPng(before),
      after_png: await encodeRgbaPng(after),
    })
  }
  return frames
}

export function createFrameRepairQualityGateCoordinator({
  projectRoot,
  workspaceRoot,
  generatedDir,
  implementationRevision,
  frameRepairCoordinator,
  frameRepairService,
} = {}) {
  assertDependencies({
    projectRoot,
    workspaceRoot,
    generatedDir,
    implementationRevision,
    frameRepairCoordinator,
    frameRepairService,
  })
  const resolvedProjectRoot = path.resolve(projectRoot)
  const resolvedWorkspaceRoot = path.resolve(workspaceRoot)
  const resolvedGeneratedDir = path.resolve(generatedDir)

  async function setupQualityGate({ sourceProjectId, body } = {}) {
    assertQualityGateRouteIds({ projectId: sourceProjectId, sessionId: null, caseId: null })
    const request = assertQualityGateSetupRequest(body)
    if (sourceProjectId === request.targetProjectId) fail('invalid_quality_gate_request')
    if (request.sourceAssets.some((item) => Object.hasOwn(CONTROL_IDENTITIES, item.caseId))) {
      fail('invalid_quality_gate_request')
    }
    return withEditorProjectMutationLock({
      projectId: sourceProjectId,
      workspaceRoot: resolvedWorkspaceRoot,
    }, async () => {
      const loaded = await loadEditorProject({
        projectId: sourceProjectId,
        projectRoot: resolvedProjectRoot,
        workspaceRoot: resolvedWorkspaceRoot,
      })
      assertSourceProject(loaded.project, request)
      const initialAuthority = sourceProjectAuthority(loaded.project)
      const sourceCaptures = await captureSourceAssets({
        request,
        project: loaded.project,
        projectRoot: resolvedProjectRoot,
        workspaceRoot: resolvedWorkspaceRoot,
      })
      const controls = await buildFrameRepairQualityGateControls()
      await assertSetupEvidenceAbsent(resolvedGeneratedDir, request.targetProjectId)
      const entries = setupEntries(request, controls, sourceCaptures)
      const now = new Date()
      const target = createDefaultEditorProject({
        id: request.targetProjectId,
        name: request.targetProjectName,
        createdAt: now,
        updatedAt: now,
      })
      const prepared = await createPreparedEditorProject({
        project: target,
        projectRoot: resolvedProjectRoot,
        workspaceRoot: resolvedWorkspaceRoot,
        now,
        prepareProject: async ({ project }) => {
          let next = project
          for (const entry of entries) {
            const imported = await importCapturedCharacterRevisionForQualityGate({
              project: next,
              targetAssetId: entry.targetAssetId,
              captured: entry.captured,
              projectRoot: resolvedProjectRoot,
              workspaceRoot: resolvedWorkspaceRoot,
              now,
            })
            next = imported.project
          }
          await verifySourceAuthority({
            sourceProjectId,
            request,
            initialAuthority,
            expectedCaptures: sourceCaptures,
            projectRoot: resolvedProjectRoot,
            workspaceRoot: resolvedWorkspaceRoot,
          })
          const manifest = setupManifest({
            sourceProject: loaded.project,
            targetProjectId: request.targetProjectId,
            entries,
          })
          await writeFrameRepairQualityGateSetupManifest({
            generatedDir: resolvedGeneratedDir,
            targetProjectId: request.targetProjectId,
            manifest,
          })
          return next
        },
      })
      await verifySourceAuthority({
        sourceProjectId,
        request,
        initialAuthority,
        expectedCaptures: sourceCaptures,
        projectRoot: resolvedProjectRoot,
        workspaceRoot: resolvedWorkspaceRoot,
      })
      const storedManifest = await readFrameRepairQualityGateSetupManifest({
        generatedDir: resolvedGeneratedDir,
        targetProjectId: request.targetProjectId,
      })
      return {
        project: prepared.project,
        mapping: publicMapping(entries),
        setupManifestSha256: hashFrameRepairQualityGateValue(storedManifest),
      }
    })
  }

  async function planQualityGate({ projectId, body } = {}) {
    assertQualityGateRouteIds({ projectId, sessionId: null, caseId: null })
    const request = assertQualityGatePlanRequest(body)
    const loaded = await loadEditorProject({
      projectId,
      projectRoot: resolvedProjectRoot,
      workspaceRoot: resolvedWorkspaceRoot,
    })
    if (loaded.project.revision !== request.expectedRevision) {
      throw new EditorProjectStoreError('revision_conflict', 'editor project revision conflict', {
        expected_revision: request.expectedRevision,
        current_revision: loaded.project.revision,
      })
    }
    const setup = await readFrameRepairQualityGateSetupManifest({
      generatedDir: resolvedGeneratedDir,
      targetProjectId: projectId,
    })
    if (hashFrameRepairQualityGateValue(setup) !== request.setupManifestSha256 ||
        setup.target_project.id !== projectId) fail('stale_quality_gate_plan')
    const frameRepairPlans = []
    for (const item of request.cases) {
      frameRepairPlans.push(await frameRepairCoordinator.planFrameRepair({
        projectId,
        assetId: item.assetId,
        body: framePlanBody(request, item),
      }))
    }
    const plan = buildFrameRepairQualityGatePlan({
      setupManifest: setup,
      request,
      project: loaded.project,
      frameRepairPlans,
    })
    if (plan.implementation_revision !== implementationRevision) {
      fail('invalid_quality_gate_plan', 'quality gate implementation revision changed')
    }
    const paths = resolveFrameRepairQualityGateSessionPaths({
      generatedDir: resolvedGeneratedDir,
      sessionId: plan.session_id,
      caseIds: plan.cases.map((item) => item.case_id),
    })
    if (await fixedFileExists(paths.sessionPlan)) {
      let sealed
      try {
        sealed = await readFrameRepairQualityGateEvidence({
          generatedDir: resolvedGeneratedDir,
          sessionId: plan.session_id,
        })
      } catch (error) {
        if (error?.code !== 'session_not_found') throw error
      }
      if (sealed && sealed.plan.session_plan_hash !== plan.session_plan_hash) {
        fail('session_id_conflict', 'quality gate session id is already sealed')
      }
    }
    return plan
  }

  async function startQualityGate({ projectId, body } = {}) {
    const request = assertQualityGateStartRequest(body)
    const plan = await planQualityGate({ projectId, body: planRequestBody(request) })
    if (plan.session_plan_hash !== request.expectedPlanHash) {
      fail('stale_quality_gate_plan', 'quality gate plan changed before Start')
    }
    const blindOrder = buildFrameRepairQualityGateBlindOrder({
      sessionId: plan.session_id,
      cases: plan.cases,
    })
    let evidence
    try {
      evidence = await startFrameRepairQualityGateEvidence({
        generatedDir: resolvedGeneratedDir,
        plan,
        blindOrder,
      })
    } catch (error) {
      if (error?.code === 'evidence_conflict') {
        fail('session_id_conflict', 'quality gate session id conflicts with sealed evidence')
      }
      throw error
    }
    return { plan, blindOrder, evidence }
  }

  async function getQualityGate({ projectId, sessionId } = {}) {
    assertQualityGateRouteIds({ projectId, sessionId, caseId: null })
    const [loaded, evidence] = await Promise.all([
      loadEditorProject({
        projectId,
        projectRoot: resolvedProjectRoot,
        workspaceRoot: resolvedWorkspaceRoot,
      }),
      readFrameRepairQualityGateEvidence({
        generatedDir: resolvedGeneratedDir,
        sessionId,
      }),
    ])
    if (evidence.plan.project.id !== projectId) fail('quality_gate_identity_mismatch')
    const reviewByCaseId = new Map(evidence.reviews.map((item) => [item.case_id, item]))
    const outcomeByCaseId = new Map(evidence.outcomes.map((item) => [item.case_id, item]))
    const blindByCaseId = new Map(evidence.blind_order.cases.map((item) => [item.case_id, item]))
    const cases = []
    let callsUsed = 0
    for (const item of evidence.plan.cases) {
      let operation = null
      try {
        operation = publicOperation(await frameRepairCoordinator.getFrameRepairOperation({
          projectId,
          assetId: item.asset_id,
          operationId: item.operation_id,
        }))
      } catch (error) {
        if (error?.code !== 'operation_not_found') throw error
      }
      const review = reviewByCaseId.get(item.case_id) ?? null
      const outcome = outcomeByCaseId.get(item.case_id) ?? null
      const blind = blindByCaseId.get(item.case_id) ?? null
      if (!blind || blind.case_hash !== item.case_hash) fail('quality_gate_identity_mismatch')
      callsUsed += outcome?.provider_calls ?? operation?.providerCallsUsed ?? 0
      cases.push({
        caseId: item.case_id,
        displayIndex: item.display_index,
        assetId: item.asset_id,
        parentRevisionId: item.parent_revision_id,
        operationId: item.operation_id,
        caseHash: item.case_hash,
        blind: { a: blind.a, b: blind.b },
        repair: {
          clipId: item.repair.clip_id,
          clipFramePosition: item.repair.clip_frame_position,
          sheetFrameIndex: item.repair.sheet_frame_index,
          instruction: item.repair.instruction,
          maskEdits: clone(item.repair.mask_edits),
        },
        classification: {
          difficulty: item.classification.difficulty,
          defectCategory: item.classification.defect_category,
          expectedImprovement: item.classification.expected_improvement,
          ownershipClass: item.classification.ownership_class,
        },
        status: deriveCaseStatus(outcome, review, operation),
        reviewRecorded: Boolean(review),
        successfulCandidate: review?.successful_candidate ?? null,
        outcome: outcome?.outcome ?? null,
        operation,
        reviewArtifactUrl: review
          ? artifactUrl(sessionId, `case_${item.case_id}_review.json`)
          : null,
        outcomeArtifactUrl: outcome
          ? artifactUrl(sessionId, `case_${item.case_id}_outcome.json`)
          : null,
      })
    }
    const paths = resolveFrameRepairQualityGateSessionPaths({
      generatedDir: resolvedGeneratedDir,
      sessionId,
      caseIds: evidence.plan.cases.map((item) => item.case_id),
    })
    const finalFiles = {
      reportJson: ['frame_repair_quality_gate.json', paths.reportJson],
      reportMarkdown: ['frame_repair_quality_gate.md', paths.reportMarkdown],
      contactSheet: ['frame_repair_quality_gate_contact_sheet.png', paths.contactSheet],
      artifactManifest: ['artifact_manifest.json', paths.artifactManifest],
    }
    const artifacts = {
      sessionPlan: artifactUrl(sessionId, 'session_plan.json'),
      blindOrder: artifactUrl(sessionId, 'blind_order.json'),
      reportJson: null,
      reportMarkdown: null,
      contactSheet: null,
      artifactManifest: null,
    }
    for (const [key, [fileName, filePath]] of Object.entries(finalFiles)) {
      if (await fixedFileExists(filePath)) artifacts[key] = artifactUrl(sessionId, fileName)
    }
    const allowedArtifactUrls = [...new Set([
      ...Object.values(artifacts).filter(Boolean),
      ...cases.flatMap((item) => [item.reviewArtifactUrl, item.outcomeArtifactUrl]).filter(Boolean),
    ])].sort()
    const finalized = artifacts.artifactManifest !== null
    const reviewing = cases.some((item) => item.reviewRecorded && item.outcome === null)
    const running = cases.some((item) => item.operation !== null && item.outcome === null)
    const unknown = cases.some((item) => item.status === 'outcome_unknown')
    const safetyProviderBlock = evidence.outcomes.find((item) => (
      item.outcome === 'provider_blocked' && item.controlled_reason === 'provider_safety_filter'
    ))
    let consecutiveNoCandidate = 0
    for (const item of evidence.plan.cases) {
      const outcome = outcomeByCaseId.get(item.case_id)
      if (!outcome) break
      if (outcome?.outcome === 'provider_blocked') consecutiveNoCandidate += 1
      else consecutiveNoCandidate = 0
    }
    const overBudget = callsUsed > 8 || cases.some((item) => (
      (item.operation?.providerCallsUsed ?? 0) > 1
    ))
    let chainDrift = false
    try {
      let terminalPrefix = 0
      while (terminalPrefix < evidence.plan.cases.length &&
          outcomeByCaseId.has(evidence.plan.cases[terminalPrefix].case_id)) terminalPrefix += 1
      const expectedCurrent = expectedChainBefore(evidence, terminalPrefix)
      chainDrift = loaded.project.revision !== expectedCurrent.revision ||
        projectProjectionSha256(loaded.project) !== expectedCurrent.projectionSha256
    } catch {
      chainDrift = true
    }
    const blockingReason = chainDrift
      ? 'revision_chain_drift'
      : overBudget
      ? 'provider_call_count_invalid'
      : safetyProviderBlock
        ? 'provider_safety_filter'
        : unknown
          ? 'transport_outcome_unknown'
          : consecutiveNoCandidate >= 2
            ? 'provider_conservation_pause'
            : null
    return {
      session: {
        id: evidence.plan.session_id,
        projectId,
        projectRevision: loaded.project.revision,
        initialRevision: evidence.plan.project.initial_revision,
        planHash: evidence.plan.session_plan_hash,
        providerPresetId: evidence.plan.provider.preset_id,
        imageSize: evidence.plan.provider.image_size,
        status: finalized
          ? 'finalized'
          : blockingReason
            ? 'paused'
            : reviewing
              ? 'reviewing'
              : running ? 'running' : 'ready',
        blockingReason,
        callsUsed,
        callsRemaining: Math.max(0, 8 - callsUsed),
      },
      cases,
      artifacts,
      allowedArtifactUrls,
    }
  }

  async function recordQualityGateReview({ projectId, sessionId, caseId, body } = {}) {
    assertQualityGateRouteIds({ projectId, sessionId, caseId })
    const request = assertQualityGateReviewRequest(body)
    const evidence = await readFrameRepairQualityGateEvidence({
      generatedDir: resolvedGeneratedDir,
      sessionId,
    })
    if (evidence.plan.project.id !== projectId) fail('quality_gate_identity_mismatch')
    const { item, index } = findPlanCase(evidence, caseId)
    assertCaseRequestIdentity(evidence, item, request)
    const chain = expectedChainBefore(evidence, index)
    const loaded = await loadEditorProject({
      projectId,
      projectRoot: resolvedProjectRoot,
      workspaceRoot: resolvedWorkspaceRoot,
    })
    const projectionSha256 = projectProjectionSha256(loaded.project)
    const asset = loaded.project.assets?.[item.asset_id]
    if (loaded.project.revision !== chain.revision || projectionSha256 !== chain.projectionSha256 ||
        !asset || asset.active_revision_id !== item.parent_revision_id) {
      fail('quality_gate_paused', 'quality gate project revision chain changed')
    }
    const { job, replanned } = await resolveDurableOperation({
      frameRepairCoordinator,
      frameRepairService,
      evidence,
      item,
      expectedRevision: loaded.project.revision,
    })
    if (job.id !== request.jobId) fail('quality_gate_identity_mismatch')
    const setup = await readFrameRepairQualityGateSetupManifest({
      generatedDir: resolvedGeneratedDir,
      targetProjectId: projectId,
    })
    const authority = await deriveCandidateAuthority({
      generatedDir: resolvedGeneratedDir,
      projectRoot: resolvedProjectRoot,
      workspaceRoot: resolvedWorkspaceRoot,
      evidence,
      setup,
      item,
      project: loaded.project,
      job,
      replanned,
    })
    if (authority.hardGates.status === 'blocked') {
      fail('quality_gate_hard_gate_failed', 'quality gate automated evidence blocks review', {
        reasons: authority.hardGates.reasons,
      })
    }
    const blind = evidence.blind_order.cases.find((candidate) => candidate.case_id === caseId)
    if (!blind || blind.case_hash !== item.case_hash) fail('quality_gate_identity_mismatch')
    const preferredVersion = request.blindChoice === 'prefer_a'
      ? blind.a
      : request.blindChoice === 'prefer_b' ? blind.b : null
    const successfulCandidate = request.improvement === 'improved' &&
      ['usable', 'review_required'].includes(request.usability) &&
      request.newBlockingDefect === false
    return writeFrameRepairQualityGateReview({
      generatedDir: resolvedGeneratedDir,
      plan: evidence.plan,
      review: {
        protocol: 'frame_repair_quality_gate_review_v1',
        session_id: sessionId,
        session_plan_hash: evidence.plan.session_plan_hash,
        case_id: item.case_id,
        case_hash: item.case_hash,
        operation_id: item.operation_id,
        job_id: job.id,
        frame_repair_plan_hash: job.plan_hash,
        frame_repair_artifact_manifest_sha256: job.artifact_manifest_sha256,
        project_revision: loaded.project.revision,
        project_projection_sha256: projectionSha256,
        parent_revision_id: item.parent_revision_id,
        blind: {
          choice: request.blindChoice,
          a: blind.a,
          b: blind.b,
          preferred_version: preferredVersion,
        },
        functional: {
          improvement: request.improvement,
          usability: request.usability,
          new_blocking_defect: request.newBlockingDefect,
          reason_codes: request.reasonCodes,
          note: request.note,
        },
        hard_gates: authority.hardGates,
        successful_candidate: successfulCandidate,
        recorded_at: new Date().toISOString(),
      },
    })
  }

  async function recordQualityGateOutcome({ projectId, sessionId, caseId, body } = {}) {
    assertQualityGateRouteIds({ projectId, sessionId, caseId })
    const request = assertQualityGateOutcomeRequest(body)
    const evidence = await readFrameRepairQualityGateEvidence({
      generatedDir: resolvedGeneratedDir,
      sessionId,
    })
    if (evidence.plan.project.id !== projectId) fail('quality_gate_identity_mismatch')
    const { item, index } = findPlanCase(evidence, caseId)
    assertCaseRequestIdentity(evidence, item, request)
    const chain = expectedChainBefore(evidence, index)
    const loaded = await loadEditorProject({
      projectId,
      projectRoot: resolvedProjectRoot,
      workspaceRoot: resolvedWorkspaceRoot,
    })
    const currentProjection = projectProjectionSha256(loaded.project)
    if (request.outcome === 'accepted' || request.outcome === 'rejected') {
      const review = evidence.reviews.find((candidate) => candidate.case_id === item.case_id)
      const reviewSha256 = review ? hashFrameRepairQualityGateValue(review) : null
      if (!review || reviewSha256 !== request.expectedReviewSha256 ||
          review.job_id !== request.jobId || review.operation_id !== item.operation_id ||
          loaded.project.revision !== request.expectedProjectRevision) {
        fail('quality_gate_identity_mismatch')
      }
      let job
      try {
        job = await frameRepairService.getOperation({
          project_id: projectId,
          asset_id: item.asset_id,
          operation_id: item.operation_id,
        })
      } catch (error) {
        if (error?.code === 'operation_not_found') fail('operation_not_found')
        throw error
      }
      if (!job || job.id !== request.jobId || job.plan_hash !== review.frame_repair_plan_hash ||
          job.artifact_manifest_sha256 !== review.frame_repair_artifact_manifest_sha256 ||
          job.provider_calls_used !== review.hard_gates.facts.provider_calls ||
          job.implementation_revision !== evidence.plan.implementation_revision) {
        fail('quality_gate_identity_mismatch')
      }
      let afterRevision = chain.revision
      let afterProjection = chain.projectionSha256
      let acceptedRevisionId = null
      if (request.outcome === 'accepted') {
        const asset = loaded.project.assets?.[item.asset_id]
        const child = asset?.revisions?.[request.acceptedRevisionId]
        const matchingChildren = Object.values(asset?.revisions ?? {}).filter((candidate) => (
          candidate.parent_revision_id === item.parent_revision_id && candidate.source_job_id === job.id
        ))
        if (!child || matchingChildren.length !== 1 || matchingChildren[0].id !== child.id ||
            asset.active_revision_id !== request.acceptedRevisionId ||
            child.parent_revision_id !== item.parent_revision_id || child.source_job_id !== job.id ||
            loaded.project.revision <= chain.revision) {
          fail('accept_outcome_ambiguous')
        }
        afterRevision = loaded.project.revision
        afterProjection = currentProjection
        acceptedRevisionId = request.acceptedRevisionId
      } else if (loaded.project.revision !== chain.revision ||
          currentProjection !== chain.projectionSha256) {
        fail('quality_gate_paused', 'quality gate project revision chain changed')
      }
      return writeFrameRepairQualityGateOutcome({
        generatedDir: resolvedGeneratedDir,
        plan: evidence.plan,
        outcome: {
          protocol: 'frame_repair_quality_gate_outcome_v1',
          session_id: sessionId,
          session_plan_hash: evidence.plan.session_plan_hash,
          case_id: item.case_id,
          case_hash: item.case_hash,
          operation_id: item.operation_id,
          job_id: job.id,
          review_sha256: reviewSha256,
          outcome: request.outcome,
          provider_calls: job.provider_calls_used,
          controlled_reason: null,
          project_before_revision: chain.revision,
          project_after_revision: afterRevision,
          accepted_revision_id: acceptedRevisionId,
          project_before_projection_sha256: chain.projectionSha256,
          project_after_projection_sha256: afterProjection,
          recorded_at: new Date().toISOString(),
        },
      })
    }
    if (loaded.project.revision !== request.expectedProjectRevision ||
        loaded.project.revision !== chain.revision || currentProjection !== chain.projectionSha256) {
      fail('quality_gate_paused', 'quality gate project revision chain changed')
    }
    const { job, replanned } = await resolveDurableOperation({
      frameRepairCoordinator,
      frameRepairService,
      evidence,
      item,
      expectedRevision: loaded.project.revision,
    })
    if (job.provider_calls_used > 1) {
      fail('quality_gate_paused', 'quality gate provider call budget was exceeded')
    }
    if (request.outcome === 'outcome_unknown') {
      if (job.recovery_state !== 'outcome_unknown' && job.status !== 'outcome_unknown' &&
          job.reason !== 'transport_outcome_unknown' && job.reason !== 'provider_failed') {
        fail('quality_gate_identity_mismatch')
      }
      return getQualityGate({ projectId, sessionId })
    }
    if (request.outcome === 'quality_blocked') {
      if (request.jobId !== job.id || request.expectedReviewSha256 !== null ||
          request.acceptedRevisionId !== null) fail('quality_gate_identity_mismatch')
      const setup = await readFrameRepairQualityGateSetupManifest({
        generatedDir: resolvedGeneratedDir,
        targetProjectId: projectId,
      })
      let authority = null
      let controlledReason = null
      try {
        authority = await deriveCandidateAuthority({
          generatedDir: resolvedGeneratedDir,
          projectRoot: resolvedProjectRoot,
          workspaceRoot: resolvedWorkspaceRoot,
          evidence,
          setup,
          item,
          project: loaded.project,
          job,
          replanned,
        })
      } catch (error) {
        if (!['artifact_integrity_failed', 'quality_gate_identity_mismatch',
          'quality_gate_hard_gate_failed', 'evidence_integrity_failed'].includes(error?.code)) throw error
        controlledReason = error.code
      }
      if (authority?.hardGates.status !== 'blocked' && controlledReason === null) {
        fail('quality_gate_hard_gate_failed')
      }
      controlledReason ??= authority.hardGates.reasons[0] ?? 'quality_evidence_incomplete'
      return writeFrameRepairQualityGateOutcome({
        generatedDir: resolvedGeneratedDir,
        plan: evidence.plan,
        outcome: {
          protocol: 'frame_repair_quality_gate_outcome_v1',
          session_id: sessionId,
          session_plan_hash: evidence.plan.session_plan_hash,
          case_id: item.case_id,
          case_hash: item.case_hash,
          operation_id: item.operation_id,
          job_id: job.id,
          review_sha256: null,
          outcome: 'quality_blocked',
          provider_calls: job.provider_calls_used,
          controlled_reason: controlledReason,
          project_before_revision: chain.revision,
          project_after_revision: chain.revision,
          accepted_revision_id: null,
          project_before_projection_sha256: chain.projectionSha256,
          project_after_projection_sha256: chain.projectionSha256,
          recorded_at: new Date().toISOString(),
        },
      })
    }
    if (request.outcome !== 'provider_blocked') {
      fail('invalid_quality_gate_outcome', 'this quality gate outcome requires a sealed review')
    }
    if (request.jobId !== job.id || request.expectedReviewSha256 !== null ||
        request.acceptedRevisionId !== null || job.generated_candidate_count !== 0 ||
        !PROVIDER_BLOCKED_REASONS.has(job.reason)) {
      fail('quality_gate_identity_mismatch')
    }
    const persisted = await writeFrameRepairQualityGateOutcome({
      generatedDir: resolvedGeneratedDir,
      plan: evidence.plan,
      outcome: {
        protocol: 'frame_repair_quality_gate_outcome_v1',
        session_id: sessionId,
        session_plan_hash: evidence.plan.session_plan_hash,
        case_id: item.case_id,
        case_hash: item.case_hash,
        operation_id: item.operation_id,
        job_id: job.id,
        review_sha256: null,
        outcome: 'provider_blocked',
        provider_calls: job.provider_calls_used,
        controlled_reason: job.reason,
        project_before_revision: chain.revision,
        project_after_revision: chain.revision,
        accepted_revision_id: null,
        project_before_projection_sha256: chain.projectionSha256,
        project_after_projection_sha256: chain.projectionSha256,
        recorded_at: new Date().toISOString(),
      },
    })
    return persisted
  }

  async function finalizeQualityGate({ projectId, sessionId, body } = {}) {
    assertQualityGateRouteIds({ projectId, sessionId, caseId: null })
    const request = assertQualityGateFinalizeRequest(body)
    const evidence = await readFrameRepairQualityGateEvidence({
      generatedDir: resolvedGeneratedDir,
      sessionId,
    })
    if (evidence.plan.project.id !== projectId ||
        evidence.plan.session_plan_hash !== request.expectedPlanHash) {
      fail('quality_gate_identity_mismatch')
    }
    const loaded = await loadEditorProject({
      projectId,
      projectRoot: resolvedProjectRoot,
      workspaceRoot: resolvedWorkspaceRoot,
    })
    if (loaded.project.revision !== request.expectedRevision) {
      throw new EditorProjectStoreError('revision_conflict', 'editor project revision conflict', {
        expected_revision: request.expectedRevision,
        current_revision: loaded.project.revision,
      })
    }
    let terminalPrefix = 0
    const outcomeIds = new Set(evidence.outcomes.map((item) => item.case_id))
    while (terminalPrefix < evidence.plan.cases.length &&
        outcomeIds.has(evidence.plan.cases[terminalPrefix].case_id)) terminalPrefix += 1
    if (evidence.outcomes.some((item) => (
      evidence.plan.cases.findIndex((planned) => planned.case_id === item.case_id) >= terminalPrefix
    ))) fail('quality_gate_paused', 'quality gate terminal outcomes are not sequential')
    const expectedCurrent = expectedChainBefore(evidence, terminalPrefix)
    if (loaded.project.revision !== expectedCurrent.revision ||
        projectProjectionSha256(loaded.project) !== expectedCurrent.projectionSha256) {
      fail('quality_gate_paused', 'quality gate project revision chain changed')
    }
    const frames = await buildFinalContactFrames({
      generatedDir: resolvedGeneratedDir,
      evidence,
      frameRepairService,
    })
    const finalized = await finalizeFrameRepairQualityGateEvidence({
      generatedDir: resolvedGeneratedDir,
      plan: evidence.plan,
      frames,
    })
    return { ...finalized, view: await getQualityGate({ projectId, sessionId }) }
  }

  return Object.freeze({
    setupQualityGate,
    planQualityGate,
    startQualityGate,
    getQualityGate,
    recordQualityGateReview,
    recordQualityGateOutcome,
    finalizeQualityGate,
  })
}
