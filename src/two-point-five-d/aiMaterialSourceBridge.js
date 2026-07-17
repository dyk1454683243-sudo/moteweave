import {
  providerGenerationOptions,
  normalizeGenerationOptions,
} from '../character-pack/textToImagePrompt.js'
import { requestGeminiPromptImage } from '../character-pack/providers/geminiAdapter.js'
import { requestOpenRouterPromptImage } from '../character-pack/providers/openRouterAdapter.js'
import { providerErrorFailureStatus } from '../character-pack/providers/providerErrors.js'
import {
  getExplicitImageConfig,
  getProviderPresets,
  resolveProviderPreset,
} from '../character-pack/providers/providerConfig.js'
import {
  buildTwoPointFiveDMaterialSourcePromptContract,
  compileTwoPointFiveDMaterialSourcePromptContract,
  summarizeTwoPointFiveDMaterialSourcePromptContract,
} from './materialSourcePromptContract.js'

export const TWO_POINT_FIVE_D_AI_MATERIAL_SOURCE_BRIDGE_MODE = 'two_point_five_d_ai_material_source_bridge_v1'

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

function providerCallBudgetSummary(providerBudget) {
  if (!providerBudget) return null
  const max = Number(providerBudget.max ?? providerBudget.maxProviderCalls ?? 0)
  const used = Number(providerBudget.used ?? providerBudget.providerCallsUsed ?? 0)
  if (!Number.isInteger(max) || max < 1) return null
  return {
    planned_provider_calls: 1,
    max_provider_calls: max,
    used_provider_calls: Number.isInteger(used) ? used : 0,
  }
}

function resolvedSourceImageConfig(providerPreset, imageConfig = {}) {
  const explicit = getExplicitImageConfig(imageConfig)
  return {
    ...providerPreset.imageConfig,
    ...explicit,
    aspect_ratio: explicit.aspect_ratio || providerPreset.imageConfig?.aspect_ratio || '1:1',
  }
}

function bridgeReport({
  providerPreset,
  prompt,
  promptContract,
  imageConfig,
  generationOptions,
  providerBudget,
  providerAttempts,
  generated,
}) {
  const promptContractSummary = summarizeTwoPointFiveDMaterialSourcePromptContract(promptContract)
  return {
    schema_version: 1,
    mode: TWO_POINT_FIVE_D_AI_MATERIAL_SOURCE_BRIDGE_MODE,
    status: 'pass',
    source_role: 'raw_material_source_not_clean_atlas',
    provider: providerPreset.provider,
    provider_preset_id: providerPreset.id,
    provider_label: providerPreset.label,
    model: providerPreset.model,
    image_config: imageConfig,
    generation_options: generationOptions,
    provider_call_budget: providerCallBudgetSummary(providerBudget),
    provider_attempts: providerAttempts,
    prompt_contract: promptContractSummary,
    prompt,
    generated_source: {
      role: 'raw_material_source',
      byte_length: generated.buffer.length,
      suggested_file: 'provider_material_source.png',
      direct_asset_use_allowed: false,
    },
    pipeline_handoff: {
      normalizer: promptContractSummary.downstream_pipeline.normalizer,
      material_builder: promptContractSummary.downstream_pipeline.material_builder,
      rule_aware_composer: promptContractSummary.downstream_pipeline.rule_aware_composer,
      validator: promptContractSummary.downstream_pipeline.validator,
      exporter: promptContractSummary.downstream_pipeline.exporter,
      final_atlas_structure_owner: 'local_deterministic_pipeline',
    },
    claim_boundary: promptContractSummary.claim_boundary,
  }
}

function promptImageRequester(providerPreset, injected) {
  if (injected) return injected
  return providerPreset.provider === 'gemini'
    ? requestGeminiPromptImage
    : requestOpenRouterPromptImage
}

export async function generateTwoPointFiveDMaterialSource({
  description = '',
  promptFields = {},
  contract = {},
  providerPresetId = '',
  imageConfig = {},
  generationOptions = {},
  providerBudget = null,
  env = process.env,
  fetchImpl = globalThis.fetch,
  requestPromptImage = null,
} = {}) {
  const promptContract = buildTwoPointFiveDMaterialSourcePromptContract({ description, promptFields, contract })
  const prompt = compileTwoPointFiveDMaterialSourcePromptContract(promptContract)
  const resolvedGenerationOptions = normalizeGenerationOptions({
    ...generationOptions,
    candidateCount: 1,
  })
  const resolvedProviderGenerationOptions = providerGenerationOptions(resolvedGenerationOptions, 1)
  const providerPresets = providerPresetCandidates(env, providerPresetId)
  const attempts = []
  let lastError = null

  for (const providerPreset of providerPresets) {
    try {
      const apiKey = requireProviderRuntime(providerPreset, fetchImpl)
      const resolvedImage = resolvedSourceImageConfig(providerPreset, imageConfig)
      const requester = promptImageRequester(providerPreset, requestPromptImage)
      consumeProviderBudget(providerBudget)
      const generated = await requester({
        providerPreset,
        apiKey,
        prompt,
        imageConfig: resolvedImage,
        generationOptions: resolvedProviderGenerationOptions,
        images: [],
        fetchImpl,
      })
      attempts.push(providerAttempt(providerPreset, { status: 'success' }))
      return {
        buffer: generated.buffer,
        report: bridgeReport({
          providerPreset,
          prompt: generated.prompt || prompt,
          promptContract,
          imageConfig: resolvedImage,
          generationOptions: {
            ...resolvedGenerationOptions,
            provider: resolvedProviderGenerationOptions,
          },
          providerBudget,
          providerAttempts: attempts,
          generated,
        }),
      }
    } catch (error) {
      lastError = error
      attempts.push(providerAttempt(providerPreset, { status: 'failed', error }))
    }
  }

  if (lastError) lastError.providerAttempts = attempts
  throw lastError ?? new Error('No provider presets are configured')
}
