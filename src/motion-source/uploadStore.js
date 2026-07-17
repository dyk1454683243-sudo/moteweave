import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { chmod, mkdir, unlink } from 'node:fs/promises'
import path from 'node:path'
import { Transform, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const MIB = 1024 * 1024
const SNIFF_BYTE_LIMIT = 32
const GENERIC_CONTENT_TYPES = new Set(['', 'application/octet-stream'])

export const MOTION_SOURCE_UPLOAD_SESSION_SCOPE = 'current_server_process'

export const DEFAULT_MOTION_SOURCE_UPLOAD_LIMITS = Object.freeze({
  video: 200 * MIB,
  gif: 64 * MIB,
  frame_sequence_zip: 64 * MIB,
  single_image: 32 * MIB,
})

export const DEFAULT_MOTION_SOURCE_UPLOAD_SESSION_LIMITS = Object.freeze({
  max_upload_count: 16,
  max_total_bytes: 512 * MIB,
  max_operation_count: 1024,
})

const EXTENSION_MEDIA_KINDS = Object.freeze({
  '.gif': 'gif',
  '.zip': 'frame_sequence_zip',
  '.png': 'single_image',
  '.jpg': 'single_image',
  '.jpeg': 'single_image',
  '.webp': 'single_image',
  '.bmp': 'single_image',
  '.mp4': 'video',
  '.mov': 'video',
  '.webm': 'video',
  '.mkv': 'video',
  '.avi': 'video',
  '.m4v': 'video',
})

const CONTENT_TYPE_MEDIA_KINDS = Object.freeze({
  'image/gif': 'gif',
  'application/zip': 'frame_sequence_zip',
  'application/x-zip-compressed': 'frame_sequence_zip',
  'image/png': 'single_image',
  'image/jpeg': 'single_image',
  'image/jpg': 'single_image',
  'image/webp': 'single_image',
  'image/bmp': 'single_image',
  'image/x-ms-bmp': 'single_image',
})

export class MotionSourceUploadError extends Error {
  constructor(code, message = code, {
    httpStatus = 400,
    retryHint = null,
    details = null,
    cause = null,
  } = {}) {
    super(message)
    this.name = 'MotionSourceUploadError'
    this.code = code
    this.status = code
    this.failure_status = code
    this.http_status = httpStatus
    this.retry_hint = retryHint
    if (details) this.details = details
    if (cause) this.cause = cause
  }
}

function uploadError(code, message, options) {
  return new MotionSourceUploadError(code, message, options)
}

function normalizedContentType(value) {
  return String(value || '').split(';', 1)[0].trim().toLowerCase()
}

function sourceExtension(sourceName) {
  return path.extname(sourceName).toLowerCase()
}

function normalizeSourceName(value) {
  const sourceName = String(value || '').trim()
  if (
    !sourceName ||
    sourceName.length > 255 ||
    sourceName === '.' ||
    sourceName === '..' ||
    sourceName.includes('/') ||
    sourceName.includes('\\') ||
    sourceName.includes('\0')
  ) {
    throw uploadError('invalid_source_name', 'motion source name must be one safe file name')
  }
  return sourceName
}

function normalizeOperationId(value) {
  const operationId = String(value || '').trim()
  if (
    !operationId ||
    operationId.length > 160 ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(operationId)
  ) {
    throw uploadError('invalid_operation_id', 'operation_id is required and must be a safe identifier')
  }
  return operationId
}

function normalizeUploadId(value) {
  const uploadId = String(value || '').trim()
  if (!/^motion_upload_[A-Za-z0-9_-]+$/.test(uploadId)) {
    throw uploadError('invalid_upload_id', 'generated upload id is invalid', { httpStatus: 500 })
  }
  return uploadId
}

function normalizeDeclaredLength(value) {
  if (value === undefined || value === null || value === '') return null
  const text = String(value).trim()
  if (!/^\d+$/.test(text)) {
    throw uploadError('invalid_content_length', 'content length must be a non-negative integer')
  }
  const length = Number(text)
  if (!Number.isSafeInteger(length) || length < 0) {
    throw uploadError('invalid_content_length', 'content length is outside the supported integer range')
  }
  return length
}

function normalizeLimits(overrides = {}) {
  const limits = {}
  for (const [kind, fallback] of Object.entries(DEFAULT_MOTION_SOURCE_UPLOAD_LIMITS)) {
    const value = overrides[kind] ?? fallback
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw uploadError('invalid_upload_limit', `invalid upload limit for ${kind}`, { httpStatus: 500 })
    }
    limits[kind] = value
  }
  return Object.freeze(limits)
}

function normalizeSessionLimits(overrides = {}) {
  const limits = {}
  for (const [name, fallback] of Object.entries(DEFAULT_MOTION_SOURCE_UPLOAD_SESSION_LIMITS)) {
    const value = overrides[name] ?? fallback
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw uploadError('invalid_upload_session_limit', `invalid upload session limit: ${name}`, {
        httpStatus: 500,
      })
    }
    limits[name] = value
  }
  return Object.freeze(limits)
}

function contentTypeMediaKind(contentType) {
  if (GENERIC_CONTENT_TYPES.has(contentType)) return null
  if (contentType.startsWith('video/')) return 'video'
  return CONTENT_TYPE_MEDIA_KINDS[contentType] ?? 'unsupported'
}

function claimedMedia({ sourceName, contentType }) {
  const extension = sourceExtension(sourceName)
  const extensionKind = EXTENSION_MEDIA_KINDS[extension]
  if (!extensionKind) {
    throw uploadError('unsupported_motion_source_type', `unsupported motion source extension: ${extension || 'none'}`, {
      httpStatus: 415,
    })
  }
  const mimeKind = contentTypeMediaKind(contentType)
  if (mimeKind === 'unsupported') {
    throw uploadError('unsupported_media_type', `unsupported motion source content type: ${contentType}`, {
      httpStatus: 415,
    })
  }
  if (mimeKind && mimeKind !== extensionKind) {
    throw uploadError('media_type_mismatch', 'motion source extension and content type disagree', {
      httpStatus: 415,
      details: {
        extension_kind: extensionKind,
        content_type_kind: mimeKind,
      },
    })
  }
  return { extension, mediaKind: extensionKind }
}

function hasBytes(buffer, bytes, offset = 0) {
  if (buffer.length < offset + bytes.length) return false
  return bytes.every((byte, index) => buffer[offset + index] === byte)
}

export function sniffMotionSourceMediaKind(buffer) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer ?? [])
  if (
    hasBytes(bytes, [0x50, 0x4b, 0x03, 0x04]) ||
    hasBytes(bytes, [0x50, 0x4b, 0x05, 0x06]) ||
    hasBytes(bytes, [0x50, 0x4b, 0x07, 0x08])
  ) {
    return 'frame_sequence_zip'
  }
  if (
    bytes.length >= 6 &&
    (bytes.subarray(0, 6).toString('ascii') === 'GIF87a' ||
      bytes.subarray(0, 6).toString('ascii') === 'GIF89a')
  ) {
    return 'gif'
  }
  if (hasBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'single_image'
  }
  if (hasBytes(bytes, [0xff, 0xd8, 0xff])) return 'single_image'
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'single_image'
  }
  if (hasBytes(bytes, [0x42, 0x4d])) return 'single_image'
  if (bytes.length >= 12 && bytes.subarray(4, 8).toString('ascii') === 'ftyp') {
    return 'video'
  }
  if (hasBytes(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return 'video'
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'AVI '
  ) {
    return 'video'
  }
  return null
}

function publicDescriptor(record) {
  return {
    upload_id: record.upload_id,
    operation_id: record.operation_id,
    source_identity: record.source_identity,
    source_name: record.source_name,
    media_kind: record.media_kind,
    byte_length: record.byte_length,
    session_scope: MOTION_SOURCE_UPLOAD_SESSION_SCOPE,
  }
}

function operationFingerprint(descriptor) {
  return JSON.stringify({
    source_identity: descriptor.source_identity,
    source_name: descriptor.source_name,
    media_kind: descriptor.media_kind,
    byte_length: descriptor.byte_length,
  })
}

async function unlinkOne(filePath, unlinkFile) {
  try {
    await unlinkFile(filePath)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

function defaultUploadId() {
  return `motion_upload_${randomUUID().replaceAll('-', '')}`
}

function ensureReadableStream(stream) {
  if (
    !stream ||
    (typeof stream.pipe !== 'function' && typeof stream[Symbol.asyncIterator] !== 'function')
  ) {
    throw uploadError('invalid_upload_stream', 'motion source upload requires a readable stream')
  }
  return stream
}

function createInspectionTransform({
  claimedKind,
  maxBytes,
  onProgress,
}) {
  let byteLength = 0
  let sniffBytes = Buffer.alloc(0)
  let sniffedKind = null
  const hash = createHash('sha256')

  const inspect = (chunk) => {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    const nextLength = byteLength + bytes.length
    if (!Number.isSafeInteger(nextLength) || nextLength > maxBytes) {
      throw uploadError('upload_too_large', `motion source exceeds the ${maxBytes} byte limit`, {
        httpStatus: 413,
        details: { limit: maxBytes, actual: nextLength, media_kind: claimedKind },
      })
    }
    byteLength = nextLength
    hash.update(bytes)
    if (sniffBytes.length < SNIFF_BYTE_LIMIT) {
      const remaining = SNIFF_BYTE_LIMIT - sniffBytes.length
      sniffBytes = Buffer.concat([sniffBytes, bytes.subarray(0, remaining)])
    }
    if (!sniffedKind) {
      sniffedKind = sniffMotionSourceMediaKind(sniffBytes)
      if (sniffedKind && sniffedKind !== claimedKind) {
        throw uploadError('media_type_mismatch', 'motion source signature disagrees with its extension or content type', {
          httpStatus: 415,
          details: { claimed_kind: claimedKind, sniffed_kind: sniffedKind },
        })
      }
      if (!sniffedKind && sniffBytes.length >= SNIFF_BYTE_LIMIT) {
        throw uploadError('corrupt_or_unsupported_source', 'motion source signature is unsupported', {
          httpStatus: 415,
        })
      }
    }
    onProgress({ byteLength, sniffedKind })
    return bytes
  }

  const finish = () => {
    if (!byteLength) {
      throw uploadError('empty_motion_source', 'motion source upload is empty', { httpStatus: 400 })
    }
    sniffedKind ||= sniffMotionSourceMediaKind(sniffBytes)
    if (!sniffedKind) {
      throw uploadError('corrupt_or_unsupported_source', 'motion source signature is unsupported', {
        httpStatus: 415,
      })
    }
    if (sniffedKind !== claimedKind) {
      throw uploadError('media_type_mismatch', 'motion source signature disagrees with its extension or content type', {
        httpStatus: 415,
        details: { claimed_kind: claimedKind, sniffed_kind: sniffedKind },
      })
    }
    return {
      byteLength,
      sniffedKind,
      sourceIdentity: `sha256:${hash.digest('hex')}`,
    }
  }

  const transform = new Transform({
    transform(chunk, _encoding, callback) {
      try {
        callback(null, inspect(chunk))
      } catch (error) {
        callback(error)
      }
    },
  })

  return { transform, finish }
}

export function createMotionSourceUploadStore({
  spoolDir,
  limits = {},
  sessionLimits = {},
  idFactory = defaultUploadId,
  createOutputStream = (filePath) => createWriteStream(filePath, { flags: 'wx', mode: 0o600 }),
  mkdirDirectory = mkdir,
  chmodPath = chmod,
  unlinkFile = unlink,
} = {}) {
  if (!spoolDir) throw uploadError('upload_store_path_required', 'spoolDir is required', { httpStatus: 500 })
  const rootDir = path.resolve(String(spoolDir))
  const byteLimits = normalizeLimits(limits)
  const capacityLimits = normalizeSessionLimits(sessionLimits)
  const uploads = new Map()
  const operations = new Map()
  let totalBytes = 0
  let activeWrites = 0
  let reservedBytes = 0

  function capacityError(details) {
    return uploadError(
      'upload_session_capacity_exceeded',
      'motion source upload session capacity is exhausted',
      {
        httpStatus: 507,
        retryHint: 'reuse_existing_upload_or_restart_server',
        details: {
          max_upload_count: capacityLimits.max_upload_count,
          max_total_bytes: capacityLimits.max_total_bytes,
          max_operation_count: capacityLimits.max_operation_count,
          upload_count: uploads.size,
          operation_count: operations.size,
          active_writes: activeWrites,
          total_bytes: totalBytes,
          reserved_bytes: reservedBytes,
          ...details,
        },
      }
    )
  }

  function reserveWrite(maxBytes) {
    if (uploads.size + activeWrites >= capacityLimits.max_upload_count) {
      throw capacityError({ requested_reservation_bytes: maxBytes })
    }
    if (totalBytes + reservedBytes + maxBytes > capacityLimits.max_total_bytes) {
      throw capacityError({ requested_reservation_bytes: maxBytes })
    }
    activeWrites += 1
    reservedBytes += maxBytes
    let released = false
    return () => {
      if (released) return
      released = true
      activeWrites -= 1
      reservedBytes -= maxBytes
    }
  }

  async function upload({
    stream,
    sourceName,
    contentType = 'application/octet-stream',
    contentLength = null,
    operationId,
    signal,
    allowReleasedReplay = false,
  } = {}) {
    ensureReadableStream(stream)
    const normalizedName = normalizeSourceName(sourceName)
    const normalizedOperationId = normalizeOperationId(operationId)
    const normalizedType = normalizedContentType(contentType)
    const { extension, mediaKind } = claimedMedia({
      sourceName: normalizedName,
      contentType: normalizedType,
    })
    const declaredLength = normalizeDeclaredLength(contentLength)
    const maxBytes = byteLimits[mediaKind]
    if (declaredLength !== null && declaredLength > maxBytes) {
      throw uploadError('upload_too_large', `declared motion source length exceeds the ${maxBytes} byte limit`, {
        httpStatus: 413,
        details: { limit: maxBytes, actual: declaredLength, media_kind: mediaKind },
      })
    }
    if (signal?.aborted) {
      throw uploadError('upload_aborted', 'motion source upload was aborted', {
        httpStatus: 499,
        retryHint: 'retry_upload',
      })
    }

    const priorOperation = operations.get(normalizedOperationId)
    if (priorOperation?.state === 'pending') {
      throw uploadError('operation_in_progress', 'operation_id upload is already in progress', {
        httpStatus: 409,
        retryHint: 'retry_same_operation',
      })
    }
    if (priorOperation?.released && !allowReleasedReplay) {
      throw uploadError('upload_released', 'the upload for this operation has already been released', {
        httpStatus: 410,
        retryHint: 'upload_with_new_operation',
      })
    }

    const pendingOperation = priorOperation
      ? null
      : { state: 'pending', operation_id: normalizedOperationId }
    if (pendingOperation && operations.size >= capacityLimits.max_operation_count) {
      throw capacityError({ requested_operation_id: normalizedOperationId })
    }
    if (pendingOperation) operations.set(normalizedOperationId, pendingOperation)

    const verificationOnly = Boolean(priorOperation)
    let releaseReservation = () => {}
    if (!verificationOnly) {
      try {
        releaseReservation = reserveWrite(maxBytes)
      } catch (error) {
        if (pendingOperation && operations.get(normalizedOperationId) === pendingOperation) {
          operations.delete(normalizedOperationId)
        }
        throw error
      }
    }

    let uploadId = verificationOnly ? priorOperation.record.upload_id : null
    let sourcePath = null
    let progress = { byteLength: 0, sniffedKind: null }
    const inspection = createInspectionTransform({
      claimedKind: mediaKind,
      maxBytes,
      onProgress(next) {
        progress = next
      },
    })

    try {
      if (!verificationOnly) {
        uploadId = normalizeUploadId(idFactory())
        sourcePath = path.join(rootDir, `${uploadId}${extension}`)
        await mkdirDirectory(rootDir, { recursive: true, mode: 0o700 })
        await chmodPath(rootDir, 0o700)
      }
      await pipeline(
        stream,
        inspection.transform,
        verificationOnly
          ? new Writable({ write(_chunk, _encoding, callback) { callback() } })
          : createOutputStream(sourcePath),
        ...(signal ? [{ signal }] : [])
      )
      const completed = inspection.finish()
      progress = {
        byteLength: completed.byteLength,
        sniffedKind: completed.sniffedKind,
      }
      const record = {
        upload_id: uploadId,
        operation_id: normalizedOperationId,
        source_identity: completed.sourceIdentity,
        source_name: normalizedName,
        media_kind: completed.sniffedKind,
        byte_length: completed.byteLength,
        content_type: normalizedType || 'application/octet-stream',
        source_path: sourcePath ?? priorOperation.record.source_path,
      }
      const fingerprint = operationFingerprint(record)
      const existingOperation = priorOperation
      if (existingOperation) {
        if (existingOperation.fingerprint !== fingerprint) {
          throw uploadError('operation_conflict', 'operation_id was already used for a different upload', {
            httpStatus: 409,
          })
        }
        if (
          !allowReleasedReplay &&
          (
            existingOperation.released ||
            existingOperation.record.releasing_promise ||
            uploads.get(existingOperation.record.upload_id) !== existingOperation.record
          )
        ) {
          throw uploadError('upload_released', 'the upload for this operation has already been released', {
            httpStatus: 410,
            retryHint: 'upload_with_new_operation',
          })
        }
        return publicDescriptor(existingOperation.record)
      }
      uploads.set(uploadId, record)
      operations.set(normalizedOperationId, {
        state: 'complete',
        fingerprint,
        record,
        released: false,
      })
      totalBytes += record.byte_length
      return publicDescriptor(record)
    } catch (error) {
      if (pendingOperation && operations.get(normalizedOperationId) === pendingOperation) {
        operations.delete(normalizedOperationId)
      }
      if (sourcePath) {
        try {
          await unlinkOne(sourcePath, unlinkFile)
        } catch (cleanupError) {
          throw uploadError('upload_cleanup_failed', 'failed to remove the explicit partial upload file', {
            httpStatus: 500,
            cause: cleanupError,
          })
        }
      }
      if (error instanceof MotionSourceUploadError) throw error
      if (signal?.aborted || error?.name === 'AbortError' || error?.code === 'ABORT_ERR') {
        throw uploadError('upload_aborted', 'motion source upload was aborted', {
          httpStatus: 499,
          retryHint: 'retry_upload',
          cause: error,
        })
      }
      throw uploadError('upload_write_failed', 'motion source upload stream could not be written', {
        httpStatus: 500,
        retryHint: 'retry_upload',
        details: {
          partial_byte_length: progress.byteLength,
          sniffed_kind: progress.sniffedKind,
        },
        cause: error,
      })
    } finally {
      releaseReservation()
    }
  }

  function descriptor(uploadId) {
    const record = uploads.get(String(uploadId || ''))
    return record && !record.releasing_promise ? publicDescriptor(record) : null
  }

  function descriptorForOperation(operationId) {
    const operation = operations.get(String(operationId || ''))
    if (operation?.state !== 'complete' || !operation.record) return null
    return publicDescriptor(operation.record)
  }

  function resolve(uploadId, { expectedIdentity } = {}) {
    const record = uploads.get(String(uploadId || ''))
    if (!record || record.releasing_promise) {
      throw uploadError('upload_not_found', 'motion source upload is unavailable in this server session', {
        httpStatus: 404,
        retryHint: 'reupload_source',
      })
    }
    if (expectedIdentity !== undefined && expectedIdentity !== record.source_identity) {
      throw uploadError('source_identity_mismatch', 'motion source identity does not match the upload descriptor', {
        httpStatus: 409,
        retryHint: 'reupload_source',
        details: {
          expected: expectedIdentity,
          actual: record.source_identity,
        },
      })
    }
    return {
      ...publicDescriptor(record),
      content_type: record.content_type,
      source_path: record.source_path,
    }
  }

  async function release(uploadId) {
    const key = String(uploadId || '')
    const record = uploads.get(key)
    if (!record) return { upload_id: key || null, released: false }
    if (record.releasing_promise) {
      await record.releasing_promise
      return { upload_id: key, released: false }
    }
    record.releasing_promise = (async () => {
      await unlinkOne(record.source_path, unlinkFile)
      if (uploads.get(key) === record) {
        uploads.delete(key)
        totalBytes = Math.max(0, totalBytes - record.byte_length)
      }
      const operation = operations.get(record.operation_id)
      if (operation?.record.upload_id === key) operation.released = true
    })()
    try {
      await record.releasing_promise
      return { upload_id: key, released: true }
    } finally {
      record.releasing_promise = null
    }
  }

  return {
    upload,
    descriptor,
    descriptorForOperation,
    resolve,
    release,
    limits: byteLimits,
    session_limits: capacityLimits,
    stats() {
      return {
        upload_count: uploads.size,
        active_writes: activeWrites,
        total_bytes: totalBytes,
        reserved_bytes: reservedBytes,
        operation_count: operations.size,
        limits: capacityLimits,
      }
    },
    session_scope: MOTION_SOURCE_UPLOAD_SESSION_SCOPE,
  }
}
