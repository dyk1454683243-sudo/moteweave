import { SPRITE_DOCUMENT_LIMITS } from './constants.js'
import { isNonNegativeInteger, isPositiveInteger } from './safety.js'
import { assertDocumentLimits, sha256Bytes, spriteDocumentError } from './spriteDocumentValidation.js'

export const PIXEL_WORKING_COPY_LIMITS = Object.freeze({
  maxEdge: SPRITE_DOCUMENT_LIMITS.maxCanvasEdge,
  maxHistorySteps: 100,
  maxHistoryBytes: 64 * 1024 * 1024,
})

const states = new WeakMap()

function reject(code, message, details) {
  throw spriteDocumentError(code, message, details)
}

function asRgba(value, expectedLength, label) {
  if (typeof value === 'string') {
    reject('invalid_request', `${label} must be explicit RGBA bytes, not a path`)
  }
  if (!(value instanceof Uint8Array) || value.byteLength !== expectedLength) {
    reject('invalid_request', `${label} length does not match the RGBA8 size`, {
      expected: expectedLength,
      bytes: value instanceof Uint8Array ? value.byteLength : null,
    })
  }
  return value
}

function readSize(width, height, rgba) {
  assertDocumentLimits({
    canvas: { w: width, h: height },
    frame_order: ['frame_1'],
    layer_order: ['layer_1'],
    cels: { cel_1: { block: { w: width, h: height } } },
  })
  const expected = width * height * 4
  return { width, height, rgba: asRgba(rgba, expected, 'rgba') }
}

function readCel(cel) {
  const width = cel?.block?.w
  const height = cel?.block?.h
  const rgba = cel?.rgba ?? cel?.bytes
  const read = readSize(width, height, rgba)
  if (cel?.block?.sha256 != null && sha256Bytes(read.rgba) !== cel.block.sha256) {
    reject('artifact_integrity_failed', 'cel block bytes do not match sha256')
  }
  return read
}

function readExplicit(input) {
  if (typeof input === 'string' || !input || typeof input !== 'object' || Array.isArray(input)) {
    reject('invalid_request', 'pixel working copy requires explicit RGBA or one cel')
  }
  if (input.frame_order != null && (!Array.isArray(input.frame_order) || input.frame_order.length !== 1)) {
    reject('unsupported_input', 'pixel working copy accepts one frame only')
  }
  if (input.layer_order != null && (!Array.isArray(input.layer_order) || input.layer_order.length !== 1)) {
    reject('unsupported_input', 'pixel working copy accepts one layer only')
  }
  if (input.cels != null) {
    const cels = Object.values(input.cels)
    if (cels.length !== 1) reject('unsupported_input', 'pixel working copy accepts one cel only')
    return readCel(cels[0])
  }
  if (input.block) return readCel(input)
  return readSize(input.width, input.height, input.rgba ?? input.bytes)
}

function stateOf(copy) {
  const state = states.get(copy)
  if (!state) reject('invalid_request', 'pixel working copy is not recognized')
  return state
}

function rectOf(rect) {
  if (!rect || typeof rect !== 'object') reject('invalid_request', 'rectangle is required')
  const { x, y, w, h } = rect
  if (!isNonNegativeInteger(x) || !isNonNegativeInteger(y) || !isPositiveInteger(w) || !isPositiveInteger(h)) {
    reject('invalid_request', 'rectangle is invalid')
  }
  return { x, y, w, h }
}

function assertInside(state, rect) {
  if (rect.x + rect.w > state.width || rect.y + rect.h > state.height) {
    reject('invalid_request', 'rectangle is outside the working copy', {
      width: state.width,
      height: state.height,
    })
  }
}

function rowBytes(rect) {
  return rect.w * 4
}

function copyRect(from, fromWidth, rect, into) {
  const span = rowBytes(rect)
  for (let row = 0; row < rect.h; row += 1) {
    const offset = ((rect.y + row) * fromWidth + rect.x) * 4
    into.set(from.subarray(offset, offset + span), row * span)
  }
}

function writeRect(into, intoWidth, rect, from) {
  const span = rowBytes(rect)
  for (let row = 0; row < rect.h; row += 1) {
    const offset = ((rect.y + row) * intoWidth + rect.x) * 4
    into.set(from.subarray(row * span, row * span + span), offset)
  }
}

function swapRect(state, entry) {
  const span = rowBytes(entry)
  const stored = entry.bytes
  for (let row = 0; row < entry.h; row += 1) {
    const offset = ((entry.y + row) * state.width + entry.x) * 4
    for (let index = 0; index < span; index += 1) {
      const storedIndex = row * span + index
      const current = state.pixels[offset + index]
      state.pixels[offset + index] = stored[storedIndex]
      stored[storedIndex] = current
    }
  }
}

export function createPixelWorkingCopy(input) {
  const { width, height, rgba } = readExplicit(input)
  const copy = {
    width,
    height,
    pixels() {
      return new Uint8Array(stateOf(copy).pixels)
    },
  }
  states.set(copy, {
    width,
    height,
    pixels: new Uint8Array(rgba),
    past: [],
    future: [],
  })
  return copy
}

export function modifyPixelWorkingCopy(copy, rectInput, rgba) {
  const state = stateOf(copy)
  const rect = rectOf(rectInput)
  assertInside(state, rect)
  const deltaBytes = rect.w * rect.h * 4
  const patch = asRgba(rgba, deltaBytes, 'patch')
  const pastBytes = state.past.reduce((total, entry) => total + entry.bytes.byteLength, 0)
  if (state.past.length + 1 > PIXEL_WORKING_COPY_LIMITS.maxHistorySteps) {
    reject('resource_limit', 'pixel history exceeds 100 steps', {
      limit: PIXEL_WORKING_COPY_LIMITS.maxHistorySteps,
      steps: state.past.length + 1,
    })
  }
  if (pastBytes + deltaBytes > PIXEL_WORKING_COPY_LIMITS.maxHistoryBytes) {
    reject('resource_limit', 'pixel history exceeds 64MiB', {
      limit: PIXEL_WORKING_COPY_LIMITS.maxHistoryBytes,
      bytes: pastBytes + deltaBytes,
    })
  }
  const previous = new Uint8Array(deltaBytes)
  copyRect(state.pixels, state.width, rect, previous)
  writeRect(state.pixels, state.width, rect, patch)
  state.past.push({ ...rect, bytes: previous })
  state.future = []
  return copy
}

export function undoPixelWorkingCopy(copy) {
  const state = stateOf(copy)
  const entry = state.past.pop()
  if (!entry) return copy
  swapRect(state, entry)
  state.future.push(entry)
  return copy
}

export function redoPixelWorkingCopy(copy) {
  const state = stateOf(copy)
  const entry = state.future.pop()
  if (!entry) return copy
  swapRect(state, entry)
  state.past.push(entry)
  return copy
}
