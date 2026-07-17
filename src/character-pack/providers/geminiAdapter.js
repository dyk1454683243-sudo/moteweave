import { compileProviderPrompt } from '../promptContracts.js'
import { DEFAULT_GEMINI_BASE_URL, DEFAULT_GEMINI_MODEL } from './providerConfig.js'
import { imageToInlineDataPart } from './providerImageUtils.js'
import { providerRequestError } from './providerErrors.js'

function buildProviderPromptText({ contract, templateImage, referenceImage, paletteImage }) {
  return compileProviderPrompt({ contract, templateImage, referenceImage, paletteImage })
}

function buildGeminiContents({ contract, templateImage, referenceImage, paletteImage }) {
  const parts = [{ text: buildProviderPromptText({ contract, templateImage, referenceImage, paletteImage }) }]
  const templatePart = imageToInlineDataPart(templateImage)
  if (templatePart) parts.push(templatePart)
  const referencePart = imageToInlineDataPart(referenceImage)
  if (referencePart) parts.push(referencePart)
  const palettePart = imageToInlineDataPart(paletteImage)
  if (palettePart) parts.push(palettePart)
  return [{ role: 'user', parts }]
}

function buildGeminiPromptContents({ prompt, images = [] } = {}) {
  const parts = [{ text: String(prompt || '') }]
  for (const image of images) {
    const part = imageToInlineDataPart(image)
    if (part) parts.push(part)
  }
  return [{ role: 'user', parts }]
}

function geminiModelPath(model) {
  return String(model || DEFAULT_GEMINI_MODEL).startsWith('models/') ? String(model) : `models/${model || DEFAULT_GEMINI_MODEL}`
}

function buildGeminiUrl(providerPreset) {
  const baseUrl = providerPreset.baseUrl || DEFAULT_GEMINI_BASE_URL
  if (baseUrl.includes(':generateContent')) return baseUrl
  return `${baseUrl.replace(/\/+$/, '')}/${geminiModelPath(providerPreset.model)}:generateContent`
}

function supportsGeminiImageSize(model) {
  return String(model || '').startsWith('gemini-3')
}

function buildGeminiGenerationConfig(model, imageConfig = {}, generationOptions = {}) {
  const image = {}
  if (imageConfig.aspect_ratio) image.aspectRatio = imageConfig.aspect_ratio
  if (supportsGeminiImageSize(model) && imageConfig.image_size) image.imageSize = imageConfig.image_size
  return {
    responseModalities: ['TEXT', 'IMAGE'],
    imageConfig: image,
    ...(generationOptions.temperature !== undefined ? { temperature: generationOptions.temperature } : {}),
    ...(generationOptions.topP !== undefined ? { topP: generationOptions.topP } : {}),
    ...(generationOptions.topK !== undefined ? { topK: generationOptions.topK } : {}),
    ...(generationOptions.seed !== undefined ? { seed: generationOptions.seed } : {}),
  }
}

function extractGeminiImageData(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts || payload?.candidates?.[0]?.content?.Parts || payload?.parts || []
  for (const part of parts) {
    const inlineData = part?.inline_data || part?.inlineData
    if (inlineData?.data) {
      return {
        data: inlineData.data,
        mimeType: inlineData.mime_type || inlineData.mimeType || 'image/png',
      }
    }
  }
  return null
}

export async function requestGeminiImage({
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
  const contents = buildGeminiContents({ contract, templateImage, referenceImage, paletteImage })
  return requestGeminiImageContents({ providerPreset, apiKey, imageConfig, generationOptions, contents, fetchImpl })
}

async function requestGeminiImageContents({
  providerPreset,
  apiKey,
  imageConfig,
  generationOptions,
  contents,
  fetchImpl,
}) {
  const body = {
    contents,
    generationConfig: buildGeminiGenerationConfig(providerPreset.model, imageConfig, generationOptions),
  }
  const response = await fetchImpl(buildGeminiUrl(providerPreset), {
    method: 'POST',
    headers: {
      'x-goog-api-key': apiKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw providerRequestError(payload?.error?.message || payload?.message || `Gemini request failed: ${response.status}`, {
      statusCode: response.status,
    })
  }
  const image = extractGeminiImageData(payload)
  if (!image) {
    throw Object.assign(new Error('Gemini response did not include an image'), {
      status: 'failed_model_error',
      retry_hint: 'regenerate',
    })
  }
  return {
    buffer: Buffer.from(image.data, 'base64'),
    prompt: contents[0].parts[0].text,
  }
}

export async function requestGeminiPromptImage({
  providerPreset,
  apiKey,
  prompt,
  imageConfig,
  generationOptions,
  images = [],
  fetchImpl,
}) {
  const contents = buildGeminiPromptContents({ prompt, images })
  return requestGeminiImageContents({ providerPreset, apiKey, imageConfig, generationOptions, contents, fetchImpl })
}
