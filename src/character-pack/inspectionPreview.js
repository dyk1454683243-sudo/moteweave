import { encodeGifFromRgbaFrames } from './gifExport.js'
import { encodeRgbaPng } from './imageCodec.js'
import { pixelOffset } from './imageMath.js'
import { detectAlphaBBox } from './normalizer.js'

export const INSPECTION_PREVIEW_SPEC = Object.freeze({
  mode: 'inspection_preview_v1',
  target_size: Object.freeze({ w: 256, h: 256 }),
  placement: 'center_bottom',
  scale_mode: 'action_stable_nearest',
  source_crop: 'action_union_alpha_bbox',
  columns: 4,
  source_padding_px: 2,
  target_padding_px: Object.freeze({ x: 16, top: 16, bottom: 16 }),
})

function fileBase(name, fallback = 'preview') {
  return (
    String(name ?? fallback)
      .replace(/\.gif$/i, '')
      .replace(/[^a-zA-Z0-9._-]+/g, '_')
      .replace(/^_+|_+$/g, '') || fallback
  )
}

function cloneEmptyFrame(size = INSPECTION_PREVIEW_SPEC.target_size) {
  return { width: size.w, height: size.h, data: new Uint8ClampedArray(size.w * size.h * 4) }
}

function unionAlphaBBox(images) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -1
  let maxY = -1
  for (const image of images) {
    const bbox = detectAlphaBBox(image)
    if (!bbox) continue
    minX = Math.min(minX, bbox.x)
    minY = Math.min(minY, bbox.y)
    maxX = Math.max(maxX, bbox.right)
    maxY = Math.max(maxY, bbox.bottom)
  }
  if (maxX < minX || maxY < minY) return null
  return { x: minX, y: minY, right: maxX, bottom: maxY, w: maxX - minX + 1, h: maxY - minY + 1 }
}

function paddedCropBox(bbox, image, padding = INSPECTION_PREVIEW_SPEC.source_padding_px) {
  if (!bbox) return null
  const x = Math.max(0, bbox.x - padding)
  const y = Math.max(0, bbox.y - padding)
  const right = Math.min(image.width - 1, bbox.right + padding)
  const bottom = Math.min(image.height - 1, bbox.bottom + padding)
  return { x, y, right, bottom, w: right - x + 1, h: bottom - y + 1 }
}

function scaleForCrop(crop, spec = INSPECTION_PREVIEW_SPEC) {
  const size = spec.target_size
  const padding = spec.target_padding_px
  const maxW = Math.max(1, size.w - padding.x * 2)
  const maxH = Math.max(1, size.h - padding.top - padding.bottom)
  return Math.min(maxW / crop.w, maxH / crop.h)
}

function renderInspectionFrame(source, crop, scale, spec = INSPECTION_PREVIEW_SPEC) {
  const out = cloneEmptyFrame(spec.target_size)
  if (!crop || !source) return out
  const scaledW = Math.max(1, Math.round(crop.w * scale))
  const scaledH = Math.max(1, Math.round(crop.h * scale))
  const dstX = Math.round((out.width - scaledW) / 2)
  const dstY = Math.round(out.height - spec.target_padding_px.bottom - scaledH)
  for (let y = 0; y < scaledH; y += 1) {
    for (let x = 0; x < scaledW; x += 1) {
      const sx = crop.x + Math.min(crop.w - 1, Math.floor(x / scale))
      const sy = crop.y + Math.min(crop.h - 1, Math.floor(y / scale))
      const tx = dstX + x
      const ty = dstY + y
      if (tx < 0 || ty < 0 || tx >= out.width || ty >= out.height) continue
      const src = pixelOffset(source.width, sx, sy)
      const dst = pixelOffset(out.width, tx, ty)
      out.data[dst] = source.data[src]
      out.data[dst + 1] = source.data[src + 1]
      out.data[dst + 2] = source.data[src + 2]
      out.data[dst + 3] = source.data[src + 3]
    }
  }
  return out
}

function pasteImage(target, image, dstX, dstY) {
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const src = pixelOffset(image.width, x, y)
      const dst = pixelOffset(target.width, dstX + x, dstY + y)
      target.data[dst] = image.data[src]
      target.data[dst + 1] = image.data[src + 1]
      target.data[dst + 2] = image.data[src + 2]
      target.data[dst + 3] = image.data[src + 3]
    }
  }
}

async function encodeStrip(frames, spec = INSPECTION_PREVIEW_SPEC) {
  const size = spec.target_size
  const strip = { width: Math.max(1, frames.length) * size.w, height: size.h, data: new Uint8ClampedArray(Math.max(1, frames.length) * size.w * size.h * 4) }
  frames.forEach((frame, index) => pasteImage(strip, frame, index * size.w, 0))
  return encodeRgbaPng(strip)
}

async function encodeSheet(actions, spec = INSPECTION_PREVIEW_SPEC) {
  const frames = actions.flatMap((action) => action.frames)
  const size = spec.target_size
  const columns = Math.max(1, spec.columns)
  const rows = Math.max(1, Math.ceil(frames.length / columns))
  const sheet = { width: columns * size.w, height: rows * size.h, data: new Uint8ClampedArray(columns * size.w * rows * size.h * 4) }
  frames.forEach((frame, index) => {
    const col = index % columns
    const row = Math.floor(index / columns)
    pasteImage(sheet, frame, col * size.w, row * size.h)
  })
  return { image: sheet, png: await encodeRgbaPng(sheet) }
}

function buildIndex({ previews, actions, sheet, spec = INSPECTION_PREVIEW_SPEC }) {
  let cursor = 0
  return {
    schema_version: 1,
    mode: spec.mode,
    target_size: spec.target_size,
    placement: spec.placement,
    scale_mode: spec.scale_mode,
    source_crop: spec.source_crop,
    columns: spec.columns,
    sheet: {
      file: 'inspection_sheet.png',
      w: sheet.image.width,
      h: sheet.image.height,
      frame_size: spec.target_size,
    },
    actions: actions.map((action, index) => {
      const preview = previews[index]
      const start = cursor
      cursor += action.frames.length
      return {
        name: preview.name,
        label: preview.label ?? preview.name,
        file: `inspection_gifs/${preview.fileName}`,
        strip_file: `inspection_strips/${fileBase(preview.fileName)}.png`,
        runtime_gif_file: preview.fileName,
        fps: preview.fps,
        mode: preview.mode,
        frame_count: action.frames.length,
        crop: action.crop,
        scale: action.scale,
        sheet_frames: action.frames.map((_, frameIndex) => {
          const absolute = start + frameIndex
          return {
            index: absolute,
            x: (absolute % spec.columns) * spec.target_size.w,
            y: Math.floor(absolute / spec.columns) * spec.target_size.h,
            w: spec.target_size.w,
            h: spec.target_size.h,
          }
        }),
      }
    }),
  }
}

export async function buildInspectionPreviewArtifacts({ rowPreviews = [], rowPreviewFrames = [], spec = INSPECTION_PREVIEW_SPEC } = {}) {
  const actions = rowPreviews.map((preview) => {
    const sourceFrames = preview.frames.map((index) => rowPreviewFrames[index]?.image).filter(Boolean)
    const bbox = unionAlphaBBox(sourceFrames)
    const crop = bbox && sourceFrames[0] ? paddedCropBox(bbox, sourceFrames[0], spec.source_padding_px) : null
    const scale = crop ? scaleForCrop(crop, spec) : 1
    return {
      preview,
      crop,
      scale,
      frames: sourceFrames.map((frame) => renderInspectionFrame(frame, crop, scale, spec)),
    }
  })
  const gifBuffers = Object.fromEntries(
    actions.map((action) => [
      `inspection_gifs/${action.preview.fileName}`,
      encodeGifFromRgbaFrames(action.frames, { delay: Math.round(1000 / Math.max(1, action.preview.fps ?? 8)) }),
    ])
  )
  const stripPngBuffers = Object.fromEntries(
    await Promise.all(actions.map(async (action) => [`inspection_strips/${fileBase(action.preview.fileName)}.png`, await encodeStrip(action.frames, spec)]))
  )
  const sheet = await encodeSheet(actions, spec)
  const indexJson = buildIndex({ previews: rowPreviews, actions, sheet, spec })
  const previews = rowPreviews.map((preview, index) => ({
    name: preview.fileName,
    fileName: `inspection_gifs/${preview.fileName}`,
    runtimeFileName: preview.fileName,
    stripFileName: `inspection_strips/${fileBase(preview.fileName)}.png`,
    animation: preview.name,
    label: preview.label ?? preview.name,
    frame_count: actions[index]?.frames.length ?? 0,
    frame_size: spec.target_size,
    fps: preview.fps,
    mode: preview.mode,
  }))
  const report = {
    mode: spec.mode,
    target_size: spec.target_size,
    placement: spec.placement,
    scale_mode: spec.scale_mode,
    source_crop: spec.source_crop,
    columns: spec.columns,
    action_count: rowPreviews.length,
    frame_count: actions.reduce((sum, action) => sum + action.frames.length, 0),
    actions: indexJson.actions.map(({ name, label, frame_count, crop, scale }) => ({ name, label, frame_count, crop, scale })),
  }
  return {
    spec,
    report,
    previews,
    gifBuffers,
    stripPngBuffers,
    sheetPng: sheet.png,
    indexJson,
  }
}
