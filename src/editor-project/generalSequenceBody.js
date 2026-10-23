export const GENERAL_SEQUENCE_MAGIC = Object.freeze([0x47, 0x54, 0x41, 0x53])
export const GENERAL_SEQUENCE_MAX_FRAMES = 256
export const GENERAL_SEQUENCE_MAX_FRAME_BYTES = 32 * 1024 * 1024
export const GENERAL_SEQUENCE_MAX_GROUP_BYTES = 64 * 1024 * 1024
export const GENERAL_SEQUENCE_MAX_MASK_BYTES = Math.ceil((4096 * 4096) / 8)
export const GENERAL_SEQUENCE_MAX_DELTA = 2048
export const GENERAL_SEQUENCE_MAX_PACKAGE_OVERHEAD_BYTES = 7 + GENERAL_SEQUENCE_MAX_FRAMES * (4 + 1 + (2 + GENERAL_SEQUENCE_MAX_DELTA * 4) + (2 + GENERAL_SEQUENCE_MAX_DELTA * 4))
export const GENERAL_SEQUENCE_MAX_BODY_BYTES = GENERAL_SEQUENCE_MAX_GROUP_BYTES + GENERAL_SEQUENCE_MAX_PACKAGE_OVERHEAD_BYTES
export const GENERAL_SEQUENCE_MAX_EXPANDED_RGBA_BYTES = 128 * 1024 * 1024
export const SEQUENCE_FRAME_LIMIT_MESSAGE = 'Each sequence image must be a PNG or JPEG of 32 MiB or less.'
export const SEQUENCE_GROUP_LIMIT_MESSAGE = 'Sequence batch images must total 64 MiB or less.'
export const SEQUENCE_BODY_LIMIT_MESSAGE = 'Sequence upload exceeds 64 MiB of images plus package overhead.'
export const SEQUENCE_EXPANDED_LIMIT_MESSAGE = 'Sequence canvas dimensions exceed the 128 MiB uncompressed RGBA budget.'

function fail(message, code = 'invalid_request') {
  const error = new Error(message)
  error.code = code
  throw error
}

export function assertSequencePreviewBudget(frameCount, maxWidth, maxHeight, maxExpandedBytes = GENERAL_SEQUENCE_MAX_EXPANDED_RGBA_BYTES) {
  const limit = Number.isInteger(maxExpandedBytes) && maxExpandedBytes > 0 ? maxExpandedBytes : GENERAL_SEQUENCE_MAX_EXPANDED_RGBA_BYTES
  if (!Number.isSafeInteger(frameCount) || frameCount < 1 || frameCount > GENERAL_SEQUENCE_MAX_FRAMES) {
    fail(`A general sequence needs 1 to ${GENERAL_SEQUENCE_MAX_FRAMES} images.`)
  }
  const w = Math.max(0, Number(maxWidth) || 0)
  const h = Math.max(0, Number(maxHeight) || 0)
  const expandedRgbaBytes = frameCount * w * h * 4
  if (expandedRgbaBytes > limit) {
    fail(SEQUENCE_EXPANDED_LIMIT_MESSAGE, 'resource_limit')
  }
  return { frameCount, maxWidth: w, maxHeight: h, expandedRgbaBytes }
}

function concat(parts) {
  const length = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function viewAt(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

export function classifySequenceImage(bytes) {
  const input = bytes instanceof Uint8Array ? bytes : null
  if (!input || input.length < 3) return null
  if (input.length >= 8 && input[0] === 0x89 && input[1] === 0x50 && input[2] === 0x4e && input[3] === 0x47
    && input[4] === 0x0d && input[5] === 0x0a && input[6] === 0x1a && input[7] === 0x0a) return 'png'
  if (input[0] === 0xff && input[1] === 0xd8 && input[2] === 0xff) return 'jpeg'
  return null
}

export function sequenceDisplayScale(width, height) {
  const edge = Math.max(width || 1, height || 1)
  if (edge <= 32) return 8
  if (edge <= 64) return 4
  if (edge <= 128) return 3
  if (edge <= 256) return 2
  return 1
}

function sourceByteLength(item) {
  if (Number.isSafeInteger(item?.size)) return item.size
  if (item?.bytes instanceof Uint8Array) return item.bytes.length
  if (Number.isSafeInteger(item?.handle?.size)) return item.handle.size
  if (item?.handle?.bytes instanceof Uint8Array) return item.handle.bytes.length
  return null
}

export function assertSequenceSourceSizes(items, { allowBatching = false } = {}) {
  if (!Array.isArray(items) || items.length < 1 || items.length > GENERAL_SEQUENCE_MAX_FRAMES) {
    fail(`A general sequence needs 1 to ${GENERAL_SEQUENCE_MAX_FRAMES} images.`)
  }
  let total = 0
  for (const item of items) {
    const size = sourceByteLength(item)
    if (size == null) continue
    if (size <= 0 || size > GENERAL_SEQUENCE_MAX_FRAME_BYTES) fail(SEQUENCE_FRAME_LIMIT_MESSAGE, 'resource_limit')
    total += size
    if (!allowBatching && total > GENERAL_SEQUENCE_MAX_GROUP_BYTES) fail(SEQUENCE_GROUP_LIMIT_MESSAGE, 'resource_limit')
  }
}

export function prepareSequenceSourceHandles(items, { allowBatching = true, maxGroupBytes = GENERAL_SEQUENCE_MAX_GROUP_BYTES } = {}) {
  assertSequenceSourceSizes(items, { allowBatching })
  return items.map((item) => {
    const hasArrayBuffer = typeof item?.arrayBuffer === 'function'
    const bytes = item?.bytes instanceof Uint8Array ? item.bytes : null
    const size = Number.isSafeInteger(item?.size) ? item.size : (bytes ? bytes.length : null)
    if (size != null && (size <= 0 || size > GENERAL_SEQUENCE_MAX_FRAME_BYTES || size > maxGroupBytes)) {
      fail(SEQUENCE_FRAME_LIMIT_MESSAGE, 'resource_limit')
    }
    return {
      name: typeof item?.name === 'string' ? item.name : '',
      size,
      file: hasArrayBuffer ? item : (typeof item?.file?.arrayBuffer === 'function' ? item.file : null),
      bytes,
    }
  })
}

export function partitionSequenceSourceBatches(items, options = {}) {
  const maxGroupBytes = typeof options === 'number'
    ? options
    : (options?.maxGroupBytes ?? GENERAL_SEQUENCE_MAX_GROUP_BYTES)
  assertSequenceSourceSizes(items, { allowBatching: true })
  const batches = []
  let current = []
  let currentBytes = 0
  for (const item of items) {
    const size = sourceByteLength(item) ?? 0
    if (size > maxGroupBytes) fail(SEQUENCE_FRAME_LIMIT_MESSAGE, 'resource_limit')
    if (current.length > 0 && currentBytes + size > maxGroupBytes) {
      batches.push(current)
      current = []
      currentBytes = 0
    }
    current.push(item)
    currentBytes += size
  }
  if (current.length > 0) batches.push(current)
  return batches
}

export async function readSequenceHandleBatch(handles, token, isCurrent, { onProgress, progressOffset = 0, totalCount = null } = {}) {
  if (!Array.isArray(handles) || typeof isCurrent !== 'function' || !isCurrent(token)) return null
  const total = totalCount ?? handles.length
  const out = []
  for (let index = 0; index < handles.length; index += 1) {
    if (!isCurrent(token)) return null
    const current = progressOffset + index + 1
    onProgress?.({ stage: 'reading', current, total }, current, total)
    const entry = handles[index]
    const handle = entry?.handle || entry
    let bytes = handle?.bytes instanceof Uint8Array ? handle.bytes : null
    if (!bytes) {
      if (typeof handle?.file?.arrayBuffer === 'function') {
        bytes = new Uint8Array(await handle.file.arrayBuffer())
      } else if (typeof handle?.arrayBuffer === 'function') {
        bytes = new Uint8Array(await handle.arrayBuffer())
      } else {
        fail('Sequence image could not be read.')
      }
    }
    if (!isCurrent(token)) return null
    if (bytes.length === 0 || bytes.length > GENERAL_SEQUENCE_MAX_FRAME_BYTES) {
      fail(SEQUENCE_FRAME_LIMIT_MESSAGE, 'resource_limit')
    }
    if (!classifySequenceImage(bytes)) {
      fail('Only PNG or JPEG files can be imported.', 'unsupported_input')
    }
    out.push({
      ...entry,
      bytes,
      size: bytes.length,
    })
  }
  return isCurrent(token) ? out : null
}

export async function readSequenceSources(files, token, isCurrent, { onProgress, allowBatching = true } = {}) {
  if (!Array.isArray(files) || typeof isCurrent !== 'function' || !isCurrent(token)) return null
  assertSequenceSourceSizes(files, { allowBatching })
  const sources = []
  for (let index = 0; index < files.length; index += 1) {
    if (!isCurrent(token)) return null
    const current = index + 1
    onProgress?.({ stage: 'reading', current, total: files.length }, current, files.length)
    const bytes = files[index]?.bytes instanceof Uint8Array
      ? files[index].bytes
      : new Uint8Array(await files[index].arrayBuffer())
    if (!isCurrent(token)) return null
    if (bytes.length === 0 || bytes.length > GENERAL_SEQUENCE_MAX_FRAME_BYTES) {
      fail(SEQUENCE_FRAME_LIMIT_MESSAGE, 'resource_limit')
    }
    sources.push({ bytes, size: bytes.length })
  }
  return isCurrent(token) ? sources : null
}

export function packBitMask(width, height, cells) {
  const total = width * height
  const bytes = new Uint8Array(Math.ceil(total / 8))
  if (cells instanceof Uint8Array) {
    if (cells.length === total) {
      for (let index = 0; index < total; index += 1) {
        if (cells[index]) bytes[index >> 3] |= 1 << (index & 7)
      }
      return bytes
    }
    if (cells.length === bytes.length) {
      bytes.set(cells)
      return bytes
    }
  }
  for (const [x, y] of cells || []) {
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y) || x < 0 || y < 0 || x >= width || y >= height) continue
    const index = y * width + x
    bytes[index >> 3] |= 1 << (index & 7)
  }
  return bytes
}

export function bitMaskHas(bytes, width, x, y) {
  const index = y * width + x
  return Boolean(bytes[index >> 3] & (1 << (index & 7)))
}

export function toggleBitMask(bytes, width, x, y) {
  const index = y * width + x
  bytes[index >> 3] ^= 1 << (index & 7)
}

function cellKey(x, y) {
  return `${x},${y}`
}

function parseCell(key) {
  const [x, y] = key.split(',').map(Number)
  return [x, y]
}

export function maskSelectionFromBitMasks(proposalBytes, selectedBytes, width, height) {
  const expectedLength = Math.ceil((width * height) / 8)
  if (!(proposalBytes instanceof Uint8Array) || !(selectedBytes instanceof Uint8Array)
    || proposalBytes.length !== expectedLength || selectedBytes.length !== expectedLength) {
    fail('Sequence selection mask does not match frame dimensions.')
  }
  let identical = true
  for (let i = 0; i < expectedLength; i += 1) {
    if (proposalBytes[i] !== selectedBytes[i]) {
      identical = false
      break
    }
  }
  if (identical) return { mode: 'proposal', removed: [], added: [] }
  const removed = []
  const added = []
  const total = width * height
  for (let index = 0; index < total; index += 1) {
    const pBit = Boolean(proposalBytes[index >> 3] & (1 << (index & 7)))
    const sBit = Boolean(selectedBytes[index >> 3] & (1 << (index & 7)))
    if (pBit === sBit) continue
    const x = index % width
    const y = (index - x) / width
    if (pBit && !sBit) removed.push([x, y])
    else added.push([x, y])
    if (removed.length > GENERAL_SEQUENCE_MAX_DELTA || added.length > GENERAL_SEQUENCE_MAX_DELTA) {
      return { mode: 'mask', mask: selectedBytes.slice() }
    }
  }
  return { mode: 'delta', removed, added }
}

export function maskDelta(proposal, selected, { width = 0, height = 0 } = {}) {
  if (proposal instanceof Uint8Array && selected instanceof Uint8Array && width > 0 && height > 0) {
    return maskSelectionFromBitMasks(proposal, selected, width, height)
  }
  const proposed = new Set((proposal || []).map(([x, y]) => cellKey(x, y)))
  const current = new Set((selected || []).map(([x, y]) => cellKey(x, y)))
  const removed = []
  const added = []
  for (const key of proposed) if (!current.has(key)) removed.push(parseCell(key))
  for (const key of current) if (!proposed.has(key)) added.push(parseCell(key))
  if (!removed.length && !added.length) return { mode: 'proposal', removed: [], added: [] }
  if (removed.length > GENERAL_SEQUENCE_MAX_DELTA || added.length > GENERAL_SEQUENCE_MAX_DELTA) {
    if (width > 0 && height > 0) {
      return { mode: 'mask', mask: packBitMask(width, height, selected) }
    }
    fail('Too many manual cell changes for coordinate delta without frame dimensions.', 'resource_limit')
  }
  return { mode: 'delta', removed, added }
}

function writeCells(cells) {
  const bytes = new Uint8Array(2 + cells.length * 4)
  const view = viewAt(bytes)
  view.setUint16(0, cells.length, false)
  cells.forEach(([x, y], index) => {
    view.setUint16(2 + index * 4, x, false)
    view.setUint16(4 + index * 4, y, false)
  })
  return bytes
}

function readCells(view, offset, count, width, height) {
  const cells = []
  for (let index = 0; index < count; index += 1) {
    const x = view.getUint16(offset + index * 4, false)
    const y = view.getUint16(offset + 2 + index * 4, false)
    if (width && height && (x >= width || y >= height)) fail('A background cell is outside the recovered image.')
    cells.push([x, y])
  }
  return cells
}

function selectionBytes(frame) {
  const mode = frame.selection?.mode || 'proposal'
  if (mode === 'proposal') return new Uint8Array([0])
  if (mode === 'delta') {
    const removed = frame.selection.removed || []
    const added = frame.selection.added || []
    if (removed.length > GENERAL_SEQUENCE_MAX_DELTA || added.length > GENERAL_SEQUENCE_MAX_DELTA) {
      fail('Too many manual cell changes for delta mode.', 'resource_limit')
    }
    return concat([new Uint8Array([1]), writeCells(removed), writeCells(added)])
  }
  if (mode === 'mask') {
    const mask = frame.selection.mask instanceof Uint8Array ? frame.selection.mask : null
    if (!mask || mask.length < 1 || mask.length > GENERAL_SEQUENCE_MAX_MASK_BYTES) {
      fail('Sequence selection mask is invalid.', mask && mask.length > GENERAL_SEQUENCE_MAX_MASK_BYTES ? 'resource_limit' : 'invalid_request')
    }
    const header = new Uint8Array(5)
    header[0] = 2
    viewAt(header).setUint32(1, mask.length, false)
    return concat([header, mask])
  }
  fail('Sequence selection is invalid.')
}

export function encodeGeneralSequenceBody(frames) {
  if (!Array.isArray(frames) || frames.length < 1 || frames.length > GENERAL_SEQUENCE_MAX_FRAMES) {
    fail(`A general sequence needs 1 to ${GENERAL_SEQUENCE_MAX_FRAMES} images.`)
  }
  assertSequenceSourceSizes(frames)
  const parts = [new Uint8Array(7)]
  const head = viewAt(parts[0])
  GENERAL_SEQUENCE_MAGIC.forEach((value, index) => { parts[0][index] = value })
  parts[0][4] = 2
  head.setUint16(5, frames.length, false)
  for (const frame of frames) {
    const image = frame?.bytes instanceof Uint8Array ? frame.bytes : null
    if (!classifySequenceImage(image)) fail(SEQUENCE_FRAME_LIMIT_MESSAGE)
    const selection = selectionBytes(frame)
    const sizes = new Uint8Array(4)
    viewAt(sizes).setUint32(0, image.length, false)
    parts.push(sizes, image, selection)
  }
  const body = concat(parts)
  if (body.length > GENERAL_SEQUENCE_MAX_BODY_BYTES) fail(SEQUENCE_BODY_LIMIT_MESSAGE, 'resource_limit')
  return body
}

export function decodeGeneralSequenceBody(bytes) {
  const input = bytes instanceof Uint8Array ? bytes : fail('Sequence body is not binary.')
  if (input.length > GENERAL_SEQUENCE_MAX_BODY_BYTES) fail(SEQUENCE_BODY_LIMIT_MESSAGE, 'resource_limit')
  if (input.length < 7 || GENERAL_SEQUENCE_MAGIC.some((value, index) => input[index] !== value) || input[4] !== 2) {
    fail('Sequence body is not a supported frame package.')
  }
  const view = viewAt(input)
  const count = view.getUint16(5, false)
  if (count < 1 || count > GENERAL_SEQUENCE_MAX_FRAMES) fail(`A general sequence needs 1 to ${GENERAL_SEQUENCE_MAX_FRAMES} images.`)
  const frames = []
  let offset = 7
  let imageTotal = 0
  for (let index = 0; index < count; index += 1) {
    if (offset + 4 > input.length) fail('Sequence body ended before a frame.')
    const imageLength = view.getUint32(offset, false)
    offset += 4
    if (imageLength > GENERAL_SEQUENCE_MAX_FRAME_BYTES) fail(SEQUENCE_FRAME_LIMIT_MESSAGE, 'resource_limit')
    imageTotal += imageLength
    if (imageTotal > GENERAL_SEQUENCE_MAX_GROUP_BYTES) fail(SEQUENCE_GROUP_LIMIT_MESSAGE, 'resource_limit')
    if (imageLength < 3 || offset + imageLength >= input.length) fail('Sequence frame length is invalid.')
    const image = input.slice(offset, offset + imageLength)
    offset += imageLength
    if (!classifySequenceImage(image)) fail('Sequence images must be PNG or JPEG.')
    const mode = input[offset]
    offset += 1
    let selection = { mode: 'proposal', removed: [], added: [] }
    if (mode === 1) {
      if (offset + 4 > input.length) fail('Sequence selection is truncated.')
      const removedCount = view.getUint16(offset, false)
      offset += 2
      if (removedCount > GENERAL_SEQUENCE_MAX_DELTA || offset + removedCount * 4 + 2 > input.length) fail('Sequence selection is truncated.')
      const removed = readCells(view, offset, removedCount)
      offset += removedCount * 4
      const addedCount = view.getUint16(offset, false)
      offset += 2
      if (addedCount > GENERAL_SEQUENCE_MAX_DELTA || offset + addedCount * 4 > input.length) fail('Sequence selection is truncated.')
      const added = readCells(view, offset, addedCount)
      offset += addedCount * 4
      selection = { mode: 'delta', removed, added }
    } else if (mode === 2) {
      if (offset + 4 > input.length) fail('Sequence selection is truncated.')
      const maskLength = view.getUint32(offset, false)
      offset += 4
      if (maskLength < 1 || maskLength > GENERAL_SEQUENCE_MAX_MASK_BYTES) {
        fail('Sequence selection mask exceeds limit.', maskLength > GENERAL_SEQUENCE_MAX_MASK_BYTES ? 'resource_limit' : 'invalid_request')
      }
      if (offset + maskLength > input.length) fail('Sequence selection is truncated.')
      const mask = input.slice(offset, offset + maskLength)
      offset += maskLength
      selection = { mode: 'mask', mask }
    } else if (mode !== 0) fail('Sequence selection is invalid.')
    frames.push({ bytes: image, selection })
  }
  if (offset !== input.length) fail('Sequence body has trailing bytes.')
  return frames
}
