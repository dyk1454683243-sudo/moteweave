import { createHash, randomUUID } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import { lstat, mkdir, open, realpath, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { ID_PATTERN, JOB_ID_PATTERN } from './constants.js'
import { isFrameRepairOperationId } from './frameRepairProtocol.js'
import { isIsoTimestamp, isSecretLikeValue } from './safety.js'

const RECORD_VERSION = 'frame_repair_operation_v1'
const RECORD_KEYS = Object.freeze([
  'version',
  'project_id',
  'asset_id',
  'parent_revision_id',
  'operation_id',
  'plan_hash',
  'job_id',
  'operation_status',
  'job_status',
  'provider_call_budget',
  'provider_calls_used',
  'provider_outcome',
  'created_at',
  'updated_at',
  'reason',
  'retry_hint',
  'artifact_manifest_sha256',
])
const RESERVE_KEYS = Object.freeze([
  'project_id', 'asset_id', 'parent_revision_id', 'operation_id', 'plan_hash', 'job_id',
])
const LOOKUP_KEYS = Object.freeze(['project_id', 'asset_id', 'operation_id'])
const TRANSITION_FIELDS = new Set([
  'operation_status',
  'job_status',
  'provider_calls_used',
  'provider_outcome',
  'reason',
  'retry_hint',
  'artifact_manifest_sha256',
])
const OPERATION_STATUSES = new Set(['reserved', 'dispatched', 'post_processing', 'done', 'failed'])
const JOB_STATUSES = new Set([
  'queued',
  'generating',
  'post_processing',
  'done',
  'failed_model_error',
  'failed_post_processing',
  'failed_safety_filter',
])
const FAILURE_JOB_STATUSES = new Set([
  'failed_model_error', 'failed_post_processing', 'failed_safety_filter',
])
const PROVIDER_OUTCOMES = Object.freeze(['not_dispatched', 'unknown', 'known'])
const STATUS_TRANSITIONS = Object.freeze({
  reserved: new Set(['reserved', 'dispatched', 'failed']),
  dispatched: new Set(['dispatched', 'post_processing', 'failed']),
  post_processing: new Set(['post_processing', 'done', 'failed']),
})
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/
const DATA_URL_PATTERN = /data:[^,\s]*;base64,/i
const PATH_TOKEN_PATTERN = /(?:^|[^A-Za-z0-9])(?:~\/\S+|\/[^\s/]+(?:\/[^\s/]+)*|[A-Za-z]:[\\/]\S+|\\\\\S+)/
const MAX_RECORD_BYTES = 16 * 1024
const MAX_ID_LENGTH = 128
const MAX_SAFE_TEXT_LENGTH = 500
const NO_FOLLOW_FLAG = fsConstants.O_NOFOLLOW ?? 0
const recordMutationTails = new Map()

export class FrameRepairOperationLedgerError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'FrameRepairOperationLedgerError'
    this.code = code
  }
}

function ledgerError(code, message) {
  return new FrameRepairOperationLedgerError(code, message)
}

function fail(code, message) {
  throw ledgerError(code, message)
}

function isStrictPlainObject(value) {
  return Boolean(value) && typeof value === 'object' &&
    Object.getPrototypeOf(value) === Object.prototype
}

function hasExactKeys(value, expectedKeys) {
  if (!isStrictPlainObject(value)) return false
  const enumerableKeys = Object.keys(value)
  const ownKeys = Reflect.ownKeys(value)
  return enumerableKeys.length === expectedKeys.length && ownKeys.length === expectedKeys.length &&
    expectedKeys.every((key) => Object.hasOwn(value, key)) &&
    ownKeys.every((key) => typeof key === 'string')
}

function isDenseArray(value) {
  if (!Array.isArray(value) || Object.keys(value).length !== value.length ||
      Reflect.ownKeys(value).length !== value.length + 1) return false
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) return false
  }
  return true
}

function validId(value) {
  return typeof value === 'string' && value.length <= MAX_ID_LENGTH && ID_PATTERN.test(value)
}

function validJobId(value) {
  return typeof value === 'string' && value.length <= MAX_ID_LENGTH && JOB_ID_PATTERN.test(value)
}

function validNullableText(value) {
  if (value === null) return true
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_SAFE_TEXT_LENGTH &&
    value.trim() === value && !CONTROL_PATTERN.test(value) && !DATA_URL_PATTERN.test(value) &&
    !PATH_TOKEN_PATTERN.test(value) && !isSecretLikeValue(value)
}

function immutableRecord(record) {
  return Object.freeze(Object.fromEntries(RECORD_KEYS.map((key) => [key, record[key]])))
}

function validateLookup(value) {
  if (!hasExactKeys(value, LOOKUP_KEYS) || !validId(value.project_id) ||
      !validId(value.asset_id) || !isFrameRepairOperationId(value.operation_id)) {
    fail('invalid_operation_lookup', 'frame repair operation lookup is invalid')
  }
  return Object.freeze({
    project_id: value.project_id,
    asset_id: value.asset_id,
    operation_id: value.operation_id,
  })
}

function validateReserveIdentity(value) {
  if (!hasExactKeys(value, RESERVE_KEYS) || !validId(value.project_id) ||
      !validId(value.asset_id) || !validId(value.parent_revision_id) ||
      !isFrameRepairOperationId(value.operation_id) || !SHA256_PATTERN.test(value.plan_hash) ||
      !validJobId(value.job_id)) {
    fail('invalid_operation_identity', 'frame repair operation identity is invalid')
  }
  return Object.freeze(Object.fromEntries(RESERVE_KEYS.map((key) => [key, value[key]])))
}

function validRecordState(record) {
  if (record.provider_calls_used === 0 && record.provider_outcome !== 'not_dispatched') return false
  if (record.provider_calls_used === 1 && record.provider_outcome === 'not_dispatched') return false
  if (record.operation_status === 'reserved') {
    return record.job_status === 'queued' && record.provider_calls_used === 0 &&
      record.provider_outcome === 'not_dispatched' && record.artifact_manifest_sha256 === null
  }
  if (record.operation_status === 'dispatched') {
    return record.job_status === 'generating' && record.provider_calls_used === 1 &&
      record.artifact_manifest_sha256 === null
  }
  if (record.operation_status === 'post_processing') {
    return record.job_status === 'post_processing' && record.provider_calls_used === 1 &&
      record.provider_outcome === 'known' && record.artifact_manifest_sha256 === null
  }
  if (record.operation_status === 'done') {
    return record.job_status === 'done' && record.provider_calls_used === 1 &&
      record.provider_outcome === 'known' && SHA256_PATTERN.test(record.artifact_manifest_sha256)
  }
  if (record.operation_status === 'failed') {
    return FAILURE_JOB_STATUSES.has(record.job_status) && record.artifact_manifest_sha256 === null
  }
  return false
}

function validateRecord(value) {
  if (!hasExactKeys(value, RECORD_KEYS) || value.version !== RECORD_VERSION ||
      !validId(value.project_id) || !validId(value.asset_id) ||
      !validId(value.parent_revision_id) || !isFrameRepairOperationId(value.operation_id) ||
      !SHA256_PATTERN.test(value.plan_hash) || !validJobId(value.job_id) ||
      !OPERATION_STATUSES.has(value.operation_status) || !JOB_STATUSES.has(value.job_status) ||
      value.provider_call_budget !== 1 ||
      (value.provider_calls_used !== 0 && value.provider_calls_used !== 1) ||
      !PROVIDER_OUTCOMES.includes(value.provider_outcome) ||
      !isIsoTimestamp(value.created_at) || !isIsoTimestamp(value.updated_at) ||
      !validNullableText(value.reason) || !validNullableText(value.retry_hint) ||
      (value.artifact_manifest_sha256 !== null &&
        !SHA256_PATTERN.test(value.artifact_manifest_sha256)) ||
      !validRecordState(value)) {
    fail('operation_record_invalid', 'frame repair operation record is invalid')
  }
  return immutableRecord(value)
}

function normalizedTimestamp(now) {
  let value
  try {
    value = now()
    if (value instanceof Date) value = value.toISOString()
  } catch {
    fail('operation_clock_invalid', 'frame repair operation clock is invalid')
  }
  if (!isIsoTimestamp(value)) fail('operation_clock_invalid', 'frame repair operation clock is invalid')
  return value
}

function operationDigest({ project_id, asset_id, operation_id }) {
  return createHash('sha256')
    .update(`${project_id}\0${asset_id}\0${operation_id}`, 'utf8')
    .digest('hex')
}

function hasParentEscape(relative) {
  return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
}

async function inspectDirectory(directory, expectedParent = null) {
  let lexicalStats
  let realDirectory
  let realStats
  try {
    lexicalStats = await lstat(directory)
    if (lexicalStats.isSymbolicLink() || !lexicalStats.isDirectory()) {
      fail('unsafe_operation_ledger', 'operation ledger directory is unsafe')
    }
    realDirectory = await realpath(directory)
    realStats = await stat(realDirectory)
  } catch (error) {
    if (error?.code === 'unsafe_operation_ledger') throw error
    fail('unsafe_operation_ledger', 'operation ledger directory is unavailable')
  }
  if (!realStats.isDirectory() || lexicalStats.dev !== realStats.dev || lexicalStats.ino !== realStats.ino) {
    fail('unsafe_operation_ledger', 'operation ledger directory identity is unsafe')
  }
  if (expectedParent && path.dirname(realDirectory) !== expectedParent) {
    fail('unsafe_operation_ledger', 'operation ledger directory is not an immediate child')
  }
  return Object.freeze({ realPath: realDirectory, dev: realStats.dev, ino: realStats.ino })
}

async function ensureChildDirectory(parent, name) {
  const directory = path.join(parent.realPath, name)
  if (path.dirname(directory) !== parent.realPath) {
    fail('unsafe_operation_ledger', 'operation ledger directory is not an immediate child')
  }
  try {
    await mkdir(directory)
  } catch (error) {
    if (error?.code !== 'EEXIST') {
      fail('unsafe_operation_ledger', 'operation ledger directory could not be created')
    }
  }
  return inspectDirectory(directory, parent.realPath)
}

async function resolveLedgerRoot(workspaceRoot) {
  const workspace = await inspectDirectory(path.resolve(workspaceRoot))
  const operations = await ensureChildDirectory(workspace, '.operations')
  return ensureChildDirectory(operations, 'frame-repair')
}

function recordPathFor(root, lookup) {
  const filePath = path.join(root.realPath, `${operationDigest(lookup)}.json`)
  if (path.dirname(filePath) !== root.realPath) {
    fail('unsafe_operation_ledger', 'operation ledger record path is unsafe')
  }
  return filePath
}

function sameFileIdentity(left, right) {
  return Boolean(left && right) && left.dev === right.dev && left.ino === right.ino
}

async function readRecordFile(root, filePath, { missingCode = 'operation_not_found' } = {}) {
  let lexicalStats
  let realFile
  let handle
  try {
    lexicalStats = await lstat(filePath)
  } catch (error) {
    if (error?.code === 'ENOENT') fail(missingCode, 'frame repair operation was not found')
    fail('operation_record_invalid', 'frame repair operation record could not be inspected')
  }
  if (lexicalStats.isSymbolicLink() || !lexicalStats.isFile() ||
      lexicalStats.size < 1 || lexicalStats.size > MAX_RECORD_BYTES) {
    fail('operation_record_invalid', 'frame repair operation record is not a safe regular file')
  }
  try {
    realFile = await realpath(filePath)
    if (path.dirname(realFile) !== root.realPath || hasParentEscape(path.relative(root.realPath, realFile))) {
      fail('operation_record_invalid', 'frame repair operation record escaped its ledger root')
    }
    handle = await open(realFile, fsConstants.O_RDONLY | NO_FOLLOW_FLAG)
    const before = await handle.stat()
    if (!before.isFile() || before.size < 1 || before.size > MAX_RECORD_BYTES ||
        !sameFileIdentity(before, lexicalStats)) {
      fail('operation_record_invalid', 'frame repair operation record identity is invalid')
    }
    const content = await handle.readFile()
    const [after, finalLexical] = await Promise.all([handle.stat(), lstat(filePath)])
    if (finalLexical.isSymbolicLink() || !finalLexical.isFile() ||
        !sameFileIdentity(before, after) || !sameFileIdentity(before, finalLexical) ||
        before.size !== after.size || before.mtimeMs !== after.mtimeMs ||
        before.ctimeMs !== after.ctimeMs || content.length !== before.size) {
      fail('operation_record_invalid', 'frame repair operation record changed while reading')
    }
    await handle.close()
    handle = null
    let text
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(content)
    } catch {
      fail('operation_record_invalid', 'frame repair operation record encoding is invalid')
    }
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      fail('operation_record_invalid', 'frame repair operation record JSON is invalid')
    }
    return validateRecord(parsed)
  } catch (error) {
    if (error instanceof FrameRepairOperationLedgerError) throw error
    fail('operation_record_invalid', 'frame repair operation record could not be read')
  } finally {
    if (handle) {
      try {
        await handle.close()
      } catch {
        // The public error is normalized above.
      }
    }
  }
}

async function readReservationWinner(root, filePath) {
  let lastError
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      return await readRecordFile(root, filePath)
    } catch (error) {
      lastError = error
      if (error?.code !== 'operation_record_invalid') throw error
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
  }
  throw lastError
}

function assertRecordLookup(record, lookup) {
  if (record.project_id !== lookup.project_id || record.asset_id !== lookup.asset_id ||
      record.operation_id !== lookup.operation_id) {
    fail('operation_record_invalid', 'frame repair operation record identity does not match its digest')
  }
}

function serializedRecord(record) {
  const content = Buffer.from(`${JSON.stringify(record, null, 2)}\n`, 'utf8')
  if (content.length < 1 || content.length > MAX_RECORD_BYTES) {
    fail('operation_record_invalid', 'frame repair operation record is too large')
  }
  return content
}

async function replaceRecordAtomically(root, filePath, record) {
  const tempPath = `${filePath}.tmp-${process.pid}-${randomUUID()}`
  const content = serializedRecord(record)
  try {
    await writeFile(tempPath, content, { flag: 'wx', mode: 0o600 })
    const tempStats = await lstat(tempPath)
    const realTemp = await realpath(tempPath)
    if (tempStats.isSymbolicLink() || !tempStats.isFile() ||
        tempStats.size !== content.length || path.dirname(realTemp) !== root.realPath) {
      fail('operation_record_invalid', 'frame repair operation temporary record is unsafe')
    }
    await rename(tempPath, filePath)
  } catch (error) {
    if (error instanceof FrameRepairOperationLedgerError) throw error
    fail('operation_record_invalid', 'frame repair operation record could not be replaced')
  }
}

async function withRecordLock(key, task) {
  const previous = recordMutationTails.get(key) ?? Promise.resolve()
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const tail = previous.then(() => gate)
  recordMutationTails.set(key, tail)
  await previous
  try {
    return await task()
  } finally {
    release()
    if (recordMutationTails.get(key) === tail) recordMutationTails.delete(key)
  }
}

function validateTransitionPatch(value) {
  if (!isStrictPlainObject(value) || !Object.hasOwn(value, 'from')) {
    fail('invalid_operation_transition', 'frame repair operation transition is invalid')
  }
  const keys = Reflect.ownKeys(value)
  if (keys.some((key) => typeof key !== 'string') ||
      keys.some((key) => key !== 'from' && !TRANSITION_FIELDS.has(key)) ||
      Object.keys(value).length !== keys.length || keys.length < 2 ||
      !isDenseArray(value.from) || value.from.length === 0 ||
      value.from.some((status) => !OPERATION_STATUSES.has(status)) ||
      new Set(value.from).size !== value.from.length) {
    fail('invalid_operation_transition', 'frame repair operation transition is invalid')
  }
  return Object.freeze({
    from: Object.freeze([...value.from]),
    fields: Object.freeze(Object.fromEntries(
      Object.keys(value).filter((key) => key !== 'from').map((key) => [key, value[key]]),
    )),
  })
}

function validateTransitionSequence(current, next) {
  if (current.operation_status === 'done' || current.operation_status === 'failed' ||
      !STATUS_TRANSITIONS[current.operation_status]?.has(next.operation_status)) {
    fail('invalid_operation_transition', 'frame repair operation transition is not permitted')
  }
  if (next.provider_calls_used < current.provider_calls_used || next.provider_calls_used > 1) {
    fail('invalid_operation_transition', 'provider call accounting cannot move backward')
  }
  const currentOutcome = PROVIDER_OUTCOMES.indexOf(current.provider_outcome)
  const nextOutcome = PROVIDER_OUTCOMES.indexOf(next.provider_outcome)
  if (nextOutcome < currentOutcome || nextOutcome > currentOutcome + 1) {
    fail('invalid_operation_transition', 'provider outcome cannot move backward or skip state')
  }
}

function recoveryView(record) {
  if (record.operation_status === 'done' ||
      (record.operation_status === 'failed' && record.provider_outcome !== 'unknown')) {
    return Object.freeze({ ...record, recovery_state: 'terminal' })
  }
  if ((record.operation_status === 'failed' && record.provider_outcome === 'unknown') ||
      ((record.operation_status === 'dispatched' || record.operation_status === 'post_processing') &&
        record.provider_calls_used === 1)) {
    return Object.freeze({ ...record, recovery_state: 'outcome_unknown' })
  }
  if (record.operation_status === 'reserved' && record.provider_calls_used === 0) {
    return Object.freeze({
      ...record,
      job_status: 'failed_post_processing',
      reason: 'interrupted_before_dispatch',
      recovery_state: 'interrupted_before_dispatch',
    })
  }
  fail('operation_record_invalid', 'frame repair operation recovery state is invalid')
}

export function createFrameRepairOperationLedger({ workspaceRoot, now = () => new Date() } = {}) {
  if (typeof workspaceRoot !== 'string' || workspaceRoot.length === 0 || typeof now !== 'function') {
    fail('invalid_operation_ledger_config', 'frame repair operation ledger config is invalid')
  }

  async function get(lookupValue) {
    const lookup = validateLookup(lookupValue)
    const root = await resolveLedgerRoot(workspaceRoot)
    const filePath = recordPathFor(root, lookup)
    const record = await readRecordFile(root, filePath)
    assertRecordLookup(record, lookup)
    return record
  }

  async function reserve(identityValue) {
    const identity = validateReserveIdentity(identityValue)
    const root = await resolveLedgerRoot(workspaceRoot)
    const lookup = validateLookup({
      project_id: identity.project_id,
      asset_id: identity.asset_id,
      operation_id: identity.operation_id,
    })
    const filePath = recordPathFor(root, lookup)
    const timestamp = normalizedTimestamp(now)
    const record = validateRecord({
      version: RECORD_VERSION,
      ...identity,
      operation_status: 'reserved',
      job_status: 'queued',
      provider_call_budget: 1,
      provider_calls_used: 0,
      provider_outcome: 'not_dispatched',
      created_at: timestamp,
      updated_at: timestamp,
      reason: null,
      retry_hint: null,
      artifact_manifest_sha256: null,
    })
    try {
      await writeFile(filePath, serializedRecord(record), { flag: 'wx', mode: 0o600 })
      const persisted = await readRecordFile(root, filePath)
      assertRecordLookup(persisted, lookup)
      return Object.freeze({ created: true, record: persisted })
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        fail('operation_record_invalid', 'frame repair operation reservation could not be written')
      }
    }
    const winner = await readReservationWinner(root, filePath)
    if (winner.project_id !== identity.project_id || winner.asset_id !== identity.asset_id ||
        winner.parent_revision_id !== identity.parent_revision_id ||
        winner.operation_id !== identity.operation_id || winner.plan_hash !== identity.plan_hash) {
      fail('operation_conflict', 'frame repair operation identity conflicts with the winner')
    }
    return Object.freeze({ created: false, record: winner })
  }

  async function transition(lookupValue, patchValue) {
    const lookup = validateLookup(lookupValue)
    const patch = validateTransitionPatch(patchValue)
    const initialRoot = await resolveLedgerRoot(workspaceRoot)
    const lockKey = `${initialRoot.realPath}\0${operationDigest(lookup)}`
    return withRecordLock(lockKey, async () => {
      const root = await resolveLedgerRoot(workspaceRoot)
      const filePath = recordPathFor(root, lookup)
      const current = await readRecordFile(root, filePath)
      assertRecordLookup(current, lookup)
      if (!patch.from.includes(current.operation_status)) {
        fail('operation_conflict', 'frame repair operation status changed before transition')
      }
      const candidate = {
        ...current,
        ...patch.fields,
        updated_at: normalizedTimestamp(now),
      }
      validateTransitionSequence(current, candidate)
      let next
      try {
        next = validateRecord(candidate)
      } catch (error) {
        if (error?.code !== 'operation_record_invalid') throw error
        fail('invalid_operation_transition', 'frame repair operation transition fields are invalid')
      }
      await replaceRecordAtomically(root, filePath, next)
      const persisted = await readRecordFile(root, filePath)
      assertRecordLookup(persisted, lookup)
      return persisted
    })
  }

  async function recover(lookupValue) {
    return recoveryView(await get(lookupValue))
  }

  return Object.freeze({ reserve, transition, get, recover })
}
