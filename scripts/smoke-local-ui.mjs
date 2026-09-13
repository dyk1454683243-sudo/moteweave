#!/usr/bin/env node
import { readFile } from 'node:fs/promises'

import JSZip from 'jszip'
import sharp from 'sharp'

function argValue(name, fallback) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] || fallback : fallback
}

function assertCondition(condition, message) {
  if (!condition) throw new Error(message)
}

async function makePng(color) {
  return sharp({
    create: {
      width: 16,
      height: 16,
      channels: 4,
      background: color,
    },
  })
    .png()
    .toBuffer()
}

async function makeMotionZip(colorOffset = 0) {
  const zip = new JSZip()
  const colors = [
    { r: 220, g: 60 + colorOffset, b: 90, alpha: 1 },
    { r: 60, g: 120 + colorOffset, b: 220, alpha: 1 },
    { r: 90, g: 200, b: 100 + colorOffset, alpha: 1 },
    { r: 190, g: 120, b: 50 + colorOffset, alpha: 1 },
    { r: 130, g: 70 + colorOffset, b: 190, alpha: 1 },
    { r: 40, g: 170, b: 170 + colorOffset, alpha: 1 },
  ]
  for (const [index, color] of colors.entries()) {
    zip.file(`frame_${String(index + 1).padStart(2, '0')}.png`, await makePng(color))
  }
  return zip.generateAsync({ type: 'nodebuffer' })
}

async function makeSceneTileSheetPng() {
  const width = 192
  const height = 192
  const data = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4
      data[offset] = 240
      data[offset + 1] = 40
      data[offset + 2] = 200
      data[offset + 3] = 255
    }
  }
  for (let mask = 0; mask < 16; mask += 1) {
    const col = mask % 4
    const row = Math.floor(mask / 4)
    const startX = col * 48 + 8
    const startY = row * 48 + 8
    const color = [
      56 + ((mask * 37) % 160),
      72 + ((mask * 53) % 140),
      48 + ((mask * 29) % 150),
      255,
    ]
    for (let y = startY; y < startY + 32; y += 1) {
      for (let x = startX; x < startX + 32; x += 1) {
        const offset = (y * width + x) * 4
        data[offset] = color[0]
        data[offset + 1] = color[1]
        data[offset + 2] = color[2]
        data[offset + 3] = color[3]
      }
    }
  }
  return sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer()
}

async function makeTwoPointFiveDMaterialSourcePng() {
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="256" shape-rendering="crispEdges">',
    '<rect x="0" y="0" width="170" height="128" fill="#2f8f3f"/>',
    '<rect x="170" y="0" width="171" height="128" fill="#7a5435"/>',
    '<rect x="341" y="0" width="171" height="128" fill="#b6d46d"/>',
    '<rect x="0" y="128" width="170" height="128" fill="#67b04f"/>',
    '<rect x="170" y="128" width="171" height="128" fill="#8f7f45"/>',
    '<rect x="341" y="128" width="171" height="128" fill="#1d2119"/>',
    '</svg>',
  ].join('')
  return sharp(Buffer.from(svg)).png().toBuffer()
}

async function pollJob(baseUrl, id) {
  let current = null
  for (let i = 0; i < 180; i += 1) {
    const response = await fetch(`${baseUrl}/api/jobs/${id}`)
    assertCondition(response.ok, `job poll returned ${response.status}`)
    current = await response.json()
    if (['done', 'failed_quality_gate', 'failed_project_pack', 'failed_post_processing', 'failed_model_error', 'failed_safety_filter'].includes(current.status)) return current
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return current
}

async function postJson(baseUrl, requestPath, body) {
  const response = await fetch(`${baseUrl}${requestPath}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = await response.json()
  assertCondition(response.ok, `${requestPath} returned ${response.status}: ${payload.reason || payload.error}`)
  return payload
}

async function uploadMotionZip(baseUrl, operationId, sourceName, bytes) {
  const response = await fetch(
    `${baseUrl}/api/motion-source/uploads?source_name=${encodeURIComponent(sourceName)}&operation_id=${encodeURIComponent(operationId)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/zip' },
      body: bytes,
    }
  )
  const payload = await response.json()
  assertCondition(response.status === 201, `motion upload returned ${response.status}: ${payload.reason || payload.error}`)
  return payload
}

async function releaseMotionUpload(baseUrl, uploadId) {
  let payload = null
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const response = await fetch(
      `${baseUrl}/api/motion-source/uploads/${encodeURIComponent(uploadId)}`,
      { method: 'DELETE' }
    )
    payload = await response.json()
    assertCondition(response.ok, `motion release returned ${response.status}: ${payload.reason || payload.error}`)
    if (!payload.pending) return payload
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`motion upload release remained pending: ${uploadId}`)
}

function motionSourceRequest(source, operationId, options = undefined) {
  return {
    source_upload_id: source.upload_id,
    source_identity: source.source_identity,
    operation_id: operationId,
    ...(options ? { options } : {}),
  }
}

const baseUrl = argValue('--base-url', 'http://localhost:4173').replace(/\/$/, '')

try {
  const homeResponse = await fetch(`${baseUrl}/`, { redirect: 'manual' })
  assertCondition(homeResponse.status === 302, `homepage promotion returned ${homeResponse.status}`)
  const studioLocation = homeResponse.headers.get('location')
  assertCondition(
    studioLocation === '/src/ui/studio/studio.html#character',
    `homepage promotion returned ${studioLocation}`,
  )
  const indexResponse = await fetch(`${baseUrl}/index.html`, { redirect: 'manual' })
  assertCondition(indexResponse.status === 302, `index promotion returned ${indexResponse.status}`)
  assertCondition(indexResponse.headers.get('location') === studioLocation, 'index promotion target changed')

  const studioResponse = await fetch(`${baseUrl}${studioLocation.split('#')[0]}`)
  assertCondition(studioResponse.ok, `Studio returned ${studioResponse.status}`)
  const studioHtml = await studioResponse.text()
  for (const expected of [
    'id="studio-character-view"',
    'id="character-local-workspace"',
    'id="character-ai-workspace"',
    'id="character-compat-workspace"',
    'id="character-local-entry"',
    'id="character-ai-entry"',
    'id="character-compat-entry"',
    'href="#project"',
  ]) assertCondition(studioHtml.includes(expected), `Studio is missing ${expected}`)

  const legacyRedirectCases = [
    ['/legacy', 'motion-source', '/src/ui/studio/studio.html#action', '&next=https%3A%2F%2Fexample.test'],
    ['/legacy', 'sprite', '/src/ui/studio/studio.html#sequence', ''],
    ['/legacy/', 'two-point-five-d', '/src/ui/studio/studio.html#tiles', ''],
    ['/legacy.html', 'project-pack', '/src/ui/studio/studio.html#project', ''],
    ['/legacy/', 'qa', '/src/ui/studio/studio.html#qa', '&open=ignored'],
    ['/legacy.html', 'character-pack', '/src/ui/studio/studio.html#character', '&next=%2Flegacy'],
    ['/legacy', 'prompts', '/src/ui/studio/studio.html?open=scene-prompt#scene', '&open=ignored&next=https%3A%2F%2Fexample.test'],
  ]
  for (const [legacyPath, tab, expectedLocation, extraSearch] of legacyRedirectCases) {
    const response = await fetch(
      `${baseUrl}${legacyPath}?tab=${encodeURIComponent(tab)}${extraSearch}`,
      {
        redirect: 'manual',
      },
    )
    assertCondition(response.status === 302, `${tab} legacy redirect returned ${response.status}`)
    assertCondition(
      response.headers.get('location') === expectedLocation,
      `${tab} legacy redirect target changed`,
    )
  }
  const legacyFallbackCases = [
    ['/legacy', ''],
    ['/legacy/', '?tab='],
    ['/legacy.html', '?tab=unknown'],
    ['/legacy', '?tab=prompts&tab=prompts'],
    ['/legacy/', '?tab=qa&tab=motion-source'],
    ['/legacy.html', '?tab=__proto__'],
    ['/legacy', '?tab=%2F%2Fexample.test&next=https%3A%2F%2Fexample.test'],
  ]
  for (const [legacyPath, search] of legacyFallbackCases) {
    const response = await fetch(`${baseUrl}${legacyPath}${search}`, { redirect: 'manual' })
    assertCondition(response.status === 302, `${legacyPath}${search} fallback returned ${response.status}`)
    assertCondition(
      response.headers.get('location') === '/src/ui/studio/studio.html#character',
      `${legacyPath}${search} fallback target changed`,
    )
  }
  const tilesStudioResponse = await fetch(`${baseUrl}/src/ui/studio/studio.html`)
  assertCondition(tilesStudioResponse.ok, `Studio shell returned ${tilesStudioResponse.status}`)
  const tilesStudioHtml = await tilesStudioResponse.text()
  for (const expected of [
    'data-studio-view="tiles"',
    'id="studio-tiles-view"',
    'id="studio-tiles-editor-canvas"',
    'id="studio-tiles-source-file"',
    'id="studio-tiles-solver"',
    'id="studio-tiles-border"',
    'id="studio-tiles-clear-edits"',
    'id="studio-tiles-result-preview"',
    'id="studio-tiles-primary"',
  ]) {
    assertCondition(tilesStudioHtml.includes(expected), `missing Studio Tiles marker: ${expected}`)
  }
  assertCondition(!tilesStudioHtml.includes('tiles-legacy-link'), 'retired Tiles escape is still present in Studio')

  const editorResponse = await fetch(`${baseUrl}/editor`)
  assertCondition(editorResponse.ok, `editor shell returned ${editorResponse.status}`)
  const editorHtml = await editorResponse.text()
  for (const expected of [
    'data-editor-shell',
    'id="editor-project-form"',
    'id="editor-scene-select"',
    'id="editor-save-project"',
    'id="editor-autosave-project"',
    'id="editor-undo-project"',
    'id="editor-redo-project"',
    'id="editor-playback-toggle"',
    'id="editor-export-project-pack"',
    'id="editor-import-form"',
    'id="editor-asset-list"',
    'id="editor-tool-select"',
    'id="editor-toggle-grid"',
    'id="editor-toggle-snap"',
    'id="editor-snap-size"',
    'id="editor-stage"',
    'id="editor-panel-body"',
    'id="editor-inspector"',
    'data-editor-panel="flow"',
    'data-editor-panel="repair"',
    'data-editor-panel="playtest"',
    'data-editor-panel="export"',
    'Preview',
    'Export Pack',
    './src/editor-app.js',
    './src/ui/editor/editor.css',
  ]) {
    assertCondition(editorHtml.includes(expected), `missing editor marker: ${expected}`)
  }
  assertCondition(editorResponse.status === 200, 'editor route failed')
  assertCondition(editorHtml.includes('id="editor-panel-body"'), 'editor panel body marker is missing')
  assertCondition(editorHtml.includes('./src/editor-app.js'), 'editor app module marker is missing')

  const repairPanelResponse = await fetch(`${baseUrl}/src/ui/editor/repairWorkbenchPanel.js`)
  assertCondition(repairPanelResponse.ok, `repair panel module returned ${repairPanelResponse.status}`)
  const repairPanelSource = await repairPanelResponse.text()
  for (const marker of [
    'editor-repair-action-only',
    'editor-repair-action-filmstrip',
    'dataset.batchRepairRegion',
    'Three-atlas action repair',
    'Identity anchor + pose guide + empty output atlas',
    'renderAiAction',
  ]) {
    assertCondition(repairPanelSource.includes(marker), `repair panel marker is missing: ${marker}`)
  }
  for (const retiredMarker of ['Processing Recipe', 'Build Preview', 'Accept as revision']) {
    assertCondition(!repairPanelSource.includes(retiredMarker), `retired local reprocess marker is still present: ${retiredMarker}`)
  }

  const editorApiModuleResponse = await fetch(`${baseUrl}/src/ui/editor/api.js`)
  assertCondition(editorApiModuleResponse.ok, `editor API module returned ${editorApiModuleResponse.status}`)
  const editorApiSource = await editorApiModuleResponse.text()
  assertCondition(!editorApiSource.includes('/reprocess'), 'retired local reprocess API client is still present')
  assertCondition(editorApiSource.includes('/api/repair-character-action'), 'three-atlas action repair API marker is missing')

  const retiredReprocessResponse = await fetch(`${baseUrl}/api/editor/projects/retired/assets/retired/reprocess`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })
  assertCondition(retiredReprocessResponse.status === 404, `retired reprocess route returned ${retiredReprocessResponse.status}`)

  const editorShellResponse = await fetch(`${baseUrl}/src/ui/editor/shell.js`)
  assertCondition(editorShellResponse.ok, `editor shell module returned ${editorShellResponse.status}`)
  const editorShellSource = await editorShellResponse.text()
  assertCondition(editorShellSource.includes('createAiActionRepairWorkflow'), 'three-atlas action repair runtime is missing')
  for (const retiredRuntime of [
    'createFrameRepairController',
    'createFrameRepairLifecycle',
    'createFrameRepairQualityGateRuntime',
  ]) {
    assertCondition(!editorShellSource.includes(retiredRuntime), `retired single-frame runtime is still loaded: ${retiredRuntime}`)
  }

  const editorScriptResponse = await fetch(`${baseUrl}/src/editor-app.js`)
  assertCondition(editorScriptResponse.ok, `editor script returned ${editorScriptResponse.status}`)
  const editorApiHealthResponse = await fetch(`${baseUrl}/api/editor/health`)
  assertCondition(editorApiHealthResponse.ok, `editor API health returned ${editorApiHealthResponse.status}`)
  const editorApiHealth = await editorApiHealthResponse.json()
  assertCondition(editorApiHealth.ok === true, 'editor API health did not return ok')
  assertCondition(editorApiHealth.version === 'editor_project_api_v0', `unexpected editor API version: ${editorApiHealth.version}`)

  const cssResponse = await fetch(`${baseUrl}/src/v8.css`)
  assertCondition(cssResponse.ok, `styles returned ${cssResponse.status}`)
  const css = await cssResponse.text()
  assertCondition(css.includes('.v8-layout'), 'v8 layout styles are missing')
  assertCondition(css.includes('.quality-report-hud'), 'quality report HUD styles are missing')
  assertCondition(css.includes('.export-modal'), 'export modal styles are missing')
  assertCondition(css.includes('.motion-source-layout'), 'motion source layout styles are missing')

  const editorCssResponse = await fetch(`${baseUrl}/src/ui/editor/editor.css`)
  assertCondition(editorCssResponse.ok, `editor styles returned ${editorCssResponse.status}`)
  const editorCss = await editorCssResponse.text()
  for (const marker of [
    '.editor-repair-action-only',
    '.editor-repair-action-filmstrip',
    '@media (max-width: 760px)',
  ]) {
    assertCondition(editorCss.includes(marker), `repair workbench editor CSS marker is missing: ${marker}`)
  }

  const providerResponse = await fetch(`${baseUrl}/api/gemini-state`)
  assertCondition(providerResponse.ok, `provider state returned ${providerResponse.status}`)
  const provider = await providerResponse.json()
  assertCondition(['openrouter', 'gemini'].includes(provider.provider), `unexpected provider: ${provider.provider}`)
  assertCondition(Array.isArray(provider.presets), 'provider presets are not listed')
  assertCondition(provider.implemented === true, 'AI provider is not marked implemented')

  const galleryResponse = await fetch(`${baseUrl}/api/benchmark-gallery`)
  assertCondition(galleryResponse.ok, `benchmark gallery returned ${galleryResponse.status}`)
  const gallery = await galleryResponse.json()
  assertCondition(Array.isArray(gallery.runs), 'benchmark gallery runs are not listed')

  const frames = [
    (await makePng({ r: 255, g: 0, b: 0, alpha: 1 })).toString('base64'),
    (await makePng({ r: 0, g: 0, b: 255, alpha: 1 })).toString('base64'),
  ]
  const gifResponse = await fetch(`${baseUrl}/api/build-frame-gif`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      frames_base64: frames,
      options: { targetW: 32, targetH: 32, padding: 4, fps: 12 },
    }),
  })
  assertCondition(gifResponse.ok, `GIF endpoint returned ${gifResponse.status}`)
  const gif = Buffer.from(await gifResponse.arrayBuffer())
  assertCondition(gif.subarray(0, 3).toString('ascii') === 'GIF', 'GIF endpoint did not return GIF bytes')

  const motionZip = await makeMotionZip()
  const motionSource = await uploadMotionZip(
    baseUrl,
    'smoke_motion_upload',
    'smoke_motion.zip',
    motionZip
  )
  const motionPreviewInitial = await postJson(
    baseUrl,
    '/api/preview-motion-frames',
    motionSourceRequest(motionSource, 'smoke_motion_preview', { maxFrames: 6, fps: 8 })
  )
  const motionPreviewJob = await pollJob(baseUrl, motionPreviewInitial.id)
  assertCondition(motionPreviewJob.status === 'done', `motion preview status: ${motionPreviewJob.status}`)
  const motionPreviewResponse = await fetch(`${baseUrl}${motionPreviewJob.frame_preview_index_url}`)
  const motionPreview = await motionPreviewResponse.json()
  assertCondition(motionPreview.default_selection_mode === 'auto', 'motion preview did not default to Auto')
  assertCondition(motionPreview.operation_id === 'smoke_motion_preview', 'motion preview binding mismatch')

  const autoOptions = {
    action: 'walk_down',
    frames: 4,
    selection_mode: 'auto',
  }
  const motionAutoInitial = await postJson(
    baseUrl,
    '/api/build-motion-strip',
    motionSourceRequest(motionSource, 'smoke_motion_auto', autoOptions)
  )
  const motionAutoJob = await pollJob(baseUrl, motionAutoInitial.id)
  assertCondition(motionAutoJob.status === 'done', `motion auto build status: ${motionAutoJob.status}`)
  const motionAutoReport = await (await fetch(`${baseUrl}${motionAutoJob.motion_source_report_url}`)).json()
  assertCondition(motionAutoReport.requested_selection_mode === 'auto', 'motion build did not preserve requested Auto mode')
  assertCondition(motionAutoReport.effective_selection_mode === 'auto', 'motion build did not execute Auto selection')

  const motionManualInitial = await postJson(
    baseUrl,
    '/api/build-motion-strip',
    motionSourceRequest(motionSource, 'smoke_motion_manual', {
      action: 'walk_down',
      selection_mode: 'manual',
      selected_frame_indexes: [4, 1, 0],
    })
  )
  const motionManualJob = await pollJob(baseUrl, motionManualInitial.id)
  assertCondition(motionManualJob.status === 'done', `motion manual build status: ${motionManualJob.status}`)
  const motionManualSelection = await (await fetch(`${baseUrl}${motionManualJob.selected_frames_url}`)).json()
  assertCondition(
    JSON.stringify(motionManualSelection.selected.map((frame) => frame.original_index)) === JSON.stringify([4, 1, 0]),
    'motion Manual selection order was not preserved'
  )

  const changedSource = await uploadMotionZip(
    baseUrl,
    'smoke_motion_upload_changed',
    'smoke_motion_changed.zip',
    await makeMotionZip(20)
  )
  const staleResponse = await fetch(`${baseUrl}/api/build-motion-strip`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...motionSourceRequest(changedSource, 'smoke_motion_stale', autoOptions),
      source_identity: motionSource.source_identity,
    }),
  })
  const stalePayload = await staleResponse.json()
  assertCondition(staleResponse.status === 409, `stale identity returned ${staleResponse.status}`)
  assertCondition(stalePayload.error === 'source_identity_mismatch', 'stale source identity was not rejected')

  const blockerInitial = await postJson(
    baseUrl,
    '/api/build-motion-strip',
    motionSourceRequest(motionSource, 'smoke_motion_cancel_blocker', autoOptions)
  )
  const queuedInitial = await postJson(
    baseUrl,
    '/api/build-motion-strip',
    motionSourceRequest(motionSource, 'smoke_motion_cancel_queued', autoOptions)
  )
  const cancelled = await postJson(
    baseUrl,
    `/api/motion-source/jobs/${queuedInitial.id}/cancel`,
    {}
  )
  assertCondition(cancelled.failure_status === 'cancelled', 'queued Motion job was not cancelled')
  const resumed = await (await fetch(`${baseUrl}/api/jobs/${queuedInitial.id}`)).json()
  assertCondition(resumed.id === queuedInitial.id, 'Motion Resume lookup changed the job id')
  assertCondition(resumed.operation_id === 'smoke_motion_cancel_queued', 'Motion Resume lookup changed the operation id')
  const replayed = await postJson(
    baseUrl,
    '/api/build-motion-strip',
    motionSourceRequest(motionSource, 'smoke_motion_cancel_queued', autoOptions)
  )
  assertCondition(replayed.id === queuedInitial.id, 'Motion operation replay created a duplicate job')
  const blockerJob = await pollJob(baseUrl, blockerInitial.id)
  assertCondition(blockerJob.status === 'done', `motion cancel blocker status: ${blockerJob.status}`)
  await releaseMotionUpload(baseUrl, motionSource.upload_id)
  await releaseMotionUpload(baseUrl, changedSource.upload_id)
  const releasedReplay = await postJson(
    baseUrl,
    '/api/build-motion-strip',
    motionSourceRequest(motionSource, 'smoke_motion_auto', autoOptions)
  )
  assertCondition(releasedReplay.id === motionAutoInitial.id, 'released Motion source replay changed the original job')
  const releasedNewResponse = await fetch(`${baseUrl}/api/build-motion-strip`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(motionSourceRequest(motionSource, 'smoke_motion_after_release', autoOptions)),
  })
  const releasedNewPayload = await releasedNewResponse.json()
  assertCondition(releasedNewResponse.status === 404, `released Motion source returned ${releasedNewResponse.status}`)
  assertCondition(releasedNewPayload.error === 'upload_not_found', 'released Motion source started a new operation')

  const tileSheet = await makeSceneTileSheetPng()
  const sceneResponse = await fetch(`${baseUrl}/api/process-scene-tiles`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      source_base64: tileSheet.toString('base64'),
      source_name: 'smoke_tileset.png',
      options: {
        identifier: 'smoke_scene',
        width: 3,
        height: 3,
        pattern: 'rule',
        seed: 7,
        density: 0.55,
        styleSnap: true,
        styleMaxColors: 16,
        edgeCondition: true,
        edgeBand: 3,
        edgeConditionMode: 'edge-aware-v1',
      },
    }),
  })
  assertCondition(sceneResponse.status === 202, `scene tile ingest returned ${sceneResponse.status}`)
  const sceneInitial = await sceneResponse.json()
  const sceneJob = await pollJob(baseUrl, sceneInitial.id)
  assertCondition(sceneJob.status === 'done', `scene tile ingest job status: ${sceneJob.status}`)
  assertCondition(Boolean(sceneJob.ldtk_project_url), 'scene tile ingest did not expose project.ldtk URL')
  assertCondition(Boolean(sceneJob.scene_pack_zip_url), 'scene tile ingest did not expose scene_pack.zip URL')
  assertCondition(Boolean(sceneJob.style_correction_url), 'scene tile ingest did not expose style_correction.json URL')
  assertCondition(Boolean(sceneJob.edge_conditioning_url), 'scene tile ingest did not expose edge_conditioning.json URL')
  assertCondition(Boolean(sceneJob.tile_conditioning_review_url), 'scene tile ingest did not expose tile_conditioning_review.json URL')
  const sceneQualityResponse = await fetch(`${baseUrl}${sceneJob.quality_gate_url}`)
  assertCondition(sceneQualityResponse.ok, `scene quality gate returned ${sceneQualityResponse.status}`)
  const sceneQuality = await sceneQualityResponse.json()
  assertCondition(sceneQuality.status === 'pass', `scene quality gate status: ${sceneQuality.status}`)
  assertCondition(sceneQuality.style_correction?.mode === 'palette_snap', 'scene style correction report was not attached')
  assertCondition(sceneQuality.edge_conditioning?.enabled === true, 'scene edge conditioning report was not attached')
  const tileMapResponse = await fetch(`${baseUrl}${sceneJob.tile_map_url}`)
  assertCondition(tileMapResponse.ok, `tile map returned ${tileMapResponse.status}`)
  const tileMap = await tileMapResponse.json()
  assertCondition(tileMap.arrangement?.seed === 7, `tile map seed mismatch: ${tileMap.arrangement?.seed}`)

  const twoPointFiveDSource = await makeTwoPointFiveDMaterialSourcePng()
  const tilesetResponse = await fetch(`${baseUrl}/api/build-two-point-five-d-tileset`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      material_source_base64: twoPointFiveDSource.toString('base64'),
      material_source_name: 'smoke_2_5d_material.png',
      options: {
        mapWidth: 5,
        mapHeight: 4,
        mapSolver: 'constraint',
        mapBorder: 'empty',
        mapSeed: 19,
        mapDensity: 0.5,
        editorOperations: [{ type: 'paint_terrain_rect', x: 2, y: 2, w: 1, h: 1 }],
      },
    }),
  })
  assertCondition(tilesetResponse.status === 202, `2.5D tileset returned ${tilesetResponse.status}`)
  const tilesetInitial = await tilesetResponse.json()
  const tilesetJob = await pollJob(baseUrl, tilesetInitial.id)
  assertCondition(tilesetJob.status === 'done', `2.5D tileset job status: ${tilesetJob.status}`)
  assertCondition(Boolean(tilesetJob.strict_atlas_png_url), '2.5D tileset did not expose strict atlas URL')
  assertCondition(Boolean(tilesetJob.map_editor_workflow_url), '2.5D tileset did not expose map editor workflow URL')
  assertCondition(Boolean(tilesetJob.ldtk_project_url), '2.5D tileset did not expose project.ldtk URL')
  assertCondition(Boolean(tilesetJob.ldtk_workflow_validation_url), '2.5D tileset did not expose LDtk workflow validation URL')
  assertCondition(Boolean(tilesetJob.workflow_release_evidence_url), '2.5D tileset did not expose release evidence URL')
  assertCondition(Boolean(tilesetJob.consumer_package_audit_url), '2.5D tileset did not expose consumer package audit URL')
  assertCondition(Boolean(tilesetJob.import_validation_url), '2.5D tileset did not expose import validation URL')
  assertCondition(Boolean(tilesetJob.release_demo_manifest_url), '2.5D tileset did not expose release demo manifest URL')
  assertCondition(Boolean(tilesetJob.release_demo_pack_zip_url), '2.5D tileset did not expose release demo pack URL')
  assertCondition(Boolean(tilesetJob.external_tool_probe_url), '2.5D tileset did not expose external tool probe URL')
  assertCondition(Boolean(tilesetJob.external_import_smoke_url), '2.5D tileset did not expose external import smoke URL')
  assertCondition(Boolean(tilesetJob.external_roundtrip_validation_url), '2.5D tileset did not expose external round-trip validation URL')
  assertCondition(Boolean(tilesetJob.external_roundtrip_checklist_md_url), '2.5D tileset did not expose external round-trip checklist URL')
  assertCondition(tilesetJob.consumer_package_audit_status === 'pass', `2.5D package audit status: ${tilesetJob.consumer_package_audit_status}`)
  assertCondition(tilesetJob.import_validation_status === 'pass', `2.5D import validation status: ${tilesetJob.import_validation_status}`)
  assertCondition(tilesetJob.release_demo_release_ready === true, '2.5D release demo pack is not release-ready')
  assertCondition(tilesetJob.external_import_smoke_status === 'pass', `2.5D external import smoke status: ${tilesetJob.external_import_smoke_status}`)
  assertCondition(tilesetJob.external_roundtrip_ready === true, '2.5D external round-trip is not ready for manual validation')
  const tilesetEvidenceResponse = await fetch(`${baseUrl}${tilesetJob.workflow_release_evidence_url}`)
  assertCondition(tilesetEvidenceResponse.ok, `2.5D release evidence returned ${tilesetEvidenceResponse.status}`)
  const tilesetEvidence = await tilesetEvidenceResponse.json()
  assertCondition(tilesetEvidence.release_ready === true, '2.5D release evidence is not release-ready')
  assertCondition(tilesetEvidence.editor?.operation_count === 1, `2.5D editor op count mismatch: ${tilesetEvidence.editor?.operation_count}`)
  assertCondition(tilesetEvidence.ldtk?.workflow_validation_status === 'pass', `2.5D LDtk workflow status: ${tilesetEvidence.ldtk?.workflow_validation_status}`)
  const tilesetImportResponse = await fetch(`${baseUrl}${tilesetJob.import_validation_url}`)
  assertCondition(tilesetImportResponse.ok, `2.5D import validation returned ${tilesetImportResponse.status}`)
  const tilesetImport = await tilesetImportResponse.json()
  assertCondition(tilesetImport.static_checks?.tiled?.status === 'pass', `2.5D Tiled import status: ${tilesetImport.static_checks?.tiled?.status}`)
  assertCondition(tilesetImport.static_checks?.ldtk?.status === 'pass', `2.5D LDtk import status: ${tilesetImport.static_checks?.ldtk?.status}`)
  const tilesetRoundtripResponse = await fetch(`${baseUrl}${tilesetJob.external_roundtrip_validation_url}`)
  assertCondition(tilesetRoundtripResponse.ok, `2.5D external round-trip validation returned ${tilesetRoundtripResponse.status}`)
  const tilesetRoundtrip = await tilesetRoundtripResponse.json()
  assertCondition(tilesetRoundtrip.ready_for_manual_roundtrip === true, '2.5D external round-trip evidence is not manual-ready')
  const tilesetZipResponse = await fetch(`${baseUrl}${tilesetJob.release_demo_pack_zip_url}`)
  assertCondition(tilesetZipResponse.ok, `2.5D release demo pack returned ${tilesetZipResponse.status}`)
  const tilesetZip = Buffer.from(await tilesetZipResponse.arrayBuffer())
  assertCondition(tilesetZip.subarray(0, 2).toString('ascii') === 'PK', '2.5D release demo pack did not return ZIP bytes')

  const fixture = await readFile('test/fixtures/character-pack/topdown_rpg_v0_sample_hero.png')
  const characterResponse = await fetch(`${baseUrl}/api/process-sheet`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      source_base64: fixture.toString('base64'),
      options: {
        name: 'smoke_hero',
        backgroundMode: 'flood',
        styleReport: true,
      },
    }),
  })
  assertCondition(characterResponse.status === 202, `character process returned ${characterResponse.status}`)
  const characterInitial = await characterResponse.json()
  const characterJob = await pollJob(baseUrl, characterInitial.id)
  assertCondition(characterJob.status === 'done', `character process job status: ${characterJob.status}`)
  assertCondition(Boolean(characterJob.zip_url), 'character process did not expose character_pack.zip URL')

  const projectResponse = await fetch(`${baseUrl}/api/project-pack`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectId: 'smoke_project',
      characterJobId: characterJob.id,
      sceneJobId: sceneJob.id,
    }),
  })
  assertCondition(projectResponse.status === 202, `project pack returned ${projectResponse.status}`)
  const projectInitial = await projectResponse.json()
  const projectJob = await pollJob(baseUrl, projectInitial.id)
  assertCondition(projectJob.status === 'done', `project pack job status: ${projectJob.status}`)
  assertCondition(Boolean(projectJob.project_manifest_url), 'project pack did not expose project_manifest.json URL')
  assertCondition(Boolean(projectJob.project_validation_url), 'project pack did not expose project_validation.json URL')
  assertCondition(Boolean(projectJob.project_pack_zip_url), 'project pack did not expose project_pack.zip URL')
  const projectValidationResponse = await fetch(`${baseUrl}${projectJob.project_validation_url}`)
  assertCondition(projectValidationResponse.ok, `project validation returned ${projectValidationResponse.status}`)
  const projectValidation = await projectValidationResponse.json()
  const allowedProjectStyleWarnings = new Set([
    'character_style_palette_mismatch',
    'scene_style_palette_mismatch',
  ])
  const unexpectedProjectWarnings = (projectValidation.warnings ?? [])
    .filter((warning) => !allowedProjectStyleWarnings.has(warning))
  assertCondition(projectValidation.status !== 'fail', `project validation status: ${projectValidation.status}`)
  assertCondition(unexpectedProjectWarnings.length === 0, `unexpected project warnings: ${unexpectedProjectWarnings.join(', ')}`)
  const projectZipResponse = await fetch(`${baseUrl}${projectJob.project_pack_zip_url}`)
  assertCondition(projectZipResponse.ok, `project zip returned ${projectZipResponse.status}`)
  const projectZip = Buffer.from(await projectZipResponse.arrayBuffer())
  assertCondition(projectZip.subarray(0, 2).toString('ascii') === 'PK', 'project zip did not return ZIP bytes')

  const strictProjectResponse = await fetch(`${baseUrl}/api/project-pack`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectId: 'smoke_project_strict',
      characterJobId: characterJob.id,
      sceneJobId: sceneJob.id,
      strictStyleContract: true,
    }),
  })
  assertCondition(strictProjectResponse.status === 202, `strict project pack returned ${strictProjectResponse.status}`)
  const strictProjectInitial = await strictProjectResponse.json()
  const strictProjectJob = await pollJob(baseUrl, strictProjectInitial.id)
  assertCondition(strictProjectJob.status === 'failed_project_pack', `strict project pack job status: ${strictProjectJob.status}`)
  assertCondition(strictProjectJob.reason === 'style_contract_failed', `strict project pack reason: ${strictProjectJob.reason}`)

  console.log(`V8 local smoke passed: tabs markup, editor shell, exclusive three-atlas action repair wiring, retired repair runtimes absent, AI provider state, GIF API (${gif.length} bytes), Motion upload/Preview/Auto/Manual/cancel/resume, scene/project/2.5D APIs`)
} catch (error) {
  console.error(error.message || error)
  process.exit(1)
}
