import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { copyFile, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import JSZip from 'jszip'

import {
  applyDeterministicPixelMatteV2,
  BACKGROUND_MATTE_V2_ALGORITHM,
  BACKGROUND_MATTE_V2_ARTIFACT_FILES,
  buildBackgroundMatteV2ArtifactBundle,
} from '../src/character-pack/backgroundMatteV2.js'
import { loadRgba } from '../src/character-pack/imageCodec.js'
import { acceptFullSheetGeneration } from '../src/server/fullSheetGenerationAcceptance.js'

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  })
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

const DYNAMIC_STANDALONE_PUBLICATION_FILES = new Set([
  'character_pack.zip',
  'generation.json',
  'generation_release_gate.json',
  'manual_acceptance.json',
  'metadata.json',
])

const DYNAMIC_CHARACTER_PACK_ENTRIES = new Set([
  'generation.json',
  'generation_release_gate.json',
  'manual_acceptance.json',
  'metadata.json',
])

async function listRelativeRegularFiles(root, relativeDir = '') {
  const files = []
  const directory = relativeDir ? path.join(root, relativeDir) : root
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relativePath = relativeDir
      ? path.posix.join(relativeDir, entry.name)
      : entry.name
    if (entry.isDirectory()) {
      files.push(...await listRelativeRegularFiles(root, relativePath))
    } else if (entry.isFile()) {
      files.push(relativePath)
    }
  }
  return files.sort()
}

async function unusedProviderEndpoint() {
  const requests = []
  const server = http.createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    requests.push({ url: req.url, body: Buffer.concat(chunks) })
    res.writeHead(500, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: { message: 'provider must not be called by this test' } }))
  })
  const port = await listen(server)
  return { server, requests, url: `http://127.0.0.1:${port}/v1beta` }
}

async function successfulProviderEndpoint(png) {
  const requests = []
  const server = http.createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    requests.push({ url: req.url, body: Buffer.concat(chunks) })
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({
      candidates: [{
        content: {
          parts: [{ inlineData: { mimeType: 'image/png', data: png.toString('base64') } }],
        },
      }],
    }))
  })
  const port = await listen(server)
  return { server, requests, url: `http://127.0.0.1:${port}/v1beta` }
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

async function fetchJson(baseUrl, pathname, options) {
  const response = await fetch(new URL(pathname, baseUrl), options)
  const text = await response.text()
  const json = text ? JSON.parse(text) : {}
  if (!response.ok) throw new Error(`${pathname} returned ${response.status}: ${text}`)
  return json
}

async function waitForJob(baseUrl, jobId) {
  const terminal = new Set([
    'done',
    'failed_quality_gate',
    'failed_safety_filter',
    'failed_model_error',
    'failed_post_processing',
  ])
  let job = await fetchJson(baseUrl, `/api/jobs/${jobId}`)
  for (let index = 0; !terminal.has(job.status) && index < 240; index++) {
    await new Promise((resolve) => setTimeout(resolve, 25))
    job = await fetchJson(baseUrl, `/api/jobs/${jobId}`)
  }
  return job
}

async function copyGenerationReviewDirectory({ sourceRoot, targetRoot, reviewId }) {
  const sourceDir = path.join(sourceRoot, reviewId)
  const targetDir = path.join(targetRoot, reviewId)
  await mkdir(targetDir)
  const fixedFiles = [
    'generation_review.json',
    'generation_request_manifest.json',
    'generation_reference_manifest.json',
    'generation_prompt.txt',
  ]
  for (const file of fixedFiles) {
    await copyFile(path.join(sourceDir, file), path.join(targetDir, file))
  }
  const referenceManifest = JSON.parse(
    await readFile(path.join(sourceDir, 'generation_reference_manifest.json'), 'utf8'),
  )
  for (const item of referenceManifest.items) {
    await copyFile(path.join(sourceDir, item.name), path.join(targetDir, item.name))
  }
}

test('reviewed live generation verifies and calls the Provider with one immutable environment snapshot', async () => {
  const source = await readFile(new URL('../server.js', import.meta.url), 'utf8')
  const start = source.indexOf('async function handleGenerateCharacter(req, res)')
  const end = source.indexOf('\nasync function handleAcceptGeneratedCharacter', start)
  assert.ok(start >= 0 && end > start)
  const handler = source.slice(start, end)
  assert.match(handler, /const providerEnv = Object\.freeze\(currentProviderEnv\(\)\)/)
  assert.match(handler, /verifyFullSheetGenerationReview\(body, \{ providerEnv \}\)/)
  assert.match(handler, /env: providerEnv/)
})

test('full-sheet Review endpoint seals provider-free artifacts and stale live input consumes zero calls', async (t) => {
  const provider = await unusedProviderEndpoint()
  t.after(() => provider.server.close())

  const portProbe = http.createServer()
  const appPort = await listen(portProbe)
  portProbe.close()
  await once(portProbe, 'close')

  const providerPresets = JSON.stringify([{
    id: 'strict-gemini-native',
    provider: 'gemini',
    apiKeyEnv: 'STRICT_GEMINI_TEST_KEY',
    model: 'gemini-3.1-flash-image-preview',
    baseUrl: provider.url,
    image_size: '2K',
    aspect_ratio: '1:1',
  }])
  const child = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(appPort),
      STRICT_GEMINI_TEST_KEY: 'test-only-key',
      CHARACTER_PROVIDER_PRESETS: providerPresets,
      CHARACTER_DEFAULT_PROVIDER: 'strict-gemini-native',
      CHARACTER_JOB_CONCURRENCY: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  t.after(() => child.kill())
  await waitForServer(child)

  const baseUrl = `http://127.0.0.1:${appPort}`
  const runId = `generation_review_test_${process.pid}_${Date.now()}`
  const review = await fetchJson(baseUrl, '/api/generate-character/review', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      runId,
      generationProfileId: 'full_sheet_fixed_region_v1',
      providerPresetId: 'strict-gemini-native',
      description: 'one copper-haired ranger in a green coat',
      imageConfig: { image_size: '2K', aspect_ratio: '1:1' },
      generationOptions: { candidateCount: 1, seed: 7 },
      maxProviderCalls: 1,
    }),
  })

  assert.equal(review.status, 'done')
  assert.equal(review.provider_calls_used, 0)
  assert.equal(review.estimated_provider_calls, 1)
  assert.equal(review.provider.route_kind, 'google_native')
  assert.equal(review.model, 'gemini-3.1-flash-image-preview')
  assert.deepEqual(review.image_config, { image_size: '2K', aspect_ratio: '1:1' })
  assert.deepEqual(review.reference_urls.map((item) => item.role), ['structure'])
  assert.equal(provider.requests.length, 0)

  const structureResponse = await fetch(new URL(review.reference_urls[0].url, baseUrl))
  assert.equal(structureResponse.ok, true)
  const structure = await loadRgba(Buffer.from(await structureResponse.arrayBuffer()))
  assert.deepEqual({ width: structure.width, height: structure.height }, { width: 1024, height: 1024 })

  const requestManifest = await fetchJson(baseUrl, review.generation_request_manifest_url)
  const referenceManifest = await fetchJson(baseUrl, review.generation_reference_manifest_url)
  assert.equal(requestManifest.plan_hash, review.plan_hash)
  assert.equal(requestManifest.reference_manifest_sha256, review.reference_manifest_sha256)
  assert.equal(requestManifest.prompt_contract.contract_version, 'character_prompt_contract_v1_18')
  assert.equal(requestManifest.provider.route_kind, 'google_native')
  assert.equal(requestManifest.provider.supports_image_size, true)
  assert.match(requestManifest.provider.provider_endpoint_sha256, /^[a-f0-9]{64}$/)
  assert.equal(requestManifest.generation_profile.background_recipe_id, BACKGROUND_MATTE_V2_ALGORITHM)
  assert.deepEqual(requestManifest.request_input.background_mode_contract, {
    requested: BACKGROUND_MATTE_V2_ALGORITHM,
    canonical: BACKGROUND_MATTE_V2_ALGORITHM,
    recipe_id: BACKGROUND_MATTE_V2_ALGORITHM,
  })
  assert.equal(JSON.stringify(requestManifest).includes('test-only-key'), false)
  assert.equal(JSON.stringify(requestManifest).includes(provider.url), false)
  assert.deepEqual(referenceManifest.items.map((item) => item.role), ['structure'])

  const stale = await fetchJson(baseUrl, '/api/generate-character', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      generationProfileId: 'full_sheet_fixed_region_v1',
      reviewedRunId: review.reviewed_run_id,
      expectedPlanHash: '0'.repeat(64),
      expectedReferenceManifestSha256: review.reference_manifest_sha256,
      confirmLiveGeneration: true,
      maxProviderCalls: 1,
    }),
  })
  assert.equal(stale.status, 'failed_model_error')
  assert.match(stale.reason, /Review binding is stale/)
  assert.equal(provider.requests.length, 0)

  const changedDescription = await fetchJson(baseUrl, '/api/generate-character', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      generationProfileId: 'full_sheet_fixed_region_v1',
      reviewedRunId: review.reviewed_run_id,
      expectedPlanHash: review.plan_hash,
      expectedReferenceManifestSha256: review.reference_manifest_sha256,
      confirmLiveGeneration: true,
      maxProviderCalls: 1,
      description: 'a changed character description',
    }),
  })
  assert.equal(changedDescription.status, 'failed_model_error')
  assert.match(changedDescription.reason, /description changed after Review/)
  assert.equal(provider.requests.length, 0)

  const changedNestedGenerationOptions = await fetchJson(baseUrl, '/api/generate-character', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      generationProfileId: 'full_sheet_fixed_region_v1',
      reviewedRunId: review.reviewed_run_id,
      expectedPlanHash: review.plan_hash,
      expectedReferenceManifestSha256: review.reference_manifest_sha256,
      confirmLiveGeneration: true,
      maxProviderCalls: 1,
      options: { seed: 8 },
    }),
  })
  assert.equal(changedNestedGenerationOptions.status, 'failed_model_error')
  assert.match(changedNestedGenerationOptions.reason, /generation options changed after Review/)
  assert.equal(provider.requests.length, 0)
})

test('strict full-sheet live generation completes as review-required after one successful provider response', async (t) => {
  const source = await readFile(new URL('../templates/motion_template_ocad_primary.png', import.meta.url))
  const provider = await successfulProviderEndpoint(source)
  t.after(() => provider.server.close())

  const portProbe = http.createServer()
  const appPort = await listen(portProbe)
  portProbe.close()
  await once(portProbe, 'close')

  const providerPresets = JSON.stringify([{
    id: 'strict-gemini-native-review',
    provider: 'gemini',
    apiKeyEnv: 'STRICT_GEMINI_REVIEW_TEST_KEY',
    model: 'gemini-3.1-flash-image-preview',
    baseUrl: provider.url,
    image_size: '2K',
    aspect_ratio: '1:1',
  }])
  const child = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(appPort),
      STRICT_GEMINI_REVIEW_TEST_KEY: 'test-only-key',
      CHARACTER_PROVIDER_PRESETS: providerPresets,
      CHARACTER_DEFAULT_PROVIDER: 'strict-gemini-native-review',
      CHARACTER_JOB_CONCURRENCY: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  t.after(() => child.kill())
  await waitForServer(child)

  const baseUrl = `http://127.0.0.1:${appPort}`
  const review = await fetchJson(baseUrl, '/api/generate-character/review', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      runId: `generation_manual_review_test_${process.pid}_${Date.now()}`,
      generationProfileId: 'full_sheet_fixed_region_v1',
      providerPresetId: 'strict-gemini-native-review',
      description: 'one original compact forest ranger',
      generationOptions: { candidateCount: 1 },
      maxProviderCalls: 1,
    }),
  })
  assert.equal(provider.requests.length, 0)

  const initial = await fetchJson(baseUrl, '/api/generate-character', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      generationProfileId: 'full_sheet_fixed_region_v1',
      reviewedRunId: review.reviewed_run_id,
      expectedPlanHash: review.plan_hash,
      expectedReferenceManifestSha256: review.reference_manifest_sha256,
      confirmLiveGeneration: true,
      maxProviderCalls: 1,
    }),
  })
  const job = await waitForJob(baseUrl, initial.id)

  assert.equal(provider.requests.length, 1)
  assert.equal(job.status, 'done')
  assert.equal(job.artifact_disposition, 'review_required')
  assert.equal(job.release_ready, false)
  assert.equal(job.manual_review_required, true)
  assert.equal(job.review_status, 'awaiting_human_review')
  assert.equal(job.human_decision_status, 'pending')
  assert.equal(job.failure_status, null)
  assert.equal(job.reason, null)
  assert.deepEqual(job.provider_call_budget, {
    planned_provider_calls: 1,
    max_provider_calls: 1,
    used_provider_calls: 1,
  })
  assert.ok(job.source_url)
  assert.equal(job.raw_provider_output_url, `/generated/${job.id}/raw_provider_output.png`)
  assert.equal(
    job.background_removed_provider_output_url,
    `/generated/${job.id}/background_removed_provider_output.png`,
  )
  assert.equal(job.background_quality_url, `/generated/${job.id}/background_quality.json`)
  assert.equal(job.background_review_url, `/generated/${job.id}/background_review.json`)
  assert.equal(job.background_contract_masks_url, `/generated/${job.id}/background_contract_masks.json`)
  assert.equal(job.background_preview_url, `/generated/${job.id}/background_preview.png`)
  assert.equal(job.background_spill_overlay_url, `/generated/${job.id}/background_spill_overlay.png`)
  assert.ok(job.normalized_sheet_url)
  assert.ok(job.source_subject_count_overlay_url)
  assert.equal(job.zip_url, undefined)

  const rawProviderResponse = await fetch(`${baseUrl}${job.raw_provider_output_url}`)
  assert.equal(rawProviderResponse.status, 200)
  assert.deepEqual(Buffer.from(await rawProviderResponse.arrayBuffer()), source)

  const backgroundRemovedResponse = await fetch(
    `${baseUrl}${job.background_removed_provider_output_url}`,
  )
  assert.equal(backgroundRemovedResponse.status, 200)
  const backgroundRemovedBuffer = Buffer.from(await backgroundRemovedResponse.arrayBuffer())
  const backgroundRemovedImage = await loadRgba(backgroundRemovedBuffer)
  assert.deepEqual(
    { width: backgroundRemovedImage.width, height: backgroundRemovedImage.height },
    { width: 252, height: 252 },
  )
  const backgroundQuality = await fetchJson(baseUrl, job.background_quality_url)
  assert.equal(backgroundQuality.algorithm, BACKGROUND_MATTE_V2_ALGORITHM)
  assert.equal(backgroundQuality.provider_calls_used, 0)

  const generationResponse = await fetch(`${baseUrl}${job.generation_url}`)
  assert.equal(generationResponse.status, 200)
  const generation = await generationResponse.json()
  assert.equal(generation.background_matte_v2.recipe_id, BACKGROUND_MATTE_V2_ALGORITHM)
  assert.deepEqual(
    Object.keys(generation.background_matte_v2.artifacts).sort(),
    Object.values(BACKGROUND_MATTE_V2_ARTIFACT_FILES).sort(),
  )
  assert.equal(generation.raw_provider_output.file, 'raw_provider_output.png')
  assert.equal(generation.raw_provider_output.byte_length, source.length)
  assert.equal(generation.raw_provider_output.detected_mime_type, 'image/png')
  assert.equal(generation.raw_provider_output.declared_mime_type, 'image/png')
  assert.equal(generation.raw_provider_output.mime_matches_declared, true)
  assert.equal(generation.raw_provider_output.width, 252)
  assert.equal(generation.raw_provider_output.height, 252)
  assert.equal(generation.raw_provider_output.processing, 'none')
  assert.match(generation.raw_provider_output.sha256, /^[a-f0-9]{64}$/)
  assert.equal(
    generation.background_removed_provider_output.file,
    'background_removed_provider_output.png',
  )
  assert.equal(generation.background_removed_provider_output.width, 252)
  assert.equal(generation.background_removed_provider_output.height, 252)
  assert.equal(
    generation.background_removed_provider_output.processing,
    'background_removal_only',
  )
  assert.equal(
    generation.background_removed_provider_output.source_sha256,
    generation.raw_provider_output.sha256,
  )
  assert.equal(
    generation.background_removed_provider_output.sha256,
    sha256(backgroundRemovedBuffer),
  )

  const sourceResponse = await fetch(`${baseUrl}${job.source_url}`)
  const normalizedResponse = await fetch(`${baseUrl}${job.normalized_sheet_url}`)
  assert.equal(sourceResponse.status, 200)
  assert.equal(normalizedResponse.status, 200)
  const sourceBuffer = Buffer.from(await sourceResponse.arrayBuffer())
  const normalizedBuffer = Buffer.from(await normalizedResponse.arrayBuffer())
  const acceptanceBody = {
    confirmManualAcceptance: true,
    expectedPlanHash: review.plan_hash,
    expectedReferenceManifestSha256: review.reference_manifest_sha256,
    expectedRawProviderOutputSha256: generation.raw_provider_output.sha256,
    expectedBackgroundRemovedProviderOutputSha256:
      generation.background_removed_provider_output.sha256,
    expectedSourceSha256: sha256(sourceBuffer),
    expectedNormalizedSheetSha256: sha256(normalizedBuffer),
    humanReviewedIssueCount: 0,
  }

  const missingBackgroundBinding = await fetch(
    `${baseUrl}/api/generate-character/${job.id}/accept`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...acceptanceBody,
        expectedBackgroundRemovedProviderOutputSha256: undefined,
      }),
    },
  )
  assert.equal(missingBackgroundBinding.status, 409)
  assert.equal((await missingBackgroundBinding.json()).provider_calls_used, 0)
  assert.equal(provider.requests.length, 1)

  const staleAcceptance = await fetch(
    `${baseUrl}/api/generate-character/${job.id}/accept`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...acceptanceBody,
        expectedNormalizedSheetSha256: '0'.repeat(64),
      }),
    },
  )
  assert.equal(staleAcceptance.status, 409)
  assert.equal((await staleAcceptance.json()).provider_calls_used, 0)
  assert.equal(provider.requests.length, 1)

  const corruptRoot = await mkdtemp(path.join(os.tmpdir(), 'full-sheet-accept-corrupt-'))
  const corruptJobId = `job_corrupt_${process.pid}_${Date.now()}`
  const corruptJobDir = path.join(corruptRoot, corruptJobId)
  const sourceJobDir = path.join(process.cwd(), 'generated', job.id)
  await copyGenerationReviewDirectory({
    sourceRoot: path.join(process.cwd(), 'generated'),
    targetRoot: corruptRoot,
    reviewId: generation.generation_review.reviewed_run_id,
  })
  await mkdir(corruptJobDir)
  for (const fileName of new Set([
    'generation.json',
    'generation_release_gate.json',
    'debug_report.json',
    'source_subject_count_report.json',
    'normalized_subject_count_report.json',
    generation.raw_provider_output.file,
    generation.background_removed_provider_output.file,
    'source.png',
    'normalized_sheet.png',
    'prompt.txt',
    ...Object.values(BACKGROUND_MATTE_V2_ARTIFACT_FILES),
  ])) {
    await copyFile(path.join(sourceJobDir, fileName), path.join(corruptJobDir, fileName))
  }
  const conflictingGeneration = JSON.parse(JSON.stringify(generation))
  conflictingGeneration.candidate_selection.candidates[0].release_gate.status = 'pass'
  await writeFile(
    path.join(corruptJobDir, 'generation.json'),
    JSON.stringify(conflictingGeneration, null, 2),
    { flag: 'w' },
  )
  await assert.rejects(
    acceptFullSheetGeneration({
      sourceJobId: corruptJobId,
      request: acceptanceBody,
      generatedDir: corruptRoot,
    }),
    (error) => error?.code === 'source_not_reviewable' && error?.provider_calls_used === 0,
  )

  await copyFile(
    path.join(sourceJobDir, 'generation.json'),
    path.join(corruptJobDir, 'generation.json'),
  )
  const incompleteDebugReport = JSON.parse(
    await readFile(path.join(sourceJobDir, 'debug_report.json'), 'utf8'),
  )
  delete incompleteDebugReport.quality_closure
  await writeFile(
    path.join(corruptJobDir, 'debug_report.json'),
    JSON.stringify(incompleteDebugReport, null, 2),
    { flag: 'w' },
  )
  await assert.rejects(
    acceptFullSheetGeneration({
      sourceJobId: corruptJobId,
      request: acceptanceBody,
      generatedDir: corruptRoot,
    }),
    (error) => error?.code === 'source_not_reviewable' && error?.provider_calls_used === 0,
  )

  await copyFile(
    path.join(sourceJobDir, 'debug_report.json'),
    path.join(corruptJobDir, 'debug_report.json'),
  )
  const conflictingNormalizedSubjectCount = JSON.parse(
    await readFile(path.join(sourceJobDir, 'normalized_subject_count_report.json'), 'utf8'),
  )
  conflictingNormalizedSubjectCount.artifact_tampered = true
  await writeFile(
    path.join(corruptJobDir, 'normalized_subject_count_report.json'),
    JSON.stringify(conflictingNormalizedSubjectCount, null, 2),
    { flag: 'w' },
  )
  await assert.rejects(
    acceptFullSheetGeneration({
      sourceJobId: corruptJobId,
      request: acceptanceBody,
      generatedDir: corruptRoot,
    }),
    (error) => error?.code === 'source_not_reviewable' && error?.provider_calls_used === 0,
  )

  await copyFile(
    path.join(sourceJobDir, 'normalized_subject_count_report.json'),
    path.join(corruptJobDir, 'normalized_subject_count_report.json'),
  )
  const sourcePromptPath = path.join(sourceJobDir, 'prompt.txt')
  const originalSourcePrompt = await readFile(sourcePromptPath)
  try {
    await writeFile(sourcePromptPath, Buffer.from('changed prompt evidence'), { flag: 'w' })
    await assert.rejects(
      acceptFullSheetGeneration({
        sourceJobId: job.id,
        request: acceptanceBody,
        generatedDir: path.join(process.cwd(), 'generated'),
      }),
      (error) => error?.code === 'acceptance_binding_stale' && error?.provider_calls_used === 0,
    )
  } finally {
    await writeFile(sourcePromptPath, originalSourcePrompt, { flag: 'w' })
  }
  const reviewReferenceManifest = JSON.parse(await readFile(path.join(
    process.cwd(),
    'generated',
    generation.generation_review.reviewed_run_id,
    'generation_reference_manifest.json',
  ), 'utf8'))
  const structureReferencePath = path.join(
    process.cwd(),
    'generated',
    generation.generation_review.reviewed_run_id,
    reviewReferenceManifest.items[0].name,
  )
  const originalStructureReference = await readFile(structureReferencePath)
  try {
    await writeFile(structureReferencePath, Buffer.from('changed structure reference'), { flag: 'w' })
    await assert.rejects(
      acceptFullSheetGeneration({
        sourceJobId: job.id,
        request: acceptanceBody,
        generatedDir: path.join(process.cwd(), 'generated'),
      }),
      (error) => error?.code === 'artifact_integrity_failed' && error?.provider_calls_used === 0,
    )
  } finally {
    await writeFile(structureReferencePath, originalStructureReference, { flag: 'w' })
  }
  await writeFile(
    path.join(corruptJobDir, generation.background_removed_provider_output.file),
    Buffer.from('changed background-removed bytes'),
    { flag: 'w' },
  )
  await assert.rejects(
    acceptFullSheetGeneration({
      sourceJobId: corruptJobId,
      request: acceptanceBody,
      generatedDir: corruptRoot,
    }),
    (error) => error?.code === 'artifact_integrity_failed' && error?.provider_calls_used === 0,
  )

  const matteRoot = await mkdtemp(path.join(os.tmpdir(), 'full-sheet-accept-matte-v2-'))
  await copyGenerationReviewDirectory({
    sourceRoot: path.join(process.cwd(), 'generated'),
    targetRoot: matteRoot,
    reviewId: generation.generation_review.reviewed_run_id,
  })
  const rawProviderBuffer = await readFile(
    path.join(sourceJobDir, generation.raw_provider_output.file),
  )
  const rawProviderImage = await loadRgba(rawProviderBuffer)
  const matteResult = applyDeterministicPixelMatteV2(rawProviderImage, {
    decode: rawProviderImage.decode,
  })
  const matteBundle = await buildBackgroundMatteV2ArtifactBundle(matteResult, {
    rawSource: rawProviderImage,
    artifactUrlPrefix: '/generated/matte_v2_accept_source',
  })
  const matteOutputEvidence = matteBundle.artifacts[
    BACKGROUND_MATTE_V2_ARTIFACT_FILES.OUTPUT
  ]
  const matteGeneration = {
    ...JSON.parse(JSON.stringify(generation)),
    background_removed_provider_output: {
      ...matteOutputEvidence,
      width: rawProviderImage.width,
      height: rawProviderImage.height,
      processing: 'background_removal_only',
      source_file: generation.raw_provider_output.file,
      source_sha256: generation.raw_provider_output.sha256,
      background_removal: {
        mode: 'deterministic_pixel_matte_v2',
        recipe_id: 'deterministic_pixel_matte_v2',
        warnings: matteResult.warnings,
      },
    },
    background_matte_v2: matteBundle.metadata,
  }
  const matteSourceFiles = [
    'generation_release_gate.json',
    'debug_report.json',
    'source_subject_count_report.json',
    'normalized_subject_count_report.json',
    generation.raw_provider_output.file,
    'source.png',
    'normalized_sheet.png',
    'prompt.txt',
  ]
  const materializeMatteJob = async (matteJobId) => {
    const matteJobDir = path.join(matteRoot, matteJobId)
    await mkdir(matteJobDir)
    for (const file of matteSourceFiles) {
      await copyFile(path.join(sourceJobDir, file), path.join(matteJobDir, file))
    }
    for (const [file, content] of Object.entries(matteBundle.files)) {
      await writeFile(path.join(matteJobDir, file), content, { flag: 'wx' })
    }
    await writeFile(
      path.join(matteJobDir, 'generation.json'),
      JSON.stringify(matteGeneration, null, 2),
      { flag: 'wx' },
    )
    return matteJobDir
  }
  const matteAcceptanceBody = {
    ...acceptanceBody,
    expectedBackgroundRemovedProviderOutputSha256: matteOutputEvidence.sha256,
  }

  const missingMatteMetadataJobId = 'matte_v2_accept_missing_metadata'
  const missingMatteMetadataJobDir = await materializeMatteJob(missingMatteMetadataJobId)
  const missingMatteMetadataGeneration = JSON.parse(
    await readFile(path.join(missingMatteMetadataJobDir, 'generation.json'), 'utf8'),
  )
  delete missingMatteMetadataGeneration.background_matte_v2
  await writeFile(
    path.join(missingMatteMetadataJobDir, 'generation.json'),
    JSON.stringify(missingMatteMetadataGeneration, null, 2),
    { flag: 'w' },
  )
  await assert.rejects(
    acceptFullSheetGeneration({
      sourceJobId: missingMatteMetadataJobId,
      request: matteAcceptanceBody,
      generatedDir: matteRoot,
    }),
    (error) => error?.code === 'artifact_integrity_failed' && error?.provider_calls_used === 0,
  )

  const tamperedMatteJobId = 'matte_v2_accept_tampered'
  const tamperedMatteJobDir = await materializeMatteJob(tamperedMatteJobId)
  await writeFile(
    path.join(tamperedMatteJobDir, BACKGROUND_MATTE_V2_ARTIFACT_FILES.REVIEW),
    Buffer.from('changed review evidence'),
    { flag: 'w' },
  )
  await assert.rejects(
    acceptFullSheetGeneration({
      sourceJobId: tamperedMatteJobId,
      request: matteAcceptanceBody,
      generatedDir: matteRoot,
    }),
    (error) => error?.code === 'artifact_integrity_failed' && error?.provider_calls_used === 0,
  )

  const matteJobId = 'matte_v2_accept_source'
  const matteJobDir = await materializeMatteJob(matteJobId)
  const matteAccepted = await acceptFullSheetGeneration({
    sourceJobId: matteJobId,
    request: matteAcceptanceBody,
    generatedDir: matteRoot,
  })
  assert.equal(matteAccepted.saved, 'accepted')
  assert.equal(matteAccepted.provider_call_budget.used_provider_calls, 0)
  assert.equal(matteAccepted.background_review_url.endsWith('/background_review.json'), true)
  const mattePublicationDir = path.join(matteRoot, matteAccepted.publication_id)
  const matteAcceptedZip = await JSZip.loadAsync(
    await readFile(path.join(mattePublicationDir, 'character_pack.zip')),
  )
  for (const file of Object.values(BACKGROUND_MATTE_V2_ARTIFACT_FILES)) {
    const sourceArtifact = await readFile(path.join(matteJobDir, file))
    const publishedArtifact = await readFile(path.join(mattePublicationDir, file))
    assert.deepEqual(publishedArtifact, sourceArtifact)
    assert.deepEqual(await matteAcceptedZip.file(file).async('nodebuffer'), sourceArtifact)
  }
  const matteAcceptedGeneration = JSON.parse(
    await readFile(path.join(mattePublicationDir, 'generation.json'), 'utf8'),
  )
  assert.deepEqual(matteAcceptedGeneration.background_matte_v2, matteBundle.metadata)
  const matteAcceptedAgain = await acceptFullSheetGeneration({
    sourceJobId: matteJobId,
    request: matteAcceptanceBody,
    generatedDir: matteRoot,
  })
  assert.equal(matteAcceptedAgain.saved, 'already_accepted')
  await writeFile(
    path.join(mattePublicationDir, 'prompt.txt'),
    Buffer.from('changed published prompt evidence'),
    { flag: 'w' },
  )
  await assert.rejects(
    acceptFullSheetGeneration({
      sourceJobId: matteJobId,
      request: matteAcceptanceBody,
      generatedDir: matteRoot,
    }),
    (error) => error?.code === 'artifact_integrity_failed' && error?.provider_calls_used === 0,
  )
  await copyFile(
    path.join(matteJobDir, 'prompt.txt'),
    path.join(mattePublicationDir, 'prompt.txt'),
  )
  await writeFile(
    path.join(mattePublicationDir, BACKGROUND_MATTE_V2_ARTIFACT_FILES.REVIEW),
    Buffer.from('changed published review evidence'),
    { flag: 'w' },
  )
  await assert.rejects(
    acceptFullSheetGeneration({
      sourceJobId: matteJobId,
      request: matteAcceptanceBody,
      generatedDir: matteRoot,
    }),
    (error) => error?.code === 'artifact_integrity_failed' && error?.provider_calls_used === 0,
  )
  assert.equal(provider.requests.length, 1)

  const oversizedAcceptance = await fetch(
    `${baseUrl}/api/generate-character/${job.id}/accept`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'x'.repeat((32 * 1024) + 1),
    },
  )
  assert.equal(oversizedAcceptance.status, 413)
  assert.equal((await oversizedAcceptance.json()).provider_calls_used, 0)
  assert.equal(provider.requests.length, 1)

  const acceptanceRequest = () => fetchJson(baseUrl, `/api/generate-character/${job.id}/accept`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(acceptanceBody),
  })
  const concurrentAcceptances = await Promise.all([acceptanceRequest(), acceptanceRequest()])
  const accepted = concurrentAcceptances.find((result) => result.saved === 'accepted')
  const concurrentRepeat = concurrentAcceptances.find((result) => result.saved === 'already_accepted')
  assert.ok(accepted)
  assert.ok(concurrentRepeat)
  assert.equal(accepted.status, 'done')
  assert.equal(accepted.saved, 'accepted')
  assert.equal(accepted.source_job_id, job.id)
  assert.equal(accepted.publication_id, `accepted_v1_${job.id}`)
  assert.equal(accepted.manual_acceptance_status, 'accepted')
  assert.equal(accepted.human_reviewed_issue_count, 0)
  assert.deepEqual(accepted.provider_call_budget, {
    planned_provider_calls: 0,
    max_provider_calls: 0,
    used_provider_calls: 0,
  })
  assert.equal(provider.requests.length, 1)

  const [manualAcceptance, acceptedGate, acceptedGeneration] = await Promise.all([
    fetchJson(baseUrl, accepted.manual_acceptance_url),
    fetchJson(baseUrl, accepted.generation_release_gate_url),
    fetchJson(baseUrl, accepted.generation_url),
  ])
  const acceptedPublicationDir = path.join(
    process.cwd(),
    'generated',
    accepted.publication_id,
  )
  assert.equal(manualAcceptance.protocol, 'full_sheet_manual_acceptance_v1')
  assert.equal(manualAcceptance.decision_authority, 'human')
  assert.equal(manualAcceptance.provider_calls_used, 0)
  assert.equal(manualAcceptance.generation_review.prompt_text_sha256, sha256(
    await readFile(path.join(sourceJobDir, 'prompt.txt')),
  ))
  assert.equal(manualAcceptance.source_artifacts.prompt_sha256, manualAcceptance.generation_review.prompt_text_sha256)
  const releaseFiles = manualAcceptance.publication_artifacts.release_files
  const characterPackEntries = manualAcceptance.publication_artifacts.character_pack_entries
  const releaseEvidenceByFile = new Map(releaseFiles.map((entry) => [entry.file, entry]))
  const publishedFiles = await listRelativeRegularFiles(acceptedPublicationDir)
  assert.deepEqual(
    releaseFiles.map((entry) => entry.file).sort(),
    publishedFiles.filter((file) => !DYNAMIC_STANDALONE_PUBLICATION_FILES.has(file)),
  )
  for (const evidence of releaseFiles) {
    const buffer = await readFile(path.join(acceptedPublicationDir, evidence.file))
    assert.equal(evidence.sha256, sha256(buffer), evidence.file)
    assert.equal(evidence.byte_length, buffer.byteLength, evidence.file)
  }
  for (const [key, file] of [
    ['godot_npc', 'godot_npc_pack.zip'],
    ['rpgmaker', 'rpgmaker_pack.zip'],
    ['ocad', 'ocad_pack.zip'],
  ]) {
    const buffer = await readFile(path.join(acceptedPublicationDir, file))
    assert.equal(manualAcceptance.publication_artifacts.engine_zips[key].file, file)
    assert.equal(manualAcceptance.publication_artifacts.engine_zips[key].sha256, sha256(buffer))
    assert.equal(manualAcceptance.publication_artifacts.engine_zips[key].byte_length, buffer.byteLength)
    assert.deepEqual(
      releaseEvidenceByFile.get(file),
      manualAcceptance.publication_artifacts.engine_zips[key],
    )
  }
  assert.equal(
    manualAcceptance.source_artifacts.background_removed_provider_output_sha256,
    sha256(backgroundRemovedBuffer),
  )
  assert.equal(manualAcceptance.source_artifacts.normalized_sheet_sha256, sha256(normalizedBuffer))
  assert.equal(acceptedGate.status, 'accepted')
  assert.equal(acceptedGate.release_ready, true)
  assert.equal(acceptedGate.human_decision_status, 'accepted')
  assert.equal(acceptedGeneration.candidate_selection.artifact_disposition, 'release')
  assert.equal(acceptedGeneration.candidate_selection.human_decision_status, 'accepted')

  const acceptedNormalizedResponse = await fetch(`${baseUrl}${accepted.normalized_sheet_url}`)
  const acceptedBackgroundRemovedResponse = await fetch(
    `${baseUrl}${accepted.background_removed_provider_output_url}`,
  )
  const acceptedZipResponse = await fetch(`${baseUrl}${accepted.zip_url}`)
  assert.equal(acceptedNormalizedResponse.status, 200)
  assert.equal(acceptedBackgroundRemovedResponse.status, 200)
  assert.equal(acceptedZipResponse.status, 200)
  assert.deepEqual(Buffer.from(await acceptedNormalizedResponse.arrayBuffer()), normalizedBuffer)
  assert.deepEqual(
    Buffer.from(await acceptedBackgroundRemovedResponse.arrayBuffer()),
    backgroundRemovedBuffer,
  )
  const acceptedZip = await JSZip.loadAsync(Buffer.from(await acceptedZipResponse.arrayBuffer()))
  const acceptedZipFiles = Object.values(acceptedZip.files)
    .filter((entry) => !entry.dir)
    .map((entry) => entry.name)
    .sort()
  assert.deepEqual(
    characterPackEntries.map((entry) => entry.file).sort(),
    acceptedZipFiles.filter((file) => !DYNAMIC_CHARACTER_PACK_ENTRIES.has(file)),
  )
  assert.deepEqual(
    acceptedZipFiles,
    [
      ...characterPackEntries.map((entry) => entry.file),
      ...DYNAMIC_CHARACTER_PACK_ENTRIES,
    ].sort(),
  )
  for (const evidence of characterPackEntries) {
    const buffer = await acceptedZip.file(evidence.file).async('nodebuffer')
    assert.equal(evidence.sha256, sha256(buffer), evidence.file)
    assert.equal(evidence.byte_length, buffer.byteLength, evidence.file)
  }
  for (const file of Object.values(BACKGROUND_MATTE_V2_ARTIFACT_FILES)) {
    assert.ok(releaseFiles.some((entry) => entry.file === file), file)
    assert.ok(characterPackEntries.some((entry) => entry.file === file), file)
  }
  for (const file of DYNAMIC_CHARACTER_PACK_ENTRIES) {
    assert.deepEqual(
      await acceptedZip.file(file).async('nodebuffer'),
      await readFile(path.join(acceptedPublicationDir, file)),
      file,
    )
  }
  const acceptedMetadata = JSON.parse(
    await readFile(path.join(acceptedPublicationDir, 'metadata.json'), 'utf8'),
  )
  assert.deepEqual(acceptedMetadata.generation, acceptedGeneration)
  delete acceptedMetadata.generation
  assert.equal(
    manualAcceptance.publication_artifacts.metadata_without_generation_sha256,
    sha256(Buffer.from(JSON.stringify(acceptedMetadata, null, 2))),
  )
  assert.deepEqual(
    await acceptedZip.file('manual_acceptance.json').async('nodebuffer'),
    Buffer.from(JSON.stringify(manualAcceptance, null, 2)),
  )
  assert.deepEqual(
    await acceptedZip.file('source.png').async('nodebuffer'),
    sourceBuffer,
  )
  assert.deepEqual(
    await acceptedZip.file('normalized_sheet.png').async('nodebuffer'),
    normalizedBuffer,
  )
  assert.ok(acceptedZip.file('character_pack.zip') == null)

  const originalSourceAfterAcceptance = await fetch(`${baseUrl}${job.source_url}`)
  const originalNormalizedAfterAcceptance = await fetch(`${baseUrl}${job.normalized_sheet_url}`)
  assert.deepEqual(Buffer.from(await originalSourceAfterAcceptance.arrayBuffer()), sourceBuffer)
  assert.deepEqual(Buffer.from(await originalNormalizedAfterAcceptance.arrayBuffer()), normalizedBuffer)

  const acceptedAgain = await acceptanceRequest()
  assert.equal(acceptedAgain.saved, 'already_accepted')
  assert.equal(acceptedAgain.publication_id, accepted.publication_id)
  assert.equal(provider.requests.length, 1)
  const expectAcceptanceReplayIntegrityFailure = async () => {
    const response = await fetch(
      `${baseUrl}/api/generate-character/${job.id}/accept`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(acceptanceBody),
      },
    )
    assert.equal(response.status, 409)
    assert.equal((await response.json()).provider_calls_used, 0)
    assert.equal(provider.requests.length, 1)
  }

  const publishedAnimationsPath = path.join(acceptedPublicationDir, 'animations.json')
  const originalPublishedAnimations = await readFile(publishedAnimationsPath)
  try {
    await writeFile(
      publishedAnimationsPath,
      Buffer.from('{"animations":{"tampered":true}}'),
      { flag: 'w' },
    )
    await expectAcceptanceReplayIntegrityFailure()
  } finally {
    await writeFile(publishedAnimationsPath, originalPublishedAnimations, { flag: 'w' })
  }

  const publishedCharacterPackPath = path.join(acceptedPublicationDir, 'character_pack.zip')
  const originalPublishedCharacterPack = await readFile(publishedCharacterPackPath)
  try {
    const changedCharacterPack = await JSZip.loadAsync(originalPublishedCharacterPack, {
      checkCRC32: true,
    })
    changedCharacterPack.file('animations.json', Buffer.from('{"animations":{"tampered":true}}'))
    const changedCharacterPackBuffer = await changedCharacterPack.generateAsync({
      type: 'nodebuffer',
    })
    await JSZip.loadAsync(changedCharacterPackBuffer, { checkCRC32: true })
    await writeFile(publishedCharacterPackPath, changedCharacterPackBuffer, { flag: 'w' })
    await expectAcceptanceReplayIntegrityFailure()
  } finally {
    await writeFile(publishedCharacterPackPath, originalPublishedCharacterPack, { flag: 'w' })
  }

  try {
    const expandedCharacterPack = await JSZip.loadAsync(originalPublishedCharacterPack, {
      checkCRC32: true,
    })
    expandedCharacterPack.file('unexpected_integrity_entry.txt', Buffer.from('unexpected entry'))
    const expandedCharacterPackBuffer = await expandedCharacterPack.generateAsync({
      type: 'nodebuffer',
    })
    await JSZip.loadAsync(expandedCharacterPackBuffer, { checkCRC32: true })
    await writeFile(publishedCharacterPackPath, expandedCharacterPackBuffer, { flag: 'w' })
    await expectAcceptanceReplayIntegrityFailure()
  } finally {
    await writeFile(publishedCharacterPackPath, originalPublishedCharacterPack, { flag: 'w' })
  }

  try {
    const expandedCharacterPack = await JSZip.loadAsync(originalPublishedCharacterPack, {
      checkCRC32: true,
    })
    expandedCharacterPack.folder('unexpected_integrity_directory')
    const expandedCharacterPackBuffer = await expandedCharacterPack.generateAsync({
      type: 'nodebuffer',
    })
    await JSZip.loadAsync(expandedCharacterPackBuffer, { checkCRC32: true })
    await writeFile(publishedCharacterPackPath, expandedCharacterPackBuffer, { flag: 'w' })
    await expectAcceptanceReplayIntegrityFailure()
  } finally {
    await writeFile(publishedCharacterPackPath, originalPublishedCharacterPack, { flag: 'w' })
  }

  const publishedMetadataPath = path.join(acceptedPublicationDir, 'metadata.json')
  const originalPublishedMetadata = await readFile(publishedMetadataPath)
  try {
    const changedMetadata = JSON.parse(originalPublishedMetadata.toString('utf8'))
    const originalMetadataGeneration = JSON.parse(
      originalPublishedMetadata.toString('utf8'),
    ).generation
    changedMetadata.integrity_tampered = true
    assert.deepEqual(changedMetadata.generation, originalMetadataGeneration)
    const changedMetadataBuffer = Buffer.from(JSON.stringify(changedMetadata, null, 2))
    const changedMetadataCharacterPack = await JSZip.loadAsync(
      originalPublishedCharacterPack,
      { checkCRC32: true },
    )
    changedMetadataCharacterPack.file('metadata.json', changedMetadataBuffer)
    const changedMetadataCharacterPackBuffer = await changedMetadataCharacterPack.generateAsync({
      type: 'nodebuffer',
    })
    await JSZip.loadAsync(changedMetadataCharacterPackBuffer, { checkCRC32: true })
    await writeFile(publishedMetadataPath, changedMetadataBuffer, { flag: 'w' })
    await writeFile(
      publishedCharacterPackPath,
      changedMetadataCharacterPackBuffer,
      { flag: 'w' },
    )
    await expectAcceptanceReplayIntegrityFailure()
  } finally {
    await writeFile(publishedMetadataPath, originalPublishedMetadata, { flag: 'w' })
    await writeFile(publishedCharacterPackPath, originalPublishedCharacterPack, { flag: 'w' })
  }

  const publishedAcceptancePath = path.join(
    acceptedPublicationDir,
    'manual_acceptance.json',
  )
  const originalPublishedAcceptance = await readFile(publishedAcceptancePath)
  const changedPublishedAcceptance = JSON.parse(originalPublishedAcceptance.toString('utf8'))
  changedPublishedAcceptance.acceptance_id = 'accepted_v1_changed_identity'
  try {
    await writeFile(
      publishedAcceptancePath,
      JSON.stringify(changedPublishedAcceptance, null, 2),
      { flag: 'w' },
    )
    const changedAcceptanceIdentity = await fetch(
      `${baseUrl}/api/generate-character/${job.id}/accept`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(acceptanceBody),
      },
    )
    assert.equal(changedAcceptanceIdentity.status, 409)
    assert.equal((await changedAcceptanceIdentity.json()).provider_calls_used, 0)
  } finally {
    await writeFile(publishedAcceptancePath, originalPublishedAcceptance, { flag: 'w' })
  }

  await writeFile(
    path.join(process.cwd(), 'generated', accepted.publication_id, 'godot_npc_pack.zip'),
    Buffer.from('changed engine ZIP evidence'),
    { flag: 'w' },
  )
  const changedEngineZipAcceptance = await fetch(
    `${baseUrl}/api/generate-character/${job.id}/accept`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(acceptanceBody),
    },
  )
  assert.equal(changedEngineZipAcceptance.status, 409)
  assert.equal((await changedEngineZipAcceptance.json()).provider_calls_used, 0)
  assert.equal(provider.requests.length, 1)
})
