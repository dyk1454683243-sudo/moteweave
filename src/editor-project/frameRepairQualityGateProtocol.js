const CONTROL_CHARACTER_PATTERN = /\p{Cc}/u
const LOWER_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/
const OPERATION_ID_PATTERN = /^[A-Za-z0-9_-]{16,80}$/
const REPOSITORY_JOB_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/
const SESSION_ID_PATTERN = /^frqg_[a-z0-9][a-z0-9_-]{15,79}$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/

const SETUP_KEYS = Object.freeze([
  'expectedRevision',
  'targetProjectId',
  'targetProjectName',
  'ownershipConfirmed',
  'sourceAssets',
])
const SOURCE_ASSET_KEYS = Object.freeze([
  'caseId',
  'assetId',
  'expectedAssetRevisionId',
])
const PLAN_KEYS = Object.freeze([
  'sessionId',
  'expectedRevision',
  'setupManifestSha256',
  'providerPresetId',
  'imageConfig',
  'maxProviderCalls',
  'cases',
])
const START_KEYS = Object.freeze([
  ...PLAN_KEYS,
  'expectedPlanHash',
  'confirmSessionStart',
])
const IMAGE_CONFIG_KEYS = Object.freeze(['image_size'])
const CASE_KEYS = Object.freeze([
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
const MASK_EDIT_KEYS = Object.freeze(['op', 'x', 'y', 'width', 'height'])
const REVIEW_KEYS = Object.freeze([
  'expectedPlanHash',
  'expectedCaseHash',
  'operationId',
  'jobId',
  'blindChoice',
  'improvement',
  'usability',
  'newBlockingDefect',
  'reasonCodes',
  'note',
])
const OUTCOME_KEYS = Object.freeze([
  'expectedPlanHash',
  'expectedCaseHash',
  'operationId',
  'jobId',
  'expectedReviewSha256',
  'outcome',
  'expectedProjectRevision',
  'acceptedRevisionId',
])
const FINALIZE_KEYS = Object.freeze([
  'expectedPlanHash',
  'expectedRevision',
  'confirmFinalize',
])
const ROUTE_KEYS = Object.freeze(['projectId', 'sessionId', 'caseId'])

const BLIND_CHOICES = Object.freeze(['prefer_a', 'prefer_b', 'no_material_difference'])
const IMPROVEMENTS = Object.freeze(['improved', 'same', 'worse'])
const USABILITY_RESULTS = Object.freeze(['usable', 'review_required', 'blocked'])

export class FrameRepairQualityGateError extends Error {
  constructor(code, message, details = null) {
    super(message)
    this.name = 'FrameRepairQualityGateError'
    this.code = code
    this.details = details
  }
}

function invalid(code) {
  throw new FrameRepairQualityGateError(code, 'quality gate request is invalid')
}

function invalidFieldCount(code, fieldCount) {
  throw new FrameRepairQualityGateError(
    code,
    'quality gate request has an invalid field count',
    Object.freeze({ field_count: fieldCount }),
  )
}

function unexpectedFields(fieldCount) {
  throw new FrameRepairQualityGateError(
    'unexpected_request_field',
    'quality gate request contains unsupported fields',
    Object.freeze({ field_count: fieldCount }),
  )
}

function cloneAndDeepFreeze(value) {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => cloneAndDeepFreeze(item)))
  }
  if (value && typeof value === 'object') {
    const clone = {}
    for (const key of Object.keys(value)) {
      clone[key] = cloneAndDeepFreeze(value[key])
    }
    return Object.freeze(clone)
  }
  return value
}

function readExactRecord(value, expectedKeys, code) {
  if (value === null || typeof value !== 'object') invalid(code)

  let isArray
  let prototype
  let descriptors
  try {
    isArray = Array.isArray(value)
    prototype = Object.getPrototypeOf(value)
    descriptors = Object.getOwnPropertyDescriptors(value)
  } catch {
    invalid(code)
  }
  if (isArray || (prototype !== Object.prototype && prototype !== null)) invalid(code)

  const ownKeys = Reflect.ownKeys(descriptors)
  const expectedKeySet = new Set(expectedKeys)
  const extraFieldCount = ownKeys.reduce((count, key) => (
    typeof key !== 'string' || !expectedKeySet.has(key) ? count + 1 : count
  ), 0)
  if (extraFieldCount > 0) unexpectedFields(extraFieldCount)

  const missingFieldCount = expectedKeys.reduce((count, key) => (
    Object.hasOwn(descriptors, key) ? count : count + 1
  ), 0)
  if (missingFieldCount > 0) invalidFieldCount(code, missingFieldCount)

  const values = Object.create(null)
  for (const key of expectedKeys) {
    const descriptor = descriptors[key]
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) invalid(code)
    values[key] = descriptor.value
  }
  return values
}

function readDenseArray(value, code, maximumLength) {
  if (value === null || typeof value !== 'object') invalid(code)

  let isArray
  let prototype
  let lengthDescriptor
  try {
    isArray = Array.isArray(value)
    prototype = Object.getPrototypeOf(value)
    lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length')
  } catch {
    invalid(code)
  }
  if (!isArray || prototype !== Array.prototype ||
      !lengthDescriptor || !Object.hasOwn(lengthDescriptor, 'value')) invalid(code)

  const length = lengthDescriptor.value
  if (!Number.isSafeInteger(length) || length < 0 || length > maximumLength) invalid(code)

  let descriptors
  try {
    descriptors = Object.getOwnPropertyDescriptors(value)
  } catch {
    invalid(code)
  }

  const expectedIndexes = new Set(Array.from({ length }, (_, index) => String(index)))
  const ownKeys = Reflect.ownKeys(descriptors)
  const extraFieldCount = ownKeys.reduce((count, key) => {
    if (key === 'length') return count
    return typeof key !== 'string' || !expectedIndexes.has(key) ? count + 1 : count
  }, 0)
  if (extraFieldCount > 0) unexpectedFields(extraFieldCount)

  const missingFieldCount = [...expectedIndexes].reduce((count, key) => (
    Object.hasOwn(descriptors, key) ? count : count + 1
  ), 0)
  if (missingFieldCount > 0) invalidFieldCount(code, missingFieldCount)

  const result = []
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[index]
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) invalid(code)
    result.push(descriptor.value)
  }
  return result
}

function isUnicodeScalarString(value) {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index)
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      if (index + 1 >= value.length) return false
      const nextCodeUnit = value.charCodeAt(index + 1)
      if (nextCodeUnit < 0xdc00 || nextCodeUnit > 0xdfff) return false
      index += 1
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false
    }
  }
  return true
}

function codePointLengthAtMost(value, maximumLength) {
  let length = 0
  for (const ignored of value) {
    void ignored
    length += 1
    if (length > maximumLength) return false
  }
  return true
}

function normalizeText(value, { trim, minimumLength, maximumLength }) {
  if (typeof value !== 'string' ||
      !isUnicodeScalarString(value) ||
      CONTROL_CHARACTER_PATTERN.test(value)) return null
  const normalized = value.normalize('NFC')
  const result = trim ? normalized.trim() : normalized
  if (!codePointLengthAtMost(result, maximumLength)) return null
  if (minimumLength > 0 && result.length === 0) return null
  return result
}

function isSafeRevision(value) {
  return Number.isSafeInteger(value) && value >= 0
}

function isLowerId(value, maximumLength) {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maximumLength &&
    LOWER_ID_PATTERN.test(value)
}

function isRepositoryJobId(value) {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 80 &&
    REPOSITORY_JOB_ID_PATTERN.test(value)
}

function isOperationId(value) {
  return typeof value === 'string' && OPERATION_ID_PATTERN.test(value)
}

function isSessionId(value) {
  return typeof value === 'string' && SESSION_ID_PATTERN.test(value)
}

function isSha256(value) {
  return typeof value === 'string' && SHA256_PATTERN.test(value)
}

function isOneOf(value, allowedValues) {
  return typeof value === 'string' && allowedValues.includes(value)
}

function validateSourceAsset(value, code) {
  const fields = readExactRecord(value, SOURCE_ASSET_KEYS, code)
  if (!isLowerId(fields.caseId, 64) ||
      !isLowerId(fields.assetId, 80) ||
      !isLowerId(fields.expectedAssetRevisionId, 80)) invalid(code)
  return {
    caseId: fields.caseId,
    assetId: fields.assetId,
    expectedAssetRevisionId: fields.expectedAssetRevisionId,
  }
}

function validateMaskEdit(value, code) {
  const fields = readExactRecord(value, MASK_EDIT_KEYS, code)
  if ((fields.op !== 'add_rectangle' && fields.op !== 'remove_rectangle') ||
      !Number.isSafeInteger(fields.x) || fields.x < 0 || fields.x > 95 ||
      !Number.isSafeInteger(fields.y) || fields.y < 0 || fields.y > 95 ||
      !Number.isSafeInteger(fields.width) || fields.width < 1 || fields.width > 96 ||
      !Number.isSafeInteger(fields.height) || fields.height < 1 || fields.height > 96 ||
      fields.x + fields.width > 96 || fields.y + fields.height > 96) invalid(code)
  return {
    op: fields.op,
    x: fields.x,
    y: fields.y,
    width: fields.width,
    height: fields.height,
  }
}

function validateQualityGateCase(value, code) {
  const fields = readExactRecord(value, CASE_KEYS, code)
  const maskEdits = readDenseArray(fields.maskEdits, code, 64)
    .map((edit) => validateMaskEdit(edit, code))
  const instruction = normalizeText(fields.instruction, {
    trim: true,
    minimumLength: 1,
    maximumLength: 500,
  })
  const expectedImprovement = normalizeText(fields.expectedImprovement, {
    trim: true,
    minimumLength: 1,
    maximumLength: 500,
  })

  if (!isLowerId(fields.caseId, 64) ||
      !isLowerId(fields.assetId, 80) ||
      !isLowerId(fields.expectedAssetRevisionId, 80) ||
      !isLowerId(fields.clipId, 80) ||
      !Number.isSafeInteger(fields.clipFramePosition) ||
      fields.clipFramePosition < 0 || fields.clipFramePosition > 7 ||
      !Number.isSafeInteger(fields.sheetFrameIndex) ||
      fields.sheetFrameIndex < 0 || fields.sheetFrameIndex > 63 ||
      instruction === null || expectedImprovement === null ||
      !isOneOf(fields.difficulty, QUALITY_GATE_DIFFICULTIES) ||
      !isOneOf(fields.defectCategory, QUALITY_GATE_DEFECT_CATEGORIES)) invalid(code)

  return {
    caseId: fields.caseId,
    assetId: fields.assetId,
    expectedAssetRevisionId: fields.expectedAssetRevisionId,
    clipId: fields.clipId,
    clipFramePosition: fields.clipFramePosition,
    sheetFrameIndex: fields.sheetFrameIndex,
    instruction,
    maskEdits,
    difficulty: fields.difficulty,
    defectCategory: fields.defectCategory,
    expectedImprovement,
  }
}

function validatePlanFields(fields, code) {
  const imageConfigFields = readExactRecord(fields.imageConfig, IMAGE_CONFIG_KEYS, code)
  const cases = readDenseArray(fields.cases, code, 8)
    .map((qualityGateCase) => validateQualityGateCase(qualityGateCase, code))

  if (!isSessionId(fields.sessionId) ||
      !isSafeRevision(fields.expectedRevision) ||
      !isSha256(fields.setupManifestSha256) ||
      !isLowerId(fields.providerPresetId, 80) ||
      (imageConfigFields.image_size !== '1K' && imageConfigFields.image_size !== '2K') ||
      fields.maxProviderCalls !== 8 ||
      cases.length !== 8) invalid(code)

  const caseIds = new Set(cases.map((item) => item.caseId))
  const assetIds = new Set(cases.map((item) => item.assetId))
  if (caseIds.size !== cases.length || assetIds.size !== cases.length) invalid(code)

  const difficultyCounts = Object.fromEntries(
    QUALITY_GATE_DIFFICULTIES.map((difficulty) => [difficulty, 0]),
  )
  const categoryCounts = Object.fromEntries(
    QUALITY_GATE_DEFECT_CATEGORIES.map((category) => [category, 0]),
  )
  for (const qualityGateCase of cases) {
    difficultyCounts[qualityGateCase.difficulty] += 1
    categoryCounts[qualityGateCase.defectCategory] += 1
  }
  if (difficultyCounts.basic !== 2 ||
      difficultyCounts.medium !== 4 ||
      difficultyCounts.hard !== 2 ||
      QUALITY_GATE_DEFECT_CATEGORIES.some((category) => categoryCounts[category] !== 1)) {
    invalid(code)
  }

  return {
    sessionId: fields.sessionId,
    expectedRevision: fields.expectedRevision,
    setupManifestSha256: fields.setupManifestSha256,
    providerPresetId: fields.providerPresetId,
    imageConfig: { image_size: imageConfigFields.image_size },
    maxProviderCalls: 8,
    cases,
  }
}

export const QUALITY_GATE_DIFFICULTIES = cloneAndDeepFreeze([
  'basic',
  'medium',
  'hard',
])

export const QUALITY_GATE_DEFECT_CATEGORIES = cloneAndDeepFreeze([
  'outline_alpha_edge',
  'small_component',
  'shape',
  'detail',
  'anchor_baseline',
  'facing_consistency',
  'semantic_reconstruction',
  'neighbor_continuity',
])

export const QUALITY_GATE_OUTCOMES = cloneAndDeepFreeze([
  'accepted',
  'rejected',
  'provider_blocked',
  'outcome_unknown',
  'quality_blocked',
])

export const QUALITY_GATE_REASON_CODES = cloneAndDeepFreeze([
  'outline_repaired',
  'alpha_edge_repaired',
  'component_repaired',
  'shape_improved',
  'detail_improved',
  'anchor_improved',
  'facing_improved',
  'semantic_improved',
  'continuity_improved',
  'no_visible_improvement',
  'new_artifact',
  'identity_drift',
  'pose_drift',
  'continuity_regression',
  'blocked_by_hard_gate',
])

export const FRAME_REPAIR_QUALITY_GATE_CONTROL_CASE_DEFAULTS = cloneAndDeepFreeze([
  {
    caseId: 'control_outline_alpha',
    assetId: 'asset_qg_control_outline_alpha',
    expectedAssetRevisionId: 'rev_001',
    clipId: 'walk_down',
    clipFramePosition: 1,
    sheetFrameIndex: 17,
    instruction: 'Repair the broken outline and alpha edge only.',
    maskEdits: [
      { op: 'add_rectangle', x: 39, y: 48, width: 12, height: 18 },
    ],
    difficulty: 'basic',
    defectCategory: 'outline_alpha_edge',
    expectedImprovement: 'The silhouette edge is continuous without changing pixels outside the mask.',
  },
  {
    caseId: 'control_small_component',
    assetId: 'asset_qg_control_small_component',
    expectedAssetRevisionId: 'rev_001',
    clipId: 'walk_right',
    clipFramePosition: 2,
    sheetFrameIndex: 30,
    instruction: 'Repair the detached small component only.',
    maskEdits: [
      { op: 'add_rectangle', x: 58, y: 56, width: 10, height: 12 },
    ],
    difficulty: 'basic',
    defectCategory: 'small_component',
    expectedImprovement: 'The detached component is restored to a coherent silhouette without outside-mask changes.',
  },
])

export function assertQualityGateSetupRequest(body) {
  const code = 'invalid_quality_gate_request'
  const fields = readExactRecord(body, SETUP_KEYS, code)
  const sourceAssets = readDenseArray(fields.sourceAssets, code, 6)
    .map((sourceAsset) => validateSourceAsset(sourceAsset, code))
  const targetProjectName = normalizeText(fields.targetProjectName, {
    trim: true,
    minimumLength: 1,
    maximumLength: 160,
  })

  if (!isSafeRevision(fields.expectedRevision) ||
      !isLowerId(fields.targetProjectId, 80) ||
      targetProjectName === null ||
      fields.ownershipConfirmed !== true ||
      sourceAssets.length !== 6) invalid(code)

  const caseIds = new Set(sourceAssets.map((item) => item.caseId))
  const assetIds = new Set(sourceAssets.map((item) => item.assetId))
  const assetRevisionTuples = new Set(sourceAssets.map((item) => (
    `${item.assetId}\u0000${item.expectedAssetRevisionId}`
  )))
  if (caseIds.size !== 6 || assetIds.size !== 6 || assetRevisionTuples.size !== 6) invalid(code)

  return cloneAndDeepFreeze({
    expectedRevision: fields.expectedRevision,
    targetProjectId: fields.targetProjectId,
    targetProjectName,
    ownershipConfirmed: true,
    sourceAssets,
  })
}

export function assertQualityGatePlanRequest(body) {
  const code = 'invalid_quality_gate_plan'
  const fields = readExactRecord(body, PLAN_KEYS, code)
  return cloneAndDeepFreeze(validatePlanFields(fields, code))
}

export function assertQualityGateStartRequest(body) {
  const code = 'invalid_quality_gate_request'
  const fields = readExactRecord(body, START_KEYS, code)
  const plan = validatePlanFields(fields, code)
  if (!isSha256(fields.expectedPlanHash) || fields.confirmSessionStart !== true) invalid(code)
  return cloneAndDeepFreeze({
    ...plan,
    expectedPlanHash: fields.expectedPlanHash,
    confirmSessionStart: true,
  })
}

export function assertQualityGateReviewRequest(body) {
  const code = 'invalid_quality_gate_review'
  const fields = readExactRecord(body, REVIEW_KEYS, code)
  const reasonCodes = readDenseArray(fields.reasonCodes, code, 16)
  const note = fields.note === null
    ? null
    : normalizeText(fields.note, { trim: false, minimumLength: 0, maximumLength: 500 })

  if (!isSha256(fields.expectedPlanHash) ||
      !isSha256(fields.expectedCaseHash) ||
      !isOperationId(fields.operationId) ||
      !isRepositoryJobId(fields.jobId) ||
      !isOneOf(fields.blindChoice, BLIND_CHOICES) ||
      !isOneOf(fields.improvement, IMPROVEMENTS) ||
      !isOneOf(fields.usability, USABILITY_RESULTS) ||
      typeof fields.newBlockingDefect !== 'boolean' ||
      (note === null && fields.note !== null) ||
      reasonCodes.some((reasonCode) => !isOneOf(reasonCode, QUALITY_GATE_REASON_CODES)) ||
      new Set(reasonCodes).size !== reasonCodes.length) invalid(code)

  return cloneAndDeepFreeze({
    expectedPlanHash: fields.expectedPlanHash,
    expectedCaseHash: fields.expectedCaseHash,
    operationId: fields.operationId,
    jobId: fields.jobId,
    blindChoice: fields.blindChoice,
    improvement: fields.improvement,
    usability: fields.usability,
    newBlockingDefect: fields.newBlockingDefect,
    reasonCodes,
    note,
  })
}

export function assertQualityGateOutcomeRequest(body) {
  const code = 'invalid_quality_gate_outcome'
  const fields = readExactRecord(body, OUTCOME_KEYS, code)
  if (!isSha256(fields.expectedPlanHash) ||
      !isSha256(fields.expectedCaseHash) ||
      !isOperationId(fields.operationId) ||
      !isOneOf(fields.outcome, QUALITY_GATE_OUTCOMES) ||
      !isSafeRevision(fields.expectedProjectRevision) ||
      (fields.jobId !== null && !isRepositoryJobId(fields.jobId)) ||
      (fields.expectedReviewSha256 !== null && !isSha256(fields.expectedReviewSha256)) ||
      (fields.acceptedRevisionId !== null && !isLowerId(fields.acceptedRevisionId, 80))) {
    invalid(code)
  }

  const jobPresent = fields.jobId !== null
  const reviewPresent = fields.expectedReviewSha256 !== null
  const acceptedRevisionPresent = fields.acceptedRevisionId !== null
  const validCombination = (
    fields.outcome === 'accepted' && jobPresent && reviewPresent && acceptedRevisionPresent
  ) || (
    fields.outcome === 'rejected' && jobPresent && reviewPresent && !acceptedRevisionPresent
  ) || (
    fields.outcome === 'quality_blocked' && jobPresent && !reviewPresent && !acceptedRevisionPresent
  ) || (
    fields.outcome === 'provider_blocked' && !reviewPresent && !acceptedRevisionPresent
  ) || (
    fields.outcome === 'outcome_unknown' && !jobPresent && !reviewPresent && !acceptedRevisionPresent
  )
  if (!validCombination) invalid(code)

  return cloneAndDeepFreeze({
    expectedPlanHash: fields.expectedPlanHash,
    expectedCaseHash: fields.expectedCaseHash,
    operationId: fields.operationId,
    jobId: fields.jobId,
    expectedReviewSha256: fields.expectedReviewSha256,
    outcome: fields.outcome,
    expectedProjectRevision: fields.expectedProjectRevision,
    acceptedRevisionId: fields.acceptedRevisionId,
  })
}

export function assertQualityGateFinalizeRequest(body) {
  const code = 'invalid_quality_gate_request'
  const fields = readExactRecord(body, FINALIZE_KEYS, code)
  if (!isSha256(fields.expectedPlanHash) ||
      !isSafeRevision(fields.expectedRevision) ||
      fields.confirmFinalize !== true) invalid(code)
  return cloneAndDeepFreeze({
    expectedPlanHash: fields.expectedPlanHash,
    expectedRevision: fields.expectedRevision,
    confirmFinalize: true,
  })
}

export function assertQualityGateRouteIds(body) {
  const code = 'invalid_quality_gate_request'
  const fields = readExactRecord(body, ROUTE_KEYS, code)
  if (!isLowerId(fields.projectId, 80) ||
      (fields.sessionId !== null && !isSessionId(fields.sessionId)) ||
      (fields.caseId !== null && !isLowerId(fields.caseId, 64)) ||
      (fields.caseId !== null && fields.sessionId === null)) invalid(code)
  return cloneAndDeepFreeze({
    projectId: fields.projectId,
    sessionId: fields.sessionId,
    caseId: fields.caseId,
  })
}
