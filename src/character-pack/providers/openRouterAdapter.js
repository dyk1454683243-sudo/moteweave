import { compileProviderPrompt } from '../promptContracts.js'
import { imageToDataUrl } from './providerImageUtils.js'
import { providerRequestError } from './providerErrors.js'

const DEFAULT_OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

function buildProviderPromptText({ contract, templateImage, referenceImage, paletteImage }) {
  return compileProviderPrompt({ contract, templateImage, referenceImage, paletteImage })
}

function buildOpenRouterContent({ contract, templateImage, referenceImage, paletteImage }) {
  const hasImages = Boolean(templateImage?.buffer || referenceImage?.buffer || paletteImage?.buffer)
  const text = buildProviderPromptText({ contract, templateImage, referenceImage, paletteImage })
  if (!hasImages) return text

  const content = [{ type: 'text', text }]
  const templateUrl = imageToDataUrl(templateImage)
  if (templateUrl) content.push({ type: 'image_url', image_url: { url: templateUrl } })
  const referenceUrl = imageToDataUrl(referenceImage)
  if (referenceUrl) content.push({ type: 'image_url', image_url: { url: referenceUrl } })
  const paletteUrl = imageToDataUrl(paletteImage)
  if (paletteUrl) content.push({ type: 'image_url', image_url: { url: paletteUrl } })
  return content
}

function openRouterGenerationBodyOptions(generationOptions = {}) {
  return {
    ...(generationOptions.temperature !== undefined ? { temperature: generationOptions.temperature } : {}),
    ...(generationOptions.topP !== undefined ? { top_p: generationOptions.topP } : {}),
    ...(generationOptions.topK !== undefined ? { top_k: generationOptions.topK } : {}),
    ...(generationOptions.seed !== undefined ? { seed: generationOptions.seed } : {}),
  }
}

function buildOpenRouterPromptContent({ prompt, images = [] } = {}) {
  const text = String(prompt || '')
  const validImages = images.filter((image) => image?.buffer)
  if (!validImages.length) return text
  return [
    { type: 'text', text },
    ...validImages.map((image) => ({ type: 'image_url', image_url: { url: imageToDataUrl(image) } })),
  ]
}

function getPromptText(content) {
  return Array.isArray(content) ? content.find((part) => part.type === 'text')?.text ?? '' : content
}

function extractImageDataUrl(payload) {
  const message = payload?.choices?.[0]?.message ?? payload?.message ?? payload
  const imageUrl = message?.images?.[0]?.image_url?.url ?? message?.images?.[0]?.imageUrl?.url
  if (typeof imageUrl === 'string' && imageUrl.startsWith('data:image/')) return imageUrl
  if (Array.isArray(message?.content)) {
    for (const part of message.content) {
      const url = part?.image_url?.url ?? part?.imageUrl?.url
      if (typeof url === 'string' && url.startsWith('data:image/')) return url
    }
  }
  if (typeof message?.content === 'string') {
    const match = message.content.match(/data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/)
    if (match) return match[0]
  }
  return null
}

function dataUrlToBuffer(dataUrl) {
  const [, base64] = dataUrl.split(',', 2)
  if (!base64) throw new Error('Image response did not contain base64 data')
  return Buffer.from(base64, 'base64')
}

export async function requestOpenRouterImage({
  providerPreset,
  apiKey,
  contract,
  imageConfig,
  generationOptions,
  templateImage,
  referenceImage,
  paletteImage,
  fetchImpl,
}) {
  const content = buildOpenRouterContent({ contract, templateImage, referenceImage, paletteImage })
  return requestOpenRouterImageContent({ providerPreset, apiKey, content, imageConfig, generationOptions, fetchImpl })
}

async function requestOpenRouterImageContent({
  providerPreset,
  apiKey,
  content,
  imageConfig,
  generationOptions,
  fetchImpl,
}) {
  const body = {
    model: providerPreset.model,
    modalities: ['image', 'text'],
    stream: false,
    image_config: imageConfig,
    ...openRouterGenerationBodyOptions(generationOptions),
    messages: [
      {
        role: 'user',
        content,
      },
    ],
  }
  const response = await fetchImpl(providerPreset.baseUrl || DEFAULT_OPENROUTER_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
      'http-referer': providerPreset.siteUrl || 'http://localhost:4173',
      'x-title': providerPreset.appName || 'MoteWeave',
    },
    body: JSON.stringify(body),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw providerRequestError(payload?.error?.message || payload?.message || `OpenRouter request failed: ${response.status}`, {
      statusCode: response.status,
    })
  }
  const dataUrl = extractImageDataUrl(payload)
  if (!dataUrl) {
    throw Object.assign(new Error('OpenRouter response did not include an image'), {
      status: 'failed_model_error',
      retry_hint: 'regenerate',
    })
  }
  return {
    buffer: dataUrlToBuffer(dataUrl),
    prompt: getPromptText(content),
  }
}

export async function requestOpenRouterPromptImage({
  providerPreset,
  apiKey,
  prompt,
  imageConfig,
  generationOptions,
  images = [],
  fetchImpl,
}) {
  const content = buildOpenRouterPromptContent({ prompt, images })
  return requestOpenRouterImageContent({ providerPreset, apiKey, content, imageConfig, generationOptions, fetchImpl })
}
