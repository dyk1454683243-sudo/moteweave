import { createHash } from 'node:crypto'

import {
  buildFullSheetCharacterPromptContract,
  buildProviderPromptSections,
  summarizePromptContract,
} from './promptContracts.js'
import {
  BACKGROUND_RECIPE_IDS,
  resolveBackgroundMode,
} from './backgroundProcessingContract.js'
import { buildGeminiGenerateContentUrl } from './providers/providerConfig.js'

export const GENERATION_REVIEW_PROTOCOL = 'full_sheet_generation_review_v1'
export const GENERATION_REQUEST_MANIFEST_FILE = 'generation_request_manifest.json'
export const GENERATION_REFERENCE_MANIFEST_FILE = 'generation_reference_manifest.json'
export const GENERATION_REVIEW_FILE = 'generation_review.json'
export const GENERATION_PROMPT_FILE = 'generation_prompt.txt'

export const GENERATION_REFERENCE_ROLE_ORDER = Object.freeze([
  'structure',
  'identity',
  'palette',
])

const HASH_PATTERN = /^[a-f0-9]{64}$/
const ID_PATTERN = /^[A-Za-z0-9._-]{1,120}$/

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!isPlainObject(value)) return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
}

export function stableGenerationReviewJson(value) {
  return JSON.stringify(canonicalize(value))
}

export function sha256GenerationBytes(value) {
  return createHash('sha256').update(Buffer.isBuffer(value) ? value : Buffer.from(value)).digest('hex')
}

export function hashGenerationReviewValue(value) {
  return sha256GenerationBytes(Buffer.from(stableGenerationReviewJson(value), 'utf8'))
}

function assertSafeId(value, label) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value) || value.includes('..')) {
    throw new Error(`${label} is invalid`)
  }
  return value
}

function assertHash(value, label) {
  if (typeof value !== 'string' || !HASH_PATTERN.test(value)) throw new Error(`${label} is invalid`)
  return value
}

function publicProvider(providerPreset) {
  return {
    preset_id: providerPreset.id,
    provider: providerPreset.provider,
    route_kind: providerPreset.routeKind,
    model: providerPreset.model,
    image_config: { ...providerPreset.imageConfig },
    supports_system_instruction: providerPreset.supportsSystemInstruction === true,
    supports_role_interleaving: providerPreset.supportsRoleInterleaving === true,
    supports_image_size: providerPreset.supportsImageSize === true,
    provider_endpoint_sha256: sha256GenerationBytes(Buffer.from(buildGeminiGenerateContentUrl(providerPreset), 'utf8')),
  }
}

function referenceManifest(profile, references) {
  const items = references.map((image, index) => ({
    order: index + 1,
    name: image.name,
    role: image.role,
    width: image.width,
    height: image.height,
    mime_type: image.mimeType,
    byte_length: image.buffer.byteLength,
    sha256: sha256GenerationBytes(image.buffer),
    original_input: image.source,
    derivation: image.report,
  }))
  return {
    schema_version: 1,
    protocol: 'generation_reference_manifest_v1',
    generation_profile_id: profile.id,
    reference_size: { ...profile.reference_size },
    items,
  }
}

function promptText(promptSections) {
  return [
    promptSections.system_instruction,
    ...promptSections.content_parts.filter((part) => part.type === 'text').map((part) => part.text),
  ].filter(Boolean).join('\n')
}

function resolveProfileBackgroundContract(profile, requestedMode) {
  const explicitMode = requestedMode == null ? null : String(requestedMode).trim()
  const backgroundMode = explicitMode ?? profile.background_recipe_id ?? 'auto'
  const backgroundContract = resolveBackgroundMode(backgroundMode, {
    allowDeterministicV2:
      profile.background_recipe_id === BACKGROUND_RECIPE_IDS.DETERMINISTIC_PIXEL_MATTE_V2,
  })
  if (
    profile.background_recipe_id != null &&
    backgroundContract.recipe_id !== profile.background_recipe_id
  ) {
    throw new Error('generation profile background mode cannot be overridden')
  }
  return { backgroundMode, backgroundContract }
}

export function buildFullSheetGenerationReview({
  reviewId,
  profile,
  providerPreset,
  description = '',
  promptFields = {},
  characterPreset,
  backgroundMode,
  generationOptions = {},
  references = [],
} = {}) {
  assertSafeId(reviewId, 'generation review id')
  if (!profile?.id) throw new Error('generation profile is required')
  if (providerPreset?.provider !== 'gemini' || providerPreset?.routeKind !== 'google_native' ||
      providerPreset?.supportsSystemInstruction !== true || providerPreset?.supportsRoleInterleaving !== true ||
      providerPreset?.supportsImageSize !== true) {
    throw new Error('full-sheet generation profiles require a Gemini Native preset with role interleaving and 2K image-size support')
  }
  if (!references.length || references[0]?.role !== 'structure') {
    throw new Error('full-sheet generation review requires the derived structure reference first')
  }
  const actualRoles = references.map((image) => image.role)
  if (actualRoles.some((role, index) => GENERATION_REFERENCE_ROLE_ORDER.indexOf(role) <= GENERATION_REFERENCE_ROLE_ORDER.indexOf(actualRoles[index - 1]))) {
    throw new Error('generation reference role order is invalid')
  }
  if (references.some((image) => (
    !Buffer.isBuffer(image?.buffer) || image.width !== 1024 || image.height !== 1024 || image.mimeType !== 'image/png'
  ))) {
    throw new Error('all generation references must be 1024x1024 PNG files')
  }
  const byRole = Object.fromEntries(references.map((image) => [image.role, image]))
  const resolvedBackground = resolveProfileBackgroundContract(profile, backgroundMode)
  const contract = buildFullSheetCharacterPromptContract({
    description,
    preset: profile.source_layout,
    promptFields,
    characterPreset,
    backgroundMode: resolvedBackground.backgroundMode,
  })
  const promptSections = buildProviderPromptSections({
    contract,
    templateImage: byRole.structure,
    referenceImage: byRole.identity,
    paletteImage: byRole.palette,
  })
  const referencesManifest = referenceManifest(profile, references)
  const referenceManifestSha256 = hashGenerationReviewValue(referencesManifest)
  const requestBase = {
    schema_version: 1,
    protocol: GENERATION_REVIEW_PROTOCOL,
    review_id: reviewId,
    generation_profile: profile,
    provider: publicProvider(providerPreset),
    source_layout: profile.source_layout,
    generation_mode: profile.generation_mode,
    request_input: {
      description: String(description ?? ''),
      prompt_fields: promptFields,
      character_preset: characterPreset ?? null,
      background_mode: resolvedBackground.backgroundMode,
      background_mode_contract: resolvedBackground.backgroundContract,
    },
    prompt_contract: summarizePromptContract(contract),
    prompt_sections: promptSections,
    prompt_text_sha256: sha256GenerationBytes(Buffer.from(promptText(promptSections), 'utf8')),
    reference_manifest_sha256: referenceManifestSha256,
    reference_order: references.map((image) => ({ name: image.name, role: image.role })),
    generation_options: {
      ...generationOptions,
      candidateCount: 1,
    },
    image_config: { ...profile.image_config },
    estimated_provider_calls: 1,
    max_provider_calls: 1,
    automatic_retry: false,
    provider_fallback: false,
    model_fallback: false,
    subject_count_gate: profile.subject_count_gate,
  }
  const requestManifest = {
    ...requestBase,
    plan_hash: hashGenerationReviewValue(requestBase),
  }
  const review = {
    protocol: GENERATION_REVIEW_PROTOCOL,
    review_id: reviewId,
    generation_profile_id: profile.id,
    plan_hash: requestManifest.plan_hash,
    reference_manifest_sha256: referenceManifestSha256,
    estimated_provider_calls: 1,
    provider_calls_used: 0,
    request_manifest_file: GENERATION_REQUEST_MANIFEST_FILE,
    reference_manifest_file: GENERATION_REFERENCE_MANIFEST_FILE,
    prompt_file: GENERATION_PROMPT_FILE,
  }
  return {
    review,
    requestManifest,
    referenceManifest: referencesManifest,
    promptText: promptText(promptSections),
    references,
  }
}

export function assertFullSheetGenerationRequestManifest(value) {
  if (!isPlainObject(value)) throw new Error('generation request manifest is invalid')
  const { plan_hash: planHash, ...base } = value
  if (value.protocol !== GENERATION_REVIEW_PROTOCOL || hashGenerationReviewValue(base) !== assertHash(planHash, 'generation plan hash')) {
    throw new Error('generation request manifest hash changed')
  }
  assertSafeId(value.review_id, 'generation review id')
  if (value.provider?.provider !== 'gemini' || value.provider?.route_kind !== 'google_native' ||
      value.provider?.supports_system_instruction !== true || value.provider?.supports_role_interleaving !== true ||
      value.provider?.supports_image_size !== true) {
    throw new Error('generation provider contract changed')
  }
  assertHash(value.provider.provider_endpoint_sha256, 'generation provider endpoint hash')
  if (value.image_config?.image_size !== '2K' || value.image_config?.aspect_ratio !== '1:1' ||
      value.estimated_provider_calls !== 1 || value.max_provider_calls !== 1 ||
      value.automatic_retry !== false || value.provider_fallback !== false || value.model_fallback !== false) {
    throw new Error('generation call contract changed')
  }
  if (!Array.isArray(value.reference_order) || value.reference_order[0]?.role !== 'structure') {
    throw new Error('generation reference order changed')
  }
  let priorReferenceRoleIndex = -1
  const referenceRoles = []
  for (const item of value.reference_order) {
    const roleIndex = GENERATION_REFERENCE_ROLE_ORDER.indexOf(item?.role)
    if (
      typeof item?.name !== 'string' || !item.name || item.name.includes('..') ||
      roleIndex <= priorReferenceRoleIndex
    ) {
      throw new Error('generation reference order changed')
    }
    priorReferenceRoleIndex = roleIndex
    referenceRoles.push(item.role)
  }
  if (
    value.source_layout !== value.generation_profile?.source_layout ||
    value.generation_mode !== value.generation_profile?.generation_mode ||
    value.prompt_contract?.layout_id !== value.generation_profile?.source_layout ||
    value.prompt_contract?.t2i_mode !== value.generation_profile?.generation_mode
  ) {
    throw new Error('generation profile contract changed')
  }
  const resolvedBackground = resolveProfileBackgroundContract(
    value.generation_profile ?? {},
    value.request_input?.background_mode,
  )
  if (
    stableGenerationReviewJson(resolvedBackground.backgroundContract) !==
      stableGenerationReviewJson(value.request_input?.background_mode_contract) ||
    value.prompt_contract?.background_mode !== resolvedBackground.backgroundMode
  ) {
    throw new Error('generation background contract changed')
  }
  const expectedPromptContract = buildFullSheetCharacterPromptContract({
    description: value.request_input?.description,
    preset: value.generation_profile.source_layout,
    promptFields: value.request_input?.prompt_fields,
    characterPreset: value.request_input?.character_preset,
    backgroundMode: resolvedBackground.backgroundMode,
  })
  if (
    stableGenerationReviewJson(summarizePromptContract(expectedPromptContract)) !==
    stableGenerationReviewJson(value.prompt_contract)
  ) {
    throw new Error('generation prompt contract changed')
  }
  const expectedPromptSections = buildProviderPromptSections({
    contract: expectedPromptContract,
    templateImage: referenceRoles.includes('structure') ? { buffer: true } : null,
    referenceImage: referenceRoles.includes('identity') ? { buffer: true } : null,
    paletteImage: referenceRoles.includes('palette') ? { buffer: true } : null,
  })
  if (
    stableGenerationReviewJson(expectedPromptSections) !==
    stableGenerationReviewJson(value.prompt_sections)
  ) {
    throw new Error('generation prompt sections changed')
  }
  if (
    sha256GenerationBytes(Buffer.from(promptText(value.prompt_sections), 'utf8')) !==
    assertHash(value.prompt_text_sha256, 'generation prompt text hash')
  ) {
    throw new Error('generation prompt text hash changed')
  }
  assertHash(value.reference_manifest_sha256, 'generation reference manifest hash')
  return value
}

export function assertFullSheetGenerationReferenceManifest(
  value,
  expectedHash = null,
  expectedProfile = null,
) {
  if (!isPlainObject(value) || value.protocol !== 'generation_reference_manifest_v1' || !Array.isArray(value.items)) {
    throw new Error('generation reference manifest is invalid')
  }
  assertSafeId(value.generation_profile_id, 'generation reference profile id')
  if (
    !isPlainObject(value.reference_size) ||
    value.reference_size.w !== 1024 ||
    value.reference_size.h !== 1024
  ) {
    throw new Error('generation reference size changed')
  }
  if (expectedProfile != null) {
    if (!isPlainObject(expectedProfile) || !expectedProfile.id || !isPlainObject(expectedProfile.reference_size)) {
      throw new Error('expected generation reference profile is invalid')
    }
    if (
      value.generation_profile_id !== expectedProfile.id ||
      stableGenerationReviewJson(value.reference_size) !==
        stableGenerationReviewJson(expectedProfile.reference_size)
    ) {
      throw new Error('generation reference profile changed')
    }
  }
  if (!value.items.length || value.items[0]?.role !== 'structure') throw new Error('generation structure reference is missing')
  let priorRoleIndex = -1
  for (const [index, item] of value.items.entries()) {
    const roleIndex = GENERATION_REFERENCE_ROLE_ORDER.indexOf(item.role)
    if (item.order !== index + 1 || roleIndex <= priorRoleIndex || item.width !== 1024 || item.height !== 1024 ||
        item.mime_type !== 'image/png' || !Number.isSafeInteger(item.byte_length) || item.byte_length <= 0) {
      throw new Error('generation reference manifest item changed')
    }
    priorRoleIndex = roleIndex
    assertHash(item.sha256, 'generation reference hash')
    if (item.original_input) assertHash(item.original_input.sha256, 'generation original input hash')
  }
  const hash = hashGenerationReviewValue(value)
  if (expectedHash && hash !== assertHash(expectedHash, 'expected reference manifest hash')) {
    throw new Error('generation reference manifest hash changed')
  }
  return value
}

export function assertFullSheetGenerationReview(value) {
  if (!isPlainObject(value) || value.protocol !== GENERATION_REVIEW_PROTOCOL) {
    throw new Error('generation review is invalid')
  }
  assertSafeId(value.review_id, 'generation review id')
  assertSafeId(value.generation_profile_id, 'generation profile id')
  assertHash(value.plan_hash, 'generation plan hash')
  assertHash(value.reference_manifest_sha256, 'generation reference manifest hash')
  if (value.estimated_provider_calls !== 1 || value.provider_calls_used !== 0) {
    throw new Error('generation review provider-call evidence changed')
  }
  return value
}
