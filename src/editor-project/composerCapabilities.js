// Application-owned capability definitions: the single source shared by the model
// contract, the reply schema/parser and the UI action handlers. A capability names an
// existing operation and its parameters; the host still binds targets, grants, budgets
// and recovery when it runs one. A clear user request is the permission to run it.
import { FULL_SHEET_GENERATION_PROFILES, FULL_SHEET_GENERATION_PROFILE_IDS } from '../character-pack/generationProfiles.js'
import { BACKGROUND_MODES } from '../character-pack/backgroundProcessingContract.js'

// The server's generation profile is the authority (it validates every request against it);
// the browser-facing request fields are derived from it rather than restated.
const FIXED_REGION = FULL_SHEET_GENERATION_PROFILES[FULL_SHEET_GENERATION_PROFILE_IDS.FIXED_REGION]
export const FIXED_REGION_PROFILE = Object.freeze({
  generationProfileId: FIXED_REGION.id,
  t2iMode: FIXED_REGION.generation_mode,
  provider: FIXED_REGION.provider,
  routeKind: FIXED_REGION.route_kind,
  imageConfig: Object.freeze({ image_size: FIXED_REGION.image_config.image_size, aspect_ratio: FIXED_REGION.image_config.aspect_ratio }),
  generationOptions: Object.freeze({ candidateCount: FIXED_REGION.candidate_count }),
  maxProviderCalls: FIXED_REGION.max_provider_calls,
  // The request names the background mode whose recipe this profile requires.
  backgroundMode: BACKGROUND_MODES.DETERMINISTIC_PIXEL_MATTE_V2,
})

export const APPLICATION_PRESETS = Object.freeze([
  Object.freeze({ id: 'fixed-region-motion', name: 'Fixed-region motion',
    description: `Character motion sheet; Gemini ${FIXED_REGION_PROFILE.imageConfig.image_size} ${FIXED_REGION_PROFILE.imageConfig.aspect_ratio}, `
      + `${FIXED_REGION_PROFILE.maxProviderCalls} provider call, processed onto a new canvas.`,
    use: 'animated character sprite sheet on a new canvas', requiredInput: 'character description', profile: FIXED_REGION_PROFILE }),
])
export const applicationPreset = id => APPLICATION_PRESETS.find(preset => preset.id === id) || null
export const COMPOSER_WORKFLOW_PHASES = ['idle', 'review', 'running', 'candidate', 'processing', 'ready', 'process_failed', 'failed', 'unknown']

export function selectStrictGeminiPreset(state) {
  const presets = Array.isArray(state?.presets) ? state.presets : []
  const { provider, routeKind, imageConfig } = FIXED_REGION_PROFILE
  const eligible = preset => preset?.available === true && preset.provider === provider
    && preset.route_kind === routeKind && preset.supports_image_size === true
    && preset.image_config?.image_size === imageConfig.image_size && preset.image_config?.aspect_ratio === imageConfig.aspect_ratio
  return presets.find(preset => preset?.id === state.active_preset_id && eligible(preset)) || presets.find(eligible) || null
}

// Flat backgrounds a generated general image may use; the app removes the chosen one on import.
export const GENERATED_IMAGE_BACKGROUNDS = Object.freeze(['green', 'magenta', 'purple', 'white'])

// Parameter definitions: JSON-schema fragment, runtime check and the short meaning a model
// reads. The schema also renders the model-facing type, so the contract cannot drift from it.
export const COMPOSER_PARAMS = Object.freeze({
  // 3800 leaves room for the background clause an image request appends (4000-character request limit).
  instruction: { schema: { type: 'string', maxLength: 3800 }, doc: 'self-contained',
    valid: value => typeof value === 'string' && Boolean(value.trim()) && value.length <= 3800 },
  size: { schema: { type: 'integer', enum: [32, 64] }, doc: 'selected/edit: selected canvas size', valid: value => [32, 64].includes(value) },
  kind: { schema: { type: 'string', enum: ['new', 'edit', 'selected'] }, valid: value => ['new', 'edit', 'selected'].includes(value) },
  reference: { schema: { type: 'boolean' }, valid: value => typeof value === 'boolean' },
  background: { schema: { type: 'string', enum: GENERATED_IMAGE_BACKGROUNDS }, doc: 'flat, absent from subject',
    valid: value => GENERATED_IMAGE_BACKGROUNDS.includes(value) },
  preset_id: { schema: { type: 'string', enum: APPLICATION_PRESETS.map(preset => preset.id) }, valid: value => Boolean(applicationPreset(value)) },
})

// `use` is what the model reads. `rule` checks combinations a schema cannot express.
// Adding a capability: add a definition here and one UI handler with the same id.
export const COMPOSER_ACTIONS = Object.freeze([
  Object.freeze({ id: 'edit_pixels', providers: ['astra'], params: ['instruction'],
    use: 'brush-draw/edit the selected 64x64 canvas or marked region; blanks change in place, imports get a copy' }),
  Object.freeze({ id: 'edit_document', providers: ['astra'], params: ['instruction'],
    use: 'draw new animated pixel art or edit frames, timing, layers and pixel blocks on the selected canvas; use for multi-frame drawing and animation' }),
  Object.freeze({ id: 'draw_pixels', providers: ['codex'], params: ['instruction', 'size', 'kind', 'reference'],
    use: 'pixel art; kind selected=on the selected empty canvas (reference false; default if one is), edit=redraw selection (reference true), new=new canvas',
    rule: action => (action.kind !== 'edit' || action.reference) && (action.kind !== 'selected' || !action.reference) }),
  Object.freeze({ id: 'generate_image', providers: ['antigravity', 'codex', 'grok'], referenceProviders: ['codex'],
    params: ['instruction', 'reference', 'background'],
    use: 'one ~1024px image on a new canvas; its background is removed', referenceUse: 'reference true sends the selected canvas' }),
  Object.freeze({ id: 'use_preset', params: ['instruction', 'preset_id', 'reference'],
    use: 'run a ready preset end to end', referenceUse: 'reference true uses the attached image or previous result' }),
])
export const composerAction = id => COMPOSER_ACTIONS.find(action => action.id === id) || null
export const composerActionsFor = (provider, { selectedPresetId = null } = {}) => COMPOSER_ACTIONS.filter(action =>
  (!action.providers || action.providers.includes(provider)) && (action.id !== 'use_preset' || Boolean(applicationPreset(selectedPresetId))))

// A field this provider may only send with one value (for example no reference upload).
const fixedValue = (action, name, provider) => name === 'reference' && action.referenceProviders && !action.referenceProviders.includes(provider) ? false : undefined
const contractType = schema => schema.enum ? schema.enum.map(value => JSON.stringify(value)).join('|')
  : schema.type === 'boolean' ? 'true|false' : schema.maxLength ? `text<=${schema.maxLength}` : schema.type

// The model-facing action contract for one provider, generated from the same definitions as
// the strict schema and the validator. A provider whose adapter enforces composerReplySchema
// (structuredOutput) reads the meanings only; any other provider receives the complete
// contract: discriminator, every required field, each allowed value and an example.
// Adding a capability, field or value updates every form.
export function composerContract(provider, generationState, { structuredOutput = false, selectedPresetId = null } = {}) {
  const actions = composerActionsFor(provider, { selectedPresetId })
  const used = [...new Set(actions.flatMap(action => action.params))]
  const fields = action => action.params.map(name => {
    const fixed = fixedValue(action, name, provider)
    return fixed === undefined ? name : `${name}=${JSON.stringify(fixed)}`
  }).join(',')
  const example = actions[0] && Object.fromEntries([['type', actions[0].id], ...actions[0].params.map(name => {
    const fixed = fixedValue(actions[0], name, provider), schema = COMPOSER_PARAMS[name].schema
    return [name, fixed ?? (schema.enum ? schema.enum[0] : schema.type === 'boolean' ? false : '...')]
  })])
  const ready = Boolean(selectStrictGeminiPreset(generationState))
  const legend = used.map(name => {
    const param = COMPOSER_PARAMS[name]
    if (structuredOutput) return param.doc ? `${name} (${param.doc})` : ''
    return `${name}=${contractType(param.schema)}${param.doc ? ` (${param.doc})` : ''}`
  }).filter(Boolean).join('; ')
  return (structuredOutput
    ? 'Enforced JSON reply; action is null or one object whose "type" is an id below:\n'
    : 'Reply raw JSON only, no code fences: {"reply":non-empty text,"action":null|action}; action = {"type":id, every listed field, nothing else}:\n')
    + actions.map(action => `${action.id}{${fields(action)}}: ${action.use}${action.referenceUse && fixedValue(action, 'reference', provider) === undefined ? `; ${action.referenceUse}` : ''}`).join('\n')
    + (legend ? `\nFields: ${legend}.` : '')
    + (example && !structuredOutput ? `\nExample: ${JSON.stringify(example)}` : '')
    + (applicationPreset(selectedPresetId)
      ? `\nSelected Skill: ${APPLICATION_PRESETS.filter(p => p.id === selectedPresetId).map(({ id, name, use, requiredInput }) => `${id} (${name}): ${use}; needs ${requiredInput}; ${ready ? 'ready' : 'not ready: say so, run nothing'}.`).join(' ')} Only this preset is allowed.`
      : '\nNo Skill selected: use this model\'s native tools; generation presets are unavailable.')
}

// One strict object per capability, so structured output cannot emit an action or field
// this provider cannot run.
export function composerReplySchema(provider, options = {}) {
  const variants = composerActionsFor(provider, options).map(action => ({
    type: 'object', additionalProperties: false, required: ['type', ...action.params],
    properties: { type: { type: 'string', enum: [action.id] },
      ...Object.fromEntries(action.params.map(name => [name, name === 'preset_id'
        ? { type: 'string', enum: [options.selectedPresetId] } : COMPOSER_PARAMS[name].schema])) },
  }))
  return { type: 'object', additionalProperties: false, required: ['reply', 'action'],
    properties: { reply: { type: 'string' }, action: { anyOf: [{ type: 'null' }, ...variants] } } }
}

export function validComposerAction(action, provider, options = {}) {
  if (!action || typeof action !== 'object' || Array.isArray(action)) return false
  const definition = composerActionsFor(provider, options).find(item => item.id === action.type)
  if (!definition) return false
  if (action.type === 'use_preset' && action.preset_id !== options.selectedPresetId) return false
  const keys = Object.keys(action).filter(key => key !== 'type').sort().join(',')
  if (keys !== [...definition.params].sort().join(',')) return false
  if (!definition.params.every(name => COMPOSER_PARAMS[name].valid(action[name]))) return false
  if (action.reference && definition.referenceProviders && !definition.referenceProviders.includes(provider)) return false
  return definition.rule ? definition.rule(action) : true
}
