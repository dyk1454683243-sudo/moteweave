const DEFAULT_OPENROUTER_MODEL = 'google/gemini-2.5-flash-image'
const DEFAULT_OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
export const DEFAULT_GEMINI_MODEL = 'gemini-3.1-flash-image-preview'
export const DEFAULT_GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'
const DEFAULT_PROVIDER_PRESET_ID = 'openrouter-default'
const DEFAULT_GEMINI_PROVIDER_PRESET_ID = 'gemini-default'
const PROVIDER_ALIASES = Object.freeze({
  gemini: 'gemini',
  google: 'gemini',
  google_gemini: 'gemini',
  google_gemini_native: 'gemini',
  openrouter: 'openrouter',
  open_router: 'openrouter',
  openrouter_compatible: 'openrouter',
})

export function supportsGeminiImageSize(model) {
  return String(model || '').replace(/^models\//, '').startsWith('gemini-3')
}

function geminiModelPath(model) {
  return String(model || DEFAULT_GEMINI_MODEL).startsWith('models/')
    ? String(model)
    : `models/${model || DEFAULT_GEMINI_MODEL}`
}

export function buildGeminiGenerateContentUrl(providerPreset = {}) {
  const baseUrl = String(providerPreset.baseUrl || DEFAULT_GEMINI_BASE_URL).trim()
  const modelPath = geminiModelPath(providerPreset.model)
  if (baseUrl.includes(':generateContent')) {
    const endpoint = baseUrl.split(/[?#]/, 1)[0]
    const endpointModelPath = endpoint.match(/(?:^|\/)(models\/[^/]+):generateContent\/?$/)?.[1]
    if (/(?:^|\/)models\//.test(endpoint) && !endpointModelPath) {
      throw new Error('Gemini generateContent endpoint model path is invalid')
    }
    if (endpointModelPath && endpointModelPath !== modelPath) {
      throw new Error('Gemini generateContent endpoint model does not match the provider Preset model')
    }
    return baseUrl
  }
  return `${baseUrl.replace(/\/+$/, '')}/${modelPath}:generateContent`
}

export function normalizeProvider(value) {
  const key = String(value || 'openrouter').trim().toLowerCase().replace(/[\s-]+/g, '_')
  const provider = PROVIDER_ALIASES[key]
  if (!provider) {
    throw new Error('Unsupported character image provider. Supported providers: openrouter, gemini.')
  }
  return provider
}

function getApiKey(env, provider = 'openrouter') {
  if (env.CHARACTER_IMAGE_API_KEY) return env.CHARACTER_IMAGE_API_KEY
  return normalizeProvider(provider) === 'gemini' ? env.GEMINI_API_KEY || '' : env.OPENROUTER_API_KEY || ''
}

function getModel(env, provider = 'openrouter') {
  if (env.CHARACTER_IMAGE_MODEL) return env.CHARACTER_IMAGE_MODEL
  return normalizeProvider(provider) === 'gemini'
    ? env.GEMINI_IMAGE_MODEL || DEFAULT_GEMINI_MODEL
    : env.OPENROUTER_IMAGE_MODEL || env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL
}

function getImageConfig(env, imageConfig = {}, provider = 'openrouter') {
  const isGemini = normalizeProvider(provider) === 'gemini'
  return {
    aspect_ratio:
      imageConfig.aspect_ratio ||
      imageConfig.aspectRatio ||
      env.CHARACTER_IMAGE_ASPECT_RATIO ||
      (isGemini ? env.GEMINI_IMAGE_ASPECT_RATIO : env.OPENROUTER_IMAGE_ASPECT_RATIO) ||
      '1:1',
    image_size:
      imageConfig.image_size ||
      imageConfig.imageSize ||
      env.CHARACTER_IMAGE_SIZE ||
      (isGemini ? env.GEMINI_IMAGE_SIZE : env.OPENROUTER_IMAGE_SIZE) ||
      '2K',
  }
}

export function getExplicitImageConfig(imageConfig = {}) {
  const result = {}
  if (imageConfig.aspect_ratio || imageConfig.aspectRatio) result.aspect_ratio = imageConfig.aspect_ratio || imageConfig.aspectRatio
  if (imageConfig.image_size || imageConfig.imageSize) result.image_size = imageConfig.image_size || imageConfig.imageSize
  return result
}

function safePresetId(value, fallback) {
  return String(value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function readProviderPresetConfig(env) {
  const raw = env.CHARACTER_PROVIDER_PRESETS || env.OPENROUTER_PROVIDER_PRESETS || ''
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      throw new Error('not_array')
    }
    return parsed
  } catch {
    throw new Error('CHARACTER_PROVIDER_PRESETS must be a JSON array of provider presets')
  }
}

function normalizeProviderPreset(input = {}, index = 0, env = process.env) {
  const id = safePresetId(input.id || input.name, `provider-${index + 1}`)
  const provider = normalizeProvider(input.provider || input.providerType || input.provider_type || input.type)
  const explicitApiKeyEnv = input.apiKeyEnv || input.api_key_env || input.keyEnv || input.key_env || ''
  const apiKeyEnv = explicitApiKeyEnv || env.CHARACTER_IMAGE_API_KEY_ENV || ''
  const apiKey = input.apiKey || input.api_key || (apiKeyEnv ? env[apiKeyEnv] : '') || (explicitApiKeyEnv ? '' : getApiKey(env, provider))
  const model = input.model || input.imageModel || input.image_model || getModel(env, provider)
  const label = input.label || input.title || `${provider} · ${model}`
  const baseUrl =
    input.baseUrl ||
    input.base_url ||
    env.CHARACTER_IMAGE_BASE_URL ||
    (provider === 'gemini' ? env.GEMINI_BASE_URL || DEFAULT_GEMINI_BASE_URL : env.OPENROUTER_BASE_URL || DEFAULT_OPENROUTER_URL)
  const imageConfig = getImageConfig(env, {
    aspect_ratio: input.aspect_ratio || input.aspectRatio,
    image_size: input.image_size || input.imageSize,
  }, provider)
  return {
    id,
    label,
    provider,
    routeKind: provider === 'gemini' ? 'google_native' : 'openrouter',
    supportsSystemInstruction: provider === 'gemini',
    supportsRoleInterleaving: provider === 'gemini',
    supportsImageSize: provider === 'gemini' && supportsGeminiImageSize(model),
    apiKey,
    apiKeyEnv: apiKeyEnv || (provider === 'gemini' ? 'GEMINI_API_KEY' : 'OPENROUTER_API_KEY'),
    baseUrl,
    model,
    imageConfig,
    siteUrl: input.siteUrl || input.site_url || env.OPENROUTER_SITE_URL || 'http://localhost:4173',
    appName: input.appName || input.app_name || env.OPENROUTER_APP_NAME || 'MoteWeave',
    available: Boolean(apiKey),
  }
}

function defaultProviderFromEnv(env = process.env) {
  if (env.CHARACTER_IMAGE_PROVIDER) return normalizeProvider(env.CHARACTER_IMAGE_PROVIDER)
  if (env.CHARACTER_PROVIDER_TYPE) return normalizeProvider(env.CHARACTER_PROVIDER_TYPE)
  if (env.GEMINI_API_KEY && !env.OPENROUTER_API_KEY) return 'gemini'
  return 'openrouter'
}

function defaultProviderPreset(env = process.env) {
  const provider = defaultProviderFromEnv(env)
  const defaultId = provider === 'gemini' ? DEFAULT_GEMINI_PROVIDER_PRESET_ID : DEFAULT_PROVIDER_PRESET_ID
  return normalizeProviderPreset(
    {
      id: env.CHARACTER_IMAGE_PRESET_ID || defaultId,
      label: env.CHARACTER_IMAGE_PROVIDER_LABEL || (provider === 'gemini' ? 'Gemini default' : env.OPENROUTER_PROVIDER_LABEL || 'OpenRouter default'),
      provider,
      apiKey: env.CHARACTER_IMAGE_API_KEY,
      apiKeyEnv: env.CHARACTER_IMAGE_API_KEY_ENV || (provider === 'gemini' ? 'GEMINI_API_KEY' : 'OPENROUTER_API_KEY'),
      model: getModel(env, provider),
      baseUrl: env.CHARACTER_IMAGE_BASE_URL || (provider === 'gemini' ? env.GEMINI_BASE_URL || DEFAULT_GEMINI_BASE_URL : env.OPENROUTER_BASE_URL || DEFAULT_OPENROUTER_URL),
      aspect_ratio: env.CHARACTER_IMAGE_ASPECT_RATIO || (provider === 'gemini' ? env.GEMINI_IMAGE_ASPECT_RATIO : env.OPENROUTER_IMAGE_ASPECT_RATIO) || '1:1',
      image_size: env.CHARACTER_IMAGE_SIZE || (provider === 'gemini' ? env.GEMINI_IMAGE_SIZE : env.OPENROUTER_IMAGE_SIZE) || '2K',
      siteUrl: env.OPENROUTER_SITE_URL || 'http://localhost:4173',
      appName: env.OPENROUTER_APP_NAME || 'MoteWeave',
    },
    0,
    env
  )
}

export function getProviderPresets(env = process.env) {
  const configured = readProviderPresetConfig(env).map((preset, index) => normalizeProviderPreset(preset, index, env))
  return configured.length ? configured : [defaultProviderPreset(env)]
}

export function resolveProviderPreset(env = process.env, presetId = '') {
  const presets = getProviderPresets(env)
  const defaultId = env.CHARACTER_DEFAULT_PROVIDER || env.OPENROUTER_DEFAULT_PROVIDER || presets[0]?.id
  const requestedId = safePresetId(presetId || defaultId, defaultId)
  const requested = presets.find((preset) => preset.id === requestedId)
  if (String(presetId || '').trim() && !requested) {
    throw new Error(`Unknown character provider preset: ${requestedId}`)
  }
  return requested || presets.find((preset) => preset.id === defaultId) || presets[0]
}

function publicProviderPreset(preset) {
  return {
    id: preset.id,
    label: preset.label,
    provider: preset.provider,
    route_kind: preset.routeKind,
    model: preset.model,
    available: preset.available,
    image_config: preset.imageConfig,
    supports_system_instruction: preset.supportsSystemInstruction,
    supports_role_interleaving: preset.supportsRoleInterleaving,
    supports_image_size: preset.supportsImageSize,
  }
}

export function getGeminiProviderState(env = process.env) {
  try {
    const presets = getProviderPresets(env)
    const active = resolveProviderPreset(env)
    return {
      available: presets.some((preset) => preset.available),
      implemented: true,
      status: presets.some((preset) => preset.available) ? 'ready' : 'missing_credentials',
      provider: active?.provider || 'openrouter',
      model: active?.model || getModel(env),
      active_preset_id: active?.id || DEFAULT_PROVIDER_PRESET_ID,
      presets: presets.map(publicProviderPreset),
    }
  } catch (error) {
    return {
      available: false,
      implemented: true,
      status: 'configuration_error',
      provider: null,
      model: null,
      active_preset_id: null,
      presets: [],
      error: String(error.message || error),
    }
  }
}
