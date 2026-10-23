import { pixelRectInside } from './pixelDocumentTarget.js'

// Rectangular selection edits on one RGBA8 cel. Inputs are never mutated.
// A placed block keeps exact RGBA; its fully transparent pixels leave the
// destination unchanged (no blending, no new colors).
function sizeBounds(size) {
  const { width, height } = size || {}
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 4096 || height > 4096) throw new Error('Unsupported pixel buffer.')
  return { x: 0, y: 0, w: width, h: height }
}

function bounds(source) {
  const box = sizeBounds(source)
  if (!(source.rgba instanceof Uint8Array) || source.rgba.length !== box.w * box.h * 4) throw new Error('Unsupported pixel buffer.')
  return box
}

function checkedRect(source, rect) {
  if (!pixelRectInside(rect, bounds(source))) throw new Error('The selection must be inside the image.')
  return { x: rect.x, y: rect.y, w: rect.w, h: rect.h }
}

function candidate(source, into) {
  const bytes = into instanceof Uint8Array && into.length === source.rgba.length && into !== source.rgba
    ? into : new Uint8Array(source.rgba.length)
  bytes.set(source.rgba)
  return bytes
}

function changedInside(bytes, source, rect) {
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let i = (y * source.width + rect.x) * 4, end = i + rect.w * 4; i < end; i++) if (bytes[i] !== source.rgba[i]) return true
  }
  return false
}

function placeBlock(bytes, width, block, at) {
  for (let y = 0; y < block.height; y++) {
    for (let x = 0; x < block.width; x++) {
      const from = (y * block.width + x) * 4
      if (block.rgba[from + 3] === 0) continue
      bytes.set(block.rgba.subarray(from, from + 4), ((at.y + y) * width + at.x + x) * 4)
    }
  }
}

export function pixelPointInRect(point, rect) {
  return Boolean(point && rect) && point.x >= rect.x && point.y >= rect.y && point.x < rect.x + rect.w && point.y < rect.y + rect.h
}

export function pixelUnionRect(a, b) {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y)
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }
}

export function extractPixelBlock(source, rect) {
  const r = checkedRect(source, rect), rgba = new Uint8Array(r.w * r.h * 4)
  for (let row = 0; row < r.h; row++) {
    const start = ((r.y + row) * source.width + r.x) * 4
    rgba.set(source.rgba.subarray(start, start + r.w * 4), row * r.w * 4)
  }
  return { width: r.w, height: r.h, rgba, origin: { x: r.x, y: r.y } }
}

// Whole-pixel position that keeps a block fully inside an image of this {width, height}.
export function clampPixelBlockPosition(size, block, at) {
  const { w, h } = sizeBounds(size)
  if (!Number.isInteger(block?.width) || !Number.isInteger(block?.height) || block.width < 1 || block.height < 1
    || block.width > w || block.height > h) throw new Error('The copied pixels are larger than this image.')
  const x = Number.isFinite(at?.x) ? Math.round(at.x) : 0, y = Number.isFinite(at?.y) ? Math.round(at.y) : 0
  return { x: Math.max(0, Math.min(w - block.width, x)), y: Math.max(0, Math.min(h - block.height, y)) }
}

export function clampPixelMove(size, rect, offset) {
  if (!pixelRectInside(rect, sizeBounds(size))) throw new Error('The selection must be inside the image.')
  const at = clampPixelBlockPosition(size, { width: rect.w, height: rect.h }, { x: rect.x + (offset?.x || 0), y: rect.y + (offset?.y || 0) })
  return { x: at.x - rect.x, y: at.y - rect.y }
}

export function deletePixelRect(source, rect, into) {
  const r = checkedRect(source, rect), bytes = candidate(source, into)
  for (let y = r.y; y < r.y + r.h; y++) bytes.fill(0, (y * source.width + r.x) * 4, (y * source.width + r.x + r.w) * 4)
  return { bytes, changed: changedInside(bytes, source, r), rect: r, writeRect: r }
}

export function flipPixelRect(source, rect, axis, into) {
  if (axis !== 'horizontal' && axis !== 'vertical') throw new Error('Choose a horizontal or vertical flip.')
  const r = checkedRect(source, rect), bytes = candidate(source, into)
  for (let y = 0; y < r.h; y++) {
    for (let x = 0; x < r.w; x++) {
      const fromX = axis === 'horizontal' ? r.w - 1 - x : x, fromY = axis === 'vertical' ? r.h - 1 - y : y
      const from = ((r.y + fromY) * source.width + r.x + fromX) * 4
      bytes.set(source.rgba.subarray(from, from + 4), ((r.y + y) * source.width + r.x + x) * 4)
    }
  }
  return { bytes, changed: changedInside(bytes, source, r), rect: r, writeRect: r }
}

// Lifting leaves fully transparent pixels behind; the block lands at rect + offset.
export function movePixelRect(source, rect, offset, into) {
  const r = checkedRect(source, rect), dx = offset?.x, dy = offset?.y
  if (!Number.isInteger(dx) || !Number.isInteger(dy)) throw new Error('Move by whole pixels.')
  const dest = { x: r.x + dx, y: r.y + dy, w: r.w, h: r.h }
  if (!pixelRectInside(dest, bounds(source))) throw new Error('The moved pixels must stay inside the image.')
  const block = extractPixelBlock(source, r), bytes = candidate(source, into)
  for (let y = r.y; y < r.y + r.h; y++) bytes.fill(0, (y * source.width + r.x) * 4, (y * source.width + r.x + r.w) * 4)
  placeBlock(bytes, source.width, block, dest)
  const writeRect = pixelUnionRect(r, dest)
  return { bytes, changed: changedInside(bytes, source, writeRect), rect: dest, writeRect }
}

export function pastePixelBlock(source, block, at, into) {
  if (!(block?.rgba instanceof Uint8Array) || block.rgba.length !== block.width * block.height * 4) throw new Error('Copy a selection before pasting.')
  const dest = { x: at?.x, y: at?.y, w: block.width, h: block.height }
  if (!pixelRectInside(dest, bounds(source))) throw new Error('The pasted pixels must stay inside the image.')
  const bytes = candidate(source, into)
  placeBlock(bytes, source.width, block, dest)
  return { bytes, changed: changedInside(bytes, source, dest), rect: dest, writeRect: dest }
}
