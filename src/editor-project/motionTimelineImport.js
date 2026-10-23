import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'

import { SPRITE_DOCUMENT_LIMITS } from './constants.js'
import { sha256Bytes, spriteDocumentError } from './spriteDocumentValidation.js'
import { runGuardedTool, EXTERNAL_TOOL_FAILURE } from '../motion-source/guardedToolRunner.js'

export const MAX_MOTION_GIF_BYTES = 64 * 1024 * 1024
export const MAX_MOTION_VIDEO_BYTES = 200 * 1024 * 1024
export const MAX_MOTION_TIMELINE_FRAMES = 64
export const MAX_MOTION_FRAME_DIMENSION = 2048
export const MAX_MOTION_FRAME_PIXELS = MAX_MOTION_FRAME_DIMENSION * MAX_MOTION_FRAME_DIMENSION
export const MAX_MOTION_VIDEO_SEGMENT_SEC = 30
export const MAX_MOTION_EXPANDED_RGBA_BYTES = SPRITE_DOCUMENT_LIMITS.maxExpandedRgbaBytes

const VIDEO_PROBE_TIMEOUT_MS = 10_000
const VIDEO_EXTRACT_TIMEOUT_MS = 20_000
const VIDEO_TOOL_MAX_RSS_MIB = 1024
const MAX_STAGED_SOURCES = 4

const stagedSources = new Map()

function createAbortError(message = 'Motion import was cancelled.') {
  const error = new Error(message)
  error.name = 'AbortError'
  error.code = 'aborted'
  return error
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw createAbortError()
}

function mapToolError(error, fallbackMessage) {
  if (!error) return spriteDocumentError('unsupported_input', fallbackMessage)
  if (error.name === 'AbortError' || error.code === 'aborted' || error.code === EXTERNAL_TOOL_FAILURE.CANCELLED) {
    return createAbortError(error.message || 'Motion import was cancelled.')
  }
  if (error.code === 'resource_limit' || error.code === 'invalid_request' || error.code === 'unsupported_input' || error.code === 'artifact_integrity_failed') {
    return error
  }
  if (error.code === EXTERNAL_TOOL_FAILURE.TIMEOUT || error.code === EXTERNAL_TOOL_FAILURE.RSS_LIMIT) {
    return spriteDocumentError('resource_limit', error.message || fallbackMessage)
  }
  return spriteDocumentError('unsupported_input', error.message || fallbackMessage)
}

function inferSafeVideoExt(fileName = '', fallback = 'mp4') {
  const match = String(fileName || '').toLowerCase().match(/\.(mp4|mov|webm|mkv|avi|m4v)$/)
  return match ? match[1] : fallback
}

export function classifyMotionSource(buffer, fileName = '') {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) {
    throw spriteDocumentError('unsupported_input', 'Motion source file is empty or truncated.')
  }
  const gifHeader = buffer.subarray(0, 6).toString('ascii')
  if (gifHeader === 'GIF87a' || gifHeader === 'GIF89a') {
    return { kind: 'gif', ext: 'gif', mimeType: 'image/gif' }
  }
  if (buffer.subarray(4, 8).toString('ascii') === 'ftyp') {
    const ext = inferSafeVideoExt(fileName, 'mp4')
    return { kind: 'video', ext, mimeType: ext === 'mov' ? 'video/quicktime' : 'video/mp4' }
  }
  if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) {
    const ext = inferSafeVideoExt(fileName, 'webm')
    return { kind: 'video', ext, mimeType: ext === 'mkv' ? 'video/x-matroska' : 'video/webm' }
  }
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'AVI ') {
    return { kind: 'video', ext: 'avi', mimeType: 'video/x-msvideo' }
  }
  throw spriteDocumentError('unsupported_input', 'Unsupported file format. Choose a GIF or video (.mp4, .mov, .webm, .mkv, .avi).')
}

function readGifSubBlocks(buffer, offset) {
  const chunks = []
  let total = 0
  let cursor = offset
  while (cursor < buffer.length) {
    const size = buffer[cursor]
    cursor += 1
    if (size === 0) {
      return { data: Buffer.concat(chunks, total), nextOffset: cursor }
    }
    if (cursor + size > buffer.length) {
      throw spriteDocumentError('unsupported_input', 'GIF data sub-block is truncated.')
    }
    chunks.push(buffer.subarray(cursor, cursor + size))
    total += size
    cursor += size
  }
  throw spriteDocumentError('unsupported_input', 'GIF data sub-block is missing its terminator.')
}

function skipGifSubBlocks(buffer, offset) {
  let cursor = offset
  while (cursor < buffer.length) {
    const size = buffer[cursor]
    cursor += 1
    if (size === 0) return cursor
    if (cursor + size > buffer.length) {
      throw spriteDocumentError('unsupported_input', 'GIF extension sub-block is truncated.')
    }
    cursor += size
  }
  throw spriteDocumentError('unsupported_input', 'GIF extension is missing its terminator.')
}

function decodeGifLzw(minCodeSize, compressed, pixelCount) {
  if (minCodeSize < 2 || minCodeSize > 11) {
    throw spriteDocumentError('unsupported_input', 'GIF LZW minimum code size is invalid.')
  }
  if (! Number.isSafeInteger(pixelCount) || pixelCount < 1) {
    throw spriteDocumentError('unsupported_input', 'GIF frame pixel count must be positive.')
  }
  const MAX_DICT_SIZE = 4096
  const clearCode = 1 << minCodeSize
  const eoiCode = clearCode + 1
  const prefix = new Int32Array(MAX_DICT_SIZE)
  const suffix = new Uint8Array(MAX_DICT_SIZE)
  const stack = new Uint8Array(MAX_DICT_SIZE + 1)
  const output = new Uint8Array(pixelCount)

  let codeSize = minCodeSize + 1
  let codeMask = (1 << codeSize) - 1
  let nextCode = eoiCode + 1
  let oldCode = -1
  let firstChar = 0

  for (let i = 0; i < clearCode; i += 1) {
    prefix[i] = -1
    suffix[i] = i
  }

  let bitBuffer = 0
  let bitCount = 0
  let bytePos = 0
  let outPos = 0

  while (outPos < pixelCount) {
    while (bitCount < codeSize && bytePos < compressed.length) {
      bitBuffer |= compressed[bytePos++] << bitCount
      bitCount += 8
    }
    if (bitCount < codeSize) {
      throw spriteDocumentError('unsupported_input', 'GIF LZW data is truncated before completing the frame.')
    }
    const code = bitBuffer & codeMask
    bitBuffer >>>= codeSize
    bitCount -= codeSize

    if (code === clearCode) {
      codeSize = minCodeSize + 1
      codeMask = (1 << codeSize) - 1
      nextCode = eoiCode + 1
      oldCode = -1
      continue
    }
    if (code === eoiCode) {
      throw spriteDocumentError('unsupported_input', 'GIF LZW stream ended prematurely (early EOI) before filling the frame.')
    }

    let inCode = code
    let stackTop = 0
    if (code >= nextCode) {
      if (code > nextCode || oldCode === -1) {
        throw spriteDocumentError('unsupported_input', 'GIF LZW stream contains an invalid code.')
      }
      stack[stackTop++] = firstChar
      inCode = oldCode
    }
    while (inCode >= clearCode) {
      if (stackTop >= MAX_DICT_SIZE) {
        throw spriteDocumentError('unsupported_input', 'GIF LZW code chain is corrupted.')
      }
      stack[stackTop++] = suffix[inCode]
      inCode = prefix[inCode]
    }
    firstChar = suffix[inCode]
    stack[stackTop++] = firstChar

    if (outPos + stackTop > pixelCount) {
      throw spriteDocumentError('unsupported_input', 'GIF LZW stream decoded more pixels than the frame descriptor allows.')
    }
    for (let i = stackTop - 1; i >= 0; i -= 1) {
      output[outPos++] = stack[i]
    }

    if (oldCode !== -1 && nextCode < MAX_DICT_SIZE) {
      prefix[nextCode] = oldCode
      suffix[nextCode] = firstChar
      nextCode += 1
      if (nextCode === codeMask + 1 && nextCode < MAX_DICT_SIZE) {
        codeSize += 1
        codeMask = (1 << codeSize) - 1
      }
    }
    oldCode = code
  }

  if (outPos < pixelCount) {
    throw spriteDocumentError('unsupported_input', 'GIF LZW decoded fewer pixels than the frame descriptor requires.')
  }

  return output
}

function deinterlaceGifIndices(indices, width, height) {
  const output = new Uint8Array(width * height)
  const starts = [0, 4, 2, 1]
  const steps = [8, 8, 4, 2]
  let srcRow = 0
  for (let pass = 0; pass < 4; pass += 1) {
    for (let dstRow = starts[pass]; dstRow < height; dstRow += steps[pass]) {
      const srcStart = srcRow * width
      const dstStart = dstRow * width
      output.set(indices.subarray(srcStart, srcStart + width), dstStart)
      srcRow += 1
    }
  }
  return output
}

export function decodeGifTimelineFrames(buffer, {
  maxFrames = MAX_MOTION_TIMELINE_FRAMES,
  maxDimension = MAX_MOTION_FRAME_DIMENSION,
  maxFramePixels = MAX_MOTION_FRAME_PIXELS,
  maxExpandedRgbaBytes = MAX_MOTION_EXPANDED_RGBA_BYTES,
  defaultZeroDelayMs = 100,
  preserveZeroDelay = false,
  signal = null,
} = {}) {
  throwIfAborted(signal)
  if (!Buffer.isBuffer(buffer) || buffer.length < 13) {
    throw spriteDocumentError('unsupported_input', 'Source is not a valid GIF file.')
  }
  if (buffer.length > MAX_MOTION_GIF_BYTES) {
    throw spriteDocumentError('resource_limit', `GIF file exceeds the ${Math.round(MAX_MOTION_GIF_BYTES / (1024 * 1024))} MiB size limit.`)
  }
  const header = buffer.subarray(0, 6).toString('ascii')
  if (header !== 'GIF87a' && header !== 'GIF89a') {
    throw spriteDocumentError('unsupported_input', 'Source is not a valid GIF87a or GIF89a file.')
  }
  const screenWidth = buffer.readUInt16LE(6)
  const screenHeight = buffer.readUInt16LE(8)
  if (screenWidth < 1 || screenHeight < 1) {
    throw spriteDocumentError('unsupported_input', 'GIF logical screen dimensions must be positive.')
  }
  if (screenWidth > maxDimension || screenHeight > maxDimension || screenWidth * screenHeight > maxFramePixels) {
    throw spriteDocumentError(
      'resource_limit',
      `GIF dimensions (${screenWidth}×${screenHeight}) exceed the ${maxDimension}×${maxDimension} px limit. The GIF was not scaled.`,
      { width: screenWidth, height: screenHeight, limit: maxDimension },
    )
  }

  const lsdPacked = buffer[10]
  const bgColorIndex = buffer[11]
  const gctFlag = (lsdPacked & 0x80) !== 0
  const gctSize = 1 << ((lsdPacked & 0x07) + 1)
  let cursor = 13
  let globalColorTable = null
  let bgColorRgb = null
  if (gctFlag) {
    const gctBytes = gctSize * 3
    if (cursor + gctBytes > buffer.length) {
      throw spriteDocumentError('unsupported_input', 'GIF global color table is truncated.')
    }
    globalColorTable = buffer.subarray(cursor, cursor + gctBytes)
    if (bgColorIndex * 3 + 2 < globalColorTable.length) {
      bgColorRgb = [
        globalColorTable[bgColorIndex * 3],
        globalColorTable[bgColorIndex * 3 + 1],
        globalColorTable[bgColorIndex * 3 + 2],
      ]
    }
    cursor += gctBytes
  }

  const descriptors = []
  let gce = null

  while (cursor < buffer.length) {
    throwIfAborted(signal)
    const blockId = buffer[cursor]
    cursor += 1
    if (blockId === 0x3b) break
    if (blockId === 0x00) continue
    if (blockId === 0x21) {
      if (cursor >= buffer.length) {
        throw spriteDocumentError('unsupported_input', 'GIF extension block is truncated.')
      }
      const extLabel = buffer[cursor]
      cursor += 1
      if (extLabel === 0xf9) {
        if (cursor + 6 > buffer.length) {
          throw spriteDocumentError('unsupported_input', 'GIF graphic control extension is truncated.')
        }
        const blockSize = buffer[cursor]
        const packed = buffer[cursor + 1]
        const delayCs = buffer.readUInt16LE(cursor + 2)
        const transparentIndex = buffer[cursor + 4]
        cursor += 1 + blockSize
        if (cursor < buffer.length && buffer[cursor] === 0) cursor += 1
        gce = {
          disposal: (packed >> 2) & 0x07,
          transparentFlag: (packed & 0x01) !== 0,
          delayCs,
          transparentIndex,
        }
      } else {
        cursor = skipGifSubBlocks(buffer, cursor)
      }
      continue
    }
    if (blockId === 0x2c) {
      if (cursor + 9 > buffer.length) {
        throw spriteDocumentError('unsupported_input', 'GIF image descriptor is truncated.')
      }
      const left = buffer.readUInt16LE(cursor)
      const top = buffer.readUInt16LE(cursor + 2)
      const width = buffer.readUInt16LE(cursor + 4)
      const height = buffer.readUInt16LE(cursor + 6)
      const imgPacked = buffer[cursor + 8]
      cursor += 9

      if (width < 1 || height < 1) {
        throw spriteDocumentError('unsupported_input', 'GIF frame dimensions must be positive.')
      }
      if (width > maxDimension || height > maxDimension || width * height > maxFramePixels) {
        throw spriteDocumentError(
          'resource_limit',
          `GIF frame dimensions (${width}×${height}) exceed the ${maxDimension}×${maxDimension} px limit. The GIF was not scaled.`,
          { width, height, limit: maxDimension },
        )
      }
      if (left + width > screenWidth || top + height > screenHeight) {
        throw spriteDocumentError(
          'unsupported_input',
          `GIF frame bounds (${left},${top} ${width}×${height}) exceed the logical screen (${screenWidth}×${screenHeight}).`,
          { left, top, width, height, screenWidth, screenHeight },
        )
      }
      if (descriptors.length + 1 > maxFrames) {
        throw spriteDocumentError(
          'resource_limit',
          `GIF has more than ${maxFrames} frames. Import a shorter GIF; frames were not truncated.`,
          { limit: maxFrames },
        )
      }
      const frameBudgetBytes = Math.max(screenWidth * screenHeight, width * height) * 4
      const nextExpandedBytes = (descriptors.length + 1) * frameBudgetBytes
      if (nextExpandedBytes > maxExpandedRgbaBytes) {
        throw spriteDocumentError(
          'resource_limit',
          `GIF exceeds the ${Math.round(maxExpandedRgbaBytes / (1024 * 1024))} MiB expanded pixel budget.`,
          { limit: maxExpandedRgbaBytes, bytes: nextExpandedBytes },
        )
      }

      const lctFlag = (imgPacked & 0x80) !== 0
      const interlaced = (imgPacked & 0x40) !== 0
      const lctSize = 1 << ((imgPacked & 0x07) + 1)
      let localColorTable = null
      if (lctFlag) {
        const lctBytes = lctSize * 3
        if (cursor + lctBytes > buffer.length) {
          throw spriteDocumentError('unsupported_input', 'GIF local color table is truncated.')
        }
        localColorTable = buffer.subarray(cursor, cursor + lctBytes)
        cursor += lctBytes
      }

      if (cursor >= buffer.length) {
        throw spriteDocumentError('unsupported_input', 'GIF LZW minimum code size is missing.')
      }
      const minCodeSize = buffer[cursor]
      cursor += 1
      const lzw = readGifSubBlocks(buffer, cursor)
      cursor = lzw.nextOffset

      descriptors.push({
        left,
        top,
        width,
        height,
        interlaced,
        localColorTable,
        minCodeSize,
        compressed: lzw.data,
        disposal: gce ? gce.disposal : 0,
        transparentFlag: gce ? gce.transparentFlag : false,
        transparentIndex: gce ? gce.transparentIndex : 0,
        delayCs: gce ? gce.delayCs : null,
        hasGce: Boolean(gce),
      })
      gce = null
      continue
    }
    throw spriteDocumentError('unsupported_input', `GIF contains an unsupported block marker (0x${blockId.toString(16)}).`)
  }

  if (!descriptors.length) {
    throw spriteDocumentError('unsupported_input', 'GIF contains no decodable image frames.')
  }

  const canvasRgba = new Uint8Array(screenWidth * screenHeight * 4)
  if (!descriptors[0].transparentFlag && bgColorRgb) {
    for (let dst = 0; dst < canvasRgba.length; dst += 4) {
      canvasRgba[dst] = bgColorRgb[0]
      canvasRgba[dst + 1] = bgColorRgb[1]
      canvasRgba[dst + 2] = bgColorRgb[2]
      canvasRgba[dst + 3] = 255
    }
  }
  const frames = []
  let elapsedMs = 0

  for (let index = 0; index < descriptors.length; index += 1) {
    throwIfAborted(signal)
    const desc = descriptors[index]
    const colorTable = desc.localColorTable || globalColorTable
    if (!colorTable) {
      throw spriteDocumentError('unsupported_input', `GIF frame ${index + 1} has no color table.`)
    }
    const framePixels = desc.width * desc.height
    if (
      desc.width > maxDimension ||
      desc.height > maxDimension ||
      framePixels > maxFramePixels ||
      desc.left + desc.width > screenWidth ||
      desc.top + desc.height > screenHeight ||
      framePixels * 4 > maxExpandedRgbaBytes
    ) {
      throw spriteDocumentError('resource_limit', `GIF frame ${index + 1} exceeds frame bounds or memory budget.`)
    }
    const rawIndices = decodeGifLzw(desc.minCodeSize, desc.compressed, framePixels)
    const indices = desc.interlaced
      ? deinterlaceGifIndices(rawIndices, desc.width, desc.height)
      : rawIndices

    const previousCanvas = desc.disposal === 3 ? new Uint8Array(canvasRgba) : null

    const xEnd = desc.left + desc.width
    const yEnd = desc.top + desc.height
    const xStart = desc.left
    const yStart = desc.top

    for (let cy = yStart; cy < yEnd; cy += 1) {
      const fy = cy - desc.top
      const rowOffset = fy * desc.width
      const canvasRowOffset = cy * screenWidth
      for (let cx = xStart; cx < xEnd; cx += 1) {
        const fx = cx - desc.left
        const paletteIdx = indices[rowOffset + fx]
        if (desc.transparentFlag && paletteIdx === desc.transparentIndex) {
          continue
        }
        const colorOffset = paletteIdx * 3
        if (colorOffset + 2 >= colorTable.length) {
          throw spriteDocumentError('unsupported_input', `GIF frame ${index + 1} references an out-of-range palette index (${paletteIdx}).`)
        }
        const dst = (canvasRowOffset + cx) * 4
        canvasRgba[dst] = colorTable[colorOffset]
        canvasRgba[dst + 1] = colorTable[colorOffset + 1]
        canvasRgba[dst + 2] = colorTable[colorOffset + 2]
        canvasRgba[dst + 3] = 255
      }
    }

    const rawDelayMs = desc.hasGce && Number.isFinite(desc.delayCs) ? desc.delayCs * 10 : null
    const durationMs = rawDelayMs !== null && rawDelayMs > 0
      ? Math.min(60000, Math.max(1, Math.round(rawDelayMs)))
      : (preserveZeroDelay && rawDelayMs === 0 ? 0 : defaultZeroDelayMs)

    frames.push({
      index,
      width: screenWidth,
      height: screenHeight,
      duration_ms: durationMs,
      timestamp_ms: elapsedMs,
      disposal: desc.disposal,
      rect: { x: desc.left, y: desc.top, w: desc.width, h: desc.height },
      rgba: Buffer.from(canvasRgba),
    })
    elapsedMs += durationMs

    if (desc.disposal === 2) {
      const restoreToBg = !desc.transparentFlag && bgColorRgb
      const r = restoreToBg ? bgColorRgb[0] : 0
      const g = restoreToBg ? bgColorRgb[1] : 0
      const b = restoreToBg ? bgColorRgb[2] : 0
      const a = restoreToBg ? 255 : 0
      for (let cy = yStart; cy < yEnd; cy += 1) {
        const canvasRowOffset = cy * screenWidth
        for (let cx = xStart; cx < xEnd; cx += 1) {
          const dst = (canvasRowOffset + cx) * 4
          canvasRgba[dst] = r
          canvasRgba[dst + 1] = g
          canvasRgba[dst + 2] = b
          canvasRgba[dst + 3] = a
        }
      }
    } else if (desc.disposal === 3 && previousCanvas) {
      canvasRgba.set(previousCanvas)
    }
  }

  return {
    kind: 'gif',
    width: screenWidth,
    height: screenHeight,
    frame_count: frames.length,
    total_duration_ms: elapsedMs,
    frames,
  }
}

export function resolveVideoBinaryPath(kind = 'ffmpeg', env = process.env) {
  if (kind === 'ffprobe') {
    if (env.FFPROBE_PATH || env.ffprobePath) return env.FFPROBE_PATH || env.ffprobePath
    for (const candidate of ['/opt/homebrew/bin/ffprobe', '/usr/local/bin/ffprobe']) {
      if (existsSync(candidate)) return candidate
    }
    return 'ffprobe'
  }
  if (env.FFMPEG_PATH || env.ffmpegPath) return env.FFMPEG_PATH || env.ffmpegPath
  for (const candidate of ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg']) {
    if (existsSync(candidate)) return candidate
  }
  return 'ffmpeg'
}

function parseFrameRateRational(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  if (typeof value !== 'string' || !value.trim()) return null
  const trimmed = value.trim()
  if (trimmed.includes('/')) {
    const [numStr, denStr] = trimmed.split('/')
    const num = Number(numStr)
    const den = Number(denStr)
    if (Number.isFinite(num) && Number.isFinite(den) && num > 0 && den > 0) {
      return num / den
    }
    return null
  }
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

export async function probeVideoFile(videoPath, {
  signal = null,
  probeRunner = runGuardedTool,
  env = process.env,
  maxDimension = MAX_MOTION_FRAME_DIMENSION,
  maxFramePixels = MAX_MOTION_FRAME_PIXELS,
} = {}) {
  throwIfAborted(signal)
  const ffprobePath = resolveVideoBinaryPath('ffprobe', env)
  const args = [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=codec_type,width,height,avg_frame_rate,r_frame_rate,duration,nb_frames:format=duration',
    '-of', 'json',
    videoPath,
  ]
  let result
  try {
    result = await probeRunner(ffprobePath, args, {
      tool: 'ffprobe',
      timeoutMs: VIDEO_PROBE_TIMEOUT_MS,
      maxRssMiB: VIDEO_TOOL_MAX_RSS_MIB,
      maxOutputBytes: 64 * 1024,
      signal,
    })
  } catch (error) {
    throw mapToolError(error, 'Video metadata could not be read by ffprobe.')
  }
  throwIfAborted(signal)
  let parsed
  try {
    parsed = JSON.parse(String(result?.stdout ?? result?.stdout_tail ?? '{}'))
  } catch {
    throw spriteDocumentError('unsupported_input', 'Video metadata output from ffprobe is invalid.')
  }
  const stream = Array.isArray(parsed?.streams) ? parsed.streams[0] : null
  if (!stream) {
    throw spriteDocumentError('unsupported_input', 'Video file does not contain a readable video stream.')
  }
  const width = Number(stream.width)
  const height = Number(stream.height)
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw spriteDocumentError('unsupported_input', 'Video stream dimensions are invalid.')
  }
  if (width > maxDimension || height > maxDimension || width * height > maxFramePixels) {
    throw spriteDocumentError(
      'resource_limit',
      `Video dimensions (${width}×${height}) exceed the ${maxDimension}×${maxDimension} px limit. The video was not scaled.`,
      { width, height, limit: maxDimension },
    )
  }
  const sourceFps = parseFrameRateRational(stream.avg_frame_rate) || parseFrameRateRational(stream.r_frame_rate)
  if (!sourceFps || !Number.isFinite(sourceFps) || sourceFps <= 0) {
    throw spriteDocumentError('unsupported_input', 'Video frame rate could not be verified from stream metadata.')
  }
  const streamDuration = Number(stream.duration)
  const formatDuration = Number(parsed?.format?.duration)
  const rawDuration = Number.isFinite(streamDuration) && streamDuration > 0
    ? streamDuration
    : (Number.isFinite(formatDuration) && formatDuration > 0 ? formatDuration : null)
  const nbFrames = Number(stream.nb_frames)
  const estimatedDuration = rawDuration ?? (Number.isFinite(nbFrames) && nbFrames > 0 ? nbFrames / sourceFps : null)
  if (!estimatedDuration || !Number.isFinite(estimatedDuration) || estimatedDuration <= 0) {
    throw spriteDocumentError('unsupported_input', 'Video duration could not be verified from metadata.')
  }
  const durationSec = Number(estimatedDuration.toFixed(4))
  const defaultFps = Math.min(12, Math.max(1, Math.round(sourceFps)))
  const maxSafeWindow = Math.min(
    durationSec,
    MAX_MOTION_VIDEO_SEGMENT_SEC,
    Math.max(0.1, Math.floor((MAX_MOTION_TIMELINE_FRAMES / defaultFps) * 100) / 100),
  )
  const defaultEndSec = Number(Math.min(durationSec, maxSafeWindow).toFixed(2))
  return {
    width,
    height,
    duration_sec: durationSec,
    source_fps: Number(sourceFps.toFixed(4)),
    nb_frames: Number.isSafeInteger(nbFrames) && nbFrames > 0 ? nbFrames : null,
    default_sampling: {
      start_sec: 0,
      end_sec: Math.max(0.05, defaultEndSec),
      sampling_mode: 'fps',
      fps: defaultFps,
      stride: Math.max(1, Math.round(sourceFps / defaultFps)),
    },
  }
}

export function normalizeVideoSamplingParams(query = {}, probe = null) {
  const samplingMode = String(query.sampling_mode || query.samplingMode || 'fps').trim().toLowerCase()
  if (samplingMode !== 'fps' && samplingMode !== 'stride') {
    throw spriteDocumentError('invalid_request', 'sampling_mode must be fps or stride.')
  }
  const startRaw = query.start_sec ?? query.startSec ?? 0
  const endRaw = query.end_sec ?? query.endSec ?? (probe?.default_sampling?.end_sec ?? probe?.duration_sec)
  const startSec = Number(startRaw)
  const endSec = Number(endRaw)
  if (!Number.isFinite(startSec) || startSec < 0) {
    throw spriteDocumentError('invalid_request', 'start_sec must be a non-negative number.')
  }
  if (!Number.isFinite(endSec) || endSec <= startSec) {
    throw spriteDocumentError('invalid_request', 'end_sec must be greater than start_sec.')
  }
  if (probe?.duration_sec) {
    if (startSec >= probe.duration_sec) {
      throw spriteDocumentError('invalid_request', `start_sec (${startSec}s) must be less than video duration (${probe.duration_sec}s).`)
    }
    if (endSec > probe.duration_sec + 0.05) {
      throw spriteDocumentError('invalid_request', `end_sec (${endSec}s) exceeds video duration (${probe.duration_sec}s).`)
    }
  }
  const effectiveEndSec = probe?.duration_sec ? Math.min(endSec, probe.duration_sec) : endSec
  const segmentDurationSec = effectiveEndSec - startSec
  if (segmentDurationSec <= 0) {
    throw spriteDocumentError('invalid_request', 'Selected video segment duration must be positive.')
  }
  if (segmentDurationSec > MAX_MOTION_VIDEO_SEGMENT_SEC) {
    throw spriteDocumentError(
      'resource_limit',
      `Selected video segment (${segmentDurationSec.toFixed(2)}s) exceeds the ${MAX_MOTION_VIDEO_SEGMENT_SEC}s limit.`,
      { limit: MAX_MOTION_VIDEO_SEGMENT_SEC },
    )
  }

  let fps = null
  let stride = null
  if (samplingMode === 'fps') {
    const fpsNum = Number(query.fps ?? probe?.default_sampling?.fps ?? 12)
    if (!Number.isSafeInteger(fpsNum) || fpsNum < 1 || fpsNum > 60) {
      throw spriteDocumentError('invalid_request', 'fps must be an integer between 1 and 60.')
    }
    fps = fpsNum
  } else {
    const strideNum = Number(query.stride ?? probe?.default_sampling?.stride ?? 1)
    if (!Number.isSafeInteger(strideNum) || strideNum < 1 || strideNum > 120) {
      throw spriteDocumentError('invalid_request', 'stride must be an integer between 1 and 120.')
    }
    stride = strideNum
  }

  return {
    start_sec: Number(startSec.toFixed(4)),
    end_sec: Number(effectiveEndSec.toFixed(4)),
    segment_duration_sec: segmentDurationSec,
    sampling_mode: samplingMode,
    fps,
    stride,
  }
}

function parseShowinfoTimestampsSec(stderr = '') {
  const timestamps = []
  for (const line of String(stderr || '').split('\n')) {
    if (!line.includes('pts_time:')) continue
    const match = line.match(/pts_time:\s*([0-9.+-eE]+)/)
    if (match) {
      const value = Number(match[1])
      if (Number.isFinite(value) && value >= 0) timestamps.push(value)
    }
  }
  return timestamps
}

export function computeVideoFrameDurationsMs({
  frameCount,
  samplingMode,
  fps,
  stride,
  sourceFps,
  ptsTimesSec = [],
  startSec = null,
  endSec = null,
  segmentDurationSec = null,
}) {
  if (!Number.isSafeInteger(frameCount) || frameCount < 1) return []
  const effectiveFps = samplingMode === 'fps' ? Number(fps) : Number(sourceFps) / Number(stride)
  if (!Number.isFinite(effectiveFps) || effectiveFps <= 0) {
    throw spriteDocumentError(
      'unsupported_input',
      samplingMode === 'fps'
        ? 'Valid target FPS is required for video duration calculation.'
        : 'Source video FPS is required for stride duration calculation.',
    )
  }

  const resolvedSegmentSec = Number.isFinite(segmentDurationSec) && segmentDurationSec > 0
    ? segmentDurationSec
    : (Number.isFinite(startSec) && Number.isFinite(endSec) && endSec > startSec
      ? endSec - startSec
      : null)

  let relPtsSec = null
  if (Array.isArray(ptsTimesSec) && ptsTimesSec.length >= frameCount) {
    const rawSlice = ptsTimesSec.slice(0, frameCount).map((value) => Number(value))
    if (rawSlice.every((value) => Number.isFinite(value) && value >= 0)) {
      const baseOffsetSec = (Number.isFinite(startSec) && startSec > 0 && rawSlice[0] >= startSec - 1e-3)
        ? startSec
        : rawSlice[0]
      const shifted = rawSlice.map((value) => Math.max(0, value - baseOffsetSec))
      let strictlyIncreasing = true
      for (let i = 1; i < shifted.length; i += 1) {
        if (shifted[i] <= shifted[i - 1] + 1e-6) {
          strictlyIncreasing = false
          break
        }
      }
      if (strictlyIncreasing && (resolvedSegmentSec === null || shifted[shifted.length - 1] < resolvedSegmentSec - 1e-4)) {
        relPtsSec = shifted
      }
    }
  }

  const boundariesSec = new Array(frameCount + 1)
  boundariesSec[0] = 0
  for (let i = 1; i < frameCount; i += 1) {
    boundariesSec[i] = relPtsSec ? relPtsSec[i] : i / effectiveFps
  }
  if (resolvedSegmentSec !== null && resolvedSegmentSec > boundariesSec[frameCount - 1]) {
    boundariesSec[frameCount] = resolvedSegmentSec
  } else {
    boundariesSec[frameCount] = boundariesSec[frameCount - 1] + (1 / effectiveFps)
  }

  const totalSegmentMs = Math.max(frameCount, Math.round(boundariesSec[frameCount] * 1000))
  const cumMs = new Array(frameCount + 1)
  cumMs[0] = 0
  cumMs[frameCount] = totalSegmentMs
  for (let i = 1; i < frameCount; i += 1) {
    const minMs = cumMs[i - 1] + 1
    const maxMs = totalSegmentMs - (frameCount - i)
    const roundedMs = Math.round(boundariesSec[i] * 1000)
    cumMs[i] = Math.min(maxMs, Math.max(minMs, roundedMs))
  }

  const durations = []
  for (let i = 0; i < frameCount; i += 1) {
    durations.push(Math.min(60000, Math.max(1, cumMs[i + 1] - cumMs[i])))
  }
  return durations
}

export async function extractVideoTimelineFrames(videoPath, {
  sampling: rawSampling = {},
  probe: existingProbe = null,
  signal = null,
  probeRunner = runGuardedTool,
  ffmpegRunner = runGuardedTool,
  env = process.env,
  maxFrames = MAX_MOTION_TIMELINE_FRAMES,
  maxDimension = MAX_MOTION_FRAME_DIMENSION,
  maxFramePixels = MAX_MOTION_FRAME_PIXELS,
  maxExpandedRgbaBytes = MAX_MOTION_EXPANDED_RGBA_BYTES,
} = {}) {
  throwIfAborted(signal)
  const probe = existingProbe || await probeVideoFile(videoPath, {
    signal,
    probeRunner,
    env,
    maxDimension,
    maxFramePixels,
  })
  const sampling = normalizeVideoSamplingParams(rawSampling, probe)
  const effectiveRate = sampling.sampling_mode === 'fps'
    ? sampling.fps
    : probe.source_fps / sampling.stride
  const estimatedFrames = Math.floor(sampling.segment_duration_sec * effectiveRate + 1e-6)
  if (estimatedFrames > maxFrames) {
    throw spriteDocumentError(
      'resource_limit',
      sampling.sampling_mode === 'fps'
        ? `Selected segment (${sampling.segment_duration_sec.toFixed(2)}s at ${sampling.fps} fps) would produce ~${estimatedFrames} frames, exceeding the ${maxFrames}-frame limit. Choose a shorter segment or lower FPS.`
        : `Selected segment (${sampling.segment_duration_sec.toFixed(2)}s with stride ${sampling.stride}) would produce ~${estimatedFrames} frames, exceeding the ${maxFrames}-frame limit. Choose a shorter segment or larger stride.`,
      { limit: maxFrames, estimated_frames: estimatedFrames },
    )
  }
  if (Math.max(1, estimatedFrames) * probe.width * probe.height * 4 > maxExpandedRgbaBytes) {
    throw spriteDocumentError(
      'resource_limit',
      `Selected video frames exceed the ${Math.round(maxExpandedRgbaBytes / (1024 * 1024))} MiB expanded pixel budget.`,
      { limit: maxExpandedRgbaBytes },
    )
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'gametool-motion-video-'))
  try {
    const ffmpegPath = resolveVideoBinaryPath('ffmpeg', env)
    const vf = sampling.sampling_mode === 'stride'
      ? `select='not(mod(n\\,${sampling.stride}))',showinfo`
      : `fps=${sampling.fps},showinfo`
    const args = [
      '-hide_banner',
      '-loglevel', 'info',
      '-nostdin',
      '-y',
      '-ss', String(sampling.start_sec),
      '-to', String(sampling.end_sec),
      '-i', videoPath,
      '-map', '0:v:0',
      '-vf', vf,
      ...(sampling.sampling_mode === 'stride' ? ['-vsync', 'vfr'] : []),
      '-frames:v', String(maxFrames + 1),
      path.join(tempDir, 'frame_%05d.png'),
    ]
    let runResult
    try {
      runResult = await ffmpegRunner(ffmpegPath, args, {
        tool: 'ffmpeg',
        timeoutMs: VIDEO_EXTRACT_TIMEOUT_MS,
        maxRssMiB: VIDEO_TOOL_MAX_RSS_MIB,
        maxOutputBytes: 256 * 1024,
        signal,
      })
    } catch (error) {
      throw mapToolError(error, 'Video frames could not be extracted by ffmpeg.')
    }
    throwIfAborted(signal)

    const entries = (await readdir(tempDir))
      .filter((name) => /^frame_\d+\.png$/i.test(name))
      .sort()
    if (!entries.length) {
      throw spriteDocumentError('unsupported_input', 'No frames were found in the selected video segment.')
    }
    if (entries.length > maxFrames) {
      throw spriteDocumentError(
        'resource_limit',
        `Selected video segment produced more than ${maxFrames} frames. Choose a shorter segment, lower FPS, or larger stride; frames were not truncated.`,
        { limit: maxFrames },
      )
    }

    const ptsTimesSec = parseShowinfoTimestampsSec(runResult?.stderr ?? runResult?.stderr_tail)
    const durationsMs = computeVideoFrameDurationsMs({
      frameCount: entries.length,
      samplingMode: sampling.sampling_mode,
      fps: sampling.fps,
      stride: sampling.stride,
      sourceFps: probe.source_fps,
      ptsTimesSec,
      startSec: sampling.start_sec,
      endSec: sampling.end_sec,
      segmentDurationSec: sampling.segment_duration_sec,
    })

    const frames = []
    let elapsedMs = Math.round(sampling.start_sec * 1000)
    let cumulativeRgbaBytes = 0

    for (let index = 0; index < entries.length; index += 1) {
      throwIfAborted(signal)
      const filePath = path.join(tempDir, entries[index])
      const pngBytes = await readFile(filePath)
      const decoded = await sharp(pngBytes, { limitInputPixels: maxFramePixels })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true })
      const width = decoded.info.width
      const height = decoded.info.height
      if (width !== probe.width || height !== probe.height) {
        throw spriteDocumentError('artifact_integrity_failed', 'Extracted video frame dimensions do not match source stream dimensions.')
      }
      cumulativeRgbaBytes += width * height * 4
      if (cumulativeRgbaBytes > maxExpandedRgbaBytes) {
        throw spriteDocumentError(
          'resource_limit',
          `Extracted video frames exceed the ${Math.round(maxExpandedRgbaBytes / (1024 * 1024))} MiB expanded pixel budget.`,
          { limit: maxExpandedRgbaBytes, bytes: cumulativeRgbaBytes },
        )
      }
      const durationMs = durationsMs[index]
      frames.push({
        index,
        width,
        height,
        duration_ms: durationMs,
        timestamp_ms: elapsedMs,
        rgba: Buffer.from(decoded.data),
      })
      elapsedMs += durationMs
    }

    return {
      kind: 'video',
      width: probe.width,
      height: probe.height,
      frame_count: frames.length,
      total_duration_ms: durationsMs.reduce((sum, d) => sum + d, 0),
      probe,
      sampling: {
        start_sec: sampling.start_sec,
        end_sec: sampling.end_sec,
        sampling_mode: sampling.sampling_mode,
        fps: sampling.fps,
        stride: sampling.stride,
      },
      frames,
    }
  } finally {
    // Keep OS temporary directories untouched per File Deletion Safety rules.
  }
}

export function samplingCacheKey(sampling) {
  if (!sampling) return 'gif_native'
  return `${sampling.start_sec}:${sampling.end_sec}:${sampling.sampling_mode}:${sampling.fps ?? ''}:${sampling.stride ?? ''}`
}

async function evictOldStagedSources() {
  while (stagedSources.size > MAX_STAGED_SOURCES) {
    const oldestKey = stagedSources.keys().next().value
    if (!oldestKey) break
    stagedSources.delete(oldestKey)
  }
}

export function clearStagedMotionSources() {
  stagedSources.clear()
}

export async function stageMotionSource({
  projectId,
  expectedSha256,
  sourceBytes,
  fileName = '',
}) {
  const key = `${projectId}:${expectedSha256}`
  if (Buffer.isBuffer(sourceBytes) && sourceBytes.length > 0) {
    const actualSha = sha256Bytes(sourceBytes)
    if (actualSha !== expectedSha256) {
      throw spriteDocumentError('artifact_integrity_failed', 'Uploaded motion source hash does not match expected_sha256.')
    }
    const classification = classifyMotionSource(sourceBytes, fileName)
    const maxBytes = classification.kind === 'gif' ? MAX_MOTION_GIF_BYTES : MAX_MOTION_VIDEO_BYTES
    if (sourceBytes.length > maxBytes) {
      throw spriteDocumentError('resource_limit', `Motion source exceeds ${Math.round(maxBytes / (1024 * 1024))} MiB limit.`)
    }
    const existing = stagedSources.get(key)
    if (existing) {
      stagedSources.delete(key)
      stagedSources.set(key, existing)
      return existing
    }
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'gametool-motion-stage-'))
    const filePath = path.join(tempDir, `source.${classification.ext}`)
    await writeFile(filePath, sourceBytes)
    const entry = {
      key,
      projectId,
      sha256: expectedSha256,
      kind: classification.kind,
      ext: classification.ext,
      mimeType: classification.mimeType,
      fileName: fileName || `source.${classification.ext}`,
      byteLength: sourceBytes.length,
      tempDir,
      filePath,
      bytes: classification.kind === 'gif' ? Buffer.from(sourceBytes) : null,
      probe: null,
      previews: new Map(),
    }
    stagedSources.set(key, entry)
    await evictOldStagedSources()
    return entry
  }
  const existing = stagedSources.get(key)
  if (!existing) {
    throw spriteDocumentError('invalid_request', 'Motion source is not staged; re-select the file and preview again.')
  }
  stagedSources.delete(key)
  stagedSources.set(key, existing)
  return existing
}

export async function resolveStagedMotionExtraction(entry, query = {}, options = {}) {
  throwIfAborted(options.signal)
  if (entry.kind === 'gif') {
    const cacheKey = 'gif_native'
    if (entry.previews.has(cacheKey)) {
      return entry.previews.get(cacheKey)
    }
    const sourceBuffer = entry.bytes || await readFile(entry.filePath)
    const extracted = decodeGifTimelineFrames(sourceBuffer, options)
    entry.previews.set(cacheKey, extracted)
    return extracted
  }
  if (!entry.probe) {
    entry.probe = await probeVideoFile(entry.filePath, options)
  }
  const normalized = normalizeVideoSamplingParams(query, entry.probe)
  const cacheKey = samplingCacheKey(normalized)
  if (entry.previews.has(cacheKey)) {
    return entry.previews.get(cacheKey)
  }
  const extracted = await extractVideoTimelineFrames(entry.filePath, {
    ...options,
    probe: entry.probe,
    sampling: normalized,
  })
  while (entry.previews.size >= 2) {
    const oldest = entry.previews.keys().next().value
    if (!oldest) break
    entry.previews.delete(oldest)
  }
  entry.previews.set(cacheKey, extracted)
  return extracted
}

export async function formatMotionPreviewResponse(entry, extracted, { signal = null } = {}) {
  const frames = []
  for (const frame of extracted.frames) {
    throwIfAborted(signal)
    if (!frame.png_base64) {
      const pngBuffer = await sharp(frame.rgba, {
        raw: { width: frame.width, height: frame.height, channels: 4 },
      })
        .png({ compressionLevel: 6 })
        .toBuffer()
      frame.png_base64 = pngBuffer.toString('base64')
    }
    frames.push({
      index: frame.index,
      width: frame.width,
      height: frame.height,
      duration_ms: frame.duration_ms,
      timestamp_ms: frame.timestamp_ms,
      png_base64: frame.png_base64,
    })
  }
  return {
    preview: true,
    kind: entry.kind,
    source_sha256: entry.sha256,
    file_name: entry.fileName,
    width: extracted.width,
    height: extracted.height,
    frame_count: extracted.frame_count,
    total_duration_ms: extracted.total_duration_ms,
    probe: extracted.probe || entry.probe || null,
    sampling: extracted.sampling || null,
    frames,
  }
}
