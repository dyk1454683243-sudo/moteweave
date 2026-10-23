import test from 'node:test'
import assert from 'node:assert/strict'
import { parseComposerReply, composerInstructions, composerReplySchema } from '../../src/editor-project/assistantActions.js'
import { COMPOSER_ACTIONS, composerActionsFor } from '../../src/editor-project/composerCapabilities.js'

test('ordinary text stays chat; structured actions are provider-bound and never carry permissions or extra fields', () => {
  assert.deepEqual(parseComposerReply('Draw is an interesting topic.', 'astra'), { reply: 'Draw is an interesting topic.', action: null })
  const action = { type: 'edit_pixels', instruction: 'Use the palette from our discussion.' }
  assert.deepEqual(parseComposerReply(JSON.stringify({ reply: 'Drawing now.', action }), 'astra').action, action)
  assert.deepEqual(parseComposerReply('```json\n' + JSON.stringify({ reply: 'Drawing now.', action }) + '\n```', 'astra').action, action, 'one surrounding fence is tolerated')
  assert.equal(parseComposerReply('Here you go: ```json\n{}\n```', 'astra').action, null, 'prose around a fence stays chat')
  for (const scalar of ['8', 'true', 'null', '"Sure, here is a palette."']) assert.deepEqual(parseComposerReply(scalar, 'grok'), { reply: scalar, action: null }, 'a bare JSON value is conversation')
  for (const invalid of [{ ...action, grant_id: 'fake' }, { ...action, type: 'save' }, { ...action, kind: 'new' }, { ...action, instruction: ' ' }]) {
    assert.throws(() => parseComposerReply(JSON.stringify({ reply: 'Yes', action: invalid }), 'astra'))
  }
  assert.throws(() => parseComposerReply(JSON.stringify({ reply: 'Yes', action }), 'grok'), 'Astra tools are not offered to other models')
  assert.throws(() => parseComposerReply(JSON.stringify({ reply: 'Yes', action: { type: 'draw_pixels', instruction: 'x', size: 64, kind: 'edit', reference: false } }), 'codex'))
  assert.throws(() => parseComposerReply(JSON.stringify({ reply: 'Yes', action: { type: 'revoke_authorization', instruction: 'x' } }), 'grok'),
    'there is no authorization action: a request is the permission')
})

test('application presets, selected blank drawing and image backgrounds use closed capability parameters', () => {
  const preset = { type: 'use_preset', instruction: 'A blue knight with a shield.', preset_id: 'fixed-region-motion', reference: false }
  for (const provider of ['grok', 'codex', 'astra', 'antigravity']) {
    assert.deepEqual(parseComposerReply(JSON.stringify({ reply: 'Making it now.', action: preset }), provider, { selectedPresetId: preset.preset_id }).action, preset)
    assert.match(composerInstructions(provider, null, { selectedPresetId: preset.preset_id }), /not ready: say so, run nothing/)
    assert.doesNotMatch(composerInstructions(provider, null), /RPG 8/)
  }
  for (const invalid of [{ ...preset, preset_id: 'rpg-8x8' }, { ...preset, maxProviderCalls: 2 }, { ...preset, reference: null }]) {
    assert.throws(() => parseComposerReply(JSON.stringify({ reply: 'Go', action: invalid }), 'codex'))
  }
  const drawing = { type: 'draw_pixels', instruction: 'A blue knight.', size: 32, kind: 'selected', reference: false }
  assert.deepEqual(parseComposerReply(JSON.stringify({ reply: 'Drawing', action: drawing }), 'codex').action, drawing)
  assert.throws(() => parseComposerReply(JSON.stringify({ reply: 'Drawing', action: { ...drawing, reference: true } }), 'codex'))
  assert.throws(() => parseComposerReply(JSON.stringify({ reply: 'Drawing', action: drawing }), 'grok'))
  const image = { type: 'generate_image', instruction: 'A green slime on a flat background.', reference: false, background: 'magenta' }
  assert.deepEqual(parseComposerReply(JSON.stringify({ reply: 'Generating', action: image }), 'grok').action, image)
  assert.throws(() => parseComposerReply(JSON.stringify({ reply: 'Generating', action: { ...image, reference: true } }), 'grok'), 'only Codex uploads a reference')
  assert.equal(parseComposerReply(JSON.stringify({ reply: 'Generating', action: { ...image, reference: true } }), 'codex').action.reference, true)
  assert.throws(() => parseComposerReply(JSON.stringify({ reply: 'Generating', action: { ...image, background: 'checkerboard' } }), 'grok'))
  assert.throws(() => parseComposerReply(JSON.stringify({ reply: 'Generating', action: image }), 'astra'), 'Astra cannot run native image generation')
})

test('instructions treat a clear request as permission and ask only for material ambiguity', () => {
  const text = composerInstructions('codex', null)
  assert.match(text, /A request for a result is permission: return its action now/)
  assert.match(text, /never ask to confirm or reply with only a plan or steps/)
  assert.match(text, /Ask one short question \(action null\) only if an open choice changes the result/)
  assert.doesNotMatch(text, /Review then|human confirmation|Save drawing|Authorize/i)
  // The forms production sends: Grok and Antigravity read the full text; Codex and Astra adapters enforce the schema.
  for (const [provider, structuredOutput] of [['grok', false], ['antigravity', false], ['codex', true], ['astra', true]]) {
    assert.ok(composerInstructions(provider, null, { structuredOutput }).length <= 1450, `${provider} instructions leave room for a 4000-character message and an excerpt`)
  }
  assert.ok(composerInstructions('codex', null, { structuredOutput: true }).length < composerInstructions('codex', null).length, 'an enforced schema carries the values')
})

test('the reply schema is generated per provider from the same capability definitions', () => {
  for (const provider of ['grok', 'codex', 'astra', 'antigravity']) {
    const variants = composerReplySchema(provider).properties.action.anyOf.slice(1)
    assert.deepEqual(variants.map(variant => variant.properties.type.enum[0]), composerActionsFor(provider).map(action => action.id))
    for (const variant of variants) {
      const definition = COMPOSER_ACTIONS.find(action => action.id === variant.properties.type.enum[0])
      assert.deepEqual(variant.required, ['type', ...definition.params])
      assert.equal(variant.additionalProperties, false)
    }
  }
  assert.deepEqual(composerActionsFor('codex').map(action => action.id), ['draw_pixels', 'generate_image'])
  assert.deepEqual(composerActionsFor('astra').map(action => action.id), ['edit_pixels', 'edit_document'])
})

test('the preset request is derived from the server generation profile and passes its own validator', async () => {
  const { FULL_SHEET_GENERATION_PROFILES, FULL_SHEET_GENERATION_PROFILE_IDS, assertFullSheetGenerationProfileRequest } = await import('../../src/character-pack/generationProfiles.js')
  const { buildReviewRequest, buildLiveGenerateRequest } = await import('../../src/ui/vnext/vnext-generation-client.js')
  const { FIXED_REGION_PROFILE, selectStrictGeminiPreset } = await import('../../src/editor-project/composerCapabilities.js')
  const profile = FULL_SHEET_GENERATION_PROFILES[FULL_SHEET_GENERATION_PROFILE_IDS.FIXED_REGION]
  const review = buildReviewRequest({ description: 'A blue knight.' })
  assert.doesNotThrow(() => assertFullSheetGenerationProfileRequest(profile, { mode: review.t2iMode, imageConfig: review.imageConfig,
    generationOptions: review.generationOptions, maxProviderCalls: review.maxProviderCalls, backgroundMode: review.backgroundMode }))
  assert.equal(review.generationProfileId, profile.id)
  assert.deepEqual({ ...review.imageConfig }, { ...profile.image_config })
  assert.equal(buildLiveGenerateRequest({ reviewed_run_id: 'r', plan_hash: 'p', reference_manifest_sha256: 'm' }).maxProviderCalls, profile.max_provider_calls)
  assert.equal(FIXED_REGION_PROFILE.generationOptions.candidateCount, profile.candidate_count)
  const ready = { active_preset_id: 'g', presets: [{ id: 'g', available: true, provider: profile.provider, route_kind: profile.route_kind, supports_image_size: true, image_config: { ...profile.image_config } }] }
  assert.equal(selectStrictGeminiPreset(ready)?.id, 'g')
  assert.equal(selectStrictGeminiPreset({ ...ready, presets: [{ ...ready.presets[0], image_config: { image_size: '1K', aspect_ratio: '1:1' } }] }), null, 'a preset that differs from the profile is not ready')
})

test('reference meanings are stated only where the provider may set reference, and instructions leave room for the image background clause', () => {
  const grok = composerInstructions('grok', null, { selectedPresetId: 'fixed-region-motion' }), codex = composerInstructions('codex', null, { structuredOutput: true, selectedPresetId: 'fixed-region-motion' })
  assert.match(grok, /generate_image\{instruction,reference=false,background\}: [^\n]*removed\n/, 'no reference promise where reference is fixed to false')
  assert.match(codex, /generate_image\{instruction,reference,background\}: [^\n]*reference true sends the selected canvas/)
  for (const text of [grok, codex]) assert.match(text, /use_preset\{instruction,preset_id,reference\}: [^\n]*reference true uses the attached image or previous result/)
  assert.match(codex, /size \(selected\/edit: selected canvas size\)/)
  assert.match(grok, /instruction=text<=3800/)
  assert.throws(() => parseComposerReply(JSON.stringify({ reply: 'Go', action: { type: 'generate_image', instruction: 'x'.repeat(3801), reference: false, background: 'green' } }), 'grok'))
  assert.equal(parseComposerReply(JSON.stringify({ reply: 'Go', action: { type: 'generate_image', instruction: 'x'.repeat(3800), reference: false, background: 'green' } }), 'grok').action.instruction.length, 3800)
})


test('unselected Skill is absent from prompt/schema and rejected by the parser for every model', () => {
  const action = { type: 'use_preset', instruction: 'Draw an animation.', preset_id: 'fixed-region-motion', reference: false }
  for (const provider of ['astra', 'codex', 'grok', 'antigravity']) {
    assert.doesNotMatch(composerInstructions(provider, null), /use_preset\{|fixed-region-motion/)
    assert.match(composerInstructions(provider, null), /No Skill selected/)
    assert.throws(() => parseComposerReply(JSON.stringify({ reply: 'Drawing', action }), provider), /invalid_composer_action/)
    const chosen = { selectedPresetId: action.preset_id }
    const variant = composerReplySchema(provider, chosen).properties.action.anyOf.find(v => v.properties?.type.enum[0] === 'use_preset')
    assert.deepEqual(variant.properties.preset_id.enum, [action.preset_id])
    assert.throws(() => parseComposerReply(JSON.stringify({ reply: 'Drawing', action }), provider, { selectedPresetId: 'unknown' }))
  }
})
