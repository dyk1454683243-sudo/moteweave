import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildCompatCharacterRequest,
  compatCharacterOutputFrameSizes,
  compatCharacterInputFingerprint,
  fetchCompatCharacterDiagnostics,
  isRecoverableCompatObservationError,
  normalizeCompatCharacterSettings,
  pollCompatCharacterJob,
  StudioCharacterCompatApiError,
  submitCompatCharacterJob,
  verifyCompatCharacterRelease,
} from '../src/ui/studio/characterCompatApi.js'
import { buildQualityCharacterPrompt } from '../src/character-pack/textToImagePrompt.js'

function imageFile(name = 'reference.jpg', type = 'image/jpeg', overrides = {}) {
  const bytes = Uint8Array.from([1, 2, 3, 4])
  return {
    name,
    type,
    size: bytes.byteLength,
    lastModified: 42,
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

function textResponse(value, status = 200) {
  return new Response(String(value), {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  })
}

function settings(overrides = {}) {
  return {
    name: 'Compat Hero',
    description: 'Silver-haired swordswoman',
    t2iMode: 'production_sheet_v0',
    characterPreset: 'rpg_humanoid_v0',
    generationLayout: 'fixed_region_motion_v0',
    imageSize: '2K',
    candidateCount: 2,
    seed: 7,
    backgroundMode: 'auto',
    backgroundTolerance: 24,
    componentCleanup: true,
    minAlpha: 18,
    minArea: 4,
    minAreaRatio: 0,
    autoCorrect: true,
    motionStabilize: true,
    motionMaxShift: 2,
    pixelFinishing: true,
    pixelFinishingMaxColors: 16,
    pixelFinishingOutline: true,
    pixelFinishingOutlineMode: 'outer',
    export1x: true,
    export2x: true,
    export3x: false,
    export4x: false,
    ...overrides,
  }
}

function generationEvidence(overrides = {}) {
  return {
    mode: 'production_sheet_v0',
    generation_profile_id: null,
    image_config: { image_size: '2K', aspect_ratio: '1:1' },
    generation_options: { candidateCount: 2, seed: 7 },
    candidate_selection: { candidate_count: 2 },
    prompt_contract: {
      t2i_mode: 'production_sheet_v0',
      preset: 'fixed_region_motion_v0',
      layout_id: 'fixed_region_motion_v0',
      character_preset: { id: 'rpg_humanoid_v0' },
      background_mode: 'auto',
      subject: 'Silver-haired swordswoman',
      structured_subject: 'Silver-haired swordswoman. Small RPG humanoid',
      prompt_fields: {},
    },
    input_images: { template: true, reference: false, palette: false },
    template_file: 'motion_template_ocad_primary.png',
    reference_file: null,
    palette_file: null,
    ...overrides,
  }
}

function releaseGate(overrides = {}) {
  return {
    schema_version: 1,
    mode: 'generation_release_gate_v1',
    generation_mode: 'production_sheet_v0',
    policy: 'strict_live_generation_v1',
    status: 'pass',
    release_ready: true,
    blocking_errors: [],
    warnings: [],
    evidence: {},
    ...overrides,
  }
}

function debugReport(overrides = {}) {
  return {
    validation: {
      status: 'pass',
      warnings: [],
      blocking_errors: [],
      frame_count: 64,
      ...overrides,
    },
  }
}

function animations(overrides = {}) {
  return {
    profile: 'topdown_rpg_v0',
    source_layout: { id: 'fixed_region_motion_v0' },
    frame_size: { w: 96, h: 96 },
    sheet_size: { w: 768, h: 768 },
    animations: { idle_down: { frames: [0, 1], fps: 8 } },
    ...overrides,
  }
}

function metadata(overrides = {}) {
  return {
    name: 'Compat Hero',
    description: 'Silver-haired swordswoman',
    profile: 'topdown_rpg_v0',
    ...overrides,
  }
}

function qualityReport(overrides = {}) {
  return {
    mode: 'quality_character_v0',
    status: 'done',
    release_ready: true,
    artifact_disposition: 'release',
    candidate_selection: {
      candidate_count: 2,
      release_ready: true,
    },
    ...overrides,
  }
}

function releaseJob(id = 'job_compat_001', overrides = {}) {
  return {
    id,
    status: 'done',
    release_ready: true,
    artifact_disposition: 'release',
    source_url: `/generated/${id}/source.png`,
    debug_report_url: `/generated/${id}/debug_report.json`,
    normalized_sheet_url: `/generated/${id}/normalized_sheet.png`,
    animations_url: `/generated/${id}/animations.json`,
    metadata_url: `/generated/${id}/metadata.json`,
    generation_url: `/generated/${id}/generation.json`,
    prompt_url: `/generated/${id}/prompt.txt`,
    generation_release_gate_url: `/generated/${id}/generation_release_gate.json`,
    zip_url: `/generated/${id}/character_pack.zip`,
    provider_call_budget: {
      planned_provider_calls: 2,
      max_provider_calls: 2,
      used_provider_calls: 2,
    },
    candidate_selection: {
      candidate_count: 2,
      release_ready: true,
      artifact_disposition: 'release',
      release_selected_index: 1,
    },
    multi_resolution_sheet_urls: [
      { frame_size: 96, url: `/generated/${id}/normalized_sheet_96.png` },
      { frame_size: 192, url: `/generated/${id}/normalized_sheet_192.png` },
    ],
    ...overrides,
  }
}

test('Studio compatible Character normalizes the legacy-compatible request without a Strict profile', async () => {
  const reference = imageFile()
  const palette = imageFile('palette.png', 'image/png')
  const body = await buildCompatCharacterRequest({ settings: settings(), referenceFile: reference, paletteFile: palette })

  assert.equal(body.t2iMode, 'production_sheet_v0')
  assert.equal(body.characterPreset, 'rpg_humanoid_v0')
  assert.equal(body.preset, 'fixed_region_motion_v0')
  assert.equal(body.maxProviderCalls, 2)
  assert.deepEqual(body.generationOptions, { candidateCount: 2, seed: 7 })
  assert.deepEqual(body.imageConfig, { aspect_ratio: '1:1', image_size: '2K' })
  assert.equal(body.reference_image_base64, 'AQIDBA==')
  assert.equal(body.palette_image_base64, 'AQIDBA==')
  assert.equal(body.options.sourceLayout, 'fixed_region_motion_v0')
  assert.equal(body.options.motionStabilizationMaxShift, 2)
  assert.deepEqual(body.options.outputFrameSizes, [96, 192])
  assert.equal(body.options.export1x, true)
  assert.equal(body.options.export3x, false)
  assert.equal('generationProfileId' in body, false)
  assert.equal('generation_profile_id' in body, false)
  assert.deepEqual(compatCharacterOutputFrameSizes(settings()), [96, 192])
})

test('Studio compatible Character omits sheet-only controls from quality image requests', async () => {
  const body = await buildCompatCharacterRequest({
    settings: settings({
      t2iMode: 'quality_character_v0',
      export1x: false,
      export2x: false,
    }),
  })
  assert.equal('name' in body, false)
  assert.equal('preset' in body, false)
  assert.deepEqual(body.options, { backgroundMode: 'auto' })
  assert.deepEqual(body.pixelFinishing, { maxColors: 16, outline: true })
  assert.equal('outlineMode' in body.pixelFinishing, false)
  assert.deepEqual(compatCharacterOutputFrameSizes(settings({ t2iMode: 'quality_character_v0' })), [])
})

test('Studio compatible Character posts once with candidate count as the Provider-call maximum', async () => {
  const requests = []
  const job = await submitCompatCharacterJob({ settings: settings(), referenceFile: null, paletteFile: null }, {
    fetchImpl: async (url, options) => {
      requests.push({ url, method: options.method, body: JSON.parse(options.body) })
      return jsonResponse({ id: 'job_compat_001', status: 'queued' }, 202)
    },
  })
  assert.equal(job.id, 'job_compat_001')
  assert.deepEqual(requests.map(({ url, method }) => ({ url, method })), [
    { url: '/api/generate-character', method: 'POST' },
  ])
  assert.equal(requests[0].body.generationOptions.candidateCount, 2)
  assert.equal(requests[0].body.maxProviderCalls, 2)
})

test('Studio compatible Character polling observes only the original Job', async () => {
  const urls = []
  const receipts = [
    { id: 'job_compat_001', status: 'generating' },
    { id: 'job_compat_001', status: 'failed_quality_gate' },
  ]
  const terminal = await pollCompatCharacterJob({ id: 'job_compat_001', status: 'queued' }, {
    intervalMs: 0,
    pollLimit: 3,
    fetchImpl: async (url, options) => {
      urls.push({ url, method: options.method ?? 'GET' })
      return jsonResponse(receipts.shift())
    },
  })
  assert.equal(terminal.status, 'failed_quality_gate')
  assert.deepEqual(urls, [
    { url: '/api/jobs/job_compat_001', method: 'GET' },
    { url: '/api/jobs/job_compat_001', method: 'GET' },
  ])
})

test('Studio compatible Character releases only after exact Job URLs, budget, generation, and quality evidence verify', async () => {
  const job = releaseJob()
  const referenceFile = imageFile('reference.jpg')
  const paletteFile = imageFile('palette.png', 'image/png')
  const requests = []
  const result = await verifyCompatCharacterRelease(job, {
    settings: settings(),
    referenceFile,
    paletteFile,
    fetchImpl: async (url, options) => {
      requests.push({ url, method: options.method ?? 'GET' })
      if (url.endsWith('/generation.json')) return jsonResponse(generationEvidence({
        input_images: { template: true, reference: true, palette: true },
        reference_file: 'reference.jpg',
        palette_file: 'palette.png',
      }))
      if (url.endsWith('/generation_release_gate.json')) return jsonResponse(releaseGate())
      if (url.endsWith('/debug_report.json')) return jsonResponse(debugReport())
      if (url.endsWith('/animations.json')) return jsonResponse(animations())
      if (url.endsWith('/metadata.json')) return jsonResponse(metadata())
      return jsonResponse({ error: 'unexpected' }, 404)
    },
  })
  assert.equal(result.job.id, job.id)
  assert.equal(result.releaseGate.release_ready, true)
  assert.equal(result.multiResolutionSheetUrls.length, 2)
  assert.equal(requests.length, 5)
  assert.ok(requests.every(({ method }) => method === 'GET'))
  assert.equal(requests.some(({ url }) => /accept|generate-character/.test(url)), false)
})

test('Studio compatible Character verifies the quality-mode report and exact release artifacts', async () => {
  const id = 'job_compat_quality'
  const qualitySettings = settings({
    t2iMode: 'quality_character_v0',
    characterPreset: 'two_to_one_character_v0',
  })
  const job = releaseJob(id, {
    result_url: `/generated/${id}/t2i_report.json`,
    t2i_result_url: `/generated/${id}/t2i_result.png`,
    zip_url: `/generated/${id}/t2i_pack.zip`,
    normalized_sheet_url: undefined,
    metadata_url: undefined,
    animations_url: undefined,
    debug_report_url: undefined,
    multi_resolution_sheet_urls: undefined,
  })
  const requests = []
  const result = await verifyCompatCharacterRelease(job, {
    settings: qualitySettings,
    fetchImpl: async (url, options) => {
      requests.push({ url, method: options.method ?? 'GET' })
      if (url.endsWith('/generation.json')) return jsonResponse(generationEvidence({
        mode: 'quality_character_v0',
        image_config: { image_size: '2K', aspect_ratio: '2:1' },
        prompt_contract: {
          mode: 'quality_character_v0',
          preset: 'two_to_one_character_v0',
          background_mode: 'auto',
          prompt_fields: {},
        },
        input_images: { template: false, reference: false, palette: false },
        template_file: null,
        reference_file: null,
        palette_file: null,
      }))
      if (url.endsWith('/generation_release_gate.json')) {
        return jsonResponse(releaseGate({
          generation_mode: 'quality_character_v0',
          policy: 'golden_review_hard_thresholds_v1',
        }))
      }
      if (url.endsWith('/t2i_report.json')) return jsonResponse(qualityReport())
      if (url.endsWith('/prompt.txt')) {
        return textResponse(buildQualityCharacterPrompt({
          description: qualitySettings.description,
          characterPreset: qualitySettings.characterPreset,
          backgroundMode: qualitySettings.backgroundMode,
        }))
      }
      return jsonResponse({ error: 'unexpected' }, 404)
    },
  })
  assert.equal(result.job.id, id)
  assert.equal(result.report.mode, 'quality_character_v0')
  assert.deepEqual(requests.map(({ url, method }) => ({ url, method })), [
    { url: `/generated/${id}/generation.json`, method: 'GET' },
    { url: `/generated/${id}/generation_release_gate.json`, method: 'GET' },
    { url: `/generated/${id}/t2i_report.json`, method: 'GET' },
    { url: `/generated/${id}/prompt.txt`, method: 'GET' },
  ])
})

test('Studio compatible Character keeps review-required evidence diagnostic-only with zero Accept POSTs', async () => {
  const id = 'job_compat_review'
  const job = releaseJob(id, {
    release_ready: false,
    artifact_disposition: 'review_required',
    zip_url: undefined,
    metadata_url: undefined,
    animations_url: undefined,
    normalized_sheet_url: undefined,
    result_url: `/generated/${id}/generation_release_gate.json`,
    candidate_selection: {
      candidate_count: 2,
      release_ready: false,
      artifact_disposition: 'review_required',
      release_selected_index: null,
    },
  })
  const requests = []
  const diagnostic = await fetchCompatCharacterDiagnostics(job, {
    settings: settings(),
    fetchImpl: async (url, options) => {
      requests.push({ url, method: options.method ?? 'GET' })
      if (url.endsWith('/generation.json')) return jsonResponse(generationEvidence())
      if (url.endsWith('/generation_release_gate.json')) return jsonResponse(releaseGate({ status: 'needs_review', release_ready: false }))
      if (url.endsWith('/debug_report.json')) return jsonResponse(debugReport({ status: 'warning', warnings: ['manual_review'] }))
      return jsonResponse({ error: 'unexpected' }, 404)
    },
  })
  assert.equal(diagnostic.job.artifact_disposition, 'review_required')
  assert.ok(requests.length >= 2)
  assert.ok(requests.every(({ method }) => method === 'GET'))
  assert.equal(requests.some(({ url }) => /accept|generate-character/.test(url)), false)
})

test('Studio compatible Character fails closed on URL, budget, and input binding drift', async () => {
  await assert.rejects(
    verifyCompatCharacterRelease(releaseJob('job_compat_001', {
      zip_url: '/generated/job_other/character_pack.zip',
    }), {
      settings: settings(),
      fetchImpl: async () => jsonResponse({}),
    }),
    (error) => error.code === 'release_url_binding_mismatch',
  )
  await assert.rejects(
    verifyCompatCharacterRelease(releaseJob('job_compat_001', {
      provider_call_budget: {
        planned_provider_calls: 2,
        max_provider_calls: 4,
        used_provider_calls: 2,
      },
    }), {
      settings: settings(),
      fetchImpl: async () => jsonResponse({}),
    }),
    (error) => error.code === 'provider_budget_binding_mismatch',
  )
  const first = compatCharacterInputFingerprint({ settings: settings(), inputEpoch: 1 })
  const changed = compatCharacterInputFingerprint({ settings: settings({ seed: 8 }), inputEpoch: 1 })
  assert.notEqual(first, changed)
})

test('Studio compatible Character fails closed on policy, scale, metadata, prompt, and optional-image drift', async () => {
  const fetchProduction = ({ generation = generationEvidence(), gate = releaseGate(), metadataValue = metadata() } = {}) => async (url) => {
    if (url.endsWith('/generation.json')) return jsonResponse(generation)
    if (url.endsWith('/generation_release_gate.json')) return jsonResponse(gate)
    if (url.endsWith('/debug_report.json')) return jsonResponse(debugReport())
    if (url.endsWith('/animations.json')) return jsonResponse(animations())
    if (url.endsWith('/metadata.json')) return jsonResponse(metadataValue)
    return jsonResponse({ error: 'unexpected' }, 404)
  }
  await assert.rejects(
    verifyCompatCharacterRelease(releaseJob(), {
      settings: settings(),
      fetchImpl: fetchProduction({ gate: releaseGate({ policy: 'wrong_policy' }) }),
    }),
    (error) => error.code === 'release_gate_blocked',
  )
  await assert.rejects(
    verifyCompatCharacterRelease(releaseJob('job_compat_001', {
      multi_resolution_sheet_urls: [{ frame_size: 96, url: '/generated/job_compat_001/normalized_sheet_96.png' }],
    }), {
      settings: settings(),
      fetchImpl: fetchProduction(),
    }),
    (error) => error.code === 'release_url_binding_mismatch',
  )
  await assert.rejects(
    verifyCompatCharacterRelease(releaseJob(), {
      settings: settings(),
      fetchImpl: fetchProduction({
        generation: generationEvidence({ template_file: 'motion_template_ocha_8x8.png' }),
      }),
    }),
    (error) => error.code === 'generation_input_binding_mismatch',
  )
  await assert.rejects(
    verifyCompatCharacterRelease(releaseJob(), {
      settings: settings(),
      fetchImpl: fetchProduction({ metadataValue: metadata({ description: 'Different subject' }) }),
    }),
    (error) => error.code === 'metadata_binding_mismatch',
  )
  await assert.rejects(
    verifyCompatCharacterRelease(releaseJob(), {
      settings: settings(),
      fetchImpl: fetchProduction({
        generation: generationEvidence({
          prompt_contract: { ...generationEvidence().prompt_contract, subject: 'Different subject' },
        }),
      }),
    }),
    (error) => error.code === 'generation_binding_mismatch',
  )
  await assert.rejects(
    verifyCompatCharacterRelease(releaseJob(), {
      settings: settings(),
      referenceFile: imageFile('reference.jpg'),
      fetchImpl: fetchProduction(),
    }),
    (error) => error.code === 'generation_input_binding_mismatch',
  )
})

test('Studio compatible Character validates bounded parameters and recoverable same-Job observation errors', () => {
  assert.throws(
    () => normalizeCompatCharacterSettings(settings({ candidateCount: 3 })),
    (error) => error instanceof StudioCharacterCompatApiError && error.code === 'invalid_compat_input',
  )
  assert.throws(
    () => normalizeCompatCharacterSettings(settings({ export1x: false, export2x: false, export3x: false, export4x: false })),
    (error) => error.code === 'invalid_compat_input',
  )
  for (const code of ['request_failed', 'request_timeout', 'poll_interrupted', 'fetch_unavailable']) {
    assert.equal(isRecoverableCompatObservationError({ code }), true)
  }
  assert.equal(isRecoverableCompatObservationError({ code: 'http_error', status: 503 }), true)
  assert.equal(isRecoverableCompatObservationError({ code: 'http_error', status: 404 }), false)
  assert.equal(isRecoverableCompatObservationError({ code: 'generation_binding_mismatch' }), false)
})
