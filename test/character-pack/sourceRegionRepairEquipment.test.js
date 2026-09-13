import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import { FIXED_REGION_SOURCE_REGIONS } from '../../src/character-pack/fixedRegionGeometry.js'
import { loadRgba } from '../../src/character-pack/imageCodec.js'
import {
  buildFixedRegionSourceRepairPlan,
  buildFixedRegionSourceRepairPrompt,
  buildFixedRegionSourceRepairReferenceBundle,
  buildFixedRegionSourceRepairReferenceImages,
  evaluateFixedRegionCandidateCompleteness,
  runFixedRegionSourceRepairLoop,
  serializeFixedRegionSourceRepairLoopResult,
} from '../../src/character-pack/sourceRegionRepair.js'
import { FIXED_REGION_MOTION_LAYOUT_ID } from '../../src/character-pack/sourceLayoutIds.js'
import { resolveSourceLayout } from '../../src/character-pack/sourceLayouts.js'
import { evaluateFixedRegionEquipmentQuality } from '../../src/character-pack/sourceQualityGate.js'

const REAL_PIG_TEMPLATE = new URL('../../templates/motion_template_ocad_primary.png', import.meta.url)

function atlasReadyPlan(overrides = {}) {
  return buildFixedRegionSourceRepairPlan({
    actions: ['idledown'],
    regionKeys: ['idledown'],
    sourceSheetPath: '/managed/source.png',
    normalizedSheetPath: '/managed/normalized_sheet.png',
    motionTemplate: { enabled: true, preset: FIXED_REGION_MOTION_LAYOUT_ID },
    equipmentPolicy: 'none',
    ...overrides,
  })
}

test('fixed-region action repair uses three independent atlases and never holes or attaches the source sheet', async () => {
  const plan = atlasReadyPlan()
  const prompt = buildFixedRegionSourceRepairPrompt(plan)
  const sourceBuffer = await readFile(REAL_PIG_TEMPLATE)
  const bundle = await buildFixedRegionSourceRepairReferenceBundle({
    sourceSheetBuffer: sourceBuffer,
    normalizedSheetBuffer: sourceBuffer,
    motionTemplateBuffer: sourceBuffer,
    actions: plan.actions,
    regionKeys: plan.region_keys,
  })
  const references = bundle.reference_images
  const empty = await loadRgba(references[2].buffer)
  const targetSlot = bundle.evidence.layout.target_slots[0]
  const allOutputSlots = [
    ...bundle.evidence.layout.target_slots,
    ...bundle.evidence.layout.control_slots,
  ]

  assert.equal(plan.equipment_policy, 'none')
  assert.equal(plan.can_run, true)
  assert.equal(plan.estimated_provider_calls, 1)
  assert.equal(plan.reference_policy.source_target_regions_holed, false)
  assert.equal(plan.reference_policy.full_source_sheet_sent, false)
  assert.equal(plan.reference_policy.full_normalized_sheet_sent, false)
  assert.equal(plan.reference_policy.provider_candidate_feedback, false)
  assert.match(prompt, /equipment policy: none/i)
  assert.match(prompt, /new coordinate board, not a punched-out source sheet/i)
  assert.match(prompt, /No full source sheet, full normalized sheet, previous provider output/i)
  assert.match(prompt, /Fill all 1 target slots one-for-one/i)
  assert.match(prompt, /transparent interiors for every grid cell/i)
  assert.match(prompt, /CONTROL; leave fully transparent and draw nothing/i)
  assert.match(prompt, /Do not create white or colored panels inside individual cells/i)
  assert.deepEqual(references.map((item) => item.role), [
    'verified_character_identity_only',
    'per_slot_pose_and_facing_only',
    'independent_transparent_output_geometry',
  ])
  assert.equal(bundle.evidence.identity_anchors.some((anchor) => anchor.region_key === 'idledown'), false)
  assert.equal(bundle.evidence.full_source_sheet_attached, false)
  assert.equal(bundle.evidence.full_normalized_sheet_attached, false)
  assert.ok(targetSlot.atlas_inner)
  assert.equal(bundle.evidence.target_holes_zero_rgba, true)
  assert.equal(bundle.evidence.control_slots_zero_rgba, true)
  assert.equal(bundle.evidence.output_slot_nonzero_pixels, 0)
  for (const slot of allOutputSlots) {
    assert.ok(slot.atlas_inner)
    for (let y = slot.atlas_inner.y; y < slot.atlas_inner.y + slot.atlas_inner.h; y += 1) {
      for (let x = slot.atlas_inner.x; x < slot.atlas_inner.x + slot.atlas_inner.w; x += 1) {
        const offset = (y * empty.width + x) * 4
        assert.deepEqual([...empty.data.subarray(offset, offset + 4)], [0, 0, 0, 0])
      }
    }
  }
})

test('fixed-region completeness blocks an empty extracted target without treating the source as a reference', async () => {
  const sourceBuffer = await readFile(REAL_PIG_TEMPLATE)
  const references = await buildFixedRegionSourceRepairReferenceImages({
    sourceSheetBuffer: sourceBuffer,
    normalizedSheetBuffer: sourceBuffer,
    motionTemplateBuffer: sourceBuffer,
    actions: ['idledown'],
    regionKeys: ['idledown'],
  })
  const source = await loadRgba(sourceBuffer)
  const emptyProviderSource = {
    width: source.width,
    height: source.height,
    data: new Uint8ClampedArray(source.width * source.height * 4),
  }
  const report = evaluateFixedRegionCandidateCompleteness(emptyProviderSource, ['idledown'])

  assert.deepEqual(references.map((item) => item.name), [
    'identity_anchor_atlas.png',
    'pose_guide_atlas.png',
    'empty_output_atlas.png',
  ])
  assert.equal(report.provider_free, true)
  assert.equal(report.status, 'blocked')
  assert.deepEqual(report.empty_region_keys, ['idledown'])
  assert.equal(report.regions[0].visible_pixel_count, 0)
})

test('fixed-region loop records zero calls when provider validation fails before dispatch', async () => {
  const sourceBuffer = await readFile(REAL_PIG_TEMPLATE)
  const plan = atlasReadyPlan({ providerPresetId: 'missing-provider' })
  let fetchCalls = 0
  const result = await runFixedRegionSourceRepairLoop({
    plan,
    sourceSheetBuffer: sourceBuffer,
    normalizedSheetBuffer: sourceBuffer,
    motionTemplateBuffer: sourceBuffer,
    env: {},
    fetchImpl: async () => {
      fetchCalls += 1
      throw new Error('must not dispatch')
    },
  })

  assert.equal(result.status, 'failed_generation')
  assert.equal(result.summary.provider_calls_used, 0)
  assert.equal(fetchCalls, 0)
})

test('fixed-region loop checkpoints returned bytes before local decode and terminalizes a decode failure without retry', async () => {
  const sourceBuffer = await readFile(REAL_PIG_TEMPLATE)
  const invalidReturnedBytes = Buffer.from('provider-returned-non-image-bytes')
  const plan = atlasReadyPlan({
    providerPresetId: 'gemini-default',
    imageConfig: { image_size: '1K' },
  })
  let fetchCalls = 0
  let checkpointed = null
  const result = await runFixedRegionSourceRepairLoop({
    plan,
    sourceSheetBuffer: sourceBuffer,
    normalizedSheetBuffer: sourceBuffer,
    motionTemplateBuffer: sourceBuffer,
    env: {
      GEMINI_API_KEY: 'test-only-key',
      CHARACTER_IMAGE_PROVIDER: 'gemini',
      CHARACTER_IMAGE_PRESET_ID: 'gemini-default',
      GEMINI_IMAGE_MODEL: 'gemini-3.1-flash-image-preview',
    },
    fetchImpl: async () => {
      fetchCalls += 1
      return {
        ok: true,
        json: async () => ({
          candidates: [{
            content: {
              parts: [{ inlineData: { data: invalidReturnedBytes.toString('base64'), mimeType: 'image/png' } }],
            },
          }],
        }),
      }
    },
    onProviderCandidate: async ({ generation }) => {
      checkpointed = Buffer.from(generation.raw_provider_png)
    },
  })

  assert.equal(fetchCalls, 1)
  assert.deepEqual(checkpointed, invalidReturnedBytes)
  assert.equal(result.status, 'failed_post_processing')
  assert.equal(result.error.code, 'local_post_processing')
  assert.equal(result.summary.provider_calls_used, 1)
  assert.equal(result.summary.automatic_retry, false)
  assert.deepEqual(result.generation.raw_provider_png, invalidReturnedBytes)
})

test('fixed-region loop preserves a scoped review candidate when the independent output atlas leaves a target empty', async () => {
  const sourceBuffer = await readFile(REAL_PIG_TEMPLATE)
  const references = await buildFixedRegionSourceRepairReferenceImages({
    sourceSheetBuffer: sourceBuffer,
    normalizedSheetBuffer: sourceBuffer,
    motionTemplateBuffer: sourceBuffer,
    actions: ['idledown'],
    regionKeys: ['idledown'],
  })
  const providerBuffer = references[2].buffer
  const plan = atlasReadyPlan({
    providerPresetId: 'gemini-default',
    imageConfig: { image_size: '1K' },
  })
  let checkpointed = false
  const result = await runFixedRegionSourceRepairLoop({
    plan,
    sourceSheetBuffer: sourceBuffer,
    normalizedSheetBuffer: sourceBuffer,
    motionTemplateBuffer: sourceBuffer,
    env: {
      GEMINI_API_KEY: 'test-only-key',
      CHARACTER_IMAGE_PROVIDER: 'gemini',
      CHARACTER_IMAGE_PRESET_ID: 'gemini-default',
      GEMINI_IMAGE_MODEL: 'gemini-3.1-flash-image-preview',
    },
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{ inlineData: { data: providerBuffer.toString('base64'), mimeType: 'image/png' } }],
          },
        }],
      }),
    }),
    onProviderCandidate: async () => {
      checkpointed = true
    },
  })
  const serialized = serializeFixedRegionSourceRepairLoopResult(result)
  const source = await loadRgba(sourceBuffer)
  const review = await loadRgba(result.review_candidate.source_sheet_png)
  const target = FIXED_REGION_SOURCE_REGIONS.idledown
  let insideChangedPixels = 0
  let outsideChangedPixels = 0
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const offset = (y * source.width + x) * 4
      const changed = [0, 1, 2, 3].some((channel) => source.data[offset + channel] !== review.data[offset + channel])
      if (!changed) continue
      const inside = x >= target.x && x < target.x + target.w && y >= target.y && y < target.y + target.h
      if (inside) insideChangedPixels += 1
      else outsideChangedPixels += 1
    }
  }

  assert.equal(checkpointed, true)
  assert.equal(result.status, 'quality_blocked')
  assert.equal(result.error.code, 'candidate_target_region_empty')
  assert.deepEqual(result.candidate_validation.empty_region_keys, ['idledown'])
  assert.ok(Buffer.isBuffer(result.review_candidate.source_sheet_png))
  assert.equal(result.apply_result, null)
  assert.equal(result.summary.provider_calls_used, 1)
  assert.equal(result.summary.automatic_retry, false)
  assert.ok(insideChangedPixels > 0)
  assert.equal(outsideChangedPixels, 0)
  assert.deepEqual(serialized.review_candidate.region_keys, ['idledown'])
  assert.equal(Object.hasOwn(serialized.review_candidate, 'source_sheet_png'), false)
})

test('fixed-region plan keeps an exact real-sheet subset instead of expanding the whole action', async () => {
  const plan = atlasReadyPlan({
    actions: ['rundown'],
    regionKeys: ['rundown0', 'rundown3'],
  })
  const sourceBuffer = await readFile(REAL_PIG_TEMPLATE)
  const bundle = await buildFixedRegionSourceRepairReferenceBundle({
    sourceSheetBuffer: sourceBuffer,
    normalizedSheetBuffer: sourceBuffer,
    motionTemplateBuffer: sourceBuffer,
    actions: plan.actions,
    regionKeys: plan.region_keys,
  })

  assert.deepEqual(plan.region_keys, ['rundown0', 'rundown3'])
  assert.deepEqual(plan.preflight.region_keys, ['rundown0', 'rundown3'])
  assert.deepEqual(plan.selected.region_keys, ['rundown0', 'rundown3'])
  assert.deepEqual(bundle.evidence.layout.target_slots.map((slot) => slot.region_key), ['rundown0', 'rundown3'])
  assert.equal(bundle.evidence.identity_anchors.some((anchor) => plan.region_keys.includes(anchor.region_key)), false)
})

test('fixed-region gate requires observable removal in a selected region of the real template', async () => {
  const source = await loadRgba(await readFile(REAL_PIG_TEMPLATE))
  const report = evaluateFixedRegionEquipmentQuality(
    source,
    resolveSourceLayout(FIXED_REGION_MOTION_LAYOUT_ID),
    {
      equipmentPolicy: 'none',
      referenceImage: source,
      templateImage: source,
      regionKeys: ['idledown'],
      requireRemovalEvidence: true,
    },
  )

  assert.equal(report.provider_free, true)
  assert.equal(report.status, 'blocked')
  assert.deepEqual(report.selected_region_keys, ['idledown'])
  assert.equal(report.removal_evidence_required, true)
  assert.ok(report.blocking_errors.includes('equipment_gate:removal_not_observed:idledown'))
})
