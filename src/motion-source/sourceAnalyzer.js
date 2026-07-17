import {
  EXTERNAL_TOOL_FAILURE,
  createExternalToolError,
  runGuardedTool,
  throwIfExternalToolAborted,
} from './guardedToolRunner.js'

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp'])
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.webm', '.mkv', '.avi', '.m4v'])
const DESCRIPTOR_KINDS = new Map([
  ['video', 'video_file'],
  ['video_file', 'video_file'],
  ['gif', 'gif'],
  ['frame_sequence_zip', 'frame_sequence_zip'],
  ['single_image', 'single_image'],
])

export const FFMPEG_PROBE_LIMITS = Object.freeze({
  maxRssMiB: 256,
  timeoutMs: 5000,
  pollIntervalMs: 500,
  terminationGraceMs: 250,
  maxOutputBytes: 4 * 1024,
})

function extensionOf(name = '') {
  const match = String(name).toLowerCase().match(/\.[^.]+$/)
  return match?.[0] ?? ''
}

function hasBytes(buffer, bytes, offset = 0) {
  if (!buffer || buffer.length < offset + bytes.length) return false
  return bytes.every((byte, index) => buffer[offset + index] === byte)
}

function sniffKind(buffer) {
  if (!buffer || !buffer.length) return { kind: 'unknown', detected_by: 'none' }
  if (hasBytes(buffer, [0x50, 0x4b, 0x03, 0x04]) || hasBytes(buffer, [0x50, 0x4b, 0x05, 0x06])) {
    return { kind: 'frame_sequence_zip', detected_by: 'magic' }
  }
  if (hasBytes(buffer, [0x47, 0x49, 0x46, 0x38])) return { kind: 'gif', detected_by: 'magic' }
  if (hasBytes(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { kind: 'single_image', detected_by: 'magic' }
  }
  if (hasBytes(buffer, [0xff, 0xd8, 0xff])) return { kind: 'single_image', detected_by: 'magic' }
  if (buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp') {
    return { kind: 'video_file', detected_by: 'magic' }
  }
  if (hasBytes(buffer, [0x1a, 0x45, 0xdf, 0xa3])) return { kind: 'video_file', detected_by: 'magic' }
  return { kind: 'unknown', detected_by: 'none' }
}

function kindFromExtension(ext) {
  if (ext === '.gif') return 'gif'
  if (ext === '.zip') return 'frame_sequence_zip'
  if (IMAGE_EXTENSIONS.has(ext)) return 'single_image'
  if (VIDEO_EXTENSIONS.has(ext)) return 'video_file'
  return 'unknown'
}

function normalizeDescriptorKind(mediaKind) {
  return DESCRIPTOR_KINDS.get(String(mediaKind ?? '').trim()) ?? null
}

function descriptorInput(options) {
  const descriptor =
    options.descriptor && typeof options.descriptor === 'object'
      ? options.descriptor
      : null
  const hasDescriptor =
    descriptor !== null ||
    Object.hasOwn(options, 'mediaKind') ||
    Object.hasOwn(options, 'media_kind') ||
    Object.hasOwn(options, 'byteLength') ||
    Object.hasOwn(options, 'byte_length')
  return {
    hasDescriptor,
    mediaKind:
      options.mediaKind ??
      options.media_kind ??
      descriptor?.mediaKind ??
      descriptor?.media_kind,
    byteLength:
      options.byteLength ??
      options.byte_length ??
      descriptor?.byteLength ??
      descriptor?.byte_length,
    name:
      options.name ??
      options.sourceName ??
      options.source_name ??
      descriptor?.name ??
      descriptor?.sourceName ??
      descriptor?.source_name ??
      '',
  }
}

function resolveFfmpegProbePath(ffmpegPath, env) {
  return ffmpegPath || env?.FFMPEG_PATH || env?.ffmpegPath || 'ffmpeg'
}

function ffmpegProbeEnvironment(env) {
  if (!env || env === process.env) return process.env
  return { ...process.env, ...env }
}

async function probeFfmpeg({ ffmpegPath, env, runner, signal }) {
  const resolvedPath = resolveFfmpegProbePath(ffmpegPath, env)
  throwIfExternalToolAborted(signal, { tool: 'ffmpeg_probe' })
  try {
    const evidence = await runner(resolvedPath, ['-version'], {
      tool: 'ffmpeg_probe',
      signal,
      env: ffmpegProbeEnvironment(env),
      ...FFMPEG_PROBE_LIMITS,
    })
    throwIfExternalToolAborted(signal, { tool: 'ffmpeg_probe' })
    return {
      kind: 'ffmpeg',
      path: resolvedPath,
      available: true,
      checked: true,
      probe: 'guarded',
      ...(Number.isFinite(evidence?.elapsed_ms)
        ? { elapsed_ms: Math.max(0, Math.round(evidence.elapsed_ms)) }
        : {}),
    }
  } catch (error) {
    if (error?.code === EXTERNAL_TOOL_FAILURE.CANCELLED) throw error
    if (signal?.aborted || error?.name === 'AbortError') {
      throwIfExternalToolAborted(signal, { tool: 'ffmpeg_probe' })
      throw createExternalToolError(
        EXTERNAL_TOOL_FAILURE.CANCELLED,
        'ffmpeg availability probe cancelled',
        { tool: 'ffmpeg_probe' }
      )
    }
    const failureStatus = String(error?.code ?? '').startsWith('external_tool_')
      ? error.code
      : EXTERNAL_TOOL_FAILURE.FAILED
    return {
      kind: 'ffmpeg',
      path: resolvedPath,
      available: false,
      checked: true,
      probe: 'guarded',
      failure_status: failureStatus,
    }
  }
}

export async function analyzeMotionSource(options = {}) {
  const {
    buffer = null,
    ffmpegPath,
    env = process.env,
    runner = runGuardedTool,
    signal,
  } = options
  const descriptor = descriptorInput(options)
  const name = String(descriptor.name ?? '')
  const ext = extensionOf(name)
  const extensionKind = kindFromExtension(ext)
  const warnings = []
  const blockingErrors = []
  let sourceKind = 'unknown'
  let detectedBy = 'none'
  let byteLength = 0

  if (descriptor.hasDescriptor) {
    const descriptorKind = normalizeDescriptorKind(descriptor.mediaKind)
    const descriptorLength = descriptor.byteLength
    if (!descriptorKind || !Number.isSafeInteger(descriptorLength) || descriptorLength <= 0) {
      blockingErrors.push('invalid_motion_source_descriptor')
    } else {
      sourceKind = descriptorKind
      detectedBy = 'descriptor'
      byteLength = descriptorLength
    }
  } else {
    const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer ?? [])
    const sniffed = sniffKind(bytes)
    sourceKind = sniffed.kind
    detectedBy = sniffed.detected_by
    byteLength = bytes.length
    if (sourceKind === 'unknown' && extensionKind === 'video_file' && !bytes.length) {
      sourceKind = 'video_file'
      detectedBy = 'extension'
    }
    if (sourceKind === 'unknown' && extensionKind === 'video_file' && bytes.length >= 8) {
      sourceKind = 'video_file'
      detectedBy = 'extension'
      warnings.push('video_magic_unverified')
    }
    if (sourceKind === 'unknown' && extensionKind !== 'unknown') {
      blockingErrors.push('corrupt_or_unsupported_source')
    }
  }

  if (sourceKind !== 'unknown' && extensionKind !== 'unknown' && extensionKind !== sourceKind) {
    warnings.push('extension_kind_mismatch')
  }

  const requiresExternalBinary = !blockingErrors.length && sourceKind === 'video_file'
  const externalBinary = requiresExternalBinary
    ? await probeFfmpeg({ ffmpegPath, env, runner, signal })
    : null
  if (externalBinary && !externalBinary.available) {
    warnings.push('ffmpeg_unavailable')
  }

  return {
    status: blockingErrors.length ? 'fail' : 'ok',
    source_kind: blockingErrors.length ? 'unknown' : sourceKind,
    name,
    byte_length: byteLength,
    detected_by: blockingErrors.length ? 'none' : detectedBy,
    extension_kind: extensionKind,
    requires_external_binary: requiresExternalBinary,
    external_binary: externalBinary,
    warnings,
    blocking_errors: blockingErrors,
  }
}
