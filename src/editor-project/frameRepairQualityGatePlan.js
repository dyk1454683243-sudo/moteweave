import { createHash } from 'node:crypto'

import {
  FRAME_REPAIR_QUALITY_GATE_CONTROL_CASE_DEFAULTS,
  FrameRepairQualityGateError,
  assertQualityGatePlanRequest,
} from './frameRepairQualityGateProtocol.js'
import { validateEditorProject } from './validation.js'

const SHA256_PATTERN = /^[a-f0-9]{64}$/
const LOWER_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/
const SESSION_ID_PATTERN = /^frqg_[a-z0-9][a-z0-9_-]{15,79}$/
const CONTROL_CHARACTER_PATTERN = /\p{Cc}/u
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const CANONICAL_UTF8_LIMIT = 16_000_000
const CANONICAL_NODE_LIMIT = 200_000
const ARTIFACT_KEYS = Object.freeze([
  'sheet',
  'animations',
  'metadata',
  'editor_metadata',
  'debug_report',
])
const REQUESTED_CASE_KEYS = Object.freeze([
  'caseId',
  'assetId',
  'expectedAssetRevisionId',
  'clipId',
  'clipFramePosition',
  'sheetFrameIndex',
  'instruction',
  'maskEdits',
  'difficulty',
  'defectCategory',
  'expectedImprovement',
])
const CONTROL_IDENTITIES = new Map([
  ['control_outline_alpha', 'quality_gate_control_outline_alpha_v1'],
  ['control_small_component', 'quality_gate_control_small_component_v1'],
])
const DIFFICULTY_BY_CATEGORY = new Map([
  ['outline_alpha_edge', 'basic'],
  ['small_component', 'basic'],
  ['shape', 'medium'],
  ['detail', 'medium'],
  ['anchor_baseline', 'medium'],
  ['facing_consistency', 'medium'],
  ['semantic_reconstruction', 'hard'],
  ['neighbor_continuity', 'hard'],
])

function invalidPlan() {
  throw new FrameRepairQualityGateError(
    'invalid_quality_gate_plan',
    'quality gate plan is invalid',
  )
}

function providerUnavailable() {
  throw new FrameRepairQualityGateError(
    'provider_unavailable',
    'quality gate provider is unavailable',
  )
}

function isUnicodeScalarString(value) {
  for (let index = 0; index < value.length; index += 1) {
    const current = value.charCodeAt(index)
    if (current >= 0xd800 && current <= 0xdbff) {
      if (index + 1 >= value.length) return false
      const next = value.charCodeAt(index + 1)
      if (next < 0xdc00 || next > 0xdfff) return false
      index += 1
    } else if (current >= 0xdc00 && current <= 0xdfff) {
      return false
    }
  }
  return true
}

function addCanonicalBytes(state, byteCount) {
  if (!Number.isSafeInteger(byteCount) || byteCount < 0 ||
      state.bytes > CANONICAL_UTF8_LIMIT - byteCount) invalidPlan()
  state.bytes += byteCount
}

function addCanonicalNode(state) {
  state.nodes += 1
  if (!Number.isSafeInteger(state.nodes) || state.nodes > CANONICAL_NODE_LIMIT) invalidPlan()
}

function jsonStringUtf8Length(value) {
  if (value.length > 1_000_000) invalidPlan()
  let byteLength = 2
  for (let index = 0; index < value.length; index += 1) {
    const current = value.charCodeAt(index)
    if (current === 0x22 || current === 0x5c ||
        current === 0x08 || current === 0x09 || current === 0x0a ||
        current === 0x0c || current === 0x0d) {
      byteLength += 2
    } else if (current <= 0x1f) {
      byteLength += 6
    } else if (current <= 0x7f) {
      byteLength += 1
    } else if (current <= 0x7ff) {
      byteLength += 2
    } else if (current >= 0xd800 && current <= 0xdbff) {
      if (index + 1 >= value.length) invalidPlan()
      const next = value.charCodeAt(index + 1)
      if (next < 0xdc00 || next > 0xdfff) invalidPlan()
      byteLength += 4
      index += 1
    } else if (current >= 0xdc00 && current <= 0xdfff) {
      invalidPlan()
    } else {
      byteLength += 3
    }
  }
  return byteLength
}

function canonicalClone(value, state = {
  active: new WeakSet(),
  depth: 0,
  nodes: 0,
  bytes: 0,
}) {
  addCanonicalNode(state)
  if (value === null) {
    addCanonicalBytes(state, 4)
    return value
  }
  if (typeof value === 'boolean') {
    addCanonicalBytes(state, value ? 4 : 5)
    return value
  }
  if (typeof value === 'string') {
    addCanonicalBytes(state, jsonStringUtf8Length(value))
    return value
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) invalidPlan()
    addCanonicalBytes(state, String(value).length)
    return value
  }
  if (!value || typeof value !== 'object' || state.depth >= 64) invalidPlan()
  if (state.active.has(value)) invalidPlan()

  let prototype
  let descriptors
  try {
    prototype = Object.getPrototypeOf(value)
    descriptors = Object.getOwnPropertyDescriptors(value)
  } catch {
    invalidPlan()
  }

  state.active.add(value)
  state.depth += 1
  try {
    if (Array.isArray(value)) {
      if (prototype !== Array.prototype) invalidPlan()
      const length = descriptors.length?.value
      if (!Number.isSafeInteger(length) || length < 0 || length > 100_000) invalidPlan()
      const ownKeys = Reflect.ownKeys(descriptors)
      if (ownKeys.some((key) => (
        key !== 'length' && (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key))
      ))) invalidPlan()
      addCanonicalBytes(state, 2 + Math.max(0, length - 1))
      const result = []
      for (let index = 0; index < length; index += 1) {
        const descriptor = descriptors[index]
        if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) invalidPlan()
        result.push(canonicalClone(descriptor.value, state))
      }
      return result
    }

    if (prototype !== Object.prototype && prototype !== null) invalidPlan()
    const ownKeys = Reflect.ownKeys(descriptors)
    if (ownKeys.length > 10_000 || ownKeys.some((key) => (
      typeof key !== 'string' || DANGEROUS_KEYS.has(key)
    ))) invalidPlan()
    const sortedKeys = ownKeys.sort()
    addCanonicalBytes(state, 2 + Math.max(0, sortedKeys.length - 1))
    for (const key of sortedKeys) {
      addCanonicalBytes(state, jsonStringUtf8Length(key) + 1)
    }
    const result = {}
    for (const key of sortedKeys) {
      const descriptor = descriptors[key]
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) invalidPlan()
      result[key] = canonicalClone(descriptor.value, state)
    }
    return result
  } finally {
    state.depth -= 1
    state.active.delete(value)
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

function frozenClone(value) {
  return deepFreeze(canonicalClone(value))
}

export function serializeFrameRepairQualityGateValue(value) {
  let serialized
  try {
    serialized = JSON.stringify(canonicalClone(value))
  } catch (error) {
    if (error instanceof FrameRepairQualityGateError) throw error
    invalidPlan()
  }
  if (typeof serialized !== 'string' ||
      Buffer.byteLength(serialized, 'utf8') > CANONICAL_UTF8_LIMIT) invalidPlan()
  return Buffer.from(serialized, 'utf8')
}

export function hashFrameRepairQualityGateValue(value) {
  return createHash('sha256')
    .update(serializeFrameRepairQualityGateValue(value))
    .digest('hex')
}

function rawSha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function requireRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidPlan()
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) invalidPlan()
  return value
}

function exactRecord(value, expectedKeys) {
  const record = requireRecord(value)
  const keys = Object.keys(record)
  if (keys.length !== expectedKeys.length ||
      expectedKeys.some((key) => !Object.hasOwn(record, key))) invalidPlan()
  return record
}

function requireArray(value, length = null) {
  if (!Array.isArray(value) || (length !== null && value.length !== length)) invalidPlan()
  return value
}

function isLowerId(value, maximumLength = 80) {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maximumLength &&
    LOWER_ID_PATTERN.test(value)
}

function isSha256(value) {
  return typeof value === 'string' && SHA256_PATTERN.test(value)
}

function isPositiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0
}

function isNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0
}

function normalizeText(value, maximumLength = 500) {
  if (typeof value !== 'string' ||
      !isUnicodeScalarString(value) ||
      CONTROL_CHARACTER_PATTERN.test(value)) invalidPlan()
  const normalized = value.normalize('NFC').trim()
  if (normalized.length === 0 || [...normalized].length > maximumLength) invalidPlan()
  return normalized
}

function canonicalEquals(left, right) {
  return serializeFrameRepairQualityGateValue(left)
    .equals(serializeFrameRepairQualityGateValue(right))
}

function validateArtifacts(value) {
  const artifacts = requireArray(value, ARTIFACT_KEYS.length)
  const seen = new Set()
  const result = artifacts.map((item) => {
    const artifact = exactRecord(item, ['key', 'size', 'sha256'])
    if (!ARTIFACT_KEYS.includes(artifact.key) ||
        seen.has(artifact.key) ||
        !isPositiveInteger(artifact.size) ||
        !isSha256(artifact.sha256)) invalidPlan()
    seen.add(artifact.key)
    return {
      key: artifact.key,
      size: artifact.size,
      sha256: artifact.sha256,
    }
  })
  if (ARTIFACT_KEYS.some((key) => !seen.has(key))) invalidPlan()
  return result
}

function artifactsEquivalent(left, right) {
  const rightByKey = new Map(right.map((item) => [item.key, item]))
  return left.every((item) => {
    const candidate = rightByKey.get(item.key)
    return candidate?.size === item.size && candidate?.sha256 === item.sha256
  })
}

function validateSetupCase(value) {
  const item = exactRecord(value, [
    'case_id',
    'ownership_class',
    'source',
    'target',
    'control_identity',
  ])
  const source = exactRecord(item.source, [
    'asset_id',
    'revision_id',
    'source_sha256',
    'artifacts',
  ])
  const target = exactRecord(item.target, ['asset_id', 'revision_id', 'artifacts'])
  const sourceArtifacts = validateArtifacts(source.artifacts)
  const targetArtifacts = validateArtifacts(target.artifacts)
  const expectedControlIdentity = CONTROL_IDENTITIES.get(item.case_id)

  if (!isLowerId(item.case_id, 64) ||
      !isLowerId(target.asset_id) ||
      !isLowerId(target.revision_id) ||
      !isSha256(source.source_sha256) ||
      source.source_sha256 !== hashFrameRepairQualityGateValue(sourceArtifacts) ||
      !artifactsEquivalent(sourceArtifacts, targetArtifacts)) invalidPlan()

  if (expectedControlIdentity) {
    if (item.ownership_class !== 'repository_control' ||
        source.asset_id !== null ||
        source.revision_id !== null ||
        item.control_identity !== expectedControlIdentity) invalidPlan()
  } else if (item.ownership_class !== 'user_owned' ||
      !isLowerId(source.asset_id) ||
      !isLowerId(source.revision_id) ||
      item.control_identity !== null) {
    invalidPlan()
  }

  return {
    case_id: item.case_id,
    ownership_class: item.ownership_class,
    source: {
      asset_id: source.asset_id,
      revision_id: source.revision_id,
      source_sha256: source.source_sha256,
      artifacts: sourceArtifacts,
    },
    target: {
      asset_id: target.asset_id,
      revision_id: target.revision_id,
      artifacts: targetArtifacts,
    },
    control_identity: item.control_identity,
  }
}

function validateSetupManifest(value) {
  const manifest = exactRecord(canonicalClone(value), [
    'protocol',
    'source_project',
    'target_project',
    'ownership_confirmed',
    'cases',
  ])
  const sourceProject = exactRecord(manifest.source_project, ['id', 'revision'])
  const targetProject = exactRecord(manifest.target_project, ['id', 'revision'])
  const cases = requireArray(manifest.cases, 8).map(validateSetupCase)

  if (manifest.protocol !== 'frame_repair_quality_gate_setup_v1' ||
      manifest.ownership_confirmed !== true ||
      !isLowerId(sourceProject.id) ||
      !isPositiveInteger(sourceProject.revision) ||
      !isLowerId(targetProject.id) ||
      targetProject.revision !== 1 ||
      sourceProject.id === targetProject.id) invalidPlan()

  const caseIds = new Set(cases.map((item) => item.case_id))
  const targetAssetIds = new Set(cases.map((item) => item.target.asset_id))
  const userSourceAssetIds = new Set(cases
    .filter((item) => item.ownership_class === 'user_owned')
    .map((item) => item.source.asset_id))
  if (caseIds.size !== 8 ||
      targetAssetIds.size !== 8 ||
      userSourceAssetIds.size !== 6 ||
      [...CONTROL_IDENTITIES.keys()].some((caseId) => !caseIds.has(caseId))) invalidPlan()

  return {
    protocol: manifest.protocol,
    source_project: { id: sourceProject.id, revision: sourceProject.revision },
    target_project: { id: targetProject.id, revision: targetProject.revision },
    ownership_confirmed: true,
    cases,
  }
}

function validateMaskEdits(value) {
  return requireArray(value).map((item) => {
    const edit = exactRecord(item, ['op', 'x', 'y', 'width', 'height'])
    if ((edit.op !== 'add_rectangle' && edit.op !== 'remove_rectangle') ||
        !isNonNegativeInteger(edit.x) ||
        !isNonNegativeInteger(edit.y) ||
        !isPositiveInteger(edit.width) ||
        !isPositiveInteger(edit.height) ||
        edit.x + edit.width > 96 ||
        edit.y + edit.height > 96) invalidPlan()
    return {
      op: edit.op,
      x: edit.x,
      y: edit.y,
      width: edit.width,
      height: edit.height,
    }
  })
}

function validateRequestedCase(value) {
  const item = exactRecord(canonicalClone(value), REQUESTED_CASE_KEYS)
  const instruction = normalizeText(item.instruction)
  const expectedImprovement = normalizeText(item.expectedImprovement)
  const expectedDifficulty = DIFFICULTY_BY_CATEGORY.get(item.defectCategory)
  if (!isLowerId(item.caseId, 64) ||
      !isLowerId(item.assetId) ||
      !isLowerId(item.expectedAssetRevisionId) ||
      !isLowerId(item.clipId) ||
      !isNonNegativeInteger(item.clipFramePosition) ||
      item.clipFramePosition > 7 ||
      !isNonNegativeInteger(item.sheetFrameIndex) ||
      item.sheetFrameIndex > 63 ||
      expectedDifficulty !== item.difficulty) invalidPlan()
  return {
    caseId: item.caseId,
    assetId: item.assetId,
    expectedAssetRevisionId: item.expectedAssetRevisionId,
    clipId: item.clipId,
    clipFramePosition: item.clipFramePosition,
    sheetFrameIndex: item.sheetFrameIndex,
    instruction,
    maskEdits: validateMaskEdits(item.maskEdits),
    difficulty: item.difficulty,
    defectCategory: item.defectCategory,
    expectedImprovement,
  }
}

function validateFrameRepairPlanWrapper(value) {
  const wrapper = requireRecord(canonicalClone(value))
  const plan = requireRecord(wrapper.plan)
  const diagnostics = requireArray(wrapper.diagnostics)
  if (diagnostics.some((item) => item === 'provider_unavailable')) providerUnavailable()
  if (wrapper.can_run !== true) invalidPlan()
  if (!isSha256(wrapper.plan_hash) ||
      wrapper.plan_hash !== hashFrameRepairQualityGateValue(plan)) invalidPlan()

  const project = requireRecord(plan.project)
  const asset = requireRecord(plan.asset)
  const clip = requireRecord(plan.clip)
  const mask = requireRecord(plan.mask)
  const references = requireRecord(plan.references)
  const provider = requireRecord(plan.provider)
  const imageConfig = requireRecord(provider.image_config)
  const instruction = normalizeText(plan.instruction)
  if (plan.version !== 'frame_repair_plan_v1' ||
      !isLowerId(project.id) ||
      !isPositiveInteger(project.revision) ||
      !isLowerId(asset.id) ||
      !isLowerId(asset.parent_revision_id) ||
      !isLowerId(clip.id) ||
      !isNonNegativeInteger(clip.position) ||
      clip.position > 7 ||
      !isNonNegativeInteger(clip.sheet_frame_index) ||
      clip.sheet_frame_index > 63 ||
      instruction !== plan.instruction ||
      !isSha256(mask.sha256) ||
      !isSha256(plan.parent_sheet_sha256) ||
      !isSha256(plan.target_frame_sha256) ||
      !isSha256(references.context_sha256) ||
      !isLowerId(provider.id) ||
      (imageConfig.image_size !== '1K' && imageConfig.image_size !== '2K') ||
      plan.max_provider_calls !== 1 ||
      (plan.estimated_provider_calls !== undefined && plan.estimated_provider_calls !== 1) ||
      normalizeText(plan.implementation_revision, 160) !== plan.implementation_revision) invalidPlan()

  return {
    wrapper,
    plan,
    project: { id: project.id, revision: project.revision },
    asset: { id: asset.id, parent_revision_id: asset.parent_revision_id },
    clip: {
      id: clip.id,
      position: clip.position,
      sheet_frame_index: clip.sheet_frame_index,
    },
    instruction,
    mask_sha256: mask.sha256,
    parent_sheet_sha256: plan.parent_sheet_sha256,
    target_frame_sha256: plan.target_frame_sha256,
    reference_context_sha256: references.context_sha256,
    provider_preset_id: provider.id,
    image_size: imageConfig.image_size,
    max_provider_calls: plan.max_provider_calls,
    implementation_revision: plan.implementation_revision,
  }
}

function buildFingerprint({ setupCase, requestedCase, frameRepairPlan }) {
  const setup = validateSetupCase(canonicalClone(setupCase))
  const requested = validateRequestedCase(requestedCase)
  const frame = validateFrameRepairPlanWrapper(frameRepairPlan)
  if (setup.case_id !== requested.caseId ||
      setup.target.asset_id !== requested.assetId ||
      setup.target.revision_id !== requested.expectedAssetRevisionId ||
      frame.asset.id !== requested.assetId ||
      frame.asset.parent_revision_id !== requested.expectedAssetRevisionId ||
      frame.clip.id !== requested.clipId ||
      frame.clip.position !== requested.clipFramePosition ||
      frame.clip.sheet_frame_index !== requested.sheetFrameIndex ||
      frame.instruction !== requested.instruction) invalidPlan()
  return {
    case_id: requested.caseId,
    asset_id: frame.asset.id,
    parent_revision_id: frame.asset.parent_revision_id,
    clip_id: frame.clip.id,
    clip_frame_position: frame.clip.position,
    sheet_frame_index: frame.clip.sheet_frame_index,
    mask_sha256: frame.mask_sha256,
    instruction_sha256: hashFrameRepairQualityGateValue(frame.instruction),
    parent_sheet_sha256: frame.parent_sheet_sha256,
    target_frame_sha256: frame.target_frame_sha256,
    reference_context_sha256: frame.reference_context_sha256,
    provider_preset_id: frame.provider_preset_id,
    image_size: frame.image_size,
    difficulty: requested.difficulty,
    defect_category: requested.defectCategory,
    expected_improvement: requested.expectedImprovement,
    ownership_class: setup.ownership_class,
    source_sha256: setup.source.source_sha256,
    max_provider_calls: frame.max_provider_calls,
  }
}

export function buildFrameRepairQualityGateCaseFingerprint(input) {
  const record = requireRecord(canonicalClone(input))
  if (!Object.hasOwn(record, 'requestedCase')) invalidPlan()
  return frozenClone(buildFingerprint({
    setupCase: record.setupCase,
    requestedCase: record.requestedCase,
    frameRepairPlan: record.frameRepairPlan,
  }))
}

function validatePlanRequest(value) {
  try {
    return assertQualityGatePlanRequest(value)
  } catch {
    invalidPlan()
  }
}

function validateProject(value) {
  const project = canonicalClone(value)
  let validation
  try {
    validation = validateEditorProject(project)
  } catch {
    invalidPlan()
  }
  if (!validation || !Array.isArray(validation.blocking_errors) ||
      validation.blocking_errors.length > 0) invalidPlan()
  return project
}

function assertControlCases(requestCases) {
  const requestedByCaseId = new Map(requestCases.map((item) => [item.caseId, item]))
  for (const control of FRAME_REPAIR_QUALITY_GATE_CONTROL_CASE_DEFAULTS) {
    const requested = requestedByCaseId.get(control.caseId)
    if (!requested || !canonicalEquals(requested, control)) invalidPlan()
  }
}

function canonicalCase({ fingerprint, requestedCase, framePlan, displayIndex }) {
  return {
    case_id: fingerprint.case_id,
    display_index: displayIndex,
    asset_id: fingerprint.asset_id,
    parent_revision_id: fingerprint.parent_revision_id,
    repair: {
      clip_id: fingerprint.clip_id,
      clip_frame_position: fingerprint.clip_frame_position,
      sheet_frame_index: fingerprint.sheet_frame_index,
      instruction: framePlan.instruction,
      instruction_sha256: fingerprint.instruction_sha256,
      mask_edits: requestedCase.maskEdits,
      mask_sha256: fingerprint.mask_sha256,
    },
    classification: {
      difficulty: fingerprint.difficulty,
      defect_category: fingerprint.defect_category,
      expected_improvement: fingerprint.expected_improvement,
      ownership_class: fingerprint.ownership_class,
    },
    authority: {
      source_sha256: fingerprint.source_sha256,
      parent_sheet_sha256: fingerprint.parent_sheet_sha256,
      target_frame_sha256: fingerprint.target_frame_sha256,
      reference_context_sha256: fingerprint.reference_context_sha256,
    },
    provider: {
      preset_id: fingerprint.provider_preset_id,
      image_size: fingerprint.image_size,
      max_calls: 1,
    },
  }
}

export function buildFrameRepairQualityGatePlan(input) {
  const fields = exactRecord(canonicalClone(input), [
    'setupManifest',
    'request',
    'project',
    'frameRepairPlans',
  ])
  const {
    setupManifest,
    request,
    project,
    frameRepairPlans,
  } = fields
  const setup = validateSetupManifest(setupManifest)
  const validatedRequest = validatePlanRequest(request)
  const validatedProject = validateProject(project)
  const wrappers = requireArray(canonicalClone(frameRepairPlans), 8)
  const frames = wrappers.map(validateFrameRepairPlanWrapper)

  if (validatedRequest.setupManifestSha256 !== hashFrameRepairQualityGateValue(setup) ||
      validatedRequest.expectedRevision !== setup.target_project.revision ||
      validatedRequest.expectedRevision !== validatedProject.revision ||
      validatedRequest.providerPresetId.length === 0 ||
      (validatedRequest.imageConfig.image_size !== '1K' &&
        validatedRequest.imageConfig.image_size !== '2K') ||
      validatedRequest.maxProviderCalls !== 8 ||
      setup.target_project.id !== validatedProject.id) invalidPlan()

  assertControlCases(validatedRequest.cases)
  if (validatedRequest.cases.some((item, index) => (
    item.caseId !== setup.cases[index]?.case_id
  ))) invalidPlan()
  const setupByCaseId = new Map(setup.cases.map((item) => [item.case_id, item]))
  const frameByAssetId = new Map(frames.map((item) => [item.asset.id, item]))
  if (setupByCaseId.size !== 8 || frameByAssetId.size !== 8) invalidPlan()

  const implementationRevisions = new Set(frames.map((item) => item.implementation_revision))
  if (implementationRevisions.size !== 1) invalidPlan()
  const implementationRevision = frames[0].implementation_revision

  const sealedCases = validatedRequest.cases.map((requestedCaseValue, displayIndex) => {
    const requestedCase = validateRequestedCase(requestedCaseValue)
    const setupCase = setupByCaseId.get(requestedCase.caseId)
    const frame = frameByAssetId.get(requestedCase.assetId)
    const asset = validatedProject.assets?.[requestedCase.assetId]
    const setupSheetArtifact = setupCase?.target.artifacts.find((item) => item.key === 'sheet')
    if (!setupCase ||
        !frame ||
        !asset ||
        frame.parent_sheet_sha256 !== setupSheetArtifact?.sha256 ||
        asset.active_revision_id !== setupCase.target.revision_id ||
        !asset.revisions?.[asset.active_revision_id] ||
        frame.project.id !== validatedProject.id ||
        frame.project.revision !== validatedProject.revision ||
        frame.provider_preset_id !== validatedRequest.providerPresetId ||
        frame.image_size !== validatedRequest.imageConfig.image_size ||
        frame.implementation_revision !== implementationRevision) invalidPlan()

    const fingerprint = buildFingerprint({
      setupCase,
      requestedCase,
      frameRepairPlan: frame.wrapper,
    })
    const canonical = canonicalCase({
      fingerprint,
      requestedCase,
      framePlan: frame,
      displayIndex,
    })
    const caseHash = hashFrameRepairQualityGateValue(canonical)
    return {
      ...canonical,
      case_hash: caseHash,
      operation_id: `frqgop_${rawSha256(
        `${validatedRequest.sessionId}\0${requestedCase.caseId}\0${caseHash}`,
      ).slice(0, 48)}`,
    }
  })

  if (sealedCases.length !== setup.cases.length ||
      setup.cases.some((item) => !sealedCases.some((candidate) => (
        candidate.case_id === item.case_id && candidate.asset_id === item.target.asset_id
      )))) invalidPlan()

  const initialProjection = canonicalClone(validatedProject)
  delete initialProjection.revision
  delete initialProjection.updated_at
  const session = {
    protocol: 'frame_repair_quality_gate_plan_v1',
    session_id: validatedRequest.sessionId,
    setup_manifest_sha256: validatedRequest.setupManifestSha256,
    implementation_revision: implementationRevision,
    project: {
      id: validatedProject.id,
      initial_revision: validatedProject.revision,
      initial_projection_sha256: hashFrameRepairQualityGateValue(initialProjection),
    },
    provider: {
      preset_id: validatedRequest.providerPresetId,
      image_size: validatedRequest.imageConfig.image_size,
    },
    call_budget: { per_case: 1, total: 8 },
    cases: sealedCases,
  }
  return frozenClone({
    ...session,
    session_plan_hash: hashFrameRepairQualityGateValue(session),
  })
}

export function buildFrameRepairQualityGateBlindOrder(input) {
  const { sessionId, cases } = exactRecord(canonicalClone(input), ['sessionId', 'cases'])
  if (typeof sessionId !== 'string' || !SESSION_ID_PATTERN.test(sessionId)) invalidPlan()
  const projectedCases = requireArray(canonicalClone(cases), 8).map((item) => {
    const record = requireRecord(item)
    if (!isLowerId(record.case_id, 64) || !isSha256(record.case_hash)) invalidPlan()
    const inverse = Number.parseInt(
      rawSha256(`${sessionId}\0${record.case_id}`).slice(0, 2),
      16,
    ) % 2 === 1
    return {
      case_id: record.case_id,
      case_hash: record.case_hash,
      a: inverse ? 'after' : 'before',
      b: inverse ? 'before' : 'after',
    }
  })
  if (new Set(projectedCases.map((item) => item.case_id)).size !== 8) invalidPlan()
  return frozenClone({ session_id: sessionId, cases: projectedCases })
}

const HARD_GATE_INPUT_KEYS = Object.freeze([
  'identityComplete',
  'manifestVerified',
  'outsideMaskEqual',
  'outsideMaskChangedPixels',
  'candidateAvailable',
  'compositedFrameAvailable',
  'qualityEvidenceComplete',
  'validatorStatus',
  'validatorBlockingErrors',
  'continuityComplete',
  'revisionChainValid',
  'unrelatedProjectMutation',
  'providerCalls',
  'warnings',
])
const HARD_GATE_FACT_KEYS = Object.freeze([
  'identity_complete',
  'manifest_verified',
  'outside_mask_equal',
  'outside_mask_changed_pixels',
  'candidate_available',
  'composited_frame_available',
  'quality_evidence_complete',
  'validator_status',
  'validator_blocking_errors',
  'continuity_complete',
  'revision_chain_valid',
  'unrelated_project_mutation',
  'provider_calls',
  'warnings',
])
const SAFE_CODE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/
const VALIDATOR_STATUSES = new Set(['pass', 'warning', 'fail'])
const OUTCOME_VALUES = new Set([
  'accepted',
  'rejected',
  'provider_blocked',
  'quality_blocked',
  'outcome_unknown',
])

function validateSafeCodes(value, maximumLength = 16) {
  const codes = requireArray(value)
  if (codes.length > maximumLength ||
      codes.some((code) => typeof code !== 'string' || !SAFE_CODE_PATTERN.test(code)) ||
      new Set(codes).size !== codes.length) invalidPlan()
  return [...codes]
}

function projectHardGateFacts(value) {
  const input = exactRecord(canonicalClone(value), HARD_GATE_INPUT_KEYS)
  const booleanKeys = [
    'identityComplete',
    'manifestVerified',
    'outsideMaskEqual',
    'candidateAvailable',
    'compositedFrameAvailable',
    'qualityEvidenceComplete',
    'continuityComplete',
    'revisionChainValid',
    'unrelatedProjectMutation',
  ]
  if (booleanKeys.some((key) => typeof input[key] !== 'boolean') ||
      !isNonNegativeInteger(input.outsideMaskChangedPixels) ||
      !isNonNegativeInteger(input.providerCalls) ||
      !VALIDATOR_STATUSES.has(input.validatorStatus)) invalidPlan()
  const validatorBlockingErrors = validateSafeCodes(input.validatorBlockingErrors)
  const warnings = validateSafeCodes(input.warnings)
  return {
    identity_complete: input.identityComplete,
    manifest_verified: input.manifestVerified,
    outside_mask_equal: input.outsideMaskEqual,
    outside_mask_changed_pixels: input.outsideMaskChangedPixels,
    candidate_available: input.candidateAvailable,
    composited_frame_available: input.compositedFrameAvailable,
    quality_evidence_complete: input.qualityEvidenceComplete,
    validator_status: input.validatorStatus,
    validator_blocking_errors: validatorBlockingErrors,
    continuity_complete: input.continuityComplete,
    revision_chain_valid: input.revisionChainValid,
    unrelated_project_mutation: input.unrelatedProjectMutation,
    provider_calls: input.providerCalls,
    warnings,
  }
}

function blockerReasons(facts) {
  const reasons = []
  if (!facts.identity_complete) reasons.push('identity_incomplete')
  if (!facts.manifest_verified) reasons.push('artifact_manifest_mismatch')
  if (!facts.outside_mask_equal || facts.outside_mask_changed_pixels > 0) {
    reasons.push('outside_mask_changed')
  }
  if (!facts.candidate_available) reasons.push('candidate_missing')
  if (!facts.composited_frame_available) reasons.push('composited_frame_missing')
  if (!facts.quality_evidence_complete) reasons.push('quality_evidence_incomplete')
  if (facts.validator_status === 'fail' || facts.validator_blocking_errors.length > 0) {
    reasons.push('validator_blocked')
  }
  if (!facts.continuity_complete) reasons.push('continuity_incomplete')
  if (!facts.revision_chain_valid) reasons.push('revision_chain_drift')
  if (facts.unrelated_project_mutation) reasons.push('unrelated_project_mutation')
  if (facts.provider_calls !== 1) reasons.push('provider_call_count_invalid')
  return reasons
}

export function projectFrameRepairQualityGateHardGates(value) {
  const facts = projectHardGateFacts(value)
  const blockers = blockerReasons(facts)
  if (blockers.length > 0) {
    return frozenClone({ status: 'blocked', reasons: blockers, facts })
  }
  const warnings = [...facts.warnings]
  if (facts.validator_status === 'warning' && !warnings.includes('validator_warning')) {
    warnings.push('validator_warning')
  }
  return frozenClone({
    status: warnings.length > 0 ? 'warning' : 'pass',
    reasons: warnings,
    facts,
  })
}

function assertSealedControlCase(value) {
  const control = FRAME_REPAIR_QUALITY_GATE_CONTROL_CASE_DEFAULTS.find((item) => (
    item.caseId === value.case_id
  ))
  if (!control) return
  const projected = {
    caseId: value.case_id,
    assetId: value.asset_id,
    expectedAssetRevisionId: value.parent_revision_id,
    clipId: value.repair.clip_id,
    clipFramePosition: value.repair.clip_frame_position,
    sheetFrameIndex: value.repair.sheet_frame_index,
    instruction: value.repair.instruction,
    maskEdits: value.repair.mask_edits,
    difficulty: value.classification.difficulty,
    defectCategory: value.classification.defect_category,
    expectedImprovement: value.classification.expected_improvement,
  }
  if (!canonicalEquals(projected, control) ||
      value.classification.ownership_class !== 'repository_control') invalidPlan()
}

function validateSealedPlanCase(value, index, sessionId, sessionProvider) {
  const item = exactRecord(value, [
    'case_id',
    'display_index',
    'asset_id',
    'parent_revision_id',
    'repair',
    'classification',
    'authority',
    'provider',
    'case_hash',
    'operation_id',
  ])
  const repair = exactRecord(item.repair, [
    'clip_id',
    'clip_frame_position',
    'sheet_frame_index',
    'instruction',
    'instruction_sha256',
    'mask_edits',
    'mask_sha256',
  ])
  const classification = exactRecord(item.classification, [
    'difficulty',
    'defect_category',
    'expected_improvement',
    'ownership_class',
  ])
  const authority = exactRecord(item.authority, [
    'source_sha256',
    'parent_sheet_sha256',
    'target_frame_sha256',
    'reference_context_sha256',
  ])
  const provider = exactRecord(item.provider, ['preset_id', 'image_size', 'max_calls'])
  const instruction = normalizeText(repair.instruction)
  const expectedImprovement = normalizeText(classification.expected_improvement)
  const expectedDifficulty = DIFFICULTY_BY_CATEGORY.get(classification.defect_category)
  const maskEdits = requireArray(repair.mask_edits)
  if (maskEdits.length > 64) invalidPlan()
  const projectedMaskEdits = validateMaskEdits(maskEdits)

  if (!isLowerId(item.case_id, 64) ||
      !isLowerId(item.asset_id) ||
      !isLowerId(item.parent_revision_id) ||
      item.display_index !== index ||
      !isLowerId(repair.clip_id) ||
      !isNonNegativeInteger(repair.clip_frame_position) ||
      repair.clip_frame_position > 7 ||
      !isNonNegativeInteger(repair.sheet_frame_index) ||
      repair.sheet_frame_index > 63 ||
      instruction !== repair.instruction ||
      repair.instruction_sha256 !== hashFrameRepairQualityGateValue(instruction) ||
      !isSha256(repair.mask_sha256) ||
      expectedDifficulty !== classification.difficulty ||
      expectedImprovement !== classification.expected_improvement ||
      (classification.ownership_class !== 'repository_control' &&
        classification.ownership_class !== 'user_owned') ||
      !isSha256(authority.source_sha256) ||
      !isSha256(authority.parent_sheet_sha256) ||
      !isSha256(authority.target_frame_sha256) ||
      !isSha256(authority.reference_context_sha256) ||
      provider.preset_id !== sessionProvider.preset_id ||
      provider.image_size !== sessionProvider.image_size ||
      provider.max_calls !== 1 ||
      !isSha256(item.case_hash)) invalidPlan()

  const canonical = {
    case_id: item.case_id,
    display_index: item.display_index,
    asset_id: item.asset_id,
    parent_revision_id: item.parent_revision_id,
    repair: {
      clip_id: repair.clip_id,
      clip_frame_position: repair.clip_frame_position,
      sheet_frame_index: repair.sheet_frame_index,
      instruction,
      instruction_sha256: repair.instruction_sha256,
      mask_edits: projectedMaskEdits,
      mask_sha256: repair.mask_sha256,
    },
    classification: {
      difficulty: classification.difficulty,
      defect_category: classification.defect_category,
      expected_improvement: expectedImprovement,
      ownership_class: classification.ownership_class,
    },
    authority: {
      source_sha256: authority.source_sha256,
      parent_sheet_sha256: authority.parent_sheet_sha256,
      target_frame_sha256: authority.target_frame_sha256,
      reference_context_sha256: authority.reference_context_sha256,
    },
    provider: {
      preset_id: provider.preset_id,
      image_size: provider.image_size,
      max_calls: provider.max_calls,
    },
  }
  assertSealedControlCase(canonical)
  const caseHash = hashFrameRepairQualityGateValue(canonical)
  const operationId = `frqgop_${rawSha256(
    `${sessionId}\0${canonical.case_id}\0${caseHash}`,
  ).slice(0, 48)}`
  if (item.case_hash !== caseHash || item.operation_id !== operationId) invalidPlan()
  return { ...canonical, case_hash: caseHash, operation_id: operationId }
}

function validateSealedPlan(value) {
  const plan = exactRecord(value, [
    'protocol',
    'session_id',
    'setup_manifest_sha256',
    'implementation_revision',
    'project',
    'provider',
    'call_budget',
    'cases',
    'session_plan_hash',
  ])
  const project = exactRecord(plan.project, [
    'id',
    'initial_revision',
    'initial_projection_sha256',
  ])
  const provider = exactRecord(plan.provider, ['preset_id', 'image_size'])
  const callBudget = exactRecord(plan.call_budget, ['per_case', 'total'])
  const implementationRevision = normalizeText(plan.implementation_revision, 160)
  const cases = requireArray(plan.cases, 8)
  if (plan.protocol !== 'frame_repair_quality_gate_plan_v1' ||
      typeof plan.session_id !== 'string' ||
      !SESSION_ID_PATTERN.test(plan.session_id) ||
      !isSha256(plan.setup_manifest_sha256) ||
      implementationRevision !== plan.implementation_revision ||
      !isLowerId(project.id) ||
      project.initial_revision !== 1 ||
      !isSha256(project.initial_projection_sha256) ||
      !isLowerId(provider.preset_id) ||
      (provider.image_size !== '1K' && provider.image_size !== '2K') ||
      callBudget.per_case !== 1 ||
      callBudget.total !== 8 ||
      !isSha256(plan.session_plan_hash)) invalidPlan()

  const sessionProvider = {
    preset_id: provider.preset_id,
    image_size: provider.image_size,
  }
  const projectedCases = cases.map((item, index) => (
    validateSealedPlanCase(item, index, plan.session_id, sessionProvider)
  ))
  const caseIds = new Set(projectedCases.map((item) => item.case_id))
  const assetIds = new Set(projectedCases.map((item) => item.asset_id))
  const categories = new Set(projectedCases.map((item) => item.classification.defect_category))
  const repositoryControls = projectedCases.filter((item) => (
    item.classification.ownership_class === 'repository_control'
  ))
  const difficultyCounts = { basic: 0, medium: 0, hard: 0 }
  for (const item of projectedCases) difficultyCounts[item.classification.difficulty] += 1
  if (caseIds.size !== 8 ||
      assetIds.size !== 8 ||
      categories.size !== 8 ||
      [...DIFFICULTY_BY_CATEGORY.keys()].some((category) => !categories.has(category)) ||
      difficultyCounts.basic !== 2 ||
      difficultyCounts.medium !== 4 ||
      difficultyCounts.hard !== 2 ||
      repositoryControls.length !== 2 ||
      FRAME_REPAIR_QUALITY_GATE_CONTROL_CASE_DEFAULTS.some((control) => (
        !repositoryControls.some((item) => item.case_id === control.caseId)
      ))) invalidPlan()

  const session = {
    protocol: 'frame_repair_quality_gate_plan_v1',
    session_id: plan.session_id,
    setup_manifest_sha256: plan.setup_manifest_sha256,
    implementation_revision: implementationRevision,
    project: {
      id: project.id,
      initial_revision: project.initial_revision,
      initial_projection_sha256: project.initial_projection_sha256,
    },
    provider: sessionProvider,
    call_budget: { per_case: 1, total: 8 },
    cases: projectedCases,
  }
  const sessionPlanHash = hashFrameRepairQualityGateValue(session)
  if (plan.session_plan_hash !== sessionPlanHash) invalidPlan()
  return { ...session, session_plan_hash: sessionPlanHash }
}

function validateDecisionReview(value, caseIds) {
  const item = requireRecord(value)
  const functional = exactRecord(item.functional, [
    'improvement',
    'usability',
    'new_blocking_defect',
  ])
  if (!caseIds.has(item.case_id) ||
      !['improved', 'same', 'worse'].includes(functional.improvement) ||
      !['usable', 'review_required', 'blocked'].includes(functional.usability) ||
      typeof functional.new_blocking_defect !== 'boolean') invalidPlan()
  return {
    case_id: item.case_id,
    functional: {
      improvement: functional.improvement,
      usability: functional.usability,
      new_blocking_defect: functional.new_blocking_defect,
    },
  }
}

function hardGateFactsToInput(facts) {
  const projected = exactRecord(facts, HARD_GATE_FACT_KEYS)
  return {
    identityComplete: projected.identity_complete,
    manifestVerified: projected.manifest_verified,
    outsideMaskEqual: projected.outside_mask_equal,
    outsideMaskChangedPixels: projected.outside_mask_changed_pixels,
    candidateAvailable: projected.candidate_available,
    compositedFrameAvailable: projected.composited_frame_available,
    qualityEvidenceComplete: projected.quality_evidence_complete,
    validatorStatus: projected.validator_status,
    validatorBlockingErrors: projected.validator_blocking_errors,
    continuityComplete: projected.continuity_complete,
    revisionChainValid: projected.revision_chain_valid,
    unrelatedProjectMutation: projected.unrelated_project_mutation,
    providerCalls: projected.provider_calls,
    warnings: projected.warnings,
  }
}

function validateDecisionHardGate(value, caseIds) {
  const item = requireRecord(value)
  if (!caseIds.has(item.case_id)) invalidPlan()
  const projected = projectFrameRepairQualityGateHardGates(
    hardGateFactsToInput(item.facts),
  )
  if (item.status !== projected.status ||
      !canonicalEquals(item.reasons, projected.reasons) ||
      !canonicalEquals(item.facts, projected.facts)) invalidPlan()
  return {
    case_id: item.case_id,
    status: projected.status,
    reasons: projected.reasons,
    facts: projected.facts,
  }
}

function validateDecisionOutcome(value, caseIds) {
  const item = requireRecord(value)
  if (!caseIds.has(item.case_id) ||
      !OUTCOME_VALUES.has(item.outcome) ||
      !isNonNegativeInteger(item.provider_calls) ||
      (item.controlled_reason !== null && (
        typeof item.controlled_reason !== 'string' ||
        !SAFE_CODE_PATTERN.test(item.controlled_reason)
      ))) invalidPlan()
  return {
    case_id: item.case_id,
    outcome: item.outcome,
    provider_calls: item.provider_calls,
    controlled_reason: item.controlled_reason,
  }
}

function uniqueMap(items) {
  const result = new Map()
  for (const item of items) {
    if (result.has(item.case_id)) invalidPlan()
    result.set(item.case_id, item)
  }
  return result
}

export function computeFrameRepairQualityGateDecision(value) {
  const input = exactRecord(canonicalClone(value), [
    'plan',
    'reviews',
    'outcomes',
    'hardGates',
  ])
  const plan = validateSealedPlan(requireRecord(input.plan))
  const caseIds = new Set(plan.cases.map((item) => item.case_id))
  const reviews = requireArray(input.reviews).map((item) => (
    validateDecisionReview(item, caseIds)
  ))
  const hardGates = requireArray(input.hardGates).map((item) => (
    validateDecisionHardGate(item, caseIds)
  ))
  const outcomes = requireArray(input.outcomes).map((item) => (
    validateDecisionOutcome(item, caseIds)
  ))
  if (reviews.length > 8 || hardGates.length > 8 || outcomes.length > 8) invalidPlan()
  const reviewsByCaseId = uniqueMap(reviews)
  const gatesByCaseId = uniqueMap(hardGates)
  const outcomesByCaseId = uniqueMap(outcomes)

  let callsUsed = 0
  let accepted = 0
  let rejected = 0
  let providerBlocked = 0
  let unresolved = 0
  let safetyFailed = hardGates.some((item) => item.status === 'blocked')

  for (const planCase of plan.cases) {
    const outcome = outcomesByCaseId.get(planCase.case_id)
    const review = reviewsByCaseId.get(planCase.case_id)
    const gate = gatesByCaseId.get(planCase.case_id)
    if (review && !gate) safetyFailed = true
    if (!outcome) {
      unresolved += 1
      continue
    }
    callsUsed += outcome.provider_calls
    if (outcome.provider_calls > 1) safetyFailed = true
    if (outcome.outcome === 'accepted') accepted += 1
    if (outcome.outcome === 'rejected') rejected += 1
    if (outcome.outcome === 'provider_blocked') providerBlocked += 1
    if (outcome.outcome === 'provider_blocked' &&
        outcome.controlled_reason === 'provider_safety_filter') safetyFailed = true
    if (outcome.outcome === 'provider_blocked' && (review || gate)) safetyFailed = true
    if (outcome.outcome === 'outcome_unknown') unresolved += 1
    if (outcome.outcome === 'quality_blocked') safetyFailed = true
    if ((outcome.outcome === 'accepted' || outcome.outcome === 'rejected') && !review) {
      safetyFailed = true
    }
  }
  if (callsUsed > 8) safetyFailed = true

  let successfulCandidates = 0
  for (const review of reviews) {
    const gate = gatesByCaseId.get(review.case_id)
    if (!gate || gate.status === 'blocked') continue
    const functional = review.functional
    if (functional.improvement === 'improved' &&
        (functional.usability === 'usable' || functional.usability === 'review_required') &&
        functional.new_blocking_defect === false) successfulCandidates += 1
  }

  const completedCandidates = reviews.length
  const requiredSuccesses = Math.ceil(0.7 * completedCandidates)
  const improvementRate = completedCandidates === 0
    ? 0
    : successfulCandidates / completedCandidates
  let result
  let failureDomain
  if (safetyFailed) {
    result = 'quality_failed'
    failureDomain = 'safety'
  } else if (unresolved > 0 || outcomesByCaseId.size !== 8 || completedCandidates < 6) {
    result = 'evidence_insufficient'
    failureDomain = null
  } else if (successfulCandidates >= requiredSuccesses) {
    result = 'passed'
    failureDomain = null
  } else {
    result = 'quality_failed'
    failureDomain = 'visual_quality'
  }

  return frozenClone({
    result,
    failure_domain: failureDomain,
    total_planned: 8,
    completed_candidates: completedCandidates,
    successful_candidates: successfulCandidates,
    required_successes: requiredSuccesses,
    improvement_rate: improvementRate,
    calls_used: callsUsed,
    calls_remaining: Math.max(0, 8 - callsUsed),
    accepted,
    rejected,
    provider_blocked: providerBlocked,
    unresolved,
  })
}
