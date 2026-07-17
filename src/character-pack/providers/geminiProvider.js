import {
  buildCharacterPromptContract,
  compileCharacterPromptContract,
  summarizePromptContract,
} from '../promptContracts.js'
import { DEFAULT_GENERATION_PRESET } from '../generationDefaults.js'
import {
  buildQualityCharacterPrompt,
  normalizeCharacterT2iPreset,
  normalizeGenerationOptions,
  normalizePromptFields,
  normalizeTextToImageMode,
  providerGenerationOptions,
  summarizeQualityPromptContract,
  TEXT_TO_IMAGE_MODE_PRODUCTION_SHEET,
  TEXT_TO_IMAGE_MODE_QUALITY_CHARACTER,
} from '../textToImagePrompt.js'
import { requestGeminiImage, requestGeminiPromptImage } from './geminiAdapter.js'
import { requestOpenRouterImage, requestOpenRouterPromptImage } from './openRouterAdapter.js'
import { providerErrorFailureStatus } from './providerErrors.js'
import {
  getExplicitImageConfig,
  getGeminiProviderState,
  getProviderPresets,
  resolveProviderPreset,
} from './providerConfig.js'
import { prepareTemplateImageForProvider } from './providerImageUtils.js'

export { getGeminiProviderState, getProviderPresets, resolveProviderPreset }

export function buildOpenRouterCharacterPrompt({ description = '', preset = DEFAULT_GENERATION_PRESET } = {}) {
  return compileCharacterPromptContract(buildCharacterPromptContract({ description, preset }))
}

function generationResult({
  buffer,
  providerPreset,
  prompt,
  promptContract,
  templateImage,
  referenceImage,
  paletteImage,
  t2iMode,
  characterPreset,
  promptFields,
  generationOptions,
  candidateIndex,
  providerAttempts = [],
}) {
  return {
    buffer,
    provider: providerPreset.provider,
    providerPresetId: providerPreset.id,
    providerLabel: providerPreset.label,
    model: providerPreset.model,
    prompt,
    promptContract,
    t2iMode,
    characterPreset,
    promptFields,
    generationOptions,
    candidateIndex,
    inputImages: {
      template: Boolean(templateImage?.buffer),
      reference: Boolean(referenceImage?.buffer),
      palette: Boolean(paletteImage?.buffer),
    },
    templateName: templateImage?.name ?? null,
    referenceName: referenceImage?.name ?? null,
    paletteName: paletteImage?.name ?? null,
    providerAttempts,
  }
}

function requireProviderRuntime(providerPreset, fetchImpl) {
  const apiKey = providerPreset?.apiKey || ''
  if (!apiKey) {
    const keyHint = providerPreset?.apiKeyEnv || 'OPENROUTER_API_KEY'
    throw Object.assign(new Error(`${keyHint} is not configured for ${providerPreset?.label || 'the selected provider'}`), {
      status: 'failed_model_error',
      retry_hint: 'manual_inspect',
    })
  }
  if (!fetchImpl) {
    throw Object.assign(new Error('fetch is unavailable in this runtime'), {
      status: 'failed_model_error',
      retry_hint: 'manual_inspect',
    })
  }
  return apiKey
}

function explicitProviderPresetId(value) {
  return String(value || '').trim().length > 0
}

function providerPresetCandidates(env, providerPresetId) {
  const primary = resolveProviderPreset(env, providerPresetId)
  if (explicitProviderPresetId(providerPresetId)) return [primary]
  const allowCrossProviderFallback = env.CHARACTER_ALLOW_CROSS_PROVIDER_FALLBACK === '1'
  return [
    primary,
    ...getProviderPresets(env).filter((preset) => (
      preset.id !== primary.id &&
      preset.available &&
      (allowCrossProviderFallback || preset.provider === primary.provider)
    )),
  ]
}

function providerAttempt(providerPreset, { status, error } = {}) {
  return {
    provider: providerPreset?.provider ?? null,
    provider_preset_id: providerPreset?.id ?? null,
    provider_label: providerPreset?.label ?? null,
    model: providerPreset?.model ?? null,
    status,
    error: error ? String(error.message || error) : null,
    retry_hint: error?.retry_hint ?? null,
    failure_status: providerErrorFailureStatus(error),
  }
}

function consumeProviderBudget(providerBudget) {
  if (!providerBudget) return null
  const max = Number(providerBudget.max ?? providerBudget.maxProviderCalls ?? 0)
  const used = Number(providerBudget.used ?? providerBudget.providerCallsUsed ?? 0)
  if (!Number.isInteger(max) || max < 1) return null
  if (used >= max) {
    throw Object.assign(new Error(`Provider call budget exhausted: used ${used}/${max}`), {
      status: 'failed_budget_exhausted',
      retry_hint: 'increase_max_provider_calls',
    })
  }
  providerBudget.used = used + 1
  providerBudget.providerCallsUsed = providerBudget.used
  return {
    used: providerBudget.used,
    max,
  }
}

export async function generateCharacterSource({
  description,
  preset = DEFAULT_GENERATION_PRESET,
  providerPresetId = '',
  imageConfig = {},
  generationOptions = {},
  candidateIndex = 1,
  t2iMode = TEXT_TO_IMAGE_MODE_PRODUCTION_SHEET,
  characterPreset,
  promptFields = {},
  backgroundMode = 'auto',
  templateImage = null,
  referenceImage = null,
  paletteImage = null,
  providerBudget = null,
  env = process.env,
  fetchImpl = globalThis.fetch,
} = {}) {
  const resolvedMode = normalizeTextToImageMode(t2iMode)
  const resolvedGenerationOptions = normalizeGenerationOptions(generationOptions)
  const resolvedProviderGenerationOptions = providerGenerationOptions(resolvedGenerationOptions, candidateIndex)
  const resolvedPromptFields = normalizePromptFields(promptFields)
  const resolvedCharacterPreset = normalizeCharacterT2iPreset(characterPreset)
  const providerPresets = providerPresetCandidates(env, providerPresetId)
  const attempts = []
  let lastError = null

  for (const providerPreset of providerPresets) {
    try {
      const apiKey = requireProviderRuntime(providerPreset, fetchImpl)
      const resolvedImageConfig = {
        ...providerPreset.imageConfig,
        ...getExplicitImageConfig(imageConfig),
      }
      let generated
      let promptContract
      let providerTemplateImage = templateImage
      if (resolvedMode === TEXT_TO_IMAGE_MODE_QUALITY_CHARACTER) {
        const prompt = buildQualityCharacterPrompt({
          description,
          promptFields: resolvedPromptFields,
          characterPreset: resolvedCharacterPreset.id,
          backgroundMode,
        })
        promptContract = summarizeQualityPromptContract({
          characterPreset: resolvedCharacterPreset.id,
          promptFields: resolvedPromptFields,
          backgroundMode,
        })
        const request = {
          providerPreset,
          apiKey,
          prompt,
          imageConfig: resolvedImageConfig,
          generationOptions: resolvedProviderGenerationOptions,
          images: [referenceImage, paletteImage].filter((image) => image?.buffer),
          fetchImpl,
        }
        providerTemplateImage = null
        consumeProviderBudget(providerBudget)
        generated = providerPreset.provider === 'gemini'
          ? await requestGeminiPromptImage(request)
          : await requestOpenRouterPromptImage(request)
      } else {
        const contract = buildCharacterPromptContract({
          description,
          preset,
          promptFields: resolvedPromptFields,
          characterPreset: resolvedCharacterPreset.id,
          backgroundMode,
          t2iMode: resolvedMode,
        })
        promptContract = summarizePromptContract(contract)
        providerTemplateImage = await prepareTemplateImageForProvider(templateImage, {
          imageConfig: resolvedImageConfig,
          contract,
        })
        const request = {
          providerPreset,
          apiKey,
          contract,
          imageConfig: resolvedImageConfig,
          generationOptions: resolvedProviderGenerationOptions,
          templateImage: providerTemplateImage,
          referenceImage,
          paletteImage,
          fetchImpl,
        }
        consumeProviderBudget(providerBudget)
        generated = providerPreset.provider === 'gemini'
          ? await requestGeminiImage(request)
          : await requestOpenRouterImage(request)
      }

      attempts.push(providerAttempt(providerPreset, { status: 'success' }))
      return generationResult({
        ...generated,
        providerPreset,
        promptContract,
        templateImage: providerTemplateImage,
        referenceImage,
        paletteImage,
        t2iMode: resolvedMode,
        characterPreset: resolvedCharacterPreset.id,
        promptFields: resolvedPromptFields,
        generationOptions: {
          ...resolvedGenerationOptions,
          provider: resolvedProviderGenerationOptions,
        },
        candidateIndex,
        providerAttempts: attempts,
      })
    } catch (error) {
      lastError = error
      attempts.push(providerAttempt(providerPreset, { status: 'failed', error }))
    }
  }

  if (lastError) lastError.providerAttempts = attempts
  throw lastError ?? new Error('No provider presets are configured')
}
