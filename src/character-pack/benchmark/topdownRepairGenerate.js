import { removeBackground } from '../sourcePreparation.js'
import { encodeRgbaPng, loadRgba } from '../imageCodec.js'
import { detectAlphaBBox, detectFootAnchor, normalizeCells } from '../normalizer.js'
import { pixelOffset } from '../imageMath.js'
import { TOPDOWN_RPG_V0 } from '../profile.js'
import { requestGeminiPromptImage } from '../providers/geminiAdapter.js'
import { requestOpenRouterPromptImage } from '../providers/openRouterAdapter.js'
import { getExplicitImageConfig, resolveProviderPreset } from '../providers/providerConfig.js'

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

export function buildTopdownRepairCellPrompt(task) {
  if (!task?.provider_payload?.prompt) throw new Error('repair task provider prompt is required')
  return [
    task.provider_payload.prompt,
    'The attached reference image contains neighboring same-animation cells only. Use it to preserve identity, palette, scale, outline, and neighboring animation timing.',
    'Return a single repaired cell image only, not an 8x8 sheet, not a full character sheet, not a contact sheet, and not a grid.',
    'Do not reproduce multiple tiny poses from the reference image. Draw exactly one repaired pose at normal cell scale.',
    'The final cell must be one compact pixel-art pose on pure white or transparent background; keep all visible pixels away from the image edges.',
    'Do not include labels, frame numbers, borders, UI, scenery, helper marks, or any extra cells.',
  ].join('\n')
}

function assertNormalizedSheetSize(image, profile) {
  if (image.width !== profile.sheet.w || image.height !== profile.sheet.h) {
    throw new Error(`normalized sheet must be ${profile.sheet.w}x${profile.sheet.h}, got ${image.width}x${image.height}`)
  }
}

function copyFrameToStrip({ sheet, strip, frame, slot, profile }) {
  const col = frame % profile.grid.columns
  const row = Math.floor(frame / profile.grid.columns)
  for (let y = 0; y < profile.frame.h; y++) {
    for (let x = 0; x < profile.frame.w; x++) {
      const src = ((row * profile.frame.h + y) * sheet.width + col * profile.frame.w + x) * 4
      const dst = (y * strip.width + slot * profile.frame.w + x) * 4
      strip.data[dst] = sheet.data[src]
      strip.data[dst + 1] = sheet.data[src + 1]
      strip.data[dst + 2] = sheet.data[src + 2]
      strip.data[dst + 3] = sheet.data[src + 3]
    }
  }
}

export async function buildTopdownRepairReferenceImages({
  task,
  normalizedSheetBuffer,
  profile = TOPDOWN_RPG_V0,
} = {}) {
  if (!task) throw new Error('repair task is required')
  if (!normalizedSheetBuffer) throw new Error('normalizedSheetBuffer is required')
  const referenceFrames = (task.context?.same_animation_frames ?? []).map((item) => item.frame)
  if (!referenceFrames.length) return []
  const sheet = await loadRgba(normalizedSheetBuffer)
  assertNormalizedSheetSize(sheet, profile)
  const strip = {
    width: profile.frame.w * referenceFrames.length,
    height: profile.frame.h,
    data: new Uint8ClampedArray(profile.frame.w * referenceFrames.length * profile.frame.h * 4),
  }
  referenceFrames.forEach((frame, slot) => copyFrameToStrip({ sheet, strip, frame, slot, profile }))
  return [
    {
      name: 'same_animation_reference.png',
      mimeType: 'image/png',
      buffer: await encodeRgbaPng(strip),
      frames: referenceFrames,
    },
  ]
}

function pasteScaledBBox(src, dst, bbox, dstX, dstY, scale) {
  const outW = Math.max(1, Math.round(bbox.w * scale))
  const outH = Math.max(1, Math.round(bbox.h * scale))
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const sx = bbox.x + Math.min(bbox.w - 1, Math.floor(x / scale))
      const sy = bbox.y + Math.min(bbox.h - 1, Math.floor(y / scale))
      const srcOffset = pixelOffset(src.width, sx, sy)
      const dstOffset = pixelOffset(dst.width, dstX + x, dstY + y)
      dst.data[dstOffset] = src.data[srcOffset]
      dst.data[dstOffset + 1] = src.data[srcOffset + 1]
      dst.data[dstOffset + 2] = src.data[srcOffset + 2]
      dst.data[dstOffset + 3] = src.data[srcOffset + 3]
    }
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function safeFitRepairCell(frame, profile, { padding = 4 } = {}) {
  const bbox = frame.normalized_bbox
  if (!bbox) return { image: frame.image, applied: false, before_bbox: null, after_bbox: null, scale: 1 }
  const hasPadding = bbox.x >= padding && bbox.y >= padding && bbox.right <= profile.frame.w - 1 - padding && bbox.bottom <= profile.frame.h - 1 - padding
  if (hasPadding) return { image: frame.image, applied: false, before_bbox: bbox, after_bbox: bbox, scale: 1 }

  const anchor = frame.normalized_anchor ?? { x: bbox.centerX, y: bbox.bottom }
  const scale = Math.min(1, (profile.frame.w - padding * 2) / bbox.w, (profile.frame.h - padding * 2) / bbox.h)
  const scaledW = Math.max(1, Math.round(bbox.w * scale))
  const scaledH = Math.max(1, Math.round(bbox.h * scale))
  const anchorOffsetX = (anchor.x - bbox.x) * scale
  const anchorOffsetY = (anchor.y - bbox.y) * scale
  const minX = padding
  const maxX = Math.max(padding, profile.frame.w - padding - scaledW)
  const minY = padding
  const maxY = Math.max(padding, profile.frame.h - padding - scaledH)
  const dstX = clamp(Math.round(profile.anchor.x - anchorOffsetX), minX, maxX)
  const dstY = clamp(Math.round(profile.anchor.y - anchorOffsetY), minY, maxY)
  const image = {
    width: profile.frame.w,
    height: profile.frame.h,
    data: new Uint8ClampedArray(profile.frame.w * profile.frame.h * 4),
  }
  pasteScaledBBox(frame.image, image, bbox, dstX, dstY, scale)
  const afterBBox = detectAlphaBBox(image)
  return {
    image,
    applied: true,
    before_bbox: bbox,
    after_bbox: afterBBox,
    scale,
  }
}

export async function postprocessTopdownRepairCell(buffer, {
  profile = TOPDOWN_RPG_V0,
  backgroundMode = 'auto',
  safePadding = 4,
} = {}) {
  const raw = await loadRgba(buffer)
  const background = await removeBackground(raw, { backgroundMode })
  const normalized = normalizeCells([
    {
      image: background.image,
      meta: { index: 0, source_layout: `${profile.id}_repair_cell` },
    },
  ], profile)
  const frame = normalized.frames[0]
  const fitted = safeFitRepairCell(frame, profile, { padding: safePadding })
  const fittedBBox = detectAlphaBBox(fitted.image)
  return {
    cell_png: await encodeRgbaPng(fitted.image),
    source_size: { w: raw.width, h: raw.height },
    background_mode: background.mode,
    background_warnings: background.warnings,
    normalized_bbox: fittedBBox,
    normalized_anchor: detectFootAnchor(fitted.image, fittedBBox),
    normalization_scale: normalized.scale,
    safe_fit: {
      applied: fitted.applied,
      padding: safePadding,
      scale: fitted.scale,
      before_bbox: fitted.before_bbox,
      after_bbox: fittedBBox,
    },
  }
}

export async function generateTopdownRepairCell({
  task,
  providerPresetId = '',
  imageConfig = {},
  referenceImages = [],
  env = process.env,
  fetchImpl = globalThis.fetch,
  profile = TOPDOWN_RPG_V0,
  backgroundMode = 'auto',
} = {}) {
  const providerPreset = resolveProviderPreset(env, providerPresetId || task?.provider_payload?.provider_preset_id || '')
  const apiKey = requireProviderRuntime(providerPreset, fetchImpl)
  const prompt = buildTopdownRepairCellPrompt(task)
  const resolvedImageConfig = {
    ...providerPreset.imageConfig,
    ...task?.provider_payload?.image_config,
    ...getExplicitImageConfig(imageConfig),
    aspect_ratio: imageConfig.aspect_ratio || imageConfig.aspectRatio || task?.provider_payload?.image_config?.aspect_ratio || providerPreset.imageConfig?.aspect_ratio || '1:1',
  }
  const request = {
    providerPreset,
    apiKey,
    prompt,
    imageConfig: resolvedImageConfig,
    images: referenceImages,
    fetchImpl,
  }
  const generated = providerPreset.provider === 'gemini'
    ? await requestGeminiPromptImage(request)
    : await requestOpenRouterPromptImage(request)
  const postprocessed = await postprocessTopdownRepairCell(generated.buffer, { profile, backgroundMode })
  return {
    schema_version: 1,
    task_id: task.task_id,
    provider: providerPreset.provider,
    provider_preset_id: providerPreset.id,
    provider_label: providerPreset.label,
    model: providerPreset.model,
    image_config: resolvedImageConfig,
    input_images: referenceImages.map((image) => image.name ?? null).filter(Boolean),
    prompt: generated.prompt,
    raw_provider_png: generated.buffer,
    repaired_cell_png: postprocessed.cell_png,
    postprocess: {
      source_size: postprocessed.source_size,
      background_mode: postprocessed.background_mode,
      background_warnings: postprocessed.background_warnings,
      normalized_bbox: postprocessed.normalized_bbox,
      normalized_anchor: postprocessed.normalized_anchor,
      normalization_scale: postprocessed.normalization_scale,
      safe_fit: postprocessed.safe_fit,
    },
  }
}
