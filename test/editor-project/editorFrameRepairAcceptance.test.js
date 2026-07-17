import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Worker } from 'node:worker_threads'

import {
  buildAnimationsJson,
  buildEditorMetadataJson,
} from '../../src/character-pack/packageBuilder.js'
import { encodeRgbaPng, loadRgba } from '../../src/character-pack/imageCodec.js'
import { TOPDOWN_RPG_V0 } from '../../src/character-pack/profile.js'

import {
  buildFrameRepairPrompt,
  buildFrameRepairQualityReport,
  compositeFrameRepairCandidate,
  createAssetRef,
  createAssetRevision,
  createDefaultEditorProject,
  createFrameRepairCoordinator,
  extractFrameRgba,
  FRAME_REPAIR_INTEGRITY_FILES,
  importAcceptedFrameRepairAsAsset,
  packageNormalizedCharacterSheet,
  runsToBitset,
  saveEditorProject,
  validateEditorProject,
  writeFrameRepairArtifacts,
} from '../../src/editor-project/index.js'

const CREATED_AT = '2026-07-11T01:00:00.000Z'
const JOB_ID = 'job_frame_repair_accept'
const OPERATION_ID = 'fr_accept0123456789'

function managedRef(fileName, revisionId = 'rev_001') {
  return `workspace/projects/project_demo/assets/asset_hero/${revisionId}/${fileName}`
}

function rgbaSheet() {
  const data = new Uint8ClampedArray(TOPDOWN_RPG_V0.sheet.w * TOPDOWN_RPG_V0.sheet.h * 4)
  for (let frame = 0; frame < 64; frame += 1) {
    const originX = (frame % 8) * 96
    const originY = Math.floor(frame / 8) * 96
    for (let y = 34; y < 66; y += 1) {
      for (let x = 36; x < 60; x += 1) {
        const offset = ((originY + y) * TOPDOWN_RPG_V0.sheet.w + originX + x) * 4
        data[offset] = 40 + frame
        data[offset + 1] = 100
        data[offset + 2] = 160
        data[offset + 3] = 255
      }
    }
  }
  return { width: TOPDOWN_RPG_V0.sheet.w, height: TOPDOWN_RPG_V0.sheet.h, data }
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

function cloneRgba(value) {
  return { width: value.width, height: value.height, data: new Uint8ClampedArray(value.data) }
}

function differenceRgba(before, after) {
  const data = new Uint8ClampedArray(before.data.length)
  for (let offset = 0; offset < data.length; offset += 4) {
    let changed = false
    for (let channel = 0; channel < 4; channel += 1) {
      data[offset + channel] = Math.abs(before.data[offset + channel] - after.data[offset + channel])
      changed ||= data[offset + channel] !== 0
    }
    if (changed && data[offset + 3] === 0) data[offset + 3] = 255
  }
  return { width: before.width, height: before.height, data }
}

function maskVisualization(frame, mask) {
  const active = runsToBitset(mask.runs, mask.width * mask.height)
  const data = new Uint8ClampedArray(frame.data.length)
  for (let pixel = 0; pixel < active.length; pixel += 1) {
    const offset = pixel * 4
    if (active[pixel]) {
      data.set([255, 56, 176, 255], offset)
    } else {
      data[offset] = frame.data[offset]
      data[offset + 1] = frame.data[offset + 1]
      data[offset + 2] = frame.data[offset + 2]
      data[offset + 3] = Math.min(frame.data[offset + 3], 64)
    }
  }
  return { width: mask.width, height: mask.height, data }
}

function planBody(project) {
  return {
    expectedRevision: project.revision,
    expectedAssetRevisionId: 'rev_001',
    clipId: 'walk_down',
    clipFramePosition: 1,
    sheetFrameIndex: 17,
    instruction: 'Repair the left outline',
    maskEdits: [{ op: 'add_rectangle', x: 34, y: 30, width: 28, height: 38 }],
    providerPresetId: 'test-preset',
    imageConfig: { image_size: '1K' },
  }
}

function validationEvidence(mode) {
  const status = mode === 'fail' ? 'fail' : mode === 'warning' ? 'warning' : 'pass'
  const warnings = status === 'warning' ? ['acceptance_warning'] : []
  const blockingErrors = status === 'fail' ? ['acceptance_failure'] : []
  return {
    status,
    warnings,
    blocking_errors: blockingErrors,
    deltas: {
      warnings_added: [...warnings],
      warnings_removed: [],
      blocking_errors_added: [...blockingErrors],
      blocking_errors_removed: [],
    },
  }
}

async function completedFrameRepairFixture({ qualityMode = 'pass' } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'editor-frame-repair-acceptance-'))
  const workspaceRoot = path.join(root, 'workspace')
  const generatedDir = path.join(root, 'generated')
  const revisionDir = path.join(
    workspaceRoot,
    'projects',
    'project_demo',
    'assets',
    'asset_hero',
    'rev_001',
  )
  await mkdir(revisionDir, { recursive: true })
  const parentSheet = rgbaSheet()
  const parentSheetBuffer = await encodeRgbaPng(parentSheet)
  const animations = buildAnimationsJson(TOPDOWN_RPG_V0)
  const metadata = {
    version: TOPDOWN_RPG_V0.version,
    id: 'hero',
    name: 'Hero',
    description: 'Managed hero',
    profile: TOPDOWN_RPG_V0.id,
    source: { type: 'upload' },
    generation: { provider: null, model: null },
    quality: { status: 'pass', warnings: [], blocking_errors: [] },
  }
  const editorMetadata = buildEditorMetadataJson({
    metadata,
    animationsJson: animations,
    frames: [],
    profile: TOPDOWN_RPG_V0,
  })
  const debugReport = {
    version: TOPDOWN_RPG_V0.version,
    profile: TOPDOWN_RPG_V0.id,
    source_layout: { id: TOPDOWN_RPG_V0.id, kind: 'uniform_grid' },
    validation: { status: 'pass', warnings: [], blocking_errors: [] },
  }
  await writeFile(path.join(revisionDir, 'normalized_sheet.png'), parentSheetBuffer)
  await writeJson(path.join(revisionDir, 'animations.json'), animations)
  await writeJson(path.join(revisionDir, 'metadata.json'), metadata)
  await writeJson(path.join(revisionDir, 'editor_metadata.json'), editorMetadata)
  await writeJson(path.join(revisionDir, 'debug_report.json'), debugReport)

  const revision = createAssetRevision({
    id: 'rev_001',
    sourceJobId: 'job_parent',
    createdAt: CREATED_AT,
    qualityStatus: 'pass',
    productionStatus: 'ready',
    artifacts: {
      sheet: managedRef('normalized_sheet.png'),
      animations: managedRef('animations.json'),
      metadata: managedRef('metadata.json'),
      editor_metadata: managedRef('editor_metadata.json'),
      debug_report: managedRef('debug_report.json'),
    },
  })
  const asset = createAssetRef({
    id: 'asset_hero',
    kind: 'character_pack',
    name: 'Hero',
    profile: TOPDOWN_RPG_V0.id,
    revision,
    provenance: { source_type: 'upload', provider: null, model: null },
    clips: Object.fromEntries(Object.entries(animations.animations).map(([id, clip]) => [id, {
      id,
      source: 'animations.json',
      frames: [...clip.frames],
      fps: clip.fps,
      loop_mode: clip.mode,
      frame_size: { ...TOPDOWN_RPG_V0.frame },
      anchor: { x: TOPDOWN_RPG_V0.anchor.x, y: TOPDOWN_RPG_V0.anchor.y },
    }])),
  })
  const draft = createDefaultEditorProject({
    id: 'project_demo',
    name: 'Demo',
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  })
  draft.assets.asset_hero = asset
  const saved = await saveEditorProject({
    project: draft,
    projectRoot: root,
    workspaceRoot,
    now: new Date(CREATED_AT),
  })
  const project = saved.project
  let completedJob = null
  let durableJob = null
  const service = {
    enqueue() {
      throw new Error('acceptance fixture must not enqueue')
    },
    getJob(jobId) {
      return completedJob?.id === jobId ? completedJob : null
    },
    async getOperation() {
      return durableJob
    },
  }
  const coordinator = createFrameRepairCoordinator({
    projectRoot: root,
    workspaceRoot,
    generatedDir,
    implementationRevision: 'package-0.5.0',
    getProviderEnv: () => ({
      CHARACTER_PROVIDER_PRESETS: JSON.stringify([{
        id: 'test-preset',
        label: 'Test preset',
        provider: 'openrouter',
        apiKey: 'private-provider-key',
        model: 'provider/image-model',
        aspect_ratio: '1:1',
        image_size: '1K',
      }]),
    }),
    frameRepairService: service,
  })
  const planned = await coordinator.planFrameRepair({
    projectId: project.id,
    assetId: asset.id,
    body: planBody(project),
  })
  const plan = planned.plan
  const before = extractFrameRgba(parentSheet, plan.clip.sheet_frame_index, plan.profile.frame_size)
  const candidate = cloneRgba(before)
  const active = runsToBitset(plan.mask.runs, plan.mask.width * plan.mask.height)
  const changedPixel = active.findIndex(Boolean)
  const changedOffset = changedPixel * 4
  candidate.data[changedOffset] = (candidate.data[changedOffset] + 73) % 256
  candidate.data[changedOffset + 1] = 210
  candidate.data[changedOffset + 3] = 255
  const composite = compositeFrameRepairCandidate({
    parentSheet,
    candidateFrame: candidate,
    sheetFrameIndex: plan.clip.sheet_frame_index,
    frameSize: plan.profile.frame_size,
    mask: plan.mask,
  })
  const patchedSheetBuffer = await encodeRgbaPng(composite.sheet)
  const generation = {
    mode: 'editor_targeted_frame_repair',
    provider: plan.provider.provider,
    provider_preset_id: plan.provider.id,
    provider_label: plan.provider.label,
    model: plan.provider.model,
    image_config: { ...plan.provider.image_config },
  }
  const packageValidation = validationEvidence(qualityMode)
  const characterResult = await packageNormalizedCharacterSheet({
    normalizedSheetPng: patchedSheetBuffer,
    profile: TOPDOWN_RPG_V0,
    parentAnimations: animations,
    parentMetadata: metadata,
    createdAt: CREATED_AT,
    lineage: {
      project_id: project.id,
      asset_id: asset.id,
      parent_revision_id: revision.id,
      parent_job_id: revision.source_job_id,
      parent_processing_recipe_ref: null,
    },
    generation,
  })
  const packageValidationProjection = {
    status: packageValidation.status,
    warnings: [...packageValidation.warnings],
    blocking_errors: [...packageValidation.blocking_errors],
  }
  characterResult.metadataJson.quality = structuredClone(packageValidationProjection)
  characterResult.debugReport.validation = {
    ...characterResult.debugReport.validation,
    ...structuredClone(packageValidationProjection),
  }
  const adjacentClipFrames = plan.clip.context_frames.map((item) => ({
    role: item.position < plan.clip.position ? 'previous' : 'next',
    frame: extractFrameRgba(parentSheet, item.sheet_frame_index, plan.profile.frame_size),
  }))
  const quality = buildFrameRepairQualityReport({
    complete: qualityMode !== 'unknown',
    parentFrame: before,
    compositedFrame: composite.after,
    normalizedProviderFrame: candidate,
    adjacentClipFrames,
    mask: plan.mask,
    integrity: composite.integrity,
    continuity: { status: 'measured', warnings: [] },
    validation: packageValidation,
  })
  const contextBase = {
    version: 'editor_frame_repair_context_v1',
    job_type: 'editor_character_frame_repair',
    job_id: JOB_ID,
    operation_id: OPERATION_ID,
    submitted_at: CREATED_AT,
    project_id: project.id,
    project_revision: project.revision,
    asset_id: asset.id,
    parent_revision_id: revision.id,
    parent_sheet_ref: revision.artifacts.sheet,
    parent_sheet_sha256: plan.parent_sheet_sha256,
    parent_processing_recipe_ref: null,
    profile: plan.profile.id,
    frame_size: { ...plan.profile.frame_size },
    sheet_size: { ...animations.sheet_size },
    clip_id: plan.clip.id,
    clip_frame_position: plan.clip.position,
    sheet_frame_index: plan.clip.sheet_frame_index,
    target_frame_sha256: plan.target_frame_sha256,
    context_frames: plan.clip.context_frames.map((item) => ({ ...item })),
    reference_context_sha256: plan.references.context_sha256,
    mask_sha256: plan.mask.sha256,
    plan_hash: planned.plan_hash,
    provider_preset: structuredClone(plan.provider),
    provider_call_budget: 1,
    provider_calls_used: 1,
    implementation_revision: plan.implementation_revision,
    input_reference_roles: [...plan.references.input_reference_roles],
  }
  const framePng = await encodeRgbaPng(candidate)
  const beforePng = await encodeRgbaPng(before)
  const maskPng = await encodeRgbaPng(maskVisualization(before, plan.mask))
  const afterPng = await encodeRgbaPng(composite.after)
  const jobDir = path.join(generatedDir, JOB_ID)
  await mkdir(jobDir, { recursive: true })
  const sealed = await writeFrameRepairArtifacts({
    generatedDir,
    job: { id: JOB_ID, created_at: CREATED_AT },
    characterResult,
    evidence: {
      frame_repair_plan: plan,
      frame_repair_context_base: contextBase,
      target_before: beforePng,
      frame_repair_mask: maskPng,
      frame_repair_context_image: beforePng,
      raw_provider_output: framePng,
      normalized_candidate_frame: framePng,
      composited_candidate_frame: afterPng,
      frame_repair_difference: await encodeRgbaPng(differenceRgba(before, composite.after)),
      frame_repair_quality: quality,
      frame_repair_prompt: Buffer.from(buildFrameRepairPrompt(plan), 'utf8'),
      patched_normalized_sheet: patchedSheetBuffer,
    },
  })
  completedJob = {
    id: JOB_ID,
    created_at: CREATED_AT,
    status: 'done',
    type: 'editor_character_frame_repair',
    project_id: project.id,
    project_revision: project.revision,
    asset_id: asset.id,
    parent_revision_id: revision.id,
    operation_id: OPERATION_ID,
    plan_hash: planned.plan_hash,
    implementation_revision: plan.implementation_revision,
    provider_call_budget: 1,
    provider_calls_used: 1,
    generated_candidate_count: 1,
    quality_status: quality.status,
    reason: null,
    retry_hint: null,
    recovery_state: null,
    ...sealed,
  }
  durableJob = completedJob
  return {
    root,
    workspaceRoot,
    generatedDir,
    project,
    asset: project.assets.asset_hero,
    revision: project.assets.asset_hero.revisions.rev_001,
    plan,
    planHash: planned.plan_hash,
    quality,
    job: completedJob,
    coordinator,
    dropInMemoryJob() {
      completedJob = null
    },
    setDurableJob(value) {
      durableJob = value
    },
    acceptRequest() {
      return {
        projectId: project.id,
        assetId: asset.id,
        jobId: JOB_ID,
        body: {
          expectedRevision: project.revision,
          expectedAssetRevisionId: revision.id,
          expectedPlanHash: planned.plan_hash,
          warningConfirmed: quality.status === 'warning',
        },
      }
    },
  }
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    return value
  }
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]))
}

function digest(value) {
  return createHash('sha256').update(Buffer.from(JSON.stringify(stableValue(value)))).digest('hex')
}

async function resealFixture(fixture) {
  const jobDir = path.join(fixture.generatedDir, fixture.job.id)
  const inner = []
  for (const [key, fileName] of Object.entries(FRAME_REPAIR_INTEGRITY_FILES)) {
    if (key === 'frame_repair_context') continue
    const content = await readFile(path.join(jobDir, fileName))
    inner.push({ key, file_name: fileName, size: content.length, sha256: createHash('sha256').update(content).digest('hex') })
  }
  const contextPath = path.join(jobDir, FRAME_REPAIR_INTEGRITY_FILES.frame_repair_context)
  const context = JSON.parse(await readFile(contextPath, 'utf8'))
  context.sealed_artifacts = inner
  await writeFile(contextPath, `${JSON.stringify(context, null, 2)}\n`)
  const outer = []
  for (const [key, fileName] of Object.entries(FRAME_REPAIR_INTEGRITY_FILES)) {
    const content = await readFile(path.join(jobDir, fileName))
    outer.push({ key, file_name: fileName, size: content.length, sha256: createHash('sha256').update(content).digest('hex') })
  }
  fixture.job.artifact_integrity_manifest = outer
  fixture.job.artifact_manifest_sha256 = digest(outer)
}

async function mutateSealedJson(fixture, key, mutate) {
  const filePath = path.join(
    fixture.generatedDir,
    fixture.job.id,
    FRAME_REPAIR_INTEGRITY_FILES[key],
  )
  const value = JSON.parse(await readFile(filePath, 'utf8'))
  mutate(value)
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`)
  await resealFixture(fixture)
}

async function mutateSealedSheetPixels(fixture, { targetOutsideMask = false } = {}) {
  const jobDir = path.join(fixture.generatedDir, fixture.job.id)
  for (const key of ['source', 'sheet', 'patched_normalized_sheet']) {
    const filePath = path.join(jobDir, FRAME_REPAIR_INTEGRITY_FILES[key])
    const image = await loadRgba(await readFile(filePath))
    let x = 0
    let y = 0
    if (targetOutsideMask) {
      x = (fixture.plan.clip.sheet_frame_index % 8) * 96
      y = Math.floor(fixture.plan.clip.sheet_frame_index / 8) * 96
    }
    const offset = (y * image.width + x) * 4
    image.data.set([245, 20, 30, 255], offset)
    await writeFile(filePath, await encodeRgbaPng(image))
  }
  if (targetOutsideMask) {
    const filePath = path.join(
      jobDir,
      FRAME_REPAIR_INTEGRITY_FILES.composited_candidate_frame,
    )
    const image = await loadRgba(await readFile(filePath))
    image.data.set([245, 20, 30, 255], 0)
    await writeFile(filePath, await encodeRgbaPng(image))
  }
  await resealFixture(fixture)
}

test('specialized Frame Repair acceptance APIs are exported', () => {
  assert.equal(typeof createFrameRepairCoordinator, 'function')
  assert.equal(typeof importAcceptedFrameRepairAsAsset, 'function')
})

test('Accept imports the exact sealed job as one child with no Processing Recipe', async () => {
  const fixture = await completedFrameRepairFixture({ qualityMode: 'pass' })
  const result = await fixture.coordinator.acceptFrameRepair(fixture.acceptRequest())
  assert.equal(result.accepted, true)
  assert.equal(result.revision.parent_revision_id, fixture.revision.id)
  assert.equal(result.revision.processing_recipe_ref, null)
  assert.equal(
    result.revision.artifacts.frame_repair_context.endsWith('/editor_frame_repair_context.json'),
    true,
  )
  assert.equal(result.revision.artifacts.raw_provider_output, undefined)
  assert.equal(result.revision.artifacts.frame_repair_prompt, undefined)
  assert.equal(result.revision.artifacts.godot_npc_zip.endsWith('/godot_npc_pack.zip'), true)
  assert.equal(result.revision.artifacts.inspection_sheet.endsWith('/inspection_sheet.png'), true)
  assert.equal(result.project.revision, fixture.project.revision + 1)
  assert.equal(fixture.project.assets.asset_hero.active_revision_id, fixture.revision.id)
  assert.equal(validateEditorProject(result.project).status, 'pass')
  assert.ok((await readFile(path.join(fixture.root, result.revision.artifacts.sheet))).length > 0)
})

test('two concurrent Accepts produce one child and one revision conflict', async () => {
  const fixture = await completedFrameRepairFixture({ qualityMode: 'pass' })
  const request = fixture.acceptRequest()
  const results = await Promise.allSettled([
    fixture.coordinator.acceptFrameRepair(request),
    fixture.coordinator.acceptFrameRepair(request),
  ])
  assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1)
  assert.equal(results.filter((item) => item.status === 'rejected').length, 1)
  const rejected = results.find((item) => item.status === 'rejected')
  assert.equal(rejected.reason?.code, 'revision_conflict')
})

test('copy failure preserves its orphan revision and the next Accept never reuses it', async () => {
  const fixture = await completedFrameRepairFixture({ qualityMode: 'pass' })
  const assetDir = path.join(
    fixture.workspaceRoot,
    'projects',
    fixture.project.id,
    'assets',
    fixture.asset.id,
  )
  const worker = new Worker(`
    const { parentPort, workerData } = require('node:worker_threads')
    const { watch, writeFileSync } = require('node:fs')
    const path = require('node:path')
    const watcher = watch(workerData.assetDir, (eventType, fileName) => {
      if (String(fileName) !== 'rev_002') return
      try {
        writeFileSync(
          path.join(workerData.assetDir, 'rev_002', workerData.fileName),
          'preserved orphan sentinel',
          { flag: 'wx', mode: 0o600 },
        )
        parentPort.postMessage({ type: 'injected' })
      } catch (error) {
        parentPort.postMessage({ type: 'inject_error', code: error && error.code })
      } finally {
        watcher.close()
      }
    })
    const timeout = setTimeout(() => {
      watcher.close()
      parentPort.postMessage({ type: 'inject_timeout' })
    }, 5000)
    watcher.on('close', () => clearTimeout(timeout))
    parentPort.postMessage({ type: 'ready' })
  `, {
    eval: true,
    workerData: {
      assetDir,
      fileName: FRAME_REPAIR_INTEGRITY_FILES.patched_normalized_sheet,
    },
  })
  try {
    await new Promise((resolve, reject) => {
      const onMessage = (message) => {
        if (message?.type !== 'ready') return
        worker.off('error', reject)
        worker.off('message', onMessage)
        resolve()
      }
      worker.on('message', onMessage)
      worker.once('error', reject)
    })
    const injected = new Promise((resolve, reject) => {
      const onMessage = (message) => {
        if (message?.type === 'injected') {
          worker.off('message', onMessage)
          resolve()
        } else if (message?.type === 'inject_error' || message?.type === 'inject_timeout') {
          worker.off('message', onMessage)
          reject(new Error(`copy conflict injection failed: ${message.type}:${message.code ?? ''}`))
        }
      }
      worker.on('message', onMessage)
      worker.once('error', reject)
    })
    const rejected = assert.rejects(
      fixture.coordinator.acceptFrameRepair(fixture.acceptRequest()),
      (error) => error?.code === 'artifact_integrity_failed',
    )
    await Promise.all([injected, rejected])
  } finally {
    await worker.terminate()
  }
  const orphanDir = path.join(assetDir, 'rev_002')
  assert.equal(
    await readFile(
      path.join(orphanDir, FRAME_REPAIR_INTEGRITY_FILES.patched_normalized_sheet),
      'utf8',
    ),
    'preserved orphan sentinel',
  )
  const accepted = await fixture.coordinator.acceptFrameRepair(fixture.acceptRequest())
  assert.equal(accepted.revision.id, 'rev_003')
  assert.equal(fixture.project.assets.asset_hero.active_revision_id, fixture.revision.id)
})

test('formal save failure keeps project JSON unchanged and preserves copied orphan evidence', async () => {
  const fixture = await completedFrameRepairFixture({ qualityMode: 'pass' })
  const projectDir = path.join(
    fixture.workspaceRoot,
    'projects',
    fixture.project.id,
  )
  const projectPath = path.join(projectDir, 'project.json')
  const before = await readFile(projectPath)
  await mkdir(path.join(projectDir, 'project.backup.json'))
  await assert.rejects(fixture.coordinator.acceptFrameRepair(fixture.acceptRequest()))
  assert.deepEqual(await readFile(projectPath), before)
  assert.ok((await readFile(path.join(
    projectDir,
    'assets',
    fixture.asset.id,
    'rev_002',
    FRAME_REPAIR_INTEGRITY_FILES.sheet,
  ))).length > 0)
  assert.equal(fixture.project.assets.asset_hero.active_revision_id, fixture.revision.id)
})

test('warning requires exact confirmation while fail and unknown quality stay blocked', async (t) => {
  await t.test('warning', async () => {
    const fixture = await completedFrameRepairFixture({ qualityMode: 'warning' })
    const request = fixture.acceptRequest()
    request.body.warningConfirmed = false
    await assert.rejects(
      fixture.coordinator.acceptFrameRepair(request),
      (error) => error?.code === 'warning_confirmation_required',
    )
    request.body.warningConfirmed = true
    const accepted = await fixture.coordinator.acceptFrameRepair(request)
    assert.equal(accepted.revision.quality_status, 'warning')
    assert.equal(accepted.revision.production_status, 'review_required')
  })

  for (const qualityMode of ['fail', 'unknown']) {
    await t.test(qualityMode, async () => {
      const fixture = await completedFrameRepairFixture({ qualityMode })
      await assert.rejects(
        fixture.coordinator.acceptFrameRepair(fixture.acceptRequest()),
        (error) => error?.code === 'quality_blocked',
      )
    })
  }
})

test('Accept rejects stale request identities and incomplete job accounting', async (t) => {
  await t.test('stale project', async () => {
    const fixture = await completedFrameRepairFixture()
    const request = fixture.acceptRequest()
    request.body.expectedRevision -= 1
    await assert.rejects(
      fixture.coordinator.acceptFrameRepair(request),
      (error) => error?.code === 'revision_conflict',
    )
  })

  await t.test('stale asset', async () => {
    const fixture = await completedFrameRepairFixture()
    const request = fixture.acceptRequest()
    request.body.expectedAssetRevisionId = 'rev_999'
    await assert.rejects(
      fixture.coordinator.acceptFrameRepair(request),
      (error) => error?.code === 'asset_revision_conflict',
    )
  })

  for (const [field, value] of [
    ['type', 'editor_character_reprocess'],
    ['status', 'generating'],
    ['provider_calls_used', 0],
    ['generated_candidate_count', 0],
  ]) {
    await t.test(`${field} mismatch`, async () => {
      const fixture = await completedFrameRepairFixture()
      fixture.job[field] = value
      await assert.rejects(
        fixture.coordinator.acceptFrameRepair(fixture.acceptRequest()),
        (error) => error?.code === 'job_not_ready',
      )
    })
  }
})

test('sealed plan, context, quality, manifest, and plan hash tamper never mutate the project', async (t) => {
  for (const key of ['frame_repair_plan', 'frame_repair_context', 'frame_repair_quality']) {
    await t.test(key, async () => {
      const fixture = await completedFrameRepairFixture()
      const filePath = path.join(
        fixture.generatedDir,
        fixture.job.id,
        FRAME_REPAIR_INTEGRITY_FILES[key],
      )
      await writeFile(filePath, Buffer.from('{"tampered":true}\n'))
      await assert.rejects(
        fixture.coordinator.acceptFrameRepair(fixture.acceptRequest()),
        (error) => error?.code === 'artifact_integrity_failed',
      )
    })
  }

  await t.test('outer manifest digest', async () => {
    const fixture = await completedFrameRepairFixture()
    fixture.job.artifact_manifest_sha256 = 'f'.repeat(64)
    await assert.rejects(
      fixture.coordinator.acceptFrameRepair(fixture.acceptRequest()),
      (error) => error?.code === 'artifact_integrity_failed',
    )
  })

  await t.test('job plan hash', async () => {
    const fixture = await completedFrameRepairFixture()
    fixture.job.plan_hash = 'f'.repeat(64)
    await assert.rejects(
      fixture.coordinator.acceptFrameRepair(fixture.acceptRequest()),
      (error) => error?.code === 'job_not_ready',
    )
  })

  await t.test('re-sealed quality policy mismatch', async () => {
    const fixture = await completedFrameRepairFixture()
    const qualityPath = path.join(
      fixture.generatedDir,
      fixture.job.id,
      FRAME_REPAIR_INTEGRITY_FILES.frame_repair_quality,
    )
    const quality = JSON.parse(await readFile(qualityPath, 'utf8'))
    quality.status = 'warning'
    fixture.job.quality_status = 'warning'
    await writeFile(qualityPath, `${JSON.stringify(quality, null, 2)}\n`)
    await resealFixture(fixture)
    await assert.rejects(
      fixture.coordinator.acceptFrameRepair(fixture.acceptRequest()),
      (error) => error?.code === 'quality_blocked',
    )
  })
})

test('fully re-sealed Context fields remain cross-bound to the canonical Plan', async (t) => {
  const mutations = [
    ['profile', (context) => { context.profile = 'topdown_rpg_v1' }],
    ['frame_size', (context) => { context.frame_size = { w: 48, h: 48 } }],
    ['clip_id', (context) => { context.clip_id = 'walk_left' }],
    ['clip_frame_position', (context) => { context.clip_frame_position = 0 }],
    ['sheet_frame_index', (context) => { context.sheet_frame_index = 16 }],
    ['context_frames', (context) => {
      context.context_frames[0].sheet_frame_index += 1
    }],
    ['target_frame_sha256', (context) => { context.target_frame_sha256 = 'f'.repeat(64) }],
    ['reference_context_sha256', (context) => {
      context.reference_context_sha256 = 'f'.repeat(64)
    }],
    ['mask_sha256', (context) => { context.mask_sha256 = 'f'.repeat(64) }],
  ]
  for (const [name, mutate] of mutations) {
    await t.test(name, async () => {
      const fixture = await completedFrameRepairFixture()
      await mutateSealedJson(fixture, 'frame_repair_context', mutate)
      await assert.rejects(
        fixture.coordinator.acceptFrameRepair(fixture.acceptRequest()),
        (error) => ['identity_mismatch', 'artifact_integrity_failed'].includes(error?.code),
      )
    })
  }
})

test('fully re-sealed standard package validation cannot contradict repair quality', async (t) => {
  for (const key of ['metadata', 'debug_report']) {
    await t.test(key, async () => {
      const fixture = await completedFrameRepairFixture()
      await mutateSealedJson(fixture, key, (document) => {
        const validation = key === 'metadata' ? document.quality : document.validation
        validation.status = 'fail'
        validation.warnings = []
        validation.blocking_errors = ['resealed_standard_failure']
      })
      await assert.rejects(
        fixture.coordinator.acceptFrameRepair(fixture.acceptRequest()),
        (error) => error?.code === 'identity_mismatch',
      )
    })
  }
})

test('fully re-sealed mask and difference visual evidence is independently verified', async (t) => {
  for (const key of ['frame_repair_mask', 'frame_repair_difference']) {
    await t.test(key, async () => {
      const fixture = await completedFrameRepairFixture()
      const jobDir = path.join(fixture.generatedDir, fixture.job.id)
      const replacement = await readFile(path.join(
        jobDir,
        FRAME_REPAIR_INTEGRITY_FILES.target_before,
      ))
      await writeFile(path.join(jobDir, FRAME_REPAIR_INTEGRITY_FILES[key]), replacement)
      await resealFixture(fixture)
      await assert.rejects(
        fixture.coordinator.acceptFrameRepair(fixture.acceptRequest()),
        (error) => error?.code === 'artifact_integrity_failed',
      )
    })
  }
})

test('Accept independently rejects parent replacement and fully re-sealed pixel violations', async (t) => {
  await t.test('parent replacement', async () => {
    const fixture = await completedFrameRepairFixture()
    const replacement = rgbaSheet()
    replacement.data.set([255, 1, 2, 255], 0)
    await writeFile(
      path.join(fixture.root, fixture.revision.artifacts.sheet),
      await encodeRgbaPng(replacement),
    )
    await assert.rejects(
      fixture.coordinator.acceptFrameRepair(fixture.acceptRequest()),
      (error) => error?.code === 'identity_mismatch',
    )
  })

  await t.test('non-target mutation', async () => {
    const fixture = await completedFrameRepairFixture()
    await mutateSealedSheetPixels(fixture)
    await assert.rejects(
      fixture.coordinator.acceptFrameRepair(fixture.acceptRequest()),
      (error) => error?.code === 'artifact_integrity_failed',
    )
  })

  await t.test('target outside-mask mutation', async () => {
    const fixture = await completedFrameRepairFixture()
    await mutateSealedSheetPixels(fixture, { targetOutsideMask: true })
    await assert.rejects(
      fixture.coordinator.acceptFrameRepair(fixture.acceptRequest()),
      (error) => error?.code === 'artifact_integrity_failed',
    )
  })
})

test('Accept recovers the exact durable operation after in-memory job loss', async () => {
  const fixture = await completedFrameRepairFixture()
  fixture.dropInMemoryJob()
  const restartSafeWinner = structuredClone(fixture.job)
  delete restartSafeWinner.project_revision
  delete restartSafeWinner.implementation_revision
  restartSafeWinner.created_at = new Date(
    Date.parse(restartSafeWinner.created_at) + 1,
  ).toISOString()
  restartSafeWinner.quality_status = 'unknown'
  restartSafeWinner.recovery_state = 'terminal'
  fixture.setDurableJob(restartSafeWinner)
  const accepted = await fixture.coordinator.acceptFrameRepair(fixture.acceptRequest())
  assert.equal(accepted.accepted, true)
  assert.equal(accepted.revision.source_job_id, fixture.job.id)
})

test('restart recovery rejects malformed fixed Context before ledger lookup', async () => {
  const fixture = await completedFrameRepairFixture()
  fixture.dropInMemoryJob()
  await writeFile(
    path.join(
      fixture.generatedDir,
      fixture.job.id,
      FRAME_REPAIR_INTEGRITY_FILES.frame_repair_context,
    ),
    '{not-json',
  )
  await assert.rejects(
    fixture.coordinator.acceptFrameRepair(fixture.acceptRequest()),
    (error) => error?.code === 'artifact_integrity_failed',
  )
})

test('Accept requires the durable operation winner even while the job is in memory', async () => {
  const fixture = await completedFrameRepairFixture()
  fixture.setDurableJob({ ...fixture.job, id: 'job_different_winner' })
  await assert.rejects(
    fixture.coordinator.acceptFrameRepair(fixture.acceptRequest()),
    (error) => error?.code === 'identity_mismatch',
  )
})
