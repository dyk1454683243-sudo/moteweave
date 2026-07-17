import { mkdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

import sharp from 'sharp'

import { encodeRgbaPng } from '../character-pack/imageCodec.js'
import {
  createMotionDecodeBudget,
  MotionDecodeBudgetError,
} from './decodeBudget.js'
import {
  EXTERNAL_TOOL_FAILURE,
  createExternalToolError,
  runGuardedTool,
  throwIfExternalToolAborted,
} from './guardedToolRunner.js'

export const REMBG_MATTING_LIMITS = Object.freeze({
  maxRssMiB: 1536,
  frameTimeoutMs: 45_000,
  totalTimeoutMs: 180_000,
  pollIntervalMs: 1000,
  maxOutputBytesPerFrame: 80 * 1024 * 1024,
  maxOutputBytesTotal: 320 * 1024 * 1024,
})

export function resolveRembgPath(env = process.env) {
  return env.REMBG_PATH || env.rembgPath || 'rembg'
}

function frameName(index) {
  return `frame_${String(index + 1).padStart(5, '0')}.png`
}

function positiveLimit(value, fallback, label) {
  const number = Number(value ?? fallback)
  if (!Number.isFinite(number) || number <= 0) {
    throw new TypeError(`${label} must be a positive finite number`)
  }
  return number
}

function remainingStageTime(deadline, now, frameIndex) {
  const remainingMs = deadline - now()
  if (remainingMs > 0) return remainingMs
  throw createExternalToolError(
    EXTERNAL_TOOL_FAILURE.TIMEOUT,
    'external matting exceeded its total stage deadline',
    { tool: 'rembg', frame_index: frameIndex, deadline_scope: 'total_stage' }
  )
}

function safeOutputByteLimit(value, fallback, label) {
  const number = Number(value ?? fallback)
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`)
  }
  return number
}

async function decodeGuardedMatteOutput(outputPath, {
  budget,
  signal,
  deadline,
  now,
  frameIndex,
  maxOutputBytesPerFrame,
  previousOutputBytes,
  maxOutputBytesTotal,
} = {}) {
  throwIfExternalToolAborted(signal, { tool: 'rembg', frame_index: frameIndex })
  remainingStageTime(deadline, now, frameIndex)
  const outputStat = await stat(outputPath)
  if (!outputStat.isFile()) throw new Error('external matting output is not a regular file')
  if (!Number.isSafeInteger(outputStat.size) || outputStat.size < 0) {
    throw new MotionDecodeBudgetError(
      'external_matting_frame_output_bytes',
      Number.MAX_SAFE_INTEGER,
      maxOutputBytesPerFrame,
      'external matting output size is outside the supported integer range'
    )
  }
  if (outputStat.size > maxOutputBytesPerFrame) {
    throw new MotionDecodeBudgetError(
      'external_matting_frame_output_bytes',
      outputStat.size,
      maxOutputBytesPerFrame
    )
  }
  if (outputStat.size > Number.MAX_SAFE_INTEGER - previousOutputBytes) {
    throw new MotionDecodeBudgetError(
      'external_matting_output_bytes',
      Number.MAX_SAFE_INTEGER,
      maxOutputBytesTotal,
      'external matting output byte accounting overflow'
    )
  }
  const nextOutputBytes = previousOutputBytes + outputStat.size
  if (nextOutputBytes > maxOutputBytesTotal) {
    throw new MotionDecodeBudgetError(
      'external_matting_output_bytes',
      nextOutputBytes,
      maxOutputBytesTotal
    )
  }
  remainingStageTime(deadline, now, frameIndex)
  let metadata
  try {
    metadata = await sharp(outputPath, {
      limitInputPixels: budget.limits.frame_pixels,
    }).metadata()
  } catch (error) {
    if (/pixel limit/i.test(String(error?.message || error))) {
      throw new MotionDecodeBudgetError(
        'frame_pixels',
        budget.limits.frame_pixels + 1,
        budget.limits.frame_pixels,
        'external matting output exceeds the decoded frame pixel ceiling'
      )
    }
    throw error
  }
  budget.recordDecodedFrame({
    width: metadata.width,
    height: metadata.height,
  })
  throwIfExternalToolAborted(signal, { tool: 'rembg', frame_index: frameIndex })
  remainingStageTime(deadline, now, frameIndex)
  const { data, info } = await sharp(outputPath, {
    limitInputPixels: budget.limits.frame_pixels,
  })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  throwIfExternalToolAborted(signal, { tool: 'rembg', frame_index: frameIndex })
  remainingStageTime(deadline, now, frameIndex)
  return {
    frame: {
      width: info.width,
      height: info.height,
      data: new Uint8ClampedArray(data),
    },
    byteLength: outputStat.size,
    totalOutputBytes: nextOutputBytes,
  }
}

export async function applyExternalMattingToFrames(frames, {
  outputDir,
  rembgPath = resolveRembgPath(),
  runner = runGuardedTool,
  signal,
  toolLimits = {},
  decodeLimits = {},
  now = Date.now,
} = {}) {
  if (!Array.isArray(frames) || !frames.length) throw new Error('external_matting_requires_frames')
  if (!outputDir) throw new Error('external matting requires an outputDir')
  throwIfExternalToolAborted(signal, { tool: 'rembg', frame_index: 0 })
  const maxRssMiB = positiveLimit(
    toolLimits.maxRssMiB,
    REMBG_MATTING_LIMITS.maxRssMiB,
    'maxRssMiB'
  )
  const frameTimeoutMs = positiveLimit(
    toolLimits.frameTimeoutMs,
    REMBG_MATTING_LIMITS.frameTimeoutMs,
    'frameTimeoutMs'
  )
  const totalTimeoutMs = positiveLimit(
    toolLimits.totalTimeoutMs,
    REMBG_MATTING_LIMITS.totalTimeoutMs,
    'totalTimeoutMs'
  )
  const pollIntervalMs = positiveLimit(
    toolLimits.pollIntervalMs,
    REMBG_MATTING_LIMITS.pollIntervalMs,
    'pollIntervalMs'
  )
  const maxOutputBytesPerFrame = safeOutputByteLimit(
    toolLimits.maxOutputBytesPerFrame,
    REMBG_MATTING_LIMITS.maxOutputBytesPerFrame,
    'maxOutputBytesPerFrame'
  )
  const maxOutputBytesTotal = safeOutputByteLimit(
    toolLimits.maxOutputBytesTotal,
    REMBG_MATTING_LIMITS.maxOutputBytesTotal,
    'maxOutputBytesTotal'
  )
  const startedAt = now()
  const deadline = startedAt + totalTimeoutMs
  const inputBudget = createMotionDecodeBudget({ limits: decodeLimits })
  const outputBudget = createMotionDecodeBudget({ limits: decodeLimits })
  const inputDir = path.join(outputDir, 'input')
  const matteDir = path.join(outputDir, 'matte')
  await mkdir(inputDir, { recursive: true })
  await mkdir(matteDir, { recursive: true })

  const mattedFrames = []
  const frameReports = []
  let totalOutputBytes = 0
  for (const [index, frame] of frames.entries()) {
    throwIfExternalToolAborted(signal, { tool: 'rembg', frame_index: index })
    remainingStageTime(deadline, now, index)
    inputBudget.recordDecodedFrame({ width: frame?.width, height: frame?.height })
    const inputPath = path.join(inputDir, frameName(index))
    const outputPath = path.join(matteDir, frameName(index))
    const encodedInput = await encodeRgbaPng(frame)
    throwIfExternalToolAborted(signal, { tool: 'rembg', frame_index: index })
    remainingStageTime(deadline, now, index)
    await writeFile(inputPath, encodedInput)
    throwIfExternalToolAborted(signal, { tool: 'rembg', frame_index: index })
    const remainingMs = remainingStageTime(deadline, now, index)
    try {
      await runner(rembgPath, ['i', inputPath, outputPath], {
        tool: 'rembg',
        signal,
        maxRssMiB,
        timeoutMs: Math.max(1, Math.min(frameTimeoutMs, remainingMs)),
        pollIntervalMs,
        terminationGraceMs: toolLimits.terminationGraceMs,
        maxOutputBytes: toolLimits.maxOutputBytes,
        deadlineAt: deadline,
      })
      throwIfExternalToolAborted(signal, { tool: 'rembg', frame_index: index })
      remainingStageTime(deadline, now, index)
      const decoded = await decodeGuardedMatteOutput(outputPath, {
        budget: outputBudget,
        signal,
        deadline,
        now,
        frameIndex: index,
        maxOutputBytesPerFrame,
        previousOutputBytes: totalOutputBytes,
        maxOutputBytesTotal,
      })
      totalOutputBytes = decoded.totalOutputBytes
      mattedFrames.push(decoded.frame)
      frameReports.push({
        index,
        input_file: path.relative(outputDir, inputPath).split(path.sep).join('/'),
        output_file: path.relative(outputDir, outputPath).split(path.sep).join('/'),
        output_bytes: decoded.byteLength,
        width: decoded.frame.width,
        height: decoded.frame.height,
      })
    } catch (error) {
      if (
        String(error?.code ?? '').startsWith('external_tool_') ||
        error?.code === 'decode_budget_exceeded'
      ) throw error
      const reason = String(error?.message || error)
      throw createExternalToolError(
        EXTERNAL_TOOL_FAILURE.FAILED,
        `external matting failed: ${reason}`,
        { tool: 'rembg', frame_index: index }
      )
    }
  }

  return {
    frames: mattedFrames,
    report: {
      mode: 'external_rembg',
      tool: 'rembg',
      path: rembgPath,
      frame_count: mattedFrames.length,
      limits: {
        max_rss_mib: maxRssMiB,
        frame_timeout_ms: frameTimeoutMs,
        total_timeout_ms: totalTimeoutMs,
        poll_interval_ms: pollIntervalMs,
        max_output_bytes_per_frame: maxOutputBytesPerFrame,
        max_output_bytes_total: maxOutputBytesTotal,
      },
      output_bytes_total: totalOutputBytes,
      frames: frameReports,
    },
  }
}
