import { requestGeminiPromptImage } from '../character-pack/providers/geminiAdapter.js'
import { requestOpenRouterPromptImage } from '../character-pack/providers/openRouterAdapter.js'
import { getProviderPresets } from '../character-pack/providers/providerConfig.js'
import { FrameRepairError } from './frameRepairProtocol.js'

const MAX_PROVIDER_OUTPUT_BYTES = 32 * 1024 * 1024
const MAX_REFERENCE_IMAGES = 4
const MAX_REFERENCE_BYTES = 32 * 1024 * 1024
const REFERENCE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])
const CONTROL_CHARACTER_PATTERN = /\p{Cc}/u
const SAFE_REFERENCE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/

function providerError(code, message) {
  return new FrameRepairError(code, message)
}

function normalizedInstruction(plan) {
  const instruction = plan?.instruction
  if (typeof instruction !== 'string' || CONTROL_CHARACTER_PATTERN.test(instruction)) {
    throw providerError('invalid_frame_repair_plan', 'approved repair instruction is invalid')
  }
  const normalized = instruction.normalize('NFC').trim()
  if (normalized.length === 0 || [...normalized].length > 500) {
    throw providerError('invalid_frame_repair_plan', 'approved repair instruction is invalid')
  }
  return normalized
}

function projectImageConfig(plan) {
  const imageConfig = plan?.provider?.image_config
  if (!imageConfig || typeof imageConfig !== 'object' || Array.isArray(imageConfig) ||
      (imageConfig.image_size !== '1K' && imageConfig.image_size !== '2K') ||
      typeof imageConfig.aspect_ratio !== 'string' || imageConfig.aspect_ratio.trim().length === 0 ||
      CONTROL_CHARACTER_PATTERN.test(imageConfig.aspect_ratio)) {
    throw providerError('invalid_frame_repair_plan', 'approved provider image configuration is invalid')
  }
  return {
    image_size: imageConfig.image_size,
    aspect_ratio: imageConfig.aspect_ratio.trim(),
  }
}

function projectReferenceImages(referenceImages) {
  if (!Array.isArray(referenceImages) || referenceImages.length > MAX_REFERENCE_IMAGES) {
    throw providerError('invalid_frame_repair_reference', 'frame repair references are invalid')
  }
  let totalBytes = 0
  return referenceImages.map((image) => {
    const mimeType = image?.mimeType ?? image?.mime_type
    if (!image || typeof image !== 'object' ||
        typeof image.name !== 'string' || !SAFE_REFERENCE_NAME_PATTERN.test(image.name) ||
        image.name === '.' || image.name === '..' ||
        !REFERENCE_MIME_TYPES.has(mimeType) ||
        !Buffer.isBuffer(image.buffer) || image.buffer.length === 0) {
      throw providerError('invalid_frame_repair_reference', 'frame repair references are invalid')
    }
    totalBytes += image.buffer.length
    if (image.buffer.length > MAX_REFERENCE_BYTES || totalBytes > MAX_REFERENCE_BYTES) {
      throw providerError('invalid_frame_repair_reference', 'frame repair references exceed the byte limit')
    }
    return {
      name: image.name,
      mimeType,
      buffer: Buffer.from(image.buffer),
    }
  })
}

export function resolveExactFrameRepairProvider(env, presetId) {
  let presets
  try {
    presets = getProviderPresets(env)
    if (!Array.isArray(presets)) throw new Error('invalid provider preset list')
    const ids = new Set()
    for (const preset of presets) {
      if (!preset || typeof preset.id !== 'string' || ids.has(preset.id)) {
        throw new Error('ambiguous provider preset configuration')
      }
      ids.add(preset.id)
    }
  } catch {
    throw providerError('provider_configuration_error', 'provider preset configuration is invalid')
  }

  const preset = typeof presetId === 'string'
    ? presets.find((item) => item.id === presetId)
    : null
  if (!preset || preset.available !== true || typeof preset.apiKey !== 'string' || preset.apiKey.length === 0) {
    throw providerError('provider_unavailable', 'selected provider preset is unavailable')
  }
  return preset
}

export function buildFrameRepairPrompt(plan) {
  const instruction = normalizedInstruction(plan)
  return [
    'Repair one isolated transparent pixel-art character frame.',
    `Approved repair instruction: ${instruction}`,
    'Preserve the referenced character identity, action, facing, scale, palette, outline weight, lighting, and pixel density.',
    'The first input image is the output-layout authority. Return one character at the same scale, position, facing, and canvas alignment.',
    'The second input image is the approved mask visualization for scope only. Do not reproduce its magenta overlay or dimmed exterior.',
    'The third input image contains at most one adjacent clip frame for identity and motion continuity only. Do not output that reference pose.',
    'Return exactly one single-subject character frame with a transparent background. Never return a sheet, grid, contact sheet, multiple poses, repeated characters, scene, text, border, checkerboard, colored mask background, watermark, duplicated anatomy, or motion trail. Include no prop unless the approved instruction explicitly requires it.',
    'Local processing will composite pixels only inside the approved mask.',
  ].join('\n')
}

export async function requestFrameRepairCandidate({
  providerPreset,
  plan,
  referenceImages,
  fetchImpl = globalThis.fetch,
  requestByProvider = {
    gemini: requestGeminiPromptImage,
    openrouter: requestOpenRouterPromptImage,
  },
} = {}) {
  if (!providerPreset || providerPreset.available !== true ||
      typeof providerPreset.apiKey !== 'string' || providerPreset.apiKey.length === 0) {
    throw providerError('provider_unavailable', 'selected provider runtime is unavailable')
  }
  const request = requestByProvider?.[providerPreset.provider]
  if (typeof request !== 'function') {
    throw providerError('provider_unavailable', 'selected provider adapter is unavailable')
  }

  const prompt = buildFrameRepairPrompt(plan)
  const imageConfig = projectImageConfig(plan)
  const images = projectReferenceImages(referenceImages)
  const generated = await request({
    providerPreset,
    apiKey: providerPreset.apiKey,
    prompt,
    imageConfig,
    images,
    fetchImpl,
  })
  if (!Buffer.isBuffer(generated?.buffer) || generated.buffer.length === 0 ||
      generated.buffer.length > MAX_PROVIDER_OUTPUT_BYTES) {
    throw providerError('provider_output_invalid', 'provider returned an invalid image payload')
  }

  return {
    provider: providerPreset.provider,
    provider_preset_id: providerPreset.id,
    provider_label: providerPreset.label,
    model: providerPreset.model,
    image_config: imageConfig,
    prompt,
    buffer: Buffer.from(generated.buffer),
  }
}
