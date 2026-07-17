import { createHash } from 'node:crypto'
import {
  constants as fsConstants,
  lstat,
  mkdir,
  open,
  realpath,
} from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

import {
  computeFrameRepairQualityGateDecision,
  hashFrameRepairQualityGateValue,
  projectFrameRepairQualityGateHardGates,
  serializeFrameRepairQualityGateValue,
} from './frameRepairQualityGatePlan.js'
import { FrameRepairQualityGateError } from './frameRepairQualityGateProtocol.js'

export const QUALITY_GATE_EVIDENCE_LIMITS = Object.freeze({
  setupManifest: 512 * 1024,
  sessionPlan: 512 * 1024,
  blindOrder: 64 * 1024,
  review: 128 * 1024,
  outcome: 128 * 1024,
  reportJson: 512 * 1024,
  reportMarkdown: 256 * 1024,
  contactSheetPng: 16 * 1024 * 1024,
  artifactManifest: 128 * 1024,
})

const LOWER_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/
const SESSION_ID_PATTERN = /^frqg_[a-z0-9][a-z0-9_-]{15,79}$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const OPERATION_ID_PATTERN = /^frqgop_[a-f0-9]{48}$/
const JOB_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/
const SAFE_CODE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const CONTROL_CHARACTER_PATTERN = /\p{Cc}/u
const ARTIFACT_KEYS = Object.freeze([
  'sheet',
  'animations',
  'metadata',
  'editor_metadata',
  'debug_report',
])
const CONTROL_IDENTITIES = new Map([
  ['control_outline_alpha', 'quality_gate_control_outline_alpha_v1'],
  ['control_small_component', 'quality_gate_control_small_component_v1'],
])
const HARD_GATE_FACT_TYPES = Object.freeze({
  identity_complete: 'boolean',
  manifest_verified: 'boolean',
  outside_mask_equal: 'boolean',
  outside_mask_changed_pixels: 'integer',
  candidate_available: 'boolean',
  composited_frame_available: 'boolean',
  quality_evidence_complete: 'boolean',
  validator_status: 'validator_status',
  validator_blocking_errors: 'codes',
  continuity_complete: 'boolean',
  revision_chain_valid: 'boolean',
  unrelated_project_mutation: 'boolean',
  provider_calls: 'integer',
  warnings: 'codes',
})
const sessionMutationTails = new Map()
const CONTACT_SHEET_WIDTH = 1536
const CONTACT_SHEET_HEIGHT = 512
const CONTACT_CELL_WIDTH = 384
const CONTACT_CELL_HEIGHT = 256
const CONTACT_FRAME_INPUT_LIMIT = 1024 * 1024
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

function fail(code = 'invalid_quality_gate_evidence', message = 'quality gate evidence is invalid') {
  throw new FrameRepairQualityGateError(code, message)
}

function asEvidenceError(error, fallbackCode = 'invalid_quality_gate_evidence') {
  if (error instanceof FrameRepairQualityGateError) return error
  return new FrameRepairQualityGateError(fallbackCode, 'quality gate evidence is invalid')
}

function isLowerId(value, maximumLength = 80) {
  return typeof value === 'string' && value.length > 0 && value.length <= maximumLength &&
    LOWER_ID_PATTERN.test(value)
}

function requireProjectId(value) {
  if (!isLowerId(value)) fail('unsafe_artifact_path', 'quality gate project id is unsafe')
  return value
}

function requireSessionId(value) {
  if (typeof value !== 'string' || !SESSION_ID_PATTERN.test(value)) {
    fail('unsafe_artifact_path', 'quality gate session id is unsafe')
  }
  return value
}

function requireCaseId(value) {
  if (!isLowerId(value, 64)) fail('unsafe_artifact_path', 'quality gate case id is unsafe')
  return value
}

function requireGeneratedDir(value) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) {
    fail('unsafe_artifact_path', 'quality gate generated root is unsafe')
  }
  return path.resolve(value)
}

function exactRecord(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) fail()
  const actual = Object.keys(value)
  if (actual.length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) fail()
  return value
}

function denseArray(value, exactLength = null, maximumLength = null) {
  if (!Array.isArray(value) ||
      (exactLength !== null && value.length !== exactLength) ||
      (maximumLength !== null && value.length > maximumLength) ||
      Object.keys(value).length !== value.length) fail()
  return value
}

function isSha256(value) {
  return typeof value === 'string' && SHA256_PATTERN.test(value)
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0
}

function nonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

function cloneFrozen(value) {
  return deepFreeze(JSON.parse(serializeFrameRepairQualityGateValue(value).toString('utf8')))
}

function rawSha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function safeCodes(value, maximumLength = 32) {
  const codes = denseArray(value, null, maximumLength)
  if (codes.some((code) => typeof code !== 'string' || !SAFE_CODE_PATTERN.test(code)) ||
      new Set(codes).size !== codes.length) fail()
  return codes
}

function safeText(value, { nullable = false, maximumLength = 500 } = {}) {
  if (nullable && value === null) return value
  if (typeof value !== 'string' || CONTROL_CHARACTER_PATTERN.test(value) ||
      [...value].length > maximumLength || value.normalize('NFC') !== value) fail()
  return value
}

function validateArtifactRecords(value) {
  const artifacts = denseArray(value, ARTIFACT_KEYS.length)
  const seen = new Set()
  for (const item of artifacts) {
    const artifact = exactRecord(item, ['key', 'size', 'sha256'])
    if (!ARTIFACT_KEYS.includes(artifact.key) || seen.has(artifact.key) ||
        !positiveInteger(artifact.size) || !isSha256(artifact.sha256)) fail()
    seen.add(artifact.key)
  }
  if (ARTIFACT_KEYS.some((key) => !seen.has(key))) fail()
  return artifacts
}

function validateSetupManifest(value) {
  const manifest = exactRecord(value, [
    'protocol', 'source_project', 'target_project', 'ownership_confirmed', 'cases',
  ])
  const sourceProject = exactRecord(manifest.source_project, ['id', 'revision'])
  const targetProject = exactRecord(manifest.target_project, ['id', 'revision'])
  if (manifest.protocol !== 'frame_repair_quality_gate_setup_v1' ||
      manifest.ownership_confirmed !== true || !isLowerId(sourceProject.id) ||
      !positiveInteger(sourceProject.revision) || !isLowerId(targetProject.id) ||
      targetProject.revision !== 1 || sourceProject.id === targetProject.id) fail()

  const cases = denseArray(manifest.cases, 8)
  const caseIds = new Set()
  const targetIds = new Set()
  const userSourceIds = new Set()
  for (const entry of cases) {
    const item = exactRecord(entry, [
      'case_id', 'ownership_class', 'source', 'target', 'control_identity',
    ])
    const source = exactRecord(item.source, ['asset_id', 'revision_id', 'source_sha256', 'artifacts'])
    const target = exactRecord(item.target, ['asset_id', 'revision_id', 'artifacts'])
    const sourceArtifacts = validateArtifactRecords(source.artifacts)
    const targetArtifacts = validateArtifactRecords(target.artifacts)
    const expectedControl = CONTROL_IDENTITIES.get(item.case_id)
    if (!isLowerId(item.case_id, 64) || caseIds.has(item.case_id) ||
        !isLowerId(target.asset_id) || targetIds.has(target.asset_id) ||
        target.revision_id !== 'rev_001' || !isSha256(source.source_sha256) ||
        source.source_sha256 !== hashFrameRepairQualityGateValue(sourceArtifacts) ||
        serializeFrameRepairQualityGateValue(sourceArtifacts)
          .equals(serializeFrameRepairQualityGateValue(targetArtifacts)) !== true) fail()
    if (expectedControl) {
      if (item.ownership_class !== 'repository_control' || source.asset_id !== null ||
          source.revision_id !== null || item.control_identity !== expectedControl) fail()
    } else {
      if (item.ownership_class !== 'user_owned' || !isLowerId(source.asset_id) ||
          !isLowerId(source.revision_id) || item.control_identity !== null ||
          userSourceIds.has(source.asset_id)) fail()
      userSourceIds.add(source.asset_id)
    }
    caseIds.add(item.case_id)
    targetIds.add(target.asset_id)
  }
  if (userSourceIds.size !== 6 ||
      [...CONTROL_IDENTITIES.keys()].some((caseId) => !caseIds.has(caseId))) fail()
  return manifest
}

function validateMaskEdits(value) {
  for (const entry of denseArray(value, null, 64)) {
    const edit = exactRecord(entry, ['op', 'x', 'y', 'width', 'height'])
    if (!['add_rectangle', 'remove_rectangle'].includes(edit.op) ||
        !nonNegativeInteger(edit.x) || !nonNegativeInteger(edit.y) ||
        !positiveInteger(edit.width) || !positiveInteger(edit.height) ||
        edit.x + edit.width > 96 || edit.y + edit.height > 96) fail()
  }
  return value
}

function validatePlan(value) {
  const plan = exactRecord(value, [
    'protocol', 'session_id', 'setup_manifest_sha256', 'implementation_revision',
    'project', 'provider', 'call_budget', 'cases', 'session_plan_hash',
  ])
  const project = exactRecord(plan.project, ['id', 'initial_revision', 'initial_projection_sha256'])
  const provider = exactRecord(plan.provider, ['preset_id', 'image_size'])
  const budget = exactRecord(plan.call_budget, ['per_case', 'total'])
  if (plan.protocol !== 'frame_repair_quality_gate_plan_v1' ||
      !SESSION_ID_PATTERN.test(plan.session_id) || !isSha256(plan.setup_manifest_sha256) ||
      typeof plan.implementation_revision !== 'string' || plan.implementation_revision.length < 1 ||
      [...plan.implementation_revision].length > 160 || CONTROL_CHARACTER_PATTERN.test(plan.implementation_revision) ||
      !isLowerId(project.id) || project.initial_revision !== 1 ||
      !isSha256(project.initial_projection_sha256) || !isLowerId(provider.preset_id) ||
      !['1K', '2K'].includes(provider.image_size) || budget.per_case !== 1 || budget.total !== 8 ||
      !isSha256(plan.session_plan_hash)) fail()
  const cases = denseArray(plan.cases, 8)
  const caseIds = new Set()
  const assetIds = new Set()
  cases.forEach((entry, index) => {
    const item = exactRecord(entry, [
      'case_id', 'display_index', 'asset_id', 'parent_revision_id', 'repair',
      'classification', 'authority', 'provider', 'case_hash', 'operation_id',
    ])
    const repair = exactRecord(item.repair, [
      'clip_id', 'clip_frame_position', 'sheet_frame_index', 'instruction',
      'instruction_sha256', 'mask_edits', 'mask_sha256',
    ])
    const classification = exactRecord(item.classification, [
      'difficulty', 'defect_category', 'expected_improvement', 'ownership_class',
    ])
    const authority = exactRecord(item.authority, [
      'source_sha256', 'parent_sheet_sha256', 'target_frame_sha256', 'reference_context_sha256',
    ])
    const caseProvider = exactRecord(item.provider, ['preset_id', 'image_size', 'max_calls'])
    validateMaskEdits(repair.mask_edits)
    if (!isLowerId(item.case_id, 64) || caseIds.has(item.case_id) || item.display_index !== index ||
        !isLowerId(item.asset_id) || assetIds.has(item.asset_id) || !isLowerId(item.parent_revision_id) ||
        !isLowerId(repair.clip_id) || !nonNegativeInteger(repair.clip_frame_position) ||
        repair.clip_frame_position > 7 || !nonNegativeInteger(repair.sheet_frame_index) ||
        repair.sheet_frame_index > 63 || safeText(repair.instruction) !== repair.instruction ||
        repair.instruction_sha256 !== hashFrameRepairQualityGateValue(repair.instruction) ||
        !isSha256(repair.mask_sha256) || !['basic', 'medium', 'hard'].includes(classification.difficulty) ||
        !isLowerId(classification.defect_category, 64) ||
        safeText(classification.expected_improvement) !== classification.expected_improvement ||
        !['repository_control', 'user_owned'].includes(classification.ownership_class) ||
        Object.values(authority).some((digest) => !isSha256(digest)) ||
        caseProvider.preset_id !== provider.preset_id || caseProvider.image_size !== provider.image_size ||
        caseProvider.max_calls !== 1 || !isSha256(item.case_hash) ||
        !OPERATION_ID_PATTERN.test(item.operation_id)) fail()
    const canonicalCase = {
      case_id: item.case_id,
      display_index: item.display_index,
      asset_id: item.asset_id,
      parent_revision_id: item.parent_revision_id,
      repair: item.repair,
      classification: item.classification,
      authority: item.authority,
      provider: item.provider,
    }
    const expectedCaseHash = hashFrameRepairQualityGateValue(canonicalCase)
    const expectedOperationId = `frqgop_${rawSha256(
      `${plan.session_id}\0${item.case_id}\0${expectedCaseHash}`,
    ).slice(0, 48)}`
    if (item.case_hash !== expectedCaseHash || item.operation_id !== expectedOperationId) fail()
    caseIds.add(item.case_id)
    assetIds.add(item.asset_id)
  })
  const session = { ...plan }
  delete session.session_plan_hash
  if (plan.session_plan_hash !== hashFrameRepairQualityGateValue(session)) fail()
  return plan
}

function validateBlindOrder(value, plan) {
  const order = exactRecord(value, ['session_id', 'cases'])
  if (order.session_id !== plan.session_id) fail()
  const cases = denseArray(order.cases, 8)
  cases.forEach((entry, index) => {
    const item = exactRecord(entry, ['case_id', 'case_hash', 'a', 'b'])
    const planned = plan.cases[index]
    if (item.case_id !== planned.case_id || item.case_hash !== planned.case_hash ||
        !((item.a === 'before' && item.b === 'after') ||
          (item.a === 'after' && item.b === 'before'))) fail()
  })
  return order
}

function validateStoredBlindOrder(value, plan) {
  const stored = exactRecord(value, ['protocol', 'session_id', 'session_plan_hash', 'cases'])
  if (stored.protocol !== 'frame_repair_quality_gate_blind_order_v1' ||
      stored.session_id !== plan.session_id || stored.session_plan_hash !== plan.session_plan_hash) fail()
  validateBlindOrder({ session_id: stored.session_id, cases: stored.cases }, plan)
  return stored
}

function validateHardGateFacts(value) {
  const keys = Object.keys(HARD_GATE_FACT_TYPES)
  exactRecord(value, keys)
  for (const [key, item] of Object.entries(value)) {
    const expected = HARD_GATE_FACT_TYPES[key]
    if (expected === 'boolean' && typeof item !== 'boolean') fail()
    if (expected === 'integer' && !nonNegativeInteger(item)) fail()
    if (expected === 'validator_status' && !['pass', 'warning', 'fail'].includes(item)) fail()
    if (expected === 'codes') safeCodes(item)
  }
  return value
}

function planCase(plan, caseId) {
  const match = plan.cases.find((item) => item.case_id === caseId)
  if (!match) fail('case_not_found', 'quality gate case was not found')
  return match
}

function validateReview(value, plan) {
  const review = exactRecord(value, [
    'protocol', 'session_id', 'session_plan_hash', 'case_id', 'case_hash', 'operation_id',
    'job_id', 'frame_repair_plan_hash', 'frame_repair_artifact_manifest_sha256',
    'project_revision', 'project_projection_sha256', 'parent_revision_id', 'blind',
    'functional', 'hard_gates', 'successful_candidate', 'recorded_at',
  ])
  const planned = planCase(plan, review.case_id)
  const blind = exactRecord(review.blind, ['choice', 'a', 'b', 'preferred_version'])
  const functional = exactRecord(review.functional, [
    'improvement', 'usability', 'new_blocking_defect', 'reason_codes', 'note',
  ])
  const hardGates = exactRecord(review.hard_gates, ['status', 'reasons', 'facts'])
  if (review.protocol !== 'frame_repair_quality_gate_review_v1' ||
      review.session_id !== plan.session_id || review.session_plan_hash !== plan.session_plan_hash ||
      review.case_hash !== planned.case_hash || review.operation_id !== planned.operation_id ||
      !JOB_ID_PATTERN.test(review.job_id) || !isSha256(review.frame_repair_plan_hash) ||
      !isSha256(review.frame_repair_artifact_manifest_sha256) || !positiveInteger(review.project_revision) ||
      !isSha256(review.project_projection_sha256) || review.parent_revision_id !== planned.parent_revision_id ||
      !['prefer_a', 'prefer_b', 'no_material_difference'].includes(blind.choice) ||
      !((blind.a === 'before' && blind.b === 'after') || (blind.a === 'after' && blind.b === 'before')) ||
      (blind.choice === 'prefer_a' && blind.preferred_version !== blind.a) ||
      (blind.choice === 'prefer_b' && blind.preferred_version !== blind.b) ||
      (blind.choice === 'no_material_difference' && blind.preferred_version !== null) ||
      !['improved', 'same', 'worse'].includes(functional.improvement) ||
      !['usable', 'review_required', 'blocked'].includes(functional.usability) ||
      typeof functional.new_blocking_defect !== 'boolean' ||
      typeof review.successful_candidate !== 'boolean' || !ISO_TIMESTAMP_PATTERN.test(review.recorded_at) ||
      !['pass', 'warning', 'blocked'].includes(hardGates.status)) fail()
  safeCodes(functional.reason_codes, 16)
  safeText(functional.note, { nullable: true })
  safeCodes(hardGates.reasons)
  validateHardGateFacts(hardGates.facts)
  const projectedHardGates = projectFrameRepairQualityGateHardGates({
    identityComplete: hardGates.facts.identity_complete,
    manifestVerified: hardGates.facts.manifest_verified,
    outsideMaskEqual: hardGates.facts.outside_mask_equal,
    outsideMaskChangedPixels: hardGates.facts.outside_mask_changed_pixels,
    candidateAvailable: hardGates.facts.candidate_available,
    compositedFrameAvailable: hardGates.facts.composited_frame_available,
    qualityEvidenceComplete: hardGates.facts.quality_evidence_complete,
    validatorStatus: hardGates.facts.validator_status,
    validatorBlockingErrors: hardGates.facts.validator_blocking_errors,
    continuityComplete: hardGates.facts.continuity_complete,
    revisionChainValid: hardGates.facts.revision_chain_valid,
    unrelatedProjectMutation: hardGates.facts.unrelated_project_mutation,
    providerCalls: hardGates.facts.provider_calls,
    warnings: hardGates.facts.warnings,
  })
  const expectedSuccessful = projectedHardGates.status !== 'blocked' &&
    functional.improvement === 'improved' &&
    ['usable', 'review_required'].includes(functional.usability) &&
    functional.new_blocking_defect === false
  if (!serializeFrameRepairQualityGateValue(projectedHardGates)
    .equals(serializeFrameRepairQualityGateValue(hardGates)) ||
      review.successful_candidate !== expectedSuccessful) fail()
  return review
}

function validateOutcome(value, plan) {
  const outcome = exactRecord(value, [
    'protocol', 'session_id', 'session_plan_hash', 'case_id', 'case_hash', 'operation_id',
    'job_id', 'review_sha256', 'outcome', 'provider_calls', 'controlled_reason',
    'project_before_revision', 'project_after_revision', 'accepted_revision_id',
    'project_before_projection_sha256', 'project_after_projection_sha256', 'recorded_at',
  ])
  const planned = planCase(plan, outcome.case_id)
  if (outcome.protocol !== 'frame_repair_quality_gate_outcome_v1' ||
      outcome.session_id !== plan.session_id || outcome.session_plan_hash !== plan.session_plan_hash ||
      outcome.case_hash !== planned.case_hash || outcome.operation_id !== planned.operation_id ||
      !['accepted', 'rejected', 'provider_blocked', 'quality_blocked'].includes(outcome.outcome) ||
      (outcome.job_id !== null && !JOB_ID_PATTERN.test(outcome.job_id)) ||
      (outcome.review_sha256 !== null && !isSha256(outcome.review_sha256)) ||
      !nonNegativeInteger(outcome.provider_calls) ||
      (outcome.controlled_reason !== null &&
        (typeof outcome.controlled_reason !== 'string' || !SAFE_CODE_PATTERN.test(outcome.controlled_reason))) ||
      !positiveInteger(outcome.project_before_revision) || !positiveInteger(outcome.project_after_revision) ||
      (outcome.accepted_revision_id !== null && !isLowerId(outcome.accepted_revision_id)) ||
      !isSha256(outcome.project_before_projection_sha256) ||
      !isSha256(outcome.project_after_projection_sha256) || !ISO_TIMESTAMP_PATTERN.test(outcome.recorded_at)) fail()
  return outcome
}

function validateBreakdownRows(value, allowedKeys) {
  const rows = denseArray(value, allowedKeys.size)
  let previous = null
  for (const entry of rows) {
    const row = exactRecord(entry, ['key', 'planned', 'completed', 'successful'])
    if (!allowedKeys.has(row.key) || (previous !== null && previous >= row.key) ||
        !positiveInteger(row.planned) || !nonNegativeInteger(row.completed) ||
        !nonNegativeInteger(row.successful) || row.completed > row.planned ||
        row.successful > row.completed) fail()
    previous = row.key
  }
  return rows
}

function validateTaxonomyRows(value) {
  const rows = denseArray(value, null, 64)
  let previous = null
  for (const entry of rows) {
    const row = exactRecord(entry, ['code', 'count'])
    if (!SAFE_CODE_PATTERN.test(row.code) || !positiveInteger(row.count) ||
        (previous !== null && previous >= row.code)) fail()
    previous = row.code
  }
  return rows
}

function validateDecision(value) {
  const decision = exactRecord(value, [
    'result', 'failure_domain', 'total_planned', 'completed_candidates',
    'successful_candidates', 'required_successes', 'improvement_rate', 'calls_used',
    'calls_remaining', 'accepted', 'rejected', 'provider_blocked', 'unresolved',
  ])
  if (!['passed', 'quality_failed', 'evidence_insufficient'].includes(decision.result) ||
      ![null, 'safety', 'visual_quality'].includes(decision.failure_domain) ||
      decision.total_planned !== 8 || !nonNegativeInteger(decision.completed_candidates) ||
      !nonNegativeInteger(decision.successful_candidates) ||
      !nonNegativeInteger(decision.required_successes) ||
      typeof decision.improvement_rate !== 'number' || !Number.isFinite(decision.improvement_rate) ||
      decision.improvement_rate < 0 || decision.improvement_rate > 1 ||
      !nonNegativeInteger(decision.calls_used) || !nonNegativeInteger(decision.calls_remaining) ||
      !nonNegativeInteger(decision.accepted) || !nonNegativeInteger(decision.rejected) ||
      !nonNegativeInteger(decision.provider_blocked) || !nonNegativeInteger(decision.unresolved)) fail()
  return decision
}

function validateReport(value, plan) {
  const report = exactRecord(value, [
    'protocol', 'session_id', 'session_plan_hash', 'provider', 'decision',
    'breakdown', 'taxonomy',
  ])
  const provider = exactRecord(report.provider, ['preset_id', 'image_size'])
  const breakdown = exactRecord(report.breakdown, ['difficulty', 'category'])
  const taxonomy = exactRecord(report.taxonomy, [
    'hard_gate_statuses', 'hard_gate_reasons', 'controlled_provider_reasons',
  ])
  if (report.protocol !== 'frame_repair_quality_gate_report_v1' ||
      report.session_id !== plan.session_id || report.session_plan_hash !== plan.session_plan_hash ||
      provider.preset_id !== plan.provider.preset_id || provider.image_size !== plan.provider.image_size) fail()
  validateDecision(report.decision)
  validateBreakdownRows(breakdown.difficulty, new Set(['basic', 'hard', 'medium']))
  validateBreakdownRows(
    breakdown.category,
    new Set(plan.cases.map((item) => item.classification.defect_category)),
  )
  validateTaxonomyRows(taxonomy.hard_gate_statuses)
  validateTaxonomyRows(taxonomy.hard_gate_reasons)
  validateTaxonomyRows(taxonomy.controlled_provider_reasons)
  return report
}

function validateArtifactManifest(value, plan, expectedFiles) {
  const manifest = exactRecord(value, ['protocol', 'session_id', 'session_plan_hash', 'files'])
  if (manifest.protocol !== 'frame_repair_quality_gate_artifact_manifest_v1' ||
      manifest.session_id !== plan.session_id || manifest.session_plan_hash !== plan.session_plan_hash) fail()
  const files = denseArray(manifest.files, expectedFiles.length)
  files.forEach((entry, index) => {
    const item = exactRecord(entry, ['file_name', 'size', 'sha256'])
    const expected = expectedFiles[index]
    if (item.file_name !== expected.file_name || item.size !== expected.size ||
        item.sha256 !== expected.sha256 || !positiveInteger(item.size) || !isSha256(item.sha256) ||
        item.file_name === 'artifact_manifest.json' || item.file_name.includes('/') ||
        item.file_name.includes('\\')) fail()
  })
  return manifest
}

function captureJson(value, limit, validator) {
  let bytes
  try {
    bytes = serializeFrameRepairQualityGateValue(value)
  } catch (error) {
    throw asEvidenceError(error)
  }
  if (bytes.length < 2 || bytes.length > limit) fail()
  let document
  try {
    document = JSON.parse(bytes.toString('utf8'))
    validator(document)
  } catch (error) {
    throw asEvidenceError(error)
  }
  return Object.freeze({ bytes: Buffer.from(bytes), document: cloneFrozen(document), sha256: rawSha256(bytes) })
}

async function rootAuthority(generatedDir) {
  const resolvedPath = requireGeneratedDir(generatedDir)
  let stats
  let realPath
  let realStats
  let after
  try {
    stats = await lstat(resolvedPath)
    realPath = await realpath(resolvedPath)
    ;[realStats, after] = await Promise.all([lstat(realPath), lstat(resolvedPath)])
  } catch (error) {
    throw asEvidenceError(error, 'unsafe_artifact_path')
  }
  if (stats.isSymbolicLink() || !stats.isDirectory() || realStats.isSymbolicLink() ||
      !realStats.isDirectory() || after.isSymbolicLink() || !after.isDirectory() ||
      !sameFileIdentity(stats, realStats) || !sameFileIdentity(stats, after)) {
    fail('unsafe_artifact_path', 'quality gate generated root is unsafe')
  }
  return Object.freeze({ resolvedPath, realPath, dev: after.dev, ino: after.ino })
}

function contained(parent, candidate) {
  const relative = path.relative(parent, candidate)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

async function ensureDirectory(root, segments) {
  let current = root.resolvedPath
  for (const segment of segments) {
    current = path.join(current, segment)
    let stats
    let realCurrent
    let realStats
    let after
    try {
      await mkdir(current)
    } catch (error) {
      if (error?.code !== 'EEXIST') throw asEvidenceError(error, 'unsafe_artifact_path')
    }
    try {
      stats = await lstat(current)
      realCurrent = await realpath(current)
      ;[realStats, after] = await Promise.all([lstat(realCurrent), lstat(current)])
    } catch (error) {
      throw asEvidenceError(error, 'unsafe_artifact_path')
    }
    if (stats.isSymbolicLink() || !stats.isDirectory() || realStats.isSymbolicLink() ||
        !realStats.isDirectory() || after.isSymbolicLink() || !after.isDirectory() ||
        !sameFileIdentity(stats, realStats) || !sameFileIdentity(stats, after)) {
      fail('unsafe_artifact_path', 'quality gate evidence directory is unsafe')
    }
    if (!contained(root.realPath, realCurrent)) {
      fail('unsafe_artifact_path', 'quality gate evidence directory escapes its root')
    }
  }
  return current
}

async function safeFileState(filePath) {
  try {
    const stats = await lstat(filePath)
    if (stats.isSymbolicLink() || !stats.isFile()) {
      fail('unsafe_artifact_path', 'quality gate evidence file is unsafe')
    }
    return stats
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw asEvidenceError(error, 'unsafe_artifact_path')
  }
}

function sameFileIdentity(left, right) {
  return Boolean(left && right) && left.dev === right.dev && left.ino === right.ino
}

function sameFileSnapshot(left, right) {
  return sameFileIdentity(left, right) && left.size === right.size &&
    left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs
}

async function readNoFollowSnapshot(filePath, limit, missingCode) {
  let lexical
  let handle
  try {
    lexical = await lstat(filePath, { bigint: true })
  } catch (error) {
    if (error?.code === 'ENOENT') fail(missingCode, 'quality gate evidence was not found')
    throw asEvidenceError(error, 'unsafe_artifact_path')
  }
  if (lexical.isSymbolicLink() || !lexical.isFile()) {
    fail('unsafe_artifact_path', 'quality gate evidence file is unsafe')
  }
  if (lexical.size < 1n || lexical.size > BigInt(limit) ||
      !Number.isInteger(fsConstants.O_NOFOLLOW)) fail('invalid_quality_gate_evidence')
  try {
    handle = await open(filePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW)
    const opened = await handle.stat({ bigint: true })
    if (!opened.isFile() || !sameFileSnapshot(lexical, opened)) {
      fail('evidence_integrity_failed', 'quality gate evidence changed during read')
    }
    const bytes = await handle.readFile()
    const [afterHandle, afterLexical] = await Promise.all([
      handle.stat({ bigint: true }),
      lstat(filePath, { bigint: true }),
    ])
    if (afterLexical.isSymbolicLink() || !afterLexical.isFile() ||
        !sameFileSnapshot(opened, afterHandle) || !sameFileSnapshot(opened, afterLexical) ||
        BigInt(bytes.length) !== opened.size) {
      fail('evidence_integrity_failed', 'quality gate evidence changed during read')
    }
    return bytes
  } catch (error) {
    if (error instanceof FrameRepairQualityGateError) throw error
    throw asEvidenceError(error, 'unsafe_artifact_path')
  } finally {
    if (handle) await handle.close().catch(() => {})
  }
}

async function readExactHandleBytes(handle, size) {
  const bytes = Buffer.alloc(size)
  let offset = 0
  while (offset < size) {
    const { bytesRead } = await handle.read(bytes, offset, size - offset, offset)
    if (bytesRead < 1) fail('evidence_integrity_failed', 'quality gate evidence read ended early')
    offset += bytesRead
  }
  const trailing = Buffer.alloc(1)
  const { bytesRead } = await handle.read(trailing, 0, 1, size)
  if (bytesRead !== 0) fail('evidence_integrity_failed', 'quality gate evidence exceeded its size')
  return bytes
}

async function verifyWrittenHandle(handle, filePath, expectedBytes) {
  const [handleStats, lexicalStats] = await Promise.all([
    handle.stat({ bigint: true }),
    lstat(filePath, { bigint: true }),
  ])
  if (!handleStats.isFile() || lexicalStats.isSymbolicLink() || !lexicalStats.isFile() ||
      !sameFileSnapshot(handleStats, lexicalStats) ||
      handleStats.size !== BigInt(expectedBytes.length)) {
    fail('evidence_integrity_failed', 'quality gate evidence changed during write')
  }
  const verified = await readExactHandleBytes(handle, expectedBytes.length)
  const after = await handle.stat({ bigint: true })
  if (!sameFileSnapshot(handleStats, after) || !verified.equals(expectedBytes)) {
    fail('evidence_integrity_failed', 'quality gate evidence write verification failed')
  }
}

async function readExactCanonicalFile(filePath, limit, validator, missingCode) {
  const bytes = await readNoFollowSnapshot(filePath, limit, missingCode)
  if (bytes.length < 2) fail('invalid_quality_gate_evidence')
  let document
  try {
    document = JSON.parse(bytes.toString('utf8'))
    validator(document)
    if (!serializeFrameRepairQualityGateValue(document).equals(bytes)) fail()
  } catch (error) {
    throw asEvidenceError(error)
  }
  return Object.freeze({ bytes, document: cloneFrozen(document), sha256: rawSha256(bytes) })
}

function semanticRecord(record) {
  const projected = { ...record }
  delete projected.recorded_at
  return projected
}

async function writeCapturedExclusive({ filePath, captured, limit, validator, equivalent = null }) {
  if (!Number.isInteger(fsConstants.O_NOFOLLOW)) fail('unsafe_artifact_path')
  let handle
  try {
    handle = await open(
      filePath,
      fsConstants.O_RDWR | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
      0o600,
    )
  } catch (error) {
    if (error?.code !== 'EEXIST') throw asEvidenceError(error)
    const existingStats = await safeFileState(filePath)
    if (!existingStats || existingStats.size < 2 || existingStats.size > limit) {
      fail('evidence_conflict', 'quality gate evidence conflicts with persisted bytes')
    }
    let existing
    try {
      existing = await readExactCanonicalFile(filePath, limit, validator, 'invalid_quality_gate_evidence')
    } catch {
      fail('evidence_conflict', 'quality gate evidence conflicts with persisted bytes')
    }
    const same = existing.bytes.equals(captured.bytes) ||
      (equivalent && equivalent(existing.document, captured.document))
    if (!same) fail('evidence_conflict', 'quality gate evidence conflicts with persisted bytes')
    return existing
  }

  try {
    await handle.writeFile(captured.bytes)
    await handle.sync()
    await verifyWrittenHandle(handle, filePath, captured.bytes)
  } finally {
    await handle.close()
  }
  const persisted = await readExactCanonicalFile(filePath, limit, validator, 'invalid_quality_gate_evidence')
  if (persisted.bytes.length !== captured.bytes.length || persisted.sha256 !== captured.sha256 ||
      !persisted.bytes.equals(captured.bytes)) fail('invalid_quality_gate_evidence')
  return persisted
}

async function readExactBytesFile(filePath, limit, validateBytes, missingCode) {
  const bytes = await readNoFollowSnapshot(filePath, limit, missingCode)
  try {
    await validateBytes(bytes)
  } catch (error) {
    throw asEvidenceError(error)
  }
  return Object.freeze({ bytes, sha256: rawSha256(bytes) })
}

async function writeBytesExclusive({ filePath, bytes, limit, validateBytes }) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > limit) fail()
  if (!Number.isInteger(fsConstants.O_NOFOLLOW)) fail('unsafe_artifact_path')
  await validateBytes(bytes)
  const captured = Buffer.from(bytes)
  const capturedSha256 = rawSha256(captured)
  let handle
  try {
    handle = await open(
      filePath,
      fsConstants.O_RDWR | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
      0o600,
    )
  } catch (error) {
    if (error?.code !== 'EEXIST') throw asEvidenceError(error)
    let existing
    try {
      existing = await readExactBytesFile(
        filePath,
        limit,
        validateBytes,
        'invalid_quality_gate_evidence',
      )
    } catch {
      fail('evidence_conflict', 'quality gate evidence conflicts with persisted bytes')
    }
    if (!existing.bytes.equals(captured)) {
      fail('evidence_conflict', 'quality gate evidence conflicts with persisted bytes')
    }
    return existing
  }
  try {
    await handle.writeFile(captured)
    await handle.sync()
    await verifyWrittenHandle(handle, filePath, captured)
  } finally {
    await handle.close()
  }
  const persisted = await readExactBytesFile(
    filePath,
    limit,
    validateBytes,
    'invalid_quality_gate_evidence',
  )
  if (persisted.sha256 !== capturedSha256 || !persisted.bytes.equals(captured)) fail()
  return persisted
}

function sortStrings(values) {
  return [...values].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
}

function countCodes(values) {
  const counts = new Map()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return sortStrings(counts.keys()).map((code) => ({ code, count: counts.get(code) }))
}

function buildBreakdownRows(plan, reviews, field) {
  const reviewByCaseId = new Map(reviews.map((item) => [item.case_id, item]))
  const keys = sortStrings(new Set(plan.cases.map((item) => item.classification[field])))
  return keys.map((key) => {
    const plannedCases = plan.cases.filter((item) => item.classification[field] === key)
    const completed = plannedCases
      .map((item) => reviewByCaseId.get(item.case_id))
      .filter(Boolean)
    return {
      key,
      planned: plannedCases.length,
      completed: completed.length,
      successful: completed.filter((item) => item.successful_candidate).length,
    }
  })
}

function buildFinalReport(plan, reviews, outcomes) {
  const decision = computeFrameRepairQualityGateDecision({
    plan,
    reviews: reviews.map((item) => ({
      case_id: item.case_id,
      functional: {
        improvement: item.functional.improvement,
        usability: item.functional.usability,
        new_blocking_defect: item.functional.new_blocking_defect,
      },
    })),
    outcomes: outcomes.map((item) => ({
      case_id: item.case_id,
      outcome: item.outcome,
      provider_calls: item.provider_calls,
      controlled_reason: item.controlled_reason,
    })),
    hardGates: reviews.map((item) => ({
      case_id: item.case_id,
      status: item.hard_gates.status,
      reasons: item.hard_gates.reasons,
      facts: item.hard_gates.facts,
    })),
  })
  return {
    protocol: 'frame_repair_quality_gate_report_v1',
    session_id: plan.session_id,
    session_plan_hash: plan.session_plan_hash,
    provider: { preset_id: plan.provider.preset_id, image_size: plan.provider.image_size },
    decision,
    breakdown: {
      difficulty: buildBreakdownRows(plan, reviews, 'difficulty'),
      category: buildBreakdownRows(plan, reviews, 'defect_category'),
    },
    taxonomy: {
      hard_gate_statuses: countCodes(reviews.map((item) => item.hard_gates.status)),
      hard_gate_reasons: countCodes(reviews.flatMap((item) => item.hard_gates.reasons)),
      controlled_provider_reasons: countCodes(outcomes
        .map((item) => item.controlled_reason)
        .filter((value) => value !== null)),
    },
  }
}

function markdownTable(rows) {
  return [
    '| Key | Planned | Completed | Successful |',
    '| --- | ---: | ---: | ---: |',
    ...rows.map((item) => `| ${item.key} | ${item.planned} | ${item.completed} | ${item.successful} |`),
  ].join('\n')
}

function taxonomyMarkdown(rows) {
  return rows.length === 0
    ? 'none'
    : rows.map((item) => `${item.code}:${item.count}`).join(', ')
}

function buildFinalMarkdown(report) {
  const { decision } = report
  return Buffer.from([
    '# Frame Repair Quality Gate',
    '',
    `- Result: ${decision.result}`,
    `- Failure domain: ${decision.failure_domain ?? 'none'}`,
    `- Improvement: ${decision.successful_candidates}/${decision.completed_candidates}`,
    `- Required successes: ${decision.required_successes}`,
    `- Improvement rate: ${decision.improvement_rate}`,
    `- Calls: ${decision.calls_used}/${decision.calls_used + decision.calls_remaining}`,
    `- Accepted: ${decision.accepted}`,
    `- Rejected: ${decision.rejected}`,
    `- Provider blocked: ${decision.provider_blocked}`,
    `- Unresolved: ${decision.unresolved}`,
    `- Provider preset: ${report.provider.preset_id}`,
    `- Image size: ${report.provider.image_size}`,
    `- Session plan hash: ${report.session_plan_hash}`,
    '',
    '## Difficulty breakdown',
    '',
    markdownTable(report.breakdown.difficulty),
    '',
    '## Category breakdown',
    '',
    markdownTable(report.breakdown.category),
    '',
    '## Controlled taxonomy',
    '',
    `- Hard gate statuses: ${taxonomyMarkdown(report.taxonomy.hard_gate_statuses)}`,
    `- Hard gate reasons: ${taxonomyMarkdown(report.taxonomy.hard_gate_reasons)}`,
    `- Controlled provider reasons: ${taxonomyMarkdown(report.taxonomy.controlled_provider_reasons)}`,
    '',
  ].join('\n'), 'utf8')
}

function validateMarkdownBytes(bytes) {
  let text
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    fail()
  }
  if (!text.startsWith('# Frame Repair Quality Gate\n') || CONTROL_CHARACTER_PATTERN.test(
    text.replaceAll('\n', '').replaceAll('\t', ''),
  )) fail()
}

function caseIdsFromPlan(plan) {
  return plan.cases.map((item) => item.case_id)
}

function escapeSvgText(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

async function normalizeContactFrame(value) {
  if (!Buffer.isBuffer(value) || value.length < PNG_SIGNATURE.length ||
      value.length > CONTACT_FRAME_INPUT_LIMIT ||
      !value.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) fail()
  let metadata
  try {
    metadata = await sharp(value, {
      failOn: 'error',
      limitInputPixels: 96 * 96,
      sequentialRead: true,
    }).metadata()
  } catch (error) {
    throw asEvidenceError(error)
  }
  if (metadata.format !== 'png' || metadata.width !== 96 || metadata.height !== 96 ||
      (metadata.pages ?? 1) !== 1) fail()
  try {
    return await sharp(value, {
      failOn: 'error',
      limitInputPixels: 96 * 96,
      sequentialRead: true,
    })
      .ensureAlpha()
      .resize(160, 160, { kernel: sharp.kernel.nearest, fit: 'fill' })
      .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
      .toBuffer()
  } catch (error) {
    throw asEvidenceError(error)
  }
}

async function validateContactSheetBytes(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < PNG_SIGNATURE.length ||
      !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) fail()
  let metadata
  try {
    metadata = await sharp(bytes, {
      failOn: 'error',
      limitInputPixels: CONTACT_SHEET_WIDTH * CONTACT_SHEET_HEIGHT,
      sequentialRead: true,
    }).metadata()
  } catch (error) {
    throw asEvidenceError(error)
  }
  if (metadata.format !== 'png' || metadata.width !== CONTACT_SHEET_WIDTH ||
      metadata.height !== CONTACT_SHEET_HEIGHT || (metadata.pages ?? 1) !== 1) fail()
}

function contactCellOverlay({ caseId, status, hasFrames }) {
  const safeCaseId = escapeSvgText(caseId.slice(0, 48))
  const safeStatus = escapeSvgText(status.slice(0, 48))
  const neutral = hasFrames
    ? ''
    : '<rect x="16" y="54" width="352" height="160" rx="8" fill="#253047"/>' +
      '<path d="M32 198 L176 70 M208 198 L352 70" stroke="#3d4962" stroke-width="10"/>' +
      '<text x="192" y="142" text-anchor="middle" fill="#a9b4c8" font-size="14">NO CANDIDATE</text>'
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CONTACT_CELL_WIDTH}" height="${CONTACT_CELL_HEIGHT}">` +
      '<rect x="0.5" y="0.5" width="383" height="255" fill="#111827" stroke="#465168"/>' +
      '<rect x="1" y="1" width="382" height="39" fill="#1d2739"/>' +
      `<text x="14" y="25" fill="#f4f7fb" font-family="monospace" font-size="13">${safeCaseId}</text>` +
      `<text x="370" y="25" text-anchor="end" fill="#8fd3a6" font-family="monospace" font-size="12">${safeStatus}</text>` +
      neutral +
      (hasFrames
        ? '<text x="96" y="238" text-anchor="middle" fill="#a9b4c8" font-size="12">BEFORE</text>' +
          '<text x="288" y="238" text-anchor="middle" fill="#a9b4c8" font-size="12">AFTER</text>'
        : '') +
      '</svg>',
    'utf8',
  )
}

async function buildContactSheet(plan, reviews, outcomes, frames) {
  const supplied = denseArray(frames, null, 8)
  const reviewIds = new Set(reviews.map((item) => item.case_id))
  const frameMap = new Map()
  for (const entry of supplied) {
    const frame = exactRecord(entry, ['case_id', 'before_png', 'after_png'])
    if (!reviewIds.has(frame.case_id) || frameMap.has(frame.case_id)) fail()
    frameMap.set(frame.case_id, {
      before: await normalizeContactFrame(frame.before_png),
      after: await normalizeContactFrame(frame.after_png),
    })
  }
  if (frameMap.size !== reviewIds.size || [...reviewIds].some((caseId) => !frameMap.has(caseId))) fail()
  const outcomeByCaseId = new Map(outcomes.map((item) => [item.case_id, item]))
  const composites = []
  for (const item of plan.cases) {
    const column = item.display_index % 4
    const row = Math.floor(item.display_index / 4)
    const left = column * CONTACT_CELL_WIDTH
    const top = row * CONTACT_CELL_HEIGHT
    const pair = frameMap.get(item.case_id)
    const status = outcomeByCaseId.get(item.case_id)?.outcome ?? 'unresolved'
    composites.push({
      input: contactCellOverlay({ caseId: item.case_id, status, hasFrames: Boolean(pair) }),
      left,
      top,
    })
    if (pair) {
      composites.push({ input: pair.before, left: left + 16, top: top + 54 })
      composites.push({ input: pair.after, left: left + 208, top: top + 54 })
    }
  }
  let bytes
  try {
    bytes = await sharp({
      create: {
        width: CONTACT_SHEET_WIDTH,
        height: CONTACT_SHEET_HEIGHT,
        channels: 4,
        background: { r: 17, g: 24, b: 39, alpha: 1 },
      },
    })
      .composite(composites)
      .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
      .toBuffer()
  } catch (error) {
    throw asEvidenceError(error)
  }
  if (bytes.length > QUALITY_GATE_EVIDENCE_LIMITS.contactSheetPng) fail()
  await validateContactSheetBytes(bytes)
  return bytes
}

function evidenceFileEntry(fileName, persisted) {
  return Object.freeze({
    file_name: fileName,
    size: persisted.bytes.length,
    sha256: persisted.sha256,
  })
}

export function resolveFrameRepairQualityGateSetupPaths({ generatedDir, targetProjectId } = {}) {
  const root = requireGeneratedDir(generatedDir)
  const projectId = requireProjectId(targetProjectId)
  const setupDir = path.join(root, 'frame-repair-quality-gates', `setup_${projectId}`)
  return Object.freeze({
    generatedDir: root,
    setupDir,
    setupManifest: path.join(setupDir, 'setup_manifest.json'),
  })
}

export function resolveFrameRepairQualityGateSessionPaths({ generatedDir, sessionId, caseIds } = {}) {
  const root = requireGeneratedDir(generatedDir)
  const safeSessionId = requireSessionId(sessionId)
  const ids = denseArray(caseIds, 8).map(requireCaseId)
  if (new Set(ids).size !== ids.length) fail('unsafe_artifact_path', 'quality gate case ids are unsafe')
  const sessionDir = path.join(root, 'frame-repair-quality-gates', safeSessionId)
  const reviewFiles = Object.fromEntries(ids.map((caseId) => [
    caseId, path.join(sessionDir, `case_${caseId}_review.json`),
  ]))
  const outcomeFiles = Object.fromEntries(ids.map((caseId) => [
    caseId, path.join(sessionDir, `case_${caseId}_outcome.json`),
  ]))
  return Object.freeze({
    generatedDir: root,
    sessionDir,
    sessionPlan: path.join(sessionDir, 'session_plan.json'),
    blindOrder: path.join(sessionDir, 'blind_order.json'),
    reviewFiles: Object.freeze(reviewFiles),
    outcomeFiles: Object.freeze(outcomeFiles),
    reportJson: path.join(sessionDir, 'frame_repair_quality_gate.json'),
    reportMarkdown: path.join(sessionDir, 'frame_repair_quality_gate.md'),
    contactSheet: path.join(sessionDir, 'frame_repair_quality_gate_contact_sheet.png'),
    artifactManifest: path.join(sessionDir, 'artifact_manifest.json'),
  })
}

export async function withFrameRepairQualityGateSessionLock(
  { generatedDir, sessionId } = {},
  task,
) {
  if (typeof task !== 'function') fail()
  const safeSessionId = requireSessionId(sessionId)
  const resolvedRoot = requireGeneratedDir(generatedDir)
  const key = `${resolvedRoot}\0${safeSessionId}`
  const previous = sessionMutationTails.get(key) ?? Promise.resolve()
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const tail = previous.then(() => gate)
  sessionMutationTails.set(key, tail)
  await previous
  try {
    await rootAuthority(resolvedRoot)
    return await task()
  } finally {
    release()
    if (sessionMutationTails.get(key) === tail) sessionMutationTails.delete(key)
  }
}

export async function writeFrameRepairQualityGateSetupManifest({
  generatedDir,
  targetProjectId,
  manifest,
} = {}) {
  const projectId = requireProjectId(targetProjectId)
  const captured = captureJson(manifest, QUALITY_GATE_EVIDENCE_LIMITS.setupManifest, validateSetupManifest)
  if (captured.document.target_project.id !== projectId) fail()
  const root = await rootAuthority(generatedDir)
  await ensureDirectory(root, ['frame-repair-quality-gates', `setup_${projectId}`])
  const paths = resolveFrameRepairQualityGateSetupPaths({ generatedDir, targetProjectId: projectId })
  const persisted = await writeCapturedExclusive({
    filePath: paths.setupManifest,
    captured,
    limit: QUALITY_GATE_EVIDENCE_LIMITS.setupManifest,
    validator: validateSetupManifest,
  })
  return Object.freeze({ sha256: persisted.sha256, manifest: persisted.document })
}

export async function readFrameRepairQualityGateSetupManifest({ generatedDir, targetProjectId } = {}) {
  const root = await rootAuthority(generatedDir)
  const projectId = requireProjectId(targetProjectId)
  await ensureDirectory(root, ['frame-repair-quality-gates', `setup_${projectId}`])
  const paths = resolveFrameRepairQualityGateSetupPaths({ generatedDir, targetProjectId: projectId })
  const persisted = await readExactCanonicalFile(
    paths.setupManifest,
    QUALITY_GATE_EVIDENCE_LIMITS.setupManifest,
    validateSetupManifest,
    'setup_manifest_not_found',
  )
  if (persisted.document.target_project.id !== projectId) fail()
  return persisted.document
}

export async function startFrameRepairQualityGateEvidence({ generatedDir, plan, blindOrder } = {}) {
  const capturedPlan = captureJson(plan, QUALITY_GATE_EVIDENCE_LIMITS.sessionPlan, validatePlan)
  const capturedOrderInput = captureJson(
    blindOrder,
    QUALITY_GATE_EVIDENCE_LIMITS.blindOrder,
    (value) => validateBlindOrder(value, capturedPlan.document),
  )
  const storedOrder = {
    protocol: 'frame_repair_quality_gate_blind_order_v1',
    session_id: capturedPlan.document.session_id,
    session_plan_hash: capturedPlan.document.session_plan_hash,
    cases: capturedOrderInput.document.cases,
  }
  const capturedStoredOrder = captureJson(
    storedOrder,
    QUALITY_GATE_EVIDENCE_LIMITS.blindOrder,
    (value) => validateStoredBlindOrder(value, capturedPlan.document),
  )
  return withFrameRepairQualityGateSessionLock(
    { generatedDir, sessionId: capturedPlan.document.session_id },
    async () => {
      const root = await rootAuthority(generatedDir)
      await ensureDirectory(root, ['frame-repair-quality-gates', capturedPlan.document.session_id])
      const paths = resolveFrameRepairQualityGateSessionPaths({
        generatedDir,
        sessionId: capturedPlan.document.session_id,
        caseIds: caseIdsFromPlan(capturedPlan.document),
      })
      const persistedPlan = await writeCapturedExclusive({
        filePath: paths.sessionPlan,
        captured: capturedPlan,
        limit: QUALITY_GATE_EVIDENCE_LIMITS.sessionPlan,
        validator: validatePlan,
      })
      const persistedOrder = await writeCapturedExclusive({
        filePath: paths.blindOrder,
        captured: capturedStoredOrder,
        limit: QUALITY_GATE_EVIDENCE_LIMITS.blindOrder,
        validator: (value) => validateStoredBlindOrder(value, persistedPlan.document),
      })
      return Object.freeze({
        plan_sha256: persistedPlan.sha256,
        blind_order_sha256: persistedOrder.sha256,
      })
    },
  )
}

async function readSessionPlan(generatedDir, sessionId) {
  const root = await rootAuthority(generatedDir)
  const safeSessionId = requireSessionId(sessionId)
  await ensureDirectory(root, ['frame-repair-quality-gates', safeSessionId])
  const planPath = path.join(
    root.resolvedPath,
    'frame-repair-quality-gates',
    safeSessionId,
    'session_plan.json',
  )
  const persisted = await readExactCanonicalFile(
    planPath,
    QUALITY_GATE_EVIDENCE_LIMITS.sessionPlan,
    validatePlan,
    'session_not_found',
  )
  if (persisted.document.session_id !== safeSessionId) fail()
  return persisted
}

async function optionalRecord(filePath, limit, validator) {
  if (!await safeFileState(filePath)) return null
  return readExactCanonicalFile(filePath, limit, validator, 'invalid_quality_gate_evidence')
}

export async function readFrameRepairQualityGateEvidence({ generatedDir, sessionId } = {}) {
  const persistedPlan = await readSessionPlan(generatedDir, sessionId)
  const plan = persistedPlan.document
  const paths = resolveFrameRepairQualityGateSessionPaths({
    generatedDir,
    sessionId: plan.session_id,
    caseIds: caseIdsFromPlan(plan),
  })
  const storedOrder = await readExactCanonicalFile(
    paths.blindOrder,
    QUALITY_GATE_EVIDENCE_LIMITS.blindOrder,
    (value) => validateStoredBlindOrder(value, plan),
    'session_not_found',
  )
  const reviews = []
  const outcomes = []
  for (const item of plan.cases) {
    const review = await optionalRecord(
      paths.reviewFiles[item.case_id],
      QUALITY_GATE_EVIDENCE_LIMITS.review,
      (value) => validateReview(value, plan),
    )
    const outcome = await optionalRecord(
      paths.outcomeFiles[item.case_id],
      QUALITY_GATE_EVIDENCE_LIMITS.outcome,
      (value) => validateOutcome(value, plan),
    )
    if (review) reviews.push(review.document)
    if (outcome) outcomes.push(outcome.document)
  }
  return deepFreeze({
    plan,
    blind_order: storedOrder.document,
    reviews,
    outcomes,
  })
}

async function finalizationStarted(paths) {
  try {
    await lstat(paths.reportJson)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw asEvidenceError(error, 'unsafe_artifact_path')
  }
}

async function writeCaseRecord({ generatedDir, plan, record, type }) {
  const capturedPlan = captureJson(plan, QUALITY_GATE_EVIDENCE_LIMITS.sessionPlan, validatePlan)
  const validator = type === 'review'
    ? (value) => validateReview(value, capturedPlan.document)
    : (value) => validateOutcome(value, capturedPlan.document)
  const limit = QUALITY_GATE_EVIDENCE_LIMITS[type]
  const captured = captureJson(record, limit, validator)
  return withFrameRepairQualityGateSessionLock(
    { generatedDir, sessionId: capturedPlan.document.session_id },
    async () => {
      const persistedPlan = await readSessionPlan(generatedDir, capturedPlan.document.session_id)
      if (!persistedPlan.bytes.equals(capturedPlan.bytes)) {
        fail('evidence_conflict', 'quality gate plan conflicts with persisted bytes')
      }
      const paths = resolveFrameRepairQualityGateSessionPaths({
        generatedDir,
        sessionId: capturedPlan.document.session_id,
        caseIds: caseIdsFromPlan(capturedPlan.document),
      })
      if (await finalizationStarted(paths)) {
        fail('quality_gate_finalized', 'quality gate finalization has started')
      }
      const filePath = type === 'review'
        ? paths.reviewFiles[captured.document.case_id]
        : paths.outcomeFiles[captured.document.case_id]
      const persisted = await writeCapturedExclusive({
        filePath,
        captured,
        limit,
        validator,
        equivalent: (left, right) => serializeFrameRepairQualityGateValue(semanticRecord(left))
          .equals(serializeFrameRepairQualityGateValue(semanticRecord(right))),
      })
      return Object.freeze({ sha256: persisted.sha256, [type]: persisted.document })
    },
  )
}

export function writeFrameRepairQualityGateReview({ generatedDir, plan, review } = {}) {
  return writeCaseRecord({ generatedDir, plan, record: review, type: 'review' })
}

export function writeFrameRepairQualityGateOutcome({ generatedDir, plan, outcome } = {}) {
  return writeCaseRecord({ generatedDir, plan, record: outcome, type: 'outcome' })
}

export async function finalizeFrameRepairQualityGateEvidence({ generatedDir, plan, frames } = {}) {
  const capturedPlan = captureJson(plan, QUALITY_GATE_EVIDENCE_LIMITS.sessionPlan, validatePlan)
  if (!Array.isArray(frames)) fail()
  return withFrameRepairQualityGateSessionLock(
    { generatedDir, sessionId: capturedPlan.document.session_id },
    async () => {
      const persistedPlan = await readSessionPlan(generatedDir, capturedPlan.document.session_id)
      if (!persistedPlan.bytes.equals(capturedPlan.bytes)) {
        fail('evidence_conflict', 'quality gate plan conflicts with persisted bytes')
      }
      const sealedPlan = persistedPlan.document
      const paths = resolveFrameRepairQualityGateSessionPaths({
        generatedDir,
        sessionId: sealedPlan.session_id,
        caseIds: caseIdsFromPlan(sealedPlan),
      })
      const persistedBlindOrder = await readExactCanonicalFile(
        paths.blindOrder,
        QUALITY_GATE_EVIDENCE_LIMITS.blindOrder,
        (value) => validateStoredBlindOrder(value, sealedPlan),
        'session_not_found',
      )
      const reviews = []
      const outcomes = []
      const evidenceEntries = [
        evidenceFileEntry('session_plan.json', persistedPlan),
        evidenceFileEntry('blind_order.json', persistedBlindOrder),
      ]
      for (const item of sealedPlan.cases) {
        const review = await optionalRecord(
          paths.reviewFiles[item.case_id],
          QUALITY_GATE_EVIDENCE_LIMITS.review,
          (value) => validateReview(value, sealedPlan),
        )
        const outcome = await optionalRecord(
          paths.outcomeFiles[item.case_id],
          QUALITY_GATE_EVIDENCE_LIMITS.outcome,
          (value) => validateOutcome(value, sealedPlan),
        )
        if (review) {
          reviews.push(review.document)
          evidenceEntries.push(evidenceFileEntry(`case_${item.case_id}_review.json`, review))
        }
        if (outcome) {
          outcomes.push(outcome.document)
          evidenceEntries.push(evidenceFileEntry(`case_${item.case_id}_outcome.json`, outcome))
        }
      }

      const report = buildFinalReport(sealedPlan, reviews, outcomes)
      const capturedReport = captureJson(
        report,
        QUALITY_GATE_EVIDENCE_LIMITS.reportJson,
        (value) => validateReport(value, sealedPlan),
      )
      const markdownBytes = buildFinalMarkdown(capturedReport.document)
      if (markdownBytes.length > QUALITY_GATE_EVIDENCE_LIMITS.reportMarkdown) fail()
      validateMarkdownBytes(markdownBytes)
      const contactSheetBytes = await buildContactSheet(
        sealedPlan,
        reviews,
        outcomes,
        frames,
      )

      const persistedReport = await writeCapturedExclusive({
        filePath: paths.reportJson,
        captured: capturedReport,
        limit: QUALITY_GATE_EVIDENCE_LIMITS.reportJson,
        validator: (value) => validateReport(value, sealedPlan),
      })
      const persistedMarkdown = await writeBytesExclusive({
        filePath: paths.reportMarkdown,
        bytes: markdownBytes,
        limit: QUALITY_GATE_EVIDENCE_LIMITS.reportMarkdown,
        validateBytes: validateMarkdownBytes,
      })
      const persistedContactSheet = await writeBytesExclusive({
        filePath: paths.contactSheet,
        bytes: contactSheetBytes,
        limit: QUALITY_GATE_EVIDENCE_LIMITS.contactSheetPng,
        validateBytes: validateContactSheetBytes,
      })
      evidenceEntries.push(
        evidenceFileEntry('frame_repair_quality_gate.json', persistedReport),
        evidenceFileEntry('frame_repair_quality_gate.md', persistedMarkdown),
        evidenceFileEntry('frame_repair_quality_gate_contact_sheet.png', persistedContactSheet),
      )
      const sortedEntries = [...evidenceEntries].sort((left, right) => (
        left.file_name < right.file_name ? -1 : left.file_name > right.file_name ? 1 : 0
      ))
      const manifest = {
        protocol: 'frame_repair_quality_gate_artifact_manifest_v1',
        session_id: sealedPlan.session_id,
        session_plan_hash: sealedPlan.session_plan_hash,
        files: sortedEntries,
      }
      const capturedManifest = captureJson(
        manifest,
        QUALITY_GATE_EVIDENCE_LIMITS.artifactManifest,
        (value) => validateArtifactManifest(value, sealedPlan, sortedEntries),
      )
      const persistedManifest = await writeCapturedExclusive({
        filePath: paths.artifactManifest,
        captured: capturedManifest,
        limit: QUALITY_GATE_EVIDENCE_LIMITS.artifactManifest,
        validator: (value) => validateArtifactManifest(value, sealedPlan, sortedEntries),
      })
      return deepFreeze({
        report_sha256: persistedReport.sha256,
        report_markdown_sha256: persistedMarkdown.sha256,
        contact_sheet_sha256: persistedContactSheet.sha256,
        artifact_manifest_sha256: persistedManifest.sha256,
        report: persistedReport.document,
        artifact_manifest: persistedManifest.document,
      })
    },
  )
}
