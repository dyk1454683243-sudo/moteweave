import { spawn } from 'node:child_process'
import { once } from 'node:events'
import http from 'node:http'
import test from 'node:test'
import assert from 'node:assert/strict'

import { encodeRgbaPng } from '../../src/character-pack/imageCodec.js'
import { OCAD_REGIONS } from '../../src/character-pack/exporters/ocadExport.js'
import { TOPDOWN_RPG_V0 } from '../../src/character-pack/profile.js'
import { FIXED_REGION_MOTION_LAYOUT_ID } from '../../src/character-pack/sourceLayoutIds.js'

const TERMINAL = new Set(['done', 'failed_safety_filter', 'failed_model_error', 'failed_post_processing'])

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  })
}

function paintRect(image, rect, color = [60, 120, 200, 255]) {
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

function makeCell(index = 0) {
  const cell = blankImage(TOPDOWN_RPG_V0.frame.w, TOPDOWN_RPG_V0.frame.h)
  paintRect(cell, { x: 41 + (index % 3), y: 38, w: 14, h: 50 }, [40 + (index % 120), 90, 160, 255])
  paintRect(cell, { x: 36, y: 52 + (index % 2), w: 6, h: 18 }, [120, 80, 40, 255])
  return cell
}

function pasteCell(sheet, frame, cell) {
  const col = frame % TOPDOWN_RPG_V0.grid.columns
  const row = Math.floor(frame / TOPDOWN_RPG_V0.grid.columns)
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

async function makeSourceSheetPng() {
  const sheet = blankImage(TOPDOWN_RPG_V0.sheet.w, TOPDOWN_RPG_V0.sheet.h)
  for (let frame = 0; frame < TOPDOWN_RPG_V0.grid.columns * TOPDOWN_RPG_V0.grid.rows; frame += 1) {
    pasteCell(sheet, frame, makeCell(frame))
  }
  return encodeRgbaPng(sheet)
}

async function makeFixedRegionSourcePng() {
  const sheet = blankImage(252, 252)
  Object.entries(OCAD_REGIONS).forEach(([key, region], index) => {
    const colorSeed = Array.from(key).reduce((sum, char) => sum + char.charCodeAt(0), 0) + index * 11
    paintRect(sheet, {
      x: region.x + Math.min(3, Math.floor(region.w / 4)),
      y: region.y + 4,
      w: Math.max(2, region.w - Math.min(6, Math.floor(region.w / 2))),
      h: Math.max(2, region.h - 8),
    }, [30 + (colorSeed % 90), 80 + (colorSeed % 80), 130 + (colorSeed % 70), 255])
  })
  return encodeRgbaPng(sheet)
}

async function makeRepairStripPng(animation = 'attack_left') {
  const def = TOPDOWN_RPG_V0.animations.find((item) => item.name === animation)
  const strip = blankImage(TOPDOWN_RPG_V0.frame.w * def.count, TOPDOWN_RPG_V0.frame.h)
  for (let slot = 0; slot < def.count; slot += 1) {
    const frame = def.row * TOPDOWN_RPG_V0.grid.columns + def.startCol + slot
    const cell = makeCell(frame + 17)
    paintRect(cell, { x: 62, y: 48 + slot, w: 12, h: 4 }, [210, 220, 80, 255])
    for (let y = 0; y < TOPDOWN_RPG_V0.frame.h; y += 1) {
      for (let x = 0; x < TOPDOWN_RPG_V0.frame.w; x += 1) {
        const src = (y * TOPDOWN_RPG_V0.frame.w + x) * 4
        const dst = (y * strip.width + slot * TOPDOWN_RPG_V0.frame.w + x) * 4
        strip.data[dst] = cell.data[src]
        strip.data[dst + 1] = cell.data[src + 1]
        strip.data[dst + 2] = cell.data[src + 2]
        strip.data[dst + 3] = cell.data[src + 3]
      }
    }
  }
  return encodeRgbaPng(strip)
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
  const response = await fetch(new URL(path, baseUrl), options)
  const text = await response.text()
  const json = text ? JSON.parse(text) : {}
  if (!response.ok) throw new Error(`${path} returned ${response.status}: ${text}`)
  return json
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

test('character action repair API writes dry-run evidence and live repaired exports', async (t) => {
  const repairStrip = await makeRepairStripPng()
  const fixedRegionRepairSheet = await makeFixedRegionSourcePng()
  let providerCalls = 0
  const providerServer = http.createServer(async (req, res) => {
    providerCalls += 1
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const requestText = Buffer.concat(chunks).toString('utf8')
    const image = requestText.includes('fixed-region source') ? fixedRegionRepairSheet : repairStrip
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({
      choices: [
        {
          message: {
            images: [{ image_url: { url: `data:image/png;base64,${image.toString('base64')}` } }],
          },
        },
      ],
    }))
  })
  const providerPort = await listen(providerServer)
  t.after(() => providerServer.close())

  const appServer = http.createServer()
  const appPort = await listen(appServer)
  appServer.close()
  await once(appServer, 'close')

  const child = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(appPort),
      CHARACTER_JOB_CONCURRENCY: '1',
      KEY_A: 'alpha',
      CHARACTER_PROVIDER_PRESETS: JSON.stringify([
        { id: 'repair-provider', provider: 'openrouter', apiKeyEnv: 'KEY_A', baseUrl: `http://127.0.0.1:${providerPort}/repair`, model: 'model/repair', image_size: '1K' },
        { id: 'missing-provider', provider: 'openrouter', apiKeyEnv: 'MISSING_KEY', baseUrl: `http://127.0.0.1:${providerPort}/repair`, model: 'model/missing', image_size: '1K' },
      ]),
      OPENROUTER_API_KEY: '',
      GEMINI_API_KEY: '',
      GOOGLE_API_KEY: '',
      CHARACTER_IMAGE_API_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  t.after(() => child.kill())
  await waitForServer(child)

  const baseUrl = `http://127.0.0.1:${appPort}`
  const sourcePng = await makeSourceSheetPng()
  const processInitial = await fetchJson(baseUrl, '/api/process-sheet', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      source_base64: sourcePng.toString('base64'),
      options: {
        name: 'repair_api_unit',
        sourceLayout: 'topdown_rpg_v0',
        backgroundMode: 'passthrough',
        autoCorrect: false,
        motionStabilize: false,
        componentCleanup: false,
        styleReport: true,
      },
    }),
  })
  const sourceJob = await waitForJob(baseUrl, processInitial.id)
  assert.ok(['done', 'failed_post_processing'].includes(sourceJob.status))
  assert.ok(sourceJob.debug_report_url)
  assert.ok(sourceJob.normalized_sheet_url)

  const fixedInitial = await fetchJson(baseUrl, '/api/process-sheet', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      source_base64: fixedRegionRepairSheet.toString('base64'),
      options: {
        name: 'repair_api_fixed_region_unit',
        sourceLayout: FIXED_REGION_MOTION_LAYOUT_ID,
        backgroundMode: 'passthrough',
        autoCorrect: false,
        motionStabilize: false,
        componentCleanup: false,
        styleReport: true,
      },
    }),
  })
  const fixedSourceJob = await waitForJob(baseUrl, fixedInitial.id)
  assert.ok(['done', 'failed_post_processing'].includes(fixedSourceJob.status))
  assert.ok(fixedSourceJob.debug_report_url)
  assert.ok(fixedSourceJob.normalized_sheet_url)

  const dryRun = await fetchJson(baseUrl, '/api/repair-character-action', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jobId: sourceJob.id,
      animation: 'attack_left',
      providerPresetId: 'repair-provider',
      imageConfig: { image_size: '1K' },
      dryRunPlan: true,
      runId: `repair_api_dry_${Date.now().toString(36)}`,
    }),
  })
  assert.equal(dryRun.status, 'done')
  assert.equal(dryRun.estimated_provider_calls, 1)
  assert.equal(dryRun.selected_animation, 'attack_left')
  assert.equal(dryRun.selected_frames.length, 4)
  assert.equal(dryRun.image_config.aspect_ratio, '4:1')
  assert.ok(dryRun.repair_plan_url)
  assert.ok(dryRun.repair_target_animation_reference_url)
  await fetchOk(baseUrl, dryRun.repair_plan_url)
  await fetchOk(baseUrl, dryRun.repair_target_animation_reference_url)

  const idleDryRun = await fetchJson(baseUrl, '/api/repair-character-action', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jobId: fixedSourceJob.id,
      animation: 'idleL',
      providerPresetId: 'repair-provider',
      imageConfig: { image_size: '1K' },
      dryRunPlan: true,
      runId: `repair_api_idle_dry_${Date.now().toString(36)}`,
    }),
  })
  assert.equal(idleDryRun.status, 'done')
  assert.equal(idleDryRun.repair_mode, 'fixed_region_source_patch')
  assert.equal(idleDryRun.selected_animation, 'idleL')
  assert.equal(idleDryRun.selected_source_action, 'idleL')
  assert.deepEqual(idleDryRun.selected_source_actions, ['idleL'])
  assert.deepEqual(idleDryRun.selected_region_keys, ['idleL'])
  assert.equal(idleDryRun.selected_frames.length, 1)
  assert.equal(idleDryRun.source_action_layout, 'fixed_region_motion_v0')
  assert.equal(idleDryRun.image_config.aspect_ratio, '1:1')
  assert.ok(idleDryRun.repair_source_sheet_reference_url)
  assert.ok(idleDryRun.repair_normalized_sheet_reference_url)
  const idlePlan = await fetchJson(baseUrl, idleDryRun.repair_plan_url)
  assert.deepEqual(idlePlan.selected.source_actions, ['idleL'])
  assert.deepEqual(idlePlan.selected.region_keys, ['idleL'])
  assert.equal(idlePlan.selected.expected_output.kind, 'patched_fixed_region_source_sheet_png')
  assert.equal(idlePlan.selected.expected_output.copied_region_count, 1)

  const fixedLiveInitial = await fetchJson(baseUrl, '/api/repair-character-action', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jobId: fixedSourceJob.id,
      actions: ['idleL', 'jump'],
      providerPresetId: 'repair-provider',
      imageConfig: { image_size: '1K' },
      confirm_live_generation: true,
      maxProviderCalls: 1,
    }),
  })
  const fixedLiveJob = await waitForJob(baseUrl, fixedLiveInitial.id)
  assert.equal(fixedLiveJob.status, 'done')
  assert.equal(fixedLiveJob.repair_mode, 'fixed_region_source_patch')
  assert.deepEqual(fixedLiveJob.selected_source_actions, ['idleL', 'jump'])
  assert.equal(fixedLiveJob.provider_call_budget.used_provider_calls, 1)
  assert.equal(providerCalls, 1)
  assert.ok(fixedLiveJob.repaired_source_sheet_url)
  assert.ok(fixedLiveJob.normalized_provider_source_sheet_url)
  assert.ok(fixedLiveJob.normalized_sheet_url)
  assert.ok(fixedLiveJob.zip_url)
  await fetchOk(baseUrl, fixedLiveJob.repaired_source_sheet_url)
  await fetchOk(baseUrl, fixedLiveJob.zip_url)

  const missingInitial = await fetchJson(baseUrl, '/api/repair-character-action', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jobId: sourceJob.id,
      animation: 'attack_left',
      providerPresetId: 'missing-provider',
      confirm_live_generation: true,
      maxProviderCalls: 1,
    }),
  })
  const missingJob = await waitForJob(baseUrl, missingInitial.id)
  assert.equal(missingJob.status, 'failed_model_error')
  assert.match(missingJob.reason, /MISSING_KEY/)

  const liveInitial = await fetchJson(baseUrl, '/api/repair-character-action', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jobId: sourceJob.id,
      animation: 'attack_left',
      providerPresetId: 'repair-provider',
      imageConfig: { image_size: '1K' },
      confirm_live_generation: true,
      maxProviderCalls: 1,
    }),
  })
  const liveJob = await waitForJob(baseUrl, liveInitial.id)
  assert.equal(liveJob.status, 'done')
  assert.equal(liveJob.selected_animation, 'attack_left')
  assert.equal(liveJob.provider_call_budget.used_provider_calls, 1)
  assert.equal(providerCalls, 2)
  assert.ok(liveJob.repaired_animation_strip_url)
  assert.ok(liveJob.repaired_normalized_sheet_url)
  assert.ok(liveJob.repair_validation_report_url)
  assert.ok(liveJob.normalized_sheet_url)
  assert.ok(liveJob.zip_url)
  await fetchOk(baseUrl, liveJob.repaired_animation_strip_url)
  await fetchOk(baseUrl, liveJob.repair_validation_report_url)
  await fetchOk(baseUrl, liveJob.zip_url)
})
