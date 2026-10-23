import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import {
  classifyMotionSource,
  decodeGifTimelineFrames,
  probeVideoFile,
  extractVideoTimelineFrames,
  computeVideoFrameDurationsMs,
  resolveVideoBinaryPath,
  clearStagedMotionSources,
} from '../../src/editor-project/motionTimelineImport.js'
import {
  createEditorProjectV1,
  createSpriteDocumentFromUploadedPng,
  createSpriteDocumentFromMotionTimeline,
  sha256Bytes,
  encodeRgbaPng,
  handleEditorProjectApi,
  createEditorArtifactAccessRegistry,
} from '../../src/editor-project/index.js'
import { isGeneralSequenceSpriteDocument } from '../../src/editor-project/pixelDocumentOrigin.js'
import { editorFetch } from '../helpers/editorFetch.js'
import { runGuardedTool } from '../../src/motion-source/guardedToolRunner.js'

/**
 * Minimal LZW-compressed GIF89a encoder for deterministic multi-frame tests
 * supporting arbitrary global palette, sub-frame rects, transparency, disposal modes, and delays.
 */
function encodeLzwMinimumCodeSize8(indices, { includeEoi = true } = {}) {
  const minCodeSize = 8
  const clearCode = 256
  const eoiCode = 257
  const codes = [clearCode]
  for (let i = 0; i < indices.length; i += 1) {
    codes.push(indices[i] & 0xff)
    // Emit clearCode periodically so table never exceeds 9-bit codes (258..511)
    if ((i + 1) % 200 === 0) codes.push(clearCode)
  }
  if (includeEoi) codes.push(eoiCode)

  const bytes = []
  let bitBuffer = 0
  let bitCount = 0
  const codeSize = 9
  for (const code of codes) {
    bitBuffer |= (code & ((1 << codeSize) - 1)) << bitCount
    bitCount += codeSize
    while (bitCount >= 8) {
      bytes.push(bitBuffer & 0xff)
      bitBuffer >>= 8
      bitCount -= 8
    }
  }
  if (bitCount > 0) {
    bytes.push(bitBuffer & 0xff)
  }

  const out = [minCodeSize]
  let offset = 0
  while (offset < bytes.length) {
    const chunkLen = Math.min(255, bytes.length - offset)
    out.push(chunkLen)
    for (let i = 0; i < chunkLen; i += 1) out.push(bytes[offset + i])
    offset += chunkLen
  }
  out.push(0) // Block terminator
  return Buffer.from(out)
}

function buildTestGif({ width, height, palette, bgColorIndex = 0, frames }) {
  const chunks = []
  // Header: GIF89a
  chunks.push(Buffer.from('GIF89a', 'ascii'))
  // Logical Screen Descriptor
  const lsd = Buffer.alloc(7)
  lsd.writeUInt16LE(width, 0)
  lsd.writeUInt16LE(height, 2)
  // Global color table flag (1), color resolution (7), sort (0), size of GCT = 256 entries (7 -> 2^(7+1)=256)
  lsd[4] = 0b11110111
  lsd[5] = bgColorIndex & 0xff
  lsd[6] = 0
  chunks.push(lsd)

  // Global Color Table (256 * 3 bytes)
  const gct = Buffer.alloc(256 * 3, 0)
  for (let i = 0; i < palette.length && i < 256; i += 1) {
    gct[i * 3] = palette[i][0]
    gct[i * 3 + 1] = palette[i][1]
    gct[i * 3 + 2] = palette[i][2]
  }
  chunks.push(gct)

  for (const frame of frames) {
    const delayCs = Math.max(1, Math.round((frame.delayMs ?? 100) / 10))
    const disposal = (frame.disposal ?? 0) & 0x07
    const hasTrans = Number.isInteger(frame.transparentIndex) && frame.transparentIndex >= 0
    const gce = Buffer.from([
      0x21,
      0xf9,
      0x04,
      (disposal << 2) | (hasTrans ? 0x01 : 0x00),
      delayCs & 0xff,
      (delayCs >> 8) & 0xff,
      hasTrans ? frame.transparentIndex : 0x00,
      0x00,
    ])
    chunks.push(gce)

    const fx = frame.left ?? 0
    const fy = frame.top ?? 0
    const fw = frame.width ?? width
    const fh = frame.height ?? height
    const desc = Buffer.alloc(10)
    desc[0] = 0x2c
    desc.writeUInt16LE(fx, 1)
    desc.writeUInt16LE(fy, 3)
    desc.writeUInt16LE(fw, 5)
    desc.writeUInt16LE(fh, 7)
    desc[9] = 0x00 // No local color table, not interlaced
    chunks.push(desc)

    chunks.push(frame.rawLzwBlock || encodeLzwMinimumCodeSize8(frame.indices))
  }

  chunks.push(Buffer.from([0x3b])) // Trailer
  return Buffer.concat(chunks)
}

async function synthesizeTestMp4(filePath, { width = 16, height = 12, fps = 10, durationSec = 1.2 } = {}) {
  await runGuardedTool(
    resolveVideoBinaryPath('ffmpeg'),
    [
      '-hide_banner',
      '-loglevel', 'error',
      '-y',
      '-f', 'lavfi',
      '-i', `testsrc2=size=${width}x${height}:rate=${fps}:duration=${durationSec}`,
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      filePath,
    ],
    {
      tool: 'ffmpeg',
      timeoutMs: 15000,
    },
  )
  return readFile(filePath)
}

test('decodeGifTimelineFrames composites partial frames, transparency, disposal modes 1/2/3, and preserves per-frame duration_ms', () => {
  // 4x4 canvas
  // Palette: 0 = transparent, 1 = Red (255,0,0), 2 = Green (0,255,0), 3 = Blue (0,0,255), 4 = Yellow (255,255,0)
  const palette = [
    [0, 0, 0],
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
    [255, 255, 0],
  ]
  const gifBuffer = buildTestGif({
    width: 4,
    height: 4,
    palette,
    frames: [
      // Frame 0: Full 4x4 Red (disposal 1 = do not dispose), delay 60ms, transparent index 0 (top-left pixel is 0 -> transparent)
      {
        left: 0,
        top: 0,
        width: 4,
        height: 4,
        disposal: 1,
        delayMs: 60,
        transparentIndex: 0,
        indices: [
          0, 1, 1, 1,
          1, 1, 1, 1,
          1, 1, 1, 1,
          1, 1, 1, 1,
        ],
      },
      // Frame 1: Partial 2x2 at (1,1) Green with disposal 2 (restore to background/transparent after frame 1), delay 140ms
      {
        left: 1,
        top: 1,
        width: 2,
        height: 2,
        disposal: 2,
        delayMs: 140,
        transparentIndex: 0,
        indices: [
          2, 0, // (1,1)=Green, (2,1)=Transparent (keeps Red from Frame 0!)
          2, 2, // (1,2)=Green, (2,2)=Green
        ],
      },
      // Frame 2: Partial 2x2 at (2,2) Blue with disposal 3 (restore to previous after frame 2), delay 90ms
      // Note: before Frame 2 draws, Frame 1's disposal=2 cleared (1,1..2,2) to transparent!
      {
        left: 2,
        top: 2,
        width: 2,
        height: 2,
        disposal: 3,
        delayMs: 90,
        transparentIndex: 0,
        indices: [
          3, 3,
          3, 3,
        ],
      },
      // Frame 3: Partial 1x1 at (0,0) Yellow, delay 210ms
      // Note: Frame 2's disposal=3 restored canvas to state before Frame 2 (where (2,2) was cleared by Frame 1's disposal=2)
      {
        left: 0,
        top: 0,
        width: 1,
        height: 1,
        disposal: 1,
        delayMs: 210,
        transparentIndex: 0,
        indices: [4],
      },
    ],
  })

  const classified = classifyMotionSource(gifBuffer, 'hero.gif')
  assert.equal(classified.kind, 'gif')
  assert.equal(classified.ext, 'gif')

  const decoded = decodeGifTimelineFrames(gifBuffer)
  assert.equal(decoded.width, 4)
  assert.equal(decoded.height, 4)
  assert.equal(decoded.frame_count, 4)
  assert.deepEqual(
    decoded.frames.map((f) => f.duration_ms),
    [60, 140, 90, 210],
  )
  assert.equal(decoded.total_duration_ms, 500)

  const pixelAt = (frameIdx, x, y) => {
    const rgba = decoded.frames[frameIdx].rgba
    const o = (y * 4 + x) * 4
    return [rgba[o], rgba[o + 1], rgba[o + 2], rgba[o + 3]]
  }

  // Frame 0: (0,0) is transparent, (1,0) and (1,1) are Red
  assert.deepEqual(pixelAt(0, 0, 0), [0, 0, 0, 0])
  assert.deepEqual(pixelAt(0, 1, 0), [255, 0, 0, 255])
  assert.deepEqual(pixelAt(0, 1, 1), [255, 0, 0, 255])

  // Frame 1: (1,1) is Green, (2,1) was transparent in partial frame so it preserved Red from Frame 0!
  assert.deepEqual(pixelAt(1, 1, 1), [0, 255, 0, 255])
  assert.deepEqual(pixelAt(1, 2, 1), [255, 0, 0, 255])
  assert.deepEqual(pixelAt(1, 0, 1), [255, 0, 0, 255])

  // Frame 2: Frame 1's disposal=2 cleared (1,1..2,2) to transparent; Frame 2 drew Blue at (2,2..3,3)
  assert.deepEqual(pixelAt(2, 1, 1), [0, 0, 0, 0], 'disposal=2 cleared (1,1) to transparent')
  assert.deepEqual(pixelAt(2, 2, 1), [0, 0, 0, 0], 'disposal=2 cleared (2,1) to transparent')
  assert.deepEqual(pixelAt(2, 2, 2), [0, 0, 255, 255], 'Frame 2 drew Blue at (2,2)')
  assert.deepEqual(pixelAt(2, 3, 3), [0, 0, 255, 255], 'Frame 2 drew Blue at (3,3)')

  // Frame 3: Frame 2's disposal=3 restored canvas to before Frame 2 ((2,2) is transparent again, (3,3) is Red again), and (0,0) is Yellow
  assert.deepEqual(pixelAt(3, 0, 0), [255, 255, 0, 255], 'Frame 3 drew Yellow at (0,0)')
  assert.deepEqual(pixelAt(3, 2, 2), [0, 0, 0, 0], 'disposal=3 restored (2,2) to transparent state before Frame 2')
  assert.deepEqual(pixelAt(3, 3, 3), [255, 0, 0, 255], 'disposal=3 restored (3,3) to Red state before Frame 2')
})

test('decodeGifTimelineFrames preserves non-transparent initial background and disposal=2 background restoration, and rejects oversized descriptors, out-of-bounds rects, and incomplete LZW streams', () => {
  // 1. Non-transparent GIF with GCT background color index 1 = Navy [10, 20, 80]:
  //    Frame 0 draws a partial 2x2 Orange [240, 120, 20] at (1,1) with disposal=2 (restore to background), no transparentIndex.
  //    Frame 1 draws a partial 1x1 White [255, 255, 255] at (0,0), no transparentIndex.
  //    - Frame 0 outside (1,1..2,2) must be Navy [10,20,80,255] (initial background), NOT transparent!
  //    - Frame 1 at (1,1) must be restored to Navy [10,20,80,255] by disposal=2, NOT cleared to transparent!
  const palette = [
    [0, 0, 0],
    [10, 20, 80],    // index 1: background color
    [240, 120, 20],  // index 2: orange
    [255, 255, 255], // index 3: white
  ]
  const nonTransparentGif = buildTestGif({
    width: 4,
    height: 4,
    palette,
    bgColorIndex: 1,
    frames: [
      {
        left: 1,
        top: 1,
        width: 2,
        height: 2,
        disposal: 2,
        delayMs: 90,
        transparentIndex: null,
        indices: [2, 2, 2, 2],
      },
      {
        left: 0,
        top: 0,
        width: 1,
        height: 1,
        disposal: 1,
        delayMs: 110,
        transparentIndex: null,
        indices: [3],
      },
    ],
  })
  const decodedBg = decodeGifTimelineFrames(nonTransparentGif)
  const px = (frameIdx, x, y) => {
    const rgba = decodedBg.frames[frameIdx].rgba
    const o = (y * 4 + x) * 4
    return [rgba[o], rgba[o + 1], rgba[o + 2], rgba[o + 3]]
  }
  assert.deepEqual(px(0, 0, 0), [10, 20, 80, 255], 'initial canvas outside partial Frame 0 uses GCT background color')
  assert.deepEqual(px(0, 1, 1), [240, 120, 20, 255], 'Frame 0 partial rect drew orange at (1,1)')
  assert.deepEqual(px(1, 0, 0), [255, 255, 255, 255], 'Frame 1 drew white at (0,0)')
  assert.deepEqual(px(1, 1, 1), [10, 20, 80, 255], 'disposal=2 on non-transparent frame restored (1,1) to GCT background color')

  // 2. Small logical screen (4x4) paired with huge frame descriptor (4096x4096) rejected before LZW allocation
  const oversizedDescGif = buildTestGif({
    width: 4,
    height: 4,
    palette,
    frames: [
      {
        left: 0,
        top: 0,
        width: 4096,
        height: 4096,
        delayMs: 80,
        rawLzwBlock: Buffer.from([8, 1, 0, 0]),
      },
    ],
  })
  assert.throws(
    () => decodeGifTimelineFrames(oversizedDescGif),
    (err) => err.code === 'resource_limit' && /frame dimensions \(4096×4096\) exceed/i.test(err.message),
  )

  // 3. Frame descriptor exceeding logical screen bounds (left=2, width=3 on 4x4 screen) rejected
  const outOfBoundsGif = buildTestGif({
    width: 4,
    height: 4,
    palette,
    frames: [
      {
        left: 2,
        top: 0,
        width: 3,
        height: 2,
        delayMs: 80,
        indices: [1, 1, 1, 1, 1, 1],
      },
    ],
  })
  assert.throws(
    () => decodeGifTimelineFrames(outOfBoundsGif),
    (err) => err.code === 'unsupported_input' && /frame bounds .* exceed the logical screen/i.test(err.message),
  )

  // 4. Premature EOI in LZW stream (only 2 pixels encoded for a 2x2=4 pixel frame) rejected
  const earlyEoiGif = buildTestGif({
    width: 2,
    height: 2,
    palette,
    frames: [
      {
        left: 0,
        top: 0,
        width: 2,
        height: 2,
        delayMs: 80,
        rawLzwBlock: encodeLzwMinimumCodeSize8([1, 1], { includeEoi: true }),
      },
    ],
  })
  assert.throws(
    () => decodeGifTimelineFrames(earlyEoiGif),
    (err) => err.code === 'unsupported_input' && /early EOI|prematurely/i.test(err.message),
  )

  // 5. LZW data exhausted before filling pixelCount (2 pixels without EOI for a 2x2=4 pixel frame) rejected
  const truncatedLzwGif = buildTestGif({
    width: 2,
    height: 2,
    palette,
    frames: [
      {
        left: 0,
        top: 0,
        width: 2,
        height: 2,
        delayMs: 80,
        rawLzwBlock: encodeLzwMinimumCodeSize8([1, 1], { includeEoi: false }),
      },
    ],
  })
  assert.throws(
    () => decodeGifTimelineFrames(truncatedLzwGif),
    (err) => err.code === 'unsupported_input' && /truncated before completing the frame/i.test(err.message),
  )
})

test('video probe and extraction support fps and stride sampling modes with accurate timing, non-integer segment end duration, and pre-decode safety limits', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'gametool-motion-video-test-'))
  const mp4Path = path.join(tempRoot, 'sample.mp4')
  const mp4Bytes = await synthesizeTestMp4(mp4Path, { width: 16, height: 12, fps: 10, durationSec: 1.5 })

  const classified = classifyMotionSource(mp4Bytes, 'sample.mp4')
  assert.equal(classified.kind, 'video')
  assert.equal(classified.ext, 'mp4')

  const probe = await probeVideoFile(mp4Path)
  assert.equal(probe.width, 16)
  assert.equal(probe.height, 12)
  assert.equal(probe.source_fps, 10)
  assert.ok(probe.duration_sec >= 1.4 && probe.duration_sec <= 1.6)

  // 1. FPS mode: 0.2s to 1.0s at 5 fps -> 4 frames, each 200ms (not hardcoded 125ms)
  const extractedFps = await extractVideoTimelineFrames(mp4Path, {
    probe,
    sampling: {
      start_sec: 0.2,
      end_sec: 1.0,
      sampling_mode: 'fps',
      fps: 5,
    },
  })
  assert.equal(extractedFps.width, 16)
  assert.equal(extractedFps.height, 12)
  assert.equal(extractedFps.frame_count, 4)
  assert.deepEqual(
    extractedFps.frames.map((f) => f.duration_ms),
    [200, 200, 200, 200],
  )
  assert.equal(extractedFps.total_duration_ms, 800)

  // 2. Stride mode: 0.0s to 0.9s with stride=3 on 10fps video -> 3 frames, each 300ms (total 900ms)
  const extractedStride = await extractVideoTimelineFrames(mp4Path, {
    probe,
    sampling: {
      start_sec: 0,
      end_sec: 0.9,
      sampling_mode: 'stride',
      stride: 3,
    },
  })
  assert.equal(extractedStride.frame_count, 3)
  assert.equal(extractedStride.total_duration_ms, 900)
  for (const frame of extractedStride.frames) {
    assert.ok(frame.duration_ms >= 280 && frame.duration_ms <= 320, `expected ~300ms for stride=3 at 10fps, got ${frame.duration_ms}`)
  }

  // 2b. Non-integer sampling interval segment: 0.0s to 0.8s on 12fps video with stride=2 (5 frames)
  //     Real PTS = [0, 0.166667, 0.333333, 0.5, 0.666667], segment end = 0.8s -> [167, 166, 167, 167, 133] = 800ms (NOT 834ms)
  const nonIntegerDurations = computeVideoFrameDurationsMs({
    frameCount: 5,
    samplingMode: 'stride',
    stride: 2,
    sourceFps: 12,
    ptsTimesSec: [0, 1 / 6, 2 / 6, 3 / 6, 4 / 6],
    startSec: 0,
    endSec: 0.8,
    segmentDurationSec: 0.8,
  })
  assert.deepEqual(nonIntegerDurations, [167, 166, 167, 167, 133])
  assert.equal(nonIntegerDurations.reduce((a, b) => a + b, 0), 800)

  const mp4Path12 = path.join(tempRoot, 'sample12fps.mp4')
  await synthesizeTestMp4(mp4Path12, { width: 16, height: 12, fps: 12, durationSec: 1.5 })
  const probe12 = await probeVideoFile(mp4Path12)
  const extractedNonInt = await extractVideoTimelineFrames(mp4Path12, {
    probe: probe12,
    sampling: {
      start_sec: 0,
      end_sec: 0.8,
      sampling_mode: 'stride',
      stride: 2,
    },
  })
  assert.equal(extractedNonInt.frame_count, 5)
  assert.deepEqual(
    extractedNonInt.frames.map((f) => f.duration_ms),
    [167, 166, 167, 167, 133],
  )
  assert.equal(extractedNonInt.total_duration_ms, 800)

  // 3. Pre-decode rejection when segment exceeds 64 frames (no silent truncation)
  await assert.rejects(
    () => extractVideoTimelineFrames(mp4Path, {
      probe: { ...probe, duration_sec: 20, source_fps: 30 },
      sampling: {
        start_sec: 0,
        end_sec: 10,
        sampling_mode: 'fps',
        fps: 10, // 100 frames > 64 limit
      },
    }),
    (err) => err.code === 'resource_limit' && /exceed(s|ing) the 64-frame limit/i.test(err.message),
  )

  // 4. Pre-decode rejection when dimensions exceed maxDimension (no silent downscaling)
  await assert.rejects(
    () => probeVideoFile(mp4Path, { maxDimension: 8 }),
    (err) => err.code === 'resource_limit' && /exceed the 8×8 px limit/i.test(err.message),
  )

  // 5. GIF > 64 frames rejected without silent truncation
  const palette = [[0, 0, 0], [255, 0, 0]]
  const tooManyFramesGif = buildTestGif({
    width: 2,
    height: 2,
    palette,
    frames: Array.from({ length: 65 }, () => ({
      width: 2,
      height: 2,
      delayMs: 50,
      indices: [1, 1, 1, 1],
    })),
  })
  assert.throws(
    () => decodeGifTimelineFrames(tooManyFramesGif),
    (err) => err.code === 'resource_limit' && /more than 64 frames/i.test(err.message),
  )
})

test('HTTP /motion-import endpoint supports probe/preview/commit, retains original source.<ext>, preserves existing canvases, and supports post-import timeline edits, export, and Undo/Redo', async () => {
  clearStagedMotionSources()
  const { randomUUID } = await import('node:crypto')
  const workspaceRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), 'gametool-motion-api-')))
  const projectRoot = path.join(workspaceRoot, 'projects')

  const created = await createEditorProjectV1({
    operationId: randomUUID(),
    name: 'Motion Timeline Test',
    projectRoot,
    workspaceRoot,
  })
  const projectId = created.project.id

  // Create an existing static canvas first to prove non-destructive placement
  const staticPng = encodeRgbaPng(4, 4, Buffer.alloc(4 * 4 * 4, 200))
  const staticImported = await createSpriteDocumentFromUploadedPng({
    projectId,
    operationId: randomUUID(),
    expectedRevision: created.project.revision,
    expectedSha256: sha256Bytes(staticPng),
    pngBytes: staticPng,
    name: 'Existing Static',
    projectRoot,
    workspaceRoot,
  })
  const initialCanvasId = Object.keys(staticImported.project.canvases)[0]
  const initialDocId = staticImported.document.document_id

  const artifactAccessRegistry = createEditorArtifactAccessRegistry()
  const server = http.createServer((req, res) => {
    handleEditorProjectApi(req, res, {
      projectRoot,
      workspaceRoot,
      generatedDir: path.join(projectRoot, 'generated'),
      artifactAccessRegistry,
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  const baseUrl = `http://127.0.0.1:${port}`

  try {
    // 1. GIF preview does NOT mutate project revision or canvases
    const gifBytes = buildTestGif({
      width: 4,
      height: 4,
      palette: [[0, 0, 0], [20, 180, 240], [240, 100, 40]],
      frames: [
        { width: 4, height: 4, delayMs: 80, transparentIndex: 0, indices: new Array(16).fill(1) },
        { width: 4, height: 4, delayMs: 160, transparentIndex: 0, indices: new Array(16).fill(2) },
      ],
    })
    const gifSha = sha256Bytes(gifBytes)

    const previewRes = await editorFetch(
      `${baseUrl}/api/editor/projects/${projectId}/sprite-documents/motion-import?` + new URLSearchParams({
        operation_id: randomUUID(),
        expected_revision: String(staticImported.project.revision),
        expected_sha256: gifSha,
        action: 'preview',
        kind: 'gif',
        file_name: 'slash.gif',
        name: 'slash',
      }),
      {
        method: 'POST',
        headers: {
          'content-type': 'application/octet-stream',
          'x-editor-local': '1',
        },
        body: gifBytes,
      },
    )
    assert.equal(previewRes.status, 200)
    const previewBody = await previewRes.json()
    assert.equal(previewBody.preview, true)
    assert.equal(previewBody.frame_count, 2)
    assert.deepEqual(previewBody.frames.map((f) => f.duration_ms), [80, 160])

    // Verify project was untouched by preview
    const checkProjRes = await editorFetch(`${baseUrl}/api/editor/projects/${projectId}`, {
      headers: { 'x-editor-local': '1' },
    })
    const checkProj = (await checkProjRes.json()).project
    assert.equal(checkProj.revision, staticImported.project.revision)
    assert.deepEqual(Object.keys(checkProj.canvases), [initialCanvasId])

    // 2. GIF commit creates a new sequence document & canvas, retains source.gif, and is idempotent on replay
    const gifCommitOpId = randomUUID()
    const commitQuery = new URLSearchParams({
      operation_id: gifCommitOpId,
      expected_revision: String(staticImported.project.revision),
      expected_sha256: gifSha,
      action: 'commit',
      kind: 'gif',
      file_name: 'slash.gif',
      name: 'slash',
    })
    const commitRes = await editorFetch(
      `${baseUrl}/api/editor/projects/${projectId}/sprite-documents/motion-import?${commitQuery}`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/octet-stream',
          'x-editor-local': '1',
        },
        body: new Uint8Array(0), // Uses staged preview!
      },
    )
    assert.equal(commitRes.status, 201)
    const commitBody = await commitRes.json()
    assert.equal(commitBody.receipt.operation_id, gifCommitOpId)
    assert.equal(commitBody.document.frame_order.length, 2)
    assert.equal(isGeneralSequenceSpriteDocument(commitBody.document, commitBody.project), true)
    assert.deepEqual(
      commitBody.document.frame_order.map((fid) => commitBody.document.frames[fid].duration_ms),
      [80, 160],
    )
    // Existing static canvas is still present and unchanged
    assert.ok(commitBody.project.canvases[initialCanvasId])
    assert.equal(commitBody.project.canvases[initialCanvasId].document_id, initialDocId)
    assert.equal(Object.keys(commitBody.project.canvases).length, 2)

    // Verify original GIF bytes retained on disk in asset revision directory
    const assetId = commitBody.document.source_ref.asset_id
    const assetRevId = commitBody.document.source_ref.revision_id
    const retainedGifPath = path.join(workspaceRoot, 'projects', projectId, 'assets', assetId, assetRevId, 'source.gif')
    const retainedGifBytes = await readFile(retainedGifPath)
    assert.equal(sha256Bytes(retainedGifBytes), gifSha)

    // Replay the exact same commit operation_id after clearing staged cache -> returns 200 idempotently
    clearStagedMotionSources()
    const replayRes = await editorFetch(
      `${baseUrl}/api/editor/projects/${projectId}/sprite-documents/motion-import?${commitQuery}`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/octet-stream',
          'x-editor-local': '1',
        },
        body: new Uint8Array(0),
      },
    )
    assert.equal(replayRes.status, 200)
    const replayBody = await replayRes.json()
    assert.equal(replayBody.receipt.operation_id, gifCommitOpId)
    assert.equal(replayBody.document.document_id, commitBody.document.document_id)
    assert.equal(Object.keys(replayBody.project.canvases).length, 2)

    // 3. Post-import timeline operations on the imported GIF sequence document:
    //    update frame duration, reorder frames, and delete a frame via working-structure
    const gifDocId = commitBody.document.document_id
    const [f1, f2] = commitBody.document.frame_order
    const durRes = await editorFetch(
      `${baseUrl}/api/editor/projects/${projectId}/sprite-documents/${gifDocId}/working-structure`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-editor-local': '1' },
        body: JSON.stringify({
          operation_id: randomUUID(),
          expected_revision: commitBody.project.revision,
          expected_working_revision: commitBody.document.revision,
          command: {
            type: 'set-duration',
            frame_id: f1,
            duration_ms: 120,
          },
        }),
      },
    )
    assert.equal(durRes.status, 200)
    const durBody = await durRes.json()
    assert.equal(durBody.document.frames[f1].duration_ms, 120)

    const reorderRes = await editorFetch(
      `${baseUrl}/api/editor/projects/${projectId}/sprite-documents/${gifDocId}/working-structure`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-editor-local': '1' },
        body: JSON.stringify({
          operation_id: randomUUID(),
          expected_revision: durBody.project.revision,
          expected_working_revision: durBody.document.revision,
          command: {
            type: 'move-frame',
            frame_id: f2,
            index: 0,
          },
        }),
      },
    )
    assert.equal(reorderRes.status, 200)
    const reorderBody = await reorderRes.json()
    assert.deepEqual(reorderBody.document.frame_order, [f2, f1])

    // 4. Video probe -> preview -> commit -> Undo (detach) -> Redo (restore)
    const mp4Path = path.join(workspaceRoot, 'clip.mp4')
    const mp4Bytes = await synthesizeTestMp4(mp4Path, { width: 16, height: 12, fps: 10, durationSec: 1.0 })
    const mp4Sha = sha256Bytes(mp4Bytes)

    const probeRes = await editorFetch(
      `${baseUrl}/api/editor/projects/${projectId}/sprite-documents/motion-import?` + new URLSearchParams({
        operation_id: randomUUID(),
        expected_revision: String(reorderBody.project.revision),
        expected_sha256: mp4Sha,
        action: 'probe',
        kind: 'video',
        file_name: 'clip.mp4',
        name: 'clip',
      }),
      {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream', 'x-editor-local': '1' },
        body: mp4Bytes,
      },
    )
    assert.equal(probeRes.status, 200)
    const probeBody = await probeRes.json()
    assert.equal(probeBody.probe, true)
    assert.equal(probeBody.width, 16)
    assert.equal(probeBody.height, 12)

    const vidPrevRes = await editorFetch(
      `${baseUrl}/api/editor/projects/${projectId}/sprite-documents/motion-import?` + new URLSearchParams({
        operation_id: randomUUID(),
        expected_revision: String(reorderBody.project.revision),
        expected_sha256: mp4Sha,
        action: 'preview',
        kind: 'video',
        file_name: 'clip.mp4',
        name: 'clip',
        start_sec: '0',
        end_sec: '0.6',
        sampling_mode: 'fps',
        fps: '5',
      }),
      {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream', 'x-editor-local': '1' },
        body: new Uint8Array(0),
      },
    )
    assert.equal(vidPrevRes.status, 200)
    const vidPrevBody = await vidPrevRes.json()
    assert.equal(vidPrevBody.frame_count, 3)
    assert.deepEqual(vidPrevBody.frames.map((f) => f.duration_ms), [200, 200, 200])

    const vidCommitRes = await editorFetch(
      `${baseUrl}/api/editor/projects/${projectId}/sprite-documents/motion-import?` + new URLSearchParams({
        operation_id: randomUUID(),
        expected_revision: String(reorderBody.project.revision),
        expected_sha256: mp4Sha,
        action: 'commit',
        kind: 'video',
        file_name: 'clip.mp4',
        name: 'clip',
        start_sec: '0',
        end_sec: '0.6',
        sampling_mode: 'fps',
        fps: '5',
      }),
      {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream', 'x-editor-local': '1' },
        body: new Uint8Array(0),
      },
    )
    assert.equal(vidCommitRes.status, 201)
    const vidCommitBody = await vidCommitRes.json()
    const vidCanvasId = vidCommitBody.canvas.id
    const vidAssetId = vidCommitBody.document.source_ref.asset_id
    const vidRevId = vidCommitBody.document.source_ref.revision_id
    const retainedMp4Path = path.join(workspaceRoot, 'projects', projectId, 'assets', vidAssetId, vidRevId, 'source.mp4')
    const retainedMp4Bytes = await readFile(retainedMp4Path)
    assert.equal(retainedMp4Bytes.byteLength, mp4Bytes.byteLength)
    assert.equal(sha256Bytes(retainedMp4Bytes), mp4Sha)
    assert.equal(Buffer.compare(retainedMp4Bytes, mp4Bytes), 0)

    // Undo (detachCanvas) removes the imported video canvas in one step
    const vidUndoOpId = randomUUID()
    const detachRes = await editorFetch(
      `${baseUrl}/api/editor/projects/${projectId}/canvases/${vidCanvasId}/detach`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-editor-local': '1' },
        body: JSON.stringify({
          operation_id: vidUndoOpId,
          expected_revision: vidCommitBody.project.revision,
        }),
      },
    )
    assert.equal(detachRes.status, 200)
    const detachBody = await detachRes.json()
    assert.equal(Boolean(detachBody.project.canvases[vidCanvasId]), false)

    // Redo (restoreCanvas) restores the imported video canvas in one step
    const restoreRes = await editorFetch(
      `${baseUrl}/api/editor/projects/${projectId}/canvases/${vidCanvasId}/restore`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-editor-local': '1' },
        body: JSON.stringify({
          operation_id: randomUUID(),
          expected_revision: detachBody.project.revision,
          detach_operation_id: vidUndoOpId,
        }),
      },
    )
    assert.equal(restoreRes.status, 200)
    const restoreBody = await restoreRes.json()
    assert.equal(Boolean(restoreBody.project.canvases[vidCanvasId]), true)
  } finally {
    await new Promise((resolve) => server.close(resolve))
    clearStagedMotionSources()
  }
})
