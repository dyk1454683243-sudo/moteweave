import test from 'node:test'
import assert from 'node:assert/strict'

import {
  SCENE_MAX_CANDIDATES,
  StudioSceneApiError,
  assertSceneArtifactUrl,
  assertSceneJob,
  diagnosticSceneArtifacts,
  normalizeSceneOptions,
  pollSceneJob,
  postSceneGeneration,
  postSceneImport,
  releaseSceneArtifacts,
  sceneSubmissionIsDefiniteRejection,
  selectEligibleSceneGeminiPreset,
} from '../src/ui/studio/sceneApi.js'
import { selectStrictGeminiPreset } from '../src/ui/studio/characterApi.js'
import { selectEligibleTilesGeminiPreset } from '../src/ui/studio/tilesApi.js'

function jsonResponse(body, { status = 200 } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function sceneJob(overrides = {}) {
  return {
    id: 'job_scene_1',
    status: 'queued',
    ...overrides,
  }
}

function doneArtifacts(id = 'job_scene_1') {
  return {
    scene_url: `/generated/${id}/scene.json`,
    tile_atlas_url: `/generated/${id}/tile_atlas.json`,
    tile_map_url: `/generated/${id}/tile_map.json`,
    quality_gate_url: `/generated/${id}/quality_gate.json`,
    ldtk_project_url: `/generated/${id}/project.ldtk`,
    tileset_url: `/generated/${id}/tileset.png`,
    scene_pack_zip_url: `/generated/${id}/scene_pack.zip`,
    zip_url: `/generated/${id}/scene_pack.zip`,
  }
}

function nativeGeminiState(id = 'gemini_native_1') {
  return {
    status: 'ready',
    available: true,
    active_preset_id: id,
    presets: [{
      id,
      available: true,
      provider: 'gemini',
      route_kind: 'google_native',
      model: 'gemini-3.1-flash-image-preview',
      supports_image_size: true,
      image_config: { image_size: '2K', aspect_ratio: '1:1' },
    }],
  }
}

function sceneGenerationFetch({ state = nativeGeminiState(), onGenerate } = {}) {
  const calls = []
  return {
    calls,
    fetchImpl: async (url, options) => {
      calls.push({ url, method: options?.method, body: options?.body })
      if (url === '/api/gemini-state') return jsonResponse(state)
      if (url === '/api/generate-scene-tiles') {
        onGenerate?.(JSON.parse(options.body))
        return jsonResponse(sceneJob({ type: 'scene_tile_generation' }))
      }
      throw new Error(`unexpected ${url}`)
    },
  }
}

function sourceFile(overrides = {}) {
  const bytes = Uint8Array.from([1, 2, 3, 4])
  return {
    name: 'scene.png',
    type: 'image/png',
    size: bytes.byteLength,
    async arrayBuffer() { return bytes.buffer },
    ...overrides,
  }
}

test('Scene options expose every maintained pipeline parameter without hidden provider settings', () => {
  assert.deepEqual(normalizeSceneOptions({
    width: 12,
    height: 9,
    pattern: 'rule',
    seed: 42,
    density: 0.35,
    styleSnap: true,
    styleMaxColors: 24,
    edgeCondition: true,
    edgeBand: 4,
    edgeConditionMode: 'global-v0',
    rawTilePolicy: 'strict',
  }), {
    projectId: 'scene_studio_project',
    identifier: 'scene_studio',
    width: 12,
    height: 9,
    pattern: 'rule',
    seed: 42,
    density: 0.35,
    styleSnap: true,
    styleMaxColors: 24,
    edgeCondition: true,
    edgeBand: 4,
    edgeConditionMode: 'global-v0',
    rawTilePolicy: 'strict',
    tilesetRelPath: 'tileset.png',
  })
  assert.throws(
    () => normalizeSceneOptions({ width: 17 }),
    (error) => error instanceof StudioSceneApiError && error.code === 'invalid_scene_options',
  )
})

test('local Scene import sends only the source and normalized existing options', async () => {
  let body
  const job = await postSceneImport({
    file: sourceFile(),
    options: { width: 8, height: 6, pattern: 'island', seed: 7, density: 0.45 },
    fetchImpl: async (url, options) => {
      assert.equal(url, '/api/process-scene-tiles')
      assert.equal(options.method, 'POST')
      body = JSON.parse(options.body)
      return jsonResponse(sceneJob())
    },
  })
  assert.equal(job.id, 'job_scene_1')
  assert.equal(body.source_base64, 'AQIDBA==')
  assert.equal(body.source_name, 'scene.png')
  assert.equal(body.options.width, 8)
  assert.equal(body.options.height, 6)
  assert.equal(body.options.rawTilePolicy, 'warn')
  assert.equal(body.confirm_live_generation, undefined)
  assert.equal(body.providerPresetId, undefined)

  let jpegBody
  await postSceneImport({
    file: sourceFile({ type: 'image/jpeg', name: 'scene.jpg' }),
    fetchImpl: async (url, options) => {
      assert.equal(url, '/api/process-scene-tiles')
      jpegBody = JSON.parse(options.body)
      return jsonResponse(sceneJob())
    },
  })
  assert.equal(jpegBody.source_name, 'scene.jpg')
  await assert.rejects(
    postSceneImport({ file: sourceFile({ type: 'image/gif', name: 'scene.gif' }), fetchImpl: async () => jsonResponse(sceneJob()) }),
    (error) => error instanceof StudioSceneApiError && error.code === 'source_type_invalid',
  )
})

test('live Scene generation requires native Gemini, fresh confirmation, and the exact preset id', async () => {
  let body
  await assert.rejects(
    postSceneGeneration({ description: 'mossy path', candidateCount: 2, confirmed: false }),
    (error) => error instanceof StudioSceneApiError && error.code === 'live_confirmation_required',
  )
  const native = sceneGenerationFetch({
    onGenerate(payload) { body = payload },
  })
  const job = await postSceneGeneration({
    description: 'mossy path',
    candidateCount: 2,
    confirmed: true,
    options: { width: 6, height: 4 },
    fetchImpl: native.fetchImpl,
  })
  assert.equal(job.type, 'scene_tile_generation')
  assert.deepEqual(native.calls.map((call) => call.url), ['/api/gemini-state', '/api/generate-scene-tiles'])
  assert.equal(body.confirm_live_generation, true)
  assert.equal(body.description, 'mossy path')
  assert.equal(body.options.candidateCount, 2)
  assert.equal(body.providerPresetId, 'gemini_native_1')
  assert.equal(body.imageConfig, undefined)
  await assert.rejects(
    postSceneGeneration({ description: 'mossy path', candidateCount: SCENE_MAX_CANDIDATES + 1, confirmed: true }),
    (error) => error instanceof StudioSceneApiError && error.code === 'invalid_scene_options',
  )
})

test('live Scene generation fails closed with zero POSTs when native Gemini is unavailable', async () => {
  const blocked = sceneGenerationFetch({
    state: {
      status: 'ready',
      presets: [{
        id: 'openrouter_1',
        available: true,
        provider: 'openrouter',
        route_kind: 'openrouter',
        model: 'example/model',
      }],
    },
  })
  await assert.rejects(
    postSceneGeneration({ description: 'mossy path', confirmed: true, fetchImpl: blocked.fetchImpl }),
    (error) => error instanceof StudioSceneApiError && error.code === 'gemini_not_ready',
  )
  assert.deepEqual(blocked.calls.map((call) => call.url), ['/api/gemini-state'])
  const failedCalls = []
  await assert.rejects(
    postSceneGeneration({
      description: 'mossy path',
      confirmed: true,
      fetchImpl: async (url, options) => {
        failedCalls.push(url)
        throw new Error('network down')
      },
    }),
    (error) => error instanceof StudioSceneApiError && error.code === 'gemini_not_ready',
  )
  assert.deepEqual(failedCalls, ['/api/gemini-state'])
  assert.equal(selectEligibleSceneGeminiPreset(nativeGeminiState()).id, 'gemini_native_1')
  assert.throws(
    () => selectEligibleSceneGeminiPreset({ presets: [{ available: true, provider: 'openrouter', route_kind: 'openrouter', id: 'or1' }] }),
    (error) => error instanceof StudioSceneApiError && error.code === 'gemini_not_ready',
  )
  assert.throws(
    () => selectStrictGeminiPreset({
      status: 'ready',
      presets: [{ available: true, provider: 'openrouter', route_kind: 'openrouter', id: 'or1' }],
    }),
    (error) => error?.code === 'gemini_not_ready',
  )
  assert.throws(
    () => selectEligibleTilesGeminiPreset({
      presets: [{ available: true, provider: 'openrouter', route_kind: 'openrouter', id: 'or1' }],
    }),
    (error) => error?.code === 'gemini_not_ready',
  )
})

test('Scene artifact and completion contracts are same-origin, exact-job, and fail closed', () => {
  assert.equal(
    assertSceneArtifactUrl('/generated/job_scene_1/scene.json', 'scene.json', {
      exactPath: '/generated/job_scene_1/scene.json',
      locationValue: { origin: 'http://127.0.0.1:4173' },
    }),
    '/generated/job_scene_1/scene.json',
  )
  assert.throws(
    () => assertSceneArtifactUrl('https://evil.example/generated/job_scene_1/scene.json', 'scene.json', {
      locationValue: { origin: 'http://127.0.0.1:4173' },
    }),
    (error) => error instanceof StudioSceneApiError && error.code === 'artifact_origin_mismatch',
  )
  assert.throws(
    () => assertSceneJob(sceneJob({ status: 'done' }), { terminal: true }),
    (error) => error instanceof StudioSceneApiError && error.code === 'artifact_missing',
  )

  const done = assertSceneJob(sceneJob({ status: 'done', ...doneArtifacts() }), { terminal: true })
  const release = releaseSceneArtifacts(done)
  assert.deepEqual(release.map((row) => row.file), [
    'scene_pack.zip',
    'project.ldtk',
    'tileset.png',
    'scene.json',
    'tile_atlas.json',
    'tile_map.json',
    'quality_gate.json',
  ])
  const legacyZip = releaseSceneArtifacts(assertSceneJob(sceneJob({
    status: 'done',
    ...doneArtifacts(),
    scene_pack_zip_url: undefined,
  }), { terminal: true }))
  assert.equal(legacyZip[0].field, 'zip_url')
  assert.equal(legacyZip[0].file, 'scene_pack.zip')
  const qualityFailed = assertSceneJob(sceneJob({
    status: 'failed_quality_gate',
    quality_gate_url: '/generated/job_scene_1/quality_gate.json',
    tile_conditioning_review_url: '/generated/job_scene_1/tile_conditioning_review.json',
  }), { terminal: true })
  assert.deepEqual(releaseSceneArtifacts(qualityFailed), [])
  assert.deepEqual(diagnosticSceneArtifacts(qualityFailed).map((row) => row.file), [
    'quality_gate.json',
    'tile_conditioning_review.json',
  ])
})

test('Scene polling observes the same Job and exposes interruption without replacement work', async () => {
  const urls = []
  const terminal = await pollSceneJob(sceneJob(), {
    sleepImpl: async () => {},
    fetchImpl: async (url) => {
      urls.push(url)
      return jsonResponse(sceneJob({ status: 'done', ...doneArtifacts() }))
    },
  })
  assert.equal(terminal.status, 'done')
  assert.deepEqual(urls, ['/api/jobs/job_scene_1'])

  const driftUrls = []
  await assert.rejects(
    pollSceneJob(sceneJob(), {
      sleepImpl: async () => {},
      fetchImpl: async (url) => {
        driftUrls.push(url)
        return jsonResponse(sceneJob({ id: 'job_scene_2' }))
      },
    }),
    (error) => error instanceof StudioSceneApiError && error.code === 'job_binding_mismatch',
  )
  assert.deepEqual(driftUrls, ['/api/jobs/job_scene_1'])

  await assert.rejects(
    pollSceneJob(sceneJob(), {
      sleepImpl: async () => {},
      fetchImpl: async () => jsonResponse({ error: 'temporary' }, { status: 503 }),
    }),
    (error) => (
      error instanceof StudioSceneApiError &&
      error.code === 'poll_interrupted' &&
      error.payload.job.id === 'job_scene_1'
    ),
  )
})

test('only definite client rejection proves that a live submission consumed no call', () => {
  assert.equal(sceneSubmissionIsDefiniteRejection({ status: 400 }), true)
  assert.equal(sceneSubmissionIsDefiniteRejection({ status: 429 }), true)
  assert.equal(sceneSubmissionIsDefiniteRejection({ status: 500 }), false)
  assert.equal(sceneSubmissionIsDefiniteRejection(new Error('network')), false)
  assert.equal(sceneSubmissionIsDefiniteRejection({ code: 'gemini_not_ready' }), true)
  assert.equal(sceneSubmissionIsDefiniteRejection({ code: 'gemini_preset_mismatch' }), true)
  assert.equal(sceneSubmissionIsDefiniteRejection({ code: 'request_failed' }), false)
})
