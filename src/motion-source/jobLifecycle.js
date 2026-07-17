import { createHash } from 'node:crypto'

export const MOTION_SOURCE_LIFECYCLE_SESSION_SCOPE = 'current_server_process'
export const MOTION_SOURCE_CANCELLED_STATUS = 'failed_post_processing'
export const MOTION_SOURCE_CANCELLED_FAILURE_STATUS = 'cancelled'
export const DEFAULT_MOTION_SOURCE_OPERATION_LIMIT = 1024

const TERMINAL_LIFECYCLES = new Set(['completed', 'failed', 'cancelled'])

export class MotionSourceLifecycleError extends Error {
  constructor(code, message = code, {
    httpStatus = 400,
    retryHint = null,
    details = null,
    patch = null,
  } = {}) {
    super(message)
    this.name = 'MotionSourceLifecycleError'
    this.code = code
    this.status = patch?.status ?? code
    this.failure_status = patch?.failure_status ?? code
    this.http_status = httpStatus
    this.retry_hint = patch?.retry_hint ?? retryHint
    if (patch?.motion_source_lifecycle) {
      this.motion_source_lifecycle = patch.motion_source_lifecycle
    }
    if (patch?.reason) this.reason = patch.reason
    if (details) this.details = details
  }
}

function lifecycleError(code, message, options) {
  return new MotionSourceLifecycleError(code, message, options)
}

function normalizeIdentifier(value, name) {
  const identifier = String(value || '').trim()
  if (
    !identifier ||
    identifier.length > 200 ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(identifier)
  ) {
    throw lifecycleError(`invalid_${name}`, `${name} is required and must be a safe identifier`)
  }
  return identifier
}

function normalizeSourceIdentity(value) {
  const identity = String(value || '').trim()
  if (!/^sha256:[a-f0-9]{64}$/.test(identity)) {
    throw lifecycleError(
      'invalid_source_identity',
      'source_identity must be sha256 followed by 64 lowercase hexadecimal characters'
    )
  }
  return identity
}

function canonicalJsonValue(value, seen, path) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw lifecycleError('invalid_operation_options', `non-finite number at ${path}`)
    }
    return Object.is(value, -0) ? 0 : value
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw lifecycleError('invalid_operation_options', `cyclic options at ${path}`)
    seen.add(value)
    const normalized = value.map((item, index) => {
      if (item === undefined) {
        throw lifecycleError('invalid_operation_options', `undefined option at ${path}[${index}]`)
      }
      return canonicalJsonValue(item, seen, `${path}[${index}]`)
    })
    seen.delete(value)
    return normalized
  }
  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw lifecycleError('invalid_operation_options', `non-plain option object at ${path}`)
    }
    if (seen.has(value)) throw lifecycleError('invalid_operation_options', `cyclic options at ${path}`)
    seen.add(value)
    const normalized = {}
    for (const key of Object.keys(value).sort()) {
      if (value[key] === undefined) {
        throw lifecycleError('invalid_operation_options', `undefined option at ${path}.${key}`)
      }
      normalized[key] = canonicalJsonValue(value[key], seen, `${path}.${key}`)
    }
    seen.delete(value)
    return normalized
  }
  throw lifecycleError('invalid_operation_options', `unsupported option value at ${path}`)
}

export function canonicalizeMotionOperationOptions(options = {}) {
  return JSON.stringify(canonicalJsonValue(options, new Set(), '$'))
}

export function hashMotionOperationOptions(options = {}) {
  return `sha256:${createHash('sha256')
    .update(canonicalizeMotionOperationOptions(options))
    .digest('hex')}`
}

function bindingFingerprint({
  operationType,
  sourceUploadId,
  sourceIdentity,
  optionsHash,
}) {
  return createHash('sha256')
    .update(JSON.stringify({
      operation_type: operationType,
      source_upload_id: sourceUploadId,
      source_identity: sourceIdentity,
      options_hash: optionsHash,
    }))
    .digest('hex')
}

export function motionSourceCancellationPatch(reason = 'motion_source_cancelled') {
  return {
    status: MOTION_SOURCE_CANCELLED_STATUS,
    failure_status: MOTION_SOURCE_CANCELLED_FAILURE_STATUS,
    motion_source_lifecycle: 'cancelled',
    retry_hint: 'resume_with_new_operation',
    reason,
  }
}

function cancelledError(record) {
  const patch = motionSourceCancellationPatch()
  return lifecycleError('cancelled', 'motion source operation was cancelled', {
    httpStatus: 409,
    patch,
    details: {
      job_id: record.job_id,
      operation_id: record.operation_id,
    },
  })
}

function publicBinding(record, { reused = false } = {}) {
  return {
    operation_id: record.operation_id,
    operation_type: record.operation_type,
    source_upload_id: record.source_upload_id,
    source_identity: record.source_identity,
    options_hash: record.options_hash,
    job_id: record.job_id,
    job: { ...record.job },
    motion_source_lifecycle: record.lifecycle,
    session_scope: MOTION_SOURCE_LIFECYCLE_SESSION_SCOPE,
    reused,
    signal: record.controller.signal,
  }
}

export function createMotionSourceJobLifecycle({
  now = () => new Date().toISOString(),
  createAbortController = () => new AbortController(),
  maxOperations = DEFAULT_MOTION_SOURCE_OPERATION_LIMIT,
} = {}) {
  if (!Number.isSafeInteger(maxOperations) || maxOperations <= 0) {
    throw lifecycleError('invalid_motion_operation_limit', 'maxOperations must be a positive safe integer', {
      httpStatus: 500,
    })
  }
  const operations = new Map()
  const jobs = new Map()

  function jobRecord(jobId) {
    const key = String(jobId || '')
    const record = jobs.get(key)
    if (!record) {
      throw lifecycleError(
        'motion_job_not_found',
        'motion source job is unavailable in this server session',
        {
          httpStatus: 404,
          retryHint: 'reupload_source',
          details: { job_id: key || null },
        }
      )
    }
    return record
  }

  function claimOperation({
    operationId,
    operationType,
    sourceUploadId,
    sourceIdentity,
    options = {},
    createJob,
  } = {}) {
    const normalizedOperationId = normalizeIdentifier(operationId, 'operation_id')
    const normalizedOperationType = normalizeIdentifier(operationType, 'operation_type')
    const normalizedUploadId = normalizeIdentifier(sourceUploadId, 'source_upload_id')
    const normalizedIdentity = normalizeSourceIdentity(sourceIdentity)
    const optionsHash = hashMotionOperationOptions(options)
    const fingerprint = bindingFingerprint({
      operationType: normalizedOperationType,
      sourceUploadId: normalizedUploadId,
      sourceIdentity: normalizedIdentity,
      optionsHash,
    })
    const existing = operations.get(normalizedOperationId)
    if (existing) {
      if (existing.binding_fingerprint !== fingerprint) {
        throw lifecycleError(
          'operation_conflict',
          'operation_id was already used with a different source or options',
          {
            httpStatus: 409,
            details: {
              operation_id: normalizedOperationId,
              job_id: existing.job_id,
              options_hash: existing.options_hash,
            },
          }
        )
      }
      return publicBinding(existing, { reused: true })
    }
    if (operations.size >= maxOperations) {
      throw lifecycleError(
        'motion_operation_capacity_exceeded',
        'motion source operation capacity is exhausted for this server session',
        {
          httpStatus: 507,
          retryHint: 'restart_server_session',
          details: {
            operation_count: operations.size,
            max_operation_count: maxOperations,
          },
        }
      )
    }
    if (typeof createJob !== 'function') {
      throw lifecycleError('job_factory_required', 'createJob must be a synchronous function', {
        httpStatus: 500,
      })
    }
    const job = createJob()
    if (job && typeof job.then === 'function') {
      throw lifecycleError('async_job_factory_not_supported', 'createJob must return synchronously', {
        httpStatus: 500,
      })
    }
    const jobId = normalizeIdentifier(job?.id, 'job_id')
    if (jobs.has(jobId)) {
      throw lifecycleError('motion_job_conflict', 'job id is already bound to a motion operation', {
        httpStatus: 409,
      })
    }
    const timestamp = now()
    const record = {
      operation_id: normalizedOperationId,
      operation_type: normalizedOperationType,
      source_upload_id: normalizedUploadId,
      source_identity: normalizedIdentity,
      options_hash: optionsHash,
      binding_fingerprint: fingerprint,
      job_id: jobId,
      job: { ...job },
      lifecycle: 'queued',
      controller: createAbortController(),
      created_at: timestamp,
      updated_at: timestamp,
    }
    operations.set(normalizedOperationId, record)
    jobs.set(jobId, record)
    return publicBinding(record)
  }

  function getOperation(operationId) {
    const record = operations.get(String(operationId || ''))
    return record ? publicBinding(record) : null
  }

  function getJobBinding(jobId) {
    const record = jobs.get(String(jobId || ''))
    return record ? publicBinding(record) : null
  }

  function hasNonTerminalUploadReferences(uploadId) {
    const key = String(uploadId || '')
    for (const record of operations.values()) {
      if (
        record.source_upload_id === key &&
        !TERMINAL_LIFECYCLES.has(record.lifecycle)
      ) return true
    }
    return false
  }

  function markActive(jobId) {
    const record = jobRecord(jobId)
    if (record.lifecycle === 'cancelled' || record.controller.signal.aborted) {
      throw cancelledError(record)
    }
    if (TERMINAL_LIFECYCLES.has(record.lifecycle)) {
      throw lifecycleError('motion_job_not_active', 'terminal motion job cannot become active', {
        httpStatus: 409,
        details: { job_id: record.job_id, lifecycle: record.lifecycle },
      })
    }
    record.lifecycle = 'active'
    record.updated_at = now()
    return publicBinding(record)
  }

  function throwIfCancelled(jobId) {
    const record = jobRecord(jobId)
    if (record.lifecycle === 'cancelled' || record.controller.signal.aborted) {
      throw cancelledError(record)
    }
    return publicBinding(record)
  }

  function assertProjection(jobId, lifecycle) {
    const record = jobRecord(jobId)
    const target = String(lifecycle || record.lifecycle)
    if (record.lifecycle === 'cancelled' && target !== 'cancelled') {
      throw cancelledError(record)
    }
    if (
      ['completed', 'failed'].includes(record.lifecycle) &&
      target !== record.lifecycle
    ) {
      throw lifecycleError(
        'motion_job_terminal',
        'terminal motion source lifecycle cannot be overwritten',
        {
          httpStatus: 409,
          details: {
            job_id: record.job_id,
            lifecycle: record.lifecycle,
            requested_lifecycle: target,
          },
        }
      )
    }
    return publicBinding(record)
  }

  function updateJobSnapshot(jobId, job) {
    const record = jobRecord(jobId)
    if (!job || job.id !== record.job_id) {
      throw lifecycleError('job_snapshot_mismatch', 'job snapshot does not match the operation binding', {
        httpStatus: 409,
      })
    }
    record.job = { ...job }
    record.updated_at = now()
    return publicBinding(record)
  }

  function markTerminal(jobId, {
    lifecycle = 'completed',
    job = null,
  } = {}) {
    const record = jobRecord(jobId)
    if (!['completed', 'failed'].includes(lifecycle)) {
      throw lifecycleError('invalid_terminal_lifecycle', 'terminal lifecycle must be completed or failed')
    }
    if (record.lifecycle === 'cancelled') return publicBinding(record)
    if (job) {
      if (job.id !== record.job_id) {
        throw lifecycleError('job_snapshot_mismatch', 'job snapshot does not match the operation binding', {
          httpStatus: 409,
        })
      }
      record.job = { ...job }
    }
    record.lifecycle = lifecycle
    record.updated_at = now()
    return publicBinding(record)
  }

  function cancelJob(jobId) {
    const record = jobRecord(jobId)
    if (record.lifecycle === 'cancelled') {
      return {
        ...publicBinding(record),
        cancelled: true,
        terminal: true,
        patch: motionSourceCancellationPatch(),
      }
    }
    if (TERMINAL_LIFECYCLES.has(record.lifecycle)) {
      return {
        ...publicBinding(record),
        cancelled: false,
        terminal: true,
        patch: null,
      }
    }
    record.lifecycle = 'cancelled'
    record.updated_at = now()
    record.controller.abort(cancelledError(record))
    return {
      ...publicBinding(record),
      cancelled: true,
      terminal: true,
      patch: motionSourceCancellationPatch(),
    }
  }

  function resumeJob({
    jobId,
    operationId,
    sourceIdentity,
    optionsHash = null,
  } = {}) {
    const record = jobRecord(jobId)
    const normalizedOperationId = normalizeIdentifier(operationId, 'operation_id')
    const normalizedIdentity = normalizeSourceIdentity(sourceIdentity)
    if (
      record.operation_id !== normalizedOperationId ||
      record.source_identity !== normalizedIdentity ||
      (optionsHash !== null && record.options_hash !== optionsHash)
    ) {
      throw lifecycleError(
        'operation_binding_mismatch',
        'resume request does not match the original motion operation',
        {
          httpStatus: 409,
          details: {
            job_id: record.job_id,
            operation_id: record.operation_id,
            source_identity: record.source_identity,
            options_hash: record.options_hash,
          },
        }
      )
    }
    return publicBinding(record, { reused: true })
  }

  return {
    claimOperation,
    getOperation,
    getJobBinding,
    hasNonTerminalUploadReferences,
    markActive,
    throwIfCancelled,
    assertProjection,
    updateJobSnapshot,
    markTerminal,
    cancelJob,
    resumeJob,
    hashOptions: hashMotionOperationOptions,
    max_operations: maxOperations,
    session_scope: MOTION_SOURCE_LIFECYCLE_SESSION_SCOPE,
  }
}
