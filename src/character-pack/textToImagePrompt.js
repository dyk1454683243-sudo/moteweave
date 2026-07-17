export const TEXT_TO_IMAGE_MODE_PRODUCTION_SHEET = 'production_sheet_v0'
export const TEXT_TO_IMAGE_MODE_QUALITY_CHARACTER = 'quality_character_v0'

export const DEFAULT_T2I_CANDIDATE_COUNT = 1
export const MAX_T2I_CANDIDATE_COUNT = 8

const MODE_SET = new Set([
  TEXT_TO_IMAGE_MODE_PRODUCTION_SHEET,
  TEXT_TO_IMAGE_MODE_QUALITY_CHARACTER,
])

export const CHARACTER_T2I_PRESETS = Object.freeze({
  rpg_humanoid_v0: Object.freeze({
    id: 'rpg_humanoid_v0',
    label: 'Small RPG humanoid',
    aspectRatio: '1:1',
    prompt: 'small readable RPG sprite-source humanoid character, compact silhouette, game-ready proportions',
  }),
  animal_companion_v0: Object.freeze({
    id: 'animal_companion_v0',
    label: 'Animal companion',
    aspectRatio: '1:1',
    prompt: 'small readable fantasy animal companion, compact body, expressive silhouette, game-ready proportions',
  }),
  monster_creature_v0: Object.freeze({
    id: 'monster_creature_v0',
    label: 'Monster creature',
    aspectRatio: '1:1',
    prompt: 'small readable fantasy monster creature, distinctive silhouette, compact game-ready proportions',
  }),
  xianxia_hero_v0: Object.freeze({
    id: 'xianxia_hero_v0',
    label: 'Xianxia hero',
    aspectRatio: '1:1',
    prompt: 'small readable xianxia fantasy hero, flowing costume shapes kept compact, game-ready proportions',
  }),
  chibi_big_pixel_v0: Object.freeze({
    id: 'chibi_big_pixel_v0',
    label: 'Chibi big-pixel',
    aspectRatio: '1:1',
    prompt: 'chibi big-pixel character, large readable pixel clusters, compact silhouette, game-ready proportions',
  }),
  two_to_one_character_v0: Object.freeze({
    id: 'two_to_one_character_v0',
    label: '2:1 character art',
    aspectRatio: '2:1',
    prompt: 'single 2:1 pixel character presentation, centered full-body figure with extra horizontal breathing room',
  }),
})

const DEFAULT_PRESET_ID = 'rpg_humanoid_v0'

const FIELD_LABELS = Object.freeze({
  identity: 'Identity',
  body: 'Body and scale',
  outfit: 'Outfit',
  colors: 'Color palette',
  equipment: 'Equipment or held items',
  style: 'Style notes',
  background: 'Background request',
  outputType: 'Output type',
})

const FIELD_ALIASES = Object.freeze({
  clothing: 'outfit',
  costume: 'outfit',
  color: 'colors',
  palette: 'colors',
  weapon: 'equipment',
  prop: 'equipment',
  output: 'outputType',
  output_type: 'outputType',
})

function cleanText(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ')
}

export function normalizeTextToImageMode(mode) {
  const value = cleanText(mode || TEXT_TO_IMAGE_MODE_PRODUCTION_SHEET)
  return MODE_SET.has(value) ? value : TEXT_TO_IMAGE_MODE_PRODUCTION_SHEET
}

export function normalizeCharacterT2iPreset(presetId) {
  const id = cleanText(presetId || DEFAULT_PRESET_ID)
  return CHARACTER_T2I_PRESETS[id] ?? CHARACTER_T2I_PRESETS[DEFAULT_PRESET_ID]
}

export function normalizeCandidateCount(value, { fallback = DEFAULT_T2I_CANDIDATE_COUNT, max = MAX_T2I_CANDIDATE_COUNT } = {}) {
  const parsed = Number(value ?? fallback)
  if (!Number.isInteger(parsed) || parsed < 1) return fallback
  return Math.min(parsed, max)
}

function normalizeOptionalNumber(value, { min = -Infinity, max = Infinity } = {}) {
  if (value === undefined || value === null || value === '') return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return undefined
  return Math.max(min, Math.min(max, parsed))
}

export function normalizeGenerationOptions(input = {}) {
  const candidateCount = normalizeCandidateCount(input.candidateCount ?? input.candidate_count)
  const seed = input.seed === undefined || input.seed === null || input.seed === '' ? undefined : Number(input.seed)
  return {
    candidateCount,
    ...(Number.isFinite(seed) ? { seed } : {}),
    ...(normalizeOptionalNumber(input.temperature, { min: 0, max: 2 }) !== undefined
      ? { temperature: normalizeOptionalNumber(input.temperature, { min: 0, max: 2 }) }
      : {}),
    ...(normalizeOptionalNumber(input.topP ?? input.top_p, { min: 0, max: 1 }) !== undefined
      ? { topP: normalizeOptionalNumber(input.topP ?? input.top_p, { min: 0, max: 1 }) }
      : {}),
    ...(normalizeOptionalNumber(input.topK ?? input.top_k, { min: 1 }) !== undefined
      ? { topK: Math.round(normalizeOptionalNumber(input.topK ?? input.top_k, { min: 1 })) }
      : {}),
    ...(input.qualityTier || input.quality_tier ? { qualityTier: cleanText(input.qualityTier ?? input.quality_tier) } : {}),
  }
}

export function providerGenerationOptions(options = {}, candidateIndex = 1) {
  const normalized = normalizeGenerationOptions(options)
  const seed = normalized.seed === undefined ? undefined : normalized.seed + Math.max(0, Number(candidateIndex) - 1)
  return {
    ...(seed !== undefined ? { seed } : {}),
    ...(normalized.temperature !== undefined ? { temperature: normalized.temperature } : {}),
    ...(normalized.topP !== undefined ? { topP: normalized.topP } : {}),
    ...(normalized.topK !== undefined ? { topK: normalized.topK } : {}),
  }
}

export function normalizePromptFields(fields = {}) {
  const result = {}
  for (const [rawKey, rawValue] of Object.entries(fields ?? {})) {
    const key = FIELD_ALIASES[rawKey] ?? rawKey
    if (!FIELD_LABELS[key]) continue
    const value = cleanText(rawValue)
    if (value) result[key] = value
  }
  return result
}

export function parsePromptFieldEntries(entries = []) {
  const list = Array.isArray(entries) ? entries : [entries]
  const fields = {}
  for (const entry of list.filter(Boolean)) {
    const text = String(entry)
    const separator = text.includes('=') ? '=' : ':'
    const index = text.indexOf(separator)
    if (index <= 0) continue
    fields[text.slice(0, index).trim()] = text.slice(index + 1).trim()
  }
  return normalizePromptFields(fields)
}

export function compileStructuredSubject({ description = '', promptFields = {}, characterPreset } = {}) {
  const preset = normalizeCharacterT2iPreset(characterPreset)
  const fields = normalizePromptFields(promptFields)
  const parts = [cleanText(description), preset.prompt]
  for (const key of Object.keys(FIELD_LABELS)) {
    if (fields[key]) parts.push(`${FIELD_LABELS[key]}: ${fields[key]}`)
  }
  return parts.filter(Boolean).join('. ')
}

function backgroundPromptLine(backgroundMode) {
  const mode = cleanText(backgroundMode || 'auto')
  if (mode === 'alpha' || mode === 'transparent' || mode === 'passthrough') {
    return 'Background: transparent if the provider supports alpha; otherwise pure white #ffffff with no checkerboard, gradient, shadow, scenery, or texture.'
  }
  if (mode === 'edge_palette') {
    return 'Background: one flat solid color that is easy to remove, no gradient, checkerboard, shadow, scenery, or texture.'
  }
  return 'Background: pure white #ffffff only, no checkerboard, gradient, shadow, scenery, ground, or texture.'
}

export function buildQualityCharacterPrompt({
  description = '',
  promptFields = {},
  characterPreset,
  backgroundMode = 'auto',
} = {}) {
  const preset = normalizeCharacterT2iPreset(characterPreset)
  const subject = compileStructuredSubject({ description, promptFields, characterPreset: preset.id })
  return [
    `Create one production-ready pixel art sprite-source character: ${subject || preset.prompt}.`,
    'Output type: one single centered full-body character only, not a sprite sheet, not a contact sheet, not multiple poses, not a grid.',
    'Sprite scale: the character silhouette must stay compact, roughly 35-60% of canvas height and 20-50% of canvas width, with generous empty padding on all sides.',
    'Pose and camera: neutral idle stance, front or slight three-quarter front view, orthographic game-asset presentation, no dramatic poster pose, no cropped close-up.',
    'Pixel style: clean readable 16-bit pixel art built from deliberate chunky pixel clusters, crisp silhouette, strong but controlled outline, limited palette, no painterly blur, no anti-aliased soft rendering.',
    'Character quality: expressive readable shape, consistent lighting, coherent costume design, simplified enough to remain readable when downscaled to a 96x96 RPG sprite.',
    'Composition: keep the entire body visible with comfortable padding around the silhouette; do not fill the canvas with a large illustration.',
    backgroundPromptLine(backgroundMode),
    'Do not include text, UI, labels, borders, frame numbers, watermarks, scenery, extra characters, or loose props outside the character silhouette.',
  ].join('\n')
}

export function summarizeQualityPromptContract({
  characterPreset,
  promptFields = {},
  backgroundMode = 'auto',
} = {}) {
  const preset = normalizeCharacterT2iPreset(characterPreset)
  return {
    schema_version: 1,
    contract_version: 'quality_character_prompt_contract_v1_0',
    mode: TEXT_TO_IMAGE_MODE_QUALITY_CHARACTER,
    preset: preset.id,
    preset_label: preset.label,
    aspect_ratio: preset.aspectRatio,
    background_mode: cleanText(backgroundMode || 'auto'),
    prompt_fields: normalizePromptFields(promptFields),
    validation_expectations: [
      'single_centered_character',
      'full_body_visible',
      'production_scale_bbox',
      'generous_padding',
      'neutral_idle_pose',
      'pixel_art_finish',
      'no_sprite_sheet_grid',
      'removable_background',
    ],
  }
}

export function resolveTextToImageAspectRatio({ mode, characterPreset, imageConfig = {} } = {}) {
  if (imageConfig.aspect_ratio || imageConfig.aspectRatio) return imageConfig.aspect_ratio || imageConfig.aspectRatio
  if (normalizeTextToImageMode(mode) === TEXT_TO_IMAGE_MODE_QUALITY_CHARACTER) {
    return normalizeCharacterT2iPreset(characterPreset).aspectRatio
  }
  return '1:1'
}
