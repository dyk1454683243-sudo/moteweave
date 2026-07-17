import test from 'node:test'
import assert from 'node:assert/strict'

import {
  canonicalizeMotionOperationOptions,
  createMotionSourceJobLifecycle,
  hashMotionOperationOptions,
  motionSourceCancellationPatch,
  MOTION_SOURCE_LIFECYCLE_SESSION_SCOPE,
} from '../../src/motion-source/jobLifecycle.js'

const SOURCE_IDENTITY = `sha256:${'a'.repeat(64)}`

function claim(lifecycle, overrides = {}) {
  return lifecycle.claimOperation({
    operationId: 'motion_operation_1',
    operationType: 'preview',
    sourceUploadId: 'motion_upload_1',
    sourceIdentity: SOURCE_IDENTITY,
    options: {
      maxFrames: 12,
      sampling: { fps: 8, stride: 2 },
    },
    createJob: () => ({ id: 'job_motion_1', status: 'queued' }),
    ...overrides,
  })
}

test('motion operation options hash is stable across object key order and preserves array order', () => {
  const first = {
    sampling: { stride: 2, fps: 8 },
    actions: ['walk_down', 'idle_down'],
  }
  const reordered = {
    actions: ['walk_down', 'idle_down'],
    sampling: { fps: 8, stride: 2 },
  }
  const changedOrder = {
    actions: ['idle_down', 'walk_down'],
    sampling: { fps: 8, stride: 2 },
  }

  assert.equal(
    canonicalizeMotionOperationOptions(first),
    canonicalizeMotionOperationOptions(reordered)
  )
  assert.equal(hashMotionOperationOptions(first), hashMotionOperationOptions(reordered))
  assert.notEqual(hashMotionOperationOptions(first), hashMotionOperationOptions(changedOrder))
  assert.match(hashMotionOperationOptions(first), /^sha256:[a-f0-9]{64}$/)
})

test('motion operation options reject cyclic, undefined, and non-finite values', () => {
  const cyclic = {}
  cyclic.self = cyclic
  for (const options of [
    cyclic,
    { value: undefined },
    { value: Number.NaN },
    { value: Number.POSITIVE_INFINITY },
  ]) {
    assert.throws(
      () => hashMotionOperationOptions(options),
      (error) => error?.code === 'invalid_operation_options'
    )
  }
})

test('same operation, source, and options recover the original job without duplicate creation', () => {
  const lifecycle = createMotionSourceJobLifecycle()
  let createCalls = 0
  const request = {
    operationId: 'motion_operation_idempotent',
    operationType: 'analyze',
    sourceUploadId: 'motion_upload_idempotent',
    sourceIdentity: SOURCE_IDENTITY,
    options: { maxFrames: 12, fps: 8 },
    createJob: () => {
      createCalls += 1
      return { id: 'job_motion_idempotent', status: 'queued' }
    },
  }
  const first = lifecycle.claimOperation(request)
  const replay = lifecycle.claimOperation(request)

  assert.equal(createCalls, 1)
  assert.equal(first.reused, false)
  assert.equal(replay.reused, true)
  assert.equal(replay.job_id, first.job_id)
  assert.equal(replay.operation_id, first.operation_id)
  assert.equal(replay.source_identity, first.source_identity)
  assert.equal(replay.options_hash, first.options_hash)
  assert.equal(replay.signal, first.signal)
  assert.equal(replay.session_scope, MOTION_SOURCE_LIFECYCLE_SESSION_SCOPE)
})

test('operation id reuse with conflicting source, upload, type, or options is rejected', () => {
  const lifecycle = createMotionSourceJobLifecycle()
  let createCalls = 0
  const createJob = () => {
    createCalls += 1
    return { id: `job_motion_conflict_${createCalls}`, status: 'queued' }
  }
  lifecycle.claimOperation({
    operationId: 'motion_operation_conflict',
    operationType: 'build',
    sourceUploadId: 'motion_upload_conflict',
    sourceIdentity: SOURCE_IDENTITY,
    options: { maxFrames: 8 },
    createJob,
  })
  const conflicts = [
    { operationType: 'preview' },
    { sourceUploadId: 'motion_upload_other' },
    { sourceIdentity: `sha256:${'b'.repeat(64)}` },
    { options: { maxFrames: 9 } },
  ]

  for (const patch of conflicts) {
    assert.throws(
      () => lifecycle.claimOperation({
        operationId: 'motion_operation_conflict',
        operationType: 'build',
        sourceUploadId: 'motion_upload_conflict',
        sourceIdentity: SOURCE_IDENTITY,
        options: { maxFrames: 8 },
        createJob,
        ...patch,
      }),
      (error) => error?.code === 'operation_conflict'
    )
  }
  assert.equal(createCalls, 1)
})

test('queued cancellation aborts before work and projects the canonical terminal patch', () => {
  const lifecycle = createMotionSourceJobLifecycle()
  const binding = claim(lifecycle)
  const cancelled = lifecycle.cancelJob(binding.job_id)

  assert.equal(binding.signal.aborted, true)
  assert.equal(cancelled.cancelled, true)
  assert.equal(cancelled.terminal, true)
  assert.deepEqual(cancelled.patch, motionSourceCancellationPatch())
  assert.deepEqual(cancelled.patch, {
    status: 'failed_post_processing',
    failure_status: 'cancelled',
    motion_source_lifecycle: 'cancelled',
    retry_hint: 'resume_with_new_operation',
    reason: 'motion_source_cancelled',
  })
  assert.throws(
    () => lifecycle.markActive(binding.job_id),
    (error) => (
      error?.code === 'cancelled' &&
      error?.status === 'failed_post_processing' &&
      error?.failure_status === 'cancelled' &&
      error?.motion_source_lifecycle === 'cancelled'
    )
  )
})

test('active cancellation reaches the operation AbortSignal and is idempotent', () => {
  const lifecycle = createMotionSourceJobLifecycle()
  const binding = claim(lifecycle, {
    operationId: 'motion_operation_active',
    sourceUploadId: 'motion_upload_active',
    createJob: () => ({ id: 'job_motion_active', status: 'queued' }),
  })
  lifecycle.markActive(binding.job_id)
  assert.equal(binding.signal.aborted, false)

  const first = lifecycle.cancelJob(binding.job_id)
  const second = lifecycle.cancelJob(binding.job_id)

  assert.equal(binding.signal.aborted, true)
  assert.equal(first.motion_source_lifecycle, 'cancelled')
  assert.deepEqual(second, first)
  assert.throws(
    () => lifecycle.throwIfCancelled(binding.job_id),
    (error) => error?.code === 'cancelled'
  )
})

test('cancelled lifecycle rejects failed or completed projections before store mutation', () => {
  const lifecycle = createMotionSourceJobLifecycle()
  const binding = claim(lifecycle, {
    operationId: 'motion_operation_projection',
    sourceUploadId: 'motion_upload_projection',
    createJob: () => ({ id: 'job_motion_projection', status: 'queued' }),
  })
  lifecycle.cancelJob(binding.job_id)

  for (const target of ['failed', 'completed', 'active']) {
    assert.throws(
      () => lifecycle.assertProjection(binding.job_id, target),
      (error) => error?.code === 'cancelled'
    )
  }
  assert.equal(
    lifecycle.assertProjection(binding.job_id, 'cancelled').motion_source_lifecycle,
    'cancelled'
  )
})

test('cancel does not relabel an already completed motion job', () => {
  const lifecycle = createMotionSourceJobLifecycle()
  const binding = claim(lifecycle, {
    operationId: 'motion_operation_completed',
    sourceUploadId: 'motion_upload_completed',
    createJob: () => ({ id: 'job_motion_completed', status: 'queued' }),
  })
  lifecycle.markActive(binding.job_id)
  lifecycle.markTerminal(binding.job_id, {
    lifecycle: 'completed',
    job: { id: binding.job_id, status: 'done' },
  })

  const result = lifecycle.cancelJob(binding.job_id)
  assert.equal(result.cancelled, false)
  assert.equal(result.terminal, true)
  assert.equal(result.motion_source_lifecycle, 'completed')
  assert.equal(result.patch, null)
  assert.equal(result.signal.aborted, false)
})

test('resume returns the exact job binding without enqueueing and rejects mismatches', () => {
  const lifecycle = createMotionSourceJobLifecycle()
  let createCalls = 0
  const binding = lifecycle.claimOperation({
    operationId: 'motion_operation_resume',
    operationType: 'build',
    sourceUploadId: 'motion_upload_resume',
    sourceIdentity: SOURCE_IDENTITY,
    options: { maxFrames: 8, selectionMode: 'auto' },
    createJob: () => {
      createCalls += 1
      return { id: 'job_motion_resume', status: 'queued' }
    },
  })
  const resumed = lifecycle.resumeJob({
    jobId: binding.job_id,
    operationId: binding.operation_id,
    sourceIdentity: binding.source_identity,
    optionsHash: binding.options_hash,
  })

  assert.equal(createCalls, 1)
  assert.equal(resumed.reused, true)
  assert.equal(resumed.job_id, binding.job_id)
  assert.equal(resumed.options_hash, binding.options_hash)
  for (const patch of [
    { operationId: 'motion_operation_other' },
    { sourceIdentity: `sha256:${'b'.repeat(64)}` },
    { optionsHash: `sha256:${'c'.repeat(64)}` },
  ]) {
    assert.throws(
      () => lifecycle.resumeJob({
        jobId: binding.job_id,
        operationId: binding.operation_id,
        sourceIdentity: binding.source_identity,
        optionsHash: binding.options_hash,
        ...patch,
      }),
      (error) => error?.code === 'operation_binding_mismatch'
    )
  }
})

test('cancelled operation replay returns the original cancelled job and requires a new operation to retry', () => {
  const lifecycle = createMotionSourceJobLifecycle()
  let createCalls = 0
  const request = {
    operationId: 'motion_operation_cancelled_replay',
    operationType: 'preview',
    sourceUploadId: 'motion_upload_cancelled_replay',
    sourceIdentity: SOURCE_IDENTITY,
    options: { maxFrames: 6 },
    createJob: () => {
      createCalls += 1
      return { id: 'job_motion_cancelled_replay', status: 'queued' }
    },
  }
  const binding = lifecycle.claimOperation(request)
  lifecycle.cancelJob(binding.job_id)
  const replay = lifecycle.claimOperation(request)

  assert.equal(createCalls, 1)
  assert.equal(replay.reused, true)
  assert.equal(replay.job_id, binding.job_id)
  assert.equal(replay.motion_source_lifecycle, 'cancelled')
  assert.equal(replay.signal.aborted, true)
})

test('a new lifecycle instance truthfully expires prior server-session operation handles', () => {
  const firstSession = createMotionSourceJobLifecycle()
  const binding = claim(firstSession, {
    operationId: 'motion_operation_session',
    sourceUploadId: 'motion_upload_session',
    createJob: () => ({ id: 'job_motion_session', status: 'queued' }),
  })
  const restartedSession = createMotionSourceJobLifecycle()

  assert.throws(
    () => restartedSession.resumeJob({
      jobId: binding.job_id,
      operationId: binding.operation_id,
      sourceIdentity: binding.source_identity,
      optionsHash: binding.options_hash,
    }),
    (error) => (
      error?.code === 'motion_job_not_found' &&
      error?.retry_hint === 'reupload_source'
    )
  )
  assert.throws(
    () => restartedSession.cancelJob(binding.job_id),
    (error) => error?.code === 'motion_job_not_found'
  )
})

test('lifecycle rejects non-Motion job ids and invalid source identities before registration', () => {
  const lifecycle = createMotionSourceJobLifecycle()
  assert.throws(
    () => lifecycle.cancelJob('job_unrelated'),
    (error) => error?.code === 'motion_job_not_found'
  )
  assert.throws(
    () => claim(lifecycle, {
      sourceIdentity: 'sha256:ABC',
    }),
    (error) => error?.code === 'invalid_source_identity'
  )
})
