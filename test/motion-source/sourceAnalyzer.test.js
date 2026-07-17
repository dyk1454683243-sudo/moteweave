import test from 'node:test'
import assert from 'node:assert/strict'

import {
  analyzeMotionSource,
  FFMPEG_PROBE_LIMITS,
} from '../../src/motion-source/sourceAnalyzer.js'
import {
  EXTERNAL_TOOL_FAILURE,
  createExternalToolError,
} from '../../src/motion-source/guardedToolRunner.js'

const GIF_HEADER = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00])
const ZIP_HEADER = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00])
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
const MP4_HEADER = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70])

async function successfulProbe() {
  return { elapsed_ms: 3, exit_code: 0 }
}

test('analyzeMotionSource classifies GIF ZIP image and video sources', async () => {
  assert.equal((await analyzeMotionSource({ name: 'walk.gif', buffer: GIF_HEADER })).source_kind, 'gif')
  assert.equal((await analyzeMotionSource({ name: 'frames.zip', buffer: ZIP_HEADER })).source_kind, 'frame_sequence_zip')
  assert.equal((await analyzeMotionSource({ name: 'pose.png', buffer: PNG_HEADER })).source_kind, 'single_image')
  assert.equal((await analyzeMotionSource({ name: 'pose.jpg', buffer: JPEG_HEADER })).source_kind, 'single_image')

  const video = await analyzeMotionSource({
    name: 'clip.mp4',
    buffer: MP4_HEADER,
    env: {},
    runner: successfulProbe,
  })
  assert.equal(video.source_kind, 'video_file')
  assert.equal(video.requires_external_binary, true)
  assert.equal(video.external_binary.kind, 'ffmpeg')
})

test('analyzeMotionSource consumes verified descriptor kind and length without reading buffer', async () => {
  const unreadableBuffer = new Proxy({}, {
    get() {
      throw new Error('descriptor analysis must not read the source buffer')
    },
  })
  let probeCalls = 0
  const result = await analyzeMotionSource({
    source_name: 'capture.mp4',
    mediaKind: 'video',
    byteLength: 200 * 1024 * 1024,
    buffer: unreadableBuffer,
    runner: async () => {
      probeCalls += 1
      return { elapsed_ms: 1, exit_code: 0 }
    },
  })

  assert.equal(result.source_kind, 'video_file')
  assert.equal(result.byte_length, 200 * 1024 * 1024)
  assert.equal(result.detected_by, 'descriptor')
  assert.equal(result.name, 'capture.mp4')
  assert.equal(result.requires_external_binary, true)
  assert.equal(probeCalls, 1)
})

test('analyzeMotionSource accepts upload-store descriptor field names', async () => {
  const result = await analyzeMotionSource({
    source_name: 'pose.png',
    media_kind: 'single_image',
    byte_length: 987,
  })

  assert.equal(result.source_kind, 'single_image')
  assert.equal(result.byte_length, 987)
  assert.equal(result.detected_by, 'descriptor')
})

test('analyzeMotionSource runs a bounded guarded FFmpeg probe and preserves explicit CLI path', async () => {
  const controller = new AbortController()
  const calls = []
  const result = await analyzeMotionSource({
    name: 'clip.mp4',
    buffer: MP4_HEADER,
    ffmpegPath: '/cli/ffmpeg',
    env: { FFMPEG_PATH: '/environment/ffmpeg' },
    signal: controller.signal,
    runner: async (command, args, options) => {
      calls.push({ command, args, options })
      return {
        elapsed_ms: 7,
        stdout_tail: 'output is intentionally not copied into analyzer evidence',
      }
    },
  })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].command, '/cli/ffmpeg')
  assert.deepEqual(calls[0].args, ['-version'])
  assert.equal(calls[0].options.tool, 'ffmpeg_probe')
  assert.equal(calls[0].options.signal, controller.signal)
  assert.equal(calls[0].options.maxRssMiB, FFMPEG_PROBE_LIMITS.maxRssMiB)
  assert.equal(calls[0].options.timeoutMs, FFMPEG_PROBE_LIMITS.timeoutMs)
  assert.equal(calls[0].options.pollIntervalMs, FFMPEG_PROBE_LIMITS.pollIntervalMs)
  assert.equal(calls[0].options.terminationGraceMs, FFMPEG_PROBE_LIMITS.terminationGraceMs)
  assert.equal(calls[0].options.maxOutputBytes, FFMPEG_PROBE_LIMITS.maxOutputBytes)
  assert.equal(calls[0].options.env.FFMPEG_PATH, '/environment/ffmpeg')
  assert.equal(calls[0].options.env.PATH, process.env.PATH)
  assert.equal(result.external_binary.available, true)
  assert.equal(result.external_binary.checked, true)
  assert.equal(result.external_binary.probe, 'guarded')
  assert.equal(result.external_binary.elapsed_ms, 7)
  assert.equal(result.external_binary.stdout_tail, undefined)
})

test('analyzeMotionSource records guarded FFmpeg probe failure without blocking analysis', async () => {
  const video = await analyzeMotionSource({
    name: 'clip.mp4',
    buffer: MP4_HEADER,
    env: {},
    runner: async () => {
      throw createExternalToolError(
        EXTERNAL_TOOL_FAILURE.SPAWN_FAILED,
        'ffmpeg executable was not found',
        { tool: 'ffmpeg_probe' }
      )
    },
  })

  assert.equal(video.external_binary.available, false)
  assert.equal(video.external_binary.path, 'ffmpeg')
  assert.equal(video.external_binary.checked, true)
  assert.equal(video.external_binary.failure_status, EXTERNAL_TOOL_FAILURE.SPAWN_FAILED)
  assert.ok(video.warnings.includes('ffmpeg_unavailable'))
  assert.equal(video.status, 'ok')

  let probeCalls = 0
  const gif = await analyzeMotionSource({
    name: 'walk.gif',
    buffer: GIF_HEADER,
    env: {},
    runner: async () => {
      probeCalls += 1
    },
  })
  assert.equal(gif.requires_external_binary, false)
  assert.equal(gif.external_binary, null)
  assert.deepEqual(gif.blocking_errors, [])
  assert.equal(probeCalls, 0)
})

test('analyzeMotionSource propagates guarded FFmpeg probe cancellation', async () => {
  const controller = new AbortController()
  await assert.rejects(
    () => analyzeMotionSource({
      name: 'clip.mp4',
      buffer: MP4_HEADER,
      signal: controller.signal,
      runner: async (command, args, options) => {
        assert.equal(options.signal, controller.signal)
        controller.abort()
        throw createExternalToolError(
          EXTERNAL_TOOL_FAILURE.CANCELLED,
          'probe cancelled',
          { tool: 'ffmpeg_probe' }
        )
      },
    }),
    (error) => {
      assert.equal(error.code, EXTERNAL_TOOL_FAILURE.CANCELLED)
      return true
    }
  )
})

test('analyzeMotionSource does not launch a guarded FFmpeg probe after pre-cancellation', async () => {
  const controller = new AbortController()
  controller.abort()
  let probeCalls = 0

  await assert.rejects(
    () => analyzeMotionSource({
      name: 'clip.mp4',
      buffer: MP4_HEADER,
      signal: controller.signal,
      runner: async () => {
        probeCalls += 1
      },
    }),
    (error) => {
      assert.equal(error.code, EXTERNAL_TOOL_FAILURE.CANCELLED)
      return true
    }
  )
  assert.equal(probeCalls, 0)
})

test('analyzeMotionSource prefers magic bytes over misleading extensions', async () => {
  const result = await analyzeMotionSource({ name: 'renamed.gif', buffer: ZIP_HEADER })

  assert.equal(result.source_kind, 'frame_sequence_zip')
  assert.equal(result.detected_by, 'magic')
  assert.ok(result.warnings.includes('extension_kind_mismatch'))
})

test('analyzeMotionSource rejects corrupt or mislabeled sources before decoding', async () => {
  const result = await analyzeMotionSource({ name: 'fake.gif', buffer: Buffer.from('not an image') })

  assert.equal(result.source_kind, 'unknown')
  assert.equal(result.status, 'fail')
  assert.ok(result.blocking_errors.includes('corrupt_or_unsupported_source'))
})

test('analyzeMotionSource returns JSON-safe metadata', async () => {
  const result = await analyzeMotionSource({ name: 'pose.png', buffer: PNG_HEADER })

  assert.equal(result.name, 'pose.png')
  assert.equal(result.byte_length, PNG_HEADER.length)
  assert.deepEqual(result.warnings, [])
  assert.deepEqual(result.blocking_errors, [])
  assert.equal(JSON.parse(JSON.stringify(result)).source_kind, 'single_image')
})
