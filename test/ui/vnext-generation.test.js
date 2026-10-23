import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import {
  VNEXT_GENERATION_COPY,
  VNEXT_PROCESS_OPTIONS,
  VNEXT_PROCESS_UNSUPPORTED,
  vnextAcceptRequest,
  VNEXT_ACCEPTANCE_BASIS,
  buildProcessSheetPayload,
  classifyGenerationJob,
  createVnextGenerationClient,
  canCreateFromJob,
  candidateImageUrl,
  file02Availability,
  isCompletedProcessJobShape,
  isGeneratedArtifactUrl,
  isUsableJobId,
  restoreJobPhase,
} from '../../src/ui/vnext/vnext-generation-client.js'
import { bindVnextGenerationSession, canFollowUpPhase, candidateTransientCanvas, generationViewModel, runningProgress } from '../../src/ui/vnext/vnext-generation-view.js'
import { createVnextAssistantClient } from '../../src/ui/vnext/vnext-assistant-client.js'
import { pollStaticImageJob, staticImageRequest, staticImagePosition, selectStaticImagePreset } from '../../src/ui/vnext/vnext-static-image.js'

test('a large newly imported image does not collide with itself when placed beside a small anchor', () => {
  const anchor = { id: 'old', x: 0, y: 0, width: 64, height: 64 }
  const added = { id: 'new', x: 0, y: 0, width: 1024, height: 1024 }
  const view = { canvases: [anchor, added], positionOf(id) { return this.canvases.find(item => item.id === id) } }
  const size = { canvasId: added.id, width: added.width, height: added.height }
  assert.deepEqual(staticImagePosition(view, anchor, size), { x: 80, y: 0 })
  view.canvases.push({ id: 'neighbor', x: 100, y: 0, width: 64, height: 64 })
  assert.deepEqual(staticImagePosition(view, anchor, size), { x: 180, y: 0 })
})


test('process options bind sealed profile values and list unsupported fields', () => {
  assert.equal(VNEXT_PROCESS_OPTIONS.sourceLayout, 'fixed_region_motion_v0')
  assert.equal(VNEXT_PROCESS_OPTIONS.backgroundMode, 'deterministic_pixel_matte_v2')
  assert.equal(VNEXT_PROCESS_OPTIONS.backgroundTolerance, 24)
  assert.deepEqual(VNEXT_PROCESS_OPTIONS.anchorOffset, { x: 0, y: 0 })
  assert.equal(VNEXT_PROCESS_OPTIONS.autoCorrect, true)
  assert.equal(VNEXT_PROCESS_OPTIONS.motionStabilize, true)
  assert.equal(VNEXT_PROCESS_OPTIONS.pixelFinishing, false)
  assert.equal(VNEXT_PROCESS_OPTIONS.sourcePixelRecovery, 'global_median_v1')
  assert.equal(VNEXT_PROCESS_OPTIONS.description, '')
  assert.ok(VNEXT_PROCESS_UNSUPPORTED.dual_matte)
  assert.ok(VNEXT_PROCESS_UNSUPPORTED.blackSourceBuffer)
  assert.ok(VNEXT_PROCESS_UNSUPPORTED.manualOverrides)
  assert.ok(VNEXT_PROCESS_UNSUPPORTED.styleEnforcement)
  const payload = buildProcessSheetPayload({ name: 'Hero', sourceBase64: 'AAA' })
  assert.equal(payload.source_black_base64, null)
  assert.equal(payload.options.sourceLayout, 'fixed_region_motion_v0')
  assert.equal(payload.options.sourcePixelRecovery, 'global_median_v1')
})

test('generation client queries known jobs and never POSTs generate-character', async () => {
  const seen = []
  const fetchImpl = async (url, init = {}) => {
    seen.push({ url, method: init.method || 'GET' })
    if (String(url).startsWith('/api/jobs/')) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          id: 'job_ready',
          status: 'done',
          quality_status: 'pass',
          debug_report: { status: 'pass' },
          normalized_sheet_url: '/generated/job_ready/normalized_sheet.png',
          zip_url: '/generated/job_ready/character_pack.zip',
        }),
      }
    }
    throw new Error(`unexpected ${url}`)
  }
  const api = createVnextGenerationClient({ fetchImpl })
  const job = await api.getJob('job_ready')
  assert.equal(classifyGenerationJob(job), 'ready')
  const downloads = file02Availability(job)
  assert.equal(downloads.find((item) => item.key === 'zip_url').available, true)
  assert.equal(downloads.find((item) => item.key === 'ocad_zip_url').available, false)
  assert.equal(seen.some((item) => item.method === 'POST'), false)
  assert.equal(isUsableJobId('../secret'), false)
})

test('generation client hydrates the real process-sheet job shape and rejects cross-job artifact URLs', async () => {
  const jobId = 'job_process_shape'
  const urls = {
    normalized_sheet_url: `/generated/${jobId}/normalized_sheet.png`,
    animations_url: `/generated/${jobId}/animations.json`,
    metadata_url: `/generated/${jobId}/metadata.json`,
    editor_metadata_url: `/generated/${jobId}/editor_metadata.json`,
    debug_report_url: `/generated/${jobId}/debug_report.json`,
  }
  const seen = []
  const fetchImpl = async (url) => {
    seen.push(String(url))
    if (String(url) === `/api/jobs/${jobId}`) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ id: jobId, status: 'done', ...urls }) }
    }
    if (String(url) === urls.debug_report_url) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ validation: { status: 'pass' } }) }
    }
    throw new Error(`unexpected ${url}`)
  }
  const api = createVnextGenerationClient({ fetchImpl })
  const job = await api.getJob(jobId)
  assert.equal(isCompletedProcessJobShape(job), true)
  assert.equal(job.debug_report.validation.status, 'pass')
  assert.equal(classifyGenerationJob(job), 'ready')
  assert.equal(file02Availability(job).find((item) => item.key === 'normalized_sheet_url').available, true)
  assert.equal(seen.at(-1), urls.debug_report_url)
  assert.equal(isGeneratedArtifactUrl(`/generated/other/normalized_sheet.png`, jobId, 'normalized_sheet.png'), false)
  assert.equal(file02Availability({ ...job, normalized_sheet_url: '/generated/other/normalized_sheet.png' }).find((item) => item.key === 'normalized_sheet_url').available, false)
})

test('review then live generate posts the sealed 2K 1:1 Gemini contract', async () => {
  const seen = []
  const fetchImpl = async (url, init = {}) => {
    seen.push({ url, method: init.method || 'GET', body: init.body })
    if (String(url) === '/api/gemini-state') {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          active_preset_id: 'gemini_2k',
          presets: [{
            id: 'gemini_2k',
            available: true,
            provider: 'gemini',
            route_kind: 'google_native',
            supports_image_size: true,
            image_config: { image_size: '2K', aspect_ratio: '1:1' },
          }],
        }),
      }
    }
    if (String(url) === '/api/generate-character/review') {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          reviewed_run_id: 'run_1',
          plan_hash: 'a'.repeat(64),
          reference_manifest_sha256: 'b'.repeat(64),
        }),
      }
    }
    if (String(url) === '/api/generate-character') {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ id: 'job_live', status: 'queued' }),
      }
    }
    throw new Error(`unexpected ${url}`)
  }
  const api = createVnextGenerationClient({ fetchImpl })
  const review = await api.reviewCharacter({ description: 'blue knight' })
  const job = await api.startGenerate(review)
  assert.equal(job.id, 'job_live')
  const reviewBody = JSON.parse(seen.find((item) => item.url === '/api/generate-character/review').body)
  assert.equal(reviewBody.generationProfileId, 'full_sheet_fixed_region_v1')
  assert.equal(reviewBody.imageConfig.image_size, '2K')
  assert.equal(reviewBody.maxProviderCalls, 1)
  const liveBody = JSON.parse(seen.find((item) => item.url === '/api/generate-character').body)
  assert.equal(liveBody.confirmLiveGeneration, true)
  assert.equal(liveBody.reviewedRunId, 'run_1')
})

test('continue query without a Job ID does not invent a generate POST', () => {
  assert.equal(isUsableJobId(''), false)
  assert.equal(VNEXT_GENERATION_COPY.missingJobId.includes('resubmit'), true)
})

test('candidate image url uses the job original png and rejects other paths', () => {
  assert.equal(candidateImageUrl({ source_url: '/generated/job_1/source.png' }), '/generated/job_1/source.png')
  assert.equal(candidateImageUrl({ t2i_result_url: '/generated/job_1/t2i_result.png' }), '/generated/job_1/t2i_result.png')
  assert.equal(candidateImageUrl({
    source_url: '/generated/job_1/source.png',
    t2i_result_url: '/generated/job_1/t2i_result.png',
  }), '/generated/job_1/source.png')
  assert.equal(candidateImageUrl({ source_url: 'https://example.test/x.png' }), null)
  assert.equal(candidateImageUrl({ id: 'job_1', source_url: '/generated/job_2/source.png' }), null)
  assert.equal(candidateImageUrl({ source_url: '/generated/../secret.png' }), null)
  assert.equal(candidateImageUrl({ normalized_sheet_url: '/generated/job_1/normalized_sheet.png' }), null)
  assert.deepEqual(candidateTransientCanvas({
    id: 'job_1',
    source_url: '/generated/job_1/source.png',
  }, { width: 252, height: 252 }), {
    id: 'candidate:job_1',
    x: 0,
    y: 0,
    width: 252,
    height: 252,
    previewUrl: '/generated/job_1/source.png',
    name: 'Generated candidate',
    transient: true,
  })
})

test('a preset run is conversational progress until its result; only the sheet with downloads and the Job ID form are rich', () => {
  const previousDocument = globalThis.document
  globalThis.document = { createElement: tag => genNode(tag) }
  try { presetModelChecks() } finally { globalThis.document = previousDocument }
})
function presetModelChecks() {
  for (const phase of ['review', 'running', 'processing']) {
    const model = generationViewModel({ phase, job: phase === 'review' ? null : { status: 'generating' } })
    assert.equal(model.busy, true, `${phase} is shown as progress`)
    assert.equal(model.fields, undefined); assert.equal(model.downloads, undefined)
  }
  assert.equal(generationViewModel({ phase: 'candidate', autoRun: {} }).busy, true)
  assert.deepEqual(generationViewModel({ phase: 'candidate' }).actions.map(action => action.action), ['adopt'], 'only an interrupted run asks to finish')
  const failed = generationViewModel({ phase: 'failed' })
  assert.equal(failed.tone, 'warning'); assert.equal(failed.downloads, undefined)
  const ready = generationViewModel({ phase: 'ready', job: { id: 'job_1' }, projectId: 'proj' })
  assert.equal(ready.title, VNEXT_GENERATION_COPY.readyPendingTitle, 'not "on the canvas" before it is added')
  assert.ok(ready.downloads.length > 0)
  const added = generationViewModel({ phase: 'ready', job: { id: 'job_1' }, projectId: 'proj', addedKeys: new Set(['proj|job_1']) })
  assert.equal(added.title, VNEXT_GENERATION_COPY.readyTitle); assert.equal(added.actions.length, 0)
  const stopped = generationViewModel({ phase: 'idle', error: VNEXT_GENERATION_COPY.stoppedBody })
  assert.equal(stopped.title, VNEXT_GENERATION_COPY.stoppedTitle, 'a stop is not reported as a connection failure')
  assert.equal(stopped.fields.length, 1, 'the Job ID form stays available')
}

test('follow-up chat skips review after a candidate is on the canvas', () => {
  assert.equal(canFollowUpPhase('idle'), false)
  assert.equal(canFollowUpPhase('review'), false)
  assert.equal(canFollowUpPhase('running'), false)
  assert.equal(canFollowUpPhase('candidate'), true)
  assert.equal(canFollowUpPhase('ready'), true)
  assert.equal(canFollowUpPhase('failed'), true)
})

test('a requested preset runs the plan check, one live call, processing and placement in order', async () => {
  const source = await readFile('src/ui/vnext/vnext-generation-view.js', 'utf8')
  const slice = (from, to) => {
    const start = source.indexOf(from), end = source.indexOf(to, start)
    assert.ok(start >= 0 && end > start, `${from} exists`)
    return source.slice(start, end)
  }
  assert.equal(slice('async function runReview', 'async function runPreset').includes('startGenerate'), false,
    'the plan check is provider-free; only the bound live step calls the provider')
  const run = slice('async function runPreset', 'async function confirmGenerate')
  const order = ['runReview(', 'confirmGenerate()', 'adoptAndProcess()', 'addToCanvas()'].map(step => run.indexOf(step))
  assert.ok(order.every(index => index > 0) && order.every((index, i) => i === 0 || index > order[i - 1]), 'steps run in order without approval stops')
  assert.doesNotMatch(source, /confirm-generate|Confirm & generate|Keep existing asset|Adopt & process/)
})

test('adopt accepts the original job before downloading and processing it', async () => {
  const source = await readFile('src/ui/vnext/vnext-generation-view.js', 'utf8')
  const start = source.indexOf('async function adoptAndProcess')
  const end = source.indexOf('async function addToCanvas', start)
  assert.ok(start >= 0 && end > start)
  const body = source.slice(start, end)
  assert.match(body, /api\.acceptJob\(jobId\)/, 'the view passes only the Job ID; the client builds the acceptance from verified artifacts')
  assert.match(body, /api\.processSheet\(/)
  assert.ok(body.indexOf('api.acceptJob') < body.indexOf('api.processSheet'))
})

test('the acceptance request keeps the strict evidence body and adds only the request basis', () => {
  // The hashes come from prepareStrictManualAcceptanceEvidence (verified artifact bytes and the sealed
  // review); the real-server contract is covered by test/ui/vnext-preset-acceptance-contract.test.js.
  const evidence = { confirmManualAcceptance: true, expectedPlanHash: 'a'.repeat(64), expectedReferenceManifestSha256: 'b'.repeat(64),
    expectedRawProviderOutputSha256: 'c'.repeat(64), expectedBackgroundRemovedProviderOutputSha256: 'd'.repeat(64),
    expectedSourceSha256: 'e'.repeat(64), expectedNormalizedSheetSha256: 'f'.repeat(64), humanReviewedIssueCount: 0 }
  assert.deepEqual(vnextAcceptRequest(evidence), { ...evidence, acceptanceBasis: VNEXT_ACCEPTANCE_BASIS })
  assert.equal(VNEXT_ACCEPTANCE_BASIS, 'user_request', 'the request is the basis; no reviewed issues are claimed')
})

test('project binding invalidates in-flight generation state', async () => {
  const source = await readFile('src/ui/vnext/vnext-generation-view.js', 'utf8')
  assert.match(source, /projectEpoch \+= 1/)
  assert.match(source, /host\.replaceChildren\(\)/)
  assert.match(source, /if \(!isCurrentContext\(token\)\) return/)
})

test('adopt uses process-sheet and from-job only after a passing process job', async () => {
  assert.equal(restoreJobPhase({
    status: 'done',
    human_decision_status: 'pending',
    source_url: '/generated/job_1/source.png',
    normalized_sheet_url: '/generated/job_1/normalized_sheet.png',
  }), 'candidate')
  assert.equal(canCreateFromJob({
    status: 'done',
    human_decision_status: 'pending',
    quality_status: 'pass',
    normalized_sheet_url: '/generated/job_1/normalized_sheet.png',
  }), false)
  assert.equal(canCreateFromJob({
    status: 'done',
    quality_status: 'pass',
    debug_report: { status: 'pass' },
    normalized_sheet_url: '/generated/job_p/normalized_sheet.png',
  }), true)
  const seen = []
  const fetchImpl = async (url, init = {}) => {
    seen.push({ url, method: init.method || 'GET' })
    if (String(url) === '/api/process-sheet') {
      return { ok: true, status: 200, text: async () => JSON.stringify({ id: 'job_p', status: 'queued' }) }
    }
    throw new Error(`unexpected ${url}`)
  }
  const api = createVnextGenerationClient({ fetchImpl })
  const job = await api.processSheet({ name: 'Sprite', sourceBase64: 'AAA' })
  assert.equal(job.id, 'job_p')
  assert.equal(seen.some((item) => String(item.url).includes('generate-character')), false)
  const processing = generationViewModel({ phase: 'processing', job: { status: 'post_processing' } })
  assert.equal(processing.title, VNEXT_GENERATION_COPY.processingTitle)
  assert.equal(processing.progress.value, 0.85)
})

test('running progress maps real job stages and elapsed time, not an ETA', () => {
  const now = Date.parse('2026-09-20T12:00:30Z')
  assert.deepEqual(runningProgress({ status: 'queued', created_at: '2026-09-20T12:00:00Z' }, now), {
    value: 0.2,
    label: 'Queued · 30s',
  })
  assert.deepEqual(runningProgress({ status: 'generating', created_at: '2026-09-20T11:58:00Z' }, now), {
    value: 0.55,
    label: 'Generating · 2m 30s',
  })
  assert.deepEqual(runningProgress({ status: 'post_processing' }, now), {
    value: 0.85,
    label: 'Finishing',
  })
  const model = generationViewModel({ phase: 'running', job: { status: 'generating' } })
  assert.equal(model.progress.value, 0.55)
  assert.equal(model.progress.label, 'Generating')
  assert.equal(model.progress.tone, 'info')
  assert.deepEqual(model.actions.map(action => action.action), ['stop'])
  const preparing = generationViewModel({ phase: 'running' })
  assert.equal(preparing.progress, undefined, 'no stage progress before a job exists')
  assert.equal(preparing.title, VNEXT_GENERATION_COPY.reviewTitle)
  assert.equal(generationViewModel({ phase: 'candidate' }).tone, undefined)
})

test('preview html starts Send disabled and hosts text discussion plus GEN-07–10/FILE-02', async () => {
  const html = await readFile('src/ui/vnext/vnext-preview.html', 'utf8')
  assert.match(html, /data-capability="GEN-05"[^>]*disabled/)
  assert.match(html, /data-capability="CHAT-01 GEN-07 GEN-08 GEN-09 GEN-10 FILE-02"/)
  assert.match(html, /id="vnext-assistant-status" class="visually-hidden" role="status"><\/p>/)
  assert.match(html, /class="vnext-composer-end"[^>]*>\s*<span class="vnext-assistant-model-wrap">\s*<button type="button" id="vnext-assistant-model"/)
  assert.ok(html.indexOf('data-capability="GEN-03"') < html.indexOf('id="vnext-assistant-model"'))
  assert.match(html, /data-figma="2152:1440"/)
})

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    async text() { return JSON.stringify(body) },
    async json() { return body },
  }
}

test('a follow-up preset request runs once with the reference sealed at review; a later draft change neither cancels nor repeats it', async () => {
  const posts = []
  let releaseReview
  const reviewGate = new Promise((resolve) => { releaseReview = resolve })
  let reviewEntered
  const reviewStarted = new Promise((resolve) => { reviewEntered = resolve })
  const harness = generationHarness(async (url, init = {}) => {
    const path = String(url)
    if (path === '/generated/job_old/source.png') {
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/octet-stream' },
        async arrayBuffer() { return new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]).buffer },
      }
    }
    if (path === '/api/gemini-state') {
      return jsonResponse(200, {
        active_preset_id: 'gemini_2k',
        presets: [{
          id: 'gemini_2k',
          available: true,
          provider: 'gemini',
          route_kind: 'google_native',
          supports_image_size: true,
          image_config: { image_size: '2K', aspect_ratio: '1:1' },
        }],
      })
    }
    if (path === '/api/generate-character/review') {
      posts.push({ path, body: init.body })
      reviewEntered()
      await reviewGate
      return jsonResponse(200, { reviewed_run_id: 'run_1', plan_hash: 'a'.repeat(64), reference_manifest_sha256: 'b'.repeat(64) })
    }
    if (path === '/api/generate-character') {
      posts.push({ path, body: init.body })
      return jsonResponse(200, { id: 'job_live', status: 'done', source_url: '/generated/job_live/source.png' })
    }
    if (path.startsWith('/api/jobs/')) return jsonResponse(200, { id: 'job_live', status: 'done', source_url: '/generated/job_live/source.png' })
    throw new Error(`unexpected ${path}`)
  })
  const realTimeout = globalThis.setTimeout
  globalThis.setTimeout = (fn) => realTimeout(fn, 0)
  try {
    harness.gen.phase = 'candidate'
    harness.gen.job = { id: 'job_old', status: 'done', source_url: '/generated/job_old/source.png' }
    harness.prompt.value = 'brighter'
    harness.prompt.dispatchEvent(new Event('input', { bubbles: true }))
    const run = harness.send.dispatchEvent({ type: 'click', target: harness.send })
    await reviewStarted
    assert.equal(posts.filter((item) => item.path === '/api/generate-character/review').length, 1)
    assert.equal(harness.host.querySelectorAll('[data-gen-action]').some(node => /confirm|adopt|idle/.test(node.dataset.genAction)), false,
      'no approval control is rendered while the request runs')
    harness.state.draft = { ...harness.state.draft, reference: { name: 'new.png' } }
    harness.prompt.value = 'a newer draft'
    harness.prompt.dispatchEvent(new Event('input', { bubbles: true }))
    releaseReview()
    await run
    for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve))
    assert.equal(posts.filter((item) => item.path === '/api/generate-character/review').length, 1)
    assert.equal(posts.filter((item) => item.path === '/api/generate-character').length, 1, 'exactly one bound live call, without a click')
    assert.equal(JSON.parse(posts.find((item) => item.path === '/api/generate-character').body).reviewedRunId, 'run_1')
    assert.equal(harness.prompt.value, 'a newer draft', 'the newer draft stays in the composer')
  } finally {
    globalThis.setTimeout = realTimeout
    await new Promise((resolve) => setTimeout(resolve, 0))
    harness.restore()
  }
})

test('known job input is queried, waits through running, and a stopped late result does not replace context', async () => {
  let releaseJob
  const jobGate = new Promise((resolve) => { releaseJob = resolve })
  let entered
  const started = new Promise((resolve) => { entered = resolve })
  const harness = generationHarness(async () => {
    entered()
    await jobGate
    return jsonResponse(200, { id: 'job_wait', status: 'done', source_url: '/generated/job_wait/source.png' })
  })
  try {
    harness.gen.jobIdDraft = ''
    await harness.host.dispatchEvent({
      type: 'click',
      target: { dataset: { genAction: 'query' }, closest(selector) { return selector.includes('gen-action') ? this : null } },
    })
    const field = harness.host.querySelector('#vnext-job-id')
    assert.ok(field)
    field.value = 'job_wait'
    const pending = harness.host.dispatchEvent({
      type: 'click',
      target: { dataset: { genAction: 'query' }, closest(selector) { return selector.includes('gen-action') ? this : null } },
    })
    await started
    await harness.host.dispatchEvent({
      type: 'click',
      target: { dataset: { genAction: 'stop' }, closest(selector) { return selector.includes('gen-action') ? this : null } },
    })
    releaseJob()
    await pending
    assert.equal(harness.gen.phase, 'idle')
    assert.notEqual(harness.gen.job?.status, 'done')
  } finally {
    harness.restore()
  }
})

test('ready add failure stays visible and does not pass a null transient', async () => {
  const seen = []
  const harness = generationHarness(async (url) => {
    seen.push(String(url))
    throw Object.assign(new Error('download_failed'), { code: 'download_failed' })
  })
  try {
    harness.gen.phase = 'ready'
    harness.gen.job = {
      id: 'job_ready',
      status: 'done',
      quality_status: 'pass',
      debug_report: { status: 'pass' },
      normalized_sheet_url: '/generated/job_ready/normalized_sheet.png',
      human_decision_status: 'accepted',
    }
    harness.session.view.setTransients = (items) => {
      seen.push(items)
      if (items.some((item) => !item)) throw new Error('null transient')
    }
    const previousImage = globalThis.Image
    globalThis.Image = class {
      set src(_value) {
        this.naturalWidth = 8
        this.naturalHeight = 8
        this.onload?.()
      }
    }
    harness.gen.phase = 'ready'
    await harness.host.dispatchEvent({
      type: 'click',
      target: { dataset: { genAction: 'add-canvas' }, closest(selector) { return selector.includes('gen-action') ? this : null } },
    })
    await new Promise((resolve) => setImmediate(resolve))
    // The failure stays visible in plain language; the raw code is not shown in the conversation.
    assert.equal(harness.gen.error, 'The sheet was not added to the canvas.')
    assert.doesNotMatch(cardText(harness.host), /download_failed/)
    assert.equal(harness.gen.phase, 'ready')
    assert.equal(harness.transients.some((items) => items.some((item) => !item)), false)
    globalThis.Image = previousImage
  } finally {
    harness.restore()
  }
})

function clickAction(node) {
  return node.dispatchEvent({ type: 'click', bubbles: true, target: node })
}

function liveJobInput(host) {
  return host.querySelector('#vnext-job-id')
}

function queryButton(input) {
  return input.parentNode.parentNode.parentNode.querySelector('[data-gen-action="query"]')
}

test('second recovery card queries only its own job, and a stopped late result stays isolated', async () => {
  const gets = []
  let releaseA
  const gateA = new Promise((resolve) => { releaseA = resolve })
  let enteredA
  const startedA = new Promise((resolve) => { enteredA = resolve })
  const harness = generationHarness(async (url) => {
    const path = String(url)
    gets.push(path)
    if (path.endsWith('/job_a')) {
      enteredA()
      await gateA
      return jsonResponse(200, { id: 'job_a', status: 'done', source_url: '/generated/job_a/source.png' })
    }
    if (path.endsWith('/job_b')) {
      return jsonResponse(200, { id: 'job_b', status: 'done', source_url: '/generated/job_b/source.png' })
    }
    throw new Error(`unexpected ${path}`)
  })
  try {
    await harness.host.dispatchEvent({
      type: 'click',
      target: { dataset: { genAction: 'query' }, closest(selector) { return selector.includes('gen-action') ? this : null } },
    })
    const first = liveJobInput(harness.host)
    assert.ok(first)
    first.value = 'job_a'
    const pendingA = clickAction(queryButton(first))
    await startedA
    await clickAction(harness.host.querySelector('[data-gen-action="stop"]'))
    releaseA()
    await pendingA
    assert.notEqual(harness.gen.job?.status, 'done')
    const cards = harness.host.querySelectorAll('.vnext-turn')
    assert.equal(cards.length, 1, 'the run keeps one turn; its recovery form is re-rendered in place')
    const live = liveJobInput(harness.host)
    assert.notEqual(live, first)
    live.value = 'job_b'
    await live.dispatchEvent(new Event('input', { bubbles: true }))
    assert.equal(harness.gen.jobIdDraft, 'job_b')
    first.value = 'job_a'
    await clickAction(queryButton(live))
    assert.deepEqual(gets.filter((path) => path.includes('/api/jobs/')), ['/api/jobs/job_a', '/api/jobs/job_b'])
    assert.equal(harness.gen.job?.id, 'job_b')
  } finally {
    harness.restore()
  }
})

test('known job query waits from running to done and stops pretending to wait at the existing limit', async () => {
  let calls = 0
  const harness = generationHarness(async () => {
    calls += 1
    if (calls === 1) return jsonResponse(200, { id: 'job_run', status: 'queued' })
    return jsonResponse(200, { id: 'job_run', status: 'done', source_url: '/generated/job_run/source.png' })
  })
  const realTimeout = globalThis.setTimeout
  globalThis.setTimeout = (fn) => realTimeout(fn, 0)
  try {
    await harness.host.dispatchEvent({
      type: 'click',
      target: { dataset: { genAction: 'query' }, closest(selector) { return selector.includes('gen-action') ? this : null } },
    })
    liveJobInput(harness.host).value = 'job_run'
    await clickAction(queryButton(liveJobInput(harness.host)))
    assert.equal(harness.gen.phase, 'candidate')
    assert.equal(harness.gen.waiting, false)
    assert.equal(calls, 2)
  } finally {
    globalThis.setTimeout = realTimeout
    harness.restore()
  }
})

test('known job query becomes recoverable after the existing wait limit', async () => {
  let calls = 0
  const harness = generationHarness(async () => {
    calls += 1
    return jsonResponse(200, { id: 'job_limit', status: 'generating' })
  })
  const realTimeout = globalThis.setTimeout
  globalThis.setTimeout = (fn) => realTimeout(fn, 0)
  try {
    await harness.host.dispatchEvent({
      type: 'click',
      target: { dataset: { genAction: 'query' }, closest(selector) { return selector.includes('gen-action') ? this : null } },
    })
    liveJobInput(harness.host).value = 'job_limit'
    await clickAction(queryButton(liveJobInput(harness.host)))
    assert.equal(calls, 240)
    assert.equal(harness.gen.waiting, false)
    assert.equal(harness.gen.phase, 'idle')
    assert.match(harness.gen.error, /not yet known/)
    assert.equal(liveJobInput(harness.host).disabled, false)
    assert.ok(harness.host.querySelectorAll('[data-gen-action="stop"]').every((node) => node.disabled))
  } finally {
    globalThis.setTimeout = realTimeout
    harness.restore()
  }
})

// A preset run starts from the request itself; "Generate again" replays the last request as a new run.
// "Generate again" repeats a request remembered for the current project only.
function armRun(harness) {
  harness.gen.lastRequest = { prompt: 'brighter', presetId: 'fixed-region-motion', useReference: false, followUp: false, projectId: harness.gen.projectId }
}
function presetFetch(inner) {
  return async (url, init) => {
    const path = String(url)
    if (path === '/api/gemini-state') return jsonResponse(200, { active_preset_id: 'gemini_2k', presets: [{ id: 'gemini_2k', available: true, provider: 'gemini',
      route_kind: 'google_native', supports_image_size: true, image_config: { image_size: '2K', aspect_ratio: '1:1' } }] })
    if (path === '/api/generate-character/review') return jsonResponse(200, { reviewed_run_id: 'run_a', plan_hash: 'a'.repeat(64), reference_manifest_sha256: 'b'.repeat(64) })
    return inner(url, init)
  }
}
function runTarget() {
  return { dataset: { genAction: 'review' }, closest(selector) { return selector.includes('gen-action') ? this : null } }
}

function actionTarget(action) {
  return { dataset: { genAction: action }, closest(selector) { return selector.includes('gen-action') ? this : null } }
}

test('a stopped run cannot clear a newer query, overwrite its job, or resume processing', async () => {
  let releaseA
  const gateA = new Promise((resolve) => { releaseA = resolve })
  let enteredA
  const startedA = new Promise((resolve) => { enteredA = resolve })
  let releaseB
  const gateB = new Promise((resolve) => { releaseB = resolve })
  let enteredB
  const startedB = new Promise((resolve) => { enteredB = resolve })
  const harness = generationHarness(presetFetch(async (url) => {
    const path = String(url)
    if (path === '/api/generate-character') {
      return jsonResponse(200, { id: 'job_a', status: 'queued' })
    }
    if (path.endsWith('/job_a')) {
      enteredA()
      await gateA
      return jsonResponse(200, { id: 'job_a', status: 'done', source_url: '/generated/job_a/source.png' })
    }
    if (path.endsWith('/job_b')) {
      enteredB()
      await gateB
      return jsonResponse(200, { id: 'job_b', status: 'done', source_url: '/generated/job_b/source.png' })
    }
    throw new Error(`unexpected ${path}`)
  }))
  try {
    armRun(harness)
    const pendingA = harness.host.dispatchEvent({ type: 'click', target: runTarget() })
    await startedA
    await harness.host.dispatchEvent({ type: 'click', target: actionTarget('stop') })
    const live = liveJobInput(harness.host)
    live.value = 'job_b'
    const pendingB = clickAction(queryButton(live))
    await startedB
    releaseA()
    await pendingA
    assert.equal(harness.gen.waiting, true)
    assert.notEqual(harness.gen.job?.status, 'done')
    assert.equal(harness.gen.error, null)
    releaseB()
    await pendingB
    assert.equal(harness.gen.job?.id, 'job_b')
    assert.equal(harness.gen.phase, 'candidate', 'the queried job is not processed by the stopped run')
    assert.equal(harness.gen.waiting, false)
    assert.equal(harness.gen.autoRun, null)
  } finally {
    harness.restore()
  }
})

for (const lateA of ['success', 'failure']) test(`a stopped plan check (late ${lateA}) cannot overwrite a newer run, clear its waiting state, or resume`, async () => {
  const reviews = [], gates = [], entered = [], lives = []
  for (let i = 0; i < 2; i++) {
    let release, enter
    gates.push(new Promise(resolve => { release = resolve }))
    entered.push(new Promise(resolve => { enter = resolve }))
    reviews.push({ release, enter })
  }
  let reviewCalls = 0
  const harness = generationHarness(async (url, init = {}) => {
    const path = String(url)
    if (path === '/api/gemini-state') return jsonResponse(200, { active_preset_id: 'gemini_2k', presets: [{ id: 'gemini_2k', available: true, provider: 'gemini',
      route_kind: 'google_native', supports_image_size: true, image_config: { image_size: '2K', aspect_ratio: '1:1' } }] })
    if (path === '/api/generate-character/review') {
      const index = reviewCalls++
      reviews[index].enter()
      const outcome = await gates[index]
      if (outcome === 'failure') return jsonResponse(503, { error: 'review_unavailable', reason: 'Plan check A failed late.' })
      return jsonResponse(200, { reviewed_run_id: `run_${index ? 'b' : 'a'}`, plan_hash: String(index).repeat(64), reference_manifest_sha256: 'b'.repeat(64) })
    }
    if (path === '/api/generate-character') {
      lives.push(JSON.parse(init.body))
      return jsonResponse(503, { error: 'provider_unavailable', reason: 'Provider offline in this test.' })
    }
    throw new Error(`unexpected ${path}`)
  })
  try {
    armRun(harness)
    const pendingA = harness.host.dispatchEvent({ type: 'click', target: runTarget() })
    await entered[0]
    await harness.host.dispatchEvent({ type: 'click', target: actionTarget('stop') })
    assert.equal(harness.gen.waiting, false); assert.equal(harness.gen.autoRun, null)
    assert.equal(harness.gen.error, VNEXT_GENERATION_COPY.stoppedBeforeCall, 'a Stop before the live call says nothing was generated')
    assert.equal(liveJobInput(harness.host), null, 'no Job ID form before any job exists')
    harness.gen.lastRequest = { prompt: 'run B knight', presetId: 'fixed-region-motion', useReference: false, followUp: false, projectId: harness.gen.projectId }
    const pendingB = harness.host.dispatchEvent({ type: 'click', target: runTarget() })
    await entered[1]
    const runB = harness.gen.autoRun
    assert.ok(runB); assert.equal(harness.gen.waiting, true)
    reviews[0].release(lateA)
    await pendingA
    for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve))
    assert.equal(harness.gen.waiting, true, 'B keeps waiting for its own plan check')
    assert.equal(harness.gen.autoRun, runB, 'B still owns the run')
    assert.equal(harness.gen.review, null, 'A cannot install its plan')
    assert.equal(harness.gen.error, null, 'A cannot report its failure over B')
    assert.equal(harness.gen.phase, 'running')
    assert.equal(lives.length, 0, 'stopped run A never reaches the live call')
    reviews[1].release('success')
    await pendingB
    assert.equal(lives.length, 1, 'B makes exactly one live call')
    assert.equal(lives[0].reviewedRunId, 'run_b', 'the live call is bound to B\'s plan')
    assert.equal(harness.gen.waiting, false); assert.equal(harness.gen.autoRun, null)
    assert.equal(harness.gen.phase, 'idle'); assert.match(harness.gen.error, /Provider offline/)
  } finally {
    harness.restore()
  }
})

test('a late live start from a stopped run cannot claim the newer query epoch', async () => {
  let releasePost
  const postGate = new Promise((resolve) => { releasePost = resolve })
  let enteredPost
  const postStarted = new Promise((resolve) => { enteredPost = resolve })
  let releaseB
  const gateB = new Promise((resolve) => { releaseB = resolve })
  let enteredB
  const startedB = new Promise((resolve) => { enteredB = resolve })
  const gets = []
  const harness = generationHarness(presetFetch(async (url) => {
    const path = String(url)
    if (path === '/api/generate-character') {
      enteredPost()
      await postGate
      return jsonResponse(200, { id: 'job_a', status: 'queued' })
    }
    gets.push(path)
    if (path.endsWith('/job_a')) {
      return jsonResponse(200, { id: 'job_a', status: 'done', source_url: '/generated/job_a/source.png' })
    }
    if (path.endsWith('/job_b')) {
      enteredB()
      await gateB
      return jsonResponse(200, { id: 'job_b', status: 'done', source_url: '/generated/job_b/source.png' })
    }
    throw new Error(`unexpected ${path}`)
  }))
  try {
    armRun(harness)
    const pendingA = harness.host.dispatchEvent({ type: 'click', target: runTarget() })
    await postStarted
    await harness.host.dispatchEvent({ type: 'click', target: actionTarget('stop') })
    const live = liveJobInput(harness.host)
    live.value = 'job_b'
    const pendingB = clickAction(queryButton(live))
    await startedB
    releasePost()
    await pendingA
    assert.equal(harness.gen.waiting, true)
    assert.notEqual(harness.gen.job?.id, 'job_a')
    assert.equal(harness.gen.error, null)
    assert.equal(gets.some((path) => path.endsWith('/job_a')), false)
    releaseB()
    await pendingB
    assert.equal(harness.gen.job?.id, 'job_b')
    assert.equal(harness.gen.phase, 'candidate')
    assert.equal(harness.gen.error, null)
  } finally {
    harness.restore()
  }
})

function readyJob(id) {
  return {
    id,
    status: 'done',
    quality_status: 'pass',
    debug_report: { status: 'pass' },
    normalized_sheet_url: `/generated/${id}/normalized_sheet.png`,
    human_decision_status: 'accepted',
  }
}

test('add B does not reuse unknown add A, and retrying A keeps the same operation', async () => {
  const posts = []
  let releaseA
  const gateA = new Promise((resolve) => { releaseA = resolve })
  const harness = generationHarness(async (url) => {
    if (String(url).endsWith('.png')) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/octet-stream' },
        async arrayBuffer() { return new Uint8Array([1, 2, 3, 4]).buffer },
      }
    }
    throw new Error(`unexpected ${url}`)
  })
  let failA = true
  harness.session.api.createFromJob = async (projectId, payload) => {
    posts.push({ projectId, ...payload })
    if (payload.jobId === 'job_a' && failA) {
      await gateA
      throw Object.assign(new Error('disk'), { kind: 'unknown', code: 'storage_commit_failed', reason: 'disk' })
    }
    return { project: { ...harness.session.project, revision: harness.session.project.revision + posts.length } }
  }
  try {
    harness.gen.phase = 'ready'
    harness.gen.job = readyJob('job_a')
    const first = harness.host.dispatchEvent({
      type: 'click',
      target: { dataset: { genAction: 'add-canvas' }, closest(selector) { return selector.includes('gen-action') ? this : null } },
    })
    await new Promise((resolve) => {
      const check = () => (posts.length ? resolve() : setImmediate(check))
      check()
    })
    const second = harness.host.dispatchEvent({
      type: 'click',
      target: { dataset: { genAction: 'add-canvas' }, closest(selector) { return selector.includes('gen-action') ? this : null } },
    })
    assert.equal(posts.length, 1)
    releaseA()
    await first
    await second
    // An unconfirmed save is reported in plain language and keeps its operation for the same retry.
    assert.equal(harness.gen.error, 'Adding the sheet was not confirmed. Add to canvas again finishes this same save; it does not create another canvas.')
    assert.equal(harness.gen.phase, 'ready')
    harness.gen.job = readyJob('job_b')
    await harness.host.dispatchEvent({
      type: 'click',
      target: { dataset: { genAction: 'add-canvas' }, closest(selector) { return selector.includes('gen-action') ? this : null } },
    })
    assert.equal(posts[1].jobId, 'job_b')
    assert.notEqual(posts[1].operationId, posts[0].operationId)
    assert.equal(posts[1].projectId, 'proj')
    harness.gen.job = readyJob('job_a')
    failA = false
    await harness.host.dispatchEvent({
      type: 'click',
      target: { dataset: { genAction: 'add-canvas' }, closest(selector) { return selector.includes('gen-action') ? this : null } },
    })
    assert.equal(posts[2].jobId, 'job_a')
    assert.equal(posts[2].operationId, posts[0].operationId)
    assert.equal(posts[2].expectedSha256, posts[0].expectedSha256)
  } finally {
    harness.restore()
  }
})

test('added card shows Added, and a reload failure does not enable another submit', async () => {
  const posts = []
  const harness = generationHarness(async () => ({
    ok: true,
    status: 200,
    headers: { get: () => 'application/octet-stream' },
    async arrayBuffer() { return new Uint8Array([1, 2, 3, 4]).buffer },
  }))
  harness.session.api.createFromJob = async (_projectId, payload) => {
    posts.push(payload)
    return { project: { ...harness.session.project, revision: harness.session.project.revision + 1 } }
  }
  try {
    harness.gen.phase = 'ready'
    harness.gen.job = readyJob('job_a')
    harness.gen.projectId = 'proj'
    await harness.host.dispatchEvent({
      type: 'click',
      target: { dataset: { genAction: 'add-canvas' }, closest(selector) { return selector.includes('gen-action') ? this : null } },
    })
    const added = harness.host.querySelector('.vnext-workflow-primary')
    assert.equal(harness.gen.error, null)
    assert.equal(cardText(harness.host).includes('Added as a new canvas.'), true)
    assert.equal(cardText(harness.host).includes('Sprite sheet on the canvas'), true)
    assert.equal(added, null, 'nothing is left to add')
    await harness.host.dispatchEvent({
      type: 'click',
      target: added || { dataset: { genAction: 'add-canvas' }, disabled: true, closest(selector) { return selector.includes('gen-action') ? this : null } },
    })
    assert.equal(posts.length, 1)

    harness.gen.addedKeys = new Set()
    harness.gen.reloadFailed = false
    harness.session.reloadProject = async () => { throw new Error('Saved, but the canvas did not reload.') }
    harness.gen.job = readyJob('job_b')
    await harness.host.dispatchEvent({
      type: 'click',
      target: { dataset: { genAction: 'add-canvas' }, closest(selector) { return selector.includes('gen-action') ? this : null } },
    })
    assert.equal(harness.gen.reloadFailed, true)
    assert.match(harness.gen.error, /did not reload/)
    assert.equal(cardText(harness.host).includes('Saved, canvas did not reload'), true)
    assert.equal(harness.host.querySelector('[data-gen-action="add-canvas"]'), null, 'a saved sheet offers no second add')
    const reload = harness.host.querySelector('[data-gen-action="reload-canvas"]')
    assert.ok(reload, 'the saved sheet offers only its reload')
    await harness.host.dispatchEvent({
      type: 'click',
      target: { dataset: {}, disabled: true, closest() { return null } },
    })
    assert.equal(posts.length, 2)
  } finally {
    harness.restore()
  }
})

test('a placed preset sheet binds Undo to exactly its new canvas after its reload recovers, and a replayed save records one entry', async () => {
  const posts = [], entries = [], undone = []
  let latest = null
  const harness = generationHarness(async () => ({
    ok: true, status: 200, headers: { get: () => 'application/octet-stream' },
    async arrayBuffer() { return new Uint8Array([1, 2, 3, 4]).buffer },
  }))
  const projectWith = (revision, ids) => ({ ...harness.session.project, revision,
    canvases: Object.fromEntries([['other', { id: 'other', document_id: 'doc_other' }], ...ids.map(id => [id, { id, document_id: `doc_${id}` }])]) })
  harness.session.recordCanvasAddition = ({ projectId, canvasId }) => {
    const existing = entries.find(entry => entry.canvasId === canvasId)
    if (existing) return existing
    const entry = { kind: 'import', projectId, canvasId }
    entries.push(entry); latest = entry
    return entry
  }
  harness.session.latestUndoEntry = () => latest
  harness.session.undoIfLatest = async entry => { if (entry !== latest) return false; undone.push(entry); latest = null; return true }
  let reloadFails = true, unknownB = true, getProjects = 0
  harness.session.reloadProject = async project => {
    if (reloadFails) { reloadFails = false; throw new Error('Saved, but the canvas did not reload.') }
    harness.session.project = project
    return { committed: true, stale: false }
  }
  harness.session.api.getProject = async () => { getProjects += 1; return { ok: true, project: projectWith(9, ['sheet_a']) } }
  harness.session.api.createFromJob = async (_projectId, payload) => {
    posts.push(payload)
    const id = payload.jobId === 'job_a' ? 'sheet_a' : 'sheet_b'
    if (id === 'sheet_b' && unknownB) { unknownB = false; throw Object.assign(new Error('disk'), { kind: 'unknown', code: 'storage_commit_failed' }) }
    // Each save's response is the project as of that save (the second one is newer than the reload shown since).
    return { project: id === 'sheet_a' ? projectWith(8, ['sheet_a']) : projectWith(10, ['sheet_a', 'sheet_b']), document: { document_id: `doc_${id}` }, receipt: { operation_id: payload.operationId, document_id: `doc_${id}` } }
  }
  const click = action => harness.host.dispatchEvent({ type: 'click', target: { dataset: { genAction: action }, closest(selector) { return selector.includes('gen-action') ? this : null } } })
  try {
    harness.gen.phase = 'ready'
    harness.gen.job = readyJob('job_a')
    await click('add-canvas')
    assert.equal(posts.length, 1)
    assert.match(cardText(harness.host), /Saved, canvas did not reload/)
    assert.equal(entries.length, 0, 'no Undo before the shown project holds the canvas')
    assert.equal(harness.host.querySelector('[data-gen-action="astra-flow:undo"]'), null)
    await click('reload-canvas')
    assert.equal(getProjects, 1, 'the reload reads the newest project state')
    assert.equal(posts.length, 1, 'reloading never adds again')
    assert.deepEqual(entries.map(entry => entry.canvasId), ['sheet_a'], 'exactly one entry, for the new canvas only')
    assert.match(cardText(harness.host), /Added as a new canvas\. Undo removes it\./)
    const undo = harness.host.querySelector('[data-gen-action="astra-flow:undo"]')
    assert.ok(undo && !undo.disabled)
    await undo.dispatchEvent({ type: 'click' })
    assert.deepEqual(undone, [entries[0]], 'Undo reverted exactly the placement entry')
    assert.match(cardText(harness.host), /Undo removed the new canvas/)
    assert.equal(harness.host.querySelector('[data-gen-action="astra-flow:undo"]'), null)

    // An unconfirmed save retried with the same operation records one entry for its canvas.
    harness.gen.job = readyJob('job_b')
    await click('add-canvas')
    assert.match(harness.gen.error, /not confirmed/)
    await click('add-canvas')
    assert.equal(posts.at(-1).operationId, posts.at(-2).operationId, 'the retry replays the same operation')
    assert.deepEqual(entries.map(entry => entry.canvasId), ['sheet_a', 'sheet_b'])
    assert.equal(harness.gen.placementUndo.entry, entries[1])
  } finally {
    harness.restore()
  }
})

function cardText(node) {
  return [node?.textContent || '', ...(node?.children || []).map(cardText)].join('\n')
}

// The Figma Current nodes a rendered turn maps to (data-figma on its message/card and actions).
function figmaIn(node) {
  return [...(node?.dataset?.figma ? [node.dataset.figma] : []), ...node.querySelectorAll('[data-figma]').map(item => item.dataset.figma)]
}

function genNode(tag = 'div') {
  const node = {
    tagName: tag.toUpperCase(),
    className: '',
    textContent: '',
    value: '',
    hidden: false,
    disabled: false,
    scrollHeight: 0,
    clientHeight: 0,
    dataset: {},
    classList: {
      contains(name) { return String(node.className).split(/\s+/).includes(name) },
      add(name) { this.toggle(name, true) },
      remove(name) { this.toggle(name, false) },
      toggle(name, force) {
        const parts = String(node.className).split(/\s+/).filter(Boolean).filter((item) => item !== name)
        const on = force == null ? !String(node.className).split(/\s+/).includes(name) : Boolean(force)
        if (on) parts.push(name)
        node.className = parts.join(' ')
      },
    },
    style: {},
    children: [],
    listeners: new Map(),
    attributes: {},
    focus() { globalThis.document.activeElement = node },
    setAttribute(name, value) {
      node.attributes[name] = String(value)
      if (name.startsWith('data-')) {
        const key = name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
        node.dataset[key] = String(value)
      }
    },
    getAttribute(name) {
      if (name === 'src') return node.src || null
      return node.attributes[name] ?? null
    },
    addEventListener(type, fn) {
      if (!node.listeners.has(type)) node.listeners.set(type, new Set())
      node.listeners.get(type).add(fn)
    },
    dispatchEvent(event) {
      if (node.id === 'vnext-prompt-input' && !(event instanceof Event)) {
        throw new TypeError("Failed to execute 'dispatchEvent' on 'EventTarget': parameter 1 is not of type 'Event'.")
      }
      const payload = {
        type: event?.type,
        target: event?.target?.closest ? event.target : node,
        bubbles: Boolean(event?.bubbles),
        key: event?.key,
        keyCode: event?.keyCode,
        isComposing: event?.isComposing,
        shiftKey: event?.shiftKey,
        preventDefault() { event?.preventDefault?.() },
        stopPropagation() { event?.stopPropagation?.() },
      }
      const pending = Promise.all([...(node.listeners.get(payload.type) || [])].map((fn) => fn(payload)))
      if (payload.bubbles && node.parentNode?.dispatchEvent) {
        return pending.then(() => node.parentNode.dispatchEvent(payload))
      }
      return pending
    },
    append(...kids) {
      for (const kid of kids) {
        if (!kid) continue
        kid.parentNode = node
        node.children.push(kid)
      }
    },
    replaceChildren(...kids) {
      node.children = []
      node.append(...kids)
    },
    remove() {
      const parent = node.parentNode
      if (!parent?.children) return
      parent.children = parent.children.filter((child) => child !== node)
      node.parentNode = null
    },
    closest(selector) {
      let cursor = node
      while (cursor) {
        if (selector.startsWith('[data-gen-action=')) {
          const expected = selector.slice('[data-gen-action="'.length, -2)
          if (cursor.dataset?.genAction === expected) return cursor
        }
        if (selector === '[data-gen-action]' && cursor.dataset?.genAction) return cursor
        if (selector.startsWith('.') && String(cursor.className || '').split(/\s+/).includes(selector.slice(1))) return cursor
        cursor = cursor.parentNode
      }
      return null
    },
    querySelector(selector) {
      if (selector === '.vnext-turn:last-child #vnext-job-id') {
        const turns = node.querySelectorAll('.vnext-turn')
        return turns[turns.length - 1]?.querySelector('#vnext-job-id') || null
      }
      return node.querySelectorAll(selector)[0] || null
    },
    querySelectorAll(selector) {
      if (selector.includes(',')) {
        const found = []
        for (const part of selector.split(',')) {
          for (const item of node.querySelectorAll(part.trim())) {
            if (!found.includes(item)) found.push(item)
          }
        }
        return found
      }
      const found = []
      const walk = (current) => {
        for (const child of current.children || []) {
          if (selector.startsWith('#') && child.id === selector.slice(1)) found.push(child)
          if (selector.toUpperCase() === child.tagName) found.push(child)
          if (selector.startsWith('.') && String(child.className).split(/\s+/).includes(selector.slice(1))) found.push(child)
          const action = selector.match(/^\[data-gen-action="([^"]+)"\]$/)
          if (action && child.dataset?.genAction === action[1]) found.push(child)
          const capability = selector.match(/^\[data-capability="([^"]+)"\]$/)
          if (capability && child.dataset?.capability === capability[1]) found.push(child)
          const presence = selector.match(/^\[data-([a-z-]+)\]$/)
          const dataKey = presence?.[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
          if (presence && Object.hasOwn(child.dataset || {}, dataKey)) found.push(child)
          walk(child)
        }
      }
      walk(node)
      return found
    },
  }
  return node
}

test('ordinary selected-image conversation never prepares editing tools or applies a legacy proposal', async () => {
  for (const scenario of ['copy', 'clarification', 'reopen', 'unsupported-chat']) {
    let finish, sent, copies = 0
    const assistant = { provider: 'grok', busy: false, blocked: false, bind() {}, stop() {},
      send(request) { sent = request; this.busy = true; return new Promise(resolve => { finish = result => { this.busy = false; resolve(result) } }) } }
    const h = generationHarness(async () => { throw new Error('generation must not run') }, assistant)
    try {
      h.state.draft.skillId = null; h.session.api.openEpoch = { current: 1 }
      h.session.conversationRef = { canvasId: 'old' }
      const source = { sourceRevision: 2, width: 2, height: 1, isCurrent: () => true }
      h.session.preparePixelEdit = async () => {
        if (scenario === 'unsupported-chat') throw Object.assign(new Error('locked'), { code: 'pixel_source_unsupported' })
        return source
      }
      // A legacy pixel_edit field in a reply must never reach the pixel writer.
      h.session.createPixelCopy = async () => { copies++; return 'Applied.' }
      h.session.savePixelStroke = async () => { copies++; return { saved: true } }
      h.prompt.value = 'erase pixel 0,0'; await h.prompt.dispatchEvent(new Event('input'))
      const pending = h.send.dispatchEvent({ type: 'click' })
      assert.equal(h.prompt.value, '')
      await new Promise(resolve => setImmediate(resolve))
      assert.equal(sent.workingRevision, undefined); assert.equal(sent.composerActions, true)
      assert.equal(sent.canvasId, 'old'); assert.equal(sent.width, undefined)
      if (scenario === 'reopen') h.session.api.openEpoch.current++
      finish({ reply: 'Which region?', pixel_edit: scenario === 'clarification' ? null : { type: 'erase' } })
      await pending
      assert.equal(copies, 0)
    } finally { h.restore() }
  }
})

test('pixel drawing runs on request without a dialog, sends the saved image only when asked, keeps a newer draft and rejects late context', async () => {
  for (const scenario of ['clarification', 'changed-draft', 'reopen', 'selection', 'grok']) {
    let finish, sent, placements = 0
    const assistant = { provider: scenario === 'grok' ? 'grok' : 'codex', busy: false, blocked: false, bind() {}, stop() {},
      send(request) { sent = request; this.busy = true; return new Promise(resolve => { finish = result => { this.busy = false; resolve(result) } }) } }
    mockComposer(assistant, { type: 'draw_pixels', size: 64, kind: 'edit', reference: true })
    const h = generationHarness(async () => { throw new Error('image generation must not run') }, assistant)
    try {
      h.state.draft.skillId = null; h.session.api.openEpoch = { current: 1 }
      h.session.conversationRef = { canvasId: 'old' }
      h.session.view.canvases = [{ id: 'old', width: 64, height: 64 }]
      h.session.preparePixelEdit = async () => ({ sourceRevision: 2, width: 64, height: 64,
        rgba: new Uint8Array(64 * 64 * 4), isSelected: () => h.session.conversationRef.canvasId === 'old' })
      h.session.placeStaticImage = async () => { placements++ }
      h.session.openConfirm = dialog => { h.dialog = dialog }; h.session.closeConfirm = () => {}
      h.prompt.value = '参考这张图画一个 64×64 像素守卫'
      await h.prompt.dispatchEvent(new Event('input'))
      const run = h.send.dispatchEvent({ type: 'click' })
      for (let i = 0; i < 20 && !sent && scenario !== 'grok'; i++) await new Promise(resolve => setImmediate(resolve))
      assert.equal(h.dialog, undefined, 'the request is the permission: no confirmation dialog')
      if (scenario === 'grok') { await run; assert.equal(sent, undefined); assert.match(cardText(h.host), /cannot run that here/); continue }
      assert.equal(h.prompt.value, '')
      assert.deepEqual(sent.pixelDrawing, { size: 64, kind: 'edit', reference: true })
      assert.equal(sent.workingRevision, 2)
      assert.match(cardText(h.host), /As a new canvas beside the selected image; the original stays unchanged/)
      h.prompt.value = scenario === 'changed-draft' ? '新的草稿' : '下一条草稿'; await h.prompt.dispatchEvent(new Event('input'))
      if (scenario === 'reopen') h.session.api.openEpoch.current++
      if (scenario === 'selection') h.session.conversationRef.canvasId = 'other'
      finish({ reply: 'Which region?', pixel_drawing: scenario === 'clarification' ? null : { invalid: true } })
      await run
      assert.equal(h.prompt.value, scenario === 'changed-draft' ? '新的草稿' : '下一条草稿'); assert.equal(placements, 0)
    } finally { h.restore() }
  }
})

test('valid pixel drawing survives its own saved revision and resolves one retained save without another model call', async () => {
  let sends = 0, saves = 0, pending = false
  const assistant = { provider: 'codex', busy: false, blocked: false, bind() {}, stop() {}, async send() {
    sends++; return { reply: 'Drawn', pixel_drawing: { size: 64, palette: ['#ff0000ff'], rects: [[0, 0, 1, 1, 0]] } }
  } }
  mockComposer(assistant, { type: 'draw_pixels', size: 64, kind: 'new' })
  const h = generationHarness(async () => { throw Error('no generation') }, assistant)
  try {
    h.state.draft.skillId = null; h.session.api.openEpoch = { current: 1 }
    const create = document.createElement
    document.createElement = tag => tag === 'canvas' ? { getContext: () => ({ createImageData: (w, h) => ({ data: new Uint8Array(64 * 64 * 4), width: w ?? 64, height: h ?? 64 }), putImageData() {} }), toBlob: cb => cb({ arrayBuffer: async () => new ArrayBuffer(4) }) } : create(tag)
    h.session.openConfirm = d => { h.dialog = d }; h.session.closeConfirm = () => {}
    h.session.hasPixelDrawingSave = () => pending
    h.session.placeStaticImage = async request => {
      assert.equal(request.pixelDrawing, true); saves++; h.session.project.revision++
      if (saves === 2) { pending = true; return { positionUnknown: true } }
      return { canvasId: 'new' }
    }
    h.session.resolvePixelDrawingSave = async () => { pending = false; h.session.project.revision++; return { canvasId: 'new', historyEntry: recoveredEntry } }
    const recoveredEntry = { kind: 'import', canvasId: 'new' }
    let latestEntry = null, undone = null
    h.session.latestUndoEntry = () => latestEntry
    h.session.undoIfLatest = async entry => { undone = entry; latestEntry = null; return true }
    for (let i = 0; i < 2; i++) {
      h.prompt.value = '画一个像素守卫'; await h.prompt.dispatchEvent(new Event('input'))
      await h.send.dispatchEvent({ type: 'click' })
      assert.equal(h.dialog, undefined, 'drawing runs without a confirmation dialog')
      if (i === 0) {
        assert.match(h.host.querySelectorAll('[data-turn-title]').at(-1).textContent, /Pixel drawing added/)
        assert.match(h.send.title, /Send to/)
      }
    }
    const drawingTurn = h.host.querySelectorAll('.is-run-turn').at(-1)
    assert.match(drawingTurn.querySelector('[data-turn-title]').textContent, /needs attention/)
    assert.equal(drawingTurn.querySelector('[data-gen-action="astra-flow:undo"]'), null, 'no Undo before the save is confirmed')
    assert.equal(h.send.title, 'Resolve pixel drawing save'); assert.equal(h.send.disabled, false)
    // The selected model changes before recovery: the result stays with the run that drew it.
    assistant.provider = 'grok'
    latestEntry = recoveredEntry
    const turnsBefore = h.host.querySelectorAll('.vnext-turn').length
    await h.send.dispatchEvent({ type: 'click' })
    assert.equal(sends, 2); assert.equal(saves, 2); assert.equal(pending, false)
    assert.equal(h.host.querySelectorAll('.vnext-turn').length, turnsBefore, 'recovery completes the original turn instead of adding a note')
    assert.match(drawingTurn.querySelector('[data-turn-title]').textContent, /Pixel drawing added \(64×64\)/)
    assert.match(cardText(drawingTurn), /No additional model request/)
    assert.equal(drawingTurn.dataset.author, 'GPT 6.1', 'attributed to its originating run')
    const undo = drawingTurn.querySelector('[data-gen-action="astra-flow:undo"]')
    assert.ok(undo && !undo.disabled, 'the recovered result offers its Undo')
    await undo.dispatchEvent({ type: 'click' })
    assert.equal(undone, recoveredEntry, 'Undo targets exactly the recovered placement')
    assert.match(drawingTurn.querySelector('[data-turn-title]').textContent, /Undone/)
    assert.match(h.send.title, /Send to/)
  } finally { h.restore() }
})

test('pixel drawing recovery takes priority over a selected skill without clearing its draft', async () => {
  for (const action of ['click', 'Enter']) {
    let pending = true, resolutions = 0
    const h = generationHarness(async () => { throw Error('skill review must not run') })
    try {
      h.session.api.openEpoch = { current: 1 }
      h.session.hasPixelDrawingSave = () => pending
      h.session.resolvePixelDrawingSave = async () => { resolutions++; pending = false; return { canvasId: 'saved' } }
      h.prompt.value = 'Keep this skill draft'
      await h.prompt.dispatchEvent(new Event('input'))
      assert.equal(h.send.title, 'Resolve pixel drawing save'); assert.equal(h.send.disabled, false)
      if (action === 'click') await h.send.dispatchEvent({ type: 'click' })
      else await h.prompt.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Enter' }))
      assert.equal(resolutions, 1); assert.equal(pending, false)
      assert.equal(h.prompt.value, 'Keep this skill draft')
      assert.equal(h.state.draft.skillId, 'fixed-region-motion')
      // No run turn is shown for this kept drawing, so its completion is credited to the drawing model.
      assert.match(h.host.querySelectorAll('[data-turn-title]').at(-1).textContent, /Pixel drawing added/)
      assert.match(cardText(h.host.querySelectorAll('.is-run-turn').at(-1)), /No additional model request/)
      assert.equal(h.host.querySelectorAll('.is-run-turn').at(-1).dataset.author, 'GPT 6.1')
    } finally { h.restore() }
  }
})

test('a completed pixel drawing is retained for its original project if the open epoch changes during PNG conversion', async () => {
  let finishPng, placements = 0, sends = 0
  const kept = []
  const assistant = { provider: 'codex', busy: false, blocked: false, bind() {}, stop() {}, async send() {
    sends++; return { reply: 'Drawn', pixel_drawing: { size: 64, palette: ['#ff0000ff'], rects: [[0, 0, 1, 1, 0]] } }
  } }
  mockComposer(assistant, { type: 'draw_pixels', size: 64, kind: 'new' })
  const h = generationHarness(async () => { throw Error('no generation') }, assistant)
  try {
    h.state.draft.skillId = null; h.session.api.openEpoch = { current: 1 }
    const create = document.createElement
    document.createElement = tag => tag === 'canvas' ? { getContext: () => ({ createImageData: (w, h) => ({ data: new Uint8Array(64 * 64 * 4), width: w ?? 64, height: h ?? 64 }), putImageData() {} }), toBlob: cb => { finishPng = () => cb({ arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer }) } } : create(tag)
    h.session.openConfirm = d => { h.dialog = d }; h.session.closeConfirm = () => {}
    h.session.retainPixelDrawing = candidate => { kept.push(candidate); return candidate }
    h.session.placeStaticImage = async () => { placements++ }
    h.prompt.value = '画一个像素守卫'; await h.prompt.dispatchEvent(new Event('input'))
    const drawing = h.send.dispatchEvent({ type: 'click' })
    for (let i = 0; !finishPng && i < 20; i++) await new Promise(r => setTimeout(r, 0))
    assert.equal(typeof finishPng, 'function')
    h.session.api.openEpoch.current++
    h.session.project = { id: 'destination', revision: 1 }
    finishPng(); await drawing
    assert.equal(sends, 1); assert.equal(placements, 0, 'no automatic placement into a changed context')
    assert.equal(kept.length, 1); assert.equal(kept[0].projectId, 'proj')
    assert.deepEqual([...kept[0].bytes], [1, 2, 3, 4])
  } finally { h.restore() }
})

// Builds a model reply with the capability's own parameter shape (see composerCapabilities.js).
function composerActionFor(action, message) {
  const base = { type: action.type, instruction: message }
  if (action.type === 'draw_pixels') return { ...base, size: 64, kind: 'new', reference: false, ...action }
  if (action.type === 'generate_image') return { ...base, reference: false, background: 'green', ...action }
  if (action.type === 'use_preset') return { ...base, preset_id: 'fixed-region-motion', reference: false, ...action }
  return { ...base, ...action }
}
function mockComposer(assistant, action) {
  const execute = assistant.send?.bind(assistant)
  assistant.send = request => request.composerActions
    ? Promise.resolve({ reply: action ? 'Making it now.' : 'Let us discuss it.', composer_action: action ? composerActionFor(action, request.message) : null })
    : execute(request)
  return assistant
}

function generationHarness(fetchImpl, assistantClient, options = {}) {
  assistantClient ||= { provider: 'grok', busy: false, blocked: false, bind() {}, stop() {}, async send(body) {
    return { reply: 'Making it now.', composer_action: body.composerPresetId
      ? { type: 'use_preset', instruction: body.message, preset_id: body.composerPresetId, reference: ['candidate', 'ready', 'process_failed'].includes(body.composerWorkflow) }
      : { type: 'generate_image', instruction: body.message, reference: false, background: 'green' } }
  } }
  const previousWindow = globalThis.window
  const previousDocument = globalThis.document
  const storage = options.storage || new Map()
  globalThis.window = {
    localStorage: {
      getItem: (k) => storage.get(String(k)) ?? null,
      setItem: (k, v) => { storage.set(String(k), String(v)) },
      removeItem: (k) => { storage.delete(String(k)) },
    },
    addEventListener() {},
  }
  globalThis.document = { createElement: (tag) => genNode(tag) }
  const host = genNode()
  host.id = 'vnext-workflow'
  const prompt = genNode('textarea')
  prompt.id = 'vnext-prompt-input'
  const send = genNode('button')
  send.className = 'vnext-send'
  const root = genNode()
  const selector = genNode('button')
  selector.id = 'vnext-assistant-model'
  const contentType = genNode('button')
  const newDiscussion = genNode('button')
  newDiscussion.className = 'is-chat-new'
  contentType.dataset.capability = 'GEN-03'
  contentType.disabled = true
  const modelWrap = genNode(); modelWrap.className = 'vnext-assistant-model-wrap'
  const modelLabel = genNode('span'); modelLabel.id = 'vnext-assistant-model-label'
  selector.append(modelLabel)
  const modelMenu = genNode(); modelMenu.id = 'vnext-assistant-model-menu'; modelMenu.hidden = true
  for (const provider of ['grok', 'codex', 'astra', 'antigravity']) {
    const item = genNode('button'); item.dataset.assistantModel = provider; modelMenu.append(item)
  }
  modelWrap.append(selector, modelMenu)
  const toast = genNode('div'); toast.id = 'vnext-project-toast'; toast.hidden = true
  const toastIcon = genNode('span'); toastIcon.id = 'vnext-project-toast-icon'
  const toastMessage = genNode('p'); toastMessage.id = 'vnext-project-toast-message'
  const toastClose = genNode('button'); toastClose.id = 'vnext-project-toast-close'; toastClose.dataset.toastAction = 'dismiss'
  toast.append(toastIcon, toastMessage, toastClose)
  const assistantStatus = genNode('p'); assistantStatus.id = 'vnext-assistant-status'; assistantStatus.hidden = true
  const runStatus = genNode('p'); runStatus.id = 'vnext-run-status'
  root.append(host, prompt, send, modelWrap, contentType, newDiscussion, toast, assistantStatus, runStatus)
  const transients = []
  const session = {
    project: Object.hasOwn(options, 'project') ? options.project : { id: 'proj', revision: 3, name: 'Hero' },
    view: {
      canvases: [],
      selectedId: null,
      setTransients(items) { transients.push(items); this.canvases = items.filter(Boolean) },
      select(id) { this.selectedId = id },
      fitAll() {},
    },
    api: {
      async createFromJob() { throw new Error('missing createFromJob') },
    },
    renderCanvas() {},
    renderObjectPreview() {},
    // The real session.reloadProject reports whether the read was committed to the shown canvas.
    async reloadProject() { return { committed: true, stale: false } },
  }
  const state = { draft: { skillId: 'fixed-region-motion', prompt: 'brighter', reference: null } }
  session.selectApplicationPreset = id => { if (id !== 'fixed-region-motion') return false; state.draft.skillId = id; return true }
  const api = createVnextGenerationClient({ fetchImpl })
  // These tests exercise individual composer actions with an already-bound
  // project. Recovery HTTP behavior has its own tests and browser coverage.
  api.listStaticImages = undefined
  if (assistantClient && !options.keepRestore) assistantClient.restore = undefined
  const gen = bindVnextGenerationSession(root, {
    session,
    generationClient: api,
    assistantClient,
    getDraft: () => ({
      prompt: prompt.value,
      skillId: state.draft.skillId,
      reference: state.draft.reference ?? null,
    }),
    initialJobId: options.initialJobId || '',
  })
  return {
    root, host, prompt, send, selector, contentType, newDiscussion, toast, toastClose, assistantStatus, runStatus, session, gen, transients, api, state, assistant: assistantClient,
    restore() {
      globalThis.window = previousWindow
      globalThis.document = previousDocument
    },
  }
}

const nativeImageState = { available: true, provider: 'antigravity', model: 'native-generate-image', extra_credits: false, reference_upload: false,
  providers: [
    { available: true, provider: 'antigravity', model: 'native-generate-image', extra_credits: false, reference_upload: false },
    { available: true, provider: 'codex', model: 'gpt-image-2', extra_credits: 'native_account_policy', reference_upload: true },
    { available: true, provider: 'grok', model: 'native-imagine', extra_credits: 'native_account_policy', reference_upload: false },
  ] }

function documentFlowHarness(options = {}) {
  const calls = [], candidate = { candidate_id: 'candidate-local', sha256: 'a'.repeat(64), canvas_id: 'canvas', document_id: 'doc', project_revision: 3, working_revision: 1, width: 32, height: 48, frames: 2, layers: 2 }
  const assistant = { provider: 'astra', busy: false, blocked: false, bind() {}, stop() { calls.push('stop') }, select(value) { this.provider = value; return true },
    prepareDocument: async () => ({ grant_id: 'docgrant-local', frames: 1, layers: 1 }),
    async send(body) { calls.push({ send: body }); if (options.send) return options.send(body); return { operation_id: 'save-operation', document_candidate: candidate, reply: 'Two aligned frames.' } },
    async documentCandidate(body) { calls.push(body); if (body.action === 'read' && options.read) return options.read(); if (body.action === 'accept' && options.accept) return options.accept(); return { ...candidate, saved: false } },
  }
  mockComposer(assistant, { type: 'edit_document', ...(options.instruction ? { instruction: options.instruction } : {}) })
  const h = generationHarness(async () => { throw Error('No network in this test') }, assistant)
  h.state.draft.skillId = null
  h.session.view.selectedId = 'canvas'
  h.session.conversationRef = { projectId: 'proj', canvasId: 'canvas', documentId: 'doc', workingRevision: 1 }
  h.session.consumeConversationRef = () => { calls.push('consume-reference'); return h.session.conversationRef }
  h.session.restoreConversationRef = ref => { assert.equal(ref, h.session.conversationRef); calls.push('restore-reference') }
  const source = { projectId: 'proj', projectRevision: 3, sourceCanvasId: 'canvas', sourceDocumentId: 'doc', sourceRevision: 1, width: 64, height: 64, isSelected: () => true }
  h.session.prepareDocumentEdit = async () => source
  h.session.canPlacePixelDrawing = () => true
  h.session.showDocumentCandidate = async (_source, _value, valid) => { if (valid()) { calls.push('show'); h.session.documentCandidate = {} } }
  h.session.clearDocumentCandidate = () => { calls.push('clear'); h.session.documentCandidate = null }
  h.session.saveDocumentCandidate = async (_source, save) => { const result = await save(); h.session.documentCandidate.result = result; return result }
  const start = async () => {
    await h.selector.dispatchEvent({ type: 'click' }); await h.root.querySelectorAll('[data-assistant-model]').find(item => item.dataset.assistantModel === 'astra').dispatchEvent({ type: 'click' })
    h.prompt.value = 'Split and align the two poses.'; await h.prompt.dispatchEvent(new Event('input'))
    // The request runs straight through, so a held step must not hold the test: wait for the run or a bounded settle.
    const sending = h.send.dispatchEvent({ type: 'click', preventDefault() {}, stopPropagation() {} })
    await Promise.race([sending, settleFlow(12)])
    return h.host.querySelectorAll('.is-astra-document').at(-1)
  }
  return { ...h, assistant, calls, candidate, start }
}

const settleFlow = async (rounds = 12) => { for (let i = 0; i < rounds; i++) await new Promise(resolve => setImmediate(resolve)) }

test('Canvas & timeline runs on request and applies the result as one undoable change, without authorization or Save cards', async () => {
  const h = documentFlowHarness()
  try {
    let undoEntry = null, undone = null
    h.session.latestUndoEntry = () => undoEntry
    h.session.undoIfLatest = async entry => { undone = entry; return true }
    const save = h.session.saveDocumentCandidate
    h.session.saveDocumentCandidate = async (...args) => { const result = await save(...args); undoEntry = { kind: 'pixels', documentId: 'doc' }; return result }
    const card = await h.start(); await settleFlow()
    assert.doesNotMatch(visibleText(card), /Authorize|Reject|Save drawing|Discard preview|Not saved yet/)
    assert.equal(h.calls.find(c => c.send).send.documentMode, true)
    assert.equal(h.calls.find(c => c.send).send.documentGrant, 'docgrant-local', 'the scoped grant still binds canvas and revision')
    assert.ok(h.calls.includes('consume-reference'), 'the sent attachment leaves the composer')
    assert.match(visibleText(card), /Canvas & timeline updated/)
    assert.doesNotMatch(visibleText(card), /Two aligned frames|32×48|2 frames|2 layers|Undo restores|View more/, 'only the host outcome and actual Undo are shown')
    assert.deepEqual(h.calls.filter(c => c.action).map(c => c.action), ['read', 'accept'])
    assert.equal(h.session.documentCandidate, null)
    await card.querySelector('[data-gen-action="astra-flow:undo"]').dispatchEvent({ type: 'click' }); await settleFlow(2)
    assert.equal(undone, undoEntry, 'the optional Undo follow-up reverts exactly this result')
    assert.match(visibleText(card), /Undone/)
  } finally { h.restore() }
})

test('Canvas & timeline send failure restores its attachment and draft', async () => {
  const h = documentFlowHarness({ instruction: 'Align the blue poses from our earlier discussion; keep their layers separate.', send: async () => { throw Object.assign(Error('offline'), { code: 'assistant_unavailable' }) } })
  try {
    await h.start(); await settleFlow()
    assert.equal(h.prompt.value, 'Split and align the two poses.')
    assert.deepEqual(h.calls.filter(c => typeof c === 'string'), ['consume-reference', 'restore-reference'])
    assert.equal(h.calls.filter(c => c.send).length, 1)
  } finally { h.restore() }
})

test('Canvas & timeline failure preserves a new reference chosen while the request was running', async () => {
  const h = documentFlowHarness({ send: async () => {
    h.state.draft.reference = { name: 'new-reference.png', objectUrl: 'blob:new-reference' }
    throw Object.assign(Error('offline'), { code: 'assistant_unavailable' })
  } })
  try {
    await h.start(); await settleFlow()
    assert.equal(h.prompt.value, '')
    assert.equal(h.state.draft.reference.name, 'new-reference.png')
    assert.deepEqual(h.calls.filter(c => typeof c === 'string'), ['consume-reference'])
    assert.equal(h.calls.filter(c => c.send).length, 1)
  } finally { h.restore() }
})

test('Canvas & timeline definite rejection releases the result; an unknown save resolves using the same operation', async () => {
  for (const code of ['candidate_expired', 'stale_revision', 'storage_commit_failed']) {
    let failures = 1
    const h = documentFlowHarness({ accept: async () => { if (failures--) throw Object.assign(Error(code), { code }); return { saved: true } } })
    try {
      const card = await h.start(); await settleFlow()
      if (code === 'storage_commit_failed') {
        assert.ok(h.session.documentCandidate); assert.match(visibleText(card), /Resolve same save/)
        await card.querySelector('[data-gen-action="astra-flow:recover"]').dispatchEvent({ type: 'click' }); await settleFlow(4)
        assert.deepEqual(h.calls.filter(c => c.action === 'accept').map(c => c.operation_id), ['save-operation', 'save-operation'])
        assert.match(visibleText(card), /Canvas & timeline updated/)
      } else {
        assert.match(visibleText(card), /Not applied/)
        assert.deepEqual(h.calls.filter(c => c.action === 'accept').length, 1, 'a definite rejection is never retried automatically')
      }
      assert.equal(h.session.documentCandidate, null)
    } finally { h.restore() }
  }
})

test('R3: scoped Canvas & timeline candidate preserves expected_editable_frame_ids across read, accept, and Resolve same save recovery', async () => {
  let failures = 1
  const h = documentFlowHarness({
    accept: async () => {
      if (failures--) throw Object.assign(Error('storage_commit_failed'), { code: 'storage_commit_failed' })
      return { saved: true }
    },
  })
  h.candidate.editable_frame_ids = ['f2']
  h.candidate.locked_frame_ids = ['f1']
  try {
    const card = await h.start(); await settleFlow()
    assert.ok(h.session.documentCandidate)
    assert.match(visibleText(card), /Resolve same save/)
    await card.querySelector('[data-gen-action="astra-flow:recover"]').dispatchEvent({ type: 'click' }); await settleFlow(4)
    const candidateCalls = h.calls.filter(c => c && c.action)
    assert.deepEqual(candidateCalls.map(c => c.action), ['read', 'accept', 'accept'])
    for (const call of candidateCalls) {
      assert.deepEqual(call.expected_editable_frame_ids, ['f2'])
    }
    assert.equal(candidateCalls[1].operation_id, candidateCalls[2].operation_id)
    assert.match(visibleText(card), /Canvas & timeline updated/)
  } finally {
    h.restore()
  }
})

test('Stop during delayed candidate read prevents late preview installation without another model request', async () => {
  let resolveRead
  const h = documentFlowHarness({ read: () => new Promise(resolve => { resolveRead = resolve }) })
  try {
    const card = await h.start(); await settleFlow(4)
    assert.ok(resolveRead); assert.equal(h.selector.disabled, true, 'selection is blocked while candidate pixels load')
    await card.querySelector('[data-gen-action="astra-flow:stop"]').dispatchEvent({ type: 'click' }); await settleFlow(2)
    resolveRead({ ...h.candidate }); await settleFlow(4)
    assert.equal(h.calls.includes('show'), false); assert.equal(h.session.documentCandidate, undefined)
    assert.equal(h.calls.filter(c => c.send).length, 1); assert.match(visibleText(card), /Stopped/)
  } finally { h.restore() }
})

test('recovered image actions remain visible and usable after asynchronous discussion restoration', async () => {
  let restoreHistory
  const assistant = { provider: 'grok', busy: false, blocked: false, bind() {}, stop() {} }
  const h = generationHarness(async () => { throw Error('no requests') }, assistant)
  try {
    assistant.restore = () => new Promise(resolve => { restoreHistory = resolve })
    h.api.listStaticImages = async () => ({ jobs: [{ id: 'saved-job', provider: 'antigravity', status: 'done', imported: false }] })
    h.state.draft.skillId = null
    h.session.project = { id: 'other', revision: 1 }
    h.session.onProjectBound()
    await new Promise(resolve => setImmediate(resolve))
    restoreHistory({ turns: [{ message: 'old question', reply: 'old answer', status: 'done' }] })
    await new Promise(resolve => setImmediate(resolve))
    const card = h.host.querySelector('[data-recovered-image]')
    const button = card.querySelector('button')
    assert.notEqual(card.hidden, true)
    assert.equal(button.disabled, false)
    assert.equal(button.textContent, 'Add saved image to canvas')
    assert.equal(h.host.children.length, 3)
  } finally { h.restore() }
})

test('a restored native candidate is not reviewed on the wrong canvas or after its save receipt exists', async () => {
  let restoreHistory
  const reviews = []
  const assistant = { provider: 'grok', busy: false, blocked: false, bind() {}, stop() {} }
  const h = generationHarness(async () => { throw Error('no requests') }, assistant)
  const context = { pixel_tools: true, project_id: 'proj-2', project_revision: 3, canvas_id: 'canvas-a', document_id: 'doc-a', working_revision: 1, width: 64, height: 64 }
  const turn = { operation_id: 'op-1', status: 'done', message: 'draw', reply: 'preview', pixel_candidate: { rgba_hex: '00'.repeat(16384), drawing_batches: 1 }, context }
  try {
    assistant.restore = () => new Promise(resolve => { restoreHistory = resolve })
    h.session.project = { id: 'proj-2', revision: 3, operation_receipts: {} }
    h.session.conversationRef = { canvasId: 'canvas-b' }
    h.session.selectCanvas = id => { h.session.conversationRef = { canvasId: id } }
    h.session.preparePixelEdit = async () => ({ projectId: 'proj-2', sourceCanvasId: 'canvas-b', sourceDocumentId: 'doc-b', projectRevision: 3, sourceRevision: 1, width: 64, height: 64 })
    h.session.reviewNativePixelCandidate = async () => { reviews.push('review') }
    h.session.onProjectBound()
    await new Promise(resolve => setImmediate(resolve))
    restoreHistory({ turns: [turn] })
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(reviews, [])
    h.host.replaceChildren()
    h.session.project.operation_receipts = { 'op-1': { document_id: 'copy' } }
    h.session.project = { id: 'proj-3', revision: 3, operation_receipts: { 'op-1': { document_id: 'copy' } } }
    h.session.preparePixelEdit = async () => ({ projectId: 'proj-3', sourceCanvasId: 'canvas-a', sourceDocumentId: 'doc-a', projectRevision: 3, sourceRevision: 1, width: 64, height: 64, multiCel: true })
    let second
    assistant.restore = () => new Promise(resolve => { second = resolve })
    h.session.onProjectBound()
    await new Promise(resolve => setImmediate(resolve))
    second({ turns: [turn] })
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(reviews, [])
  } finally { h.restore() }
})

test('new discussion stays disabled while an old selected-image message is preparing', async () => {
  let release, newDiscussions = 0
  const assistant = { provider: 'grok', busy: false, blocked: false, bind() {}, stop() {},
    send() { this.busy = true; return new Promise(resolve => { release = () => { this.busy = false; resolve({ reply: 'done' }) } }) } }
  const h = generationHarness(async () => { throw Error('no requests') }, assistant)
  try {
    assistant.restore = async () => { newDiscussions++; return { turns: [] } }
    h.state.draft.skillId = null
    h.session.conversationRef = { canvasId: 'canvas_a' }
    h.session.preparePixelEdit = () => { throw Error('ordinary chat must not prepare an edit') }
    h.prompt.value = 'fill rect (0, 0, 2, 2) with red'
    await h.prompt.dispatchEvent(new Event('input'))
    const sending = h.send.dispatchEvent({ type: 'click' })
    assert.equal(h.newDiscussion.disabled, true)
    await h.newDiscussion.dispatchEvent({ type: 'click' })
    assert.equal(newDiscussions, 0)
    release(null); await sending
    assert.equal(h.newDiscussion.disabled, false)
  } finally { h.restore() }
})

test('a selected-reference image request sends only that canvas, and nothing once the selection changes', async () => {
  for (const scenario of ['codex', 'codex-changed', 'grok']) {
    const posts = []
    const provider = scenario === 'grok' ? 'grok' : 'codex'
    const assistant = { provider, busy: false, blocked: false, bind() {}, stop() {} }
    mockComposer(assistant, { type: 'generate_image', reference: true })
    let h, progress = ''
    h = generationHarness(async (url, init = {}) => {
      if (init.method === 'POST') { posts.push(JSON.parse(init.body)); return { ok: true, status: 202, text: async () => JSON.stringify({ id: 'job_ref', status: 'queued' }) } }
      if (String(url).endsWith('/image-generation/job_ref')) {
        progress = cardText(h.host)
        return { ok: true, status: 200, text: async () => JSON.stringify({ id: 'job_ref', status: 'failed', reason: 'image_failed' }) }
      }
      if (scenario === 'codex-changed') h.session.conversationRef.canvasId = 'other'
      return { ok: true, status: 200, text: async () => JSON.stringify(nativeImageState) }
    }, assistant)
    try {
      h.session.project.sprite_documents = { doc: { working_revision: 1 } }
      h.session.conversationRef = { projectId: 'proj', canvasId: 'c', documentId: 'doc', workingRevision: 1, name: 'Forest guard' }
      h.session.view.canvases = [{ id: 'c', width: 64, height: 64 }]
      h.session.openConfirm = dialog => { h.dialog = dialog }; h.session.closeConfirm = () => {}
      h.state.draft.skillId = null; h.prompt.value = '参考这张图生成像素风新图，放在右边'
      await h.prompt.dispatchEvent(new Event('input')); await h.send.dispatchEvent({ type: 'click' })
      for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve))
      assert.equal(h.prompt.value, '')
      assert.equal(h.dialog, undefined, 'the request is the permission: no confirmation dialog')
      if (scenario === 'codex') {
        assert.equal(posts.length, 1)
        assert.deepEqual(posts[0].reference, { canvas_id: 'c', document_id: 'doc', expected_revision: 3, working_revision: 1 }, 'only the selected canvas is sent')
        assert.match(progress, /Using the selected canvas as the reference/, 'progress names what is sent while the request runs')
        assert.match(cardText(h.host), /Image not added/)
      } else assert.equal(posts.length, 0, scenario === 'grok' ? 'a provider without reference upload sends nothing' : 'a selection changed before submission sends nothing')
    } finally { h.restore() }
  }
})

test('image provider selection never falls back to another provider or model', () => {
  for (const provider of ['codex', 'grok', 'antigravity']) {
    const preset = selectStaticImagePreset(nativeImageState, provider)
    const request = staticImageRequest({ description: 'guard', preset })
    assert.equal(request.provider, provider)
    assert.match(request.description, /pure green #00ff00/)
  }
  assert.equal(selectStaticImagePreset({ ...nativeImageState, providers: [nativeImageState.providers[0]] }, 'codex'), null)
  assert.equal(selectStaticImagePreset(nativeImageState, 'unknown'), null)
})

test('switching the selected provider while an image request is prepared sends nothing', async () => {
  let posts = 0
  const assistant = { provider: 'codex', busy: false, blocked: false, bind() {}, stop() {} }
  mockComposer(assistant, { type: 'generate_image', reference: false })
  const h = generationHarness(async (_url, init = {}) => {
    if (init.method === 'POST') posts++
    assistant.provider = 'grok'
    return { ok: true, status: 200, text: async () => JSON.stringify(nativeImageState) }
  }, assistant)
  h.session.openConfirm = dialog => { h.dialog = dialog }; h.session.closeConfirm = () => {}
  try {
    h.state.draft.skillId = null; h.prompt.value = '生成一个守卫'
    await h.prompt.dispatchEvent(new Event('input')); await h.send.dispatchEvent({ type: 'click' })
    assert.equal(h.dialog, undefined)
    assert.equal(posts, 0)
    assert.equal(h.prompt.value, '')
  } finally { h.restore() }
})

test('a static image request starts the one Antigravity request immediately and shows its budget as progress', async () => {
  const posts = []
  let sent = 0
  const assistant = {
    provider: 'antigravity', busy: false, blocked: false, bind() {}, stop() {},
    send() { sent += 1; return Promise.resolve({ reply: 'no' }) },
  }
  mockComposer(assistant, { type: 'generate_image', reference: false })
  let progress = ''
  const harness = generationHarness(async (url, init = {}) => {
    const path = String(url)
    if (path === '/api/editor/projects/proj/image-generation' && init.method !== 'POST') {
      return { ok: true, status: 200, text: async () => JSON.stringify({ available: true, ...nativeImageState }) }
    }
    if (path === '/api/editor/projects/proj/image-generation') {
      posts.push(JSON.parse(init.body))
      return { ok: true, status: 202, text: async () => JSON.stringify({ id: 'job_static', status: 'queued' }) }
    }
    progress = cardText(harness.host)
    return { ok: true, status: 200, text: async () => JSON.stringify({ id: 'job_static', status: 'failed', reason: 'image_failed' }) }
  }, assistant)
  const opened = []
  harness.session.openConfirm = (dialog) => opened.push(dialog)
  harness.session.closeConfirm = () => {}
  try {
    harness.state.draft.skillId = null
    harness.prompt.value = 'Generate an image of a red door'
    await harness.prompt.dispatchEvent(new Event('input'))
    await harness.send.dispatchEvent({ type: 'click' })
    assert.equal(harness.prompt.value, '')
    assert.equal(sent, 0, 'the model is not asked twice')
    assert.equal(opened.length, 0, 'no confirmation dialog')
    assert.equal(posts.length, 1)
    assert.deepEqual(Object.keys(posts[0]).sort(), ['description', 'operation_id', 'provider'])
    assert.match(posts[0].operation_id, /^[a-f0-9-]{36}$/)
    assert.equal(posts[0].provider, 'antigravity')
    assert.match(progress, /Generating an image…/)
    assert.match(progress, /One request on your account, no automatic retry/)
    assert.doesNotMatch(progress, /gpt-image|Imagine|native-generate/, 'model identifiers stay out of the conversation')
    assert.match(cardText(harness.host), /Image not added/, 'a failed job reports in the same turn and is not retried')
    assert.match(cardText(harness.host), /The provider did not return a usable image/)
    assert.doesNotMatch(cardText(harness.host), /image_failed|job_static/, 'no raw error code or job ID in the conversation')
    assert.equal(posts.length, 1)
    const run = harness.host.querySelectorAll('.is-run-turn').at(-1)
    assert.equal(run.classList.contains('is-continued'), true, 'the run follows its own reply under the same author, shown once')
    assert.equal(harness.host.querySelectorAll('.is-text-reply').at(-1).classList.contains('is-continued'), false)
  } finally {
    harness.restore()
  }
})

for (const fitted of [false, true]) test(`Generate submits once and reports the ${fitted ? 'fitted' : 'unchanged'} provider PNG`, async () => {
  const posts = []
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
  const assistant = { provider: 'grok', busy: false, blocked: false, bind() {}, stop() {}, send() { throw new Error('chat') } }
  mockComposer(assistant, { type: 'generate_image' })
  const harness = generationHarness(async (url, init = {}) => {
    const path = String(url)
    if (path === '/api/editor/projects/proj/image-generation' && init.method !== 'POST') {
      return { ok: true, status: 200, text: async () => JSON.stringify({
        available: true,
        ...nativeImageState,
        presets: [{ id: 'gemini-default', provider: 'gemini', model: 'gemini-3.1-flash-image-preview', available: true, route_kind: 'google_native', image_config: { aspect_ratio: '1:1' } }],
      }) }
    }
    if (path === '/api/editor/projects/proj/image-generation' && init.method === 'POST') {
      posts.push(JSON.parse(init.body))
      return { ok: true, status: 202, text: async () => JSON.stringify({ id: 'job_static', status: 'queued' }) }
    }
    if (path === '/api/editor/projects/proj/image-generation/job_static') {
      return { ok: true, status: 200, text: async () => JSON.stringify({ id: 'job_static', status: 'done', fitted, source_url: '/api/editor/projects/proj/image-generation/job_static/source' }) }
    }
    if (path === '/api/editor/projects/proj/image-generation/job_static/source') {
      return { ok: true, status: 200, arrayBuffer: async () => png.buffer }
    }
    throw new Error(`unexpected ${path}`)
  }, assistant)
  const placed = []
  const undo = { id: 'undo-image' }
  harness.session.openConfirm = (dialog) => { harness.dialog = dialog }
  harness.session.closeConfirm = () => {}
  harness.session.latestUndoEntry = () => (placed.length ? undo : null)
  harness.session.undoIfLatest = async entry => entry === undo
  harness.session.importGeneratedAsset = async (input) => { placed.push(input); return { placed: true, canvasId: 'generated' } }
  harness.session.placeStaticImage = async () => { throw new Error('generated images import through the shared background removal') }
  try {
    harness.state.draft.skillId = null
    harness.prompt.value = '生成一个像素风守卫'
    await harness.prompt.dispatchEvent(new Event('input'))
    await harness.send.dispatchEvent({ type: 'click' })
    for (let i = 0; i < 20 && !placed.length; i++) await new Promise(resolve => setImmediate(resolve))
    await settleFlow()
    assert.equal(harness.dialog, undefined, 'no confirmation and no background review dialog')
    assert.equal(posts.length, 1)
    assert.deepEqual(Object.keys(posts[0]).sort(), ['description', 'operation_id', 'provider'])
    assert.equal(posts[0].provider, 'grok')
    assert.equal(placed[0].sourceJobId, 'job_static')
    assert.match(posts[0].description, /pure green #00ff00/)
    assert.equal(posts[0].generationProfileId, undefined)
    assert.equal(placed.length, 1)
    assert.equal(placed[0].bytes[0], 137)
    assert.equal(placed[0].background, 'green')
    assert.equal(harness.prompt.value, '')
    const text = cardText(harness.host)
    assert.match(text, /Image added to the canvas/)
    assert.equal(/Scaled to fit 1024/.test(text), fitted)
    const undoButton = harness.host.querySelector('[data-gen-action="astra-flow:undo"]')
    assert.ok(undoButton, 'the result offers Undo instead of a prior approval')
  } finally {
    harness.restore()
  }
})

test('a model paused by a stopped reply offers one Continue here that keeps the draft and sends nothing until the next message', async () => {
  let paused = false, resumes = 0, failResume = 'assistant_busy'
  const sent = []
  const assistant = { provider: 'astra', busy: false, errorCode: null, connection: 'interrupted', bind() {}, select(value) { this.provider = value; return true },
    get blocked() { return paused }, get interrupted() { return paused }, stop() { paused = true },
    async send(body) { sent.push(body.message); return { reply: 'Noted.', composer_action: null } },
    async resume() { resumes += 1; if (failResume) { const code = failResume; failResume = null; throw Object.assign(new Error(), { code }) } paused = false; return { turns: [] } } }
  const h = generationHarness(async () => { throw new Error('no generation') }, assistant)
  try {
    h.state.draft.skillId = null
    paused = true // as after Stop: the reply result is unknown
    h.prompt.value = 'My unsent draft'
    await h.prompt.dispatchEvent(new Event('input'))
    await h.prompt.dispatchEvent(new Event('input'))
    const notes = h.host.querySelectorAll('[data-resume-channel]')
    assert.equal(notes.length, 1, 'one Continue here, not one per update')
    assert.equal(notes[0].dataset.figma, '2864:249', 'Continue here maps to its Figma Current button')
    assert.ok(h.host.querySelectorAll('.vnext-turn').some(turn => figmaIn(turn).includes('2864:241')), 'the paused note maps to its Figma Current note')
    assert.equal(h.send.disabled, true)
    assert.match(h.send.title, /paused/)
    const button = notes[0]
    await button.dispatchEvent({ type: 'click' })
    assert.match(cardText(h.host), /still ending/, 'a stopped request still ending is reported, nothing sent')
    assert.equal(paused, true)
    await button.dispatchEvent({ type: 'click' })
    assert.equal(resumes, 2)
    assert.equal(paused, false)
    assert.match(cardText(h.host), /Ready to continue in this discussion\. The stopped reply was not sent again\./)
    assert.equal(h.host.querySelectorAll('[data-resume-channel]').length, 0)
    assert.equal(h.prompt.value, 'My unsent draft', 'the draft is untouched')
    assert.equal(sent.length, 0, 'recovery sends no model request')
    assert.equal(h.send.disabled, false)
    await h.send.dispatchEvent({ type: 'click' })
    assert.deepEqual(sent, ['My unsent draft'], 'only the next explicit message is sent')
  } finally { h.restore() }
})

test('a generated image saved before its canvas refreshed reports that truthfully, recovers in its own turn and binds one Undo without importing or generating again', async () => {
  const posts = [], imports = []
  let downloads = 0
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
  const assistant = { provider: 'grok', busy: false, blocked: false, bind() {}, stop() {}, send() { throw new Error('chat') } }
  mockComposer(assistant, { type: 'generate_image' })
  const harness = generationHarness(async (url, init = {}) => {
    const path = String(url)
    if (path === '/api/editor/projects/proj/image-generation' && init.method !== 'POST') return { ok: true, status: 200, text: async () => JSON.stringify({ available: true, ...nativeImageState }) }
    if (path === '/api/editor/projects/proj/image-generation' && init.method === 'POST') { posts.push(JSON.parse(init.body)); return { ok: true, status: 202, text: async () => JSON.stringify({ id: 'job_static', status: 'queued' }) } }
    if (path === '/api/editor/projects/proj/image-generation/job_static') return { ok: true, status: 200, text: async () => JSON.stringify({ id: 'job_static', status: 'done', source_url: '/api/editor/projects/proj/image-generation/job_static/source' }) }
    if (path === '/api/editor/projects/proj/image-generation/job_static/source') { downloads += 1; return { ok: true, status: 200, arrayBuffer: async () => png.buffer } }
    throw new Error(`unexpected ${path}`)
  }, assistant)
  const entry = { kind: 'import', canvasId: 'generated' }
  let latest = null, undone = null, refreshFails = true
  harness.session.latestUndoEntry = () => latest
  harness.session.undoIfLatest = async value => { undone = value; latest = null; return value === entry }
  harness.session.importGeneratedAsset = async input => {
    imports.push(input)
    if (refreshFails) { refreshFails = false; return { saved: true, refreshPending: true, operationId: 'op-import' } }
    latest = entry
    return { placed: true, canvasId: 'generated', historyEntry: entry }
  }
  try {
    harness.state.draft.skillId = null
    harness.prompt.value = 'A pixel guard'
    await harness.prompt.dispatchEvent(new Event('input'))
    await harness.send.dispatchEvent({ type: 'click' })
    for (let i = 0; i < 20 && !imports.length; i++) await new Promise(resolve => setImmediate(resolve))
    await settleFlow()
    const turn = harness.host.querySelectorAll('.is-run-turn').at(-1)
    assert.match(turn.querySelector('[data-turn-title]').textContent, /Image saved, canvas not refreshed yet/, 'saved but not complete')
    assert.doesNotMatch(cardText(turn), /Image added to the canvas/)
    assert.equal(turn.querySelector('[data-gen-action="astra-flow:undo"]'), null, 'no Undo before the canvas shows the image')
    assert.ok(figmaIn(turn).includes('2864:137') && turn.querySelector('[data-gen-action="astra-flow:recover"]').dataset.figma === '2864:145', 'refresh pending maps to its Figma Current state')
    assert.equal(harness.runStatus.textContent, 'Image saved, canvas not refreshed yet')
    assert.equal(harness.send.title, 'Resolve the same image save')
    const turnsBefore = harness.host.querySelectorAll('.vnext-turn').length
    await turn.querySelector('[data-gen-action="astra-flow:recover"]').dispatchEvent({ type: 'click' })
    for (let i = 0; i < 20 && imports.length < 2; i++) await new Promise(resolve => setImmediate(resolve))
    await settleFlow()
    assert.equal(posts.length, 1, 'one generation request in total')
    assert.equal(downloads, 1, 'the image is not downloaded again')
    assert.equal(imports.length, 2)
    assert.equal(imports[1].sourceJobId, 'job_static')
    assert.equal(imports[1].bytes, undefined, 'recovery reuses the saved import instead of sending the image again')
    assert.equal(harness.host.querySelectorAll('.vnext-turn').length, turnsBefore, 'the original turn completes; no second result turn')
    assert.match(turn.querySelector('[data-turn-title]').textContent, /Image added to the canvas/)
    assert.ok(figmaIn(turn).includes('2864:150') && !figmaIn(turn).includes('2864:137'), 'the recovered result maps to its Figma Current state')
    assert.equal(turn.dataset.author, 'Grok 4.7')
    const undo = turn.querySelector('[data-gen-action="astra-flow:undo"]')
    assert.ok(undo && !undo.disabled)
    await undo.dispatchEvent({ type: 'click' })
    assert.equal(undone, entry, 'Undo targets exactly the recovered import')
    assert.match(harness.send.title, /Send to/)
  } finally {
    harness.restore()
  }
})

test('the requested background stays frozen when the panel control changes while the image downloads', async () => {
  let releaseDownload
  const downloadGate = new Promise((resolve) => { releaseDownload = resolve })
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
  const posts = []
  const placed = []
  const assistant = { provider: 'grok', busy: false, blocked: false, bind() {}, stop() {}, send() { throw new Error('chat') } }
  mockComposer(assistant, { type: 'generate_image', reference: false, background: 'purple' })
  const select = genNode('select')
  let downloading = false
  const harness = generationHarness(async (url, init = {}) => {
    const path = String(url)
    if (path === '/api/editor/projects/proj/image-generation' && init.method !== 'POST') {
      return { ok: true, status: 200, text: async () => JSON.stringify({ available: true, ...nativeImageState }) }
    }
    if (path === '/api/editor/projects/proj/image-generation' && init.method === 'POST') {
      posts.push(JSON.parse(init.body))
      return { ok: true, status: 202, text: async () => JSON.stringify({ id: 'job_static', status: 'queued' }) }
    }
    if (path === '/api/editor/projects/proj/image-generation/job_static') {
      return { ok: true, status: 200, text: async () => JSON.stringify({ id: 'job_static', status: 'done', source_url: `${path}/source` }) }
    }
    if (path.endsWith('/source')) {
      downloading = true
      await downloadGate
      return { ok: true, status: 200, arrayBuffer: async () => png.buffer }
    }
    throw new Error(`unexpected ${path}`)
  }, assistant)
  select.id = 'vnext-general-background'
  select.value = 'white'
  harness.root.append(select)
  harness.session.openConfirm = (dialog) => { harness.dialog = dialog }
  harness.session.closeConfirm = () => {}
  harness.session.importGeneratedAsset = async (input) => { placed.push(input); return { placed: true, canvasId: 'generated' } }
  try {
    harness.state.draft.skillId = null
    harness.prompt.value = '生成一个像素风守卫'
    await harness.prompt.dispatchEvent(new Event('input'))
    const pending = harness.send.dispatchEvent({ type: 'click' })
    for (let i = 0; i < 50 && !downloading; i++) await new Promise(resolve => setImmediate(resolve))
    assert.ok(downloading, 'the request started without a dialog')
    select.value = 'green'
    releaseDownload()
    await pending
    assert.equal(harness.dialog, undefined)
    assert.equal(posts.length, 1)
    assert.match(posts[0].description, /#8000ff/)
    assert.equal(placed[0].background, 'purple')
  } finally {
    releaseDownload()
    harness.restore()
  }
})

test('restored image without a saved background is placed directly with automatic background removal and is not generated again', async () => {
  const posts = []
  const reviews = []
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
  const assistant = { provider: 'grok', busy: false, blocked: false, bind() {}, stop() {} }
  const harness = generationHarness(async (url, init = {}) => {
    const path = String(url)
    if (init.method === 'POST') posts.push(path)
    if (path.endsWith('/image-generation/saved-job')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ id: 'saved-job', status: 'done', source_url: `${path}/source` }) }
    }
    if (path.endsWith('/source')) return { ok: true, status: 200, arrayBuffer: async () => png.buffer }
    throw new Error(`unexpected ${path} ${init.method || 'GET'}`)
  }, assistant)
  harness.api.listStaticImages = async () => ({ jobs: [{ id: 'saved-job', provider: 'codex', status: 'done', imported: false }] })
  harness.session.openConfirm = (dialog) => { harness.dialog = dialog }
  let undoEntry = null
  harness.session.latestUndoEntry = () => undoEntry
  harness.session.undoIfLatest = async entry => entry === undoEntry
  harness.session.importGeneratedAsset = async (input) => { reviews.push(input.background); undoEntry = { kind: 'import' }; return { placed: true, canvasId: 'restored' } }
  try {
    harness.session.project = { id: 'proj-restored', revision: 1 }
    harness.session.onProjectBound()
    let button = null
    for (let i = 0; i < 20 && !button; i += 1) {
      await new Promise((resolve) => setImmediate(resolve))
      button = harness.host.querySelector('[data-recover-job]')
    }
    assert.equal(button.textContent, 'Add saved image to canvas')
    await button.dispatchEvent({ type: 'click' })
    for (let i = 0; i < 20 && reviews.length === 0; i += 1) await new Promise((resolve) => setImmediate(resolve))
    assert.equal(harness.dialog, undefined)
    assert.equal(posts.length, 0)
    assert.deepEqual(reviews, ['auto'])
    await settleFlow()
    assert.equal(button.textContent, 'Saved in this project')
    assert.match(cardText(harness.host), /Image added to the canvas/)
    // The resumed job reports in its own turn, credited to the model that made the image, with Undo.
    const result = harness.host.children.filter(node => node.className.includes('is-run-turn')).at(-1)
    assert.equal(result.dataset.author, 'GPT 6.1')
    assert.ok(result.querySelector('[data-gen-action="astra-flow:undo"]'), 'the placed image offers Undo')
    assert.equal(harness.runStatus.textContent, 'Image added to the canvas', 'the outcome is announced politely')
  } finally {
    harness.restore()
  }
})

test('a static image job can finish after more than eight reads without another submission', async () => {
  let starts = 0
  let reads = 0
  const done = await pollStaticImageJob({
    request: { description: 'guard' },
    sleep: async () => {},
    isCurrent: () => true,
    start: async () => {
      starts += 1
      return { id: 'job_slow' }
    },
    getJob: async (id) => {
      reads += 1
      return reads < 10
        ? { id, status: 'queued' }
        : { id, status: 'done', source_url: '/api/editor/projects/proj/image-generation/job_slow/source' }
    },
  })
  assert.equal(starts, 1)
  assert.equal(reads, 10)
  assert.equal(done.jobId, 'job_slow')
  await assert.rejects(pollStaticImageJob({
    jobId: 'job_slow',
    sleep: async () => {},
    isCurrent: () => true,
    start: async () => { starts += 1; return { id: 'job_other' } },
    getJob: async () => { throw new Error('offline') },
  }), (error) => error.code === 'static_image_query' && error.jobId === 'job_slow')
  assert.equal(starts, 1)
})

test('an interrupted static image query resumes the same job and keeps a newer draft', async () => {
  const posts = []
  let queries = 0
  let release
  const png = new Uint8Array([137, 80, 78, 71])
  const assistant = { provider: 'grok', busy: false, blocked: false, bind() {}, stop() {}, send() { throw new Error('chat') } }
  mockComposer(assistant, { type: 'generate_image', reference: false })
  const harness = generationHarness(async (url, init = {}) => {
    const path = String(url)
    if (path === '/api/editor/projects/proj/image-generation' && init.method !== 'POST') {
      return { ok: true, status: 200, text: async () => JSON.stringify({
        available: true,
        ...nativeImageState,
        presets: [{ id: 'gemini-default', provider: 'gemini', model: 'gemini-3.1-flash-image-preview', available: true, route_kind: 'google_native' }],
      }) }
    }
    if (path === '/api/editor/projects/proj/image-generation' && init.method === 'POST') {
      posts.push(JSON.parse(init.body))
      return { ok: true, status: 202, text: async () => JSON.stringify({ id: 'job_static', status: 'queued' }) }
    }
    if (path === '/api/editor/projects/proj/image-generation/job_static') {
      queries += 1
      if (queries === 1) {
        await new Promise((resolve) => { release = resolve })
        throw new Error('query interrupted')
      }
      return { ok: true, status: 200, text: async () => JSON.stringify({ id: 'job_static', status: 'done', source_url: '/api/editor/projects/proj/image-generation/job_static/source' }) }
    }
    if (path === '/api/editor/projects/proj/image-generation/job_static/source') {
      return { ok: true, status: 200, arrayBuffer: async () => png.buffer }
    }
    throw new Error(`unexpected ${path}`)
  }, assistant)
  const placed = []
  harness.session.openConfirm = (dialog) => { harness.dialog = dialog }
  harness.session.closeConfirm = () => {}
  harness.session.importGeneratedAsset = async (input) => { placed.push(input); return { placed: true, canvasId: 'generated' } }
  harness.session.placeStaticImage = async () => { throw new Error('generated images import through the shared background removal') }
  try {
    harness.state.draft.skillId = null
    harness.session.conversationRef = { canvasId: 'original' }
    harness.session.view.canvases = [{ id: 'original', width: 64, height: 64 }]
    harness.prompt.value = '生成一个像素风守卫'
    await harness.prompt.dispatchEvent(new Event('input'))
    const pending = harness.send.dispatchEvent({ type: 'click' })
    while (!release) await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(harness.dialog, undefined)
    assert.equal(harness.prompt.value, '')
    assert.match(harness.send.title, /Waiting for the same image/)
    harness.prompt.value = 'later draft'
    await harness.prompt.dispatchEvent(new Event('input'))
    release()
    await pending
    assert.equal(posts.length, 1)
    assert.equal(harness.prompt.value, 'later draft')
    assert.match(harness.send.title, /Check the same image job/)
    harness.session.conversationRef = { canvasId: 'other' }
    harness.session.view.canvases.push({ id: 'other', width: 128, height: 128 })
    await harness.prompt.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Enter' }))
    for (let i = 0; i < 20 && !placed.length; i++) await new Promise(resolve => setImmediate(resolve))
    assert.equal(posts.length, 1)
    assert.equal(queries, 2)
    assert.equal(placed.length, 1)
    assert.equal(placed[0].sourceJobId, 'job_static')
    assert.deepEqual(placed[0].anchor, { id: 'original', width: 64, height: 64 }, 'the resumed job keeps its original placement anchor')
    assert.equal(harness.prompt.value, 'later draft')
  } finally {
    harness.restore()
  }
})

test('a project change while an image request is prepared sends nothing and keeps the new project draft', async () => {
  let posts = 0
  let harness
  harness = generationHarness(async (url, init = {}) => {
    if (String(url) === '/api/editor/projects/proj/image-generation' && init.method !== 'POST') {
      harness.session.api.openEpoch.current = 2
      harness.prompt.value = 'new project draft'
      return { ok: true, status: 200, text: async () => JSON.stringify(nativeImageState) }
    }
    posts += 1
    throw new Error('must not send')
  })
  harness.session.api.openEpoch = { current: 1 }
  harness.session.openConfirm = (dialog) => { harness.dialog = dialog }
  harness.session.closeConfirm = () => {}
  try {
    harness.state.draft.skillId = null
    harness.prompt.value = '生成一个守卫'
    await harness.prompt.dispatchEvent(new Event('input'))
    await harness.send.dispatchEvent({ type: 'click' })
    await settleFlow()
    assert.equal(harness.dialog, undefined)
    assert.equal(posts, 0)
    assert.equal(harness.prompt.value, 'new project draft')
    await assert.rejects(pollStaticImageJob({ isCurrent: () => false,
      start: async () => { posts += 1 }, getJob: async () => {} }), { code: 'static_image_stale' })
    assert.equal(posts, 0)
  } finally { harness.restore() }
})

for (const lateResult of ['preset', 'preset-error', 'job-error']) {
  test(`same-project reopen ignores an old ${lateResult} result`, async () => {
    let finish, entered
    const blocked = new Promise(resolve => { entered = resolve })
    const preset = nativeImageState
    const harness = generationHarness(async (url, init = {}) => {
      const path = String(url)
      if ((lateResult !== 'job-error' && path === '/api/editor/projects/proj/image-generation') || path.includes('/api/editor/projects/proj/image-generation/')) {
        entered()
        await new Promise(resolve => { finish = resolve })
        if (lateResult !== 'preset') throw new Error('late failure')
      }
      const payload = path === '/api/editor/projects/proj/image-generation' && init.method !== 'POST' ? preset : { id: 'job_old', status: 'queued' }
      return { ok: true, status: 200, text: async () => JSON.stringify(payload) }
    })
    harness.session.api.openEpoch = { current: 1 }
    harness.session.openConfirm = dialog => { harness.dialog = dialog }
    harness.session.closeConfirm = () => {}
    try {
      harness.state.draft.skillId = null
      harness.prompt.value = '生成一个守卫'
      await harness.prompt.dispatchEvent(new Event('input'))
      const pending = harness.send.dispatchEvent({ type: 'click' })
      await blocked
      harness.session.api.openEpoch.current = 2
      harness.session.onProjectBound()
      const before = harness.gen.thread.length
      finish()
      await pending
      assert.equal(harness.gen.thread.length, before)
      assert.equal(harness.dialog, undefined)
    } finally { harness.restore() }
  })
}

test('image save recovery does not poll, download or generate again and Enter cannot send chat', async () => {
  const calls = []
  let release
  const harness = generationHarness(async (url, init = {}) => {
    const path = String(url)
    calls.push(path)
    const payload = path === '/api/editor/projects/proj/image-generation' && init.method !== 'POST'
      ? nativeImageState
      : path === '/api/editor/projects/proj/image-generation' ? { id: 'job_save', status: 'queued' }
        : { id: 'job_save', status: 'done', source_url: '/api/editor/projects/proj/image-generation/job_save/source' }
    return { ok: true, status: 200, text: async () => JSON.stringify(payload), arrayBuffer: async () => new Uint8Array([137, 80]).buffer }
  }, mockComposer({ provider: 'grok', busy: false, blocked: false, bind() {}, stop() {}, send() { throw new Error('unexpected tool call') } }, { type: 'generate_image' }))
  const placements = []
  harness.session.openConfirm = (dialog) => { harness.dialog = dialog }
  harness.session.closeConfirm = () => {}
  harness.session.importGeneratedAsset = async (input) => {
    placements.push(input)
    if (placements.length === 1) {
      await new Promise(resolve => { release = resolve })
      return { unknown: true }
    }
    return { placed: true, canvasId: 'generated' }
  }
  // As the real session reports it: the unknown import of this job is still pending and current.
  harness.session.imageSaveFor = jobId => jobId === 'job_save' && placements.length === 1
  harness.session.imageSaveCurrentFor = jobId => jobId === 'job_save' && placements.length === 1
  try {
    harness.state.draft.skillId = null
    harness.prompt.value = '生成一个守卫'
    await harness.prompt.dispatchEvent(new Event('input'))
    const pending = harness.send.dispatchEvent({ type: 'click' })
    while (!release) await new Promise(resolve => setTimeout(resolve, 0))
    assert.equal(harness.dialog, undefined)
    harness.prompt.value = 'new draft'
    await harness.prompt.dispatchEvent(new Event('input'))
    await harness.prompt.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Enter' }))
    assert.equal(harness.send.disabled, true)
    release()
    await pending
    assert.match(harness.send.title, /Resolve the same/)
    assert.match(cardText(harness.host), /Placing the image needs attention/)
    const before = [...calls]
    await harness.prompt.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Enter' }))
    for (let i = 0; i < 20 && placements.length < 2; i++) await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(calls, before)
    assert.equal(placements[1].sourceJobId, 'job_save')
    assert.equal(placements[1].bytes, undefined)
    assert.equal(harness.prompt.value, 'new draft')
    assert.equal(harness.gen.staticImageJobId, null)
  } finally { harness.restore() }
})

test('an unknown native submission recovers by frozen operation id without a second POST', async () => {
  let posts = 0
  let operationId, queries = 0
  const assistant = { provider: 'grok', busy: false, blocked: false, bind() {}, stop() {}, send() { throw new Error('chat') } }
  mockComposer(assistant, { type: 'generate_image', reference: false })
  const harness = generationHarness(async (url, init = {}) => {
    const path = String(url)
    if (path === '/api/editor/projects/proj/image-generation' && init.method !== 'POST') {
      return { ok: true, status: 200, text: async () => JSON.stringify({
        available: true,
        ...nativeImageState,
        presets: [{ id: 'gemini-default', provider: 'gemini', model: 'gemini-3.1-flash-image-preview', available: true }],
      }) }
    }
    if (path === '/api/editor/projects/proj/image-generation' && init.method === 'POST') {
      posts += 1
      operationId = JSON.parse(init.body).operation_id
      throw new Error('lost reply')
    }
    if (path === `/api/editor/projects/proj/image-generation/${operationId}`) { queries++; throw new Error('offline') }
    throw new Error(`unexpected ${path}`)
  }, assistant)
  harness.session.openConfirm = (dialog) => { harness.dialog = dialog }
  harness.session.closeConfirm = () => {}
  try {
    harness.state.draft.skillId = null
    harness.prompt.value = '生成一个像素风守卫'
    await harness.prompt.dispatchEvent(new Event('input'))
    await harness.send.dispatchEvent({ type: 'click' })
    await settleFlow()
    assert.equal(harness.dialog, undefined)
    assert.equal(posts, 1)
    assert.match(harness.send.title, /Check the same image job/)
    await harness.send.dispatchEvent({ type: 'click' })
    assert.equal(posts, 1)
    assert.equal(queries, 1)
  } finally {
    harness.restore()
  }
})

test('a definite native busy rejection is not treated as an unknown submission', async () => {
  await assert.rejects(pollStaticImageJob({ request: { operation_id: 'frozen' }, isCurrent: () => true,
    start: async () => { throw Object.assign(new Error('image_busy'), { status: 409 }) },
    getJob: async () => { throw new Error('must not query') } }), { code: 'static_image_failed' })
})

test('selection edit wording remains chat when the selected model requests clarification', async () => {
  let calls = 0, chats = 0
  const harness = generationHarness(async () => {
    calls += 1
    throw new Error('generation')
  }, { provider: 'grok', busy: false, blocked: false, bind() {}, stop() {}, async send() {
    chats++; return { reply: 'What should change on the cape?', composer_action: null }
  } })
  try {
    harness.session.conversationRef = {
      projectId: 'proj',
      canvasId: 'c',
      documentId: 'd',
      projectRevision: 3,
      workingRevision: 1,
    }
    harness.prompt.value = 'edit the cape'
    harness.send.disabled = false
    await harness.send.dispatchEvent({ type: 'click' })
    assert.equal(chats, 1)
    assert.equal(calls, 0)
    assert.equal(harness.gen.phase, 'idle')
  } finally {
    harness.restore()
  }
})

test('plain composer sends selected metadata to Grok and renders role labels outside text bubbles', async () => {
  const sent = []
  const assistant = createVnextAssistantClient({ fetchImpl: async (url, init) => {
    const body = JSON.parse(init.body)
    if (url.endsWith('/session')) return { ok: true, json: async () => ({ conversation: 'local', provider: body.provider, model: body.model }) }
    sent.push(body)
    return { ok: true, json: async () => ({ reply: 'Text discussion only.', provider: 'grok', completed: true, requestedModel: 'grok-4.7', termination: 'natural',
      context: { project_id: 'proj', project_revision: 3, canvas_id: 'c' } }) }
  } })
  const h = generationHarness(async () => { throw new Error('generation must not run') }, assistant)
  try {
    h.state.draft.skillId = null
    h.session.conversationRef = { canvasId: 'c' }
    h.prompt.value = 'fill rect (0, 0, 2, 2) with red'
    await h.root.dispatchEvent({ type: 'vnext-draft-change' })
    assert.equal(h.send.disabled, false)
    assert.notEqual(h.contentType.hidden, true)
    assert.equal(h.contentType.disabled, true)
    assert.equal(h.selector.title, 'Grok 4.7')
    await h.send.dispatchEvent({ type: 'click' })
    assert.equal(sent.length, 1); assert.equal(sent[0].canvas_id, 'c')
    assert.equal(h.prompt.value, '')
    assert.equal(h.gen.phase, 'idle')
    const [user, reply] = h.host.children
    assert.equal(user.children[0].textContent, 'You')
    assert.equal(user.querySelector('.vnext-msg').querySelector('.vnext-msg-role'), null)
    assert.equal(reply.children[0].querySelector('.vnext-msg-role').textContent, 'Grok 4.7')
    assert.equal(reply.querySelector('.vnext-msg').querySelector('.vnext-msg-role'), null)
    assert.equal(reply.querySelector('.vnext-workflow-card'), null, 'a plain reply is text, not a card')
  } finally { h.restore() }
})

test('model selector keeps drafts and all provider messages visible and is locked while replying', async () => {
  let finish
  const assistant = createVnextAssistantClient({ fetchImpl: async (url, init) => {
    const body = JSON.parse(init.body)
    if (url.endsWith('/session')) return { ok: true, json: async () => ({ conversation: body.provider, provider: body.provider, model: body.model }) }
    return new Promise(resolve => { finish = () => resolve({ ok: true, json: async () => ({
      reply: `${body.conversation} reply`, provider: body.conversation, completed: true,
      requestedModel: body.conversation === 'codex' ? 'gpt-6.1-sol' : 'grok-4.7',
      termination: body.conversation === 'codex' ? 'managed' : 'natural',
      context: { project_id: 'proj', project_revision: 3, canvas_id: null },
    }) }) })
  } })
  const h = generationHarness(async () => { throw new Error('no generation') }, assistant)
  try {
    h.state.draft.skillId = null; h.prompt.value = 'Grok'
    await h.root.dispatchEvent({ type: 'vnext-draft-change' })
    const pending = h.send.dispatchEvent({ type: 'click' })
    assert.equal(h.selector.disabled, true)
    await new Promise(resolve => setImmediate(resolve)); finish(); await pending
    assert.equal(h.selector.disabled, false)
    h.prompt.value = 'unsent draft'; h.selector.value = 'codex'
    await h.selector.dispatchEvent({ type: 'change' })
    assert.equal(h.prompt.value, 'unsent draft'); assert.equal(assistant.provider, 'codex')
    assert.equal(h.host.children.every(n => !n.hidden), true)
    assert.match(h.send.title, /GPT 6\.1/)
    h.selector.value = 'grok'; await h.selector.dispatchEvent({ type: 'change' })
    assert.equal(h.host.children.every(n => !n.hidden), true)
    assert.equal(h.prompt.value, 'unsent draft')
  } finally { h.restore() }
})

test('Grok error preserves draft, composing Enter does not send, and changing selection cancels', async () => {
  let rejectReply, modelCalls = 0
  const assistant = createVnextAssistantClient({ fetchImpl: async (url, init) => {
    if (url.endsWith('/session')) return { ok: true, json: async () => ({ conversation: 'local', provider: 'grok', model: 'grok-4.7' }) }
    modelCalls++
    return new Promise((resolve, reject) => {
      rejectReply = reject
      init.signal.addEventListener('abort', () => reject(Object.assign(new Error(), { name: 'AbortError' })))
    })
  } })
  const h = generationHarness(async () => { throw new Error('generation must not run') }, assistant)
  try {
    h.state.draft.skillId = null; h.prompt.value = 'keep this draft'
    await h.root.dispatchEvent({ type: 'vnext-draft-change' })
    await h.prompt.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Enter', isComposing: true }))
    assert.equal(modelCalls, 0)
    const pending = h.send.dispatchEvent({ type: 'click' })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(modelCalls, 1); assert.equal(h.send.title, 'Stop Grok 4.7 reply')
    h.session.conversationRef = { canvasId: 'different' }
    await h.root.dispatchEvent({ type: 'vnext-draft-change' })
    await pending
    assert.equal(h.prompt.value, ''); assert.equal(assistant.blocked, true)
  } finally { rejectReply?.(new Error()); h.restore() }
})

for (const scenario of ['success', 'failure', 'cancel', 'new-draft', 'typed-then-deleted', 'new-project', 'new-revision']) {
  test(`Grok clears immediately and protects draft ownership: ${scenario}`, async () => {
    let finish, fail
    const assistant = createVnextAssistantClient({ fetchImpl: async (url, init) => {
      if (url.endsWith('/session')) return { ok: true, json: async () => ({ conversation: 'local', provider: 'grok', model: 'grok-4.7' }) }
      return new Promise((resolve, reject) => {
        finish = () => resolve({ ok: true, json: async () => ({ reply: 'Reply', provider: 'grok', completed: true, requestedModel: 'grok-4.7', termination: 'natural',
          context: { project_id: 'proj', project_revision: 3, canvas_id: null } }) })
        fail = () => reject(Object.assign(new Error(), { code: 'assistant_configuration_changed' }))
        init.signal.addEventListener('abort', () => reject(Object.assign(new Error(), { name: 'AbortError' })))
      })
    } })
    const h = generationHarness(async () => { throw new Error('generation must not run') }, assistant)
    try {
      h.state.draft.skillId = null
      h.prompt.value = '  original text\n'
      await h.prompt.dispatchEvent(new Event('input'))
      const pending = h.send.dispatchEvent({ type: 'click' })
      assert.equal(h.prompt.value, '', 'clear synchronously, before any reply')
      await new Promise(resolve => setImmediate(resolve))
      assert.equal(h.send.title, 'Stop Grok 4.7 reply')
      if (['success', 'new-draft', 'typed-then-deleted'].includes(scenario)) {
        h.prompt.value = 'new draft'
        await h.prompt.dispatchEvent(new Event('input'))
        if (scenario === 'typed-then-deleted') {
          h.prompt.value = ''
          await h.prompt.dispatchEvent(new Event('input'))
        }
      }
      if (scenario === 'new-project') {
        h.session.project = { id: 'other', revision: 1 }
        h.session.onProjectBound()
      } else if (scenario === 'new-revision') {
        h.session.project.revision++
        await h.root.dispatchEvent({ type: 'vnext-draft-change' })
      } else if (scenario === 'cancel') await h.send.dispatchEvent({ type: 'click' })
      else if (scenario === 'success') finish()
      else fail()
      await pending
      const expected = ['failure', 'cancel'].includes(scenario) ? '  original text\n'
        : ['success', 'new-draft'].includes(scenario) ? 'new draft' : ''
      assert.equal(h.prompt.value, expected)
      if (scenario === 'new-project') assert.equal(h.host.children.length, 0)
    } finally { h.restore() }
  })
}

test('Add to canvas waits while another project opens or is created, then adds the same processed sheet once', async () => {
  const posts = []
  let changing = true
  const harness = generationHarness(async (url) => {
    if (String(url).endsWith('.png')) return { ok: true, status: 200, headers: { get: () => 'application/octet-stream' }, async arrayBuffer() { return new Uint8Array([1, 2, 3, 4]).buffer } }
    throw new Error(`unexpected ${url}`)
  })
  harness.session.openInFlight = () => changing
  harness.session.api.createFromJob = async (projectId, payload) => { posts.push({ projectId, ...payload }); return { project: { ...harness.session.project, revision: harness.session.project.revision + 1 } } }
  const click = () => harness.host.dispatchEvent({ type: 'click', target: { dataset: { genAction: 'add-canvas' }, closest(selector) { return selector.includes('gen-action') ? this : null } } })
  try {
    harness.gen.phase = 'ready'
    harness.gen.job = readyJob('job_wait')
    const waiting = generationViewModel({ ...harness.gen, projectId: 'proj', projectChanging: true }).actions[0]
    assert.equal(waiting.disabled, true)
    assert.equal(waiting.title, 'Wait for the project to finish opening')
    await click()
    assert.equal(posts.length, 0, 'nothing is added to the project being left')
    assert.equal(harness.gen.phase, 'ready', 'the processed sheet stays ready')
    changing = false
    await click()
    assert.equal(posts.length, 1)
    assert.equal(posts[0].jobId, 'job_wait')
  } finally {
    harness.restore()
  }
})

test('an image-job handle stays with its project, and no image generation starts while another project opens', async () => {
  const opened = []
  const h = generationHarness(async (url) => { throw new Error(`unexpected ${url}`) })
  h.session.openConfirm = dialog => opened.push(dialog)
  h.session.closeConfirm = () => {}
  try {
    h.state.draft.skillId = null
    h.gen.staticImageSavePending = true
    h.gen.staticImageJobId = 'job_old'
    h.gen.staticImageContext = { projectId: 'proj', openEpoch: null, token: null }
    h.session.project = { id: 'proj_copy', revision: 1, name: 'Copy' } // e.g. an upgraded copy opened
    h.session.onProjectBound()
    assert.equal(h.gen.staticImageSavePending, false, 'the old project save no longer blocks this project')
    assert.equal(h.gen.staticImageJobId, null)
    assert.equal(h.newDiscussion.disabled, false, 'New discussion is available in the new project')

    h.session.openInFlight = () => true
    h.prompt.value = 'Generate an image of a red door'
    await h.prompt.dispatchEvent(new Event('input'))
    await h.send.dispatchEvent({ type: 'click' })
    assert.equal(opened.length, 0, 'no generation dialog while another project opens')
    const text = n => [n.textContent || '', ...(n.children || []).map(text)].join(' ')
    assert.ok(h.gen.thread.some(turn => /finish opening, then send the request again\. Nothing was run/.test(text(turn.node))))
  } finally {
    h.restore()
  }
})

test('Add to canvas sends nothing if a project change starts while the sheet is read, and never reloads into a change', async () => {
  const posts = [], reloads = []
  let changing = false, readSheet
  const harness = generationHarness(async (url) => {
    if (String(url).endsWith('.png')) {
      await new Promise(resolve => { readSheet = resolve })
      return { ok: true, status: 200, headers: { get: () => 'application/octet-stream' }, async arrayBuffer() { return new Uint8Array([1, 2, 3, 4]).buffer } }
    }
    throw new Error(`unexpected ${url}`)
  })
  harness.session.openInFlight = () => changing
  harness.session.reloadProject = async project => { reloads.push(project); harness.session.project = project; return { committed: true, stale: false } }
  harness.session.api.createFromJob = async (projectId, payload) => {
    posts.push({ projectId, ...payload })
    changing = true // another project starts opening while the request is out
    return { project: { ...harness.session.project, revision: 9 } }
  }
  // The server's newest state is read when the change ends (later than the saved snapshot).
  harness.session.api.getProject = async () => ({ ok: true, project: { ...harness.session.project, revision: 10 } })
  const click = () => harness.host.dispatchEvent({ type: 'click', target: { dataset: { genAction: 'add-canvas' }, closest(selector) { return selector.includes('gen-action') ? this : null } } })
  try {
    harness.gen.phase = 'ready'
    harness.gen.job = readyJob('job_sheet')
    const first = click()
    await new Promise(resolve => { const check = () => (readSheet ? resolve() : setImmediate(check)); check() })
    changing = true; readSheet()
    await first
    assert.equal(posts.length, 0, 'nothing was sent once the change began')
    assert.equal(harness.gen.pendingAdds.size, 1, 'the same payload is kept')
    changing = false
    const second = click()
    await new Promise(resolve => { const check = () => (readSheet ? resolve() : setImmediate(check)); check() })
    await second
    assert.equal(posts.length, 1)
    assert.equal(reloads.length, 0, 'the saved sheet is not reloaded into the project change')
    assert.equal(harness.gen.reloadFailed, true)
    assert.match(harness.gen.error, /Another project is opening/)
    assert.equal(harness.session.project.revision, 3, 'session project left for the change to settle')
    changing = false
    harness.session.onOpenEpochKept('proj') // the change ended in this project: the newest project is shown now
    for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve))
    assert.equal(reloads.length, 1)
    assert.equal(reloads[0].revision, 10, 'the newest read is shown, never the saved snapshot')
    assert.equal(harness.gen.reloadFailed, false)
  } finally {
    harness.restore()
  }
})

test('an image job interrupted by a project change keeps its handle and is offered again when the change ends without switching', async () => {
  let starts = 0, polls = 0, release, entered
  const firstPoll = new Promise(resolve => { entered = resolve })
  const ok = payload => ({ ok: true, status: 200, text: async () => JSON.stringify(payload) })
  const harness = generationHarness(async (url, init = {}) => {
    const path = String(url)
    if (path === '/api/editor/projects/proj/image-generation') {
      if (init.method === 'POST') { starts += 1; return ok({ id: 'job_keep', status: 'queued' }) }
      return ok(nativeImageState)
    }
    if (path === '/api/editor/projects/proj/image-generation/job_keep') {
      polls += 1
      if (polls === 1) { entered(); await new Promise(resolve => { release = resolve }) }
      return ok({ id: 'job_keep', status: 'running' })
    }
    throw new Error(`unexpected ${path}`)
  })
  harness.session.api.openEpoch = { current: 1 }
  harness.session.openConfirm = dialog => { harness.dialog = dialog }
  harness.session.closeConfirm = () => {}
  try {
    harness.state.draft.skillId = null
    harness.prompt.value = 'Generate an image of a red door'
    await harness.prompt.dispatchEvent(new Event('input'))
    const run = harness.send.dispatchEvent({ type: 'click' })
    await firstPoll
    assert.equal(harness.dialog, undefined)
    harness.session.api.openEpoch.current = 2 // an open of another project starts
    release()
    await run
    assert.equal(harness.gen.staticImageJobId, 'job_keep', 'the same job is kept, not dropped')
    harness.session.api.openEpoch.current = 3 // the open was cancelled or failed: still this project
    harness.session.onOpenEpochKept('proj', 3)
    assert.equal(harness.send.title, 'Check the same image job')
    assert.equal(starts, 1, 'no second generation request')
  } finally { harness.restore() }
})

test('an image job is kept only in its own current context: Undo-removed saves stop looping, reopen in place rebinds, a stale round trip does not', async () => {
  const h = generationHarness(async (url) => { throw new Error(`unexpected ${url}`) })
  h.session.api.openEpoch = { current: 5 }
  h.session.closeConfirm = () => {}
  try {
    h.state.draft.skillId = null
    // (1) Same epoch: the target canvas was removed (Undo), so Resolve abandons once and the composer is free again.
    let placements = 0
    h.session.importGeneratedAsset = async () => { placements += 1; return { abandoned: true } }
    h.session.imageSaveCurrentFor = () => true
    h.gen.staticImageContext = { projectId: 'proj', openEpoch: 5, token: { epoch: 0, projectId: 'proj' }, anchor: null, background: 'green' }
    h.gen.staticImageJobId = 'job_j'; h.gen.staticImageSavePending = true; h.gen.staticImageRequest = { provider: 'grok' }
    await h.send.dispatchEvent({ type: 'click' })
    assert.equal(placements, 1)
    assert.equal(h.gen.staticImageJobId, null); assert.equal(h.gen.staticImageSavePending, false)
    await h.send.dispatchEvent({ type: 'click' })
    assert.equal(placements, 1, 'no Resolve loop')

    // (3) Reopened in place: the job follows the reopen's epoch even while that open is still committing.
    h.session.imageSaveCurrentFor = () => false
    h.gen.staticImageContext = { projectId: 'proj', openEpoch: 5, token: { epoch: 0, projectId: 'proj' }, anchor: null }
    h.gen.staticImageJobId = 'job_k'; h.gen.staticImageSavePending = true
    h.session.api.openEpoch.current = 6
    h.session.openInFlight = () => true; h.session.pendingOpen = { projectId: 'proj', token: 6 }
    h.session.onProjectBound()
    assert.equal(h.gen.staticImageContext.openEpoch, 6)
    assert.equal(h.gen.staticImageSavePending, false, 'the discarded save becomes a plain job handle')
    assert.equal(h.send.title, 'Wait for the project to finish opening')
    h.session.openInFlight = () => false; h.session.pendingOpen = null
    await h.root.dispatchEvent({ type: 'vnext-draft-change' }) // the open finished (openProjectById notifies)
    assert.equal(h.send.title, 'Check the same image job')

    // (4) A context from an earlier visit (stale token) is not revived.
    h.gen.staticImageContext = { projectId: 'proj', openEpoch: 5, token: { epoch: 99, projectId: 'proj' }, anchor: null }
    h.session.onProjectBound()
    assert.equal(h.gen.staticImageContext.openEpoch, 5)
  } finally { h.restore() }
})

test('a deferred sheet reload never rolls the canvas back, shows only a newest read, and stays pending if it did not commit', async () => {
  const reloads = []
  let result = undefined, latest = { ok: true, project: { id: 'proj', revision: 8 } }
  const h = generationHarness(async (url) => { throw new Error(`unexpected ${url}`) })
  h.session.reloadProject = async project => { reloads.push(project.revision); if (!result?.stale) h.session.project = project; return result || { committed: true, stale: false } }
  h.session.api.getProject = async () => latest
  h.gen.savedPlacement = { key: 'proj|job_sheet', projectId: 'proj', result: { project: { id: 'proj', revision: 6 }, document: { document_id: 'doc_sheet' } } }
  const settle = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve)) }
  try {
    // The project shown is already newer than the saved sheet (e.g. a reopen loaded it): drop, never roll back.
    h.session.project = { id: 'proj', revision: 7, name: 'Hero' }
    h.gen.deferredReload = { projectId: 'proj', project: { id: 'proj', revision: 6 } }
    h.gen.reloadFailed = true; h.gen.error = 'Saved. Another project is opening, so this canvas was not reloaded here.'
    h.session.onProjectBound()
    assert.equal(h.gen.deferredReload, null); assert.equal(h.gen.reloadFailed, false)
    h.session.onOpenEpochKept('proj'); await settle()
    assert.deepEqual(reloads, [], 'no reload of an older snapshot')

    // Older project shown, but the reload is superseded (not committed): it stays pending with its notice.
    h.session.project = { id: 'proj', revision: 3, name: 'Hero' }
    h.gen.deferredReload = { projectId: 'proj', project: { id: 'proj', revision: 6 } }
    h.gen.reloadFailed = true; h.gen.error = 'Saved. Another project is opening, so this canvas was not reloaded here.'
    // A failed or too-old newest read shows nothing (never the saved snapshot) and stays pending.
    for (const read of [{ ok: false, error: 'offline' }, { ok: true, project: { id: 'proj', revision: 5 } }, { ok: true, stale: true }]) {
      latest = read
      h.session.onOpenEpochKept('proj'); await settle()
      assert.deepEqual(reloads, [], 'no snapshot or older project is shown')
      assert.ok(h.gen.deferredReload); assert.equal(h.gen.reloadFailed, true)
      assert.match(h.gen.error, /could not be reloaded yet/)
    }
    latest = { ok: true, project: { id: 'proj', revision: 8 } }
    result = { stale: true }
    h.session.onOpenEpochKept('proj'); await settle()
    assert.deepEqual(reloads, [8], 'the newest read, not the saved revision 6'); assert.ok(h.gen.deferredReload, 'kept for the next time the change ends here'); assert.equal(h.gen.reloadFailed, true)
    result = undefined
    h.session.onOpenEpochKept('proj'); await settle()
    assert.deepEqual(reloads, [8, 8]); assert.equal(h.gen.deferredReload, null); assert.equal(h.gen.reloadFailed, false)
  } finally { h.restore() }
})

test('an unknown add keeps the same payload across a project switch and does not write to the other project', async () => {
  const posts = []
  let fail = true
  const harness = generationHarness(async (url) => {
    if (String(url).endsWith('.png')) {
      return { ok: true, status: 200, headers: { get: () => 'application/octet-stream' }, async arrayBuffer() { return new Uint8Array([9, 9]).buffer } }
    }
    throw new Error(`unexpected ${url}`)
  })
  harness.session.api.createFromJob = async (projectId, payload) => {
    posts.push({ projectId, ...payload })
    if (fail) throw Object.assign(new Error('disk'), { kind: 'unknown', code: 'storage_commit_failed', reason: 'disk' })
    return { project: { ...harness.session.project, revision: harness.session.project.revision + 1 } }
  }
  const click = () => harness.host.dispatchEvent({
    type: 'click',
    target: { dataset: { genAction: 'add-canvas' }, closest(selector) { return selector.includes('gen-action') ? this : null } },
  })
  try {
    harness.gen.phase = 'ready'
    harness.gen.job = readyJob('job_keep')
    await click()
    assert.equal(posts.length, 1)
    assert.equal(posts[0].projectId, 'proj')
    harness.session.view.select('other-canvas')
    await click()
    assert.equal(posts.length, 2)
    assert.equal(posts[1].operationId, posts[0].operationId)
    assert.equal(posts[1].expectedSha256, posts[0].expectedSha256)
    assert.equal(posts[1].jobId, 'job_keep')
    harness.session.project = { id: 'other', revision: 1, name: 'Other' }
    harness.session.onProjectBound()
    await click()
    assert.equal(posts.length, 2, 'the other project is not written')
    harness.session.project = { id: 'proj', revision: 3, name: 'Hero' }
    harness.session.onProjectBound()
    fail = false
    await click()
    assert.equal(posts.length, 3)
    assert.equal(posts[2].projectId, 'proj')
    assert.equal(posts[2].operationId, posts[0].operationId)
    assert.equal(posts[2].expectedSha256, posts[0].expectedSha256)
    assert.equal(posts[2].expectedRevision, posts[0].expectedRevision)
  } finally { harness.restore() }
})

function visibleText(node) {
  const parts = []
  const walk = current => {
    if (current?.textContent) parts.push(current.textContent)
    for (const child of current?.children || []) walk(child)
  }
  walk(node)
  return parts.join('\n')
}

test('first project bind restores and sends under that project, then a late reply cannot cross projects', async () => {
  const json = value => ({ ok: true, status: 200, async text() { return JSON.stringify(value) }, async json() { return value } })
  const settle = async () => { for (let i = 0; i < 6; i += 1) await new Promise(resolve => setImmediate(resolve)) }
  const calls = []
  const fetchImpl = async (url) => {
    const path = String(url)
    calls.push(path)
    if (path.includes('/assistant/history')) {
      const owner = path.match(/projects\/([^/]+)/)[1]
      return json({ provider: 'grok', model: 'grok-4.7', conversation: `conv-${owner}`, turns: [{ message: `${owner} question`, reply: `${owner} answer`, status: 'done' }] })
    }
    if (path.includes('/assistant/session')) return json({ provider: 'grok', model: 'grok-4.7', conversation: 'conv-opened' })
    if (path.includes('/assistant/messages')) {
      const owner = path.match(/projects\/([^/]+)/)[1]
      return json({ reply: 'local reply', context: { project_id: owner, project_revision: 2, canvas_id: null }, provider: 'grok', requestedModel: 'grok-4.7', completed: true, termination: 'natural' })
    }
    throw new Error(`unexpected ${path}`)
  }
  const assistant = createVnextAssistantClient({ fetchImpl })
  const h = generationHarness(fetchImpl, assistant, { project: null, keepRestore: true })
  try {
    h.state.draft.skillId = null
    h.session.project = { id: 'opened', revision: 2, name: 'Opened' }
    h.session.onProjectBound()
    await settle()
    assert.equal(calls.some(path => path.includes('/projects/opened/assistant/history')), true)
    assert.equal(visibleText(h.host).includes('opened answer'), true)
    h.prompt.value = 'discuss the sprite'
    await h.prompt.dispatchEvent(new Event('input'))
    await h.send.dispatchEvent({ type: 'click', preventDefault() {}, stopPropagation() {} })
    await settle()
    assert.equal(calls.some(path => path.includes('/projects/opened/assistant/messages')), true)
  } finally { h.restore() }

  let releaseJob
  const jobGate = new Promise(resolve => { releaseJob = resolve })
  const lateCalls = []
  const lateFetch = async (url) => {
    const path = String(url)
    lateCalls.push(path)
    if (path.includes('/api/jobs/job_urlquery')) {
      await jobGate
      return json({ id: 'job_urlquery', status: 'done', type: 'process_sheet' })
    }
    if (path.includes('/assistant/history')) {
      return json({ provider: 'grok', model: 'grok-4.7', conversation: 'conv-late', turns: [] })
    }
    throw new Error(`unexpected ${path}`)
  }
  const lateAssistant = createVnextAssistantClient({ fetchImpl: lateFetch })
  const late = generationHarness(lateFetch, lateAssistant, { project: null, keepRestore: true, initialJobId: 'job_urlquery' })
  try {
    late.session.project = { id: 'opened', revision: 2, name: 'Opened' }
    late.session.onProjectBound()
    assert.equal(lateCalls.some(path => path === '/api/jobs/job_urlquery'), true)
    late.session.project = { id: 'other', revision: 1, name: 'Other' }
    late.session.onProjectBound()
    releaseJob()
    await settle()
    assert.notEqual(late.gen.job?.id, 'job_urlquery')
    assert.equal(lateCalls.some(path => path.includes('/projects/other/assistant/history')), true)
  } finally { late.restore() }
})

test('N1 a native pixel request runs at once inside its minted scope: no modal or authorization card, a fresh grant per send, exact region and colors, automatic apply and accurate errors', async () => {
  const sentCalls = []
  const reviewed = []
  let confirmDialog = null
  let failNextWithVersionError = false
  const assistant = {
    provider: 'astra',
    busy: false,
    blocked: false,
    bind() {},
    stop() {},
    restore: async () => ({ turns: [] }),
    send: async (payload) => {
      sentCalls.push(payload)
      if (failNextWithVersionError) {
        failNextWithVersionError = false
        throw Object.assign(new Error('assistant_version_unverified'), {
          code: 'assistant_version_unverified',
          diagnostic: { reason: 'authorization', rule: 'internal' },
        })
      }
      const bytes = new Uint8Array(64 * 64 * 4)
      bytes[0] = 255; bytes[3] = 255
      return {
        reply: 'Patched region',
        pixelCandidateBytes: bytes,
        pixel_candidate: { drawing_batches: 1, allowed_rect: payload.allowedRect, source_sha256: 'a'.repeat(64), sha256: 'b'.repeat(64) },
      }
    },
  }
  mockComposer(assistant, { type: 'edit_pixels' })
  const storage = new Map()
  const h = generationHarness(async () => { throw Error('no requests') }, assistant, { storage })
  try {
    h.state.draft.skillId = null
    const region = { x: 8, y: 12, w: 6, h: 4 }
    h.session.project = { id: 'proj', revision: 4, palette: { colors: [[10, 20, 30, 255]] }, operation_receipts: {} }
    h.session.conversationRef = { projectId: 'proj', canvasId: 'canvas_1', documentId: 'doc_1', workingRevision: 2, name: 'Hero' }
    h.session.pixelSelection = { projectId: 'proj', canvasId: 'canvas_1', rect: { ...region } }
    let prepareCount = 0
    let prepareOpts = null
    let sourceRgba = new Uint8Array(64 * 64 * 4)
    h.session.preparePixelEdit = async (opts) => {
      prepareCount += 1
      prepareOpts = opts
      return {
        projectId: h.session.project.id, projectRevision: h.session.project.revision,
        sourceCanvasId: 'canvas_1', sourceDocumentId: 'doc_1', sourceRevision: 2, width: 64, height: 64,
        rgba: sourceRgba,
        allowedRect: h.session.pixelSelection?.rect ? { ...h.session.pixelSelection.rect } : undefined,
        grantId: `grant_${String(prepareCount).padStart(32, '0')}`,
        isSelected: () => true,
      }
    }
    h.session.openConfirm = (spec) => { confirmDialog = spec }
    h.session.closeConfirm = () => {}
    let undoEntry = null
    h.session.latestUndoEntry = () => undoEntry
    h.session.undoIfLatest = async entry => entry === undoEntry
    h.session.reviewNativePixelCandidate = async (source, bytes, candidate, options = {}) => {
      reviewed.push({ source, bytes, candidate, options })
      undoEntry = { kind: 'pixels', n: reviewed.length }
      return { outcome: 'saved', message: 'Astra drawing saved on this canvas.' }
    }
    const send = async text => {
      h.prompt.value = text
      await h.prompt.dispatchEvent(new Event('input'))
      await h.send.dispatchEvent({ type: 'click', preventDefault() {}, stopPropagation() {} })
      await settleFlow()
    }
    const latestRun = () => [...h.host.querySelectorAll('.is-run-turn')].at(-1)

    // 1. The request runs now: scope grant for the selected region, one send, automatic apply with Undo.
    await send('Recolor visor to #ff4422')
    assert.equal(confirmDialog, null, 'no modal')
    assert.equal(h.host.querySelectorAll('.is-astra-auth').length, 0, 'no authorization card')
    assert.equal(prepareOpts?.scopeGrant, true)
    assert.ok(prepareOpts?.allowedOperations?.includes('read_region'))
    assert.ok(prepareOpts?.allowedOperations?.includes('patch_region'))
    assert.equal(sentCalls.length, 1, 'one model tool request per user request')
    assert.equal(sentCalls[0].grantId, 'grant_00000000000000000000000000000001')
    assert.deepEqual(sentCalls[0].allowedRect, region)
    assert.deepEqual(sentCalls[0].allowedColors, [[255, 68, 34, 255], [10, 20, 30, 255]])
    assert.equal(reviewed.length, 1)
    assert.equal(reviewed[0].options.renderDecision, undefined, 'the result is applied without a Save step')
    assert.equal(typeof reviewed[0].options.checkCurrent, 'function', 'target and revision are re-checked before the write')
    assert.deepEqual(reviewed[0].candidate.allowed_rect, region)
    assert.match(visibleText(latestRun()), /Drawing applied/)
    assert.match(visibleText(latestRun()), /Region \(8, 12, 6×4\)/)
    assert.doesNotMatch(visibleText(h.host), /Authorize|Reject|Save drawing|Discard preview|Not saved yet/)
    assert.ok(latestRun().querySelector('[data-gen-action="astra-flow:undo"]'), 'Undo is the optional follow-up')

    // 2. 61 unique opaque source colors + 1 explicit color fits slot 62; every send mints a fresh grant.
    const region61 = { x: 0, y: 0, w: 64, h: 1 }
    sourceRgba = new Uint8Array(64 * 64 * 4)
    for (let x = 0; x < 64; x += 1) {
      const c = Math.min(x, 60), i = x * 4
      sourceRgba[i] = c + 1; sourceRgba[i + 1] = 10; sourceRgba[i + 2] = 20; sourceRgba[i + 3] = 255
    }
    h.session.pixelSelection = { projectId: 'proj', canvasId: 'canvas_1', rect: { ...region61 } }
    await send('Paint accent with #ff00aa')
    assert.equal(sentCalls.length, 2)
    assert.deepEqual(sentCalls[1].allowedColors, [[255, 0, 170, 255]], 'explicit prompt color preserved in the 62nd slot')
    await send('Paint accent with #112233')
    assert.equal(sentCalls.length, 3)
    assert.notEqual(sentCalls[2].grantId, sentCalls[1].grantId, 'fresh server grant on every send')
    assert.equal(reviewed.length, 3)

    // 3. A version error reports accurately and restores the draft.
    failNextWithVersionError = true
    await send('Paint after error #334455')
    assert.equal(sentCalls.length, 4)
    assert.equal(h.prompt.value, 'Paint after error #334455', 'draft restored on version verification error')
    assert.match(visibleText(latestRun()), /CLI version is not verified for this connection\. Draft kept; no message was sent\./)
    assert.doesNotMatch(visibleText(h.host), /That tool call was not authorized/)

    // 4. More than 62 colors is refused before anything is sent, without silent truncation.
    await send('Paint with #ff00aa and #00ffbb')
    assert.equal(sentCalls.length, 4, 'nothing sent when explicit colors exceed the 62-symbol limit')
    assert.equal(h.prompt.value, '', 'the chat message stays in history')
    assert.match(visibleText(h.host), /more than 62 colors/)

    // 5. No authorization preference exists: nothing is written to browser storage.
    assert.deepEqual([...storage.keys()].filter(key => /astraAlwaysAllow/.test(key)), [])
  } finally { h.restore() }
})

test('N1 the Astra run card shows progress with Stop, applies the result with Undo, refuses a competing action while saving, and reports a changed canvas as not applied', async () => {
  let pendingSend = null
  let pendingSave = null
  let confirmModalCalls = 0
  const region = { x: 8, y: 12, w: 6, h: 4 }
  const assistant = {
    provider: 'astra',
    busy: false,
    blocked: false,
    bind() {},
    stop() {
      if (pendingSend) {
        assistant.busy = false
        const reject = pendingSend.reject
        pendingSend = null
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
      }
    },
    restore: async () => ({ turns: [] }),
    send: (payload) => {
      assistant.busy = true
      return new Promise((resolve, reject) => { pendingSend = { payload, resolve, reject } })
    },
  }
  mockComposer(assistant, { type: 'edit_pixels' })
  const h = generationHarness(async () => { throw Error('no requests') }, assistant)
  try {
    h.state.draft.skillId = null
    h.session.project = { id: 'proj_flow', revision: 4, palette: { colors: [] }, operation_receipts: {} }
    h.session.conversationRef = { projectId: 'proj_flow', canvasId: 'canvas_1', documentId: 'doc_1', workingRevision: 2, name: 'Hero' }
    h.session.pixelSelection = { projectId: 'proj_flow', canvasId: 'canvas_1', rect: { ...region } }
    h.session.openConfirm = () => { confirmModalCalls += 1 }
    h.session.closeConfirm = () => {}
    h.session.preparePixelEdit = async () => ({
      projectId: h.session.project.id, projectRevision: h.session.project.revision,
      sourceCanvasId: 'canvas_1', sourceDocumentId: 'doc_1', sourceRevision: 2, width: 64, height: 64,
      rgba: new Uint8Array(64 * 64 * 4),
      allowedRect: h.session.pixelSelection?.rect ? { ...h.session.pixelSelection.rect } : undefined,
      grantId: 'grant_flow_0000000000000000000001',
      isSelected: () => h.session.conversationRef?.canvasId === 'canvas_1',
    })
    let undoEntry = null, undone = null
    h.session.latestUndoEntry = () => undoEntry
    h.session.undoIfLatest = async entry => { undone = entry; return entry === undoEntry }
    h.session.reviewNativePixelCandidate = async (source, bytes, candidate, opts = {}) => {
      assert.equal(opts.renderDecision, undefined)
      await opts.checkCurrent()
      await new Promise((resolve) => { pendingSave = resolve })
      undoEntry = { kind: 'pixels' }
      return { outcome: 'saved', message: 'Astra drawing saved on this canvas.' }
    }
    const latestRun = () => [...h.host.querySelectorAll('.is-run-turn')].at(-1)
    const flowBtn = (card, name) => card?.querySelector(`[data-gen-action="astra-flow:${name}"]`)
    const candidateBytes = new Uint8Array(64 * 64 * 4)
    candidateBytes[0] = 255; candidateBytes[3] = 255
    const result = { reply: 'Patched visor', pixelCandidateBytes: candidateBytes,
      pixel_candidate: { drawing_batches: 2, allowed_rect: region, source_sha256: 'a'.repeat(64), sha256: 'b'.repeat(64) } }

    // 1. The request starts at once with progress and Stop; Stop ends waiting and restores the draft.
    h.prompt.value = 'Shade visor #ff4422'
    await h.prompt.dispatchEvent(new Event('input'))
    const run1 = h.send.dispatchEvent({ type: 'click', preventDefault() {}, stopPropagation() {} })
    await settleFlow(6)
    const card1 = latestRun()
    assert.ok(pendingSend, 'the tool request started without an authorization step')
    assert.match(visibleText(card1), /Drawing…/)
    assert.match(visibleText(card1), /On the selected region \(8, 12, 6×4\) of this 64×64 canvas\./)
    assert.equal(card1.querySelector('.vnext-workflow-card'), null, 'progress is conversational, not a card')
    assert.equal(flowBtn(card1, 'stop')?.textContent, 'Stop')
    await flowBtn(card1, 'stop').dispatchEvent({ type: 'click' })
    await run1; await settleFlow(4)
    assert.match(visibleText(card1), /Drawing stopped/)
    assert.match(visibleText(card1), /No pixels were saved; no automatic retry\./)
    assert.equal(h.prompt.value, 'Shade visor #ff4422', 'draft restored after stopping')

    // 2. The result is applied in the same card; a competing action is refused while it saves; Undo follows.
    const run2 = h.send.dispatchEvent({ type: 'click', preventDefault() {}, stopPropagation() {} })
    await settleFlow(6)
    const card2 = latestRun()
    assert.notEqual(card2, card1)
    assistant.busy = false
    pendingSend.resolve(result); pendingSend = null
    await settleFlow(6)
    assert.equal(confirmModalCalls, 0, 'no preview modal')
    assert.match(visibleText(card2), /Applying the drawing…/)
    assert.match(visibleText(card2), /Region \(8, 12, 6×4\)\. Saving now\./)
    assert.equal(flowBtn(card2, 'save'), null, 'no Save step')
    h.prompt.value = 'Another request while saving'
    await h.prompt.dispatchEvent(new Event('input'))
    await h.send.dispatchEvent({ type: 'click', preventDefault() {}, stopPropagation() {} })
    await settleFlow(4)
    assert.equal(pendingSend, null, 'a competing model action does not start another tool request')
    assert.match(visibleText(h.host), /The previous result is still being made or saved/)
    pendingSave(); pendingSave = null
    await run2; await settleFlow(4)
    assert.match(visibleText(card2), /Drawing applied/)
    assert.match(visibleText(card2), /Region \(8, 12, 6×4\)\. Undo restores the previous pixels\./)
    await flowBtn(card2, 'undo').dispatchEvent({ type: 'click' }); await settleFlow(2)
    assert.equal(undone, undoEntry)
    assert.match(visibleText(card2), /Undone/)

    // 3. A canvas change while drawing is reported as not applied; nothing is saved and nothing is retried.
    h.prompt.value = 'Paint another accent'; await h.prompt.dispatchEvent(new Event('input'))
    const run3 = h.send.dispatchEvent({ type: 'click', preventDefault() {}, stopPropagation() {} })
    await settleFlow(6)
    const card3 = latestRun()
    h.session.project.revision = 5
    assistant.busy = false
    pendingSend.resolve(result); pendingSend = null
    await run3; await settleFlow(4)
    assert.match(visibleText(card3), /Not applied/)
    assert.match(visibleText(card3), /No pixels were saved; send the request again/)
    assert.equal(pendingSave, null, 'no save was attempted')
    h.prompt.value = 'Ready again'
    await h.prompt.dispatchEvent(new Event('input'))
    assert.equal(h.send.disabled, false, 'composer is free after the run ends')
  } finally { h.restore() }
})

const settleAstraHistory = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve)) }
function astraHistoryHarness({ provider = 'astra', storage = new Map(), restoreResult, recoverSave } = {}) {
  const turn = { operation_id: 'candidate-history-1', status: 'done', message: 'Paint red', reply: 'Preview ready',
    context: { project_id: 'history_project', project_revision: 3, canvas_id: 'canvas_1', document_id: 'doc_1', working_revision: 2, pixel_tools: true },
    pixel_candidate: { rgba_hex: 'ff0000ff'.repeat(4096), source_sha256: 'a'.repeat(64), sha256: 'b'.repeat(64), drawing_batches: 1 } }
  let reviews = 0, selected = 0, undoEntry = null, shown = false
  const assistant = { provider, busy: false, bind() {}, stop() {},
    select(value) { this.provider = value; return true },
    // Like the real client: once history is shown, later reads of the same discussion keep the view.
    restore: async () => {
      const value = restoreResult ? await restoreResult() : { turns: assistant.provider === 'astra' ? [turn] : [] }
      const preserveView = shown; shown = true
      return { preserveView, ...value }
    },
    send: async () => { throw new Error('test must not send to a model') },
  }
  const h = generationHarness(async () => { throw new Error('no network') }, assistant, { project: null, keepRestore: true, storage })
  h.state.draft.skillId = null
  h.session.project = { id: 'history_project', revision: 3, operation_receipts: {} }
  h.session.conversationRef = { canvasId: 'canvas_1', workingRevision: 2 }
  h.session.selectCanvas = id => { selected++; h.session.conversationRef.canvasId = id }
  h.session.preparePixelEdit = async () => ({ projectId: 'history_project', projectRevision: 3,
    sourceCanvasId: 'canvas_1', sourceDocumentId: 'doc_1', sourceRevision: 2, width: 64, height: 64,
    isSelected: () => h.session.conversationRef.canvasId === 'canvas_1' })
  h.session.latestUndoEntry = () => undoEntry
  h.session.undoIfLatest = async entry => entry === undoEntry
  h.session.reviewNativePixelCandidate = async (_source, _rgba, _candidate, options) => {
    reviews++
    assert.equal(options.renderDecision, undefined, 'an earlier result has no Save/Discard decision step')
    if (recoverSave) { options.renderRecovery(recoverSave); return { outcome: 'unconfirmed', message: 'Drawing save is not confirmed.' } }
    undoEntry = { kind: 'pixels' }
    return { outcome: 'saved', message: 'Astra drawing saved on this canvas.' }
  }
  return { ...h, assistant, turn, storage, counts: () => ({ reviews, selected }),
    button: action => h.host.querySelector(`[data-gen-action="astra-flow:${action}"]`),
    offer: () => h.host.querySelector('[data-recover-discussion-preview]'),
    dismiss: () => h.host.querySelector('[data-dismiss-discussion-preview]'),
    async start() { h.session.onProjectBound(); await settleAstraHistory() } }
}

test('N1 history restoration never activates an earlier result, for any model or after a late provider change', async () => {
  for (const provider of ['grok', 'astra']) {
    const h = astraHistoryHarness({ provider })
    if (provider === 'grok') h.assistant.restore = async () => ({ turns: [{ ...h.turn, provider: 'astra' }] })
    try {
      h.session.conversationRef.canvasId = 'current_canvas'
      await h.start()
      assert.deepEqual(h.counts(), { reviews: 0, selected: 0 }, `${provider}: nothing is applied, previewed or selected`)
      assert.equal(h.session.conversationRef.canvasId, 'current_canvas')
      assert.ok(h.offer(), `${provider}: the earlier result is only offered`)
      assert.match(visibleText(h.host), /An earlier drawing from this discussion was never applied/)
      assert.equal(h.selector.disabled, false)
      h.prompt.value = 'Continue chat'; await h.prompt.dispatchEvent(new Event('input'))
      assert.equal(h.send.disabled, false, `${provider}: new requests are not blocked by the old result`)
    } finally { h.restore() }
  }
  let resolveHistory
  const late = astraHistoryHarness({ restoreResult: () => new Promise(resolve => { resolveHistory = resolve }) })
  try {
    await late.start()
    late.assistant.provider = 'codex'
    resolveHistory({ turns: [late.turn] })
    await settleAstraHistory()
    assert.deepEqual(late.counts(), { reviews: 0, selected: 0 })
    assert.equal(late.selector.disabled, false)
  } finally { late.restore() }
})

test('N1 an earlier result is applied only by its explicit Apply, with Undo; Dismiss is remembered across reopening; saved results are not offered', async () => {
  const h = astraHistoryHarness()
  try {
    h.session.conversationRef.canvasId = 'another_canvas'
    await h.start()
    assert.deepEqual(h.counts(), { reviews: 0, selected: 0 })
    await h.offer().dispatchEvent({ type: 'click' }); await settleAstraHistory()
    assert.deepEqual(h.counts(), { reviews: 1, selected: 1 }, 'Apply is the request: one apply of the earlier drawing on its own canvas')
    assert.match(visibleText(h.host), /Drawing applied/)
    assert.doesNotMatch(visibleText(h.host), /Save drawing|Discard preview|Not saved yet/)
    assert.ok(h.button('undo'), 'Undo follows the applied earlier result')
    assert.equal(h.offer().dataset.recoveredDone, 'true')
  } finally { h.restore() }
  const storage = new Map()
  const dismissed = astraHistoryHarness({ storage })
  let resolveImages
  try {
    dismissed.api.listStaticImages = () => new Promise(resolve => { resolveImages = resolve })
    await dismissed.start()
    resolveImages({ jobs: [{ id: 'old_image', imported: true, provider: 'codex' }] })
    await settleAstraHistory()
    assert.equal(dismissed.dismiss().disabled, false, 'late image history does not freeze the offer')
    await dismissed.dismiss().dispatchEvent({ type: 'click' }); await settleAstraHistory()
    assert.match(visibleText(dismissed.host), /Earlier result dismissed\. Nothing was applied\./)
    assert.equal(dismissed.offer().disabled, true)
    assert.ok([...storage.values()].some(value => value.includes('candidate-history-1')))
    assert.deepEqual(dismissed.counts(), { reviews: 0, selected: 0 })
  } finally { dismissed.restore() }
  const reopened = astraHistoryHarness({ storage })
  try {
    await reopened.start()
    assert.equal(reopened.offer(), null, 'a dismissed result is not offered again')
    assert.deepEqual(reopened.counts(), { reviews: 0, selected: 0 })
  } finally { reopened.restore() }
  const saved = astraHistoryHarness()
  try {
    saved.session.conversationRef.canvasId = 'current_canvas'
    saved.session.project.operation_receipts[saved.turn.operation_id] = { saved: true }
    await saved.start()
    assert.equal(saved.offer(), null, 'a saved result is never offered')
    assert.deepEqual(saved.counts(), { reviews: 0, selected: 0 })
    assert.equal(saved.session.conversationRef.canvasId, 'current_canvas')
  } finally { saved.restore() }
  const stale = astraHistoryHarness()
  try {
    stale.session.project.revision = 4
    await stale.start()
    assert.equal(stale.offer(), null, 'a result for an older project revision is not offered')
  } finally { stale.restore() }
})

test('N1 inline recovery of an applied earlier result stays actionable and resolves the same save in the same turn', async () => {
  let resolveSave, retries = 0
  const h = astraHistoryHarness({ recoverSave: {
    title: 'Pixel refresh pending', body: 'Pixels are saved. Reload checks the saved image.', primary: 'Reload canvas',
    onPrimary: () => { retries++; return new Promise(resolve => { resolveSave = resolve }) },
  } })
  try {
    await h.start()
    await h.offer().dispatchEvent({ type: 'click' }); await settleAstraHistory()
    const card = h.host.querySelectorAll('.is-run-turn').at(-1)
    assert.match(visibleText(card), /Pixel refresh pending/)
    assert.equal(h.button('recover').disabled, false)
    h.button('recover').dispatchEvent({ type: 'click' }); await settleAstraHistory()
    assert.equal(retries, 1)
    assert.equal(h.button('recover').disabled, true)
    assert.match(visibleText(card), /Resolving the save/)
    await h.button('recover').dispatchEvent({ type: 'click' })
    assert.equal(retries, 1, 'a second click while resolving does nothing')
    resolveSave({ message: 'Astra drawing saved on this canvas.', pending: false })
    await settleAstraHistory()
    assert.match(visibleText(card), /Drawing applied/)
    assert.equal(h.host.querySelectorAll('.is-run-turn').at(-1), card, 'the same turn completes after recovery')
    h.prompt.value = 'Continue'; await h.prompt.dispatchEvent(new Event('input'))
    assert.equal(h.send.disabled, false)
    assert.equal(h.selector.disabled, false)
  } finally { h.restore() }
})

test('N1 a late history restore cannot replace a running request or its draft', async () => {
  let resolveHistory, rejectSend, sends = 0
  const h = astraHistoryHarness({ restoreResult: () => new Promise(resolve => { resolveHistory = resolve }) })
  h.assistant.send = () => { sends++; return new Promise((_resolve, reject) => { rejectSend = reject }) }
  mockComposer(h.assistant, { type: 'edit_pixels' })
  try {
    await h.start()
    h.prompt.value = 'Paint red #FF0000'; await h.prompt.dispatchEvent(new Event('input'))
    const run = h.send.dispatchEvent({ type: 'click', preventDefault() {}, stopPropagation() {} })
    await settleAstraHistory()
    const stop = h.button('stop')
    assert.ok(stop, 'the request is running, not waiting for authorization')
    assert.equal(sends, 1)
    resolveHistory({ turns: [h.turn] }); await settleAstraHistory()
    assert.deepEqual(h.counts(), { reviews: 0, selected: 0 })
    assert.equal(stop.disabled, false)
    assert.equal(h.prompt.value, '')
    rejectSend(Object.assign(new Error('aborted'), { name: 'AbortError' })); await run
  } finally { h.restore() }
})

test('N1 failed dismissal storage is truthful and an unreadable store offers and activates nothing', async () => {
  const h = astraHistoryHarness()
  try {
    await h.start()
    globalThis.window.localStorage.setItem = () => { throw new Error('storage unavailable') }
    await h.dismiss().dispatchEvent({ type: 'click' }); await settleAstraHistory()
    assert.match(visibleText(h.host), /could not remember this dismissal/)
    // Rebuild the thread (not a preserved view), so the offer is computed again from history.
    h.assistant.restore = async () => ({ preserveView: false, turns: [{ ...h.turn, provider: 'astra' }] })
    await h.selector.dispatchEvent({ type: 'click' })
    await h.root.querySelectorAll('[data-assistant-model]')[1].dispatchEvent({ type: 'click' }); await settleAstraHistory()
    await h.selector.dispatchEvent({ type: 'click' })
    await h.root.querySelectorAll('[data-assistant-model]')[2].dispatchEvent({ type: 'click' }); await settleAstraHistory()
    assert.match(visibleText(h.host), /Preview ready/, 'the history was rebuilt')
    assert.equal(h.offer(), null, 'the in-tab dismissal holds when storage fails, even after a rebuild')
    assert.deepEqual(h.counts(), { reviews: 0, selected: 0 })
  } finally { h.restore() }
  const unreadable = astraHistoryHarness()
  try {
    globalThis.window.localStorage.getItem = () => { throw new Error('storage unavailable') }
    await unreadable.start()
    assert.deepEqual(unreadable.counts(), { reviews: 0, selected: 0 })
    assert.equal(unreadable.offer(), null)
    assert.match(visibleText(unreadable.host), /No historical preview was activated/)
    assert.equal(unreadable.selector.disabled, false)
  } finally { unreadable.restore() }
})

test('New discussion clears the active thread without inserting the fresh-discussion note card, while keeping real history and error notices', async () => {
  let failFresh = false
  const assistant = {
    provider: 'grok',
    busy: false,
    blocked: false,
    bind() {},
    stop() {},
    restore: async ({ fresh } = {}) => {
      if (fresh && failFresh) {
        throw Object.assign(new Error('storage_failed'), { code: 'assistant_storage_failed' })
      }
      if (fresh) return { turns: [] }
      return {
        turns: [
          { message: 'Saved question', reply: 'Saved answer', status: 'done' },
          { message: 'Failed question', status: 'failed', error: 'assistant_unavailable' },
        ],
      }
    },
  }
  const h = generationHarness(async () => { throw new Error('no network') }, assistant, { keepRestore: true })
  try {
    h.session.onProjectBound()
    await settleAstraHistory()
    assert.match(visibleText(h.host), /Saved question/)
    assert.match(visibleText(h.host), /Saved answer/)
    assert.match(visibleText(h.host), /Failed question/)
    assert.match(visibleText(h.host), /did not complete this reply/)

    await h.newDiscussion.dispatchEvent({ type: 'click' })
    await settleAstraHistory()
    assert.doesNotMatch(visibleText(h.host), /New discussion\. Earlier messages remain saved in the project\./)
    assert.equal(h.host.children.length, 0, 'fresh discussion starts with a clean empty thread without the static note card')

    failFresh = true
    await h.newDiscussion.dispatchEvent({ type: 'click' })
    await settleAstraHistory()
    assert.match(visibleText(h.host), /Saved discussion could not be read\. No message was sent\./)
  } finally {
    h.restore()
  }
})


test('restored native document turns hide operational commentary but keep ordinary chat complete', async () => {
  const reply = 'A complete answer. '.repeat(1000)
  const assistant = { provider: 'astra', busy: false, bind() {},
    async restore() { return { turns: [
      { provider: 'astra', message: 'Draw a flame', reply: 'I will use the document tools.', status: 'done', composer_action: { type: 'edit_document' } },
      { provider: 'astra', message: 'Create the frames', reply: 'Created unsaved frames; tools cannot save or loop.', status: 'done', operation_id: 'saved-document', document_candidate: { project_revision: 1, canvas_id: 'canvas' } },
      { provider: 'astra', message: 'Explain the colors', reply, status: 'done' },
    ] } },
  }
  const h = generationHarness(async () => { throw Error('no network') }, assistant, { keepRestore: true })
  try {
    h.session.project.operation_receipts = { 'saved-document': {} }
    h.session.onProjectBound(); await settleAstraHistory()
    const text = visibleText(h.host)
    assert.doesNotMatch(text, /I will use the document tools|Created unsaved frames|tools cannot save/)
    assert.ok(text.includes(reply), 'ordinary chat is not shortened')
    assert.match(text, /Canvas & timeline result/)
    assert.equal(h.host.querySelector('details'), null, 'no expandable internal commentary')
  } finally { h.restore() }
})

test('model changes preserve mixed-provider messages, their authors, DOM and draft', async () => {
  let restores = 0
  const assistant = { provider: 'grok', busy: false, bind() {}, select(provider) { this.provider = provider; return true },
    async restore() { return { preserveView: restores++ > 0, turns: [
      { provider: 'grok', message: 'Blue shield', reply: 'Grok remembers blue', status: 'done' },
      { provider: 'codex', message: 'White star', reply: 'GPT remembers white', status: 'done' },
    ] } },
  }
  const h = generationHarness(async () => { throw Error('no network') }, assistant, { keepRestore: true })
  try {
    h.session.onProjectBound(); await settleAstraHistory()
    h.state.draft.skillId = null; h.state.draft.prompt = 'Unsent draft'
    await h.root.dispatchEvent({ type: 'vnext-draft-change' })
    const original = [...h.host.children]
    await h.selector.dispatchEvent({ type: 'click' })
    await h.root.querySelectorAll('[data-assistant-model]')[1].dispatchEvent({ type: 'click' })
    await settleAstraHistory()
    assert.equal(assistant.provider, 'codex')
    assert.deepEqual([...h.host.children], original)
    assert.ok(original.every(node => !node.hidden))
    assert.match(visibleText(h.host), /Grok remembers blue/); assert.match(visibleText(h.host), /GPT remembers white/)
    assert.match(visibleText(h.host), /Grok 4.7/); assert.match(visibleText(h.host), /GPT 6.1/)
    assert.equal(h.state.draft.prompt, 'Unsent draft')
    await h.selector.dispatchEvent({ type: 'click' })
    await h.root.querySelectorAll('[data-assistant-model]')[2].dispatchEvent({ type: 'click' })
    await settleAstraHistory()
    assert.equal(assistant.provider, 'astra')
    assert.deepEqual([...h.host.children], original)
    assert.match(visibleText(h.host), /GPT remembers white/)
    assert.ok(original.every(node => !node.hidden))
  } finally { h.restore() }
})

test('shared history keeps a valid old pixel preview inactive until explicitly reopened', async () => {
  const h = astraHistoryHarness({ provider: 'grok' })
  let restores = 0
  h.assistant.restore = async () => ({ preserveView: restores++ > 0, turns: [{ ...h.turn, provider: 'astra' }] })
  try {
    h.session.conversationRef.canvasId = 'another_canvas'
    await h.start()
    h.state.draft.prompt = 'Keep this unsent draft'
    await h.root.dispatchEvent({ type: 'vnext-draft-change' })
    const original = [...h.host.children]
    assert.deepEqual(h.counts(), { reviews: 0, selected: 0 })
    const reopen = h.host.querySelector('[data-recover-discussion-preview]')
    assert.ok(reopen, 'default Grok page exposes explicit recovery')
    await h.selector.dispatchEvent({ type: 'click' })
    await h.root.querySelectorAll('[data-assistant-model]')[2].dispatchEvent({ type: 'click' })
    await settleAstraHistory()
    assert.equal(h.assistant.provider, 'astra')
    assert.deepEqual([...h.host.children], original)
    assert.match(visibleText(h.host), /Preview ready/)
    assert.deepEqual(h.counts(), { reviews: 0, selected: 0 })
    assert.equal(h.session.conversationRef.canvasId, 'another_canvas')
    assert.equal(h.state.draft.prompt, 'Keep this unsent draft')
    await reopen.dispatchEvent({ type: 'click' }); await settleAstraHistory()
    assert.deepEqual(h.counts(), { reviews: 1, selected: 1 })
    assert.equal(h.session.conversationRef.canvasId, 'canvas_1')
    assert.equal(h.state.draft.prompt, 'Keep this unsent draft')
    assert.match(visibleText(h.host), /Drawing applied/)
    assert.equal(h.button('save'), null); assert.equal(h.button('discard'), null)
  } finally { h.restore() }
})

test('shared history checks an earlier document preview only through explicit recovery', async () => {
  const requests = []
  const turn = { provider: 'astra',
    operation_id: 'old-document', status: 'done', message: 'Animate', reply: 'Document preview ready',
    document_candidate: { project_revision: 3, canvas_id: 'canvas_1' },
  }
  const assistant = createVnextAssistantClient({ fetchImpl: async (url, init) => {
    requests.push({ url, method: init.method })
    if (url.endsWith('/document-candidate')) return jsonResponse(200, { saved: true })
    const provider = new URL(url, 'http://local').searchParams.get('provider')
    assert.ok(url.includes('/history?'), 'recovery never creates a discussion or sends a message')
    return jsonResponse(200, { provider, model: provider === 'grok' ? 'grok-4.7' : 'gpt-6-astra',
      discussion: 'same-discussion', conversation: `${provider}-native`, blocked: false, turns: [turn] })
  } })
  const h = generationHarness(async () => { throw new Error('no generation') }, assistant, { project: null, keepRestore: true })
  try {
    h.state.draft.skillId = null
    h.session.project = { id: 'history_project', revision: 3, operation_receipts: {} }
    h.session.conversationRef = { canvasId: 'another_canvas' }
    h.session.onProjectBound(); await settleAstraHistory()
    const original = [...h.host.children]
    await h.selector.dispatchEvent({ type: 'click' })
    await h.root.querySelectorAll('[data-assistant-model]')[2].dispatchEvent({ type: 'click' })
    await settleAstraHistory()
    assert.equal(requests.length, 2, 'default Grok and first Astra switch only read history')
    assert.ok(requests.every(request => request.method === 'GET'))
    assert.deepEqual([...h.host.children], original)
    assert.equal(h.session.conversationRef.canvasId, 'another_canvas')
    await h.host.querySelector('[data-recover-discussion-preview]').dispatchEvent({ type: 'click' })
    await settleAstraHistory()
    assert.equal(requests.length, 4, 'explicit recovery refreshes the already cached Astra channel then resolves the candidate')
    assert.ok(requests[2].url.includes('/history?provider=astra&shared=true'))
    assert.ok(requests[3].url.endsWith('/document-candidate'))
    assert.match(visibleText(h.host), /candidate was saved/)
    assert.equal(h.session.conversationRef.canvasId, 'another_canvas')
  } finally { h.restore() }
})

// "Apply it" applies exactly the offered result: an older document in the same discussion is
// neither resolved nor applied first, whatever state it is in.
for (const documentState of ['saved', 'expired', 'read-failure']) test(`explicit recovery applies only the offered pixel result, never an older ${documentState} document`, async () => {
  const h = astraHistoryHarness({ provider: 'grok' })
  let restores = 0, documentCalls = 0
  h.assistant.restore = async () => ({ preserveView: restores++ > 0, turns: [{ provider: 'astra',
    operation_id: 'earlier-document', status: 'done', message: 'Animate', reply: 'Earlier document',
    document_candidate: { project_revision: 3, canvas_id: 'canvas_1' },
  }, { ...h.turn, provider: 'astra' }] })
  h.assistant.documentCandidate = async () => {
    documentCalls += 1
    if (documentState === 'saved') return { saved: true }
    throw Object.assign(Error(documentState), { code: documentState === 'expired' ? 'candidate_expired' : 'assistant_service_unavailable' })
  }
  try {
    h.session.conversationRef.canvasId = 'another_canvas'
    await h.start()
    const offers = h.host.querySelectorAll('[data-recover-discussion-preview]')
    assert.equal(offers.length, 1, 'only the latest unapplied result is offered')
    assert.match(visibleText(h.host), /earlier drawing/i, 'the offer names the pixel result it applies')
    await offers[0].dispatchEvent({ type: 'click' }); await settleAstraHistory()
    assert.equal(documentCalls, 0, 'the older document is not touched')
    assert.deepEqual(h.counts(), { reviews: 1, selected: 1 })
    assert.match(visibleText(h.host), /Drawing applied/)
  } finally { h.restore() }
})

for (const change of ['canvas', 'revision', 'draft', 'read-failure']) test(`explicit preview recovery preserves current work after ${change}`, async () => {
  const h = astraHistoryHarness({ provider: 'grok' })
  let restores = 0, complete
  const history = () => ({ preserveView: restores > 1, turns: [{ ...h.turn, provider: 'astra' }] })
  h.assistant.restore = async ({ refresh }) => {
    restores++
    if (restores <= 2) return history()
    assert.equal(refresh, true)
    h.assistant.busy = true
    return new Promise((resolve, reject) => { complete = () => {
      h.assistant.busy = false
      if (change === 'read-failure') reject(Object.assign(Error('offline'), { code: 'assistant_service_unavailable' }))
      else resolve(history())
    } })
  }
  try {
    h.session.conversationRef.canvasId = 'another_canvas'
    await h.start()
    await h.selector.dispatchEvent({ type: 'click' })
    await h.root.querySelectorAll('[data-assistant-model]')[2].dispatchEvent({ type: 'click' })
    await settleAstraHistory()
    const reopen = h.host.querySelector('[data-recover-discussion-preview]')
    await reopen.dispatchEvent({ type: 'click' }); await settleAstraHistory()
    assert.equal(reopen.disabled, true)
    if (change === 'canvas') h.session.conversationRef.canvasId = 'new_selection'
    if (change === 'revision') h.session.project.revision++
    if (change === 'draft') { h.prompt.value = 'New draft'; await h.prompt.dispatchEvent(new Event('input')) }
    complete(); await settleAstraHistory()
    assert.deepEqual(h.counts(), { reviews: 0, selected: 0 })
    assert.equal(h.session.conversationRef.canvasId, change === 'canvas' ? 'new_selection' : 'another_canvas')
    assert.equal(reopen.disabled, false, 'an interrupted read keeps explicit recovery available without retrying')
    assert.equal(restores, 3)
    if (change === 'draft') assert.equal(h.prompt.value, 'New draft')
    if (change === 'read-failure') {
      assert.equal(h.toast.hidden, false)
      assert.match(h.toast.textContent, /Local service unavailable/)
      assert.doesNotMatch(visibleText(h.host), /local service is unavailable/)
    }
  } finally { h.restore() }
})

test('explicit document recovery does not select an old canvas after a delayed candidate read', async () => {
  const h = astraHistoryHarness({ provider: 'grok' })
  let restores = 0, finishRead
  h.assistant.restore = async () => ({ preserveView: restores++ > 0, turns: [{ provider: 'astra',
    operation_id: 'document-wait', status: 'done', message: 'Animate', reply: 'Preview ready',
    document_candidate: { project_revision: 3, canvas_id: 'canvas_1' },
  }] })
  h.assistant.documentCandidate = async request => request.action === 'resolve' ? { saved: false }
    : new Promise(resolve => { finishRead = resolve })
  h.session.prepareDocumentEdit = async () => { throw new Error('changed context must not prepare a preview') }
  try {
    h.session.conversationRef.canvasId = 'another_canvas'
    await h.start()
    const reopen = h.host.querySelector('[data-recover-discussion-preview]')
    await reopen.dispatchEvent({ type: 'click' }); await settleAstraHistory()
    assert.equal(typeof finishRead, 'function')
    h.session.conversationRef.canvasId = 'new_selection'
    finishRead({}); await settleAstraHistory()
    assert.deepEqual(h.counts(), { reviews: 0, selected: 0 })
    assert.equal(h.session.conversationRef.canvasId, 'new_selection')
    assert.equal(reopen.disabled, false)
  } finally { h.restore() }
})

test('custom model menu supports selection, keyboard dismissal, outside click and busy locking', async () => {
  const assistant = { provider: 'grok', busy: false, bind() {}, select(provider) { this.provider = provider; return true } }
  const h = generationHarness(async () => { throw Error('no network') }, assistant)
  try {
    h.state.draft.skillId = null; await h.root.dispatchEvent({ type: 'vnext-draft-change' })
    const menu = h.root.querySelector('#vnext-assistant-model-menu')
    await h.selector.dispatchEvent({ type: 'click' })
    assert.equal(menu.hidden, false); assert.equal(h.selector.getAttribute('aria-expanded'), 'true')
    const items = h.root.querySelectorAll('[data-assistant-model]')
    assert.equal(items.length, 4); assert.equal(globalThis.document.activeElement, items[0])
    await items[0].dispatchEvent({ type: 'keydown', key: 'ArrowDown' })
    assert.equal(globalThis.document.activeElement, items[1])
    await items[1].dispatchEvent({ type: 'click' })
    assert.equal(assistant.provider, 'codex'); assert.equal(menu.hidden, true)
    assert.equal(h.root.querySelector('#vnext-assistant-model-label').textContent, 'GPT 6.1')
    assert.equal(globalThis.document.activeElement, h.selector)
    await h.selector.dispatchEvent({ type: 'keydown', key: 'ArrowUp' })
    assert.equal(globalThis.document.activeElement, items[3])
    await items[3].dispatchEvent({ type: 'keydown', key: 'Escape' })
    assert.equal(menu.hidden, true); assert.equal(globalThis.document.activeElement, h.selector)
    await h.selector.dispatchEvent({ type: 'click' }); await h.root.dispatchEvent({ type: 'pointerdown', target: h.prompt })
    assert.equal(menu.hidden, true)
    assistant.busy = true; await h.root.dispatchEvent({ type: 'vnext-draft-change' })
    await h.selector.dispatchEvent({ type: 'click' }); await items[2].dispatchEvent({ type: 'click' })
    assert.equal(menu.hidden, true); assert.equal(assistant.provider, 'codex')
  } finally { h.restore() }
})

test('Astra freely chats without edit preparation; consumes a sent attachment once and restores only the matching failed draft', async () => {
  const sent = []; let failNext = false, changeReference = null
  const assistant = { provider: 'astra', busy: false, blocked: false, bind() {},
    async send(body) { sent.push(body); if (changeReference) changeReference(); if (failNext) throw Object.assign(Error('failed'), { code: 'assistant_login_required' }); return { reply: 'Let us talk.' } },
  }
  const h = generationHarness(async () => { throw Error('no generation') }, assistant)
  try {
    h.state.draft.skillId = null
    h.session.preparePixelEdit = () => { throw Error('ordinary discussion must not prepare pixel edits') }
    const ref = { projectId: 'proj', canvasId: 'canvas-1' }
    h.session.conversationRef = ref
    h.session.consumeConversationRef = () => {
      if (h.session.consumedConversationRef === h.session.conversationRef) return null
      h.session.consumedConversationRef = h.session.conversationRef; return h.session.conversationRef
    }
    h.session.restoreConversationRef = value => {
      if (value && value === h.session.conversationRef && value === h.session.consumedConversationRef) h.session.consumedConversationRef = null
    }
    const send = async text => { h.prompt.value = text; await h.prompt.dispatchEvent(new Event('input')); await h.send.dispatchEvent({ type: 'click' }) }
    await send('你好')
    assert.equal(sent.length, 1); assert.equal(sent[0].canvasId, 'canvas-1'); assert.equal(sent[0].workingRevision, undefined)
    assert.equal(h.session.consumedConversationRef, ref)
    await send('你能生成图片吗')
    assert.equal(sent.length, 2); assert.equal(sent[1].canvasId, 'canvas-1'); assert.equal(sent[1].pixelTools, undefined)
    for (const question of ['生成图片需要多久？', '生成图片是什么意思？']) {
      await send(question)
      assert.equal(sent.at(-1).message, question)
      assert.equal(sent.at(-1).pixelTools, undefined)
    }
    failNext = true
    await send('继续聊聊')
    assert.equal(h.session.consumedConversationRef, ref, 'failed text follow-up does not revive the previously sent image')
    const next = { projectId: 'proj', canvasId: 'canvas-2' }; h.session.conversationRef = next
    await send('这张呢')
    assert.equal(h.session.consumedConversationRef, null, 'a failed matching attachment is restored with its draft')
    changeReference = () => { h.session.conversationRef = { projectId: 'proj', canvasId: 'canvas-3' }; h.prompt.value = 'new draft' }
    await send('再试这个')
    assert.equal(h.session.conversationRef.canvasId, 'canvas-3'); assert.equal(h.prompt.value, 'new draft')
  } finally { h.restore() }
})

test('there is no authorization mode: a message about authorization is ordinary chat sent to the model', async () => {
  const storage = new Map()
  const sent = []
  const assistant = mockComposer({ provider: 'astra', busy: false, blocked: false, bind() {}, stop() {} }, null)
  const reply = assistant.send
  assistant.send = request => { sent.push(request); return reply(request) }
  const h = generationHarness(async () => { throw Error('no network') }, assistant, { storage })
  try {
    h.state.draft.skillId = null
    h.prompt.value = '取消授权'; await h.prompt.dispatchEvent(new Event('input'))
    await h.send.dispatchEvent({ type: 'click' })
    assert.equal(sent.length, 1, 'the model answers it like any other message')
    assert.match(visibleText(h.host), /Let us discuss it/)
    assert.doesNotMatch(visibleText(h.host), /Future Astra edits will ask first|Automatic authorization/)
    assert.equal(storage.size, 0, 'no authorization preference is stored')
    assert.equal(h.root.querySelector('#vnext-astra-auth-status'), null)
  } finally { h.restore() }
})


test('the same topic words follow the model decision, never a client keyword rule', async () => {
  for (const action of [null, { type: 'edit_pixels' }, { type: 'edit_document' }]) {
    const assistant = mockComposer({ provider: 'astra', busy: false, blocked: false, bind() {} }, action)
    const h = generationHarness(async () => { throw Error('no generation') }, assistant)
    let pixels = 0, documents = 0
    try {
      h.state.draft.skillId = null
      h.session.preparePixelEdit = async () => { pixels++; throw Error('pixel gate reached') }
      h.session.prepareDocumentEdit = async () => { documents++; throw Error('document gate reached') }
      h.prompt.value = '我们继续刚才关于画画的讨论'; await h.prompt.dispatchEvent(new Event('input'))
      await h.send.dispatchEvent({ type: 'click' })
      assert.equal(pixels, action?.type === 'edit_pixels' ? 1 : 0)
      assert.equal(documents, action?.type === 'edit_document' ? 1 : 0)
    } finally { h.restore() }
  }
})

test('one Astra model routes edits on a multi-layer 64x64 canvas to existing document tools', async () => {
  const h = documentFlowHarness()
  try {
    h.session.documents = new Map([['doc', { frame_order: ['f'], layer_order: ['l1', 'l2'] }]])
    h.session.view.canvases = [{ id: 'canvas', document_id: 'doc', width: 64, height: 64 }]
    h.session.preparePixelEdit = () => { throw Error('must use document tools') }
    h.prompt.value = '把选中区域填充蓝色'; await h.prompt.dispatchEvent(new Event('input'))
    await h.send.dispatchEvent({ type: 'click' }); await settleFlow()
    assert.ok(h.host.querySelector('.is-astra-document'))
    assert.equal(h.calls.filter(c => c.send).length, 1, 'the request runs the document tools directly')
    assert.equal(h.calls.find(c => c.send).send.documentMode, true)
  } finally { h.restore() }
})


test('reference-image generation consumes the submitted selection once and sends it as the reference', async () => {
  const assistant = { provider: 'codex', busy: false, bind() {} }
  mockComposer(assistant, { type: 'generate_image', reference: true })
  const h = generationHarness(async () => { throw Error('no network') }, assistant)
  let consumed = 0, submitted, placed = 0
  try {
    h.state.draft.skillId = null; h.session.api.openEpoch = { current: 1 }
    h.session.project.sprite_documents = { doc: { working_revision: 1 } }
    h.session.conversationRef = { projectId: 'proj', canvasId: 'c', documentId: 'doc', workingRevision: 1, name: 'Reference' }
    h.session.view.canvases = [{ id: 'c', width: 64, height: 64 }]
    h.session.consumeConversationRef = () => { consumed++; return h.session.conversationRef }
    h.session.openConfirm = dialog => { h.dialog = dialog }; h.session.closeConfirm = () => {}
    h.session.importGeneratedAsset = async () => { placed++; return { placed: true, canvasId: 'generated' } }
    h.api.getStaticImageState = async () => nativeImageState
    h.api.startStaticImage = async (_projectId, body) => { submitted = body; return { id: 'job_ref' } }
    h.api.getStaticImageJob = async () => ({ id: 'job_ref', status: 'done', source_url: '/api/editor/projects/proj/image-generation/job_ref/source' })
    h.api.downloadStaticImage = async () => new Uint8Array([137, 80, 78, 71])
    h.prompt.value = '参考这张图生成像素风新图，放在右边'; await h.prompt.dispatchEvent(new Event('input'))
    await h.send.dispatchEvent({ type: 'click' }); await settleFlow()
    assert.equal(h.dialog, undefined)
    assert.equal(consumed, 1, 'the original composer submission consumes its attachment once')
    assert.ok(submitted.reference); assert.equal(placed, 1)
    assert.equal(h.prompt.value, '')
  } finally { h.restore() }
})


test('an applied document result keeps its Undo through ordinary follow-up discussion', async () => {
  const h = documentFlowHarness()
  try {
    let undoEntry = null, undone = null
    h.session.latestUndoEntry = () => undoEntry
    h.session.undoIfLatest = async entry => { undone = entry; return entry === undoEntry }
    const save = h.session.saveDocumentCandidate
    h.session.saveDocumentCandidate = async (...args) => { const result = await save(...args); undoEntry = { kind: 'pixels' }; return result }
    const card = await h.start(); await settleFlow()
    mockComposer(h.assistant, null)
    for (const text of ['Why align them?', 'What about the next frame?']) {
      h.prompt.value = text; await h.prompt.dispatchEvent(new Event('input'))
      await h.send.dispatchEvent({ type: 'click' })
      assert.equal(card.querySelector('[data-gen-action="astra-flow:undo"]').disabled, false)
    }
    assert.equal(h.calls.filter(c => c.action === 'accept').length, 1, 'chat never applies the result again')
    await card.querySelector('[data-gen-action="astra-flow:undo"]').dispatchEvent({ type: 'click' }); await settleFlow(2)
    assert.equal(undone, undoEntry)
    assert.match(visibleText(card), /Undone/)
  } finally { h.restore() }
})


test('a model action cannot adopt a selection or frame changed while its chat reply was pending', async () => {
  for (const changed of ['region', 'cel']) {
    let resolve, preparations = 0
    const assistant = { provider: 'astra', busy: false, blocked: false, bind() {}, send() { return new Promise(r => { resolve = r }) } }
    const h = generationHarness(async () => { throw Error('no generation') }, assistant)
    try {
      h.state.draft.skillId = null
      h.session.project.canvases = { c: { document_id: 'd' } }
      h.session.conversationRef = { canvasId: 'c' }; h.session.view.selectedId = 'c'
      h.session.pixelSelection = { projectId: 'proj', canvasId: 'c', rect: { x: 0, y: 0, w: 4, h: 4 } }
      h.session.documents = new Map([['d', { revision: 1 }]])
      let cel = 'c1'; h.session.documentTimeline = { target: () => ({ frame_id: 'f', layer_id: 'l', cel_id: cel }) }
      h.session.preparePixelEdit = async () => { preparations++; throw Error('must not prepare a new selection') }
      h.prompt.value = 'Fill this selection'; await h.prompt.dispatchEvent(new Event('input'))
      const pending = h.send.dispatchEvent({ type: 'click' })
      if (changed === 'region') h.session.pixelSelection.rect = { x: 12, y: 12, w: 4, h: 4 }
      else cel = 'c2'
      resolve({ reply: 'I can prepare it.', composer_action: { type: 'edit_pixels', instruction: 'Fill the selected region blue.', size: null, reference: false, kind: null } })
      await pending
      assert.equal(preparations, 0)
      assert.match(visibleText(h.host), /selection or attachment changed while the reply was being written, so nothing was run/)
    } finally { h.restore() }
  }
})


test('a selected preset stays conversational; a model request runs it once end to end and later chat does not retry a failure', async () => {
  let action = null, reviews = 0, sends = 0, starts = 0
  const assistant = { provider: 'astra', busy: false, blocked: false, bind() {}, stop() {}, async send(body) {
    sends++; assert.equal(body.composerPresetId, 'fixed-region-motion')
    return { reply: action ? 'Making the knight sheet.' : 'Which character should the preset use?', composer_action: action }
  } }
  const h = generationHarness(async () => { throw Error('No generation or unrelated request') }, assistant)
  try {
    h.session.api.openEpoch = { current: 1 }
    h.session.openConfirm = dialog => { h.dialog = dialog }
    h.api.reviewCharacter = async request => { reviews++; assert.equal(request.description, 'A blue knight.'); assert.equal(request.reference, null); return { reviewId: 'r1' } }
    h.api.startGenerate = async review => { starts++; assert.deepEqual(review, { reviewId: 'r1' }); throw Object.assign(new Error('The provider is offline. Nothing was generated.'), { status: 503 }) }
    h.prompt.value = 'What does this preset do?'; await h.prompt.dispatchEvent(new Event('input'))
    await h.send.dispatchEvent({ type: 'click' })
    assert.equal(reviews, 0); assert.equal(starts, 0); assert.equal(h.prompt.value, '')
    action = { type: 'use_preset', instruction: 'A blue knight.', preset_id: 'fixed-region-motion', reference: false }
    h.prompt.value = 'Use it for a blue knight'; await h.prompt.dispatchEvent(new Event('input'))
    await h.send.dispatchEvent({ type: 'click' }); await settleFlow()
    assert.equal(h.dialog, undefined, 'no approval dialog')
    assert.equal(reviews, 1); assert.equal(starts, 1, 'the plan check flows straight into the one live call')
    assert.equal(h.gen.phase, 'idle'); assert.match(h.gen.error, /provider is offline/)
    assert.equal(h.gen.autoRun, null)
    action = null
    h.prompt.value = 'Explain what happened'; await h.prompt.dispatchEvent(new Event('input'))
    await h.send.dispatchEvent({ type: 'click' }); await settleFlow()
    assert.equal(reviews, 1); assert.equal(starts, 1, 'chat never retries the live call'); assert.equal(sends, 3)
  } finally { h.restore() }
})

for (const changed of [false, true]) test(`Codex draws directly on the selected empty canvas${changed ? ' and refuses a changed target' : ''} without importing another canvas`, async () => {
  let draws = 0, saves = 0
  let selected = true
  const source = { isSelected: () => selected }
  const assistant = { provider: 'codex', busy: false, blocked: false, bind() {}, stop() {}, async send(body) {
    draws++; assert.equal(body.pixelDrawing.kind, 'new'); assert.equal(body.pixelDrawing.reference, false)
    if (changed) selected = false
    return { reply: 'Drawn', pixel_drawing: { size: 32, palette: ['#ff0000ff'], rects: [[0, 0, 1, 1, 0]] } }
  } }
  mockComposer(assistant, { type: 'draw_pixels', size: 32, kind: 'selected' })
  const h = generationHarness(async () => { throw Error('No generation') }, assistant)
  try {
    h.state.draft.skillId = null; h.session.api.openEpoch = { current: 1 }
    h.session.openConfirm = d => { h.dialog = d }; h.session.closeConfirm = () => {}
    let undoEntry = null
    h.session.latestUndoEntry = () => undoEntry
    h.session.undoIfLatest = async entry => entry === undoEntry
    h.session.prepareBlankPixelDrawing = async size => { assert.equal(size, 32); return source }
    h.session.saveBlankPixelDrawing = async (actual, rgba) => {
      saves++; assert.equal(actual, source); assert.equal(rgba.length, 32 * 32 * 4); assert.deepEqual([...rgba.slice(0, 4)], [255, 0, 0, 255])
      undoEntry = { kind: 'pixels' }
      return { saved: true, settled: true }
    }
    h.session.placeStaticImage = () => { throw Error('Must not create a separate canvas') }
    h.prompt.value = 'Draw on this blank canvas'; await h.prompt.dispatchEvent(new Event('input'))
    await h.send.dispatchEvent({ type: 'click' }); await settleFlow()
    assert.equal(h.dialog, undefined, 'no preview or save dialog')
    assert.equal(draws, 1); assert.equal(saves, changed ? 0 : 1)
    assert.match(h.host.querySelectorAll('[data-turn-title]').at(-1).textContent, changed ? /Not drawn/ : /Drawn on the selected canvas/)
    assert.equal(Boolean(h.host.querySelector('[data-gen-action="astra-flow:undo"]')), !changed)
  } finally { h.restore() }
})

test('assistant_service_unavailable renders a single P11 warning toast without model chat bubbles, keeps draft and Send safety block on dismiss, and resets after reconnect', async () => {
  let online = false
  let restoreCalls = 0
  let sendCalls = 0
  const assistant = {
    provider: 'grok',
    busy: false,
    blocked: false,
    errorCode: null,
    serviceUnavailable: false,
    connection: 'not_checked',
    bind() {
      this.blocked = false
      this.errorCode = null
      this.serviceUnavailable = false
    },
    stop() {},
    select(provider) {
      this.provider = provider
      return true
    },
    async restore() {
      restoreCalls += 1
      if (!online) {
        this.blocked = true
        this.errorCode = 'assistant_service_unavailable'
        this.serviceUnavailable = true
        throw Object.assign(new Error('offline'), { code: 'assistant_service_unavailable' })
      }
      this.blocked = false
      this.errorCode = null
      this.serviceUnavailable = false
      return {
        preserveView: false,
        turns: [{ provider: 'grok', message: 'Earlier question', reply: 'Earlier model reply', status: 'done' }],
      }
    },
    async send(body) {
      sendCalls += 1
      if (!online) {
        this.blocked = true
        this.errorCode = 'assistant_service_unavailable'
        this.serviceUnavailable = true
        throw Object.assign(new Error('offline'), { code: 'assistant_service_unavailable' })
      }
      this.blocked = false
      this.errorCode = null
      this.serviceUnavailable = false
      this.connection = 'connected'
      return { reply: `Connected reply to ${body.message}` }
    },
  }
  const h = generationHarness(async () => { throw new Error('No generation') }, assistant, { keepRestore: true })
  try {
    h.state.draft.skillId = null
    await settleFlow(4)
    assert.equal(restoreCalls, 1)
    assert.equal(h.toast.hidden, false, 'disconnection shows top-center P11 toast')
    assert.equal(h.toast.dataset.toastTone, 'warning')
    assert.equal(h.toast.dataset.toastKey, 'assistant_service_unavailable')
    assert.equal(h.toast.textContent, 'Local service unavailable Draft kept. No message sent. Restart the service, then reload.')
    assert.equal(h.host.children.length, 0, 'no model-signed chat reply card appended for local service unavailability')

    h.prompt.value = 'Keep this unsent draft safe'
    await h.prompt.dispatchEvent(new Event('input'))
    assert.equal(h.send.disabled, true, 'Send remains blocked while local service is unavailable')
    assert.match(h.send.title, /local service is unavailable\. Draft kept\. No message sent\./)
    assert.equal(h.send.getAttribute('aria-label'), h.send.title)
    assert.equal(h.assistantStatus.hidden, false)
    assert.match(h.assistantStatus.textContent, /local service is unavailable\. Draft kept\. No message sent\./)

    // Dismissing the toast hides the visual banner but never clears the safety block or accessible explanation.
    await h.toastClose.dispatchEvent({ type: 'click' })
    assert.equal(h.toast.hidden, true)
    assert.equal(h.send.disabled, true, 'dismissing toast must not re-enable Send while offline')
    assert.match(h.send.title, /local service is unavailable\. Draft kept\. No message sent\./)
    assert.match(h.assistantStatus.textContent, /local service is unavailable\. Draft kept\. No message sent\./)

    // Switching across all models while still offline must not stack chat cards or re-pop the dismissed toast.
    for (const model of ['codex', 'antigravity', 'astra', 'grok']) {
      await h.selector.dispatchEvent({ type: 'click' })
      const option = h.root.querySelectorAll('[data-assistant-model]').find(item => item.dataset.assistantModel === model)
      await option.dispatchEvent({ type: 'click' })
      await settleFlow(4)
      assert.equal(h.host.children.length, 0, `switching to ${model} while offline appends no chat bubble`)
      assert.equal(h.toast.hidden, true, `switching to ${model} while offline does not stack a duplicate toast`)
      assert.equal(h.prompt.value, 'Keep this unsent draft safe', 'draft is preserved across model switches')
      assert.equal(h.send.disabled, true)
    }

    // Reconnecting restores history, clears the block, and preserves the draft.
    online = true
    await h.newDiscussion.dispatchEvent({ type: 'click' })
    await settleFlow(4)
    assert.equal(h.send.disabled, false, 'Send is enabled again after local service responds')
    assert.equal(h.prompt.value, 'Keep this unsent draft safe')
    assert.equal(h.host.children.length, 2, 'saved user + model turns are rendered')

    // If the service drops right when sending, no model error bubble is added, the draft stays in the input, and a single toast appears.
    online = false
    assistant.blocked = false
    assistant.errorCode = null
    assistant.serviceUnavailable = false
    await h.root.dispatchEvent({ type: 'vnext-draft-change' })
    assert.equal(h.send.disabled, false)
    await h.send.dispatchEvent({ type: 'click' })
    await settleFlow(4)
    assert.equal(sendCalls, 1)
    assert.equal(h.prompt.value, 'Keep this unsent draft safe', 'unsent message restored to composer input')
    assert.equal(h.host.children.length, 2, 'neither an orphaned user turn nor a model error bubble is left in the thread')
    assert.equal(h.toast.hidden, false, 'new disconnection episode displays the toast again')
    assert.equal(h.toast.textContent, 'Local service unavailable Draft kept. No message sent. Restart the service, then reload.')
    assert.equal(h.send.disabled, true)
  } finally { h.restore() }
})

// DIRECT-ACTIONS-20261020/r1 self-check: restored jobs, run ownership, Undo and presentation.
const pngResponse = () => ({ ok: true, status: 200, headers: { get: () => 'application/octet-stream' },
  async arrayBuffer() { return new Uint8Array([1, 2, 3, 4]).buffer } })

test('a job restored into an empty conversation seeds its request once and never previews, selects or refits on its own', async () => {
  const harness = generationHarness(async (url) => {
    const path = String(url)
    if (path === '/api/jobs/job_restored') return jsonResponse(200, { id: 'job_restored', status: 'done', source_url: '/generated/job_restored/source.png', description: 'red knight walking' })
    throw new Error(`unexpected ${path}`)
  }, undefined, { initialJobId: 'job_restored' })
  const previousImage = globalThis.Image
  globalThis.Image = class { set src(_value) { this.naturalWidth = 8; this.naturalHeight = 8; this.onload?.() } }
  let fitted = 0
  harness.session.view.fitAll = () => { fitted += 1 }
  try {
    await settleFlow()
    assert.equal(harness.gen.phase, 'candidate')
    const users = harness.host.children.filter(node => node.className.includes('is-user'))
    assert.equal(users.length, 1, 'the restored request is shown once')
    assert.match(visibleText(users[0]), /red knight walking/)
    assert.equal(harness.transients.some(items => items.length > 0), false, 'no candidate preview is installed')
    assert.equal(harness.session.view.selectedId, null); assert.equal(fitted, 0)
    assert.match(visibleText(harness.host), /Finish processing/)
  } finally { globalThis.Image = previousImage; harness.restore() }
})

test('an unknown Job ID is reported as not found, never as a candidate, and is forgotten so a reload does not restore it', async () => {
  const storage = new Map([['vnext-last-job-id', 'job_gone']])
  const reads = []
  const harness = generationHarness(async (url) => {
    const path = String(url); reads.push(path)
    if (path === '/api/jobs/job_gone') return jsonResponse(200, { status: 'not_found' })
    if (path === '/generated/job_gone/generation.json') return jsonResponse(404, { error: 'not_found' })
    throw new Error(`unexpected ${path}`)
  }, undefined, { initialJobId: 'job_gone', storage })
  try {
    await settleFlow()
    assert.equal(harness.gen.phase, 'idle')
    assert.equal(harness.gen.job, null)
    const text = visibleText(harness.host)
    assert.match(text, /Job not found/)
    assert.match(text, /No job or saved result with this ID is available in the local service/)
    assert.doesNotMatch(text, /Finish processing|Image generated/, 'a missing job is never a processable candidate')
    assert.equal(harness.host.querySelector('[data-gen-action="adopt"]'), null)
    assert.ok(harness.host.querySelector('[data-gen-action="query"]'), 'only Continue query (check another Job ID) is offered')
    assert.equal(harness.host.querySelectorAll('.vnext-workflow-card').at(-1).dataset.figma, '2918:2689')
    assert.equal(storage.has('vnext-last-job-id'), false, 'the remembered missing ID is forgotten')
    assert.ok(reads.every(path => !path.includes('/accept') && !path.includes('/api/generate-character')), 'nothing is generated or accepted')
  } finally { harness.restore() }
  // Files that exist but are not a finishable generated sheet: reported, not a candidate.
  const other = generationHarness(async (url) => {
    const path = String(url)
    if (path === '/api/jobs/job_other') return jsonResponse(200, { status: 'not_found' })
    if (path === '/generated/job_other/generation.json') return jsonResponse(200, { mode: 'legacy' })
    throw new Error(`unexpected ${path}`)
  }, undefined, { initialJobId: 'job_other' })
  try {
    await settleFlow()
    assert.match(visibleText(other.host), /Job cannot be finished/)
    assert.doesNotMatch(visibleText(other.host), /Job not found/, 'files that exist are not reported as a missing job')
    assert.match(visibleText(other.host), /not a generated sheet that can be finished here/)
    assert.equal(other.host.querySelector('[data-gen-action="adopt"]'), null)
    assert.equal(other.host.querySelectorAll('.vnext-workflow-card').at(-1).dataset.figma, '2927:2694')
  } finally { other.restore() }
  // A job started in this browser whose result was never saved: an outcome the service lost, not an unknown ID.
  const mine = new Map([['vnext-last-job-id', 'job_mine'], ['vnext-job-runs', JSON.stringify({ job_mine: {} })]])
  const lost = generationHarness(async (url) => {
    const path = String(url)
    if (path === '/api/jobs/job_mine') return jsonResponse(200, { status: 'not_found' })
    if (path === '/generated/job_mine/generation.json') return jsonResponse(404, { error: 'not_found' })
    throw new Error(`unexpected ${path}`)
  }, undefined, { initialJobId: 'job_mine', storage: mine })
  try {
    await settleFlow()
    const text = visibleText(lost.host)
    assert.match(text, /Sheet not finished/)
    assert.match(text, /its result was not saved, so it cannot be finished/)
    assert.match(text, /may already have been used; nothing is retried/)
    assert.doesNotMatch(text, /Job not found|Nothing was generated or changed|Finish processing/)
    assert.equal(lost.host.querySelectorAll('.vnext-workflow-card').at(-1).dataset.figma, '2927:2712')
    assert.equal(mine.has('vnext-last-job-id'), false, 'a final outcome is not restored again on reload')
  } finally { lost.restore() }
})

test('a Job ID check that cannot complete is reported as not checked, keeps the ID for a retry, and differs from a missing job', async () => {
  for (const failure of ['network', 'artifact_500']) {
    const storage = new Map([['vnext-last-job-id', 'job_later']])
    let answer = 'fail'
    const harness = generationHarness(async (url) => {
      const path = String(url)
      if (path === '/api/jobs/job_later') {
        if (failure === 'network' && answer === 'fail') throw new TypeError('fetch failed')
        return jsonResponse(200, answer === 'fail' ? { status: 'not_found' } : { id: 'job_later', status: 'done', source_url: '/generated/job_later/source.png', human_decision_status: 'pending' })
      }
      if (path === '/generated/job_later/generation.json') return jsonResponse(500, { error: 'internal_error' })
      if (path === '/generated/job_later/prompt.txt') return { ok: false, status: 404, text: async () => '' }
      throw new Error(`unexpected ${path}`)
    }, undefined, { initialJobId: 'job_later', storage })
    try {
      await settleFlow()
      const text = visibleText(harness.host)
      assert.match(text, /Job not checked/, failure)
      assert.match(text, /did not answer the check/)
      assert.doesNotMatch(text, /Job not found|Finish processing/)
      assert.equal(harness.host.querySelectorAll('.vnext-workflow-card').at(-1).dataset.figma, '2918:2708')
      assert.equal(storage.get('vnext-last-job-id'), 'job_later', 'the ID is kept for the retry')
      // The retry with Continue query reaches the job once the service answers.
      answer = 'ok'
      await harness.host.dispatchEvent({ type: 'click', target: actionTarget('query') }); await settleFlow()
      assert.equal(harness.gen.phase, 'candidate', failure)
      assert.match(visibleText(harness.host), /Finish processing/)
    } finally { harness.restore() }
  }
})

test('a valid job the service no longer holds is rebuilt from its saved files, and Finish processing accepts it once by Job ID only', async () => {
  const restoredJob = { id: 'job_saved', status: 'done', human_decision_status: 'pending', artifact_disposition: 'review_required',
    source_url: '/generated/job_saved/source.png', normalized_sheet_url: '/generated/job_saved/normalized_sheet.png' }
  const storage = new Map()
  const harness = generationHarness(async (url) => {
    const path = String(url)
    if (path === '/api/jobs/job_saved') return jsonResponse(200, { status: 'not_found' })
    if (path.endsWith('.png')) return pngResponse()
    if (path.endsWith('prompt.txt')) return { ok: false, status: 404, text: async () => '' }
    throw new Error(`unexpected ${path}`)
  }, undefined, { initialJobId: 'job_saved', storage })
  const accepts = [], restores = [], downloads = []
  let releaseAccept
  harness.api.restoreGenerationJob = async id => { restores.push(id); return { job: restoredJob, review: { reviewed_run_id: 'generation_review_saved' }, description: 'a forest messenger in green' } }
  // The accept route's real response shape (no job id): see the contract test for the request itself.
  harness.api.acceptJob = (...args) => { accepts.push(args); return new Promise(resolve => { releaseAccept = () => resolve({ mode: 'full_sheet_manual_acceptance_v1', status: 'done',
    saved: 'accepted', source_job_id: 'job_saved', publication_id: 'accepted_v1_job_saved', source_url: '/generated/accepted_v1_job_saved/source.png' }) }) }
  const download = harness.api.downloadUrl
  harness.api.downloadUrl = async (url, ...rest) => { downloads.push(url); return download(url, ...rest) }
  harness.api.processSheet = async () => ({ id: 'job_proc_saved', status: 'queued' })
  harness.api.getJob = async id => (id === 'job_saved' ? { status: 'not_found' } : readyJob('job_proc_saved'))
  try {
    await settleFlow()
    assert.deepEqual(restores, ['job_saved'])
    assert.equal(harness.gen.phase, 'candidate')
    const users = harness.host.children.filter(node => node.className.includes('is-user'))
    assert.equal(users.length, 1)
    assert.match(visibleText(users[0]), /a forest messenger in green/, 'the user\'s sealed request is shown, not the composed generation prompt')
    assert.match(visibleText(harness.host), /Finish processing/)
    // The acceptance is held: a second click meanwhile must not start another one.
    const first = harness.host.dispatchEvent({ type: 'click', target: actionTarget('adopt') }); await settleFlow(4)
    const second = harness.host.dispatchEvent({ type: 'click', target: actionTarget('adopt') }); await settleFlow(4)
    assert.deepEqual(accepts, [['job_saved']], 'one acceptance, by Job ID only (the client builds it from the verified artifacts)')
    releaseAccept(); await Promise.all([first, second]); await settleFlow(30)
    assert.equal(accepts.length, 1, 'nothing is accepted or generated again')
    assert.deepEqual(downloads.filter(url => url.endsWith('/source.png')), ['/generated/accepted_v1_job_saved/source.png'], 'the accepted source is processed, not the unaccepted original')
    assert.equal(harness.gen.job?.id, 'job_proc_saved', 'the same sheet is processed')
    assert.deepEqual(JSON.parse(storage.get('vnext-job-runs')).job_proc_saved, { source: 'job_saved' }, 'the processing job remembers the job it finishes')
  } finally { harness.restore() }
})

test('a run whose job the service no longer holds says so and offers the Job ID check instead of a dead candidate', async () => {
  const harness = generationHarness(async (url) => { throw new Error(`unexpected ${url}`) })
  harness.api.reviewCharacter = async () => ({ reviewed_run_id: 'r1' })
  harness.api.startGenerate = async () => ({ id: 'job_lost', status: 'queued' })
  harness.api.getJob = async () => ({ status: 'not_found' })
  try {
    harness.prompt.value = 'Use it for a blue knight'; await harness.prompt.dispatchEvent(new Event('input'))
    await harness.send.dispatchEvent({ type: 'click' }); await settleFlow(30)
    const text = visibleText(harness.host)
    assert.match(text, /no longer holds this job/)
    assert.doesNotMatch(text, /Finish processing|Image generated/)
    assert.ok(harness.host.querySelector('[data-gen-action="query"]'))
    assert.equal(harness.host.querySelectorAll('.vnext-workflow-card').at(-1).dataset.figma, '2918:2727')
  } finally { harness.restore() }
})

test('a processing job the service lost is checked through the generation job it finished; a sheet the project holds is not finished again', async () => {
  const restoredJob = { id: 'job_gen', status: 'done', human_decision_status: 'pending', artifact_disposition: 'review_required',
    source_url: '/generated/job_gen/source.png', normalized_sheet_url: '/generated/job_gen/normalized_sheet.png' }
  const runs = JSON.stringify({ job_gen: {}, job_proc_lost: { source: 'job_gen' }, job_proc_done: { source: 'job_gen' } })
  const routes = async (url) => {
    const path = String(url)
    if (/^\/api\/jobs\/job_(proc_lost|proc_done|gen)$/.test(path)) return jsonResponse(200, { status: 'not_found' })
    if (path.endsWith('prompt.txt')) return { ok: false, status: 404, text: async () => '' }
    throw new Error(`unexpected ${path}`)
  }
  const restoreStub = restores => async id => { restores.push(id)
    return id === 'job_gen' ? { job: restoredJob, review: { reviewed_run_id: 'generation_review_gen' }, description: 'a forest messenger' } : { missing: true } }
  // Not placed yet: the Job ID offered for checking is the generation job, which is rebuilt from its files.
  const storage = new Map([['vnext-last-job-id', 'job_proc_lost'], ['vnext-job-runs', runs]])
  const harness = generationHarness(routes, undefined, { initialJobId: 'job_proc_lost', storage })
  const restores = []
  harness.api.restoreGenerationJob = restoreStub(restores)
  try {
    await settleFlow()
    const text = visibleText(harness.host)
    assert.match(text, /no longer holds this job/)
    assert.doesNotMatch(text, /Job not found|Finish processing/)
    assert.equal(harness.host.querySelectorAll('.vnext-workflow-card').at(-1).dataset.figma, '2918:2727')
    assert.equal(liveJobInput(harness.host).value, 'job_gen')
    assert.equal(storage.get('vnext-last-job-id'), 'job_gen', 'a reload checks the generation job too')
    await clickAction(queryButton(liveJobInput(harness.host))); await settleFlow()
    assert.deepEqual(restores, ['job_proc_lost', 'job_gen'])
    assert.equal(harness.gen.phase, 'candidate')
    assert.match(visibleText(harness.host), /Finish processing/)
  } finally { harness.restore() }
  // Already placed in this project: a plain notice; nothing is finished, accepted or added again.
  const held = new Map([['vnext-last-job-id', 'job_proc_done'], ['vnext-job-runs', runs]])
  const other = generationHarness(routes, undefined, { initialJobId: 'job_proc_done', storage: held })
  const heldRestores = []
  other.api.restoreGenerationJob = restoreStub(heldRestores)
  other.api.acceptJob = async () => { throw new Error('must not accept') }
  other.session.project = { ...other.session.project, assets: { asset_1: { revisions: { rev_1: { source_job_id: 'job_proc_done' } } } } }
  try {
    await settleFlow()
    assert.match(visibleText(other.host), /This sheet is already in this project/)
    const notice = other.host.querySelectorAll('.is-plain').at(-1)
    assert.equal(notice?.dataset.figma, '2927:2746', 'a plain notice, not a warning card')
    assert.equal(notice.className.includes('is-warning'), false)
    assert.equal(liveJobInput(other.host), null, 'no Job ID form: there is nothing to check')
    assert.equal(other.host.querySelector('[data-gen-action="adopt"]'), null)
    assert.deepEqual(heldRestores, ['job_proc_done'], 'the generation job is not offered again')
    assert.equal(held.has('vnext-last-job-id'), false)
  } finally { other.restore() }
})

test('a lost processing job checked before its project is shown waits for the project, then reads already in this project instead of offering its generation job', async () => {
  const runs = JSON.stringify({ job_proc_done: { source: 'job_gen' } })
  const storage = new Map([['vnext-last-job-id', 'job_proc_done'], ['vnext-job-runs', runs]])
  const harness = generationHarness(async (url) => {
    const path = String(url)
    if (/^\/api\/jobs\/job_(proc_done|gen)$/.test(path)) return jsonResponse(200, { status: 'not_found' })
    if (path.endsWith('prompt.txt')) return { ok: false, status: 404, text: async () => '' }
    throw new Error(`unexpected ${path}`)
  }, undefined, { initialJobId: 'job_proc_done', storage, project: null })
  const restores = []
  harness.api.restoreGenerationJob = async id => { restores.push(id)
    return id === 'job_gen' ? { job: { id: 'job_gen', status: 'done', human_decision_status: 'pending', source_url: '/generated/job_gen/source.png' }, review: { reviewed_run_id: 'generation_review_gen' }, description: 'x' } : { missing: true } }
  harness.api.acceptJob = async () => { throw new Error('must not accept') }
  try {
    await settleFlow()
    // No project is shown yet: nothing is concluded and nothing is redirected to the generation job.
    assert.deepEqual(restores, ['job_proc_done'])
    assert.doesNotMatch(visibleText(harness.host), /no longer holds this job|Finish processing|Job not found|result was not saved/)
    assert.equal(storage.get('vnext-last-job-id'), 'job_proc_done', 'the Job ID is kept for the check after the project is shown')
    // The project opens and holds the sheet: the check runs again and reads already in this project.
    harness.session.project = { id: 'proj', revision: 3, name: 'Hero', assets: { asset_1: { revisions: { rev_1: { source_job_id: 'job_proc_done' } } } } }
    harness.session.onProjectBound()
    await settleFlow()
    assert.match(visibleText(harness.host), /This sheet is already in this project/)
    assert.equal(harness.host.querySelectorAll('.is-plain').at(-1)?.dataset.figma, '2927:2746')
    assert.equal(harness.host.querySelector('[data-gen-action="adopt"]'), null, 'its generation job is never offered for finishing again')
    assert.ok(!restores.includes('job_gen'))
    assert.equal(storage.has('vnext-last-job-id'), false)
  } finally { harness.restore() }
})

test('a lost processing job entered by hand while no project is open says to open one, keeps its Job ID, and is checked once a project is shown', async () => {
  const storage = new Map([['vnext-job-runs', JSON.stringify({ job_proc_done: { source: 'job_gen' } })]])
  const harness = generationHarness(async (url) => {
    const path = String(url)
    if (/^\/api\/jobs\/job_(proc_done|gen|typed)$/.test(path)) return jsonResponse(200, { status: 'not_found' })
    if (path === '/generated/job_typed/generation.json') return jsonResponse(404, { error: 'not_found' })
    if (path.endsWith('prompt.txt')) return { ok: false, status: 404, text: async () => '' }
    throw new Error(`unexpected ${path}`)
  }, undefined, { initialJobId: 'job_typed', storage, project: null })
  const restores = []
  const restore = harness.api.restoreGenerationJob
  harness.api.restoreGenerationJob = async id => { restores.push(id); return id === 'job_typed' ? restore(id) : { missing: true } }
  try {
    await settleFlow()
    assert.match(visibleText(harness.host), /Job not found/, 'the page was opened with an unknown Job ID')
    // The user enters the lost processing job and checks it while no project is open.
    liveJobInput(harness.host).value = 'job_proc_done'
    await clickAction(queryButton(liveJobInput(harness.host))); await settleFlow()
    const text = visibleText(harness.host)
    assert.match(text, /Open a project first/)
    assert.doesNotMatch(text, /Preparing the sheet|Stop waiting|no longer holds this job \(it may/, 'not left busy, and not redirected to its generation job')
    assert.equal(harness.host.querySelectorAll('.vnext-workflow-card').at(-1).dataset.figma, '2931:2700')
    assert.equal(liveJobInput(harness.host).value, 'job_proc_done', 'the Job ID is kept')
    assert.equal(harness.host.querySelector('[data-gen-action="stop"]'), null)
    // A project holding its sheet opens: the Job ID entered (not the one the page was opened with) is checked.
    harness.session.project = { id: 'proj', revision: 3, name: 'Hero', assets: { asset_1: { revisions: { rev_1: { source_job_id: 'job_proc_done' } } } } }
    harness.session.onProjectBound()
    await settleFlow()
    assert.match(visibleText(harness.host), /This sheet is already in this project/)
    assert.deepEqual(restores.filter(id => id !== 'job_typed'), ['job_proc_done', 'job_proc_done'])
    assert.ok(!restores.includes('job_gen'), 'its generation job is never offered')
  } finally { harness.restore() }
})

test('a recovery card keeps its Job ID across a project switch, so Continue query checks that job', async () => {
  let answer = 'fail'
  const harness = generationHarness(async (url) => {
    const path = String(url)
    if (path === '/api/jobs/job_later') {
      if (answer === 'fail') throw new TypeError('fetch failed')
      return jsonResponse(200, { id: 'job_later', status: 'done', source_url: '/generated/job_later/source.png', human_decision_status: 'pending' })
    }
    if (path === '/generated/job_later/prompt.txt') return { ok: false, status: 404, text: async () => '' }
    throw new Error(`unexpected ${path}`)
  }, undefined, { initialJobId: 'job_later' })
  try {
    await settleFlow()
    assert.match(visibleText(harness.host), /Job not checked/)
    harness.session.project = { id: 'other', revision: 1, name: 'Other' }; harness.session.onProjectBound()
    harness.session.project = { id: 'proj', revision: 3, name: 'Hero' }; harness.session.onProjectBound()
    await settleFlow()
    assert.match(visibleText(harness.host), /Job not checked/)
    assert.equal(liveJobInput(harness.host).value, 'job_later', 'the card still holds the Job ID it offers to check')
    answer = 'ok'
    await clickAction(queryButton(liveJobInput(harness.host))); await settleFlow()
    assert.equal(harness.gen.phase, 'candidate')
    assert.doesNotMatch(visibleText(harness.host), new RegExp(VNEXT_GENERATION_COPY.missingJobId))
  } finally { harness.restore() }
})

test('a saved-file check still pending when the project changes reports nothing and forgets nothing there', async () => {
  const storage = new Map([['vnext-last-job-id', 'job_slow']])
  let releaseRestore = null
  const harness = generationHarness(async (url) => {
    const path = String(url)
    if (path === '/api/jobs/job_slow') return jsonResponse(200, { status: 'not_found' })
    throw new Error(`unexpected ${path}`)
  }, undefined, { initialJobId: 'job_slow', storage })
  harness.api.restoreGenerationJob = () => new Promise(resolve => { releaseRestore = resolve })
  try {
    await settleFlow()
    assert.ok(releaseRestore, 'the saved-file check is pending')
    harness.session.project = { id: 'other', revision: 1, name: 'Other' }; harness.session.onProjectBound()
    releaseRestore({ missing: true }); await settleFlow()
    assert.doesNotMatch(visibleText(harness.host), /Job not found|Finish processing/)
    assert.notEqual(harness.gen.error, VNEXT_GENERATION_COPY.jobNotFoundBody)
    assert.equal(storage.get('vnext-last-job-id'), 'job_slow', 'a superseded check forgets nothing')
  } finally { harness.restore() }
})

test('a saved-file check whose read is cut off mid-transfer is a lookup failure, not an unfinishable job', async () => {
  let generationReads = 0
  const cut = { ok: true, status: 200, headers: { get: () => null },
    body: { getReader: () => ({ read: async () => { throw new TypeError('terminated') }, cancel: async () => {} }) } }
  const client = createVnextGenerationClient({ fetchImpl: async (url) => {
    if (String(url) === '/generated/job_cut/generation.json' && generationReads++ === 0) {
      return jsonResponse(200, { generation_review: { reviewed_run_id: 'generation_review_cut' } })
    }
    return cut
  } })
  await assert.rejects(client.restoreGenerationJob('job_cut'), error => error instanceof TypeError && !error.code)
})

test('a restored sheet the project already holds is not offered for adding again', async () => {
  const posts = []
  const harness = generationHarness(async (url) => { if (String(url).endsWith('.png')) return pngResponse(); throw new Error(`unexpected ${url}`) })
  harness.session.api.createFromJob = async (...args) => { posts.push(args); return { project: harness.session.project } }
  try {
    harness.session.project = { ...harness.session.project, assets: { asset_1: { revisions: { rev_1: { source_job_id: 'job_sheet' } } } } }
    harness.gen.phase = 'ready'
    harness.gen.job = readyJob('job_sheet')
    harness.session.onProjectBound()
    assert.match(visibleText(harness.host), /Already in this project; it was not added again/)
    assert.equal(harness.host.querySelector('[data-gen-action="add-canvas"]'), null)
    assert.equal(harness.host.querySelectorAll('.vnext-workflow-card').at(-1)?.dataset.figma, '2916:2688', 'already in this project maps to its own Figma Current state')
    await harness.host.dispatchEvent({ type: 'click', target: actionTarget('add-canvas') }); await settleFlow()
    assert.equal(posts.length, 0)
  } finally { harness.restore() }
})

test('Canvas & timeline applies its result while a finished sheet turn is still open elsewhere in the thread', async () => {
  const h = documentFlowHarness()
  try {
    h.gen.phase = 'ready'
    h.gen.job = readyJob('job_sheet')
    h.session.onProjectBound()
    assert.ok(h.host.children.some(node => node.className.includes('is-preset-run')))
    const card = await h.start(); await settleFlow()
    assert.match(visibleText(card), /Canvas & timeline updated/)
    assert.deepEqual(h.calls.filter(c => c.action).map(c => c.action), ['read', 'accept'])
  } finally { h.restore() }
})

test('Finish processing is a run of its own: after Stop, its late step never places a job queried meanwhile', async () => {
  let releaseAccept, entered
  const gate = new Promise(resolve => { releaseAccept = resolve })
  const accepting = new Promise(resolve => { entered = resolve })
  const posts = []
  const harness = generationHarness(async (url) => {
    const path = String(url)
    if (path === '/api/jobs/job_ready') return jsonResponse(200, readyJob('job_ready'))
    if (path.endsWith('.png')) return pngResponse()
    throw new Error(`unexpected ${path}`)
  })
  harness.session.api.createFromJob = async (...args) => { posts.push(args); return { project: harness.session.project } }
  // The acceptance is held (its artifact-verified request is the client's; see the contract test).
  harness.api.acceptJob = async () => { entered(); await gate; return { status: 'done', saved: 'accepted', source_job_id: 'job_a', publication_id: 'accepted_v1_job_a', source_url: '/generated/accepted_v1_job_a/source.png' } }
  try {
    harness.gen.phase = 'candidate'
    harness.gen.job = { id: 'job_a', status: 'done', source_url: '/generated/job_a/source.png' }
    harness.session.onProjectBound()
    const adopting = harness.host.dispatchEvent({ type: 'click', target: actionTarget('adopt') })
    await accepting
    assert.ok(harness.gen.autoRun, 'finishing processing is a run')
    await harness.host.dispatchEvent({ type: 'click', target: actionTarget('stop') })
    assert.equal(harness.gen.autoRun, null)
    const live = liveJobInput(harness.host); live.value = 'job_ready'
    await clickAction(queryButton(live))
    assert.equal(harness.gen.phase, 'ready')
    releaseAccept(); await adopting; await settleFlow()
    assert.equal(posts.length, 0, 'nothing is placed without its own run or an Add to canvas click')
    assert.match(visibleText(harness.host), /Ready to add to the canvas/)
  } finally { harness.restore() }
})

test('a run released by a project switch is never continued: its job is only read again, or a pre-job step reports Stop', async () => {
  for (const parked of ['running', 'review']) {
    const reads = []
    const harness = generationHarness(async (url) => {
      const path = String(url)
      reads.push(path)
      if (path === '/api/jobs/job_run') return jsonResponse(200, { id: 'job_run', status: 'done', source_url: '/generated/job_run/source.png' })
      throw new Error(`unexpected ${path}`)
    })
    try {
      harness.gen.phase = parked
      harness.gen.waiting = true
      if (parked === 'running') { harness.gen.job = { id: 'job_run', status: 'generating' }; harness.gen.runJobId = 'job_run' }
      harness.session.project = { id: 'other', revision: 1, name: 'Other' }; harness.session.onProjectBound()
      harness.session.project = { id: 'proj', revision: 3, name: 'Hero' }; harness.session.onProjectBound()
      await settleFlow()
      assert.equal(harness.gen.waiting, false, `${parked}: nothing keeps waiting`)
      if (parked === 'running') {
        assert.deepEqual(reads, ['/api/jobs/job_run'], 'only a status read, no provider call')
        assert.equal(harness.gen.phase, 'candidate')
        assert.match(visibleText(harness.host), /Finish processing/)
      } else {
        assert.deepEqual(reads, [])
        assert.equal(harness.gen.phase, 'idle'); assert.equal(harness.gen.error, VNEXT_GENERATION_COPY.stoppedBeforeCall)
      }
      assert.doesNotMatch(visibleText(harness.host), /Generating the sheet/)
    } finally { harness.restore() }
  }
})

test('re-rendering an earlier recovery turn keeps it frozen after a later message', async () => {
  const assistant = { provider: 'grok', busy: false, blocked: false, bind() {}, stop() {}, async send() { return { reply: 'Noted.' } } }
  const harness = generationHarness(async () => { throw new Error('no network') }, assistant)
  try {
    harness.gen.phase = 'idle'; harness.gen.error = VNEXT_GENERATION_COPY.recoveryBody; harness.gen.jobIdDraft = 'job_x'
    harness.session.onProjectBound()
    const recovery = harness.host.children.find(node => node.className.includes('is-preset-run'))
    assert.equal(recovery.querySelector('[data-gen-action="query"]').disabled, false)
    harness.state.draft.skillId = null
    harness.prompt.value = 'hello'; await harness.prompt.dispatchEvent(new Event('input'))
    await harness.send.dispatchEvent({ type: 'click', preventDefault() {}, stopPropagation() {} }); await settleFlow()
    assert.match(visibleText(harness.host), /Noted\./)
    harness.session.onProjectBound() // a same-project bundle apply re-renders the preset turn
    assert.equal(recovery.querySelector('[data-gen-action="query"]').disabled, true, 'the old recovery stays frozen')
    assert.equal(recovery.querySelector('#vnext-job-id'), null, 'its Job ID field no longer competes with the live one')
  } finally { harness.restore() }
})

test('a preset error before any job is a plain notice; Generate again and the Job ID form appear only when they apply', () => {
  const previousDocument = globalThis.document
  globalThis.document = { createElement: tag => genNode(tag) }
  try {
    const plain = generationViewModel({ phase: 'idle', projectId: 'p', lastRequest: { projectId: 'p' },
      error: 'Attach a reference image before using this preset with a reference. Nothing was generated.' })
    assert.equal(plain.fields, undefined); assert.equal(plain.tone, 'warning')
    assert.match(plain.title, /Attach a reference image/)
    assert.deepEqual(plain.actions.map(a => a.action), ['review'])
    const otherProject = generationViewModel({ phase: 'idle', projectId: 'p', lastRequest: { projectId: 'q' }, error: 'Describe the character first.' })
    assert.deepEqual(otherProject.actions, [], 'Generate again repeats only a request remembered for this project')
    const followUpStop = generationViewModel({ phase: 'idle', projectId: 'p', lastRequest: { projectId: 'p' }, job: { id: 'job_previous', status: 'done' },
      jobIdDraft: 'job_previous', runJobId: null, error: VNEXT_GENERATION_COPY.stoppedBeforeCall })
    assert.equal(followUpStop.fields, undefined, 'a Stop during a follow-up plan check does not offer the previous job')
    assert.equal(followUpStop.title, VNEXT_GENERATION_COPY.stoppedBeforeCall)
    const followUpError = generationViewModel({ phase: 'idle', projectId: 'p', job: { id: 'job_previous', status: 'done' }, jobIdDraft: 'job_previous', runJobId: null,
      error: 'Attach a reference image before using this preset with a reference. Nothing was generated.' })
    assert.equal(followUpError.fields, undefined, 'a follow-up error before its own job does not offer the previous job')
    const followUpCheck = generationViewModel({ phase: 'running', job: { id: 'job_previous', status: 'done' }, runJobId: null })
    assert.equal(followUpCheck.title, VNEXT_GENERATION_COPY.reviewTitle, 'a follow-up plan check is not shown as generating the previous job')
    assert.equal(followUpCheck.progress, undefined)
    const started = generationViewModel({ phase: 'running', job: { id: 'job_new', status: 'generating' }, runJobId: 'job_new' })
    assert.equal(started.title, VNEXT_GENERATION_COPY.runningTitle)
    const reload = generationViewModel({ phase: 'idle', projectId: 'p', jobIdDraft: 'job_a', error: VNEXT_GENERATION_COPY.recoveryBody })
    assert.equal(reload.fields.length, 1)
    assert.deepEqual(reload.actions.map(a => a.action), ['query'], 'no remembered request after a reload: no Generate again')
  } finally { globalThis.document = previousDocument }
})

test('Undo stays offered through a transient save, is disabled while it runs, and reverts only while still the latest change', async () => {
  const h = documentFlowHarness()
  try {
    let undoEntry = null, busy = true, release
    h.session.latestUndoEntry = () => undoEntry
    h.session.undoIfLatest = async entry => {
      if (busy) return false
      await new Promise(resolve => { release = resolve })
      if (entry !== undoEntry) return false
      undoEntry = null
      return true
    }
    const save = h.session.saveDocumentCandidate
    h.session.saveDocumentCandidate = async (...args) => { const result = await save(...args); undoEntry = { kind: 'pixels', documentId: 'doc' }; return result }
    const card = await h.start(); await settleFlow()
    assert.equal(h.runStatus.textContent, 'Canvas & timeline updated')
    await card.querySelector('[data-gen-action="astra-flow:undo"]').dispatchEvent({ type: 'click' }); await settleFlow()
    assert.match(visibleText(card), /Undo could not run while another change was saving; try again/)
    const undo = card.querySelector('[data-gen-action="astra-flow:undo"]')
    assert.ok(undo, 'Undo is still offered'); assert.equal(undo.disabled, false)
    busy = false
    const undoing = undo.dispatchEvent({ type: 'click' }); await settleFlow(2)
    assert.equal(undo.disabled, true, 'Undo cannot be clicked twice while it runs')
    release(); await undoing; await settleFlow()
    assert.match(visibleText(card), /Undone/)
    assert.equal(h.runStatus.textContent, 'Undone')
  } finally { h.restore() }
})

test('conversation notes never show raw codes and name models by their picker label', async () => {
  const assistant = { provider: 'codex', busy: false, blocked: false, bind() {}, stop() {} }
  mockComposer(assistant, { type: 'generate_image', reference: false, background: 'green' })
  const harness = generationHarness(async (url) => {
    if (String(url).includes('/image-generation')) return jsonResponse(500, { error: 'image_native_failed' })
    throw new Error(`unexpected ${url}`)
  }, assistant)
  try {
    harness.state.draft.skillId = null
    harness.prompt.value = 'a lantern'; await harness.prompt.dispatchEvent(new Event('input'))
    await harness.send.dispatchEvent({ type: 'click', preventDefault() {}, stopPropagation() {} }); await settleFlow()
    const text = visibleText(harness.host)
    assert.match(text, /Image generation could not be checked\. Nothing was sent\./)
    assert.doesNotMatch(text, /image_native_failed/)
    assert.equal(harness.host.children.at(-1).dataset.author, 'GPT 6.1')
  } finally { harness.restore() }
})

test('an unavailable preset is reported in plain language and nothing runs', async () => {
  const assistant = { provider: 'grok', busy: false, blocked: false, bind() {}, stop() {},
    async send() { return { reply: 'I will make the sheet.', composer_notice: 'preset_unavailable' } } }
  const harness = generationHarness(async () => { throw new Error('nothing is generated') }, assistant)
  try {
    harness.prompt.value = 'make a knight sheet'; await harness.prompt.dispatchEvent(new Event('input'))
    await harness.send.dispatchEvent({ type: 'click', preventDefault() {}, stopPropagation() {} }); await settleFlow()
    const text = visibleText(harness.host)
    assert.match(text, /Fixed-region motion is not ready: this server has no Gemini 2K square image preset\. Nothing was generated\./)
    assert.doesNotMatch(text, /GEMINI_API_KEY/)
    assert.equal(harness.gen.phase, 'idle'); assert.equal(harness.gen.autoRun, null)
  } finally { harness.restore() }
})

test('a rebuilt discussion regroups authors, so a kept image note never loses its author label', async () => {
  const assistant = { provider: 'grok', busy: false, blocked: false, bind() {}, stop() {}, select(value) { this.provider = value; return true },
    restore: async () => ({ preserveView: false, turns: [{ provider: 'grok', message: 'hello', reply: 'Hello there.', status: 'done' }] }) }
  const h = generationHarness(async () => { throw Error('no requests') }, assistant, { keepRestore: true })
  try {
    h.api.listStaticImages = async () => {
      await settleFlow(2) // the saved image job is listed after the discussion is shown
      return { jobs: [{ id: 'saved-job', provider: 'grok', status: 'failed', imported: false }] }
    }
    h.session.project = { id: 'proj-regroup', revision: 1 }
    h.session.onProjectBound(); await settleFlow()
    const note = h.host.children.find(node => node.dataset.recoveredImage === 'saved-job')
    assert.ok(note.className.includes('is-continued'), 'grouped under the earlier Grok reply')
    await h.selector.dispatchEvent({ type: 'click' })
    await h.root.querySelectorAll('[data-assistant-model]')[1].dispatchEvent({ type: 'click' }); await settleFlow()
    assert.equal(h.host.children[0], note, 'the kept note now opens the thread')
    assert.equal(note.className.includes('is-continued'), false, 'its author label is shown again')
    assert.match(visibleText(h.host), /Hello there\./)
  } finally { h.restore() }
})

test('post-return documentCandidate read disconnect keeps the completed turn and newer draft, never reports No message sent, and retries the same candidate without resending', async () => {
  const h = documentFlowHarness()
  try {
    let failRead = true
    let totalSends = 0
    let documentSends = 0
    const baseSend = h.assistant.send.bind(h.assistant)
    h.assistant.send = async (body) => {
      totalSends += 1
      if (body?.documentMode) documentSends += 1
      return baseSend(body)
    }
    const baseCandidate = h.assistant.documentCandidate.bind(h.assistant)
    h.assistant.documentCandidate = async (req, owner) => {
      if (req.action === 'read' && failRead) {
        h.calls.push(req)
        h.assistant.serviceUnavailable = true
        h.assistant.blocked = true
        h.assistant.errorCode = 'assistant_service_unavailable'
        throw Object.assign(new Error('offline during candidate read'), { code: 'assistant_service_unavailable' })
      }
      h.assistant.serviceUnavailable = false
      h.assistant.blocked = false
      h.assistant.errorCode = null
      return baseCandidate(req, owner)
    }

    const card = await h.start('Add a second frame')
    await settleFlow(4)

    // 1) Model already returned: user + run turn stay; internal router commentary stays hidden.
    assert.equal(documentSends, 1)
    assert.equal(totalSends, 2)
    assert.equal(h.host.children.length, 2, 'user turn and Astra run turn are preserved without internal commentary')
    assert.equal(h.toast.hidden, false)
    assert.equal(h.toast.dataset.toastTone, 'warning')
    assert.match(h.toast.textContent, /Local service unavailable Reply completed, but the result could not be read yet and was not applied\./)
    assert.doesNotMatch(h.toast.textContent, /No message sent/, 'never misreports a completed model call as No message sent')
    assert.doesNotMatch(h.send.title, /No message sent/)
    assert.doesNotMatch(h.assistantStatus.textContent, /No message sent/)
    assert.match(visibleText(card), /Result could not be read yet/)

    // 2) Typing a new draft while recovering must not be overwritten.
    h.prompt.value = 'My follow-up draft'
    await h.prompt.dispatchEvent(new Event('input'))

    // 3) Retrying the same result after service returns reads and applies the exact same candidate/operationId without calling assistant.send again.
    failRead = false
    const retryBtn = card.querySelector('[data-gen-action="astra-flow:recover"]')
    assert.ok(retryBtn)
    assert.equal(retryBtn.textContent, 'Retry same result')
    await retryBtn.dispatchEvent({ type: 'click' })
    await settleFlow(4)

    assert.equal(documentSends, 1, 'no second document model call is made on recovery')
    assert.equal(totalSends, 2, 'no second assistant.send call of any kind is made on recovery')
    assert.equal(h.prompt.value, 'My follow-up draft', 'newer composer draft is preserved untouched')
    assert.match(visibleText(card), /Canvas & timeline updated/)
    const candidateActions = h.calls.filter(c => c.action)
    assert.deepEqual(candidateActions.map(c => c.action), ['read', 'read', 'accept'])
    assert.equal(candidateActions[0].candidate_id, candidateActions[1].candidate_id)
    assert.equal(candidateActions[0].operation_id, candidateActions[1].operation_id)
    assert.equal(candidateActions[1].operation_id, candidateActions[2].operation_id)
  } finally {
    h.restore()
  }
})

test('typing a draft while a reconnect restore is in flight still clears the offline lock and does not get stuck behind cached restore state', async () => {
  let online = false
  let releaseRestore = null
  const client = createVnextAssistantClient({
    fetchImpl: async (url) => {
      if (!online) throw new Error('offline')
      if (releaseRestore) await new Promise(resolve => { releaseRestore = resolve })
      const provider = new URL(url, 'http://local').searchParams.get('provider') || 'grok'
      const model = { grok: 'grok-4.7', codex: 'gpt-6.1-sol', astra: 'gpt-6-astra', antigravity: 'gemini-3.8-flash-low' }[provider]
      return {
        ok: true,
        status: 200,
        json: async () => ({
          conversation: `${provider}-conv`,
          discussion: 'shared-disc',
          provider,
          model,
          blocked: false,
          turns: [{ provider: 'grok', message: 'Saved prompt', reply: 'Saved answer', status: 'done' }],
        }),
      }
    },
  })
  const h = generationHarness(async () => { throw new Error('no generation') }, client, { keepRestore: true })
  try {
    h.state.draft.skillId = null
    await settleFlow(4)
    assert.equal(h.toast.hidden, false)
    assert.equal(h.send.disabled, true)

    // Reconnect starts while the user edits the composer draft before the response arrives.
    online = true
    releaseRestore = true
    await h.selector.dispatchEvent({ type: 'click' })
    const codexItem = h.root.querySelectorAll('[data-assistant-model]').find(item => item.dataset.assistantModel === 'codex')
    await codexItem.dispatchEvent({ type: 'click' })
    await settleFlow(2)

    h.prompt.value = 'Typed during reconnect'
    await h.prompt.dispatchEvent(new Event('input'))
    assert.equal(typeof releaseRestore, 'function')
    const finish = releaseRestore
    releaseRestore = null
    finish()
    await settleFlow(4)

    assert.equal(client.serviceUnavailable, false)
    assert.equal(h.toast.hidden, true, 'reconnect clears the offline toast')
    assert.equal(h.prompt.value, 'Typed during reconnect', 'draft typed during reconnect is preserved')
    assert.equal(h.send.disabled, false, 'Send is unlocked even though draft changed during restore')
    assert.equal(h.host.children.length, 2, 'restored thread history is shown')
  } finally {
    h.restore()
  }
})

test('Retry same result serializes recovery before the first await, disables duplicate clicks, and rejects late failures or invalidated targets', async () => {
  let readAttempt = 0
  let saveCalls = 0
  let undoEntry = null
  const heldReads = []
  const h = documentFlowHarness({
    read: () => {
      readAttempt += 1
      if (readAttempt === 1) {
        return Promise.reject(Object.assign(new Error('offline'), { code: 'assistant_service_unavailable' }))
      }
      return new Promise((resolve, reject) => {
        heldReads.push({ resolve, reject })
      })
    },
  })
  try {
    let undone = null
    h.session.latestUndoEntry = () => undoEntry
    h.session.undoIfLatest = async entry => { undone = entry; return true }
    const baseSave = h.session.saveDocumentCandidate
    h.session.saveDocumentCandidate = async (...args) => {
      saveCalls += 1
      const result = await baseSave(...args)
      undoEntry = { kind: 'pixels', documentId: 'doc', revision: 2 }
      return result
    }

    const card = await h.start()
    await settleFlow(4)
    assert.equal(readAttempt, 1)
    assert.match(visibleText(card), /Result could not be read yet/)

    const retryBtn = card.querySelector('[data-gen-action="astra-flow:recover"]')
    assert.ok(retryBtn)
    assert.equal(retryBtn.disabled, false)

    // 1) Double-clicking Retry same result while the read is held issues only ONE read and shows busy/disabled state immediately.
    const staleActionHandler = card.handleAstraFlowAction
    await retryBtn.dispatchEvent({ type: 'click' })
    const busyRetryBtn = card.querySelector('[data-gen-action="astra-flow:recover"]')
    assert.ok(busyRetryBtn, 'Retry button remains rendered in disabled state while reading')
    assert.equal(busyRetryBtn.disabled, true, 'Retry button is immediately disabled before the first await resolves')
    assert.match(visibleText(card), /Reading canvas & timeline changes…/)
    await busyRetryBtn.dispatchEvent({ type: 'click' })
    staleActionHandler?.('recover')
    card.handleAstraFlowAction?.('recover')
    assert.equal(heldReads.length, 1, 'consecutive clicks only issue 1 read request')
    assert.equal(readAttempt, 2)

    // 2) If that retry read fails, Retry same result becomes clickable again; a second retry that succeeds cannot be overwritten by any late failure.
    heldReads[0].reject(Object.assign(new Error('still offline'), { code: 'assistant_service_unavailable' }))
    await settleFlow(4)
    assert.match(visibleText(card), /Result could not be read yet/)
    const retryBtn2 = card.querySelector('[data-gen-action="astra-flow:recover"]')
    assert.equal(retryBtn2.disabled, false)

    await retryBtn2.dispatchEvent({ type: 'click' })
    assert.equal(heldReads.length, 2)
    heldReads[1].resolve({ ...h.candidate, saved: false })
    await settleFlow(6)
    assert.match(visibleText(card), /Canvas & timeline updated/)
    assert.equal(saveCalls, 1, 'exactly one save lifecycle completed')
    const undoBtn = card.querySelector('[data-gen-action="astra-flow:undo"]')
    assert.ok(undoBtn, 'one Undo action is offered for the applied result')
    assert.equal(h.calls.filter(c => c.send).length, 1, 'zero additional model calls')
    const candidateActions = h.calls.filter(c => c.action)
    assert.deepEqual(candidateActions.map(c => c.action), ['read', 'read', 'read', 'accept'])
    assert.ok(candidateActions.every(c => c.candidate_id === 'candidate-local' && c.operation_id === 'save-operation'))

    // Even if a late handler is invoked after success, Canvas & timeline updated stays intact and Undo works.
    staleActionHandler?.('recover')
    card.handleAstraFlowAction?.('recover')
    await settleFlow(2)
    assert.equal(heldReads.length, 2, 'no read issued after settled success')
    assert.match(visibleText(card), /Canvas & timeline updated/)
    await undoBtn.dispatchEvent({ type: 'click' })
    await settleFlow(2)
    assert.equal(undone, undoEntry, 'Undo reverts the single applied result')
    assert.match(visibleText(card), /Undone/)
  } finally {
    h.restore()
  }
})

test('Retry same result transitions to Not applied when the canvas or project is invalidated during a held retry read', async () => {
  for (const invalidation of ['canvas_deselected', 'project_switched']) {
    let readAttempt = 0
    let saveCalls = 0
    const heldReads = []
    let selected = true
    const h = documentFlowHarness({
      read: () => {
        readAttempt += 1
        if (readAttempt === 1) {
          return Promise.reject(Object.assign(new Error('offline'), { code: 'assistant_service_unavailable' }))
        }
        return new Promise((resolve, reject) => {
          heldReads.push({ resolve, reject })
        })
      },
    })
    try {
      h.session.prepareDocumentEdit = async () => ({
        projectId: 'proj',
        projectRevision: 3,
        sourceCanvasId: 'canvas',
        sourceDocumentId: 'doc',
        sourceRevision: 1,
        width: 64,
        height: 64,
        isSelected: () => selected,
      })
      const baseSave = h.session.saveDocumentCandidate
      h.session.saveDocumentCandidate = async (...args) => {
        saveCalls += 1
        return baseSave(...args)
      }

      const card = await h.start()
      await settleFlow(4)
      assert.match(visibleText(card), /Result could not be read yet/)

      const retryBtn = card.querySelector('[data-gen-action="astra-flow:recover"]')
      await retryBtn.dispatchEvent({ type: 'click' })
      assert.equal(heldReads.length, 1)

      if (invalidation === 'canvas_deselected') {
        selected = false
        heldReads[0].resolve({ ...h.candidate, saved: false })
        await settleFlow(4)
        assert.match(visibleText(card), /Not applied/)
        assert.equal(saveCalls, 0, 'invalidated canvas target is never saved')
        assert.equal(card.querySelector('[data-gen-action="astra-flow:recover"]'), null, 'recovery button is removed after invalidation')
      } else {
        h.session.project = { id: 'proj-other', revision: 1 }
        h.session.onProjectBound()
        await settleFlow(2)
        heldReads[0].reject(Object.assign(new Error('late offline from old project'), { code: 'assistant_service_unavailable' }))
        await settleFlow(4)
        assert.equal(saveCalls, 0, 'switched project never saves old candidate')
        assert.equal(h.toast.hidden, true, 'late failure from old project retry does not show toast in new project')
      }
    } finally {
      h.restore()
    }
  }
})

test('N4 Canvas & timeline binds editable_frame_ids and reference_ids in prepareDocument, send, and accept, and reports scoped progress and summary', async () => {
  const preparedPayloads = []
  const h = documentFlowHarness()
  try {
    h.candidate.editable_frame_ids = ['f2']
    h.candidate.locked_frame_ids = ['f1']
    h.candidate.used_reference_ids = ['ref_0001']
    let undoEntry = null, undone = null
    h.session.latestUndoEntry = () => undoEntry
    h.session.undoIfLatest = async entry => { undone = entry; return true }
    h.session.prepareDocumentEdit = async () => ({
      projectId: 'proj',
      projectRevision: 3,
      sourceCanvasId: 'canvas',
      sourceDocumentId: 'doc',
      sourceRevision: 1,
      width: 64,
      height: 64,
      editableFrameIds: ['f2'],
      lockedFrameIds: ['f1'],
      referenceIds: ['ref_0001'],
      isSelected: () => true,
    })
    h.assistant.prepareDocument = async payload => {
      preparedPayloads.push(payload)
      return {
        grant_id: 'docgrant-scoped',
        frames: 2,
        layers: 2,
        editable_frame_ids: ['f2'],
        locked_frame_ids: ['f1'],
        reference_ids: ['ref_0001'],
      }
    }
    const baseSave = h.session.saveDocumentCandidate
    h.session.saveDocumentCandidate = async (...args) => {
      const res = await baseSave(...args)
      undoEntry = { kind: 'pixels', documentId: 'doc', revision: 2 }
      return res
    }

    const card = await h.start()
    await settleFlow()

    assert.equal(preparedPayloads.length, 1)
    assert.deepEqual(preparedPayloads[0], {
      canvas_id: 'canvas',
      expected_revision: 3,
      expected_working_revision: 1,
      editable_frame_ids: ['f2'],
      reference_ids: ['ref_0001'],
    })

    const sendCall = h.calls.find(c => c.send)?.send
    assert.ok(sendCall)
    assert.equal(sendCall.documentMode, true)
    assert.equal(sendCall.documentGrant, 'docgrant-scoped')
    assert.deepEqual(sendCall.editableFrameIds, ['f2'])
    assert.deepEqual(sendCall.referenceIds, ['ref_0001'])

    const acceptCall = h.calls.find(c => c.action === 'accept')
    assert.ok(acceptCall)
    assert.deepEqual(acceptCall.expected_editable_frame_ids, ['f2'])

    assert.match(visibleText(card), /Canvas & timeline updated/)
    assert.doesNotMatch(visibleText(card), /32×48|editable frame|locked frame|reference used|Undo restores/, 'scope remains enforced without technical success commentary')

    const undoBtn = card.querySelector('[data-gen-action="astra-flow:undo"]')
    assert.ok(undoBtn)
    await undoBtn.dispatchEvent({ type: 'click' })
    await settleFlow(2)
    assert.equal(undone, undoEntry)
    assert.match(visibleText(card), /Undone/)
  } finally {
    h.restore()
  }
})

test('N4 Canvas & timeline surfaces cross-scope linked cel 422 unsupported_input errors and preserves composer draft on send failure', async () => {
  const crossScopeMessage = 'unsupported_input: Linked cel group g_link on layer l_body spans editable frame(s) f2 and locked frame(s) f1. Unlink those cels or include all linked frames in the editable scope.'
  const h1 = documentFlowHarness()
  try {
    h1.session.prepareDocumentEdit = async () => ({
      projectId: 'proj',
      projectRevision: 3,
      sourceCanvasId: 'canvas',
      sourceDocumentId: 'doc',
      sourceRevision: 1,
      width: 64,
      height: 64,
      editableFrameIds: ['f2'],
      lockedFrameIds: ['f1'],
      isSelected: () => true,
    })
    h1.assistant.prepareDocument = async () => {
      throw Object.assign(new Error(crossScopeMessage), {
        status: 422,
        code: 'unsupported_input',
        details: { group_id: 'g_link', layer_id: 'l_body', editable_frames: ['f2'], locked_frames: ['f1'] },
      })
    }

    await h1.start()
    await settleFlow(6)

    assert.equal(h1.calls.filter(c => c.send).length, 0, 'cross-scope rejection in prepareDocument stops before model tool send')
    assert.match(visibleText(h1.host), /Linked cel group g_link on layer l_body spans editable frame\(s\) f2 and locked frame\(s\) f1/)
  } finally {
    h1.restore()
  }

  const h2 = documentFlowHarness({
    send: async () => {
      throw Object.assign(new Error(crossScopeMessage), {
        status: 422,
        code: 'unsupported_input',
        details: { group_id: 'g_link', layer_id: 'l_body', editable_frames: ['f2'], locked_frames: ['f1'] },
      })
    },
  })
  try {
    const card = await h2.start()
    await settleFlow(6)
    assert.equal(h2.prompt.value, 'Split and align the two poses.', 'composer draft is restored when tool send rejects')
    assert.match(visibleText(card), /Canvas & timeline change stopped/)
    assert.match(visibleText(card), /Linked cel group g_link on layer l_body spans editable frame\(s\) f2 and locked frame\(s\) f1/)
  } finally {
    h2.restore()
  }
})


// ---- DIRECT-ACTIONS r4 (R1, R4): preview finalization and the preset Reload boundary ----
function livePresetHarness({ reload = 'ok' } = {}) {
  let action = { type: 'use_preset', instruction: 'A blue knight.', preset_id: 'fixed-region-motion', reference: false }
  const assistant = { provider: 'astra', busy: false, blocked: false, bind() {}, stop() {}, async send() {
    const value = action; action = null
    return { reply: value ? 'Making the knight sheet.' : 'Noted.', composer_action: value }
  } }
  const h = generationHarness(async () => { throw Error('No unrelated request') }, assistant)
  const loads = [], selected = [], entries = [], undone = []
  let latest = null
  const previousImage = globalThis.Image
  // Image sizes resolve only when the test says so, so a late callback can be released after placement.
  globalThis.Image = class { set src(url) { loads.push({ url, image: this }) } }
  const releaseLoads = () => { for (const { image } of loads.splice(0)) { image.naturalWidth = 64; image.naturalHeight = 64; image.onload?.() } }
  const generated = { id: 'job_gen', status: 'done', source_url: '/generated/job_gen/source.png' }
  const processed = { ...readyJob('job_proc') }
  h.session.api.openEpoch = { current: 1 }
  h.api.reviewCharacter = async () => ({ reviewId: 'r1' })
  h.api.startGenerate = async () => ({ id: 'job_gen', status: 'queued' })
  h.api.getJob = async id => (id === 'job_gen' ? generated : processed)
  h.api.acceptJob = async () => generated
  h.api.downloadUrl = async () => new Uint8Array([1, 2, 3, 4])
  h.api.processSheet = async () => ({ id: 'job_proc', status: 'queued' })
  const placedProject = revision => ({ ...h.session.project, revision, canvases: { other: { id: 'other', document_id: 'doc_other' }, sheet: { id: 'sheet', document_id: 'doc_sheet' } } })
  h.session.api.createFromJob = async () => ({ project: placedProject(8), document: { document_id: 'doc_sheet' }, receipt: { document_id: 'doc_sheet' } })
  // Like the real view: removing a transient drops its selection; a committed reload shows the
  // stored canvases (keeping live transients) and calls onProjectBound, which re-renders the run.
  const view = h.session.view, setTransients = view.setTransients.bind(view)
  view.setTransients = items => {
    const kept = view.canvases.filter(item => !item.transient)
    setTransients(items)
    view.canvases = [...kept, ...items.filter(Boolean)]
    if (view.selectedId && !view.canvases.some(item => item.id === view.selectedId)) view.selectedId = null
  }
  let reloadMode = reload
  h.session.reloadProject = async project => {
    if (reloadMode === 'fail') { reloadMode = 'ok'; throw new Error('Saved, but the canvas did not reload.') }
    h.session.project = project
    view.canvases = [...Object.values(project.canvases).map(canvas => ({ id: canvas.id, width: 64, height: 32 })), ...view.canvases.filter(item => item.transient)]
    h.session.onProjectBound?.()
    return { committed: true, stale: false }
  }
  h.session.selectCanvas = id => { selected.push(id); h.session.view.select(id) }
  h.session.recordCanvasAddition = ({ projectId, canvasId }) => {
    const existing = entries.find(entry => entry.canvasId === canvasId)
    if (existing) return existing
    const entry = { kind: 'import', projectId, canvasId }; entries.push(entry); latest = entry; return entry
  }
  h.session.latestUndoEntry = () => latest
  h.session.undoIfLatest = async entry => { if (entry !== latest) return false; undone.push(entry); latest = null; return true }
  const transientNow = () => h.session.view.canvases.filter(item => item.transient)
  const run = async () => {
    h.prompt.value = 'Use it for a blue knight'; await h.prompt.dispatchEvent(new Event('input'))
    await h.send.dispatchEvent({ type: 'click' }); await settleFlow(30)
  }
  const restore = () => { globalThis.Image = previousImage; h.restore() }
  return { h, run, loads, releaseLoads, selected, entries, undone, transientNow, placedProject, restore, setReload: mode => { reloadMode = mode } }
}

test('a placed preset sheet ends its temporary preview, selects the saved canvas, ignores a late image size and Undo revives no ghost', async () => {
  const t = livePresetHarness()
  try {
    // While the run is live its candidate is previewed on the canvas (the actual previewLive path).
    const previews = []
    const setTransients = t.h.session.view.setTransients.bind(t.h.session.view)
    t.h.session.view.setTransients = items => { previews.push(items.map(item => item.id)); setTransients(items) }
    await t.run()
    assert.ok(previews.some(ids => ids.includes('candidate:job_gen') || ids.includes('candidate:job_proc')), 'the live run previewed its candidate')
    assert.ok(t.loads.length > 0, 'image-size callbacks are still pending when the sheet is placed')
    assert.equal(t.h.gen.phase, 'ready')
    assert.match(cardText(t.h.host), /Sprite sheet on the canvas/)
    assert.deepEqual(t.transientNow(), [], 'no temporary candidate after placement')
    assert.equal(t.h.session.view.selectedId, 'sheet', 'the saved, editable canvas is selected')
    assert.deepEqual(t.selected, ['sheet'])
    assert.equal(t.h.gen.previewLive, false, 'the preview ended with the confirmed placement')
    t.releaseLoads(); await settleFlow(4)
    assert.deepEqual(t.transientNow(), [], 'a late image-size callback cannot recreate the candidate')
    assert.equal(t.h.session.view.selectedId, 'sheet', 'nor select it')
    assert.deepEqual(t.entries.map(entry => entry.canvasId), ['sheet'])
    await t.h.host.querySelector('[data-gen-action="astra-flow:undo"]').dispatchEvent({ type: 'click' }); await settleFlow(4)
    t.releaseLoads(); await settleFlow(4)
    assert.deepEqual(t.undone, [t.entries[0]], 'Undo removes only the new canvas')
    assert.deepEqual(t.transientNow(), [], 'Undo does not revive a ghost preview')
    assert.match(cardText(t.h.host), /Undo removed the new canvas/)
    assert.equal(t.h.host.querySelectorAll('.vnext-workflow-card').at(-1).dataset.figma, '2910:2806', 'Undone maps to its Figma Current state')
  } finally { t.restore() }
})

test('the placed preset sheet keeps its Undo while another save runs and says nothing was reverted once a later change withdraws it', async () => {
  const t = livePresetHarness()
  try {
    await t.run()
    assert.match(cardText(t.h.host), /Added as a new canvas\. Undo removes it\./)
    const undo = () => t.h.host.querySelector('[data-gen-action="astra-flow:undo"]')
    // Still the latest change, but another save blocked it: the same Undo stays offered.
    const undoIfLatest = t.h.session.undoIfLatest
    t.h.session.undoIfLatest = async () => false
    await undo().dispatchEvent({ type: 'click' }); await settleFlow(6)
    assert.match(cardText(t.h.host), /Added as a new canvas\. Undo could not run while another change was saving; try again\./)
    assert.ok(undo() && !undo().disabled, 'the same Undo stays offered')
    assert.equal(t.h.host.querySelectorAll('.vnext-workflow-card').at(-1).dataset.figma, '2910:2697')
    // A later change exists: this Undo is withdrawn and nothing is reverted.
    t.h.session.undoIfLatest = undoIfLatest
    t.h.session.latestUndoEntry = () => ({ kind: 'later_change' })
    await undo().dispatchEvent({ type: 'click' }); await settleFlow(6)
    assert.match(cardText(t.h.host), /Added as a new canvas\. Undo here was withdrawn because a later change was made; nothing was reverted\. ⌘Z \/ Ctrl\+Z steps back through changes in order\./)
    assert.equal(undo(), null, 'no Undo is offered after it was withdrawn')
    assert.equal(t.h.host.querySelectorAll('.vnext-workflow-card').at(-1).dataset.figma, '2910:2753')
    assert.deepEqual(t.undone, [], 'nothing was reverted')
  } finally { t.restore() }
})

test('preset Reload completes only from a newest read: failed, stale, older and foreign reads keep recovery, and a later success completes once', async () => {
  const t = livePresetHarness({ reload: 'fail' })
  try {
    const reads = []
    let next = []
    t.h.session.api.getProject = async () => { const value = next.shift(); reads.push(value); return value }
    const shown = []
    const reloadProject = t.h.session.reloadProject
    t.h.session.reloadProject = async project => { shown.push(project.revision); return reloadProject(project) }
    await t.run()
    assert.match(cardText(t.h.host), /Saved, canvas did not reload/)
    assert.deepEqual(t.entries, [], 'no Undo before the shown project holds the canvas')
    const stateNode = () => t.h.host.querySelectorAll('.vnext-workflow-card').at(-1).dataset.figma
    assert.equal(stateNode(), '2910:2534', 'saved, not reloaded maps to its Figma Current state')
    const click = () => t.h.host.dispatchEvent({ type: 'click', target: { dataset: { genAction: 'reload-canvas' }, closest(selector) { return selector.includes('gen-action') ? this : null } } })
    for (const read of [{ ok: false, error: 'offline' }, { ok: true, stale: true }, { ok: true, project: t.placedProject(7) }, { ok: true, project: { ...t.placedProject(9), id: 'other_project' } }, null]) {
      next = [read]
      shown.length = 0
      await click(); await settleFlow(4)
      assert.deepEqual(shown, [], `read ${JSON.stringify(read)?.slice(0, 60)}: nothing (and never the saved snapshot) is shown`)
      assert.equal(t.h.gen.reloadFailed, true)
      assert.match(cardText(t.h.host), /could not be reloaded yet/)
      assert.equal(stateNode(), '2910:2641', 'the kept recovery maps to its Figma Current state')
      assert.deepEqual(t.entries, [], 'no premature Undo')
      assert.equal(t.h.host.querySelector('[data-gen-action="astra-flow:undo"]'), null)
    }
    // A later valid read completes the original result exactly once.
    next = [{ ok: true, project: t.placedProject(9) }]
    await click(); await settleFlow(4)
    assert.deepEqual(shown, [9], 'the newest read is shown')
    assert.equal(t.h.gen.reloadFailed, false)
    assert.deepEqual(t.entries.map(entry => entry.canvasId), ['sheet'], 'one Undo entry, bound after the confirmed reload')
    assert.equal(t.h.session.view.selectedId, 'sheet')
    assert.match(cardText(t.h.host), /Added as a new canvas\. Undo removes it\./)
    assert.equal(stateNode(), '2855:2456', 'the completed placement maps to its Figma Current state')
    await click(); await settleFlow(4)
    assert.deepEqual(shown, [9], 'nothing is reloaded or added twice')
  } finally { t.restore() }
  // An intervening project change: a read that returns afterwards shows nothing anywhere.
  const u = livePresetHarness({ reload: 'fail' })
  try {
    const shown = []
    const reloadProject = u.h.session.reloadProject
    u.h.session.reloadProject = async project => { shown.push(project.revision); return reloadProject(project) }
    await u.run()
    assert.match(cardText(u.h.host), /Saved, canvas did not reload/)
    shown.length = 0
    let releaseRead
    u.h.session.api.getProject = () => new Promise(resolve => { releaseRead = () => resolve({ ok: true, project: u.placedProject(9) }) })
    const pending = u.h.host.dispatchEvent({ type: 'click', target: { dataset: { genAction: 'reload-canvas' }, closest(selector) { return selector.includes('gen-action') ? this : null } } })
    await settleFlow(2)
    u.h.session.project = { id: 'elsewhere', revision: 1, name: 'Elsewhere', canvases: {} }; u.h.session.onProjectBound()
    releaseRead(); await pending; await settleFlow(4)
    assert.deepEqual(shown, [], 'the old project read is not shown after the change')
    assert.equal(u.h.session.project.id, 'elsewhere')
    assert.deepEqual(u.entries, [], 'no Undo is bound for the earlier project')
  } finally { u.restore() }
})

test('preset Reload keeps recovery when a project change starts during the read or the commit is superseded, and a canvas removed meanwhile gets no Undo', async () => {
  const t = livePresetHarness({ reload: 'fail' })
  try {
    let next = null, gate = null, moveEpoch = false, changing = false, commit = { committed: true, stale: false }
    t.h.session.openInFlight = () => changing
    t.h.session.api.getProject = async () => {
      if (gate) await gate.promise
      if (moveEpoch) t.h.session.api.openEpoch.current += 1
      return next
    }
    const shown = []
    const reloadProject = t.h.session.reloadProject
    t.h.session.reloadProject = async (project, options) => { shown.push(project.revision); return commit === 'unconfirmed' ? undefined : commit.stale ? commit : reloadProject(project, options) }
    await t.run()
    shown.length = 0
    const click = () => t.h.host.dispatchEvent({ type: 'click', target: { dataset: { genAction: 'reload-canvas' }, closest(selector) { return selector.includes('gen-action') ? this : null } } })
    const kept = label => {
      assert.equal(t.h.gen.reloadFailed, true, `${label}: recovery kept`)
      assert.deepEqual(t.entries, [], `${label}: no Undo`)
      assert.match(cardText(t.h.host), /could not be reloaded yet/)
    }
    // Another project change begins while the read is out: nothing is shown into it.
    next = { ok: true, project: t.placedProject(9) }
    let release
    gate = { promise: new Promise(resolve => { release = resolve }) }
    const pending = click(); await settleFlow(2)
    changing = true; release(); await pending; await settleFlow(4)
    gate = null; changing = false
    assert.deepEqual(shown, []); kept('change during read')
    // The open epoch moved while the read was out.
    moveEpoch = true
    await click(); await settleFlow(4)
    moveEpoch = false
    assert.deepEqual(shown, []); kept('epoch moved')
    // The read matches the saved revision (which session.project already holds as the saved
    // snapshot) but the reload never confirms a commit: still not completed.
    next = { ok: true, project: t.placedProject(8) }
    commit = 'unconfirmed'
    await click(); await settleFlow(4)
    assert.deepEqual(shown, [8]); kept('commit unconfirmed')
    shown.length = 0
    next = { ok: true, project: t.placedProject(9) }
    // The newest read is valid but its commit is superseded.
    commit = { committed: false, stale: true }
    await click(); await settleFlow(4)
    assert.deepEqual(shown, [9]); kept('commit superseded')
    // A later change removed the placed canvas: the reload completes, without an Undo claim, and the
    // card says the sheet is saved but not on the canvas (r7: the status follows the actual canvas).
    commit = { committed: true, stale: false }
    next = { ok: true, project: { ...t.placedProject(10), canvases: { other: { id: 'other', document_id: 'doc_other' } } } }
    await click(); await settleFlow(4)
    assert.deepEqual(shown, [9, 10])
    assert.equal(t.h.gen.reloadFailed, false)
    assert.deepEqual(t.entries, [])
    assert.equal(t.h.host.querySelector('[data-gen-action="astra-flow:undo"]'), null)
    assert.equal(t.h.host.querySelectorAll('.vnext-workflow-card').at(-1).dataset.figma, '2934:2702', 'saved, not on the canvas maps to its own Figma Current state')
    assert.match(cardText(t.h.host), /Saved, not on the canvas/)
    assert.doesNotMatch(cardText(t.h.host), /Undo removes it|Added as a new canvas/)
    assert.equal(t.h.host.querySelector('[data-gen-action="add-canvas"]'), null, 'a saved sheet is never added again')
    assert.notEqual(t.h.session.view.selectedId, 'sheet')
  } finally { t.restore() }
})

test('a placement hands over the selection the run started with, and a Reload canvas click owns its own selection', async () => {
  const t = livePresetHarness({ reload: 'fail' })
  try {
    t.h.session.project = { ...t.h.session.project, canvases: { other: { id: 'other', document_id: 'doc_other' } } }
    t.h.session.view.canvases = [{ id: 'other', width: 64, height: 64 }]
    t.h.session.view.select('other') // selected before the request: the run owns this selection
    await t.run()
    assert.match(cardText(t.h.host), /Saved, canvas did not reload/)
    assert.equal(t.h.session.view.selectedId, 'other', 'nothing is handed over while the canvas has not reloaded')
    let fitted = 0
    t.h.session.view.fitAll = () => { fitted += 1 }
    const click = () => t.h.host.dispatchEvent({ type: 'click', target: { dataset: { genAction: 'reload-canvas' }, closest(selector) { return selector.includes('gen-action') ? this : null } } })
    t.h.session.api.getProject = async () => ({ ok: false, error: 'offline' })
    await click(); await settleFlow(8)
    assert.equal(fitted, 0, 'a failed read moves nothing into view')
    t.h.session.api.getProject = async () => ({ ok: true, project: t.placedProject(8) })
    await click(); await settleFlow(8)
    assert.match(cardText(t.h.host), /Added as a new canvas\. Undo removes it\./)
    assert.equal(t.h.session.view.selectedId, 'sheet', 'the Reload canvas click hands its selection to the saved canvas')
    assert.equal(fitted, 1, 'the recovered placement is brought into view like a direct one')
  } finally { t.restore() }
  const s = livePresetHarness()
  try {
    s.h.session.project = { ...s.h.session.project, canvases: { other: { id: 'other', document_id: 'doc_other' } } }
    s.h.session.view.canvases = [{ id: 'other', width: 64, height: 64 }]
    s.h.session.view.select('other')
    await s.run()
    assert.match(cardText(s.h.host), /Sprite sheet on the canvas/)
    assert.equal(s.h.session.view.selectedId, 'sheet', 'the selection the run started with hands over to the saved canvas')
    assert.deepEqual(s.selected, ['sheet'])
  } finally { s.restore() }
})

test('a placement completed after a project change keeps the selection the add owned, and a reopen that holds the sheet completes the placement', async () => {
  // The automatic reload after the change: the canvas the user picked during the run stays selected.
  const t = livePresetHarness()
  try {
    const withMine = project => ({ ...project, canvases: { ...project.canvases, mine: { id: 'mine', document_id: 'doc_mine' } } })
    t.h.session.project = { ...t.h.session.project, canvases: { other: { id: 'other', document_id: 'doc_other' }, mine: { id: 'mine', document_id: 'doc_mine' } } }
    t.h.session.view.canvases = [{ id: 'other', width: 64, height: 64 }, { id: 'mine', width: 64, height: 64 }]
    t.h.session.view.select('other') // the selection the run starts with
    let changing = false
    t.h.session.openInFlight = () => changing
    const placed = []
    t.h.session.placeAddedCanvas = async ({ canvasId }) => { placed.push(canvasId); return { unchanged: true } }
    const createFromJob = t.h.session.api.createFromJob
    t.h.session.api.createFromJob = async (...args) => { t.h.session.view.select('mine'); changing = true; return createFromJob(...args) }
    await t.run()
    assert.match(cardText(t.h.host), /Another project is opening/)
    changing = false
    t.h.session.api.getProject = async () => ({ ok: true, project: withMine(t.placedProject(8)) })
    t.h.session.onOpenEpochKept(t.h.session.project.id); await settleFlow(10)
    assert.match(cardText(t.h.host), /Added as a new canvas\. Undo removes it\./)
    assert.equal(t.h.session.view.selectedId, 'mine', 'the canvas the user selected during the run stays selected')
    assert.deepEqual(placed, ['sheet'], 'the placement completes once (the commit\'s own project-bound pass does not complete it again)')
  } finally { t.restore() }
  // A reopen of this project that already holds the sheet: placed beside the others, its Undo, the owned (empty) selection.
  const u = livePresetHarness()
  try {
    let changing = false
    u.h.session.openInFlight = () => changing
    const placed = []
    u.h.session.placeAddedCanvas = async ({ canvasId }) => { placed.push(canvasId); return { unchanged: true } }
    const createFromJob = u.h.session.api.createFromJob
    u.h.session.api.createFromJob = async (...args) => { changing = true; return createFromJob(...args) }
    await u.run()
    assert.match(cardText(u.h.host), /Another project is opening/)
    changing = false
    await u.h.session.reloadProject(u.placedProject(9)); await settleFlow(10)
    assert.deepEqual(placed, ['sheet'], 'the sheet is kept beside the canvases it would cover')
    assert.equal(u.h.session.view.selectedId, 'sheet', 'the run owned an empty selection, so the saved canvas is selected')
    assert.match(cardText(u.h.host), /Added as a new canvas\. Undo removes it\./)
    assert.deepEqual(u.entries.map(entry => entry.canvasId), ['sheet'])
  } finally { u.restore() }
})

test('a placement never takes over a canvas the user selected meanwhile, and a placed job is not previewed again', async () => {
  const t = livePresetHarness()
  try {
    t.h.session.project = { ...t.h.session.project, canvases: { other: { id: 'other', document_id: 'doc_other' } } }
    t.h.session.view.canvases = [{ id: 'other', width: 64, height: 64 }]
    const createFromJob = t.h.session.api.createFromJob
    t.h.session.api.createFromJob = async (...args) => { t.h.session.view.select('other'); return createFromJob(...args) }
    await t.run()
    t.releaseLoads(); await settleFlow(4)
    assert.match(cardText(t.h.host), /Sprite sheet on the canvas/)
    assert.equal(t.h.session.view.selectedId, 'other', 'the user\'s own selection stays')
    assert.deepEqual(t.selected, [])
    assert.deepEqual(t.transientNow(), [])
    // Re-rendering the placed run (for example after a same-project reload) shows no candidate.
    t.h.gen.previewLive = true
    t.h.session.onProjectBound(); await settleFlow(4)
    t.releaseLoads(); await settleFlow(4)
    assert.deepEqual(t.transientNow(), [], 'a sheet the project already holds is never shown as a candidate')
  } finally { t.restore() }
})

// r7: the add, recovery and Undo flow of a preset sheet.
function r7PresetHarness() {
  const harness = generationHarness(async () => ({ ok: true, status: 200, headers: { get: () => 'application/octet-stream' },
    async arrayBuffer() { return new Uint8Array([1, 2, 3, 4]).buffer } }))
  const projectWith = (revision, ids, x = 0) => ({ ...harness.session.project, revision,
    canvases: Object.fromEntries([['other', { id: 'other', document_id: 'doc_other', x, y: 0 }], ...ids.map(id => [id, { id, document_id: `doc_${id}` }])]) })
  // A history like the session's: Undo detaches the canvas, Redo restores it.
  const history = { undo: [], redo: [] }
  const s = harness.session
  s.recordCanvasAddition = ({ projectId, canvasId }) => {
    const found = history.undo.find(entry => entry.canvasId === canvasId)
    if (found) return found
    const entry = { kind: 'import', projectId, canvasId }
    history.undo.push(entry)
    return entry
  }
  s.latestUndoEntry = () => history.undo.at(-1) || null
  s.latestRedoEntry = () => history.redo.at(-1) || null
  s.undoEntryState = entry => (history.undo.includes(entry) ? 'undo' : history.redo.includes(entry) ? 'redo' : 'absent')
  s.undoIfLatest = async entry => {
    if (history.undo.at(-1) !== entry) return false
    history.undo.pop(); history.redo.push(entry)
    const { [entry.canvasId]: removed, ...rest } = s.project.canvases
    s.project = { ...s.project, revision: s.project.revision + 1, canvases: rest, removed }
    return true
  }
  s.redoIfLatest = async entry => {
    if (history.redo.at(-1) !== entry) return false
    history.redo.pop(); history.undo.push(entry)
    s.project = { ...s.project, revision: s.project.revision + 1, canvases: { ...s.project.canvases, [entry.canvasId]: s.project.removed } }
    return true
  }
  const reloads = []
  s.reloadProject = async project => {
    reloads.push(project.revision)
    if ((s.project?.revision ?? -1) > project.revision) return { stale: true, committed: false, superseded: true }
    s.project = project
    return { committed: true, stale: false }
  }
  const click = action => harness.host.dispatchEvent({ type: 'click', target: { dataset: { genAction: action }, closest(selector) { return selector.includes('gen-action') ? this : null } } })
  return { harness, history, projectWith, reloads, click }
}

test('r7: a late Add to canvas response older than a newer same-project save never moves the shown project back; the newest revision completes the same placement once', async () => {
  const t = r7PresetHarness()
  const posts = [], reads = []
  let releaseAdd
  t.harness.session.project = t.projectWith(5, [])
  t.harness.session.api.getProject = async () => { reads.push(1); return { ok: true, project: t.projectWith(7, ['sheet'], 24) } }
  t.harness.session.api.createFromJob = (_projectId, payload) => {
    posts.push(payload)
    return new Promise(resolve => { releaseAdd = () => resolve({ project: t.projectWith(6, ['sheet']), document: { document_id: 'doc_sheet' }, receipt: { operation_id: payload.operationId, document_id: 'doc_sheet' } }) })
  }
  try {
    t.harness.gen.phase = 'ready'
    t.harness.gen.job = readyJob('job_sheet')
    const adding = t.click('add-canvas')
    for (let i = 0; i < 50 && !releaseAdd; i++) await settleFlow(2)
    assert.ok(releaseAdd, 'the add request is in flight')
    // A newer same-project save (revision 7: the other canvas moved) is shown while the add response is delayed.
    t.harness.session.project = t.projectWith(7, ['sheet'], 24)
    releaseAdd(); await adding; await settleFlow(6)
    assert.equal(t.harness.session.project.revision, 7, 'the older response (6) is not adopted')
    assert.equal(t.harness.session.project.canvases.other.x, 24, 'the newer saved layout stays')
    assert.deepEqual(t.reloads, [7], 'the newest revision is shown, never the late snapshot')
    assert.equal(reads.length, 1)
    assert.equal(posts.length, 1, 'nothing is added, processed or generated again')
    assert.deepEqual(t.history.undo.map(entry => entry.canvasId), ['sheet'], 'Undo is bound to exactly the new canvas')
    assert.match(cardText(t.harness.host), /Added as a new canvas\. Undo removes it\./)
    assert.equal(t.harness.gen.reloadFailed, false)
  } finally { t.harness.restore() }
})

test('r7: after Undo the preset card says the sheet stays saved and offers Redo of exactly that canvas; Redo (or ⌘⇧Z) puts it back with its Undo', async () => {
  const t = r7PresetHarness()
  const posts = []
  t.harness.session.project = t.projectWith(5, [])
  t.harness.session.api.createFromJob = async (_projectId, payload) => {
    posts.push(payload)
    return { project: t.projectWith(6, ['sheet']), document: { document_id: 'doc_sheet' }, receipt: { operation_id: payload.operationId, document_id: 'doc_sheet' } }
  }
  const card = () => t.harness.host.querySelectorAll('.vnext-workflow-card').at(-1)
  try {
    t.harness.gen.phase = 'ready'
    t.harness.gen.job = readyJob('job_sheet')
    await t.click('add-canvas'); await settleFlow(4)
    assert.match(cardText(t.harness.host), /Added as a new canvas\. Undo removes it\./)
    await t.harness.host.querySelector('[data-gen-action="astra-flow:undo"]').dispatchEvent({ type: 'click' }); await settleFlow(4)
    let text = cardText(t.harness.host)
    assert.match(text, /Undone/)
    assert.match(text, /the sheet stays saved in this project\. Redo puts the same canvas back\./)
    assert.doesNotMatch(text, /Already in this project|Added as a new canvas/)
    assert.equal(card().dataset.figma, '2910:2806')
    assert.equal(t.harness.host.querySelector('[data-gen-action="add-canvas"]'), null, 'no second add (it would duplicate the saved sheet)')
    const redo = t.harness.host.querySelector('[data-gen-action="astra-flow:redo"]')
    assert.ok(redo && !redo.disabled, 'Redo of exactly this canvas is offered')
    await redo.dispatchEvent({ type: 'click' }); await settleFlow(4)
    assert.ok(t.harness.session.project.canvases.sheet, 'the same canvas is back')
    assert.match(cardText(t.harness.host), /Added as a new canvas\. Undo removes it\./)
    assert.equal(posts.length, 1, 'nothing was added again')
    // ⌘Z / Ctrl+Z and ⌘⇧Z / Ctrl+Shift+Z move the same entry; the card follows on its next render.
    await t.harness.session.undoIfLatest(t.history.undo.at(-1)); t.harness.session.onProjectBound()
    assert.match(cardText(t.harness.host), /Redo puts the same canvas back/)
    await t.harness.session.redoIfLatest(t.history.redo.at(-1)); t.harness.session.onProjectBound()
    assert.match(cardText(t.harness.host), /Added as a new canvas\. Undo removes it\./)
    // A later undone change makes this Redo no longer the newest: no Redo button, nothing is re-applied.
    await t.harness.session.undoIfLatest(t.history.undo.at(-1))
    t.history.redo.push({ kind: 'later' }); t.harness.session.onProjectBound()
    text = cardText(t.harness.host)
    assert.match(text, /the sheet stays saved in this project\./)
    assert.doesNotMatch(text, /Redo puts the same canvas back/)
    assert.equal(t.harness.host.querySelector('[data-gen-action="astra-flow:redo"]'), null)
  } finally { t.harness.restore() }
})

test('r7: a restored sheet saved in the project but on no canvas reads Saved, not on the canvas and offers no second add; on a canvas it reads already in this project', async () => {
  const posts = []
  const harness = generationHarness(async (url) => { if (String(url).endsWith('.png')) return pngResponse(); throw new Error(`unexpected ${url}`) })
  harness.session.api.createFromJob = async (...args) => { posts.push(args); return { project: harness.session.project } }
  harness.session.documents = new Map([['doc_sheet', { source_ref: { asset_id: 'asset_1', revision_id: 'rev_1' } }]])
  try {
    harness.session.project = { ...harness.session.project, assets: { asset_1: { revisions: { rev_1: { source_job_id: 'job_sheet' } } } }, canvases: {} }
    harness.gen.phase = 'ready'
    harness.gen.job = readyJob('job_sheet')
    harness.session.onProjectBound()
    const text = cardText(harness.host)
    assert.match(text, /Saved, not on the canvas/)
    assert.match(text, /no canvas shows it now\. Nothing was added again; the downloads stay available\./)
    assert.doesNotMatch(text, /Already in this project|Sprite sheet on the canvas/)
    assert.equal(harness.host.querySelectorAll('.vnext-workflow-card').at(-1).dataset.figma, '2934:2702')
    assert.equal(harness.host.querySelector('[data-gen-action="add-canvas"]'), null)
    assert.match(text, /Sheet PNG/, 'the downloads stay available')
    await harness.host.dispatchEvent({ type: 'click', target: actionTarget('add-canvas') }); await settleFlow()
    assert.equal(posts.length, 0, 'never added again (it would duplicate the saved sheet)')
    harness.session.project = { ...harness.session.project, canvases: { c1: { id: 'c1', document_id: 'doc_sheet' } } }
    harness.session.onProjectBound()
    assert.match(cardText(harness.host), /Already in this project; it was not added again/)
    assert.equal(harness.host.querySelectorAll('.vnext-workflow-card').at(-1).dataset.figma, '2916:2688')
  } finally { harness.restore() }
})

test('r7: a lost processing job whose sheet is saved but on no canvas says so instead of already in this project', async () => {
  const storage = new Map([['vnext-last-job-id', 'job_proc_off'], ['vnext-job-runs', JSON.stringify({ job_proc_off: { source: 'job_gen' } })]])
  const harness = generationHarness(async (url) => {
    const path = String(url)
    if (path === '/api/jobs/job_proc_off') return jsonResponse(200, { status: 'not_found' })
    throw new Error(`unexpected ${path}`)
  }, undefined, { initialJobId: 'job_proc_off', storage })
  harness.api.restoreGenerationJob = async () => ({ missing: true })
  harness.session.documents = new Map([['doc_copy', { source_ref: { asset_id: 'asset_1', revision_id: 'rev_1' }, derived_from: { document_id: 'doc_sheet', revision: 1 } }]])
  harness.session.project = { ...harness.session.project, assets: { asset_1: { revisions: { rev_1: { source_job_id: 'job_proc_off' } } } },
    canvases: { copy: { id: 'copy', document_id: 'doc_copy' } } }
  try {
    await settleFlow()
    const note = harness.host.querySelectorAll('.is-plain').at(-1)
    assert.equal(note?.dataset.figma, '2934:2741')
    assert.match(visibleText(harness.host), /saved in this project, but no canvas shows it now/)
    assert.doesNotMatch(visibleText(harness.host), /already in this project|Finish processing/)
    assert.equal(storage.has('vnext-last-job-id'), false)
  } finally { harness.restore() }
})

test('r7: a run released by a project switch leaves no temporary candidate on the next project canvas', async () => {
  const harness = generationHarness(async (url) => { if (String(url).endsWith('.png')) return pngResponse(); throw new Error(`unexpected ${url}`) })
  try {
    // A requested run shows its candidate (a temporary canvas) while it is still processing.
    harness.session.view.setTransients([{ id: 'candidate:job_live', transient: true }])
    harness.gen.previewLive = true
    harness.gen.phase = 'processing'
    harness.gen.job = { id: 'job_live', status: 'post_processing', source_url: '/generated/job_live/source.png' }
    let drawn = 0
    harness.session.renderCanvas = () => { drawn += 1 }
    harness.session.project = { id: 'other', revision: 1, name: 'Other' }; harness.session.onProjectBound()
    await settleFlow()
    assert.deepEqual(harness.transients.at(-1), [], 'the candidate preview is removed at the switch')
    assert.ok(drawn > 0, 'and the canvas is redrawn without it')
    assert.equal(harness.session.view.canvases.some(canvas => canvas.transient), false)
    assert.equal(harness.gen.previewLive, false)
  } finally { harness.restore() }
})

test('r7: ⌘Z / ⌘⇧Z render the card inside the project commit, then it re-reads its entry once the history pointer moved', async () => {
  const t = r7PresetHarness()
  t.harness.session.project = t.projectWith(5, [])
  t.harness.session.api.createFromJob = async (_projectId, payload) => ({ project: t.projectWith(6, ['sheet']), document: { document_id: 'doc_sheet' }, receipt: { operation_id: payload.operationId, document_id: 'doc_sheet' } })
  const s = t.harness.session
  const card = () => cardText(t.harness.host)
  try {
    t.harness.gen.phase = 'ready'
    t.harness.gen.job = readyJob('job_sheet')
    await t.click('add-canvas'); await settleFlow(4)
    const entry = t.history.undo.at(-1)
    // ⌘Z: the detached project is committed (onProjectBound renders) before the pointer moves to redo.
    const { sheet, ...rest } = s.project.canvases
    s.project = { ...s.project, revision: s.project.revision + 1, canvases: rest, removed: sheet }
    s.onProjectBound()
    t.history.undo.pop(); t.history.redo.push(entry)
    t.harness.root.dispatchEvent(new Event('vnext-draft-change')) // the session notifies after the pointer moved
    assert.match(card(), /Undone/)
    assert.match(card(), /Redo puts the same canvas back/)
    assert.ok(t.harness.host.querySelector('[data-gen-action="astra-flow:redo"]'))
    // ⌘⇧Z: the restored project is committed first, then the entry returns to undo.
    s.project = { ...s.project, revision: s.project.revision + 1, canvases: { ...s.project.canvases, sheet } }
    s.onProjectBound()
    t.history.redo.pop(); t.history.undo.push(entry)
    t.harness.root.dispatchEvent(new Event('vnext-draft-change'))
    assert.match(card(), /Added as a new canvas\. Undo removes it\./)
    assert.equal(t.harness.host.querySelector('[data-gen-action="astra-flow:redo"]'), null, 'no Redo for a canvas that is back')
  } finally { t.harness.restore() }
})

test('r7: an earlier preset turn keeps answering for its own placement: its Undo and Redo re-render that card, and a blocked Redo says so', async () => {
  const t = r7PresetHarness()
  t.harness.session.project = t.projectWith(5, [])
  t.harness.session.api.createFromJob = async (_projectId, payload) => ({ project: t.projectWith(6, ['sheet']), document: { document_id: 'doc_sheet' }, receipt: { operation_id: payload.operationId, document_id: 'doc_sheet' } })
  const s = t.harness.session
  try {
    t.harness.gen.phase = 'ready'
    t.harness.gen.job = readyJob('job_sheet')
    await t.click('add-canvas'); await settleFlow(4)
    const figma = () => t.harness.host.querySelectorAll('.vnext-workflow-card').at(-1)?.dataset.figma
    const turnText = () => cardText(t.harness.host)
    // A newer run took over the view's current placement; this card is an earlier one now.
    t.harness.gen.placementUndo = null
    await t.harness.host.querySelector('[data-gen-action="astra-flow:undo"]').dispatchEvent({ type: 'click' }); await settleFlow(4)
    assert.match(turnText(), /Undone/)
    assert.match(turnText(), /Redo puts the same canvas back/)
    assert.equal(figma(), '2910:2806')
    // Another save blocks the Redo: it stays offered and says so.
    const redoIfLatest = s.redoIfLatest
    s.redoIfLatest = async () => false
    await t.harness.host.querySelector('[data-gen-action="astra-flow:redo"]').dispatchEvent({ type: 'click' }); await settleFlow(4)
    assert.match(turnText(), /Redo could not run while another change was saving; try again\./)
    assert.ok(t.harness.host.querySelector('[data-gen-action="astra-flow:redo"]'))
    s.redoIfLatest = redoIfLatest
    await t.harness.host.querySelector('[data-gen-action="astra-flow:redo"]').dispatchEvent({ type: 'click' }); await settleFlow(4)
    assert.ok(s.project.canvases.sheet, 'the same canvas is back')
    assert.match(turnText(), /Added as a new canvas\. Undo removes it\./)
  } finally { t.harness.restore() }
})

test('r7: a preset add whose reload fails after a project switch writes nothing into the project now shown', async () => {
  const t = r7PresetHarness()
  t.harness.session.project = t.projectWith(5, [])
  t.harness.session.api.createFromJob = async (_projectId, payload) => ({ project: t.projectWith(6, ['sheet']), document: { document_id: 'doc_sheet' }, receipt: { operation_id: payload.operationId, document_id: 'doc_sheet' } })
  let failReload
  t.harness.session.reloadProject = () => new Promise((_, reject) => { failReload = () => reject(new Error('Saved, but the canvas did not reload.')) })
  try {
    t.harness.gen.phase = 'ready'
    t.harness.gen.job = readyJob('job_sheet')
    const adding = t.click('add-canvas')
    for (let i = 0; i < 50 && !failReload; i++) await settleFlow(2)
    assert.ok(failReload, 'the reload after the add is in flight')
    t.harness.session.project = { id: 'other', revision: 1, name: 'Other' }; t.harness.session.onProjectBound()
    failReload(); await adding; await settleFlow(4)
    assert.equal(t.harness.gen.reloadFailed, false, 'the other project gets no recovery state')
    assert.notEqual(t.harness.gen.error, 'Saved, but the canvas did not reload.')
    assert.notEqual(t.harness.gen.phase, 'ready', 'its phase is not forced to the earlier project’s result')
  } finally { t.harness.restore() }
})

// r8: the first submission of a preset Add carries the revision shown after its download and hash, so a
// canvas save during those steps is not a conflict; a submitted Add whose outcome is unknown is resent
// exactly as it was (same operation, revision and hash), never refreshed.
test('r8: a layout save during the download and hash does not conflict with the first Add, and an unconfirmed Add is resent exactly', async () => {
  const posts = []
  let readSheet = null, fail = true
  const harness = generationHarness(async (url) => {
    if (String(url).endsWith('.png')) {
      await new Promise(resolve => { readSheet = resolve })
      return pngResponse()
    }
    throw new Error(`unexpected ${url}`)
  })
  harness.session.api.createFromJob = async (projectId, payload) => {
    posts.push({ projectId, ...payload })
    if (fail) throw Object.assign(new Error('disk'), { kind: 'unknown', code: 'storage_commit_failed', reason: 'disk' })
    return { project: { ...harness.session.project, revision: harness.session.project.revision + 1 } }
  }
  try {
    harness.gen.phase = 'ready'
    harness.gen.job = readyJob('job_r8')
    const first = harness.host.dispatchEvent({ type: 'click', target: actionTarget('add-canvas') })
    await new Promise(resolve => { const check = () => (readSheet ? resolve() : setImmediate(check)); check() })
    // Save canvas positions lands while the sheet is downloaded and hashed (revision 3 -> 4).
    harness.session.project = { ...harness.session.project, revision: 4 }
    readSheet()
    await first; await settleFlow(4)
    assert.equal(posts.length, 1)
    assert.equal(posts[0].expectedRevision, 4, 'the first submission carries the revision shown after the download and hash')
    assert.equal(posts[0].name, 'Hero')
    assert.match(harness.gen.error, /Adding the sheet was not confirmed/)
    // Another save lands before the retry: the unconfirmed request is resent exactly, not refreshed.
    harness.session.project = { ...harness.session.project, revision: 5 }
    fail = false
    readSheet = null
    await harness.host.dispatchEvent({ type: 'click', target: actionTarget('add-canvas') }); await settleFlow(4)
    assert.equal(posts.length, 2)
    assert.equal(readSheet, null, 'the sheet is not downloaded again')
    assert.equal(posts[1].operationId, posts[0].operationId)
    assert.equal(posts[1].expectedRevision, 4, 'the replay keeps the revision it was first sent with')
    assert.equal(posts[1].expectedSha256, posts[0].expectedSha256)
  } finally { harness.restore() }
})

// r8 (read-only pre-check finding): a canvas save still being written when the hash finishes would race
// the revision the first Add reads. The Add waits until no canvas write is in flight, then sends.
test('r8: the first Add waits while a canvas save is still being written, then sends the newer revision', async () => {
  const posts = []
  const harness = generationHarness(async (url) => { if (String(url).endsWith('.png')) return pngResponse(); throw new Error(`unexpected ${url}`) })
  let saving = true
  harness.session.canvasWriteInFlight = () => saving
  harness.session.api.createFromJob = async (projectId, payload) => {
    posts.push({ projectId, ...payload, whileSaving: saving })
    return { project: { ...harness.session.project, revision: harness.session.project.revision + 1 } }
  }
  try {
    harness.gen.phase = 'ready'
    harness.gen.job = readyJob('job_r8_lock')
    const adding = harness.host.dispatchEvent({ type: 'click', target: actionTarget('add-canvas') })
    await new Promise(resolve => setTimeout(resolve, 250))
    assert.equal(posts.length, 0, 'nothing is sent while the save is still being written')
    // The save lands (revision 3 -> 4) and releases its write.
    harness.session.project = { ...harness.session.project, revision: 4 }
    saving = false
    await adding; await settleFlow(4)
    assert.equal(posts.length, 1)
    assert.equal(posts[0].expectedRevision, 4, 'the revision read after the save settled')
    assert.equal(posts[0].whileSaving, false, 'sent only once no canvas write is in flight')
  } finally { harness.restore() }
})

// r8 (final audit): a project open that starts while the Add waits ends the wait quietly: nothing is sent,
// no 'still saving' note is left, and the unsent payload is kept for this project.
test('r8: a project open during the Add wait sends nothing and leaves no saving note; the next Add sends the revision shown then', async () => {
  const posts = []
  const harness = generationHarness(async (url) => { if (String(url).endsWith('.png')) return pngResponse(); throw new Error(`unexpected ${url}`) })
  let saving = true, opening = false
  harness.session.canvasWriteInFlight = () => saving
  harness.session.openInFlight = () => opening
  harness.session.api.createFromJob = async (projectId, payload) => {
    posts.push({ projectId, ...payload })
    return { project: { ...harness.session.project, revision: harness.session.project.revision + 1 } }
  }
  try {
    harness.gen.phase = 'ready'
    harness.gen.job = readyJob('job_r8_open')
    const adding = harness.host.dispatchEvent({ type: 'click', target: actionTarget('add-canvas') })
    await new Promise(resolve => setTimeout(resolve, 150))
    opening = true
    await adding; await settleFlow(4)
    assert.equal(posts.length, 0, 'nothing is sent')
    assert.doesNotMatch(String(harness.gen.error || ''), /still saving/, 'no saving note for a project open')
    assert.equal(harness.gen.pendingAdds.size, 1, 'the unsent payload is kept')
    opening = false; saving = false
    harness.session.project = { ...harness.session.project, revision: 6 }
    await harness.host.dispatchEvent({ type: 'click', target: actionTarget('add-canvas') }); await settleFlow(4)
    assert.equal(posts.length, 1)
    assert.equal(posts[0].expectedRevision, 6, 'the unsent payload takes the revision shown when it is first sent')
  } finally { harness.restore() }
})

// r8: after Undo and a page reload there is no Redo. The card offers Put back on the canvas when this
// browser holds the page's own Undo record of that sheet's canvas; it restores the same canvas through
// the session (nothing is added or generated), then offers that canvas's Undo.
test('r8: after Undo and a reload the preset card offers Put back on the canvas, which restores the same canvas and then offers its Undo', async () => {
  const posts = [], restores = [], selected = []
  const harness = generationHarness(async (url) => { if (String(url).endsWith('.png')) return pngResponse(); throw new Error(`unexpected ${url}`) })
  harness.session.api.createFromJob = async (...args) => { posts.push(args); return { project: harness.session.project } }
  harness.session.documents = new Map([['doc_sheet', { source_ref: { asset_id: 'asset_1', revision_id: 'rev_1' } }]])
  const saved = { ...harness.session.project, revision: 8, assets: { asset_1: { revisions: { rev_1: { source_job_id: 'job_sheet' } } } },
    sprite_documents: { doc_sheet: {} }, canvases: {} }
  const record = { projectId: 'proj', canvasId: 'sheet', documentId: 'doc_sheet', detachOperationId: 'op_detach', jobId: 'job_sheet' }
  const s = harness.session
  s.project = saved
  // The session's lookup over this browser's records (the store the preset view gave it).
  s.undonePlacementFor = query => s.undonePlacements.find({ project: s.project, ...query })
  const entry = { kind: 'import', projectId: 'proj', canvasId: 'sheet', documentId: 'doc_sheet', placement: { jobId: 'job_sheet' } }
  let undone = false, hold = null
  const outcomes = [{ outcome: 'retry' }, { outcome: 'unknown' }, { outcome: 'restored' }]
  s.restoreUndonePlacement = async query => {
    restores.push(query)
    if (hold) await hold
    const next = outcomes.shift()
    if (next.outcome !== 'restored') return next
    s.project = { ...saved, revision: 9, canvases: { sheet: { id: 'sheet', document_id: 'doc_sheet', x: 0, y: 0 } } }
    s.undonePlacements.forget(record)
    return { outcome: 'restored', shown: true, canvasId: 'sheet', entry }
  }
  s.selectCanvas = id => selected.push(id)
  s.latestUndoEntry = () => (undone ? null : entry)
  s.latestRedoEntry = () => (undone ? entry : null)
  s.undoEntryState = item => (item !== entry ? 'absent' : undone ? 'redo' : 'undo')
  s.undoIfLatest = async item => { if (item !== entry || undone) return false; undone = true; s.project = { ...saved, revision: 10 }; return true }
  const card = () => harness.host.querySelectorAll('.vnext-workflow-card').at(-1)
  const putBack = () => harness.host.querySelector('[data-gen-action="restore-canvas"]')
  const clickPutBack = () => harness.host.dispatchEvent({ type: 'click', target: actionTarget('restore-canvas') })
  try {
    harness.gen.phase = 'ready'
    harness.gen.job = readyJob('job_sheet')
    harness.session.onProjectBound()
    assert.equal(card().dataset.figma, '2934:2702', 'without this page\'s Undo record nothing can be put back')
    assert.equal(putBack(), null)
    assert.equal(s.undonePlacements.remember(record), true)
    harness.session.onProjectBound()
    let text = cardText(harness.host)
    assert.match(text, /Saved, not on the canvas/)
    assert.match(text, /Undo removed this sheet's canvas; the sheet stays saved in this project\. Put back on the canvas restores that same canvas; nothing is added or generated again\./)
    assert.equal(card().dataset.figma, '2937:2736')
    assert.equal(putBack().textContent, 'Put back on the canvas')
    assert.equal(putBack().disabled, false)
    assert.equal(harness.host.querySelector('[data-gen-action="add-canvas"]'), null, 'never a second add')
    assert.match(text, /Sheet PNG/, 'the downloads stay available')
    // While it runs the action reads Putting back… and cannot be sent twice.
    let release
    hold = new Promise(resolve => { release = resolve })
    const running = clickPutBack(); await settleFlow(2)
    assert.equal(putBack().textContent, 'Putting back…')
    assert.equal(putBack().disabled, true)
    await clickPutBack(); await settleFlow(2)
    assert.equal(restores.length, 1, 'one request at a time')
    hold = null; release(); await running; await settleFlow(2)
    assert.match(cardText(harness.host), /Putting it back could not run while another change was saving; try again\./)
    assert.equal(card().dataset.figma, '2937:2736')
    await clickPutBack(); await settleFlow(2)
    assert.match(cardText(harness.host), /Putting it back was not confirmed; Put back on the canvas checks the same request and does not add another canvas\./)
    await clickPutBack(); await settleFlow(4)
    text = cardText(harness.host)
    assert.match(text, /Sprite sheet on the canvas/)
    assert.match(text, /Back on the canvas\. Undo removes it\./)
    assert.equal(card().dataset.figma, '2937:2759')
    assert.ok(harness.host.querySelector('[data-gen-action="astra-flow:undo"]'), 'the restored canvas offers its Undo')
    assert.deepEqual(selected, ['sheet'], 'the restored canvas becomes the selection')
    assert.deepEqual(restores, Array(3).fill({ projectId: 'proj', jobId: 'job_sheet' }), 'only this sheet\'s own record is used')
    assert.equal(posts.length, 0, 'nothing was added, processed or generated')
    // Its Undo removes exactly that canvas again; Redo then puts it back as usual.
    await harness.host.querySelector('[data-gen-action="astra-flow:undo"]').dispatchEvent({ type: 'click' }); await settleFlow(4)
    assert.equal(undone, true)
    assert.equal(card().dataset.figma, '2910:2806')
    assert.ok(harness.host.querySelector('[data-gen-action="astra-flow:redo"]'))
    assert.equal(putBack(), null, 'Redo owns the canvas while the history holds it')
    // A later edit clears that Redo (the entry leaves the history) and this page's Undo kept a new record:
    // typing in the prompt (a draft change) keeps Put back on this card instead of an earlier snapshot.
    s.undoEntryState = () => 'absent'
    s.latestRedoEntry = () => null
    assert.equal(s.undonePlacements.remember(record), true)
    await harness.root.dispatchEvent({ type: 'vnext-draft-change' }); await settleFlow(2)
    assert.equal(card().dataset.figma, '2937:2736', 'the current card is never repainted from an earlier placement')
    assert.ok(putBack(), 'Put back is offered again')
  } finally { harness.restore() }
})


test('a preset action cannot select a Skill on behalf of a no-Skill composer', async () => {
  let selections = 0, reviews = 0
  const assistant = { provider: 'astra', busy: false, blocked: false, bind() {}, stop() {}, async send() {
    return { reply: 'Making it.', composer_action: { type: 'use_preset', instruction: 'A flame.', preset_id: 'fixed-region-motion', reference: false } }
  } }
  const h = generationHarness(async () => { throw Error('no generation') }, assistant)
  try {
    h.state.draft.skillId = null
    h.session.selectApplicationPreset = () => { selections++; return true }
    h.api.reviewCharacter = async () => { reviews++; throw Error('must not execute') }
    h.prompt.value = 'Draw a flame animation'; await h.prompt.dispatchEvent(new Event('input'))
    await h.send.dispatchEvent({ type: 'click' }); await settleFlow()
    assert.equal(selections, 0); assert.equal(reviews, 0)
    assert.equal(h.state.draft.skillId, null)
    assert.match(visibleText(h.root), /cannot run that here/)
  } finally { h.restore() }
})
