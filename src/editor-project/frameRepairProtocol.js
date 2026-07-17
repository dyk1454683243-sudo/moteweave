import {
  clonePlain,
  findBase64PayloadPaths,
  findSecretLikePaths,
  isPlainObject,
  isValidId,
} from './safety.js'

const SHA256_PATTERN = /^[a-f0-9]{64}$/
const OPERATION_ID_PATTERN = /^[A-Za-z0-9_-]{16,80}$/
const CONTROL_CHARACTER_PATTERN = /\p{Cc}/u
const BASE64_DATA_URL_OCCURRENCE_PATTERN = /data:[^,\s]*;base64,/i

const PLAN_KEYS = Object.freeze([
  'expectedRevision',
  'expectedAssetRevisionId',
  'clipId',
  'clipFramePosition',
  'sheetFrameIndex',
  'instruction',
  'maskEdits',
  'providerPresetId',
  'imageConfig',
])
const LIVE_KEYS = Object.freeze([
  ...PLAN_KEYS,
  'operationId',
  'expectedPlanHash',
  'confirmLiveGeneration',
  'maxProviderCalls',
])
const ACCEPT_KEYS = Object.freeze([
  'expectedRevision',
  'expectedAssetRevisionId',
  'expectedPlanHash',
  'warningConfirmed',
])
const MASK_EDIT_KEYS = Object.freeze(['op', 'x', 'y', 'width', 'height'])
const IMAGE_CONFIG_KEYS = Object.freeze(['image_size'])

export class FrameRepairError extends Error {
  constructor(code, message, details = null) {
    super(message)
    this.name = 'FrameRepairError'
    this.code = code
    this.details = details
  }
}

function isPlainJsonObject(value) {
  if (!isPlainObject(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function assertExactObject(value, keys, code = 'invalid_frame_repair_request') {
  if (!isPlainJsonObject(value)) {
    throw new FrameRepairError(code, 'expected a plain JSON object')
  }
  const actualKeys = Object.keys(value)
  const extraFields = actualKeys.filter((key) => !keys.includes(key))
  if (extraFields.length > 0) {
    throw new FrameRepairError(
      'unexpected_request_field',
      'request contains unsupported fields',
      { field_count: extraFields.length },
    )
  }
  const missingFields = keys.filter((key) => !Object.hasOwn(value, key))
  if (missingFields.length > 0) {
    throw new FrameRepairError(code, 'request is missing required fields', { fields: missingFields })
  }
}

function assertNestedExactFields(body) {
  if (Array.isArray(body.maskEdits)) {
    for (const edit of body.maskEdits) {
      if (isPlainJsonObject(edit)) assertExactObject(edit, MASK_EDIT_KEYS)
    }
  }
  if (isPlainJsonObject(body.imageConfig)) {
    assertExactObject(body.imageConfig, IMAGE_CONFIG_KEYS)
  }
}

function assertSafeJson(value, code) {
  if (containsBase64DataUrl(value) ||
      findBase64PayloadPaths(value).length > 0 ||
      findSecretLikePaths(value).length > 0) {
    throw new FrameRepairError(code, 'binary and secret-like values are forbidden')
  }
}

function containsBase64DataUrl(value) {
  if (typeof value === 'string') return BASE64_DATA_URL_OCCURRENCE_PATTERN.test(value)
  if (Array.isArray(value)) return value.some(containsBase64DataUrl)
  if (!isPlainObject(value)) return false
  return Object.values(value).some(containsBase64DataUrl)
}

function normalizedInstruction(value) {
  if (typeof value !== 'string' || CONTROL_CHARACTER_PATTERN.test(value)) return null
  const normalized = value.normalize('NFC').trim()
  if (normalized.length === 0 || [...normalized].length > 500) return null
  return normalized
}

function isValidMaskEdit(edit) {
  return isPlainJsonObject(edit) &&
    (edit.op === 'add_rectangle' || edit.op === 'remove_rectangle') &&
    Number.isInteger(edit.x) && edit.x >= 0 &&
    Number.isInteger(edit.y) && edit.y >= 0 &&
    Number.isInteger(edit.width) && edit.width > 0 &&
    Number.isInteger(edit.height) && edit.height > 0
}

export function assertFrameRepairPlanRequest(body) {
  assertExactObject(body, PLAN_KEYS)
  assertNestedExactFields(body)
  assertSafeJson(body, 'invalid_frame_repair_request')

  const instruction = normalizedInstruction(body.instruction)
  if (!Number.isInteger(body.expectedRevision) || body.expectedRevision < 0 ||
      !isValidId(body.expectedAssetRevisionId) ||
      !isValidId(body.clipId) ||
      !Number.isInteger(body.clipFramePosition) || body.clipFramePosition < 0 ||
      !Number.isInteger(body.sheetFrameIndex) || body.sheetFrameIndex < 0 ||
      instruction == null ||
      !Array.isArray(body.maskEdits) || body.maskEdits.length > 64 ||
      !body.maskEdits.every(isValidMaskEdit) ||
      !isValidId(body.providerPresetId) ||
      !isPlainJsonObject(body.imageConfig) ||
      (body.imageConfig.image_size !== '1K' && body.imageConfig.image_size !== '2K')) {
    throw new FrameRepairError(
      'invalid_frame_repair_request',
      'Frame Repair plan fields are invalid',
    )
  }

  const result = clonePlain(body)
  result.instruction = instruction
  return result
}

export function assertFrameRepairLiveRequest(body) {
  assertExactObject(body, LIVE_KEYS)

  const plan = assertFrameRepairPlanRequest(
    Object.fromEntries(PLAN_KEYS.map((key) => [key, body[key]])),
  )
  assertSafeJson(body, 'invalid_frame_repair_request')
  if (!isFrameRepairOperationId(body.operationId) ||
      typeof body.expectedPlanHash !== 'string' ||
      !SHA256_PATTERN.test(body.expectedPlanHash) ||
      body.confirmLiveGeneration !== true ||
      body.maxProviderCalls !== 1) {
    throw new FrameRepairError(
      'invalid_frame_repair_request',
      'live confirmation fields are invalid',
    )
  }

  return clonePlain({
    ...plan,
    operationId: body.operationId,
    expectedPlanHash: body.expectedPlanHash,
    confirmLiveGeneration: true,
    maxProviderCalls: 1,
  })
}

export function assertFrameRepairAcceptRequest(body) {
  assertExactObject(body, ACCEPT_KEYS, 'invalid_accept_request')
  assertSafeJson(body, 'invalid_accept_request')

  if (!Number.isInteger(body.expectedRevision) || body.expectedRevision < 0 ||
      !isValidId(body.expectedAssetRevisionId) ||
      typeof body.expectedPlanHash !== 'string' ||
      !SHA256_PATTERN.test(body.expectedPlanHash) ||
      typeof body.warningConfirmed !== 'boolean') {
    throw new FrameRepairError(
      'invalid_accept_request',
      'Frame Repair Accept fields are invalid',
    )
  }
  return clonePlain(body)
}

export function isFrameRepairOperationId(value) {
  return typeof value === 'string' && OPERATION_ID_PATTERN.test(value)
}
