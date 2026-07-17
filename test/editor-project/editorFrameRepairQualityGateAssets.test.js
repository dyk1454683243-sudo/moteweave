import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { renameSync, symlinkSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { encodeRgbaPng } from '../../src/character-pack/imageCodec.js'
import {
  buildAnimationsJson,
  buildEditorMetadataJson,
  buildMetadataJson,
} from '../../src/character-pack/packageBuilder.js'
import { TOPDOWN_RPG_V0 } from '../../src/character-pack/profile.js'
import {
  captureManagedCharacterRevisionForQualityGate,
  createAssetRef,
  createAssetRevision,
  createDefaultCharacterProcessingRecipe,
  createDefaultEditorProject,
  createVerifiedCharacterRevisionCaptureForQualityGate,
  hashFrameRepairQualityGateValue,
  importCapturedCharacterRevisionForQualityGate,
  QUALITY_GATE_CHARACTER_ARTIFACT_KEYS,
  validateEditorProject,
} from '../../src/editor-project/index.js'

const SHEET_LIMIT = 32 * 1024 * 1024
const JSON_LIMIT = 4 * 1024 * 1024
const FILE_NAMES = Object.freeze({
  sheet: 'normalized_sheet.png',
  animations: 'animations.json',
  metadata: 'metadata.json',
  editor_metadata: 'editor_metadata.json',
  debug_report: 'debug_report.json',
  processing_recipe: 'processing_recipe.json',
})

const VALID_SHEET_PNG = await (async () => {
  const data = new Uint8ClampedArray(768 * 768 * 4)
  for (let frame = 0; frame < 64; frame += 1) {
    const frameX = (frame % 8) * 96
    const frameY = Math.floor(frame / 8) * 96
    const offset = ((frameY + 80) * 768 + frameX + 48) * 4
    data[offset] = 24
    data[offset + 1] = 128
    data[offset + 2] = 112
    data[offset + 3] = 255
  }
  return encodeRgbaPng({ width: 768, height: 768, data })
})()

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function jsonBuffer(value) {
  return Buffer.from(JSON.stringify(value), 'utf8')
}

function deriveClips(animations) {
  return Object.fromEntries(Object.entries(animations.animations).map(([id, animation]) => [id, {
    id,
    source: 'animations.json',
    frames: [...animation.frames],
    fps: animation.fps,
    loop_mode: animation.mode,
    frame_size: { ...animations.frame_size },
    anchor: { ...animations.anchor },
  }]))
}

function createCharacterCaptureInput({
  qualityStatus = 'pass',
  productionStatus = qualityStatus === 'pass' ? 'ready' : 'review_required',
  withRecipe = false,
} = {}) {
  const animations = buildAnimationsJson(TOPDOWN_RPG_V0)
  const metadata = buildMetadataJson({
    id: 'source_hero',
    name: 'Source Hero',
    description: 'User-owned managed Character Pack fixture.',
    createdAt: '2026-07-12T00:00:00.000Z',
    source: { type: 'upload', input: null },
    generation: { provider: null, model: null, prompt_file: null },
    quality: {
      status: qualityStatus,
      warnings: qualityStatus === 'warning' ? ['review_required'] : [],
      blocking_errors: [],
    },
    profile: TOPDOWN_RPG_V0,
  })
  const editorMetadata = buildEditorMetadataJson({
    metadata,
    animationsJson: animations,
    profile: TOPDOWN_RPG_V0,
    frames: Array.from({ length: 64 }, (_, index) => ({
      index,
      normalized_anchor: { x: 48, y: 88 },
      normalized_bbox: { x: 47, y: 80, w: 2, h: 1, right: 48, bottom: 80, centerX: 47.5, centerY: 80 },
      source_meta: { source_layout: TOPDOWN_RPG_V0.id },
    })),
  })
  const debugReport = {
    profile: TOPDOWN_RPG_V0.id,
    validation: {
      status: qualityStatus,
      warnings: qualityStatus === 'warning' ? ['review_required'] : [],
      blocking_errors: [],
    },
  }
  const recipe = createDefaultCharacterProcessingRecipe({
    sourceJobId: 'job_source_hero',
    assetId: 'asset_source_hero',
    sourceLayout: TOPDOWN_RPG_V0.id,
  })
  const artifacts = {
    debug_report: jsonBuffer(debugReport),
    sheet: Buffer.from(VALID_SHEET_PNG),
    metadata: jsonBuffer(metadata),
    animations: jsonBuffer(animations),
    editor_metadata: jsonBuffer(editorMetadata),
    ...(withRecipe ? { processing_recipe: jsonBuffer(recipe) } : {}),
  }
  const revisionArtifacts = Object.fromEntries(QUALITY_GATE_CHARACTER_ARTIFACT_KEYS.map((key) => [
    key,
    `workspace/projects/project_source/assets/asset_source_hero/rev_003/${FILE_NAMES[key]}`,
  ]))
  if (withRecipe) revisionArtifacts.processing_recipe =
    'workspace/projects/project_source/assets/asset_source_hero/rev_003/processing_recipe.json'
  const revision = createAssetRevision({
    id: 'rev_003',
    sourceJobId: 'job_source_hero',
    createdAt: '2026-07-12T00:00:00.000Z',
    qualityStatus,
    productionStatus,
    artifacts: revisionArtifacts,
    processingRecipeRef: withRecipe ? revisionArtifacts.processing_recipe : null,
  })
  const asset = createAssetRef({
    id: 'asset_source_hero',
    kind: 'character_pack',
    name: 'Source Hero',
    profile: TOPDOWN_RPG_V0.id,
    revision,
    provenance: { source_type: 'upload', provider: null, model: null },
    clips: deriveClips(animations),
    tags: ['user-owned', 'quality-gate-source'],
  })
  return { asset, revision: asset.revisions.rev_003, artifacts }
}

function captureEntries(captured) {
  assert.ok(Array.isArray(captured.artifacts), 'capture must expose one ordered private artifact snapshot list')
  return captured.artifacts
}

function publicDigestEntries(captured) {
  return captureEntries(captured).map(({ key, size, sha256: digest }) => ({ key, size, sha256: digest }))
}

async function fixtureRoot(prefix = 'editor-qg-assets-') {
  return mkdtemp(path.join(os.tmpdir(), prefix))
}

async function writeManagedSourceFixture(root, options = {}) {
  const input = createCharacterCaptureInput(options)
  const project = createDefaultEditorProject({
    id: 'project_source',
    name: 'Source Project',
    revision: 12,
    createdAt: '2026-07-12T00:00:00.000Z',
    updatedAt: '2026-07-12T00:00:00.000Z',
  })
  project.assets[input.asset.id] = input.asset
  const revisionDir = path.join(root, 'workspace', 'projects', project.id, 'assets', input.asset.id, input.revision.id)
  await mkdir(revisionDir, { recursive: true })
  for (const [key, content] of Object.entries(input.artifacts)) {
    await writeFile(path.join(revisionDir, FILE_NAMES[key]), content)
  }
  return { ...input, project, revisionDir }
}

async function verifyTargetBytes(imported, root, captured) {
  const targetRevision = imported.revision
  const records = []
  for (const sourceRecord of publicDigestEntries(captured)) {
    const ref = sourceRecord.key === 'processing_recipe'
      ? targetRevision.processing_recipe_ref
      : targetRevision.artifacts[sourceRecord.key]
    const bytes = await readFile(path.resolve(root, ref))
    assert.equal(bytes.length, sourceRecord.size)
    assert.equal(sha256(bytes), sourceRecord.sha256)
    records.push({ key: sourceRecord.key, size: bytes.length, sha256: sha256(bytes) })
  }
  assert.equal(hashFrameRepairQualityGateValue(records), captured.source_sha256)
}

test('in-memory quality-gate capture seals exact ordered bytes, metadata, and canonical aggregate authority', async () => {
  for (const options of [
    { qualityStatus: 'pass', productionStatus: 'ready', withRecipe: false },
    { qualityStatus: 'warning', productionStatus: 'review_required', withRecipe: true },
  ]) {
    const input = createCharacterCaptureInput(options)
    const originalSheet = input.artifacts.sheet
    const captured = await createVerifiedCharacterRevisionCaptureForQualityGate(input)
    const entries = captureEntries(captured)
    const expectedKeys = [
      ...QUALITY_GATE_CHARACTER_ARTIFACT_KEYS,
      ...(options.withRecipe ? ['processing_recipe'] : []),
    ]

    assert.deepEqual(entries.map((entry) => entry.key), expectedKeys)
    assert.equal(Object.isFrozen(captured), true)
    assert.equal(Object.isFrozen(captured.asset), true)
    assert.equal(Object.isFrozen(captured.revision), true)
    assert.equal(Object.isFrozen(entries), true)
    assert.ok(entries.every(Object.isFrozen))
    assert.ok(entries.every((entry) => Buffer.isBuffer(entry.content)))
    assert.notStrictEqual(entries.find((entry) => entry.key === 'sheet').content, originalSheet)
    assert.deepEqual(captured.asset, {
      id: 'asset_source_hero',
      kind: 'character_pack',
      name: 'Source Hero',
      profile: TOPDOWN_RPG_V0.id,
      provenance: { source_type: 'upload', provider: null, model: null },
      clips: input.asset.clips,
      tags: ['user-owned', 'quality-gate-source'],
    })
    assert.deepEqual(captured.revision, {
      id: 'rev_003',
      source_job_id: 'job_source_hero',
      quality_status: options.qualityStatus,
      production_status: options.productionStatus,
      has_processing_recipe: options.withRecipe,
    })
    for (const entry of entries) {
      assert.equal(entry.size, entry.content.length)
      assert.equal(entry.sha256, sha256(entry.content))
    }
    assert.equal(
      captured.source_sha256,
      hashFrameRepairQualityGateValue(publicDigestEntries(captured)),
    )
    assert.doesNotMatch(JSON.stringify({ asset: captured.asset, revision: captured.revision }), /workspace\/projects|\/Users\//)
  }
})

test('in-memory quality-gate capture rejects non-authoritative packs, malformed evidence, profile drift, and inconsistent validation', async (t) => {
  const cases = [
    ['non-Character Pack', (input) => { input.asset.kind = 'scene_pack' }],
    ['missing controlled artifact', (input) => { delete input.artifacts.metadata }],
    ['extra artifact authority', (input) => { input.artifacts.preview = Buffer.from('extra') }],
    ['invalid quality/production pair', (input) => { input.revision.production_status = 'review_required' }],
    ['failed quality', (input) => {
      input.revision.quality_status = 'fail'
      input.revision.production_status = 'blocked'
    }],
    ['unknown quality', (input) => { input.revision.quality_status = 'unknown' }],
    ['malformed JSON', (input) => { input.artifacts.metadata = Buffer.from('{') }],
    ['fatal UTF-8 in otherwise parseable metadata JSON', (input) => {
      const metadata = Buffer.from(input.artifacts.metadata)
      const fieldText = Buffer.from('User-owned managed Character Pack fixture.', 'utf8')
      const fieldOffset = metadata.indexOf(fieldText)
      assert.notEqual(fieldOffset, -1)
      metadata[fieldOffset + 1] = 0xff
      assert.doesNotThrow(() => JSON.parse(metadata.toString('utf8')))
      input.artifacts.metadata = metadata
    }],
    ['profile mismatch', (input) => {
      const animations = JSON.parse(input.artifacts.animations.toString('utf8'))
      animations.profile = 'different_profile'
      input.artifacts.animations = jsonBuffer(animations)
    }],
    ['clip mismatch', (input) => { input.asset.clips.walk_down.frames = [0] }],
    ['validation-state mismatch', (input) => {
      const report = JSON.parse(input.artifacts.debug_report.toString('utf8'))
      report.validation.status = 'warning'
      input.artifacts.debug_report = jsonBuffer(report)
    }],
    ['contradictory top-level and nested debug status', (input) => {
      const report = JSON.parse(input.artifacts.debug_report.toString('utf8'))
      report.status = 'pass'
      report.validation.status = 'warning'
      input.artifacts.debug_report = jsonBuffer(report)
    }],
    ['missing debug validation record', (input) => {
      const report = JSON.parse(input.artifacts.debug_report.toString('utf8'))
      report.status = 'pass'
      report.blocking_errors = []
      delete report.validation
      input.artifacts.debug_report = jsonBuffer(report)
    }],
    ['non-record debug validation', (input) => {
      const report = JSON.parse(input.artifacts.debug_report.toString('utf8'))
      report.status = 'pass'
      report.blocking_errors = []
      report.validation = []
      input.artifacts.debug_report = jsonBuffer(report)
    }],
    ['debug validation contains a blocking error', (input) => {
      const report = JSON.parse(input.artifacts.debug_report.toString('utf8'))
      report.validation.blocking_errors = ['unexpected_blocker']
      input.artifacts.debug_report = jsonBuffer(report)
    }],
    ['corrupt PNG', (input) => { input.artifacts.sheet = Buffer.from('not a PNG') }],
    ['invalid sheet geometry', async (input) => {
      input.artifacts.sheet = await encodeRgbaPng({
        width: 2,
        height: 2,
        data: new Uint8ClampedArray(2 * 2 * 4),
      })
    }],
  ]

  for (const [name, mutate] of cases) {
    await t.test(name, async () => {
      const input = createCharacterCaptureInput()
      await mutate(input)
      await assert.rejects(async () => createVerifiedCharacterRevisionCaptureForQualityGate(input))
    })
  }
})

test('quality-gate capture enforces 32 MiB sheet and 4 MiB per-document ceilings before decode', async () => {
  const oversizedSheetInput = createCharacterCaptureInput()
  let oversizedSheet = Buffer.concat([
    VALID_SHEET_PNG,
    Buffer.alloc(SHEET_LIMIT + 1 - VALID_SHEET_PNG.length),
  ])
  oversizedSheetInput.artifacts.sheet = oversizedSheet
  await assert.rejects(async () => createVerifiedCharacterRevisionCaptureForQualityGate(oversizedSheetInput))
  oversizedSheet = null

  const oversizedJsonInput = createCharacterCaptureInput()
  let oversizedJson = jsonBuffer({ padding: 'x'.repeat(JSON_LIMIT) })
  assert.ok(oversizedJson.length > JSON_LIMIT)
  oversizedJsonInput.artifacts.metadata = oversizedJson
  await assert.rejects(async () => createVerifiedCharacterRevisionCaptureForQualityGate(oversizedJsonInput))
  oversizedJson = null
})

test('managed quality-gate capture reads only the exact active revision and snapshots later source-file mutation', async () => {
  const root = await fixtureRoot()
  const fixture = await writeManagedSourceFixture(root, { withRecipe: true })
  const captured = await captureManagedCharacterRevisionForQualityGate({
    project: fixture.project,
    assetId: fixture.asset.id,
    expectedAssetRevisionId: fixture.revision.id,
    projectRoot: root,
    workspaceRoot: path.join(root, 'workspace'),
  })
  const sealedSheet = Buffer.from(captureEntries(captured).find((entry) => entry.key === 'sheet').content)

  await writeFile(path.join(fixture.revisionDir, FILE_NAMES.sheet), Buffer.from('mutated after capture'))
  assert.deepEqual(captureEntries(captured).find((entry) => entry.key === 'sheet').content, sealedSheet)
  assert.deepEqual(captureEntries(captured).map((entry) => entry.key), [
    ...QUALITY_GATE_CHARACTER_ARTIFACT_KEYS,
    'processing_recipe',
  ])
})

test('managed quality-gate capture accepts known standard-import artifacts but snapshots only gate authority', async () => {
  const root = await fixtureRoot()
  const fixture = await writeManagedSourceFixture(root)
  const revisionPrefix =
    `workspace/projects/${fixture.project.id}/assets/${fixture.asset.id}/${fixture.revision.id}`
  const importedArtifacts = {
    source: `${revisionPrefix}/source.png`,
    row_gif_walk_down: `${revisionPrefix}/walk_down.gif`,
    inspection_gif_walk_down: `${revisionPrefix}/inspection_gifs/walk_down.gif`,
    inspection_strip_walk_down: `${revisionPrefix}/inspection_strips/walk_down.png`,
  }
  Object.assign(fixture.revision.artifacts, importedArtifacts)
  await mkdir(path.join(fixture.revisionDir, 'inspection_gifs'), { recursive: true })
  await mkdir(path.join(fixture.revisionDir, 'inspection_strips'), { recursive: true })
  await writeFile(path.join(fixture.revisionDir, 'source.png'), Buffer.from(VALID_SHEET_PNG))
  await writeFile(path.join(fixture.revisionDir, 'walk_down.gif'), Buffer.from('GIF89a-row'))
  await writeFile(path.join(fixture.revisionDir, 'inspection_gifs', 'walk_down.gif'), Buffer.from('GIF89a-inspection'))
  await writeFile(path.join(fixture.revisionDir, 'inspection_strips', 'walk_down.png'), Buffer.from(VALID_SHEET_PNG))

  const captured = await captureManagedCharacterRevisionForQualityGate({
    project: fixture.project,
    assetId: fixture.asset.id,
    expectedAssetRevisionId: fixture.revision.id,
    projectRoot: root,
    workspaceRoot: path.join(root, 'workspace'),
  })

  assert.deepEqual(captureEntries(captured).map((entry) => entry.key), [
    ...QUALITY_GATE_CHARACTER_ARTIFACT_KEYS,
  ])
  assert.equal(captured.revision.has_processing_recipe, false)
  assert.equal(captured.source_sha256, hashFrameRepairQualityGateValue(publicDigestEntries(captured)))
})

test('managed quality-gate capture rejects revision drift, traversal, symlinks, and missing or extra revision authority', async (t) => {
  await t.test('active revision drift', async () => {
    const root = await fixtureRoot()
    const fixture = await writeManagedSourceFixture(root)
    await assert.rejects(captureManagedCharacterRevisionForQualityGate({
      project: fixture.project,
      assetId: fixture.asset.id,
      expectedAssetRevisionId: 'rev_002',
      projectRoot: root,
      workspaceRoot: path.join(root, 'workspace'),
    }))
  })

  await t.test('post-lstat sheet swap to an in-workspace symlink', async () => {
    const root = await fixtureRoot()
    const fixture = await writeManagedSourceFixture(root)
    const authorizedSheet = path.join(fixture.revisionDir, FILE_NAMES.sheet)
    const backupSheet = path.join(fixture.revisionDir, 'authorized_sheet_backup.png')
    const alternateSheet = path.join(fixture.revisionDir, 'alternate_valid_sheet.png')
    await writeFile(alternateSheet, Buffer.from(VALID_SHEET_PNG))
    assert.equal((await readFile(alternateSheet)).length, (await readFile(authorizedSheet)).length)

    let swapRan = false
    let swapError = null
    process.nextTick(() => {
      try {
        renameSync(authorizedSheet, backupSheet)
        symlinkSync(alternateSheet, authorizedSheet)
        swapRan = true
      } catch (error) {
        swapError = error
      }
    })

    let captureError = null
    try {
      await captureManagedCharacterRevisionForQualityGate({
        project: fixture.project,
        assetId: fixture.asset.id,
        expectedAssetRevisionId: fixture.revision.id,
        projectRoot: root,
        workspaceRoot: path.join(root, 'workspace'),
      })
    } catch (error) {
      captureError = error
    }
    if (swapError) throw swapError
    assert.equal(swapRan, true)
    assert.ok(captureError, 'capture must reject an authorized path whose identity changed after lstat')
    assert.ok(
      ['unsafe_artifact_path', 'artifact_integrity_failed'].includes(captureError.code),
      `expected one controlled path/integrity code, received ${captureError.code ?? '(none)'}`,
    )
  })

  await t.test('traversal ref', async () => {
    const root = await fixtureRoot()
    const fixture = await writeManagedSourceFixture(root)
    fixture.revision.artifacts.sheet = '../outside.png'
    await assert.rejects(captureManagedCharacterRevisionForQualityGate({
      project: fixture.project,
      assetId: fixture.asset.id,
      expectedAssetRevisionId: fixture.revision.id,
      projectRoot: root,
      workspaceRoot: path.join(root, 'workspace'),
    }))
  })

  await t.test('symlinked managed file', async () => {
    const root = await fixtureRoot()
    const fixture = await writeManagedSourceFixture(root)
    const alternateRef = `workspace/projects/${fixture.project.id}/assets/${fixture.asset.id}/${fixture.revision.id}/linked_sheet.png`
    const outside = path.join(root, 'outside-sheet.png')
    await writeFile(outside, VALID_SHEET_PNG)
    await symlink(outside, path.resolve(root, alternateRef))
    fixture.revision.artifacts.sheet = alternateRef
    await assert.rejects(captureManagedCharacterRevisionForQualityGate({
      project: fixture.project,
      assetId: fixture.asset.id,
      expectedAssetRevisionId: fixture.revision.id,
      projectRoot: root,
      workspaceRoot: path.join(root, 'workspace'),
    }))
  })

  await t.test('symlinked managed ancestor that stays inside the revision directory', async () => {
    const root = await fixtureRoot()
    const fixture = await writeManagedSourceFixture(root)
    const realArtifactsDir = path.join(fixture.revisionDir, 'real_artifacts')
    const linkedArtifactsDir = path.join(fixture.revisionDir, 'linked_artifacts')
    await mkdir(realArtifactsDir)
    for (const key of QUALITY_GATE_CHARACTER_ARTIFACT_KEYS) {
      await writeFile(
        path.join(realArtifactsDir, FILE_NAMES[key]),
        fixture.artifacts[key],
      )
      fixture.revision.artifacts[key] =
        `workspace/projects/${fixture.project.id}/assets/${fixture.asset.id}/${fixture.revision.id}/linked_artifacts/${FILE_NAMES[key]}`
    }
    await symlink(realArtifactsDir, linkedArtifactsDir)

    await assert.rejects(
      captureManagedCharacterRevisionForQualityGate({
        project: fixture.project,
        assetId: fixture.asset.id,
        expectedAssetRevisionId: fixture.revision.id,
        projectRoot: root,
        workspaceRoot: path.join(root, 'workspace'),
      }),
      (error) => ['unsafe_artifact_path', 'artifact_integrity_failed'].includes(error?.code),
    )
  })

  for (const [name, mutate] of [
    ['missing authority', (revision) => { delete revision.artifacts.metadata }],
    ['extra authority', (revision) => { revision.artifacts.preview = revision.artifacts.sheet }],
    ['mismatched Recipe authority', (revision) => {
      revision.processing_recipe_ref = revision.artifacts.sheet
    }],
  ]) {
    await t.test(name, async () => {
      const root = await fixtureRoot()
      const fixture = await writeManagedSourceFixture(root)
      mutate(fixture.revision)
      await assert.rejects(captureManagedCharacterRevisionForQualityGate({
        project: fixture.project,
        assetId: fixture.asset.id,
        expectedAssetRevisionId: fixture.revision.id,
        projectRoot: root,
        workspaceRoot: path.join(root, 'workspace'),
      }))
    })
  }
})

test('quality-gate import creates one immutable rev_001 copy, preserves lineage, and excludes source paths', async () => {
  const root = await fixtureRoot('editor-qg-import-')
  await mkdir(path.join(root, 'workspace'), { recursive: true })
  const input = createCharacterCaptureInput({ qualityStatus: 'warning', productionStatus: 'review_required', withRecipe: true })
  const expectedSheet = Buffer.from(input.artifacts.sheet)
  const captured = await createVerifiedCharacterRevisionCaptureForQualityGate(input)
  input.artifacts.sheet.fill(0)

  const targetProject = createDefaultEditorProject({
    id: 'project_gate',
    name: 'Quality Gate',
    revision: 1,
    createdAt: '2026-07-12T01:00:00.000Z',
    updatedAt: '2026-07-12T01:00:00.000Z',
  })
  const imported = await importCapturedCharacterRevisionForQualityGate({
    project: targetProject,
    targetAssetId: 'asset_qg_real_shape_01',
    captured,
    projectRoot: root,
    workspaceRoot: path.join(root, 'workspace'),
    now: new Date('2026-07-12T01:05:00.000Z'),
  })

  assert.equal(imported.asset.id, 'asset_qg_real_shape_01')
  assert.equal(imported.asset.active_revision_id, 'rev_001')
  assert.equal(imported.revision.id, 'rev_001')
  assert.equal(imported.revision.parent_revision_id, null)
  assert.equal(imported.revision.source_job_id, 'job_source_hero')
  assert.equal(imported.revision.quality_status, 'warning')
  assert.equal(imported.revision.production_status, 'review_required')
  assert.equal(imported.asset.profile, TOPDOWN_RPG_V0.id)
  assert.deepEqual(imported.asset.clips, input.asset.clips)
  assert.deepEqual(imported.asset.provenance, input.asset.provenance)
  assert.deepEqual(imported.asset.tags, input.asset.tags)
  assert.equal(imported.revision.processing_recipe_ref, imported.revision.artifacts.processing_recipe)
  assert.equal(validateEditorProject(imported.project).blocking_errors.length, 0)
  assert.deepEqual(
    await readFile(path.resolve(root, imported.revision.artifacts.sheet)),
    expectedSheet,
  )
  await verifyTargetBytes(imported, root, captured)

  const serialized = JSON.stringify(imported)
  assert.doesNotMatch(serialized, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.doesNotMatch(serialized, /workspace\/projects\/project_source\/assets\//)
  assert.ok(Object.values(imported.revision.artifacts).every((ref) =>
    ref.startsWith('workspace/projects/project_gate/assets/asset_qg_real_shape_01/rev_001/')))
})

test('quality-gate import uses captured file bytes after the managed source changes and rejects target collisions', async () => {
  const root = await fixtureRoot('editor-qg-import-source-')
  const fixture = await writeManagedSourceFixture(root)
  const captured = await captureManagedCharacterRevisionForQualityGate({
    project: fixture.project,
    assetId: fixture.asset.id,
    expectedAssetRevisionId: fixture.revision.id,
    projectRoot: root,
    workspaceRoot: path.join(root, 'workspace'),
  })
  await writeFile(path.join(fixture.revisionDir, FILE_NAMES.sheet), Buffer.from('changed source file'))

  const targetProject = createDefaultEditorProject({ id: 'project_gate', name: 'Quality Gate' })
  const imported = await importCapturedCharacterRevisionForQualityGate({
    project: targetProject,
    targetAssetId: 'asset_qg_real_detail_02',
    captured,
    projectRoot: root,
    workspaceRoot: path.join(root, 'workspace'),
  })
  await verifyTargetBytes(imported, root, captured)

  await assert.rejects(importCapturedCharacterRevisionForQualityGate({
    project: imported.project,
    targetAssetId: 'asset_qg_real_detail_02',
    captured,
    projectRoot: root,
    workspaceRoot: path.join(root, 'workspace'),
  }))
})
