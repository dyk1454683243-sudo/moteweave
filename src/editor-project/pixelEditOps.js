import { isNonNegativeInteger, isPositiveInteger } from './safety.js'
import { SPRITE_DOCUMENT_LIMITS } from './constants.js'
import { createPixelStroke, createPixelLine, createPixelRectangle, createPixelFill, createPixelText } from './pixelDrawingTools.js'

const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype)
const byteLengthOf = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteLength').get
const bufferOf = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'buffer').get

function reject(message) {
  throw Object.assign(new Error(message), { code: 'invalid_request' })
}

function checkSize(width, height) {
  if (!isPositiveInteger(width) || !isPositiveInteger(height)) reject('canvas size is invalid')
  if (width > SPRITE_DOCUMENT_LIMITS.maxCanvasEdge || height > SPRITE_DOCUMENT_LIMITS.maxCanvasEdge) {
    throw Object.assign(new Error('canvas edge exceeds 4096'), { code: 'resource_limit' })
  }
}

function requireFields(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    reject(`${label} must be an explicit record`)
  }
  const keys = Reflect.ownKeys(value)
  if (keys.length !== fields.length || keys.some((key) => !fields.includes(key))) {
    reject(`${label} fields are invalid`)
  }
  // Only data records are accepted; validation must not execute caller getters.
  if (keys.some((key) => !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'))) {
    reject(`${label} must contain data fields`)
  }
}

function readRect(value, width, height, label) {
  requireFields(value, ['x', 'y', 'w', 'h'], label)
  const { x, y, w, h } = value
  if (!isNonNegativeInteger(x) || !isNonNegativeInteger(y)
    || !isPositiveInteger(w) || !isPositiveInteger(h)
    || x >= width || y >= height || w > width - x || h > height - y) {
    reject(`${label} must be a nonempty rectangle inside the image`)
  }
  return { x, y, w, h }
}

function readColor(value, label) {
  if (!Array.isArray(value) || value.length !== 4) reject(`${label} must be four RGBA8 channels`)
  // Index every channel explicitly so sparse arrays cannot bypass validation.
  const color = []
  for (let index = 0; index < 4; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index)
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) reject(`${label} must contain data channels`)
    const channel = descriptor.value
    if (!isNonNegativeInteger(channel) || channel > 255) reject(`${label} must be four RGBA8 channels`)
    color.push(channel)
  }
  return color
}

function readPoint(point, rect) {
  requireFields(point, ['x', 'y'], 'point')
  if (!isNonNegativeInteger(point.x) || !isNonNegativeInteger(point.y)
    || point.x < rect.x || point.y < rect.y || point.x >= rect.x + rect.w || point.y >= rect.y + rect.h) reject('point exceeds operation.rect')
  return { x: point.x, y: point.y }
}

/**
 * Produce one same-size candidate without modifying the source or a working copy.
 * input: { width, height, rgba: Uint8Array }; allowedRect is supplied by the caller,
 * independently of operation. Both rectangles are required; no clipping is done.
 * Operations (each has rect): replace-color { from, to }, fill-rect { color }, erase.
 * Colors are exact straight-alpha RGBA8 arrays. Fill replaces (never blends);
 * erase clears all four channels. Replacement matches alpha and hidden RGB too.
 * The synchronous call snapshots ordinary owned bytes; shared memory is rejected.
 * No paths, documents, history, persistence, model calls, or implicit application.
 */
export function validatePixelEditOperation(operation, width, height, allowedRect) {
  checkSize(width, height)
  const allowed = readRect(allowedRect, width, height, 'allowedRect')
  // Read type only after checking that it is a data property.
  const type = operation && Object.getOwnPropertyDescriptor(operation, 'type')?.value
  let fields
  if (type === 'replace-color') fields = ['type', 'rect', 'from', 'to']
  else if (type === 'fill-rect') fields = ['type', 'rect', 'color']
  else if (type === 'erase') fields = ['type', 'rect']
  else if (type === 'pencil') fields = ['type', 'rect', 'points', 'color']
  else if (type === 'eraser') fields = ['type', 'rect', 'points']
  else if (type === 'line' || type === 'rectangle') fields = ['type', 'rect', 'start', 'end', 'color']
  else if (type === 'flood-fill') fields = ['type', 'rect', 'seed', 'color']
  else if (type === 'text') fields = ['type', 'rect', 'at', 'text', 'size', 'color']
  else reject('pixel operation is unsupported')
  requireFields(operation, fields, 'operation')
  const rect = readRect(operation.rect, width, height, 'operation.rect')
  if (rect.x < allowed.x || rect.y < allowed.y
    || rect.x + rect.w > allowed.x + allowed.w || rect.y + rect.h > allowed.y + allowed.h) {
    reject('operation.rect exceeds allowedRect')
  }
  if (['pencil', 'eraser'].includes(type)) {
    if (!Array.isArray(operation.points) || !operation.points.length || operation.points.length > 2048) reject('use 1 to 2048 stroke points')
    const points = []
    for (let i = 0; i < operation.points.length; i++) {
      const field = Object.getOwnPropertyDescriptor(operation.points, i)
      if (!field || !Object.hasOwn(field, 'value')) reject('points must contain data entries')
      points.push(readPoint(field.value, rect))
    }
    return { type, rect, points, ...(type === 'pencil' ? { color: readColor(operation.color, 'color') } : {}) }
  }
  if (type === 'line' || type === 'rectangle') return { type, rect, start: readPoint(operation.start, rect), end: readPoint(operation.end, rect), color: readColor(operation.color, 'color') }
  if (type === 'flood-fill') return { type, rect, seed: readPoint(operation.seed, rect), color: readColor(operation.color, 'color') }
  if (type === 'text') {
    if (typeof operation.text !== 'string' || operation.text.length > 160 || !operation.text.trim()
      || operation.text.replace(/\r\n?/g, '\n').split('\n').length > 4
      || !Number.isInteger(operation.size) || operation.size < 6 || operation.size > 96) reject('invalid text or pixel size')
    return { type, rect, at: readPoint(operation.at, rect), text: operation.text, size: operation.size, color: readColor(operation.color, 'color') }
  }
  const from = type === 'replace-color' ? readColor(operation.from, 'from') : null
  const to = type === 'replace-color' ? readColor(operation.to, 'to')
    : type === 'fill-rect' ? readColor(operation.color, 'color') : [0, 0, 0, 0]
  return { type, rect, ...(type === 'replace-color' ? { from, to } : type === 'fill-rect' ? { color: to } : {}) }
}

export function createPixelEditCandidate(input, operation, allowedRect, { makeCanvas } = {}) {
  requireFields(input, ['width', 'height', 'rgba'], 'input')
  const { width, height, rgba } = input
  checkSize(width, height)
  if (!(rgba instanceof Uint8Array) || Object.hasOwn(rgba, 'byteLength') || Object.hasOwn(rgba, 'buffer')) {
    reject('rgba must be RGBA8 bytes without shadowed metadata')
  }
  const byteLength = byteLengthOf.call(rgba)
  const buffer = bufferOf.call(rgba)
  if (byteLength !== width * height * 4
    || (typeof SharedArrayBuffer !== 'undefined' && buffer instanceof SharedArrayBuffer)) {
    reject('rgba must be non-shared RGBA8 bytes matching the image size')
  }
  const checked = validatePixelEditOperation(operation, width, height, allowedRect)
  const { rect, from } = checked
  let drawing
  if (checked.type === 'pencil' || checked.type === 'eraser') {
    drawing = createPixelStroke(input, checked.color || [0, 0, 0, 0]); checked.points.forEach(point => drawing.point(point))
  } else if (checked.type === 'line' || checked.type === 'rectangle') {
    drawing = (checked.type === 'line' ? createPixelLine : createPixelRectangle)(input, checked.color, checked.start); drawing.point(checked.end)
  } else if (checked.type === 'flood-fill') drawing = createPixelFill(input, checked.color, checked.seed, rect)
  else if (checked.type === 'text') {
    drawing = createPixelText(input, checked.color, checked.at, checked.text, checked.size, makeCanvas)
    // Font metrics differ per device. Never silently clip a model's text proposal.
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (x >= rect.x && y >= rect.y && x < rect.x + rect.w && y < rect.y + rect.h) continue
      const offset = (y * width + x) * 4
      for (let c = 0; c < 4; c++) if (drawing.bytes[offset + c] !== rgba[offset + c]) reject('text exceeds operation.rect')
    }
  }
  if (drawing) return { width, height, rgba: drawing.bytes }
  const to = checked.type === 'replace-color' ? checked.to : checked.type === 'fill-rect' ? checked.color : [0, 0, 0, 0]
  // All validation happens before allocating the one candidate (at most 4 MiB).
  const pixels = new Uint8Array(rgba)
  for (let y = rect.y; y < rect.y + rect.h; y += 1) {
    for (let x = rect.x; x < rect.x + rect.w; x += 1) {
      const offset = (y * width + x) * 4
      if (from && from.some((channel, index) => pixels[offset + index] !== channel)) continue
      pixels.set(to, offset)
    }
  }
  return { width, height, rgba: pixels }
}
