import { createHash } from 'node:crypto'
import { assertPixelTags, validateStructureCommand } from './pixelStructure.js'
import { assertPixelLinks } from './pixelLinks.js'
import { validPaletteColors, validProjectPalette } from './validation.js'
import { isBlankSpriteDocument } from './pixelDocumentOrigin.js'
import { assertTextObjects } from './pixelTextObjects.js'

import {
  EDITOR_PROJECT_V1_VERSION,
  EDITOR_PROJECT_V2_VERSION,
  PROJECT_REFERENCE_PURPOSES,
  PROJECT_REFERENCE_SOURCE_KINDS,
  SHA256_HEX_PATTERN,
  SPRITE_DOCUMENT_LIMITS,
  SPRITE_DOCUMENT_VERSION,
  UUID_PATTERN,
} from './constants.js'
import {
  isIsoTimestamp,
  isNonNegativeInteger,
  isObjectMap,
  isPlainObject,
  isPositiveInteger,
  isValidId,
  isValidJobId,
} from './safety.js'

export const DEFAULT_V1_PROJECT_NAME = 'Untitled Project'
export const DEFAULT_V1_DOCUMENT_NAME = 'Untitled Document'

const V1_DOCUMENT_KEYS = Object.freeze([
  'version',
  'document_id',
  'project_id',
  'name',
  'revision',
  'parent_revision',
  'canvas',
  'color',
  'frame_order',
  'layer_order',
  'frames',
  'layers',
  'cels',
  'links',
  'text_objects',
  'tags',
  'palette',
  'anchors',
  'source_ref',
  'derived_from',
  'origin',
])

const CREATE_PROJECT_KEYS = Object.freeze(['operation_id', 'name'])
const UPGRADE_COPY_KEYS = Object.freeze(['operation_id', 'expected_revision', 'name'])
const CREATE_DOCUMENT_KEYS = Object.freeze(['operation_id', 'expected_revision', 'source', 'name'])
const CREATE_BLANK_KEYS = Object.freeze(['operation_id', 'expected_revision', 'width', 'height', 'name'])
const FROM_JOB_KEYS = Object.freeze(['operation_id', 'expected_revision', 'source', 'name'])
const FROM_JOB_SOURCE_KEYS = Object.freeze(['job_id', 'artifact', 'expected_sha256'])
const SOURCE_KEYS = Object.freeze(['asset_id', 'revision_id', 'artifact', 'expected_sha256'])
const IMPORT_PNG_QUERY_KEYS = Object.freeze(['operation_id', 'expected_revision', 'expected_sha256', 'name'])
const GENERAL_SEQUENCE_QUERY_KEYS = Object.freeze(['operation_id', 'expected_revision', 'expected_sha256', 'background', 'name', 'preview', 'append_document_id', 'source_job_id'])
const GENERAL_SEQUENCE_BACKGROUNDS = new Set(['auto', 'white', 'green', 'magenta', 'purple'])
const MOTION_IMPORT_QUERY_KEYS = Object.freeze([
  'operation_id',
  'expected_revision',
  'expected_sha256',
  'action',
  'kind',
  'file_name',
  'name',
  'start_sec',
  'end_sec',
  'sampling_mode',
  'fps',
  'stride',
])
const IMPORT_JPEG_QUERY_KEYS = Object.freeze(['operation_id', 'expected_revision', 'expected_sha256', 'name'])
const CANVAS_LAYOUT_KEYS = Object.freeze(['operation_id', 'expected_revision', 'positions'])
const RENAME_CANVAS_KEYS = Object.freeze(['operation_id', 'expected_revision', 'display_name'])
const RESET_CANVAS_NAME_KEYS = Object.freeze(['operation_id', 'expected_revision'])
const DETACH_CANVAS_KEYS = Object.freeze(['operation_id', 'expected_revision'])
const RESTORE_CANVAS_KEYS = Object.freeze(['operation_id', 'expected_revision', 'detach_operation_id'])
const PROMOTE_REFERENCE_KEYS = Object.freeze([
  'operation_id',
  'expected_revision',
  'canvas_id',
  'document_id',
  'working_revision',
  'frame_id',
  'layer_id',
  'source_kind',
  'purpose',
  'name',
])
const REVOKE_REFERENCE_KEYS = Object.freeze([
  'operation_id',
  'expected_revision',
])
const DERIVE_WORKING_KEYS = Object.freeze([
  'operation_id',
  'expected_revision',
  'source_canvas_id',
  'source_document_id',
  'source_revision',
  'name',
])
const RESTORE_WORKING_KEYS = Object.freeze([
  'operation_id',
  'expected_revision',
  'expected_working_revision',
  'target_revision',
  'mode',
])
const WORKING_PIXELS_QUERY_KEYS = Object.freeze([
  'operation_id',
  'expected_revision',
  'expected_working_revision',
  'x',
  'y',
  'w',
  'h',
  'expected_sha256',
])
export const WORKING_PIXELS_MAX_BYTES = 4 * 1024 * 1024
const CANVAS_POSITION_KEYS = Object.freeze(['canvas_id', 'x', 'y'])
const CLIENT_FORBIDDEN_FIELDS = Object.freeze([
  'version',
  'revision',
  'accepted_revision',
  'accepted',
  'upgraded_from',
  'operation_receipts',
  'provenance',
  'source_provenance',
  'created_at',
  'updated_at',
  'id',
  'document_id',
  'project_id',
  'sprite_documents',
  'pages',
  'canvases',
  'conversation_id',
  'derived_from',
  'references',
])

export class SpriteDocumentError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'SpriteDocumentError'
    this.code = code
    this.details = details
  }
}

export function spriteDocumentError(code, message, details = {}) {
  return new SpriteDocumentError(code, message, details)
}

export function isEditorProjectV1(project) {
  return project?.version === EDITOR_PROJECT_V1_VERSION
}

export function isPixelEditorProject(project) {
  return isEditorProjectV1(project) || project?.version === EDITOR_PROJECT_V2_VERSION
}

export function isUuid(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

export function isSha256Hex(value) {
  return typeof value === 'string' && SHA256_HEX_PATTERN.test(value)
}

export function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

export function sha256Text(value) {
  return sha256Bytes(Buffer.from(String(value), 'utf8'))
}

export function stableJson(value) {
  if (value === undefined) return 'null'
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function payloadSha256(value) {
  return sha256Text(stableJson(value))
}

export function deriveStableId(prefix, seed) {
  return `${prefix}${sha256Text(seed).slice(0, 16)}`
}

export function assertV1Name(value, label = 'name') {
  if (typeof value !== 'string') {
    throw spriteDocumentError('invalid_request', `${label} must be a string`)
  }
  if (value !== value.trim() || !value || value.length > SPRITE_DOCUMENT_LIMITS.maxNameLength) {
    throw spriteDocumentError('invalid_request', `${label} must be 1-${SPRITE_DOCUMENT_LIMITS.maxNameLength} characters`)
  }
  if (/[\u0000-\u001f]/.test(value)) {
    throw spriteDocumentError('invalid_request', `${label} contains control characters`)
  }
  return value
}

export function optionalV1Name(value, fallback) {
  if (value == null) return fallback
  return assertV1Name(value)
}

export function assertUuid(value, label = 'operation_id') {
  if (!isUuid(value)) throw spriteDocumentError('invalid_request', `${label} must be a UUID`)
  return value
}

export function assertExpectedRevision(value) {
  if (!isPositiveInteger(value)) {
    throw spriteDocumentError('invalid_request', 'expected_revision must be an integer >= 1')
  }
  return value
}

export function assertSha256Hex(value, label = 'sha256') {
  if (!isSha256Hex(value)) {
    throw spriteDocumentError('invalid_request', `${label} must be 64 lowercase hex characters`)
  }
  return value
}

function unknownKeys(value, allowed) {
  return Object.keys(value ?? {}).filter((key) => !allowed.includes(key))
}

export function assertExactFields(value, allowed, label) {
  if (!isPlainObject(value)) throw spriteDocumentError('invalid_request', `${label} must be an object`)
  const extra = unknownKeys(value, allowed)
  if (extra.length) {
    throw spriteDocumentError('invalid_request', `${label} has unknown fields`)
  }
  for (const field of CLIENT_FORBIDDEN_FIELDS) {
    if (Object.hasOwn(value, field) && !allowed.includes(field)) {
      throw spriteDocumentError('invalid_request', `${label} cannot write ${field}`)
    }
  }
  return value
}

export function parseCreateProjectRequest(body) {
  assertExactFields(body, CREATE_PROJECT_KEYS, 'create project request')
  const operation_id = assertUuid(body.operation_id)
  const name = optionalV1Name(body.name, DEFAULT_V1_PROJECT_NAME)
  return {
    operation_id,
    name,
    payload: { operation_id, name: body.name ?? null },
  }
}

export function parseUpgradeCopyRequest(body) {
  assertExactFields(body, UPGRADE_COPY_KEYS, 'upgrade-copy request')
  const operation_id = assertUuid(body.operation_id)
  const expected_revision = assertExpectedRevision(body.expected_revision)
  const name = optionalV1Name(body.name, null)
  return {
    operation_id,
    expected_revision,
    name,
    payload: {
      operation_id,
      expected_revision,
      name: body.name ?? null,
    },
  }
}

function assertSafeInteger(value, label) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw spriteDocumentError('invalid_request', `${label} must be a safe integer`)
  }
  return value
}

function collectSearchKeys(searchParams) {
  const keys = []
  for (const key of searchParams.keys()) keys.push(key)
  return keys
}

export function parseImportPngQuery(searchParams, encodedQuery = '') {
  const encoded = String(encodedQuery ?? '').replace(/^\?/, '')
  if (Buffer.byteLength(encoded, 'utf8') > SPRITE_DOCUMENT_LIMITS.maxQueryBytes) {
    throw spriteDocumentError('resource_limit', 'query string exceeds 2KiB', {
      limit: SPRITE_DOCUMENT_LIMITS.maxQueryBytes,
    })
  }
  const keys = collectSearchKeys(searchParams)
  const seen = new Set()
  for (const key of keys) {
    if (seen.has(key)) {
      throw spriteDocumentError('invalid_request', 'import-png query has duplicate fields')
    }
    seen.add(key)
    if (!IMPORT_PNG_QUERY_KEYS.includes(key)) {
      throw spriteDocumentError('invalid_request', 'import-png query has unknown fields')
    }
  }
  for (const required of ['operation_id', 'expected_revision', 'expected_sha256']) {
    if (!seen.has(required)) {
      throw spriteDocumentError('invalid_request', `${required} is required`)
    }
  }
  const operation_id = assertUuid(searchParams.get('operation_id'))
  const revisionText = searchParams.get('expected_revision')
  if (!/^[1-9][0-9]*$/.test(revisionText)) {
    throw spriteDocumentError('invalid_request', 'expected_revision must be an integer >= 1')
  }
  const expected_revision = assertExpectedRevision(Number(revisionText))
  const expected_sha256 = assertSha256Hex(searchParams.get('expected_sha256'), 'expected_sha256')
  const name = seen.has('name') ? assertV1Name(searchParams.get('name')) : null
  return {
    operation_id,
    expected_revision,
    expected_sha256,
    name,
    payload: {
      action: 'import_png',
      operation_id,
      expected_revision,
      expected_sha256,
      name: name ?? null,
    },
  }
}

export function parseGeneralSequenceQuery(searchParams, encodedQuery = '') {
  const encoded = String(encodedQuery ?? '').replace(/^\?/, '')
  if (Buffer.byteLength(encoded, 'utf8') > SPRITE_DOCUMENT_LIMITS.maxQueryBytes) {
    throw spriteDocumentError('resource_limit', 'query string exceeds 2KiB', {
      limit: SPRITE_DOCUMENT_LIMITS.maxQueryBytes,
    })
  }
  const keys = collectSearchKeys(searchParams)
  const seen = new Set()
  for (const key of keys) {
    if (seen.has(key)) throw spriteDocumentError('invalid_request', 'general-sequence query has duplicate fields')
    seen.add(key)
    if (!GENERAL_SEQUENCE_QUERY_KEYS.includes(key)) {
      throw spriteDocumentError('invalid_request', 'general-sequence query has unknown fields')
    }
  }
  for (const required of ['operation_id', 'expected_revision', 'expected_sha256']) {
    if (!seen.has(required)) throw spriteDocumentError('invalid_request', `${required} is required`)
  }
  const operation_id = assertUuid(searchParams.get('operation_id'))
  const revisionText = searchParams.get('expected_revision')
  if (!/^[1-9][0-9]*$/.test(revisionText)) {
    throw spriteDocumentError('invalid_request', 'expected_revision must be an integer >= 1')
  }
  const expected_revision = assertExpectedRevision(Number(revisionText))
  const expected_sha256 = assertSha256Hex(searchParams.get('expected_sha256'), 'expected_sha256')
  const background = seen.has('background') ? (searchParams.get('background') || 'auto') : 'auto'
  if (!GENERAL_SEQUENCE_BACKGROUNDS.has(background)) {
    throw spriteDocumentError('invalid_request', 'background must be auto, white, green, magenta, or purple')
  }
  const name = seen.has('name') ? assertV1Name(searchParams.get('name')) : null
  const preview = seen.has('preview') ? searchParams.get('preview') : '0'
  if (preview !== '0' && preview !== '1') throw spriteDocumentError('invalid_request', 'preview must be 0 or 1')
  const append_document_id = seen.has('append_document_id') ? searchParams.get('append_document_id') : null
  if (append_document_id !== null && !isValidId(append_document_id)) {
    throw spriteDocumentError('invalid_request', 'append_document_id is invalid')
  }
  const source_job_id = seen.has('source_job_id') ? searchParams.get('source_job_id') : null
  if (source_job_id !== null) {
    if (!isValidJobId(source_job_id)) {
      throw spriteDocumentError('invalid_request', 'source_job_id is invalid')
    }
    if (preview === '1' || append_document_id !== null) {
      throw spriteDocumentError('invalid_request', 'source_job_id cannot be used with preview or append_document_id')
    }
  }
  return {
    operation_id,
    expected_revision,
    expected_sha256,
    background,
    name,
    preview: preview === '1',
    append_document_id,
    source_job_id,
    payload: {
      action: 'import_general_sequence',
      operation_id,
      expected_revision,
      expected_sha256,
      background,
      name: name ?? null,
      ...(append_document_id ? { append_document_id } : {}),
      ...(source_job_id ? { generated_job_id: source_job_id } : {}),
    },
  }
}

export function parseMotionImportQuery(searchParams, encodedQuery = '') {
  const encoded = String(encodedQuery ?? '').replace(/^\?/, '')
  if (Buffer.byteLength(encoded, 'utf8') > SPRITE_DOCUMENT_LIMITS.maxQueryBytes) {
    throw spriteDocumentError('resource_limit', 'query string exceeds 2KiB', {
      limit: SPRITE_DOCUMENT_LIMITS.maxQueryBytes,
    })
  }
  const keys = collectSearchKeys(searchParams)
  const seen = new Set()
  for (const key of keys) {
    if (seen.has(key)) throw spriteDocumentError('invalid_request', 'motion-import query has duplicate fields')
    seen.add(key)
    if (!MOTION_IMPORT_QUERY_KEYS.includes(key)) {
      throw spriteDocumentError('invalid_request', 'motion-import query has unknown fields')
    }
  }
  for (const required of ['operation_id', 'expected_revision', 'expected_sha256']) {
    if (!seen.has(required)) throw spriteDocumentError('invalid_request', `${required} is required`)
  }
  const operation_id = assertUuid(searchParams.get('operation_id'))
  const revisionText = searchParams.get('expected_revision')
  if (!/^[1-9][0-9]*$/.test(revisionText)) {
    throw spriteDocumentError('invalid_request', 'expected_revision must be an integer >= 1')
  }
  const expected_revision = assertExpectedRevision(Number(revisionText))
  const expected_sha256 = assertSha256Hex(searchParams.get('expected_sha256'), 'expected_sha256')
  const action = seen.has('action') ? String(searchParams.get('action') || '').trim().toLowerCase() : 'preview'
  if (!['probe', 'preview', 'commit'].includes(action)) {
    throw spriteDocumentError('invalid_request', 'action must be probe, preview, or commit')
  }
  const kind = seen.has('kind') ? String(searchParams.get('kind') || '').trim().toLowerCase() : null
  if (kind !== null && kind !== 'gif' && kind !== 'video') {
    throw spriteDocumentError('invalid_request', 'kind must be gif or video')
  }
  const file_name = seen.has('file_name') ? String(searchParams.get('file_name') || '').trim() : ''
  if (file_name.length > 180 || /[\x00-\x1f\x7f]/.test(file_name)) {
    throw spriteDocumentError('invalid_request', 'file_name is invalid')
  }
  const name = seen.has('name') ? assertV1Name(searchParams.get('name')) : null
  const start_sec = seen.has('start_sec') ? Number(searchParams.get('start_sec')) : null
  if (start_sec !== null && (!Number.isFinite(start_sec) || start_sec < 0)) {
    throw spriteDocumentError('invalid_request', 'start_sec must be a non-negative number')
  }
  const end_sec = seen.has('end_sec') ? Number(searchParams.get('end_sec')) : null
  if (end_sec !== null && (!Number.isFinite(end_sec) || end_sec <= 0)) {
    throw spriteDocumentError('invalid_request', 'end_sec must be a positive number')
  }
  const sampling_mode = seen.has('sampling_mode') ? String(searchParams.get('sampling_mode') || '').trim().toLowerCase() : null
  if (sampling_mode !== null && sampling_mode !== 'fps' && sampling_mode !== 'stride') {
    throw spriteDocumentError('invalid_request', 'sampling_mode must be fps or stride')
  }
  const fps = seen.has('fps') ? Number(searchParams.get('fps')) : null
  if (fps !== null && (!Number.isSafeInteger(fps) || fps < 1 || fps > 60)) {
    throw spriteDocumentError('invalid_request', 'fps must be an integer between 1 and 60')
  }
  const stride = seen.has('stride') ? Number(searchParams.get('stride')) : null
  if (stride !== null && (!Number.isSafeInteger(stride) || stride < 1 || stride > 120)) {
    throw spriteDocumentError('invalid_request', 'stride must be an integer between 1 and 120')
  }
  return {
    operation_id,
    expected_revision,
    expected_sha256,
    action,
    kind,
    file_name,
    name,
    start_sec,
    end_sec,
    sampling_mode,
    fps,
    stride,
    payload: {
      action: 'import_motion_timeline',
      operation_id,
      expected_revision,
      expected_sha256,
      kind: kind ?? null,
      name: name ?? null,
      start_sec: start_sec !== null ? Number(start_sec.toFixed(4)) : null,
      end_sec: end_sec !== null ? Number(end_sec.toFixed(4)) : null,
      sampling_mode: sampling_mode ?? null,
      fps: fps ?? null,
      stride: stride ?? null,
    },
  }
}

export function parseImportJpegQuery(searchParams, encodedQuery = '') {
  const encoded = String(encodedQuery ?? '').replace(/^\?/, '')
  if (Buffer.byteLength(encoded, 'utf8') > SPRITE_DOCUMENT_LIMITS.maxQueryBytes) {
    throw spriteDocumentError('resource_limit', 'query string exceeds 2KiB', {
      limit: SPRITE_DOCUMENT_LIMITS.maxQueryBytes,
    })
  }
  const keys = collectSearchKeys(searchParams)
  const seen = new Set()
  for (const key of keys) {
    if (seen.has(key)) {
      throw spriteDocumentError('invalid_request', 'import-jpeg query has duplicate fields')
    }
    seen.add(key)
    if (!IMPORT_JPEG_QUERY_KEYS.includes(key)) {
      throw spriteDocumentError('invalid_request', 'import-jpeg query has unknown fields')
    }
  }
  for (const required of ['operation_id', 'expected_revision', 'expected_sha256']) {
    if (!seen.has(required)) {
      throw spriteDocumentError('invalid_request', `${required} is required`)
    }
  }
  const operation_id = assertUuid(searchParams.get('operation_id'))
  const revisionText = searchParams.get('expected_revision')
  if (!/^[1-9][0-9]*$/.test(revisionText)) {
    throw spriteDocumentError('invalid_request', 'expected_revision must be an integer >= 1')
  }
  const expected_revision = assertExpectedRevision(Number(revisionText))
  const expected_sha256 = assertSha256Hex(searchParams.get('expected_sha256'), 'expected_sha256')
  const name = seen.has('name') ? assertV1Name(searchParams.get('name')) : null
  return {
    operation_id,
    expected_revision,
    expected_sha256,
    name,
    payload: {
      action: 'import_jpeg',
      operation_id,
      expected_revision,
      expected_sha256,
      name: name ?? null,
    },
  }
}

export function parseRenameCanvasRequest(body, canvasId) {
  assertExactFields(body, RENAME_CANVAS_KEYS, 'canvas rename request')
  if (!isValidId(canvasId)) {
    throw spriteDocumentError('invalid_request', 'canvas_id is invalid')
  }
  const operation_id = assertUuid(body.operation_id)
  const expected_revision = assertExpectedRevision(body.expected_revision)
  const display_name = assertV1Name(body.display_name, 'display_name')
  return {
    operation_id,
    expected_revision,
    display_name,
    canvas_id: canvasId,
    payload: {
      action: 'rename_canvas',
      canvas_id: canvasId,
      operation_id,
      expected_revision,
      display_name,
    },
  }
}

export function parseResetCanvasNameRequest(body, canvasId) {
  assertExactFields(body, RESET_CANVAS_NAME_KEYS, 'canvas reset-name request')
  if (!isValidId(canvasId)) throw spriteDocumentError('invalid_request', 'canvas_id is invalid')
  const operation_id = assertUuid(body.operation_id)
  const expected_revision = assertExpectedRevision(body.expected_revision)
  return {
    operation_id,
    expected_revision,
    canvas_id: canvasId,
    payload: {
      action: 'reset_canvas_name',
      canvas_id: canvasId,
      operation_id,
      expected_revision,
    },
  }
}

export function parseDetachCanvasRequest(body, canvasId) {
  assertExactFields(body, DETACH_CANVAS_KEYS, 'canvas detach request')
  if (!isValidId(canvasId)) throw spriteDocumentError('invalid_request', 'canvas_id is invalid')
  const operation_id = assertUuid(body.operation_id)
  const expected_revision = assertExpectedRevision(body.expected_revision)
  return {
    operation_id,
    expected_revision,
    canvas_id: canvasId,
    payload: {
      action: 'detach_canvas',
      canvas_id: canvasId,
      operation_id,
      expected_revision,
    },
  }
}

export function parseRestoreCanvasRequest(body, canvasId) {
  assertExactFields(body, RESTORE_CANVAS_KEYS, 'canvas restore request')
  if (!isValidId(canvasId)) throw spriteDocumentError('invalid_request', 'canvas_id is invalid')
  const operation_id = assertUuid(body.operation_id)
  const expected_revision = assertExpectedRevision(body.expected_revision)
  const detach_operation_id = assertUuid(body.detach_operation_id)
  return {
    operation_id,
    expected_revision,
    detach_operation_id,
    canvas_id: canvasId,
    payload: {
      action: 'restore_canvas',
      canvas_id: canvasId,
      operation_id,
      expected_revision,
      detach_operation_id,
    },
  }
}

export function parsePromoteProjectReferenceRequest(body) {
  assertExactFields(body, PROMOTE_REFERENCE_KEYS, 'promote reference request')
  const operation_id = assertUuid(body.operation_id)
  const expected_revision = assertExpectedRevision(body.expected_revision)
  if (!isValidId(body.canvas_id)) throw spriteDocumentError('invalid_request', 'canvas_id is invalid')
  if (!isValidId(body.document_id)) throw spriteDocumentError('invalid_request', 'document_id is invalid')
  const working_revision = assertExpectedRevision(body.working_revision)
  if (!isValidId(body.frame_id)) throw spriteDocumentError('invalid_request', 'frame_id is invalid')
  const source_kind = body.source_kind == null ? (body.layer_id ? 'cel' : 'frame_composite') : body.source_kind
  if (!PROJECT_REFERENCE_SOURCE_KINDS.includes(source_kind)) {
    throw spriteDocumentError('invalid_request', 'source_kind must be frame_composite or cel')
  }
  const layer_id = body.layer_id == null ? null : body.layer_id
  if (source_kind === 'cel') {
    if (!isValidId(layer_id)) throw spriteDocumentError('invalid_request', 'layer_id is required for cel reference')
  } else if (layer_id !== null) {
    throw spriteDocumentError('invalid_request', 'layer_id must be omitted or null for frame_composite reference')
  }
  const purpose = body.purpose == null ? (source_kind === 'cel' ? 'cel' : 'frame') : body.purpose
  if (!PROJECT_REFERENCE_PURPOSES.includes(purpose)) {
    throw spriteDocumentError('invalid_request', `purpose must be one of ${PROJECT_REFERENCE_PURPOSES.join(', ')}`)
  }
  const name = optionalV1Name(body.name, null)
  return {
    operation_id,
    expected_revision,
    canvas_id: body.canvas_id,
    document_id: body.document_id,
    working_revision,
    frame_id: body.frame_id,
    layer_id,
    source_kind,
    purpose,
    name,
    payload: {
      action: 'promote_reference',
      operation_id,
      expected_revision,
      canvas_id: body.canvas_id,
      document_id: body.document_id,
      working_revision,
      frame_id: body.frame_id,
      layer_id,
      source_kind,
      purpose,
      name: name ?? null,
    },
  }
}

export function parseRevokeProjectReferenceRequest(body, referenceId) {
  assertExactFields(body, REVOKE_REFERENCE_KEYS, 'revoke reference request')
  if (!isValidId(referenceId)) throw spriteDocumentError('invalid_request', 'reference_id is invalid')
  const operation_id = assertUuid(body.operation_id)
  const expected_revision = assertExpectedRevision(body.expected_revision)
  return {
    operation_id,
    expected_revision,
    reference_id: referenceId,
    payload: {
      action: 'revoke_reference',
      operation_id,
      expected_revision,
      reference_id: referenceId,
    },
  }
}

export function parseProjectPaletteRequest(body) {
  const hasMulti = isPlainObject(body) && (Object.hasOwn(body, 'active_id') || Object.hasOwn(body, 'items'))
  assertExactFields(body, hasMulti ? ['operation_id', 'expected_revision', 'colors', 'active_id', 'items'] : ['operation_id', 'expected_revision', 'colors'], 'project palette request')
  const operation_id = assertUuid(body.operation_id)
  const expected_revision = assertExpectedRevision(body.expected_revision)
  if (Array.isArray(body.colors) && body.colors.length > 256) throw spriteDocumentError('resource_limit', 'palette exceeds 256 colors')
  if (!validPaletteColors(body.colors)) throw spriteDocumentError('invalid_request', 'colors must be RGBA byte tuples')
  const colors = body.colors.map(color => color.slice())
  if (!hasMulti) {
    return { operation_id, expected_revision, colors, payload: { action: 'project_palette', operation_id, expected_revision, colors } }
  }
  if (Array.isArray(body.items) && body.items.length > 16) throw spriteDocumentError('resource_limit', 'project exceeds 16 palettes')
  if (Array.isArray(body.items) && body.items.some(item => Array.isArray(item?.colors) && item.colors.length > 256)) {
    throw spriteDocumentError('resource_limit', 'palette exceeds 256 colors')
  }
  const candidate = { colors, active_id: body.active_id, items: body.items }
  if (!validProjectPalette(candidate)) throw spriteDocumentError('invalid_request', 'invalid project palette list')
  const items = body.items.map(item => ({ id: item.id, name: item.name.trim(), colors: item.colors.map(color => color.slice()) }))
  const active_id = body.active_id
  return {
    operation_id,
    expected_revision,
    colors,
    active_id,
    items,
    payload: { action: 'project_palette', operation_id, expected_revision, colors, active_id, items },
  }
}

export function parseCanvasLayoutRequest(body) {
  assertExactFields(body, CANVAS_LAYOUT_KEYS, 'canvas-layout request')
  const operation_id = assertUuid(body.operation_id)
  const expected_revision = assertExpectedRevision(body.expected_revision)
  if (!Array.isArray(body.positions) || !body.positions.length) {
    throw spriteDocumentError('invalid_request', 'positions must be a non-empty array')
  }
  if (body.positions.length > SPRITE_DOCUMENT_LIMITS.maxCanvasesOrDocuments) {
    throw spriteDocumentError('resource_limit', 'canvas layout exceeds 64 positions', {
      limit: SPRITE_DOCUMENT_LIMITS.maxCanvasesOrDocuments,
    })
  }
  const seen = new Set()
  const positions = body.positions.map((item, index) => {
    assertExactFields(item, CANVAS_POSITION_KEYS, `positions[${index}]`)
    if (!isValidId(item.canvas_id)) {
      throw spriteDocumentError('invalid_request', 'canvas_id is invalid')
    }
    if (seen.has(item.canvas_id)) {
      throw spriteDocumentError('invalid_request', 'positions has duplicate canvas_id')
    }
    seen.add(item.canvas_id)
    return {
      canvas_id: item.canvas_id,
      x: assertSafeInteger(item.x, 'x'),
      y: assertSafeInteger(item.y, 'y'),
    }
  })
  positions.sort((left, right) => left.canvas_id.localeCompare(right.canvas_id))
  return {
    operation_id,
    expected_revision,
    positions,
    payload: {
      action: 'save_canvas_layout',
      operation_id,
      expected_revision,
      positions,
    },
  }
}

function parseQueryInteger(searchParams, key, { minimum }) {
  const text = searchParams.get(key)
  if (!/^(0|[1-9][0-9]*)$/.test(text ?? '')) {
    throw spriteDocumentError('invalid_request', `${key} must be an integer`)
  }
  const value = Number(text)
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw spriteDocumentError('invalid_request', `${key} must be an integer`)
  }
  return value
}

export function parseDeriveWorkingRequest(body) {
  assertExactFields(body, DERIVE_WORKING_KEYS, 'derive-working request')
  const operation_id = assertUuid(body.operation_id)
  const expected_revision = assertExpectedRevision(body.expected_revision)
  if (!isValidId(body.source_canvas_id) || !isValidId(body.source_document_id)) {
    throw spriteDocumentError('invalid_request', 'source identity is invalid')
  }
  const source_revision = assertExpectedRevision(body.source_revision)
  const name = optionalV1Name(body.name, null)
  return {
    operation_id,
    expected_revision,
    source_canvas_id: body.source_canvas_id,
    source_document_id: body.source_document_id,
    source_revision,
    name,
    payload: {
      action: 'derive_working',
      operation_id,
      expected_revision,
      source_canvas_id: body.source_canvas_id,
      source_document_id: body.source_document_id,
      source_revision,
      name: body.name ?? null,
    },
  }
}

export function parseCreateBlankRequest(body) {
  assertExactFields(body, CREATE_BLANK_KEYS, 'blank-document request')
  const operation_id = assertUuid(body.operation_id)
  const expected_revision = assertExpectedRevision(body.expected_revision)
  const maxBlankEdge = SPRITE_DOCUMENT_LIMITS.maxBlankCanvasEdge ?? 1024
  for (const key of ['width', 'height']) {
    if (!Number.isSafeInteger(body[key]) || body[key] < 1) throw spriteDocumentError('invalid_request', `${key} must be a positive integer`)
    if (body[key] > maxBlankEdge) throw spriteDocumentError('resource_limit', 'canvas edge exceeds 1024')
  }
  const name = optionalV1Name(body.name, null)
  return { operation_id, expected_revision, width: body.width, height: body.height, name,
    payload: { action: 'create_blank', operation_id, expected_revision, width: body.width, height: body.height, name: body.name ?? null } }
}

export function parseRestoreWorkingRequest(body, documentId) {
  assertExactFields(body, RESTORE_WORKING_KEYS, 'restore-working request')
  if (!isValidId(documentId)) throw spriteDocumentError('invalid_request', 'document_id is invalid')
  const operation_id = assertUuid(body.operation_id)
  const expected_revision = assertExpectedRevision(body.expected_revision)
  const expected_working_revision = assertExpectedRevision(body.expected_working_revision)
  const target_revision = assertExpectedRevision(body.target_revision)
  if (Object.hasOwn(body, 'mode') && body.mode !== 'structure') throw spriteDocumentError('invalid_request', 'unsupported restore mode')
  return {
    operation_id,
    expected_revision,
    expected_working_revision,
    target_revision,
    ...(body.mode ? { mode: body.mode } : {}),
    payload: {
      action: 'restore_working',
      operation_id,
      expected_revision,
      expected_working_revision,
      document_id: documentId,
      target_revision,
      ...(body.mode ? { mode: body.mode } : {}),
    },
  }
}

export function parseWorkingStructureRequest(body, documentId) {
  assertExactFields(body, ['operation_id', 'expected_revision', 'expected_working_revision', 'command'], 'working-structure request')
  if (!isValidId(documentId)) throw spriteDocumentError('invalid_request', 'document_id is invalid')
  const operation_id = assertUuid(body.operation_id)
  const expected_revision = assertExpectedRevision(body.expected_revision)
  const expected_working_revision = assertExpectedRevision(body.expected_working_revision)
  try { validateStructureCommand(body.command) } catch (error) { throw spriteDocumentError('invalid_request', error.message) }
  return { operation_id, expected_revision, expected_working_revision, command: body.command,
    payload: { action: 'working_structure', document_id: documentId, operation_id, expected_revision, expected_working_revision, command: body.command } }
}

export function parseWorkingPixelsQuery(searchParams, encodedQuery = '', documentId) {
  const encoded = String(encodedQuery ?? '').replace(/^\?/, '')
  if (Buffer.byteLength(encoded, 'utf8') > SPRITE_DOCUMENT_LIMITS.maxQueryBytes) {
    throw spriteDocumentError('resource_limit', 'query string exceeds 2KiB', {
      limit: SPRITE_DOCUMENT_LIMITS.maxQueryBytes,
    })
  }
  if (!isValidId(documentId)) throw spriteDocumentError('invalid_request', 'document_id is invalid')
  const keys = collectSearchKeys(searchParams)
  const seen = new Set()
  for (const key of keys) {
    if (seen.has(key)) throw spriteDocumentError('invalid_request', 'working-pixels query has duplicate fields')
    seen.add(key)
    if (![...WORKING_PIXELS_QUERY_KEYS, 'frame_id', 'layer_id', 'cel_id', 'grant_id', 'command_sha256'].includes(key)) {
      throw spriteDocumentError('invalid_request', 'working-pixels query has unknown fields')
    }
  }
  for (const required of WORKING_PIXELS_QUERY_KEYS) {
    if (!seen.has(required)) throw spriteDocumentError('invalid_request', `${required} is required`)
  }
  const operation_id = assertUuid(searchParams.get('operation_id'))
  const expected_revision = parseQueryInteger(searchParams, 'expected_revision', { minimum: 1 })
  const expected_working_revision = parseQueryInteger(searchParams, 'expected_working_revision', { minimum: 1 })
  const x = parseQueryInteger(searchParams, 'x', { minimum: 0 })
  const y = parseQueryInteger(searchParams, 'y', { minimum: 0 })
  const w = parseQueryInteger(searchParams, 'w', { minimum: 1 })
  const h = parseQueryInteger(searchParams, 'h', { minimum: 1 })
  if (w > SPRITE_DOCUMENT_LIMITS.maxCanvasEdge || h > SPRITE_DOCUMENT_LIMITS.maxCanvasEdge) {
    throw spriteDocumentError('resource_limit', 'canvas edge exceeds 4096', {
      limit: SPRITE_DOCUMENT_LIMITS.maxCanvasEdge,
    })
  }
  const expected_sha256 = assertSha256Hex(searchParams.get('expected_sha256'), 'expected_sha256')
  const targets = ['frame_id', 'layer_id', 'cel_id']
  const hasTarget = targets.some(key => seen.has(key))
  if (hasTarget && targets.some(key => !isValidId(searchParams.get(key)))) throw spriteDocumentError('invalid_request', 'frame, layer and cel must be supplied together')
  const target = hasTarget ? Object.fromEntries(targets.map(key => [key, searchParams.get(key)])) : undefined
  const grant_id = searchParams.get('grant_id'), command_sha256 = searchParams.get('command_sha256')
  if ((seen.has('grant_id') || seen.has('command_sha256')) && (!target || !/^grant_[a-f0-9]{32}$/i.test(grant_id || '') || !isSha256Hex(command_sha256))) throw spriteDocumentError('invalid_request', 'grant and command hash require an explicit target')
  const scopeFields = { ...(target || {}), ...(grant_id ? { grant_id, command_sha256 } : {}) }
  return {
    operation_id,
    expected_revision,
    expected_working_revision,
    x,
    y,
    w,
    h,
    expected_sha256,
    ...scopeFields,
    payload: {
      action: 'working_pixels',
      operation_id,
      expected_revision,
      expected_working_revision,
      document_id: documentId,
      x,
      y,
      w,
      h,
      expected_sha256,
      ...scopeFields,
    },
  }
}

export function parseFromJobRequest(body) {
  assertExactFields(body, FROM_JOB_KEYS, 'from-job request')
  const operation_id = assertUuid(body.operation_id)
  const expected_revision = assertExpectedRevision(body.expected_revision)
  assertExactFields(body.source, FROM_JOB_SOURCE_KEYS, 'source')
  if (typeof body.source.job_id !== 'string' || !body.source.job_id || !isValidJobId(body.source.job_id)) {
    throw spriteDocumentError('invalid_request', 'job_id is invalid')
  }
  if (body.source.artifact !== 'sheet') {
    throw spriteDocumentError('invalid_request', 'artifact must be sheet')
  }
  const expected_sha256 = assertSha256Hex(body.source.expected_sha256, 'expected_sha256')
  const name = optionalV1Name(body.name, null)
  const source = {
    job_id: body.source.job_id,
    artifact: 'sheet',
    expected_sha256,
  }
  return {
    operation_id,
    expected_revision,
    source,
    name,
    payload: {
      operation_id,
      expected_revision,
      source,
      name: body.name ?? null,
    },
  }
}

export function parseCreateDocumentRequest(body) {
  assertExactFields(body, CREATE_DOCUMENT_KEYS, 'sprite-document request')
  const operation_id = assertUuid(body.operation_id)
  const expected_revision = assertExpectedRevision(body.expected_revision)
  assertExactFields(body.source, SOURCE_KEYS, 'source')
  if (!isValidId(body.source.asset_id)) throw spriteDocumentError('invalid_request', 'asset_id is invalid')
  if (!isValidId(body.source.revision_id)) throw spriteDocumentError('invalid_request', 'revision_id is invalid')
  if (typeof body.source.artifact !== 'string' || !/^[a-z][a-z0-9_]*$/.test(body.source.artifact)) {
    throw spriteDocumentError('invalid_request', 'artifact is invalid')
  }
  const expected_sha256 = assertSha256Hex(body.source.expected_sha256, 'expected_sha256')
  const name = optionalV1Name(body.name, null)
  const source = {
    asset_id: body.source.asset_id,
    revision_id: body.source.revision_id,
    artifact: body.source.artifact,
    expected_sha256,
  }
  return {
    operation_id,
    expected_revision,
    source,
    name,
    payload: {
      operation_id,
      expected_revision,
      source,
      name: body.name ?? null,
    },
  }
}

export function jsonByteLength(value) {
  return Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value), 'utf8')
}

export function assertJsonByteLimit(value, maxBytes, label) {
  const bytes = jsonByteLength(value)
  if (bytes > maxBytes) {
    throw spriteDocumentError('resource_limit', `${label} exceeds ${maxBytes} bytes`, {
      limit: maxBytes,
      bytes,
    })
  }
  return bytes
}

export function expandedRgbaBytes(cels = {}) {
  let total = 0
  for (const cel of Object.values(cels)) {
    if (!cel?.block) continue
    const width = cel.block.w
    const height = cel.block.h
    if (!isPositiveInteger(width) || !isPositiveInteger(height)) {
      throw spriteDocumentError('invalid_request', 'cel block size is invalid')
    }
    total += width * height * 4
  }
  return total
}

export function assertDocumentLimits(manifest) {
  const canvas = manifest?.canvas
  if (!isPositiveInteger(canvas?.w) || !isPositiveInteger(canvas?.h)) {
    throw spriteDocumentError('invalid_request', 'canvas size is invalid')
  }
  if (canvas.w > SPRITE_DOCUMENT_LIMITS.maxCanvasEdge || canvas.h > SPRITE_DOCUMENT_LIMITS.maxCanvasEdge) {
    throw spriteDocumentError('resource_limit', 'canvas edge exceeds 4096', {
      limit: SPRITE_DOCUMENT_LIMITS.maxCanvasEdge,
    })
  }
  const frameCount = manifest.frame_order?.length ?? 0
  const layerCount = manifest.layer_order?.length ?? 0
  const nonEmptyCels = Object.values(manifest.cels ?? {}).filter((cel) => cel?.block).length
  if (frameCount > SPRITE_DOCUMENT_LIMITS.maxFrames) {
    throw spriteDocumentError('resource_limit', 'frame count exceeds 256', { limit: SPRITE_DOCUMENT_LIMITS.maxFrames })
  }
  if (layerCount > SPRITE_DOCUMENT_LIMITS.maxLayers) {
    throw spriteDocumentError('resource_limit', 'layer count exceeds 32', { limit: SPRITE_DOCUMENT_LIMITS.maxLayers })
  }
  if (nonEmptyCels > SPRITE_DOCUMENT_LIMITS.maxNonEmptyCels) {
    throw spriteDocumentError('resource_limit', 'non-empty cel count exceeds 4096', {
      limit: SPRITE_DOCUMENT_LIMITS.maxNonEmptyCels,
    })
  }
  const expanded = expandedRgbaBytes(manifest.cels)
  if (expanded > SPRITE_DOCUMENT_LIMITS.maxExpandedRgbaBytes) {
    throw spriteDocumentError('resource_limit', 'expanded RGBA exceeds 128MiB', {
      limit: SPRITE_DOCUMENT_LIMITS.maxExpandedRgbaBytes,
      bytes: expanded,
    })
  }
}

function pushUnique(list, code) {
  if (!list.includes(code)) list.push(code)
}

function validateDerivedFrom(derivedFrom, errors) {
  if (derivedFrom == null) return
  const keys = ['document_id', 'revision', 'manifest_sha256']
  if (!isPlainObject(derivedFrom) || unknownKeys(derivedFrom, keys).length) {
    pushUnique(errors, 'invalid_derived_from')
    return
  }
  if (!isValidId(derivedFrom.document_id) || !isPositiveInteger(derivedFrom.revision) || !isSha256Hex(derivedFrom.manifest_sha256)) {
    pushUnique(errors, 'invalid_derived_from')
  }
}

function validateSourceRef(sourceRef, errors) {
  if (sourceRef == null) return
  if (!isPlainObject(sourceRef) || unknownKeys(sourceRef, SOURCE_KEYS).length) {
    pushUnique(errors, 'invalid_source_ref')
    return
  }
  if (!isValidId(sourceRef.asset_id) || !isValidId(sourceRef.revision_id)) pushUnique(errors, 'invalid_source_ref')
  if (typeof sourceRef.artifact !== 'string' || !sourceRef.artifact) pushUnique(errors, 'invalid_source_ref')
  if (!isSha256Hex(sourceRef.expected_sha256)) pushUnique(errors, 'invalid_source_ref')
}

export function validateSpriteDocument(manifest) {
  const errors = []
  if (!isPlainObject(manifest)) return { status: 'fail', blocking_errors: ['document_not_object'] }
  if (unknownKeys(manifest, V1_DOCUMENT_KEYS).length) pushUnique(errors, 'unknown_document_field')
  if (Object.hasOwn(manifest, 'origin') && (!isPlainObject(manifest.origin) || !isBlankSpriteDocument(manifest))) pushUnique(errors, 'invalid_document_origin')
  if (manifest.version !== SPRITE_DOCUMENT_VERSION) pushUnique(errors, 'unknown_document_version')
  if (!isValidId(manifest.document_id)) pushUnique(errors, 'malformed_document_id')
  if (!isValidId(manifest.project_id)) pushUnique(errors, 'malformed_project_id')
  if (typeof manifest.name !== 'string' || !manifest.name || manifest.name.length > SPRITE_DOCUMENT_LIMITS.maxNameLength) {
    pushUnique(errors, 'invalid_document_name')
  }
  if (!isPositiveInteger(manifest.revision)) pushUnique(errors, 'invalid_document_revision')
  if (manifest.parent_revision != null && !isPositiveInteger(manifest.parent_revision)) {
    pushUnique(errors, 'invalid_parent_revision')
  }
  if (manifest.parent_revision != null && manifest.parent_revision >= manifest.revision) {
    pushUnique(errors, 'invalid_parent_revision')
  }
  if (!isPositiveInteger(manifest.canvas?.w) || !isPositiveInteger(manifest.canvas?.h)) {
    pushUnique(errors, 'invalid_canvas')
  }
  if (
    manifest.color?.format !== 'rgba8'
    || manifest.color?.alpha !== 'straight'
    || manifest.color?.space !== 'srgb'
  ) {
    pushUnique(errors, 'invalid_color_contract')
  }
  if (!Array.isArray(manifest.frame_order) || !Array.isArray(manifest.layer_order)) {
    pushUnique(errors, 'invalid_document_order')
  }
  if (!isObjectMap(manifest.frames) || !isObjectMap(manifest.layers) || !isObjectMap(manifest.cels)) {
    pushUnique(errors, 'invalid_document_maps')
  }
  if (!Array.isArray(manifest.tags) || !Array.isArray(manifest.palette) || !Array.isArray(manifest.anchors)) {
    pushUnique(errors, 'invalid_document_extras')
  }

  for (const frameId of manifest.frame_order ?? []) {
    const frame = manifest.frames?.[frameId]
    if (!frame || frame.id !== frameId || !isValidId(frame.id)) pushUnique(errors, 'invalid_frame')
    if (!isNonNegativeInteger(frame?.duration_ms)) pushUnique(errors, 'invalid_frame_duration')
  }
  for (const [key, frame] of Object.entries(manifest.frames ?? {})) {
    if (key !== frame?.id || !manifest.frame_order?.includes(key)) pushUnique(errors, 'frame_order_mismatch')
  }
  for (const layerId of manifest.layer_order ?? []) {
    const layer = manifest.layers?.[layerId]
    if (!layer || layer.id !== layerId || !isValidId(layer.id)) pushUnique(errors, 'invalid_layer')
    if (typeof layer?.name !== 'string' || !layer.name) pushUnique(errors, 'invalid_layer')
    if (layer?.kind !== 'raster') pushUnique(errors, 'invalid_layer_kind')
    if (typeof layer?.visible !== 'boolean' || typeof layer?.locked !== 'boolean') pushUnique(errors, 'invalid_layer')
  }
  for (const [key, layer] of Object.entries(manifest.layers ?? {})) {
    if (key !== layer?.id || !manifest.layer_order?.includes(key)) pushUnique(errors, 'layer_order_mismatch')
  }
  for (const [key, cel] of Object.entries(manifest.cels ?? {})) {
    if (key !== cel?.id || !isValidId(cel?.id)) pushUnique(errors, 'invalid_cel')
    if (!manifest.frames?.[cel?.frame_id] || !manifest.layers?.[cel?.layer_id]) pushUnique(errors, 'invalid_cel_ref')
    if (cel?.block != null) {
      if (!isSha256Hex(cel.block.sha256) || !isPositiveInteger(cel.block.w) || !isPositiveInteger(cel.block.h)) {
        pushUnique(errors, 'invalid_cel_block')
      }
    }
  }
  validateSourceRef(manifest.source_ref, errors)
  try { assertPixelLinks(manifest) } catch { pushUnique(errors, 'invalid_links') }
  try { assertTextObjects(manifest) } catch { pushUnique(errors, 'invalid_text_objects') }
  try { assertPixelTags(manifest) } catch { pushUnique(errors, 'invalid_tags') }
  validateDerivedFrom(manifest.derived_from, errors)
  try {
    assertDocumentLimits(manifest)
  } catch (error) {
    pushUnique(errors, error.code === 'resource_limit' ? 'document_resource_limit' : 'invalid_document_limits')
  }
  try {
    assertJsonByteLimit(manifest, SPRITE_DOCUMENT_LIMITS.maxManifestBytes, 'manifest')
  } catch {
    pushUnique(errors, 'document_resource_limit')
  }
  return {
    status: errors.length ? 'fail' : 'pass',
    blocking_errors: errors,
  }
}

export function assertValidSpriteDocument(manifest) {
  const result = validateSpriteDocument(manifest)
  if (result.status === 'fail') {
    throw spriteDocumentError('invalid_request', `Invalid sprite document: ${result.blocking_errors.join(', ')}`)
  }
  return manifest
}

export { collectEditorProjectV1Errors } from './validation.js'

export function listSpriteDocumentAssetRefs(project, manifests = {}) {
  const usage = []
  for (const documentId of Object.keys(project?.sprite_documents ?? {})) {
    const manifest = manifests[documentId]
    const assetId = manifest?.source_ref?.asset_id
    if (assetId) usage.push({ document_id: documentId, asset_id: assetId })
  }
  return usage
}

export function durationFromFps(fps) {
  if (typeof fps !== 'number' || !Number.isFinite(fps) || fps <= 0) {
    throw spriteDocumentError('unsupported_input', 'source fps is not a verified positive number')
  }
  return Math.round(1000 / fps)
}
