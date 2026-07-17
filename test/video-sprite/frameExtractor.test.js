import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import JSZip from 'jszip'

import {
  detectFrameSourceKind,
  extractFrames,
  extractFramesFromVideoFile,
  FFMPEG_EXTRACTION_LIMITS,
  resolveFfmpegPath,
  sampleFrames,
} from '../../src/video-sprite/frameExtractor.js'
import { EXTERNAL_TOOL_FAILURE } from '../../src/motion-source/guardedToolRunner.js'
import { encodeRgbaPng } from '../../src/character-pack/imageCodec.js'
import { encodeGifFromRgbaFrames } from '../../src/character-pack/gifExport.js'

function solid(width, height, [r, g, b, a]) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = r
    data[i * 4 + 1] = g
    data[i * 4 + 2] = b
    data[i * 4 + 3] = a
  }
  return { width, height, data }
}

function zipEndOfCentralDirectoryOffset(buffer) {
  for (let offset = buffer.length - 22; offset >= 0; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset
  }
  throw new Error('test ZIP is missing its end-of-central-directory record')
}

function forgeZipUncompressedSize(buffer, size) {
  const forged = Buffer.from(buffer)
  for (let offset = 0; offset <= forged.length - 4; offset += 1) {
    const signature = forged.readUInt32LE(offset)
    if (signature === 0x04034b50) forged.writeUInt32LE(size, offset + 22)
    if (signature === 0x02014b50) forged.writeUInt32LE(size, offset + 24)
  }
  return forged
}

test('extractFrames reads a frame-sequence ZIP in numeric filename order', async () => {
  const red = solid(2, 2, [255, 0, 0, 255])
  const green = solid(2, 2, [0, 255, 0, 255])
  const blue = solid(2, 2, [0, 0, 255, 255])
  const zip = new JSZip()
  // Add out of order and with names that would sort wrong lexically (frame_10 < frame_2).
  zip.file('frame_10.png', await encodeRgbaPng(blue))
  zip.file('frame_2.png', await encodeRgbaPng(green))
  zip.file('frame_1.png', await encodeRgbaPng(red))
  const buffer = await zip.generateAsync({ type: 'nodebuffer' })

  const result = await extractFrames(buffer, { name: 'frames.zip' })

  assert.equal(result.kind, 'zip')
  assert.equal(result.frame_count, 3)
  assert.deepEqual([...result.frames[0].data.slice(0, 3)], [255, 0, 0])
  assert.deepEqual([...result.frames[1].data.slice(0, 3)], [0, 255, 0])
  assert.deepEqual([...result.frames[2].data.slice(0, 3)], [0, 0, 255])
  assert.deepEqual(result.frame_provenance, [
    {
      candidate_index: 0,
      raw_index: 0,
      timestamp_ms: null,
      duration_ms: null,
      timing_source: 'unavailable',
      source_entry: 'frame_1.png',
    },
    {
      candidate_index: 1,
      raw_index: 1,
      timestamp_ms: null,
      duration_ms: null,
      timing_source: 'unavailable',
      source_entry: 'frame_2.png',
    },
    {
      candidate_index: 2,
      raw_index: 2,
      timestamp_ms: null,
      duration_ms: null,
      timing_source: 'unavailable',
      source_entry: 'frame_10.png',
    },
  ])
})

test('extractFrames reads every page of an animated GIF', async () => {
  const frames = [
    solid(4, 4, [200, 40, 40, 255]),
    solid(4, 4, [40, 200, 40, 255]),
    solid(4, 4, [40, 40, 200, 255]),
    solid(4, 4, [200, 200, 40, 255]),
  ]
  const gif = encodeGifFromRgbaFrames(frames, { delay: 80 })

  const result = await extractFrames(gif, { name: 'walk.gif' })

  assert.equal(result.kind, 'gif')
  assert.equal(result.frame_count_raw, 4)
  assert.equal(result.frames.length, 4)
  assert.equal(result.frames[0].width, 4)
  assert.equal(result.frames[0].height, 4)
  assert.deepEqual(
    result.frame_provenance.map((frame) => ({
      candidate_index: frame.candidate_index,
      raw_index: frame.raw_index,
      timestamp_ms: frame.timestamp_ms,
      duration_ms: frame.duration_ms,
      timing_source: frame.timing_source,
    })),
    [
      { candidate_index: 0, raw_index: 0, timestamp_ms: 0, duration_ms: 80, timing_source: 'exact' },
      { candidate_index: 1, raw_index: 1, timestamp_ms: 80, duration_ms: 80, timing_source: 'exact' },
      { candidate_index: 2, raw_index: 2, timestamp_ms: 160, duration_ms: 80, timing_source: 'exact' },
      { candidate_index: 3, raw_index: 3, timestamp_ms: 240, duration_ms: 80, timing_source: 'exact' },
    ]
  )
})

test('extractFrames enforces ZIP, page, pixel, and sampled-frame decode budgets', async () => {
  const zip = new JSZip()
  const png = await encodeRgbaPng(solid(2, 2, [20, 40, 60, 255]))
  zip.file('frame_01.png', png)
  zip.file('frame_02.png', png)
  zip.file('frame_03.png', png)
  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' })

  await assert.rejects(
    () => extractFrames(zipBuffer, {
      name: 'frames.zip',
      decodeLimits: { zip_entry_count: 2 },
    }),
    (error) => error.code === 'decode_budget_exceeded' && error.budget === 'zip_entry_count'
  )
  await assert.rejects(
    () => extractFrames(zipBuffer, {
      name: 'frames.zip',
      decodeLimits: { sampled_frame_count: 2 },
    }),
    (error) => error.code === 'decode_budget_exceeded' && error.budget === 'sampled_frame_count'
  )
  await assert.rejects(
    () => extractFrames(png, {
      name: 'frame.png',
      decodeLimits: { frame_pixels: 3 },
    }),
    (error) => error.code === 'decode_budget_exceeded' && error.budget === 'frame_pixels'
  )

  const gif = encodeGifFromRgbaFrames([
    solid(2, 2, [200, 20, 20, 255]),
    solid(2, 2, [20, 200, 20, 255]),
  ])
  await assert.rejects(
    () => extractFrames(gif, {
      name: 'walk.gif',
      decodeLimits: { page_count: 1 },
    }),
    (error) => error.code === 'decode_budget_exceeded' && error.budget === 'page_count'
  )
})

test('extractFrames rejects Zip64 and malformed central-directory claims before JSZip decoding', async () => {
  const zip = new JSZip()
  zip.file('frame_01.png', await encodeRgbaPng(solid(2, 2, [20, 40, 60, 255])))
  const standard = await zip.generateAsync({ type: 'nodebuffer' })
  const zip64Claim = Buffer.from(standard)
  const eocdOffset = zipEndOfCentralDirectoryOffset(zip64Claim)
  zip64Claim.writeUInt16LE(0xffff, eocdOffset + 10)

  await assert.rejects(
    () => extractFrames(zip64Claim, { name: 'frames.zip' }),
    (error) => (
      error.code === 'decode_budget_exceeded' &&
      error.budget === 'zip_central_directory' &&
      /Zip64/.test(error.message)
    )
  )
})

test('extractFrames counts actual ZIP inflation bytes instead of trusting forged declarations', async () => {
  const zip = new JSZip()
  zip.file('metadata.bin', Buffer.alloc(4096, 0), { compression: 'DEFLATE' })
  const standard = await zip.generateAsync({ type: 'nodebuffer' })
  const forged = forgeZipUncompressedSize(standard, 1)

  await assert.rejects(
    () => extractFrames(forged, {
      name: 'frames.zip',
      decodeLimits: { zip_uncompressed_bytes: 64 },
    }),
    (error) => (
      error.code === 'decode_budget_exceeded' &&
      error.budget === 'zip_uncompressed_bytes' &&
      error.actual > error.limit
    )
  )
})

test('extractFrames checks cancellation before non-video decode work', async () => {
  const controller = new AbortController()
  controller.abort()
  const png = await encodeRgbaPng(solid(2, 2, [20, 40, 60, 255]))

  await assert.rejects(
    () => extractFrames(png, {
      name: 'frame.png',
      signal: controller.signal,
    }),
    (error) => error.code === EXTERNAL_TOOL_FAILURE.CANCELLED
  )
})

test('extractFrames rejects video sources with an actionable ffmpeg message', async () => {
  await assert.rejects(
    () => extractFrames(Buffer.from([0x00, 0x00, 0x00, 0x18]), { name: 'clip.mp4' }),
    /ffmpeg/
  )
})

test('resolveFfmpegPath prefers explicit environment paths', () => {
  assert.equal(resolveFfmpegPath({ FFMPEG_PATH: '/opt/bin/ffmpeg', ffmpegPath: '/ignored' }), '/opt/bin/ffmpeg')
  assert.equal(resolveFfmpegPath({ ffmpegPath: '/local/ffmpeg' }), '/local/ffmpeg')
  assert.equal(resolveFfmpegPath({}), 'ffmpeg')
})

test('extractFramesFromVideoFile uses an injected ffmpeg runner and reads extracted PNG frames', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'video-frame-extractor-'))
  const calls = []
  const controller = new AbortController()
  const runner = async (binary, args, options) => {
    calls.push({ binary, args, options })
    await writeFile(path.join(outputDir, 'frame_00001.png'), await encodeRgbaPng(solid(2, 2, [20, 40, 60, 255])))
    await writeFile(path.join(outputDir, 'frame_00002.png'), await encodeRgbaPng(solid(2, 2, [80, 100, 120, 255])))
  }

  const result = await extractFramesFromVideoFile('/tmp/clip.mp4', {
    outputDir,
    fps: 6,
    startSec: 1,
    endSec: 3,
    maxFrames: 2,
    ffmpegPath: '/custom/ffmpeg',
    runner,
    signal: controller.signal,
  })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].binary, '/custom/ffmpeg')
  assert.deepEqual(calls[0].args.slice(0, 2), ['-nostdin', '-y'])
  assert.deepEqual(calls[0].args.slice(2, 6), ['-threads', '2', '-filter_threads', '2'])
  assert.deepEqual(calls[0].args.slice(6, 10), ['-ss', '1', '-i', '/tmp/clip.mp4'])
  assert.ok(calls[0].args.includes('-t'))
  assert.ok(calls[0].args.includes('2'))
  const filter = calls[0].args[calls[0].args.indexOf('-vf') + 1]
  assert.match(filter, /fps=6/)
  assert.match(filter, /min\(iw,4096\)/)
  assert.match(filter, /min\(ih,4096\)/)
  assert.ok(calls[0].args.includes('-frames:v'))
  assert.ok(calls[0].args.includes('-threads:v'))
  assert.ok(calls[0].args.includes('2'))
  assert.equal(calls[0].options.tool, 'ffmpeg')
  assert.equal(calls[0].options.maxRssMiB, FFMPEG_EXTRACTION_LIMITS.maxRssMiB)
  assert.equal(calls[0].options.timeoutMs, FFMPEG_EXTRACTION_LIMITS.timeoutMs)
  assert.equal(calls[0].options.pollIntervalMs, FFMPEG_EXTRACTION_LIMITS.pollIntervalMs)
  assert.equal(calls[0].options.signal, controller.signal)
  assert.equal(result.kind, 'video')
  assert.equal(result.frame_count, 2)
  assert.deepEqual([...result.frames[0].data.slice(0, 3)], [20, 40, 60])
  assert.equal(result.frame_provenance[0].candidate_index, 0)
  assert.equal(result.frame_provenance[0].raw_index, 0)
  assert.equal(result.frame_provenance[0].timestamp_ms, 1000)
  assert.equal(result.frame_provenance[0].duration_ms, 1000 / 6)
  assert.equal(result.frame_provenance[0].timing_source, 'derived_sampling')
  assert.equal(result.frame_provenance[0].source_entry, 'frame_00001.png')
  assert.equal(result.frame_provenance[1].timestamp_ms, 1000 + 1000 / 6)
  assert.equal(result.ffmpeg.path, '/custom/ffmpeg')
  assert.equal(result.ffmpeg.output_dir, outputDir)
  assert.equal(result.ffmpeg.normalization.mode, 'bounded_scale_v1')
  assert.equal(result.ffmpeg.normalization.planned_frame_count, 2)
  assert.equal(result.ffmpeg.normalization.max_frame_dimension, 4096)
  assert.ok(result.ffmpeg.output_bytes.total > 0)
})

test('extractFramesFromVideoFile does not launch ffmpeg after cancellation', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'video-frame-extractor-cancel-'))
  const controller = new AbortController()
  controller.abort()
  let calls = 0

  await assert.rejects(
    () => extractFramesFromVideoFile('/tmp/clip.mp4', {
      outputDir,
      signal: controller.signal,
      runner: async () => {
        calls += 1
      },
    }),
    (error) => {
      assert.equal(error.code, EXTERNAL_TOOL_FAILURE.CANCELLED)
      return true
    }
  )
  assert.equal(calls, 0)
})

test('extractFramesFromVideoFile reports missing output directory and ffmpeg failures clearly', async () => {
  await assert.rejects(
    () => extractFramesFromVideoFile('/tmp/clip.mp4', { runner: async () => {} }),
    /outputDir/
  )
  await assert.rejects(
    () => extractFramesFromVideoFile('', { outputDir: '/tmp/unused', runner: async () => {} }),
    /inputPath/
  )
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'video-frame-extractor-fail-'))
  await assert.rejects(
    () => extractFramesFromVideoFile('/tmp/clip.mp4', {
      outputDir,
      runner: async () => {
        throw new Error('missing binary')
      },
    }),
    (error) => {
      assert.equal(error.code, EXTERNAL_TOOL_FAILURE.FAILED)
      assert.match(error.message, /ffmpeg frame extraction failed: missing binary/)
      return true
    }
  )
})

test('extractFramesFromVideoFile always applies finite time, frame, and thread bounds', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'video-frame-extractor-bounds-'))
  let call = null
  await assert.rejects(
    () => extractFramesFromVideoFile('/tmp/clip.mp4', {
      outputDir,
      maxFrames: Infinity,
      runner: async (binary, args, options) => {
        call = { binary, args, options }
      },
    }),
    /no PNG frames/
  )

  const frameLimitIndex = call.args.indexOf('-frames:v')
  const durationIndex = call.args.indexOf('-t')
  assert.equal(call.args[frameLimitIndex + 1], String(FFMPEG_EXTRACTION_LIMITS.maxFrames))
  assert.ok(Number(call.args[durationIndex + 1]) <= FFMPEG_EXTRACTION_LIMITS.maxSourceWindowSec)
  assert.deepEqual(
    call.args.slice(call.args.indexOf('-threads'), call.args.indexOf('-threads') + 2),
    ['-threads', String(FFMPEG_EXTRACTION_LIMITS.maxThreads)]
  )
  assert.deepEqual(
    call.args.slice(call.args.indexOf('-threads:v'), call.args.indexOf('-threads:v') + 2),
    ['-threads:v', String(FFMPEG_EXTRACTION_LIMITS.maxThreads)]
  )
  assert.equal(call.args[0], '-nostdin')
  const filter = call.args[call.args.indexOf('-vf') + 1]
  assert.match(filter, /min\(iw,1024\)/)
  assert.match(filter, /min\(ih,1024\)/)
})

test('extractFramesFromVideoFile rejects oversized extracted files before image decode', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'video-frame-extractor-output-limit-'))

  await assert.rejects(
    () => extractFramesFromVideoFile('/tmp/clip.mp4', {
      outputDir,
      maxFrames: 1,
      toolLimits: {
        maxFrameOutputBytes: 8,
        maxTotalOutputBytes: 16,
      },
      runner: async () => {
        await writeFile(path.join(outputDir, 'frame_00001.png'), Buffer.alloc(9))
      },
    }),
    (error) => (
      error.code === 'decode_budget_exceeded' &&
      error.budget === 'extracted_frame_output_bytes'
    )
  )
})

test('sampleFrames applies a frame stride', () => {
  const frames = [0, 1, 2, 3, 4, 5].map((value) => solid(1, 1, [value, value, value, 255]))
  const strided = sampleFrames(frames, { stride: 2 })
  assert.equal(strided.length, 3)
  assert.deepEqual(strided.map((frame) => frame.data[0]), [0, 2, 4])
})

test('extractFrames keeps raw provenance indexes after stride sampling', async () => {
  const zip = new JSZip()
  for (let index = 0; index < 6; index += 1) {
    zip.file(
      `frame_${String(index + 1).padStart(2, '0')}.png`,
      await encodeRgbaPng(solid(1, 1, [index, index, index, 255]))
    )
  }
  const result = await extractFrames(
    await zip.generateAsync({ type: 'nodebuffer' }),
    {
      name: 'frames.zip',
      stride: 2,
      maxFrames: 3,
    }
  )

  assert.deepEqual(result.frames.map((frame) => frame.data[0]), [0, 2, 4])
  assert.deepEqual(
    result.frame_provenance.map((frame) => ({
      candidate_index: frame.candidate_index,
      raw_index: frame.raw_index,
      source_entry: frame.source_entry,
    })),
    [
      { candidate_index: 0, raw_index: 0, source_entry: 'frame_01.png' },
      { candidate_index: 1, raw_index: 2, source_entry: 'frame_03.png' },
      { candidate_index: 2, raw_index: 4, source_entry: 'frame_05.png' },
    ]
  )
})

test('detectFrameSourceKind falls back to magic bytes when the name is unknown', () => {
  assert.equal(detectFrameSourceKind('', Buffer.from([0x50, 0x4b, 0x03, 0x04])), 'zip')
  assert.equal(detectFrameSourceKind('', Buffer.from([0x47, 0x49, 0x46, 0x38])), 'gif')
  assert.equal(detectFrameSourceKind('sheet.png'), 'image')
})
