import path from 'node:path'

import {
  actionRepairActionLabel,
  actionRepairEquipmentLayout,
  actionRepairRegionKeysForActions,
  normalizeActionRepairActions,
  normalizeActionRepairRegionKeys,
  resolveActionRepairLayout,
  scaleActionRepairRegion,
  selectedActionRepairRegionKeys,
} from './actionRepairLayouts.js'
import { encodeRgbaPng, loadRgba, resizeRgbaNearest } from './imageCodec.js'
import { cloneRgba, pixelOffset } from './imageMath.js'
import {
  FIXED_REGION_ACTION_REPAIR_ATLAS_SIZE,
  FIXED_REGION_ACTION_REPAIR_ATLAS_VERSION,
  buildFixedRegionActionRepairAtlasLayout,
  buildFixedRegionActionRepairAtlases,
  extractFixedRegionActionRepairAtlas,
} from './fixedRegionActionRepairAtlas.js'
import {
  FIXED_REGION_ACTION_REPAIR_ACCEPTANCE_FILE,
  FIXED_REGION_ACTION_REPAIR_REVIEW_FILE,
  stableActionRepairJson,
} from './fixedRegionActionRepairReview.js'
import {
  EQUIPMENT_POLICY,
  buildEquipmentGateOverlay,
  equipmentPromptRules,
  normalizeEquipmentPolicy,
  splitEquipmentLayers,
} from './equipmentPolicy.js'
import { OCAD_SOURCE_ACTION_ORDER } from './ocadSourceActions.js'
import { resolveProviderPreset, getExplicitImageConfig } from './providers/providerConfig.js'
import { requestGeminiPromptImage } from './providers/geminiAdapter.js'
import { requestOpenRouterPromptImage } from './providers/openRouterAdapter.js'
import { FIXED_REGION_MOTION_LAYOUT_ID } from './sourceLayoutIds.js'
import { evaluateActionRepairEquipmentQuality } from './sourceQualityGate.js'
import { removeBackground } from './sourcePreparation.js'

export const FIXED_REGION_SOURCE_REPAIR_MODE = 'fixed_region_source_provider_repair_v1'

function safePathSegment(value, fallback = 'item') {
  return (
    String(value ?? fallback)
      .replace(/[^a-zA-Z0-9._-]+/g, '_')
      .replace(/^\.+/, '')
      .replace(/\.+$/, '') || fallback
  )
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

export function normalizeFixedRegionRepairActions(actions = [], sourceLayoutId = FIXED_REGION_MOTION_LAYOUT_ID) {
  return normalizeActionRepairActions(sourceLayoutId, actions)
}

export function normalizeFixedRegionRepairRegionKeys(regionKeys = [], sourceLayoutId = FIXED_REGION_MOTION_LAYOUT_ID) {
  return normalizeActionRepairRegionKeys(sourceLayoutId, regionKeys)
}

function actionRegionKeys(actions, sourceLayoutId = FIXED_REGION_MOTION_LAYOUT_ID) {
  return actionRepairRegionKeysForActions(sourceLayoutId, actions)
}

function selectedRegionKeys(actions, regionKeys = null, sourceLayoutId = FIXED_REGION_MOTION_LAYOUT_ID) {
  return selectedActionRepairRegionKeys(sourceLayoutId, actions, regionKeys)
}

function actionLabel(action, sourceLayoutId = FIXED_REGION_MOTION_LAYOUT_ID) {
  return actionRepairActionLabel(sourceLayoutId, action)
}

function normalizedRepairInstruction(value) {
  const instruction = String(value ?? 'Correct the selected action slots while preserving the character identity.')
    .normalize('NFC')
    .trim()
  if (!instruction) throw new Error('fixed-region action repair instruction is required')
  if ([...instruction].length > 500) throw new Error('fixed-region action repair instruction is too long')
  if (/\p{Cc}/u.test(instruction)) throw new Error('fixed-region action repair instruction contains a control character')
  return instruction
}

function slotContractLine(slot) {
  const direction = slot.facing === 'front'
    ? 'front view, facing toward the viewer'
    : slot.facing === 'back'
      ? 'back view, facing away from the viewer'
      : slot.facing === 'right'
        ? 'screen-right side view'
        : 'screen-left side view'
  return `- Row ${slot.row + 1}, column ${slot.column + 1}: ${slot.region_key} (${slot.action}); ${direction}.`
}

function controlSlotContractLine(slot) {
  return `- Row ${slot.row + 1}, column ${slot.column + 1}: CONTROL; leave fully transparent and draw nothing.`
}

export function buildFixedRegionSourceRepairPrompt(plan = {}) {
  const actions = plan.actions ?? []
  const sourceLayoutId = plan.source_layout ?? FIXED_REGION_MOTION_LAYOUT_ID
  const regionKeys = plan.region_keys ?? actionRegionKeys(actions, sourceLayoutId)
  const atlas = plan.atlas ?? buildFixedRegionActionRepairAtlasLayout(regionKeys, sourceLayoutId)
  const equipmentPolicy = normalizeEquipmentPolicy(
    plan.equipment_policy ?? EQUIPMENT_POLICY.NONE,
  )
  const equipmentRules = equipmentPromptRules(equipmentPolicy)
  const instruction = normalizedRepairInstruction(plan.instruction)
  return [
    `Generate exactly one square pixel-art action repair atlas using the same invisible ${atlas.columns}-column by ${atlas.rows}-row coordinate system as the attached pose and empty-output atlases.`,
    '',
    `Approved action-slot correction: ${instruction}`,
    `Target source actions: ${actions.map((action) => actionLabel(action, sourceLayoutId)).join(', ')}`,
    `Target region keys: ${regionKeys.join(', ')}`,
    '',
    'Attached reference images, in order:',
    '1. IDENTITY ANCHOR ATLAS: verified-correct, unselected crops from the current character. It is the only authority for species, anatomy, face, hair, costume, proportions, palette, outline weight, lighting, and pixel density. Do not copy anchor poses into target slots.',
    '2. GRAYSCALE POSE GUIDE ATLAS: structural poses derived from the approved motion template. Copy only the pose, facing, stride phase, hand placement, foot placement, scale, and baseline in the same slot. Never copy or blend the guide character identity, face, species, anatomy, costume, or colors.',
    '3. INDEPENDENT EMPTY OUTPUT ATLAS: a new coordinate board, not a punched-out source sheet. It has transparent interiors for every grid cell. Only cells paired with a grayscale pose are targets; every pose-empty cell is a control and must remain transparent.',
    'No full source sheet, full normalized sheet, previous provider output, repaired candidate, or selected wrong target crop is attached.',
    '',
    'Exact output-slot contract:',
    ...atlas.target_slots.map(slotContractLine),
    ...atlas.control_slots.map(controlSlotContractLine),
    '',
    'Hard constraints:',
    `- Return one square atlas with the same ${atlas.columns}-column by ${atlas.rows}-row placement. Each target slot contains exactly one complete, separated, centered, full-body version of the identity-anchor character.`,
    `- Fill all ${regionKeys.length} target slots one-for-one. Do not leave any target slot transparent, blank, missing, or background-only.`,
    '- Draw only in cells that contain a grayscale pose guide. Never copy identity-anchor examples into pose-empty control cells.',
    '- Preserve one consistent character identity across every target. The grayscale guide never overrides identity.',
    '- Follow the gray pose in the corresponding same-position cell. Do not reorder, swap, duplicate, or blend poses across slots or action groups.',
    '- Treat unwanted weapons, incorrect hand poses, wrong facing, wrong stride, and other pose defects as full action-slot corrections.',
    ...equipmentRules.map((rule) => `- ${rule}`),
    '- No duplicate limbs, ghost limbs, extra anatomy, action trails, speed lines, motion blur, shadows, scenery, UI, labels, numbers, borders, or visible grid.',
    '- Keep a pure transparent background. If alpha is unavailable, use one flat solid #FF00FF background; never draw a checkerboard transparency pattern.',
    '- Do not create white or colored panels inside individual cells. Background treatment must be uniform across the entire atlas.',
    '- Crisp small RPG pixel art only, with stable scale and baseline; no painterly rendering or smooth vector edges.',
    '- Local processing will extract only the named target slots and copy them into the exact selected source regions. Every other source pixel remains authoritative and unchanged.',
  ].filter(Boolean).join('\n')
}

export function buildFixedRegionSourceRepairPlan({
  actions,
  regionKeys = null,
  sourceLayoutId = FIXED_REGION_MOTION_LAYOUT_ID,
  outputDir = path.join('generated', 'fixed-region-source-repairs', `repair_${Date.now().toString(36)}`),
  providerPresetId = '',
  imageConfig = {},
  backgroundMode = 'auto',
  motionTemplate = null,
  sourceSheetPath = null,
  normalizedSheetPath = null,
  sourceJobId = null,
  equipmentPolicy = EQUIPMENT_POLICY.NONE,
  instruction = 'Correct the selected action slots while preserving the character identity.',
} = {}) {
  const sourceLayout = resolveActionRepairLayout(sourceLayoutId)
  const selectedActions = normalizeFixedRegionRepairActions(actions, sourceLayout.id)
  const exactRegionKeys = selectedRegionKeys(selectedActions, regionKeys, sourceLayout.id)
  const atlas = buildFixedRegionActionRepairAtlasLayout(exactRegionKeys, sourceLayout.id)
  const providerPreset = providerPresetId || null
  const normalizedEquipmentPolicy = normalizeEquipmentPolicy(equipmentPolicy)
  const exactInstruction = normalizedRepairInstruction(instruction)
  const resolvedConfig = {
    aspect_ratio: '1:1',
    ...getExplicitImageConfig(imageConfig),
  }
  const preflightErrors = [
    ...(!sourceSheetPath ? ['source sheet is required for action repair'] : []),
    ...(!normalizedSheetPath ? ['normalized sheet is required for verified identity anchors'] : []),
    ...(motionTemplate?.enabled !== true ? ['motion template is required for the pose guide atlas'] : []),
  ]
  return {
    schema_version: 1,
    mode: FIXED_REGION_SOURCE_REPAIR_MODE,
    run_id: sourceJobId ?? null,
    source_layout: sourceLayout.id,
    output_dir: outputDir,
    provider_preset_id: providerPreset,
    image_config: resolvedConfig,
    background_mode: backgroundMode,
    equipment_policy: normalizedEquipmentPolicy,
    instruction: exactInstruction,
    atlas,
    reference_policy: {
      source_target_regions_holed: false,
      identity_anchor_atlas: true,
      pose_guide_atlas: true,
      independent_empty_output_atlas: true,
      full_source_sheet_sent: false,
      full_normalized_sheet_sent: false,
      provider_candidate_feedback: false,
    },
    motion_template: motionTemplate,
    actions: selectedActions,
    region_keys: exactRegionKeys,
    estimated_provider_calls: 1,
    can_run: preflightErrors.length === 0,
    preflight: {
      can_run: preflightErrors.length === 0,
      errors: preflightErrors,
      source_sheet: sourceSheetPath,
      normalized_sheet: normalizedSheetPath,
      actions: selectedActions,
      region_keys: exactRegionKeys,
      source_region_mask: {
        width: sourceLayout.sheet.w,
        height: sourceLayout.sheet.h,
        regions: exactRegionKeys.map((key) => ({
          key,
          ...sourceLayout.regions[key],
        })),
      },
      reference_roles: [
        'verified_character_identity_only',
        'per_slot_pose_and_facing_only',
        'independent_transparent_output_geometry',
      ],
      image_dimensions: {
        references: { width: FIXED_REGION_ACTION_REPAIR_ATLAS_SIZE, height: FIXED_REGION_ACTION_REPAIR_ATLAS_SIZE },
        provider_output: resolvedConfig.image_size ?? 'provider_default',
      },
    },
    selected: {
      actions: selectedActions,
      source_actions: selectedActions,
      source_layout: sourceLayout.id,
      region_keys: exactRegionKeys,
      expected_output: {
        kind: 'independent_action_repair_atlas_then_scoped_source_patch',
        width: sourceLayout.sheet.w,
        height: sourceLayout.sheet.h,
        copied_region_count: exactRegionKeys.length,
      },
      prompt: null,
    },
    files: {
      plan: path.join(outputDir, 'fixed_region_source_repair_plan.json'),
      review_contract: path.join(outputDir, FIXED_REGION_ACTION_REPAIR_REVIEW_FILE),
      acceptance_manifest: path.join(outputDir, FIXED_REGION_ACTION_REPAIR_ACCEPTANCE_FILE),
      summary: path.join(outputDir, 'fixed_region_source_repair_summary.json'),
      prompt: path.join(outputDir, 'selected_prompt.txt'),
      identity_anchor_atlas: path.join(outputDir, 'identity_anchor_atlas.png'),
      pose_guide_atlas: path.join(outputDir, 'pose_guide_atlas.png'),
      empty_output_atlas: path.join(outputDir, 'empty_output_atlas.png'),
      raw_provider_output: path.join(outputDir, 'raw_provider_repair_atlas.png'),
      background_removed_provider_atlas: path.join(outputDir, 'background_removed_provider_atlas.png'),
      atlas_extraction_report: path.join(outputDir, 'atlas_extraction_report.json'),
      extracted_frames_dir: path.join(outputDir, 'extracted_frames'),
      normalized_provider_sheet: path.join(outputDir, 'normalized_provider_source_sheet.png'),
      repaired_source_sheet: path.join(outputDir, 'repaired_source_sheet.png'),
      review_candidate_source_sheet: path.join(outputDir, 'candidate_scoped_review_only.png'),
      candidate_validation_report: path.join(outputDir, 'candidate_validation_report.json'),
      source_scope_report: path.join(outputDir, 'source_scope_report.json'),
      equipment_quality_report: path.join(outputDir, 'equipment_quality_report.json'),
      equipment_quality_overlay: path.join(outputDir, 'equipment_quality_overlay.png'),
      equipment_body_candidate: path.join(outputDir, 'equipment_body_candidate.png'),
      equipment_layer: path.join(outputDir, 'equipment_layer.png'),
    },
    claim_boundary: 'This loop calls one provider at most once with a verified identity atlas, grayscale pose-guide atlas, and independent empty output atlas. It never holes the source character, sends a selected wrong crop, retries, feeds a candidate back as reference, edits an unselected source pixel, or accepts a candidate into an Editor project without a later explicit user action.',
  }
}

export function evaluateFixedRegionCandidateCompleteness(
  image,
  regionKeys = [],
  sourceLayoutId = FIXED_REGION_MOTION_LAYOUT_ID,
) {
  if (!image?.width || !image?.height || !image?.data) {
    throw new Error('fixed-region candidate image is required')
  }
  const exactRegionKeys = normalizeFixedRegionRepairRegionKeys(regionKeys, sourceLayoutId)
  const regions = exactRegionKeys.map((key) => {
    const region = scaleActionRepairRegion(sourceLayoutId, key, image)
    let visiblePixelCount = 0
    for (let y = region.y; y < region.y + region.h; y += 1) {
      for (let x = region.x; x < region.x + region.w; x += 1) {
        if (image.data[pixelOffset(image.width, x, y) + 3] > 0) visiblePixelCount += 1
      }
    }
    return {
      key,
      visible_pixel_count: visiblePixelCount,
      status: visiblePixelCount > 0 ? 'pass' : 'blocked',
    }
  })
  const emptyRegionKeys = regions.filter((item) => item.status === 'blocked').map((item) => item.key)
  return {
    schema_version: 1,
    provider_free: true,
    status: emptyRegionKeys.length ? 'blocked' : 'pass',
    selected_region_keys: exactRegionKeys,
    empty_region_keys: emptyRegionKeys,
    regions,
  }
}

export async function evaluateFixedRegionRepairScope({
  beforeBuffer,
  afterBuffer,
  regionKeys,
  sourceLayoutId = FIXED_REGION_MOTION_LAYOUT_ID,
} = {}) {
  if (!beforeBuffer || !afterBuffer) throw new Error('beforeBuffer and afterBuffer are required for scope validation')
  const exactRegionKeys = normalizeFixedRegionRepairRegionKeys(regionKeys, sourceLayoutId)
  const [before, after] = await Promise.all([loadRgba(beforeBuffer), loadRgba(afterBuffer)])
  if (before.width !== after.width || before.height !== after.height) {
    throw new Error('scope validation image dimensions differ')
  }
  const rectangles = exactRegionKeys.map((key) => (
    scaleActionRepairRegion(sourceLayoutId, key, before)
  ))
  let insideChangedPixels = 0
  let outsideChangedPixels = 0
  for (let y = 0; y < before.height; y += 1) {
    for (let x = 0; x < before.width; x += 1) {
      const offset = pixelOffset(before.width, x, y)
      const changed = before.data[offset] !== after.data[offset] ||
        before.data[offset + 1] !== after.data[offset + 1] ||
        before.data[offset + 2] !== after.data[offset + 2] ||
        before.data[offset + 3] !== after.data[offset + 3]
      if (!changed) continue
      const inside = rectangles.some((rectangle) => (
        x >= rectangle.x && x < rectangle.x + rectangle.w &&
        y >= rectangle.y && y < rectangle.y + rectangle.h
      ))
      if (inside) insideChangedPixels += 1
      else outsideChangedPixels += 1
    }
  }
  return {
    schema_version: 1,
    provider_free: true,
    status: outsideChangedPixels === 0 ? 'scope_pass' : 'scope_fail',
    selected_region_keys: exactRegionKeys,
    inside_selected_changed_pixels: insideChangedPixels,
    outside_selected_changed_pixels: outsideChangedPixels,
  }
}

export function finalizeFixedRegionSourceRepairPlan(plan) {
  return {
    ...plan,
    selected: {
      ...plan.selected,
      prompt: buildFixedRegionSourceRepairPrompt(plan),
    },
  }
}

export async function buildFixedRegionSourceRepairReferenceBundle({
  sourceSheetBuffer,
  normalizedSheetBuffer = null,
  motionTemplateBuffer,
  normalizedFrameMappings = [],
  actions = [],
  regionKeys = null,
  sourceLayoutId = FIXED_REGION_MOTION_LAYOUT_ID,
} = {}) {
  if (!sourceSheetBuffer) throw new Error('sourceSheetBuffer is required')
  const selectedActions = normalizeFixedRegionRepairActions(actions, sourceLayoutId)
  const exactRegionKeys = selectedRegionKeys(selectedActions, regionKeys, sourceLayoutId)
  return buildFixedRegionActionRepairAtlases({
    sourceSheetBuffer,
    normalizedSheetBuffer,
    motionTemplateBuffer,
    normalizedFrameMappings,
    regionKeys: exactRegionKeys,
    sourceLayoutId,
  })
}

export async function buildFixedRegionSourceRepairReferenceImages(options = {}) {
  const bundle = await buildFixedRegionSourceRepairReferenceBundle(options)
  return bundle.reference_images
}

async function normalizeProviderSourceSheet(buffer, targetSize, backgroundMode) {
  const raw = await loadRgba(buffer)
  const background = await removeBackground(raw, { backgroundMode })
  const image = background.image.width === targetSize.w && background.image.height === targetSize.h
    ? background.image
    : await resizeRgbaNearest(background.image, targetSize)
  return {
    image,
    png: await encodeRgbaPng(image),
    postprocess: {
      source_size: { w: raw.width, h: raw.height },
      background_mode: background.mode,
      background_warnings: background.warnings,
      normalized_size: { w: image.width, h: image.height },
      normalization: {
        method: raw.width === targetSize.w && raw.height === targetSize.h ? 'exact_size' : 'full_canvas_nearest_resize',
        target_size: targetSize,
      },
    },
  }
}

function pasteRegion(target, patch, region) {
  for (let y = 0; y < region.h; y += 1) {
    for (let x = 0; x < region.w; x += 1) {
      const offset = pixelOffset(target.width, region.x + x, region.y + y)
      const src = pixelOffset(patch.width, region.x + x, region.y + y)
      target.data[offset] = patch.data[src]
      target.data[offset + 1] = patch.data[src + 1]
      target.data[offset + 2] = patch.data[src + 2]
      target.data[offset + 3] = patch.data[src + 3]
    }
  }
}

export async function applyFixedRegionSourceRepair({
  sourceSheetBuffer,
  providerSheetBuffer,
  actions,
  regionKeys = null,
  sourceLayoutId = FIXED_REGION_MOTION_LAYOUT_ID,
} = {}) {
  if (!sourceSheetBuffer) throw new Error('sourceSheetBuffer is required')
  if (!providerSheetBuffer) throw new Error('providerSheetBuffer is required')
  const selectedActions = normalizeFixedRegionRepairActions(actions, sourceLayoutId)
  const exactRegionKeys = selectedRegionKeys(selectedActions, regionKeys, sourceLayoutId)
  const source = await loadRgba(sourceSheetBuffer)
  const targetSize = { w: source.width, h: source.height }
  const normalizedProvider = await normalizeProviderSourceSheet(providerSheetBuffer, targetSize, 'passthrough')
  const repaired = cloneRgba(source)
  for (const key of exactRegionKeys) {
    const region = scaleActionRepairRegion(sourceLayoutId, key, source)
    pasteRegion(repaired, normalizedProvider.image, region)
  }
  return {
    repaired_source_sheet_png: await encodeRgbaPng(repaired),
    normalized_provider_source_sheet_png: normalizedProvider.png,
    actions: selectedActions,
    region_keys: exactRegionKeys,
    postprocess: normalizedProvider.postprocess,
  }
}

function resolvedImageConfig(providerPreset, imageConfig = {}) {
  return {
    ...providerPreset.imageConfig,
    ...getExplicitImageConfig(imageConfig),
  }
}

export async function generateFixedRegionSourceRepairSheet({
  plan,
  referenceImages = [],
  env = process.env,
  fetchImpl = globalThis.fetch,
  onProviderDispatch = null,
} = {}) {
  if (!plan) throw new Error('fixed-region source repair plan is required')
  const providerPreset = resolveProviderPreset(env, plan.provider_preset_id || '')
  const apiKey = requireProviderRuntime(providerPreset, fetchImpl)
  const finalImageConfig = resolvedImageConfig(providerPreset, plan.image_config)
  const reviewedProvider = plan.provider
  if (reviewedProvider && (reviewedProvider.id !== providerPreset.id ||
      reviewedProvider.provider !== providerPreset.provider || reviewedProvider.model !== providerPreset.model ||
      stableActionRepairJson(reviewedProvider.image_config) !== stableActionRepairJson(finalImageConfig))) {
    throw Object.assign(new Error('reviewed fixed-region provider configuration changed before dispatch'), {
      status: 'failed_model_error',
      retry_hint: 'new_review_required',
    })
  }
  const request = {
    providerPreset,
    apiKey,
    prompt: buildFixedRegionSourceRepairPrompt(plan),
    imageConfig: finalImageConfig,
    images: referenceImages,
    fetchImpl,
  }
  if (onProviderDispatch) {
    await onProviderDispatch({
      provider: providerPreset.provider,
      provider_preset_id: providerPreset.id,
      model: providerPreset.model,
    })
  }
  const generated = providerPreset.provider === 'gemini'
    ? await requestGeminiPromptImage(request)
    : await requestOpenRouterPromptImage(request)
  return {
    schema_version: 1,
    provider: providerPreset.provider,
    provider_preset_id: providerPreset.id,
    provider_label: providerPreset.label,
    model: providerPreset.model,
    image_config: finalImageConfig,
    input_images: referenceImages.map((image) => image.name ?? null).filter(Boolean),
    prompt: generated.prompt,
    raw_provider_png: generated.buffer,
  }
}

function generationError(error) {
  return {
    message: String(error?.message || error),
    status: error?.status ?? 'failed_model_error',
    retry_hint: error?.retry_hint ?? 'manual_inspect',
  }
}

function postGenerationFailureResult({
  plan,
  referenceImages,
  generation,
  stage,
  reviewCandidate = null,
  candidateValidation = null,
  qualityGate = null,
  atlasEvidence = null,
  atlasExtraction = null,
  scopeValidation = null,
} = {}) {
  const controlledMessage = stage === 'candidate_persistence'
    ? 'provider candidate could not be persisted before local validation'
    : 'provider candidate failed local post-processing'
  return {
    schema_version: 1,
    mode: FIXED_REGION_SOURCE_REPAIR_MODE,
    status: 'failed_post_processing',
    run_id: plan.run_id,
    reference_images: referenceImages,
    atlas_evidence: atlasEvidence,
    generation,
    error: {
      code: stage,
      message: controlledMessage,
      status: 'failed_post_processing',
      retry_hint: 'manual_review_no_retry',
    },
    review_candidate: reviewCandidate,
    atlas_extraction: atlasExtraction,
    scope_validation: scopeValidation,
    candidate_validation: candidateValidation,
    quality_gate: qualityGate,
    apply_result: null,
    accepted: false,
    summary: {
      estimated_provider_calls: 1,
      provider_calls_used: 1,
      generated_count: 1,
      applied: false,
      automatic_retry: false,
      candidate_feedback: false,
      quality_status: 'unknown',
      requires_user_confirmation: true,
      failure_stage: stage,
    },
    claim_boundary: plan.claim_boundary,
  }
}

export async function runFixedRegionSourceRepairLoop({
  plan,
  sourceSheetBuffer,
  normalizedSheetBuffer = null,
  motionTemplateBuffer = null,
  normalizedFrameMappings = [],
  env = process.env,
  fetchImpl = globalThis.fetch,
  onProviderCandidate = null,
  onProviderDispatch = null,
  referenceBundle: reviewedReferenceBundle = null,
} = {}) {
  if (!plan?.can_run) throw new Error(`fixed-region source repair preflight failed: ${(plan?.preflight?.errors ?? []).join('; ')}`)
  const referenceBundle = reviewedReferenceBundle ?? await buildFixedRegionSourceRepairReferenceBundle({
    sourceSheetBuffer,
    normalizedSheetBuffer,
    motionTemplateBuffer,
    normalizedFrameMappings,
    actions: plan.actions ?? plan.selected?.actions ?? [],
    regionKeys: plan.region_keys ?? plan.selected?.region_keys ?? null,
    sourceLayoutId: plan.source_layout,
  })
  const referenceImages = referenceBundle.reference_images
  let generation
  let providerCallsUsed = 0
  try {
    generation = await generateFixedRegionSourceRepairSheet({
      plan,
      referenceImages,
      env,
      fetchImpl,
      onProviderDispatch: async (dispatch) => {
        if (onProviderDispatch) await onProviderDispatch(dispatch)
        providerCallsUsed = 1
      },
    })
  } catch (error) {
    return {
      schema_version: 1,
      mode: FIXED_REGION_SOURCE_REPAIR_MODE,
      status: 'failed_generation',
      run_id: plan.run_id,
      reference_images: referenceImages,
      atlas_evidence: referenceBundle.evidence,
      generation: null,
      error: generationError(error),
      apply_result: null,
      summary: {
        estimated_provider_calls: 1,
        provider_calls_used: providerCallsUsed,
        generated_count: 0,
        applied: false,
        automatic_retry: false,
        candidate_feedback: false,
      },
      claim_boundary: plan.claim_boundary,
    }
  }
  if (onProviderCandidate) {
    try {
      await onProviderCandidate({ plan, referenceImages, generation })
    } catch {
      return postGenerationFailureResult({
        plan,
        referenceImages,
        generation,
        stage: 'candidate_persistence',
        atlasEvidence: referenceBundle.evidence,
      })
    }
  }

  let persistedGeneration = generation
  let reviewCandidate = null
  let candidateValidation = null
  let qualityGate = null
  let atlasExtraction = null
  let scopeValidation = null
  try {
    const selectedActions = plan.actions ?? plan.selected?.actions ?? []
    const exactRegionKeys = plan.region_keys ?? plan.selected?.region_keys ?? actionRegionKeys(
      selectedActions,
      plan.source_layout,
    )
    atlasExtraction = await extractFixedRegionActionRepairAtlas({
      providerAtlasBuffer: generation.raw_provider_png,
      sourceSheetBuffer,
      normalizedSheetBuffer,
      motionTemplateBuffer,
      normalizedFrameMappings,
      regionKeys: exactRegionKeys,
      sourceLayoutId: plan.source_layout,
    })
    persistedGeneration = {
      ...generation,
      normalized_provider_source_sheet_png: atlasExtraction.provider_source_sheet_png,
      background_removed_provider_atlas_png: atlasExtraction.background_removed_provider_atlas_png,
      atlas_extraction_report: atlasExtraction.report,
      extracted_frames: atlasExtraction.extracted_frames,
      postprocess: {
        method: FIXED_REGION_ACTION_REPAIR_ATLAS_VERSION,
        provider_atlas_size: atlasExtraction.report.provider_source_size,
        atlas_grid: atlasExtraction.report.atlas_grid,
      },
    }
    const providerSourceImage = await loadRgba(atlasExtraction.provider_source_sheet_png)
    candidateValidation = evaluateFixedRegionCandidateCompleteness(
      providerSourceImage,
      exactRegionKeys,
      plan.source_layout,
    )
    const scopedCandidate = await applyFixedRegionSourceRepair({
      sourceSheetBuffer,
      providerSheetBuffer: atlasExtraction.provider_source_sheet_png,
      actions: selectedActions,
      regionKeys: exactRegionKeys,
      sourceLayoutId: plan.source_layout,
    })
    reviewCandidate = {
      source_sheet_png: scopedCandidate.repaired_source_sheet_png,
      actions: scopedCandidate.actions,
      region_keys: scopedCandidate.region_keys,
      postprocess: scopedCandidate.postprocess,
    }
    scopeValidation = await evaluateFixedRegionRepairScope({
      beforeBuffer: sourceSheetBuffer,
      afterBuffer: scopedCandidate.repaired_source_sheet_png,
      regionKeys: exactRegionKeys,
      sourceLayoutId: plan.source_layout,
    })
    if (scopeValidation.status !== 'scope_pass') {
      throw new Error('action repair changed pixels outside the selected source regions')
    }
    const actionRepairLayout = resolveActionRepairLayout(plan.source_layout)
    const sourceSheet = await normalizeProviderSourceSheet(sourceSheetBuffer, actionRepairLayout.sheet, 'passthrough')
    const templateSheet = motionTemplateBuffer
      ? await normalizeProviderSourceSheet(motionTemplateBuffer, actionRepairLayout.sheet, 'passthrough')
      : null
    const equipmentGate = evaluateActionRepairEquipmentQuality(
      providerSourceImage,
      actionRepairEquipmentLayout(plan.source_layout),
      {
        equipmentPolicy: plan.equipment_policy ?? EQUIPMENT_POLICY.NONE,
        referenceImage: sourceSheet.image,
        templateImage: templateSheet?.image ?? null,
        regionKeys: exactRegionKeys,
        requireRemovalEvidence: (plan.equipment_policy ?? EQUIPMENT_POLICY.NONE) !== EQUIPMENT_POLICY.PRESERVE,
        preferTemplateEnvelope: true,
      },
    )
    const equipmentOverlayPng = await encodeRgbaPng(
      buildEquipmentGateOverlay(providerSourceImage, equipmentGate),
    )
    let separated = null
    if (equipmentGate.policy === EQUIPMENT_POLICY.SEPARATE) {
      const layers = splitEquipmentLayers(providerSourceImage, equipmentGate)
      separated = {
        body_candidate_png: await encodeRgbaPng(layers.body),
        equipment_layer_png: await encodeRgbaPng(layers.equipment),
        removed_pixel_count: layers.removed_pixel_count,
      }
    }
    qualityGate = {
      report: equipmentGate,
      overlay_png: equipmentOverlayPng,
      separated,
    }
    if (candidateValidation.status === 'blocked' ||
        atlasExtraction.report.status === 'extraction_blocked' ||
        equipmentGate.status === 'blocked') {
      const completenessBlocked = candidateValidation.status === 'blocked'
      const extractionBlocked = atlasExtraction.report.status === 'extraction_blocked'
      return {
        schema_version: 1,
        mode: FIXED_REGION_SOURCE_REPAIR_MODE,
        status: 'quality_blocked',
        run_id: plan.run_id,
        reference_images: referenceImages,
        atlas_evidence: referenceBundle.evidence,
        generation: persistedGeneration,
        error: {
          code: completenessBlocked
            ? 'candidate_target_region_empty'
            : extractionBlocked
              ? 'candidate_atlas_extraction_blocked'
              : 'equipment_quality_blocked',
          message: completenessBlocked
            ? 'provider candidate left one or more selected target regions empty'
            : extractionBlocked
              ? 'provider action atlas did not contain exactly one usable subject in every selected slot'
              : 'provider candidate was blocked by the local equipment quality gate',
          status: 'failed_post_processing',
          retry_hint: 'manual_review_no_retry',
        },
        review_candidate: reviewCandidate,
        atlas_extraction: atlasExtraction.report,
        scope_validation: scopeValidation,
        candidate_validation: candidateValidation,
        quality_gate: qualityGate,
        apply_result: null,
        accepted: false,
        summary: {
          estimated_provider_calls: 1,
          provider_calls_used: 1,
          generated_count: 1,
          applied: false,
          automatic_retry: false,
          candidate_feedback: false,
          quality_status: 'blocked',
          atlas_extraction_status: atlasExtraction.report.status,
          empty_region_keys: candidateValidation.empty_region_keys,
          rejected_pixel_count: equipmentGate.rejected_pixel_count,
          requires_user_confirmation: true,
        },
        claim_boundary: plan.claim_boundary,
      }
    }
    return {
      schema_version: 1,
      mode: FIXED_REGION_SOURCE_REPAIR_MODE,
      status: 'source_repaired',
      run_id: plan.run_id,
      reference_images: referenceImages,
      atlas_evidence: referenceBundle.evidence,
      generation: persistedGeneration,
      error: null,
      review_candidate: reviewCandidate,
      atlas_extraction: atlasExtraction.report,
      scope_validation: scopeValidation,
      candidate_validation: candidateValidation,
      quality_gate: qualityGate,
      apply_result: scopedCandidate,
      accepted: false,
      summary: {
        estimated_provider_calls: 1,
        provider_calls_used: 1,
        generated_count: 1,
        applied: true,
        automatic_retry: false,
        candidate_feedback: false,
        quality_status: 'pass',
        atlas_extraction_status: atlasExtraction.report.status,
        empty_region_keys: [],
        requires_user_confirmation: true,
        action_count: scopedCandidate.actions.length,
        copied_region_count: scopedCandidate.region_keys.length,
      },
      claim_boundary: plan.claim_boundary,
    }
  } catch {
    return postGenerationFailureResult({
      plan,
      referenceImages,
      generation: persistedGeneration,
      stage: 'local_post_processing',
      reviewCandidate,
      candidateValidation,
      qualityGate,
      atlasEvidence: referenceBundle.evidence,
      atlasExtraction: atlasExtraction?.report ?? null,
      scopeValidation,
    })
  }
}

export function fixedRegionRepairArtifactFileMap(plan) {
  return {
    plan: plan.files.plan,
    review_contract: plan.files.review_contract,
    acceptance_manifest: plan.files.acceptance_manifest,
    summary: plan.files.summary,
    prompt: plan.files.prompt,
    identity_anchor_atlas: plan.files.identity_anchor_atlas,
    pose_guide_atlas: plan.files.pose_guide_atlas,
    empty_output_atlas: plan.files.empty_output_atlas,
    raw_provider_output: plan.files.raw_provider_output,
    background_removed_provider_atlas: plan.files.background_removed_provider_atlas,
    atlas_extraction_report: plan.files.atlas_extraction_report,
    extracted_frames_dir: plan.files.extracted_frames_dir,
    normalized_provider_sheet: plan.files.normalized_provider_sheet,
    repaired_source_sheet: plan.files.repaired_source_sheet,
    review_candidate_source_sheet: plan.files.review_candidate_source_sheet,
    candidate_validation_report: plan.files.candidate_validation_report,
    source_scope_report: plan.files.source_scope_report,
    equipment_quality_report: plan.files.equipment_quality_report,
    equipment_quality_overlay: plan.files.equipment_quality_overlay,
    equipment_body_candidate: plan.files.equipment_body_candidate,
    equipment_layer: plan.files.equipment_layer,
  }
}

export function serializeFixedRegionSourceRepairPlan(plan = {}) {
  return {
    ...plan,
    actions: plan.actions ?? plan.selected?.actions ?? [],
    selected: plan.selected
      ? {
          actions: plan.selected.actions,
          source_actions: plan.selected.source_actions,
          source_layout: plan.selected.source_layout,
          region_keys: plan.selected.region_keys,
          expected_output: plan.selected.expected_output,
          prompt: plan.selected.prompt,
        }
      : null,
  }
}

export function serializeFixedRegionSourceRepairLoopResult(result = {}) {
  return {
    ...result,
    reference_images: (result.reference_images ?? []).map((image) => ({
      name: image.name,
      role: image.role,
    })),
    generation: result.generation
      ? {
          schema_version: result.generation.schema_version,
          provider: result.generation.provider,
          provider_preset_id: result.generation.provider_preset_id,
          provider_label: result.generation.provider_label,
          model: result.generation.model,
          image_config: result.generation.image_config,
          input_images: result.generation.input_images,
          prompt: result.generation.prompt,
          postprocess: result.generation.postprocess,
        }
      : null,
    quality_gate: result.quality_gate
      ? {
          report: result.quality_gate.report,
          separated: result.quality_gate.separated
            ? { removed_pixel_count: result.quality_gate.separated.removed_pixel_count }
            : null,
        }
      : null,
    review_candidate: result.review_candidate
      ? {
          actions: result.review_candidate.actions,
          region_keys: result.review_candidate.region_keys,
          postprocess: result.review_candidate.postprocess,
        }
      : null,
    candidate_validation: result.candidate_validation ?? null,
    apply_result: result.apply_result
      ? {
          actions: result.apply_result.actions,
          region_keys: result.apply_result.region_keys,
          postprocess: result.apply_result.postprocess,
        }
      : null,
  }
}

export function allFixedRegionSourceActions() {
  const layout = resolveActionRepairLayout(FIXED_REGION_MOTION_LAYOUT_ID)
  return OCAD_SOURCE_ACTION_ORDER.filter((action) => layout.action_region_keys[action]?.length)
}
