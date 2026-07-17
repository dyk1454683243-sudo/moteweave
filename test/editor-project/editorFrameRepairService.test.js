import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { encodeRgbaPng } from '../../src/character-pack/imageCodec.js'
import { buildAnimationsJson } from '../../src/character-pack/packageBuilder.js'
import { TOPDOWN_RPG_V0 } from '../../src/character-pack/profile.js'
import * as editorProject from '../../src/editor-project/index.js'
import { FRAME_REPAIR_INTEGRITY_FILES } from '../../src/editor-project/frameRepairArtifacts.js'
import {
  compositeFrameRepairCandidate,
  normalizeFrameRepairCandidate,
} from '../../src/editor-project/frameRepairComposite.js'
import { FRAME_REPAIR_PROVIDER_FAILURE_FILES } from '../../src/editor-project/frameRepairProviderFailureArtifacts.js'
import {
  hashFrameRepairPlan,
  hashFrameRepairReferenceContext,
} from '../../src/editor-project/frameRepairPlan.js'
import { createFrameRepairOperationLedger } from '../../src/editor-project/frameRepairOperationLedger.js'
import { packageNormalizedCharacterSheet } from '../../src/editor-project/normalizedCharacterSheetPackage.js'
import { buildFrameRepairPrompt } from '../../src/editor-project/frameRepairProvider.js'
import { createFrameRepairService } from '../../src/editor-project/frameRepairService.js'

const CREATED_AT = '2026-07-11T00:00:00.000Z'
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)
const QUALITY_STATUSES_FOR_TEST = new Set(['pass', 'warning', 'fail', 'unknown'])
const SERVICE_SHEET = {
  width: 768,
  height: 768,
  data: new Uint8ClampedArray(768 * 768 * 4),
}
for (let frameIndex = 0; frameIndex < 64; frameIndex += 1) {
  const x = (frameIndex % 8) * 96 + 47
  const y = Math.floor(frameIndex / 8) * 96 + 80
  SERVICE_SHEET.data.set([32 + frameIndex, 96, 144, 255],
    (y * SERVICE_SHEET.width + x) * 4)
}
for (const frameIndex of [16, 17, 18]) {
  const originX = (frameIndex % 8) * 96
  const originY = Math.floor(frameIndex / 8) * 96
  for (let y = 76; y < 82; y += 1) {
    for (let x = 45; x < 51; x += 1) {
      const offset = ((originY + y) * SERVICE_SHEET.width + originX + x) * 4
      SERVICE_SHEET.data.set([48 + frameIndex, 96, 144, 255], offset)
    }
  }
}
const SERVICE_PARENT_PNG = await encodeRgbaPng(SERVICE_SHEET)

function serviceFrame(sheetFrameIndex) {
  const data = new Uint8ClampedArray(96 * 96 * 4)
  const originX = (sheetFrameIndex % 8) * 96
  const originY = Math.floor(sheetFrameIndex / 8) * 96
  for (let y = 0; y < 96; y += 1) {
    const source = ((originY + y) * SERVICE_SHEET.width + originX) * 4
    data.set(SERVICE_SHEET.data.subarray(source, source + 96 * 4), y * 96 * 4)
  }
  return { width: 96, height: 96, data }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function planFixture(referenceImages, parentSheetBuffer, targetFrame) {
  const referenceItems = referenceImages.map((item) => ({
    role: item.role,
    name: item.name,
    sha256: sha256(item.buffer),
  }))
  return {
    version: 'frame_repair_plan_v1',
    project: { id: 'project_demo', revision: 4 },
    asset: { id: 'asset_hero', parent_revision_id: 'rev_003' },
    profile: { id: 'topdown_rpg_v0', frame_size: { w: 96, h: 96 } },
    clip: {
      id: 'walk_down',
      frames: [16, 17, 18, 19],
      position: 1,
      sheet_frame_index: 17,
      context_frames: [
        { position: 0, sheet_frame_index: 16, sha256: sha256(Buffer.from(serviceFrame(16).data)) },
        { position: 2, sheet_frame_index: 18, sha256: sha256(Buffer.from(serviceFrame(18).data)) },
      ],
    },
    parent_sheet_sha256: sha256(parentSheetBuffer),
    target_frame_sha256: sha256(Buffer.from(targetFrame.data)),
    references: {
      input_reference_roles: referenceItems.map((item) => item.role),
      context_sha256: hashFrameRepairReferenceContext(referenceItems),
      items: referenceItems,
    },
    mask: {
      width: 96,
      height: 96,
      source: 'user_scoped',
      confidence: 'user_confirmed',
      runs: [{ start: 80 * 96 + 48, length: 1 }],
      activePixelCount: 1,
      sha256: hashFrameRepairPlan({
        width: 96,
        height: 96,
        runs: [{ start: 80 * 96 + 48, length: 1 }],
      }),
    },
    instruction: 'Repair the selected hand',
    provider: {
      id: 'gemini-default',
      provider: 'gemini',
      label: 'Gemini default',
      model: 'model-a',
      image_config: { image_size: '1K', aspect_ratio: '1:1' },
    },
    estimated_provider_calls: 1,
    max_provider_calls: 1,
    implementation_revision: 'package-0.4.0',
  }
}

function liveServiceInput() {
  const parentSheetBuffer = Buffer.from(SERVICE_PARENT_PNG)
  const targetFrame = serviceFrame(17)
  const referenceImages = [
    { role: 'target_enlarged', name: 'target.png', mimeType: 'image/png', buffer: Buffer.from(TINY_PNG) },
    { role: 'mask_visualization', name: 'mask.png', mimeType: 'image/png', buffer: Buffer.from(TINY_PNG) },
    { role: 'clip_context', name: 'context.png', mimeType: 'image/png', buffer: Buffer.from(TINY_PNG) },
  ]
  const plan = planFixture(referenceImages, parentSheetBuffer, targetFrame)
  return {
    identity: {
      project_id: 'project_demo',
      project_revision: 4,
      asset_id: 'asset_hero',
      parent_revision_id: 'rev_003',
      operation_id: 'fr_0123456789abcdef',
      plan_hash: hashFrameRepairPlan(plan),
    },
    plan,
    providerPreset: {
      ...plan.provider,
      available: true,
      apiKey: 'private-runtime-key',
      endpoint: 'https://provider.invalid/private-runtime',
    },
    parentSheetBuffer,
    targetFrame,
    referenceImages,
    parentAnimations: buildAnimationsJson(TOPDOWN_RPG_V0),
    parentMetadata: {
      name: 'Forest Hero',
      description: 'Managed parent',
      profile: 'topdown_rpg_v0',
      quality: { status: 'pass', warnings: [], blocking_errors: [] },
    },
    lineage: {
      project_id: 'project_demo',
      asset_id: 'asset_hero',
      parent_revision_id: 'rev_003',
      parent_job_id: 'job_parent',
      parent_processing_recipe_ref: 'workspace/projects/project_demo/assets/asset_hero/rev_003/processing_recipe.json',
    },
  }
}

function sealedWriterResult(job) {
  const manifest = Object.entries(FRAME_REPAIR_INTEGRITY_FILES).map(([key, fileName], index) => ({
    key,
    file_name: fileName,
    size: index + 1,
    sha256: String(index % 10).repeat(64),
  }))
  const stable = (value) => Array.isArray(value)
    ? value.map(stable)
    : value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype
      ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]))
      : value
  return {
    job_id: job.id,
    created_at: job.created_at,
    status: 'done',
    reason: null,
    retry_hint: null,
    artifact_integrity_manifest: manifest,
    artifact_manifest_sha256: sha256(Buffer.from(JSON.stringify(stable(manifest)), 'utf8')),
    ...Object.fromEntries(Object.entries(FRAME_REPAIR_INTEGRITY_FILES).map(([key, fileName]) => [
      `${key}_url`,
      `/generated/${job.id}/${fileName}`,
    ])),
  }
}

async function serviceHarness({ providerError = null } = {}) {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'frame-service-'))
  const generatedDir = path.join(workspaceRoot, 'artifacts')
  const jobs = new Map()
  const queue = []
  const calls = []
  let providerCalls = 0
  let jobNumber = 0
  const ledger = createFrameRepairOperationLedger({ workspaceRoot, now: () => CREATED_AT })
  const dependencies = {
    generatedDir,
    jobQueue: {
      enqueue(task, onError) {
        queue.push({ task, onError })
      },
    },
    createJob(initial) {
      jobNumber += 1
      const job = {
        id: `job_frame_repair_${jobNumber}`,
        status: 'queued',
        created_at: CREATED_AT,
        ...initial,
        private_runtime: 'must-not-leak',
      }
      jobs.set(job.id, job)
      return job
    },
    getJob(jobId) {
      return jobs.get(jobId) ?? null
    },
    updateJob(jobId, patch) {
      const current = jobs.get(jobId)
      if (!current) return null
      const next = { ...current, ...patch, updated_at: '2026-07-11T00:00:01.000Z' }
      jobs.set(jobId, next)
      return next
    },
    ledger,
    async generateCandidate(input) {
      providerCalls += 1
      calls.push({ phase: 'provider', input })
      if (providerError) throw providerError
      return {
        provider: 'gemini',
        provider_preset_id: 'gemini-default',
        provider_label: 'Gemini default',
        model: 'model-a',
        image_config: { image_size: '1K', aspect_ratio: '1:1' },
        prompt: buildFrameRepairPrompt(input.plan),
        buffer: Buffer.from(TINY_PNG),
      }
    },
    async normalizeCandidate(input) {
      calls.push({ phase: 'normalize', input })
      return {
        raw_provider_png: Buffer.from(input.providerBuffer),
        normalized_candidate_frame: {
          width: input.parentFrame.width,
          height: input.parentFrame.height,
          data: new Uint8ClampedArray(input.parentFrame.data),
        },
        normalized_candidate_frame_png: await encodeRgbaPng(input.parentFrame),
      }
    },
    async compositeCandidate(input) {
      calls.push({ phase: 'composite', input })
      return compositeFrameRepairCandidate(input)
    },
    async packageSheet(input) {
      calls.push({ phase: 'package', input })
      return {
        packaged: true,
        debugReport: {
          validation: { status: 'pass', warnings: [], blocking_errors: [] },
        },
        files: {
          sourcePng: Buffer.from(input.normalizedSheetPng),
          normalizedSheetPng: Buffer.from(input.normalizedSheetPng),
        },
      }
    },
    async writeArtifacts(input) {
      calls.push({ phase: 'writer', input })
      return sealedWriterResult(input.job)
    },
    async recoverArtifacts({ jobId, expectedManifestSha256 }) {
      const job = jobs.get(jobId)
      const written = sealedWriterResult(job ?? { id: jobId })
      assert.equal(expectedManifestSha256, written.artifact_manifest_sha256)
      return {
        job_id: jobId,
        artifact_manifest_sha256: written.artifact_manifest_sha256,
        manifest: written.artifact_integrity_manifest,
        ...Object.fromEntries(Object.entries(FRAME_REPAIR_INTEGRITY_FILES).map(([key, fileName]) => [
          `${key}_url`, `/generated/${jobId}/${fileName}`,
        ])),
      }
    },
  }
  return {
    workspaceRoot,
    generatedDir,
    jobs,
    queue,
    calls,
    ledger,
    dependencies,
    get providerCalls() { return providerCalls },
  }
}

async function runQueued(item) {
  try {
    await item.task()
  } catch (error) {
    await item.onError(error)
  }
}

function containsPrivateValue(value) {
  return /apiKey|private-runtime|private_runtime|parentSheetBuffer|targetFrame/.test(JSON.stringify(value))
}

test('frame repair service API is exported from editor-project', () => {
  assert.equal(editorProject.createFrameRepairService, createFrameRepairService)
})

test('service snapshots private inputs, queues once, dispatches once, and publishes no private runtime', async () => {
  const harness = await serviceHarness()
  const service = createFrameRepairService(harness.dependencies)
  const input = liveServiceInput()
  const firstPromise = service.enqueue(input)
  input.parentSheetBuffer.fill(0)
  input.providerPreset.apiKey = 'mutated-private-key'
  input.referenceImages[0].buffer.fill(0)
  const first = await firstPromise
  const replay = await service.enqueue(liveServiceInput())

  assert.equal(first.id, replay.id)
  assert.equal(harness.queue.length, 1)
  await runQueued(harness.queue[0])
  assert.equal(harness.providerCalls, 1)
  const completed = await service.getOperation({
    project_id: 'project_demo',
    asset_id: 'asset_hero',
    operation_id: 'fr_0123456789abcdef',
  })
  assert.equal(completed.status, 'done', JSON.stringify({ completed, phases: harness.calls.map((item) => item.phase) }))
  assert.equal(completed.provider_calls_used, 1)
  assert.equal(completed.generated_candidate_count, 1)
  assert.equal(containsPrivateValue(completed), false)
  assert.equal(containsPrivateValue(service.getJob(first.id)), false)
  const providerCall = harness.calls.find((item) => item.phase === 'provider')
  assert.equal(providerCall.input.providerPreset.apiKey, 'private-runtime-key')
  assert.deepEqual(providerCall.input.referenceImages[0].buffer, TINY_PNG)
  const packageCall = harness.calls.find((item) => item.phase === 'package')
  const writerCall = harness.calls.find((item) => item.phase === 'writer')
  assert.equal(Object.hasOwn(packageCall.input, 'providerPreset'), false)
  assert.equal(Object.hasOwn(writerCall.input, 'providerPreset'), false)
  assert.equal(
    writerCall.input.evidence.frame_repair_context_base.parent_processing_recipe_ref,
    input.lineage.parent_processing_recipe_ref,
  )
})

test('service marks budget used before dispatch and never retries an uncertain failure', async () => {
  const providerError = Object.assign(new Error('network lost'), { outcomeUnknown: true })
  const harness = await serviceHarness({ providerError })
  const service = createFrameRepairService(harness.dependencies)
  const input = liveServiceInput()
  await service.enqueue(input)
  await runQueued(harness.queue[0])

  assert.equal(harness.providerCalls, 1)
  const recovered = await service.getOperation({
    project_id: identityProject(input),
    asset_id: input.identity.asset_id,
    operation_id: input.identity.operation_id,
  })
  assert.equal(recovered.provider_calls_used, 1)
  assert.equal(recovered.recovery_state, 'outcome_unknown')
  assert.equal(recovered.reason, 'transport_outcome_unknown')
  assert.equal(recovered.retry_hint, null)
  await service.enqueue(liveServiceInput())
  assert.equal(harness.queue.length, 1)
  assert.equal(harness.providerCalls, 1)
})

test('unclassified provider exceptions default to conservative outcome-unknown recovery', async () => {
  const harness = await serviceHarness({ providerError: new Error('transport closed') })
  const service = createFrameRepairService(harness.dependencies)
  await service.enqueue(liveServiceInput())
  await runQueued(harness.queue[0])

  const recovered = await service.getOperation(operationLookup())
  assert.equal(recovered.status, 'failed_model_error')
  assert.equal(recovered.provider_calls_used, 1)
  assert.equal(recovered.recovery_state, 'outcome_unknown')
  assert.equal(recovered.reason, 'provider_failed')
  assert.equal(recovered.retry_hint, null)
  assert.equal(harness.providerCalls, 1)
})

test('service persists safe provider diagnostics without raw text, retry, or ledger drift', async () => {
  const cases = [
    ['authentication', { http_status: 401 }, 'provider_authentication_failed', 'check_provider_credentials', 'known', null, null, 401],
    ['quota', { http_status: 402 }, 'provider_quota_or_payment_required', 'check_provider_quota', 'known', null, null, 402],
    ['rate limit', { http_status: 429 }, 'provider_rate_limited', 'wait_before_new_call', 'known', null, null, 429],
    ['service unavailable', { http_status: 503 }, 'provider_service_unavailable', 'review_provider_status', 'known', null, null, 503],
    ['invalid image response', { status: 'failed_model_error', retry_hint: 'regenerate' }, 'provider_output_invalid', 'inspect_provider_output_contract', 'known', null, null, null],
    ['transport uncertainty', { outcomeUnknown: true, cause: { code: 'ECONNRESET' } }, 'transport_outcome_unknown', null, 'unknown', 'outcome_unknown', 'ECONNRESET', null],
  ]

  for (const [
    name, fields, reason, retryHint, providerOutcome, recoveryState,
    connectionCode, httpStatus,
  ] of cases) {
    const rawSecret = `Bearer private.${name.replaceAll(' ', '_')} /Users/private/provider.json`
    const providerError = Object.assign(new Error(rawSecret), fields)
    const harness = await serviceHarness({ providerError })
    const service = createFrameRepairService(harness.dependencies)

    await service.enqueue(liveServiceInput())
    await runQueued(harness.queue[0])

    const failed = await service.getOperation(operationLookup())
    const publicJob = service.getJob(failed.id)
    const record = await harness.ledger.get(operationLookup())
    assert.equal(failed.status, 'failed_model_error', name)
    assert.equal(failed.reason, reason, name)
    assert.equal(failed.retry_hint, retryHint, name)
    assert.equal(failed.recovery_state, recoveryState, name)
    assert.equal(failed.provider_calls_used, 1, name)
    assert.equal(publicJob.reason, reason, name)
    assert.equal(publicJob.retry_hint, retryHint, name)
    assert.equal(record.reason, reason, name)
    assert.equal(record.retry_hint, retryHint, name)
    assert.equal(record.provider_outcome, providerOutcome, name)
    assert.equal(harness.providerCalls, 1, name)
    const providerDiagnostic = JSON.parse(await readFile(path.join(
      harness.generatedDir,
      failed.id,
      FRAME_REPAIR_PROVIDER_FAILURE_FILES.diagnostic,
    ), 'utf8'))
    assert.equal(providerDiagnostic.version, 'frame_repair_provider_failure_v2', name)
    assert.equal(providerDiagnostic.failure_stage, 'provider', name)
    assert.equal(providerDiagnostic.reason, reason, name)
    assert.equal(providerDiagnostic.provider_outcome, providerOutcome, name)
    assert.equal(providerDiagnostic.connection_code, connectionCode, name)
    assert.equal(providerDiagnostic.http_status, httpStatus, name)
    assert.equal(providerDiagnostic.raw_provider_payload_persisted, false, name)
    assert.equal(providerDiagnostic.preview, null, name)
    assert.doesNotMatch(JSON.stringify(providerDiagnostic), /Bearer|\/Users\/private/, name)

    const restarted = createFrameRepairService({
      ...harness.dependencies,
      getJob() { return null },
    })
    const recovered = await restarted.getOperation(operationLookup())
    assert.equal(recovered.reason, reason, name)
    assert.equal(recovered.retry_hint, retryHint, name)
    assert.equal(recovered.recovery_state, recoveryState ?? 'terminal', name)
    assert.equal(harness.providerCalls, 1, name)
    assert.doesNotMatch(JSON.stringify({ failed, publicJob, record, recovered }), /Bearer|\/Users\/private/)

    const replay = await service.enqueue(liveServiceInput())
    assert.equal(replay.id, failed.id, name)
    assert.equal(harness.queue.length, 1, name)
    assert.equal(harness.providerCalls, 1, name)
  }
})

test('service interoperates with the real normalization and direct composite contracts', async () => {
  const harness = await serviceHarness()
  const generate = harness.dependencies.generateCandidate
  const candidatePng = await encodeRgbaPng(serviceFrame(17))
  harness.dependencies.generateCandidate = async (input) => ({
    ...await generate(input),
    buffer: Buffer.from(candidatePng),
  })
  harness.dependencies.normalizeCandidate = normalizeFrameRepairCandidate
  harness.dependencies.compositeCandidate = compositeFrameRepairCandidate
  harness.dependencies.packageSheet = packageNormalizedCharacterSheet
  const input = liveServiceInput()
  input.providerPreset.imageConfig = input.providerPreset.image_config
  delete input.providerPreset.image_config
  const service = createFrameRepairService(harness.dependencies)
  await service.enqueue(input)
  await runQueued(harness.queue[0])

  const completed = await service.getOperation(operationLookup(input))
  assert.equal(completed.status, 'done', JSON.stringify({ completed, phases: harness.calls.map((item) => item.phase) }))
  assert.equal(completed.provider_calls_used, 1)
  assert.equal(completed.generated_candidate_count, 1)
  assert.ok(QUALITY_STATUSES_FOR_TEST.has(completed.quality_status))
  const writer = harness.calls.find((item) => item.phase === 'writer')
  assert.equal(writer.input.evidence.frame_repair_quality.complete, true)
  assert.equal(writer.input.evidence.frame_repair_quality.integrity.non_target_equal, true)
  assert.equal(writer.input.evidence.frame_repair_quality.integrity.target_outside_mask_equal, true)
})

function identityProject(input) {
  return input.identity.project_id
}

function operationLookup(input = liveServiceInput()) {
  return {
    project_id: input.identity.project_id,
    asset_id: input.identity.asset_id,
    operation_id: input.identity.operation_id,
  }
}

test('service publishes a durable queue failure without dispatching or replaying work', async () => {
  const harness = await serviceHarness()
  harness.dependencies.jobQueue = {
    enqueue() {
      throw new Error('queue unavailable')
    },
  }
  const service = createFrameRepairService(harness.dependencies)
  const failed = await service.enqueue(liveServiceInput())

  assert.equal(failed.status, 'failed_post_processing')
  assert.equal(failed.reason, 'queue_failed')
  assert.equal(failed.provider_calls_used, 0)
  assert.equal(harness.providerCalls, 0)
  const replay = await service.enqueue(liveServiceInput())
  assert.equal(replay.id, failed.id)
  assert.equal(harness.providerCalls, 0)
})

test('exclusive job directory collision fails before provider dispatch', async () => {
  const harness = await serviceHarness()
  const service = createFrameRepairService(harness.dependencies)
  const queued = await service.enqueue(liveServiceInput())
  await mkdir(path.join(harness.generatedDir, queued.id), { recursive: true })
  await runQueued(harness.queue[0])

  const failed = await service.getOperation(operationLookup())
  assert.equal(failed.status, 'failed_post_processing')
  assert.equal(failed.reason, 'job_directory_collision')
  assert.equal(failed.provider_calls_used, 0)
  assert.equal(harness.providerCalls, 0)
})

test('provider unavailable and safety responses map to controlled one-call terminal states', async () => {
  for (const [code, status, reason] of [
    ['provider_unavailable', 'failed_model_error', 'provider_unavailable'],
    ['safety_filter', 'failed_safety_filter', 'provider_safety_filter'],
  ]) {
    const harness = await serviceHarness({ providerError: Object.assign(new Error(code), { code }) })
    const service = createFrameRepairService(harness.dependencies)
    await service.enqueue(liveServiceInput())
    await runQueued(harness.queue[0])
    const failed = await service.getOperation(operationLookup())
    assert.equal(failed.status, status)
    assert.equal(failed.reason, reason)
    assert.equal(failed.provider_calls_used, 1)
    assert.equal(failed.generated_candidate_count, 0)
    assert.equal(harness.providerCalls, 1)
    const replay = await service.enqueue(liveServiceInput())
    assert.equal(replay.id, failed.id)
    assert.equal(harness.queue.length, 1)
  }
})

test('corrupt returned candidate is a definitive one-call model failure', async () => {
  const harness = await serviceHarness()
  const generate = harness.dependencies.generateCandidate
  harness.dependencies.generateCandidate = async (input) => ({
    ...await generate(input),
    buffer: Buffer.from('not-a-raster-image'),
  })
  harness.dependencies.normalizeCandidate = normalizeFrameRepairCandidate
  const service = createFrameRepairService(harness.dependencies)
  const queued = await service.enqueue(liveServiceInput())
  await runQueued(harness.queue[0])

  const failed = await service.getOperation(operationLookup())
  assert.equal(failed.status, 'failed_model_error')
  assert.equal(failed.reason, 'provider_candidate_invalid')
  assert.equal(failed.retry_hint, 'inspect_provider_output_invalid')
  assert.equal(failed.provider_calls_used, 1)
  assert.equal(failed.generated_candidate_count, 1)
  assert.equal(failed.recovery_state, null)
  assert.equal(harness.providerCalls, 1)
  const diagnostic = JSON.parse(await readFile(path.join(
    harness.generatedDir,
    queued.id,
    FRAME_REPAIR_PROVIDER_FAILURE_FILES.diagnostic,
  ), 'utf8'))
  assert.equal(diagnostic.normalization_code, 'provider_output_invalid')
  assert.equal(diagnostic.raw_provider_payload_persisted, false)
  assert.equal(diagnostic.preview, null)
  const restarted = createFrameRepairService({
    ...harness.dependencies,
    getJob() { return null },
  })
  const recovered = await restarted.getOperation(operationLookup())
  assert.equal(recovered.generated_candidate_count, 1)
  assert.equal(recovered.reason, 'provider_candidate_invalid')
  assert.equal(recovered.retry_hint, 'inspect_provider_output_invalid')
})

test('full-sheet candidate preserves a sanitized preview and exact one-call subtype', async () => {
  const harness = await serviceHarness()
  const generate = harness.dependencies.generateCandidate
  harness.dependencies.generateCandidate = async (input) => ({
    ...await generate(input),
    buffer: Buffer.from(SERVICE_PARENT_PNG),
  })
  harness.dependencies.normalizeCandidate = normalizeFrameRepairCandidate
  const service = createFrameRepairService(harness.dependencies)
  const queued = await service.enqueue(liveServiceInput())
  await runQueued(harness.queue[0])

  const failed = await service.getOperation(operationLookup())
  assert.equal(failed.status, 'failed_model_error')
  assert.equal(failed.reason, 'provider_candidate_invalid')
  assert.equal(failed.retry_hint, 'inspect_provider_output_full_sheet')
  assert.equal(failed.provider_calls_used, 1)
  assert.equal(failed.generated_candidate_count, 1)
  assert.equal(harness.providerCalls, 1)

  const jobDir = path.join(harness.generatedDir, queued.id)
  const diagnostic = JSON.parse(await readFile(
    path.join(jobDir, FRAME_REPAIR_PROVIDER_FAILURE_FILES.diagnostic),
    'utf8',
  ))
  const preview = await readFile(path.join(jobDir, FRAME_REPAIR_PROVIDER_FAILURE_FILES.preview))
  assert.equal(diagnostic.normalization_code, 'provider_output_full_sheet')
  assert.equal(diagnostic.raw_provider_payload_persisted, false)
  assert.equal(diagnostic.preview.file_name, FRAME_REPAIR_PROVIDER_FAILURE_FILES.preview)
  assert.equal(diagnostic.preview.width, SERVICE_SHEET.width)
  assert.equal(diagnostic.preview.height, SERVICE_SHEET.height)
  assert.equal(diagnostic.preview.sha256, sha256(preview))
  assert.deepEqual([...preview.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])

  const replay = await service.enqueue(liveServiceInput())
  assert.equal(replay.id, failed.id)
  assert.equal(harness.queue.length, 1)
  assert.equal(harness.providerCalls, 1)
})

test('failure-evidence capture errors never replace the terminal provider subtype', async () => {
  const harness = await serviceHarness()
  const generate = harness.dependencies.generateCandidate
  harness.dependencies.generateCandidate = async (input) => ({
    ...await generate(input),
    buffer: Buffer.from('not-a-raster-image'),
  })
  harness.dependencies.normalizeCandidate = normalizeFrameRepairCandidate
  harness.dependencies.writeProviderFailureArtifacts = async () => {
    throw new Error('diagnostic writer unavailable')
  }
  const service = createFrameRepairService(harness.dependencies)
  await service.enqueue(liveServiceInput())
  await runQueued(harness.queue[0])

  const failed = await service.getOperation(operationLookup())
  assert.equal(failed.status, 'failed_model_error')
  assert.equal(failed.reason, 'provider_candidate_invalid')
  assert.equal(failed.retry_hint, 'inspect_provider_output_invalid')
  assert.equal(failed.provider_calls_used, 1)
  assert.equal(failed.generated_candidate_count, 1)
  assert.equal(harness.providerCalls, 1)
})

test('normalization, composite, package, and writer failures remain terminal and never retry', async () => {
  const cases = [
    ['normalization_failed', (dependencies) => {
      dependencies.normalizeCandidate = async () => { throw new Error('normalize') }
    }],
    ['composite_integrity_failed', (dependencies) => {
      const composite = dependencies.compositeCandidate
      dependencies.compositeCandidate = async (input) => {
        const result = await composite(input)
        return {
          ...result,
          integrity: {
            ...result.integrity,
            non_target_equal: false,
            actual_non_target_changed: 1,
          },
        }
      }
    }],
    ['package_failed', (dependencies) => {
      dependencies.packageSheet = async () => { throw new Error('package') }
    }],
    ['artifact_integrity_failed', (dependencies) => {
      dependencies.writeArtifacts = async () => { throw new Error('writer') }
    }],
  ]
  for (const [reason, mutate] of cases) {
    const harness = await serviceHarness()
    mutate(harness.dependencies)
    const service = createFrameRepairService(harness.dependencies)
    await service.enqueue(liveServiceInput())
    await runQueued(harness.queue[0])
    const failed = await service.getOperation(operationLookup())
    assert.equal(failed.status, 'failed_post_processing')
    assert.equal(failed.reason, reason)
    assert.equal(failed.provider_calls_used, 1)
    assert.equal(failed.generated_candidate_count, 1)
    assert.equal(harness.providerCalls, 1)
    const replay = await service.enqueue(liveServiceInput())
    assert.equal(replay.id, failed.id)
    assert.equal(harness.queue.length, 1)
  }
})

test('service independently rejects a composite that tampers with non-target pixels', async () => {
  const harness = await serviceHarness()
  const composite = harness.dependencies.compositeCandidate
  harness.dependencies.compositeCandidate = async (input) => {
    const result = await composite(input)
    const sheet = {
      width: result.sheet.width,
      height: result.sheet.height,
      data: new Uint8ClampedArray(result.sheet.data),
    }
    sheet.data[0] ^= 1
    return { ...result, sheet }
  }
  const service = createFrameRepairService(harness.dependencies)
  await service.enqueue(liveServiceInput())
  await runQueued(harness.queue[0])

  const failed = await service.getOperation(operationLookup())
  assert.equal(failed.status, 'failed_post_processing')
  assert.equal(failed.reason, 'composite_integrity_failed')
  assert.equal(harness.calls.some((item) => item.phase === 'package'), false)
})

test('service rejects masked pixels that do not come from the normalized candidate', async () => {
  const harness = await serviceHarness()
  const composite = harness.dependencies.compositeCandidate
  harness.dependencies.compositeCandidate = async (input) => {
    const result = await composite(input)
    const sheet = {
      width: result.sheet.width,
      height: result.sheet.height,
      data: new Uint8ClampedArray(result.sheet.data),
    }
    const after = {
      width: result.after.width,
      height: result.after.height,
      data: new Uint8ClampedArray(result.after.data),
    }
    const localOffset = (80 * 96 + 48) * 4
    const sheetOffset = ((2 * 96 + 80) * 768 + 96 + 48) * 4
    const forged = [250, 1, 2, 255]
    sheet.data.set(forged, sheetOffset)
    after.data.set(forged, localOffset)
    return {
      ...result,
      sheet,
      after,
      integrity: { ...result.integrity, changed_inside_mask: 1 },
    }
  }
  const service = createFrameRepairService(harness.dependencies)
  await service.enqueue(liveServiceInput())
  await runQueued(harness.queue[0])

  const failed = await service.getOperation(operationLookup())
  assert.equal(failed.status, 'failed_post_processing')
  assert.equal(failed.reason, 'composite_integrity_failed')
  assert.equal(harness.calls.some((item) => item.phase === 'package'), false)
})

test('provider and normalizer dependency mutations cannot rewrite captured authority', async () => {
  const harness = await serviceHarness()
  const generate = harness.dependencies.generateCandidate
  const normalize = harness.dependencies.normalizeCandidate
  harness.dependencies.generateCandidate = async (input) => {
    const result = await generate(input)
    input.providerPreset.apiKey = 'mutated-after-dispatch'
    input.plan.mask.runs[0].start = 0
    input.referenceImages[1].buffer.fill(0)
    return result
  }
  harness.dependencies.normalizeCandidate = async (input) => {
    const result = await normalize(input)
    input.parentSheet.data[0] = 255
    input.parentFrame.data.fill(0)
    return result
  }
  const service = createFrameRepairService(harness.dependencies)
  const input = liveServiceInput()
  await service.enqueue(input)
  await runQueued(harness.queue[0])

  const completed = await service.getOperation(operationLookup())
  assert.equal(completed.status, 'done')
  const writer = harness.calls.find((item) => item.phase === 'writer')
  assert.deepEqual(
    writer.input.evidence.frame_repair_mask,
    await encodeRgbaPng(editorProject.buildFrameRepairMaskVisualization(
      input.targetFrame,
      input.plan.mask,
    )),
  )
  assert.equal(writer.input.evidence.frame_repair_plan.mask.runs[0].start, 80 * 96 + 48)
})

test('concurrent first submissions share the persisted winner and one queue task', async () => {
  const harness = await serviceHarness()
  const service = createFrameRepairService(harness.dependencies)
  const [left, right] = await Promise.all([
    service.enqueue(liveServiceInput()),
    service.enqueue(liveServiceInput()),
  ])

  assert.equal(left.id, right.id)
  assert.equal(harness.jobs.size, 2)
  assert.equal(harness.queue.length, 1)
  await runQueued(harness.queue[0])
  assert.equal(harness.providerCalls, 1)
  assert.equal((await service.getOperation(operationLookup())).status, 'done')
})

test('restart reconstructs only sealed URLs and manifest and never enqueues', async () => {
  const harness = await serviceHarness()
  const service = createFrameRepairService(harness.dependencies)
  const queued = await service.enqueue(liveServiceInput())
  await runQueued(harness.queue[0])
  assert.equal((await service.getOperation(operationLookup())).status, 'done')

  const restarted = createFrameRepairService({
    ...harness.dependencies,
    getJob() { return null },
  })
  const recovered = await restarted.getOperation(operationLookup())
  assert.equal(recovered.id, queued.id)
  assert.equal(recovered.status, 'done')
  assert.equal(recovered.recovery_state, 'terminal')
  assert.equal(recovered.artifact_integrity_manifest.length,
    Object.keys(FRAME_REPAIR_INTEGRITY_FILES).length)
  assert.equal(containsPrivateValue(recovered), false)
  const replay = await restarted.enqueue(liveServiceInput())
  assert.equal(replay.id, queued.id)
  assert.equal(harness.queue.length, 1)
  assert.equal(harness.providerCalls, 1)
})

test('done is not published when the terminal ledger transition cannot persist', async () => {
  const harness = await serviceHarness()
  const persistedLedger = harness.dependencies.ledger
  harness.dependencies.ledger = {
    ...persistedLedger,
    async transition(lookup, patch) {
      if (patch.operation_status === 'done') throw new Error('ledger write failed')
      return persistedLedger.transition(lookup, patch)
    },
  }
  const service = createFrameRepairService(harness.dependencies)
  await service.enqueue(liveServiceInput())
  await runQueued(harness.queue[0])

  const unresolved = await service.getOperation(operationLookup())
  assert.equal(unresolved.status, 'post_processing')
  assert.equal(unresolved.recovery_state, 'outcome_unknown')
  assert.notEqual(unresolved.status, 'done')
  assert.equal(harness.providerCalls, 1)
  assert.equal(harness.calls.filter((item) => item.phase === 'writer').length, 1)
})

test('intermediate ledger persistence failures stop without dispatch retry or false terminal publication', async () => {
  for (const [stage, expected] of [
    ['dispatch', {
      status: 'failed_post_processing',
      recovery_state: 'interrupted_before_dispatch',
      provider_calls_used: 0,
      providerCalls: 0,
    }],
    ['known', {
      status: 'generating',
      recovery_state: 'outcome_unknown',
      provider_calls_used: 1,
      providerCalls: 1,
    }],
  ]) {
    const harness = await serviceHarness()
    const persistedLedger = harness.dependencies.ledger
    harness.dependencies.ledger = {
      ...persistedLedger,
      async transition(lookup, patch) {
        if (stage === 'dispatch' && patch.operation_status === 'dispatched' &&
            patch.provider_outcome === 'unknown') throw new Error('dispatch ledger unavailable')
        if (stage === 'known' && patch.operation_status === 'dispatched' &&
            patch.provider_outcome === 'known') throw new Error('outcome ledger unavailable')
        return persistedLedger.transition(lookup, patch)
      },
    }
    const service = createFrameRepairService(harness.dependencies)
    await service.enqueue(liveServiceInput())
    await runQueued(harness.queue[0])
    const unresolved = await service.getOperation(operationLookup())
    assert.equal(unresolved.status, expected.status)
    assert.equal(unresolved.recovery_state, expected.recovery_state)
    assert.equal(unresolved.provider_calls_used, expected.provider_calls_used)
    assert.equal(harness.providerCalls, expected.providerCalls)
    await service.enqueue(liveServiceInput())
    assert.equal(harness.queue.length, 1)
    assert.equal(harness.providerCalls, expected.providerCalls)
  }
})

test('private service snapshots reject accessor inputs before creating a job', async () => {
  const harness = await serviceHarness()
  const service = createFrameRepairService(harness.dependencies)
  const input = liveServiceInput()
  const lineage = input.lineage
  Object.defineProperty(input, 'lineage', {
    enumerable: true,
    get() { return lineage },
  })
  await assert.rejects(
    service.enqueue(input),
    (error) => error?.code === 'invalid_frame_repair_service_input',
  )
  assert.equal(harness.jobs.size, 0)
  assert.equal(harness.queue.length, 0)
})

test('reusing an operation id with a different plan is a conflict and creates no second job', async () => {
  const harness = await serviceHarness()
  const service = createFrameRepairService(harness.dependencies)
  await service.enqueue(liveServiceInput())
  const conflicting = liveServiceInput()
  conflicting.plan.instruction = 'Repair a different region'
  conflicting.identity.plan_hash = hashFrameRepairPlan(conflicting.plan)

  await assert.rejects(
    service.enqueue(conflicting),
    (error) => error?.code === 'operation_conflict',
  )
  assert.equal(harness.jobs.size, 1)
  assert.equal(harness.queue.length, 1)
  assert.equal(harness.providerCalls, 0)
})

test('canonical plan, mask, sheet, instruction, and image config are rejected before job creation', async () => {
  const mutations = [
    (input) => {
      input.plan.instruction = ' Repair the selected hand '
      input.identity.plan_hash = hashFrameRepairPlan(input.plan)
    },
    (input) => {
      input.plan.instruction = 'Use https://private.invalid/reference.png'
      input.identity.plan_hash = hashFrameRepairPlan(input.plan)
    },
    (input) => {
      input.plan.instruction = 'Use ../private/reference.png'
      input.identity.plan_hash = hashFrameRepairPlan(input.plan)
    },
    (input) => {
      input.plan.instruction = 'Use sk-abcdefghijklmnop'
      input.identity.plan_hash = hashFrameRepairPlan(input.plan)
    },
    (input) => {
      input.plan.provider.image_config.aspect_ratio = '   '
      input.providerPreset.image_config.aspect_ratio = '   '
      input.identity.plan_hash = hashFrameRepairPlan(input.plan)
    },
    (input) => {
      input.plan.mask.sha256 = '0'.repeat(64)
      input.identity.plan_hash = hashFrameRepairPlan(input.plan)
    },
    (input) => {
      input.parentSheetBuffer[input.parentSheetBuffer.length - 1] ^= 1
    },
    (input) => {
      input.referenceImages[1].mimeType = 'image/jpeg'
    },
  ]
  for (const mutate of mutations) {
    const harness = await serviceHarness()
    const service = createFrameRepairService(harness.dependencies)
    const input = liveServiceInput()
    mutate(input)
    await assert.rejects(
      service.enqueue(input),
      (error) => error?.code === 'invalid_frame_repair_service_input',
    )
    assert.equal(harness.jobs.size, 0)
    assert.equal(harness.queue.length, 0)
    assert.equal(harness.providerCalls, 0)
  }
})

test('quality is built after packaging and preserves a real validator failure for review', async () => {
  const harness = await serviceHarness()
  const packageSheet = harness.dependencies.packageSheet
  harness.dependencies.packageSheet = async (input) => {
    const result = await packageSheet(input)
    result.debugReport.validation = {
      status: 'fail',
      warnings: [],
      blocking_errors: ['frame_17_cropped'],
    }
    return result
  }
  const service = createFrameRepairService(harness.dependencies)
  await service.enqueue(liveServiceInput())
  await runQueued(harness.queue[0])

  const completed = await service.getOperation(operationLookup())
  assert.equal(completed.status, 'done')
  assert.equal(completed.quality_status, 'fail')
  const writer = harness.calls.find((item) => item.phase === 'writer')
  assert.equal(writer.input.evidence.frame_repair_quality.status, 'fail')
  assert.deepEqual(writer.input.evidence.frame_repair_quality.validation.blocking_errors,
    ['frame_17_cropped'])
})

test('writer manifest digest mismatch cannot be published as done', async () => {
  const harness = await serviceHarness()
  const writeArtifacts = harness.dependencies.writeArtifacts
  harness.dependencies.writeArtifacts = async (input) => ({
    ...await writeArtifacts(input),
    artifact_manifest_sha256: '0'.repeat(64),
  })
  const service = createFrameRepairService(harness.dependencies)
  await service.enqueue(liveServiceInput())
  await runQueued(harness.queue[0])

  const failed = await service.getOperation(operationLookup())
  assert.equal(failed.status, 'failed_post_processing')
  assert.equal(failed.reason, 'artifact_integrity_failed')
  assert.equal(failed.artifact_manifest_sha256, null)
  assert.equal(harness.providerCalls, 1)
})

test('eager shared queue projects durable active states without false recovery failures', async () => {
  const harness = await serviceHarness()
  const persistedLedger = harness.dependencies.ledger
  let releaseDispatch
  let releasePost
  let signalDispatch
  let signalPost
  const dispatchPersisted = new Promise((resolve) => { signalDispatch = resolve })
  const postPersisted = new Promise((resolve) => { signalPost = resolve })
  const dispatchGate = new Promise((resolve) => { releaseDispatch = resolve })
  const postGate = new Promise((resolve) => { releasePost = resolve })
  harness.dependencies.ledger = {
    ...persistedLedger,
    async transition(lookup, patch) {
      const result = await persistedLedger.transition(lookup, patch)
      if (patch.operation_status === 'dispatched' && patch.provider_outcome === 'unknown') {
        signalDispatch()
        await dispatchGate
      }
      if (patch.operation_status === 'post_processing') {
        signalPost()
        await postGate
      }
      return result
    },
  }
  let taskCompletion = Promise.resolve()
  harness.dependencies.jobQueue = {
    enqueue(task, onError) {
      taskCompletion = Promise.resolve().then(task).catch(onError)
    },
  }
  const service = createFrameRepairService(harness.dependencies)
  await service.enqueue(liveServiceInput())

  await dispatchPersisted
  const generating = await service.getOperation(operationLookup())
  assert.equal(generating.status, 'generating')
  assert.equal(generating.provider_calls_used, 1)
  assert.equal(generating.recovery_state, null)
  releaseDispatch()

  await postPersisted
  const post = await service.getOperation(operationLookup())
  assert.equal(post.status, 'post_processing')
  assert.equal(post.generated_candidate_count, 1)
  assert.equal(post.recovery_state, null)
  releasePost()
  await taskCompletion
  assert.equal((await service.getOperation(operationLookup())).status, 'done')
})
