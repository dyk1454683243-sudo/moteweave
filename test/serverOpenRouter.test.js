import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import http from 'node:http'
import { once } from 'node:events'
import test from 'node:test'
import assert from 'node:assert/strict'

import { encodeRgbaPng } from '../src/character-pack/imageCodec.js'
import { getTileSourceRegion } from '../src/scene-pack/tileProfile.js'

const TERMINAL = new Set(['done', 'failed_quality_gate', 'failed_safety_filter', 'failed_model_error', 'failed_post_processing'])

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  })
}

async function startMockOpenRouter(imageBuffer) {
  const requests = []
  const server = http.createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = Buffer.concat(chunks).toString('utf8')
    requests.push(JSON.parse(body))
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              images: [
                {
                  image_url: {
                    url: `data:image/png;base64,${imageBuffer.toString('base64')}`,
                  },
                },
              ],
            },
          },
        ],
      })
    )
  })
  const port = await listen(server)
  return { server, requests, url: `http://127.0.0.1:${port}/v1/chat/completions` }
}

async function startFailingOpenRouter(message = 'provider unavailable') {
  const requests = []
  const server = http.createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = Buffer.concat(chunks).toString('utf8')
    requests.push(JSON.parse(body))
    res.writeHead(400, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: { message } }))
  })
  const port = await listen(server)
  return { server, requests, url: `http://127.0.0.1:${port}/v1/chat/completions` }
}

function paintRect(image, rect, color = [80, 120, 60, 255]) {
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const offset = (y * image.width + x) * 4
      image.data[offset] = color[0]
      image.data[offset + 1] = color[1]
      image.data[offset + 2] = color[2]
      image.data[offset + 3] = color[3]
    }
  }
}

function makeSceneTileSheet() {
  const image = {
    width: 192,
    height: 192,
    data: new Uint8ClampedArray(192 * 192 * 4),
  }
  for (let mask = 0; mask < 16; mask += 1) {
    const region = getTileSourceRegion(mask)
    paintRect(image, { x: region.col * 48, y: region.row * 48, w: 48, h: 48 }, [240, 40, 200, 255])
    paintRect(image, region, [80, 120, 60, 255])
  }
  return image
}

function makeTwoPointFiveDMaterialSourceImage() {
  const image = {
    width: 1024,
    height: 1024,
    data: new Uint8ClampedArray(1024 * 1024 * 4),
  }
  paintRect(image, { x: 0, y: 0, w: 1024, h: 1024 }, [29, 33, 25, 255])
  paintRect(image, { x: 0, y: 0, w: 512, h: 342 }, [79, 154, 69, 255])
  paintRect(image, { x: 512, y: 0, w: 512, h: 342 }, [118, 82, 53, 255])
  paintRect(image, { x: 0, y: 342, w: 512, h: 341 }, [182, 212, 109, 255])
  paintRect(image, { x: 512, y: 342, w: 512, h: 341 }, [119, 180, 87, 255])
  paintRect(image, { x: 0, y: 683, w: 512, h: 341 }, [140, 124, 67, 255])
  paintRect(image, { x: 512, y: 683, w: 512, h: 341 }, [36, 40, 32, 255])
  paintRect(image, { x: 120, y: 96, w: 64, h: 48 }, [143, 202, 99, 255])
  paintRect(image, { x: 640, y: 112, w: 80, h: 48 }, [141, 104, 68, 255])
  paintRect(image, { x: 160, y: 500, w: 96, h: 24 }, [215, 232, 139, 255])
  paintRect(image, { x: 656, y: 824, w: 128, h: 32 }, [48, 53, 40, 255])
  return image
}

function makeQualityCharacterImage() {
  const image = {
    width: 128,
    height: 128,
    data: new Uint8ClampedArray(128 * 128 * 4),
  }
  paintRect(image, { x: 0, y: 0, w: 128, h: 128 }, [255, 255, 255, 255])
  paintRect(image, { x: 58, y: 28, w: 12, h: 14 }, [235, 220, 190, 255])
  paintRect(image, { x: 50, y: 44, w: 28, h: 36 }, [58, 96, 150, 255])
  paintRect(image, { x: 44, y: 46, w: 8, h: 28 }, [42, 64, 100, 255])
  paintRect(image, { x: 76, y: 46, w: 8, h: 28 }, [42, 64, 100, 255])
  paintRect(image, { x: 52, y: 80, w: 8, h: 24 }, [32, 42, 68, 255])
  paintRect(image, { x: 68, y: 80, w: 8, h: 24 }, [32, 42, 68, 255])
  return image
}

function makeBlankGenerationImage() {
  const image = {
    width: 128,
    height: 128,
    data: new Uint8ClampedArray(128 * 128 * 4),
  }
  paintRect(image, { x: 0, y: 0, w: 128, h: 128 }, [255, 255, 255, 255])
  return image
}

function waitForServer(child) {
  return new Promise((resolve, reject) => {
    let output = ''
    const onData = (chunk) => {
      output += chunk.toString()
      if (output.includes('Character tool running')) resolve()
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.once('exit', (code) => reject(new Error(`server exited before ready: ${code}\n${output}`)))
  })
}

async function fetchJson(baseUrl, path, options) {
  const response = await fetch(new URL(path, baseUrl), options)
  const text = await response.text()
  const json = text ? JSON.parse(text) : {}
  if (!response.ok) throw new Error(`${path} returned ${response.status}: ${text}`)
  return json
}

async function waitForJob(baseUrl, id) {
  let current = await fetchJson(baseUrl, `/api/jobs/${id}`)
  for (let i = 0; !TERMINAL.has(current.status) && i < 240; i++) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    current = await fetchJson(baseUrl, `/api/jobs/${id}`)
  }
  return current
}

test('generate-character routes OpenRouter output through the character pack pipeline', async (t) => {
  const fixture = await readFile('test/fixtures/character-pack/topdown_rpg_v0_sample_hero.png')
  const mock = await startMockOpenRouter(fixture)
  t.after(() => mock.server.close())

  const appServer = http.createServer()
  const appPort = await listen(appServer)
  appServer.close()
  await once(appServer, 'close')

  const child = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(appPort),
      OPENROUTER_API_KEY: 'test-key',
      OPENROUTER_BASE_URL: mock.url,
      OPENROUTER_IMAGE_MODEL: 'mock/gemini-image',
      OPENROUTER_IMAGE_SIZE: '1K',
      OPENROUTER_IMAGE_ASPECT_RATIO: '1:1',
      CHARACTER_PROVIDER_PRESETS: '[]',
      CHARACTER_DEFAULT_PROVIDER: 'openrouter-default',
      CHARACTER_JOB_CONCURRENCY: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  t.after(() => child.kill())
  await waitForServer(child)

  const baseUrl = `http://127.0.0.1:${appPort}`
  const state = await fetchJson(baseUrl, '/api/gemini-state')
  assert.equal(state.available, true)
  assert.equal(state.implemented, true)
  assert.equal(state.provider, 'openrouter')
  assert.equal(state.model, 'mock/gemini-image')
  assert.equal(state.active_preset_id, 'openrouter-default')
  assert.equal(state.presets[0].available, true)
  assert.equal(state.presets[0].model, 'mock/gemini-image')

  const initial = await fetchJson(baseUrl, '/api/generate-character', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'server_integration',
      preset: 'topdown_rpg_v0',
      description: 'a test swordswoman',
      reference_image_base64: fixture.toString('base64'),
      reference_image_mime: 'image/png',
      reference_image_name: 'reference.png',
      palette_image_base64: fixture.toString('base64'),
      palette_image_mime: 'image/png',
      palette_image_name: 'endesga-32-32x.png',
      imageConfig: { image_size: '1K', aspect_ratio: '1:1' },
      options: { backgroundMode: 'auto' },
    }),
  })
  assert.ok(['queued', 'generating', 'post_processing'].includes(initial.status))

  const job = await waitForJob(baseUrl, initial.id)
  assert.equal(job.status, 'done')
  assert.equal(job.release_ready, true)
  assert.equal(job.artifact_disposition, 'release')
  assert.ok(job.source_url)
  assert.ok(job.prompt_url)
  assert.ok(job.generation_url)
  assert.ok(job.normalized_sheet_url)
  assert.ok(job.multi_resolution_manifest_url)
  assert.ok(job.multi_resolution_sheet_urls.some((sheet) => sheet.frame_size === 64 && sheet.url.endsWith('/normalized_sheet_64.png')))
  assert.ok(job.debug_report_url)
  assert.ok(job.debug_overlay_url)
  assert.ok(job.onion_skin_overlay_url)
  assert.ok(job.zip_url)
  assert.equal(job.row_gif_urls.length, 16)
  assert.deepEqual(job.provider_call_budget, {
    planned_provider_calls: 1,
    max_provider_calls: 1,
    used_provider_calls: 1,
  })
  assert.equal(job.candidate_selection.candidate_count, 1)
  assert.equal(job.candidate_selection.release_selected_index, 1)

  assert.equal(mock.requests.length, 1)
  const [request] = mock.requests
  assert.equal(request.model, 'mock/gemini-image')
  assert.deepEqual(request.modalities, ['image', 'text'])
  assert.deepEqual(request.image_config, { aspect_ratio: '1:1', image_size: '1K' })
  assert.equal(request.messages[0].content[0].type, 'text')
  assert.match(request.messages[0].content[0].text, /template image is the approved strict structural(?: 8x8)? layout template/)
  assert.match(request.messages[0].content[0].text, /background must be pure white/i)
  assert.equal(request.messages[0].content.filter((part) => part.type === 'image_url').length, 3)
  assert.match(request.messages[0].content[0].text, /palette\/style reference only/)

  const generation = await fetchJson(baseUrl, job.generation_url)
  assert.equal(generation.provider_preset_id, 'openrouter-default')
  assert.deepEqual(generation.input_images, { template: true, reference: true, palette: true })
  assert.equal(generation.template_file, 'motion_template_ocha_8x8.png')
  assert.equal(generation.reference_file, 'reference.png')
  assert.equal(generation.palette_file, 'endesga-32-32x.png')
  assert.equal(generation.prompt_contract.contract_version, 'character_prompt_contract_v1_15')
  assert.equal(generation.prompt_contract.preset, 'topdown_rpg_v0')
  assert.equal(generation.prompt_contract.layout_id, 'topdown_rpg_v0')
  assert.equal(generation.candidate_selection.candidate_count, 1)
  assert.equal(generation.candidate_selection.selected_index, 1)
  assert.equal(generation.generation_options.candidateCount, 1)
})

test('generate-character can return quality text-to-image artifacts without sheet post-processing', async (t) => {
  const fixture = await encodeRgbaPng(makeQualityCharacterImage())
  const mock = await startMockOpenRouter(fixture)
  t.after(() => mock.server.close())

  const appServer = http.createServer()
  const appPort = await listen(appServer)
  appServer.close()
  await once(appServer, 'close')

  const child = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(appPort),
      OPENROUTER_API_KEY: 'test-key',
      OPENROUTER_BASE_URL: mock.url,
      OPENROUTER_IMAGE_MODEL: 'mock/gemini-image',
      CHARACTER_PROVIDER_PRESETS: '[]',
      CHARACTER_DEFAULT_PROVIDER: 'openrouter-default',
      CHARACTER_JOB_CONCURRENCY: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  t.after(() => child.kill())
  await waitForServer(child)

  const baseUrl = `http://127.0.0.1:${appPort}`
  const initial = await fetchJson(baseUrl, '/api/generate-character', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      description: 'silver swordswoman',
      t2iMode: 'quality_character_v0',
      characterPreset: 'two_to_one_character_v0',
      generationOptions: { candidateCount: 2, seed: 5 },
      imageConfig: { image_size: '2K' },
      options: { backgroundMode: 'auto' },
    }),
  })

  const job = await waitForJob(baseUrl, initial.id)
  assert.equal(job.status, 'done')
  assert.equal(job.release_ready, true)
  assert.equal(job.artifact_disposition, 'release')
  assert.ok(job.t2i_result_url)
  assert.ok(job.source_url)
  assert.ok(job.generation_url)
  assert.ok(job.zip_url)
  assert.equal(job.normalized_sheet_url, undefined)
  assert.deepEqual(job.provider_call_budget, {
    planned_provider_calls: 2,
    max_provider_calls: 2,
    used_provider_calls: 2,
  })
  assert.equal(typeof job.quality_spec.metrics.bbox_area_ratio, 'number')
  assert.equal(job.candidate_selection.candidate_count, 2)
  assert.equal(job.candidate_selection.release_selected_index, 1)
  assert.equal(mock.requests.length, 2)
  assert.equal(mock.requests[0].image_config.aspect_ratio, '2:1')
  assert.equal(mock.requests[0].image_config.image_size, '2K')
  assert.equal(mock.requests[0].seed, 5)
  assert.equal(mock.requests[1].seed, 6)
  assert.match(mock.requests[0].messages[0].content, /one single centered full-body character only/)

  const generation = await fetchJson(baseUrl, job.generation_url)
  assert.equal(generation.mode, 'quality_character_v0')
  assert.equal(generation.prompt_contract.preset, 'two_to_one_character_v0')
  assert.equal(generation.candidate_selection.candidate_count, 2)
  const report = await fetchJson(baseUrl, job.result_url)
  assert.equal(typeof report.pixel_finishing.quality_spec.metrics.bbox_area_ratio, 'number')
  assert.equal(typeof report.candidate_selection.candidates[0].metrics.bbox_area_ratio, 'number')
})

test('generation release gate keeps blocked production and quality results diagnostic-only', async (t) => {
  const fixture = await encodeRgbaPng(makeBlankGenerationImage())
  const mock = await startMockOpenRouter(fixture)
  t.after(() => mock.server.close())

  const appServer = http.createServer()
  const appPort = await listen(appServer)
  appServer.close()
  await once(appServer, 'close')

  const child = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(appPort),
      OPENROUTER_API_KEY: 'test-key',
      OPENROUTER_BASE_URL: mock.url,
      OPENROUTER_IMAGE_MODEL: 'mock/gemini-image',
      CHARACTER_PROVIDER_PRESETS: '[]',
      CHARACTER_DEFAULT_PROVIDER: 'openrouter-default',
      CHARACTER_JOB_CONCURRENCY: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  t.after(() => child.kill())
  await waitForServer(child)

  const baseUrl = `http://127.0.0.1:${appPort}`
  for (const body of [
    {
      description: 'blank production sheet',
      preset: 'topdown_rpg_v0',
      generationOptions: { candidateCount: 1 },
      options: { backgroundMode: 'auto' },
    },
    {
      description: 'blank quality character',
      t2iMode: 'quality_character_v0',
      generationOptions: { candidateCount: 1 },
      options: { backgroundMode: 'auto' },
    },
  ]) {
    const initial = await fetchJson(baseUrl, '/api/generate-character', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const job = await waitForJob(baseUrl, initial.id)
    assert.equal(job.status, 'failed_quality_gate')
    assert.equal(job.failure_status, 'generation_release_gate_failed')
    assert.equal(job.release_ready, false)
    assert.equal(job.release_gate.release_ready, false)
    assert.equal(job.artifact_disposition, 'diagnostic_only')
    assert.equal(job.candidate_selection.release_selected_index, null)
    assert.equal(job.candidate_selection.artifact_disposition, 'diagnostic_only')
    assert.equal(job.zip_url, undefined)
    assert.ok(job.generation_release_gate_url)
  }
})

test('browser session provider config drives text-to-image without echoing the API key', async (t) => {
  const providerPng = await encodeRgbaPng(makeQualityCharacterImage())
  const mock = await startMockOpenRouter(providerPng)
  t.after(() => mock.server.close())

  const appServer = http.createServer()
  const appPort = await listen(appServer)
  appServer.close()
  await once(appServer, 'close')

  const child = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(appPort),
      OPENROUTER_API_KEY: 'env-key',
      OPENROUTER_BASE_URL: 'http://127.0.0.1:9/not-used',
      OPENROUTER_IMAGE_MODEL: 'env/model',
      CHARACTER_PROVIDER_PRESETS: '[]',
      CHARACTER_DEFAULT_PROVIDER: 'openrouter-default',
      CHARACTER_JOB_CONCURRENCY: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  t.after(() => child.kill())
  await waitForServer(child)

  const baseUrl = `http://127.0.0.1:${appPort}`
  const configured = await fetchJson(baseUrl, '/api/provider-config', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      provider: 'openrouter',
      model: 'runtime/model',
      apiKey: 'runtime-secret',
      baseUrl: mock.url,
      imageSize: '1K',
      aspectRatio: '1:1',
    }),
  })
  assert.equal(configured.ok, true)
  assert.equal(configured.provider_state.runtime_configured, true)
  assert.equal(configured.provider_state.active_preset_id, 'browser-runtime')
  assert.equal(configured.provider_state.model, 'runtime/model')
  assert.equal(configured.provider_state.presets[0].available, true)
  assert.doesNotMatch(JSON.stringify(configured), /runtime-secret/)

  const refreshed = await fetchJson(baseUrl, '/api/gemini-state')
  assert.equal(refreshed.runtime_configured, true)
  assert.equal(refreshed.model, 'runtime/model')
  assert.doesNotMatch(JSON.stringify(refreshed), /runtime-secret/)

  const initial = await fetchJson(baseUrl, '/api/generate-character', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      description: 'silver swordswoman',
      t2iMode: 'quality_character_v0',
      generationOptions: { candidateCount: 1 },
      imageConfig: { image_size: '1K', aspect_ratio: '1:1' },
      maxProviderCalls: 1,
      options: { backgroundMode: 'auto' },
    }),
  })

  const job = await waitForJob(baseUrl, initial.id)
  assert.equal(job.status, 'done')
  assert.equal(mock.requests.length, 1)
  assert.equal(mock.requests[0].model, 'runtime/model')
  assert.deepEqual(mock.requests[0].image_config, { aspect_ratio: '1:1', image_size: '1K' })

  const generation = await fetchJson(baseUrl, job.generation_url)
  assert.equal(generation.provider_preset_id, 'browser-runtime')
  assert.equal(generation.model, 'runtime/model')
  assert.doesNotMatch(JSON.stringify(generation), /runtime-secret/)

  const cleared = await fetchJson(baseUrl, '/api/provider-config', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clear: true }),
  })
  assert.equal(cleared.ok, true)
  assert.equal(cleared.provider_state.runtime_configured, false)
  assert.doesNotMatch(JSON.stringify(cleared), /runtime-secret/)
})

test('generate-character reports quality text-to-image candidate failures without fake success', async (t) => {
  const mock = await startFailingOpenRouter('provider unavailable')
  t.after(() => mock.server.close())

  const appServer = http.createServer()
  const appPort = await listen(appServer)
  appServer.close()
  await once(appServer, 'close')

  const child = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(appPort),
      OPENROUTER_API_KEY: 'test-key',
      OPENROUTER_BASE_URL: mock.url,
      OPENROUTER_IMAGE_MODEL: 'mock/gemini-image',
      CHARACTER_PROVIDER_PRESETS: '[]',
      CHARACTER_DEFAULT_PROVIDER: 'openrouter-default',
      CHARACTER_JOB_CONCURRENCY: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  t.after(() => child.kill())
  await waitForServer(child)

  const baseUrl = `http://127.0.0.1:${appPort}`
  const initial = await fetchJson(baseUrl, '/api/generate-character', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      description: 'silver swordswoman',
      t2iMode: 'quality_character_v0',
      generationOptions: { candidateCount: 2 },
      imageConfig: { image_size: '2K' },
      maxProviderCalls: 2,
      options: { backgroundMode: 'auto' },
    }),
  })

  const job = await waitForJob(baseUrl, initial.id)
  assert.equal(job.status, 'failed_model_error')
  assert.equal(job.failure_status, 'failed_all_candidates')
  assert.equal(job.reason, 'provider unavailable')
  assert.equal(job.retry_hint, 'regenerate')
  assert.deepEqual(job.provider_call_budget, {
    planned_provider_calls: 2,
    max_provider_calls: 2,
    used_provider_calls: 2,
  })
  assert.equal(job.candidate_selection.candidate_count, 2)
  assert.deepEqual(job.candidate_selection.candidates.map((candidate) => candidate.reason), [
    'provider unavailable',
    'provider unavailable',
  ])
  assert.equal(mock.requests.length, 2)
})

test('generate-character keeps local image processing failures distinct from provider failures', async (t) => {
  const mock = await startMockOpenRouter(Buffer.from('not a png'))
  t.after(() => mock.server.close())

  const appServer = http.createServer()
  const appPort = await listen(appServer)
  appServer.close()
  await once(appServer, 'close')

  const child = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(appPort),
      OPENROUTER_API_KEY: 'test-key',
      OPENROUTER_BASE_URL: mock.url,
      OPENROUTER_IMAGE_MODEL: 'mock/gemini-image',
      CHARACTER_PROVIDER_PRESETS: '[]',
      CHARACTER_DEFAULT_PROVIDER: 'openrouter-default',
      CHARACTER_JOB_CONCURRENCY: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  t.after(() => child.kill())
  await waitForServer(child)

  const baseUrl = `http://127.0.0.1:${appPort}`
  const initial = await fetchJson(baseUrl, '/api/generate-character', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      description: 'invalid image payload',
      t2iMode: 'quality_character_v0',
      generationOptions: { candidateCount: 1 },
      maxProviderCalls: 1,
      options: { backgroundMode: 'auto' },
    }),
  })

  const job = await waitForJob(baseUrl, initial.id)
  assert.equal(job.status, 'failed_post_processing')
  assert.equal(job.failure_status, 'failed_post_processing')
  assert.equal(job.retry_hint, 'manual_inspect')
  assert.equal(job.provider_call_budget.used_provider_calls, 1)
  assert.equal(job.candidate_selection.candidates[0].failure_stage, 'post_processing')
  assert.equal(mock.requests.length, 1)
})

test('generate-character stops quality candidates when provider route is blocked', async (t) => {
  const mock = await startFailingOpenRouter('The request is prohibited due to a violation of provider terms of service.')
  t.after(() => mock.server.close())

  const appServer = http.createServer()
  const appPort = await listen(appServer)
  appServer.close()
  await once(appServer, 'close')

  const child = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(appPort),
      OPENROUTER_API_KEY: 'test-key',
      OPENROUTER_BASE_URL: mock.url,
      OPENROUTER_IMAGE_MODEL: 'mock/gemini-image',
      CHARACTER_PROVIDER_PRESETS: '[]',
      CHARACTER_DEFAULT_PROVIDER: 'openrouter-default',
      CHARACTER_JOB_CONCURRENCY: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  t.after(() => child.kill())
  await waitForServer(child)

  const baseUrl = `http://127.0.0.1:${appPort}`
  const initial = await fetchJson(baseUrl, '/api/generate-character', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      description: 'silver swordswoman',
      t2iMode: 'quality_character_v0',
      generationOptions: { candidateCount: 4 },
      imageConfig: { image_size: '2K' },
      maxProviderCalls: 4,
      options: { backgroundMode: 'auto' },
    }),
  })

  const job = await waitForJob(baseUrl, initial.id)
  assert.equal(job.status, 'failed_model_error')
  assert.equal(job.failure_status, 'provider_route_blocked')
  assert.equal(job.retry_hint, 'switch_provider_preset')
  assert.deepEqual(job.provider_call_budget, {
    planned_provider_calls: 4,
    max_provider_calls: 4,
    used_provider_calls: 1,
  })
  assert.equal(job.candidate_selection.candidate_count, 4)
  assert.equal(job.candidate_selection.candidates.length, 1)
  assert.equal(job.candidate_selection.candidates[0].failure_status, 'provider_route_blocked')
  assert.equal(mock.requests.length, 1)
})

test('generate-character rejects provider budgets below planned candidate calls before requesting a provider', async (t) => {
  const providerPng = await encodeRgbaPng(makeSceneTileSheet())
  const mock = await startMockOpenRouter(providerPng)
  t.after(() => mock.server.close())

  const appServer = http.createServer()
  const appPort = await listen(appServer)
  appServer.close()
  await once(appServer, 'close')

  const child = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(appPort),
      OPENROUTER_API_KEY: 'test-key',
      OPENROUTER_BASE_URL: mock.url,
      OPENROUTER_IMAGE_MODEL: 'mock/gemini-image',
      CHARACTER_PROVIDER_PRESETS: '[]',
      CHARACTER_DEFAULT_PROVIDER: 'openrouter-default',
      CHARACTER_JOB_CONCURRENCY: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  t.after(() => child.kill())
  await waitForServer(child)

  const baseUrl = `http://127.0.0.1:${appPort}`
  const initial = await fetchJson(baseUrl, '/api/generate-character', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      description: 'silver swordswoman',
      t2iMode: 'quality_character_v0',
      generationOptions: { candidateCount: 2 },
      maxProviderCalls: 1,
      options: { backgroundMode: 'auto' },
    }),
  })

  const job = await waitForJob(baseUrl, initial.id)
  assert.equal(job.status, 'failed_model_error')
  assert.equal(job.failure_status, 'failed_budget_exhausted')
  assert.match(job.reason, /planned provider calls 2 exceed maxProviderCalls 1/)
  assert.equal(job.retry_hint, 'increase_max_provider_calls')
  assert.deepEqual(job.provider_call_budget, {
    planned_provider_calls: 2,
    max_provider_calls: 1,
    used_provider_calls: 0,
  })
  assert.equal(mock.requests.length, 0)
})

test('generate-scene-tiles requires confirmation before spending provider quota', async (t) => {
  const appServer = http.createServer()
  const appPort = await listen(appServer)
  appServer.close()
  await once(appServer, 'close')

  const child = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(appPort),
      OPENROUTER_API_KEY: 'test-key',
      CHARACTER_PROVIDER_PRESETS: '[]',
      CHARACTER_DEFAULT_PROVIDER: 'openrouter-default',
      CHARACTER_JOB_CONCURRENCY: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  t.after(() => child.kill())
  await waitForServer(child)

  const response = await fetch(new URL('/api/generate-scene-tiles', `http://127.0.0.1:${appPort}`), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ description: 'mossy terrain' }),
  })
  const body = await response.json()

  assert.equal(response.status, 400)
  assert.equal(body.error, 'missing_live_generation_confirmation')
})

test('build-two-point-five-d-tileset requires confirmation before generating a provider material source', async (t) => {
  const appServer = http.createServer()
  const appPort = await listen(appServer)
  appServer.close()
  await once(appServer, 'close')

  const child = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(appPort),
      OPENROUTER_API_KEY: 'test-key',
      CHARACTER_PROVIDER_PRESETS: '[]',
      CHARACTER_DEFAULT_PROVIDER: 'openrouter-default',
      CHARACTER_JOB_CONCURRENCY: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  t.after(() => child.kill())
  await waitForServer(child)

  const response = await fetch(new URL('/api/build-two-point-five-d-tileset', `http://127.0.0.1:${appPort}`), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ material_source_prompt: 'mossy cliff terrain source' }),
  })
  const body = await response.json()

  assert.equal(response.status, 400)
  assert.equal(body.error, 'missing_live_generation_confirmation')
})

test('build-two-point-five-d-tileset routes provider material source through local 2.5D pipeline', async (t) => {
  const providerPng = await encodeRgbaPng(makeTwoPointFiveDMaterialSourceImage())
  const mock = await startMockOpenRouter(providerPng)
  t.after(() => mock.server.close())

  const appServer = http.createServer()
  const appPort = await listen(appServer)
  appServer.close()
  await once(appServer, 'close')

  const child = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(appPort),
      KEY_A: 'source-key',
      CHARACTER_PROVIDER_PRESETS: JSON.stringify([
        { id: 'source-provider', apiKeyEnv: 'KEY_A', baseUrl: mock.url, model: 'mock/material-source', image_size: '1K', aspect_ratio: '1:1' },
      ]),
      CHARACTER_DEFAULT_PROVIDER: 'source-provider',
      CHARACTER_JOB_CONCURRENCY: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  t.after(() => child.kill())
  await waitForServer(child)

  const baseUrl = `http://127.0.0.1:${appPort}`
  const initial = await fetchJson(baseUrl, '/api/build-two-point-five-d-tileset', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      confirm_live_generation: true,
      material_source_prompt: 'mossy cliff grass blocks with dark stone side walls',
      providerPresetId: 'source-provider',
      imageConfig: { image_size: '1K', aspect_ratio: '1:1' },
      generationOptions: { seed: 11, temperature: 0.25 },
      maxProviderCalls: 1,
      options: {
        mapWidth: 4,
        mapHeight: 4,
      },
    }),
  })
  assert.ok(['queued', 'generating', 'post_processing'].includes(initial.status))

  const job = await waitForJob(baseUrl, initial.id)
  assert.equal(job.status, 'done')
  assert.equal(job.ai_material_source_bridge_status, 'pass')
  assert.equal(job.ai_material_source_provider, 'openrouter')
  assert.equal(job.ai_material_source_provider_preset_id, 'source-provider')
  assert.equal(job.ai_material_source_model, 'mock/material-source')
  assert.deepEqual(job.provider_call_budget, {
    planned_provider_calls: 1,
    max_provider_calls: 1,
    used_provider_calls: 1,
  })
  assert.ok(job.ai_material_source_bridge_url)
  assert.ok(job.ai_material_source_prompt_url)
  assert.ok(job.provider_material_source_png_url)
  assert.ok(job.normalized_material_source_png_url)
  assert.ok(job.strict_atlas_png_url)
  assert.ok(job.ldtk_project_url)

  assert.equal(mock.requests.length, 1)
  assert.equal(mock.requests[0].model, 'mock/material-source')
  assert.deepEqual(mock.requests[0].image_config, { aspect_ratio: '1:1', image_size: '1K' })
  assert.equal(mock.requests[0].seed, 11)
  assert.equal(mock.requests[0].temperature, 0.25)
  assert.match(mock.requests[0].messages[0].content, /raw material source image/)
  assert.match(mock.requests[0].messages[0].content, /Do not create a strict atlas/)

  const bridge = await fetchJson(baseUrl, job.ai_material_source_bridge_url)
  assert.equal(bridge.source_role, 'raw_material_source_not_clean_atlas')
  assert.equal(bridge.pipeline_handoff.final_atlas_structure_owner, 'local_deterministic_pipeline')
  assert.equal(bridge.generated_source.direct_asset_use_allowed, false)
})

test('two-point-five-d material-source benchmark writes a dry-run plan without provider calls', async (t) => {
  const appServer = http.createServer()
  const appPort = await listen(appServer)
  appServer.close()
  await once(appServer, 'close')

  const child = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(appPort),
      CHARACTER_PROVIDER_PRESETS: '[]',
      CHARACTER_JOB_CONCURRENCY: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  t.after(() => child.kill())
  await waitForServer(child)

  const baseUrl = `http://127.0.0.1:${appPort}`
  const missingConfirmation = await fetch(new URL('/api/two-point-five-d-material-source-benchmark', baseUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ description: 'mossy cliff material source', candidateCount: 2 }),
  })
  const missingConfirmationBody = await missingConfirmation.json()
  assert.equal(missingConfirmation.status, 400)
  assert.equal(missingConfirmationBody.error, 'missing_live_generation_confirmation')

  const plan = await fetchJson(baseUrl, '/api/two-point-five-d-material-source-benchmark', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      dryRunPlan: true,
      description: 'mossy cliff grass blocks with cool stone side walls',
      candidateCount: 2,
      imageConfig: { image_size: '1K', aspect_ratio: '1:1' },
      options: { mapWidth: 4, mapHeight: 4 },
      runId: 'server_source_benchmark_plan',
    }),
  })

  assert.equal(plan.mode, 'dry_run_plan')
  assert.equal(plan.estimated_provider_calls, 2)
  assert.equal(plan.candidate_count, 2)
  assert.deepEqual(plan.case_ids, ['custom_material_source'])
  assert.ok(plan.plan_url)

  const planArtifact = await fetchJson(baseUrl, plan.plan_url)
  assert.equal(planArtifact.run_id, 'server_source_benchmark_plan')
  assert.equal(typeof planArtifact.provider_config.available, 'boolean')
  assert.equal(planArtifact.provider_config.apiKey, undefined)
  assert.equal(planArtifact.provider_config.api_key, undefined)
  assert.match(planArtifact.claim_boundary, /local deterministic code/)
})

test('two-point-five-d material-source benchmark requires live budget before provider calls', async (t) => {
  const providerPng = await encodeRgbaPng(makeTwoPointFiveDMaterialSourceImage())
  const mock = await startMockOpenRouter(providerPng)
  t.after(() => mock.server.close())

  const appServer = http.createServer()
  const appPort = await listen(appServer)
  appServer.close()
  await once(appServer, 'close')

  const child = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(appPort),
      KEY_A: 'source-key',
      CHARACTER_PROVIDER_PRESETS: JSON.stringify([
        { id: 'source-provider', apiKeyEnv: 'KEY_A', baseUrl: mock.url, model: 'mock/material-source', image_size: '1K', aspect_ratio: '1:1' },
      ]),
      CHARACTER_DEFAULT_PROVIDER: 'source-provider',
      CHARACTER_JOB_CONCURRENCY: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  t.after(() => child.kill())
  await waitForServer(child)

  const baseUrl = `http://127.0.0.1:${appPort}`
  const response = await fetch(new URL('/api/two-point-five-d-material-source-benchmark', baseUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      confirm_live_generation: true,
      description: 'mossy cliff grass blocks with cool stone side walls',
      candidateCount: 1,
      imageConfig: { image_size: '1K', aspect_ratio: '1:1' },
    }),
  })
  const body = await response.json()

  assert.equal(response.status, 400)
  assert.equal(body.error, 'missing_provider_call_budget')
  assert.equal(mock.requests.length, 0)
})

test('two-point-five-d material-source benchmark routes provider candidates through local ranking', async (t) => {
  const providerPng = await encodeRgbaPng(makeTwoPointFiveDMaterialSourceImage())
  const mock = await startMockOpenRouter(providerPng)
  t.after(() => mock.server.close())

  const appServer = http.createServer()
  const appPort = await listen(appServer)
  appServer.close()
  await once(appServer, 'close')

  const child = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(appPort),
      KEY_A: 'source-key',
      CHARACTER_PROVIDER_PRESETS: JSON.stringify([
        { id: 'source-provider', apiKeyEnv: 'KEY_A', baseUrl: mock.url, model: 'mock/material-source', image_size: '1K', aspect_ratio: '1:1' },
      ]),
      CHARACTER_DEFAULT_PROVIDER: 'source-provider',
      CHARACTER_JOB_CONCURRENCY: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  t.after(() => child.kill())
  await waitForServer(child)

  const baseUrl = `http://127.0.0.1:${appPort}`
  const initial = await fetchJson(baseUrl, '/api/two-point-five-d-material-source-benchmark', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      confirm_live_generation: true,
      description: 'mossy cliff grass blocks with cool stone side walls',
      providerPresetId: 'source-provider',
      candidateCount: 1,
      imageConfig: { image_size: '1K', aspect_ratio: '1:1' },
      generationOptions: { seed: 21, temperature: 0.25 },
      maxProviderCalls: 1,
      options: { mapWidth: 4, mapHeight: 4 },
      runId: 'server_source_benchmark_live',
    }),
  })
  assert.ok(['queued', 'generating', 'post_processing'].includes(initial.status))

  const job = await waitForJob(baseUrl, initial.id)
  assert.equal(job.status, 'done')
  assert.equal(job.material_source_benchmark_status, job.benchmark_status)
  assert.equal(job.run_id, 'server_source_benchmark_live')
  assert.deepEqual(job.provider_call_budget, {
    planned_provider_calls: 1,
    max_provider_calls: 1,
    used_provider_calls: 1,
  })
  assert.ok(job.material_source_benchmark_plan_url)
  assert.ok(job.material_source_benchmark_url)
  assert.ok(job.material_source_benchmark_md_url)
  assert.equal(mock.requests.length, 1)
  assert.equal(mock.requests[0].model, 'mock/material-source')
  assert.equal(mock.requests[0].seed, 21)
  assert.match(mock.requests[0].messages[0].content, /raw material source image/)

  const report = await fetchJson(baseUrl, job.material_source_benchmark_url)
  assert.equal(report.mode, 'two_point_five_d_material_source_benchmark_v1')
  assert.equal(report.cases[0].candidate_selection.selected_candidate_id, 'candidate_01')
  assert.match(report.claim_boundary, /does not claim providers can emit final strict atlases/)
})

test('generate-scene-tiles routes provider output through scene pack artifacts', async (t) => {
  const providerPng = await encodeRgbaPng(makeSceneTileSheet())
  const mock = await startMockOpenRouter(providerPng)
  t.after(() => mock.server.close())

  const appServer = http.createServer()
  const appPort = await listen(appServer)
  appServer.close()
  await once(appServer, 'close')

  const child = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(appPort),
      KEY_A: 'scene-key',
      CHARACTER_PROVIDER_PRESETS: JSON.stringify([
        { id: 'scene-provider', apiKeyEnv: 'KEY_A', baseUrl: mock.url, model: 'mock/scene-image' },
      ]),
      CHARACTER_DEFAULT_PROVIDER: 'scene-provider',
      CHARACTER_JOB_CONCURRENCY: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  t.after(() => child.kill())
  await waitForServer(child)

  const baseUrl = `http://127.0.0.1:${appPort}`
  const initial = await fetchJson(baseUrl, '/api/generate-scene-tiles', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      confirm_live_generation: true,
      description: 'mossy forest ground dual-grid tiles',
      providerPresetId: 'scene-provider',
      imageConfig: { image_size: '1K', aspect_ratio: '1:1' },
      options: {
        identifier: 'server_scene',
        width: 2,
        height: 2,
        pattern: 'solid',
        candidateCount: 2,
        styleSnap: true,
        styleMaxColors: 2,
        rawTilePolicy: 'strict',
      },
    }),
  })
  assert.ok(['queued', 'generating'].includes(initial.status))

  const job = await waitForJob(baseUrl, initial.id)
  assert.equal(job.status, 'done')
  assert.ok(job.scene_url)
  assert.ok(job.tile_atlas_url)
  assert.ok(job.tile_map_url)
  assert.ok(job.quality_gate_url)
  assert.ok(job.ldtk_project_url)
  assert.ok(job.tileset_url)
  assert.ok(job.prompt_url)
  assert.ok(job.generation_url)
  assert.ok(job.candidate_selection_url)
  assert.ok(job.scene_pack_zip_url)
  assert.ok(job.style_correction_url)

  assert.equal(mock.requests.length, 2)
  assert.equal(mock.requests[0].model, 'mock/scene-image')
  assert.deepEqual(mock.requests[0].image_config, { aspect_ratio: '1:1', image_size: '1K' })
  assert.match(mock.requests[0].messages[0].content, /mossy forest ground dual-grid tiles/)

  const generation = await fetchJson(baseUrl, job.generation_url)
  assert.equal(generation.mode, 'live_tile_generation')
  assert.equal(generation.provider_preset_id, 'scene-provider')
  assert.equal(generation.candidate_count, 2)
  assert.equal(generation.candidate_selection.candidate_count, 2)
  assert.equal(generation.gate_policy.raw_tile_quality, 'strict')
  assert.equal(generation.prompt_contract.contract_version, 'scene_tile_prompt_contract_v0_6')
  assert.equal(generation.style_correction.mode, 'palette_snap')
  const qualityGate = await fetchJson(baseUrl, job.quality_gate_url)
  assert.equal(qualityGate.status, 'pass')
  assert.equal(qualityGate.gate_policy.raw_tile_quality, 'strict')
  assert.equal(qualityGate.style_correction.mode, 'palette_snap')
  const candidateSelection = await fetchJson(baseUrl, job.candidate_selection_url)
  assert.equal(candidateSelection.selected_status, 'pass')
  assert.equal(candidateSelection.candidate_count, 2)
})
