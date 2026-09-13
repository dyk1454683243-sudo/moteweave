import { naturalSortSequenceFiles, normalizeSequenceOptions } from './core.js'

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function bytesToBase64(bytes) {
  let output = ''
  for (let offset = 0; offset < bytes.length; offset += 3) {
    const first = bytes[offset]
    const hasSecond = offset + 1 < bytes.length
    const hasThird = offset + 2 < bytes.length
    const second = hasSecond ? bytes[offset + 1] : 0
    const third = hasThird ? bytes[offset + 2] : 0
    const value = (first << 16) | (second << 8) | third
    output += BASE64_ALPHABET[(value >>> 18) & 0x3f]
    output += BASE64_ALPHABET[(value >>> 12) & 0x3f]
    output += hasSecond ? BASE64_ALPHABET[(value >>> 6) & 0x3f] : '='
    output += hasThird ? BASE64_ALPHABET[value & 0x3f] : '='
  }
  return output
}

async function fileToBase64(fileOrFrame) {
  const file = fileOrFrame?.file ?? fileOrFrame
  if (!file || typeof file.arrayBuffer !== 'function') {
    throw new TypeError('Sequence frames must be File-like values')
  }
  return bytesToBase64(new Uint8Array(await file.arrayBuffer()))
}

async function resolveFramesBase64({ files, orderedFrames, framesBase64 }) {
  if (framesBase64 !== undefined) {
    if (!Array.isArray(framesBase64)) {
      throw new TypeError('framesBase64 must be an array')
    }
    return [...framesBase64]
  }

  if (orderedFrames !== undefined && !Array.isArray(orderedFrames)) {
    throw new TypeError('orderedFrames must be an array')
  }

  const encoded = []
  const frames = orderedFrames === undefined
    ? naturalSortSequenceFiles(files)
    : orderedFrames
  for (const file of frames) {
    encoded.push(await fileToBase64(file))
  }
  return encoded
}

async function frameGifRequestError(response) {
  let payload = null
  if (response.status === 400 && typeof response.json === 'function') {
    try {
      payload = await response.json()
    } catch {
      payload = null
    }
  }
  const reason = typeof payload?.reason === 'string' && payload.reason.trim()
    ? payload.reason.trim()
    : null
  const error = new Error(reason ?? `GIF build failed: ${response.status}`)
  error.code = typeof payload?.error === 'string' && payload.error
    ? payload.error
    : 'frame_gif_request_failed'
  error.status = response.status
  error.reason = reason
  return error
}

export async function requestFrameGif({
  files,
  orderedFrames,
  framesBase64,
  options = {},
  fetchImpl = globalThis.fetch,
  onRequestStart,
  signal,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('fetchImpl must be a function')
  }
  if (onRequestStart !== undefined && typeof onRequestStart !== 'function') {
    throw new TypeError('onRequestStart must be a function')
  }
  const normalized = normalizeSequenceOptions(options)
  const encodedFrames = await resolveFramesBase64({ files, orderedFrames, framesBase64 })
  onRequestStart?.()
  const response = await fetchImpl('/api/build-frame-gif', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      frames_base64: encodedFrames,
      options: {
        targetW: normalized.targetW,
        targetH: normalized.targetH,
        padding: normalized.padding,
        fps: normalized.fps,
      },
    }),
    ...(signal === undefined ? {} : { signal }),
  })
  if (!response.ok) throw await frameGifRequestError(response)
  return response.blob()
}
