import { bitMaskHas, classifySequenceImage, GENERAL_SEQUENCE_MAX_FRAMES } from '../editor-project/generalSequenceBody.js'
import { SPRITE_DOCUMENT_LIMITS } from '../editor-project/constants.js'
import { generalAssetBackground } from './generalAssetBackground.js'
import { loadRgba } from './imageCodec.js'
import { prepareSourcePixelRecovery } from './sourcePixelRecovery.js'
import { SOURCE_PIXEL_MAX_PIXELS, SOURCE_PIXEL_RECOVERY_MODE } from './pixelGridSampling.js'

export { GENERAL_ASSET_BACKGROUNDS, generalAssetBackground, generalAssetBackgroundClause } from './generalAssetBackground.js'

const MAX_EDGE = 4096
const BG_MAX_CHANNEL_DIFF = 28
const BG_MAX_L1_DIFF = 64
const BG_MIN_PERIMETER_FRACTION = 0.75
const BG_MIN_EDGE_FRACTION = 0.65

function fail(code, message) {
  const error = new Error(message)
  error.code = code
  throw error
}

function normalizeCells(cells, width, height) {
  if (cells == null) return []
  if (!Array.isArray(cells)) fail('invalid_request', 'Background cell selection must be a list.')
  const out = []
  const seen = new Uint8Array(width * height)
  for (const cell of cells) {
    const x = Array.isArray(cell) ? cell[0] : cell?.x
    const y = Array.isArray(cell) ? cell[1] : cell?.y
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y) || x < 0 || y < 0 || x >= width || y >= height) {
      fail('invalid_request', 'A background cell is outside the recovered image.')
    }
    const index = y * width + x
    if (seen[index]) continue
    seen[index] = 1
    out.push([x, y])
  }
  return out
}

function hasTransparentPixel(data) {
  for (let index = 3; index < data.length; index += 4) {
    if (data[index] !== 255) return true
  }
  return false
}

function withinColorDistance(rgba, offset, color, maxDiff = 0, maxL1 = maxDiff * 3) {
  if (rgba[offset + 3] !== 255) return false
  const dr = Math.abs(rgba[offset] - color.r)
  const dg = Math.abs(rgba[offset + 1] - color.g)
  const db = Math.abs(rgba[offset + 2] - color.b)
  return Math.max(dr, dg, db) <= maxDiff && (dr + dg + db) <= maxL1
}

function medianChannel(values) {
  const sorted = Int16Array.from(values).sort()
  return sorted[sorted.length >> 1]
}

function toHex(r, g, b) {
  return `#${[r, g, b].map((v) => Number(v).toString(16).padStart(2, '0')).join('')}`
}

function classifyRepresentativeColor(rep) {
  const presets = [
    { id: 'green', r: 0, g: 255, b: 0 },
    { id: 'magenta', r: 255, g: 0, b: 255 },
    { id: 'purple', r: 128, g: 0, b: 255 },
    { id: 'white', r: 255, g: 255, b: 255 },
  ]
  for (const preset of presets) {
    const dr = Math.abs(rep.r - preset.r)
    const dg = Math.abs(rep.g - preset.g)
    const db = Math.abs(rep.b - preset.b)
    if (Math.max(dr, dg, db) <= BG_MAX_CHANNEL_DIFF && (dr + dg + db) <= BG_MAX_L1_DIFF) {
      return preset.id
    }
  }
  return 'auto'
}

function floodFillMask(rgba, width, height, color, maxDiff = 0, maxL1 = maxDiff * 3) {
  const total = width * height
  const seen = new Uint8Array(total)
  const queue = new Int32Array(total)
  let head = 0
  let tail = 0
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return
    const index = y * width + x
    if (seen[index] || !withinColorDistance(rgba, index * 4, color, maxDiff, maxL1)) return
    seen[index] = 1
    queue[tail++] = index
  }
  for (let x = 0; x < width; x += 1) {
    push(x, 0)
    push(x, height - 1)
  }
  for (let y = 0; y < height; y += 1) {
    push(0, y)
    push(width - 1, y)
  }
  while (head < tail) {
    const index = queue[head++]
    const x = index % width
    const y = (index - x) / width
    push(x + 1, y)
    push(x - 1, y)
    push(x, y + 1)
    push(x, y - 1)
  }
  return { mask: seen, count: tail }
}

function maskToCells(mask, width, height) {
  const cells = []
  const total = width * height
  for (let index = 0; index < total; index += 1) {
    if (!mask[index]) continue
    const x = index % width
    const y = (index - x) / width
    cells.push([x, y])
  }
  return cells
}

function countMask(mask) {
  let count = 0
  for (let index = 0; index < mask.length; index += 1) {
    if (mask[index]) count += 1
  }
  return count
}

export function detectAutomaticBackground(rgba, width, height) {
  const total = width * height
  const emptyMask = new Uint8Array(total)
  if (width < 3 || height < 3) {
    return {
      mask: emptyMask,
      count: 0,
      status: 'kept_original',
      reason: 'image_too_small_for_auto_background',
      color: null,
      id: 'auto',
    }
  }
  const perimeterIndices = []
  for (let x = 0; x < width; x += 1) perimeterIndices.push(x)
  for (let y = 1; y < height - 1; y += 1) perimeterIndices.push(y * width + (width - 1))
  for (let x = width - 1; x >= 0; x -= 1) perimeterIndices.push((height - 1) * width + x)
  for (let y = height - 2; y >= 1; y -= 1) perimeterIndices.push(y * width)

  const bins = new Int32Array(4096)
  for (const index of perimeterIndices) {
    const offset = index * 4
    if (rgba[offset + 3] !== 255) continue
    const key = ((rgba[offset] >> 4) << 8) | ((rgba[offset + 1] >> 4) << 4) | (rgba[offset + 2] >> 4)
    bins[key] += 1
  }

  let bestBin = -1
  let bestScore = -1
  for (const index of perimeterIndices) {
    const offset = index * 4
    if (rgba[offset + 3] !== 255) continue
    const br = rgba[offset] >> 4
    const bg = rgba[offset + 1] >> 4
    const bb = rgba[offset + 2] >> 4
    const center = (br << 8) | (bg << 4) | bb
    let score = 0
    for (let dr = -1; dr <= 1; dr += 1) {
      const nr = br + dr
      if (nr < 0 || nr > 15) continue
      for (let dg = -1; dg <= 1; dg += 1) {
        const ng = bg + dg
        if (ng < 0 || ng > 15) continue
        for (let db = -1; db <= 1; db += 1) {
          const nb = bb + db
          if (nb < 0 || nb > 15) continue
          score += bins[(nr << 8) | (ng << 4) | nb]
        }
      }
    }
    if (score > bestScore) {
      bestScore = score
      bestBin = center
    }
  }

  if (bestBin < 0) {
    return {
      mask: emptyMask,
      count: 0,
      status: 'kept_original',
      reason: 'complex_or_ambiguous_border',
      color: null,
      id: 'auto',
    }
  }

  const br = (bestBin >> 8) & 15
  const bg = (bestBin >> 4) & 15
  const bb = bestBin & 15
  const seedR = []
  const seedG = []
  const seedB = []
  for (const index of perimeterIndices) {
    const offset = index * 4
    if (rgba[offset + 3] !== 255) continue
    if (Math.abs((rgba[offset] >> 4) - br) <= 1
      && Math.abs((rgba[offset + 1] >> 4) - bg) <= 1
      && Math.abs((rgba[offset + 2] >> 4) - bb) <= 1) {
      seedR.push(rgba[offset])
      seedG.push(rgba[offset + 1])
      seedB.push(rgba[offset + 2])
    }
  }

  const initialSeed = {
    r: medianChannel(seedR),
    g: medianChannel(seedG),
    b: medianChannel(seedB),
  }

  const clusterR = []
  const clusterG = []
  const clusterB = []
  for (const index of perimeterIndices) {
    const offset = index * 4
    if (withinColorDistance(rgba, offset, initialSeed, BG_MAX_CHANNEL_DIFF, BG_MAX_L1_DIFF)) {
      clusterR.push(rgba[offset])
      clusterG.push(rgba[offset + 1])
      clusterB.push(rgba[offset + 2])
    }
  }

  if (!clusterR.length) {
    return {
      mask: emptyMask,
      count: 0,
      status: 'kept_original',
      reason: 'complex_or_ambiguous_border',
      color: null,
      id: 'auto',
    }
  }

  const rep = {
    r: medianChannel(clusterR),
    g: medianChannel(clusterG),
    b: medianChannel(clusterB),
  }
  rep.hex = toHex(rep.r, rep.g, rep.b)

  let matchedPerimeter = 0
  for (const index of perimeterIndices) {
    if (withinColorDistance(rgba, index * 4, rep, BG_MAX_CHANNEL_DIFF, BG_MAX_L1_DIFF)) {
      matchedPerimeter += 1
    }
  }
  const perimeterFraction = matchedPerimeter / perimeterIndices.length

  let topMatched = 0
  let bottomMatched = 0
  let leftMatched = 0
  let rightMatched = 0
  for (let x = 0; x < width; x += 1) {
    if (withinColorDistance(rgba, x * 4, rep, BG_MAX_CHANNEL_DIFF, BG_MAX_L1_DIFF)) topMatched += 1
    if (withinColorDistance(rgba, ((height - 1) * width + x) * 4, rep, BG_MAX_CHANNEL_DIFF, BG_MAX_L1_DIFF)) bottomMatched += 1
  }
  for (let y = 0; y < height; y += 1) {
    if (withinColorDistance(rgba, (y * width) * 4, rep, BG_MAX_CHANNEL_DIFF, BG_MAX_L1_DIFF)) leftMatched += 1
    if (withinColorDistance(rgba, (y * width + (width - 1)) * 4, rep, BG_MAX_CHANNEL_DIFF, BG_MAX_L1_DIFF)) rightMatched += 1
  }

  const minEdgeFraction = Math.min(
    topMatched / width,
    bottomMatched / width,
    leftMatched / height,
    rightMatched / height,
  )

  if (perimeterFraction < BG_MIN_PERIMETER_FRACTION) {
    return {
      mask: emptyMask,
      count: 0,
      status: 'kept_original',
      reason: 'complex_or_ambiguous_border',
      color: rep,
      id: 'auto',
    }
  }
  if (minEdgeFraction < BG_MIN_EDGE_FRACTION) {
    return {
      mask: emptyMask,
      count: 0,
      status: 'kept_original',
      reason: 'subject_touches_border',
      color: rep,
      id: 'auto',
    }
  }

  const filled = floodFillMask(rgba, width, height, rep, BG_MAX_CHANNEL_DIFF, BG_MAX_L1_DIFF)
  const keptCount = total - filled.count
  if (filled.count === 0 || keptCount === 0) {
    return {
      mask: emptyMask,
      count: 0,
      status: 'kept_original',
      reason: 'single_color_or_no_foreground',
      color: rep,
      id: 'auto',
    }
  }

  const id = classifyRepresentativeColor(rep)
  return {
    mask: filled.mask,
    count: filled.count,
    status: 'omitted',
    reason: null,
    color: rep,
    id,
  }
}

export function proposedBackgroundCells(rgba, width, height, color = null) {
  if (color && typeof color === 'object' && typeof color.r === 'number' && typeof color.g === 'number' && typeof color.b === 'number') {
    const tol = Number.isFinite(color.tolerance) ? color.tolerance : 0
    const l1 = Number.isFinite(color.maxL1) ? color.maxL1 : tol * 3
    const filled = floodFillMask(rgba, width, height, color, tol, l1)
    return maskToCells(filled.mask, width, height)
  }
  const detected = detectAutomaticBackground(rgba, width, height)
  return maskToCells(detected.mask, width, height)
}

function buildSelectedMask(proposedMask, width, height, { omit = null, protect = [], selection = null } = {}) {
  const total = width * height
  const mask = new Uint8Array(total)
  if (selection) {
    if (selection.mode === 'proposal') {
      mask.set(proposedMask)
    } else if (selection.mode === 'delta') {
      mask.set(proposedMask)
      for (const [x, y] of normalizeCells(selection.removed || [], width, height)) {
        mask[y * width + x] = 0
      }
      for (const [x, y] of normalizeCells(selection.added || [], width, height)) {
        mask[y * width + x] = 1
      }
    } else if (selection.mode === 'mask') {
      const packed = selection.mask instanceof Uint8Array ? selection.mask : null
      const expectedLength = Math.ceil(total / 8)
      if (!packed || packed.length !== expectedLength) {
        fail('invalid_request', 'Sequence selection mask does not match the recovered image size.')
      }
      for (let index = 0; index < total; index += 1) {
        if (packed[index >> 3] & (1 << (index & 7))) mask[index] = 1
      }
    } else {
      fail('invalid_request', 'Sequence selection is invalid.')
    }
  } else if (omit == null) {
    mask.set(proposedMask)
  } else {
    for (const [x, y] of normalizeCells(omit, width, height)) {
      mask[y * width + x] = 1
    }
  }
  for (const [x, y] of normalizeCells(protect, width, height)) {
    mask[y * width + x] = 0
  }
  return mask
}

export function cellsFromSelection(proposed, selection, width, height) {
  const proposedMask = new Uint8Array(width * height)
  if (proposed instanceof Uint8Array && proposed.length === width * height) {
    proposedMask.set(proposed)
  } else {
    for (const [x, y] of normalizeCells(proposed || [], width, height)) {
      proposedMask[y * width + x] = 1
    }
  }
  const mask = buildSelectedMask(proposedMask, width, height, { selection: selection || { mode: 'proposal' } })
  return maskToCells(mask, width, height)
}

function createAbortError() {
  const error = new Error('Sequence preview aborted.')
  error.name = 'AbortError'
  error.code = 'aborted'
  return error
}

export function readEncodedImageDimensions(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : Buffer.from(bytes || [])
  const kind = classifySequenceImage(data)
  if (!kind) return null
  if (kind === 'png') {
    if (data.length < 24) return null
    const chunk = String.fromCharCode(data[12], data[13], data[14], data[15])
    if (chunk !== 'IHDR') return null
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    const width = view.getUint32(16, false)
    const height = view.getUint32(20, false)
    if (width > 0 && height > 0) return { width, height, kind }
    return null
  }
  if (kind === 'jpeg') {
    let offset = 2
    while (offset + 9 <= data.length) {
      if (data[offset] !== 0xff) {
        offset += 1
        continue
      }
      while (offset < data.length && data[offset] === 0xff) offset += 1
      if (offset >= data.length) break
      const marker = data[offset]
      offset += 1
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) continue
      if (offset + 2 > data.length) break
      const segLength = (data[offset] << 8) | data[offset + 1]
      if (segLength < 2 || offset + segLength > data.length) break
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        if (segLength < 7) break
        const height = (data[offset + 3] << 8) | data[offset + 4]
        const width = (data[offset + 5] << 8) | data[offset + 6]
        if (width > 0 && height > 0) return { width, height, kind }
        break
      }
      offset += segLength
    }
  }
  return null
}

function attachLazyCellArrays(target, width, height, proposedMask, omittedMask) {
  let cachedProposed = null
  let cachedOmitted = null
  Object.defineProperty(target, 'proposed', {
    enumerable: false,
    configurable: true,
    get() {
      if (!cachedProposed) cachedProposed = maskToCells(proposedMask, width, height)
      return cachedProposed
    },
  })
  Object.defineProperty(target, 'omitted', {
    enumerable: false,
    configurable: true,
    get() {
      if (!cachedOmitted) cachedOmitted = maskToCells(omittedMask, width, height)
      return cachedOmitted
    },
  })
  return target
}

export function applyBackgroundSelection(cRgba, width, height, { omit = null, protect = [], proposed = [], proposedMask = null, transparent = false, selection = null } = {}) {
  const source = Buffer.isBuffer(cRgba) ? cRgba : Buffer.from(cRgba)
  const total = width * height
  if (transparent) {
    const empty = new Uint8Array(total)
    return attachLazyCellArrays({
      working: Buffer.from(source),
      omittedMask: empty,
      omittedCount: 0,
      proposedMask: empty,
      proposedCount: 0,
    }, width, height, empty, empty)
  }
  let baseMask
  if (proposedMask instanceof Uint8Array && proposedMask.length === total) {
    baseMask = proposedMask
  } else {
    baseMask = new Uint8Array(total)
    for (const [x, y] of normalizeCells(proposed || [], width, height)) {
      baseMask[y * width + x] = 1
    }
  }
  const selectedMask = buildSelectedMask(baseMask, width, height, { omit, protect, selection })
  const working = Buffer.from(source)
  let omittedCount = 0
  for (let index = 0; index < total; index += 1) {
    if (!selectedMask[index]) continue
    omittedCount += 1
    const offset = index * 4
    working[offset] = 0
    working[offset + 1] = 0
    working[offset + 2] = 0
    working[offset + 3] = 0
  }
  const proposedCount = countMask(baseMask)
  return attachLazyCellArrays({
    working,
    omittedMask: selectedMask,
    omittedCount,
    proposedMask: baseMask,
    proposedCount,
  }, width, height, baseMask, selectedMask)
}

export function restoreBackgroundCells(working, cRgba, cells, width, height) {
  const next = Buffer.from(working)
  for (const [x, y] of normalizeCells(cells, width, height)) {
    const offset = (y * width + x) * 4
    next[offset] = cRgba[offset]
    next[offset + 1] = cRgba[offset + 1]
    next[offset + 2] = cRgba[offset + 2]
    next[offset + 3] = cRgba[offset + 3]
  }
  return next
}

function placeFrame(frame, width, height) {
  if (frame.width === width && frame.height === height) {
    return Buffer.isBuffer(frame.working) ? frame.working : Buffer.from(frame.working)
  }
  const placed = Buffer.alloc(width * height * 4)
  for (let y = 0; y < frame.height; y += 1) {
    frame.working.copy(placed, y * width * 4, y * frame.width * 4, (y + 1) * frame.width * 4)
  }
  return placed
}

export async function prepareGeneralAssetFrame(bytes, { background = 'auto', omit = null, protect = [], selection = null, signal = null } = {}) {
  if (signal?.aborted) throw createAbortError()
  if (!classifySequenceImage(bytes)) fail('unsupported_input', 'Sequence images must be PNG or JPEG.')
  generalAssetBackground(background)
  const encodedDims = readEncodedImageDimensions(bytes)
  if (encodedDims && (encodedDims.width > MAX_EDGE || encodedDims.height > MAX_EDGE)) {
    fail('resource_limit', `Image edge exceeds ${MAX_EDGE}. The sequence was not scaled.`)
  }
  const sourceBuffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
  let prepared = null
  if (encodedDims && encodedDims.width * encodedDims.height > SOURCE_PIXEL_MAX_PIXELS) {
    try {
      const loadedRaw = await loadRgba(sourceBuffer, { limitInputPixels: MAX_EDGE * MAX_EDGE })
      if (loadedRaw.width > MAX_EDGE || loadedRaw.height > MAX_EDGE) {
        fail('resource_limit', `Image edge exceeds ${MAX_EDGE}. The sequence was not scaled.`)
      }
      prepared = {
        loadedRaw,
        image: loadedRaw,
        report: {
          status: 'passthrough',
          reason: 'exceeds_recovery_budget',
          exact_recovery: false,
          method: SOURCE_PIXEL_RECOVERY_MODE,
        },
      }
    } catch (fallbackError) {
      if (fallbackError.code === 'resource_limit') throw fallbackError
      if (/Input image exceeds maximum pixel limit/i.test(String(fallbackError?.message || ''))) {
        fail('resource_limit', `Image edge exceeds ${MAX_EDGE}. The sequence was not scaled.`)
      }
      fail(fallbackError.code || 'unsupported_input', fallbackError.message || 'Source pixel recovery failed.')
    }
  } else {
    try {
      prepared = await prepareSourcePixelRecovery(sourceBuffer, {
        sourcePixelRecovery: SOURCE_PIXEL_RECOVERY_MODE,
        pixelFinishing: false,
        backgroundMode: 'passthrough',
      })
    } catch (error) {
      const message = String(error?.message || '')
      if (/Input image exceeds maximum pixel limit|Invalid or oversized pixel recovery image/i.test(message)) {
        try {
          const loadedRaw = await loadRgba(sourceBuffer, { limitInputPixels: MAX_EDGE * MAX_EDGE })
          if (loadedRaw.width > MAX_EDGE || loadedRaw.height > MAX_EDGE) {
            fail('resource_limit', `Image edge exceeds ${MAX_EDGE}. The sequence was not scaled.`)
          }
          prepared = {
            loadedRaw,
            image: loadedRaw,
            report: {
              status: 'passthrough',
              reason: 'exceeds_recovery_budget',
              exact_recovery: false,
              method: SOURCE_PIXEL_RECOVERY_MODE,
            },
          }
        } catch (fallbackError) {
          if (fallbackError.code === 'resource_limit') throw fallbackError
          if (/Input image exceeds maximum pixel limit/i.test(String(fallbackError?.message || ''))) {
            fail('resource_limit', `Image edge exceeds ${MAX_EDGE}. The sequence was not scaled.`)
          }
          fail(fallbackError.code || 'unsupported_input', fallbackError.message || 'Source pixel recovery failed.')
        }
      } else {
        fail(error.code || 'unsupported_input', error.message || 'Source pixel recovery failed.')
      }
    }
  }
  if (signal?.aborted) throw createAbortError()
  if (!prepared?.image?.data) fail('unsupported_input', 'Source pixel recovery did not return an image.')
  const image = prepared.image
  if (image.width > MAX_EDGE || image.height > MAX_EDGE) {
    fail('resource_limit', `Recovered image edge exceeds ${MAX_EDGE}. The sequence was not scaled.`)
  }
  const cRgba = Buffer.isBuffer(image.data) ? image.data : Buffer.from(image.data)
  const transparent = hasTransparentPixel(prepared.loadedRaw.data)
  const autoBg = transparent
    ? {
      mask: new Uint8Array(image.width * image.height),
      count: 0,
      status: 'transparent_source',
      reason: 'transparent_source',
      color: null,
      id: 'auto',
    }
    : detectAutomaticBackground(cRgba, image.width, image.height)
  const applied = applyBackgroundSelection(cRgba, image.width, image.height, {
    omit,
    protect,
    proposedMask: autoBg.mask,
    transparent,
    selection,
  })
  const frameResult = {
    width: image.width,
    height: image.height,
    inputWidth: prepared.loadedRaw?.width ?? image.width,
    inputHeight: prepared.loadedRaw?.height ?? image.height,
    cRgba,
    working: applied.working,
    omittedMask: applied.omittedMask,
    omittedCount: applied.omittedCount,
    proposedMask: applied.proposedMask,
    proposedCount: applied.proposedCount,
    transparentSource: transparent,
    background: autoBg.id,
    backgroundStatus: autoBg.status,
    backgroundReason: autoBg.reason,
    backgroundColor: autoBg.color,
    recovery: {
      status: prepared.report?.status ?? 'unknown',
      reason: prepared.report?.reason ?? null,
      exact_recovery: prepared.report?.exact_recovery === true,
      method: SOURCE_PIXEL_RECOVERY_MODE,
    },
  }
  return attachLazyCellArrays(frameResult, image.width, image.height, applied.proposedMask, applied.omittedMask)
}

export async function prepareGeneralSequence(frames, { background = 'auto', includePlaced = true, minWidth = 0, minHeight = 0, existingFrameCount = 0, signal = null } = {}) {
  if (!Number.isSafeInteger(existingFrameCount) || existingFrameCount < 0) {
    fail('invalid_request', 'Invalid existing frame count.')
  }
  if (!Array.isArray(frames) || frames.length < 1 || existingFrameCount + frames.length > GENERAL_SEQUENCE_MAX_FRAMES) {
    fail('invalid_request', `A general sequence needs 1 to ${GENERAL_SEQUENCE_MAX_FRAMES} images.`)
  }
  generalAssetBackground(background)
  const totalFrameCount = existingFrameCount + frames.length
  let runningWidth = minWidth
  let runningHeight = minHeight
  if (runningWidth > MAX_EDGE || runningHeight > MAX_EDGE) {
    fail('resource_limit', `Shared canvas edge exceeds ${MAX_EDGE}. Frames were not scaled.`)
  }
  if (runningWidth > 0 && runningHeight > 0 && totalFrameCount * runningWidth * runningHeight * 4 > SPRITE_DOCUMENT_LIMITS.maxExpandedRgbaBytes) {
    fail('resource_limit', 'Sequence exceeds the 128 MiB expanded pixel budget. Import fewer or smaller frames per batch.')
  }
  // Pre-scan encoded headers before decoding any frame so oversized dimensions or guaranteed-passthrough
  // budget overruns fail before allocating decoded RGBA buffers.
  for (const frame of frames) {
    if (signal?.aborted) throw createAbortError()
    const dims = readEncodedImageDimensions(frame?.bytes)
    if (dims) {
      if (dims.width > MAX_EDGE || dims.height > MAX_EDGE) {
        fail('resource_limit', `Image edge exceeds ${MAX_EDGE}. The sequence was not scaled.`)
      }
      if (dims.width * dims.height > SOURCE_PIXEL_MAX_PIXELS) {
        runningWidth = Math.max(runningWidth, dims.width)
        runningHeight = Math.max(runningHeight, dims.height)
        if (totalFrameCount * runningWidth * runningHeight * 4 > SPRITE_DOCUMENT_LIMITS.maxExpandedRgbaBytes) {
          fail('resource_limit', 'Sequence exceeds the 128 MiB expanded pixel budget. Import fewer or smaller frames per batch.')
        }
      }
    }
  }
  const prepared = []
  for (let index = 0; index < frames.length; index += 1) {
    if (signal?.aborted) throw createAbortError()
    if (index > 0 && signal) {
      await new Promise((resolve) => setImmediate(resolve))
      if (signal.aborted) throw createAbortError()
    }
    const frame = frames[index]
    const preparedFrame = await prepareGeneralAssetFrame(frame.bytes, {
      background,
      omit: frame.omit,
      protect: frame.protect,
      selection: frame.selection,
      signal,
    })
    runningWidth = Math.max(runningWidth, preparedFrame.width)
    runningHeight = Math.max(runningHeight, preparedFrame.height)
    if (runningWidth > MAX_EDGE || runningHeight > MAX_EDGE) {
      fail('resource_limit', `Shared canvas edge exceeds ${MAX_EDGE}. Frames were not scaled.`)
    }
    const expandedBytes = totalFrameCount * runningWidth * runningHeight * 4
    if (expandedBytes > SPRITE_DOCUMENT_LIMITS.maxExpandedRgbaBytes) {
      fail('resource_limit', 'Sequence exceeds the 128 MiB expanded pixel budget. Import fewer or smaller frames per batch.')
    }
    prepared.push(preparedFrame)
  }
  const width = runningWidth
  const height = runningHeight
  const placed = prepared.map((frame) => {
    const next = {
      width: frame.width,
      height: frame.height,
      inputWidth: frame.inputWidth ?? frame.width,
      inputHeight: frame.inputHeight ?? frame.height,
      cRgba: frame.cRgba,
      working: frame.working,
      omittedMask: frame.omittedMask,
      omittedCount: frame.omittedCount,
      proposedMask: frame.proposedMask,
      proposedCount: frame.proposedCount,
      transparentSource: frame.transparentSource,
      background: frame.background,
      backgroundStatus: frame.backgroundStatus,
      backgroundReason: frame.backgroundReason,
      backgroundColor: frame.backgroundColor,
      recovery: frame.recovery,
      placed: includePlaced ? placeFrame(frame, width, height) : null,
      anchor: { x: 0, y: 0 },
    }
    return attachLazyCellArrays(next, frame.width, frame.height, frame.proposedMask, frame.omittedMask)
  })
  const detectedIds = new Set(placed.map((frame) => frame.background).filter((id) => id && id !== 'auto'))
  const resolvedBackground = background && background !== 'auto'
    ? generalAssetBackground(background).id
    : (detectedIds.size === 1 ? [...detectedIds][0] : 'auto')
  return {
    background: resolvedBackground,
    width,
    height,
    anchor: { x: 0, y: 0 },
    scaled: false,
    canvasUniform: true,
    gridConsistent: placed.every((frame) => frame.recovery.status === 'resampled' && frame.width === placed[0].width && frame.height === placed[0].height),
    gridReason: placed.every((frame) => frame.recovery.status === 'resampled')
      ? (placed.every((frame) => frame.width === placed[0].width && frame.height === placed[0].height) ? 'resampled_shared_grid' : 'recovered_sizes_differ')
      : 'passthrough_or_unconfirmed_grid',
    frames: placed,
  }
}
