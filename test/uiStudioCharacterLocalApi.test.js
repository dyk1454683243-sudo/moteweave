import test from 'node:test'
import assert from 'node:assert/strict'

import {
  assertLocalCharacterAnimations,
  assertLocalCharacterDebugReport,
  assertLocalCharacterJob,
  buildLocalCharacterOptions,
  fetchLocalCharacterJob,
  isRecoverableLocalCharacterObservationError,
  LOCAL_CHARACTER_DEFAULTS,
  LOCAL_CHARACTER_RELEASE_URLS,
  pollLocalCharacterJob,
  requestStudioCharacterText,
  StudioCharacterLocalApiError,
  submitAdvancedLocalCharacterJob,
  submitLocalCharacterJob,
  validateLocalCharacterFile,
  verifyLocalCharacterResult,
} from '../src/ui/studio/characterLocalApi.js'
import {
  bindAdvancedBlackMatteSettings,
  createAdvancedLocalSettings,
} from '../src/ui/studio/characterAdvancedLocal.js'

test('Studio Character bounded client reads verified UTF-8 text artifacts', async () => {
  const value = await requestStudioCharacterText('/generated/job_text/prompt.txt', {}, async () => (
    new Response('bound prompt text', { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8' } })
  ))
  assert.equal(value, 'bound prompt text')
})

function sourceFile(overrides = {}) {
  const bytes = Uint8Array.from([1, 2, 3, 4])
  return {
    name: 'hero.webp',
    type: 'image/webp',
    size: bytes.byteLength,
    async arrayBuffer() {
      return bytes.buffer.slice(0)
    },
    ...overrides,
  }
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function releaseJob(id = 'job_local_001', overrides = {}) {
  return {
    id,
    status: 'done',
    ...Object.fromEntries(
      Object.entries(LOCAL_CHARACTER_RELEASE_URLS)
        .map(([field, file]) => [field, `/generated/${id}/${file}`]),
    ),
    ...overrides,
  }
}

function qualityReport(overrides = {}) {
  return {
    validation: {
      status: 'pass',
      warnings: [],
      blocking_errors: [],
      frame_count: 64,
      ...overrides,
    },
    normalization: {},
  }
}

function animations(overrides = {}) {
  return {
    profile: 'topdown_rpg_v0',
    frame_size: { w: 96, h: 96 },
    sheet_size: { w: 768, h: 768 },
    anchor: { x: 48, y: 88 },
    animations: {
      idle_down: { frames: [0, 1, 2, 3], fps: 8 },
      walk_down: { frames: [16, 17, 18, 19], fps: 10 },
    },
    ...overrides,
  }
}

test('Studio local Character submits the maintained topdown defaults to process-sheet', async () => {
  let captured = null
  const fetchImpl = async (url, options) => {
    captured = { url, options }
    return jsonResponse({ id: 'job_local_001', status: 'queued' }, 202)
  }
  const file = sourceFile()
  const job = await submitLocalCharacterJob({ file, name: 'Hero Knight' }, { fetchImpl })

  assert.equal(job.id, 'job_local_001')
  assert.equal(captured.url, '/api/process-sheet')
  assert.equal(captured.options.method, 'POST')
  assert.equal(captured.options.redirect, 'error')
  const body = JSON.parse(captured.options.body)
  assert.equal(body.source_base64, 'AQIDBA==')
  assert.equal(body.source_black_base64, null)
  assert.deepEqual(body.options, {
    ...LOCAL_CHARACTER_DEFAULTS,
    anchorOffset: { x: 0, y: 0 },
    frameAdjustments: [],
    lockedAnimations: [],
    name: 'Hero Knight',
    sourceFileName: 'hero.webp',
  })
  assert.equal(body.options.sourceLayout, 'topdown_rpg_v0')
  assert.equal(body.options.backgroundMode, 'auto')
  assert.equal(body.options.autoCorrect, true)
  assert.equal(body.options.motionStabilize, true)
  assert.equal('styleEnforcement' in body.options, false)
})

test('Studio advanced local Character submits JPEG, paired matte, and normalized options to the same endpoint', async () => {
  const captured = []
  const fetchImpl = async (url, options) => {
    captured.push({ url, options })
    return jsonResponse({ id: 'job_advanced_001', status: 'queued' }, 202)
  }
  const dimensions = { width: 768, height: 768 }
  const file = sourceFile({ name: 'hero.jpg', type: 'image/jpeg' })
  const blackFile = sourceFile({ name: 'hero-black.png', type: 'image/png' })
  const job = await submitAdvancedLocalCharacterJob({
    file,
    blackFile,
    blackDimensions: dimensions,
    dimensions,
    name: 'Advanced Hero',
    settings: {
      ...bindAdvancedBlackMatteSettings(createAdvancedLocalSettings(dimensions)),
      exportScales: [1, 2, 3, 4],
    },
  }, { fetchImpl })
  assert.equal(job.id, 'job_advanced_001')
  assert.equal(captured.length, 1)
  assert.equal(captured[0].url, '/api/process-sheet')
  assert.equal(captured[0].options.method, 'POST')
  const body = JSON.parse(captured[0].options.body)
  assert.equal(body.source_base64, 'AQIDBA==')
  assert.equal(body.source_black_base64, 'AQIDBA==')
  assert.equal(body.options.sourceLayout, 'topdown_rpg_v0')
  assert.deepEqual(body.options.outputFrameSizes, [96, 192, 288, 384])
})

test('Studio local Character rejects unsupported, empty, and oversized inputs before fetch', () => {
  assert.throws(
    () => validateLocalCharacterFile(sourceFile({ type: 'image/jpeg', name: 'hero.jpg' })),
    (error) => error instanceof StudioCharacterLocalApiError && error.code === 'source_type_invalid',
  )
  assert.throws(
    () => validateLocalCharacterFile(sourceFile({ size: 0 })),
    (error) => error instanceof StudioCharacterLocalApiError && error.code === 'source_size_invalid',
  )
  assert.throws(
    () => buildLocalCharacterOptions({ file: sourceFile(), name: 'x'.repeat(65) }),
    (error) => error instanceof StudioCharacterLocalApiError && error.code === 'name_invalid',
  )
})

test('Studio local Character binds every release URL to the exact terminal Job', () => {
  assert.equal(assertLocalCharacterJob(releaseJob(), { terminal: true }).status, 'done')
  assert.throws(
    () => assertLocalCharacterJob(releaseJob('job_local_001', {
      zip_url: '/generated/job_other/character_pack.zip',
    }), { terminal: true }),
    (error) => error.code === 'artifact_binding_mismatch',
  )
  assert.throws(
    () => assertLocalCharacterJob(releaseJob('job_local_001', {
      godot_npc_zip_url: '/generated/job_local_001/not_godot.zip',
    }), { terminal: true }),
    (error) => error.code === 'artifact_binding_mismatch',
  )
})

test('Studio local Character polling observes only the submitted Job through terminal state', async () => {
  const receipts = [
    { id: 'job_local_001', status: 'post_processing' },
    releaseJob(),
  ]
  const urls = []
  const updates = []
  const terminal = await pollLocalCharacterJob(
    { id: 'job_local_001', status: 'queued' },
    {
      intervalMs: 0,
      pollLimit: 3,
      onUpdate: (job) => updates.push(job.status),
      fetchImpl: async (url) => {
        urls.push(url)
        return jsonResponse(receipts.shift())
      },
    },
  )
  assert.equal(terminal.status, 'done')
  assert.deepEqual(urls, ['/api/jobs/job_local_001', '/api/jobs/job_local_001'])
  assert.deepEqual(updates, ['queued', 'post_processing', 'done'])
})

test('Studio local Character verifies warning releases with zero blockers and real animations', async () => {
  const job = releaseJob()
  const requested = []
  const verified = await verifyLocalCharacterResult(job, {
    fetchImpl: async (url) => {
      requested.push(url)
      if (url.endsWith('/debug_report.json')) {
        return jsonResponse(qualityReport({ status: 'warning', warnings: ['anchor_drift'] }))
      }
      if (url.endsWith('/animations.json')) return jsonResponse(animations())
      return jsonResponse({ error: 'unexpected' }, 404)
    },
  })
  assert.equal(verified.job.id, job.id)
  assert.equal(verified.debugReport.validation.status, 'warning')
  assert.equal(verified.animations.profile, 'topdown_rpg_v0')
  assert.deepEqual(requested.sort(), [job.animations_url, job.debug_report_url].sort())
})

test('Studio local Character fails closed on blockers or malformed animation manifests', () => {
  assert.throws(
    () => assertLocalCharacterDebugReport(
      qualityReport({ status: 'fail', blocking_errors: ['frame_0_empty'] }),
      { requireRelease: true },
    ),
    (error) => error.code === 'quality_gate_blocked',
  )
  assert.throws(
    () => assertLocalCharacterAnimations(animations({ profile: 'fixed_region_motion_v0' })),
    (error) => error.code === 'invalid_animations',
  )
  assert.throws(
    () => assertLocalCharacterAnimations(animations({
      source_layout: { id: 'topdown_rpg_v0' },
    }), { expectedSourceLayout: 'fixed_region_motion_v0' }),
    (error) => error.code === 'source_layout_binding_mismatch',
  )
})

test('Studio local Character retries observation only for transient transport failures', () => {
  for (const code of ['request_failed', 'request_timeout', 'poll_interrupted', 'fetch_unavailable']) {
    assert.equal(isRecoverableLocalCharacterObservationError({ code }), true)
  }
  assert.equal(isRecoverableLocalCharacterObservationError({ code: 'http_error', status: 503 }), true)
  assert.equal(isRecoverableLocalCharacterObservationError({ code: 'http_error', status: 404 }), false)
  assert.equal(isRecoverableLocalCharacterObservationError({ code: 'artifact_binding_mismatch' }), false)
})

test('Studio local Character treats response-body timeout as recoverable same-Job observation', async () => {
  const fetchImpl = async (_url, options) => ({
    ok: true,
    status: 200,
    headers: new Headers(),
    arrayBuffer() {
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          const error = new Error('response body aborted')
          error.name = 'AbortError'
          reject(error)
        }, { once: true })
      })
    },
  })
  await assert.rejects(
    fetchLocalCharacterJob('job_local_001', { fetchImpl, timeoutMs: 5 }),
    (error) => (
      error instanceof StudioCharacterLocalApiError &&
      error.code === 'request_timeout' &&
      isRecoverableLocalCharacterObservationError(error)
    ),
  )
})

test('Studio local Character preserves caller abort while reading a response body', async () => {
  const controller = new AbortController()
  let markBodyStarted
  const bodyStarted = new Promise((resolve) => {
    markBodyStarted = resolve
  })
  const fetchImpl = async (_url, options) => ({
    ok: true,
    status: 200,
    headers: new Headers(),
    arrayBuffer() {
      markBodyStarted()
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          const error = new Error('response body aborted')
          error.name = 'AbortError'
          reject(error)
        }, { once: true })
      })
    },
  })
  const request = fetchLocalCharacterJob('job_local_001', {
    signal: controller.signal,
    fetchImpl,
    timeoutMs: 1_000,
  })
  await bodyStarted
  controller.abort()
  await assert.rejects(request, (error) => (
    error?.name === 'AbortError' && !(error instanceof StudioCharacterLocalApiError)
  ))
})
