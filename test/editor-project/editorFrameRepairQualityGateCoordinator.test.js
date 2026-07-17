import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { encodeRgbaPng, loadRgba } from '../../src/character-pack/imageCodec.js'
import { TOPDOWN_RPG_V0 } from '../../src/character-pack/profile.js'

import {
  FRAME_REPAIR_QUALITY_GATE_CONTROL_CASE_DEFAULTS,
  buildFrameRepairPrompt,
  buildFrameRepairQualityReport,
  buildFrameRepairQualityGateControls,
  compositeFrameRepairCandidate,
  createDefaultEditorProject,
  createFrameRepairCoordinator,
  createPreparedEditorProject,
  hashFrameRepairQualityGateValue,
  importCapturedCharacterRevisionForQualityGate,
  loadEditorProject,
  extractFrameRgba,
  packageNormalizedCharacterSheet,
  readFrameRepairQualityGateEvidence,
  readFrameRepairQualityGateSetupManifest,
  resolveFrameRepairQualityGateSessionPaths,
  resolveFrameRepairQualityGateSetupPaths,
  runsToBitset,
  writeFrameRepairArtifacts,
} from '../../src/editor-project/index.js'
import { createFrameRepairQualityGateCoordinator } from '../../src/editor-project/frameRepairQualityGateCoordinator.js'

const FIXED_TIME = '2026-07-13T00:00:00.000Z'
const IMPLEMENTATION_REVISION = 'quality-gate-coordinator-fixture-v1'
const PROVIDER_PRESET_ID = 'preset_primary'
const USER_CASES = Object.freeze([
  Object.freeze({ caseId: 'case_shape_01', sourceAssetId: 'source_shape_01', clipId: 'walk_down', clipFramePosition: 0, sheetFrameIndex: 16, instruction: 'Repair the distorted body shape only.', maskEdits: [{ op: 'add_rectangle', x: 20, y: 18, width: 48, height: 62 }], difficulty: 'medium', defectCategory: 'shape', expectedImprovement: 'The body shape is coherent while pixels outside the mask remain unchanged.' }),
  Object.freeze({ caseId: 'case_detail_01', sourceAssetId: 'source_detail_01', clipId: 'walk_left', clipFramePosition: 1, sheetFrameIndex: 25, instruction: 'Repair the missing sprite detail only.', maskEdits: [{ op: 'add_rectangle', x: 42, y: 30, width: 16, height: 18 }], difficulty: 'medium', defectCategory: 'detail', expectedImprovement: 'The missing detail is restored without altering unrelated pixels.' }),
  Object.freeze({ caseId: 'case_anchor_01', sourceAssetId: 'source_anchor_01', clipId: 'walk_up', clipFramePosition: 2, sheetFrameIndex: 22, instruction: 'Repair the foot anchor and baseline only.', maskEdits: [{ op: 'add_rectangle', x: 28, y: 70, width: 40, height: 18 }], difficulty: 'medium', defectCategory: 'anchor_baseline', expectedImprovement: 'The feet share the intended baseline and anchor.' }),
  Object.freeze({ caseId: 'case_facing_01', sourceAssetId: 'source_facing_01', clipId: 'walk_right', clipFramePosition: 3, sheetFrameIndex: 31, instruction: 'Repair facing-direction inconsistency only.', maskEdits: [{ op: 'add_rectangle', x: 18, y: 14, width: 58, height: 68 }], difficulty: 'medium', defectCategory: 'facing_consistency', expectedImprovement: 'The frame faces right consistently with its neighboring frames.' }),
  Object.freeze({ caseId: 'case_semantic_01', sourceAssetId: 'source_semantic_01', clipId: 'idle_down', clipFramePosition: 0, sheetFrameIndex: 0, instruction: 'Reconstruct the masked semantic feature only.', maskEdits: [{ op: 'add_rectangle', x: 30, y: 20, width: 36, height: 44 }], difficulty: 'hard', defectCategory: 'semantic_reconstruction', expectedImprovement: 'The intended feature is recognizable and preserves character identity.' }),
  Object.freeze({ caseId: 'case_continuity_01', sourceAssetId: 'source_continuity_01', clipId: 'walk_down', clipFramePosition: 2, sheetFrameIndex: 18, instruction: 'Repair continuity with neighboring animation frames only.', maskEdits: [{ op: 'add_rectangle', x: 22, y: 16, width: 52, height: 66 }], difficulty: 'hard', defectCategory: 'neighbor_continuity', expectedImprovement: 'The repaired frame transitions coherently to both neighboring frames.' }),
])

function sha(value) {
  return createHash('sha256').update(value).digest('hex')
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
    if (active[pixel]) data.set([255, 56, 176, 255], offset)
    else {
      data[offset] = frame.data[offset]
      data[offset + 1] = frame.data[offset + 1]
      data[offset + 2] = frame.data[offset + 2]
      data[offset + 3] = Math.min(frame.data[offset + 3], 64)
    }
  }
  return { width: mask.width, height: mask.height, data }
}

function expectCode(code) {
  return (error) => {
    assert.equal(error?.code, code)
    return true
  }
}

async function exists(filePath) {
  try {
    await stat(filePath)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

async function createSourceFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'frame-repair-quality-gate-coordinator-'))
  const workspaceRoot = path.join(root, 'workspace')
  const generatedDir = path.join(root, 'generated')
  await mkdir(generatedDir, { recursive: true })
  const controls = await buildFrameRepairQualityGateControls()
  const seed = controls[0]
  const sourceProject = createDefaultEditorProject({
    id: 'project_source',
    name: 'User Owned Source',
    createdAt: FIXED_TIME,
    updatedAt: FIXED_TIME,
  })
  const prepared = await createPreparedEditorProject({
    project: sourceProject,
    projectRoot: root,
    workspaceRoot,
    now: new Date(FIXED_TIME),
    prepareProject: async ({ project }) => {
      let next = project
      for (const item of USER_CASES) {
        const imported = await importCapturedCharacterRevisionForQualityGate({
          project: next,
          targetAssetId: item.sourceAssetId,
          captured: seed,
          projectRoot: root,
          workspaceRoot,
          now: new Date(FIXED_TIME),
        })
        next = imported.project
      }
      return next
    },
  })
  return {
    root,
    workspaceRoot,
    generatedDir,
    sourceProject: prepared.project,
    sourceProjectPath: prepared.paths.projectJson,
  }
}

function setupBody(fixture, targetProjectId = 'project_quality_gate') {
  return {
    expectedRevision: fixture.sourceProject.revision,
    targetProjectId,
    targetProjectName: 'Frame Repair Quality Gate',
    ownershipConfirmed: true,
    sourceAssets: USER_CASES.map((item) => ({
      caseId: item.caseId,
      assetId: item.sourceAssetId,
      expectedAssetRevisionId: 'rev_001',
    })),
  }
}

function qualityGateCases(mapping) {
  const userTargets = new Map(mapping.slice(2).map((item) => [item.caseId, item.targetAssetId]))
  return [
    ...structuredClone(FRAME_REPAIR_QUALITY_GATE_CONTROL_CASE_DEFAULTS),
    ...USER_CASES.map((item) => ({
      caseId: item.caseId,
      assetId: userTargets.get(item.caseId),
      expectedAssetRevisionId: 'rev_001',
      clipId: item.clipId,
      clipFramePosition: item.clipFramePosition,
      sheetFrameIndex: item.sheetFrameIndex,
      instruction: item.instruction,
      maskEdits: structuredClone(item.maskEdits),
      difficulty: item.difficulty,
      defectCategory: item.defectCategory,
      expectedImprovement: item.expectedImprovement,
    })),
  ]
}

function planBody(setup, sessionId = 'frqg_20260713_primary') {
  return {
    sessionId,
    expectedRevision: setup.project.revision,
    setupManifestSha256: setup.setupManifestSha256,
    providerPresetId: PROVIDER_PRESET_ID,
    imageConfig: { image_size: '1K' },
    maxProviderCalls: 8,
    cases: qualityGateCases(setup.mapping),
  }
}

function fakeFrameRepairAuthority() {
  const planCalls = []
  const operationCalls = []
  const sheetByAssetId = new Map()
  const operations = new Map()
  const planResultsByAssetId = new Map()
  let unavailableIndex = -1
  return {
    planCalls,
    operationCalls,
    sheetByAssetId,
    operations,
    planResultsByAssetId,
    setUnavailableIndex(value) { unavailableIndex = value },
    coordinator: {
      async planFrameRepair({ projectId, assetId, body }) {
        const index = planCalls.length
        planCalls.push(structuredClone({ projectId, assetId, body }))
        const plan = {
          version: 'frame_repair_plan_v1',
          project: { id: projectId, revision: body.expectedRevision },
          asset: { id: assetId, parent_revision_id: body.expectedAssetRevisionId },
          clip: {
            id: body.clipId,
            position: body.clipFramePosition,
            sheet_frame_index: body.sheetFrameIndex,
          },
          mask: { sha256: hashFrameRepairQualityGateValue(body.maskEdits) },
          instruction: body.instruction,
          parent_sheet_sha256: sheetByAssetId.get(assetId),
          target_frame_sha256: sha(`target:${assetId}:${body.sheetFrameIndex}`),
          references: { context_sha256: sha(`context:${assetId}:${body.clipId}`) },
          provider: {
            id: body.providerPresetId,
            provider: 'fixture_provider',
            label: 'Fixture provider',
            model: 'fixture-model-v1',
            image_config: { image_size: body.imageConfig.image_size, aspect_ratio: '1:1' },
            apiKey: 'provider_secret_DO_NOT_LEAK',
          },
          estimated_provider_calls: 1,
          max_provider_calls: 1,
          implementation_revision: IMPLEMENTATION_REVISION,
        }
        const result = {
          plan,
          plan_hash: hashFrameRepairQualityGateValue(plan),
          can_run: index !== unavailableIndex,
          diagnostics: index === unavailableIndex ? ['provider_unavailable'] : [],
          runtime: { token: 'runtime_secret_DO_NOT_LEAK' },
        }
        planResultsByAssetId.set(assetId, structuredClone(result))
        return result
      },
      async getFrameRepairOperation({ projectId, assetId, operationId }) {
        operationCalls.push({ projectId, assetId, operationId })
        const result = operations.get(operationId)
        if (!result) throw Object.assign(new Error('not found'), { code: 'operation_not_found' })
        return structuredClone(result)
      },
    },
  }
}

function createCoordinator(fixture, authority, service = null) {
  return createFrameRepairQualityGateCoordinator({
    projectRoot: fixture.root,
    workspaceRoot: fixture.workspaceRoot,
    generatedDir: fixture.generatedDir,
    implementationRevision: IMPLEMENTATION_REVISION,
    frameRepairCoordinator: authority.coordinator,
    frameRepairService: service ?? {
      enqueue() { throw new Error('quality gate must not enqueue') },
      getOperation() { throw new Error('direct service lookup is not expected in Task 6') },
    },
  })
}

async function setupAndLoadManifest(fixture, authority) {
  const coordinator = createCoordinator(fixture, authority)
  const setup = await coordinator.setupQualityGate({
    sourceProjectId: fixture.sourceProject.id,
    body: setupBody(fixture),
  })
  const manifest = await readFrameRepairQualityGateSetupManifest({
    generatedDir: fixture.generatedDir,
    targetProjectId: setup.project.id,
  })
  for (const item of manifest.cases) {
    authority.sheetByAssetId.set(
      item.target.asset_id,
      item.target.artifacts.find((artifact) => artifact.key === 'sheet').sha256,
    )
  }
  return { coordinator, setup, manifest }
}

async function createRealQualityGateRuntime() {
  const fixture = await createSourceFixture()
  const operations = new Map()
  const service = {
    enqueue() { throw new Error('quality gate test must not enqueue') },
    getJob(jobId) {
      return [...operations.values()].find((item) => item.id === jobId) ?? null
    },
    async getOperation(lookup) {
      const value = operations.get(lookup.operation_id)
      if (!value) throw Object.assign(new Error('not found'), { code: 'operation_not_found' })
      return value
    },
  }
  const frameCoordinator = createFrameRepairCoordinator({
    projectRoot: fixture.root,
    workspaceRoot: fixture.workspaceRoot,
    generatedDir: fixture.generatedDir,
    implementationRevision: IMPLEMENTATION_REVISION,
    getProviderEnv: () => ({
      CHARACTER_PROVIDER_PRESETS: JSON.stringify([{
        id: PROVIDER_PRESET_ID,
        label: 'Quality Gate Fixture',
        provider: 'openrouter',
        apiKey: 'private-provider-key',
        model: 'fixture/image-model',
        aspect_ratio: '1:1',
        image_size: '1K',
      }]),
    }),
    frameRepairService: service,
  })
  const coordinator = createFrameRepairQualityGateCoordinator({
    projectRoot: fixture.root,
    workspaceRoot: fixture.workspaceRoot,
    generatedDir: fixture.generatedDir,
    implementationRevision: IMPLEMENTATION_REVISION,
    frameRepairCoordinator: frameCoordinator,
    frameRepairService: service,
  })
  const setup = await coordinator.setupQualityGate({
    sourceProjectId: fixture.sourceProject.id,
    body: setupBody(fixture),
  })
  const body = planBody(setup, 'frqg_20260713_real_review')
  const plan = await coordinator.planQualityGate({ projectId: setup.project.id, body })
  await coordinator.startQualityGate({
    projectId: setup.project.id,
    body: { ...body, expectedPlanHash: plan.session_plan_hash, confirmSessionStart: true },
  })
  return { fixture, operations, service, frameCoordinator, coordinator, setup, body, plan }
}

async function sealReviewableJob(runtime, caseIndex = 0) {
  const item = runtime.plan.cases[caseIndex]
  const loaded = await loadEditorProject({
    projectId: runtime.setup.project.id,
    projectRoot: runtime.fixture.root,
    workspaceRoot: runtime.fixture.workspaceRoot,
  })
  const project = loaded.project
  const asset = project.assets[item.asset_id]
  const revision = asset.revisions[item.parent_revision_id]
  const requested = runtime.body.cases[caseIndex]
  const planned = await runtime.frameCoordinator.planFrameRepair({
    projectId: project.id,
    assetId: item.asset_id,
    body: {
      expectedRevision: project.revision,
      expectedAssetRevisionId: item.parent_revision_id,
      clipId: requested.clipId,
      clipFramePosition: requested.clipFramePosition,
      sheetFrameIndex: requested.sheetFrameIndex,
      instruction: requested.instruction,
      maskEdits: requested.maskEdits,
      providerPresetId: runtime.body.providerPresetId,
      imageConfig: runtime.body.imageConfig,
    },
  })
  const framePlan = planned.plan
  const [parentSheet, animations, metadata] = await Promise.all([
    loadRgba(await readFile(path.resolve(runtime.fixture.root, revision.artifacts.sheet))),
    readFile(path.resolve(runtime.fixture.root, revision.artifacts.animations), 'utf8').then(JSON.parse),
    readFile(path.resolve(runtime.fixture.root, revision.artifacts.metadata), 'utf8').then(JSON.parse),
  ])
  const before = extractFrameRgba(parentSheet, framePlan.clip.sheet_frame_index, framePlan.profile.frame_size)
  const candidate = cloneRgba(before)
  const active = runsToBitset(framePlan.mask.runs, framePlan.mask.width * framePlan.mask.height)
  const changedPixel = active.findIndex(Boolean)
  assert.notEqual(changedPixel, -1)
  const offset = changedPixel * 4
  candidate.data[offset] = (candidate.data[offset] + 73) % 256
  candidate.data[offset + 1] = 210
  candidate.data[offset + 3] = 255
  const composite = compositeFrameRepairCandidate({
    parentSheet,
    candidateFrame: candidate,
    sheetFrameIndex: framePlan.clip.sheet_frame_index,
    frameSize: framePlan.profile.frame_size,
    mask: framePlan.mask,
  })
  const patchedSheetBuffer = await encodeRgbaPng(composite.sheet)
  const characterResult = await packageNormalizedCharacterSheet({
    normalizedSheetPng: patchedSheetBuffer,
    profile: TOPDOWN_RPG_V0,
    parentAnimations: animations,
    parentMetadata: metadata,
    createdAt: FIXED_TIME,
    lineage: {
      project_id: project.id,
      asset_id: asset.id,
      parent_revision_id: revision.id,
      parent_job_id: revision.source_job_id,
      parent_processing_recipe_ref: revision.processing_recipe_ref,
    },
    generation: {
      mode: 'editor_targeted_frame_repair',
      provider: framePlan.provider.provider,
      provider_preset_id: framePlan.provider.id,
      provider_label: framePlan.provider.label,
      model: framePlan.provider.model,
      image_config: { ...framePlan.provider.image_config },
    },
  })
  const validation = {
    status: 'pass',
    warnings: [],
    blocking_errors: [],
    deltas: {
      warnings_added: [],
      warnings_removed: [...(metadata.quality?.warnings ?? [])],
      blocking_errors_added: [],
      blocking_errors_removed: [...(metadata.quality?.blocking_errors ?? [])],
    },
  }
  characterResult.metadataJson.quality = { status: 'pass', warnings: [], blocking_errors: [] }
  characterResult.debugReport.validation = { status: 'pass', warnings: [], blocking_errors: [] }
  const adjacentClipFrames = framePlan.clip.context_frames.map((context) => ({
    role: context.position < framePlan.clip.position ? 'previous' : 'next',
    frame: extractFrameRgba(parentSheet, context.sheet_frame_index, framePlan.profile.frame_size),
  }))
  const quality = buildFrameRepairQualityReport({
    complete: true,
    parentFrame: before,
    compositedFrame: composite.after,
    normalizedProviderFrame: candidate,
    adjacentClipFrames,
    mask: framePlan.mask,
    integrity: composite.integrity,
    continuity: { status: 'measured', warnings: [] },
    validation,
  })
  const jobId = `job_qg_review_case_${caseIndex}`
  const contextBase = {
    version: 'editor_frame_repair_context_v1',
    job_type: 'editor_character_frame_repair',
    job_id: jobId,
    operation_id: item.operation_id,
    submitted_at: FIXED_TIME,
    project_id: project.id,
    project_revision: project.revision,
    asset_id: asset.id,
    parent_revision_id: revision.id,
    parent_sheet_ref: revision.artifacts.sheet,
    parent_sheet_sha256: framePlan.parent_sheet_sha256,
    parent_processing_recipe_ref: revision.processing_recipe_ref,
    profile: framePlan.profile.id,
    frame_size: { ...framePlan.profile.frame_size },
    sheet_size: { ...animations.sheet_size },
    clip_id: framePlan.clip.id,
    clip_frame_position: framePlan.clip.position,
    sheet_frame_index: framePlan.clip.sheet_frame_index,
    target_frame_sha256: framePlan.target_frame_sha256,
    context_frames: framePlan.clip.context_frames.map((context) => ({ ...context })),
    reference_context_sha256: framePlan.references.context_sha256,
    mask_sha256: framePlan.mask.sha256,
    plan_hash: planned.plan_hash,
    provider_preset: structuredClone(framePlan.provider),
    provider_call_budget: 1,
    provider_calls_used: 1,
    implementation_revision: framePlan.implementation_revision,
    input_reference_roles: [...framePlan.references.input_reference_roles],
  }
  const beforePng = await encodeRgbaPng(before)
  const candidatePng = await encodeRgbaPng(candidate)
  const afterPng = await encodeRgbaPng(composite.after)
  await mkdir(path.join(runtime.fixture.generatedDir, jobId), { recursive: true })
  const sealed = await writeFrameRepairArtifacts({
    generatedDir: runtime.fixture.generatedDir,
    job: { id: jobId, created_at: FIXED_TIME },
    characterResult,
    evidence: {
      frame_repair_plan: framePlan,
      frame_repair_context_base: contextBase,
      target_before: beforePng,
      frame_repair_mask: await encodeRgbaPng(maskVisualization(before, framePlan.mask)),
      frame_repair_context_image: beforePng,
      raw_provider_output: candidatePng,
      normalized_candidate_frame: candidatePng,
      composited_candidate_frame: afterPng,
      frame_repair_difference: await encodeRgbaPng(differenceRgba(before, composite.after)),
      frame_repair_quality: quality,
      frame_repair_prompt: Buffer.from(buildFrameRepairPrompt(framePlan), 'utf8'),
      patched_normalized_sheet: patchedSheetBuffer,
    },
  })
  const job = {
    id: jobId,
    created_at: FIXED_TIME,
    status: 'done',
    type: 'editor_character_frame_repair',
    project_id: project.id,
    project_revision: project.revision,
    asset_id: asset.id,
    parent_revision_id: revision.id,
    operation_id: item.operation_id,
    plan_hash: planned.plan_hash,
    implementation_revision: IMPLEMENTATION_REVISION,
    provider_call_budget: 1,
    provider_calls_used: 1,
    generated_candidate_count: 1,
    quality_status: quality.status,
    reason: null,
    retry_hint: null,
    recovery_state: null,
    ...sealed,
  }
  runtime.operations.set(item.operation_id, job)
  return { item, job, quality }
}

test('Setup creates one isolated eight-pack project and immutable bounded setup evidence', async () => {
  const fixture = await createSourceFixture()
  const authority = fakeFrameRepairAuthority()
  const coordinator = createCoordinator(fixture, authority)
  const sourceBytesBefore = await readFile(fixture.sourceProjectPath)
  const result = await coordinator.setupQualityGate({
    sourceProjectId: fixture.sourceProject.id,
    body: setupBody(fixture),
  })

  assert.equal(result.project.id, 'project_quality_gate')
  assert.equal(result.project.revision, 1)
  assert.equal(Object.keys(result.project.assets).length, 8)
  assert.equal(Object.hasOwn(result.project, 'quality_gate'), false)
  assert.deepEqual(result.mapping.slice(0, 2), [
    {
      caseId: 'control_outline_alpha', sourceAssetId: null, sourceRevisionId: null,
      targetAssetId: 'asset_qg_control_outline_alpha', targetRevisionId: 'rev_001',
      ownershipClass: 'repository_control',
    },
    {
      caseId: 'control_small_component', sourceAssetId: null, sourceRevisionId: null,
      targetAssetId: 'asset_qg_control_small_component', targetRevisionId: 'rev_001',
      ownershipClass: 'repository_control',
    },
  ])
  assert.deepEqual(result.mapping.slice(2).map((item) => item.targetAssetId),
    USER_CASES.map((item) => `asset_qg_${item.caseId}`))
  assert.match(result.setupManifestSha256, /^[a-f0-9]{64}$/)
  assert.deepEqual(await readFile(fixture.sourceProjectPath), sourceBytesBefore)
  assert.deepEqual((await loadEditorProject({
    projectId: fixture.sourceProject.id,
    projectRoot: fixture.root,
    workspaceRoot: fixture.workspaceRoot,
  })).project, fixture.sourceProject)

  const manifest = await readFrameRepairQualityGateSetupManifest({
    generatedDir: fixture.generatedDir,
    targetProjectId: result.project.id,
  })
  assert.equal(hashFrameRepairQualityGateValue(manifest), result.setupManifestSha256)
  assert.equal(manifest.cases.length, 8)
  assert.deepEqual(manifest.cases.map((item) => item.target.asset_id),
    result.mapping.map((item) => item.targetAssetId))
  for (const item of manifest.cases) {
    assert.deepEqual(item.source.artifacts.map((artifact) => artifact.key),
      ['sheet', 'animations', 'metadata', 'editor_metadata', 'debug_report'])
    assert.deepEqual(item.target.artifacts, item.source.artifacts)
  }
  const publicBytes = JSON.stringify(result)
  for (const forbidden of [
    fixture.root, 'provider_secret_DO_NOT_LEAK', 'runtime_secret_DO_NOT_LEAK',
    'instruction', 'maskEdits', 'Buffer',
  ]) assert.equal(publicBytes.includes(forbidden), false)
  assert.doesNotMatch(JSON.stringify(manifest), /processing_recipe/)

  await assert.rejects(coordinator.setupQualityGate({
    sourceProjectId: fixture.sourceProject.id,
    body: { ...setupBody(fixture, 'project_stale_gate'), expectedRevision: 999 },
  }), expectCode('revision_conflict'))
  const staleTarget = await loadEditorProject({
    projectId: 'project_stale_gate',
    projectRoot: fixture.root,
    workspaceRoot: fixture.workspaceRoot,
  }).catch((error) => error)
  assert.equal(staleTarget.code, 'project_not_found')

  const driftBody = setupBody(fixture, 'project_asset_drift_gate')
  driftBody.sourceAssets[5].expectedAssetRevisionId = 'rev_999'
  await assert.rejects(coordinator.setupQualityGate({
    sourceProjectId: fixture.sourceProject.id,
    body: driftBody,
  }), expectCode('asset_revision_conflict'))
  assert.equal(await exists(path.join(
    fixture.workspaceRoot, 'projects', 'project_asset_drift_gate', 'project.json',
  )), false)

  const reservedTargetId = 'project_reserved_gate'
  const reservedPath = resolveFrameRepairQualityGateSetupPaths({
    generatedDir: fixture.generatedDir,
    targetProjectId: reservedTargetId,
  })
  await mkdir(path.dirname(reservedPath.setupManifest), { recursive: true })
  await writeFile(reservedPath.setupManifest, '{"reserved":true}')
  await assert.rejects(coordinator.setupQualityGate({
    sourceProjectId: fixture.sourceProject.id,
    body: setupBody(fixture, reservedTargetId),
  }), expectCode('evidence_conflict'))
  assert.equal(await exists(path.join(
    fixture.workspaceRoot, 'projects', reservedTargetId, 'project.json',
  )), false)
})

test('Plan, Start, and Get stay provider-free, write only sealed evidence, and expose fixed safe URLs', async () => {
  const fixture = await createSourceFixture()
  const authority = fakeFrameRepairAuthority()
  const { coordinator, setup } = await setupAndLoadManifest(fixture, authority)
  const body = planBody(setup)
  const sessionPaths = resolveFrameRepairQualityGateSessionPaths({
    generatedDir: fixture.generatedDir,
    sessionId: body.sessionId,
    caseIds: body.cases.map((item) => item.caseId),
  })
  assert.equal(await exists(sessionPaths.sessionDir), false)
  const plan = await coordinator.planQualityGate({ projectId: setup.project.id, body })
  assert.equal(authority.planCalls.length, 8)
  assert.equal(await exists(sessionPaths.sessionDir), false)
  assert.equal(plan.session_id, body.sessionId)
  assert.deepEqual(authority.planCalls.map((item) => item.body), body.cases.map((item) => ({
    expectedRevision: body.expectedRevision,
    expectedAssetRevisionId: item.expectedAssetRevisionId,
    clipId: item.clipId,
    clipFramePosition: item.clipFramePosition,
    sheetFrameIndex: item.sheetFrameIndex,
    instruction: item.instruction,
    maskEdits: item.maskEdits,
    providerPresetId: body.providerPresetId,
    imageConfig: body.imageConfig,
  })))
  assert.doesNotMatch(JSON.stringify(plan), /provider_secret|runtime_secret|apiKey|runtime/)
  await assert.rejects(coordinator.planQualityGate({
    projectId: setup.project.id,
    body: { ...body, sessionId: 'frqg_20260713_bad_setup_hash', setupManifestSha256: '0'.repeat(64) },
  }), expectCode('stale_quality_gate_plan'))
  assert.equal(authority.planCalls.length, 8)

  const unavailableAuthority = fakeFrameRepairAuthority()
  for (const [assetId, digest] of authority.sheetByAssetId) {
    unavailableAuthority.sheetByAssetId.set(assetId, digest)
  }
  unavailableAuthority.setUnavailableIndex(3)
  const unavailableCoordinator = createCoordinator(fixture, unavailableAuthority)
  await assert.rejects(unavailableCoordinator.planQualityGate({
    projectId: setup.project.id,
    body: { ...body, sessionId: 'frqg_20260713_unavailable' },
  }), expectCode('provider_unavailable'))

  const started = await coordinator.startQualityGate({
    projectId: setup.project.id,
    body: { ...body, expectedPlanHash: plan.session_plan_hash, confirmSessionStart: true },
  })
  assert.equal(started.plan.session_plan_hash, plan.session_plan_hash)
  assert.equal(await exists(sessionPaths.sessionPlan), true)
  assert.equal(await exists(sessionPaths.blindOrder), true)
  const retry = await coordinator.startQualityGate({
    projectId: setup.project.id,
    body: { ...body, expectedPlanHash: plan.session_plan_hash, confirmSessionStart: true },
  })
  assert.deepEqual(retry, started)
  const evidence = await readFrameRepairQualityGateEvidence({
    generatedDir: fixture.generatedDir,
    sessionId: body.sessionId,
  })
  assert.equal(evidence.plan.session_plan_hash, plan.session_plan_hash)

  const processingCase = plan.cases[0]
  authority.operations.set(processingCase.operation_id, {
    id: 'job_quality_gate_case_0',
    status: 'processing',
    project_id: setup.project.id,
    asset_id: processingCase.asset_id,
    operation_id: processingCase.operation_id,
    provider_calls_used: 1,
    generated_candidate_count: 0,
    reason: null,
  })
  const view = await coordinator.getQualityGate({
    projectId: setup.project.id,
    sessionId: body.sessionId,
  })
  assert.equal(authority.operationCalls.length, 8)
  assert.equal(view.session.id, body.sessionId)
  assert.equal(view.session.planHash, plan.session_plan_hash)
  assert.equal(view.cases[0].status, 'processing')
  assert.deepEqual(new Set(Object.values(view.cases[0].blind)), new Set(['before', 'after']))
  assert.equal(view.cases[0].repair.clipId, plan.cases[0].repair.clip_id)
  assert.equal(view.cases[0].classification.difficulty,
    plan.cases[0].classification.difficulty)
  assert.equal(view.cases.slice(1).every((item) => item.status === 'pending'), true)
  assert.deepEqual(view.allowedArtifactUrls, [
    `/generated/frame-repair-quality-gates/${body.sessionId}/blind_order.json`,
    `/generated/frame-repair-quality-gates/${body.sessionId}/session_plan.json`,
  ])
  assert.deepEqual(view.artifacts, {
    sessionPlan: `/generated/frame-repair-quality-gates/${body.sessionId}/session_plan.json`,
    blindOrder: `/generated/frame-repair-quality-gates/${body.sessionId}/blind_order.json`,
    reportJson: null,
    reportMarkdown: null,
    contactSheet: null,
    artifactManifest: null,
  })
  assert.doesNotMatch(JSON.stringify(view), new RegExp(fixture.root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))

  await assert.rejects(coordinator.planQualityGate({
    projectId: setup.project.id,
    body: { ...body, providerPresetId: 'preset_changed' },
  }), expectCode('session_id_conflict'))
})

test('durable provider outcomes are sequenced, unknown transport pauses without a record, and Finalize is provider-free', async () => {
  const fixture = await createSourceFixture()
  const authority = fakeFrameRepairAuthority()
  const durable = new Map()
  const service = {
    enqueue() { throw new Error('quality gate must not enqueue') },
    async getOperation(lookup) {
      const value = durable.get(lookup.operation_id)
      if (!value) throw Object.assign(new Error('not found'), { code: 'operation_not_found' })
      return structuredClone(value)
    },
  }
  const setupCoordinator = createCoordinator(fixture, authority, service)
  const setup = await setupCoordinator.setupQualityGate({
    sourceProjectId: fixture.sourceProject.id,
    body: setupBody(fixture),
  })
  const manifest = await readFrameRepairQualityGateSetupManifest({
    generatedDir: fixture.generatedDir,
    targetProjectId: setup.project.id,
  })
  for (const item of manifest.cases) {
    authority.sheetByAssetId.set(item.target.asset_id,
      item.target.artifacts.find((artifact) => artifact.key === 'sheet').sha256)
  }
  const body = planBody(setup, 'frqg_20260713_outcomes')
  const plan = await setupCoordinator.planQualityGate({ projectId: setup.project.id, body })
  await setupCoordinator.startQualityGate({
    projectId: setup.project.id,
    body: { ...body, expectedPlanHash: plan.session_plan_hash, confirmSessionStart: true },
  })
  const first = plan.cases[0]
  const firstJob = {
    id: 'job_provider_blocked_0',
    status: 'failed_generation',
    project_id: setup.project.id,
    project_revision: 1,
    asset_id: first.asset_id,
    parent_revision_id: first.parent_revision_id,
    operation_id: first.operation_id,
    plan_hash: authority.planResultsByAssetId.get(first.asset_id).plan_hash,
    implementation_revision: IMPLEMENTATION_REVISION,
    provider_call_budget: 1,
    provider_calls_used: 1,
    generated_candidate_count: 0,
    quality_status: 'unknown',
    reason: 'provider_rate_limited',
    recovery_state: null,
  }
  durable.set(first.operation_id, firstJob)
  authority.operations.set(first.operation_id, firstJob)
  const recorded = await setupCoordinator.recordQualityGateOutcome({
    projectId: setup.project.id,
    sessionId: plan.session_id,
    caseId: first.case_id,
    body: {
      expectedPlanHash: plan.session_plan_hash,
      expectedCaseHash: first.case_hash,
      operationId: first.operation_id,
      jobId: 'job_provider_blocked_0',
      expectedReviewSha256: null,
      outcome: 'provider_blocked',
      expectedProjectRevision: 1,
      acceptedRevisionId: null,
    },
  })
  assert.equal(recorded.outcome.outcome, 'provider_blocked')
  assert.equal(recorded.outcome.controlled_reason, 'provider_rate_limited')
  assert.equal(recorded.outcome.provider_calls, 1)

  const third = plan.cases[2]
  await assert.rejects(setupCoordinator.recordQualityGateOutcome({
    projectId: setup.project.id,
    sessionId: plan.session_id,
    caseId: third.case_id,
    body: {
      expectedPlanHash: plan.session_plan_hash,
      expectedCaseHash: third.case_hash,
      operationId: third.operation_id,
      jobId: 'job_skipped_case',
      expectedReviewSha256: null,
      outcome: 'provider_blocked',
      expectedProjectRevision: 1,
      acceptedRevisionId: null,
    },
  }), expectCode('quality_gate_paused'))

  const second = plan.cases[1]
  const secondJob = {
    id: 'job_provider_blocked_1',
    status: 'failed_generation',
    project_id: setup.project.id,
    project_revision: 1,
    asset_id: second.asset_id,
    parent_revision_id: second.parent_revision_id,
    operation_id: second.operation_id,
    plan_hash: authority.planResultsByAssetId.get(second.asset_id).plan_hash,
    implementation_revision: IMPLEMENTATION_REVISION,
    provider_call_budget: 1,
    provider_calls_used: 1,
    generated_candidate_count: 0,
    quality_status: 'unknown',
    reason: 'provider_service_unavailable',
    recovery_state: null,
  }
  durable.set(second.operation_id, secondJob)
  authority.operations.set(second.operation_id, secondJob)
  await setupCoordinator.recordQualityGateOutcome({
    projectId: setup.project.id,
    sessionId: plan.session_id,
    caseId: second.case_id,
    body: {
      expectedPlanHash: plan.session_plan_hash,
      expectedCaseHash: second.case_hash,
      operationId: second.operation_id,
      jobId: secondJob.id,
      expectedReviewSha256: null,
      outcome: 'provider_blocked',
      expectedProjectRevision: 1,
      acceptedRevisionId: null,
    },
  })
  const conservation = await setupCoordinator.getQualityGate({
    projectId: setup.project.id,
    sessionId: plan.session_id,
  })
  assert.equal(conservation.session.status, 'paused')
  assert.equal(conservation.session.blockingReason, 'provider_conservation_pause')

  const thirdJob = {
    id: 'job_transport_unknown_2',
    status: 'outcome_unknown',
    project_id: setup.project.id,
    project_revision: 1,
    asset_id: third.asset_id,
    parent_revision_id: third.parent_revision_id,
    operation_id: third.operation_id,
    plan_hash: authority.planResultsByAssetId.get(third.asset_id).plan_hash,
    implementation_revision: IMPLEMENTATION_REVISION,
    provider_call_budget: 1,
    provider_calls_used: 1,
    generated_candidate_count: 0,
    quality_status: 'unknown',
    reason: 'transport_outcome_unknown',
    recovery_state: 'outcome_unknown',
  }
  durable.set(third.operation_id, thirdJob)
  authority.operations.set(third.operation_id, thirdJob)
  const paused = await setupCoordinator.recordQualityGateOutcome({
    projectId: setup.project.id,
    sessionId: plan.session_id,
    caseId: third.case_id,
    body: {
      expectedPlanHash: plan.session_plan_hash,
      expectedCaseHash: third.case_hash,
      operationId: third.operation_id,
      jobId: null,
      expectedReviewSha256: null,
      outcome: 'outcome_unknown',
      expectedProjectRevision: 1,
      acceptedRevisionId: null,
    },
  })
  assert.equal(paused.session.status, 'paused')
  assert.equal(paused.session.blockingReason, 'transport_outcome_unknown')
  const evidence = await readFrameRepairQualityGateEvidence({
    generatedDir: fixture.generatedDir,
    sessionId: plan.session_id,
  })
  assert.equal(evidence.outcomes.length, 2)

  const finalized = await setupCoordinator.finalizeQualityGate({
    projectId: setup.project.id,
    sessionId: plan.session_id,
    body: {
      expectedPlanHash: plan.session_plan_hash,
      expectedRevision: 1,
      confirmFinalize: true,
    },
  })
  assert.equal(finalized.report.decision.result, 'evidence_insufficient')
  assert.equal(finalized.view.session.status, 'finalized')
})

test('a real sealed candidate produces one server-derived blind review, terminal rejection, and contact-sheet finalization', async () => {
  const runtime = await createRealQualityGateRuntime()
  const sealed = await sealReviewableJob(runtime)
  const reviewBody = {
    expectedPlanHash: runtime.plan.session_plan_hash,
    expectedCaseHash: sealed.item.case_hash,
    operationId: sealed.item.operation_id,
    jobId: sealed.job.id,
    blindChoice: 'prefer_b',
    improvement: 'improved',
    usability: 'usable',
    newBlockingDefect: false,
    reasonCodes: ['outline_repaired'],
    note: 'Private local reviewer note; never render this.',
  }
  const reviewed = await runtime.coordinator.recordQualityGateReview({
    projectId: runtime.setup.project.id,
    sessionId: runtime.plan.session_id,
    caseId: sealed.item.case_id,
    body: reviewBody,
  })
  assert.equal(reviewed.review.hard_gates.status === 'pass' ||
    reviewed.review.hard_gates.status === 'warning', true)
  assert.equal(reviewed.review.hard_gates.facts.outside_mask_equal, true)
  assert.equal(reviewed.review.hard_gates.facts.provider_calls, 1)
  assert.equal(reviewed.review.successful_candidate, true)
  assert.equal(reviewed.review.blind.preferred_version, reviewed.review.blind.b)
  const retry = await runtime.coordinator.recordQualityGateReview({
    projectId: runtime.setup.project.id,
    sessionId: runtime.plan.session_id,
    caseId: sealed.item.case_id,
    body: structuredClone(reviewBody),
  })
  assert.equal(retry.sha256, reviewed.sha256)
  await assert.rejects(runtime.coordinator.recordQualityGateReview({
    projectId: runtime.setup.project.id,
    sessionId: runtime.plan.session_id,
    caseId: sealed.item.case_id,
    body: { ...reviewBody, improvement: 'same' },
  }), expectCode('evidence_conflict'))

  const rejected = await runtime.coordinator.recordQualityGateOutcome({
    projectId: runtime.setup.project.id,
    sessionId: runtime.plan.session_id,
    caseId: sealed.item.case_id,
    body: {
      expectedPlanHash: runtime.plan.session_plan_hash,
      expectedCaseHash: sealed.item.case_hash,
      operationId: sealed.item.operation_id,
      jobId: sealed.job.id,
      expectedReviewSha256: reviewed.sha256,
      outcome: 'rejected',
      expectedProjectRevision: 1,
      acceptedRevisionId: null,
    },
  })
  assert.equal(rejected.outcome.outcome, 'rejected')
  assert.equal(rejected.outcome.project_before_projection_sha256,
    rejected.outcome.project_after_projection_sha256)

  const finalized = await runtime.coordinator.finalizeQualityGate({
    projectId: runtime.setup.project.id,
    sessionId: runtime.plan.session_id,
    body: {
      expectedPlanHash: runtime.plan.session_plan_hash,
      expectedRevision: 1,
      confirmFinalize: true,
    },
  })
  assert.equal(finalized.report.decision.result, 'evidence_insufficient')
  assert.equal(finalized.report.decision.completed_candidates, 1)
  assert.equal(finalized.view.session.status, 'finalized')
  assert.match(finalized.view.artifacts.contactSheet, /frame_repair_quality_gate_contact_sheet\.png$/)
  assert.doesNotMatch(JSON.stringify(finalized.report), /Private local reviewer note/)
  const finalizedRetry = await runtime.coordinator.finalizeQualityGate({
    projectId: runtime.setup.project.id,
    sessionId: runtime.plan.session_id,
    body: {
      expectedPlanHash: runtime.plan.session_plan_hash,
      expectedRevision: 1,
      confirmFinalize: true,
    },
  })
  assert.equal(finalizedRetry.artifact_manifest_sha256, finalized.artifact_manifest_sha256)
})

test('an already accepted specialized child is recovered into one exact provider-free accepted outcome', async () => {
  const runtime = await createRealQualityGateRuntime()
  const sealed = await sealReviewableJob(runtime)
  const reviewed = await runtime.coordinator.recordQualityGateReview({
    projectId: runtime.setup.project.id,
    sessionId: runtime.plan.session_id,
    caseId: sealed.item.case_id,
    body: {
      expectedPlanHash: runtime.plan.session_plan_hash,
      expectedCaseHash: sealed.item.case_hash,
      operationId: sealed.item.operation_id,
      jobId: sealed.job.id,
      blindChoice: 'prefer_a',
      improvement: 'improved',
      usability: 'review_required',
      newBlockingDefect: false,
      reasonCodes: ['outline_repaired'],
      note: null,
    },
  })
  const accepted = await runtime.frameCoordinator.acceptFrameRepair({
    projectId: runtime.setup.project.id,
    assetId: sealed.item.asset_id,
    jobId: sealed.job.id,
    body: {
      expectedRevision: 1,
      expectedAssetRevisionId: sealed.item.parent_revision_id,
      expectedPlanHash: sealed.job.plan_hash,
      warningConfirmed: true,
    },
  })
  assert.equal(accepted.project.revision, 2)
  const outcome = await runtime.coordinator.recordQualityGateOutcome({
    projectId: runtime.setup.project.id,
    sessionId: runtime.plan.session_id,
    caseId: sealed.item.case_id,
    body: {
      expectedPlanHash: runtime.plan.session_plan_hash,
      expectedCaseHash: sealed.item.case_hash,
      operationId: sealed.item.operation_id,
      jobId: sealed.job.id,
      expectedReviewSha256: reviewed.sha256,
      outcome: 'accepted',
      expectedProjectRevision: 2,
      acceptedRevisionId: accepted.revision.id,
    },
  })
  assert.equal(outcome.outcome.outcome, 'accepted')
  assert.equal(outcome.outcome.project_before_revision, 1)
  assert.equal(outcome.outcome.project_after_revision, 2)
  assert.equal(outcome.outcome.accepted_revision_id, accepted.revision.id)
  assert.notEqual(outcome.outcome.project_before_projection_sha256,
    outcome.outcome.project_after_projection_sha256)
})
