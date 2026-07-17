import { pixelOffset } from '../character-pack/imageMath.js'
import { detectAlphaBBox } from '../character-pack/normalizer.js'

export function cellRegionForFrame(frameIndex, profile) {
  const col = frameIndex % profile.grid.columns
  const row = Math.floor(frameIndex / profile.grid.columns)
  return {
    x: col * profile.frame.w,
    y: row * profile.frame.h,
    w: profile.frame.w,
    h: profile.frame.h,
    row,
    col,
  }
}

export function copySheetCell(sheet, frameIndex, profile) {
  const region = cellRegionForFrame(frameIndex, profile)
  const image = {
    width: profile.frame.w,
    height: profile.frame.h,
    data: new Uint8ClampedArray(profile.frame.w * profile.frame.h * 4),
  }
  for (let y = 0; y < profile.frame.h; y += 1) {
    for (let x = 0; x < profile.frame.w; x += 1) {
      const src = pixelOffset(sheet.width, region.x + x, region.y + y)
      const dst = pixelOffset(image.width, x, y)
      image.data[dst] = sheet.data[src]
      image.data[dst + 1] = sheet.data[src + 1]
      image.data[dst + 2] = sheet.data[src + 2]
      image.data[dst + 3] = sheet.data[src + 3]
    }
  }
  return image
}

export function framesFromSheet(sheet, profile) {
  const frameCount = profile.grid.columns * profile.grid.rows
  return Array.from({ length: frameCount }, (_, index) => {
    const image = copySheetCell(sheet, index, profile)
    const bbox = detectAlphaBBox(image)
    return {
      index,
      image,
      normalized_bbox: bbox,
      normalized_anchor: bbox ? { ...profile.anchor } : null,
      source_anchor: null,
      source_bbox: bbox,
      warnings: bbox ? [] : ['empty_frame'],
    }
  })
}
