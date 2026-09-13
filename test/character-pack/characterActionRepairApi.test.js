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

test('character action repair API runs the same sealed three-atlas workflow for both source templates', async (t) => {
  const fixedRegionRepairSheet = await makeFixedRegionSourcePng()
  let providerCalls = 0
  const providerImageCounts = []
  const providerServer = http.createServer(async (req, res) => {
    providerCalls += 1
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const requestText = Buffer.concat(chunks).toString('utf8')
    const requestBody = JSON.parse(requestText)
    const content = requestBody.messages?.[0]?.content
    const promptText = Array.isArray(content)
      ? content.find((part) => part.type === 'text')?.text ?? ''
      : String(content ?? '')
    const imageParts = Array.isArray(content)
      ? content.filter((part) => part.type === 'image_url')
      : []
    let image = fixedRegionRepairSheet
    if (promptText.includes('action repair atlas')) {
      providerImageCounts.push(imageParts.length)
      const poseGuideDataUrl = imageParts[1]?.image_url?.url ?? ''
      image = Buffer.from(poseGuideDataUrl.split(',', 2)[1] ?? '', 'base64')
    }
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

  const appEnv = {
    ...process.env,
    PORT: String(appPort),
    CHARACTER_JOB_CONCURRENCY: '1',
    KEY_A: 'alpha',
    CHARACTER_PROVIDER_PRESETS: JSON.stringify([
      { id: 'repair-provider', provider: 'openrouter', apiKeyEnv: 'KEY_A', baseUrl: `http://127.0.0.1:${providerPort}/repair`, model: 'model/repair', image_size: '1K' },
    ]),
    OPENROUTER_API_KEY: '',
    GEMINI_API_KEY: '',
    GOOGLE_API_KEY: '',
    CHARACTER_IMAGE_API_KEY: '',
  }
  let child = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: appEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  t.after(() => {
    if (child.exitCode == null) child.kill()
  })
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

  const repairProjectId = `project_pig_${process.pid}_${Date.now()}`
  const repairProject = await fetchJson(baseUrl, '/api/editor/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: repairProjectId, name: 'Repair API identities' }),
  })
  const importedTopdown = await fetchJson(baseUrl, `/api/editor/projects/${repairProjectId}/import-job`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      expectedRevision: repairProject.project.revision,
      kind: 'character_pack',
      jobId: sourceJob.id,
      assetId: 'asset_topdown',
    }),
  })
  const importedFixed = await fetchJson(baseUrl, `/api/editor/projects/${repairProjectId}/import-job`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      expectedRevision: importedTopdown.project.revision,
      kind: 'character_pack',
      jobId: fixedSourceJob.id,
      assetId: 'asset_pig',
    }),
  })
  assert.equal(importedTopdown.revision.source_job_id, sourceJob.id)
  assert.equal(importedFixed.revision.source_job_id, fixedSourceJob.id)

  const callsBeforeWrongIdentity = providerCalls
  const wrongIdentityResponse = await fetch(new URL('/api/repair-character-action', baseUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectId: repairProjectId,
      assetId: 'asset_pig',
      parentRevisionId: 'rev_001',
      jobId: sourceJob.id,
      animation: 'attack_left',
      providerPresetId: 'repair-provider',
      dryRunPlan: true,
    }),
  })
  assert.equal(wrongIdentityResponse.status, 400)
  assert.equal((await wrongIdentityResponse.json()).error, 'repair_plan_failed')
  assert.equal(providerCalls, callsBeforeWrongIdentity)

  const topdownDryRun = await fetchJson(baseUrl, '/api/repair-character-action', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectId: repairProjectId,
      assetId: 'asset_topdown',
      parentRevisionId: 'rev_001',
      jobId: sourceJob.id,
      animation: 'attack_left',
      providerPresetId: 'repair-provider',
      imageConfig: { image_size: '1K' },
      equipmentPolicy: 'preserve',
      dryRunPlan: true,
      runId: `repair_api_dry_${Date.now().toString(36)}`,
    }),
  })
  assert.equal(topdownDryRun.status, 'done')
  assert.equal(topdownDryRun.repair_mode, 'action_repair_atlas')
  assert.equal(topdownDryRun.source_action_layout, 'topdown_rpg_v0')
  assert.deepEqual(topdownDryRun.selected_source_actions, ['attack_left'])
  assert.deepEqual(topdownDryRun.selected_region_keys, [
    'attack_left_0', 'attack_left_1', 'attack_left_2', 'attack_left_3',
  ])
  assert.deepEqual(
    [topdownDryRun.preflight.source_region_mask.width, topdownDryRun.preflight.source_region_mask.height],
    [768, 768],
  )
  assert.ok(topdownDryRun.repair_identity_anchor_atlas_url)
  assert.ok(topdownDryRun.repair_pose_guide_atlas_url)
  assert.ok(topdownDryRun.repair_empty_output_atlas_url)
  assert.equal(providerCalls, 0)

  const topdownLiveInitial = await fetchJson(baseUrl, '/api/repair-character-action', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectId: repairProjectId,
      assetId: 'asset_topdown',
      parentRevisionId: 'rev_001',
      jobId: sourceJob.id,
      animation: 'attack_left',
      providerPresetId: 'repair-provider',
      imageConfig: { image_size: '1K' },
      equipmentPolicy: 'preserve',
      reviewedRunId: topdownDryRun.review_id,
      expectedPlanHash: topdownDryRun.plan_hash,
      expectedReferenceManifestSha256: topdownDryRun.reference_manifest_sha256,
      confirm_live_generation: true,
      maxProviderCalls: 1,
    }),
  })
  const topdownLiveJob = await waitForJob(baseUrl, topdownLiveInitial.id)
  assert.ok(TERMINAL.has(topdownLiveJob.status))
  assert.equal(topdownLiveJob.repair_mode, 'action_repair_atlas')
  assert.equal(topdownLiveJob.source_action_layout, 'topdown_rpg_v0')
  assert.equal(topdownLiveJob.provider_call_budget.used_provider_calls, 1)
  assert.deepEqual(topdownLiveJob.selected_region_keys, topdownDryRun.selected_region_keys)
  assert.ok(topdownLiveJob.raw_provider_repair_output_url)
  assert.equal(providerCalls, 1)
  assert.deepEqual(providerImageCounts, [3])

  const idleDryRun = await fetchJson(baseUrl, '/api/repair-character-action', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectId: repairProjectId,
      assetId: 'asset_pig',
      parentRevisionId: 'rev_001',
      jobId: fixedSourceJob.id,
      animation: 'idleL',
      providerPresetId: 'repair-provider',
      imageConfig: { image_size: '1K' },
      dryRunPlan: true,
      runId: `repair_api_idle_dry_${Date.now().toString(36)}`,
    }),
  })
  assert.equal(idleDryRun.status, 'done')
  assert.equal(idleDryRun.repair_mode, 'action_repair_atlas')
  assert.equal(idleDryRun.selected_animation, 'idleL')
  assert.equal(idleDryRun.selected_source_action, 'idleL')
  assert.deepEqual(idleDryRun.selected_source_actions, ['idleL'])
  assert.deepEqual(idleDryRun.selected_region_keys, ['idleL'])
  assert.equal(idleDryRun.selected_frames.length, 1)
  assert.equal(idleDryRun.source_action_layout, 'fixed_region_motion_v0')
  assert.equal(idleDryRun.image_config.aspect_ratio, '1:1')
  assert.ok(idleDryRun.repair_identity_anchor_atlas_url)
  assert.ok(idleDryRun.repair_pose_guide_atlas_url)
  assert.ok(idleDryRun.repair_empty_output_atlas_url)
  assert.equal(idleDryRun.repair_source_sheet_reference_url, null)
  assert.equal(idleDryRun.repair_normalized_sheet_reference_url, null)
  assert.equal(idleDryRun.equipment_policy, 'none')
  assert.equal(idleDryRun.provider.provider, 'openrouter')
  assert.equal(idleDryRun.provider.model, 'model/repair')
  assert.equal(idleDryRun.reference_policy.source_target_regions_holed, false)
  assert.equal(idleDryRun.reference_policy.full_source_sheet_sent, false)
  assert.equal(idleDryRun.review_id.startsWith('repair_api_idle_dry_'), true)
  assert.match(idleDryRun.plan_hash, /^[a-f0-9]{64}$/)
  assert.match(idleDryRun.reference_manifest_sha256, /^[a-f0-9]{64}$/)
  assert.deepEqual(idleDryRun.identity, {
    project_id: repairProjectId,
    asset_id: 'asset_pig',
    parent_revision_id: 'rev_001',
    source_job_id: fixedSourceJob.id,
  })
  assert.ok(idleDryRun.action_repair_review_contract_url)
  assert.deepEqual(
    idleDryRun.preflight.source_region_mask.regions.map((region) => region.key),
    ['idleL'],
  )
  assert.deepEqual(
    [idleDryRun.preflight.source_region_mask.width, idleDryRun.preflight.source_region_mask.height],
    [252, 252],
  )
  const idlePlan = await fetchJson(baseUrl, idleDryRun.repair_plan_url)
  assert.deepEqual(idlePlan.reference_policy, {
    source_target_regions_holed: false,
    identity_anchor_atlas: true,
    pose_guide_atlas: true,
    independent_empty_output_atlas: true,
    full_source_sheet_sent: false,
    full_normalized_sheet_sent: false,
    provider_candidate_feedback: false,
  })
  assert.deepEqual(idlePlan.selected.source_actions, ['idleL'])
  assert.deepEqual(idlePlan.selected.region_keys, ['idleL'])
  assert.equal(idlePlan.selected.expected_output.kind, 'independent_action_repair_atlas_then_scoped_source_patch')
  assert.equal(idlePlan.selected.expected_output.copied_region_count, 1)

  const fixedLiveReview = await fetchJson(baseUrl, '/api/repair-character-action', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectId: repairProjectId,
      assetId: 'asset_pig',
      parentRevisionId: 'rev_001',
      jobId: fixedSourceJob.id,
      actions: ['idleL', 'jump'],
      regionKeys: ['idleL', 'jump1'],
      providerPresetId: 'repair-provider',
      imageConfig: { image_size: '1K' },
      equipmentPolicy: 'preserve',
      dryRunPlan: true,
      runId: `repair_api_fixed_live_review_${Date.now().toString(36)}`,
    }),
  })
  assert.equal(fixedLiveReview.status, 'done')
  assert.equal(providerCalls, 1)

  const staleReviewResponse = await fetch(new URL('/api/repair-character-action', baseUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectId: repairProjectId,
      assetId: 'asset_pig',
      parentRevisionId: 'rev_001',
      jobId: fixedSourceJob.id,
      actions: ['idleL', 'jump'],
      regionKeys: ['idleL', 'jump1'],
      providerPresetId: 'repair-provider',
      imageConfig: { image_size: '1K' },
      equipmentPolicy: 'preserve',
      reviewedRunId: fixedLiveReview.review_id,
      expectedPlanHash: '0'.repeat(64),
      expectedReferenceManifestSha256: fixedLiveReview.reference_manifest_sha256,
      confirm_live_generation: true,
      maxProviderCalls: 1,
    }),
  })
  assert.equal(staleReviewResponse.status, 400)
  assert.equal((await staleReviewResponse.json()).error, 'repair_plan_failed')
  assert.equal(providerCalls, 1)

  const fixedLiveInitial = await fetchJson(baseUrl, '/api/repair-character-action', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectId: repairProjectId,
      assetId: 'asset_pig',
      parentRevisionId: 'rev_001',
      jobId: fixedSourceJob.id,
      actions: ['idleL', 'jump'],
      regionKeys: ['idleL', 'jump1'],
      providerPresetId: 'repair-provider',
      imageConfig: { image_size: '1K' },
      equipmentPolicy: 'preserve',
      reviewedRunId: fixedLiveReview.review_id,
      expectedPlanHash: fixedLiveReview.plan_hash,
      expectedReferenceManifestSha256: fixedLiveReview.reference_manifest_sha256,
      confirm_live_generation: true,
      maxProviderCalls: 1,
    }),
  })
  const fixedLiveJob = await waitForJob(baseUrl, fixedLiveInitial.id)
  assert.equal(fixedLiveJob.status, 'failed_post_processing')
  assert.equal(fixedLiveJob.repair_status, 'quality_blocked')
  assert.equal(fixedLiveJob.reason, 'equipment_quality_blocked')
  assert.equal(fixedLiveJob.repair_mode, 'action_repair_atlas')
  assert.deepEqual(fixedLiveJob.selected_source_actions, ['idleL', 'jump'])
  assert.deepEqual(fixedLiveJob.selected_region_keys, ['idleL', 'jump1'])
  assert.equal(fixedLiveJob.equipment_policy, 'preserve')
  assert.equal(fixedLiveJob.provider_call_budget.used_provider_calls, 1)
  assert.equal(fixedLiveJob.accepted, false)
  assert.equal(fixedLiveJob.requires_user_confirmation, true)
  assert.equal(providerCalls, 2)
  assert.deepEqual(providerImageCounts, [3, 3])
  assert.ok(fixedLiveJob.raw_provider_repair_output_url)
  assert.ok(fixedLiveJob.atlas_extraction_report_url)
  assert.ok(fixedLiveJob.source_scope_report_url)
  assert.equal(fixedLiveJob.source_scope_status, 'scope_pass')
  assert.equal(fixedLiveJob.outside_selected_changed_pixels, 0)
  assert.ok(fixedLiveJob.review_candidate_source_sheet_url)
  assert.ok(fixedLiveJob.equipment_quality_report_url)
  assert.equal(fixedLiveJob.repaired_source_sheet_url, null)
  assert.equal(Boolean(fixedLiveJob.normalized_sheet_url), false)
  assert.equal(Boolean(fixedLiveJob.zip_url), false)
  await fetchOk(baseUrl, fixedLiveJob.review_candidate_source_sheet_url)
  await fetchOk(baseUrl, fixedLiveJob.source_scope_report_url)
  await fetchOk(baseUrl, fixedLiveJob.equipment_quality_report_url)

  const restartProjectId = `project_restart_action_repair_${Date.now().toString(36)}`
  const restartAssetId = 'asset_restart_action_repair'
  const createdProject = await fetchJson(baseUrl, '/api/editor/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: restartProjectId, name: 'Restart Action Repair' }),
  })
  assert.equal(createdProject.project.revision, 1)
  const imported = await fetchJson(baseUrl, `/api/editor/projects/${restartProjectId}/import-job`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      expectedRevision: 1,
      kind: 'character_pack',
      jobId: fixedSourceJob.id,
      assetId: restartAssetId,
    }),
  })
  assert.equal(imported.revision.id, 'rev_001')
  assert.equal(imported.revision.source_job_id, fixedSourceJob.id)

  const firstChild = child
  const firstChildExit = once(firstChild, 'exit')
  firstChild.kill()
  await firstChildExit
  child = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: appEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  await waitForServer(child)

  const callsBeforeRestartReview = providerCalls
  const restartReview = await fetchJson(baseUrl, '/api/repair-character-action', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectId: restartProjectId,
      assetId: restartAssetId,
      parentRevisionId: imported.revision.id,
      jobId: fixedSourceJob.id,
      actions: ['idleL'],
      regionKeys: ['idleL'],
      providerPresetId: 'repair-provider',
      imageConfig: { image_size: '1K' },
      dryRunPlan: true,
      runId: `repair_api_restart_review_${Date.now().toString(36)}`,
    }),
  })
  assert.equal(restartReview.status, 'done')
  assert.equal(restartReview.repair_mode, 'action_repair_atlas')
  assert.deepEqual(restartReview.identity, {
    project_id: restartProjectId,
    asset_id: restartAssetId,
    parent_revision_id: imported.revision.id,
    source_job_id: fixedSourceJob.id,
  })
  assert.equal(providerCalls, callsBeforeRestartReview)
})
