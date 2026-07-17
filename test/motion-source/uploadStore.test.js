import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { access, mkdir, mkdtemp, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable, Writable } from 'node:stream'

import {
  createMotionSourceUploadStore,
  DEFAULT_MOTION_SOURCE_UPLOAD_LIMITS,
  DEFAULT_MOTION_SOURCE_UPLOAD_SESSION_LIMITS,
  MOTION_SOURCE_UPLOAD_SESSION_SCOPE,
} from '../../src/motion-source/uploadStore.js'

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const GIF_HEADER = Buffer.from('GIF89a', 'ascii')
const ZIP_HEADER = Buffer.from([0x50, 0x4b, 0x03, 0x04])

function png(payload = 'pixels') {
  return Buffer.concat([PNG_HEADER, Buffer.from(payload)])
}

function mp4(payload = 'video') {
  return Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x18]),
    Buffer.from('ftypisom', 'ascii'),
    Buffer.from(payload),
  ])
}

function ids(...values) {
  let index = 0
  return () => values[index++]
}

async function exists(filePath) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

test('motion upload store streams, hashes, resolves, and releases one server-owned source file', async () => {
  const spoolDir = await mkdtemp(path.join(os.tmpdir(), 'motion-upload-success-'))
  const bytes = mp4('bounded video bytes')
  const store = createMotionSourceUploadStore({
    spoolDir,
    idFactory: ids('motion_upload_success'),
  })

  const descriptor = await store.upload({
    stream: Readable.from([bytes.subarray(0, 7), bytes.subarray(7)]),
    sourceName: 'walk.mp4',
    contentType: 'video/mp4',
    contentLength: String(bytes.length),
    operationId: 'motion_upload_op_success',
  })

  assert.deepEqual(descriptor, {
    upload_id: 'motion_upload_success',
    operation_id: 'motion_upload_op_success',
    source_identity: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    source_name: 'walk.mp4',
    media_kind: 'video',
    byte_length: bytes.length,
    session_scope: MOTION_SOURCE_UPLOAD_SESSION_SCOPE,
  })
  assert.equal('source_path' in descriptor, false)
  const resolved = store.resolve(descriptor.upload_id, {
    expectedIdentity: descriptor.source_identity,
  })
  assert.equal(resolved.source_path, path.join(spoolDir, 'motion_upload_success.mp4'))
  assert.equal(await exists(resolved.source_path), true)
  assert.equal((await stat(spoolDir)).mode & 0o777, 0o700)
  assert.equal((await stat(resolved.source_path)).mode & 0o777, 0o600)
  assert.equal(
    store.descriptorForOperation(descriptor.operation_id).upload_id,
    descriptor.upload_id
  )
  assert.deepEqual(await store.release(descriptor.upload_id), {
    upload_id: descriptor.upload_id,
    released: true,
  })
  assert.equal(await exists(resolved.source_path), false)
  assert.equal(
    store.descriptorForOperation(descriptor.operation_id).upload_id,
    descriptor.upload_id
  )
})

test('motion upload store rejects declared overflow before creating an upload file', async () => {
  const spoolDir = await mkdtemp(path.join(os.tmpdir(), 'motion-upload-declared-limit-'))
  let idCalls = 0
  const store = createMotionSourceUploadStore({
    spoolDir,
    limits: { video: 12 },
    idFactory() {
      idCalls += 1
      return 'motion_upload_declared_limit'
    },
  })

  await assert.rejects(
    store.upload({
      stream: Readable.from([mp4()]),
      sourceName: 'walk.mp4',
      contentType: 'video/mp4',
      contentLength: 13,
      operationId: 'motion_upload_op_declared_limit',
    }),
    (error) => error?.code === 'upload_too_large' && error?.http_status === 413
  )
  assert.equal(idCalls, 0)
  assert.equal(
    await exists(path.join(spoolDir, 'motion_upload_declared_limit.mp4')),
    false
  )
})

test('motion upload store removes the explicit partial file after streamed overflow', async () => {
  const spoolDir = await mkdtemp(path.join(os.tmpdir(), 'motion-upload-stream-limit-'))
  const filePath = path.join(spoolDir, 'motion_upload_stream_limit.gif')
  const store = createMotionSourceUploadStore({
    spoolDir,
    limits: { gif: 10 },
    idFactory: ids('motion_upload_stream_limit'),
  })

  await assert.rejects(
    store.upload({
      stream: Readable.from([GIF_HEADER, Buffer.alloc(12, 1)]),
      sourceName: 'walk.gif',
      contentType: 'image/gif',
      operationId: 'motion_upload_op_stream_limit',
    }),
    (error) => error?.code === 'upload_too_large'
  )
  assert.equal(await exists(filePath), false)
})

test('motion upload store removes the explicit partial file after abort', async () => {
  const spoolDir = await mkdtemp(path.join(os.tmpdir(), 'motion-upload-abort-'))
  const filePath = path.join(spoolDir, 'motion_upload_abort.gif')
  const controller = new AbortController()
  const source = Readable.from((async function* uploadChunks() {
    yield GIF_HEADER
    controller.abort()
    yield Buffer.alloc(8, 2)
  })())
  const store = createMotionSourceUploadStore({
    spoolDir,
    idFactory: ids('motion_upload_abort'),
  })

  await assert.rejects(
    store.upload({
      stream: source,
      sourceName: 'walk.gif',
      contentType: 'image/gif',
      operationId: 'motion_upload_op_abort',
      signal: controller.signal,
    }),
    (error) => error?.code === 'upload_aborted'
  )
  assert.equal(await exists(filePath), false)
})

test('motion upload store removes one explicit partial file after a write failure', async () => {
  const spoolDir = await mkdtemp(path.join(os.tmpdir(), 'motion-upload-write-error-'))
  const filePath = path.join(spoolDir, 'motion_upload_write_error.png')
  const store = createMotionSourceUploadStore({
    spoolDir,
    idFactory: ids('motion_upload_write_error'),
    createOutputStream(targetPath) {
      return new Writable({
        write(chunk, _encoding, callback) {
          writeFile(targetPath, chunk)
            .then(() => callback(Object.assign(new Error('disk write failed'), { code: 'EIO' })))
            .catch(callback)
        },
      })
    },
  })

  await assert.rejects(
    store.upload({
      stream: Readable.from([png()]),
      sourceName: 'pose.png',
      contentType: 'image/png',
      operationId: 'motion_upload_op_write_error',
    }),
    (error) => error?.code === 'upload_write_failed'
  )
  assert.equal(await exists(filePath), false)
})

test('motion upload store rejects MIME, extension, and sniff disagreements', async () => {
  const spoolDir = await mkdtemp(path.join(os.tmpdir(), 'motion-upload-kind-mismatch-'))
  let idCalls = 0
  const store = createMotionSourceUploadStore({
    spoolDir,
    idFactory() {
      idCalls += 1
      return `motion_upload_kind_mismatch_${idCalls}`
    },
  })

  await assert.rejects(
    store.upload({
      stream: Readable.from([GIF_HEADER]),
      sourceName: 'walk.gif',
      contentType: 'video/mp4',
      operationId: 'motion_upload_op_mime_mismatch',
    }),
    (error) => error?.code === 'media_type_mismatch'
  )
  assert.equal(idCalls, 0)

  await assert.rejects(
    store.upload({
      stream: Readable.from([ZIP_HEADER, Buffer.alloc(12)]),
      sourceName: 'walk.gif',
      contentType: 'image/gif',
      operationId: 'motion_upload_op_sniff_mismatch',
    }),
    (error) => error?.code === 'media_type_mismatch'
  )
  assert.equal(
    await exists(path.join(spoolDir, 'motion_upload_kind_mismatch_1.gif')),
    false
  )
})

test('motion upload operation replay returns the original descriptor and rejects conflicting bytes', async () => {
  const spoolDir = await mkdtemp(path.join(os.tmpdir(), 'motion-upload-idempotency-'))
  const store = createMotionSourceUploadStore({
    spoolDir,
    idFactory: ids(
      'motion_upload_original',
      'motion_upload_duplicate',
      'motion_upload_conflict'
    ),
  })
  const request = {
    sourceName: 'pose.png',
    contentType: 'image/png',
    operationId: 'motion_upload_op_idempotent',
  }
  const original = await store.upload({
    ...request,
    stream: Readable.from([png('same')]),
  })
  const replay = await store.upload({
    ...request,
    stream: Readable.from([png('same')]),
  })

  assert.deepEqual(replay, original)
  assert.equal(
    await exists(path.join(spoolDir, 'motion_upload_duplicate.png')),
    false
  )
  await assert.rejects(
    store.upload({
      ...request,
      stream: Readable.from([png('different')]),
    }),
    (error) => error?.code === 'operation_conflict'
  )
  assert.equal(
    await exists(path.join(spoolDir, 'motion_upload_conflict.png')),
    false
  )
  await store.release(original.upload_id)
})

test('motion upload operation reserves an in-flight id before any filesystem await', async () => {
  const spoolDir = await mkdtemp(path.join(os.tmpdir(), 'motion-upload-in-flight-'))
  let releaseMkdir
  const mkdirGate = new Promise((resolve) => { releaseMkdir = resolve })
  const store = createMotionSourceUploadStore({
    spoolDir,
    idFactory: ids('motion_upload_in_flight'),
    async mkdirDirectory(...args) {
      await mkdirGate
      return mkdir(...args)
    },
  })
  const request = {
    sourceName: 'pose.png',
    contentType: 'image/png',
    operationId: 'motion_upload_op_in_flight',
  }
  const first = store.upload({
    ...request,
    stream: Readable.from([png('first')]),
  })

  await assert.rejects(
    store.upload({
      ...request,
      stream: Readable.from([png('first')]),
    }),
    (error) => error?.code === 'operation_in_progress' && error?.http_status === 409
  )
  releaseMkdir()
  const descriptor = await first
  assert.equal(store.stats().upload_count, 1)
  await store.release(descriptor.upload_id)
})

test('motion upload session quota is bounded and release restores one slot', async () => {
  const spoolDir = await mkdtemp(path.join(os.tmpdir(), 'motion-upload-session-quota-'))
  const store = createMotionSourceUploadStore({
    spoolDir,
    sessionLimits: {
      max_upload_count: 1,
      max_total_bytes: 64 * 1024 * 1024,
    },
    idFactory: ids('motion_upload_quota_a', 'motion_upload_quota_b'),
  })
  const first = await store.upload({
    stream: Readable.from([png('a')]),
    sourceName: 'a.png',
    contentType: 'image/png',
    operationId: 'motion_upload_op_quota_a',
  })
  await assert.rejects(
    store.upload({
      stream: Readable.from([png('b')]),
      sourceName: 'b.png',
      contentType: 'image/png',
      operationId: 'motion_upload_op_quota_b',
    }),
    (error) => error?.code === 'upload_session_capacity_exceeded' && error?.http_status === 507
  )
  await store.release(first.upload_id)
  const second = await store.upload({
    stream: Readable.from([png('b')]),
    sourceName: 'b.png',
    contentType: 'image/png',
    operationId: 'motion_upload_op_quota_b',
  })
  assert.equal(store.stats().upload_count, 1)
  await store.release(second.upload_id)
})

test('motion upload descriptor resolution rejects an identity mismatch', async () => {
  const spoolDir = await mkdtemp(path.join(os.tmpdir(), 'motion-upload-identity-'))
  const store = createMotionSourceUploadStore({
    spoolDir,
    idFactory: ids('motion_upload_identity'),
  })
  const descriptor = await store.upload({
    stream: Readable.from([png()]),
    sourceName: 'pose.png',
    contentType: 'application/octet-stream',
    operationId: 'motion_upload_op_identity',
  })

  assert.throws(
    () => store.resolve(descriptor.upload_id, {
      expectedIdentity: `sha256:${'0'.repeat(64)}`,
    }),
    (error) => error?.code === 'source_identity_mismatch'
  )
  assert.equal(
    store.resolve(descriptor.upload_id, {
      expectedIdentity: descriptor.source_identity,
    }).source_identity,
    descriptor.source_identity
  )
  await store.release(descriptor.upload_id)
})

test('a new upload store instance expires prior server-session handles', async () => {
  const spoolDir = await mkdtemp(path.join(os.tmpdir(), 'motion-upload-session-'))
  const firstSession = createMotionSourceUploadStore({
    spoolDir,
    idFactory: ids('motion_upload_session'),
  })
  const descriptor = await firstSession.upload({
    stream: Readable.from([png()]),
    sourceName: 'pose.png',
    contentType: 'image/png',
    operationId: 'motion_upload_op_session',
  })
  const restartedSession = createMotionSourceUploadStore({ spoolDir })

  assert.throws(
    () => restartedSession.resolve(descriptor.upload_id, {
      expectedIdentity: descriptor.source_identity,
    }),
    (error) => (
      error?.code === 'upload_not_found' &&
      error?.retry_hint === 'reupload_source'
    )
  )
  await firstSession.release(descriptor.upload_id)
})

test('motion upload release removes only the named file and keeps another descriptor usable', async () => {
  const spoolDir = await mkdtemp(path.join(os.tmpdir(), 'motion-upload-release-one-'))
  const store = createMotionSourceUploadStore({
    spoolDir,
    idFactory: ids('motion_upload_release_a', 'motion_upload_release_b'),
  })
  const first = await store.upload({
    stream: Readable.from([png('a')]),
    sourceName: 'a.png',
    contentType: 'image/png',
    operationId: 'motion_upload_op_release_a',
  })
  const second = await store.upload({
    stream: Readable.from([png('b')]),
    sourceName: 'b.png',
    contentType: 'image/png',
    operationId: 'motion_upload_op_release_b',
  })
  const firstPath = store.resolve(first.upload_id).source_path
  const secondPath = store.resolve(second.upload_id).source_path

  const concurrentRelease = await Promise.all([
    store.release(first.upload_id),
    store.release(first.upload_id),
  ])
  assert.equal(concurrentRelease.filter((result) => result.released).length, 1)
  assert.deepEqual(await store.release(first.upload_id), {
    upload_id: first.upload_id,
    released: false,
  })
  assert.equal(await exists(firstPath), false)
  assert.equal(await exists(secondPath), true)
  assert.equal(store.stats().total_bytes, second.byte_length)
  assert.equal(store.resolve(second.upload_id).source_identity, second.source_identity)
  await store.release(second.upload_id)
  assert.equal(await exists(secondPath), false)
})

test('motion upload limits expose the approved compressed byte ceilings', () => {
  assert.deepEqual(DEFAULT_MOTION_SOURCE_UPLOAD_LIMITS, {
    video: 200 * 1024 * 1024,
    gif: 64 * 1024 * 1024,
    frame_sequence_zip: 64 * 1024 * 1024,
    single_image: 32 * 1024 * 1024,
  })
  assert.deepEqual(DEFAULT_MOTION_SOURCE_UPLOAD_SESSION_LIMITS, {
    max_upload_count: 16,
    max_total_bytes: 512 * 1024 * 1024,
    max_operation_count: 1024,
  })
})
