import path from 'node:path'

import { applyQualityClosureProviderRepairs, serializeQualityClosureProviderRepairApplyResult } from './qualityClosureRepairApply.js'
import {
  buildQualityClosureProviderRepairPrompt,
  rankQualityClosureProviderRepairTasks,
} from './qualityClosureProviderHandoff.js'
import { ACTION_REPAIR_MODE, isStaticPoseRepairTask, repairOutputFrameCountForTask } from '../actionRepairMode.js'
import { encodeRgbaPng, loadRgba, resizeRgbaNearest } from '../imageCodec.js'
import { pixelOffset } from '../imageMath.js'
import { detectAlphaBBox, normalizeCells } from '../normalizer.js'
import { TOPDOWN_RPG_V0 } from '../profile.js'
import { resolveProviderPreset, getExplicitImageConfig } from '../providers/providerConfig.js'
import { requestGeminiPromptImage } from '../providers/geminiAdapter.js'
import { requestOpenRouterPromptImage } from '../providers/openRouterAdapter.js'
import {
  FIXED_REGION_MOTION_LAYOUT_ID,
  isFixedRegionMotionLayoutId,
  resolveSourceLayout,
  sliceCellsForSourceLayout,
} from '../sourceLayouts.js'
import { removeBackground } from '../sourcePreparation.js'

export const CHARACTER_QUALITY_CLOSURE_PROVIDER_REPAIR_LOOP_MODE = 'character_quality_closure_provider_repair_loop_v1'

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

function targetFramesForTask(task = {}, profile = TOPDOWN_RPG_V0) {
  const frameCount = profile.grid.columns * profile.grid.rows
  return (task.target?.frames ?? [])
    .map((frame) => Number(frame.frame ?? frame))
    .filter((frame) => Number.isInteger(frame) && frame >= 0 && frame < frameCount)
}

function selectedProviderTask(manifest = {}, taskId = null) {
  const ranked = rankQualityClosureProviderRepairTasks(manifest)
  if (!ranked.length) return null
  if (!taskId) return ranked[0].task
  return ranked.find((entry) => entry.task.task_id === taskId)?.task ?? null
}

function buildPreflight(task, profile = TOPDOWN_RPG_V0) {
  const errors = []
  if (!task) {
    errors.push('no quality closure provider repair task selected')
    return { can_run: false, errors, normalized_sheet: null, target_frames: [] }
  }
  if (!task.provider_required) errors.push(`quality closure repair task ${task.task_id} is not provider-required`)
  if (!task.artifacts?.normalized_sheet) errors.push(`quality closure repair task ${task.task_id} is missing normalized_sheet artifact path`)
  const targetFrames = targetFramesForTask(task, profile)
  if (!targetFrames.length) errors.push(`quality closure repair task ${task.task_id} has no target frames`)
  return {
    can_run: errors.length === 0,
    errors,
    normalized_sheet: task.artifacts?.normalized_sheet ?? null,
    source_sheet: task.artifacts?.source_sheet ?? null,
    target_frames: targetFrames,
  }
}

function stripTargetSize(frameCount, profile = TOPDOWN_RPG_V0) {
  return { w: profile.frame.w * Math.max(1, frameCount), h: profile.frame.h }
}

function repairOutputFramesForTask(task = {}, profile = TOPDOWN_RPG_V0) {
  const targetFrames = targetFramesForTask(task, profile)
  const outputFrameCount = repairOutputFrameCountForTask(task, targetFrames.length)
  return targetFrames.slice(0, outputFrameCount)
}

function gcd(a, b) {
  let x = Math.abs(a)
  let y = Math.abs(b)
  while (y) {
    const next = x % y
    x = y
    y = next
  }
  return x || 1
}

function stripAspectRatio(frameCount, profile = TOPDOWN_RPG_V0) {
  const target = stripTargetSize(frameCount, profile)
  const divisor = gcd(target.w, target.h)
  return `${target.w / divisor}:${target.h / divisor}`
}

function copyImageToStrip({ image, strip, slot, profile }) {
  for (let y = 0; y < profile.frame.h; y++) {
    for (let x = 0; x < profile.frame.w; x++) {
      const src = pixelOffset(image.width, x, y)
      const dst = pixelOffset(strip.width, slot * profile.frame.w + x, y)
      strip.data[dst] = image.data[src]
      strip.data[dst + 1] = image.data[src + 1]
      strip.data[dst + 2] = image.data[src + 2]
      strip.data[dst + 3] = image.data[src + 3]
    }
  }
}

function copyFrameToStrip({ sheet, strip, frame, slot, profile }) {
  const col = frame % profile.grid.columns
  const row = Math.floor(frame / profile.grid.columns)
  for (let y = 0; y < profile.frame.h; y++) {
    for (let x = 0; x < profile.frame.w; x++) {
      const src = pixelOffset(sheet.width, col * profile.frame.w + x, row * profile.frame.h + y)
      const dst = pixelOffset(strip.width, slot * profile.frame.w + x, y)
      strip.data[dst] = sheet.data[src]
      strip.data[dst + 1] = sheet.data[src + 1]
      strip.data[dst + 2] = sheet.data[src + 2]
      strip.data[dst + 3] = sheet.data[src + 3]
    }
  }
}

function cropUniformGridCell(image, frame, profile = TOPDOWN_RPG_V0) {
  const cellW = image.width / profile.grid.columns
  const cellH = image.height / profile.grid.rows
  if (!Number.isInteger(cellW) || !Number.isInteger(cellH)) {
    throw new Error(`motion template sheet must divide into ${profile.grid.columns}x${profile.grid.rows} cells`)
  }
  const col = frame % profile.grid.columns
  const row = Math.floor(frame / profile.grid.columns)
  const cell = {
    width: cellW,
    height: cellH,
    data: new Uint8ClampedArray(cellW * cellH * 4),
  }
  for (let y = 0; y < cellH; y++) {
    for (let x = 0; x < cellW; x++) {
      const src = pixelOffset(image.width, col * cellW + x, row * cellH + y)
      const dst = pixelOffset(cell.width, x, y)
      cell.data[dst] = image.data[src]
      cell.data[dst + 1] = image.data[src + 1]
      cell.data[dst + 2] = image.data[src + 2]
      cell.data[dst + 3] = image.data[src + 3]
    }
  }
  return cell
}

async function composeMotionTemplateStripFromCells(cells, targetFrames, profile = TOPDOWN_RPG_V0) {
  const strip = {
    width: profile.frame.w * targetFrames.length,
    height: profile.frame.h,
    data: new Uint8ClampedArray(profile.frame.w * targetFrames.length * profile.frame.h * 4),
  }
  for (const [slot, frame] of targetFrames.entries()) {
    const cell = cells[frame]
    if (!cell) throw new Error(`motion template is missing frame ${frame}`)
    const image = cell.image.width === profile.frame.w && cell.image.height === profile.frame.h
      ? cell.image
      : await resizeRgbaNearest(cell.image, { w: profile.frame.w, h: profile.frame.h })
    copyImageToStrip({ image, strip, slot, profile })
  }
  return strip
}

async function buildUniformGridMotionTemplateStrip(image, targetFrames, profile = TOPDOWN_RPG_V0) {
  const cells = Array.from({ length: profile.grid.columns * profile.grid.rows }, (_, frame) => ({
    image: cropUniformGridCell(image, frame, profile),
  }))
  return composeMotionTemplateStripFromCells(cells, targetFrames, profile)
}

async function buildFixedRegionMotionTemplateStrip(image, targetFrames, layoutId, profile = TOPDOWN_RPG_V0) {
  const layout = resolveSourceLayout(layoutId || FIXED_REGION_MOTION_LAYOUT_ID)
  const sliced = sliceCellsForSourceLayout(image, profile, layout)
  const normalized = normalizeCells(sliced.cells, profile)
  return composeMotionTemplateStripFromCells(normalized.frames, targetFrames, profile)
}

function looksLikeTargetStrip(image, frameCount, profile = TOPDOWN_RPG_V0) {
  const target = stripTargetSize(frameCount, profile)
  return image.width === target.w && image.height === target.h
}

function looksLikeUniformGrid(image, profile = TOPDOWN_RPG_V0) {
  return image.width % profile.grid.columns === 0 && image.height % profile.grid.rows === 0
}

async function buildMotionTemplateReferenceImage({
  task,
  motionTemplateBuffer,
  motionTemplateName = 'motion_template_reference.png',
  motionTemplateLayout = null,
  profile = TOPDOWN_RPG_V0,
} = {}) {
  if (!motionTemplateBuffer) return null
  const targetFrames = repairOutputFramesForTask(task, profile)
  if (!targetFrames.length) throw new Error(`quality closure repair task ${task?.task_id ?? 'unknown'} has no target frames`)
  const image = await loadRgba(motionTemplateBuffer)
  let strip
  let sourceMode
  if (looksLikeTargetStrip(image, targetFrames.length, profile)) {
    strip = image
    sourceMode = 'template_strip'
  } else if (motionTemplateLayout && isFixedRegionMotionLayoutId(motionTemplateLayout)) {
    strip = await buildFixedRegionMotionTemplateStrip(image, targetFrames, motionTemplateLayout, profile)
    sourceMode = 'fixed_region_template_sheet'
  } else if (looksLikeUniformGrid(image, profile)) {
    strip = await buildUniformGridMotionTemplateStrip(image, targetFrames, profile)
    sourceMode = 'uniform_grid_template_sheet'
  } else if (!motionTemplateLayout && image.width === 252 && image.height === 252) {
    strip = await buildFixedRegionMotionTemplateStrip(image, targetFrames, FIXED_REGION_MOTION_LAYOUT_ID, profile)
    sourceMode = 'fixed_region_template_sheet'
  } else {
    throw new Error('motion template must be a target-size strip, an 8x8 sheet, or a fixed-region motion template')
  }
  return {
    name: 'motion_template_reference.png',
    sourceName: motionTemplateName,
    mimeType: 'image/png',
    buffer: await encodeRgbaPng(strip),
    role: 'motion_template_action_reference',
    frames: targetFrames,
    source_mode: sourceMode,
    source_layout: motionTemplateLayout ?? null,
  }
}

function assertNormalizedSheetSize(image, profile = TOPDOWN_RPG_V0) {
  if (image.width !== profile.sheet.w || image.height !== profile.sheet.h) {
    throw new Error(`normalized sheet must be ${profile.sheet.w}x${profile.sheet.h}, got ${image.width}x${image.height}`)
  }
}

export async function buildQualityClosureProviderRepairReferenceImages({
  task,
  normalizedSheetBuffer,
  motionTemplateBuffer = null,
  motionTemplateName = 'motion_template_reference.png',
  motionTemplateLayout = null,
  sourceSheetBuffer = null,
  profile = TOPDOWN_RPG_V0,
} = {}) {
  if (!task) throw new Error('quality closure provider repair task is required')
  if (!normalizedSheetBuffer) throw new Error('normalizedSheetBuffer is required')
  const targetFrames = targetFramesForTask(task, profile)
  const outputFrames = repairOutputFramesForTask(task, profile)
  if (!targetFrames.length) throw new Error(`quality closure repair task ${task.task_id ?? 'unknown'} has no target frames`)
  if (!outputFrames.length) throw new Error(`quality closure repair task ${task.task_id ?? 'unknown'} has no provider output frames`)

  const sheet = await loadRgba(normalizedSheetBuffer)
  assertNormalizedSheetSize(sheet, profile)
  const strip = {
    width: profile.frame.w * outputFrames.length,
    height: profile.frame.h,
    data: new Uint8ClampedArray(profile.frame.w * outputFrames.length * profile.frame.h * 4),
  }
  outputFrames.forEach((frame, slot) => copyFrameToStrip({ sheet, strip, frame, slot, profile }))

  const motionTemplate = await buildMotionTemplateReferenceImage({
    task,
    motionTemplateBuffer,
    motionTemplateName,
    motionTemplateLayout,
    profile,
  })

  const images = [
    motionTemplate,
    {
      name: 'normalized_sheet_reference.png',
      mimeType: 'image/png',
      buffer: normalizedSheetBuffer,
      role: 'full_normalized_sheet_reference',
    },
    {
      name: 'target_animation_reference.png',
      mimeType: 'image/png',
      buffer: await encodeRgbaPng(strip),
      role: 'current_target_animation_problem_context',
      frames: outputFrames,
      target_frames: targetFrames,
    },
  ].filter(Boolean)
  if (sourceSheetBuffer) {
    images.push({
      name: 'source_sheet_reference.png',
      mimeType: 'image/png',
      buffer: sourceSheetBuffer,
      role: 'optional_source_sheet_context',
    })
  }
  return images
}

function expandBBox(bbox, image, padding) {
  const x = Math.max(0, bbox.x - padding)
  const y = Math.max(0, bbox.y - padding)
  const right = Math.min(image.width - 1, bbox.right + padding)
  const bottom = Math.min(image.height - 1, bbox.bottom + padding)
  return { x, y, right, bottom, w: right - x + 1, h: bottom - y + 1 }
}

function cropRgba(image, bbox) {
  const out = {
    width: bbox.w,
    height: bbox.h,
    data: new Uint8ClampedArray(bbox.w * bbox.h * 4),
  }
  for (let y = 0; y < bbox.h; y++) {
    for (let x = 0; x < bbox.w; x++) {
      const src = pixelOffset(image.width, bbox.x + x, bbox.y + y)
      const dst = pixelOffset(out.width, x, y)
      out.data[dst] = image.data[src]
      out.data[dst + 1] = image.data[src + 1]
      out.data[dst + 2] = image.data[src + 2]
      out.data[dst + 3] = image.data[src + 3]
    }
  }
  return out
}

function cropFrameCellFromSheet(image, frame, profile = TOPDOWN_RPG_V0) {
  const col = frame % profile.grid.columns
  const row = Math.floor(frame / profile.grid.columns)
  return cropRgba(image, {
    x: col * profile.frame.w,
    y: row * profile.frame.h,
    right: col * profile.frame.w + profile.frame.w - 1,
    bottom: row * profile.frame.h + profile.frame.h - 1,
    w: profile.frame.w,
    h: profile.frame.h,
  })
}

function countOccupiedGridCells(image, profile = TOPDOWN_RPG_V0, { minPixels = 8 } = {}) {
  if (!image.width || !image.height) return 0
  const cellW = image.width / profile.grid.columns
  const cellH = image.height / profile.grid.rows
  if (cellW < 1 || cellH < 1) return 0
  let occupied = 0
  for (let row = 0; row < profile.grid.rows; row += 1) {
    for (let col = 0; col < profile.grid.columns; col += 1) {
      let visible = 0
      const startX = Math.floor(col * cellW)
      const endX = Math.floor((col + 1) * cellW)
      const startY = Math.floor(row * cellH)
      const endY = Math.floor((row + 1) * cellH)
      for (let y = startY; y < endY && visible < minPixels; y += 1) {
        for (let x = startX; x < endX && visible < minPixels; x += 1) {
          if (image.data[pixelOffset(image.width, x, y) + 3]) visible += 1
        }
      }
      if (visible >= minPixels) occupied += 1
    }
  }
  return occupied
}

async function normalizeStaticPoseSheetCandidate(image, profile = TOPDOWN_RPG_V0) {
  const occupied = countOccupiedGridCells(image, profile)
  if (occupied < 12) return null
  if (image.width === profile.sheet.w && image.height === profile.sheet.h) return image
  if (Math.abs(image.width - image.height) > Math.max(4, Math.round(Math.max(image.width, image.height) * 0.03))) return null
  if (image.width < profile.grid.columns * 12 || image.height < profile.grid.rows * 12) return null
  return resizeRgbaNearest(image, { w: profile.sheet.w, h: profile.sheet.h })
}

function isFullCanvasBBox(bbox, image) {
  return bbox.w / image.width >= 0.9 && bbox.h / image.height >= 0.9
}

function assertRepairCropLooksLikeStrip({ bbox, image, target, frameCount }) {
  if (isFullCanvasBBox(bbox, image)) {
    throw Object.assign(new Error('provider repair output looks like a full sheet or full-canvas image, not a single horizontal animation strip'), {
      retry_hint: 'regenerate_repair_strip',
      failure_status: 'provider_output_not_strip',
    })
  }
  if (frameCount > 1) {
    const cropAspect = bbox.w / Math.max(1, bbox.h)
    const targetAspect = target.w / target.h
    const minAspect = Math.min(1.6, targetAspect * 0.45)
    if (cropAspect < minAspect) {
      throw Object.assign(new Error(`provider repair output is too square for a horizontal ${frameCount}-cell animation strip`), {
        retry_hint: 'regenerate_repair_strip',
        failure_status: 'provider_output_not_strip',
      })
    }
  }
}

export async function postprocessQualityClosureProviderRepairStrip(buffer, {
  task,
  profile = TOPDOWN_RPG_V0,
  backgroundMode = 'auto',
  cropPadding = 8,
} = {}) {
  if (!buffer) throw new Error('provider repair strip buffer is required')
  const targetFrames = targetFramesForTask(task, profile)
  const outputFrameCount = repairOutputFrameCountForTask(task, targetFrames.length)
  if (!targetFrames.length) throw new Error(`quality closure repair task ${task?.task_id ?? 'unknown'} has no target frames`)
  const target = stripTargetSize(outputFrameCount, profile)
  const raw = await loadRgba(buffer)
  const background = await removeBackground(raw, { backgroundMode })
  let normalized = background.image
  let normalization = {
    method: 'exact_size',
    resized: false,
    crop_bbox: null,
    target_size: target,
  }

  if (isStaticPoseRepairTask(task)) {
    const patchedSheet = await normalizeStaticPoseSheetCandidate(normalized, profile)
    if (patchedSheet) {
      const cell = cropFrameCellFromSheet(patchedSheet, targetFrames[0], profile)
      return {
        repair_strip_png: await encodeRgbaPng(cell),
        source_size: { w: raw.width, h: raw.height },
        background_mode: background.mode,
        background_warnings: background.warnings,
        normalized_size: { w: cell.width, h: cell.height },
        normalization: {
          method: 'patched_sheet_crop_first_target_cell',
          resized: patchedSheet.width !== raw.width || patchedSheet.height !== raw.height,
          crop_bbox: null,
          target_size: target,
          patched_sheet_size: { w: patchedSheet.width, h: patchedSheet.height },
          cropped_frame: targetFrames[0],
        },
      }
    }
  }

  if (normalized.width !== target.w || normalized.height !== target.h) {
    const bbox = detectAlphaBBox(normalized)
    if (!bbox) throw new Error('provider repair strip has no visible pixels after background removal')
    const cropBBox = expandBBox(bbox, normalized, cropPadding)
    assertRepairCropLooksLikeStrip({ bbox: cropBBox, image: normalized, target, frameCount: outputFrameCount })
    const cropped = cropRgba(normalized, cropBBox)
    normalized = await resizeRgbaNearest(cropped, target)
    normalization = {
      method: 'visible_bbox_crop_resize',
      resized: true,
      crop_bbox: cropBBox,
      target_size: target,
    }
  }

  return {
    repair_strip_png: await encodeRgbaPng(normalized),
    source_size: { w: raw.width, h: raw.height },
    background_mode: background.mode,
    background_warnings: background.warnings,
    normalized_size: { w: normalized.width, h: normalized.height },
    normalization,
  }
}

function resolvedImageConfig(providerPreset, imageConfig = {}, task = {}) {
  return {
    ...providerPreset.imageConfig,
    ...task.provider_payload?.image_config,
    ...getExplicitImageConfig(imageConfig),
  }
}

export async function generateQualityClosureProviderRepairStrip({
  task,
  providerPresetId = '',
  imageConfig = {},
  referenceImages = [],
  env = process.env,
  fetchImpl = globalThis.fetch,
  profile = TOPDOWN_RPG_V0,
  backgroundMode = 'auto',
} = {}) {
  if (!task) throw new Error('quality closure provider repair task is required')
  const providerPreset = resolveProviderPreset(env, providerPresetId || task.provider_payload?.provider_preset_id || '')
  const apiKey = requireProviderRuntime(providerPreset, fetchImpl)
  const prompt = buildQualityClosureProviderRepairPrompt(task, profile, {
    motionTemplate: referenceImages.some((image) => image.role === 'motion_template_action_reference'),
  })
  const finalImageConfig = resolvedImageConfig(providerPreset, imageConfig, task)
  const request = {
    providerPreset,
    apiKey,
    prompt,
    imageConfig: finalImageConfig,
    images: referenceImages,
    fetchImpl,
  }
  const generated = providerPreset.provider === 'gemini'
    ? await requestGeminiPromptImage(request)
    : await requestOpenRouterPromptImage(request)
  const postprocessed = await postprocessQualityClosureProviderRepairStrip(generated.buffer, { task, profile, backgroundMode })
  return {
    schema_version: 1,
    task_id: task.task_id,
    provider: providerPreset.provider,
    provider_preset_id: providerPreset.id,
    provider_label: providerPreset.label,
    model: providerPreset.model,
    image_config: finalImageConfig,
    input_images: referenceImages.map((image) => image.name ?? null).filter(Boolean),
    prompt: generated.prompt,
    raw_provider_png: generated.buffer,
    repaired_strip_png: postprocessed.repair_strip_png,
    postprocess: {
      source_size: postprocessed.source_size,
      background_mode: postprocessed.background_mode,
      background_warnings: postprocessed.background_warnings,
      normalized_size: postprocessed.normalized_size,
      normalization: postprocessed.normalization,
    },
  }
}

export function buildQualityClosureProviderRepairLoopPlan({
  manifest = {},
  taskId = null,
  outputDir = path.join('generated', 'quality-closure-repairs', safePathSegment(manifest.run_id ?? 'run'), 'provider_repair_loop'),
  providerPresetId = '',
  imageConfig = {},
  backgroundMode = 'auto',
  motionTemplate = null,
  profile = TOPDOWN_RPG_V0,
} = {}) {
  const task = selectedProviderTask(manifest, taskId)
  const preflight = buildPreflight(task, profile)
  const targetFrames = preflight.target_frames ?? []
  const outputCellCount = repairOutputFrameCountForTask(task ?? {}, targetFrames.length)
  const itemId = task?.item_id ?? 'item'
  const itemOutputDir = path.join(outputDir, safePathSegment(itemId))
  const providerPreset = providerPresetId || task?.provider_payload?.provider_preset_id || manifest.provider_preset_id || null
  const expectedSize = stripTargetSize(outputCellCount, profile)
  const staticPose = isStaticPoseRepairTask(task)
  const resolvedConfig = {
    ...(task?.provider_payload?.image_config ?? {}),
    aspect_ratio: stripAspectRatio(outputCellCount || 1, profile),
    ...getExplicitImageConfig(imageConfig),
  }
  return {
    schema_version: 1,
    mode: CHARACTER_QUALITY_CLOSURE_PROVIDER_REPAIR_LOOP_MODE,
    run_id: manifest.run_id ?? null,
    preset: manifest.preset ?? profile.id,
    output_dir: outputDir,
    provider_preset_id: providerPreset,
    image_config: resolvedConfig,
    background_mode: backgroundMode,
    motion_template: motionTemplate,
    estimated_provider_calls: task ? 1 : 0,
    can_run: preflight.can_run,
    preflight,
    selected: task
      ? {
          task_id: task.task_id,
          item_id: task.item_id,
          action: task.action,
          requested_action: task.requested_action ?? task.target?.requested_action ?? null,
          source_action: task.source_action ?? task.target?.source_action ?? null,
          source_layout: task.source_layout ?? task.target?.source_layout ?? null,
          issue: task.issue,
          repair_mode: staticPose ? ACTION_REPAIR_MODE.STATIC_POSE : ACTION_REPAIR_MODE.ANIMATION_STRIP,
          animation: task.target?.animation ?? null,
          frames: targetFrames,
          derived_frames: task.target?.derived_frames ?? [],
          expected_output: {
            kind: staticPose ? 'patched_normalized_sheet_png' : 'horizontal_animation_strip_png',
            cell_width: profile.frame.w,
            cell_height: profile.frame.h,
            cell_count: outputCellCount,
            target_cell_count: Math.max(1, targetFrames.length),
            width: staticPose ? profile.sheet.w : expectedSize.w,
            height: staticPose ? profile.sheet.h : expectedSize.h,
          },
          artifacts: task.artifacts,
          provider_payload: task.provider_payload,
          prompt: buildQualityClosureProviderRepairPrompt(task, profile, {
            motionTemplate: Boolean(motionTemplate?.enabled),
          }),
        }
      : null,
    task,
    files: {
      plan: path.join(outputDir, 'quality_closure_provider_repair_loop_plan.json'),
      summary: path.join(outputDir, 'quality_closure_provider_repair_loop_summary.json'),
      prompt: path.join(outputDir, 'selected_prompt.txt'),
      motion_template_reference: path.join(outputDir, 'motion_template_reference.png'),
      normalized_sheet_reference: path.join(outputDir, 'normalized_sheet_reference.png'),
      target_animation_reference: path.join(outputDir, 'target_animation_reference.png'),
      source_sheet_reference: path.join(outputDir, 'source_sheet_reference.png'),
      raw_provider_output: path.join(outputDir, 'raw_provider_repair_output.png'),
      repaired_strip: path.join(outputDir, 'repaired_animation_strip.png'),
      item_output_dir: itemOutputDir,
      repaired_normalized_sheet: path.join(itemOutputDir, 'repaired_normalized_sheet.png'),
      validation_report: path.join(itemOutputDir, 'quality_closure_provider_repair_report.json'),
      markdown_report: path.join(itemOutputDir, 'quality_closure_provider_repair_report.md'),
    },
    claim_boundary: 'This loop calls one provider to repair one selected animation strip, then applies and revalidates it locally. It does not auto-detect semantic facing or mix regions from different candidates.',
  }
}

function generationError(error) {
  return {
    message: String(error?.message || error),
    status: error?.status ?? 'failed_model_error',
    retry_hint: error?.retry_hint ?? 'manual_inspect',
  }
}

export async function runQualityClosureProviderRepairLoop({
  plan,
  normalizedSheetBuffer,
  motionTemplateBuffer = null,
  motionTemplateName = 'motion_template_reference.png',
  motionTemplateLayout = null,
  sourceSheetBuffer = null,
  env = process.env,
  fetchImpl = globalThis.fetch,
  profile = TOPDOWN_RPG_V0,
} = {}) {
  if (!plan) throw new Error('quality closure provider repair loop plan is required')
  if (!plan.can_run) throw new Error(`quality closure provider repair loop preflight failed: ${plan.preflight.errors.join('; ')}`)
  if (!normalizedSheetBuffer) throw new Error('normalizedSheetBuffer is required')
  const task = plan.task
  const referenceImages = await buildQualityClosureProviderRepairReferenceImages({
    task,
    normalizedSheetBuffer,
    motionTemplateBuffer,
    motionTemplateName,
    motionTemplateLayout,
    sourceSheetBuffer,
    profile,
  })

  let generated
  try {
    generated = await generateQualityClosureProviderRepairStrip({
      task,
      providerPresetId: plan.provider_preset_id,
      imageConfig: plan.image_config,
      referenceImages,
      env,
      fetchImpl,
      profile,
      backgroundMode: plan.background_mode,
    })
  } catch (error) {
    return {
      schema_version: 1,
      mode: CHARACTER_QUALITY_CLOSURE_PROVIDER_REPAIR_LOOP_MODE,
      status: 'failed_generation',
      run_id: plan.run_id,
      preset: plan.preset,
      selected_task_id: task.task_id,
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

  const applied = await applyQualityClosureProviderRepairs({
    normalizedSheetBuffer,
    repairs: [{ task, stripBuffer: generated.repaired_strip_png }],
    profile,
  })

  return {
    schema_version: 1,
    mode: CHARACTER_QUALITY_CLOSURE_PROVIDER_REPAIR_LOOP_MODE,
    status: applied.status,
    run_id: plan.run_id,
    preset: plan.preset,
    selected_task_id: task.task_id,
    reference_images: referenceImages,
    generation: generated,
    error: null,
    apply_result: applied,
    summary: {
      estimated_provider_calls: 1,
      generated_count: 1,
      applied: true,
      repair_status: applied.status,
      resolved_target_count: applied.summary.resolved_target_count,
      remaining_repair_task_count: applied.summary.remaining_repair_task_count,
      after_validation_status: applied.summary.after_validation_status,
      after_quality_closure_status: applied.summary.after_quality_closure_status,
    },
    claim_boundary: plan.claim_boundary,
  }
}

export function serializeQualityClosureProviderRepairLoopPlan(plan = {}) {
  return {
    ...plan,
    task: plan.task
      ? {
          task_id: plan.task.task_id,
          item_id: plan.task.item_id,
          action: plan.task.action,
          requested_action: plan.task.requested_action,
          source_action: plan.task.source_action,
          source_layout: plan.task.source_layout,
          repair_mode: plan.task.repair_mode,
          issue: plan.task.issue,
          target: plan.task.target,
          artifacts: plan.task.artifacts,
          provider_payload: plan.task.provider_payload,
          motion_template: plan.motion_template,
        }
      : null,
  }
}

export function serializeQualityClosureProviderRepairLoopResult(result = {}) {
  return {
    ...result,
    reference_images: (result.reference_images ?? []).map((image) => ({
      name: image.name,
      source_name: image.sourceName,
      role: image.role,
      frames: image.frames,
      target_frames: image.target_frames,
      source_mode: image.source_mode,
      source_layout: image.source_layout,
    })),
    generation: result.generation
      ? {
          schema_version: result.generation.schema_version,
          task_id: result.generation.task_id,
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
          ...serializeQualityClosureProviderRepairApplyResult(result.apply_result),
          repaired_normalized_sheet_png: undefined,
          row_gif_buffers: undefined,
          row_gif_count: Object.keys(result.apply_result.row_gif_buffers ?? {}).length,
        }
      : null,
  }
}
