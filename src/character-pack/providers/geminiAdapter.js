import { buildProviderPromptSections, compileProviderPrompt } from '../promptContracts.js'
import {
  buildGeminiGenerateContentUrl,
  supportsGeminiImageSize,
} from './providerConfig.js'
import { imageToInlineDataPart } from './providerImageUtils.js'
import { providerRequestError } from './providerErrors.js'

function buildGeminiContents({ contract, templateImage, referenceImage, paletteImage, promptSections = null }) {
  if (!promptSections) {
    const prompt = compileProviderPrompt({ contract, templateImage, referenceImage, paletteImage })
    const parts = [{ text: prompt }]
    for (const image of [templateImage, referenceImage, paletteImage]) {
      const imagePart = imageToInlineDataPart(image)
      if (imagePart) parts.push(imagePart)
    }
    return {
      contents: [{ role: 'user', parts }],
      systemInstruction: null,
      prompt,
    }
  }
  const sections = promptSections
  const images = {
    structure: templateImage,
    identity: referenceImage,
    palette: paletteImage,
  }
  const parts = []
  for (const part of sections.content_parts ?? []) {
    if (part.type === 'text') {
      parts.push({ text: String(part.text ?? '') })
      continue
    }
    if (part.type === 'image') {
      const imagePart = imageToInlineDataPart(images[part.role])
      if (!imagePart) throw new Error(`Gemini prompt is missing its ${part.role} image`)
      parts.push(imagePart)
    }
  }
  return {
    contents: [{ role: 'user', parts }],
    systemInstruction: sections.system_instruction
      ? { parts: [{ text: String(sections.system_instruction) }] }
      : null,
    prompt: [
      sections.system_instruction,
      ...(sections.content_parts ?? []).filter((part) => part.type === 'text').map((part) => part.text),
    ].filter(Boolean).join('\n'),
  }
}

function buildGeminiPromptContents({ prompt, images = [] } = {}) {
  const parts = [{ text: String(prompt || '') }]
  for (const image of images) {
    const part = imageToInlineDataPart(image)
    if (part) parts.push(part)
  }
  return [{ role: 'user', parts }]
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
        mimeType: inlineData.mime_type || inlineData.mimeType || null,
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
  promptSections = null,
  fetchImpl,
}) {
  const request = buildGeminiContents({
    contract,
    templateImage,
    referenceImage,
    paletteImage,
    promptSections,
  })
  return requestGeminiImageContents({
    providerPreset,
    apiKey,
    imageConfig,
    generationOptions,
    ...request,
    fetchImpl,
  })
}

async function requestGeminiImageContents({
  providerPreset,
  apiKey,
  imageConfig,
  generationOptions,
  contents,
  systemInstruction = null,
  prompt = null,
  fetchImpl,
}) {
  const body = {
    contents,
    ...(systemInstruction ? { systemInstruction } : {}),
    generationConfig: buildGeminiGenerationConfig(providerPreset.model, imageConfig, generationOptions),
  }
  const response = await fetchImpl(buildGeminiGenerateContentUrl(providerPreset), {
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
    mimeType: image.mimeType,
    prompt: prompt ?? contents[0].parts[0].text,
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
  return requestGeminiImageContents({ providerPreset, apiKey, imageConfig, generationOptions, contents, prompt, fetchImpl })
}
