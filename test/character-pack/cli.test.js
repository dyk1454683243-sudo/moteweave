import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { execFile } from 'node:child_process'
import { access, chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import JSZip from 'jszip'
import sharp from 'sharp'

import { encodeRgbaPng } from '../../src/character-pack/imageCodec.js'
import { TOPDOWN_RPG_V0 } from '../../src/character-pack/profile.js'
import { CHARACTER_QUALITY_CLOSURE_MODE } from '../../src/character-pack/qualityClosureGate.js'
import {
  FIXED_REGION_MOTION_LAYOUT_ID,
  LEGACY_OCAD_MOTION_LAYOUT_ID,
} from '../../src/character-pack/sourceLayouts.js'
import { getTileSourceRegion } from '../../src/scene-pack/tileProfile.js'

const execFileAsync = promisify(execFile)
const cliPath = path.resolve('scripts/character-pack-cli.mjs')

async function exists(filePath) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

async function runCli(args, { env } = {}) {
  const { stdout } = await execFileAsync(process.execPath, [cliPath, ...args], {
    cwd: process.cwd(),
    env: { ...process.env, ...(env ?? {}) },
    maxBuffer: 1024 * 1024,
  })
  return JSON.parse(stdout)
}

async function runCliError(args, { env } = {}) {
  try {
    await execFileAsync(process.execPath, [cliPath, ...args], {
      cwd: process.cwd(),
      env: { ...process.env, ...(env ?? {}) },
      maxBuffer: 1024 * 1024,
    })
  } catch (error) {
    return error
  }
  throw new Error(`Expected CLI command to fail: ${args.join(' ')}`)
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  })
}

async function startMockImageProvider(imageBuffer) {
  const requests = []
  const server = http.createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = Buffer.concat(chunks).toString('utf8')
    requests.push(JSON.parse(body))
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({
      choices: [
        {
          message: {
            images: [{ image_url: { url: `data:image/png;base64,${imageBuffer.toString('base64')}` } }],
          },
        },
      ],
    }))
  })
  const port = await listen(server)
  return { requests, server, url: `http://127.0.0.1:${port}/v1/chat/completions` }
}

async function startFailingImageProvider(message = 'provider unavailable') {
  const requests = []
  const server = http.createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = Buffer.concat(chunks).toString('utf8')
    requests.push(JSON.parse(body))
    res.writeHead(400, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: { message } }))
  })
  const port = await listen(server)
  return { requests, server, url: `http://127.0.0.1:${port}/v1/chat/completions` }
}

function paintRect(image, rect, color = [60, 120, 200, 255]) {
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const offset = (y * image.width + x) * 4
      image.data[offset] = color[0]
      image.data[offset + 1] = color[1]
      image.data[offset + 2] = color[2]
      image.data[offset + 3] = color[3]
    }
  }
}

function makeRepairTestCell(rect) {
  const image = {
    width: TOPDOWN_RPG_V0.frame.w,
    height: TOPDOWN_RPG_V0.frame.h,
    data: new Uint8ClampedArray(TOPDOWN_RPG_V0.frame.w * TOPDOWN_RPG_V0.frame.h * 4),
  }
  paintRect(image, rect)
  return image
}

function pasteRepairTestCell(sheet, frame, cell) {
  const col = frame % TOPDOWN_RPG_V0.grid.columns
  const row = Math.floor(frame / TOPDOWN_RPG_V0.grid.columns)
  for (let y = 0; y < TOPDOWN_RPG_V0.frame.h; y++) {
    for (let x = 0; x < TOPDOWN_RPG_V0.frame.w; x++) {
      const src = (y * TOPDOWN_RPG_V0.frame.w + x) * 4
      const dst = ((row * TOPDOWN_RPG_V0.frame.h + y) * TOPDOWN_RPG_V0.sheet.w + col * TOPDOWN_RPG_V0.frame.w + x) * 4
      sheet.data[dst] = cell.data[src]
      sheet.data[dst + 1] = cell.data[src + 1]
      sheet.data[dst + 2] = cell.data[src + 2]
      sheet.data[dst + 3] = cell.data[src + 3]
    }
  }
}

async function encodeRgbaJpeg(image) {
  return sharp(Buffer.from(image.data), { raw: { width: image.width, height: image.height, channels: 4 } }).jpeg().toBuffer()
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

async function makeRepairTestSheetPng({ croppedFrame = 40 } = {}) {
  const sheet = {
    width: TOPDOWN_RPG_V0.sheet.w,
    height: TOPDOWN_RPG_V0.sheet.h,
    data: new Uint8ClampedArray(TOPDOWN_RPG_V0.sheet.w * TOPDOWN_RPG_V0.sheet.h * 4),
  }
  const compact = makeRepairTestCell({ x: 24, y: 17, w: 48, h: 72 })
  const cropped = makeRepairTestCell({ x: 0, y: 17, w: 72, h: 72 })
  for (let frame = 0; frame < TOPDOWN_RPG_V0.grid.columns * TOPDOWN_RPG_V0.grid.rows; frame++) {
    pasteRepairTestCell(sheet, frame, frame === croppedFrame ? cropped : compact)
  }
  return encodeRgbaPng(sheet)
}

async function makeQualityClosureRepairTestSheetPng() {
  const sheet = {
    width: TOPDOWN_RPG_V0.sheet.w,
    height: TOPDOWN_RPG_V0.sheet.h,
    data: new Uint8ClampedArray(TOPDOWN_RPG_V0.sheet.w * TOPDOWN_RPG_V0.sheet.h * 4),
  }
  const normal = makeRepairTestCell({ x: 40, y: 40, w: 17, h: 49 })
  const halo = makeRepairTestCell({ x: 40, y: 40, w: 17, h: 49 })
  paintRect(halo, { x: 39, y: 40, w: 1, h: 49 }, [250, 250, 250, 255])
  const drifted = makeRepairTestCell({ x: 34, y: 34, w: 17, h: 49 })
  for (let frame = 0; frame < TOPDOWN_RPG_V0.grid.columns * TOPDOWN_RPG_V0.grid.rows; frame++) {
    pasteRepairTestCell(sheet, frame, frame === 0 ? halo : frame === 1 ? drifted : normal)
  }
  return encodeRgbaPng(sheet)
}

function makeSemanticRepairTestCell(index, propSide = null) {
  const image = {
    width: TOPDOWN_RPG_V0.frame.w,
    height: TOPDOWN_RPG_V0.frame.h,
    data: new Uint8ClampedArray(TOPDOWN_RPG_V0.frame.w * TOPDOWN_RPG_V0.frame.h * 4),
  }
  paintRect(image, { x: 42, y: 40, w: 13, h: 49 }, [40 + (index % 80), 90, 160, 255])
  if (propSide === 'left') paintRect(image, { x: 25, y: 35, w: 3, h: 35 }, [120, 80, 40, 255])
  if (propSide === 'right') paintRect(image, { x: 69, y: 35, w: 3, h: 35 }, [120, 80, 40, 255])
  return image
}

async function makeSemanticRepairTestSheetPng() {
  const sheet = {
    width: TOPDOWN_RPG_V0.sheet.w,
    height: TOPDOWN_RPG_V0.sheet.h,
    data: new Uint8ClampedArray(TOPDOWN_RPG_V0.sheet.w * TOPDOWN_RPG_V0.sheet.h * 4),
  }
  const propSides = new Map([
    [24, 'left'],
    [25, 'left'],
    [26, 'right'],
    [27, 'right'],
  ])
  for (let frame = 0; frame < TOPDOWN_RPG_V0.grid.columns * TOPDOWN_RPG_V0.grid.rows; frame++) {
    pasteRepairTestCell(sheet, frame, makeSemanticRepairTestCell(frame, propSides.get(frame)))
  }
  return encodeRgbaPng(sheet)
}

async function makeSemanticRepairStripPng(frames, propSide = 'left') {
  const strip = {
    width: TOPDOWN_RPG_V0.frame.w * frames.length,
    height: TOPDOWN_RPG_V0.frame.h,
    data: new Uint8ClampedArray(TOPDOWN_RPG_V0.frame.w * frames.length * TOPDOWN_RPG_V0.frame.h * 4),
  }
  for (const [index, frame] of frames.entries()) {
    const cell = makeSemanticRepairTestCell(frame, propSide)
    for (let y = 0; y < TOPDOWN_RPG_V0.frame.h; y++) {
      for (let x = 0; x < TOPDOWN_RPG_V0.frame.w; x++) {
        const src = (y * TOPDOWN_RPG_V0.frame.w + x) * 4
        const dst = (y * strip.width + index * TOPDOWN_RPG_V0.frame.w + x) * 4
        strip.data[dst] = cell.data[src]
        strip.data[dst + 1] = cell.data[src + 1]
        strip.data[dst + 2] = cell.data[src + 2]
        strip.data[dst + 3] = cell.data[src + 3]
      }
    }
  }
  return encodeRgbaPng(strip)
}

function makeSceneTileSheet() {
  const image = {
    width: 192,
    height: 192,
    data: new Uint8ClampedArray(192 * 192 * 4),
  }
  for (let mask = 0; mask < 16; mask += 1) {
    const region = getTileSourceRegion(mask)
    paintRect(image, { x: region.col * 48, y: region.row * 48, w: 48, h: 48 }, [240, 40, 200, 255])
    paintRect(image, region, [80, 120, 60, 255])
  }
  return image
}

function makeMotionSourceFrame(index = 0) {
  const image = {
    width: 48,
    height: 48,
    data: new Uint8ClampedArray(48 * 48 * 4),
  }
  paintRect(image, { x: 0, y: 0, w: 48, h: 48 }, [255, 255, 255, 255])
  paintRect(image, { x: 14 + index, y: 12, w: 8, h: 24 }, [40, 90, 170, 255])
  if (index % 2 === 0) paintRect(image, { x: 10 + index, y: 34, w: 4, h: 2 }, [40, 90, 170, 255])
  else paintRect(image, { x: 22 + index, y: 34, w: 4, h: 2 }, [40, 90, 170, 255])
  return image
}

async function makeMotionSourceZip(frameCount = 6) {
  const zip = new JSZip()
  for (let index = 0; index < frameCount; index += 1) {
    zip.file(`frame_${String(index + 1).padStart(2, '0')}.png`, await encodeRgbaPng(makeMotionSourceFrame(index)))
  }
  return zip.generateAsync({ type: 'nodebuffer' })
}

async function makeMotionApplySheetPng() {
  const sheet = {
    width: TOPDOWN_RPG_V0.sheet.w,
    height: TOPDOWN_RPG_V0.sheet.h,
    data: new Uint8ClampedArray(TOPDOWN_RPG_V0.sheet.w * TOPDOWN_RPG_V0.sheet.h * 4),
  }
  for (let frame = 0; frame < TOPDOWN_RPG_V0.grid.columns * TOPDOWN_RPG_V0.grid.rows; frame += 1) {
    pasteRepairTestCell(sheet, frame, makeRepairTestCell({ x: 40, y: 40, w: 16, h: 49 }))
  }
  return encodeRgbaPng(sheet)
}

async function makeMotionApplyStripPng(frameCount = 4, color = null) {
  const strip = {
    width: TOPDOWN_RPG_V0.frame.w * frameCount,
    height: TOPDOWN_RPG_V0.frame.h,
    data: new Uint8ClampedArray(TOPDOWN_RPG_V0.frame.w * frameCount * TOPDOWN_RPG_V0.frame.h * 4),
  }
  for (let index = 0; index < frameCount; index += 1) {
    const cell = makeRepairTestCell({ x: 40 + (index % 2), y: 40, w: 16, h: 49 })
    paintRect(cell, { x: 40 + (index % 2), y: 40, w: 16, h: 49 }, color ?? [120 + index * 20, 80, 160, 255])
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
  return encodeRgbaPng(strip)
}

function makeMismatchedSceneTileSheet() {
  const image = makeSceneTileSheet()
  const colors = [
    [220, 30, 30, 255],
    [30, 210, 80, 255],
    [40, 60, 220, 255],
    [230, 210, 50, 255],
  ]
  for (let mask = 0; mask < 16; mask += 1) {
    const region = getTileSourceRegion(mask)
    paintRect(image, { x: region.x, y: region.y, w: region.w, h: 1 }, colors[mask % colors.length])
    paintRect(image, { x: region.x, y: region.y + region.h - 1, w: region.w, h: 1 }, colors[(mask + 1) % colors.length])
    paintRect(image, { x: region.x, y: region.y, w: 1, h: region.h }, colors[(mask + 2) % colors.length])
    paintRect(image, { x: region.x + region.w - 1, y: region.y, w: 1, h: region.h }, colors[(mask + 3) % colors.length])
  }
  return image
}

test('character pack CLI process writes pack artifacts', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'character-pack-cli-process-'))
  const result = await runCli([
    'process',
    '--input',
    'test/fixtures/character-pack/topdown_rpg_v0_sample_hero.png',
    '--output-dir',
    outputDir,
    '--job-id',
    'cli_process',
    '--name',
    'sample_hero',
    '--background-mode',
    'flood',
  ])

  assert.equal(result.command, 'process')
  assert.equal(result.job_id, 'cli_process')
  assert.equal(result.status, 'done')
  assert.equal(result.urls.editor_metadata_url, '/generated/cli_process/editor_metadata.json')
  assert.equal(await exists(path.join(outputDir, 'cli_process', 'editor_metadata.json')), true)
  assert.equal(await exists(path.join(outputDir, 'cli_process', 'normalized_sheet.png')), true)
  assert.equal(await exists(path.join(outputDir, 'cli_process', 'multi_resolution.json')), true)
  assert.equal(await exists(path.join(outputDir, 'cli_process', 'normalized_sheet_64.png')), true)
  assert.equal(await exists(path.join(outputDir, 'cli_process', 'debug_report.json')), true)
  assert.equal(await exists(path.join(outputDir, 'cli_process', 'character_pack.zip')), true)
})

test('character pack CLI motion-source build-strip writes strip artifacts from a ZIP', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'character-pack-cli-motion-source-'))
  const inputPath = path.join(root, 'motion.zip')
  const outputDir = path.join(root, 'out')
  await writeFile(inputPath, await makeMotionSourceZip(6))

  const result = await runCli([
    'motion-source',
    'build-strip',
    inputPath,
    '--output-dir',
    outputDir,
    '--job-id',
    'motion_strip',
    '--action',
    'walk_down',
    '--frames',
    '4',
    '--motion-selection-recipe',
    'motion_selection_recipe_v2',
    '--loop-expectation',
    'once',
    '--temporal-matte',
    'evidence_only',
    '--grid-refinement-recipe',
    'pixel_grid_v2_balanced',
    '--grid-refinement-min-confidence',
    '0',
    '--grid-refinement-min-sequence-support',
    '0',
    '--grid-refinement-max-cell',
    '8',
  ])

  const jobDir = path.join(outputDir, 'motion_strip')
  const report = JSON.parse(await readFile(path.join(jobDir, 'motion_source_report.json'), 'utf8'))
  const selected = JSON.parse(await readFile(path.join(jobDir, 'selected_frames.json'), 'utf8'))

  assert.equal(result.command, 'motion-source build-strip')
  assert.equal(result.status, 'done')
  assert.equal(result.action, 'walk_down')
  assert.equal(result.selected_frame_count, 4)
  assert.equal(report.frame_selection.selected.length, 4)
  assert.equal(report.frame_selection.mode, 'motion_selection_report_v2')
  assert.equal(report.frame_selection.recipe, 'motion_selection_recipe_v2')
  assert.equal(report.frame_selection.settings.loop_expectation, 'once')
  assert.equal(report.frame_selection.temporal_matte.status, 'evidence_only')
  assert.ok(report.frame_selection.selected.every((frame) => Number.isInteger(frame.raw_index)))
  assert.equal(report.pixel_grid_refinement.schema_version, 2)
  assert.equal(report.pixel_grid_refinement.mode, 'pixel_grid_refinement_v2')
  assert.equal(report.pixel_grid_refinement.recipe.id, 'pixel_grid_v2_balanced')
  assert.equal(report.pixel_grid_refinement.settings.max_cell, 8)
  assert.equal(report.pixel_grid_refinement.settings.min_confidence, 0)
  assert.notEqual(report.pixel_grid_refinement.status, 'disabled')
  assert.equal(selected.selected.length, 4)
  assert.equal(await exists(path.join(jobDir, 'normalized_motion_strip.png')), true)
  assert.equal(await exists(path.join(jobDir, 'motion_contact_sheet.png')), true)
  assert.equal(await exists(path.join(jobDir, 'motion_source_report.json')), true)
  assert.equal(await exists(path.join(jobDir, 'selected_frames.json')), true)
})

test('character pack CLI motion-source build-strip rejects unknown Motion Selection flags', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'character-pack-cli-motion-selection-invalid-'))
  const inputPath = path.join(root, 'motion.zip')
  await writeFile(inputPath, await makeMotionSourceZip(4))

  await assert.rejects(
    runCli([
      'motion-source',
      'build-strip',
      inputPath,
      '--output-dir',
      path.join(root, 'out'),
      '--job-id',
      'motion_selection_invalid',
      '--motion-selection-threshold',
      '0.9',
    ]),
    /Unknown Motion Selection option --motion-selection-threshold/
  )
})

test('character pack CLI motion-source build-strip passes video paths to guarded FFmpeg extraction', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'character-pack-cli-motion-video-'))
  const inputPath = path.join(root, 'motion.mp4')
  const outputDir = path.join(root, 'out')
  const ffmpegPath = path.join(root, 'fake-ffmpeg.js')
  const frameBuffers = await Promise.all(
    Array.from({ length: 6 }, (_, index) => encodeRgbaPng(makeMotionSourceFrame(index)))
  )
  await writeFile(inputPath, Buffer.from('local video path fixture'))
  await writeFile(ffmpegPath, `#!/usr/bin/env node
const { mkdirSync, writeFileSync } = require('node:fs')
const path = require('node:path')
const outputPattern = process.argv[process.argv.length - 1]
mkdirSync(path.dirname(outputPattern), { recursive: true })
const frames = ${JSON.stringify(frameBuffers.map((buffer) => buffer.toString('base64')))}
for (let index = 0; index < frames.length; index += 1) {
  writeFileSync(
    outputPattern.replace('%05d', String(index + 1).padStart(5, '0')),
    Buffer.from(frames[index], 'base64')
  )
}
`)
  await chmod(ffmpegPath, 0o755)

  const result = await runCli([
    'motion-source',
    'build-strip',
    inputPath,
    '--output-dir',
    outputDir,
    '--job-id',
    'motion_video_strip',
    '--action',
    'walk_down',
    '--frames',
    '4',
  ], {
    env: { FFMPEG_PATH: ffmpegPath },
  })

  const jobDir = path.join(outputDir, 'motion_video_strip')
  assert.equal(result.status, 'done')
  assert.equal(result.source_kind, 'video_file')
  assert.equal(result.ffmpeg.normalization.mode, 'bounded_scale_v1')
  assert.equal(await exists(path.join(jobDir, 'video_frames', 'frame_00001.png')), true)
  assert.equal(await exists(path.join(jobDir, 'normalized_motion_strip.png')), true)
})

test('character pack CLI motion-source apply-strip writes applied sheet artifacts', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'character-pack-cli-motion-apply-'))
  const sheetPath = path.join(root, 'normalized_sheet.png')
  const stripPath = path.join(root, 'motion_strip.png')
  const outputDir = path.join(root, 'out')
  await writeFile(sheetPath, await makeMotionApplySheetPng())
  await writeFile(stripPath, await makeMotionApplyStripPng(8))

  const result = await runCli([
    'motion-source',
    'apply-strip',
    '--sheet',
    sheetPath,
    '--strip',
    stripPath,
    '--output-dir',
    outputDir,
    '--job-id',
    'motion_apply',
    '--action',
    'walk_down',
    '--resample-strategy',
    'nearest_keyframes',
  ])

  const jobDir = path.join(outputDir, 'motion_apply')
  const report = JSON.parse(await readFile(path.join(jobDir, 'apply_motion_strip_report.json'), 'utf8'))

  assert.equal(result.command, 'motion-source apply-strip')
  assert.equal(result.status, 'done')
  assert.equal(result.action, 'walk_down')
  assert.equal(result.resample_strategy, 'nearest_keyframes')
  assert.deepEqual(report.resample_mapping.map((item) => item.source_frame_index), [0, 2, 5, 7])
  assert.equal(await exists(path.join(jobDir, 'applied_normalized_sheet.png')), true)
  assert.equal(await exists(path.join(jobDir, 'apply_motion_strip_report.json')), true)
})

test('character pack CLI motion-source analyze-set writes set and identity reports', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'character-pack-cli-motion-set-'))
  const idlePath = path.join(root, 'idle_down.png')
  const walkPath = path.join(root, 'walk_down.png')
  const manifestPath = path.join(root, 'motion_source_set.json')
  const outputDir = path.join(root, 'out')
  await writeFile(idlePath, await makeMotionApplyStripPng(8))
  await writeFile(walkPath, await makeMotionApplyStripPng(8))
  await writeFile(manifestPath, JSON.stringify({
    contract_version: 'motion_source_set_v1',
    identity_anchor: { source_id: 'idle_down' },
    background: {
      source_requirement: 'flat_solid_key_color',
      key_color: [255, 255, 255],
    },
    sources: [
      {
        id: 'idle_down',
        runtime_action: 'idle_down',
        source: 'idle_down.png',
        target_frame_count: 8,
        recommended_duration_sec: [0.6, 1.1],
        facing_direction: 'down',
      },
      {
        id: 'walk_down',
        runtime_action: 'walk_down',
        source: 'walk_down.png',
        target_frame_count: 8,
        recommended_duration_sec: [0.8, 1.4],
        facing_direction: 'down',
      },
    ],
  }, null, 2))

  const result = await runCli([
    'motion-source',
    'analyze-set',
    manifestPath,
    '--output-dir',
    outputDir,
    '--job-id',
    'motion_set',
  ])

  const jobDir = path.join(outputDir, 'motion_set')
  const setReport = JSON.parse(await readFile(path.join(jobDir, 'motion_source_set_report.json'), 'utf8'))
  const identityReport = JSON.parse(await readFile(path.join(jobDir, 'identity_consistency_report.json'), 'utf8'))

  assert.equal(result.command, 'motion-source analyze-set')
  assert.equal(result.status, 'pass')
  assert.equal(result.can_apply_multi_strip, true)
  assert.equal(setReport.status, 'pass')
  assert.equal(identityReport.status, 'pass')
  assert.equal(identityReport.can_apply_multi_strip, true)
  assert.equal(identityReport.per_strip.length, 2)
  assert.equal(await exists(path.join(jobDir, 'motion_source_set_report.json')), true)
  assert.equal(await exists(path.join(jobDir, 'identity_consistency_report.json')), true)
})

test('character pack CLI motion-source apply-set writes guarded multi-strip artifacts', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'character-pack-cli-motion-set-'))
  const outputDir = path.join(root, 'out')
  const sheetPath = path.join(root, 'normalized_sheet.png')
  const idleStripPath = path.join(root, 'idle_down.png')
  const walkStripPath = path.join(root, 'walk_down.png')
  const manifestPath = path.join(root, 'motion_source_set.json')

  await writeFile(sheetPath, await makeMotionApplySheetPng())
  await writeFile(idleStripPath, await makeMotionApplyStripPng(4, [120, 80, 160, 255]))
  await writeFile(walkStripPath, await makeMotionApplyStripPng(4, [124, 82, 158, 255]))
  await writeFile(manifestPath, JSON.stringify({
    contract_version: 'motion_source_set_v1',
    identity_anchor: { source_id: 'idle_down', facing_direction: 'down' },
    background: { source_requirement: 'flat_solid_key_color', key_color: [255, 255, 255] },
    sources: [
      { id: 'idle_down', runtime_action: 'idle_down', source: 'idle_down.png', target_frame_count: 4, facing_direction: 'down' },
      { id: 'walk_down', runtime_action: 'walk_down', source: 'walk_down.png', target_frame_count: 4, facing_direction: 'down' },
    ],
  }, null, 2))

  const result = await runCli([
    'motion-source',
    'apply-set',
    '--sheet',
    sheetPath,
    '--manifest',
    manifestPath,
    '--strip',
    `idle_down=${idleStripPath}`,
    '--strip',
    `walk_down=${walkStripPath}`,
    '--output-dir',
    outputDir,
    '--job-id',
    'motion_set_apply',
  ])

  const jobDir = path.join(outputDir, 'motion_set_apply')
  const report = JSON.parse(await readFile(path.join(jobDir, 'motion_source_set_apply_report.json'), 'utf8'))

  assert.equal(result.command, 'motion-source apply-set')
  assert.equal(result.status, 'done')
  assert.equal(result.can_apply_multi_strip, true)
  assert.equal(report.mode, 'motion_source_set_apply_report_v1')
  assert.deepEqual(report.applied_actions.map((item) => item.runtime_action), ['idle_down', 'walk_down'])
  assert.equal(await exists(path.join(jobDir, 'applied_normalized_sheet.png')), true)
  assert.equal(await exists(path.join(jobDir, 'motion_source_set_report.json')), true)
  assert.equal(await exists(path.join(jobDir, 'identity_consistency_report.json')), true)
})

test('character pack CLI process can opt into report-only pixel style metrics', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'character-pack-cli-style-report-'))
  const result = await runCli([
    'process',
    '--input',
    'test/fixtures/character-pack/topdown_rpg_v0_sample_hero.png',
    '--output-dir',
    outputDir,
    '--job-id',
    'cli_style_report',
    '--background-mode',
    'flood',
    '--style-report',
    '--style-max-colors',
    '6',
  ])

  const debugReport = JSON.parse(await readFile(path.join(outputDir, 'cli_style_report', 'debug_report.json'), 'utf8'))
  assert.equal(result.command, 'process')
  assert.equal(debugReport.pixel_style.mode, 'report_only')
  assert.equal(debugReport.pixel_style.output_mutation, 'none')
  assert.equal(debugReport.pixel_style.palette.max_colors, 6)
  assert.ok(debugReport.pixel_style.palette.colors.length <= 6)
})

test('character pack CLI generate dry-run writes prompt artifacts without provider quota', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'character-pack-cli-generate-'))
  const result = await runCli([
    'generate',
    '--description',
    'blue wizard',
    '--preset',
    'topdown_rpg_v0',
    '--dry-run-prompt',
    '--output-dir',
    outputDir,
    '--job-id',
    'cli_prompt',
  ])

  assert.equal(result.command, 'generate')
  assert.equal(result.mode, 'dry_run_prompt')
  assert.equal(result.job_id, 'cli_prompt')
  assert.equal(result.prompt_contract.contract_version, 'character_prompt_contract_v1_15')
  assert.equal(await exists(path.join(outputDir, 'cli_prompt', 'prompt.txt')), true)
  assert.equal(await exists(path.join(outputDir, 'cli_prompt', 'generation.json')), true)
})

test('character pack CLI generate dry-run defaults to the fixed-region motion generation layout', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'character-pack-cli-generate-default-'))
  const result = await runCli([
    'generate',
    '--description',
    'blue wizard',
    '--dry-run-prompt',
    '--output-dir',
    outputDir,
    '--job-id',
    'cli_prompt_default',
  ])

  assert.equal(result.command, 'generate')
  assert.equal(result.mode, 'dry_run_prompt')
  assert.equal(result.prompt_contract.preset, FIXED_REGION_MOTION_LAYOUT_ID)
  assert.equal(result.prompt_contract.layout_id, FIXED_REGION_MOTION_LAYOUT_ID)
})

test('character pack CLI generate dry-run supports quality character mode', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'character-pack-cli-quality-prompt-'))
  const result = await runCli([
    'generate',
    '--description',
    'silver swordswoman',
    '--t2i-mode',
    'quality_character_v0',
    '--character-preset',
    'two_to_one_character_v0',
    '--prompt-field',
    'outfit=blue cloak',
    '--dry-run-prompt',
    '--output-dir',
    outputDir,
    '--job-id',
    'cli_quality_prompt',
  ])

  const prompt = await readFile(path.join(outputDir, 'cli_quality_prompt', 'prompt.txt'), 'utf8')
  assert.equal(result.command, 'generate')
  assert.equal(result.mode, 'dry_run_prompt')
  assert.equal(result.prompt_contract.mode, 'quality_character_v0')
  assert.equal(result.prompt_contract.preset, 'two_to_one_character_v0')
  assert.match(prompt, /one single centered full-body character only/)
  assert.match(prompt, /blue cloak/)
})

test('character pack CLI generate writes quality character artifacts from provider output', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'character-pack-cli-quality-generate-'))
  const outputDir = path.join(root, 'out')
  const providerPng = await encodeRgbaPng(makeRepairTestCell({ x: 24, y: 17, w: 48, h: 72 }))
  const provider = await startMockImageProvider(providerPng)
  t.after(() => provider.server.close())

  const result = await runCli([
    'generate',
    '--description',
    'silver swordswoman',
    '--t2i-mode',
    'quality_character_v0',
    '--candidate-count',
    '2',
    '--output-dir',
    outputDir,
    '--job-id',
    'quality_character',
    '--provider-preset',
    'quality-provider',
    '--max-provider-calls',
    '2',
    '--yes',
  ], {
    env: {
      KEY_A: 'alpha',
      CHARACTER_PROVIDER_PRESETS: JSON.stringify([
        { id: 'quality-provider', apiKeyEnv: 'KEY_A', baseUrl: provider.url, model: 'model/quality' },
      ]),
      CHARACTER_DEFAULT_PROVIDER: 'quality-provider',
    },
  })

  const jobDir = path.join(outputDir, 'quality_character')
  assert.equal(result.t2i_mode, 'quality_character_v0')
  assert.equal(result.status, 'done')
  assert.equal(result.release_ready, true)
  assert.equal(result.artifact_disposition, 'release')
  assert.equal(result.release_gate.release_ready, true)
  assert.deepEqual(result.provider_call_budget, {
    planned_provider_calls: 2,
    max_provider_calls: 2,
    used_provider_calls: 2,
  })
  assert.equal(result.candidate_selection.selected_index, 1)
  assert.equal(result.candidate_selection.release_selected_index, 1)
  assert.equal(provider.requests.length, 2)
  assert.equal(provider.requests[0].image_config.image_size, '2K')
  assert.match(provider.requests[0].messages[0].content, /not a sprite sheet/)
  assert.equal(await exists(path.join(jobDir, 'source.png')), true)
  assert.equal(await exists(path.join(jobDir, 't2i_result.png')), true)
  assert.equal(await exists(path.join(jobDir, 'candidate_1.png')), true)
  assert.equal(await exists(path.join(jobDir, 't2i_pack.zip')), true)
  const report = JSON.parse(await readFile(path.join(jobDir, 't2i_report.json'), 'utf8'))
  assert.equal(report.candidate_selection.candidate_count, 2)
})

test('character pack CLI generate reports a blocked quality character as diagnostic-only', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'character-pack-cli-quality-gate-'))
  const outputDir = path.join(root, 'out')
  const providerPng = await encodeRgbaPng({
    width: 96,
    height: 96,
    data: new Uint8ClampedArray(96 * 96 * 4),
  })
  const provider = await startMockImageProvider(providerPng)
  t.after(() => provider.server.close())

  const result = await runCli([
    'generate',
    '--description',
    'blank quality character',
    '--t2i-mode',
    'quality_character_v0',
    '--candidate-count',
    '1',
    '--output-dir',
    outputDir,
    '--job-id',
    'quality_character_blocked',
    '--provider-preset',
    'quality-provider',
    '--max-provider-calls',
    '1',
    '--yes',
  ], {
    env: {
      KEY_A: 'alpha',
      CHARACTER_PROVIDER_PRESETS: JSON.stringify([
        { id: 'quality-provider', apiKeyEnv: 'KEY_A', baseUrl: provider.url, model: 'model/quality' },
      ]),
      CHARACTER_DEFAULT_PROVIDER: 'quality-provider',
    },
  })

  const jobDir = path.join(outputDir, 'quality_character_blocked')
  assert.equal(result.status, 'failed_quality_gate')
  assert.equal(result.failure_status, 'generation_release_gate_failed')
  assert.equal(result.release_ready, false)
  assert.equal(result.artifact_disposition, 'diagnostic_only')
  assert.equal(result.candidate_selection.release_selected_index, null)
  assert.equal(await exists(path.join(jobDir, 'generation_release_gate.json')), true)
  assert.equal(await exists(path.join(jobDir, 't2i_result.png')), true)
  assert.equal(await exists(path.join(jobDir, 't2i_pack.zip')), false)
})

test('character pack CLI generate requires a live provider call budget', async () => {
  const error = await runCliError([
    'generate',
    '--description',
    'silver swordswoman',
    '--t2i-mode',
    'quality_character_v0',
    '--yes',
  ])

  assert.match(error.stderr, /generate requires --max-provider-calls/)
})

test('character pack CLI benchmark t2i-golden writes dry-run plan', async () => {
  const result = await runCli([
    'benchmark',
    't2i-golden',
    '--dry-run-plan',
    '--sample-size',
    '3',
    '--candidate-count',
    '4',
  ], {
    env: {
      CHARACTER_IMAGE_PROVIDER: 'gemini',
      GEMINI_API_KEY: 'gemini-key',
      CHARACTER_IMAGE_MODEL: 'gemini-plan-model',
      CHARACTER_PROVIDER_PRESETS: '[]',
    },
  })

  assert.equal(result.command, 'benchmark t2i-golden')
  assert.equal(result.mode, 'dry_run_plan')
  assert.equal(result.t2i_mode, 'quality_character_v0')
  assert.equal(result.provider_config.provider, 'gemini')
  assert.equal(result.provider_config.model, 'gemini-plan-model')
  assert.equal(result.provider_config.available, true)
  assert.equal(result.provider_config.secrets_exposed, false)
  assert.equal(result.case_count, 3)
  assert.equal(result.candidate_count, 4)
  assert.equal(result.planned_provider_calls, 12)
  assert.equal(result.image_config.image_size, '2K')
})

test('character pack CLI benchmark t2i-golden records diagnostic and release selections', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'character-pack-cli-t2i-release-evidence-'))
  const outputDir = path.join(root, 'out')
  const providerPng = await encodeRgbaPng(makeRepairTestCell({ x: 24, y: 17, w: 48, h: 72 }))
  const provider = await startMockImageProvider(providerPng)
  t.after(() => provider.server.close())

  const result = await runCli([
    'benchmark',
    't2i-golden',
    '--sample-size',
    '1',
    '--candidate-count',
    '1',
    '--provider-preset',
    'quality-provider',
    '--max-provider-calls',
    '1',
    '--output-dir',
    outputDir,
    '--run-id',
    'release_evidence',
    '--yes',
  ], {
    env: {
      KEY_A: 'alpha',
      CHARACTER_PROVIDER_PRESETS: JSON.stringify([
        { id: 'quality-provider', apiKeyEnv: 'KEY_A', baseUrl: provider.url, model: 'model/quality' },
      ]),
      CHARACTER_DEFAULT_PROVIDER: 'quality-provider',
    },
  })

  const report = JSON.parse(await readFile(
    path.join(outputDir, 'release_evidence', 't2i_golden_report.json'),
    'utf8'
  ))
  const item = report.items[0]
  assert.equal(item.status, 'done')
  assert.equal(item.selected_index, 1)
  assert.equal(item.release_selected_index, 1)
  assert.equal(typeof item.selected_score, 'number')
  assert.equal(item.release_selected_score, item.selected_score)
  assert.equal(item.candidate_selection.selected_index, 1)
  assert.equal(item.candidate_selection.release_selected_index, 1)
  const roundedReleaseScore = Math.round(item.release_selected_score * 100) / 100
  assert.equal(report.summary.average_reviewed_score, roundedReleaseScore)
  assert.equal(result.average_reviewed_score, roundedReleaseScore)
  assert.equal(provider.requests.length, 1)
  assert.match(report.markdown, /Diagnostic score \| Release \| Release score/)
})

test('character pack CLI benchmark t2i-golden requires a live provider call budget', async () => {
  const error = await runCliError([
    'benchmark',
    't2i-golden',
    '--sample-size',
    '3',
    '--candidate-count',
    '4',
    '--yes',
  ])

  assert.match(error.stderr, /benchmark t2i-golden requires --max-provider-calls/)
})

test('character pack CLI benchmark t2i-golden rejects budgets below the planned call count', async () => {
  const error = await runCliError([
    'benchmark',
    't2i-golden',
    '--sample-size',
    '3',
    '--candidate-count',
    '4',
    '--max-provider-calls',
    '11',
    '--yes',
  ])

  assert.match(error.stderr, /planned provider calls 12 exceed --max-provider-calls 11/)
})

test('character pack CLI benchmark t2i-golden writes a report when a case fails', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'character-pack-cli-t2i-failed-'))
  const outputDir = path.join(root, 'out')
  const provider = await startFailingImageProvider('provider unavailable')
  t.after(() => provider.server.close())

  const result = await runCli([
    'benchmark',
    't2i-golden',
    '--sample-size',
    '2',
    '--candidate-count',
    '2',
    '--provider-preset',
    'failing-provider',
    '--max-provider-calls',
    '4',
    '--output-dir',
    outputDir,
    '--run-id',
    'failed_gate',
    '--yes',
  ], {
    env: {
      KEY_A: 'alpha',
      CHARACTER_PROVIDER_PRESETS: JSON.stringify([
        { id: 'failing-provider', apiKeyEnv: 'KEY_A', baseUrl: provider.url, model: 'model/failing' },
      ]),
    },
  })

  const reportPath = path.join(outputDir, 'failed_gate', 't2i_golden_report.json')
  const report = JSON.parse(await readFile(reportPath, 'utf8'))
  assert.equal(result.total, 1)
  assert.deepEqual(result.provider_call_budget, {
    planned_provider_calls: 4,
    max_provider_calls: 4,
    used_provider_calls: 2,
  })
  assert.equal(provider.requests.length, 2)
  assert.equal(report.summary.failure_count, 1)
  assert.equal(report.summary.stopped_early, true)
  assert.equal(report.summary.stop_reason, 'case_failure_limit_reached')
  assert.equal(report.provider_config.selected_provider_preset_id, 'failing-provider')
  assert.equal(report.provider_config.model, 'model/failing')
  assert.deepEqual(report.failure_taxonomy, [
    { category: 'provider.model_error', count: 1, examples: ['silver_swordswoman_zh'] },
  ])
  assert.equal(report.items[0].status, 'failed_all_candidates')
  assert.equal(report.items[0].error, 'provider unavailable')
  assert.equal(report.items[0].candidate_selection.candidates.length, 2)
  assert.match(await readFile(path.join(outputDir, 'failed_gate', 't2i_golden_report.md'), 'utf8'), /provider unavailable/)
})

test('character pack CLI benchmark t2i-golden stops early on provider route blocks', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'character-pack-cli-t2i-route-blocked-'))
  const outputDir = path.join(root, 'out')
  const provider = await startFailingImageProvider('The request is prohibited due to a violation of provider terms of service.')
  t.after(() => provider.server.close())

  const result = await runCli([
    'benchmark',
    't2i-golden',
    '--sample-size',
    '2',
    '--candidate-count',
    '4',
    '--provider-preset',
    'blocked-provider',
    '--max-provider-calls',
    '8',
    '--output-dir',
    outputDir,
    '--run-id',
    'blocked_gate',
    '--yes',
  ], {
    env: {
      KEY_A: 'alpha',
      CHARACTER_PROVIDER_PRESETS: JSON.stringify([
        { id: 'blocked-provider', apiKeyEnv: 'KEY_A', baseUrl: provider.url, model: 'model/blocked' },
      ]),
    },
  })

  const reportPath = path.join(outputDir, 'blocked_gate', 't2i_golden_report.json')
  const report = JSON.parse(await readFile(reportPath, 'utf8'))
  assert.equal(result.total, 1)
  assert.deepEqual(result.provider_call_budget, {
    planned_provider_calls: 8,
    max_provider_calls: 8,
    used_provider_calls: 1,
  })
  assert.equal(provider.requests.length, 1)
  assert.equal(report.items[0].status, 'provider_route_blocked')
  assert.equal(report.items[0].retry_hint, 'switch_provider_preset')
  assert.deepEqual(report.failure_taxonomy, [
    { category: 'provider.route_blocked', count: 1, examples: ['silver_swordswoman_zh'] },
  ])
  assert.equal(report.items[0].candidate_selection.candidate_count, 4)
  assert.equal(report.items[0].candidate_selection.candidates.length, 1)
  assert.equal(report.items[0].candidate_selection.candidates[0].failure_status, 'provider_route_blocked')
})

test('character pack CLI benchmark t2i-golden-review writes offline review files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'character-pack-cli-t2i-review-'))
  const runDir = path.join(root, 't2i_run')
  const itemDir = path.join(runDir, 'items', 'hero_ok')
  const outputDir = path.join(root, 'review')
  await mkdir(itemDir, { recursive: true })
  for (const name of ['source.png', 't2i_result.png', 'candidate_1.png', 'candidate_2.png', 'prompt.txt', 'generation.json']) {
    await writeFile(path.join(itemDir, name), name)
  }
  const reportPath = path.join(runDir, 't2i_golden_report.json')
  await writeFile(reportPath, JSON.stringify({
    run_id: 't2i_run',
    t2i_mode: 'quality_character_v0',
    candidate_count: 2,
    image_config: { image_size: '2K', aspect_ratio: '1:1' },
    generation_options: { candidateCount: 2 },
    summary: { total: 1, average_score: 760 },
    items: [
      {
        case_id: 'hero_ok',
        locale: 'en',
        description: 'blue hero',
        status: 'done',
        selected_index: 2,
        selected_score: 760,
        prompt_file: path.join(itemDir, 'prompt.txt'),
        generation_file: path.join(itemDir, 'generation.json'),
        source_file: path.join(itemDir, 'source.png'),
        result_file: path.join(itemDir, 't2i_result.png'),
        candidate_selection: {
          candidates: [
            { index: 1, score: 690, status: 'pass', metrics: { visible_pixel_count: 1200, unique_color_count: 10 } },
            { index: 2, score: 760, status: 'pass', metrics: { visible_pixel_count: 1600, unique_color_count: 16, palette_changed_pixel_ratio: 0.2, outline_pixel_ratio: 0.04 } },
          ],
        },
      },
    ],
  }, null, 2))

  const result = await runCli([
    'benchmark',
    't2i-golden-review',
    '--report',
    reportPath,
    '--output-dir',
    outputDir,
  ])

  assert.equal(result.command, 'benchmark t2i-golden-review')
  assert.equal(result.mode, 'offline')
  assert.equal(result.quality_gate.status, 'pass')
  assert.equal(result.usable_rate, 1)
  assert.equal(result.closure_analysis.status, 'pass')
  assert.equal(result.priority_actions[0].id, 'monitor_quality_gate')
  assert.equal(await exists(path.join(outputDir, 't2i_golden_review.json')), true)
  assert.equal(await exists(path.join(outputDir, 't2i_golden_review.md')), true)
  assert.equal(await exists(path.join(outputDir, 't2i_golden_review.html')), true)
  const review = JSON.parse(await readFile(path.join(outputDir, 't2i_golden_review.json'), 'utf8'))
  assert.equal(review.items[0].candidate_scores[1].artifact.exists, true)
  assert.match(await readFile(path.join(outputDir, 't2i_golden_review.html'), 'utf8'), /candidate_2\.png/)
})

test('character pack CLI scene tile-prompt writes provider-free dry-run artifacts', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'character-pack-cli-scene-tile-prompt-'))
  const result = await runCli([
    'scene',
    'tile-prompt',
    '--description',
    'mossy cliff path',
    '--dry-run-prompt',
    '--output-dir',
    outputDir,
    '--job-id',
    'scene_tile_prompt',
  ])

  const generation = JSON.parse(await readFile(path.join(outputDir, 'scene_tile_prompt', 'generation.json'), 'utf8'))
  const prompt = await readFile(path.join(outputDir, 'scene_tile_prompt', 'prompt.txt'), 'utf8')
  assert.equal(result.command, 'scene tile-prompt')
  assert.equal(result.mode, 'dry_run_prompt')
  assert.equal(result.prompt_contract.contract_version, 'scene_tile_prompt_contract_v0_6')
  assert.equal(generation.prompt_contract.profile, 'topdown_tile_dual_grid_v0')
  assert.match(prompt, /mossy cliff path/i)
  assert.match(prompt, /row-major dual-grid mask order 0-15/i)
  assert.match(prompt, /outer 3 px border band/i)
  assert.match(prompt, /not separate mini-scenes/i)
  assert.match(prompt, /not a continuous scene sliced into cells/i)
  assert.doesNotMatch(prompt, /Mask placement/i)
  assert.match(prompt, /true PNG image at exactly 192x192 pixels/i)
})

test('character pack CLI scene tile-ingest writes scene pack artifacts from a source sheet', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'character-pack-cli-scene-tile-ingest-'))
  const input = path.join(root, 'tileset.png')
  const outputDir = path.join(root, 'out')
  await writeFile(input, await encodeRgbaPng(makeSceneTileSheet()))

  const result = await runCli([
    'scene',
    'tile-ingest',
    '--input',
    input,
    '--output-dir',
    outputDir,
    '--job-id',
    'scene_tile_ingest',
    '--identifier',
    'uploaded_scene',
    '--width',
    '2',
    '--height',
    '2',
    '--pattern',
    'solid',
  ])

  assert.equal(result.command, 'scene tile-ingest')
  assert.equal(result.job_id, 'scene_tile_ingest')
  assert.equal(result.status, 'done')
  assert.equal(result.urls.ldtk_project_url, '/generated/scene_tile_ingest/project.ldtk')
  assert.equal(await exists(path.join(outputDir, 'scene_tile_ingest', 'scene_pack.zip')), true)
  assert.equal(await exists(path.join(outputDir, 'scene_tile_ingest', 'project.ldtk')), true)
  assert.equal(await exists(path.join(outputDir, 'scene_tile_ingest', 'tileset.png')), true)
  assert.equal(JSON.parse(await readFile(path.join(outputDir, 'scene_tile_ingest', 'quality_gate.json'), 'utf8')).status, 'pass')
})

test('character pack CLI scene tile-ingest can opt into palette snap style correction', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'character-pack-cli-scene-style-snap-'))
  const input = path.join(root, 'tileset.png')
  const outputDir = path.join(root, 'out')
  await writeFile(input, await encodeRgbaPng(makeSceneTileSheet()))

  const result = await runCli([
    'scene',
    'tile-ingest',
    '--input',
    input,
    '--output-dir',
    outputDir,
    '--job-id',
    'scene_tile_style_snap',
    '--identifier',
    'style_snap_scene',
    '--width',
    '2',
    '--height',
    '2',
    '--pattern',
    'solid',
    '--style-snap',
    '--style-max-colors',
    '1',
  ])

  const jobDir = path.join(outputDir, 'scene_tile_style_snap')
  const qualityGate = JSON.parse(await readFile(path.join(jobDir, 'quality_gate.json'), 'utf8'))
  const styleCorrection = JSON.parse(await readFile(path.join(jobDir, 'style_correction.json'), 'utf8'))

  assert.equal(result.status, 'done')
  assert.equal(result.urls.style_correction_url, '/generated/scene_tile_style_snap/style_correction.json')
  assert.equal(styleCorrection.mode, 'palette_snap')
  assert.equal(styleCorrection.output_mutation, 'palette_snap')
  assert.equal(styleCorrection.palette.source, 'extracted')
  assert.equal(styleCorrection.palette.max_colors, 1)
  assert.ok(styleCorrection.changed_pixel_count > 0)
  assert.ok(styleCorrection.changed_pixel_ratio > 0)
  assert.equal(qualityGate.style_correction.mode, 'palette_snap')
  assert.equal(result.style_correction.mode, 'palette_snap')
})

test('character pack CLI scene tile-ingest can write edge-conditioned scene pack artifacts', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'character-pack-cli-scene-edge-condition-'))
  const input = path.join(root, 'tileset.png')
  const outputDir = path.join(root, 'out')
  await writeFile(input, await encodeRgbaPng(makeMismatchedSceneTileSheet()))

  const result = await runCli([
    'scene',
    'tile-ingest',
    '--input',
    input,
    '--output-dir',
    outputDir,
    '--job-id',
    'scene_tile_conditioned',
    '--identifier',
    'conditioned_scene',
    '--width',
    '2',
    '--height',
    '2',
    '--pattern',
    'solid',
    '--edge-condition',
    '--edge-band',
    '3',
  ])

  const jobDir = path.join(outputDir, 'scene_tile_conditioned')
  const qualityGate = JSON.parse(await readFile(path.join(jobDir, 'quality_gate.json'), 'utf8'))
  const edgeConditioning = JSON.parse(await readFile(path.join(jobDir, 'edge_conditioning.json'), 'utf8'))
  const conditioningReview = JSON.parse(await readFile(path.join(jobDir, 'tile_conditioning_review.json'), 'utf8'))

  assert.equal(result.command, 'scene tile-ingest')
  assert.equal(result.status, 'done')
  assert.equal(result.urls.edge_conditioning_url, '/generated/scene_tile_conditioned/edge_conditioning.json')
  assert.equal(result.urls.tile_conditioning_review_url, '/generated/scene_tile_conditioned/tile_conditioning_review.json')
  assert.equal(result.urls.tile_conditioning_review_image_url, '/generated/scene_tile_conditioned/tile_conditioning_review.png')
  assert.equal(qualityGate.status, 'pass')
  assert.equal(edgeConditioning.enabled, true)
  assert.equal(edgeConditioning.mode, 'edge_aware_conditioning_v1')
  assert.equal(edgeConditioning.band, 3)
  assert.ok(edgeConditioning.changed_pixel_count > 0)
  assert.ok(edgeConditioning.changed_pixel_ratio < 0.3398)
  assert.equal(conditioningReview.status, 'warning')
  assert.deepEqual(conditioningReview.warnings, ['tile.edge_conditioning_visible_mutation'])
  assert.equal(await exists(path.join(jobDir, 'tile_conditioning_review.png')), true)
  assert.equal(result.edge_conditioning.enabled, true)
  assert.equal(result.tile_conditioning_review.status, 'warning')
})

test('character pack CLI project pack combines existing character and scene artifact dirs', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'character-pack-cli-project-pack-'))
  const characterOutputDir = path.join(root, 'character-out')
  const sceneOutputDir = path.join(root, 'scene-out')
  const projectOutputDir = path.join(root, 'project-out')
  const sceneInput = path.join(root, 'tileset.png')
  await writeFile(sceneInput, await encodeRgbaPng(makeSceneTileSheet()))

  await runCli([
    'process',
    '--input',
    'test/fixtures/character-pack/topdown_rpg_v0_sample_hero.png',
    '--output-dir',
    characterOutputDir,
    '--job-id',
    'hero_pack',
    '--name',
    'hero',
    '--background-mode',
    'flood',
    '--style-report',
  ])
  await runCli([
    'scene',
    'tile-ingest',
    '--input',
    sceneInput,
    '--output-dir',
    sceneOutputDir,
    '--job-id',
    'scene_pack',
    '--identifier',
    'meadow_scene',
    '--width',
    '2',
    '--height',
    '2',
    '--pattern',
    'solid',
  ])

  const result = await runCli([
    'project',
    'pack',
    '--character-dir',
    path.join(characterOutputDir, 'hero_pack'),
    '--scene-dir',
    path.join(sceneOutputDir, 'scene_pack'),
    '--output-dir',
    projectOutputDir,
    '--job-id',
    'project_pack',
    '--project-id',
    'demo_project',
    '--created-at',
    '2026-06-06T00:00:00.000Z',
  ])

  const jobDir = path.join(projectOutputDir, 'project_pack')
  const manifest = JSON.parse(await readFile(path.join(jobDir, 'project_manifest.json'), 'utf8'))
  const validation = JSON.parse(await readFile(path.join(jobDir, 'project_validation.json'), 'utf8'))
  const zip = await JSZip.loadAsync(await readFile(path.join(jobDir, 'project_pack.zip')))

  assert.equal(result.command, 'project pack')
  assert.equal(result.status, 'done')
  assert.equal(result.urls.project_pack_zip_url, '/generated/project_pack/project_pack.zip')
  assert.equal(manifest.project_id, 'demo_project')
  assert.equal(manifest.packs.character.profile, 'topdown_rpg_v0')
  assert.equal(manifest.packs.scene.profile, 'topdown_tile_dual_grid_v0')
  assert.equal(manifest.style_contract.source, 'character_pixel_style_report')
  assert.equal(validation.status, 'warning')
  assert.ok(validation.warnings.includes('scene_style_report_missing'))
  assert.equal(JSON.parse(await zip.file('project_manifest.json').async('string')).project_id, 'demo_project')
  assert.equal(JSON.parse(await zip.file('character/metadata.json').async('string')).profile, 'topdown_rpg_v0')
  assert.equal(JSON.parse(await zip.file('scene/scene.json').async('string')).identifier, 'meadow_scene')
  assert.ok(zip.file('character/character_pack.zip'))
  assert.ok(zip.file('scene/scene_pack.zip'))

  const strictResult = await runCli([
    'project',
    'pack',
    '--character-dir',
    path.join(characterOutputDir, 'hero_pack'),
    '--scene-dir',
    path.join(sceneOutputDir, 'scene_pack'),
    '--output-dir',
    projectOutputDir,
    '--job-id',
    'project_pack_strict',
    '--project-id',
    'demo_project_strict',
    '--strict-style-contract',
  ])
  assert.equal(strictResult.status, 'failed_project_pack')
  assert.equal(strictResult.reason, 'style_contract_failed')
  assert.equal(strictResult.validation.style_contract.policy, 'strict')
})

test('character pack CLI scene tile-generate refuses live provider quota without yes', async () => {
  const error = await runCliError([
    'scene',
    'tile-generate',
    '--description',
    'mossy cliff path',
  ])

  assert.match(error.stderr, /scene tile-generate uses live provider quota/)
})

test('character pack CLI scene tile-generate requires a provider call budget', async () => {
  const error = await runCliError([
    'scene',
    'tile-generate',
    '--description',
    'mossy cliff path',
    '--candidate-count',
    '2',
    '--yes',
  ])

  assert.match(error.stderr, /scene tile-generate requires --max-provider-calls/)
  assert.match(error.stderr, /planned provider calls: 2/)
})

test('character pack CLI scene tile-generate writes scene pack artifacts from provider output', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'character-pack-cli-scene-tile-generate-'))
  const outputDir = path.join(root, 'out')
  const providerPng = await encodeRgbaPng(makeSceneTileSheet())
  const provider = await startMockImageProvider(providerPng)
  t.after(() => provider.server.close())

  const result = await runCli([
    'scene',
    'tile-generate',
    '--description',
    'mossy cliff path',
    '--output-dir',
    outputDir,
    '--job-id',
    'scene_tile_generate',
    '--identifier',
    'generated_scene',
    '--width',
    '2',
    '--height',
    '2',
    '--pattern',
    'solid',
    '--provider-preset',
    'scene-provider',
    '--image-size',
    '1K',
    '--aspect-ratio',
    '1:1',
    '--candidate-count',
    '2',
    '--max-provider-calls',
    '2',
    '--yes',
  ], {
    env: {
      KEY_A: 'alpha',
      CHARACTER_PROVIDER_PRESETS: JSON.stringify([
        { id: 'scene-provider', apiKeyEnv: 'KEY_A', baseUrl: provider.url, model: 'model/scene' },
      ]),
      CHARACTER_DEFAULT_PROVIDER: 'scene-provider',
    },
  })

  const jobDir = path.join(outputDir, 'scene_tile_generate')
  assert.equal(result.command, 'scene tile-generate')
  assert.equal(result.mode, 'live')
  assert.equal(result.status, 'done')
  assert.deepEqual(result.provider_call_budget, {
    planned_provider_calls: 2,
    max_provider_calls: 2,
    used_provider_calls: 2,
  })
  assert.equal(result.urls.ldtk_project_url, '/generated/scene_tile_generate/project.ldtk')
  assert.equal(result.urls.prompt_url, '/generated/scene_tile_generate/prompt.txt')
  assert.equal(result.urls.generation_url, '/generated/scene_tile_generate/generation.json')
  assert.equal(result.urls.candidate_selection_url, '/generated/scene_tile_generate/candidate_selection.json')
  assert.equal(await exists(path.join(jobDir, 'scene_pack.zip')), true)
  assert.equal(await exists(path.join(jobDir, 'project.ldtk')), true)
  assert.equal(await exists(path.join(jobDir, 'tileset.png')), true)
  assert.equal(await exists(path.join(jobDir, 'candidate_selection.json')), true)
  assert.equal(await exists(path.join(jobDir, 'candidates', 'candidate_02', 'generation.json')), true)
  assert.equal(JSON.parse(await readFile(path.join(jobDir, 'quality_gate.json'), 'utf8')).status, 'pass')
  const generation = JSON.parse(await readFile(path.join(jobDir, 'generation.json'), 'utf8'))
  assert.equal(generation.mode, 'live_tile_generation')
  assert.equal(generation.candidate_count, 2)
  assert.equal(generation.candidate_selection.candidate_count, 2)
  assert.equal(generation.provider_preset_id, 'scene-provider')
  assert.equal(generation.prompt_contract.contract_version, 'scene_tile_prompt_contract_v0_6')
  assert.equal(provider.requests.length, 2)
  assert.equal(provider.requests[0].model, 'model/scene')
  assert.deepEqual(provider.requests[0].image_config, { aspect_ratio: '1:1', image_size: '1K' })
  assert.match(provider.requests[0].messages[0].content, /mossy cliff path/)
})

test('character pack CLI benchmark processed forwards to existing benchmark runner', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'character-pack-cli-bench-root-'))
  const generatedDir = path.join(root, 'generated')
  await mkdir(path.join(generatedDir, 'sample_a'), { recursive: true })
  await writeFile(
    path.join(generatedDir, 'sample_a', 'debug_report.json'),
    JSON.stringify({
      profile: 'topdown_rpg_v0',
      source_layout: { id: 'topdown_rpg_v0' },
      background_mode: 'flood',
      normalization: {
        auto_correction: { applied_count: 0 },
        motion_stabilization: { applied_count: 0 },
      },
      validation: {
        status: 'pass',
        warnings: [],
        blocking_errors: [],
        metrics: { halo_score: 0, edge_pressure: { severe_frame_count: 0 } },
      },
      frames: [{ normalized_anchor: { x: 48, y: 88 } }],
    })
  )

  const outputDir = path.join(root, 'benchmarks')
  const result = await runCli([
    'benchmark',
    'processed',
    '--root-dir',
    generatedDir,
    '--output-dir',
    outputDir,
    '--run-id',
    'cli_processed',
  ])

  assert.equal(result.command, 'benchmark processed')
  assert.equal(result.run_id, 'cli_processed')
  assert.equal(result.total, 1)
  assert.equal(result.validation.pass, 1)
  assert.equal(await exists(path.join(outputDir, 'cli_processed', 'processed_sample_benchmark.json')), true)
})

test('character pack CLI benchmark local-images reads a controlled manifest only', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'character-pack-cli-local-images-empty-'))
  const outputDir = path.join(root, 'out')
  const manifestPath = path.join(root, 'manifest.json')
  await writeFile(
    manifestPath,
    JSON.stringify({
      schema_version: 1,
      fixture_set: 'local_image_golden_empty_test',
      legacy_exclusions: ['../topdown_rpg_v0_sample_hero.png'],
      samples: [],
    }, null, 2)
  )
  const result = await runCli([
    'benchmark',
    'local-images',
    '--manifest',
    manifestPath,
    '--output-dir',
    outputDir,
    '--run-id',
    'local_empty',
  ])

  assert.equal(result.command, 'benchmark local-images')
  assert.equal(result.run_id, 'local_empty')
  assert.equal(result.total, 0)
  assert.deepEqual(result.validation, { pass: 0, warning: 0, fail: 0, error: 0, skipped: 0 })
  assert.equal(result.gate_layer.id, 'local-golden')
  assert.equal(result.quality_gate.status, 'fail')
  assert.equal(result.quality_gate.blocking_errors.includes('sample_count'), true)
  const report = JSON.parse(await readFile(path.join(outputDir, 'local_empty', 'local_image_benchmark.json'), 'utf8'))
  assert.deepEqual(report.manifest.legacy_exclusions, ['../topdown_rpg_v0_sample_hero.png'])
  assert.equal(report.items.length, 0)
  assert.equal(report.quality_gate.layer, 'local-golden')
})

test('character pack CLI benchmark local-images scores manifest single-character samples', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'character-pack-cli-local-images-'))
  const fixtureRoot = path.join(root, 'fixtures')
  const outputDir = path.join(root, 'out')
  await mkdir(path.join(fixtureRoot, 'single-character'), { recursive: true })
  const image = { width: 64, height: 64, data: new Uint8ClampedArray(64 * 64 * 4) }
  paintRect(image, { x: 20, y: 16, w: 24, h: 32 }, [60, 120, 210, 255])
  const imageBuffer = await encodeRgbaPng(image)
  await writeFile(path.join(fixtureRoot, 'single-character', 'blue_hero.png'), imageBuffer)
  const manifestPath = path.join(fixtureRoot, 'manifest.json')
  await writeFile(
    manifestPath,
    JSON.stringify({
      schema_version: 1,
      fixture_set: 'local_image_golden_test',
      legacy_exclusions: ['../topdown_rpg_v0_sample_hero.png'],
      samples: [
        {
          id: 'blue_hero',
          file: 'single-character/blue_hero.png',
          kind: 'single_character',
          profile: 'quality_character_v0',
          source_rights: 'test_generated',
          sha256: sha256(imageBuffer),
          image: { width: 64, height: 64, format: 'png' },
          expected_status: 'pass',
          expected_checks: ['single_character.bbox'],
          notes: 'centered synthetic test image',
        },
      ],
    }, null, 2)
  )

  const result = await runCli([
    'benchmark',
    'local-images',
    '--manifest',
    manifestPath,
    '--output-dir',
    outputDir,
    '--run-id',
    'local_single',
    '--kind',
    'single_character',
  ])

  assert.equal(result.command, 'benchmark local-images')
  assert.equal(result.total, 1)
  assert.equal(result.validation.pass, 1)
  assert.equal(result.quality_gate.status, 'pass')
  assert.equal(result.html_file, `${outputDir}/local_single/local_image_benchmark.html`)
  assert.equal(result.usable_rate, 1)
  assert.equal(result.expectation_met_rate, 1)
  const report = JSON.parse(await readFile(path.join(outputDir, 'local_single', 'local_image_benchmark.json'), 'utf8'))
  const htmlReport = await readFile(path.join(outputDir, 'local_single', 'local_image_benchmark.html'), 'utf8')
  assert.equal(report.items[0].id, 'blue_hero')
  assert.equal(report.items[0].status, 'pass')
  assert.equal(report.items[0].metrics.bbox_width_ratio, 0.375)
  assert.equal(report.items[0].metrics.bbox_height_ratio, 0.5)
  assert.match(htmlReport, /Local Image Benchmark local_single/)
  assert.match(htmlReport, /provider_free/)
  assert.match(htmlReport, /blue_hero/)
  assert.equal(await exists(path.join(outputDir, 'local_single', report.items[0].visual_previews.background_before_after)), true)
})

test('character pack CLI benchmark local-images can sweep background modes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'character-pack-cli-local-images-sweep-'))
  const fixtureRoot = path.join(root, 'fixtures')
  const outputDir = path.join(root, 'out')
  await mkdir(path.join(fixtureRoot, 'single-character'), { recursive: true })
  const image = { width: 64, height: 64, data: new Uint8ClampedArray(64 * 64 * 4) }
  paintRect(image, { x: 0, y: 0, w: 64, h: 64 }, [255, 255, 255, 255])
  paintRect(image, { x: 20, y: 16, w: 24, h: 32 }, [60, 120, 210, 255])
  const imageBuffer = await encodeRgbaPng(image)
  await writeFile(path.join(fixtureRoot, 'single-character', 'blue_hero.png'), imageBuffer)
  const manifestPath = path.join(fixtureRoot, 'manifest.json')
  await writeFile(
    manifestPath,
    JSON.stringify({
      schema_version: 1,
      fixture_set: 'local_image_golden_sweep_test',
      samples: [
        {
          id: 'blue_hero',
          file: 'single-character/blue_hero.png',
          kind: 'single_character',
          profile: 'quality_character_v0',
          source_rights: 'test_generated',
          sha256: sha256(imageBuffer),
          image: { width: 64, height: 64, format: 'png' },
          expected_checks: ['background_sweep'],
        },
      ],
    }, null, 2)
  )

  const result = await runCli([
    'benchmark',
    'local-images',
    '--manifest',
    manifestPath,
    '--output-dir',
    outputDir,
    '--run-id',
    'local_sweep',
    '--background-sweep',
    '--background-sweep-mode',
    'flood',
    '--background-sweep-mode',
    'passthrough',
  ])

  assert.equal(result.command, 'benchmark local-images')
  assert.equal(result.background_sweep.enabled, true)
  assert.equal(result.quality_gate.status, 'pass')
  const report = JSON.parse(await readFile(path.join(outputDir, 'local_sweep', 'local_image_benchmark.json'), 'utf8'))
  const sweep = report.items[0].background_sweep
  assert.deepEqual(sweep.modes, ['flood', 'passthrough'])
  assert.equal(sweep.recommended_mode, 'flood')
  assert.equal(sweep.results.find((item) => item.requested_mode === 'flood').status, 'pass')
  assert.equal(sweep.results.find((item) => item.requested_mode === 'passthrough').status, 'warning')
})

test('character pack CLI benchmark local-images gate layers define warning policy', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'character-pack-cli-local-images-gates-'))
  const fixtureRoot = path.join(root, 'fixtures')
  const outputDir = path.join(root, 'out')
  await mkdir(path.join(fixtureRoot, 'single-character'), { recursive: true })
  const image = { width: 64, height: 64, data: new Uint8ClampedArray(64 * 64 * 4) }
  paintRect(image, { x: 2, y: 2, w: 60, h: 60 }, [60, 120, 210, 255])
  await writeFile(path.join(fixtureRoot, 'single-character', 'oversized_hero.png'), await encodeRgbaPng(image))
  const manifestPath = path.join(fixtureRoot, 'manifest.json')
  await writeFile(
    manifestPath,
    JSON.stringify({
      schema_version: 1,
      fixture_set: 'local_image_gate_layer_test',
      samples: [
        {
          id: 'oversized_hero',
          file: 'single-character/oversized_hero.png',
          kind: 'single_character',
          profile: 'quality_character_v0',
          source_rights: 'test_generated',
          expected_checks: ['single_character.warning_policy'],
        },
      ],
    }, null, 2)
  )

  const localGolden = await runCli([
    'benchmark',
    'local-images',
    '--manifest',
    manifestPath,
    '--output-dir',
    outputDir,
    '--run-id',
    'local_golden_warning',
    '--gate-layer',
    'local-golden',
  ])
  const release = await runCli([
    'benchmark',
    'local-images',
    '--manifest',
    manifestPath,
    '--output-dir',
    outputDir,
    '--run-id',
    'release_warning',
    '--gate-layer',
    'release',
  ])

  assert.equal(localGolden.validation.warning, 1)
  assert.equal(localGolden.quality_gate.status, 'warning')
  assert.equal(release.validation.warning, 1)
  assert.equal(release.quality_gate.status, 'fail')
  assert.equal(release.quality_gate.blocking_errors.includes('sample_quality'), true)
})

test('character pack CLI benchmark local-images rejects live gate layer', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'character-pack-cli-local-images-live-gate-'))
  const manifestPath = path.join(root, 'manifest.json')
  await writeFile(
    manifestPath,
    JSON.stringify({
      schema_version: 1,
      fixture_set: 'local_image_live_gate_test',
      samples: [],
    }, null, 2)
  )

  const error = await runCliError([
    'benchmark',
    'local-images',
    '--manifest',
    manifestPath,
    '--gate-layer',
    'live',
  ])

  assert.match(error.stderr, /cannot run --gate-layer live/)
})

test('character pack CLI benchmark local-images-validate catches extension mismatches', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'character-pack-cli-local-images-validate-'))
  const fixtureRoot = path.join(root, 'fixtures')
  await mkdir(path.join(fixtureRoot, 'single-character'), { recursive: true })
  const image = { width: 32, height: 32, data: new Uint8ClampedArray(32 * 32 * 4) }
  paintRect(image, { x: 8, y: 6, w: 16, h: 20 }, [80, 90, 200, 255])
  await writeFile(path.join(fixtureRoot, 'single-character', 'misnamed.png'), await encodeRgbaJpeg(image))
  const manifestPath = path.join(fixtureRoot, 'manifest.json')
  await writeFile(
    manifestPath,
    JSON.stringify({
      schema_version: 1,
      fixture_set: 'local_image_golden_validate_test',
      directories: { single_character: 'single-character' },
      samples: [
        {
          id: 'misnamed_sample',
          file: 'single-character/misnamed.png',
          kind: 'single_character',
          profile: 'quality_character_v0',
          source_rights: 'test_generated',
          expected_checks: ['extension_mismatch'],
        },
      ],
    }, null, 2)
  )

  const result = await runCli([
    'benchmark',
    'local-images-validate',
    '--manifest',
    manifestPath,
  ])

  assert.equal(result.command, 'benchmark local-images-validate')
  assert.equal(result.status, 'fail')
  assert.equal(result.errors, 1)
  assert.equal(result.issues.some((item) => item.code === 'sample.file_extension_mismatch'), true)
})

test('character pack CLI benchmark local-images-validate rejects local-only source rights', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'character-pack-cli-local-images-source-rights-'))
  const fixtureRoot = path.join(root, 'fixtures')
  await mkdir(path.join(fixtureRoot, 'single-character'), { recursive: true })
  const image = { width: 32, height: 32, data: new Uint8ClampedArray(32 * 32 * 4) }
  paintRect(image, { x: 8, y: 6, w: 16, h: 20 }, [80, 90, 200, 255])
  await writeFile(path.join(fixtureRoot, 'single-character', 'local_only.png'), await encodeRgbaPng(image))
  const manifestPath = path.join(fixtureRoot, 'manifest.json')
  await writeFile(
    manifestPath,
    JSON.stringify({
      schema_version: 1,
      fixture_set: 'local_image_source_rights_test',
      directories: { single_character: 'single-character' },
      samples: [
        {
          id: 'local_only_sample',
          file: 'single-character/local_only.png',
          kind: 'single_character',
          profile: 'quality_character_v0',
          source_rights: 'user_provided_local',
          expected_checks: ['repository_safety'],
        },
      ],
    }, null, 2)
  )

  const result = await runCli([
    'benchmark',
    'local-images-validate',
    '--manifest',
    manifestPath,
  ])

  assert.equal(result.command, 'benchmark local-images-validate')
  assert.equal(result.status, 'fail')
  assert.equal(result.issues.some((item) => item.code === 'sample.source_rights_not_repository_safe'), true)
})

test('character pack CLI benchmark local-images-add copies one image and fixes destination extension', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'character-pack-cli-local-images-add-'))
  const fixtureRoot = path.join(root, 'fixtures')
  await mkdir(path.join(fixtureRoot, 'single-character'), { recursive: true })
  const manifestPath = path.join(fixtureRoot, 'manifest.json')
  await writeFile(
    manifestPath,
    JSON.stringify({
      schema_version: 1,
      fixture_set: 'local_image_golden_add_test',
      directories: { single_character: 'single-character' },
      samples: [],
    }, null, 2)
  )
  const image = { width: 40, height: 40, data: new Uint8ClampedArray(40 * 40 * 4) }
  paintRect(image, { x: 12, y: 8, w: 16, h: 24 }, [180, 90, 60, 255])
  const inputPath = path.join(root, 'warrior_source.png')
  await writeFile(inputPath, await encodeRgbaJpeg(image))

  const result = await runCli([
    'benchmark',
    'local-images-add',
    '--manifest',
    manifestPath,
    '--input',
    inputPath,
    '--id',
    'single_warrior_concept',
    '--kind',
    'single_character',
    '--profile',
    'quality_character_v0',
    '--source-rights',
    'test_generated',
    '--expected-check',
    'baseline_quality',
    '--notes',
    'jpeg content with misleading input extension',
  ])

  assert.equal(result.command, 'benchmark local-images-add')
  assert.equal(result.sample.file, 'single-character/single_warrior_concept.jpg')
  assert.equal(result.sample.image.format, 'jpeg')
  assert.equal(result.sample.image.width, 40)
  assert.equal(result.sample.image.height, 40)
  assert.match(result.sample.sha256, /^[a-f0-9]{64}$/)
  assert.equal(await exists(path.join(fixtureRoot, result.sample.file)), true)
  assert.equal(result.validation.status, 'pass')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  assert.equal(manifest.samples[0].file, 'single-character/single_warrior_concept.jpg')
})

test('character pack CLI benchmark scene-tile-report summarizes explicit scene dirs', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'character-pack-cli-scene-report-'))
  const sceneDir = path.join(root, 'scene_pack')
  const outputDir = path.join(root, 'reports')
  await mkdir(sceneDir)
  await writeFile(
    path.join(sceneDir, 'quality_gate.json'),
    JSON.stringify({
      status: 'warning',
      warnings: ['tile.duplicate_runtime_tile'],
      blocking_errors: [],
      gates: [
        { id: 'metadata_seams', status: 'pass' },
        { id: 'tile_distinctness', status: 'warning' },
      ],
      failure_taxonomy: [
        { category: 'tile.duplicate_runtime_tile', count: 1, examples: ['mask_1 ~= mask_2'] },
      ],
    }, null, 2)
  )

  const result = await runCli([
    'benchmark',
    'scene-tile-report',
    '--scene-dir',
    sceneDir,
    '--output-dir',
    outputDir,
    '--run-id',
    'cli_scene_report',
  ])

  assert.equal(result.command, 'benchmark scene-tile-report')
  assert.equal(result.run_id, 'cli_scene_report')
  assert.equal(result.total, 1)
  assert.equal(result.validation.warning, 1)
  assert.equal(result.usable_rate, 1)
  assert.equal(result.gates.find((gate) => gate.id === 'tile_distinctness').warning, 1)
  assert.equal(result.failure_taxonomy.top_categories[0].id, 'tile.duplicate_runtime_tile')
  assert.equal(result.correction_dependency.dependency_level, 'low')
  assert.equal(result.correction_dependency.corrected_item_count, 0)
  assert.equal(await exists(path.join(outputDir, 'cli_scene_report', 'scene_tile_report.json')), true)
  assert.equal(await exists(path.join(outputDir, 'cli_scene_report', 'scene_tile_report.md')), true)
})

test('character pack CLI benchmark scene-tile-correction-matrix compares raw and corrected variants', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'character-pack-cli-scene-matrix-'))
  const input = path.join(root, 'scene.png')
  const outputDir = path.join(root, 'matrix')
  await writeFile(input, await encodeRgbaPng(makeSceneTileSheet()))

  const result = await runCli([
    'benchmark',
    'scene-tile-correction-matrix',
    '--input',
    input,
    '--id',
    'forest_case',
    '--output-dir',
    outputDir,
    '--run-id',
    'cli_scene_matrix',
    '--width',
    '2',
    '--height',
    '2',
    '--pattern',
    'solid',
  ])

  assert.equal(result.command, 'benchmark scene-tile-correction-matrix')
  assert.equal(result.run_id, 'cli_scene_matrix')
  assert.equal(result.input_count, 1)
  assert.equal(result.total_items, 3)
  assert.deepEqual(result.by_variant.map((variant) => variant.id), ['raw', 'style_snap', 'style_snap_edge_aware'])
  assert.equal(result.correction_dependency.corrected_item_count, 2)
  assert.equal(result.correction_dependency.uncorrected_item_count, 1)
  assert.equal(result.raw_quality_readiness.status, 'ready')
  assert.equal(result.raw_quality_diagnostics.status, 'pass')
  assert.equal(result.transitions.raw_to_style_snap.same, 1)
  assert.equal(result.gate_transitions.raw_to_style_snap.find((gate) => gate.id === 'visual_seams').same, 1)
  assert.deepEqual(result.blocker_taxonomy_by_variant.find((item) => item.variant_id === 'raw').top_categories, [])
  assert.deepEqual(result.blocker_transitions.raw_to_style_snap, [])
  assert.equal(await exists(path.join(outputDir, 'cli_scene_matrix', 'scene_tile_correction_matrix.json')), true)
  assert.equal(await exists(path.join(outputDir, 'cli_scene_matrix', 'scene_tile_report.json')), true)
})

test('character pack CLI benchmark scene-tile-manual-prompts writes provider-free prompts', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'character-pack-cli-scene-manual-prompts-'))
  const result = await runCli([
    'benchmark',
    'scene-tile-manual-prompts',
    '--output-dir',
    outputDir,
    '--run-id',
    'manual_prompts',
    '--sample-size',
    '2',
  ])

  assert.equal(result.command, 'benchmark scene-tile-manual-prompts')
  assert.equal(result.prompt_contract.contract_version, 'scene_tile_prompt_contract_v0_6')
  assert.deepEqual(result.case_ids, ['mossy_forest_ground', 'dry_cliff_path'])
  assert.equal(await exists(path.join(outputDir, 'manual_prompts', 'manual_prompt_pack.json')), true)
  assert.equal(await exists(path.join(outputDir, 'manual_prompts', 'manual_handoff.md')), true)
  assert.match(await readFile(path.join(outputDir, 'manual_prompts', 'mossy_forest_ground', 'prompt.txt'), 'utf8'), /no unique edge marks/i)
  assert.match(await readFile(path.join(outputDir, 'manual_prompts', 'manual_handoff.md'), 'utf8'), /Do not save JPEG data with a \.png filename/i)
  assert.equal(result.handoff_file, path.join(outputDir, 'manual_prompts', 'manual_handoff.md'))
})

test('character pack CLI benchmark scene-tile-manual-retest reports missing v0.6 inputs', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'character-pack-cli-scene-manual-retest-missing-'))
  const inputDir = path.join(root, 'inputs')
  const outputDir = path.join(root, 'matrix')
  const result = await runCli([
    'benchmark',
    'scene-tile-manual-retest',
    '--input-dir',
    inputDir,
    '--output-dir',
    outputDir,
    '--run-id',
    'manual_retest_missing',
    '--sample-size',
    '2',
  ])

  assert.equal(result.command, 'benchmark scene-tile-manual-retest')
  assert.equal(result.status, 'missing_inputs')
  assert.equal(result.existing_input_count, 0)
  assert.equal(result.missing_input_count, 2)
  assert.deepEqual(result.missing_inputs.map((item) => item.expected_input_filename), [
    'mossy_forest_ground_192.png',
    'dry_cliff_path_192.png',
  ])
  assert.equal(await exists(path.join(outputDir, 'manual_retest_missing', 'manual_retest_status.json')), true)
})

test('character pack CLI benchmark scene-tile-manual-retest rejects invalid present inputs', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'character-pack-cli-scene-manual-retest-invalid-'))
  const inputDir = path.join(root, 'inputs')
  const outputDir = path.join(root, 'matrix')
  await mkdir(inputDir, { recursive: true })
  await writeFile(
    path.join(inputDir, 'mossy_forest_ground_192.png'),
    await sharp({
      create: {
        width: 1024,
        height: 1024,
        channels: 4,
        background: { r: 40, g: 90, b: 40, alpha: 1 },
      },
    }).jpeg().toBuffer()
  )

  const result = await runCli([
    'benchmark',
    'scene-tile-manual-retest',
    '--input-dir',
    inputDir,
    '--output-dir',
    outputDir,
    '--run-id',
    'manual_retest_invalid',
    '--sample-size',
    '1',
  ])

  assert.equal(result.command, 'benchmark scene-tile-manual-retest')
  assert.equal(result.status, 'invalid_inputs')
  assert.equal(result.existing_input_count, 1)
  assert.equal(result.missing_input_count, 0)
  assert.equal(result.invalid_input_count, 1)
  assert.deepEqual(result.invalid_inputs[0].blocking_errors, [
    'source_sheet_format_mismatch',
    'source_sheet_size_mismatch',
  ])
  assert.equal(result.invalid_inputs[0].actual_format, 'jpeg')
  assert.deepEqual(result.invalid_inputs[0].actual_size, { width: 1024, height: 1024 })
  assert.equal(await exists(path.join(outputDir, 'manual_retest_invalid', 'manual_retest_status.json')), true)
})

test('character pack CLI benchmark scene-tile-manual-retest runs matrix when v0.6 inputs exist', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'character-pack-cli-scene-manual-retest-ready-'))
  const inputDir = path.join(root, 'inputs')
  const outputDir = path.join(root, 'matrix')
  await mkdir(inputDir, { recursive: true })
  await writeFile(path.join(inputDir, 'mossy_forest_ground_192.png'), await encodeRgbaPng(makeSceneTileSheet()))

  const result = await runCli([
    'benchmark',
    'scene-tile-manual-retest',
    '--input-dir',
    inputDir,
    '--output-dir',
    outputDir,
    '--run-id',
    'manual_retest_ready',
    '--sample-size',
    '1',
    '--width',
    '2',
    '--height',
    '2',
    '--pattern',
    'solid',
  ])

  assert.equal(result.command, 'benchmark scene-tile-manual-retest')
  assert.equal(result.status, 'ready')
  assert.equal(result.input_count, 1)
  assert.equal(result.raw_quality_readiness.status, 'ready')
  assert.equal(result.raw_quality_diagnostics.status, 'pass')
  assert.equal(await exists(path.join(outputDir, 'manual_retest_ready', 'scene_tile_correction_matrix.json')), true)
  assert.equal(await exists(path.join(outputDir, 'manual_retest_ready', 'manual_retest_status.json')), true)
})

test('character pack CLI benchmark scene-tile-live-gate writes dry-run plan', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'character-pack-cli-scene-live-plan-'))
  const result = await runCli([
    'benchmark',
    'scene-tile-live-gate',
    '--dry-run-plan',
    '--output-dir',
    outputDir,
    '--run-id',
    'cli_scene_live_plan',
    '--sample-size',
    '2',
    '--candidate-count',
    '3',
    '--provider-preset',
    'scene-provider',
    '--image-size',
    '1K',
    '--style-snap',
    '--edge-condition',
  ], {
    env: {
      KEY_A: 'alpha',
      CHARACTER_PROVIDER_PRESETS: JSON.stringify([
        { id: 'scene-provider', apiKeyEnv: 'KEY_A', baseUrl: 'https://example.test/scene', model: 'model/scene' },
      ]),
      CHARACTER_DEFAULT_PROVIDER: 'scene-provider',
    },
  })

  const plan = JSON.parse(await readFile(path.join(outputDir, 'cli_scene_live_plan', 'live_gate_plan.json'), 'utf8'))

  assert.equal(result.command, 'benchmark scene-tile-live-gate')
  assert.equal(result.mode, 'dry_run_plan')
  assert.equal(result.estimated_provider_calls, 6)
  assert.equal(result.candidate_count, 3)
  assert.equal(result.provider_config.selected_preset_id, 'scene-provider')
  assert.equal(result.provider_config.provider, 'openrouter')
  assert.equal(result.provider_config.model, 'model/scene')
  assert.equal(result.provider_config.selected_available, true)
  assert.deepEqual(result.case_ids, ['mossy_forest_ground', 'dry_cliff_path'])
  assert.equal(result.gate_policy.raw_tile_quality, 'strict')
  assert.equal(plan.scene_options.candidate_count, 3)
  assert.equal(plan.provider_config.selected_preset_id, 'scene-provider')
  assert.equal(plan.provider_config.model, 'model/scene')
  assert.equal(plan.scene_options.gate_policy.raw_tile_quality, 'strict')
  assert.equal(plan.scene_options.style_correction.mode, 'palette_snap')
  assert.equal(plan.scene_options.edge_conditioning.mode, 'edge-aware-v1')
})

test('character pack CLI benchmark scene-tile-live-gate requires quota consent', async () => {
  const error = await runCliError([
    'benchmark',
    'scene-tile-live-gate',
    '--sample-size',
    '1',
  ])

  assert.match(error.stderr, /uses live provider quota/)
})

test('character pack CLI benchmark scene-tile-live-gate requires a provider call budget', async () => {
  const error = await runCliError([
    'benchmark',
    'scene-tile-live-gate',
    '--sample-size',
    '1',
    '--candidate-count',
    '2',
    '--yes',
  ])

  assert.match(error.stderr, /requires --max-provider-calls/)
  assert.match(error.stderr, /planned provider calls: 2/)
})

test('character pack CLI benchmark scene-tile-live-gate writes provider blocker evidence', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'character-pack-cli-scene-live-blocker-'))
  const outputDir = path.join(root, 'out')
  const provider = await startFailingImageProvider('The request is prohibited due to a violation of provider Terms Of Service.')
  t.after(() => provider.server.close())

  const error = await runCliError([
    'benchmark',
    'scene-tile-live-gate',
    '--output-dir',
    outputDir,
    '--run-id',
    'cli_scene_live_blocked',
    '--sample-size',
    '1',
    '--candidate-count',
    '1',
    '--provider-preset',
    'scene-provider',
    '--image-size',
    '1K',
    '--aspect-ratio',
    '1:1',
    '--max-provider-calls',
    '1',
    '--yes',
  ], {
    env: {
      KEY_A: 'alpha',
      CHARACTER_PROVIDER_PRESETS: JSON.stringify([
        { id: 'scene-provider', apiKeyEnv: 'KEY_A', baseUrl: provider.url, model: 'model/scene' },
      ]),
      CHARACTER_DEFAULT_PROVIDER: 'scene-provider',
    },
  })

  const runDir = path.join(outputDir, 'cli_scene_live_blocked')
  const blocker = JSON.parse(await readFile(path.join(runDir, 'live_gate_blocker.json'), 'utf8'))
  const plan = JSON.parse(await readFile(path.join(runDir, 'live_gate_plan.json'), 'utf8'))
  const review = JSON.parse(await readFile(path.join(runDir, 'live_gate_review.json'), 'utf8'))
  const reviewMarkdown = await readFile(path.join(runDir, 'live_gate_review.md'), 'utf8')

  assert.match(error.stderr, /prohibited/)
  assert.equal(provider.requests.length, 1)
  assert.equal(plan.estimated_provider_calls, 1)
  assert.equal(plan.provider_config.selected_preset_id, 'scene-provider')
  assert.equal(plan.provider_config.model, 'model/scene')
  assert.equal(blocker.mode, 'scene_tile_live_gate_blocker_v0')
  assert.equal(blocker.status, 'blocked_provider_access')
  assert.equal(blocker.blocker_category, 'provider_route_blocked')
  assert.equal(blocker.provider_config.selected_preset_id, 'scene-provider')
  assert.equal(blocker.provider_config.model, 'model/scene')
  assert.equal(blocker.recovery_runbook, 'docs/runbooks/scene-tile-strict-gate-readiness.md')
  assert.deepEqual(blocker.provider_call_budget, {
    planned_provider_calls: 1,
    max_provider_calls: 1,
    used_provider_calls: 1,
  })
  assert.deepEqual(blocker.case_ids, ['mossy_forest_ground'])
  assert.equal(review.mode, 'scene_tile_live_gate_review_v0')
  assert.equal(review.conclusion, 'provider_access_blocked_no_tile_quality_evidence')
  assert.equal(review.evidence_status.selected_candidate_distribution, 'unavailable')
  assert.equal(review.evidence_status.failed_candidate_taxonomy, 'unavailable')
  assert.equal(review.evidence_status.wfc_ldtk_decision_ready, false)
  assert.equal(review.planned_sample.candidate_count, 1)
  assert.equal(review.planned_sample.correction_path, 'none')
  assert.equal(review.decision.proceed_to_ldtk_auto_layer, false)
  assert.equal(review.decision.proceed_to_wfc_or_rule_expansion, false)
  assert.equal(review.decision.recovery_runbook, 'docs/runbooks/scene-tile-strict-gate-readiness.md')
  assert.equal(review.recovery_runbook, 'docs/runbooks/scene-tile-strict-gate-readiness.md')
  assert.match(reviewMarkdown, /Scene Tile Live Gate Review: cli_scene_live_blocked/)
  assert.match(reviewMarkdown, /Selected candidate distribution \| unavailable/)
  assert.match(reviewMarkdown, /docs\/runbooks\/scene-tile-strict-gate-readiness\.md/)
})

test('character pack CLI benchmark scene-tile-live-gate writes report from provider output', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'character-pack-cli-scene-live-gate-'))
  const outputDir = path.join(root, 'out')
  const providerPng = await encodeRgbaPng(makeSceneTileSheet())
  const provider = await startMockImageProvider(providerPng)
  t.after(() => provider.server.close())

  const result = await runCli([
    'benchmark',
    'scene-tile-live-gate',
    '--output-dir',
    outputDir,
    '--run-id',
    'cli_scene_live_gate',
    '--sample-size',
    '2',
    '--candidate-count',
    '2',
    '--provider-preset',
    'scene-provider',
    '--image-size',
    '1K',
    '--aspect-ratio',
    '1:1',
    '--pattern',
    'solid',
    '--style-snap',
    '--style-max-colors',
    '2',
    '--max-provider-calls',
    '4',
    '--yes',
  ], {
    env: {
      KEY_A: 'alpha',
      CHARACTER_PROVIDER_PRESETS: JSON.stringify([
        { id: 'scene-provider', apiKeyEnv: 'KEY_A', baseUrl: provider.url, model: 'model/scene' },
      ]),
      CHARACTER_DEFAULT_PROVIDER: 'scene-provider',
    },
  })

  const runDir = path.join(outputDir, 'cli_scene_live_gate')

  assert.equal(result.command, 'benchmark scene-tile-live-gate')
  assert.equal(result.mode, 'live')
  assert.equal(result.total, 2)
  assert.equal(result.sample_size, 2)
  assert.equal(result.candidate_count, 2)
  assert.equal(result.estimated_provider_calls, 4)
  assert.equal(result.provider_config.selected_preset_id, 'scene-provider')
  assert.equal(result.provider_config.model, 'model/scene')
  assert.deepEqual(result.provider_call_budget, {
    planned_provider_calls: 4,
    max_provider_calls: 4,
    used_provider_calls: 4,
  })
  assert.equal(result.validation.pass, 2)
  assert.equal(result.usable_rate, 1)
  assert.equal(result.gate_policy.raw_tile_quality.strict, 2)
  assert.equal(result.correction_paths.find((item) => item.label === 'style:palette_snap')?.count, 2)
  assert.equal(provider.requests.length, 4)
  assert.equal(provider.requests[0].model, 'model/scene')
  assert.equal(await exists(path.join(runDir, 'live_gate_plan.json')), true)
  const plan = JSON.parse(await readFile(path.join(runDir, 'live_gate_plan.json'), 'utf8'))
  assert.equal(plan.provider_config.selected_preset_id, 'scene-provider')
  assert.equal(plan.provider_config.model, 'model/scene')
  assert.equal(await exists(path.join(runDir, 'scene_tile_report.json')), true)
  assert.equal(await exists(path.join(runDir, 'scene_tile_report.md')), true)
  assert.equal(await exists(path.join(runDir, 'items', 'mossy_forest_ground_v1', 'scene_pack.zip')), true)
  assert.equal(await exists(path.join(runDir, 'items', 'dry_cliff_path_v1', 'quality_gate.json')), true)
  assert.equal(await exists(path.join(runDir, 'items', 'dry_cliff_path_v1', 'candidate_selection.json')), true)
  assert.equal(await exists(path.join(runDir, 'items', 'dry_cliff_path_v1', 'candidates', 'candidate_02', 'quality_gate.json')), true)
})

test('character pack CLI benchmark openrouter-recompute-report rewrites summary and markdown without provider quota', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'character-pack-cli-openrouter-recompute-'))
  const reportPath = path.join(root, 'benchmark_report.json')
  const outputDir = path.join(root, 'recomputed')
  await writeFile(
    reportPath,
    JSON.stringify({
      schema_version: 1,
      run_id: 'old_ocad_run',
      created_at: '2026-06-01T00:00:00.000Z',
      preset: LEGACY_OCAD_MOTION_LAYOUT_ID,
      template_file: 'fixed_region_motion_template_v1.png',
      image_config: { image_size: '1K', aspect_ratio: '1:1' },
      cases: [{ id: 'blue_wizard', description: 'blue wizard' }],
      variants_per_case: 1,
      summary: {
        total: 1,
        validation: { pass: 0, warning: 1, fail: 0, unknown: 0 },
        failures: { total: 0, model_error: 0, post_processing: 0, unexpected_error: 0 },
        pass_rate: 0,
        usable_rate: 1,
        failure_taxonomy: {
          top_categories: [{ id: 'motion.duplicate_frames', severity: 'warning', count: 9, examples: ['duplicate_frames'] }],
        },
      },
      items: [
        {
          case: { id: 'blue_wizard', description: 'blue wizard' },
          variant: 1,
          status: 'done',
          validation: { status: 'warning', warnings: ['source_region_edge_pressure_high'], blocking_errors: [] },
          quality: {
            halo_score: 0,
            duplicate_group_count: 9,
            duplicate_expected_source_reuse_count: 9,
            duplicate_unexpected_group_count: 0,
          },
          failure_taxonomy: {
            primary: 'motion.duplicate_frames',
            severity: 'warning',
            categories: [
              { id: 'motion.duplicate_frames', severity: 'warning', count: 9, examples: ['duplicate_frames'] },
              { id: 'layout.source_region_edge_pressure', severity: 'warning', count: 1, examples: ['source_region_edge_pressure_high'] },
            ],
          },
        },
      ],
    }, null, 2)
  )

  const result = await runCli([
    'benchmark',
    'openrouter-recompute-report',
    '--report',
    reportPath,
    '--output-dir',
    outputDir,
    '--run-id',
    'ocad_recomputed',
  ])

  const savedReportPath = path.join(outputDir, 'ocad_recomputed', 'benchmark_report.json')
  const savedMarkdownPath = path.join(outputDir, 'ocad_recomputed', 'benchmark_report.md')
  const saved = JSON.parse(await readFile(savedReportPath, 'utf8'))
  const markdown = await readFile(savedMarkdownPath, 'utf8')

  assert.equal(result.command, 'benchmark openrouter-recompute-report')
  assert.equal(result.source_run_id, 'old_ocad_run')
  assert.equal(result.run_id, 'ocad_recomputed')
  assert.equal(result.quality_gate.status, 'pass')
  assert.equal(result.quality_gate.preset, FIXED_REGION_MOTION_LAYOUT_ID)
  assert.equal(result.quality_gate.gates.find((item) => item.id === 'motion_duplicate_frames').status, 'pass')
  assert.equal(saved.summary.failure_taxonomy.top_categories.some((item) => item.id === 'motion.duplicate_frames'), false)
  assert.equal(saved.items[0].failure_taxonomy.primary, 'layout.source_region_edge_pressure')
  assert.match(markdown, /Expected reuse/)
  assert.match(markdown, /Unexpected dupes/)
  assert.doesNotMatch(markdown, /\| Case \| Variant \| Status \| Validation \| Taxonomy \| Halo \| Duplicates \| Failure \|/)
})

test('character pack CLI benchmark topdown quality closure dry-run prints matrix plan', async () => {
  const result = await runCli([
    'benchmark',
    'topdown-quality-closure',
    '--dry-run-plan',
    '--run-id',
    'cli_topdown_quality',
    '--case-id',
    'frog_knight',
    '--case-id',
    'blue_wizard',
    '--image-size',
    '1K',
    '--image-size',
    '2K',
  ])

  assert.equal(result.command, 'benchmark topdown-quality-closure')
  assert.equal(result.mode, 'dry_run_plan')
  assert.equal(result.run_id, 'cli_topdown_quality')
  assert.deepEqual(result.case_ids, ['frog_knight', 'blue_wizard'])
  assert.deepEqual(result.image_sizes, ['1K', '2K'])
  assert.deepEqual(result.runs.map((run) => run.run_id), ['cli_topdown_quality_1k', 'cli_topdown_quality_2k'])
})

test('character pack CLI benchmark topdown repair plan summarizes an existing report', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'character-pack-cli-repair-plan-'))
  const reportPath = path.join(root, 'benchmark_report.json')
  await writeFile(
    reportPath,
    JSON.stringify({
      run_id: 'openrouter_bench_repair',
      preset: 'topdown_rpg_v0',
      items: [
        {
          case: { id: 'frog_knight' },
          variant: 1,
          validation: { status: 'fail', blocking_errors: ['frame_6_empty', 'frame_24_cropped'], warnings: [] },
        },
        {
          case: { id: 'blue_wizard' },
          variant: 1,
          validation: { status: 'fail', blocking_errors: ['frame_6_empty'], warnings: [] },
        },
      ],
    })
  )

  const result = await runCli(['benchmark', 'topdown-repair-plan', '--report', reportPath])

  assert.equal(result.command, 'benchmark topdown-repair-plan')
  assert.equal(result.run_id, 'openrouter_bench_repair')
  assert.equal(result.summary.issue_count, 3)
  assert.deepEqual(result.summary.by_issue, { empty_frame: 2, cropped_frame: 1 })
  assert.deepEqual(result.summary.top_frames.slice(0, 2), [
    { frame: 6, count: 2 },
    { frame: 24, count: 1 },
  ])
})

test('character pack CLI benchmark topdown repair manifest emits provider-ready repair tasks', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'character-pack-cli-repair-manifest-'))
  const reportPath = path.join(root, 'benchmark_report.json')
  await writeFile(
    reportPath,
    JSON.stringify({
      run_id: 'openrouter_bench_repair_manifest',
      preset: 'topdown_rpg_v0',
      provider_preset_id: 'openrouter-gemini-image',
      template_file: 'motion_template_ocha_8x8.png',
      image_config: { image_size: '2K', aspect_ratio: '1:1' },
      items: [
        {
          case: {
            id: 'frog_knight',
            description: 'a tiny frog knight with a round shield and leaf cape',
          },
          variant: 1,
          artifacts: {
            dir: 'generated/openrouter-benchmarks/openrouter_bench_repair_manifest/items/frog_knight_v1',
          },
          generation: {
            prompt_contract: { contract_version: 'character_prompt_contract_v1_3', layout_id: 'topdown_rpg_v0' },
          },
          validation: { status: 'fail', blocking_errors: ['frame_6_empty', 'frame_24_cropped'], warnings: [] },
        },
      ],
    })
  )

  const result = await runCli(['benchmark', 'topdown-repair-manifest', '--report', reportPath])

  assert.equal(result.command, 'benchmark topdown-repair-manifest')
  assert.equal(result.run_id, 'openrouter_bench_repair_manifest')
  assert.equal(result.summary.task_count, 2)
  assert.equal(result.tasks[0].task_id, 'frog_knight_v1_frame_6_empty')
  assert.deepEqual(result.tasks[0].target.rect, { x: 576, y: 0, w: 96, h: 96 })
  assert.match(result.tasks[0].provider_payload.prompt, /Repair exactly one topdown_rpg_v0 cell/)
  assert.equal(result.tasks[1].provider_payload.image_config.image_size, '2K')

  const summary = await runCli(['benchmark', 'topdown-repair-manifest', '--report', reportPath, '--summary-only'])
  assert.equal(summary.command, 'benchmark topdown-repair-manifest')
  assert.equal(summary.run_id, 'openrouter_bench_repair_manifest')
  assert.equal(summary.summary.task_count, 2)
  assert.equal(summary.tasks, undefined)
})

test('character pack CLI benchmark quality closure repair manifest writes provider-free task plan', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'character-pack-cli-quality-closure-repair-'))
  const itemDir = path.join(root, 'items', 'village_elder_v1')
  await mkdir(itemDir, { recursive: true })
  const debugReportPath = path.join(itemDir, 'debug_report.json')
  await writeFile(debugReportPath, JSON.stringify({
    profile: 'topdown_rpg_v0',
    validation: {
      status: 'warning',
      warnings: ['walk_left_low_motion'],
      blocking_errors: [],
    },
    frames: [
      {
        index: 24,
        runtime_action: 'walk_left',
        source_frame: { layout: 'topdown_rpg_v0', row: 3, col: 0, rect: { x: 0, y: 0, w: 192, h: 192 } },
        normalized_bbox: { x: 34, y: 30, w: 28, h: 58, right: 61, bottom: 87 },
        normalized_anchor: TOPDOWN_RPG_V0.anchor,
        warnings: [],
      },
      {
        index: 25,
        runtime_action: 'walk_left',
        source_frame: { layout: 'topdown_rpg_v0', row: 3, col: 1, rect: { x: 192, y: 0, w: 192, h: 192 } },
        normalized_bbox: { x: 34, y: 30, w: 28, h: 58, right: 61, bottom: 87 },
        normalized_anchor: TOPDOWN_RPG_V0.anchor,
        warnings: [],
      },
    ],
    quality_closure: {
      mode: CHARACTER_QUALITY_CLOSURE_MODE,
      status: 'warning',
      release_ready: false,
      repair_tasks: [
        {
          id: 'local_halo_cleanup',
          provider_required: false,
          action: 'local_halo_cleanup',
          frames: [24],
          rationale: 'near-white edge pixels remain',
        },
        {
          id: 'repair_semantic_side_walk_left',
          provider_required: true,
          action: 'semantic_frame_repair',
          animation: 'walk_left',
          frames: [24, 25],
          rationale: 'held prop or accessory appears to switch sides inside the animation group',
        },
      ],
    },
  }))

  const outputDir = path.join(root, 'repair-manifest')
  const result = await runCli([
    'benchmark',
    'quality-closure-repair-manifest',
    '--debug-report',
    debugReportPath,
    '--item-id',
    'village_elder_v1',
    '--case-id',
    'village_elder',
    '--description',
    'an elderly village leader with a wooden cane',
    '--run-id',
    'quality_closure_repair_cli',
    '--output-dir',
    outputDir,
  ])

  assert.equal(result.command, 'benchmark quality-closure-repair-manifest')
  assert.equal(result.status, 'needs_repair')
  assert.equal(result.summary.task_count, 2)
  assert.equal(result.summary.local_task_count, 1)
  assert.equal(result.summary.provider_task_count, 1)
  assert.equal(result.summary.estimated_provider_calls, 1)
  assert.equal(result.tasks[1].target.animation, 'walk_left')
  assert.match(result.tasks[1].provider_payload.prompt, /Target animation: walk_left/)
  assert.equal(await exists(path.join(outputDir, 'quality_closure_repair_manifest.json')), true)
  assert.equal(await exists(path.join(outputDir, 'quality_closure_repair_manifest.md')), true)

  const summary = await runCli([
    'benchmark',
    'quality-closure-repair-manifest',
    '--debug-report',
    debugReportPath,
    '--item-id',
    'village_elder_v1',
    '--summary-only',
  ])
  assert.equal(summary.command, 'benchmark quality-closure-repair-manifest')
  assert.equal(summary.tasks, undefined)
  assert.equal(summary.summary.provider_task_count, 1)
})

test('character pack CLI benchmark quality closure repair loop applies local tasks and writes evidence', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'character-pack-cli-quality-closure-loop-'))
  const itemDir = path.join(root, 'items', 'village_elder_v1')
  await mkdir(itemDir, { recursive: true })
  await writeFile(path.join(itemDir, 'normalized_sheet.png'), await makeQualityClosureRepairTestSheetPng())
  const debugReportPath = path.join(itemDir, 'debug_report.json')
  await writeFile(debugReportPath, JSON.stringify({
    profile: 'topdown_rpg_v0',
    validation: {
      status: 'warning',
      warnings: ['frame_1_anchor_drift'],
      blocking_errors: [],
    },
    frames: Array.from({ length: 64 }, (_, index) => ({
      index,
      runtime_action: index >= 24 && index <= 27 ? 'walk_left' : null,
      source_frame: {
        layout: 'topdown_rpg_v0',
        row: Math.floor(index / TOPDOWN_RPG_V0.grid.columns),
        col: index % TOPDOWN_RPG_V0.grid.columns,
        rect: { x: 0, y: 0, w: 192, h: 192 },
      },
      normalized_bbox: null,
      normalized_anchor: null,
      warnings: [],
    })),
    quality_closure: {
      mode: CHARACTER_QUALITY_CLOSURE_MODE,
      status: 'warning',
      release_ready: false,
      repair_tasks: [
        {
          id: 'local_halo_cleanup',
          provider_required: false,
          action: 'local_halo_cleanup',
          frames: [0],
          rationale: 'near-white edge pixels remain',
        },
        {
          id: 'local_anchor_stabilization',
          provider_required: false,
          action: 'local_anchor_stabilization',
          frames: [1],
          animations: [],
          rationale: 'frame anchor drift remains',
        },
        {
          id: 'repair_semantic_side_walk_left',
          provider_required: true,
          action: 'semantic_frame_repair',
          animation: 'walk_left',
          frames: [24, 25, 26, 27],
          rationale: 'held prop or accessory appears to switch sides inside the animation group',
        },
      ],
    },
  }))

  const manifestDir = path.join(root, 'repair-manifest')
  const manifestResult = await runCli([
    'benchmark',
    'quality-closure-repair-manifest',
    '--debug-report',
    debugReportPath,
    '--item-id',
    'village_elder_v1',
    '--case-id',
    'village_elder',
    '--run-id',
    'quality_closure_loop_cli',
    '--output-dir',
    manifestDir,
  ])
  const manifestPath = manifestResult.artifacts.manifest_json
  const dryRunDir = path.join(root, 'repair-loop-plan')
  const dryRun = await runCli([
    'benchmark',
    'quality-closure-repair-loop',
    '--manifest',
    manifestPath,
    '--dry-run-plan',
    '--output-dir',
    dryRunDir,
  ])
  assert.equal(dryRun.command, 'benchmark quality-closure-repair-loop')
  assert.equal(dryRun.mode, 'dry_run_plan')
  assert.equal(dryRun.local_task_count, 2)
  assert.equal(dryRun.provider_task_count, 1)
  assert.equal(dryRun.estimated_provider_calls, 1)
  assert.equal(await exists(path.join(dryRunDir, 'quality_closure_repair_loop_plan.json')), true)

  const outputDir = path.join(root, 'repair-loop-run')
  const result = await runCli([
    'benchmark',
    'quality-closure-repair-loop',
    '--manifest',
    manifestPath,
    '--output-dir',
    outputDir,
  ])
  const report = JSON.parse(await readFile(path.join(outputDir, 'quality_closure_repair_report.json'), 'utf8'))

  assert.equal(result.command, 'benchmark quality-closure-repair-loop')
  assert.equal(result.mode, 'provider_free_local_repair')
  assert.equal(result.summary.local_task_count, 2)
  assert.equal(result.summary.local_applied_count, 2)
  assert.equal(result.provider_dry_run.task_count, 1)
  assert.ok(result.local_target_results.some((item) => item.action === 'local_halo_cleanup' && item.resolved))
  assert.ok(result.local_target_results.some((item) => item.action === 'local_anchor_stabilization' && item.resolved))
  assert.equal(await exists(path.join(outputDir, 'quality_closure_before_after.png')), true)
  assert.equal(await exists(path.join(outputDir, 'quality_closure_repair_report.md')), true)
  assert.equal(await exists(path.join(outputDir, 'village_elder_v1', 'repaired_normalized_sheet.png')), true)
  assert.equal(await exists(report.provider_dry_run.tasks[0].files.prompt), true)
  assert.equal(await exists(report.provider_dry_run.tasks[0].files.contract), true)
})

test('character pack CLI benchmark quality closure provider handoff selects one prompt task', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'character-pack-cli-quality-closure-provider-handoff-'))
  const manifestPath = path.join(root, 'quality_closure_repair_manifest.json')
  const frames = [24, 25, 26, 27].map((frame) => ({
    frame,
    animation: 'walk_left',
    row: Math.floor(frame / TOPDOWN_RPG_V0.grid.columns),
    col: frame % TOPDOWN_RPG_V0.grid.columns,
    rect: {
      x: (frame % TOPDOWN_RPG_V0.grid.columns) * TOPDOWN_RPG_V0.frame.w,
      y: Math.floor(frame / TOPDOWN_RPG_V0.grid.columns) * TOPDOWN_RPG_V0.frame.h,
      w: TOPDOWN_RPG_V0.frame.w,
      h: TOPDOWN_RPG_V0.frame.h,
    },
  }))
  await writeFile(manifestPath, JSON.stringify({
    schema_version: 1,
    mode: 'character_quality_closure_repair_manifest_v1',
    run_id: 'quality_closure_provider_handoff_cli',
    preset: 'topdown_rpg_v0',
    tasks: [
      {
        task_id: 'village_elder_v1_repair_semantic_side_walk_left',
        item_id: 'village_elder_v1',
        provider_required: true,
        action: 'semantic_frame_repair',
        issue: { type: 'prop_side_flip_suspected' },
        target: { animation: 'walk_left', frames },
        artifacts: { normalized_sheet: path.join(root, 'items', 'village_elder_v1', 'normalized_sheet.png') },
        provider_payload: { prompt: 'Repair walk_left', output: { cell_count: 4, cell_width: 96, cell_height: 96 } },
      },
    ],
  }, null, 2))

  const outputDir = path.join(root, 'provider-handoff')
  const result = await runCli([
    'benchmark',
    'quality-closure-provider-handoff',
    '--manifest',
    manifestPath,
    '--output-dir',
    outputDir,
  ])

  assert.equal(result.command, 'benchmark quality-closure-provider-handoff')
  assert.equal(result.selected_task_id, 'village_elder_v1_repair_semantic_side_walk_left')
  assert.equal(result.selected_animation, 'walk_left')
  assert.equal(await exists(path.join(outputDir, 'quality_closure_provider_handoff.json')), true)
  assert.equal(await exists(path.join(outputDir, 'quality_closure_provider_handoff.md')), true)
  assert.equal(await exists(path.join(outputDir, 'selected_prompt.txt')), true)
  assert.equal(await exists(path.join(outputDir, 'selected_provider_contract.json')), true)
  assert.match(await readFile(path.join(outputDir, 'selected_prompt.txt'), 'utf8'), /384x96px/)
})

test('character pack CLI benchmark quality closure apply provider repair writes repaired sheet and report', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'character-pack-cli-quality-closure-provider-apply-'))
  const itemDir = path.join(root, 'items', 'village_elder_v1')
  await mkdir(itemDir, { recursive: true })
  await writeFile(path.join(itemDir, 'normalized_sheet.png'), await makeSemanticRepairTestSheetPng())
  const stripPath = path.join(root, 'walk_left_repair_strip.png')
  await writeFile(stripPath, await makeSemanticRepairStripPng([24, 25, 26, 27]))
  const manifestPath = path.join(root, 'quality_closure_repair_manifest.json')
  await writeFile(manifestPath, JSON.stringify({
    schema_version: 1,
    mode: 'character_quality_closure_repair_manifest_v1',
    run_id: 'quality_closure_provider_apply_cli',
    preset: 'topdown_rpg_v0',
    status: 'needs_repair',
    release_ready: false,
    summary: { task_count: 1, provider_task_count: 1, local_task_count: 0, estimated_provider_calls: 1 },
    blockers: [],
    tasks: [
      {
        schema_version: 1,
        task_id: 'village_elder_v1_repair_semantic_side_walk_left',
        item_id: 'village_elder_v1',
        preset: 'topdown_rpg_v0',
        stage: 'provider',
        provider_required: true,
        action: 'semantic_frame_repair',
        issue: { type: 'prop_side_flip_suspected', source_action: 'semantic_frame_repair' },
        target: {
          animation: 'walk_left',
          frames: [24, 25, 26, 27].map((frame) => ({
            frame,
            animation: 'walk_left',
            rect: {
              x: (frame % TOPDOWN_RPG_V0.grid.columns) * TOPDOWN_RPG_V0.frame.w,
              y: Math.floor(frame / TOPDOWN_RPG_V0.grid.columns) * TOPDOWN_RPG_V0.frame.h,
              w: TOPDOWN_RPG_V0.frame.w,
              h: TOPDOWN_RPG_V0.frame.h,
            },
          })),
        },
        artifacts: {
          dir: itemDir,
          normalized_sheet: path.join(itemDir, 'normalized_sheet.png'),
        },
      },
    ],
  }, null, 2))

  const outputDir = path.join(root, 'provider-apply-output')
  const result = await runCli([
    'benchmark',
    'quality-closure-apply-provider-repair',
    '--manifest',
    manifestPath,
    '--repair',
    `village_elder_v1_repair_semantic_side_walk_left=${stripPath}`,
    '--output-dir',
    outputDir,
  ])

  assert.equal(result.command, 'benchmark quality-closure-apply-provider-repair')
  assert.equal(result.summary.repair_count, 1)
  assert.equal(result.summary.resolved_count, 1)
  assert.equal(result.items[0].semantic_target_results[0].resolved, true)
  assert.equal(result.items[0].files.row_gif_count, 16)
  assert.equal(await exists(path.join(outputDir, 'village_elder_v1', 'repaired_normalized_sheet.png')), true)
  assert.equal(await exists(path.join(outputDir, 'village_elder_v1', 'quality_closure_provider_repair_report.json')), true)
  assert.equal(await exists(path.join(outputDir, 'village_elder_v1', 'quality_closure_provider_repair_report.md')), true)
  assert.equal(await exists(path.join(outputDir, 'village_elder_v1', 'walk_left.gif')), true)
})

test('character pack CLI benchmark quality closure provider repair loop writes dry-run references and live repair output', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'character-pack-cli-quality-provider-repair-loop-'))
  const itemDir = path.join(root, 'items', 'village_elder_v1')
  await mkdir(itemDir, { recursive: true })
  await writeFile(path.join(itemDir, 'normalized_sheet.png'), await makeSemanticRepairTestSheetPng())
  const frames = [24, 25, 26, 27].map((frame) => ({
    frame,
    row: Math.floor(frame / TOPDOWN_RPG_V0.grid.columns),
    col: frame % TOPDOWN_RPG_V0.grid.columns,
    animation: 'walk_left',
    rect: {
      x: (frame % TOPDOWN_RPG_V0.grid.columns) * TOPDOWN_RPG_V0.frame.w,
      y: Math.floor(frame / TOPDOWN_RPG_V0.grid.columns) * TOPDOWN_RPG_V0.frame.h,
      w: TOPDOWN_RPG_V0.frame.w,
      h: TOPDOWN_RPG_V0.frame.h,
    },
  }))
  const manifestPath = path.join(root, 'quality_closure_repair_manifest.json')
  await writeFile(manifestPath, JSON.stringify({
    schema_version: 1,
    mode: 'character_quality_closure_repair_manifest_v1',
    run_id: 'quality_closure_provider_repair_loop_cli',
    preset: 'topdown_rpg_v0',
    provider_preset_id: 'repair-provider',
    tasks: [
      {
        schema_version: 1,
        task_id: 'village_elder_v1_repair_semantic_side_walk_left',
        item_id: 'village_elder_v1',
        preset: 'topdown_rpg_v0',
        stage: 'provider',
        provider_required: true,
        action: 'semantic_frame_repair',
        issue: { type: 'prop_side_flip_suspected', source_action: 'semantic_frame_repair' },
        target: { animation: 'walk_left', frames },
        artifacts: {
          dir: itemDir,
          normalized_sheet: path.join(itemDir, 'normalized_sheet.png'),
        },
        provider_payload: {
          prompt: 'Repair walk_left semantic side consistency.',
          image_config: { image_size: '1K', aspect_ratio: '1:1' },
        },
      },
    ],
  }, null, 2))

  const dryRunDir = path.join(root, 'provider-repair-loop-dry-run')
  const dryRun = await runCli([
    'benchmark',
    'quality-closure-provider-repair-loop',
    '--manifest',
    manifestPath,
    '--dry-run-plan',
    '--output-dir',
    dryRunDir,
  ])
  assert.equal(dryRun.command, 'benchmark quality-closure-provider-repair-loop')
  assert.equal(dryRun.mode, 'dry_run_plan')
  assert.equal(dryRun.can_run, true)
  assert.equal(dryRun.estimated_provider_calls, 1)
  assert.equal(dryRun.motion_template.enabled, true)
  assert.equal(dryRun.motion_template.preset, 'fixed_region_motion_v0')
  assert.equal(await exists(path.join(dryRunDir, 'motion_template_reference.png')), true)
  assert.equal(await exists(path.join(dryRunDir, 'selected_prompt.txt')), true)
  assert.equal(await exists(path.join(dryRunDir, 'normalized_sheet_reference.png')), true)
  assert.equal(await exists(path.join(dryRunDir, 'target_animation_reference.png')), true)
  assert.match(await readFile(path.join(dryRunDir, 'selected_prompt.txt'), 'utf8'), /Target facing direction: left/)
  assert.match(await readFile(path.join(dryRunDir, 'selected_prompt.txt'), 'utf8'), /Motion template action strip/)

  const provider = await startMockImageProvider(await makeSemanticRepairStripPng([24, 25, 26, 27]))
  try {
    const liveDir = path.join(root, 'provider-repair-loop-live')
    const result = await runCli([
      'benchmark',
      'quality-closure-provider-repair-loop',
      '--manifest',
      manifestPath,
      '--provider-preset',
      'repair-provider',
      '--output-dir',
      liveDir,
      '--yes',
    ], {
      env: {
        KEY_A: 'alpha',
        CHARACTER_PROVIDER_PRESETS: JSON.stringify([
          { id: 'repair-provider', apiKeyEnv: 'KEY_A', baseUrl: provider.url, model: 'model/repair', image_size: '1K' },
        ]),
      },
    })

    assert.equal(result.command, 'benchmark quality-closure-provider-repair-loop')
    assert.match(result.status, /^(passed|partial)$/)
    assert.equal(result.summary.generated_count, 1)
    assert.equal(result.summary.resolved_target_count, 1)
    assert.equal(provider.requests.length, 1)
    assert.equal(provider.requests[0].messages[0].content.length, 4)
    assert.match(provider.requests[0].messages[0].content[0].text, /no duplicated arms or hands/)
    assert.match(provider.requests[0].messages[0].content[0].text, /Follow the motion template/)
    assert.equal(await exists(path.join(liveDir, 'motion_template_reference.png')), true)
    assert.equal(await exists(path.join(liveDir, 'raw_provider_repair_output.png')), true)
    assert.equal(await exists(path.join(liveDir, 'repaired_animation_strip.png')), true)
    assert.equal(await exists(path.join(liveDir, 'village_elder_v1', 'repaired_normalized_sheet.png')), true)
    assert.equal(await exists(path.join(liveDir, 'village_elder_v1', 'walk_left.gif')), true)
  } finally {
    provider.server.close()
  }
})

test('character pack CLI benchmark topdown generate repair cell writes dry-run prompt', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'character-pack-cli-generate-repair-cell-'))
  const reportPath = path.join(root, 'benchmark_report.json')
  await writeFile(
    reportPath,
    JSON.stringify({
      run_id: 'topdown_generate_repair_cell_test',
      preset: 'topdown_rpg_v0',
      items: [
        {
          case: { id: 'frog_knight', description: 'a tiny frog knight' },
          variant: 1,
          validation: { status: 'fail', blocking_errors: ['frame_40_cropped'], warnings: [] },
        },
      ],
    })
  )

  const outputDir = path.join(root, 'repair-cell-output')
  const result = await runCli([
    'benchmark',
    'topdown-generate-repair-cell',
    '--report',
    reportPath,
    '--task-id',
    'frog_knight_v1_frame_40_cropped',
    '--dry-run-prompt',
    '--output-dir',
    outputDir,
  ])

  assert.equal(result.command, 'benchmark topdown-generate-repair-cell')
  assert.equal(result.mode, 'dry_run_prompt')
  assert.equal(result.task_id, 'frog_knight_v1_frame_40_cropped')
  assert.equal(await exists(path.join(outputDir, 'prompt.txt')), true)
  assert.equal(await exists(path.join(outputDir, 'repair_generation.json')), true)
})

test('character pack CLI benchmark topdown repair loop writes dry-run preflight plan', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'character-pack-cli-repair-loop-plan-'))
  const itemDir = path.join(root, 'items', 'frog_knight_v1')
  await mkdir(itemDir, { recursive: true })
  const reportPath = path.join(root, 'benchmark_report.json')
  await writeFile(
    reportPath,
    JSON.stringify({
      run_id: 'topdown_repair_loop_plan_test',
      preset: 'topdown_rpg_v0',
      provider_preset_id: 'openrouter-gemini-image',
      image_config: { image_size: '1K', aspect_ratio: '1:1' },
      items: [
        {
          case: { id: 'frog_knight', description: 'a tiny frog knight' },
          variant: 1,
          artifacts: { dir: itemDir },
          validation: { status: 'fail', blocking_errors: ['frame_40_cropped', 'frame_41_cropped'], warnings: [] },
        },
      ],
    })
  )

  const outputDir = path.join(root, 'repair-loop-output')
  const args = [
    'benchmark',
    'topdown-repair-loop',
    '--report',
    reportPath,
    '--task-id',
    'frog_knight_v1_frame_40_cropped',
    '--task-id',
    'frog_knight_v1_frame_41_cropped',
    '--dry-run-plan',
    '--output-dir',
    outputDir,
  ]
  const result = await runCli(args)

  assert.equal(result.command, 'benchmark topdown-repair-loop')
  assert.equal(result.mode, 'dry_run_plan')
  assert.equal(result.can_run, true)
  assert.equal(result.estimated_provider_calls, 2)
  assert.deepEqual(result.task_ids, ['frog_knight_v1_frame_40_cropped', 'frog_knight_v1_frame_41_cropped'])
  assert.equal(await exists(path.join(outputDir, 'loop_plan.json')), true)
  const collision = await runCliError(args)
  assert.match(collision.stderr, /repair loop output collision/)
})

test('character pack CLI benchmark topdown repair loop requires dry-run plan or quota consent', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'character-pack-cli-repair-loop-quota-'))
  const itemDir = path.join(root, 'items', 'frog_knight_v1')
  await mkdir(itemDir, { recursive: true })
  const reportPath = path.join(root, 'benchmark_report.json')
  await writeFile(
    reportPath,
    JSON.stringify({
      run_id: 'topdown_repair_loop_quota_test',
      preset: 'topdown_rpg_v0',
      items: [
        {
          case: { id: 'frog_knight', description: 'a tiny frog knight' },
          variant: 1,
          artifacts: { dir: itemDir },
          validation: { status: 'fail', blocking_errors: ['frame_40_cropped'], warnings: [] },
        },
      ],
    })
  )

  const error = await runCliError([
    'benchmark',
    'topdown-repair-loop',
    '--report',
    reportPath,
    '--task-id',
    'frog_knight_v1_frame_40_cropped',
    '--output-dir',
    path.join(root, 'repair-loop-output'),
  ])

  assert.match(error.stderr, /uses live provider quota/)
})

test('character pack CLI benchmark topdown apply repair writes validation and row gifs', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'character-pack-cli-apply-repair-'))
  const itemDir = path.join(root, 'items', 'frog_knight_v1')
  await mkdir(itemDir, { recursive: true })
  await writeFile(path.join(itemDir, 'normalized_sheet.png'), await makeRepairTestSheetPng({ croppedFrame: 40 }))
  const repairedCellPath = path.join(root, 'repaired_cell.png')
  await writeFile(repairedCellPath, await encodeRgbaPng(makeRepairTestCell({ x: 26, y: 17, w: 44, h: 72 })))
  const reportPath = path.join(root, 'benchmark_report.json')
  await writeFile(
    reportPath,
    JSON.stringify({
      run_id: 'topdown_apply_repair_test',
      preset: 'topdown_rpg_v0',
      items: [
        {
          case: { id: 'frog_knight', description: 'a tiny frog knight' },
          variant: 1,
          artifacts: { dir: itemDir },
          validation: { status: 'fail', blocking_errors: ['frame_40_cropped'], warnings: [] },
        },
      ],
    })
  )

  const outputDir = path.join(root, 'repair-output')
  const result = await runCli([
    'benchmark',
    'topdown-apply-repair',
    '--report',
    reportPath,
    '--repair',
    `frog_knight_v1_frame_40_cropped=${repairedCellPath}`,
    '--output-dir',
    outputDir,
  ])

  assert.equal(result.command, 'benchmark topdown-apply-repair')
  assert.equal(result.summary.repair_count, 1)
  assert.equal(result.summary.resolved_count, 1)
  assert.equal(result.items[0].target_results[0].after_has_issue, false)
  assert.equal(result.items[0].validation_after.blocking_errors.includes('frame_40_cropped'), false)
  assert.equal(result.items[0].files.row_gif_count, 16)
  assert.equal(await exists(path.join(outputDir, 'frog_knight_v1', 'repaired_normalized_sheet.png')), true)
  assert.equal(await exists(path.join(outputDir, 'frog_knight_v1', 'repair_validation.json')), true)
  assert.equal(await exists(path.join(outputDir, 'frog_knight_v1', 'attack_left.gif')), true)
})

test('character pack CLI benchmark topdown apply repair sanitizes report-derived output id', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'character-pack-cli-apply-repair-sanitize-'))
  const itemDir = path.join(root, 'items', 'unsafe')
  await mkdir(itemDir, { recursive: true })
  await writeFile(path.join(itemDir, 'normalized_sheet.png'), await makeRepairTestSheetPng({ croppedFrame: 40 }))
  const repairedCellPath = path.join(root, 'repaired_cell.png')
  await writeFile(repairedCellPath, await encodeRgbaPng(makeRepairTestCell({ x: 26, y: 17, w: 44, h: 72 })))
  const reportPath = path.join(root, 'benchmark_report.json')
  await writeFile(
    reportPath,
    JSON.stringify({
      run_id: 'topdown_apply_repair_sanitize_test',
      preset: 'topdown_rpg_v0',
      items: [
        {
          case: { id: '../unsafe id', description: 'a tiny frog knight' },
          variant: 1,
          artifacts: { dir: itemDir },
          validation: { status: 'fail', blocking_errors: ['frame_40_cropped'], warnings: [] },
        },
      ],
    })
  )

  const outputDir = path.join(root, 'repair-output')
  const result = await runCli([
    'benchmark',
    'topdown-apply-repair',
    '--report',
    reportPath,
    '--repair',
    `../unsafe id_v1_frame_40_cropped=${repairedCellPath}`,
    '--output-dir',
    outputDir,
  ])

  assert.equal(result.items[0].item_id, '../unsafe id_v1')
  assert.equal(result.items[0].output_id, '_unsafe_id_v1')
  assert.equal(result.items[0].output_dir, path.join(outputDir, '_unsafe_id_v1'))
  assert.equal(await exists(path.join(outputDir, '_unsafe_id_v1', 'repair_validation.json')), true)
  assert.equal(await exists(path.join(root, 'unsafe id_v1', 'repair_validation.json')), false)
})
