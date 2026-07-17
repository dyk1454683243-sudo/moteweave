import path from 'node:path'

import {
  FIXED_REGION_SOURCE_ACTION_REGION_KEYS,
  FIXED_REGION_SOURCE_REGIONS,
  FIXED_REGION_SOURCE_SHEET,
  getFixedRegionSourceActionRegionKeys,
  scaleFixedRegionSourceRegion,
} from './fixedRegionGeometry.js'
import { encodeRgbaPng, loadRgba, resizeRgbaNearest } from './imageCodec.js'
import { cloneRgba, pixelOffset } from './imageMath.js'
import {
  OCAD_SOURCE_ACTIONS,
  OCAD_SOURCE_ACTION_ORDER,
  isOcadSourceAction,
} from './ocadSourceActions.js'
import { resolveProviderPreset, getExplicitImageConfig } from './providers/providerConfig.js'
import { requestGeminiPromptImage } from './providers/geminiAdapter.js'
import { requestOpenRouterPromptImage } from './providers/openRouterAdapter.js'
import { FIXED_REGION_MOTION_LAYOUT_ID } from './sourceLayoutIds.js'
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

export function normalizeFixedRegionRepairActions(actions = []) {
  const raw = Array.isArray(actions) ? actions : [actions]
  const unique = []
  for (const action of raw.map((item) => String(item ?? '').trim()).filter(Boolean)) {
    if (!isOcadSourceAction(action)) throw new Error(`unknown fixed-region source action: ${action}`)
    if (!unique.includes(action)) unique.push(action)
  }
  if (!unique.length) throw new Error('at least one fixed-region source action is required')
  return unique
}

function actionRegionKeys(actions) {
  return actions.flatMap((action) => getFixedRegionSourceActionRegionKeys(action))
}

function actionLabel(action) {
  const info = OCAD_SOURCE_ACTIONS[action]
  return info?.zh ? `${action} (${info.label}, ${info.zh})` : action
}

export function buildFixedRegionSourceRepairPrompt(plan = {}) {
  const actions = plan.actions ?? []
  const regionKeys = plan.region_keys ?? actionRegionKeys(actions)
  return [
    'Repair selected regions in a fixed-region pixel character source sheet.',
    '',
    `Target source actions: ${actions.map(actionLabel).join(', ')}`,
    `Target region keys: ${regionKeys.join(', ')}`,
    `Required output: one full transparent fixed-region source sheet, ${FIXED_REGION_SOURCE_SHEET.w}x${FIXED_REGION_SOURCE_SHEET.h}px layout ratio, preserving the same non-uniform region map.`,
    '',
    'Attached reference images, in order:',
    plan.motion_template?.enabled
      ? '1. Motion template full source sheet: pose layout, action rhythm, region boundaries, and facing reference. Do not copy its character identity.'
      : null,
    plan.motion_template?.enabled
      ? '2. Current full source sheet: character identity, costume, scale, palette, outline weight, and current context.'
      : '1. Current full source sheet: character identity, costume, scale, palette, outline weight, and current context.',
    plan.motion_template?.enabled
      ? '3. Full normalized runtime sheet: secondary identity and scale context.'
      : '2. Full normalized runtime sheet: secondary identity and scale context.',
    '',
    'Hard constraints:',
    '- Keep the fixed-region source layout, canvas ratio, region positions, sprite scale, spacing, and pixel-art style.',
    '- Edit only the listed target source-action regions. Leave all other regions visually unchanged.',
    '- Do not convert the image into an 8x8 grid, animation strip, contact sheet, scene, UI, label, watermark, border, or helper-mark image.',
    '- Keep pure transparent background outside the character pixels.',
    '- Default to empty hands: do not add ladders, weapons, shields, tools, props, or handheld items unless explicitly required.',
    '- Keep each selected region as one clean character silhouette with no duplicated arms or hands, ghost limbs, action trails, motion blur, summoned limbs, or extra anatomy.',
    '- Show motion through pose changes between target regions, not by drawing several limb positions inside one region.',
    '- Preserve character identity, costume details, palette, outline weight, lighting direction, and pixel density from the current source sheet.',
  ].filter(Boolean).join('\n')
}

export function buildFixedRegionSourceRepairPlan({
  actions,
  outputDir = path.join('generated', 'fixed-region-source-repairs', `repair_${Date.now().toString(36)}`),
  providerPresetId = '',
  imageConfig = {},
  backgroundMode = 'auto',
  motionTemplate = null,
  sourceSheetPath = null,
  normalizedSheetPath = null,
  sourceJobId = null,
} = {}) {
  const selectedActions = normalizeFixedRegionRepairActions(actions)
  const regionKeys = actionRegionKeys(selectedActions)
  const providerPreset = providerPresetId || null
  const resolvedConfig = {
    aspect_ratio: '1:1',
    ...getExplicitImageConfig(imageConfig),
  }
  return {
    schema_version: 1,
    mode: FIXED_REGION_SOURCE_REPAIR_MODE,
    run_id: sourceJobId ?? null,
    source_layout: FIXED_REGION_MOTION_LAYOUT_ID,
    output_dir: outputDir,
    provider_preset_id: providerPreset,
    image_config: resolvedConfig,
    background_mode: backgroundMode,
    motion_template: motionTemplate,
    actions: selectedActions,
    region_keys: regionKeys,
    estimated_provider_calls: 1,
    can_run: Boolean(sourceSheetPath),
    preflight: {
      can_run: Boolean(sourceSheetPath),
      errors: sourceSheetPath ? [] : ['source sheet is required for fixed-region source repair'],
      source_sheet: sourceSheetPath,
      normalized_sheet: normalizedSheetPath,
      actions: selectedActions,
      region_keys: regionKeys,
    },
    selected: {
      actions: selectedActions,
      source_actions: selectedActions,
      source_layout: FIXED_REGION_MOTION_LAYOUT_ID,
      region_keys: regionKeys,
      expected_output: {
        kind: 'patched_fixed_region_source_sheet_png',
        width: FIXED_REGION_SOURCE_SHEET.w,
        height: FIXED_REGION_SOURCE_SHEET.h,
        copied_region_count: regionKeys.length,
      },
      prompt: null,
    },
    files: {
      plan: path.join(outputDir, 'fixed_region_source_repair_plan.json'),
      summary: path.join(outputDir, 'fixed_region_source_repair_summary.json'),
      prompt: path.join(outputDir, 'selected_prompt.txt'),
      motion_template_reference: path.join(outputDir, 'motion_template_reference.png'),
      source_sheet_reference: path.join(outputDir, 'source_sheet_reference.png'),
      normalized_sheet_reference: path.join(outputDir, 'normalized_sheet_reference.png'),
      raw_provider_output: path.join(outputDir, 'raw_provider_repair_output.png'),
      normalized_provider_sheet: path.join(outputDir, 'normalized_provider_source_sheet.png'),
      repaired_source_sheet: path.join(outputDir, 'repaired_source_sheet.png'),
    },
    claim_boundary: 'This loop calls one provider to repair selected fixed-region source regions, then locally copies only those regions into the backed-up source sheet. It does not auto-detect semantic mistakes or apply unselected provider edits.',
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

export async function buildFixedRegionSourceRepairReferenceImages({
  sourceSheetBuffer,
  normalizedSheetBuffer = null,
  motionTemplateBuffer = null,
} = {}) {
  if (!sourceSheetBuffer) throw new Error('sourceSheetBuffer is required')
  return [
    motionTemplateBuffer
      ? {
          name: 'motion_template_reference.png',
          mimeType: 'image/png',
          buffer: motionTemplateBuffer,
          role: 'fixed_region_motion_template_reference',
        }
      : null,
    {
      name: 'source_sheet_reference.png',
      mimeType: 'image/png',
      buffer: sourceSheetBuffer,
      role: 'current_fixed_region_source_sheet',
    },
    normalizedSheetBuffer
      ? {
          name: 'normalized_sheet_reference.png',
          mimeType: 'image/png',
          buffer: normalizedSheetBuffer,
          role: 'normalized_runtime_identity_reference',
        }
      : null,
  ].filter(Boolean)
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

export async function applyFixedRegionSourceRepair({ sourceSheetBuffer, providerSheetBuffer, actions } = {}) {
  if (!sourceSheetBuffer) throw new Error('sourceSheetBuffer is required')
  if (!providerSheetBuffer) throw new Error('providerSheetBuffer is required')
  const selectedActions = normalizeFixedRegionRepairActions(actions)
  const source = await loadRgba(sourceSheetBuffer)
  const targetSize = { w: source.width, h: source.height }
  const normalizedProvider = await normalizeProviderSourceSheet(providerSheetBuffer, targetSize, 'passthrough')
  const repaired = cloneRgba(source)
  const regionKeys = actionRegionKeys(selectedActions)
  for (const key of regionKeys) {
    const region = scaleFixedRegionSourceRegion(FIXED_REGION_SOURCE_REGIONS[key], source)
    pasteRegion(repaired, normalizedProvider.image, region)
  }
  return {
    repaired_source_sheet_png: await encodeRgbaPng(repaired),
    normalized_provider_source_sheet_png: normalizedProvider.png,
    actions: selectedActions,
    region_keys: regionKeys,
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
} = {}) {
  if (!plan) throw new Error('fixed-region source repair plan is required')
  const providerPreset = resolveProviderPreset(env, plan.provider_preset_id || '')
  const apiKey = requireProviderRuntime(providerPreset, fetchImpl)
  const finalImageConfig = resolvedImageConfig(providerPreset, plan.image_config)
  const request = {
    providerPreset,
    apiKey,
    prompt: buildFixedRegionSourceRepairPrompt(plan),
    imageConfig: finalImageConfig,
    images: referenceImages,
    fetchImpl,
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

export async function runFixedRegionSourceRepairLoop({
  plan,
  sourceSheetBuffer,
  normalizedSheetBuffer = null,
  motionTemplateBuffer = null,
  env = process.env,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!plan?.can_run) throw new Error(`fixed-region source repair preflight failed: ${(plan?.preflight?.errors ?? []).join('; ')}`)
  const referenceImages = await buildFixedRegionSourceRepairReferenceImages({
    sourceSheetBuffer,
    normalizedSheetBuffer,
    motionTemplateBuffer,
  })
  let generation
  try {
    generation = await generateFixedRegionSourceRepairSheet({ plan, referenceImages, env, fetchImpl })
  } catch (error) {
    return {
      schema_version: 1,
      mode: FIXED_REGION_SOURCE_REPAIR_MODE,
      status: 'failed_generation',
      run_id: plan.run_id,
      reference_images: referenceImages,
      generation: null,
      error: generationError(error),
      apply_result: null,
      summary: {
        estimated_provider_calls: 1,
        generated_count: 0,
        applied: false,
      },
      claim_boundary: plan.claim_boundary,
    }
  }

  const providerSheet = await normalizeProviderSourceSheet(generation.raw_provider_png, FIXED_REGION_SOURCE_SHEET, plan.background_mode)
  const applied = await applyFixedRegionSourceRepair({
    sourceSheetBuffer,
    providerSheetBuffer: providerSheet.png,
    actions: plan.actions ?? plan.selected?.actions ?? [],
  })
  return {
    schema_version: 1,
    mode: FIXED_REGION_SOURCE_REPAIR_MODE,
    status: 'source_repaired',
    run_id: plan.run_id,
    reference_images: referenceImages,
    generation: {
      ...generation,
      normalized_provider_source_sheet_png: providerSheet.png,
      postprocess: providerSheet.postprocess,
    },
    error: null,
    apply_result: applied,
    summary: {
      estimated_provider_calls: 1,
      generated_count: 1,
      applied: true,
      action_count: applied.actions.length,
      copied_region_count: applied.region_keys.length,
    },
    claim_boundary: plan.claim_boundary,
  }
}

export function fixedRegionRepairArtifactFileMap(plan) {
  return {
    plan: plan.files.plan,
    summary: plan.files.summary,
    prompt: plan.files.prompt,
    motion_template_reference: plan.files.motion_template_reference,
    source_sheet_reference: plan.files.source_sheet_reference,
    normalized_sheet_reference: plan.files.normalized_sheet_reference,
    raw_provider_output: plan.files.raw_provider_output,
    normalized_provider_sheet: plan.files.normalized_provider_sheet,
    repaired_source_sheet: plan.files.repaired_source_sheet,
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
  return OCAD_SOURCE_ACTION_ORDER.filter((action) => FIXED_REGION_SOURCE_ACTION_REGION_KEYS[action]?.length)
}
