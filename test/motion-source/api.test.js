import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { chmod, mkdtemp, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

import JSZip from 'jszip'

import { encodeRgbaPng } from '../../src/character-pack/imageCodec.js'
import { TOPDOWN_RPG_V0 } from '../../src/character-pack/profile.js'

const TERMINAL = new Set(['done', 'failed_quality_gate', 'failed_safety_filter', 'failed_model_error', 'failed_post_processing'])

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  })
}

function paintRect(image, rect, color) {
  for (let y = rect.y; y < rect.y + rect.h; y += 1) {
    for (let x = rect.x; x < rect.x + rect.w; x += 1) {
      const offset = (y * image.width + x) * 4
      image.data[offset] = color[0]
      image.data[offset + 1] = color[1]
      image.data[offset + 2] = color[2]
      image.data[offset + 3] = color[3]
    }
  }
}

function blankImage(width, height) {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) }
}

function makeMotionFrame(index = 0, color = [70, 100, 180, 255]) {
  const image = blankImage(48, 48)
  paintRect(image, { x: 0, y: 0, w: 48, h: 48 }, [255, 255, 255, 255])
  paintRect(image, { x: 15 + (index % 2), y: 10, w: 14, h: 28 }, color)
  paintRect(image, { x: 12 + (index % 3), y: 37, w: 5, h: 3 }, color)
  paintRect(image, { x: 27 - (index % 2), y: 37, w: 5, h: 3 }, color)
  return image
}

async function makeMotionZip(frameCount = 6, color = [70, 100, 180, 255]) {
  const zip = new JSZip()
  for (let index = 0; index < frameCount; index += 1) {
    zip.file(`frame_${String(index + 1).padStart(2, '0')}.png`, await encodeRgbaPng(makeMotionFrame(index, color)))
  }
  return zip.generateAsync({ type: 'nodebuffer' })
}

function makeMp4LikeBuffer() {
  return Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x18]),
    Buffer.from('ftypmp42'),
    Buffer.alloc(32),
  ])
}

async function makeFakeFfmpeg() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'motion-source-api-ffmpeg-'))
  const frameBuffers = await Promise.all(
    Array.from({ length: 6 }, (_, index) => encodeRgbaPng(makeMotionFrame(index, [90, 120, 190, 255])))
  )
  const binary = path.join(root, 'fake-ffmpeg.js')
  await writeFile(binary, `#!/usr/bin/env node
const { mkdirSync, writeFileSync } = require('node:fs')
const path = require('node:path')
if (process.argv.includes('-version')) {
  console.log('ffmpeg fake-test')
  process.exit(0)
}
const outputPattern = process.argv[process.argv.length - 1]
mkdirSync(path.dirname(outputPattern), { recursive: true })
const frames = ${JSON.stringify(frameBuffers.map((buffer) => buffer.toString('base64')))}
for (let index = 0; index < frames.length; index += 1) {
  writeFileSync(outputPattern.replace('%05d', String(index + 1).padStart(5, '0')), Buffer.from(frames[index], 'base64'))
}
`)
  await chmod(binary, 0o755)
  return binary
}

async function makeFakeRembg() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'motion-source-api-rembg-'))
  const outputFrame = await encodeRgbaPng(makeMotionFrame(0, [130, 80, 170, 255]))
  const binary = path.join(root, 'fake-rembg.js')
  const marker = path.join(root, 'started.marker')
  const blockFile = path.join(root, 'block.marker')
  await writeFile(binary, `#!/usr/bin/env node
const { appendFileSync, existsSync, mkdirSync, writeFileSync } = require('node:fs')
const path = require('node:path')
if (process.argv.includes('--version')) {
  console.log('rembg fake-test')
  process.exit(0)
}
const outputPath = process.argv[process.argv.length - 1]
mkdirSync(path.dirname(outputPath), { recursive: true })
if (process.env.FAKE_REMBG_MARKER) appendFileSync(process.env.FAKE_REMBG_MARKER, outputPath + '\\n')
const delay = process.env.FAKE_REMBG_BLOCK_FILE && existsSync(process.env.FAKE_REMBG_BLOCK_FILE) ? 5000 : 0
setTimeout(() => {
  writeFileSync(outputPath, Buffer.from('${outputFrame.toString('base64')}', 'base64'))
}, delay)
`)
  await chmod(binary, 0o755)
  return { binary, marker, blockFile }
}

function makeCell(color = [80, 80, 80, 255], dx = 0) {
  const cell = blankImage(TOPDOWN_RPG_V0.frame.w, TOPDOWN_RPG_V0.frame.h)
  paintRect(cell, { x: 40 + dx, y: 40, w: 16, h: 49 }, color)
  return cell
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

async function makeSheetPng() {
  const sheet = blankImage(TOPDOWN_RPG_V0.sheet.w, TOPDOWN_RPG_V0.sheet.h)
  for (let frame = 0; frame < TOPDOWN_RPG_V0.grid.columns * TOPDOWN_RPG_V0.grid.rows; frame += 1) {
    pasteCell(sheet, frame, makeCell([60, 60, 60, 255]))
  }
  return encodeRgbaPng(sheet)
}

function makeStrip(frameCount = 8, color = [120, 80, 160, 255]) {
  const strip = blankImage(TOPDOWN_RPG_V0.frame.w * frameCount, TOPDOWN_RPG_V0.frame.h)
  for (let index = 0; index < frameCount; index += 1) {
    const cell = makeCell([color[0] + index, color[1], color[2], 255], index % 2)
    for (let y = 0; y < TOPDOWN_RPG_V0.frame.h; y += 1) {
      for (let x = 0; x < TOPDOWN_RPG_V0.frame.w; x += 1) {
        const src = (y * TOPDOWN_RPG_V0.frame.w + x) * 4
        const dst = (y * strip.width + index * TOPDOWN_RPG_V0.frame.w + x) * 4
        strip.data[dst] = cell.data[src]
        strip.data[dst + 1] = cell.data[src + 1]
        strip.data[dst + 2] = cell.data[src + 2]
        strip.data[dst + 3] = cell.data[src + 3]
      }
    }
  }
  return strip
}

async function makeStripPng(frameCount = 8, color = [120, 80, 160, 255]) {
  return encodeRgbaPng(makeStrip(frameCount, color))
}

function waitForServer(child) {
  return new Promise((resolve, reject) => {
    let output = ''
    const onData = (chunk) => {
      output += chunk.toString()
      if (output.includes('Character tool running')) resolve()
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.once('exit', (code) => reject(new Error(`server exited before ready: ${code}\n${output}`)))
  })
}

async function fetchJson(baseUrl, path, options) {
  const { response, json, text } = await fetchResponseJson(baseUrl, path, options)
  if (!response.ok) throw new Error(`${path} returned ${response.status}: ${text}`)
  return json
}

async function fetchResponseJson(baseUrl, requestPath, options) {
  const response = await fetch(new URL(requestPath, baseUrl), options)
  const text = await response.text()
  return {
    response,
    text,
    json: text ? JSON.parse(text) : {},
  }
}

async function uploadMotionSource(baseUrl, sourceName, buffer, operationId, contentType) {
  return fetchJson(
    baseUrl,
    `/api/motion-source/uploads?source_name=${encodeURIComponent(sourceName)}&operation_id=${encodeURIComponent(operationId)}`,
    {
      method: 'POST',
      headers: { 'content-type': contentType },
      body: buffer,
    }
  )
}

function beginMotionSourceUpload(baseUrl, sourceName, operationId, contentType, contentLength) {
  const target = new URL(
    `/api/motion-source/uploads?source_name=${encodeURIComponent(sourceName)}&operation_id=${encodeURIComponent(operationId)}`,
    baseUrl
  )
  const request = http.request(target, {
    method: 'POST',
    headers: {
      'content-type': contentType,
      'content-length': String(contentLength),
    },
  })
  const response = new Promise((resolve, reject) => {
    request.once('error', reject)
    request.once('response', (incoming) => {
      const chunks = []
      incoming.on('data', (chunk) => chunks.push(chunk))
      incoming.once('error', reject)
      incoming.once('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        resolve({
          status: incoming.statusCode,
          text,
          json: text ? JSON.parse(text) : {},
        })
      })
    })
  })
  return { request, response }
}

function sourceRequest(descriptor, operationId, options = undefined) {
  return {
    source_upload_id: descriptor.upload_id,
    source_identity: descriptor.source_identity,
    operation_id: operationId,
    ...(options ? { options } : {}),
  }
}

async function fetchOk(baseUrl, path) {
  const response = await fetch(new URL(path, baseUrl))
  assert.equal(response.ok, true, `${path} should be fetchable`)
  return response
}

async function waitForJob(baseUrl, id) {
  let current = await fetchJson(baseUrl, `/api/jobs/${id}`)
  for (let i = 0; !TERMINAL.has(current.status) && i < 240; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    current = await fetchJson(baseUrl, `/api/jobs/${id}`)
  }
  return current
}

async function waitForMarkerLines(filePath, expectedCount) {
  for (let index = 0; index < 200; index += 1) {
    try {
      const lines = (await readFile(filePath, 'utf8'))
        .split('\n')
        .filter(Boolean)
      if (lines.length >= expectedCount) return lines
    } catch {
      // The marker is created by the external tool after it starts.
    }
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`timed out waiting for ${expectedCount} marker lines: ${filePath}`)
}

test('motion source local API analyzes builds applies and gates source sets without providers', async (t) => {
  const appServer = http.createServer()
  const appPort = await listen(appServer)
  appServer.close()
  await once(appServer, 'close')
  const fakeFfmpegPath = await makeFakeFfmpeg()
  const fakeRembg = await makeFakeRembg()
  const motionSpoolDir = await mkdtemp(path.join(os.tmpdir(), 'motion-source-api-spool-'))

  const child = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(appPort),
      CHARACTER_JOB_CONCURRENCY: '1',
      CHARACTER_PROVIDER_PRESETS: '[]',
      OPENROUTER_API_KEY: '',
      GEMINI_API_KEY: '',
      GOOGLE_API_KEY: '',
      CHARACTER_IMAGE_API_KEY: '',
      FFMPEG_PATH: fakeFfmpegPath,
      REMBG_PATH: fakeRembg.binary,
      FAKE_REMBG_MARKER: fakeRembg.marker,
      FAKE_REMBG_BLOCK_FILE: fakeRembg.blockFile,
      MOTION_SOURCE_SPOOL_DIR: motionSpoolDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  t.after(async () => {
    if (child.exitCode !== null) return
    child.kill('SIGTERM')
    await once(child, 'exit')
  })
  await waitForServer(child)

  const baseUrl = `http://127.0.0.1:${appPort}`
  const sourceZip = await makeMotionZip(6)

  const toolStatus = await fetchJson(baseUrl, '/api/motion-source-tool-status')
  assert.equal(toolStatus.ffmpeg.available, true)
  assert.equal(toolStatus.rembg.available, true)

  const sourceUpload = await uploadMotionSource(
    baseUrl,
    'walk_down.zip',
    sourceZip,
    'upload_walk_down',
    'application/zip'
  )
  assert.match(sourceUpload.upload_id, /^motion_upload_/)
  assert.match(sourceUpload.source_identity, /^sha256:[a-f0-9]{64}$/)
  assert.equal(sourceUpload.byte_length, sourceZip.length)
  assert.equal(sourceUpload.media_kind, 'frame_sequence_zip')
  assert.equal(sourceUpload.session_scope, 'current_server_process')
  const repeatedUpload = await uploadMotionSource(
    baseUrl,
    'walk_down.zip',
    sourceZip,
    'upload_walk_down',
    'application/zip'
  )
  assert.equal(repeatedUpload.upload_id, sourceUpload.upload_id)
  const conflictingUpload = await fetchResponseJson(
    baseUrl,
    '/api/motion-source/uploads?source_name=walk_down.zip&operation_id=upload_walk_down',
    {
      method: 'POST',
      headers: { 'content-type': 'application/zip' },
      body: await makeMotionZip(3),
    }
  )
  assert.equal(conflictingUpload.response.status, 409)
  assert.equal(conflictingUpload.json.error, 'operation_conflict')

  const invalidRelease = await fetchResponseJson(
    baseUrl,
    '/api/motion-source/uploads/not-a-server-upload',
    { method: 'DELETE' }
  )
  assert.equal(invalidRelease.response.status, 400)
  assert.equal(invalidRelease.json.error, 'invalid_upload_id')

  const precommittedRelease = await fetchJson(
    baseUrl,
    '/api/motion-source/upload-operations/upload_release_before_commit',
    { method: 'DELETE' }
  )
  assert.equal(precommittedRelease.pending, true)
  const releasedDuringUpload = await uploadMotionSource(
    baseUrl,
    'released_during_upload.zip',
    sourceZip,
    'upload_release_before_commit',
    'application/zip'
  )
  assert.equal(releasedDuringUpload.release_requested, true)
  assert.equal(releasedDuringUpload.release_pending, false)
  const releasedDuringUploadUse = await fetchResponseJson(baseUrl, '/api/preview-motion-frames', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(sourceRequest(releasedDuringUpload, 'preview_released_during_upload')),
  })
  assert.equal(releasedDuringUploadUse.response.status, 404)
  assert.equal(releasedDuringUploadUse.json.error, 'upload_not_found')

  const concurrentOperationId = 'upload_release_concurrent_replay'
  const pendingUpload = beginMotionSourceUpload(
    baseUrl,
    'released_after_concurrent_replay.zip',
    concurrentOperationId,
    'application/zip',
    sourceZip.length
  )
  t.after(() => pendingUpload.request.destroy())
  const splitAt = Math.max(1, Math.floor(sourceZip.length / 2))
  pendingUpload.request.write(sourceZip.subarray(0, splitAt))
  let concurrentRelease
  let concurrentReplay
  try {
    await new Promise((resolve) => setTimeout(resolve, 25))
    concurrentRelease = await fetchJson(
      baseUrl,
      `/api/motion-source/upload-operations/${concurrentOperationId}`,
      { method: 'DELETE' }
    )
    concurrentReplay = await fetchResponseJson(
      baseUrl,
      `/api/motion-source/uploads?source_name=released_after_concurrent_replay.zip&operation_id=${concurrentOperationId}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/zip' },
        body: sourceZip,
      }
    )
  } finally {
    if (!pendingUpload.request.writableEnded) {
      pendingUpload.request.end(sourceZip.subarray(splitAt))
    }
  }
  const concurrentCommitted = await pendingUpload.response
  assert.equal(concurrentRelease.pending, true)
  assert.equal(concurrentReplay.response.status, 409)
  assert.equal(concurrentReplay.json.error, 'operation_in_progress')
  assert.equal(concurrentCommitted.status, 201)
  assert.equal(concurrentCommitted.json.release_requested, true)
  assert.equal(concurrentCommitted.json.release_pending, false)
  const concurrentReleasedUse = await fetchResponseJson(baseUrl, '/api/preview-motion-frames', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(sourceRequest(concurrentCommitted.json, 'preview_concurrent_released_upload')),
  })
  assert.equal(concurrentReleasedUse.response.status, 404)
  assert.equal(concurrentReleasedUse.json.error, 'upload_not_found')

  const previewInitial = await fetchJson(baseUrl, '/api/preview-motion-frames', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(sourceRequest(sourceUpload, 'preview_walk_down', {
      maxFrames: 5,
      fps: 8,
      startSec: 0,
    })),
  })
  const previewJob = await waitForJob(baseUrl, previewInitial.id)
  assert.equal(previewJob.status, 'done')
  assert.equal(previewJob.frame_count, 5)
  assert.ok(previewJob.frame_preview_index_url)
  assert.ok(previewJob.frame_preview_sheet_url)
  await fetchOk(baseUrl, previewJob.frame_preview_sheet_url)
  const previewIndex = await fetchJson(baseUrl, previewJob.frame_preview_index_url)
  assert.equal(previewIndex.mode, 'motion_frame_preview_index_v2')
  assert.equal(previewIndex.schema_version, 2)
  assert.equal(previewIndex.default_selection_mode, 'auto')
  assert.equal(previewIndex.frames.length, 5)
  assert.equal(previewIndex.frames[0].preview_file, 'frame_previews/frame_00001.png')
  assert.deepEqual(
    previewIndex.frames.map((frame) => frame.raw_index),
    [0, 1, 2, 3, 4]
  )
  assert.equal(previewIndex.source_identity, sourceUpload.source_identity)
  assert.equal(previewIndex.operation_id, 'preview_walk_down')
  assert.equal(previewJob.motion_source_lifecycle, 'completed')
  assert.match(previewJob.options_hash, /^sha256:[a-f0-9]{64}$/)

  const analyzeInitial = await fetchJson(baseUrl, '/api/analyze-motion-source', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(sourceRequest(sourceUpload, 'analyze_walk_down')),
  })
  const analyzeJob = await waitForJob(baseUrl, analyzeInitial.id)
  assert.equal(analyzeJob.status, 'done')
  assert.equal(analyzeJob.source_kind, 'frame_sequence_zip')
  assert.equal(analyzeJob.source_identity, sourceUpload.source_identity)
  assert.equal(analyzeJob.operation_id, 'analyze_walk_down')
  assert.ok(analyzeJob.motion_source_analysis_url)
  const analysisArtifact = await fetchJson(baseUrl, analyzeJob.motion_source_analysis_url)
  assert.equal(analysisArtifact.source_identity, sourceUpload.source_identity)
  assert.equal(analysisArtifact.operation_id, 'analyze_walk_down')

  const corruptUpload = await fetchResponseJson(
    baseUrl,
    '/api/motion-source/uploads?source_name=broken.gif&operation_id=upload_broken',
    {
      method: 'POST',
      headers: { 'content-type': 'image/gif' },
      body: Buffer.from('not really a gif'),
    }
  )
  assert.equal(corruptUpload.response.status, 415)
  assert.equal(corruptUpload.json.error, 'corrupt_or_unsupported_source')

  const identityMismatch = await fetchResponseJson(baseUrl, '/api/analyze-motion-source', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...sourceRequest(sourceUpload, 'analyze_identity_mismatch'),
      source_identity: `sha256:${'0'.repeat(64)}`,
    }),
  })
  assert.equal(identityMismatch.response.status, 409)
  assert.equal(identityMismatch.json.error, 'source_identity_mismatch')

  const buildInitial = await fetchJson(baseUrl, '/api/build-motion-strip', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(sourceRequest(sourceUpload, 'build_walk_down_auto', {
      action: 'walk_down',
      frames: 4,
      selection_mode: 'auto',
      background: { tolerance: 31, defringe: false },
      anchor_policy: { static_offset_y: -2 },
    })),
  })
  const buildJob = await waitForJob(baseUrl, buildInitial.id)
  assert.equal(buildJob.status, 'done')
  assert.ok(buildJob.normalized_motion_strip_url)
  assert.ok(buildJob.motion_contact_sheet_url)
  assert.ok(buildJob.motion_source_report_url)
  assert.ok(buildJob.selected_frames_url)
  await fetchOk(baseUrl, buildJob.normalized_motion_strip_url)
  const buildReport = await fetchJson(baseUrl, buildJob.motion_source_report_url)
  assert.equal(buildReport.requested_selection_mode, 'auto')
  assert.equal(buildReport.effective_selection_mode, 'auto')
  assert.equal(buildReport.source_identity, sourceUpload.source_identity)
  assert.equal(buildReport.operation_id, 'build_walk_down_auto')
  assert.equal(buildReport.contract.background.tolerance, 31)
  assert.equal(buildReport.contract.background.defringe, false)
  assert.equal(buildReport.contract.anchor_policy.static_offset_y, -2)
  const selectionV2Initial = await fetchJson(baseUrl, '/api/build-motion-strip', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(sourceRequest(sourceUpload, 'build_walk_down_selection_v2', {
      action: 'walk_down',
      frames: 3,
      selection_mode: 'auto',
      motion_selection: {
        recipe: 'motion_selection_recipe_v2',
        loop_expectation: 'once',
        temporal_matte: 'evidence_only',
      },
    })),
  })
  const selectionV2Job = await waitForJob(baseUrl, selectionV2Initial.id)
  assert.equal(selectionV2Job.status, 'done')
  const selectionV2Report = await fetchJson(
    baseUrl,
    selectionV2Job.motion_source_report_url
  )
  assert.equal(selectionV2Report.frame_selection.mode, 'motion_selection_report_v2')
  assert.equal(selectionV2Report.frame_selection.settings.loop_expectation, 'once')
  assert.equal(selectionV2Report.frame_selection.temporal_matte.status, 'evidence_only')
  assert.equal(selectionV2Report.frame_selection.target.target_satisfied, true)
  assert.ok(selectionV2Report.frame_selection.selected.every(
    (frame) => Number.isInteger(frame.raw_index)
  ))
  const selectionV2Replay = await fetchJson(baseUrl, '/api/build-motion-strip', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(sourceRequest(sourceUpload, 'build_walk_down_selection_v2', {
      action: 'walk_down',
      frames: 3,
      selectionMode: 'auto',
      motionSelection: {
        recipe: 'motion_selection_recipe_v2',
        loopExpectation: 'once',
        temporalMatte: 'evidence_only',
      },
    })),
  })
  assert.equal(selectionV2Replay.id, selectionV2Initial.id)
  assert.equal(selectionV2Replay.options_hash, selectionV2Initial.options_hash)

  const invalidMotionSelection = await fetchResponseJson(baseUrl, '/api/build-motion-strip', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(sourceRequest(sourceUpload, 'build_invalid_motion_selection', {
      action: 'walk_down',
      frames: 4,
      selection_mode: 'auto',
      motion_selection: {
        recipe: 'future_motion_selection_recipe',
      },
    })),
  })
  assert.equal(invalidMotionSelection.response.status, 400)
  assert.equal(invalidMotionSelection.json.error, 'invalid_motion_selection_recipe')

  const conflictingMotionSelectionAliases = await fetchResponseJson(
    baseUrl,
    '/api/build-motion-strip',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(sourceRequest(sourceUpload, 'build_conflicting_motion_selection', {
        action: 'walk_down',
        frames: 3,
        selection_mode: 'auto',
        motion_selection_recipe: 'motion_selection_recipe_v2',
        selectionRecipe: 'motion_selection_v1_compat',
      })),
    }
  )
  assert.equal(conflictingMotionSelectionAliases.response.status, 400)
  assert.equal(
    conflictingMotionSelectionAliases.json.error,
    'conflicting_motion_selection_option'
  )

  const unknownMotionSelectionOption = await fetchResponseJson(
    baseUrl,
    '/api/build-motion-strip',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(sourceRequest(sourceUpload, 'build_unknown_motion_selection_option', {
        action: 'walk_down',
        frames: 3,
        selection_mode: 'auto',
        motion_selection_threshold: 0.9,
      })),
    }
  )
  assert.equal(unknownMotionSelectionOption.response.status, 400)
  assert.equal(
    unknownMotionSelectionOption.json.error,
    'unknown_motion_selection_option'
  )

  const gridBuildInitial = await fetchJson(baseUrl, '/api/build-motion-strip', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(sourceRequest(sourceUpload, 'build_walk_down_grid_v2', {
      action: 'walk_down',
      frames: 4,
      selection_mode: 'auto',
      pixel_grid_refinement: {
        recipe: 'pixel_grid_v2_balanced',
        minConfidence: 0,
        minSequenceSupport: 0,
      },
    })),
  })
  const gridBuildJob = await waitForJob(baseUrl, gridBuildInitial.id)
  assert.equal(gridBuildJob.status, 'done')
  const gridBuildReport = await fetchJson(baseUrl, gridBuildJob.motion_source_report_url)
  assert.equal(gridBuildReport.pixel_grid_refinement.schema_version, 2)
  assert.equal(gridBuildReport.pixel_grid_refinement.mode, 'pixel_grid_refinement_v2')
  assert.equal(gridBuildReport.pixel_grid_refinement.recipe.id, 'pixel_grid_v2_balanced')
  assert.equal(gridBuildReport.pixel_grid_refinement.settings.max_cell, 32)
  assert.deepEqual(gridBuildJob.warnings, gridBuildReport.warnings)

  const invalidGridRecipe = await fetchResponseJson(baseUrl, '/api/build-motion-strip', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(sourceRequest(sourceUpload, 'build_invalid_grid_recipe', {
      action: 'walk_down',
      frames: 4,
      selection_mode: 'auto',
      pixel_grid_refinement: { recipe: 'pixel_grid_unknown' },
    })),
  })
  assert.equal(invalidGridRecipe.response.status, 400)
  assert.equal(invalidGridRecipe.json.error, 'invalid_pixel_grid_recipe')

  const falseGridRecipe = await fetchResponseJson(baseUrl, '/api/build-motion-strip', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(sourceRequest(sourceUpload, 'build_false_grid_recipe', {
      action: 'walk_down',
      frames: 4,
      selection_mode: 'auto',
      pixel_grid_refinement: { recipe: false },
    })),
  })
  assert.equal(falseGridRecipe.response.status, 400)
  assert.equal(falseGridRecipe.json.error, 'invalid_pixel_grid_recipe')

  const unknownGridOption = await fetchResponseJson(baseUrl, '/api/build-motion-strip', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(sourceRequest(sourceUpload, 'build_unknown_grid_option', {
      action: 'walk_down',
      frames: 4,
      selection_mode: 'auto',
      pixel_grid_refinement: {
        recipe: 'pixel_grid_v2_balanced',
        surprise: true,
      },
    })),
  })
  assert.equal(unknownGridOption.response.status, 400)
  assert.equal(unknownGridOption.json.error, 'unknown_pixel_grid_option')

  const invalidGridRange = await fetchResponseJson(baseUrl, '/api/build-motion-strip', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(sourceRequest(sourceUpload, 'build_invalid_grid_range', {
      action: 'walk_down',
      frames: 4,
      selection_mode: 'auto',
      pixel_grid_refinement: {
        recipe: 'pixel_grid_v2_balanced',
        minCell: 1,
      },
    })),
  })
  assert.equal(invalidGridRange.response.status, 400)
  assert.equal(invalidGridRange.json.error, 'invalid_pixel_grid_option')

  const disabledGridInitial = await fetchJson(baseUrl, '/api/build-motion-strip', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(sourceRequest(sourceUpload, 'build_disabled_grid_canonical', {
      action: 'walk_down',
      frames: 4,
      selection_mode: 'auto',
      pixel_grid_refinement: false,
    })),
  })
  const disabledGridReplay = await fetchJson(baseUrl, '/api/build-motion-strip', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(sourceRequest(sourceUpload, 'build_disabled_grid_canonical', {
      action: 'walk_down',
      frames: 4,
      selection_mode: 'auto',
    })),
  })
  const nullGridReplay = await fetchJson(baseUrl, '/api/build-motion-strip', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(sourceRequest(sourceUpload, 'build_disabled_grid_canonical', {
      action: 'walk_down',
      frames: 4,
      selection_mode: 'auto',
      pixel_grid_refinement: null,
    })),
  })
  assert.equal(disabledGridReplay.id, disabledGridInitial.id)
  assert.equal(disabledGridReplay.options_hash, disabledGridInitial.options_hash)
  assert.equal(nullGridReplay.id, disabledGridInitial.id)
  assert.equal(nullGridReplay.options_hash, disabledGridInitial.options_hash)

  assert.ok(buildJob.video_frames_sheet_url)
  assert.ok(buildJob.frames_index_url)
  assert.ok(buildJob.frames_zip_url)
  const framesIndex = await fetchJson(baseUrl, buildJob.frames_index_url)
  assert.equal(framesIndex.mode, 'motion_sequence_frames_index_v1')
  assert.equal(framesIndex.frame_count, 4)
  assert.equal(framesIndex.source_identity, sourceUpload.source_identity)
  assert.equal(framesIndex.operation_id, 'build_walk_down_auto')
  assert.equal(framesIndex.options_hash, buildJob.options_hash)
  const framesZipResponse = await fetchOk(baseUrl, buildJob.frames_zip_url)
  const framesZip = await JSZip.loadAsync(Buffer.from(await framesZipResponse.arrayBuffer()))
  const zippedFramesIndex = JSON.parse(await framesZip.file('frames_index.json').async('string'))
  assert.equal(zippedFramesIndex.source_identity, sourceUpload.source_identity)
  assert.equal(zippedFramesIndex.operation_id, 'build_walk_down_auto')
  assert.equal(zippedFramesIndex.options_hash, buildJob.options_hash)

  const replayInitial = await fetchJson(baseUrl, '/api/build-motion-strip', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(sourceRequest(sourceUpload, 'build_walk_down_auto', {
      action: 'walk_down',
      frames: 4,
      selection_mode: 'auto',
      background: { tolerance: 31, defringe: false },
      anchor_policy: { static_offset_y: -2 },
    })),
  })
  assert.equal(replayInitial.id, buildInitial.id)

  const operationConflict = await fetchResponseJson(baseUrl, '/api/build-motion-strip', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(sourceRequest(sourceUpload, 'build_walk_down_auto', {
      action: 'walk_down',
      frames: 3,
      selection_mode: 'auto',
    })),
  })
  assert.equal(operationConflict.response.status, 409)
  assert.equal(operationConflict.json.error, 'operation_conflict')

  const contradictorySelection = await fetchResponseJson(baseUrl, '/api/build-motion-strip', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(sourceRequest(sourceUpload, 'build_invalid_auto', {
      action: 'walk_down',
      frames: 3,
      selection_mode: 'auto',
      selected_frame_indexes: [0, 1, 2],
    })),
  })
  assert.equal(contradictorySelection.response.status, 400)
  assert.equal(contradictorySelection.json.error, 'auto_selection_conflicts_with_frame_indexes')

  const invalidTopLevel = await fetchResponseJson(baseUrl, '/api/build-motion-strip', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify([]),
  })
  assert.equal(invalidTopLevel.response.status, 400)
  assert.equal(invalidTopLevel.json.error, 'invalid_motion_request_shape')

  const invalidOptions = await fetchResponseJson(baseUrl, '/api/build-motion-strip', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...sourceRequest(sourceUpload, 'build_invalid_options'),
      options: 'auto',
    }),
  })
  assert.equal(invalidOptions.response.status, 400)
  assert.equal(invalidOptions.json.error, 'invalid_motion_request_shape')

  const oversizedSelection = await fetchResponseJson(baseUrl, '/api/build-motion-strip', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(sourceRequest(sourceUpload, 'build_oversized_selection', {
      selection_mode: 'manual',
      selected_frame_indexes: Array.from({ length: 65 }, (_, index) => index),
    })),
  })
  assert.equal(oversizedSelection.response.status, 400)
  assert.equal(oversizedSelection.json.error, 'too_many_selected_frame_indexes')

  const clientPath = await fetchResponseJson(baseUrl, '/api/build-motion-strip', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(sourceRequest(sourceUpload, 'build_client_path', {
      inputPath: '/tmp/owned-by-client.mp4',
    })),
  })
  assert.equal(clientPath.response.status, 400)
  assert.equal(clientPath.json.error, 'client_path_not_allowed')

  const manualBuildInitial = await fetchJson(baseUrl, '/api/build-motion-strip', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(sourceRequest(sourceUpload, 'build_walk_down_manual', {
      action: 'walk_down',
      selection_mode: 'manual',
      selected_frame_indexes: [4, 1, 0],
      background: { tolerance: 31, defringe: false },
    })),
  })
  const manualBuildJob = await waitForJob(baseUrl, manualBuildInitial.id)
  assert.equal(manualBuildJob.status, 'done')
  assert.equal(manualBuildJob.frame_selection_mode, 'manual')
  assert.equal(manualBuildJob.selected_frame_count, 3)
  const manualSelected = await fetchJson(baseUrl, manualBuildJob.selected_frames_url)
  assert.equal(manualSelected.selection_mode, 'manual')
  assert.equal(manualSelected.requested_selection_mode, 'manual')
  assert.deepEqual(manualSelected.selected.map((frame) => frame.original_index), [4, 1, 0])

  const spoolBeforeInvalidLegacyOperation = await readdir(motionSpoolDir)
  const invalidLegacyOperation = await fetchResponseJson(baseUrl, '/api/build-motion-strip', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      operation_id: 'invalid legacy operation',
      source_base64: sourceZip.toString('base64'),
      source_name: 'walk_down.zip',
      options: { action: 'walk_down' },
    }),
  })
  assert.equal(invalidLegacyOperation.response.status, 400)
  assert.equal(invalidLegacyOperation.json.error, 'invalid_operation_id')
  assert.deepEqual(await readdir(motionSpoolDir), spoolBeforeInvalidLegacyOperation)

  const legacyManualInitial = await fetchJson(baseUrl, '/api/build-motion-strip', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      operation_id: 'legacy_build_manual',
      source_base64: sourceZip.toString('base64'),
      source_name: 'walk_down.zip',
      options: {
        action: 'walk_down',
        selected_frame_indexes: [3, 1, 0],
      },
    }),
  })
  const legacyManualJob = await waitForJob(baseUrl, legacyManualInitial.id)
  assert.equal(legacyManualJob.status, 'done')
  const legacyManualSelected = await fetchJson(baseUrl, legacyManualJob.selected_frames_url)
  assert.equal(legacyManualSelected.requested_selection_mode, null)
  assert.equal(legacyManualSelected.effective_selection_mode, 'manual')
  assert.equal((await readdir(motionSpoolDir)).length, 1)
  const releasedLegacyReplay = await fetchJson(baseUrl, '/api/build-motion-strip', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      operation_id: 'legacy_build_manual',
      source_base64: sourceZip.toString('base64'),
      source_name: 'walk_down.zip',
      options: {
        action: 'walk_down',
        selected_frame_indexes: [3, 1, 0],
      },
    }),
  })
  assert.equal(releasedLegacyReplay.id, legacyManualInitial.id)
  assert.equal(releasedLegacyReplay.status, 'done')

  const rembgBuildInitial = await fetchJson(baseUrl, '/api/build-motion-strip', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(sourceRequest(sourceUpload, 'build_walk_down_rembg', {
      action: 'walk_down',
      frames: 4,
      selection_mode: 'auto',
      background: { method: 'external_rembg' },
    })),
  })
  const rembgBuildJob = await waitForJob(baseUrl, rembgBuildInitial.id)
  assert.equal(rembgBuildJob.status, 'done')
  assert.equal(rembgBuildJob.external_matting_status, 'done')
  const rembgReport = await fetchJson(baseUrl, rembgBuildJob.motion_source_report_url)
  assert.equal(rembgReport.contract.background.source_requirement, 'transparent_alpha')
  assert.equal(rembgReport.external_matting.mode, 'external_rembg')

  await unlink(fakeRembg.marker).catch((error) => {
    if (error?.code !== 'ENOENT') throw error
  })
  await writeFile(fakeRembg.blockFile, 'block active rembg')
  const activeInitial = await fetchJson(baseUrl, '/api/build-motion-strip', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(sourceRequest(sourceUpload, 'build_cancel_active', {
      action: 'walk_down',
      frames: 4,
      selection_mode: 'auto',
      background: { method: 'external_rembg' },
    })),
  })
  await waitForMarkerLines(fakeRembg.marker, 1)
  const queuedInitial = await fetchJson(baseUrl, '/api/build-motion-strip', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(sourceRequest(sourceUpload, 'build_cancel_queued', {
      action: 'walk_down',
      frames: 4,
      selection_mode: 'auto',
    })),
  })
  const cancelled = await fetchJson(baseUrl, `/api/motion-source/jobs/${queuedInitial.id}/cancel`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })
  assert.equal(cancelled.id, queuedInitial.id)
  assert.equal(cancelled.status, 'failed_post_processing')
  assert.equal(cancelled.failure_status, 'cancelled')
  assert.equal(cancelled.motion_source_lifecycle, 'cancelled')
  assert.equal(cancelled.retry_hint, 'resume_with_new_operation')
  const cancelledAgain = await fetchJson(baseUrl, `/api/motion-source/jobs/${queuedInitial.id}/cancel`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })
  assert.equal(cancelledAgain.updated_at, cancelled.updated_at)
  const resumedCancelled = await fetchJson(baseUrl, `/api/jobs/${queuedInitial.id}`)
  assert.equal(resumedCancelled.id, queuedInitial.id)
  assert.equal(resumedCancelled.operation_id, 'build_cancel_queued')
  assert.equal(resumedCancelled.status, 'failed_post_processing')
  const afterActiveInitial = await fetchJson(baseUrl, '/api/build-motion-strip', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(sourceRequest(sourceUpload, 'build_after_active_cancel', {
      action: 'walk_down',
      frames: 4,
      selection_mode: 'auto',
      background: { method: 'external_rembg' },
    })),
  })
  const pendingRelease = await fetchJson(
    baseUrl,
    `/api/motion-source/uploads/${sourceUpload.upload_id}`,
    { method: 'DELETE' }
  )
  assert.equal(pendingRelease.released, false)
  assert.equal(pendingRelease.pending, true)
  const activeCancelStartedAt = Date.now()
  const activeCancelled = await fetchJson(baseUrl, `/api/motion-source/jobs/${activeInitial.id}/cancel`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })
  await unlink(fakeRembg.blockFile)
  assert.equal(activeCancelled.failure_status, 'cancelled')
  assert.equal(activeCancelled.motion_source_lifecycle, 'cancelled')
  await waitForMarkerLines(fakeRembg.marker, 2)
  assert.ok(Date.now() - activeCancelStartedAt < 4500, 'the next guarded rembg process should start before the 5s block expires')
  const afterActiveJob = await waitForJob(baseUrl, afterActiveInitial.id)
  assert.equal(afterActiveJob.status, 'done')
  await new Promise((resolve) => setTimeout(resolve, 300))
  const activeFinal = await fetchJson(baseUrl, `/api/jobs/${activeInitial.id}`)
  assert.equal(activeFinal.failure_status, 'cancelled')
  assert.equal(activeFinal.motion_source_lifecycle, 'cancelled')
  const finishedRelease = await fetchJson(
    baseUrl,
    `/api/motion-source/uploads/${sourceUpload.upload_id}`,
    { method: 'DELETE' }
  )
  assert.equal(finishedRelease.pending, false)
  const releasedSourceReplay = await fetchJson(baseUrl, '/api/build-motion-strip', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(sourceRequest(sourceUpload, 'build_after_active_cancel', {
      action: 'walk_down',
      frames: 4,
      selection_mode: 'auto',
      background: { method: 'external_rembg' },
    })),
  })
  assert.equal(releasedSourceReplay.id, afterActiveInitial.id)
  assert.equal(releasedSourceReplay.status, 'done')
  const releasedSourceNewOperation = await fetchResponseJson(baseUrl, '/api/build-motion-strip', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(sourceRequest(sourceUpload, 'build_after_source_release', {
      action: 'walk_down',
      frames: 4,
      selection_mode: 'auto',
    })),
  })
  assert.equal(releasedSourceNewOperation.response.status, 404)
  assert.equal(releasedSourceNewOperation.json.error, 'upload_not_found')

  const unknownCancel = await fetchResponseJson(baseUrl, '/api/motion-source/jobs/job_not_motion/cancel', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })
  assert.equal(unknownCancel.response.status, 404)
  assert.equal(unknownCancel.json.error, 'motion_job_not_found')

  const videoSource = makeMp4LikeBuffer()
  const videoUpload = await uploadMotionSource(
    baseUrl,
    'walk_down.mp4',
    videoSource,
    'upload_walk_down_video',
    'video/mp4'
  )
  const videoBuildInitial = await fetchJson(baseUrl, '/api/build-motion-strip', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(sourceRequest(videoUpload, 'build_walk_down_video', {
      action: 'walk_down',
      frames: 4,
      selection_mode: 'auto',
      fps: 6,
      maxFrames: 6,
      background: { tolerance: 31, defringe: false },
    })),
  })
  const videoBuildJob = await waitForJob(baseUrl, videoBuildInitial.id)
  assert.equal(videoBuildJob.status, 'done')
  assert.equal(videoBuildJob.source_kind, 'video_file')
  assert.equal(videoBuildJob.source_identity, videoUpload.source_identity)
  assert.ok(videoBuildJob.normalized_motion_strip_url)
  const videoAnalysis = await fetchJson(baseUrl, videoBuildJob.motion_source_analysis_url)
  assert.equal(videoAnalysis.requires_external_binary, true)
  assert.equal(videoAnalysis.external_binary.available, true)
  assert.equal(videoAnalysis.byte_length, videoSource.length)
  const videoBuildReport = await fetchJson(baseUrl, videoBuildJob.motion_source_report_url)
  assert.equal(videoBuildReport.contract.source_kind, 'video_file')
  assert.equal(videoBuildReport.selected_frame_count, 4)

  const sheetPng = await makeSheetPng()
  const stripPng = await makeStripPng(8)
  const applyInitial = await fetchJson(baseUrl, '/api/apply-motion-strip', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sheet_base64: sheetPng.toString('base64'),
      strip_base64: stripPng.toString('base64'),
      options: {
        action: 'walk_down',
        output_profile: { resample_strategy: 'nearest_keyframes' },
      },
    }),
  })
  const applyJob = await waitForJob(baseUrl, applyInitial.id)
  assert.equal(applyJob.status, 'done')
  assert.equal(applyJob.resample_strategy, 'nearest_keyframes')
  assert.ok(applyJob.applied_normalized_sheet_url)
  assert.ok(applyJob.apply_motion_strip_report_url)
  const applyReport = await fetchJson(baseUrl, applyJob.apply_motion_strip_report_url)
  assert.deepEqual(applyReport.resample_mapping.map((item) => item.source_frame_index), [0, 2, 5, 7])

  const idlePng = await makeStripPng(8, [120, 80, 160, 255])
  const walkPng = await makeStripPng(8, [20, 220, 40, 255])
  const setInitial = await fetchJson(baseUrl, '/api/analyze-motion-source-set', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      manifest: {
        contract_version: 'motion_source_set_v1',
        identity_anchor: { source_id: 'idle_down' },
        identity_thresholds: { max_palette_delta: 36 },
        background: {
          source_requirement: 'flat_solid_key_color',
          key_color: [255, 255, 255],
        },
        sources: [
          { id: 'idle_down', runtime_action: 'idle_down', source: 'idle_down.png', target_frame_count: 8, facing_direction: 'down' },
          { id: 'walk_down', runtime_action: 'walk_down', source: 'walk_down.png', target_frame_count: 8, facing_direction: 'down' },
        ],
      },
      strips: [
        { id: 'idle_down', source_base64: idlePng.toString('base64') },
        { id: 'walk_down', source_base64: walkPng.toString('base64') },
      ],
    }),
  })
  const setJob = await waitForJob(baseUrl, setInitial.id)
  assert.equal(setJob.status, 'failed_post_processing')
  assert.equal(setJob.identity_status, 'fail')
  assert.equal(setJob.can_apply_multi_strip, false)
  assert.ok(setJob.identity_consistency_report_url)
  const identityReport = await fetchJson(baseUrl, setJob.identity_consistency_report_url)
  assert.equal(identityReport.status, 'fail')
  assert.ok(identityReport.blocking_errors.includes('identity_mismatch:walk_down'))

  const idleApplyPng = await makeStripPng(4, [120, 80, 160, 255])
  const walkApplyPng = await makeStripPng(4, [124, 82, 158, 255])
  const applySetInitial = await fetchJson(baseUrl, '/api/apply-motion-source-set', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sheet_base64: sheetPng.toString('base64'),
      manifest: {
        contract_version: 'motion_source_set_v1',
        identity_anchor: { source_id: 'idle_down', facing_direction: 'down' },
        background: {
          source_requirement: 'flat_solid_key_color',
          key_color: [255, 255, 255],
        },
        sources: [
          { id: 'idle_down', runtime_action: 'idle_down', source: 'idle_down.png', target_frame_count: 4, facing_direction: 'down' },
          { id: 'walk_down', runtime_action: 'walk_down', source: 'walk_down.png', target_frame_count: 4, facing_direction: 'down' },
        ],
      },
      strips: [
        { id: 'idle_down', source_base64: idleApplyPng.toString('base64') },
        { id: 'walk_down', source_base64: walkApplyPng.toString('base64') },
      ],
    }),
  })
  const applySetJob = await waitForJob(baseUrl, applySetInitial.id)
  assert.equal(applySetJob.status, 'done')
  assert.equal(applySetJob.source_set_apply_status, 'done')
  assert.equal(applySetJob.can_apply_multi_strip, true)
  assert.ok(applySetJob.applied_normalized_sheet_url)
  assert.ok(applySetJob.motion_source_set_apply_report_url)
  assert.ok(applySetJob.motion_source_set_report_url)
  assert.ok(applySetJob.identity_consistency_report_url)
  const applySetReport = await fetchJson(baseUrl, applySetJob.motion_source_set_apply_report_url)
  assert.equal(applySetReport.mode, 'motion_source_set_apply_report_v1')
  assert.deepEqual(applySetReport.applied_actions.map((item) => item.runtime_action), ['idle_down', 'walk_down'])
  await fetchOk(baseUrl, applySetJob.applied_normalized_sheet_url)

  assert.equal(buildJob.provider_call_budget, undefined)
  assert.equal(applyJob.provider_call_budget, undefined)
  assert.equal(setJob.provider_call_budget, undefined)
  assert.equal(applySetJob.provider_call_budget, undefined)

  const invalidLegacyBase64 = await fetchResponseJson(baseUrl, '/api/analyze-motion-source', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      source_base64: 'data:image/png,AAAA,BBBB',
      source_name: 'invalid.png',
    }),
  })
  assert.equal(invalidLegacyBase64.response.status, 400)
  assert.equal(invalidLegacyBase64.json.error, 'invalid_base64')

  const oversizedLegacy = await fetchResponseJson(baseUrl, '/api/analyze-motion-source', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ padding: 'x'.repeat(16 * 1024 * 1024) }),
  })
  assert.equal(oversizedLegacy.response.status, 413)
  assert.equal(oversizedLegacy.json.error, 'use_motion_source_upload')
})
