import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assertFullSheetGenerationReferenceManifest,
  assertFullSheetGenerationRequestManifest,
  buildFullSheetGenerationReview,
  hashGenerationReviewValue,
  sha256GenerationBytes,
} from '../../src/character-pack/generationReview.js'
import {
  buildIdentityReferenceBoard,
  buildPaletteReferenceBoard,
  buildStructureReferenceBoard,
} from '../../src/character-pack/generationReferenceBoards.js'
import {
  FULL_SHEET_GENERATION_PROFILE_IDS,
  resolveFullSheetGenerationProfile,
} from '../../src/character-pack/generationProfiles.js'
import { encodeRgbaPng, loadRgba } from '../../src/character-pack/imageCodec.js'
import { resolveProviderPreset } from '../../src/character-pack/providers/providerConfig.js'
import { loadAuthoritativeGenerationStructureImage } from '../../src/character-pack/templateStore.js'

function rgba(width, height, fill = [0, 0, 0, 0]) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let offset = 0; offset < data.length; offset += 4) data.set(fill, offset)
  return { width, height, data }
}

function paint(target, rect, color) {
  for (let y = rect.y; y < rect.y + rect.h; y += 1) {
    for (let x = rect.x; x < rect.x + rect.w; x += 1) {
      target.data.set(color, (y * target.width + x) * 4)
    }
  }
}

const providerEnv = {
  GEMINI_KEY: 'test-only',
  CHARACTER_PROVIDER_PRESETS: JSON.stringify([{
    id: 'gemini-native',
    provider: 'gemini',
    apiKeyEnv: 'GEMINI_KEY',
    model: 'gemini-3.1-flash-image-preview',
    image_size: '2K',
    aspect_ratio: '1:1',
  }]),
}

test('generation Review seals 1024 role-isolated references and exact one-call request', async () => {
  const template = rgba(252, 252, [255, 0, 255, 255])
  paint(template, { x: 20, y: 20, w: 24, h: 40 }, [20, 30, 40, 255])
  const identity = rgba(96, 96)
  paint(identity, { x: 34, y: 18, w: 28, h: 64 }, [70, 120, 200, 255])
  const palette = rgba(32, 32)
  paint(palette, { x: 0, y: 0, w: 16, h: 32 }, [30, 50, 90, 255])
  paint(palette, { x: 16, y: 0, w: 16, h: 32 }, [220, 180, 90, 255])
  const templateInput = { name: 'template.png', mimeType: 'image/png', buffer: await encodeRgbaPng(template) }
  const identityInput = { name: 'identity.png', mimeType: 'image/png', buffer: await encodeRgbaPng(identity) }
  const paletteInput = { name: 'palette.png', mimeType: 'image/png', buffer: await encodeRgbaPng(palette) }
  const references = [
    await buildStructureReferenceBoard(templateInput, { sourceLayoutId: 'fixed_region_motion_v0' }),
    await buildIdentityReferenceBoard(identityInput),
    await buildPaletteReferenceBoard(paletteInput),
  ]
  const profile = resolveFullSheetGenerationProfile(FULL_SHEET_GENERATION_PROFILE_IDS.FIXED_REGION)
  const providerPreset = resolveProviderPreset(providerEnv, 'gemini-native')
  const built = buildFullSheetGenerationReview({
    reviewId: 'review_unit_1',
    profile,
    providerPreset,
    description: 'blue-cloaked ranger',
    generationOptions: { candidateCount: 1 },
    references,
  })

  assert.deepEqual(references.map((image) => image.role), ['structure', 'identity', 'palette'])
  for (const reference of references) {
    const metadata = await loadRgba(reference.buffer)
    assert.deepEqual({ w: metadata.width, h: metadata.height }, { w: 1024, h: 1024 })
  }
  assert.equal(references[0].report.retains_source_color, false)
  const structurePixels = await loadRgba(references[0].buffer)
  const structureColors = new Set()
  for (let offset = 0; offset < structurePixels.data.length; offset += 4) {
    if (structurePixels.data[offset + 3] === 0) continue
    structureColors.add(`${structurePixels.data[offset]},${structurePixels.data[offset + 1]},${structurePixels.data[offset + 2]}`)
  }
  assert.deepEqual([...structureColors].sort(), ['125,125,137', '30,30,42'])
  assert.equal(references[1].report.significant_subject_count, 1)
  assert.equal(references[1].report.duplicate_views, 0)
  assert.equal(references[2].report.contains_source_silhouette, false)
  assert.equal(built.requestManifest.provider.route_kind, 'google_native')
  assert.equal(built.requestManifest.provider.supports_image_size, true)
  assert.match(built.requestManifest.provider.provider_endpoint_sha256, /^[a-f0-9]{64}$/)
  assert.equal('base_url' in built.requestManifest.provider, false)
  assert.equal(built.requestManifest.estimated_provider_calls, 1)
  assert.deepEqual(built.requestManifest.request_input.background_mode_contract, {
    requested: 'deterministic_pixel_matte_v2',
    canonical: 'deterministic_pixel_matte_v2',
    recipe_id: 'deterministic_pixel_matte_v2',
  })
  assert.equal(
    JSON.stringify(built.requestManifest).includes('deterministic_pixel_matte_v2'),
    true,
  )
  assert.equal(built.review.provider_calls_used, 0)
  assert.equal(built.requestManifest.prompt_contract.contract_version, 'character_prompt_contract_v1_18')
  assert.doesNotMatch(built.promptText, /weak appearance reference/i)
  assert.match(built.promptText, /sole authority/i)
  assertFullSheetGenerationRequestManifest(built.requestManifest)
  assertFullSheetGenerationReferenceManifest(
    built.referenceManifest,
    built.requestManifest.reference_manifest_sha256,
    profile,
  )

  const tampered = structuredClone(built.requestManifest)
  tampered.provider.model = 'changed-model'
  assert.throws(() => assertFullSheetGenerationRequestManifest(tampered), /hash changed/)

  const changedEndpoint = structuredClone(built.requestManifest)
  changedEndpoint.provider.provider_endpoint_sha256 = '0'.repeat(64)
  assert.throws(() => assertFullSheetGenerationRequestManifest(changedEndpoint), /hash changed/)

  const changedReferences = structuredClone(built.referenceManifest)
  changedReferences.items[0].sha256 = '0'.repeat(64)
  assert.throws(
    () => assertFullSheetGenerationReferenceManifest(changedReferences, built.requestManifest.reference_manifest_sha256),
    /hash changed/,
  )

  const changedReferenceOrder = structuredClone(built.referenceManifest)
  changedReferenceOrder.items[1].order = 7
  assert.throws(
    () => assertFullSheetGenerationReferenceManifest(
      changedReferenceOrder,
      hashGenerationReviewValue(changedReferenceOrder),
      profile,
    ),
    /reference manifest item changed/,
  )

  for (const mutate of [
    (manifest) => { manifest.generation_profile_id = FULL_SHEET_GENERATION_PROFILE_IDS.TOPDOWN },
    (manifest) => { manifest.reference_size = { w: 512, h: 512 } },
  ]) {
    const changedReferenceProfile = structuredClone(built.referenceManifest)
    mutate(changedReferenceProfile)
    assert.throws(
      () => assertFullSheetGenerationReferenceManifest(
        changedReferenceProfile,
        hashGenerationReviewValue(changedReferenceProfile),
        profile,
      ),
      /generation reference (?:profile|size) changed/,
    )
  }

  const changedBackground = structuredClone(built.requestManifest)
  changedBackground.request_input.background_mode = 'auto'
  changedBackground.request_input.background_mode_contract = {
    requested: 'auto',
    canonical: 'auto',
    recipe_id: 'legacy_auto_v1',
  }
  const { plan_hash: ignoredPlanHash, ...changedBackgroundBase } = changedBackground
  changedBackground.plan_hash = hashGenerationReviewValue(changedBackgroundBase)
  assert.throws(
    () => assertFullSheetGenerationRequestManifest(changedBackground),
    /background mode cannot be overridden/,
  )

  const changedPromptBackground = structuredClone(built.requestManifest)
  changedPromptBackground.prompt_contract.background_mode = 'auto'
  const { plan_hash: ignoredPromptPlanHash, ...changedPromptBackgroundBase } = changedPromptBackground
  changedPromptBackground.plan_hash = hashGenerationReviewValue(changedPromptBackgroundBase)
  assert.throws(
    () => assertFullSheetGenerationRequestManifest(changedPromptBackground),
    /generation background contract changed/,
  )

  for (const mutate of [
    (manifest) => { manifest.source_layout = 'topdown_rpg_v0' },
    (manifest) => { manifest.generation_mode = 'quality_character_v0' },
    (manifest) => { manifest.prompt_contract.layout_id = 'topdown_rpg_v0' },
    (manifest) => { manifest.prompt_contract.t2i_mode = 'quality_character_v0' },
  ]) {
    const changedProfileBinding = structuredClone(built.requestManifest)
    mutate(changedProfileBinding)
    const { plan_hash: ignoredProfilePlanHash, ...changedProfileBindingBase } = changedProfileBinding
    changedProfileBinding.plan_hash = hashGenerationReviewValue(changedProfileBindingBase)
    assert.throws(
      () => assertFullSheetGenerationRequestManifest(changedProfileBinding),
      /generation profile contract changed/,
    )
  }

  const changedPromptSections = structuredClone(built.requestManifest)
  changedPromptSections.prompt_sections.content_parts =
    changedPromptSections.prompt_sections.content_parts.filter((part) => !(
      part.type === 'image' && part.role === 'structure'
    ))
  const { plan_hash: ignoredSectionsPlanHash, ...changedPromptSectionsBase } = changedPromptSections
  changedPromptSections.plan_hash = hashGenerationReviewValue(changedPromptSectionsBase)
  assert.throws(
    () => assertFullSheetGenerationRequestManifest(changedPromptSections),
    /generation prompt sections changed/,
  )
})

test('generation Review rejects a Gemini preset that cannot honor the sealed 2K image size', async () => {
  const template = rgba(256, 256, [255, 0, 255, 255])
  paint(template, { x: 24, y: 24, w: 32, h: 56 }, [40, 100, 180, 255])
  const structure = await buildStructureReferenceBoard({
    name: 'template.png',
    mimeType: 'image/png',
    buffer: await encodeRgbaPng(template),
  }, { sourceLayoutId: 'topdown_rpg_v0' })
  const providerPreset = resolveProviderPreset({
    GEMINI_KEY: 'test-only',
    CHARACTER_PROVIDER_PRESETS: JSON.stringify([{
      id: 'gemini-native-without-image-size',
      provider: 'gemini',
      apiKeyEnv: 'GEMINI_KEY',
      model: 'gemini-2.5-flash-image',
      image_size: '2K',
      aspect_ratio: '1:1',
    }]),
  }, 'gemini-native-without-image-size')

  assert.equal(providerPreset.supportsImageSize, false)
  assert.throws(() => buildFullSheetGenerationReview({
    reviewId: 'review_unsupported_size_1',
    profile: resolveFullSheetGenerationProfile(FULL_SHEET_GENERATION_PROFILE_IDS.TOPDOWN),
    providerPreset,
    description: 'one ranger',
    references: [structure],
  }), /2K image-size support/)
})

test('generation Review supports text-authoritative identity with no identity or palette image', async () => {
  const template = rgba(256, 256, [255, 0, 255, 255])
  paint(template, { x: 24, y: 24, w: 32, h: 56 }, [40, 100, 180, 255])
  const structure = await buildStructureReferenceBoard({
    name: 'template.png',
    mimeType: 'image/png',
    buffer: await encodeRgbaPng(template),
  }, { sourceLayoutId: 'topdown_rpg_v0' })
  const profile = resolveFullSheetGenerationProfile(FULL_SHEET_GENERATION_PROFILE_IDS.TOPDOWN)
  const providerPreset = resolveProviderPreset(providerEnv, 'gemini-native')
  const built = buildFullSheetGenerationReview({
    reviewId: 'review_text_identity_1',
    profile,
    providerPreset,
    description: 'one copper-haired ranger in a green coat',
    references: [structure],
  })

  assert.deepEqual(built.referenceManifest.items.map((item) => item.role), ['structure'])
  assert.deepEqual(built.requestManifest.reference_order.map((item) => item.role), ['structure'])
  assert.deepEqual(built.requestManifest.request_input.background_mode_contract, {
    requested: 'auto',
    canonical: 'auto',
    recipe_id: 'legacy_auto_v1',
  })
  assert.match(built.promptText, /structured written character description is the sole identity authority/i)
  assert.equal(built.requestManifest.prompt_sections.content_parts.some((part) => part.role === 'identity' && part.type === 'image'), false)
  assert.equal(built.review.provider_calls_used, 0)
})

test('identity reference builder rejects multiple significant subjects', async () => {
  const identity = rgba(96, 96)
  paint(identity, { x: 10, y: 18, w: 24, h: 64 }, [70, 120, 200, 255])
  paint(identity, { x: 58, y: 18, w: 24, h: 64 }, [180, 90, 70, 255])
  await assert.rejects(
    buildIdentityReferenceBoard({ name: 'two.png', mimeType: 'image/png', buffer: await encodeRgbaPng(identity) }),
    /one reliably isolated subject/,
  )
})

test('confirmed fixed-region Structure keeps the exact reviewed 1024 pixel outline', async () => {
  const source = await loadAuthoritativeGenerationStructureImage('fixed_region_motion_v0', {
    rootDir: process.cwd(),
  })
  const structure = await buildStructureReferenceBoard(source, {
    sourceLayoutId: 'fixed_region_motion_v0',
  })

  assert.equal(sha256GenerationBytes(structure.buffer), '6970952fdd0571493d46ec26b6fa750b56f1459f96ae3473d51090651c7da541')
  assert.equal(structure.report.structure_authority, 'repository_maintained_exact_outline')
  assert.equal(structure.report.structure_authority_id, 'fixed_region_motion_primary_structure_v1')
  assert.equal(structure.report.source_outline_preserved, true)
  assert.equal(structure.report.geometric_transform_only, 'transparent_padding_then_nearest_neighbor_resize')
})
