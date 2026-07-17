import test from 'node:test'
import assert from 'node:assert/strict'

import * as editorProject from '../../src/editor-project/index.js'
import {
  buildFrameRepairPrompt,
  requestFrameRepairCandidate,
  resolveExactFrameRepairProvider,
} from '../../src/editor-project/frameRepairProvider.js'

function providerEnv() {
  return {
    CHARACTER_PROVIDER_PRESETS: JSON.stringify([
      {
        id: 'first',
        provider: 'gemini',
        apiKey: 'key-a-private',
        model: 'model-a',
        image_size: '1K',
        aspect_ratio: '1:1',
      },
      {
        id: 'second',
        provider: 'openrouter',
        apiKey: 'key-b-private',
        model: 'model-b',
        image_size: '1K',
        aspect_ratio: '1:1',
      },
    ]),
  }
}

function plan() {
  return {
    instruction: 'repair the raised hand',
    provider: {
      image_config: { image_size: '1K', aspect_ratio: '1:1' },
    },
  }
}

function providerPreset(overrides = {}) {
  return {
    id: 'second',
    label: 'Second provider',
    provider: 'openrouter',
    apiKey: 'key-b-private',
    available: true,
    model: 'model-b',
    imageConfig: { image_size: '1K', aspect_ratio: '1:1' },
    ...overrides,
  }
}

async function assertRejectCode(promise, code) {
  await assert.rejects(promise, (error) => error?.code === code)
}

test('frame repair provider API is exported from editor-project', () => {
  assert.equal(editorProject.resolveExactFrameRepairProvider, resolveExactFrameRepairProvider)
  assert.equal(editorProject.buildFrameRepairPrompt, buildFrameRepairPrompt)
  assert.equal(editorProject.requestFrameRepairCandidate, requestFrameRepairCandidate)
})

test('exact provider selection never falls back and sanitizes configuration errors', () => {
  assert.equal(resolveExactFrameRepairProvider(providerEnv(), 'second').id, 'second')
  assert.throws(
    () => resolveExactFrameRepairProvider(providerEnv(), 'missing'),
    (error) => error?.code === 'provider_unavailable' && !String(error).includes('key-b-private'),
  )

  const secret = 'do-not-echo-this-env-value'
  assert.throws(
    () => resolveExactFrameRepairProvider({ CHARACTER_PROVIDER_PRESETS: `[${secret}` }, 'second'),
    (error) => error?.code === 'provider_configuration_error' &&
      !JSON.stringify({ message: error.message, details: error.details }).includes(secret),
  )
})

test('exact provider selection rejects unavailable presets and unsupported provider configuration', () => {
  const unavailable = providerEnv()
  unavailable.CHARACTER_PROVIDER_PRESETS = JSON.stringify([
    { id: 'only', provider: 'gemini', apiKey: '', model: 'model-a' },
  ])
  assert.throws(
    () => resolveExactFrameRepairProvider(unavailable, 'only'),
    (error) => error?.code === 'provider_unavailable' && !String(error).includes('GEMINI_API_KEY'),
  )
  assert.throws(
    () => resolveExactFrameRepairProvider({
      CHARACTER_PROVIDER_PRESETS: JSON.stringify([
        { id: 'bad', provider: 'not-supported', apiKey: 'never-echo-this-key' },
      ]),
    }, 'bad'),
    (error) => error?.code === 'provider_configuration_error' &&
      !JSON.stringify({ message: error.message, details: error.details }).includes('never-echo-this-key'),
  )
})

test('project-owned prompt includes only the approved instruction and fixed constraints', () => {
  const prompt = buildFrameRepairPrompt({
    ...plan(),
    apiKey: 'prompt-secret',
    sourcePath: '/private/character.png',
    raw_base64: 'data:image/png;base64,AAAA',
  })
  assert.match(prompt, /repair the raised hand/)
  assert.match(prompt, /one isolated transparent pixel-art character frame/i)
  assert.match(prompt, /approved mask/i)
  assert.match(prompt, /first input image is the output-layout authority/i)
  assert.match(prompt, /third input image contains at most one adjacent clip frame/i)
  assert.match(prompt, /exactly one single-subject character frame/i)
  assert.match(prompt, /never return a sheet, grid, contact sheet, multiple poses/i)
  assert.match(prompt, /no prop unless the approved instruction explicitly requires it/i)
  assert.doesNotMatch(prompt, /full normalized sheet/i)
  assert.doesNotMatch(prompt, /prompt-secret|\/private\/character|base64,AAAA/)
  assert.doesNotMatch(prompt, /PixelLab|Aseprite|Spine|Scenario AI|OCAD/i)
})

test('one candidate request dispatches only the exact adapter and returns detached trusted facts', async () => {
  const providerPreset = resolveExactFrameRepairProvider(providerEnv(), 'second')
  const generated = Buffer.from('candidate')
  let exactCalls = 0
  let wrongCalls = 0
  let adapterInput = null

  const result = await requestFrameRepairCandidate({
    providerPreset,
    plan: plan(),
    referenceImages: [{
      name: 'target.png',
      mimeType: 'image/png',
      buffer: Buffer.from('target'),
      path: '/private/reference.png',
      apiKey: 'reference-secret',
    }],
    requestByProvider: {
      openrouter: async (input) => {
        exactCalls += 1
        adapterInput = input
        return { buffer: generated, prompt: 'provider-controlled prompt' }
      },
      gemini: async () => {
        wrongCalls += 1
        throw new Error('wrong adapter')
      },
    },
  })

  assert.equal(exactCalls, 1)
  assert.equal(wrongCalls, 0)
  assert.equal(result.provider_preset_id, 'second')
  assert.equal(result.prompt, buildFrameRepairPrompt(plan()))
  assert.notEqual(result.prompt, 'provider-controlled prompt')
  assert.notEqual(result.buffer, generated)
  assert.deepEqual(result.buffer, generated)
  assert.equal(adapterInput.images[0].path, undefined)
  assert.equal(adapterInput.images[0].apiKey, undefined)
  generated[0] = 0
  assert.deepEqual(result.buffer, Buffer.from('candidate'))
})

test('candidate request rejects unavailable runtimes and missing adapters before dispatch', async () => {
  let calls = 0
  const adapter = async () => {
    calls += 1
    return { buffer: Buffer.from('candidate') }
  }
  await assertRejectCode(requestFrameRepairCandidate({
    providerPreset: providerPreset({ available: false }),
    plan: plan(),
    referenceImages: [],
    requestByProvider: { openrouter: adapter },
  }), 'provider_unavailable')
  await assertRejectCode(requestFrameRepairCandidate({
    providerPreset: providerPreset({ apiKey: '' }),
    plan: plan(),
    referenceImages: [],
    requestByProvider: { openrouter: adapter },
  }), 'provider_unavailable')
  await assertRejectCode(requestFrameRepairCandidate({
    providerPreset: providerPreset(),
    plan: plan(),
    referenceImages: [],
    requestByProvider: { gemini: adapter },
  }), 'provider_unavailable')
  assert.equal(calls, 0)
})

test('candidate request bounds and projects reference images before dispatch', async () => {
  let calls = 0
  const adapter = async () => {
    calls += 1
    return { buffer: Buffer.from('candidate') }
  }
  await assertRejectCode(requestFrameRepairCandidate({
    providerPreset: providerPreset(),
    plan: plan(),
    referenceImages: Array.from({ length: 5 }, (_, index) => ({
      name: `reference-${index}.png`,
      mimeType: 'image/png',
      buffer: Buffer.from([index]),
    })),
    requestByProvider: { openrouter: adapter },
  }), 'invalid_frame_repair_reference')
  await assertRejectCode(requestFrameRepairCandidate({
    providerPreset: providerPreset(),
    plan: plan(),
    referenceImages: [{
      name: '../private.png',
      mimeType: 'image/png',
      buffer: Buffer.from('target'),
    }],
    requestByProvider: { openrouter: adapter },
  }), 'invalid_frame_repair_reference')
  assert.equal(calls, 0)
})

test('candidate request rejects empty, non-buffer, and oversized provider payloads after one call', async () => {
  for (const buffer of [null, Buffer.alloc(0), Buffer.alloc(32 * 1024 * 1024 + 1)]) {
    let calls = 0
    await assertRejectCode(requestFrameRepairCandidate({
      providerPreset: providerPreset(),
      plan: plan(),
      referenceImages: [],
      requestByProvider: {
        openrouter: async () => {
          calls += 1
          return { buffer, prompt: 'untrusted' }
        },
      },
    }), 'provider_output_invalid')
    assert.equal(calls, 1)
  }
})
