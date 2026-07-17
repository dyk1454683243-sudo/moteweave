import { mkdir, readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'

import sharp from 'sharp'
import JSZip from 'jszip'

import {
  EXTERNAL_TOOL_FAILURE,
  createExternalToolError,
  runGuardedTool,
  throwIfExternalToolAborted,
} from '../motion-source/guardedToolRunner.js'
import {
  createMotionDecodeBudget,
  MotionDecodeBudgetError,
} from '../motion-source/decodeBudget.js'

// Provider-free frame decoding. GIF, image, and frame-sequence ZIP inputs use
// existing libraries; video uses an optional user-installed FFmpeg executable.
// No native binary or model is bundled by this project.

const IMAGE_ENTRY_PATTERN = /\.(png|jpe?g|webp|bmp)$/i
const VIDEO_NAME_PATTERN = /\.(mp4|mov|webm|mkv|avi|m4v)$/i
const VIDEO_FRAME_PATTERN = /^frame_\d{5}\.png$/i
const ZIP_EOCD_SIGNATURE = 0x06054b50
const ZIP_CENTRAL_FILE_SIGNATURE = 0x02014b50
const ZIP_MAX_COMMENT_BYTES = 0xffff
const MIB = 1024 * 1024

export const FFMPEG_EXTRACTION_LIMITS = Object.freeze({
  maxRssMiB: 1536,
  timeoutMs: 120_000,
  pollIntervalMs: 1000,
  maxFrames: 64,
  maxFrameDimension: 4096,
  maxFrameOutputBytes: 80 * MIB,
  maxTotalOutputBytes: 320 * MIB,
  maxSourceWindowSec: 120,
  maxThreads: 2,
})

export function detectFrameSourceKind(name = '', buffer = null) {
  const lower = String(name).toLowerCase()
  if (lower.endsWith('.zip')) return 'zip'
  if (lower.endsWith('.gif')) return 'gif'
  if (VIDEO_NAME_PATTERN.test(lower)) return 'video'
  if (IMAGE_ENTRY_PATTERN.test(lower)) return 'image'
  if (buffer && buffer.length >= 4) {
    if (buffer[0] === 0x50 && buffer[1] === 0x4b) return 'zip' // "PK" zip header
    if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return 'gif' // "GIF" header
  }
  return 'image'
}

function decodeBudget(value, limits) {
  return value ?? createMotionDecodeBudget({ limits })
}

function zipPreflightError(message, {
  budget = 'zip_central_directory',
  actual = 1,
  limit = 0,
} = {}) {
  return new MotionDecodeBudgetError(budget, actual, limit, message)
}

function findZipEndOfCentralDirectory(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) {
    throw zipPreflightError('ZIP end-of-central-directory record is missing')
  }
  const lowerBound = Math.max(0, buffer.length - 22 - ZIP_MAX_COMMENT_BYTES)
  for (let offset = buffer.length - 22; offset >= lowerBound; offset -= 1) {
    if (buffer.readUInt32LE(offset) !== ZIP_EOCD_SIGNATURE) continue
    const commentLength = buffer.readUInt16LE(offset + 20)
    if (offset + 22 + commentLength === buffer.length) return offset
  }
  throw zipPreflightError('ZIP end-of-central-directory record is malformed')
}

function preflightZipCentralDirectory(buffer, budget) {
  const eocdOffset = findZipEndOfCentralDirectory(buffer)
  const diskNumber = buffer.readUInt16LE(eocdOffset + 4)
  const centralDirectoryDisk = buffer.readUInt16LE(eocdOffset + 6)
  const entriesOnDisk = buffer.readUInt16LE(eocdOffset + 8)
  const totalEntries = buffer.readUInt16LE(eocdOffset + 10)
  const centralDirectorySize = buffer.readUInt32LE(eocdOffset + 12)
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16)
  if (
    entriesOnDisk === 0xffff ||
    totalEntries === 0xffff ||
    centralDirectorySize === 0xffffffff ||
    centralDirectoryOffset === 0xffffffff
  ) {
    throw zipPreflightError('Zip64 archives are not supported by the bounded Motion decoder')
  }
  if (
    diskNumber !== 0 ||
    centralDirectoryDisk !== 0 ||
    entriesOnDisk !== totalEntries
  ) {
    throw zipPreflightError('multi-disk ZIP archives are not supported')
  }
  const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize
  if (
    !Number.isSafeInteger(centralDirectoryEnd) ||
    centralDirectoryOffset < 0 ||
    centralDirectoryEnd !== eocdOffset
  ) {
    throw zipPreflightError('ZIP central-directory bounds are inconsistent')
  }

  let cursor = centralDirectoryOffset
  let parsedEntries = 0
  let totalUncompressedBytes = 0
  while (cursor < centralDirectoryEnd) {
    if (
      cursor + 46 > centralDirectoryEnd ||
      buffer.readUInt32LE(cursor) !== ZIP_CENTRAL_FILE_SIGNATURE
    ) {
      throw zipPreflightError('ZIP central-directory entry is malformed')
    }
    const uncompressedBytes = buffer.readUInt32LE(cursor + 24)
    const fileNameLength = buffer.readUInt16LE(cursor + 28)
    const extraLength = buffer.readUInt16LE(cursor + 30)
    const commentLength = buffer.readUInt16LE(cursor + 32)
    const startDisk = buffer.readUInt16LE(cursor + 34)
    const localHeaderOffset = buffer.readUInt32LE(cursor + 42)
    if (
      uncompressedBytes === 0xffffffff ||
      localHeaderOffset === 0xffffffff ||
      startDisk !== 0
    ) {
      throw zipPreflightError('Zip64 or multi-disk ZIP entries are not supported')
    }
    const entryLength = 46 + fileNameLength + extraLength + commentLength
    const nextCursor = cursor + entryLength
    if (
      !Number.isSafeInteger(nextCursor) ||
      entryLength < 46 ||
      nextCursor > centralDirectoryEnd
    ) {
      throw zipPreflightError('ZIP central-directory entry length is invalid')
    }
    parsedEntries += 1
    if (uncompressedBytes > Number.MAX_SAFE_INTEGER - totalUncompressedBytes) {
      throw zipPreflightError('ZIP uncompressed byte accounting overflow', {
        budget: 'zip_uncompressed_bytes',
        actual: Number.MAX_SAFE_INTEGER,
        limit: budget.limits.zip_uncompressed_bytes,
      })
    }
    totalUncompressedBytes += uncompressedBytes
    budget.assertZipArchive({
      entryCount: parsedEntries,
      totalUncompressedBytes,
    })
    cursor = nextCursor
  }
  if (cursor !== centralDirectoryEnd || parsedEntries !== totalEntries) {
    throw zipPreflightError('ZIP central-directory entry count is inconsistent')
  }
  return {
    entryCount: parsedEntries,
    totalUncompressedBytes,
  }
}

async function loadImageWithBudget(buffer, budget, { signal, source = 'image' } = {}) {
  throwIfExternalToolAborted(signal, { tool: 'motion_decode', source })
  const metadata = await sharp(buffer).metadata()
  budget.recordDecodedFrame({ width: metadata.width, height: metadata.height })
  throwIfExternalToolAborted(signal, { tool: 'motion_decode', source })
  const { data, info } = await sharp(buffer, {
    limitInputPixels: budget.limits.frame_pixels,
  })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  throwIfExternalToolAborted(signal, { tool: 'motion_decode', source })
  return {
    width: info.width,
    height: info.height,
    data: new Uint8ClampedArray(data),
  }
}

async function readZipEntryWithActualByteLimit(entry, {
  budget,
  signal,
  retain,
  actualTotal,
} = {}) {
  const stream = entry.internalStream('nodebuffer')
  const chunks = retain ? [] : null
  let entryBytes = 0
  return new Promise((resolve, reject) => {
    let settled = false
    const removeAbortListener = () => {
      if (signal) signal.removeEventListener('abort', onAbort)
    }
    const fail = (error) => {
      if (settled) return
      settled = true
      stream.pause()
      removeAbortListener()
      reject(error)
    }
    const onAbort = () => {
      try {
        throwIfExternalToolAborted(signal, {
          tool: 'motion_decode',
          source: 'zip',
          entry: entry.name,
        })
      } catch (error) {
        fail(error)
      }
    }
    if (signal) signal.addEventListener('abort', onAbort, { once: true })
    stream
      .on('data', (chunk) => {
        if (settled) return
        try {
          throwIfExternalToolAborted(signal, {
            tool: 'motion_decode',
            source: 'zip',
            entry: entry.name,
          })
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
          if (
            bytes.length > Number.MAX_SAFE_INTEGER - entryBytes ||
            bytes.length > Number.MAX_SAFE_INTEGER - actualTotal.bytes
          ) {
            throw new MotionDecodeBudgetError(
              'zip_uncompressed_bytes',
              Number.MAX_SAFE_INTEGER,
              budget.limits.zip_uncompressed_bytes,
              'ZIP actual uncompressed byte accounting overflow'
            )
          }
          const nextTotal = actualTotal.bytes + bytes.length
          if (nextTotal > budget.limits.zip_uncompressed_bytes) {
            throw new MotionDecodeBudgetError(
              'zip_uncompressed_bytes',
              nextTotal,
              budget.limits.zip_uncompressed_bytes,
              'ZIP actual uncompressed payload exceeds the Motion decode budget'
            )
          }
          entryBytes += bytes.length
          actualTotal.bytes = nextTotal
          if (chunks) chunks.push(bytes)
        } catch (error) {
          fail(error)
        }
      })
      .on('error', fail)
      .on('end', () => {
        if (settled) return
        try {
          budget.recordZipEntry({ uncompressedBytes: entryBytes })
          settled = true
          removeAbortListener()
          resolve(chunks ? Buffer.concat(chunks, entryBytes) : null)
        } catch (error) {
          fail(error)
        }
      })
      .resume()
    if (signal?.aborted) onAbort()
  })
}

export async function extractFramesFromZip(buffer, {
  budget: budgetInput,
  decodeLimits,
  signal,
  frameProvenance = null,
} = {}) {
  const budget = decodeBudget(budgetInput, decodeLimits)
  throwIfExternalToolAborted(signal, { tool: 'motion_decode', source: 'zip' })
  preflightZipCentralDirectory(buffer, budget)
  throwIfExternalToolAborted(signal, { tool: 'motion_decode', source: 'zip' })
  const zip = await JSZip.loadAsync(buffer)
  throwIfExternalToolAborted(signal, { tool: 'motion_decode', source: 'zip' })
  const fileEntries = Object.values(zip.files).filter((entry) => !entry.dir)
  const actualTotal = { bytes: 0 }
  const decodedEntries = []
  for (const entry of fileEntries) {
    const retain = IMAGE_ENTRY_PATTERN.test(entry.name)
    const data = await readZipEntryWithActualByteLimit(entry, {
      budget,
      signal,
      retain,
      actualTotal,
    })
    if (retain) decodedEntries.push({ name: entry.name, data })
  }
  const entries = decodedEntries
    // Numeric-aware sort so frame_2 precedes frame_10 instead of lexical ordering.
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
  const frames = []
  for (const entry of entries) {
    throwIfExternalToolAborted(signal, {
      tool: 'motion_decode',
      source: 'zip',
      entry: entry.name,
    })
    frames.push(await loadImageWithBudget(entry.data, budget, {
      signal,
      source: `zip:${entry.name}`,
    }))
    if (Array.isArray(frameProvenance)) {
      const rawIndex = frames.length - 1
      frameProvenance.push({
        candidate_index: rawIndex,
        raw_index: rawIndex,
        timestamp_ms: null,
        duration_ms: null,
        timing_source: 'unavailable',
        source_entry: entry.name,
      })
    }
  }
  return frames
}

export async function extractFramesFromGif(buffer, {
  budget: budgetInput,
  decodeLimits,
  signal,
  frameProvenance = null,
} = {}) {
  const budget = decodeBudget(budgetInput, decodeLimits)
  // Each page is read as a fully rendered frame. GIFs that use partial-frame
  // disposal optimization are an arbitrary-source edge case left for the FFmpeg
  // path; sheets exported by this project (gifExport.js) write full frames.
  throwIfExternalToolAborted(signal, { tool: 'motion_decode', source: 'gif' })
  const meta = await sharp(buffer, { animated: true }).metadata()
  const pageCount = Math.max(1, meta.pages ?? 1)
  const delays = Array.isArray(meta.delay) ? meta.delay : []
  budget.assertPageCount(pageCount)
  throwIfExternalToolAborted(signal, { tool: 'motion_decode', source: 'gif' })
  const frames = []
  let elapsedMs = 0
  let timestampKnown = true
  for (let page = 0; page < pageCount; page += 1) {
    throwIfExternalToolAborted(signal, {
      tool: 'motion_decode',
      source: 'gif',
      page,
    })
    const image = sharp(buffer, {
      page,
      limitInputPixels: budget.limits.frame_pixels,
    }).ensureAlpha()
    const pageMeta = await image.metadata()
    budget.recordDecodedFrame({ width: pageMeta.width, height: pageMeta.height })
    throwIfExternalToolAborted(signal, {
      tool: 'motion_decode',
      source: 'gif',
      page,
    })
    const data = await image.raw().toBuffer()
    frames.push({
      width: pageMeta.width,
      height: pageMeta.height,
      data: new Uint8ClampedArray(data),
    })
    if (Array.isArray(frameProvenance)) {
      const delayValue = delays[page]
      const rawDelay = delayValue === null || delayValue === undefined || delayValue === ''
        ? Number.NaN
        : Number(delayValue)
      const durationMs = Number.isFinite(rawDelay) && rawDelay >= 0
        ? rawDelay
        : null
      frameProvenance.push({
        candidate_index: page,
        raw_index: page,
        timestamp_ms: timestampKnown && durationMs !== null ? elapsedMs : null,
        duration_ms: durationMs,
        timing_source: durationMs !== null ? 'exact' : 'unavailable',
        source_entry: null,
      })
      if (durationMs === null) {
        timestampKnown = false
      } else {
        elapsedMs += durationMs
      }
    }
  }
  throwIfExternalToolAborted(signal, { tool: 'motion_decode', source: 'gif' })
  return frames
}

export function resolveFfmpegPath(env = process.env) {
  return env.FFMPEG_PATH || env.ffmpegPath || 'ffmpeg'
}

function assertVideoOutputDir(outputDir) {
  if (!outputDir) {
    throw new Error('video frame extraction requires an outputDir for extracted PNG frames')
  }
}

function videoFrameName(index) {
  return `frame_${String(index).padStart(5, '0')}.png`
}

function boundedVideoFrameRate(fps) {
  return Math.min(60, Math.max(1, Math.round(Number(fps) || 12)))
}

function boundedVideoStartSec(startSec) {
  return Math.max(0, Number(startSec) || 0)
}

function boundedVideoFrameCount(maxFrames) {
  const requested = Number(maxFrames)
  if (!Number.isFinite(requested)) return FFMPEG_EXTRACTION_LIMITS.maxFrames
  return Math.min(
    FFMPEG_EXTRACTION_LIMITS.maxFrames,
    Math.max(1, Math.round(requested))
  )
}

function boundedVideoDuration({ startSec, endSec, frameRate, maxFrames }) {
  const requestedDuration =
    Number.isFinite(Number(endSec)) && Number(endSec) > startSec
      ? Number(endSec) - startSec
      : maxFrames / frameRate
  return Math.min(
    FFMPEG_EXTRACTION_LIMITS.maxSourceWindowSec,
    Math.max(1 / frameRate, requestedDuration)
  )
}

function ffmpegArgsForVideoFrames(inputPath, outputDir, {
  fps = 12,
  startSec = 0,
  endSec,
  maxFrames = FFMPEG_EXTRACTION_LIMITS.maxFrames,
  maxFrameDimension = FFMPEG_EXTRACTION_LIMITS.maxFrameDimension,
} = {}) {
  const frameRate = boundedVideoFrameRate(fps)
  const frameCount = boundedVideoFrameCount(maxFrames)
  const start = boundedVideoStartSec(startSec)
  const duration = boundedVideoDuration({
    startSec: start,
    endSec,
    frameRate,
    maxFrames: frameCount,
  })
  const args = [
    '-nostdin',
    '-y',
    '-threads',
    String(FFMPEG_EXTRACTION_LIMITS.maxThreads),
    '-filter_threads',
    String(FFMPEG_EXTRACTION_LIMITS.maxThreads),
  ]
  if (start > 0) args.push('-ss', String(start))
  args.push('-i', inputPath)
  args.push('-t', String(duration))
  args.push(
    '-vf',
    `fps=${frameRate},scale=w='min(iw,${maxFrameDimension})':h='min(ih,${maxFrameDimension})':force_original_aspect_ratio=decrease`
  )
  args.push('-frames:v', String(frameCount))
  args.push('-threads:v', String(FFMPEG_EXTRACTION_LIMITS.maxThreads))
  args.push(path.join(outputDir, 'frame_%05d.png'))
  return args
}

function videoNormalizationBudget(budget, maxFrames) {
  const plannedFrameCount = boundedVideoFrameCount(maxFrames)
  const aggregatePixels = Math.floor(
    budget.limits.aggregate_rgba_bytes / 4 / plannedFrameCount
  )
  const maxFramePixels = Math.max(
    1,
    Math.min(budget.limits.frame_pixels, aggregatePixels)
  )
  const maxFrameDimension = Math.max(
    1,
    Math.min(
      FFMPEG_EXTRACTION_LIMITS.maxFrameDimension,
      Math.floor(Math.sqrt(maxFramePixels))
    )
  )
  return {
    plannedFrameCount,
    maxFramePixels,
    maxFrameDimension,
  }
}

async function inspectVideoFrameOutputs(entries, outputDir, {
  signal,
  maxFrameOutputBytes,
  maxTotalOutputBytes,
} = {}) {
  let totalOutputBytes = 0
  const inspected = []
  for (const entry of entries) {
    throwIfExternalToolAborted(signal, {
      tool: 'ffmpeg',
      stage: 'inspect_output',
      entry,
    })
    const filePath = path.join(outputDir, entry)
    const fileStat = await stat(filePath)
    if (!fileStat.isFile()) continue
    if (!Number.isSafeInteger(fileStat.size) || fileStat.size < 0) {
      throw new MotionDecodeBudgetError(
        'extracted_frame_output_bytes',
        Number.MAX_SAFE_INTEGER,
        maxFrameOutputBytes,
        'FFmpeg output file size is outside the supported integer range'
      )
    }
    if (fileStat.size > maxFrameOutputBytes) {
      throw new MotionDecodeBudgetError(
        'extracted_frame_output_bytes',
        fileStat.size,
        maxFrameOutputBytes
      )
    }
    if (fileStat.size > Number.MAX_SAFE_INTEGER - totalOutputBytes) {
      throw new MotionDecodeBudgetError(
        'extracted_output_bytes',
        Number.MAX_SAFE_INTEGER,
        maxTotalOutputBytes,
        'FFmpeg output byte accounting overflow'
      )
    }
    totalOutputBytes += fileStat.size
    if (totalOutputBytes > maxTotalOutputBytes) {
      throw new MotionDecodeBudgetError(
        'extracted_output_bytes',
        totalOutputBytes,
        maxTotalOutputBytes
      )
    }
    inspected.push({ entry, filePath, byteLength: fileStat.size })
  }
  return { entries: inspected, totalOutputBytes }
}

export async function extractFramesFromVideoFile(inputPath, {
  outputDir,
  fps = 12,
  startSec = 0,
  endSec,
  maxFrames = FFMPEG_EXTRACTION_LIMITS.maxFrames,
  ffmpegPath = resolveFfmpegPath(),
  runner = runGuardedTool,
  signal,
  toolLimits = {},
  budget: budgetInput,
  decodeLimits,
} = {}) {
  const budget = decodeBudget(budgetInput, decodeLimits)
  if (!inputPath) throw new Error('video frame extraction requires an inputPath')
  assertVideoOutputDir(outputDir)
  throwIfExternalToolAborted(signal, { tool: 'ffmpeg' })
  await mkdir(outputDir, { recursive: true })
  const normalization = videoNormalizationBudget(budget, maxFrames)
  const args = ffmpegArgsForVideoFrames(inputPath, outputDir, {
    fps,
    startSec,
    endSec,
    maxFrames,
    maxFrameDimension: normalization.maxFrameDimension,
  })
  try {
    await runner(ffmpegPath, args, {
      tool: 'ffmpeg',
      signal,
      maxRssMiB: toolLimits.maxRssMiB ?? FFMPEG_EXTRACTION_LIMITS.maxRssMiB,
      timeoutMs: toolLimits.timeoutMs ?? FFMPEG_EXTRACTION_LIMITS.timeoutMs,
      pollIntervalMs: toolLimits.pollIntervalMs ?? FFMPEG_EXTRACTION_LIMITS.pollIntervalMs,
      terminationGraceMs: toolLimits.terminationGraceMs,
      maxOutputBytes: toolLimits.maxOutputBytes,
      deadlineAt: toolLimits.deadlineAt,
    })
  } catch (error) {
    if (String(error?.code ?? '').startsWith('external_tool_')) throw error
    const reason = String(error?.message || error)
    throw createExternalToolError(
      EXTERNAL_TOOL_FAILURE.FAILED,
      `ffmpeg frame extraction failed: ${reason}`,
      { tool: 'ffmpeg' }
    )
  }
  throwIfExternalToolAborted(signal, { tool: 'ffmpeg' })
  const entries = (await readdir(outputDir))
    .filter((name) => VIDEO_FRAME_PATTERN.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
  budget.assertExtractedFrameCount(entries.length)
  const maxFrameOutputBytes = Math.floor(
    Number(toolLimits.maxFrameOutputBytes ?? FFMPEG_EXTRACTION_LIMITS.maxFrameOutputBytes)
  )
  const maxTotalOutputBytes = Math.floor(
    Number(toolLimits.maxTotalOutputBytes ?? FFMPEG_EXTRACTION_LIMITS.maxTotalOutputBytes)
  )
  if (
    !Number.isSafeInteger(maxFrameOutputBytes) ||
    maxFrameOutputBytes <= 0 ||
    !Number.isSafeInteger(maxTotalOutputBytes) ||
    maxTotalOutputBytes <= 0
  ) {
    throw new TypeError('FFmpeg output byte limits must be positive safe integers')
  }
  const inspected = await inspectVideoFrameOutputs(entries, outputDir, {
    signal,
    maxFrameOutputBytes,
    maxTotalOutputBytes,
  })
  const frames = []
  const frameProvenance = []
  const frameRate = boundedVideoFrameRate(fps)
  const sourceStartMs = boundedVideoStartSec(startSec) * 1000
  const frameDurationMs = 1000 / frameRate
  for (const [rawIndex, entry] of inspected.entries.entries()) {
    throwIfExternalToolAborted(signal, { tool: 'ffmpeg' })
    frames.push(await loadImageWithBudget(await readFile(entry.filePath), budget, {
      signal,
      source: `video:${entry.entry}`,
    }))
    frameProvenance.push({
      candidate_index: rawIndex,
      raw_index: rawIndex,
      timestamp_ms: sourceStartMs + rawIndex * frameDurationMs,
      duration_ms: frameDurationMs,
      timing_source: 'derived_sampling',
      source_entry: entry.entry,
    })
  }
  if (!frames.length) throw new Error('ffmpeg completed but no PNG frames were extracted')
  return {
    kind: 'video',
    frame_count_raw: frames.length,
    frame_count: frames.length,
    frames,
    frame_provenance: frameProvenance,
    ffmpeg: {
      path: ffmpegPath,
      args,
      output_dir: outputDir,
      first_frame: videoFrameName(1),
      normalization: {
        mode: 'bounded_scale_v1',
        planned_frame_count: normalization.plannedFrameCount,
        max_frame_pixels: normalization.maxFramePixels,
        max_frame_dimension: normalization.maxFrameDimension,
        aggregate_rgba_byte_budget: budget.limits.aggregate_rgba_bytes,
        preserves_aspect_ratio: true,
      },
      output_bytes: {
        total: inspected.totalOutputBytes,
        max_per_frame: maxFrameOutputBytes,
        max_total: maxTotalOutputBytes,
      },
    },
  }
}

export function sampleFrames(frames, { stride = 1, maxFrames = Infinity } = {}) {
  const step = Math.max(1, Math.round(stride))
  if (step === 1 && frames.length <= maxFrames) return frames.slice()
  const sampled = []
  for (let index = 0; index < frames.length && sampled.length < maxFrames; index += step) {
    sampled.push(frames[index])
  }
  return sampled
}

export async function extractFrames(buffer, {
  kind = 'auto',
  name = '',
  stride = 1,
  maxFrames = Infinity,
  inputPath,
  videoOutputDir,
  fps,
  startSec,
  endSec,
  ffmpegPath,
  runner,
  signal,
  toolLimits,
  decodeBudget: decodeBudgetInput,
  decodeLimits,
} = {}) {
  const resolvedKind = kind === 'auto' ? detectFrameSourceKind(name, buffer) : kind
  if (resolvedKind !== 'video' && (!buffer || !buffer.length)) throw new Error('frame source buffer is empty')
  const budget = decodeBudget(decodeBudgetInput, decodeLimits)
  let frames
  let frameProvenance = []
  let videoResult = null
  switch (resolvedKind) {
    case 'zip':
      frames = await extractFramesFromZip(buffer, {
        budget,
        signal,
        frameProvenance,
      })
      break
    case 'gif':
      frames = await extractFramesFromGif(buffer, {
        budget,
        signal,
        frameProvenance,
      })
      break
    case 'image':
      frames = [await loadImageWithBudget(buffer, budget, {
        signal,
        source: 'image',
      })]
      frameProvenance = [{
        candidate_index: 0,
        raw_index: 0,
        timestamp_ms: null,
        duration_ms: null,
        timing_source: 'unavailable',
        source_entry: name || null,
      }]
      break
    case 'video':
      if (!inputPath) {
        throw new Error('video frame extraction requires ffmpeg plus an inputPath; convert to GIF or a frame-sequence ZIP first, or pass inputPath/videoOutputDir')
      }
      videoResult = await extractFramesFromVideoFile(inputPath, {
        outputDir: videoOutputDir,
        fps,
        startSec,
        endSec,
        maxFrames,
        ffmpegPath,
        runner,
        signal,
        toolLimits,
        budget,
      })
      frames = videoResult.frames
      frameProvenance = videoResult.frame_provenance
      break
    default:
      throw new Error(`unsupported frame source kind: ${resolvedKind}`)
  }
  throwIfExternalToolAborted(signal, { tool: 'motion_decode', source: resolvedKind })
  if (!frames.length) throw new Error(`no frames found in ${resolvedKind} source`)
  const sampledRecords = sampleFrames(
    frames.map((frame, rawIndex) => ({
      frame,
      provenance: frameProvenance[rawIndex] ?? {
        candidate_index: rawIndex,
        raw_index: rawIndex,
        timestamp_ms: null,
        duration_ms: null,
        timing_source: 'unavailable',
        source_entry: null,
      },
    })),
    { stride, maxFrames }
  )
  const sampled = sampledRecords.map((record) => record.frame)
  const sampledProvenance = sampledRecords.map((record, candidateIndex) => ({
    ...record.provenance,
    candidate_index: candidateIndex,
  }))
  budget.assertSampledFrameCount(sampled.length)
  return {
    kind: resolvedKind,
    frame_count_raw: frames.length,
    frame_count: sampled.length,
    frames: sampled,
    frame_provenance: sampledProvenance,
    ...(videoResult ? { ffmpeg: videoResult.ffmpeg } : {}),
  }
}
