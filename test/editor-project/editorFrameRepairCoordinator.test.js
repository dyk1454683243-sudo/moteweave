import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  buildAnimationsJson,
  buildEditorMetadataJson,
} from '../../src/character-pack/packageBuilder.js'
import { encodeRgbaPng, loadRgba, resizeRgbaNearest } from '../../src/character-pack/imageCodec.js'
import { TOPDOWN_RPG_V0 } from '../../src/character-pack/profile.js'
import {
  createAssetRef,
  createAssetRevision,
  createDefaultEditorProject,
  createFrameRepairCoordinator,
  createFrameRepairOperationLedger,
  createFrameRepairService,
  extractFrameRgba,
  loadEditorProject,
  saveEditorProject,
} from '../../src/editor-project/index.js'

const CREATED_AT = '2026-07-11T00:00:00.000Z'
const OPERATION_ID = 'fr_0123456789abcdef'

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function managedRef(fileName, revisionId = 'rev_001') {
  return `workspace/projects/project_demo/assets/asset_hero/${revisionId}/${fileName}`
}

function frameSheet() {
  const { w: width, h: height } = TOPDOWN_RPG_V0.sheet
  const data = new Uint8ClampedArray(width * height * 4)
  for (let frameIndex = 0; frameIndex < 64; frameIndex += 1) {
    const frameX = (frameIndex % 8) * 96
    const frameY = Math.floor(frameIndex / 8) * 96
    for (let y = 32; y < 64; y += 1) {
      for (let x = 36; x < 60; x += 1) {
        const offset = ((frameY + y) * width + frameX + x) * 4
        data[offset] = 30 + frameIndex
        data[offset + 1] = 90 + (frameIndex % 80)
        data[offset + 2] = 150
        data[offset + 3] = 255
      }
    }
  }
  return { width, height, data }
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

async function managedFrameRepairFixture({
  clipFrames = [16, 17, 18, 19],
  metadataFileMode = 'regular',
} = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'editor-frame-repair-coordinator-'))
  const workspaceRoot = path.join(root, 'workspace')
  const revisionDir = path.join(
    workspaceRoot,
    'projects',
    'project_demo',
    'assets',
    'asset_hero',
    'rev_001',
  )
  await mkdir(revisionDir, { recursive: true })
  const sheetBuffer = await encodeRgbaPng(frameSheet())
  const animations = buildAnimationsJson(TOPDOWN_RPG_V0)
  animations.animations.walk_down.frames = [...clipFrames]
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
    profile: TOPDOWN_RPG_V0.id,
    source_layout: { id: TOPDOWN_RPG_V0.id, kind: 'uniform_grid' },
    validation: { status: 'pass' },
  }
  await writeFile(path.join(revisionDir, 'normalized_sheet.png'), sheetBuffer)
  await writeJson(path.join(revisionDir, 'animations.json'), animations)
  if (metadataFileMode === 'regular') {
    await writeJson(path.join(revisionDir, 'metadata.json'), metadata)
  } else if (metadataFileMode === 'symlink') {
    const outside = path.join(root, 'outside_metadata.json')
    await writeJson(outside, metadata)
    await symlink(outside, path.join(revisionDir, 'metadata.json'))
  }
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
    clips: {
      walk_down: {
        id: 'walk_down',
        source: 'animations.json',
        frames: [...clipFrames],
        fps: animations.animations.walk_down.fps,
        loop_mode: 'loop',
        frame_size: { ...TOPDOWN_RPG_V0.frame },
        anchor: { x: TOPDOWN_RPG_V0.anchor.x, y: TOPDOWN_RPG_V0.anchor.y },
      },
    },
  })
  const project = createDefaultEditorProject({
    id: 'project_demo',
    name: 'Demo',
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  })
  project.assets.asset_hero = asset
  const saved = await saveEditorProject({
    project,
    projectRoot: root,
    workspaceRoot,
    now: new Date(CREATED_AT),
  })
  return {
    root,
    workspaceRoot,
    revisionDir,
    sheetBuffer,
    project: saved.project,
    asset: saved.project.assets.asset_hero,
    loadProject: () => loadEditorProject({
      projectId: 'project_demo',
      projectRoot: root,
      workspaceRoot,
    }).then((value) => value.project),
  }
}

function planBody(fixture, overrides = {}) {
  return {
    expectedRevision: fixture.project.revision,
    expectedAssetRevisionId: 'rev_001',
    clipId: 'walk_down',
    clipFramePosition: 1,
    sheetFrameIndex: 17,
    instruction: '  Repair the left outline  ',
    maskEdits: [{ op: 'add_rectangle', x: 34, y: 30, width: 28, height: 36 }],
    providerPresetId: 'test-preset',
    imageConfig: { image_size: '1K' },
    ...overrides,
  }
}

function liveBody(fixture, expectedPlanHash, overrides = {}) {
  return {
    ...planBody(fixture),
    operationId: OPERATION_ID,
    expectedPlanHash,
    confirmLiveGeneration: true,
    maxProviderCalls: 1,
    ...overrides,
  }
}

function coordinatorHarness(fixture, {
  provider = 'openrouter',
  apiKey = 'private-provider-key',
  providerConfig = null,
} = {}) {
  const serviceCalls = []
  const operationCalls = []
  let providerEnvReads = 0
  const providerEnv = {
    CHARACTER_PROVIDER_PRESETS: providerConfig ?? JSON.stringify([{
      id: 'test-preset',
      label: 'Test preset',
      provider,
      apiKey,
      model: 'test/image-model',
      baseUrl: 'https://provider.invalid/api',
      aspect_ratio: '1:1',
      image_size: '2K',
    }]),
  }
  const frameRepairService = {
    async enqueue(input) {
      serviceCalls.push(input)
      return {
        id: 'job_frame_repair',
        status: 'queued',
        type: 'editor_character_frame_repair',
        created_at: CREATED_AT,
        project_id: 'project_demo',
        project_revision: fixture.project.revision,
        asset_id: 'asset_hero',
        parent_revision_id: 'rev_001',
        operation_id: OPERATION_ID,
        plan_hash: input.identity.plan_hash,
        implementation_revision: 'package-0.5.0',
        provider_call_budget: 1,
        provider_calls_used: 0,
        generated_candidate_count: 0,
        quality_status: 'unknown',
        reason: null,
        retry_hint: null,
        recovery_state: null,
        artifact_manifest_sha256: null,
      }
    },
    async getOperation(lookup) {
      operationCalls.push(lookup)
      return { id: 'job_frame_repair', status: 'queued', ...lookup }
    },
    getJob() {
      return null
    },
  }
  const coordinator = createFrameRepairCoordinator({
    projectRoot: fixture.root,
    workspaceRoot: fixture.workspaceRoot,
    generatedDir: path.join(fixture.root, 'generated'),
    implementationRevision: 'package-0.5.0',
    getProviderEnv() {
      providerEnvReads += 1
      return { ...providerEnv }
    },
    frameRepairService,
  })
  return {
    coordinator,
    serviceCalls,
    operationCalls,
    get providerEnvReads() {
      return providerEnvReads
    },
  }
}

async function mutateFormalProject(fixture, mutate) {
  const project = await fixture.loadProject()
  mutate(project)
  const saved = await saveEditorProject({
    project,
    projectRoot: fixture.root,
    workspaceRoot: fixture.workspaceRoot,
    expectedRevision: project.revision,
    now: new Date('2026-07-11T00:01:00.000Z'),
  })
  fixture.project = saved.project
  fixture.asset = saved.project.assets.asset_hero
  return saved.project
}

test('Plan reloads managed authority, spends zero calls, and binds repeated clip position', async () => {
  const fixture = await managedFrameRepairFixture({ clipFrames: [16, 17, 17, 18] })
  const harness = coordinatorHarness(fixture)
  const result = await harness.coordinator.planFrameRepair({
    projectId: 'project_demo',
    assetId: 'asset_hero',
    body: planBody(fixture, { clipFramePosition: 2, sheetFrameIndex: 17 }),
  })
  assert.equal(result.plan.clip.position, 2)
  assert.equal(result.plan.clip.sheet_frame_index, 17)
  assert.equal(result.plan.instruction, 'Repair the left outline')
  assert.equal(result.estimated_provider_calls, 1)
  assert.equal(result.can_run, true)
  assert.equal(harness.serviceCalls.length, 0)
  assert.equal(harness.providerEnvReads, 1)
  assert.equal((await fixture.loadProject()).revision, fixture.project.revision)
  assert.equal(JSON.stringify(result).includes('private-provider-key'), false)
  assert.equal(JSON.stringify(result).includes('base64'), false)
})

test('live submit re-plans exactly and stale hash spends no call', async () => {
  const fixture = await managedFrameRepairFixture()
  const harness = coordinatorHarness(fixture)
  const planned = await harness.coordinator.planFrameRepair({
    projectId: 'project_demo',
    assetId: 'asset_hero',
    body: planBody(fixture),
  })
  await assert.rejects(
    harness.coordinator.submitFrameRepair({
      projectId: 'project_demo',
      assetId: 'asset_hero',
      body: liveBody(fixture, 'f'.repeat(64)),
    }),
    (error) => error?.code === 'stale_plan',
  )
  assert.equal(harness.serviceCalls.length, 0)

  const submitted = await harness.coordinator.submitFrameRepair({
    projectId: 'project_demo',
    assetId: 'asset_hero',
    body: liveBody(fixture, planned.plan_hash),
  })
  assert.equal(submitted.plan_hash, planned.plan_hash)
  assert.equal(harness.serviceCalls.length, 1)
  assert.equal(harness.serviceCalls[0].providerPreset.apiKey, 'private-provider-key')
  assert.equal(harness.serviceCalls[0].identity.operation_id, OPERATION_ID)
  assert.equal(harness.serviceCalls[0].plan.parent_sheet_sha256, sha256(fixture.sheetBuffer))
  assert.equal(JSON.stringify(submitted).includes('private-provider-key'), false)
})

test('operation recovery validates the route and performs no provider planning', async () => {
  const fixture = await managedFrameRepairFixture()
  const harness = coordinatorHarness(fixture)
  const recovered = await harness.coordinator.getFrameRepairOperation({
    projectId: 'project_demo',
    assetId: 'asset_hero',
    operationId: OPERATION_ID,
  })
  assert.equal(recovered.id, 'job_frame_repair')
  assert.deepEqual(harness.operationCalls, [{
    project_id: 'project_demo',
    asset_id: 'asset_hero',
    operation_id: OPERATION_ID,
  }])
  assert.equal(harness.providerEnvReads, 0)
  assert.equal(harness.serviceCalls.length, 0)
})

test('project and active asset revision conflicts fail before authority capture', async () => {
  const fixture = await managedFrameRepairFixture()
  const harness = coordinatorHarness(fixture)
  await assert.rejects(
    harness.coordinator.planFrameRepair({
      projectId: 'project_demo',
      assetId: 'asset_hero',
      body: planBody(fixture, { expectedRevision: fixture.project.revision - 1 }),
    }),
    (error) => error?.code === 'revision_conflict',
  )

  await mutateFormalProject(fixture, (project) => {
    const asset = project.assets.asset_hero
    asset.revisions.rev_002 = {
      ...structuredClone(asset.revisions.rev_001),
      id: 'rev_002',
      artifacts: Object.fromEntries(Object.entries(asset.revisions.rev_001.artifacts).map(
        ([key, value]) => [key, value.replace('/rev_001/', '/rev_002/')],
      )),
    }
    asset.active_revision_id = 'rev_002'
  })
  await assert.rejects(
    harness.coordinator.planFrameRepair({
      projectId: 'project_demo',
      assetId: 'asset_hero',
      body: planBody(fixture, { expectedAssetRevisionId: 'rev_001' }),
    }),
    (error) => error?.code === 'asset_revision_conflict',
  )
  assert.equal(harness.serviceCalls.length, 0)
})

test('missing, malformed, and symlinked managed artifacts are rejected', async (t) => {
  await t.test('missing', async () => {
    const fixture = await managedFrameRepairFixture({ metadataFileMode: 'missing' })
    const harness = coordinatorHarness(fixture)
    await assert.rejects(
      harness.coordinator.planFrameRepair({
        projectId: 'project_demo', assetId: 'asset_hero', body: planBody(fixture),
      }),
      (error) => error?.code === 'artifact_not_found',
    )
  })

  await t.test('malformed', async () => {
    const fixture = await managedFrameRepairFixture()
    await writeFile(path.join(fixture.revisionDir, 'metadata.json'), '{')
    const harness = coordinatorHarness(fixture)
    await assert.rejects(
      harness.coordinator.planFrameRepair({
        projectId: 'project_demo', assetId: 'asset_hero', body: planBody(fixture),
      }),
      (error) => error?.code === 'invalid_managed_metadata',
    )
  })

  await t.test('symlink', async () => {
    const fixture = await managedFrameRepairFixture({ metadataFileMode: 'symlink' })
    const harness = coordinatorHarness(fixture)
    await assert.rejects(
      harness.coordinator.planFrameRepair({
        projectId: 'project_demo', assetId: 'asset_hero', body: planBody(fixture),
      }),
      (error) => error?.code === 'unsafe_artifact_path',
    )
  })
})

test('profile, sheet geometry, clip metadata, and clip position are authoritative', async (t) => {
  await t.test('profile conflict', async () => {
    const fixture = await managedFrameRepairFixture()
    await writeJson(path.join(fixture.revisionDir, 'metadata.json'), {
      version: TOPDOWN_RPG_V0.version,
      profile: 'other_profile',
      name: 'Hero',
    })
    const harness = coordinatorHarness(fixture)
    await assert.rejects(
      harness.coordinator.planFrameRepair({
        projectId: 'project_demo', assetId: 'asset_hero', body: planBody(fixture),
      }),
      (error) => error?.code === 'profile_conflict',
    )
  })

  await t.test('sheet geometry', async () => {
    const fixture = await managedFrameRepairFixture()
    const data = new Uint8ClampedArray(96 * 96 * 4)
    data.fill(255)
    await writeFile(
      path.join(fixture.revisionDir, 'normalized_sheet.png'),
      await encodeRgbaPng({ width: 96, height: 96, data }),
    )
    const harness = coordinatorHarness(fixture)
    await assert.rejects(
      harness.coordinator.planFrameRepair({
        projectId: 'project_demo', assetId: 'asset_hero', body: planBody(fixture),
      }),
      (error) => error?.code === 'invalid_managed_sheet',
    )
  })

  await t.test('clip fps', async () => {
    const fixture = await managedFrameRepairFixture()
    const animations = buildAnimationsJson(TOPDOWN_RPG_V0)
    animations.animations.walk_down.fps = 0
    await writeJson(path.join(fixture.revisionDir, 'animations.json'), animations)
    const harness = coordinatorHarness(fixture)
    await assert.rejects(
      harness.coordinator.planFrameRepair({
        projectId: 'project_demo', assetId: 'asset_hero', body: planBody(fixture),
      }),
      (error) => error?.code === 'invalid_managed_metadata',
    )
  })

  await t.test('clip position', async () => {
    const fixture = await managedFrameRepairFixture()
    const harness = coordinatorHarness(fixture)
    await assert.rejects(
      harness.coordinator.planFrameRepair({
        projectId: 'project_demo',
        assetId: 'asset_hero',
        body: planBody(fixture, { clipFramePosition: 0, sheetFrameIndex: 17 }),
      }),
      (error) => error?.code === 'frame_identity_mismatch',
    )
  })
})

test('mask scope is bounded and empty Plans cannot be submitted', async () => {
  const fixture = await managedFrameRepairFixture()
  const harness = coordinatorHarness(fixture)
  await assert.rejects(
    harness.coordinator.planFrameRepair({
      projectId: 'project_demo',
      assetId: 'asset_hero',
      body: planBody(fixture, {
        maskEdits: [{ op: 'add_rectangle', x: 90, y: 90, width: 20, height: 20 }],
      }),
    }),
    (error) => error?.code === 'invalid_frame_repair_mask',
  )

  const emptyPlan = await harness.coordinator.planFrameRepair({
    projectId: 'project_demo',
    assetId: 'asset_hero',
    body: planBody(fixture, { maskEdits: [] }),
  })
  assert.equal(emptyPlan.can_run, false)
  assert.ok(emptyPlan.diagnostics.includes('invalid_mask'))
  await assert.rejects(
    harness.coordinator.submitFrameRepair({
      projectId: 'project_demo',
      assetId: 'asset_hero',
      body: liveBody(fixture, emptyPlan.plan_hash, { maskEdits: [] }),
    }),
    (error) => error?.code === 'invalid_frame_repair_mask',
  )
  assert.equal(harness.serviceCalls.length, 0)
})

test('provider configuration is exact and live references are single-frame bounded', async () => {
  const fixture = await managedFrameRepairFixture()
  const unavailable = coordinatorHarness(fixture, { apiKey: '' })
  const unavailablePlan = await unavailable.coordinator.planFrameRepair({
    projectId: 'project_demo', assetId: 'asset_hero', body: planBody(fixture),
  })
  assert.equal(unavailablePlan.can_run, false)
  assert.ok(unavailablePlan.diagnostics.includes('provider_unavailable'))
  assert.equal(JSON.stringify(unavailablePlan).includes('private-provider-key'), false)
  await assert.rejects(
    unavailable.coordinator.submitFrameRepair({
      projectId: 'project_demo',
      assetId: 'asset_hero',
      body: liveBody(fixture, unavailablePlan.plan_hash),
    }),
    (error) => error?.code === 'provider_unavailable',
  )
  assert.equal(unavailable.serviceCalls.length, 0)
  const malformed = coordinatorHarness(fixture, { providerConfig: '{' })
  await assert.rejects(
    malformed.coordinator.planFrameRepair({
      projectId: 'project_demo', assetId: 'asset_hero', body: planBody(fixture),
    }),
    (error) => error?.code === 'provider_configuration_error',
  )

  const gemini = coordinatorHarness(fixture, { provider: 'gemini' })
  const planned = await gemini.coordinator.planFrameRepair({
    projectId: 'project_demo', assetId: 'asset_hero', body: planBody(fixture),
  })
  assert.deepEqual(planned.plan.references.input_reference_roles, [
    'target_enlarged', 'mask_visualization', 'clip_context',
  ])
  await gemini.coordinator.submitFrameRepair({
    projectId: 'project_demo',
    assetId: 'asset_hero',
    body: liveBody(fixture, planned.plan_hash),
  })
  assert.deepEqual(gemini.serviceCalls[0].referenceImages.map((item) => item.role), [
    'target_enlarged', 'mask_visualization', 'clip_context',
  ])
  assert.equal(gemini.serviceCalls[0].referenceImages[2].name, 'adjacent_context.png')
  assert.ok(gemini.serviceCalls[0].referenceImages.every((item) => Buffer.isBuffer(item.buffer)))
  const decodedReferences = await Promise.all(
    gemini.serviceCalls[0].referenceImages.map((item) => loadRgba(item.buffer)),
  )
  const referenceSizes = decodedReferences.map(({ width, height }) => ({ width, height }))
  assert.deepEqual(referenceSizes, Array(3).fill({
    width: TOPDOWN_RPG_V0.authoringCell.w,
    height: TOPDOWN_RPG_V0.authoringCell.h,
  }))
  assert.equal(
    gemini.serviceCalls[0].referenceImages[0].buffer.equals(
      gemini.serviceCalls[0].referenceImages[2].buffer,
    ),
    false,
  )
  const parentSheet = await loadRgba(fixture.sheetBuffer)
  const previousFrame = extractFrameRgba(parentSheet, 16, TOPDOWN_RPG_V0.frame)
  assert.deepEqual(
    decodedReferences[2],
    await resizeRgbaNearest(previousFrame, TOPDOWN_RPG_V0.authoringCell),
  )

  const boundaryFixture = await managedFrameRepairFixture()
  const boundary = coordinatorHarness(boundaryFixture, { provider: 'gemini' })
  const boundaryRequest = { clipFramePosition: 0, sheetFrameIndex: 16 }
  const boundaryPlan = await boundary.coordinator.planFrameRepair({
    projectId: 'project_demo',
    assetId: 'asset_hero',
    body: planBody(boundaryFixture, boundaryRequest),
  })
  await boundary.coordinator.submitFrameRepair({
    projectId: 'project_demo',
    assetId: 'asset_hero',
    body: liveBody(boundaryFixture, boundaryPlan.plan_hash, boundaryRequest),
  })
  const boundarySheet = await loadRgba(boundaryFixture.sheetBuffer)
  const nextFrame = extractFrameRgba(boundarySheet, 17, TOPDOWN_RPG_V0.frame)
  assert.deepEqual(
    await loadRgba(boundary.serviceCalls[0].referenceImages[2].buffer),
    await resizeRgbaNearest(nextFrame, TOPDOWN_RPG_V0.authoringCell),
  )
})

test('unsafe public provider fields are rejected before Plan or provider dispatch', async () => {
  const fixture = await managedFrameRepairFixture()
  const unsafeFields = [
    { label: 'https://provider.invalid/private' },
    { model: '/private/model.bin' },
    { aspect_ratio: '../secret' },
    { label: 'A'.repeat(64) },
    { label: 'private-provider-key' },
  ]
  for (const fields of unsafeFields) {
    const harness = coordinatorHarness(fixture, {
      providerConfig: JSON.stringify([{
        id: 'test-preset',
        label: 'Safe preset',
        provider: 'openrouter',
        apiKey: 'private-provider-key',
        model: 'provider/image-model',
        aspect_ratio: '1:1',
        image_size: '1K',
        ...fields,
      }]),
    })
    await assert.rejects(
      harness.coordinator.planFrameRepair({
        projectId: 'project_demo', assetId: 'asset_hero', body: planBody(fixture),
      }),
      (error) => error?.code === 'provider_configuration_error',
    )
    assert.equal(harness.serviceCalls.length, 0)
  }
  const shortKey = coordinatorHarness(fixture, {
    providerConfig: JSON.stringify([{
      id: 'test-preset',
      label: 'prefix-xy-suffix',
      provider: 'openrouter',
      apiKey: 'xy',
      model: 'provider/image-model',
      aspect_ratio: '1:1',
      image_size: '1K',
    }]),
  })
  await assert.rejects(
    shortKey.coordinator.planFrameRepair({
      projectId: 'project_demo', assetId: 'asset_hero', body: planBody(fixture),
    }),
    (error) => error?.code === 'provider_configuration_error',
  )
})

test('parent sheet replacement and unsafe instruction fail before service enqueue', async () => {
  const fixture = await managedFrameRepairFixture()
  const harness = coordinatorHarness(fixture)
  const planned = await harness.coordinator.planFrameRepair({
    projectId: 'project_demo', assetId: 'asset_hero', body: planBody(fixture),
  })
  const replaced = frameSheet()
  replaced.data[0] = 255
  replaced.data[3] = 255
  await writeFile(
    path.join(fixture.revisionDir, 'normalized_sheet.png'),
    await encodeRgbaPng(replaced),
  )
  await assert.rejects(
    harness.coordinator.submitFrameRepair({
      projectId: 'project_demo',
      assetId: 'asset_hero',
      body: liveBody(fixture, planned.plan_hash),
    }),
    (error) => error?.code === 'stale_plan',
  )
  assert.equal(harness.serviceCalls.length, 0)

  for (const instruction of [
    'Use https://example.invalid/reference.png',
    'Read /Users/person/private.png',
    'Load ../secret.png',
    'Bearer abcdefghijklmnopqrstuvwxyz',
  ]) {
    await assert.rejects(
      harness.coordinator.planFrameRepair({
        projectId: 'project_demo',
        assetId: 'asset_hero',
        body: planBody(fixture, { instruction }),
      }),
      (error) => error?.code === 'invalid_frame_repair_request',
    )
  }
})

test('live submit records a safely resolved nullable parent Processing Recipe reference', async () => {
  const fixture = await managedFrameRepairFixture()
  await writeJson(path.join(fixture.revisionDir, 'processing_recipe.json'), {
    version: 'processing_recipe_v0',
    target_pipeline: 'character_pack',
  })
  await mutateFormalProject(fixture, (project) => {
    project.assets.asset_hero.revisions.rev_001.processing_recipe_ref = managedRef(
      'processing_recipe.json',
    )
  })
  const harness = coordinatorHarness(fixture)
  const planned = await harness.coordinator.planFrameRepair({
    projectId: 'project_demo', assetId: 'asset_hero', body: planBody(fixture),
  })
  await harness.coordinator.submitFrameRepair({
    projectId: 'project_demo',
    assetId: 'asset_hero',
    body: liveBody(fixture, planned.plan_hash),
  })
  assert.equal(
    harness.serviceCalls[0].lineage.parent_processing_recipe_ref,
    managedRef('processing_recipe.json'),
  )
  assert.equal(JSON.stringify(planned).includes('processing_recipe.json'), false)
})

test('coordinator live authority is accepted by the real service boundary without dispatch', async () => {
  const fixture = await managedFrameRepairFixture({ clipFrames: [16, 17, 17, 18] })
  const jobs = new Map()
  const queue = []
  const frameRepairService = createFrameRepairService({
    generatedDir: path.join(fixture.root, 'generated'),
    jobQueue: {
      enqueue(task, onError) {
        queue.push({ task, onError })
      },
    },
    createJob(input) {
      const job = { id: 'job_real_boundary', created_at: CREATED_AT, ...input }
      jobs.set(job.id, job)
      return job
    },
    getJob(jobId) {
      return jobs.get(jobId) ?? null
    },
    updateJob(jobId, patch) {
      const job = { ...jobs.get(jobId), ...patch }
      jobs.set(jobId, job)
      return job
    },
    ledger: createFrameRepairOperationLedger({
      workspaceRoot: fixture.workspaceRoot,
      now: () => new Date(CREATED_AT),
    }),
    generateCandidate: async () => { throw new Error('must not dispatch') },
    normalizeCandidate: async () => { throw new Error('must not normalize') },
    compositeCandidate: async () => { throw new Error('must not composite') },
    packageSheet: async () => { throw new Error('must not package') },
    writeArtifacts: async () => { throw new Error('must not write') },
  })
  const coordinator = createFrameRepairCoordinator({
    projectRoot: fixture.root,
    workspaceRoot: fixture.workspaceRoot,
    generatedDir: path.join(fixture.root, 'generated'),
    implementationRevision: 'package-0.5.0',
    getProviderEnv: () => ({
      CHARACTER_PROVIDER_PRESETS: JSON.stringify([{
        id: 'test-preset',
        label: 'Test preset',
        provider: 'openrouter',
        apiKey: 'private-provider-key',
        model: 'test/image-model',
        aspect_ratio: '1:1',
        image_size: '1K',
      }]),
    }),
    frameRepairService,
  })
  const planRequest = planBody(fixture, { clipFramePosition: 2, sheetFrameIndex: 17 })
  const planned = await coordinator.planFrameRepair({
    projectId: 'project_demo', assetId: 'asset_hero', body: planRequest,
  })
  const submitted = await coordinator.submitFrameRepair({
    projectId: 'project_demo',
    assetId: 'asset_hero',
    body: {
      ...planRequest,
      operationId: OPERATION_ID,
      expectedPlanHash: planned.plan_hash,
      confirmLiveGeneration: true,
      maxProviderCalls: 1,
    },
  })
  assert.equal(submitted.status, 'queued')
  assert.equal(submitted.provider_calls_used, 0)
  assert.equal(queue.length, 1)
  assert.equal(jobs.size, 1)
})
