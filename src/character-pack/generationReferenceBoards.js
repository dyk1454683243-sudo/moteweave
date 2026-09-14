import { createHash } from 'node:crypto'

import { grayscalePose } from './fixedRegionActionRepairAtlas.js'
import { encodeRgbaPng, loadRgba, resizeRgbaNearest } from './imageCodec.js'
import { cloneRgba, pixelOffset } from './imageMath.js'
import { detectAlphaBBox } from './normalizer.js'
import { removeBackground, shouldPreferExistingAlpha } from './sourcePreparation.js'
import { extractPalette } from './stylePipeline.js'
import { analyzeSubjectCountCell } from './subjectCountGate.js'

export const GENERATION_REFERENCE_SIZE = 1024

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function emptyImage(width, height, fill = [0, 0, 0, 0]) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let offset = 0; offset < data.length; offset += 4) data.set(fill, offset)
  return { width, height, data }
}

function cropImage(image, bbox) {
  const output = emptyImage(bbox.w, bbox.h)
  for (let y = 0; y < bbox.h; y += 1) {
    const sourceOffset = pixelOffset(image.width, bbox.x, bbox.y + y)
    output.data.set(image.data.subarray(sourceOffset, sourceOffset + bbox.w * 4), y * bbox.w * 4)
  }
  return output
}

function pasteImage(target, source, x, y) {
  for (let sy = 0; sy < source.height; sy += 1) {
    for (let sx = 0; sx < source.width; sx += 1) {
      const sourceOffset = pixelOffset(source.width, sx, sy)
      if (source.data[sourceOffset + 3] === 0) continue
      const tx = x + sx
      const ty = y + sy
      if (tx < 0 || ty < 0 || tx >= target.width || ty >= target.height) continue
      target.data.set(source.data.subarray(sourceOffset, sourceOffset + 4), pixelOffset(target.width, tx, ty))
    }
  }
}

function derivedImageRecord({ name, role, buffer, source, report = null }) {
  return {
    name,
    role,
    mimeType: 'image/png',
    buffer,
    width: GENERATION_REFERENCE_SIZE,
    height: GENERATION_REFERENCE_SIZE,
    source: source ? {
      name: source.name ?? null,
      mime_type: source.mimeType ?? source.mime_type ?? null,
      byte_length: source.buffer.byteLength,
      sha256: sha256(source.buffer),
    } : null,
    report,
  }
}

export async function buildStructureReferenceBoard(templateImage, { sourceLayoutId } = {}) {
  if (!templateImage?.buffer) throw new Error('generation structure template is required')
  const loaded = await loadRgba(templateImage.buffer)
  let prepared = loaded
  let padding = null
  if (sourceLayoutId === 'fixed_region_motion_v0' && loaded.width === 252 && loaded.height === 252) {
    prepared = emptyImage(256, 256)
    pasteImage(prepared, loaded, 0, 0)
    padding = { right: 4, bottom: 4 }
  }
  const grayscale = grayscalePose(prepared)
  const board = await resizeRgbaNearest(grayscale, {
    w: GENERATION_REFERENCE_SIZE,
    h: GENERATION_REFERENCE_SIZE,
  })
  const buffer = await encodeRgbaPng(board)
  const actualSha256 = sha256(buffer)
  if (templateImage.expectedStructureSha256 && actualSha256 !== templateImage.expectedStructureSha256) {
    throw new Error(`authoritative generation structure pixels changed: ${sourceLayoutId}`)
  }
  return derivedImageRecord({
    name: 'structure_reference.png',
    role: 'structure',
    buffer,
    source: templateImage,
    report: {
      transform: 'three_tone_grayscale_pose_v1',
      source_layout: sourceLayoutId,
      source_size: { w: loaded.width, h: loaded.height },
      padded_size: { w: prepared.width, h: prepared.height },
      padding,
      resize: 'nearest_neighbor',
      output_size: { w: board.width, h: board.height },
      retains_source_color: false,
      identity_authority: false,
      structure_authority: templateImage.structureAuthority ?? 'caller_supplied_unsealed',
      structure_authority_id: templateImage.structureAuthorityId ?? null,
      exact_structure_sha256: actualSha256,
      source_outline_preserved: true,
      geometric_transform_only: 'transparent_padding_then_nearest_neighbor_resize',
    },
  })
}

async function transparentIdentitySource(image) {
  const raw = await loadRgba(image.buffer)
  if (shouldPreferExistingAlpha(raw, { minCoverage: 0.02 })) {
    return { image: cloneRgba(raw), mode: 'existing_alpha' }
  }
  const removed = await removeBackground(raw, { backgroundMode: 'auto' })
  return { image: removed.image, mode: removed.mode, warnings: removed.warnings ?? [] }
}

export async function buildIdentityReferenceBoard(identityImage) {
  if (!identityImage?.buffer) return null
  const transparent = await transparentIdentitySource(identityImage)
  const subject = analyzeSubjectCountCell(transparent.image, { role: 'identity_input' })
  if (subject.status !== 'pass') {
    throw new Error(`identity image must contain one reliably isolated subject; subject gate returned ${subject.status}`)
  }
  const bbox = detectAlphaBBox(transparent.image)
  if (!bbox) throw new Error('identity image contains no visible subject')
  const cropped = cropImage(transparent.image, bbox)
  const maxWidth = 768
  const maxHeight = 768
  const scale = Math.min(maxWidth / cropped.width, maxHeight / cropped.height)
  const target = {
    w: Math.max(1, Math.round(cropped.width * scale)),
    h: Math.max(1, Math.round(cropped.height * scale)),
  }
  const resized = target.w === cropped.width && target.h === cropped.height
    ? cropped
    : await resizeRgbaNearest(cropped, target)
  const board = emptyImage(GENERATION_REFERENCE_SIZE, GENERATION_REFERENCE_SIZE)
  const x = Math.round((board.width - resized.width) / 2)
  const y = Math.round((board.height - resized.height) / 2)
  pasteImage(board, resized, x, y)
  return derivedImageRecord({
    name: 'identity_reference.png',
    role: 'identity',
    buffer: await encodeRgbaPng(board),
    source: identityImage,
    report: {
      transform: 'single_subject_identity_board_v1',
      background_mode: transparent.mode,
      background_warnings: transparent.warnings ?? [],
      subject_gate: {
        mode: 'subject_count_gate_v1',
        status: subject.status,
        component_count: subject.components.length,
        accessory_component_count: subject.components.filter((component) => component.classification === 'accessory').length,
      },
      source_bbox: bbox,
      placed_bbox: { x, y, w: resized.width, h: resized.height },
      significant_subject_count: 1,
      duplicate_views: 0,
      output_size: { w: board.width, h: board.height },
    },
  })
}

function fillRect(image, rect, color) {
  for (let y = rect.y; y < rect.y + rect.h; y += 1) {
    for (let x = rect.x; x < rect.x + rect.w; x += 1) {
      const offset = pixelOffset(image.width, x, y)
      image.data[offset] = color[0]
      image.data[offset + 1] = color[1]
      image.data[offset + 2] = color[2]
      image.data[offset + 3] = 255
    }
  }
}

export async function buildPaletteReferenceBoard(paletteImage, { maxColors = 16 } = {}) {
  if (!paletteImage?.buffer) return null
  const raw = await loadRgba(paletteImage.buffer)
  let paletteSource = raw
  let backgroundMode = 'not_applied'
  if (!shouldPreferExistingAlpha(raw, { minCoverage: 0.02 })) {
    const removed = await removeBackground(raw, { backgroundMode: 'auto' })
    const cleanedPalette = extractPalette(removed.image, { maxColors })
    if (cleanedPalette.length >= 2) {
      paletteSource = removed.image
      backgroundMode = removed.mode
    }
  }
  const palette = extractPalette(paletteSource, { maxColors })
  if (!palette.length) throw new Error('palette image contains no usable colors')
  const columns = Math.min(4, palette.length)
  const rows = Math.ceil(palette.length / columns)
  const board = emptyImage(GENERATION_REFERENCE_SIZE, GENERATION_REFERENCE_SIZE, palette[0].rgb.concat(255))
  palette.forEach((color, index) => {
    const column = index % columns
    const row = Math.floor(index / columns)
    const x0 = Math.round((column * board.width) / columns)
    const x1 = Math.round(((column + 1) * board.width) / columns)
    const y0 = Math.round((row * board.height) / rows)
    const y1 = Math.round(((row + 1) * board.height) / rows)
    fillRect(board, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, color.rgb)
  })
  return derivedImageRecord({
    name: 'palette_reference.png',
    role: 'palette',
    buffer: await encodeRgbaPng(board),
    source: paletteImage,
    report: {
      transform: 'palette_swatch_board_v1',
      background_mode: backgroundMode,
      color_count: palette.length,
      colors: palette.map((color) => ({ rgb: color.rgb, hex: color.hex, ratio: color.ratio })),
      contains_source_silhouette: false,
      output_size: { w: board.width, h: board.height },
    },
  })
}
