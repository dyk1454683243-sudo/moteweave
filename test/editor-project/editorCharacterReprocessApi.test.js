import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

import { encodeRgbaPng } from '../../src/character-pack/imageCodec.js'
import { hashRepairRecipe } from '../../src/editor-project/repairRecipeHash.js'
import * as editorProject from '../../src/editor-project/index.js'

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)
const CREATED_AT = '2026-07-10T00:00:00.000Z'

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

async function tempRoot(label = 'editor-character-reprocess-api-') {
  return mkdtemp(path.join(os.tmpdir(), label))
}

async function tinyPng(seed = 20) {
  const width = 8
  const height = 8
  const data = new Uint8ClampedArray(width * height * 4)
  for (let index = 0; index < data.length; index += 4) {
    data[index] = seed
    data[index + 1] = seed + 1
    data[index + 2] = seed + 2
    data[index + 3] = 255
  }
  return encodeRgbaPng({ width, height, data })
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

function managedRef(fileName, { revisionId = 'rev_001' } = {}) {
  return `workspace/projects/project_demo/assets/asset_hero/${revisionId}/${fileName}`
}

function managedParentRecipe({
  sourceLayout = 'topdown_rpg_v0',
  sourceJobId = 'job_parent',
  blackMatteRef = null,
} = {}) {
  const recipe = editorProject.createDefaultCharacterProcessingRecipe({
    fileName: 'source.png',
    sourceLayout,
    sourceJobId,
    assetId: 'asset_hero',
    blackMatteArtifactRef: blackMatteRef,
    createdFrom: blackMatteRef ? { background: { mode: 'dual_matte' } } : {},
  })
  recipe.implementation_revision = 'package-parent'
  return recipe
}

async function createManagedCharacterProject(root, {
  includeSource = true,
  includeSheet = true,
  includeBlackMatte = false,
  parentRecipe = undefined,
  parentRecipeRef = null,
  debugReport = { source_layout: { id: 'topdown_rpg_v0' }, validation: { status: 'pass' } },
  animations = {
    profile: 'topdown_rpg_v0',
    source_layout: { id: 'topdown_rpg_v0' },
    frame_size: { w: 96, h: 96 },
    anchor: { x: 48, y: 88 },
    animations: { walk_down: { frames: [16, 17, 18, 19], fps: 10, loop: true, mode: 'loop' } },
  },
  metadata = {
    name: 'Managed historical name',
    description: 'Managed hero description',
    profile: 'topdown_rpg_v0',
    generation: {
      mode: 'upload',
      provider: 'safe-provider',
      model: 'safe-model',
      image_config: { image_size: '1024x1024', aspect_ratio: '1:1' },
      template_file: 'template.png',
      prompt: 'must not be copied',
      prompt_contract: { contract_version: 'v1', layout_id: 'topdown_rpg_v0' },
    },
  },
  assetProfile = 'topdown_rpg_v0',
  assetName = 'Hero server name',
  extraArtifacts = {},
} = {}) {
  const revisionDir = path.join(root, 'workspace', 'projects', 'project_demo', 'assets', 'asset_hero', 'rev_001')
  await mkdir(revisionDir, { recursive: true })
  const sourceBuffer = await tinyPng(20)
  const sheetBuffer = await tinyPng(40)
  const blackBuffer = await tinyPng(60)
  if (includeSource) await writeFile(path.join(revisionDir, 'source.png'), sourceBuffer)
  if (includeSheet) await writeFile(path.join(revisionDir, 'normalized_sheet.png'), sheetBuffer)
  if (includeBlackMatte) await writeFile(path.join(revisionDir, 'black.png'), blackBuffer)
  await writeJson(path.join(revisionDir, 'animations.json'), animations)
  await writeJson(path.join(revisionDir, 'metadata.json'), metadata)
  await writeJson(path.join(revisionDir, 'editor_metadata.json'), { version: '0.1', frames: {} })
  if (typeof debugReport === 'string') {
    await writeFile(path.join(revisionDir, 'debug_report.json'), debugReport)
  } else if (debugReport !== null) {
    await writeJson(path.join(revisionDir, 'debug_report.json'), debugReport)
  }
  const resolvedRecipeRef = parentRecipeRef ?? (parentRecipe === undefined ? null : managedRef('processing_recipe.json'))
  if (parentRecipe !== undefined && parentRecipeRef == null) {
    await writeJson(path.join(revisionDir, 'processing_recipe.json'), parentRecipe)
  }

  const artifacts = {
    ...(includeSource ? { source: managedRef('source.png') } : {}),
    ...(includeSheet ? { sheet: managedRef('normalized_sheet.png') } : {}),
    animations: managedRef('animations.json'),
    metadata: managedRef('metadata.json'),
    editor_metadata: managedRef('editor_metadata.json'),
    ...(debugReport !== null ? { debug_report: managedRef('debug_report.json') } : {}),
    ...(includeBlackMatte ? { black_matte: managedRef('black.png') } : {}),
    ...extraArtifacts,
  }
  const revision = editorProject.createAssetRevision({
    id: 'rev_001',
    sourceJobId: 'job_parent',
    createdAt: CREATED_AT,
    qualityStatus: 'pass',
    productionStatus: 'ready',
    processingRecipeRef: resolvedRecipeRef,
    artifacts,
  })
  const asset = editorProject.createAssetRef({
    id: 'asset_hero',
    kind: 'character_pack',
    name: assetName,
    profile: assetProfile,
    revision,
    provenance: { source_type: 'upload', provider: null, model: null },
    clips: {
      walk_down: {
        id: 'walk_down',
        source: 'animations.json',
        frames: [16, 17, 18, 19],
        fps: 10,
        loop_mode: 'loop',
        frame_size: { w: 96, h: 96 },
        anchor: { x: 48, y: 88 },
      },
    },
  })
  const project = editorProject.createDefaultEditorProject({
    id: 'project_demo',
    name: 'Demo Project',
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  })
  project.assets.asset_hero = asset
  const saved = await editorProject.saveEditorProject({
    project,
    projectRoot: root,
    workspaceRoot: path.join(root, 'workspace'),
    now: new Date(CREATED_AT),
  })
  return {
    project: saved.project,
    asset: saved.project.assets.asset_hero,
    revision: saved.project.assets.asset_hero.revisions.rev_001,
    revisionDir,
    sourceBuffer,
    sheetBuffer,
    blackBuffer,
  }
}

function createCapturingReprocessService({ jobId = 'job_preview' } = {}) {
  const calls = []
  const jobs = new Map()
  return {
    calls,
    jobs,
    service: Object.freeze({
      enqueue(input) {
        calls.push(input)
        const job = {
          id: jobId,
          status: 'queued',
          created_at: CREATED_AT,
          type: 'editor_character_reprocess',
        }
        jobs.set(jobId, job)
        return job
      },
      getJob(id) {
        return jobs.get(id) ?? null
      },
    }),
  }
}

function recipeForManagedFixture(fixture, {
  sourceLayout = 'topdown_rpg_v0',
  blackMatteRef = fixture.revision.artifacts.black_matte ?? null,
  backgroundMode = blackMatteRef ? 'dual_matte' : 'auto',
} = {}) {
  return editorProject.createDefaultCharacterProcessingRecipe({
    fileName: fixture.revision.artifacts.source ? 'source.png' : 'normalized_sheet.png',
    sourceLayout,
    sourceJobId: fixture.revision.source_job_id,
    assetId: fixture.asset.id,
    blackMatteArtifactRef: blackMatteRef,
    createdFrom: { background: { mode: backgroundMode } },
  })
}

function coordinatorFor(root, service) {
  return editorProject.createCharacterReprocessCoordinator({
    projectRoot: root,
    workspaceRoot: path.join(root, 'workspace'),
    generatedDir: path.join(root, 'generated'),
    implementationRevision: 'package-0.4.0',
    reprocessService: service,
  })
}

async function writeCompletedReprocessJob(root, fixture, {
  jobId = 'job_preview',
  status = 'done',
  quality = 'pass',
  sentinel = 80,
  blackMatte = Boolean(fixture.revision.artifacts.black_matte),
  draftRecipeMutate = (value) => value,
  recipeMutate = (value) => value,
  contextMutate = (value) => value,
  jobMutate = (value) => value,
} = {}) {
  const generatedDir = path.join(root, 'generated')
  const jobDir = path.join(generatedDir, jobId)
  await mkdir(jobDir, { recursive: true })
  const draftRecipe = draftRecipeMutate(recipeForManagedFixture(fixture, {
    blackMatteRef: blackMatte ? fixture.revision.artifacts.black_matte : null,
    backgroundMode: blackMatte ? 'dual_matte' : 'auto',
  }))
  const canonicalRecipe = editorProject.withRepairImplementationRevision(
    editorProject.canonicalizeRepairRecipe(draftRecipe, {
      profile: (await import('../../src/character-pack/profile.js')).TOPDOWN_RPG_V0,
      sourceSize: { width: 8, height: 8 },
      inputMode: fixture.revision.artifacts.source ? 'managed_source' : 'normalized_sheet_fallback',
      sourceLayoutKind: 'uniform_grid',
      hasBlackMatte: blackMatte,
    }),
    'package-0.4.0',
  )
  const recipe = recipeMutate(structuredClone(canonicalRecipe))
  const recipeHash = hashRepairRecipe(
    editorProject.serializeCanonicalRecipe(canonicalRecipe),
  )
  const settingsHash = hashRepairRecipe(
    editorProject.serializeCanonicalRecipe(
      editorProject.createDraftSettingsHashInput(canonicalRecipe),
    ),
  )
  const context = contextMutate(reprocessContext({
    preview_job_id: jobId,
    project_revision: fixture.project.revision,
    input_mode: fixture.revision.artifacts.source ? 'managed_source' : 'normalized_sheet_fallback',
    input_artifact_key: fixture.revision.artifacts.source ? 'source' : 'sheet',
    input_artifact_ref: fixture.revision.artifacts.source ?? fixture.revision.artifacts.sheet,
    input_artifact_sha256: sha256(
      fixture.revision.artifacts.source ? fixture.sourceBuffer : fixture.sheetBuffer,
    ),
    black_matte_artifact_sha256: blackMatte ? sha256(fixture.blackBuffer) : null,
    recipe_hash: recipeHash,
    draft_settings_hash: settingsHash,
  }))

  const files = {
    source: await tinyPng(sentinel),
    source_layout_overlay: await tinyPng(sentinel + 1),
    sheet: await tinyPng(sentinel + 2),
    multi_resolution: Buffer.from(JSON.stringify({
      frame_sizes: [96, 64, 48, 32, 16],
      evidence_marker: `${jobId}-${sentinel}`,
    })),
    sheet_96: await tinyPng(sentinel + 3),
    sheet_64: await tinyPng(sentinel + 4),
    sheet_48: await tinyPng(sentinel + 5),
    sheet_32: await tinyPng(sentinel + 6),
    sheet_16: await tinyPng(sentinel + 7),
    animations: Buffer.from(JSON.stringify({
      evidence_marker: `${jobId}-${sentinel}`,
      profile: 'topdown_rpg_v0',
      source_layout: { id: 'topdown_rpg_v0' },
      frame_size: { w: 96, h: 96 },
      anchor: { x: 48, y: 88 },
      animations: {
        walk_down: { frames: [16, 17, 18, 19], fps: 10, loop: true, mode: 'loop' },
      },
    })),
    metadata: Buffer.from(JSON.stringify({
      evidence_marker: `${jobId}-${sentinel}`,
      id: 'hero',
      name: 'Hero server name',
      description: 'Managed hero description',
      profile: 'topdown_rpg_v0',
      source: { type: 'derived_revision' },
      generation: { mode: 'editor_reprocess' },
      created_at: CREATED_AT,
    })),
    editor_metadata: Buffer.from(JSON.stringify({
      version: '0.1',
      frames: {},
      evidence_marker: `${jobId}-${sentinel}`,
    })),
    debug_report: Buffer.from(JSON.stringify({
      evidence_marker: `${jobId}-${sentinel}`,
      source_layout: { id: 'topdown_rpg_v0' },
      validation: {
        status: quality,
        warnings: quality === 'warning' ? ['review_required'] : [],
        blocking_errors: quality === 'fail' ? ['quality_failed'] : [],
      },
    })),
    debug_overlay: await tinyPng(sentinel + 8),
    onion_skin_overlay: await tinyPng(sentinel + 9),
    processing_recipe: Buffer.from(`${JSON.stringify(recipe, null, 2)}\n`),
    reprocess_context: Buffer.from(`${JSON.stringify(context, null, 2)}\n`),
    zip: Buffer.from(`zip-${jobId}-${sentinel}`),
    ...(blackMatte ? { black_matte: fixture.blackBuffer } : {}),
  }
  const fileNames = blackMatte
    ? {
        ...editorProject.CHARACTER_REPROCESS_INTEGRITY_FILES,
        ...editorProject.CHARACTER_REPROCESS_OPTIONAL_INTEGRITY_FILES,
      }
    : editorProject.CHARACTER_REPROCESS_INTEGRITY_FILES
  const manifest = []
  for (const [key, fileName] of Object.entries(fileNames)) {
    const content = files[key]
    await writeFile(path.join(jobDir, fileName), content)
    manifest.push({
      key,
      file_name: fileName,
      size: content.byteLength,
      sha256: sha256(content),
    })
  }
  const job = jobMutate({
    id: jobId,
    status,
    created_at: CREATED_AT,
    type: 'editor_character_reprocess',
    project_id: 'project_demo',
    asset_id: 'asset_hero',
    parent_revision_id: 'rev_001',
    recipe_hash: recipeHash,
    draft_settings_hash: settingsHash,
    implementation_revision: 'package-0.4.0',
    artifact_integrity_manifest: manifest,
  })
  return {
    job,
    jobDir,
    generatedDir,
    recipe,
    canonicalRecipe,
    context,
    recipeHash,
    settingsHash,
    manifest,
    files,
  }
}

function serviceForJobs(jobs) {
  const byId = new Map(jobs.map((job) => [job.id, job]))
  return Object.freeze({
    enqueue() {
      throw new Error('unexpected enqueue')
    },
    getJob(id) {
      return byId.get(id) ?? null
    },
  })
}

function acceptBody(job, overrides = {}) {
  return {
    expectedRevision: 1,
    expectedAssetRevisionId: 'rev_001',
    expectedRecipeHash: job.recipe_hash,
    warningConfirmed: false,
    ...overrides,
  }
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  })
}

async function startEditorApi(root, options = {}) {
  const server = http.createServer((req, res) => editorProject.handleEditorProjectApi(req, res, {
    projectRoot: root,
    workspaceRoot: path.join(root, 'workspace'),
    generatedDir: path.join(root, 'legacy-generated'),
    reprocessGeneratedDir: path.join(root, 'generated'),
    artifactAccessRegistry: editorProject.createEditorArtifactAccessRegistry(),
    ...options,
  }))
  const port = await listen(server)
  return { server, baseUrl: `http://127.0.0.1:${port}` }
}

async function fetchJson(baseUrl, pathname, options = {}) {
  const response = await fetch(new URL(pathname, baseUrl), options)
  const text = await response.text()
  return { status: response.status, json: text ? JSON.parse(text) : {} }
}

function previewRecipe() {
  return editorProject.createDefaultCharacterProcessingRecipe({
    fileName: 'source.png',
    sourceLayout: 'topdown_rpg_v0',
    sourceJobId: 'job_parent',
    assetId: 'asset_hero',
  })
}

function previewBody(recipe = previewRecipe()) {
  return {
    expectedRevision: 1,
    expectedAssetRevisionId: 'rev_001',
    recipe,
  }
}

function reprocessContext(overrides = {}) {
  return {
    version: 'editor_reprocess_context_v0',
    job_type: 'editor_character_reprocess',
    preview_job_id: 'job_preview',
    submitted_at: '2026-07-10T00:00:00.000Z',
    project_id: 'project_demo',
    project_revision: 1,
    asset_id: 'asset_hero',
    parent_revision_id: 'rev_001',
    input_mode: 'managed_source',
    input_artifact_key: 'source',
    input_artifact_ref: 'workspace/projects/project_demo/assets/asset_hero/rev_001/source.png',
    input_artifact_sha256: HASH_A,
    black_matte_artifact_sha256: null,
    authoritative_source_layout: 'topdown_rpg_v0',
    recipe_hash: HASH_A,
    draft_settings_hash: HASH_B,
    implementation_revision: 'package-0.4.0',
    ...overrides,
  }
}

test('character reprocess coordinator exposes the strict backend boundary', () => {
  assert.equal(typeof editorProject.CharacterReprocessError, 'function')
  assert.equal(typeof editorProject.createCharacterReprocessCoordinator, 'function')
  assert.equal(typeof editorProject.assertPreviewRequest, 'function')
  assert.equal(typeof editorProject.assertAcceptRequest, 'function')
  assert.equal(typeof editorProject.validateEditorReprocessContext, 'function')
  assert.equal(typeof editorProject.sanitizeParentGeneration, 'function')
})

test('Preview and Accept use exact envelopes and reject client-controlled execution fields', () => {
  assert.deepEqual(editorProject.assertPreviewRequest(previewBody()), previewBody())
  const forbidden = [
    'source_path',
    'source_base64',
    'providerKey',
    'apiKey',
    'prompt',
    'script',
    'module',
    'options',
    'createdAt',
  ]
  for (const field of forbidden) {
    assert.throws(
      () => editorProject.assertPreviewRequest({ ...previewBody(), [field]: field === 'source_base64' ? 'data:image/png;base64,AAAA' : 'forbidden' }),
      (error) => ['unexpected_request_field', 'invalid_reprocess_request'].includes(error?.code),
      `root ${field}`,
    )
    const recipe = previewRecipe()
    recipe.source[field] = 'forbidden'
    assert.throws(
      () => editorProject.assertPreviewRequest(previewBody(recipe)),
      (error) => ['unexpected_request_field', 'invalid_reprocess_request', 'invalid_recipe'].includes(error?.code),
      `nested ${field}`,
    )
  }
  const implemented = previewRecipe()
  implemented.implementation_revision = 'client-build'
  assert.throws(
    () => editorProject.assertPreviewRequest(previewBody(implemented)),
    (error) => error?.code === 'invalid_recipe',
  )
  assert.throws(
    () => editorProject.assertPreviewRequest({ ...previewBody(), expected_revision: 1 }),
    (error) => error?.code === 'unexpected_request_field',
  )

  const accept = {
    expectedRevision: 1,
    expectedAssetRevisionId: 'rev_001',
    expectedRecipeHash: HASH_A,
    warningConfirmed: false,
  }
  assert.deepEqual(editorProject.assertAcceptRequest(accept), accept)
  for (const invalid of [
    { ...accept, expected_recipe_hash: HASH_A },
    { ...accept, expectedRecipeHash: HASH_B.slice(1) },
    { ...accept, warningConfirmed: 1 },
    { ...accept, expectedRevision: -1 },
  ]) {
    assert.throws(
      () => editorProject.assertAcceptRequest(invalid),
      (error) => ['invalid_accept_request', 'unexpected_request_field'].includes(error?.code),
    )
  }
})

test('editor reprocess context is exact, registered, and cross-bound to managed identity', () => {
  assert.deepEqual(editorProject.validateEditorReprocessContext(reprocessContext()), reprocessContext())
  const fallback = reprocessContext({
    input_mode: 'normalized_sheet_fallback',
    input_artifact_key: 'sheet',
    input_artifact_ref: 'workspace/projects/project_demo/assets/asset_hero/rev_001/normalized_sheet.png',
  })
  assert.deepEqual(editorProject.validateEditorReprocessContext(fallback), fallback)
  for (const invalid of [
    reprocessContext({ extra: true }),
    reprocessContext({ authoritative_source_layout: 'unknown_layout' }),
    reprocessContext({ project_revision: -1 }),
    reprocessContext({ input_artifact_key: 'sheet' }),
    reprocessContext({ input_artifact_ref: 'workspace/projects/project_other/assets/asset_hero/rev_001/source.png' }),
    reprocessContext({ input_artifact_ref: 'workspace/projects/project_demo/assets/asset_other/rev_001/source.png' }),
    reprocessContext({ input_artifact_ref: 'workspace/projects/project_demo/assets/asset_hero/rev_999/source.png' }),
    reprocessContext({ input_artifact_ref: 'workspace/projects/project_demo/assets/asset_hero/rev_001/normalized_sheet.png' }),
    reprocessContext({ input_mode: 'normalized_sheet_fallback', input_artifact_key: 'sheet', black_matte_artifact_sha256: HASH_B }),
    reprocessContext({
      input_mode: 'normalized_sheet_fallback',
      input_artifact_key: 'sheet',
      input_artifact_ref: 'workspace/projects/project_demo/assets/asset_hero/rev_001/normalized_sheet.png',
      authoritative_source_layout: 'fixed_region_motion_v0',
    }),
    reprocessContext({ input_artifact_sha256: new String(HASH_A) }),
  ]) {
    assert.throws(
      () => editorProject.validateEditorReprocessContext(invalid),
      (error) => ['invalid_reprocess_context', 'unexpected_request_field'].includes(error?.code),
    )
  }

  const { job_type, preview_job_id, submitted_at, ...base } = reprocessContext()
  assert.deepEqual(editorProject.validateEditorReprocessContextBase(base), base)
  assert.throws(
    () => editorProject.validateEditorReprocessContextBase({ ...base, submitted_at }),
    (error) => error?.code === 'unexpected_request_field',
  )
})

test('generation provenance uses the recursive allowlist without coercing objects or paths', () => {
  const result = editorProject.sanitizeParentGeneration({
    generation: {
      mode: 'upload',
      provider: 'safe-provider',
      provider_preset_id: 'preset-one',
      provider_label: 'Safe label',
      model: 'model-one',
      ignored_scalar: 'drop-me',
      image_config: { image_size: '1024x1024', aspect_ratio: '1:1', seed: 42 },
      template_file: 'template.png',
      prompt_file: 'prompt.txt',
      prompt: 'private prompt text',
      attempts: [{ raw_response: 'drop-me' }],
      prompt_contract: {
        contract_version: 'v1',
        layout_id: 'topdown_rpg_v0',
        profile: 'topdown_rpg_v0',
        profile_id: 'topdown_rpg_v0',
        mode: 'character',
        text: 'drop-me',
      },
    },
  })
  assert.deepEqual(result, {
    mode: 'upload',
    provider: 'safe-provider',
    provider_preset_id: 'preset-one',
    provider_label: 'Safe label',
    model: 'model-one',
    image_config: { image_size: '1024x1024', aspect_ratio: '1:1' },
    template_file: 'template.png',
    prompt_contract: {
      contract_version: 'v1',
      layout_id: 'topdown_rpg_v0',
      profile: 'topdown_rpg_v0',
      profile_id: 'topdown_rpg_v0',
      mode: 'character',
    },
  })
  for (const metadata of [
    { generation: { apiKey: 'secret' } },
    { generation: { model: 'sk-abcdefghijklmnop' } },
    { generation: [] },
    { generation: { image_config: [] } },
    { generation: { reference_file: '../reference.png' } },
    { generation: { reference_file: 'folder/reference.png' } },
    { generation: { reference_file: 'folder\\reference.png' } },
    { generation: { palette_file: { name: 'palette.png' } } },
    { generation: { template_file: '.' } },
    { generation: { model: { id: 'model' } } },
    { generation: { image_config: { image_size: ['1024x1024'] } } },
    { generation: { prompt_contract: { mode: ['character'] } } },
  ]) {
    assert.throws(
      () => editorProject.sanitizeParentGeneration(metadata),
      (error) => error?.code === 'invalid_managed_metadata',
    )
  }
})

test('managed Preview derives canonical authority, hashes, and provider-free processing input', async () => {
  const root = await tempRoot()
  const fixture = await createManagedCharacterProject(root, {
    includeBlackMatte: true,
    parentRecipe: managedParentRecipe({ blackMatteRef: managedRef('black.png') }),
    debugReport: { source_layout: { id: 'fixed_region_motion_v0' }, validation: { status: 'pass' } },
  })
  const capture = createCapturingReprocessService()
  const coordinator = coordinatorFor(root, capture.service)
  assert.equal(Object.isFrozen(coordinator), true)
  assert.deepEqual(Object.keys(coordinator).sort(), [
    'acceptCharacterReprocessPreview',
    'submitCharacterReprocessPreview',
  ])

  const recipe = recipeForManagedFixture(fixture)
  const response = await coordinator.submitCharacterReprocessPreview({
    projectId: 'project_demo',
    assetId: 'asset_hero',
    body: previewBody(recipe),
  })

  assert.equal(response.id, 'job_preview')
  assert.equal(response.recipe_hash, hashRepairRecipe(
    editorProject.serializeCanonicalRecipe(response.canonical_recipe),
  ))
  assert.equal(response.draft_settings_hash, hashRepairRecipe(
    editorProject.serializeCanonicalRecipe(
      editorProject.createDraftSettingsHashInput(response.canonical_recipe),
    ),
  ))
  assert.equal(response.canonical_recipe.implementation_revision, 'package-0.4.0')
  assert.deepEqual(response.diagnostics, [])
  assert.equal(capture.calls.length, 1)

  const call = capture.calls[0]
  assert.equal(Buffer.isBuffer(call.sourceBuffer), true)
  assert.deepEqual(call.sourceBuffer, fixture.sourceBuffer)
  assert.equal(Buffer.isBuffer(call.blackSourceBuffer), true)
  assert.deepEqual(call.blackSourceBuffer, fixture.blackBuffer)
  assert.deepEqual(call.processOptions.blackSourceBuffer, fixture.blackBuffer)
  assert.equal(call.processOptions.backgroundMode, 'dual_matte')
  assert.equal(call.processOptions.name, 'Hero server name')
  assert.equal(call.processOptions.description, 'Managed hero description')
  assert.equal(call.processOptions.profile.id, 'topdown_rpg_v0')
  assert.equal(call.processOptions.createdAt, undefined)
  assert.equal(call.processOptions.promptText, undefined)
  assert.equal(call.processOptions.providerKey, undefined)
  assert.equal(call.processOptions.apiKey, undefined)
  assert.deepEqual(call.processOptions.source, {
    type: 'derived_revision',
    file_name: 'source.png',
    parent_project_id: 'project_demo',
    parent_asset_id: 'asset_hero',
    parent_revision_id: 'rev_001',
    parent_job_id: 'job_parent',
  })
  assert.deepEqual(call.processOptions.generation, {
    mode: 'upload',
    provider: 'safe-provider',
    model: 'safe-model',
    image_config: { image_size: '1024x1024', aspect_ratio: '1:1' },
    template_file: 'template.png',
    prompt_contract: { contract_version: 'v1', layout_id: 'topdown_rpg_v0' },
  })
  assert.deepEqual(call.reprocessContextBase, {
    version: 'editor_reprocess_context_v0',
    project_id: 'project_demo',
    project_revision: 1,
    asset_id: 'asset_hero',
    parent_revision_id: 'rev_001',
    input_mode: 'managed_source',
    input_artifact_key: 'source',
    input_artifact_ref: managedRef('source.png'),
    input_artifact_sha256: sha256(fixture.sourceBuffer),
    black_matte_artifact_sha256: sha256(fixture.blackBuffer),
    authoritative_source_layout: 'topdown_rpg_v0',
    recipe_hash: response.recipe_hash,
    draft_settings_hash: response.draft_settings_hash,
    implementation_revision: 'package-0.4.0',
  })

  await writeFile(path.join(fixture.revisionDir, 'source.png'), await tinyPng(99))
  assert.deepEqual(call.sourceBuffer, fixture.sourceBuffer)
})

test('Preview queues the captured bytes when the managed path is replaced at the enqueue boundary', async () => {
  const root = await tempRoot()
  const fixture = await createManagedCharacterProject(root)
  const replacement = await tinyPng(98)
  const calls = []
  const service = Object.freeze({
    enqueue(input) {
      writeFileSync(path.join(fixture.revisionDir, 'source.png'), replacement)
      calls.push(input)
      return {
        id: 'job_capture_race',
        type: 'editor_character_reprocess',
        status: 'queued',
        created_at: CREATED_AT,
      }
    },
    getJob() {
      return null
    },
  })
  await coordinatorFor(root, service).submitCharacterReprocessPreview({
    projectId: 'project_demo',
    assetId: 'asset_hero',
    body: previewBody(recipeForManagedFixture(fixture)),
  })
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].sourceBuffer, fixture.sourceBuffer)
  assert.equal(calls[0].reprocessContextBase.input_artifact_sha256, sha256(fixture.sourceBuffer))
  assert.deepEqual(await readFile(path.join(fixture.revisionDir, 'source.png')), replacement)
})

test('dual matte Preview preserves the requested mode and real inconsistent-pair warning', async () => {
  const root = await tempRoot()
  const fixture = await createManagedCharacterProject(root, { includeBlackMatte: true })
  const source = await readFile('test/fixtures/character-pack/topdown_rpg_v0_sample_hero.png')
  const sharp = (await import('sharp')).default
  const metadata = await sharp(source).metadata()
  const inconsistentBlack = await sharp({
    create: {
      width: metadata.width,
      height: metadata.height,
      channels: 4,
      background: { r: 20, g: 220, b: 40, alpha: 1 },
    },
  }).png().toBuffer()
  await writeFile(path.join(fixture.revisionDir, 'source.png'), source)
  await writeFile(path.join(fixture.revisionDir, 'black.png'), inconsistentBlack)
  const capture = createCapturingReprocessService({ jobId: 'job_dual_matte_warning' })
  await coordinatorFor(root, capture.service).submitCharacterReprocessPreview({
    projectId: 'project_demo',
    assetId: 'asset_hero',
    body: previewBody(recipeForManagedFixture(fixture)),
  })
  const call = capture.calls[0]
  assert.equal(call.processOptions.backgroundMode, 'dual_matte')
  assert.deepEqual(call.blackSourceBuffer, inconsistentBlack)
  const { processSheetBuffer } = await import('../../src/character-pack/processSheet.js')
  const result = await processSheetBuffer(call.sourceBuffer, call.processOptions)
  assert.equal(result.debugReport.requested_background_mode, 'dual_matte')
  assert.equal(result.debugReport.background_mode, 'flood')
  assert.equal(result.debugReport.validation.dual_matte_inconsistent, true)
  assert.ok(result.debugReport.validation.warnings.includes('dual_matte_inconsistent'))
})

test('real queued Preview binds processing metadata and context to the service-created job clock', async () => {
  const root = await tempRoot()
  const callerCreatedAt = '1999-01-01T00:00:00.000Z'
  const fixture = await createManagedCharacterProject(root, {
    metadata: {
      name: 'Historical name',
      description: 'Managed hero description',
      profile: 'topdown_rpg_v0',
      created_at: callerCreatedAt,
      generation: { mode: 'upload', model: 'safe-model' },
    },
  })
  const source = await readFile('test/fixtures/character-pack/topdown_rpg_v0_sample_hero.png')
  await writeFile(path.join(fixture.revisionDir, 'source.png'), source)

  const jobs = new Map()
  const queued = []
  const generatedDir = path.join(root, 'generated')
  const { processSheetBuffer } = await import('../../src/character-pack/processSheet.js')
  const { writeCharacterPackArtifacts } = await import('../../src/character-pack/artifactWriter.js')
  const reprocessService = editorProject.createCharacterReprocessService({
    generatedDir,
    jobQueue: {
      enqueue(task, onError) {
        queued.push({ task, onError })
      },
    },
    createJob(initial) {
      const job = {
        id: 'job_real_time_binding',
        status: 'queued',
        created_at: CREATED_AT,
        ...initial,
      }
      jobs.set(job.id, job)
      return job
    },
    getJob(id) {
      return jobs.get(id) ?? null
    },
    updateJob(id, patch) {
      const next = { ...jobs.get(id), ...patch, updated_at: '2026-07-10T00:00:01.000Z' }
      jobs.set(id, next)
      return next
    },
    processSheet: processSheetBuffer,
    writeCharacterArtifacts: ({ job, result }) => writeCharacterPackArtifacts({
      jobId: job.id,
      outputDir: generatedDir,
      result,
      allowExistingJobDir: true,
    }),
    writeEvidence: (input) => editorProject.writeCharacterReprocessEvidence({
      generatedDir,
      ...input,
    }),
  })
  const submitted = await coordinatorFor(root, reprocessService).submitCharacterReprocessPreview({
    projectId: 'project_demo',
    assetId: 'asset_hero',
    body: previewBody(recipeForManagedFixture(fixture)),
  })
  assert.equal(submitted.created_at, CREATED_AT)
  assert.equal(queued.length, 1)
  await queued[0].task()

  const completed = reprocessService.getJob(submitted.id)
  assert.ok(['done', 'failed_post_processing'].includes(completed.status))
  assert.equal(completed.created_at, CREATED_AT)
  assert.equal(completed.artifact_integrity_manifest.length, 18)
  const metadata = JSON.parse(await readFile(path.join(generatedDir, submitted.id, 'metadata.json'), 'utf8'))
  const context = JSON.parse(await readFile(path.join(generatedDir, submitted.id, 'editor_reprocess_context.json'), 'utf8'))
  assert.equal(metadata.created_at, completed.created_at)
  assert.equal(context.submitted_at, completed.created_at)
  assert.equal(metadata.created_at, context.submitted_at)
  assert.notEqual(metadata.created_at, callerCreatedAt)
})

test('Preview uses explicit normalized-sheet fallback and never treats asset.profile as layout authority', async () => {
  const root = await tempRoot()
  const fixture = await createManagedCharacterProject(root, {
    includeSource: false,
    parentRecipe: null,
    debugReport: { source_layout: { id: 'fixed_region_motion_v0' }, validation: { status: 'pass' } },
    animations: {
      profile: 'topdown_rpg_v0',
      source_layout: { id: 'fixed_region_motion_v0' },
      animations: {},
    },
  })
  const capture = createCapturingReprocessService()
  const response = await coordinatorFor(root, capture.service).submitCharacterReprocessPreview({
    projectId: 'project_demo',
    assetId: 'asset_hero',
    body: previewBody(recipeForManagedFixture(fixture, { sourceLayout: 'topdown_rpg_v0' })),
  })
  assert.equal(capture.calls.length, 1)
  assert.deepEqual(capture.calls[0].sourceBuffer, fixture.sheetBuffer)
  assert.equal(capture.calls[0].reprocessContextBase.input_mode, 'normalized_sheet_fallback')
  assert.equal(capture.calls[0].reprocessContextBase.input_artifact_key, 'sheet')
  assert.equal(capture.calls[0].reprocessContextBase.authoritative_source_layout, 'topdown_rpg_v0')
  assert.ok(response.diagnostics.includes('normalized_sheet_fallback'))
  assert.ok(response.diagnostics.includes('processing_recipe_invalid'))

  const missingLayoutRoot = await tempRoot()
  const missing = await createManagedCharacterProject(missingLayoutRoot, {
    parentRecipe: null,
    debugReport: { source_layout: { id: 'unknown_layout' } },
    animations: { profile: 'topdown_rpg_v0', animations: {} },
  })
  await assert.rejects(
    coordinatorFor(missingLayoutRoot, createCapturingReprocessService().service).submitCharacterReprocessPreview({
      projectId: 'project_demo',
      assetId: 'asset_hero',
      body: previewBody(recipeForManagedFixture(missing)),
    }),
    (error) => error?.code === 'missing_source_layout',
  )
})

test('optional Recipe and debug evidence fall through in order with diagnostics, while unsafe paths block', async (t) => {
  await t.test('falsy and generic-valid Workbench-invalid Recipe values fall through to debug', async () => {
    for (const parentRecipe of [null, false, 0, '', {
      ...managedParentRecipe(),
      pipeline_contract: 'wrong-contract',
    }]) {
      const root = await tempRoot()
      const fixture = await createManagedCharacterProject(root, {
        parentRecipe,
        debugReport: { source_layout: { id: 'fixed_region_motion_v0' } },
        animations: {
          profile: 'topdown_rpg_v0',
          source_layout: { id: 'topdown_rpg_v0' },
          animations: {},
        },
      })
      const capture = createCapturingReprocessService()
      const response = await coordinatorFor(root, capture.service).submitCharacterReprocessPreview({
        projectId: 'project_demo',
        assetId: 'asset_hero',
        body: previewBody(recipeForManagedFixture(fixture, { sourceLayout: 'fixed_region_motion_v0' })),
      })
      assert.equal(capture.calls[0].reprocessContextBase.authoritative_source_layout, 'fixed_region_motion_v0')
      assert.ok(response.diagnostics.some((item) => item.startsWith('processing_recipe_')))
    }
  })

  await t.test('invalid debug layout falls through to the already captured animations authority', async () => {
    const root = await tempRoot()
    const fixture = await createManagedCharacterProject(root, {
      parentRecipe: undefined,
      debugReport: '{invalid-json',
    })
    const capture = createCapturingReprocessService()
    const response = await coordinatorFor(root, capture.service).submitCharacterReprocessPreview({
      projectId: 'project_demo',
      assetId: 'asset_hero',
      body: previewBody(recipeForManagedFixture(fixture)),
    })
    assert.equal(capture.calls[0].reprocessContextBase.authoritative_source_layout, 'topdown_rpg_v0')
    assert.ok(response.diagnostics.includes('debug_report_invalid_managed_metadata'))
  })

  await t.test('unsafe optional Recipe identity does not degrade to fallback', async () => {
    const root = await tempRoot()
    const fixture = await createManagedCharacterProject(root, {
      parentRecipeRef: 'workspace/projects/project_demo/assets/asset_attacker/rev_001/processing_recipe.json',
    })
    const capture = createCapturingReprocessService()
    await assert.rejects(
      coordinatorFor(root, capture.service).submitCharacterReprocessPreview({
        projectId: 'project_demo',
        assetId: 'asset_hero',
        body: previewBody(recipeForManagedFixture(fixture)),
      }),
      (error) => error?.code === 'unsafe_artifact_path',
    )
    assert.equal(capture.calls.length, 0)
  })
})

test('Preview fails closed for identity, revision, profile, metadata, input, and black-matte authority conflicts', async (t) => {
  await t.test('request identity and revisions', async () => {
    const root = await tempRoot()
    const fixture = await createManagedCharacterProject(root)
    const capture = createCapturingReprocessService()
    const coordinator = coordinatorFor(root, capture.service)
    for (const request of [
      { projectId: 'project_demo', assetId: 'asset_hero', body: { ...previewBody(recipeForManagedFixture(fixture)), expectedRevision: 2 } },
      { projectId: 'project_demo', assetId: 'asset_hero', body: { ...previewBody(recipeForManagedFixture(fixture)), expectedAssetRevisionId: 'rev_999' } },
      { projectId: 'project_demo', assetId: 'asset_hero', body: previewBody({ ...recipeForManagedFixture(fixture), source: { ...recipeForManagedFixture(fixture).source, source_job_id: 'job_other' } }) },
      { projectId: 'project_demo', assetId: 'asset_hero', body: previewBody({ ...recipeForManagedFixture(fixture), source: { ...recipeForManagedFixture(fixture).source, asset_id: 'asset_other' } }) },
      { projectId: 'project_demo', assetId: 'asset_hero', body: previewBody({ ...recipeForManagedFixture(fixture), source: { ...recipeForManagedFixture(fixture).source, source_layout: 'fixed_region_motion_v0' } }) },
    ]) {
      await assert.rejects(
        coordinator.submitCharacterReprocessPreview(request),
        (error) => ['revision_conflict', 'asset_revision_conflict', 'identity_mismatch'].includes(error?.code),
      )
    }
    assert.equal(capture.calls.length, 0)
  })

  await t.test('strict managed metadata, profile, and missing input', async () => {
    for (const options of [
      { metadata: { profile: 'topdown_rpg_v0', description: {}, generation: {} } },
      { metadata: { profile: 'topdown_rpg_v0', description: 'ok', generation: { apiKey: 'secret' } } },
      { metadata: { profile: 'other_profile', description: 'ok', generation: {} } },
      { animations: { profile: 'other_profile', source_layout: { id: 'topdown_rpg_v0' }, animations: {} } },
      { assetProfile: 'unknown_profile' },
      {
        includeSource: false,
        includeSheet: true,
        extraArtifacts: { sheet: managedRef('missing-normalized-sheet.png') },
      },
    ]) {
      const root = await tempRoot()
      const fixture = await createManagedCharacterProject(root, options)
      const capture = createCapturingReprocessService()
      await assert.rejects(
        coordinatorFor(root, capture.service).submitCharacterReprocessPreview({
          projectId: 'project_demo',
          assetId: 'asset_hero',
          body: previewBody(recipeForManagedFixture(fixture)),
        }),
        (error) => ['invalid_managed_metadata', 'profile_conflict', 'unsupported_profile', 'artifact_not_found'].includes(error?.code),
      )
      assert.equal(capture.calls.length, 0)
    }
  })

  await t.test('only the dedicated active-revision black_matte key is authoritative', async () => {
    const root = await tempRoot()
    const decoyRef = managedRef('decoy-black.png')
    const fixture = await createManagedCharacterProject(root, {
      extraArtifacts: { decoy: decoyRef },
    })
    await writeFile(path.join(fixture.revisionDir, 'decoy-black.png'), await tinyPng(70))
    const capture = createCapturingReprocessService()
    await assert.rejects(
      coordinatorFor(root, capture.service).submitCharacterReprocessPreview({
        projectId: 'project_demo',
        assetId: 'asset_hero',
        body: previewBody(recipeForManagedFixture(fixture, {
          blackMatteRef: decoyRef,
          backgroundMode: 'dual_matte',
        })),
      }),
      (error) => error?.code === 'identity_mismatch',
    )
    assert.equal(capture.calls.length, 0)
  })
})

test('Preview rejects non-string or blank server asset names before enqueue', async () => {
  for (const assetName of [{ label: 'Hero' }, ['Hero'], 42, '   ']) {
    const root = await tempRoot()
    const fixture = await createManagedCharacterProject(root, { assetName })
    const capture = createCapturingReprocessService()
    await assert.rejects(
      coordinatorFor(root, capture.service).submitCharacterReprocessPreview({
        projectId: 'project_demo',
        assetId: 'asset_hero',
        body: previewBody(recipeForManagedFixture(fixture)),
      }),
      (error) => error?.code === 'invalid_managed_metadata',
    )
    assert.equal(capture.calls.length, 0)
  }
})

test('Editor API exposes exact Preview and Accept routes with stable statuses', async (t) => {
  await t.test('Preview returns 202 and validation rejects before enqueue', async (t) => {
    const root = await tempRoot()
    const fixture = await createManagedCharacterProject(root)
    const capture = createCapturingReprocessService()
    const coordinator = coordinatorFor(root, capture.service)
    const { server, baseUrl } = await startEditorApi(root, {
      characterReprocessCoordinator: coordinator,
      reprocessService: capture.service,
    })
    t.after(() => server.close())
    const response = await fetchJson(
      baseUrl,
      '/api/editor/projects/project_demo/assets/asset_hero/reprocess',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(previewBody(recipeForManagedFixture(fixture))),
      },
    )
    assert.equal(response.status, 202)
    assert.equal(response.json.id, 'job_preview')
    assert.equal(response.json.recipe_hash.length, 64)
    assert.equal(response.json.draft_settings_hash.length, 64)
    assert.equal(response.json.canonical_recipe.implementation_revision, 'package-0.4.0')
    assert.equal(capture.calls.length, 1)

    const rejected = await fetchJson(
      baseUrl,
      '/api/editor/projects/project_demo/assets/asset_hero/reprocess',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...previewBody(recipeForManagedFixture(fixture)), prompt: 'forbidden' }),
      },
    )
    assert.equal(rejected.status, 400)
    assert.equal(rejected.json.error, 'unexpected_request_field')
    assert.equal(capture.calls.length, 1)
  })

  await t.test('Accept returns 200 and unavailable routes return stable 503', async (t) => {
    const root = await tempRoot()
    const fixture = await createManagedCharacterProject(root)
    const completed = await writeCompletedReprocessJob(root, fixture)
    const service = serviceForJobs([completed.job])
    const { server, baseUrl } = await startEditorApi(root, {
      characterReprocessCoordinator: coordinatorFor(root, service),
      reprocessService: service,
    })
    t.after(() => server.close())
    const response = await fetchJson(
      baseUrl,
      `/api/editor/projects/project_demo/assets/asset_hero/reprocess/${completed.job.id}/accept`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(acceptBody(completed.job)),
      },
    )
    assert.equal(response.status, 200)
    assert.equal(response.json.accepted, true)

    const unavailableRoot = await tempRoot()
    const unavailable = await startEditorApi(unavailableRoot)
    t.after(() => unavailable.server.close())
    for (const pathname of [
      '/api/editor/projects/project_demo/assets/asset_hero/reprocess',
      '/api/editor/projects/project_demo/assets/asset_hero/reprocess/job_preview/accept',
    ]) {
      const result = await fetchJson(unavailable.baseUrl, pathname, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
      assert.equal(result.status, 503)
      assert.equal(result.json.error, 'reprocess_unavailable')
    }
  })

  await t.test('controlled coordinator errors keep their literal HTTP mappings', async (t) => {
    const root = await tempRoot()
    const errors = new Map([
      ['bad', new editorProject.CharacterReprocessError('invalid_managed_source', 'bad source')],
      ['missing', new editorProject.CharacterReprocessError('job_not_found', 'missing')],
      ['conflict', new editorProject.CharacterReprocessError('preview_stale', 'stale')],
      ['quality', new editorProject.CharacterReprocessError('quality_blocked', 'blocked')],
    ])
    const coordinator = Object.freeze({
      async submitCharacterReprocessPreview({ body }) {
        throw errors.get(body.case)
      },
      async acceptCharacterReprocessPreview() {
        throw new editorProject.CharacterReprocessError('warning_confirmation_required', 'confirm')
      },
    })
    const fakeService = Object.freeze({ enqueue() {}, getJob() { return null } })
    const { server, baseUrl } = await startEditorApi(root, {
      characterReprocessCoordinator: coordinator,
      reprocessService: fakeService,
    })
    t.after(() => server.close())
    for (const [caseName, status] of [['bad', 400], ['missing', 404], ['conflict', 409], ['quality', 422]]) {
      const response = await fetchJson(
        baseUrl,
        '/api/editor/projects/project_demo/assets/asset_hero/reprocess',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ case: caseName }),
        },
      )
      assert.equal(response.status, status)
    }
    const warning = await fetchJson(
      baseUrl,
      '/api/editor/projects/project_demo/assets/asset_hero/reprocess/job_preview/accept',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
    )
    assert.equal(warning.status, 422)
  })
})

test('specialized Accept imports the exact passing job as one immutable child revision', async () => {
  const root = await tempRoot()
  const fixture = await createManagedCharacterProject(root)
  const completed = await writeCompletedReprocessJob(root, fixture)
  const projectPath = path.join(root, 'workspace', 'projects', 'project_demo', 'project.json')
  const parentBefore = await readFile(path.join(fixture.revisionDir, 'source.png'))
  const jobBefore = new Map()
  for (const entry of completed.manifest) {
    jobBefore.set(entry.file_name, await readFile(path.join(completed.jobDir, entry.file_name)))
  }

  const result = await coordinatorFor(root, serviceForJobs([completed.job]))
    .acceptCharacterReprocessPreview({
      projectId: 'project_demo',
      assetId: 'asset_hero',
      jobId: completed.job.id,
      body: acceptBody(completed.job),
    })

  assert.equal(result.accepted, true)
  assert.equal(result.project.revision, 2)
  assert.equal(result.asset.active_revision_id, 'rev_002')
  assert.equal(result.revision.id, 'rev_002')
  assert.equal(result.revision.parent_revision_id, 'rev_001')
  assert.equal(result.revision.source_job_id, completed.job.id)
  assert.equal(result.revision.quality_status, 'pass')
  assert.equal(result.revision.production_status, 'ready')
  assert.equal(result.revision.processing_recipe_ref, result.revision.artifacts.processing_recipe)
  assert.equal(result.revision.artifacts.reprocess_context.endsWith('/editor_reprocess_context.json'), true)
  assert.deepEqual(
    JSON.parse(await readFile(path.join(root, result.revision.processing_recipe_ref), 'utf8')),
    completed.canonicalRecipe,
  )
  assert.deepEqual(
    JSON.parse(await readFile(path.join(root, result.revision.artifacts.reprocess_context), 'utf8')),
    completed.context,
  )
  assert.deepEqual(await readFile(path.join(fixture.revisionDir, 'source.png')), parentBefore)
  for (const [fileName, content] of jobBefore) {
    assert.deepEqual(await readFile(path.join(completed.jobDir, fileName)), content)
  }
  assert.equal(JSON.parse(await readFile(projectPath, 'utf8')).revision, 2)
})

test('dual matte Preview to Accept to reload to Preview preserves exact managed matte authority', async () => {
  const root = await tempRoot()
  const fixture = await createManagedCharacterProject(root, {
    includeBlackMatte: true,
    parentRecipe: managedParentRecipe({ blackMatteRef: managedRef('black.png') }),
  })
  const firstCapture = createCapturingReprocessService({ jobId: 'job_preview_round_one' })
  const firstPreview = await coordinatorFor(root, firstCapture.service)
    .submitCharacterReprocessPreview({
      projectId: 'project_demo',
      assetId: 'asset_hero',
      body: previewBody(recipeForManagedFixture(fixture)),
    })
  assert.deepEqual(firstCapture.calls[0].blackSourceBuffer, fixture.blackBuffer)

  const completed = await writeCompletedReprocessJob(root, fixture, {
    jobId: firstPreview.id,
    blackMatte: true,
  })
  assert.equal(completed.recipeHash, firstPreview.recipe_hash)
  const accepted = await coordinatorFor(root, serviceForJobs([completed.job]))
    .acceptCharacterReprocessPreview({
      projectId: 'project_demo',
      assetId: 'asset_hero',
      jobId: completed.job.id,
      body: acceptBody(completed.job),
    })
  assert.equal(accepted.revision.artifacts.black_matte.endsWith('/input_black_matte.png'), true)
  assert.deepEqual(
    await readFile(path.join(root, accepted.revision.artifacts.black_matte)),
    fixture.blackBuffer,
  )
  const acceptedRecipePath = path.join(root, accepted.revision.processing_recipe_ref)
  const acceptedRecipeBytes = await readFile(acceptedRecipePath)
  const acceptedRecipe = JSON.parse(acceptedRecipeBytes.toString('utf8'))
  assert.equal(acceptedRecipe.source.black_matte_artifact_ref, managedRef('black.png'))

  const reopenedDraft = editorProject.createRepairRecipeDraft({
    asset: accepted.asset,
    revision: accepted.revision,
    loadedRecipe: acceptedRecipe,
    sourceContext: {
      inputMode: 'managed_source',
      sourceLayout: 'topdown_rpg_v0',
      sourceLayoutKind: 'uniform_grid',
      sourceFileName: 'source.png',
      sourceSize: { width: 8, height: 8 },
      blackMatteArtifactRef: accepted.revision.artifacts.black_matte,
    },
  })
  const secondCapture = createCapturingReprocessService({ jobId: 'job_preview_round_two' })
  const secondPreview = await coordinatorFor(root, secondCapture.service)
    .submitCharacterReprocessPreview({
      projectId: 'project_demo',
      assetId: 'asset_hero',
      body: {
        expectedRevision: 2,
        expectedAssetRevisionId: accepted.revision.id,
        recipe: reopenedDraft.recipe,
      },
    })
  assert.equal(secondPreview.canonical_recipe.source.black_matte_artifact_ref, accepted.revision.artifacts.black_matte)
  assert.deepEqual(secondCapture.calls[0].blackSourceBuffer, fixture.blackBuffer)
  assert.equal(secondCapture.calls[0].reprocessContextBase.black_matte_artifact_sha256, sha256(fixture.blackBuffer))
  assert.deepEqual(await readFile(acceptedRecipePath), acceptedRecipeBytes)
})

test('Accept enforces exact job, context, full hash, status, and quality policy without project mutation', async (t) => {
  await t.test('warning needs confirmation and imports review_required only after confirmation', async () => {
    const root = await tempRoot()
    const fixture = await createManagedCharacterProject(root)
    const completed = await writeCompletedReprocessJob(root, fixture, { quality: 'warning' })
    const coordinator = coordinatorFor(root, serviceForJobs([completed.job]))
    const projectPath = path.join(root, 'workspace', 'projects', 'project_demo', 'project.json')
    const before = await readFile(projectPath)
    await assert.rejects(
      coordinator.acceptCharacterReprocessPreview({
        projectId: 'project_demo',
        assetId: 'asset_hero',
        jobId: completed.job.id,
        body: acceptBody(completed.job),
      }),
      (error) => error?.code === 'warning_confirmation_required',
    )
    assert.deepEqual(await readFile(projectPath), before)
    const accepted = await coordinator.acceptCharacterReprocessPreview({
      projectId: 'project_demo',
      assetId: 'asset_hero',
      jobId: completed.job.id,
      body: acceptBody(completed.job, { warningConfirmed: true }),
    })
    assert.equal(accepted.revision.quality_status, 'warning')
    assert.equal(accepted.revision.production_status, 'review_required')
  })

  const cases = [
    ['quality fail', { quality: 'fail' }, {}, 'quality_blocked'],
    ['quality unknown', { quality: 'unknown' }, {}, 'quality_blocked'],
    ['job not done', { status: 'post_processing' }, {}, 'quality_blocked'],
    ['failed with complete artifacts', { status: 'failed_post_processing', quality: 'fail' }, {}, 'quality_blocked'],
    ['non reprocess job', {}, { jobMutate: (job) => ({ ...job, type: 'character_pack' }) }, 'job_not_found'],
    ['job identity mismatch', {}, { jobMutate: (job) => ({ ...job, asset_id: 'asset_other' }) }, 'identity_mismatch'],
    ['context job mismatch', {}, { contextMutate: (context) => ({ ...context, preview_job_id: 'job_other' }) }, 'preview_stale'],
    ['context extra key', {}, { contextMutate: (context) => ({ ...context, extra: true }) }, 'unexpected_request_field'],
  ]
  for (const [label, direct, indirect, expectedCode] of cases) {
    await t.test(label, async () => {
      const root = await tempRoot()
      const fixture = await createManagedCharacterProject(root)
      const completed = await writeCompletedReprocessJob(root, fixture, { ...direct, ...indirect })
      const projectPath = path.join(root, 'workspace', 'projects', 'project_demo', 'project.json')
      const before = await readFile(projectPath)
      await assert.rejects(
        coordinatorFor(root, serviceForJobs([completed.job])).acceptCharacterReprocessPreview({
          projectId: 'project_demo',
          assetId: 'asset_hero',
          jobId: completed.job.id,
          body: acceptBody(completed.job),
        }),
        (error) => error?.code === expectedCode,
      )
      assert.deepEqual(await readFile(projectPath), before)
    })
  }

  await t.test('draft settings hash has no acceptance authority', async () => {
    const root = await tempRoot()
    const fixture = await createManagedCharacterProject(root)
    const completed = await writeCompletedReprocessJob(root, fixture)
    const before = await readFile(path.join(root, 'workspace', 'projects', 'project_demo', 'project.json'))
    await assert.rejects(
      coordinatorFor(root, serviceForJobs([completed.job])).acceptCharacterReprocessPreview({
        projectId: 'project_demo',
        assetId: 'asset_hero',
        jobId: completed.job.id,
        body: acceptBody(completed.job, { expectedRecipeHash: completed.settingsHash }),
      }),
      (error) => ['preview_stale', 'artifact_integrity_failed'].includes(error?.code),
    )
    assert.deepEqual(
      await readFile(path.join(root, 'workspace', 'projects', 'project_demo', 'project.json')),
      before,
    )
  })

  await t.test('invalid route job id is rejected before project mutation', async () => {
    const root = await tempRoot()
    const fixture = await createManagedCharacterProject(root)
    const completed = await writeCompletedReprocessJob(root, fixture)
    const projectPath = path.join(root, 'workspace', 'projects', 'project_demo', 'project.json')
    const before = await readFile(projectPath)
    await assert.rejects(
      coordinatorFor(root, serviceForJobs([completed.job])).acceptCharacterReprocessPreview({
        projectId: 'project_demo',
        assetId: 'asset_hero',
        jobId: '../job_preview',
        body: acceptBody(completed.job),
      }),
      (error) => error?.code === 'invalid_accept_request',
    )
    assert.deepEqual(await readFile(projectPath), before)
  })

  await t.test('intervening project save and active revision change are conflicts', async () => {
    const root = await tempRoot()
    const fixture = await createManagedCharacterProject(root)
    const completed = await writeCompletedReprocessJob(root, fixture)
    const renamed = structuredClone(fixture.project)
    renamed.name = 'Intervening Save'
    const saved = await editorProject.saveEditorProject({
      project: renamed,
      expectedRevision: 1,
      projectRoot: root,
      workspaceRoot: path.join(root, 'workspace'),
      now: new Date('2026-07-10T00:01:00.000Z'),
    })
    const projectPath = path.join(root, 'workspace', 'projects', 'project_demo', 'project.json')
    const afterSave = await readFile(projectPath)
    await assert.rejects(
      coordinatorFor(root, serviceForJobs([completed.job])).acceptCharacterReprocessPreview({
        projectId: 'project_demo',
        assetId: 'asset_hero',
        jobId: completed.job.id,
        body: acceptBody(completed.job, { expectedRevision: saved.project.revision }),
      }),
      (error) => error?.code === 'preview_stale',
    )
    assert.deepEqual(await readFile(projectPath), afterSave)

    const changed = structuredClone(saved.project)
    changed.assets.asset_hero.revisions.rev_002 = {
      ...structuredClone(changed.assets.asset_hero.revisions.rev_001),
      id: 'rev_002',
      parent_revision_id: 'rev_001',
      created_at: '2026-07-10T00:02:00.000Z',
    }
    changed.assets.asset_hero.active_revision_id = 'rev_002'
    const activeSaved = await editorProject.saveEditorProject({
      project: changed,
      expectedRevision: 2,
      projectRoot: root,
      workspaceRoot: path.join(root, 'workspace'),
      now: new Date('2026-07-10T00:02:00.000Z'),
    })
    const afterActive = await readFile(projectPath)
    await assert.rejects(
      coordinatorFor(root, serviceForJobs([completed.job])).acceptCharacterReprocessPreview({
        projectId: 'project_demo',
        assetId: 'asset_hero',
        jobId: completed.job.id,
        body: acceptBody(completed.job, { expectedRevision: activeSaved.project.revision }),
      }),
      (error) => error?.code === 'asset_revision_conflict',
    )
    assert.deepEqual(await readFile(projectPath), afterActive)
  })
})

test('Accept rejects sealed artifact/evidence tampering and changed parent input before copying', async (t) => {
  await t.test('post-completion Recipe and context evidence mutations are each rejected', async () => {
    for (const [key, fileName] of [
      ['processing_recipe', 'processing_recipe.json'],
      ['reprocess_context', 'editor_reprocess_context.json'],
    ]) {
      const root = await tempRoot()
      const fixture = await createManagedCharacterProject(root)
      const completed = await writeCompletedReprocessJob(root, fixture, {
        jobId: `job_tamper_${key}`,
      })
      await writeFile(path.join(completed.jobDir, fileName), Buffer.from('{"tampered":true}'))
      await assert.rejects(
        coordinatorFor(root, serviceForJobs([completed.job])).acceptCharacterReprocessPreview({
          projectId: 'project_demo',
          assetId: 'asset_hero',
          jobId: completed.job.id,
          body: acceptBody(completed.job),
        }),
        (error) => error?.code === 'artifact_integrity_failed',
      )
    }
  })

  await t.test('source artifact changed before capture fails its sealed digest', async () => {
    const root = await tempRoot()
    const fixture = await createManagedCharacterProject(root)
    const completed = await writeCompletedReprocessJob(root, fixture)
    await writeFile(path.join(completed.jobDir, 'source.png'), await tinyPng(101))
    const before = await readFile(path.join(root, 'workspace', 'projects', 'project_demo', 'project.json'))
    await assert.rejects(
      coordinatorFor(root, serviceForJobs([completed.job])).acceptCharacterReprocessPreview({
        projectId: 'project_demo',
        assetId: 'asset_hero',
        jobId: completed.job.id,
        body: acceptBody(completed.job),
      }),
      (error) => error?.code === 'artifact_integrity_failed',
    )
    assert.deepEqual(
      await readFile(path.join(root, 'workspace', 'projects', 'project_demo', 'project.json')),
      before,
    )
  })

  await t.test('source path changed after manifest capture cannot change copied bytes', async () => {
    const root = await tempRoot()
    const fixture = await createManagedCharacterProject(root)
    const completed = await writeCompletedReprocessJob(root, fixture)
    const sealedSource = Buffer.from(completed.files.source)
    const replacement = await tinyPng(103)
    const zipEntry = completed.job.artifact_integrity_manifest.find((entry) => entry.key === 'zip')
    const zipDigest = zipEntry.sha256
    let replaced = false
    Object.defineProperty(zipEntry, 'sha256', {
      enumerable: true,
      configurable: true,
      get() {
        if (!replaced) {
          replaced = true
          writeFileSync(path.join(completed.jobDir, 'source.png'), replacement)
        }
        return zipDigest
      },
    })
    const accepted = await coordinatorFor(root, serviceForJobs([completed.job]))
      .acceptCharacterReprocessPreview({
        projectId: 'project_demo',
        assetId: 'asset_hero',
        jobId: completed.job.id,
        body: acceptBody(completed.job),
      })
    assert.equal(replaced, true)
    assert.deepEqual(
      await readFile(path.join(root, accepted.revision.artifacts.source)),
      sealedSource,
    )
    assert.deepEqual(await readFile(path.join(completed.jobDir, 'source.png')), replacement)
  })

  await t.test('parent managed source changed after Preview makes the job stale', async () => {
    const root = await tempRoot()
    const fixture = await createManagedCharacterProject(root)
    const completed = await writeCompletedReprocessJob(root, fixture)
    await writeFile(path.join(fixture.revisionDir, 'source.png'), await tinyPng(102))
    const before = await readFile(path.join(root, 'workspace', 'projects', 'project_demo', 'project.json'))
    await assert.rejects(
      coordinatorFor(root, serviceForJobs([completed.job])).acceptCharacterReprocessPreview({
        projectId: 'project_demo',
        assetId: 'asset_hero',
        jobId: completed.job.id,
        body: acceptBody(completed.job),
      }),
      (error) => error?.code === 'identity_mismatch',
    )
    assert.deepEqual(
      await readFile(path.join(root, 'workspace', 'projects', 'project_demo', 'project.json')),
      before,
    )
  })

  await t.test('parent managed black matte changed after Preview makes the job stale', async () => {
    const root = await tempRoot()
    const fixture = await createManagedCharacterProject(root, { includeBlackMatte: true })
    const completed = await writeCompletedReprocessJob(root, fixture, { blackMatte: true })
    await writeFile(path.join(fixture.revisionDir, 'black.png'), await tinyPng(104))
    const before = await readFile(path.join(root, 'workspace', 'projects', 'project_demo', 'project.json'))
    await assert.rejects(
      coordinatorFor(root, serviceForJobs([completed.job])).acceptCharacterReprocessPreview({
        projectId: 'project_demo',
        assetId: 'asset_hero',
        jobId: completed.job.id,
        body: acceptBody(completed.job),
      }),
      (error) => error?.code === 'identity_mismatch',
    )
    assert.deepEqual(
      await readFile(path.join(root, 'workspace', 'projects', 'project_demo', 'project.json')),
      before,
    )
  })

  await t.test('sealed black matte bytes must equal the context and active parent digest', async () => {
    const root = await tempRoot()
    const fixture = await createManagedCharacterProject(root, { includeBlackMatte: true })
    const completed = await writeCompletedReprocessJob(root, fixture, { blackMatte: true })
    const forgedBlack = await tinyPng(105)
    await writeFile(path.join(completed.jobDir, 'input_black_matte.png'), forgedBlack)
    const blackEntry = completed.job.artifact_integrity_manifest.find((entry) => entry.key === 'black_matte')
    blackEntry.size = forgedBlack.byteLength
    blackEntry.sha256 = sha256(forgedBlack)
    await assert.rejects(
      coordinatorFor(root, serviceForJobs([completed.job])).acceptCharacterReprocessPreview({
        projectId: 'project_demo',
        assetId: 'asset_hero',
        jobId: completed.job.id,
        body: acceptBody(completed.job),
      }),
      (error) => error?.code === 'artifact_integrity_failed',
    )
  })

  await t.test('Recipe evidence that is sealed but noncanonical is rejected', async () => {
    const root = await tempRoot()
    const fixture = await createManagedCharacterProject(root)
    const completed = await writeCompletedReprocessJob(root, fixture, {
      recipeMutate: (recipe) => ({ ...recipe, locked_animations: ['walk_down', 'walk_down'] }),
    })
    await assert.rejects(
      coordinatorFor(root, serviceForJobs([completed.job])).acceptCharacterReprocessPreview({
        projectId: 'project_demo',
        assetId: 'asset_hero',
        jobId: completed.job.id,
        body: acceptBody(completed.job),
      }),
      (error) => ['noncanonical_recipe', 'artifact_integrity_failed'].includes(error?.code),
    )
  })

  await t.test('malformed pass/warning quality arrays cannot authorize acceptance', async () => {
    const root = await tempRoot()
    const fixture = await createManagedCharacterProject(root)
    const completed = await writeCompletedReprocessJob(root, fixture)
    const malformedReport = Buffer.from(JSON.stringify({
      validation: { status: 'pass', warnings: 'not-an-array', blocking_errors: [] },
    }))
    await writeFile(path.join(completed.jobDir, 'debug_report.json'), malformedReport)
    const reportEntry = completed.job.artifact_integrity_manifest.find((entry) => entry.key === 'debug_report')
    reportEntry.size = malformedReport.byteLength
    reportEntry.sha256 = sha256(malformedReport)
    await assert.rejects(
      coordinatorFor(root, serviceForJobs([completed.job])).acceptCharacterReprocessPreview({
        projectId: 'project_demo',
        assetId: 'asset_hero',
        jobId: completed.job.id,
        body: acceptBody(completed.job),
      }),
      (error) => error?.code === 'artifact_integrity_failed',
    )
  })

  await t.test('pass quality with warnings is contradictory evidence', async () => {
    const root = await tempRoot()
    const fixture = await createManagedCharacterProject(root)
    const completed = await writeCompletedReprocessJob(root, fixture)
    const contradictoryReport = Buffer.from(JSON.stringify({
      validation: { status: 'pass', warnings: ['unexpected_warning'], blocking_errors: [] },
    }))
    await writeFile(path.join(completed.jobDir, 'debug_report.json'), contradictoryReport)
    const reportEntry = completed.job.artifact_integrity_manifest.find((entry) => entry.key === 'debug_report')
    reportEntry.size = contradictoryReport.byteLength
    reportEntry.sha256 = sha256(contradictoryReport)
    await assert.rejects(
      coordinatorFor(root, serviceForJobs([completed.job])).acceptCharacterReprocessPreview({
        projectId: 'project_demo',
        assetId: 'asset_hero',
        jobId: completed.job.id,
        body: acceptBody(completed.job),
      }),
      (error) => error?.code === 'artifact_integrity_failed',
    )
  })

  await t.test('verified metadata must be a plain object with the exact job timestamp', async () => {
    const variants = [
      ['array metadata', Buffer.from(JSON.stringify([]))],
      ['invalid metadata timestamp', Buffer.from(JSON.stringify({
        id: 'hero',
        name: 'Hero server name',
        profile: 'topdown_rpg_v0',
        created_at: 'not-an-iso-timestamp',
      }))],
      ['mismatched metadata timestamp', Buffer.from(JSON.stringify({
        id: 'hero',
        name: 'Hero server name',
        profile: 'topdown_rpg_v0',
        created_at: '2026-07-10T00:00:01.000Z',
      }))],
    ]
    for (const [label, metadata] of variants) {
      const root = await tempRoot()
      const fixture = await createManagedCharacterProject(root)
      const completed = await writeCompletedReprocessJob(root, fixture, {
        jobId: `job_metadata_${label.replaceAll(' ', '_')}`,
      })
      await writeFile(path.join(completed.jobDir, 'metadata.json'), metadata)
      const metadataEntry = completed.job.artifact_integrity_manifest.find((entry) => entry.key === 'metadata')
      metadataEntry.size = metadata.byteLength
      metadataEntry.sha256 = sha256(metadata)
      const projectPath = path.join(root, 'workspace', 'projects', 'project_demo', 'project.json')
      const before = await readFile(projectPath)
      await assert.rejects(
        coordinatorFor(root, serviceForJobs([completed.job])).acceptCharacterReprocessPreview({
          projectId: 'project_demo',
          assetId: 'asset_hero',
          jobId: completed.job.id,
          body: acceptBody(completed.job),
        }),
        (error) => error?.code === 'artifact_integrity_failed',
      )
      assert.deepEqual(await readFile(projectPath), before)
    }
  })
})

test('concurrent accepts serialize to one winner without mixing job bytes', async () => {
  const root = await tempRoot()
  const fixture = await createManagedCharacterProject(root)
  const left = await writeCompletedReprocessJob(root, fixture, {
    jobId: 'job_preview_left',
    sentinel: 110,
    draftRecipeMutate: (recipe) => ({
      ...recipe,
      background: { ...recipe.background, tolerance: 21 },
    }),
  })
  const right = await writeCompletedReprocessJob(root, fixture, {
    jobId: 'job_preview_right',
    sentinel: 160,
    draftRecipeMutate: (recipe) => ({
      ...recipe,
      background: { ...recipe.background, tolerance: 22 },
    }),
  })
  const leftByKey = new Map(left.manifest.map((entry) => [entry.key, entry]))
  const rightByKey = new Map(right.manifest.map((entry) => [entry.key, entry]))
  assert.deepEqual([...leftByKey.keys()], [...rightByKey.keys()])
  for (const key of leftByKey.keys()) {
    assert.notEqual(leftByKey.get(key).sha256, rightByKey.get(key).sha256, `${key} must distinguish the two jobs`)
  }
  const parentHashes = new Map()
  for (const [key, artifactRef] of Object.entries(fixture.revision.artifacts)) {
    parentHashes.set(key, sha256(await readFile(path.join(root, artifactRef))))
  }
  const service = serviceForJobs([left.job, right.job])
  const coordinator = coordinatorFor(root, service)
  const submit = (completed) => coordinator.acceptCharacterReprocessPreview({
    projectId: 'project_demo',
    assetId: 'asset_hero',
    jobId: completed.job.id,
    body: acceptBody(completed.job),
  })
  const results = await Promise.allSettled([submit(left), submit(right)])
  assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1)
  assert.equal(results.filter((item) => item.status === 'rejected').length, 1)
  assert.equal(results.find((item) => item.status === 'rejected').reason.code, 'revision_conflict')
  const loaded = await editorProject.loadEditorProject({
    projectId: 'project_demo',
    projectRoot: root,
    workspaceRoot: path.join(root, 'workspace'),
  })
  assert.equal(loaded.project.revision, 2)
  const asset = loaded.project.assets.asset_hero
  assert.equal(Object.keys(asset.revisions).length, 2)
  const child = asset.revisions[asset.active_revision_id]
  const winning = child.source_job_id === left.job.id ? left : right
  const losing = winning === left ? right : left
  const losingByKey = new Map(losing.manifest.map((entry) => [entry.key, entry]))
  for (const winningEntry of winning.manifest) {
    const targetRef = child.artifacts[winningEntry.key]
    assert.equal(typeof targetRef, 'string', `managed target missing for ${winningEntry.key}`)
    const targetHash = sha256(await readFile(path.join(root, targetRef)))
    assert.equal(targetHash, winningEntry.sha256, `${winningEntry.key} must match the winner`)
    assert.notEqual(targetHash, losingByKey.get(winningEntry.key).sha256, `${winningEntry.key} must not match the loser`)
  }
  for (const completed of [left, right]) {
    for (const entry of completed.manifest) {
      assert.equal(
        sha256(await readFile(path.join(completed.jobDir, entry.file_name))),
        entry.sha256,
      )
    }
  }
  for (const [key, artifactRef] of Object.entries(fixture.revision.artifacts)) {
    assert.equal(sha256(await readFile(path.join(root, artifactRef))), parentHashes.get(key), `${key} parent evidence changed`)
  }
})

test('pre-copy verification and formal-save failures leave project JSON unchanged', async (t) => {
  await t.test('invalid verified metadata is rejected before copy', async () => {
    const root = await tempRoot()
    const fixture = await createManagedCharacterProject(root)
    const completed = await writeCompletedReprocessJob(root, fixture)
    const invalidMetadata = Buffer.from('{not-json')
    await writeFile(path.join(completed.jobDir, 'metadata.json'), invalidMetadata)
    const entry = completed.job.artifact_integrity_manifest.find((item) => item.key === 'metadata')
    entry.size = invalidMetadata.byteLength
    entry.sha256 = sha256(invalidMetadata)
    const projectPath = path.join(root, 'workspace', 'projects', 'project_demo', 'project.json')
    const before = await readFile(projectPath)
    await assert.rejects(
      coordinatorFor(root, serviceForJobs([completed.job])).acceptCharacterReprocessPreview({
        projectId: 'project_demo',
        assetId: 'asset_hero',
        jobId: completed.job.id,
        body: acceptBody(completed.job),
      }),
      (error) => error?.code === 'artifact_integrity_failed',
    )
    assert.deepEqual(await readFile(projectPath), before)
    await assert.rejects(
      readFile(path.join(root, 'workspace', 'projects', 'project_demo', 'assets', 'asset_hero', 'rev_002', 'metadata.json')),
      (error) => error?.code === 'ENOENT',
    )
  })

  await t.test('project save failure after verified copy', async () => {
    const root = await tempRoot()
    const fixture = await createManagedCharacterProject(root)
    const completed = await writeCompletedReprocessJob(root, fixture)
    const projectDir = path.join(root, 'workspace', 'projects', 'project_demo')
    const projectPath = path.join(projectDir, 'project.json')
    await mkdir(path.join(projectDir, 'project.backup.json'))
    const before = await readFile(projectPath)
    await assert.rejects(
      coordinatorFor(root, serviceForJobs([completed.job])).acceptCharacterReprocessPreview({
        projectId: 'project_demo',
        assetId: 'asset_hero',
        jobId: completed.job.id,
        body: acceptBody(completed.job),
      }),
    )
    assert.deepEqual(await readFile(projectPath), before)
    assert.deepEqual(
      await readFile(path.join(projectDir, 'assets', 'asset_hero', 'rev_002', 'source.png')),
      completed.files.source,
    )
  })
})
