import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import {
  fetchImageArtifact,
  fetchJsonArtifact,
  pollMotionSourceJob,
  releaseMotionSourceUpload,
  releaseMotionSourceUploadOperation,
  uploadMotionSource,
  waitForMotionSourceJob,
} from '../src/ui/motionSource/api.js'
import { serializeMotionPixelGridRecipe } from '../src/ui/motionSource/optionsModel.js'

test('Studio Action exposes the maintained Motion workflow and bindings', async () => {
  const [html, view, api, guidedState, options, css] = await Promise.all([
    readFile('src/ui/studio/studio.html', 'utf8'),
    readFile('src/ui/studio/actionView.js', 'utf8'),
    readFile('src/ui/motionSource/api.js', 'utf8'),
    readFile('src/ui/motionSource/guidedState.js', 'utf8'),
    readFile('src/ui/motionSource/optionsModel.js', 'utf8'),
    readFile('src/ui/studio/studio.css', 'utf8'),
  ])

  assert.match(html, /id="studio-action-view"/)
  assert.match(html, /href="#action" data-studio-route="action"/)
  assert.match(view, /uploadMotionSource/)
  assert.match(view, /previewMotionFrames/)
  assert.match(view, /buildMotionStrip/)
  assert.match(view, /resumeExistingOperation/)
  assert.match(view, /assertBoundMotionArtifact/)
  assert.match(view, /motionCandidateFingerprint/)
  assert.match(view, /motionBuildFingerprint/)
  assert.match(api, /\/api\/motion-source\/uploads/)
  assert.match(api, /method:\s*'DELETE'/)
  assert.doesNotMatch(api, /fileToBase64/)
  assert.match(guidedState, /motion_selection_v1_dependency_violation/)
  assert.match(options, /serializeMotionPixelGridRecipe/)
  assert.match(css, /\.action-workspace/)
  assert.doesNotMatch(html, /href="\/legacy\?tab=motion-source"/)
})
test('Motion Pixel Grid recipe serialization omits Disabled and preserves real recipes', () => {
  assert.equal(serializeMotionPixelGridRecipe('disabled'), null)
  assert.deepEqual(
    serializeMotionPixelGridRecipe('pixel_grid_v2_balanced'),
    { recipe: 'pixel_grid_v2_balanced' }
  )
  assert.throws(
    () => serializeMotionPixelGridRecipe('pixel_grid_future'),
    /Unsupported Motion Pixel Grid recipe/
  )
})

test('Motion Source browser API can request release before an upload descriptor exists', async () => {
  const previousFetch = globalThis.fetch
  let request = null
  globalThis.fetch = async (url, options) => {
    request = { url: String(url), options }
    return {
      ok: true,
      status: 200,
      json: async () => ({ operation_id: 'motion_upload_op_test', pending: true }),
    }
  }
  try {
    const result = await releaseMotionSourceUploadOperation('motion_upload_op_test')
    assert.equal(result.pending, true)
    assert.equal(request.url, '/api/motion-source/upload-operations/motion_upload_op_test')
    assert.equal(request.options.method, 'DELETE')
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('Motion Source browser API releases only the named server upload', async () => {
  const previousFetch = globalThis.fetch
  let request = null
  globalThis.fetch = async (url, options) => {
    request = { url: String(url), options }
    return {
      ok: true,
      status: 200,
      json: async () => ({ upload_id: 'motion_upload_test', released: true, pending: false }),
    }
  }
  try {
    const result = await releaseMotionSourceUpload('motion_upload_test')
    assert.equal(result.released, true)
    assert.equal(request.url, '/api/motion-source/uploads/motion_upload_test')
    assert.equal(request.options.method, 'DELETE')
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('Motion Source browser release requests stop at a bounded deadline', async () => {
  const previousFetch = globalThis.fetch
  let requestSignal = null
  globalThis.fetch = async (_url, options) => {
    requestSignal = options.signal
    return new Promise(() => {})
  }
  try {
    await assert.rejects(
      releaseMotionSourceUploadOperation('motion_upload_op_timeout', { timeoutMs: 20 }),
      (error) => error?.code === 'motion_release_timeout' && error?.timeout_ms === 20
    )
    assert.equal(requestSignal.aborted, true)
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('Motion Source artifact reads stop at a bounded deadline', async () => {
  const previousFetch = globalThis.fetch
  let requestSignal = null
  globalThis.fetch = async (_url, options) => {
    requestSignal = options.signal
    return new Promise(() => {})
  }
  try {
    await assert.rejects(
      fetchJsonArtifact('/generated/job/report.json', { timeoutMs: 20 }),
      (error) => error?.code === 'motion_artifact_timeout' && error?.timeout_ms === 20
    )
    assert.equal(requestSignal.aborted, true)
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('Motion Source image artifact reads reject undecodable bytes', async () => {
  const previousFetch = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    blob: async () => new Blob(['not an image'], { type: 'text/plain' }),
  })
  try {
    await assert.rejects(
      fetchImageArtifact('/generated/job/normalized_motion_strip.png'),
      (error) => error?.code === 'motion_artifact_unreadable'
    )
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('Motion Source browser API uploads the original File body without Base64 conversion', async () => {
  const previousFetch = globalThis.fetch
  const source = { name: 'walk.mp4', type: 'video/mp4' }
  let request = null
  globalThis.fetch = async (url, options) => {
    request = { url: String(url), options }
    return {
      ok: true,
      status: 201,
      json: async () => ({
        upload_id: 'motion_upload_test',
        operation_id: 'motion_upload_op_test',
        source_identity: `sha256:${'a'.repeat(64)}`,
      }),
    }
  }
  try {
    const descriptor = await uploadMotionSource(source, { operationId: 'motion_upload_op_test' })
    assert.equal(descriptor.upload_id, 'motion_upload_test')
    assert.match(request.url, /source_name=walk\.mp4/)
    assert.match(request.url, /operation_id=motion_upload_op_test/)
    assert.equal(request.options.body, source)
    assert.equal(request.options.headers['content-type'], 'video/mp4')
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('Motion Source polling keeps abort, timeout, and missing-session failures distinct', async () => {
  const queued = { id: 'job_test', status: 'queued' }
  await assert.rejects(
    waitForMotionSourceJob(queued, { timeoutMs: 0 }),
    (error) => error.code === 'poll_timeout' && error.job_id === 'job_test' && error.job === queued
  )

  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    waitForMotionSourceJob(queued, { signal: controller.signal }),
    (error) => error.name === 'AbortError'
  )

  const previousFetch = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: false,
    status: 404,
    json: async () => ({ error: 'motion_job_not_found', reason: 'server session expired' }),
  })
  try {
    await assert.rejects(
      pollMotionSourceJob('job_test'),
      (error) => error.status === 404 && error.code === 'motion_job_not_found'
    )
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('Motion Source polling keeps the exact job id and bounds a stalled fetch', async () => {
  const previousFetch = globalThis.fetch
  const requestedUrls = []
  globalThis.fetch = async (url) => {
    requestedUrls.push(String(url))
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: 'job_other', status: 'queued' }),
    }
  }
  try {
    await assert.rejects(
      waitForMotionSourceJob(
        { id: 'job_exact', status: 'queued' },
        { pollMs: 0, timeoutMs: 100 }
      ),
      (error) => error.code === 'motion_job_binding_mismatch' &&
        error.job_id === 'job_exact' &&
        error.received_job_id === 'job_other'
    )
    assert.deepEqual(requestedUrls, ['/api/jobs/job_exact'])
  } finally {
    globalThis.fetch = previousFetch
  }

  let markFetchStarted
  const fetchStarted = new Promise((resolve) => {
    markFetchStarted = resolve
  })
  globalThis.fetch = async (_url, { signal }) => new Promise((resolve, reject) => {
    markFetchStarted?.()
    signal.addEventListener('abort', () => {
      reject(new DOMException('Aborted', 'AbortError'))
    }, { once: true })
  })
  try {
    const controller = new AbortController()
    const externallyAborted = waitForMotionSourceJob(
      { id: 'job_aborted', status: 'queued' },
      { pollMs: 0, timeoutMs: 100, signal: controller.signal }
    )
    const abortAssertion = assert.rejects(
      externallyAborted,
      (error) => error.name === 'AbortError' && error.code !== 'poll_timeout'
    )
    await fetchStarted
    controller.abort()
    await abortAssertion

    await assert.rejects(
      waitForMotionSourceJob(
        { id: 'job_stalled', status: 'queued' },
        { pollMs: 0, timeoutMs: 10 }
      ),
      (error) => error.code === 'poll_timeout' &&
        error.job_id === 'job_stalled' &&
        error.job?.id === 'job_stalled'
    )
  } finally {
    globalThis.fetch = previousFetch
  }
})
