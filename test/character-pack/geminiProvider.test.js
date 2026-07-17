import test from 'node:test'
import assert from 'node:assert/strict'

import sharp from 'sharp'

import { buildOpenRouterCharacterPrompt, generateCharacterSource, getGeminiProviderState } from '../../src/character-pack/providers/geminiProvider.js'
import {
  FIXED_REGION_MOTION_LAYOUT_ID,
  LEGACY_OCAD_MOTION_LAYOUT_ID,
} from '../../src/character-pack/sourceLayouts.js'

test('getGeminiProviderState reports OpenRouter availability and implementation state', () => {
  const missing = getGeminiProviderState({})
  assert.equal(missing.available, false)
  assert.equal(missing.implemented, true)
  assert.equal(missing.status, 'missing_credentials')
  assert.equal(missing.provider, 'openrouter')
  assert.equal(missing.model, 'google/gemini-2.5-flash-image')
  assert.equal(missing.active_preset_id, 'openrouter-default')
  assert.equal(missing.presets.length, 1)
  assert.equal(missing.presets[0].available, false)

  const configured = getGeminiProviderState({ OPENROUTER_API_KEY: 'key', OPENROUTER_IMAGE_MODEL: 'custom/model' })
  assert.equal(configured.available, true)
  assert.equal(configured.implemented, true)
  assert.equal(configured.status, 'ready')
  assert.equal(configured.provider, 'openrouter')
  assert.equal(configured.model, 'custom/model')
  assert.equal(configured.presets[0].id, 'openrouter-default')
  assert.equal(configured.presets[0].available, true)
})

test('getGeminiProviderState supports simple user-selected Gemini defaults without exposing secrets', () => {
  const state = getGeminiProviderState({
    CHARACTER_IMAGE_PROVIDER: 'gemini',
    CHARACTER_IMAGE_MODEL: 'gemini-custom-image',
    CHARACTER_IMAGE_SIZE: '1K',
    CHARACTER_IMAGE_ASPECT_RATIO: '2:1',
    GEMINI_API_KEY: 'gemini-secret',
  })

  assert.equal(state.available, true)
  assert.equal(state.status, 'ready')
  assert.equal(state.provider, 'gemini')
  assert.equal(state.model, 'gemini-custom-image')
  assert.equal(state.active_preset_id, 'gemini-default')
  assert.equal(state.presets[0].provider, 'gemini')
  assert.equal(state.presets[0].model, 'gemini-custom-image')
  assert.deepEqual(state.presets[0].image_config, { aspect_ratio: '2:1', image_size: '1K' })
  assert.equal('apiKey' in state.presets[0], false)
})

test('getGeminiProviderState infers Gemini when only Gemini credentials are configured', () => {
  const state = getGeminiProviderState({
    GEMINI_API_KEY: 'gemini-secret',
    GEMINI_IMAGE_MODEL: 'gemini-env-model',
  })

  assert.equal(state.available, true)
  assert.equal(state.provider, 'gemini')
  assert.equal(state.model, 'gemini-env-model')
  assert.equal(state.active_preset_id, 'gemini-default')
})

test('getGeminiProviderState reports invalid provider config without leaking secrets', () => {
  const state = getGeminiProviderState({
    CHARACTER_IMAGE_PROVIDER: 'unsupported-secret-looking-value',
    CHARACTER_IMAGE_API_KEY: 'super-secret-key',
  })

  assert.equal(state.available, false)
  assert.equal(state.status, 'configuration_error')
  assert.match(state.error, /Supported providers: openrouter, gemini/)
  assert.doesNotMatch(state.error, /unsupported-secret-looking-value/)
  assert.doesNotMatch(state.error, /super-secret-key/)
  assert.deepEqual(state.presets, [])
})

test('getGeminiProviderState exposes configured provider presets without secrets', () => {
  const env = {
    KEY_A: 'alpha',
    CHARACTER_DEFAULT_PROVIDER: 'fast',
    CHARACTER_PROVIDER_PRESETS: JSON.stringify([
      {
        id: 'fast',
        label: 'Fast Gemini',
        provider: 'openrouter',
        apiKeyEnv: 'KEY_A',
        baseUrl: 'https://example.test/fast',
        model: 'google/gemini-fast',
        image_size: '1K',
      },
      {
        id: 'quality',
        label: 'Quality Gemini',
        provider: 'openrouter',
        apiKeyEnv: 'MISSING_KEY',
        model: 'google/gemini-quality',
      },
    ]),
  }
  const state = getGeminiProviderState(env)
  assert.equal(state.available, true)
  assert.equal(state.active_preset_id, 'fast')
  assert.equal(state.model, 'google/gemini-fast')
  assert.deepEqual(state.presets.map((preset) => preset.id), ['fast', 'quality'])
  assert.deepEqual(state.presets.map((preset) => preset.available), [true, false])
  assert.equal('apiKey' in state.presets[0], false)
})

test('generateCharacterSource parses an OpenRouter image data URL response', async () => {
  let request
  const png = Buffer.from('fake-png')
  const fetchImpl = async (url, init) => {
    request = { url, init }
    return {
      ok: true,
      async json() {
        return {
          choices: [
            {
              message: {
                images: [{ image_url: { url: `data:image/png;base64,${png.toString('base64')}` } }],
              },
            },
          ],
        }
      },
    }
  }

  const result = await generateCharacterSource({
    description: 'silver hair sword fighter',
    env: { OPENROUTER_API_KEY: 'key', OPENROUTER_IMAGE_MODEL: 'custom/model' },
    fetchImpl,
  })

  assert.equal(request.url, 'https://openrouter.ai/api/v1/chat/completions')
  const body = JSON.parse(request.init.body)
  assert.equal(body.model, 'custom/model')
  assert.deepEqual(body.modalities, ['image', 'text'])
  assert.equal(body.stream, false)
  assert.deepEqual(body.image_config, { aspect_ratio: '1:1', image_size: '2K' })
  assert.deepEqual(result.buffer, png)
  assert.equal(result.provider, 'openrouter')
  assert.equal(result.model, 'custom/model')
  assert.equal(result.promptContract.contract_version, 'character_prompt_contract_v1_15')
  assert.equal(result.promptContract.preset, FIXED_REGION_MOTION_LAYOUT_ID)
  assert.equal(result.promptContract.layout_id, FIXED_REGION_MOTION_LAYOUT_ID)
})

test('generateCharacterSource uses the selected configured provider preset', async () => {
  let request
  const png = Buffer.from('selected-preset-png')
  const fetchImpl = async (url, init) => {
    request = { url, init }
    return {
      ok: true,
      async json() {
        return {
          choices: [
            {
              message: {
                images: [{ image_url: { url: `data:image/png;base64,${png.toString('base64')}` } }],
              },
            },
          ],
        }
      },
    }
  }

  const env = {
    KEY_A: 'alpha',
    KEY_B: 'bravo',
    CHARACTER_PROVIDER_PRESETS: JSON.stringify([
      { id: 'fast', label: 'Fast', apiKeyEnv: 'KEY_A', baseUrl: 'https://example.test/fast', model: 'model/fast', image_size: '1K' },
      { id: 'quality', label: 'Quality', apiKeyEnv: 'KEY_B', baseUrl: 'https://example.test/quality', model: 'model/quality', image_size: '4K' },
    ]),
  }

  const result = await generateCharacterSource({
    description: 'green swordsman',
    providerPresetId: 'quality',
    env,
    fetchImpl,
  })

  assert.equal(request.url, 'https://example.test/quality')
  assert.equal(request.init.headers.authorization, 'Bearer bravo')
  const body = JSON.parse(request.init.body)
  assert.equal(body.model, 'model/quality')
  assert.deepEqual(body.image_config, { aspect_ratio: '1:1', image_size: '4K' })
  assert.equal(result.providerPresetId, 'quality')
  assert.equal(result.providerLabel, 'Quality')
  assert.equal(result.model, 'model/quality')
})

test('generateCharacterSource falls back from the default provider to the next available preset', async () => {
  const requests = []
  const png = Buffer.from('fallback-png')
  const fetchImpl = async (url, init) => {
    requests.push({ url, init })
    if (url === 'https://example.test/bad') throw new Error('fetch failed')
    return {
      ok: true,
      async json() {
        return {
          choices: [{ message: { images: [{ image_url: { url: `data:image/png;base64,${png.toString('base64')}` } }] } }],
        }
      },
    }
  }
  const env = {
    KEY_BAD: 'bad-key',
    KEY_GOOD: 'good-key',
    CHARACTER_DEFAULT_PROVIDER: 'bad',
    CHARACTER_PROVIDER_PRESETS: JSON.stringify([
      { id: 'good', label: 'Good', apiKeyEnv: 'KEY_GOOD', baseUrl: 'https://example.test/good', model: 'model/good' },
      { id: 'bad', label: 'Bad', apiKeyEnv: 'KEY_BAD', baseUrl: 'https://example.test/bad', model: 'model/bad' },
    ]),
  }

  const result = await generateCharacterSource({
    description: 'blue wizard',
    t2iMode: 'quality_character_v0',
    env,
    fetchImpl,
  })

  assert.deepEqual(requests.map((request) => request.url), ['https://example.test/bad', 'https://example.test/good'])
  assert.equal(JSON.parse(requests[1].init.body).model, 'model/good')
  assert.equal(result.providerPresetId, 'good')
  assert.equal(result.model, 'model/good')
  assert.deepEqual(result.providerAttempts.map((attempt) => [attempt.provider_preset_id, attempt.status]), [
    ['bad', 'failed'],
    ['good', 'success'],
  ])
  assert.equal(result.providerAttempts[0].error, 'fetch failed')
})

test('generateCharacterSource counts failed fallback attempts against provider budget', async () => {
  const requests = []
  const fetchImpl = async (url) => {
    requests.push(url)
    throw new Error('fetch failed')
  }
  const env = {
    KEY_BAD: 'bad-key',
    KEY_GOOD: 'good-key',
    CHARACTER_DEFAULT_PROVIDER: 'bad',
    CHARACTER_PROVIDER_PRESETS: JSON.stringify([
      { id: 'bad', label: 'Bad', apiKeyEnv: 'KEY_BAD', baseUrl: 'https://example.test/bad', model: 'model/bad' },
      { id: 'good', label: 'Good', apiKeyEnv: 'KEY_GOOD', baseUrl: 'https://example.test/good', model: 'model/good' },
    ]),
  }
  const providerBudget = { max: 1, used: 0 }

  await assert.rejects(
    generateCharacterSource({
      description: 'blue wizard',
      t2iMode: 'quality_character_v0',
      env,
      fetchImpl,
      providerBudget,
    }),
    (error) => {
      assert.match(error.message, /Provider call budget exhausted: used 1\/1/)
      assert.equal(error.status, 'failed_budget_exhausted')
      assert.deepEqual(error.providerAttempts.map((attempt) => [attempt.provider_preset_id, attempt.status]), [
        ['bad', 'failed'],
        ['good', 'failed'],
      ])
      assert.equal(error.providerAttempts[0].error, 'fetch failed')
      assert.equal(error.providerAttempts[1].error, 'Provider call budget exhausted: used 1/1')
      return true
    }
  )
  assert.deepEqual(requests, ['https://example.test/bad'])
  assert.equal(providerBudget.used, 1)
  assert.equal(providerBudget.providerCallsUsed, 1)
})

test('generateCharacterSource keeps explicitly selected provider failures strict', async () => {
  const requests = []
  const fetchImpl = async (url) => {
    requests.push(url)
    throw new Error('fetch failed')
  }
  const env = {
    KEY_BAD: 'bad-key',
    KEY_GOOD: 'good-key',
    CHARACTER_DEFAULT_PROVIDER: 'good',
    CHARACTER_PROVIDER_PRESETS: JSON.stringify([
      { id: 'bad', label: 'Bad', apiKeyEnv: 'KEY_BAD', baseUrl: 'https://example.test/bad', model: 'model/bad' },
      { id: 'good', label: 'Good', apiKeyEnv: 'KEY_GOOD', baseUrl: 'https://example.test/good', model: 'model/good' },
    ]),
  }

  await assert.rejects(
    generateCharacterSource({
      description: 'blue wizard',
      providerPresetId: 'bad',
      t2iMode: 'quality_character_v0',
      env,
      fetchImpl,
    }),
    /fetch failed/
  )
  assert.deepEqual(requests, ['https://example.test/bad'])
})

test('generateCharacterSource classifies provider route TOS blocks', async () => {
  const message = 'The request is prohibited due to a violation of provider terms of service.'
  const fetchImpl = async () => ({
    ok: false,
    status: 400,
    async json() {
      return { error: { message } }
    },
  })

  await assert.rejects(
    generateCharacterSource({
      description: 'blue wizard',
      t2iMode: 'quality_character_v0',
      env: { OPENROUTER_API_KEY: 'key' },
      fetchImpl,
    }),
    (error) => {
      assert.equal(error.status, 'provider_route_blocked')
      assert.equal(error.failure_status, 'provider_route_blocked')
      assert.equal(error.retry_hint, 'switch_provider_preset')
      assert.equal(error.providerAttempts.length, 1)
      assert.equal(error.providerAttempts[0].failure_status, 'provider_route_blocked')
      assert.equal(error.providerAttempts[0].retry_hint, 'switch_provider_preset')
      return true
    }
  )
})

test('generateCharacterSource does not cross provider families for implicit fallback by default', async () => {
  const requests = []
  const fetchImpl = async (url) => {
    requests.push(url)
    throw new Error('route failed')
  }
  const env = {
    KEY_OPENROUTER: 'openrouter-key',
    KEY_GEMINI: 'gemini-key',
    CHARACTER_DEFAULT_PROVIDER: 'bad-openrouter',
    CHARACTER_PROVIDER_PRESETS: JSON.stringify([
      { id: 'bad-openrouter', label: 'Bad OpenRouter', provider: 'openrouter', apiKeyEnv: 'KEY_OPENROUTER', baseUrl: 'https://example.test/bad-openrouter', model: 'model/bad' },
      { id: 'native-gemini', label: 'Native Gemini', provider: 'gemini', apiKeyEnv: 'KEY_GEMINI', baseUrl: 'https://example.test/native-gemini', model: 'gemini-3.1-flash-image-preview' },
    ]),
  }

  await assert.rejects(
    generateCharacterSource({
      description: 'blue wizard',
      t2iMode: 'quality_character_v0',
      env,
      fetchImpl,
    }),
    /route failed/
  )
  assert.deepEqual(requests, ['https://example.test/bad-openrouter'])
})

test('generateCharacterSource forwards explicit generation options to OpenRouter', async () => {
  let request
  const png = Buffer.from('generation-options-png')
  const fetchImpl = async (_url, init) => {
    request = JSON.parse(init.body)
    return {
      ok: true,
      async json() {
        return {
          choices: [{ message: { images: [{ image_url: { url: `data:image/png;base64,${png.toString('base64')}` } }] } }],
        }
      },
    }
  }

  const result = await generateCharacterSource({
    description: 'jade healer',
    generationOptions: { candidateCount: 4, seed: 50, temperature: 1.2, topP: 0.8, topK: 24 },
    candidateIndex: 3,
    env: { OPENROUTER_API_KEY: 'key' },
    fetchImpl,
  })

  assert.equal(request.seed, 52)
  assert.equal(request.temperature, 1.2)
  assert.equal(request.top_p, 0.8)
  assert.equal(request.top_k, 24)
  assert.equal(result.generationOptions.candidateCount, 4)
  assert.equal(result.generationOptions.provider.seed, 52)
})

test('generateCharacterSource quality mode sends prompt image request without structural template', async () => {
  let request
  const png = Buffer.from('quality-character-png')
  const fetchImpl = async (_url, init) => {
    request = JSON.parse(init.body)
    return {
      ok: true,
      async json() {
        return {
          choices: [{ message: { images: [{ image_url: { url: `data:image/png;base64,${png.toString('base64')}` } }] } }],
        }
      },
    }
  }

  const result = await generateCharacterSource({
    description: 'silver swordswoman',
    t2iMode: 'quality_character_v0',
    characterPreset: 'two_to_one_character_v0',
    promptFields: { outfit: 'blue cloak' },
    imageConfig: { image_size: '2K', aspect_ratio: '2:1' },
    env: { OPENROUTER_API_KEY: 'key' },
    fetchImpl,
  })

  assert.equal(result.t2iMode, 'quality_character_v0')
  assert.equal(result.promptContract.contract_version, 'quality_character_prompt_contract_v1_0')
  assert.equal(result.promptContract.preset, 'two_to_one_character_v0')
  assert.match(request.messages[0].content, /one single centered full-body character only/)
  assert.match(request.messages[0].content, /production-ready pixel art sprite-source character/)
  assert.doesNotMatch(request.messages[0].content, /ControlNet-style template/)
  assert.equal(result.inputImages.template, false)
})

test('generateCharacterSource supports the official Gemini image API provider', async () => {
  let request
  const png = Buffer.from('native-gemini-png')
  const fetchImpl = async (url, init) => {
    request = { url, init }
    return {
      ok: true,
      async json() {
        return {
          candidates: [
            {
              content: {
                parts: [{ inlineData: { mimeType: 'image/png', data: png.toString('base64') } }],
              },
            },
          ],
        }
      },
    }
  }

  const template = await sharp({
    create: {
      width: 16,
      height: 16,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .png()
    .toBuffer()
  const env = {
    GEMINI_NATIVE_KEY: 'native-key',
    CHARACTER_PROVIDER_PRESETS: JSON.stringify([
      {
        id: 'gemini-native',
        label: 'Gemini API',
        provider: 'gemini',
        apiKeyEnv: 'GEMINI_NATIVE_KEY',
        model: 'gemini-3.1-flash-image-preview',
        image_size: '2K',
      },
    ]),
  }

  const result = await generateCharacterSource({
    description: 'red armored knight',
    providerPresetId: 'gemini-native',
    templateImage: { buffer: template, mimeType: 'image/png', name: 'template.png' },
    env,
    fetchImpl,
  })

  assert.equal(request.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent')
  assert.equal(request.init.headers['x-goog-api-key'], 'native-key')
  const body = JSON.parse(request.init.body)
  assert.equal(body.contents[0].role, 'user')
  assert.match(body.contents[0].parts[0].text, /red armored knight/)
  assert.equal(body.contents[0].parts[1].inline_data.mime_type, 'image/png')
  const sentTemplate = Buffer.from(body.contents[0].parts[1].inline_data.data, 'base64')
  const sentTemplateMetadata = await sharp(sentTemplate).metadata()
  assert.equal(sentTemplateMetadata.width, 256)
  assert.equal(sentTemplateMetadata.height, 256)
  assert.deepEqual(body.generationConfig, {
    responseModalities: ['TEXT', 'IMAGE'],
    imageConfig: {
      aspectRatio: '1:1',
      imageSize: '2K',
    },
  })
  assert.deepEqual(result.buffer, png)
  assert.equal(result.provider, 'gemini')
  assert.equal(result.providerPresetId, 'gemini-native')
  assert.equal(result.model, 'gemini-3.1-flash-image-preview')
  assert.equal(result.templateName, 'template.png')
})

test('generateCharacterSource uses simple Gemini env config and generic local API key', async () => {
  let request
  const png = Buffer.from('simple-gemini-png')
  const fetchImpl = async (url, init) => {
    request = { url, init }
    return {
      ok: true,
      async json() {
        return {
          candidates: [
            {
              content: {
                parts: [{ inlineData: { mimeType: 'image/png', data: png.toString('base64') } }],
              },
            },
          ],
        }
      },
    }
  }

  const result = await generateCharacterSource({
    description: 'violet mage',
    t2iMode: 'quality_character_v0',
    env: {
      CHARACTER_IMAGE_PROVIDER: 'gemini',
      CHARACTER_IMAGE_API_KEY: 'local-generic-key',
      CHARACTER_IMAGE_MODEL: 'gemini-simple-model',
      CHARACTER_IMAGE_SIZE: '1K',
      CHARACTER_IMAGE_ASPECT_RATIO: '1:1',
    },
    fetchImpl,
  })

  assert.equal(request.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-simple-model:generateContent')
  assert.equal(request.init.headers['x-goog-api-key'], 'local-generic-key')
  const body = JSON.parse(request.init.body)
  assert.equal(body.generationConfig.imageConfig.aspectRatio, '1:1')
  assert.equal(result.provider, 'gemini')
  assert.equal(result.providerPresetId, 'gemini-default')
  assert.equal(result.model, 'gemini-simple-model')
})

test('generateCharacterSource sends template and reference images as OpenRouter content parts', async () => {
  let request
  const output = Buffer.from('generated-png')
  const fetchImpl = async (url, init) => {
    request = { url, init }
    return {
      ok: true,
      async json() {
        return {
          choices: [
            {
              message: {
                images: [{ image_url: { url: `data:image/png;base64,${output.toString('base64')}` } }],
              },
            },
          ],
        }
      },
    }
  }

  const template = await sharp({
    create: {
      width: 16,
      height: 16,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .png()
    .toBuffer()
  const reference = Buffer.from('reference-image')
  const result = await generateCharacterSource({
    description: 'girl holding an umbrella',
    preset: 'topdown_rpg_v0',
    env: { OPENROUTER_API_KEY: 'key' },
    templateImage: { buffer: template, mimeType: 'image/png', name: 'motion_template_ocha_8x8.png' },
    referenceImage: { buffer: reference, mimeType: 'image/jpeg', name: 'umbrella_ref.jpg' },
    fetchImpl,
  })

  const body = JSON.parse(request.init.body)
  assert.equal(body.messages[0].role, 'user')
  assert.equal(body.messages[0].content[0].type, 'text')
  assert.match(body.messages[0].content[0].text, /template image is the approved strict structural(?: 8x8)? layout template/i)
  assert.match(body.messages[0].content[0].text, /strict structural(?: 8x8)? layout template/i)
  assert.match(body.messages[0].content[0].text, /Preserve the exact layout, frame count, grid structure, and poses/i)
  assert.match(body.messages[0].content[0].text, /exactly 64 cells/i)
  assert.match(body.messages[0].content[0].text, /Do not copy empty template cells/i)
  assert.match(body.messages[0].content[0].text, /empty-looking template slots are placeholders that must be replaced/i)
  assert.doesNotMatch(body.messages[0].content[0].text, /profile grid overrides/i)
  assert.doesNotMatch(body.messages[0].content[0].text, /template canvas if they conflict/i)
  assert.deepEqual(
    body.messages[0].content.slice(1).map((part) => part.type),
    ['image_url', 'image_url']
  )
  const sentTemplate = Buffer.from(body.messages[0].content[1].image_url.url.split(',', 2)[1], 'base64')
  const sentTemplateMetadata = await sharp(sentTemplate).metadata()
  assert.equal(sentTemplateMetadata.width, 2048)
  assert.equal(sentTemplateMetadata.height, 2048)
  assert.equal(body.messages[0].content[2].image_url.url, `data:image/jpeg;base64,${reference.toString('base64')}`)
  assert.deepEqual(result.inputImages, { template: true, reference: true, palette: false })
  assert.equal(result.templateName, 'motion_template_ocha_8x8.png')
  assert.equal(result.referenceName, 'umbrella_ref.jpg')
  assert.match(result.prompt, /template image is the approved strict structural(?: 8x8)? layout template/i)
})

test('generateCharacterSource sends palette images as style-only references', async () => {
  let request
  const output = Buffer.from('generated-png')
  const fetchImpl = async (url, init) => {
    request = { url, init }
    return {
      ok: true,
      async json() {
        return {
          choices: [
            {
              message: {
                images: [{ image_url: { url: `data:image/png;base64,${output.toString('base64')}` } }],
              },
            },
          ],
        }
      },
    }
  }

  const template = await sharp({
    create: {
      width: 16,
      height: 16,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .png()
    .toBuffer()
  const palette = Buffer.from('palette-image')
  const result = await generateCharacterSource({
    description: 'hooded merchant',
    preset: 'topdown_rpg_v0',
    env: { OPENROUTER_API_KEY: 'key' },
    templateImage: { buffer: template, mimeType: 'image/png', name: 'motion_template_ocha_8x8.png' },
    paletteImage: { buffer: palette, mimeType: 'image/png', name: 'endesga-32-32x.png' },
    fetchImpl,
  })

  const body = JSON.parse(request.init.body)
  assert.equal(body.messages[0].content[0].type, 'text')
  assert.match(body.messages[0].content[0].text, /DO NOT copy character content/i)
  assert.match(body.messages[0].content[0].text, /palette\/style reference only/i)
  assert.match(body.messages[0].content[0].text, /Match only its color palette, ramp relationships, saturation range, and outline weight/i)
  const sentTemplate = Buffer.from(body.messages[0].content[1].image_url.url.split(',', 2)[1], 'base64')
  const sentTemplateMetadata = await sharp(sentTemplate).metadata()
  assert.equal(sentTemplateMetadata.width, 2048)
  assert.equal(sentTemplateMetadata.height, 2048)
  assert.equal(body.messages[0].content[2].image_url.url, `data:image/png;base64,${palette.toString('base64')}`)
  assert.deepEqual(result.inputImages, { template: true, reference: false, palette: true })
  assert.equal(result.paletteName, 'endesga-32-32x.png')
})

test('generateCharacterSource prepares fixed-region templates as 256px references before API submission', async () => {
  let request
  const output = Buffer.from('generated-png')
  const fetchImpl = async (url, init) => {
    request = { url, init }
    return {
      ok: true,
      async json() {
        return {
          choices: [
            {
              message: {
                images: [{ image_url: { url: `data:image/png;base64,${output.toString('base64')}` } }],
              },
            },
          ],
        }
      },
    }
  }

  const template = await sharp({
    create: {
      width: 252,
      height: 252,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .png()
    .toBuffer()

  const result = await generateCharacterSource({
    description: 'hooded merchant',
    preset: FIXED_REGION_MOTION_LAYOUT_ID,
    env: { OPENROUTER_API_KEY: 'key', OPENROUTER_IMAGE_SIZE: '1K' },
    templateImage: { buffer: template, mimeType: 'image/png', name: 'fixed_region_motion_template_v1.png' },
    fetchImpl,
  })

  const body = JSON.parse(request.init.body)
  const templateUrl = body.messages[0].content[1].image_url.url
  const sentTemplate = Buffer.from(templateUrl.split(',', 2)[1], 'base64')
  const metadata = await sharp(sentTemplate).metadata()

  assert.equal(metadata.width, 256)
  assert.equal(metadata.height, 256)
  assert.equal(result.templateName, 'fixed_region_motion_template_v1.png')
})

test('generateCharacterSource upscales 8x8 templates to the requested generation size before API submission', async () => {
  let request
  const output = Buffer.from('generated-png')
  const fetchImpl = async (url, init) => {
    request = { url, init }
    return {
      ok: true,
      async json() {
        return {
          choices: [
            {
              message: {
                images: [{ image_url: { url: `data:image/png;base64,${output.toString('base64')}` } }],
              },
            },
          ],
        }
      },
    }
  }

  const template = await sharp({
    create: {
      width: 256,
      height: 256,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .png()
    .toBuffer()

  await generateCharacterSource({
    description: 'hooded merchant',
    preset: 'topdown_rpg_v0',
    imageConfig: { image_size: '1K', aspect_ratio: '1:1' },
    env: { OPENROUTER_API_KEY: 'key' },
    templateImage: { buffer: template, mimeType: 'image/png', name: 'motion_template_ocha_8x8.png' },
    fetchImpl,
  })

  const body = JSON.parse(request.init.body)
  const templateUrl = body.messages[0].content[1].image_url.url
  const sentTemplate = Buffer.from(templateUrl.split(',', 2)[1], 'base64')
  const metadata = await sharp(sentTemplate).metadata()
  assert.equal(metadata.width, 1024)
  assert.equal(metadata.height, 1024)
})

test('buildOpenRouterCharacterPrompt supports the fixed-region motion layout', () => {
  const prompt = buildOpenRouterCharacterPrompt({
    description: 'hooded merchant',
    preset: FIXED_REGION_MOTION_LAYOUT_ID,
  })

  assert.match(prompt, /fixed-region motion source layout/i)
  assert.match(prompt, /first attached template image as the structural template/i)
  assert.match(prompt, /body orientation, facing direction, silhouette rhythm/i)
  assert.match(prompt, /sprite sheet layout, pixel art style/i)
  assert.match(prompt, /Do not target a literal tiny pixel canvas/i)
  assert.match(prompt, /local post-processing/i)
  assert.match(prompt, /Default to empty hands/i)
  assert.match(prompt, /do not add ladders, weapons, shields, tools, props/i)
  assert.match(prompt, /one clean character silhouette/i)
  assert.match(prompt, /no extra or duplicated arms or hands/i)
  assert.match(prompt, /ghost limbs, motion blur, action trails, afterimages/i)
  assert.match(prompt, /Show motion across frames or regions/i)
  assert.match(prompt, /not as multiple limb positions inside one cell or region/i)
  assert.match(prompt, /Do not include text, numbers, labels, UI/i)
  assert.match(prompt, /idledown/i)
  assert.match(prompt, /walkdown/i)
  assert.match(prompt, /rundown/i)
  assert.match(prompt, /runL/i)
  assert.match(prompt, /attractL/i)
  assert.match(prompt, /defence/i)
  assert.match(prompt, /die/i)
  assert.match(prompt, /climb/i)
  assert.doesNotMatch(prompt, /OCAD/i)
  assert.doesNotMatch(prompt, /exactly 8 columns by 8 rows/i)
  assert.doesNotMatch(prompt, /Rows: idle down\/up/i)
})

test('buildOpenRouterCharacterPrompt accepts the legacy fixed-region motion preset as an alias', () => {
  const prompt = buildOpenRouterCharacterPrompt({
    description: 'hooded merchant',
    preset: LEGACY_OCAD_MOTION_LAYOUT_ID,
  })

  assert.match(prompt, new RegExp(`Profile: ${FIXED_REGION_MOTION_LAYOUT_ID}`))
  assert.match(prompt, /fixed-region motion source layout/i)
})

test('buildOpenRouterCharacterPrompt treats templates as strict structural controls', () => {
  const fixedRegionPrompt = buildOpenRouterCharacterPrompt({
    description: 'hooded merchant',
    preset: FIXED_REGION_MOTION_LAYOUT_ID,
  })
  const gridPrompt = buildOpenRouterCharacterPrompt({
    description: 'hooded merchant',
    preset: 'topdown_rpg_v0',
  })

  for (const prompt of [fixedRegionPrompt, gridPrompt]) {
    assert.match(prompt, /precise pixel art sprite sheet/i)
    assert.match(prompt, /strictly use the provided image as a structural layout template/i)
    assert.match(prompt, /Preserve the exact layout, frame count, grid structure, and poses/i)
    assert.match(prompt, /background must be pure white, pure black, or transparent/i)
    assert.match(prompt, /Clean 16-bit pixel art style, high contrast, strictly flat 2D silhouettes/i)
  }
})

test('buildOpenRouterCharacterPrompt keeps template priority and clean-output constraints', () => {
  const fixedRegionPrompt = buildOpenRouterCharacterPrompt({
    description: 'hooded merchant',
    preset: FIXED_REGION_MOTION_LAYOUT_ID,
  })
  const gridPrompt = buildOpenRouterCharacterPrompt({
    description: 'hooded merchant',
    preset: 'topdown_rpg_v0',
  })

  assert.match(fixedRegionPrompt, /first attached template image as the structural template/i)
  assert.match(fixedRegionPrompt, /body orientation, facing direction, silhouette rhythm/i)
  assert.match(fixedRegionPrompt, /Default to empty hands/i)
  assert.match(fixedRegionPrompt, /do not add ladders, weapons, shields, tools, props/i)
  assert.match(fixedRegionPrompt, /one clean character silhouette/i)
  assert.match(fixedRegionPrompt, /Show motion across frames or regions/i)
  assert.match(fixedRegionPrompt, /Do not include text, numbers, labels, UI/i)
  assert.match(fixedRegionPrompt, /Do not convert this layout into an 8x8 grid/i)
  assert.match(gridPrompt, /Do not reorder rows/i)
  assert.match(gridPrompt, /Do not move cell boundaries/i)
  assert.match(gridPrompt, /Default to empty hands/i)
  assert.match(gridPrompt, /do not add ladders, weapons, shields, tools, props/i)
  assert.match(gridPrompt, /one clean character silhouette/i)
  assert.match(gridPrompt, /Do not include text, numbers, labels, UI/i)
})
