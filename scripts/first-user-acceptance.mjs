#!/usr/bin/env node
import { readFile } from 'node:fs/promises'

import {
  MOTION_TARGET_FRAME_INDEXES,
  acceptanceAssert,
  acceptanceLoopbackUrl,
  buildDeterministicMotionZip,
  changedSheetCellIndexes,
  inspectAcceptancePackages,
  pngRgbaEqual,
} from './first-user-acceptance-helpers.mjs'

const TERMINAL_JOB_STATUSES = new Set([
  'done',
  'failed_quality_gate',
  'failed_project_pack',
  'failed_post_processing',
  'failed_model_error',
  'failed_safety_filter',
])

function argValue(name, fallback) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] || fallback : fallback
}

const baseUrl = acceptanceLoopbackUrl(
  argValue('--base-url', 'http://127.0.0.1:4173')
)
const requests = []

async function localFetch(pathname, options = {}) {
  const url = new URL(pathname, baseUrl)
  acceptanceAssert(url.origin === baseUrl.origin, `Acceptance request escaped the local origin: ${url}`)
  requests.push({ method: options.method ?? 'GET', pathname: url.pathname })
  return fetch(url, options)
}

async function fetchJson(pathname, options = {}) {
  const response = await localFetch(pathname, options)
  const payload = await response.json().catch(() => ({}))
  acceptanceAssert(
    response.ok,
    `${options.method ?? 'GET'} ${pathname} returned ${response.status}: ${payload.reason || payload.error || 'unknown error'}`
  )
  return payload
}

async function postJson(pathname, body) {
  return fetchJson(pathname, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function fetchBuffer(pathname) {
  const response = await localFetch(pathname)
  acceptanceAssert(response.ok, `GET ${pathname} returned ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

async function pollJob(initial) {
  let current = initial
  for (let attempt = 0; attempt < 240; attempt += 1) {
    if (TERMINAL_JOB_STATUSES.has(current?.status)) return current
    acceptanceAssert(current?.id, 'Job response did not contain an id')
    await new Promise((resolve) => setTimeout(resolve, 250))
    current = await fetchJson(`/api/jobs/${encodeURIComponent(current.id)}`)
  }
  throw new Error(`Job polling exceeded 60 seconds: ${initial?.id ?? 'unknown'}`)
}

async function processSheet(sourcePng, options) {
  const initial = await postJson('/api/process-sheet', {
    source_base64: sourcePng.toString('base64'),
    source_black_base64: null,
    options,
  })
  return pollJob(initial)
}

async function uploadMotionZip(bytes) {
  const operationId = 'first_user_motion_upload_v1'
  const sourceName = 'sample_hero_walk_acceptance.zip'
  const query = new URLSearchParams({
    source_name: sourceName,
    operation_id: operationId,
  })
  const response = await localFetch(`/api/motion-source/uploads?${query}`, {
    method: 'POST',
    headers: { 'content-type': 'application/zip' },
    body: bytes,
  })
  const payload = await response.json().catch(() => ({}))
  acceptanceAssert(response.status === 201, `Motion upload returned ${response.status}`)
  acceptanceAssert(payload.operation_id === operationId, 'Motion upload operation id changed')
  acceptanceAssert(payload.source_name === sourceName, 'Motion upload source name changed')
  acceptanceAssert(payload.byte_length === bytes.length, 'Motion upload byte length changed')
  acceptanceAssert(/^sha256:[a-f0-9]{64}$/.test(payload.source_identity ?? ''), 'Motion upload identity is invalid')
  acceptanceAssert(payload.upload_id, 'Motion upload id is missing')
  return payload
}

function motionRequest(source, operationId, options) {
  return {
    source_upload_id: source.upload_id,
    source_identity: source.source_identity,
    operation_id: operationId,
    options,
  }
}

async function releaseMotionUpload(uploadId) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const payload = await fetchJson(
      `/api/motion-source/uploads/${encodeURIComponent(uploadId)}`,
      { method: 'DELETE' }
    )
    if (!payload.pending) {
      acceptanceAssert(payload.released === true, 'Motion upload did not report released')
      return payload
    }
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`Motion upload release remained pending: ${uploadId}`)
}

function assertManagedJobArtifact(job, field, fileName) {
  acceptanceAssert(
    job?.[field] === `/generated/${job.id}/${fileName}`,
    `${field} is missing or not bound to job ${job?.id}`
  )
}

function assertExportableValidation(report, label) {
  const validation = report?.validation
  acceptanceAssert(
    validation && typeof validation === 'object' && !Array.isArray(validation),
    `${label} validation evidence is missing`
  )
  acceptanceAssert(
    ['pass', 'warning'].includes(validation.status),
    `${label} validation status is not exportable: ${validation.status ?? 'missing'}`
  )
  acceptanceAssert(
    Array.isArray(validation.blocking_errors) && validation.blocking_errors.length === 0,
    `${label} validation is blocked or malformed`
  )
  acceptanceAssert(
    Array.isArray(validation.warnings),
    `${label} validation warnings are malformed`
  )
}

const initialOptions = Object.freeze({
  name: 'Sample Hero Acceptance',
  description: 'provider-free first-user acceptance',
  createdAt: '2026-07-18T00:00:00.000Z',
  sourceType: 'acceptance_fixture',
  sourceFileName: 'topdown_rpg_v0_sample_hero.png',
  sourceLayout: 'topdown_rpg_v0',
  backgroundMode: 'flood',
  backgroundTolerance: 24,
  componentCleanup: true,
  cleanupMinAlpha: 18,
  componentCleanupMinArea: 4,
  componentCleanupMinAreaRatio: 0,
  autoCorrect: true,
  motionStabilize: true,
  motionStabilizationMaxShift: 2,
  pixelFinishing: false,
  styleReport: true,
  styleMaxColors: 16,
  outputFrameSizes: [96, 64, 48, 32, 16],
})

const motionOptions = Object.freeze({
  action: 'walk_down',
  frames: 4,
  selection_mode: 'auto',
  motion_selection: {
    recipe: 'motion_selection_recipe_v2',
    loop_expectation: 'auto',
    temporal_matte: 'disabled',
  },
  stride: 1,
  fps: 10,
  maxFrames: 6,
  startSec: 0,
  endSec: null,
  background: {
    method: 'key_color',
    key_color: [255, 255, 255],
    tolerance: 24,
    defringe: true,
  },
  anchor_policy: { static_offset_y: 0 },
  pixel_grid_refinement: { recipe: 'pixel_grid_v2_balanced' },
  output_profile: { resample_strategy: 'reject_mismatch' },
})

let motionUpload = null
try {
  const provider = await fetchJson('/api/gemini-state')
  acceptanceAssert(provider.available === false, 'Provider credentials are available during zero-call acceptance')
  acceptanceAssert(provider.runtime_configured === false, 'A browser-session Provider is configured during acceptance')
  acceptanceAssert(
    (provider.presets ?? []).every((preset) => preset.available === false),
    'At least one Provider preset is available during acceptance'
  )

  const homepage = await localFetch('/')
  acceptanceAssert(homepage.ok, `Homepage returned ${homepage.status}`)
  const html = await homepage.text()
  acceptanceAssert(html.includes('id="motion-guide-build-engine-packs"'), 'Motion engine package action is missing')
  acceptanceAssert(html.includes('value="passthrough"'), 'Canonical Character alpha mode is missing')
  acceptanceAssert(!html.includes('id="character-pack-export-1x"'), 'Disconnected export scale controls remain active')

  const fixture = await readFile('test/fixtures/character-pack/topdown_rpg_v0_sample_hero.png')
  const initialJob = await processSheet(fixture, initialOptions)
  acceptanceAssert(initialJob.status === 'done', `Initial Character job status: ${initialJob.status}`)
  for (const [field, fileName] of [
    ['normalized_sheet_url', 'normalized_sheet.png'],
    ['debug_report_url', 'debug_report.json'],
    ['zip_url', 'character_pack.zip'],
    ['godot_npc_zip_url', 'godot_npc_pack.zip'],
    ['rpgmaker_zip_url', 'rpgmaker_pack.zip'],
    ['ocad_zip_url', 'ocad_pack.zip'],
  ]) assertManagedJobArtifact(initialJob, field, fileName)
  const initialReport = await fetchJson(initialJob.debug_report_url)
  acceptanceAssert(initialReport.profile === 'topdown_rpg_v0', 'Initial Character profile is incorrect')
  acceptanceAssert(initialReport.component_cleanup?.enabled === true, 'Component cleanup did not run')
  acceptanceAssert(initialReport.normalization?.auto_correction?.enabled === true, 'Auto-correction did not run')
  acceptanceAssert(initialReport.normalization?.motion_stabilization?.enabled === true, 'Motion stabilization did not run')
  acceptanceAssert(initialReport.pixel_style?.mode === 'report_only', 'Pixel style evidence did not run')
  assertExportableValidation(initialReport, 'Initial Character')
  const initialSheet = await fetchBuffer(initialJob.normalized_sheet_url)

  const firstMotionZip = await buildDeterministicMotionZip(initialSheet)
  const secondMotionZip = await buildDeterministicMotionZip(initialSheet)
  acceptanceAssert(firstMotionZip.equals(secondMotionZip), 'Motion ZIP construction is not deterministic')
  motionUpload = await uploadMotionZip(firstMotionZip)

  const previewInitial = await postJson(
    '/api/preview-motion-frames',
    motionRequest(motionUpload, 'first_user_motion_preview_v1', motionOptions)
  )
  const previewJob = await pollJob(previewInitial)
  acceptanceAssert(previewJob.status === 'done', `Motion Preview status: ${previewJob.status}`)
  assertManagedJobArtifact(previewJob, 'frame_preview_index_url', 'frame_preview_index.json')
  const previewIndex = await fetchJson(previewJob.frame_preview_index_url)
  acceptanceAssert(previewIndex.default_selection_mode === 'auto', 'Motion Preview did not preserve Auto authority')

  const buildInitial = await postJson(
    '/api/build-motion-strip',
    motionRequest(motionUpload, 'first_user_motion_build_v1', motionOptions)
  )
  const buildJob = await pollJob(buildInitial)
  acceptanceAssert(buildJob.status === 'done', `Motion Build status: ${buildJob.status}`)
  acceptanceAssert(buildJob.operation_id === 'first_user_motion_build_v1', 'Motion Build operation id changed')
  acceptanceAssert(buildJob.source_identity === motionUpload.source_identity, 'Motion Build source identity changed')
  assertManagedJobArtifact(buildJob, 'normalized_motion_strip_url', 'normalized_motion_strip.png')
  assertManagedJobArtifact(buildJob, 'motion_source_report_url', 'motion_source_report.json')
  const buildReport = await fetchJson(buildJob.motion_source_report_url)
  acceptanceAssert(buildReport.requested_selection_mode === 'auto', 'Motion Build did not request Auto selection')
  acceptanceAssert(buildReport.effective_selection_mode === 'auto', 'Motion Build did not execute Auto selection')
  acceptanceAssert(buildReport.selected_frame_count === 4, 'Motion Build did not select four frames')
  acceptanceAssert(buildReport.frame_selection?.mode === 'motion_selection_report_v2', 'Motion Selection v2 evidence is missing')
  acceptanceAssert(buildReport.frame_selection?.target?.target_satisfied === true, 'Motion target frame count was not satisfied')
  acceptanceAssert(buildReport.pixel_grid_refinement?.schema_version === 2, 'Pixel Grid v2 schema evidence is missing')
  acceptanceAssert(buildReport.pixel_grid_refinement?.mode === 'pixel_grid_refinement_v2', 'Pixel Grid v2 did not execute')
  acceptanceAssert(buildReport.pixel_grid_refinement?.recipe?.id === 'pixel_grid_v2_balanced', 'Pixel Grid recipe changed')
  const strip = await fetchBuffer(buildJob.normalized_motion_strip_url)

  const applyInitial = await postJson('/api/apply-motion-strip', {
    sheet_base64: initialSheet.toString('base64'),
    strip_base64: strip.toString('base64'),
    options: {
      action: 'walk_down',
      output_profile: { resample_strategy: 'reject_mismatch' },
    },
  })
  const applyJob = await pollJob(applyInitial)
  acceptanceAssert(applyJob.status === 'done', `Motion Apply status: ${applyJob.status}`)
  assertManagedJobArtifact(applyJob, 'applied_normalized_sheet_url', 'applied_normalized_sheet.png')
  assertManagedJobArtifact(applyJob, 'apply_motion_strip_report_url', 'apply_motion_strip_report.json')
  const applyReport = await fetchJson(applyJob.apply_motion_strip_report_url)
  acceptanceAssert(applyReport.mode === 'apply_motion_strip_report_v1', 'Motion Apply report mode changed')
  acceptanceAssert(applyReport.profile_id === 'topdown_rpg_v0', 'Motion Apply profile changed')
  acceptanceAssert(applyReport.status === 'done', 'Motion Apply report is not done')
  assertExportableValidation(applyReport, 'Motion Apply')
  acceptanceAssert(
    JSON.stringify(applyReport.target_frame_indexes) === JSON.stringify(MOTION_TARGET_FRAME_INDEXES),
    'Motion Apply target indexes changed'
  )
  const appliedSheet = await fetchBuffer(applyJob.applied_normalized_sheet_url)
  const applyChangedCells = await changedSheetCellIndexes(initialSheet, appliedSheet)
  acceptanceAssert(
    applyChangedCells.length > 0 &&
      applyChangedCells.every((index) => MOTION_TARGET_FRAME_INDEXES.includes(index)),
    `Motion Apply changed unexpected cells: ${applyChangedCells.join(',')}`
  )

  const finalOptions = {
    ...initialOptions,
    description: 'provider-free motion-applied acceptance result',
    sourceType: 'motion_source_apply',
    sourceFileName: 'applied_normalized_sheet.png',
    backgroundMode: 'passthrough',
    componentCleanup: false,
    autoCorrect: false,
    motionStabilize: false,
    pixelFinishing: false,
  }
  const finalJob = await processSheet(appliedSheet, finalOptions)
  acceptanceAssert(finalJob.status === 'done', `Final Character job status: ${finalJob.status}`)
  for (const [field, fileName] of [
    ['normalized_sheet_url', 'normalized_sheet.png'],
    ['debug_report_url', 'debug_report.json'],
    ['zip_url', 'character_pack.zip'],
    ['godot_npc_zip_url', 'godot_npc_pack.zip'],
    ['rpgmaker_zip_url', 'rpgmaker_pack.zip'],
    ['ocad_zip_url', 'ocad_pack.zip'],
  ]) assertManagedJobArtifact(finalJob, field, fileName)
  const finalReport = await fetchJson(finalJob.debug_report_url)
  assertExportableValidation(finalReport, 'Final Character')
  acceptanceAssert(finalReport.profile === 'topdown_rpg_v0', 'Final Character profile changed')
  acceptanceAssert(finalReport.source_layout?.id === 'topdown_rpg_v0', 'Final Character source layout changed')
  acceptanceAssert(finalReport.requested_background_mode === 'passthrough', 'Final Character background mode changed')
  acceptanceAssert(finalReport.component_cleanup?.enabled === false, 'Final Character component cleanup was not disabled')
  acceptanceAssert(finalReport.normalization?.auto_correction?.enabled === false, 'Final Character auto-correction was not disabled')
  acceptanceAssert(finalReport.normalization?.motion_stabilization?.enabled === false, 'Final Character motion stabilization was not disabled')
  acceptanceAssert(finalReport.pixel_style?.mode === 'report_only', 'Final Character pixel style evidence changed')
  const finalSheet = await fetchBuffer(finalJob.normalized_sheet_url)
  const finalChangedCells = await changedSheetCellIndexes(initialSheet, finalSheet)
  acceptanceAssert(
    finalChangedCells.some((index) => MOTION_TARGET_FRAME_INDEXES.includes(index)),
    'Motion changes did not survive final Character processing'
  )

  const packages = await inspectAcceptancePackages({
    characterZip: await fetchBuffer(finalJob.zip_url),
    godotZip: await fetchBuffer(finalJob.godot_npc_zip_url),
    rpgMakerZip: await fetchBuffer(finalJob.rpgmaker_zip_url),
    ocadZip: await fetchBuffer(finalJob.ocad_zip_url),
    finalNormalizedSheetPng: finalSheet,
  })

  const allowedRequestPath = (pathname) =>
    pathname === '/' ||
    pathname === '/api/gemini-state' ||
    pathname === '/api/process-sheet' ||
    pathname === '/api/preview-motion-frames' ||
    pathname === '/api/build-motion-strip' ||
    pathname === '/api/apply-motion-strip' ||
    /^\/api\/jobs\/[^/]+$/.test(pathname) ||
    /^\/api\/motion-source\/uploads(?:\/[^/]+)?$/.test(pathname) ||
    /^\/generated\/[^/]+\/[^/]+$/.test(pathname)
  const unexpectedRequests = requests.filter(({ pathname }) => !allowedRequestPath(pathname))
  acceptanceAssert(
    unexpectedRequests.length === 0,
    `Acceptance client reached an unapproved endpoint: ${unexpectedRequests.map((item) => item.pathname).join(',')}`
  )
  console.log(JSON.stringify({
    mode: 'provider_free_first_user_acceptance_v1',
    status: 'pass',
    provider_available: false,
    provider_calls: 0,
    initial_character_job_id: initialJob.id,
    motion_preview_job_id: previewJob.id,
    motion_build_job_id: buildJob.id,
    motion_apply_job_id: applyJob.id,
    final_character_job_id: finalJob.id,
    apply_changed_cells: applyChangedCells,
    final_changed_cells: finalChangedCells,
    applied_final_rgba_exact: await pngRgbaEqual(appliedSheet, finalSheet),
    packages,
    local_request_count: requests.length,
  }, null, 2))
} finally {
  if (motionUpload?.upload_id) await releaseMotionUpload(motionUpload.upload_id)
}
