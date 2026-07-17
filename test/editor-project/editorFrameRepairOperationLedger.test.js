import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  symlink,
  writeFile,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  createFrameRepairOperationLedger,
} from '../../src/editor-project/frameRepairOperationLedger.js'

const identity = Object.freeze({
  project_id: 'project_demo',
  asset_id: 'asset_hero',
  parent_revision_id: 'rev_003',
  operation_id: 'fr_0123456789abcdef',
  plan_hash: 'a'.repeat(64),
  job_id: 'job_frame_repair',
})

const lookup = Object.freeze({
  project_id: identity.project_id,
  asset_id: identity.asset_id,
  operation_id: identity.operation_id,
})

const recordKeys = Object.freeze([
  'version', 'project_id', 'asset_id', 'parent_revision_id', 'operation_id',
  'plan_hash', 'job_id', 'operation_status', 'job_status', 'provider_call_budget',
  'provider_calls_used', 'provider_outcome', 'created_at', 'updated_at', 'reason',
  'retry_hint', 'artifact_manifest_sha256',
])

function createLedger(workspaceRoot, now = '2026-07-11T00:00:00.000Z') {
  return createFrameRepairOperationLedger({ workspaceRoot, now: () => now })
}

function operationRecordPath(workspaceRoot, value = lookup) {
  const digest = createHash('sha256')
    .update(`${value.project_id}\0${value.asset_id}\0${value.operation_id}`, 'utf8')
    .digest('hex')
  return path.join(workspaceRoot, '.operations', 'frame-repair', `${digest}.json`)
}

async function reservedFixture(prefix = 'frame-ledger-fixture-') {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), prefix))
  const ledger = createLedger(workspaceRoot)
  const reserved = await ledger.reserve(identity)
  return {
    workspaceRoot,
    ledger,
    reserved,
    recordPath: operationRecordPath(workspaceRoot),
  }
}

async function dispatch(ledger) {
  return ledger.transition(lookup, {
    from: ['reserved'],
    operation_status: 'dispatched',
    job_status: 'generating',
    provider_calls_used: 1,
    provider_outcome: 'unknown',
  })
}

test('ledger create-exclusive reservation deduplicates concurrent first submit', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'frame-ledger-'))
  const ledger = createLedger(workspaceRoot)

  const [first, second] = await Promise.all([
    ledger.reserve(identity),
    ledger.reserve(identity),
  ])

  assert.equal(first.record.job_id, 'job_frame_repair')
  assert.equal(second.record.job_id, 'job_frame_repair')
  assert.equal([first.created, second.created].filter(Boolean).length, 1)
  await assert.rejects(
    () => ledger.reserve({ ...identity, plan_hash: 'b'.repeat(64) }),
    (error) => error?.code === 'operation_conflict',
  )
})

test('same operation and plan returns the create-exclusive winner when proposed job ids differ', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'frame-ledger-race-'))
  const ledger = createLedger(workspaceRoot)

  const [left, right] = await Promise.all([
    ledger.reserve({ ...identity, job_id: 'job_left' }),
    ledger.reserve({ ...identity, job_id: 'job_right' }),
  ])

  assert.equal(left.record.job_id, right.record.job_id)
  assert.equal([left.created, right.created].filter(Boolean).length, 1)
})

test('ledger restart recovers dispatched work as outcome unknown and never resets call count', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'frame-ledger-restart-'))
  const first = createLedger(workspaceRoot)
  await first.reserve(identity)
  await first.transition(lookup, {
    from: ['reserved'],
    operation_status: 'dispatched',
    job_status: 'generating',
    provider_calls_used: 1,
    provider_outcome: 'unknown',
  })

  const restarted = createLedger(workspaceRoot, '2026-07-11T00:01:00.000Z')
  const recovered = await restarted.recover(lookup)

  assert.equal(recovered.recovery_state, 'outcome_unknown')
  assert.equal(recovered.provider_calls_used, 1)
})

test('ledger persists only the exact private scalar schema at a direct digest path', async () => {
  const fixture = await reservedFixture()
  const stored = JSON.parse(await readFile(fixture.recordPath, 'utf8'))
  const fetched = await fixture.ledger.get(lookup)

  assert.deepEqual(Object.keys(stored), recordKeys)
  assert.match(path.basename(fixture.recordPath), /^[a-f0-9]{64}\.json$/)
  assert.equal(Object.isFrozen(fixture.reserved), true)
  assert.equal(Object.isFrozen(fixture.reserved.record), true)
  assert.equal(Object.isFrozen(fetched), true)
  for (const forbidden of [
    'instruction', 'prompt', 'mask', 'provider_key', 'runtime_preset',
    'source_path', 'project_json', 'raw_request',
  ]) {
    assert.equal(Object.hasOwn(stored, forbidden), false)
  }
})

test('ledger rejects symlinked workspace, managed directory, and record file', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'frame-ledger-links-'))
  const realWorkspace = path.join(root, 'real-workspace')
  const linkedWorkspace = path.join(root, 'linked-workspace')
  await mkdir(realWorkspace)
  await symlink(realWorkspace, linkedWorkspace, 'dir')
  await assert.rejects(
    () => createLedger(linkedWorkspace).reserve(identity),
    (error) => error?.code === 'unsafe_operation_ledger',
  )

  const managedWorkspace = await mkdtemp(path.join(os.tmpdir(), 'frame-ledger-managed-link-'))
  const outside = path.join(root, 'outside-operations')
  await mkdir(outside)
  await symlink(outside, path.join(managedWorkspace, '.operations'), 'dir')
  await assert.rejects(
    () => createLedger(managedWorkspace).reserve(identity),
    (error) => error?.code === 'unsafe_operation_ledger',
  )

  const fileWorkspace = await mkdtemp(path.join(os.tmpdir(), 'frame-ledger-file-link-'))
  const filePath = operationRecordPath(fileWorkspace)
  await mkdir(path.dirname(filePath), { recursive: true })
  const outsideFile = path.join(root, 'outside-record.json')
  await writeFile(outsideFile, '{}\n')
  await symlink(outsideFile, filePath)
  await assert.rejects(
    () => createLedger(fileWorkspace).get(lookup),
    (error) => error?.code === 'operation_record_invalid',
  )
})

test('get rejects malformed, oversized, unexpected, secret-shaped, and invalid scalar records', async () => {
  const mutations = [
    async (filePath) => writeFile(filePath, '{not-json\n'),
    async (filePath) => writeFile(filePath, Buffer.alloc(17 * 1024, 0x20)),
    async (filePath, record) => writeFile(filePath, `${JSON.stringify({ ...record, instruction: 'repair' })}\n`),
    async (filePath, record) => writeFile(filePath, `${JSON.stringify({ ...record, plan_hash: 'bad' })}\n`),
    async (filePath, record) => writeFile(filePath, `${JSON.stringify({ ...record, project_id: '../escape' })}\n`),
    async (filePath, record) => writeFile(filePath, `${JSON.stringify({ ...record, reason: 'Bearer private.token' })}\n`),
  ]
  for (const mutate of mutations) {
    const fixture = await reservedFixture('frame-ledger-invalid-')
    const record = JSON.parse(await readFile(fixture.recordPath, 'utf8'))
    await mutate(fixture.recordPath, record)
    await assert.rejects(
      () => fixture.ledger.get(lookup),
      (error) => error?.code === 'operation_record_invalid',
    )
  }
})

test('transition rejects stale from, unexpected fields, call rollback, and skipped provider outcome', async () => {
  const stale = await reservedFixture('frame-ledger-stale-')
  await assert.rejects(
    () => stale.ledger.transition(lookup, {
      from: ['post_processing'],
      operation_status: 'failed',
      job_status: 'failed_post_processing',
    }),
    (error) => error?.code === 'operation_conflict',
  )
  await assert.rejects(
    () => stale.ledger.transition(lookup, { from: ['reserved'], instruction: 'private' }),
    (error) => error?.code === 'invalid_operation_transition',
  )
  await assert.rejects(
    () => stale.ledger.transition(lookup, {
      from: ['reserved'],
      operation_status: 'dispatched',
      job_status: 'generating',
      provider_calls_used: 1,
      provider_outcome: 'known',
    }),
    (error) => error?.code === 'invalid_operation_transition',
  )

  const rollback = await reservedFixture('frame-ledger-rollback-')
  await dispatch(rollback.ledger)
  await assert.rejects(
    () => rollback.ledger.transition(lookup, {
      from: ['dispatched'],
      provider_calls_used: 0,
    }),
    (error) => ['invalid_operation_transition', 'operation_record_invalid'].includes(error?.code),
  )
  assert.equal((await rollback.ledger.get(lookup)).provider_calls_used, 1)
})

test('transition rejects path-shaped reason tokens without modifying the reserved winner', async () => {
  for (const reason of [
    'failed at (/Users/alice/private.png)',
    'source:/Users/alice/private.png',
    'source:/private.png',
    'failed at (/tmp)',
    String.raw`source:C:\Users\alice\private.png`,
  ]) {
    const fixture = await reservedFixture('frame-ledger-private-path-')
    await assert.rejects(
      () => fixture.ledger.transition(lookup, {
        from: ['reserved'],
        operation_status: 'failed',
        job_status: 'failed_post_processing',
        reason,
      }),
      (error) => error?.code === 'invalid_operation_transition',
    )
    const persisted = await fixture.ledger.get(lookup)
    assert.equal(persisted.operation_status, 'reserved')
    assert.equal(persisted.reason, null)
  }
})

test('serialized transitions produce one winner and leave no adjacent temporary records', async () => {
  const fixture = await reservedFixture('frame-ledger-transition-race-')
  const transition = () => dispatch(fixture.ledger)
  const settled = await Promise.allSettled([transition(), transition()])

  assert.equal(settled.filter((item) => item.status === 'fulfilled').length, 1)
  assert.equal(settled.filter((item) => item.status === 'rejected').length, 1)
  const record = await fixture.ledger.get(lookup)
  assert.equal(record.provider_calls_used, 1)
  assert.deepEqual(
    (await readdir(path.dirname(fixture.recordPath))).sort(),
    [path.basename(fixture.recordPath)],
  )
})

test('recover classifies zero-call interruption without mutating the reserved record', async () => {
  const fixture = await reservedFixture('frame-ledger-zero-call-')
  const recovered = await fixture.ledger.recover(lookup)

  assert.equal(recovered.recovery_state, 'interrupted_before_dispatch')
  assert.equal(recovered.job_status, 'failed_post_processing')
  assert.equal(recovered.reason, 'interrupted_before_dispatch')
  const persisted = await fixture.ledger.get(lookup)
  assert.equal(persisted.operation_status, 'reserved')
  assert.equal(persisted.job_status, 'queued')
  assert.equal(persisted.provider_calls_used, 0)
})

test('recover preserves done and known failed terminal records', async () => {
  const done = await reservedFixture('frame-ledger-done-')
  await dispatch(done.ledger)
  await done.ledger.transition(lookup, {
    from: ['dispatched'],
    operation_status: 'post_processing',
    job_status: 'post_processing',
    provider_outcome: 'known',
  })
  await done.ledger.transition(lookup, {
    from: ['post_processing'],
    operation_status: 'done',
    job_status: 'done',
    artifact_manifest_sha256: 'f'.repeat(64),
  })
  const recoveredDone = await done.ledger.recover(lookup)
  assert.equal(recoveredDone.recovery_state, 'terminal')
  assert.equal(recoveredDone.job_status, 'done')
  assert.equal(recoveredDone.artifact_manifest_sha256, 'f'.repeat(64))

  const failed = await reservedFixture('frame-ledger-failed-known-')
  await dispatch(failed.ledger)
  await failed.ledger.transition(lookup, {
    from: ['dispatched'],
    operation_status: 'failed',
    job_status: 'failed_model_error',
    provider_outcome: 'known',
    reason: 'provider_failed',
  })
  const recoveredFailed = await failed.ledger.recover(lookup)
  assert.equal(recoveredFailed.recovery_state, 'terminal')
  assert.equal(recoveredFailed.job_status, 'failed_model_error')
  assert.equal(recoveredFailed.provider_calls_used, 1)
})

test('recover marks uncertain failed and post-processing records outcome unknown', async () => {
  const uncertain = await reservedFixture('frame-ledger-failed-unknown-')
  await dispatch(uncertain.ledger)
  await uncertain.ledger.transition(lookup, {
    from: ['dispatched'],
    operation_status: 'failed',
    job_status: 'failed_model_error',
    reason: 'transport_outcome_unknown',
  })
  const recoveredFailure = await uncertain.ledger.recover(lookup)
  assert.equal(recoveredFailure.recovery_state, 'outcome_unknown')
  assert.equal(recoveredFailure.provider_outcome, 'unknown')

  const processing = await reservedFixture('frame-ledger-post-processing-')
  await dispatch(processing.ledger)
  await processing.ledger.transition(lookup, {
    from: ['dispatched'],
    operation_status: 'post_processing',
    job_status: 'post_processing',
    provider_outcome: 'known',
  })
  const recoveredProcessing = await processing.ledger.recover(lookup)
  assert.equal(recoveredProcessing.recovery_state, 'outcome_unknown')
  assert.equal(recoveredProcessing.job_status, 'post_processing')
  assert.equal(recoveredProcessing.provider_calls_used, 1)
})

test('missing direct lookup is not found and ledger source has no artifact-directory dependency', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'frame-ledger-missing-'))
  await assert.rejects(
    () => createLedger(workspaceRoot).get(lookup),
    (error) => error?.code === 'operation_not_found',
  )
  const source = await readFile(
    new URL('../../src/editor-project/frameRepairOperationLedger.js', import.meta.url),
    'utf8',
  )
  assert.doesNotMatch(source, /generated/)
})

test('invalid injected clock is normalized to a controlled ledger error', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'frame-ledger-clock-'))
  const ledger = createFrameRepairOperationLedger({
    workspaceRoot,
    now: () => new Date(Number.NaN),
  })
  await assert.rejects(
    () => ledger.reserve(identity),
    (error) => error?.code === 'operation_clock_invalid',
  )
})
