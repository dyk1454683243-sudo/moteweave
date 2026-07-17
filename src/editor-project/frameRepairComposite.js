import sharp from 'sharp'

import {
  cleanupAlphaArtifactsFromRgba,
  cleanupSmallAlphaComponentsFromRgba,
} from '../character-pack/backgroundRemoval.js'
import { encodeRgbaPng, resizeRgbaNearest } from '../character-pack/imageCodec.js'
import { cloneRgba } from '../character-pack/imageMath.js'
import { detectAlphaBBox, detectFootAnchor } from '../character-pack/normalizer.js'
import { removeBackground } from '../character-pack/sourcePreparation.js'
import { extractPalette, snapToPalette } from '../character-pack/stylePipeline.js'
import { FrameRepairError } from './frameRepairProtocol.js'

const MAX_PROVIDER_BYTES = 32 * 1024 * 1024
const MAX_PROVIDER_SIDE = 2048
const MAX_PROVIDER_PIXELS = 4_194_304
const ALLOWED_PROVIDER_FORMATS = new Set(['png', 'jpeg', 'webp'])

function compositeError(code, message) {
  return new FrameRepairError(code, message)
}

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function assertPositiveInteger(value, message) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw compositeError('invalid_frame_repair_composite', message)
  }
}

function assertRgba(image, label, expectedSize = null) {
  if (!isPlainRecord(image)) {
    throw compositeError('invalid_frame_repair_composite', `${label} RGBA image is invalid`)
  }
  assertPositiveInteger(image.width, `${label} width is invalid`)
  assertPositiveInteger(image.height, `${label} height is invalid`)
  const pixelCount = image.width * image.height
  if (!Number.isSafeInteger(pixelCount) ||
      !(image.data instanceof Uint8ClampedArray) || image.data.length !== pixelCount * 4 ||
      (expectedSize && (image.width !== expectedSize.w || image.height !== expectedSize.h))) {
    throw compositeError('invalid_frame_repair_composite', `${label} RGBA image is invalid`)
  }
}

function assertFrameSize(frameSize) {
  if (!isPlainRecord(frameSize)) {
    throw compositeError('invalid_frame_repair_composite', 'frame size is invalid')
  }
  assertPositiveInteger(frameSize.w, 'frame width is invalid')
  assertPositiveInteger(frameSize.h, 'frame height is invalid')
  if (!Number.isSafeInteger(frameSize.w * frameSize.h)) {
    throw compositeError('invalid_frame_repair_composite', 'frame size is invalid')
  }
}

function samePixel(a, aOffset, b, bOffset) {
  return a[aOffset] === b[bOffset] &&
    a[aOffset + 1] === b[bOffset + 1] &&
    a[aOffset + 2] === b[bOffset + 2] &&
    a[aOffset + 3] === b[bOffset + 3]
}

export function runsToBitset(runs, pixelCount) {
  if (!Number.isSafeInteger(pixelCount) || pixelCount <= 0 || !Array.isArray(runs)) {
    throw compositeError('invalid_frame_repair_mask', 'canonical mask runs are invalid')
  }
  const active = new Uint8Array(pixelCount)
  let previousEnd = -2
  for (const run of runs) {
    if (!isPlainRecord(run) || Object.keys(run).length !== 2 ||
        !Object.hasOwn(run, 'start') || !Object.hasOwn(run, 'length') ||
        !Number.isSafeInteger(run.start) || run.start < 0 ||
        !Number.isSafeInteger(run.length) || run.length <= 0 ||
        run.start >= pixelCount || run.length > pixelCount - run.start ||
        run.start <= previousEnd + 1) {
      throw compositeError('invalid_frame_repair_mask', 'canonical mask runs are invalid')
    }
    active.fill(1, run.start, run.start + run.length)
    previousEnd = run.start + run.length - 1
  }
  return active
}

export function buildFrameRepairMaskVisualization(targetFrame, mask) {
  if (!isPlainRecord(mask) || !Number.isSafeInteger(mask.width) || mask.width <= 0 ||
      !Number.isSafeInteger(mask.height) || mask.height <= 0) {
    throw compositeError('invalid_frame_repair_mask', 'canonical mask dimensions are invalid')
  }
  assertRgba(targetFrame, 'target frame', { w: mask.width, h: mask.height })
  const active = runsToBitset(mask.runs, mask.width * mask.height)
  const data = new Uint8ClampedArray(targetFrame.data.length)
  for (let pixel = 0; pixel < active.length; pixel += 1) {
    const offset = pixel * 4
    if (active[pixel]) {
      data[offset] = 255
      data[offset + 1] = 56
      data[offset + 2] = 176
      data[offset + 3] = 255
    } else {
      data[offset] = targetFrame.data[offset]
      data[offset + 1] = targetFrame.data[offset + 1]
      data[offset + 2] = targetFrame.data[offset + 2]
      data[offset + 3] = Math.min(targetFrame.data[offset + 3], 64)
    }
  }
  return { width: mask.width, height: mask.height, data }
}

export function frameOrigin(sheetFrameIndex, parentSheet, frameSize) {
  assertFrameSize(frameSize)
  assertRgba(parentSheet, 'parent sheet')
  if (parentSheet.width % frameSize.w !== 0 || parentSheet.height % frameSize.h !== 0) {
    throw compositeError('invalid_frame_repair_composite', 'parent sheet is not divisible by the frame size')
  }
  const columns = parentSheet.width / frameSize.w
  const rows = parentSheet.height / frameSize.h
  if (!Number.isSafeInteger(sheetFrameIndex) || sheetFrameIndex < 0 || sheetFrameIndex >= columns * rows) {
    throw compositeError('invalid_frame_repair_composite', 'sheet frame index is outside the parent sheet')
  }
  return {
    x: (sheetFrameIndex % columns) * frameSize.w,
    y: Math.floor(sheetFrameIndex / columns) * frameSize.h,
  }
}

export function extractFrameRgba(parentSheet, sheetFrameIndex, frameSize) {
  const origin = frameOrigin(sheetFrameIndex, parentSheet, frameSize)
  const data = new Uint8ClampedArray(frameSize.w * frameSize.h * 4)
  for (let y = 0; y < frameSize.h; y += 1) {
    const sourceStart = ((origin.y + y) * parentSheet.width + origin.x) * 4
    const targetStart = y * frameSize.w * 4
    data.set(parentSheet.data.subarray(sourceStart, sourceStart + frameSize.w * 4), targetStart)
  }
  return { width: frameSize.w, height: frameSize.h, data }
}

export function verifyFrameRepairIntegrity({
  parentSheet,
  patchedSheet,
  candidateFrame,
  sheetFrameIndex,
  frameSize,
  active,
}) {
  assertFrameSize(frameSize)
  assertRgba(parentSheet, 'parent sheet')
  assertRgba(patchedSheet, 'patched sheet')
  assertRgba(candidateFrame, 'candidate frame', frameSize)
  if (patchedSheet.width !== parentSheet.width || patchedSheet.height !== parentSheet.height ||
      !(active instanceof Uint8Array) || active.length !== frameSize.w * frameSize.h) {
    throw compositeError('invalid_frame_repair_composite', 'integrity inputs are invalid')
  }
  for (const value of active) {
    if (value !== 0 && value !== 1) {
      throw compositeError('invalid_frame_repair_composite', 'integrity mask is invalid')
    }
  }

  const origin = frameOrigin(sheetFrameIndex, parentSheet, frameSize)
  let attemptedOutsideMaskChanged = 0
  let actualOutsideMaskChanged = 0
  let actualNonTargetChanged = 0
  for (let y = 0; y < parentSheet.height; y += 1) {
    for (let x = 0; x < parentSheet.width; x += 1) {
      const sheetOffset = (y * parentSheet.width + x) * 4
      const inTarget = x >= origin.x && x < origin.x + frameSize.w &&
        y >= origin.y && y < origin.y + frameSize.h
      if (!inTarget) {
        if (!samePixel(parentSheet.data, sheetOffset, patchedSheet.data, sheetOffset)) {
          actualNonTargetChanged += 1
        }
        continue
      }
      const localX = x - origin.x
      const localY = y - origin.y
      const localPixel = localY * frameSize.w + localX
      if (active[localPixel]) continue
      const candidateOffset = localPixel * 4
      if (!samePixel(parentSheet.data, sheetOffset, candidateFrame.data, candidateOffset)) {
        attemptedOutsideMaskChanged += 1
      }
      if (!samePixel(parentSheet.data, sheetOffset, patchedSheet.data, sheetOffset)) {
        actualOutsideMaskChanged += 1
      }
    }
  }
  return {
    attempted_outside_mask_changed: attemptedOutsideMaskChanged,
    actual_outside_mask_changed: actualOutsideMaskChanged,
    actual_non_target_changed: actualNonTargetChanged,
    target_outside_mask_equal: actualOutsideMaskChanged === 0,
    non_target_equal: actualNonTargetChanged === 0,
  }
}

export function compositeFrameRepairCandidate({
  parentSheet,
  candidateFrame,
  sheetFrameIndex,
  frameSize,
  mask,
} = {}) {
  assertFrameSize(frameSize)
  assertRgba(parentSheet, 'parent sheet')
  assertRgba(candidateFrame, 'candidate frame', frameSize)
  if (!isPlainRecord(mask) || mask.width !== frameSize.w || mask.height !== frameSize.h) {
    throw compositeError('invalid_frame_repair_mask', 'canonical mask dimensions are invalid')
  }
  const active = runsToBitset(mask.runs, frameSize.w * frameSize.h)
  if (!active.some(Boolean)) {
    throw compositeError('invalid_frame_repair_mask', 'canonical mask is empty')
  }
  const origin = frameOrigin(sheetFrameIndex, parentSheet, frameSize)
  const before = extractFrameRgba(parentSheet, sheetFrameIndex, frameSize)
  const sheet = cloneRgba(parentSheet)
  let changedInsideMask = 0
  for (let pixel = 0; pixel < active.length; pixel += 1) {
    if (!active[pixel]) continue
    const x = pixel % frameSize.w
    const y = Math.floor(pixel / frameSize.w)
    const source = pixel * 4
    const target = ((origin.y + y) * sheet.width + origin.x + x) * 4
    if (!samePixel(sheet.data, target, candidateFrame.data, source)) changedInsideMask += 1
    sheet.data.set(candidateFrame.data.subarray(source, source + 4), target)
  }
  return {
    sheet,
    before,
    after: extractFrameRgba(sheet, sheetFrameIndex, frameSize),
    integrity: {
      ...verifyFrameRepairIntegrity({
        parentSheet,
        patchedSheet: sheet,
        candidateFrame,
        sheetFrameIndex,
        frameSize,
        active,
      }),
      changed_inside_mask: changedInsideMask,
    },
  }
}

function assertProviderBuffer(providerBuffer) {
  if (!Buffer.isBuffer(providerBuffer) || providerBuffer.length === 0 ||
      providerBuffer.length > MAX_PROVIDER_BYTES) {
    throw compositeError('provider_output_invalid', 'provider image payload is invalid')
  }
}

async function decodeProviderRaster(providerBuffer) {
  let pipeline
  let metadata
  try {
    pipeline = sharp(Buffer.from(providerBuffer), {
      animated: true,
      failOn: 'error',
      limitInputPixels: MAX_PROVIDER_PIXELS,
    })
    metadata = await pipeline.metadata()
  } catch {
    throw compositeError('provider_output_invalid', 'provider image metadata is invalid')
  }
  const width = metadata.width
  const height = metadata.height
  const pages = metadata.pages ?? 1
  if (!ALLOWED_PROVIDER_FORMATS.has(metadata.format) || pages !== 1 ||
      !Number.isSafeInteger(width) || width <= 0 ||
      !Number.isSafeInteger(height) || height <= 0 ||
      width > MAX_PROVIDER_SIDE || height > MAX_PROVIDER_SIDE ||
      !Number.isSafeInteger(width * height) || width * height > MAX_PROVIDER_PIXELS) {
    throw compositeError('provider_output_invalid', 'provider image format or dimensions are invalid')
  }

  try {
    const { data, info } = await pipeline.ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    if (info.width !== width || info.height !== height || info.channels !== 4 ||
        data.length !== width * height * 4) {
      throw new Error('decoded RGBA shape mismatch')
    }
    return { width, height, data: new Uint8ClampedArray(data) }
  } catch {
    throw compositeError('provider_output_invalid', 'provider image decode failed')
  }
}

function collectAlphaComponents(image) {
  const seen = new Uint8Array(image.width * image.height)
  const components = []
  for (let start = 0; start < seen.length; start += 1) {
    if (seen[start]) continue
    seen[start] = 1
    if (image.data[start * 4 + 3] === 0) continue
    const queue = [start]
    const pixels = []
    let minX = start % image.width
    let maxX = minX
    let minY = Math.floor(start / image.width)
    let maxY = minY
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const current = queue[cursor]
      const x = current % image.width
      const y = Math.floor(current / image.width)
      pixels.push(current)
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= image.width || ny >= image.height) continue
          const next = ny * image.width + nx
          if (seen[next]) continue
          seen[next] = 1
          if (image.data[next * 4 + 3] > 0) queue.push(next)
        }
      }
    }
    components.push({
      pixels,
      area: pixels.length,
      bbox: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
    })
  }
  return components
}

function significantComponentEvidence(image) {
  const components = collectAlphaComponents(image)
  const largest = components.reduce((max, component) => Math.max(max, component.area), 0)
  const threshold = largest <= 1 ? 1 : Math.max(2, Math.min(4, Math.ceil(largest * 0.15)))
  const significant = components.filter((component) => component.area >= threshold)
  return {
    components,
    significant,
    threshold,
    areas: components.map((component) => component.area).sort((a, b) => b - a),
  }
}

function cropRgba(image, bbox) {
  const data = new Uint8ClampedArray(bbox.w * bbox.h * 4)
  for (let y = 0; y < bbox.h; y += 1) {
    const sourceStart = ((bbox.y + y) * image.width + bbox.x) * 4
    const targetStart = y * bbox.w * 4
    data.set(image.data.subarray(sourceStart, sourceStart + bbox.w * 4), targetStart)
  }
  return { width: bbox.w, height: bbox.h, data }
}

function pasteRgba(source, size, destination) {
  const image = {
    width: size.w,
    height: size.h,
    data: new Uint8ClampedArray(size.w * size.h * 4),
  }
  let clippedPixels = 0
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const targetX = destination.x + x
      const targetY = destination.y + y
      const sourceOffset = (y * source.width + x) * 4
      if (targetX < 0 || targetY < 0 || targetX >= image.width || targetY >= image.height) {
        if (source.data[sourceOffset + 3] > 0) clippedPixels += 1
        continue
      }
      image.data.set(source.data.subarray(sourceOffset, sourceOffset + 4),
        (targetY * image.width + targetX) * 4)
    }
  }
  return { image, clippedPixels }
}

function changedPixelCount(before, after) {
  let changed = 0
  for (let offset = 0; offset < before.data.length; offset += 4) {
    if (!samePixel(before.data, offset, after.data, offset)) changed += 1
  }
  return changed
}

function alphaCleanupEvidence(before, after) {
  let removedPixels = 0
  let changedPixels = 0
  for (let offset = 0; offset < before.data.length; offset += 4) {
    if (before.data[offset + 3] !== after.data[offset + 3]) changedPixels += 1
    if (before.data[offset + 3] > 0 && after.data[offset + 3] === 0) removedPixels += 1
  }
  return { min_alpha: 18, changed_pixels: changedPixels, removed_pixels: removedPixels }
}

function haloEvidence(image) {
  let nearWhiteEdgePixels = 0
  let semiTransparentEdgePixels = 0
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const offset = (y * image.width + x) * 4
      const alpha = image.data[offset + 3]
      if (alpha === 0) continue
      let edge = false
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= image.width || ny >= image.height ||
            image.data[(ny * image.width + nx) * 4 + 3] === 0) {
          edge = true
          break
        }
      }
      if (!edge) continue
      const r = image.data[offset]
      const g = image.data[offset + 1]
      const b = image.data[offset + 2]
      if (Math.max(r, g, b) - Math.min(r, g, b) <= 28 && (r + g + b) / 3 >= 170) {
        nearWhiteEdgePixels += 1
      }
      if (alpha < 255) semiTransparentEdgePixels += 1
    }
  }
  return {
    near_white_edge_pixels: nearWhiteEdgePixels,
    semi_transparent_edge_pixels: semiTransparentEdgePixels,
  }
}

function isFullSheetResponse(decoded, parentSheet, frameSize) {
  return (parentSheet.width !== frameSize.w || parentSheet.height !== frameSize.h) &&
    decoded.width === parentSheet.width && decoded.height === parentSheet.height
}

export async function normalizeFrameRepairCandidate({
  providerBuffer,
  parentFrame,
  parentSheet,
  frameSize,
} = {}) {
  assertProviderBuffer(providerBuffer)
  assertFrameSize(frameSize)
  assertRgba(parentFrame, 'parent frame', frameSize)
  assertRgba(parentSheet, 'parent sheet')
  if (parentSheet.width % frameSize.w !== 0 || parentSheet.height % frameSize.h !== 0) {
    throw compositeError('invalid_frame_repair_composite', 'parent sheet is not divisible by the frame size')
  }
  const targetBbox = detectAlphaBBox(parentFrame)
  const targetAnchor = detectFootAnchor(parentFrame, targetBbox)
  if (!targetBbox || !targetAnchor) {
    throw compositeError('invalid_frame_repair_composite', 'parent target frame is empty')
  }

  const decoded = await decodeProviderRaster(providerBuffer)
  const rawProviderPng = await encodeRgbaPng(decoded)
  if (isFullSheetResponse(decoded, parentSheet, frameSize)) {
    throw compositeError('provider_output_full_sheet', 'provider returned a full sheet instead of one frame')
  }

  const background = await removeBackground(decoded, { backgroundMode: 'auto' })
  const subjectEvidence = significantComponentEvidence(background.image)
  if (subjectEvidence.significant.length === 0) {
    throw compositeError('provider_output_empty', 'provider output does not contain a visible subject')
  }
  if (subjectEvidence.significant.length > 1) {
    throw compositeError('provider_output_multiple_subjects', 'provider output contains multiple significant subjects')
  }

  const prefitCleanup = cleanupSmallAlphaComponentsFromRgba(background.image, {
    minArea: subjectEvidence.threshold,
    minAreaRatio: 0,
  })
  const sourceBbox = detectAlphaBBox(prefitCleanup.image)
  if (!sourceBbox) {
    throw compositeError('provider_output_empty', 'provider output is empty after local cleanup')
  }
  const cropped = cropRgba(prefitCleanup.image, sourceBbox)
  const scale = Math.min(targetBbox.w / sourceBbox.w, targetBbox.h / sourceBbox.h)
  if (!Number.isFinite(scale) || scale <= 0) {
    throw compositeError('provider_output_invalid', 'provider subject cannot be fitted to the target frame')
  }
  const scaledSize = {
    w: Math.max(1, Math.round(sourceBbox.w * scale)),
    h: Math.max(1, Math.round(sourceBbox.h * scale)),
  }
  const resized = await resizeRgbaNearest(cropped, scaledSize)
  const resizedBbox = detectAlphaBBox(resized)
  const resizedAnchor = detectFootAnchor(resized, resizedBbox)
  if (!resizedAnchor) {
    throw compositeError('provider_output_empty', 'provider output is empty after nearest-neighbor fit')
  }
  const destination = {
    x: targetAnchor.x - resizedAnchor.x,
    y: targetAnchor.y - resizedAnchor.y,
  }
  const placed = pasteRgba(resized, frameSize, destination)

  const palette = extractPalette(parentSheet, { maxColors: 16, alphaThreshold: 1 })
  if (palette.length === 0) {
    throw compositeError('invalid_frame_repair_composite', 'parent sheet palette is empty')
  }
  const paletteSnapped = snapToPalette(placed.image, { palette, alphaThreshold: 1 })
  const alphaCleaned = cleanupAlphaArtifactsFromRgba(paletteSnapped, { minAlpha: 18 })
  const finalCleanup = cleanupSmallAlphaComponentsFromRgba(alphaCleaned, {
    minArea: 1,
    minAreaRatio: 0,
  })
  const candidateFrame = cloneRgba(finalCleanup.image)
  const normalizedBbox = detectAlphaBBox(candidateFrame)
  const normalizedAnchor = detectFootAnchor(candidateFrame, normalizedBbox)
  if (!normalizedBbox || !normalizedAnchor) {
    throw compositeError('provider_output_empty', 'normalized provider candidate is empty')
  }
  const candidatePng = await encodeRgbaPng(candidateFrame)

  return {
    raw_provider_png: Buffer.from(rawProviderPng),
    normalized_candidate_frame: candidateFrame,
    normalized_candidate_frame_png: Buffer.from(candidatePng),
    transforms: {
      source_size: { w: decoded.width, h: decoded.height },
      source_bbox: structuredClone(sourceBbox),
      target_bbox: structuredClone(targetBbox),
      source_anchor: detectFootAnchor(prefitCleanup.image, sourceBbox),
      target_anchor: structuredClone(targetAnchor),
      scale,
      scaled_size: scaledSize,
      destination,
      clipped_visible_pixels: placed.clippedPixels,
      palette_source: 'parent_sheet',
      resize: 'nearest',
    },
    finishing: {
      background_removal: {
        mode: background.mode,
        warnings: [...(background.warnings ?? [])],
      },
      significant_components: {
        count: subjectEvidence.significant.length,
        threshold: subjectEvidence.threshold,
        areas: subjectEvidence.areas,
      },
      palette: {
        source: 'parent_sheet',
        max_colors: 16,
        colors: structuredClone(palette),
        changed_pixel_count: changedPixelCount(placed.image, paletteSnapped),
      },
      alpha_cleanup: alphaCleanupEvidence(paletteSnapped, alphaCleaned),
      component_cleanup: {
        removed_components: prefitCleanup.stats.removed_components + finalCleanup.stats.removed_components,
        removed_pixels: prefitCleanup.stats.removed_pixels + finalCleanup.stats.removed_pixels,
        before_fit: structuredClone(prefitCleanup.stats),
        after_fit: structuredClone(finalCleanup.stats),
      },
      halo: {
        before: haloEvidence(placed.image),
        after: haloEvidence(candidateFrame),
      },
      normalized_bbox: structuredClone(normalizedBbox),
      normalized_anchor: structuredClone(normalizedAnchor),
      baseline: normalizedAnchor.y,
    },
  }
}

function cloneEvidence(value) {
  return value == null ? value : structuredClone(value)
}

function visiblePixelCount(image) {
  let count = 0
  for (let offset = 3; offset < image.data.length; offset += 4) {
    if (image.data[offset] > 0) count += 1
  }
  return count
}

function frameQualityEvidence(image, label) {
  assertRgba(image, label)
  const bbox = detectAlphaBBox(image)
  const footAnchor = detectFootAnchor(image, bbox)
  return {
    bbox: cloneEvidence(bbox),
    foot_anchor: cloneEvidence(footAnchor),
    baseline: footAnchor?.y ?? null,
    visible_pixels: visiblePixelCount(image),
  }
}

function alphaQualityEvidence(image) {
  let visiblePixels = 0
  let opaquePixels = 0
  let semiTransparentPixels = 0
  for (let offset = 3; offset < image.data.length; offset += 4) {
    const alpha = image.data[offset]
    if (alpha === 0) continue
    visiblePixels += 1
    if (alpha === 255) opaquePixels += 1
    else semiTransparentPixels += 1
  }
  return {
    visible_pixels: visiblePixels,
    opaque_pixels: opaquePixels,
    semi_transparent_pixels: semiTransparentPixels,
  }
}

function componentQualityEvidence(image) {
  const evidence = significantComponentEvidence(image)
  return {
    count: evidence.significant.length,
    total_count: evidence.components.length,
    threshold: evidence.threshold,
    areas: evidence.areas,
  }
}

function deriveFrameIntegrityEvidence({ parentFrame, compositedFrame, candidateFrame, mask, integrity }) {
  assertRgba(parentFrame, 'quality parent frame')
  assertRgba(compositedFrame, 'quality composited frame', {
    w: parentFrame.width,
    h: parentFrame.height,
  })
  assertRgba(candidateFrame, 'quality provider frame', {
    w: parentFrame.width,
    h: parentFrame.height,
  })
  if (!isPlainRecord(mask) || mask.width !== parentFrame.width || mask.height !== parentFrame.height) {
    throw compositeError('invalid_frame_repair_quality', 'quality mask dimensions are invalid')
  }
  const active = runsToBitset(mask.runs, parentFrame.width * parentFrame.height)
  if (!active.some(Boolean)) {
    throw compositeError('invalid_frame_repair_quality', 'quality mask is empty')
  }
  let changedInsideMask = 0
  let attemptedOutsideMaskChanged = 0
  let actualOutsideMaskChanged = 0
  for (let pixel = 0; pixel < active.length; pixel += 1) {
    const offset = pixel * 4
    if (active[pixel]) {
      if (!samePixel(parentFrame.data, offset, compositedFrame.data, offset)) changedInsideMask += 1
      continue
    }
    if (!samePixel(parentFrame.data, offset, candidateFrame.data, offset)) {
      attemptedOutsideMaskChanged += 1
    }
    if (!samePixel(parentFrame.data, offset, compositedFrame.data, offset)) {
      actualOutsideMaskChanged += 1
    }
  }
  const actualNonTargetChanged = Number.isSafeInteger(integrity?.actual_non_target_changed) &&
    integrity.actual_non_target_changed >= 0
    ? integrity.actual_non_target_changed
    : null
  return {
    attempted_outside_mask_changed: attemptedOutsideMaskChanged,
    actual_outside_mask_changed: actualOutsideMaskChanged,
    actual_non_target_changed: actualNonTargetChanged,
    target_outside_mask_equal: actualOutsideMaskChanged === 0,
    non_target_equal: actualNonTargetChanged === 0 && integrity?.non_target_equal !== false,
    changed_inside_mask: changedInsideMask,
  }
}

function distanceBetween(a, b) {
  if (!a || !b) return null
  return Number(Math.hypot(a.x - b.x, a.y - b.y).toFixed(4))
}

function continuityComparison(frame, adjacent) {
  const target = frameQualityEvidence(frame, 'quality continuity target')
  const context = frameQualityEvidence(adjacent, 'quality continuity context')
  return {
    foot_anchor_distance: distanceBetween(target.foot_anchor, context.foot_anchor),
    bbox_center_distance: target.bbox && context.bbox
      ? Number(Math.hypot(
        target.bbox.centerX - context.bbox.centerX,
        target.bbox.centerY - context.bbox.centerY,
      ).toFixed(4))
      : null,
    baseline_delta: target.baseline == null || context.baseline == null
      ? null
      : Math.abs(target.baseline - context.baseline),
    visible_pixel_delta: Math.abs(target.visible_pixels - context.visible_pixels),
  }
}

function deriveContinuityEvidence(parentFrame, compositedFrame, adjacentClipFrames) {
  if (!Array.isArray(adjacentClipFrames)) return null
  const frames = adjacentClipFrames.map((item, index) => {
    const frame = isPlainRecord(item) && Object.hasOwn(item, 'frame') ? item.frame : item
    const role = isPlainRecord(item) && typeof item.role === 'string' ? item.role : `context_${index}`
    const before = continuityComparison(parentFrame, frame)
    const after = continuityComparison(compositedFrame, frame)
    const delta = Object.fromEntries(Object.keys(before).map((key) => [
      key,
      before[key] == null || after[key] == null ? null : Number((after[key] - before[key]).toFixed(4)),
    ]))
    return { role, before, after, delta }
  })
  return { status: 'measured', warnings: [], frames }
}

function hasRawQualityInputs(evidence) {
  return evidence.parentFrame != null || evidence.parent_frame != null ||
    evidence.compositedFrame != null || evidence.composited_frame != null ||
    evidence.normalizedProviderFrame != null || evidence.normalized_provider_frame != null
}

function projectQualityEvidence(evidence) {
  if (!hasRawQualityInputs(evidence)) {
    return {
      before: cloneEvidence(evidence.before),
      after: cloneEvidence(evidence.after),
      integrity: cloneEvidence(evidence.integrity),
      halo: cloneEvidence(evidence.halo),
      alpha: cloneEvidence(evidence.alpha),
      significant_components: cloneEvidence(evidence.significant_components),
      continuity: cloneEvidence(evidence.continuity),
      validation: cloneEvidence(evidence.validation),
    }
  }

  const parentFrame = evidence.parentFrame ?? evidence.parent_frame
  const compositedFrame = evidence.compositedFrame ?? evidence.composited_frame
  const candidateFrame = evidence.normalizedProviderFrame ?? evidence.normalized_provider_frame
  const adjacentClipFrames = evidence.adjacentClipFrames ?? evidence.adjacent_clip_frames
  const measuredContinuity = deriveContinuityEvidence(parentFrame, compositedFrame, adjacentClipFrames)
  const suppliedContinuity = cloneEvidence(evidence.continuity)
  return {
    before: frameQualityEvidence(parentFrame, 'quality parent frame'),
    after: frameQualityEvidence(compositedFrame, 'quality composited frame'),
    integrity: deriveFrameIntegrityEvidence({
      parentFrame,
      compositedFrame,
      candidateFrame,
      mask: evidence.mask,
      integrity: evidence.integrity,
    }),
    halo: {
      before: haloEvidence(parentFrame),
      candidate: haloEvidence(candidateFrame),
      after: haloEvidence(compositedFrame),
    },
    alpha: {
      before: alphaQualityEvidence(parentFrame),
      candidate: alphaQualityEvidence(candidateFrame),
      after: alphaQualityEvidence(compositedFrame),
    },
    significant_components: {
      before: componentQualityEvidence(parentFrame),
      candidate: componentQualityEvidence(candidateFrame),
      after: componentQualityEvidence(compositedFrame),
    },
    continuity: suppliedContinuity
      ? { ...suppliedContinuity, frames: measuredContinuity?.frames ?? suppliedContinuity.frames }
      : measuredContinuity,
    validation: cloneEvidence(evidence.validation),
  }
}

function actualIntegrityFailed(integrity) {
  return integrity?.non_target_equal === false ||
    integrity?.target_outside_mask_equal === false ||
    (isNonNegativeSafeInteger(integrity?.actual_outside_mask_changed) &&
      integrity.actual_outside_mask_changed > 0) ||
    (isNonNegativeSafeInteger(integrity?.actual_non_target_changed) &&
      integrity.actual_non_target_changed > 0)
}

function validatorFailed(validation) {
  return validation?.status === 'fail' ||
    (isStringArray(validation?.blocking_errors) && validation.blocking_errors.length > 0)
}

function hasWarning(evidence) {
  return evidence?.validation?.status === 'warning' ||
    (Array.isArray(evidence?.validation?.warnings) && evidence.validation.warnings.length > 0) ||
    evidence?.continuity?.status === 'warning' ||
    evidence?.continuity?.warning === true ||
    (Array.isArray(evidence?.continuity?.warnings) && evidence.continuity.warnings.length > 0) ||
    Number(evidence?.integrity?.changed_inside_mask ?? 0) === 0
}

function isNonNegativeSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0
}

function isNonNegativeFinite(value) {
  return Number.isFinite(value) && value >= 0
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function addMissing(missing, path) {
  if (!missing.includes(path)) missing.push(path)
}

function requireFact(record, key, path, validator, missing) {
  const factPath = `${path}.${key}`
  if (!Object.hasOwn(record, key) || !validator(record[key])) addMissing(missing, factPath)
}

function validBBox(value) {
  if (value === null) return true
  if (!isPlainRecord(value) ||
      !isNonNegativeSafeInteger(value.x) || !isNonNegativeSafeInteger(value.y) ||
      !Number.isSafeInteger(value.w) || value.w <= 0 ||
      !Number.isSafeInteger(value.h) || value.h <= 0 ||
      !isNonNegativeSafeInteger(value.right) || !isNonNegativeSafeInteger(value.bottom) ||
      !isNonNegativeFinite(value.centerX) || !isNonNegativeFinite(value.centerY)) return false
  return value.right === value.x + value.w - 1 &&
    value.bottom === value.y + value.h - 1 &&
    value.centerX === value.x + value.w / 2 &&
    value.centerY === value.y + value.h / 2
}

function validFootAnchor(value) {
  return value === null || (
    isPlainRecord(value) &&
    isNonNegativeSafeInteger(value.x) &&
    isNonNegativeSafeInteger(value.y) &&
    typeof value.mode === 'string' && value.mode.length > 0
  )
}

function validateFrameEvidence(value, path, missing) {
  if (!isPlainRecord(value)) {
    addMissing(missing, path)
    return
  }
  requireFact(value, 'bbox', path, validBBox, missing)
  requireFact(value, 'foot_anchor', path, validFootAnchor, missing)
  requireFact(value, 'baseline', path, (item) => item === null || isNonNegativeFinite(item), missing)
  requireFact(value, 'visible_pixels', path, isNonNegativeSafeInteger, missing)
}

function validateIntegrityEvidence(value, missing) {
  const path = 'integrity'
  if (!isPlainRecord(value)) {
    addMissing(missing, path)
    return
  }
  for (const key of [
    'attempted_outside_mask_changed',
    'actual_outside_mask_changed',
    'actual_non_target_changed',
    'changed_inside_mask',
  ]) requireFact(value, key, path, isNonNegativeSafeInteger, missing)
  for (const key of ['target_outside_mask_equal', 'non_target_equal']) {
    requireFact(value, key, path, (item) => typeof item === 'boolean', missing)
  }
}

function validateStageCounts(value, path, fields, missing) {
  if (!isPlainRecord(value)) {
    addMissing(missing, path)
    return
  }
  for (const field of fields) requireFact(value, field, path, isNonNegativeSafeInteger, missing)
}

function validateThreeStageCounts(value, path, fields, missing) {
  if (!isPlainRecord(value)) {
    addMissing(missing, path)
    return
  }
  for (const stage of ['before', 'candidate', 'after']) {
    const stagePath = `${path}.${stage}`
    if (!Object.hasOwn(value, stage)) addMissing(missing, stagePath)
    else validateStageCounts(value[stage], stagePath, fields, missing)
  }
}

function validateComponentEvidence(value, missing) {
  const path = 'significant_components'
  if (!isPlainRecord(value)) {
    addMissing(missing, path)
    return
  }
  for (const stage of ['before', 'candidate', 'after']) {
    const stagePath = `${path}.${stage}`
    const stageValue = value[stage]
    if (!Object.hasOwn(value, stage) || !isPlainRecord(stageValue)) {
      addMissing(missing, stagePath)
      continue
    }
    requireFact(stageValue, 'count', stagePath, isNonNegativeSafeInteger, missing)
    requireFact(stageValue, 'total_count', stagePath, isNonNegativeSafeInteger, missing)
    requireFact(stageValue, 'threshold', stagePath,
      (item) => Number.isSafeInteger(item) && item > 0, missing)
    requireFact(stageValue, 'areas', stagePath,
      (item) => Array.isArray(item) && item.every(isNonNegativeSafeInteger), missing)
    if (isNonNegativeSafeInteger(stageValue.count) &&
        isNonNegativeSafeInteger(stageValue.total_count) &&
        stageValue.count > stageValue.total_count) addMissing(missing, `${stagePath}.count`)
    if (Array.isArray(stageValue.areas) && isNonNegativeSafeInteger(stageValue.total_count) &&
        stageValue.areas.length !== stageValue.total_count) addMissing(missing, `${stagePath}.areas`)
  }
}

const CONTINUITY_METRIC_KEYS = Object.freeze([
  'foot_anchor_distance',
  'bbox_center_distance',
  'baseline_delta',
  'visible_pixel_delta',
])

function validContinuityMetricGroup(value, allowNegative = false) {
  return isPlainRecord(value) && CONTINUITY_METRIC_KEYS.every((key) =>
    Object.hasOwn(value, key) &&
    (value[key] === null || (Number.isFinite(value[key]) && (allowNegative || value[key] >= 0))))
}

function validContinuityFrames(value) {
  return Array.isArray(value) && value.every((item) =>
    isPlainRecord(item) && typeof item.role === 'string' && item.role.length > 0 &&
    validContinuityMetricGroup(item.before) &&
    validContinuityMetricGroup(item.after) &&
    validContinuityMetricGroup(item.delta, true))
}

function validateContinuityEvidence(value, missing) {
  const path = 'continuity'
  if (!isPlainRecord(value)) {
    addMissing(missing, path)
    return
  }
  requireFact(value, 'status', path,
    (item) => item === 'measured' || item === 'pass' || item === 'warning', missing)
  requireFact(value, 'warnings', path, isStringArray, missing)

  if (!Object.hasOwn(value, 'frames') || !validContinuityFrames(value.frames)) {
    addMissing(missing, 'continuity.frames')
  }
}

function validateValidationEvidence(value, missing) {
  const path = 'validation'
  if (!isPlainRecord(value)) {
    addMissing(missing, path)
    return
  }
  requireFact(value, 'status', path,
    (item) => item === 'pass' || item === 'warning' || item === 'fail', missing)
  requireFact(value, 'warnings', path, isStringArray, missing)
  requireFact(value, 'blocking_errors', path, isStringArray, missing)
  if (!Object.hasOwn(value, 'deltas') || !isPlainRecord(value.deltas)) {
    addMissing(missing, 'validation.deltas')
    return
  }
  for (const key of [
    'warnings_added',
    'warnings_removed',
    'blocking_errors_added',
    'blocking_errors_removed',
  ]) requireFact(value.deltas, key, 'validation.deltas', isStringArray, missing)
}

function missingQualityGroups(evidence) {
  const missing = []
  validateFrameEvidence(evidence?.before, 'before', missing)
  validateFrameEvidence(evidence?.after, 'after', missing)
  validateIntegrityEvidence(evidence?.integrity, missing)
  validateThreeStageCounts(evidence?.halo, 'halo', [
    'near_white_edge_pixels',
    'semi_transparent_edge_pixels',
  ], missing)
  validateThreeStageCounts(evidence?.alpha, 'alpha', [
    'visible_pixels',
    'opaque_pixels',
    'semi_transparent_pixels',
  ], missing)
  validateComponentEvidence(evidence?.significant_components, missing)
  validateContinuityEvidence(evidence?.continuity, missing)
  validateValidationEvidence(evidence?.validation, missing)
  return missing
}

export function buildFrameRepairQualityReport(evidence = {}) {
  if (!isPlainRecord(evidence)) {
    throw compositeError('invalid_frame_repair_quality', 'frame repair quality evidence is invalid')
  }
  const projected = projectQualityEvidence(evidence)
  const missing = missingQualityGroups(projected)
  const complete = evidence.complete === true && missing.length === 0
  const status = actualIntegrityFailed(projected.integrity) || validatorFailed(projected.validation)
    ? 'fail'
    : !complete
      ? 'unknown'
      : hasWarning(projected)
        ? 'warning'
        : 'pass'
  return {
    status,
    complete,
    completeness: { complete, missing },
    ...projected,
  }
}
