import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import JSZip from 'jszip'

import { encodeGifFromRgbaFrames } from '../../src/character-pack/gifExport.js'
import { encodeRgbaPng, loadRgba } from '../../src/character-pack/imageCodec.js'
import { TOPDOWN_RPG_V0, getAnimationFrameIndexes } from '../../src/character-pack/profile.js'
import { validateNormalizedFrames } from '../../src/character-pack/validator.js'
import { buildEditorFramesJson } from '../../src/motion-source/editorJson.js'
import { buildEditorHandoffManifest, writeEditorHandoffArtifacts } from '../../src/motion-source/editorHandoff.js'
import { analyzeMotionSource } from '../../src/motion-source/sourceAnalyzer.js'
import { createMotionSourceContract } from '../../src/motion-source/contract.js'
import { evaluateIdentityConsistency } from '../../src/motion-source/identityConsistencyGate.js'
import { applyMotionStrip } from '../../src/motion-source/stripApplier.js'
import { buildMotionStrip } from '../../src/motion-source/stripBuilder.js'
import { extractFrames } from '../../src/video-sprite/frameExtractor.js'

function blankImage(width, height, fill = [0, 0, 0, 0]) {
  const image = { width, height, data: new Uint8ClampedArray(width * height * 4) }
  for (let index = 0; index < width * height; index += 1) {
    image.data[index * 4] = fill[0]
    image.data[index * 4 + 1] = fill[1]
    image.data[index * 4 + 2] = fill[2]
    image.data[index * 4 + 3] = fill[3]
  }
  return image
}

function paintRect(image, rect, color) {
  for (let y = rect.y; y < rect.y + rect.h; y += 1) {
    for (let x = rect.x; x < rect.x + rect.w; x += 1) {
      if (x < 0 || y < 0 || x >= image.width || y >= image.height) continue
      const offset = (y * image.width + x) * 4
      image.data[offset] = color[0]
      image.data[offset + 1] = color[1]
      image.data[offset + 2] = color[2]
      image.data[offset + 3] = color[3]
    }
  }
}

function makeMotionFrame({
  index,
  background = [255, 255, 255, 255],
  body = [92, 132, 190, 255],
  transparentBackground = false,
} = {}) {
  const fill = transparentBackground ? [0, 0, 0, 0] : background
  const image = blankImage(48, 48, fill)
  const bodyX = 17 + index
  paintRect(image, { x: bodyX, y: 10, w: 11, h: 27 }, body)
  paintRect(image, { x: bodyX + 2, y: 6, w: 7, h: 6 }, body)
  paintRect(image, { x: bodyX + (index % 2 === 0 ? -3 : 2), y: 36, w: 5, h: 4 }, body)
  paintRect(image, { x: bodyX + 8 + (index % 2 === 0 ? 2 : -3), y: 36, w: 5, h: 4 }, body)
  return image
}

function makeMotionFrames(count, options = {}) {
  return Array.from({ length: count }, (_, index) => makeMotionFrame({ index, ...options }))
}

async function makeMotionZip({ count = 6, body = [92, 132, 190, 255] } = {}) {
  const zip = new JSZip()
  const frames = makeMotionFrames(count, { body })
  for (const [index, frame] of frames.entries()) {
    zip.file(`frame_${String(index + 1).padStart(3, '0')}.png`, await encodeRgbaPng(frame))
  }
  return zip.generateAsync({ type: 'nodebuffer' })
}

function makeMotionGif({ count = 6, body = [96, 134, 188, 255] } = {}) {
  return encodeGifFromRgbaFrames(
    makeMotionFrames(count, { body, transparentBackground: true }),
    { delay: 90 }
  )
}

function pasteCell(sheet, frameIndex, cell) {
  const col = frameIndex % TOPDOWN_RPG_V0.grid.columns
  const row = Math.floor(frameIndex / TOPDOWN_RPG_V0.grid.columns)
  for (let y = 0; y < TOPDOWN_RPG_V0.frame.h; y += 1) {
    for (let x = 0; x < TOPDOWN_RPG_V0.frame.w; x += 1) {
      const src = (y * TOPDOWN_RPG_V0.frame.w + x) * 4
      const dst = ((row * TOPDOWN_RPG_V0.frame.h + y) * TOPDOWN_RPG_V0.sheet.w + col * TOPDOWN_RPG_V0.frame.w + x) * 4
      sheet.data[dst] = cell.data[src]
      sheet.data[dst + 1] = cell.data[src + 1]
      sheet.data[dst + 2] = cell.data[src + 2]
      sheet.data[dst + 3] = cell.data[src + 3]
    }
  }
}

function makeFullSheet() {
  const sheet = blankImage(TOPDOWN_RPG_V0.sheet.w, TOPDOWN_RPG_V0.sheet.h)
  const cell = blankImage(TOPDOWN_RPG_V0.frame.w, TOPDOWN_RPG_V0.frame.h)
  paintRect(cell, { x: 40, y: 40, w: 16, h: 49 }, [60, 60, 60, 255])
  for (let index = 0; index < TOPDOWN_RPG_V0.grid.columns * TOPDOWN_RPG_V0.grid.rows; index += 1) {
    pasteCell(sheet, index, cell)
  }
  return sheet
}

function sampleAppliedFrame(sheet, frameIndex, normalizedBbox) {
  const col = frameIndex % TOPDOWN_RPG_V0.grid.columns
  const row = Math.floor(frameIndex / TOPDOWN_RPG_V0.grid.columns)
  const x = col * TOPDOWN_RPG_V0.frame.w + Math.floor(normalizedBbox.centerX)
  const y = row * TOPDOWN_RPG_V0.frame.h + Math.floor(normalizedBbox.centerY)
  const offset = (y * sheet.width + x) * 4
  return [...sheet.data.slice(offset, offset + 4)]
}

test('encoded GIF and ZIP motion sources complete the provider-free strip workflow', async () => {
  const zipBuffer = await makeMotionZip()
  const gifBuffer = makeMotionGif()

  const zipAnalysis = await analyzeMotionSource({ name: 'walk_down.zip', buffer: zipBuffer })
  const gifAnalysis = await analyzeMotionSource({ name: 'idle_down.gif', buffer: gifBuffer })

  assert.equal(zipAnalysis.status, 'ok')
  assert.equal(zipAnalysis.source_kind, 'frame_sequence_zip')
  assert.equal(gifAnalysis.status, 'ok')
  assert.equal(gifAnalysis.source_kind, 'gif')

  const zipExtracted = await extractFrames(zipBuffer, { name: 'walk_down.zip', kind: 'zip' })
  const gifExtracted = await extractFrames(gifBuffer, { name: 'idle_down.gif', kind: 'gif' })

  assert.equal(zipExtracted.kind, 'zip')
  assert.equal(zipExtracted.frame_count_raw, 6)
  assert.equal(gifExtracted.kind, 'gif')
  assert.equal(gifExtracted.frame_count_raw, 6)

  const walkStrip = await buildMotionStrip({
    frames: zipExtracted.frames,
    contract: createMotionSourceContract({
      source_kind: 'frame_sequence_zip',
      runtime_action: 'walk_down',
      target_frame_count: 4,
    }),
  })
  const idleStrip = await buildMotionStrip({
    frames: gifExtracted.frames,
    contract: createMotionSourceContract({
      source_kind: 'gif',
      runtime_action: 'idle_down',
      target_frame_count: 4,
    }),
  })

  const walkImage = await loadRgba(walkStrip.normalizedMotionStripPng)
  const idleImage = await loadRgba(idleStrip.normalizedMotionStripPng)
  assert.deepEqual([walkImage.width, walkImage.height], [384, 96])
  assert.deepEqual([idleImage.width, idleImage.height], [384, 96])
  assert.equal(walkStrip.report.status, 'done')
  assert.equal(walkStrip.report.selected_frame_count, 4)
  assert.equal(idleStrip.report.status, 'done')
  assert.equal(idleStrip.report.selected_frame_count, 4)

  const identity = evaluateIdentityConsistency([
    { id: 'idle_down', runtime_action: 'idle_down', image: idleStrip.stripImage, facing_direction: 'down' },
    { id: 'walk_down', runtime_action: 'walk_down', image: walkStrip.stripImage, facing_direction: 'down' },
  ], {
    identityAnchor: { source_id: 'idle_down', facing_direction: 'down' },
  })

  assert.equal(identity.status, 'pass')
  assert.equal(identity.can_apply_multi_strip, true)

  const applyResult = await applyMotionStrip({
    sheet: makeFullSheet(),
    strip: walkStrip.stripImage,
    action: 'walk_down',
  })
  const applied = await loadRgba(applyResult.appliedNormalizedSheetPng)
  const targetIndexes = getAnimationFrameIndexes('walk_down')
  const copiedColor = sampleAppliedFrame(applied, targetIndexes[0], walkStrip.report.normalized_frames[0].normalized_bbox)
  const untouchedColor = sampleAppliedFrame(applied, 0, { centerX: 48, centerY: 64 })

  assert.equal(applyResult.report.status, 'done')
  assert.equal(applyResult.report.resample_strategy, 'exact')
  assert.deepEqual(copiedColor, [92, 132, 190, 255])
  assert.deepEqual(untouchedColor, [60, 60, 60, 255])
  assert.deepEqual(validateNormalizedFrames(applyResult.frames, TOPDOWN_RPG_V0).blocking_errors, [])

  const handoffDir = await mkdtemp(path.join(os.tmpdir(), 'motion-source-e2e-'))
  const editorFrames = buildEditorFramesJson({
    action: 'walk_down',
    sheetSize: { w: walkStrip.stripImage.width, h: walkStrip.stripImage.height },
    cellSize: TOPDOWN_RPG_V0.frame,
  })
  const handoffManifest = buildEditorHandoffManifest({
    action: 'walk_down',
    frameCount: 4,
    cellSize: TOPDOWN_RPG_V0.frame,
    sheetSize: { w: walkStrip.stripImage.width, h: walkStrip.stripImage.height },
  })
  const written = await writeEditorHandoffArtifacts({ outDir: handoffDir, editorFramesJson: editorFrames, manifest: handoffManifest })

  assert.equal(JSON.parse(await readFile(written.editor_frames_json, 'utf8')).meta.frameTags[0].name, 'walk_down')
  assert.equal(JSON.parse(await readFile(written.editor_handoff_manifest_json, 'utf8')).reimport_contract.required_same_size, true)
})
