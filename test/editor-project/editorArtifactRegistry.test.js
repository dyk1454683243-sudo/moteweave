import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { encodeRgbaPng } from '../../src/character-pack/imageCodec.js'
import {
  createDefaultCharacterProcessingRecipe,
  createDefaultEditorProject,
  createRepairRecipeDraft,
  importAcceptedCharacterReprocessAsAsset,
  importGeneratedJobAsAsset,
  QUALITY_GATE_CHARACTER_ARTIFACT_KEYS,
  validateEditorProject,
} from '../../src/editor-project/index.js'

const CHARACTER_REPROCESS_TEST_FILES = Object.freeze({
  source: 'source.png',
  source_layout_overlay: 'source_layout_overlay.png',
  source_quality_report: 'source_quality_report.json',
  sheet: 'normalized_sheet.png',
  debug_overlay: 'debug_overlay.png',
  onion_skin_overlay: 'onion_skin_overlay.png',
  animations: 'animations.json',
  metadata: 'metadata.json',
  editor_metadata: 'editor_metadata.json',
  debug_report: 'debug_report.json',
  inspection_index: 'inspection_index.json',
  inspection_sheet: 'inspection_sheet.png',
  prompt: 'prompt.txt',
  generation: 'generation.json',
  godot_npc_zip: 'godot_npc_pack.zip',
  rpgmaker_zip: 'rpgmaker_pack.zip',
  ocad_zip: 'ocad_pack.zip',
  zip: 'character_pack.zip',
  multi_resolution: 'multi_resolution.json',
  sheet_96: 'normalized_sheet_96.png',
  sheet_64: 'normalized_sheet_64.png',
  sheet_48: 'normalized_sheet_48.png',
  sheet_32: 'normalized_sheet_32.png',
  sheet_16: 'normalized_sheet_16.png',
  black_matte: 'input_black_matte.png',
  processing_recipe: 'processing_recipe.json',
  reprocess_context: 'editor_reprocess_context.json',
})

async function tempRoot() {
  return mkdtemp(path.join(os.tmpdir(), 'editor-artifact-registry-'))
}

async function tinyPng() {
  return encodeRgbaPng({
    width: 2,
    height: 2,
    data: new Uint8ClampedArray([
      20, 30, 40, 255, 30, 40, 50, 255,
      40, 50, 60, 255, 50, 60, 70, 255,
    ]),
  })
}

async function writeJson(filePath, value) {
  await writeFile(filePath, JSON.stringify(value, null, 2))
}

async function writeCharacterJob(root, jobId, { status = 'pass', sourceType = 'upload', provider = null } = {}) {
  const dir = path.join(root, 'generated', jobId)
  await mkdir(dir, { recursive: true })
  await mkdir(path.join(dir, 'inspection_gifs'), { recursive: true })
  await mkdir(path.join(dir, 'inspection_strips'), { recursive: true })
  await writeFile(path.join(dir, 'source.png'), await tinyPng())
  await writeFile(path.join(dir, 'normalized_sheet.png'), await tinyPng())
  await writeFile(path.join(dir, 'debug_overlay.png'), await tinyPng())
  await writeFile(path.join(dir, 'onion_skin_overlay.png'), await tinyPng())
  await writeFile(path.join(dir, 'inspection_sheet.png'), await tinyPng())
  await writeFile(path.join(dir, 'walk_down.gif'), Buffer.from('GIF89a'))
  await writeFile(path.join(dir, 'inspection_gifs', 'walk_down.gif'), Buffer.from('GIF89a'))
  await writeFile(path.join(dir, 'inspection_strips', 'walk_down.png'), await tinyPng())
  await writeJson(path.join(dir, 'animations.json'), {
    version: '0.1',
    profile: 'topdown_rpg_v0',
    sheet: 'normalized_sheet.png',
    frame_size: { w: 96, h: 96 },
    anchor: { x: 48, y: 88 },
    animations: {
      walk_down: { fps: 10, loop: true, mode: 'loop', frames: [16, 17, 18, 19] },
    },
  })
  await writeJson(path.join(dir, 'inspection_index.json'), {
    mode: 'inspection_preview_v1',
    actions: [
      {
        name: 'walk_down',
        file: 'inspection_gifs/walk_down.gif',
        strip_file: 'inspection_strips/walk_down.png',
        runtime_gif_file: 'walk_down.gif',
      },
    ],
  })
  await writeJson(path.join(dir, 'metadata.json'), {
    version: '0.1',
    id: 'hero',
    name: 'Hero',
    profile: 'topdown_rpg_v0',
    source: { type: sourceType },
    generation: { provider, model: provider ? 'mock-image-model' : null },
    quality: { status },
  })
  await writeJson(path.join(dir, 'editor_metadata.json'), { version: '0.1', frames: {} })
  await writeJson(path.join(dir, 'debug_report.json'), {
    validation: { status, warnings: status === 'warning' ? ['edge_pressure'] : [], blocking_errors: status === 'fail' ? ['frame_count_mismatch'] : [] },
  })
  return dir
}

async function writeCharacterReprocessJob(root, jobId, {
  parentJobId = 'job_hero_original',
  parentRevisionId = 'rev_001',
  assetId = 'asset_hero',
  sourceLayout = 'topdown_rpg_v0',
  status = 'pass',
  blackMatteArtifactRef = null,
} = {}) {
  const dir = await writeCharacterJob(root, jobId, { status, sourceType: 'derived_revision' })
  const png = await tinyPng()
  await writeFile(path.join(dir, 'source_layout_overlay.png'), png)
  await writeJson(path.join(dir, 'source_quality_report.json'), { status: 'pass' })
  await writeFile(path.join(dir, 'prompt.txt'), 'local repair only\n')
  await writeJson(path.join(dir, 'generation.json'), { mode: 'editor_character_reprocess' })
  await writeFile(path.join(dir, 'godot_npc_pack.zip'), Buffer.from('godot-pack'))
  await writeFile(path.join(dir, 'rpgmaker_pack.zip'), Buffer.from('rpgmaker-pack'))
  await writeFile(path.join(dir, 'ocad_pack.zip'), Buffer.from('ocad-pack'))
  await writeFile(path.join(dir, 'character_pack.zip'), Buffer.from('character-pack'))
  await writeJson(path.join(dir, 'multi_resolution.json'), {
    version: 'character_multi_resolution_v0',
    frame_sizes: [96, 64, 48, 32, 16],
  })
  for (const size of [96, 64, 48, 32, 16]) {
    await writeFile(path.join(dir, `normalized_sheet_${size}.png`), png)
  }
  if (blackMatteArtifactRef) await writeFile(path.join(dir, 'input_black_matte.png'), png)

  const recipe = createDefaultCharacterProcessingRecipe({
    sourceJobId: parentJobId,
    assetId,
    sourceLayout,
    blackMatteArtifactRef,
    createdFrom: blackMatteArtifactRef ? { background: { mode: 'dual_matte' } } : {},
  })
  recipe.implementation_revision = 'character-pack-recipe-v0'
  const context = {
    job_type: 'editor_character_reprocess',
    preview_job_id: jobId,
    project_id: 'project_demo',
    project_revision: 0,
    asset_id: assetId,
    parent_revision_id: parentRevisionId,
    input_mode: 'managed_source',
    managed_input_artifact_key: 'source',
    managed_input_artifact_ref: 'managed-source-ref',
    authoritative_source_layout: sourceLayout,
    recipe_hash: 'a'.repeat(64),
    draft_settings_hash: 'b'.repeat(64),
    implementation_revision: recipe.implementation_revision,
  }
  await writeJson(path.join(dir, 'processing_recipe.json'), recipe)
  await writeJson(path.join(dir, 'editor_reprocess_context.json'), context)
  return { dir, recipe, context }
}

async function captureReprocessManifest(dir, { includeBlackMatte = false } = {}) {
  const entries = []
  for (const [key, fileName] of Object.entries(CHARACTER_REPROCESS_TEST_FILES)) {
    if (key === 'black_matte' && !includeBlackMatte) continue
    if (!existsSync(path.join(dir, fileName))) continue
    const content = await readFile(path.join(dir, fileName))
    entries.push({
      key,
      content,
      size: content.byteLength,
      sha256: createHash('sha256').update(content).digest('hex'),
    })
  }
  return entries
}

function replaceCapturedJson(manifest, key, value) {
  const content = Buffer.from(JSON.stringify(value))
  return manifest.map((entry) => entry.key === key
    ? {
        ...entry,
        content,
        size: content.byteLength,
        sha256: createHash('sha256').update(content).digest('hex'),
      }
    : entry)
}

async function createParentCharacterProject(root, { withBlackMatte = false } = {}) {
  const project = createDefaultEditorProject({
    id: 'project_demo',
    name: 'Demo Project',
    createdAt: '2026-06-22T00:00:00.000Z',
    updatedAt: '2026-06-22T00:00:00.000Z',
  })
  await writeCharacterJob(root, 'job_hero_original')
  const imported = await importGeneratedJobAsAsset({
    project,
    kind: 'character_pack',
    jobId: 'job_hero_original',
    generatedDir: path.join(root, 'generated'),
    projectRoot: root,
    assetId: 'asset_hero',
    now: '2026-06-22T00:03:00.000Z',
  })
  if (withBlackMatte) {
    const revision = imported.project.assets.asset_hero.revisions.rev_001
    const relative = 'workspace/projects/project_demo/assets/asset_hero/rev_001/input_black_matte.png'
    await writeFile(path.join(root, relative), await tinyPng())
    revision.artifacts.black_matte = relative
  }
  return imported.project
}

function reprocessImportInput({ project, job, manifest, root, now = '2026-06-22T00:04:00.000Z' }) {
  return {
    project,
    assetId: 'asset_hero',
    jobId: job.context.preview_job_id,
    projectRoot: root,
    workspaceRoot: path.join(root, 'workspace'),
    verifiedContext: job.context,
    verifiedRecipe: job.recipe,
    verifiedArtifactManifest: manifest,
    now,
  }
}

async function writeSceneJob(root, jobId, { status = 'pass' } = {}) {
  const dir = path.join(root, 'generated', jobId)
  await mkdir(dir, { recursive: true })
  await writeJson(path.join(dir, 'scene.json'), {
    version: 'scene_pack_v0',
    id: 'forest_scene',
    name: 'Forest Scene',
    profile: 'topdown_tile_dual_grid_v0',
  })
  await writeJson(path.join(dir, 'tile_map.json'), { profile: 'topdown_tile_dual_grid_v0', width: 2, height: 2, tiles: [] })
  await writeJson(path.join(dir, 'tile_atlas.json'), { profile: 'topdown_tile_dual_grid_v0', tiles: [] })
  await writeJson(path.join(dir, 'quality_gate.json'), { status, warnings: [], blocking_errors: status === 'fail' ? ['tile.visual_seam_mismatch'] : [] })
  await writeFile(path.join(dir, 'tileset.png'), await tinyPng())
  return dir
}

test('quality-gate Character artifact authority exports one frozen exact-order key list', () => {
  assert.deepEqual(QUALITY_GATE_CHARACTER_ARTIFACT_KEYS, [
    'sheet',
    'animations',
    'metadata',
    'editor_metadata',
    'debug_report',
  ])
  assert.equal(Object.isFrozen(QUALITY_GATE_CHARACTER_ARTIFACT_KEYS), true)
  assert.throws(() => QUALITY_GATE_CHARACTER_ARTIFACT_KEYS.push('processing_recipe'), TypeError)
})

test('artifact registry imports explicit character job artifacts as immutable managed revisions', async () => {
  const root = await tempRoot()
  const project = createDefaultEditorProject({
    id: 'project_demo',
    name: 'Demo Project',
    createdAt: '2026-06-22T00:00:00.000Z',
    updatedAt: '2026-06-22T00:00:00.000Z',
  })
  await writeCharacterJob(root, 'job_hero')

  const imported = await importGeneratedJobAsAsset({
    project,
    kind: 'character_pack',
    jobId: 'job_hero',
    generatedDir: path.join(root, 'generated'),
    projectRoot: root,
    assetId: 'asset_hero',
    now: '2026-06-22T00:03:00.000Z',
  })

  const asset = imported.project.assets.asset_hero
  assert.equal(asset.kind, 'character_pack')
  assert.equal(asset.active_revision_id, 'rev_001')
  assert.equal(asset.revisions.rev_001.quality_status, 'pass')
  assert.equal(asset.revisions.rev_001.production_status, 'ready')
  assert.equal(asset.clips.walk_down.fps, 10)
  assert.equal(asset.revisions.rev_001.artifacts.sheet, 'workspace/projects/project_demo/assets/asset_hero/rev_001/normalized_sheet.png')
  assert.equal(asset.revisions.rev_001.artifacts.source, 'workspace/projects/project_demo/assets/asset_hero/rev_001/source.png')
  assert.equal(asset.revisions.rev_001.artifacts.debug_overlay, 'workspace/projects/project_demo/assets/asset_hero/rev_001/debug_overlay.png')
  assert.equal(asset.revisions.rev_001.artifacts.onion_skin_overlay, 'workspace/projects/project_demo/assets/asset_hero/rev_001/onion_skin_overlay.png')
  assert.equal(asset.revisions.rev_001.artifacts.inspection_strip_walk_down, 'workspace/projects/project_demo/assets/asset_hero/rev_001/inspection_strips/walk_down.png')
  assert.equal(asset.revisions.rev_001.artifacts.row_gif_walk_down, 'workspace/projects/project_demo/assets/asset_hero/rev_001/walk_down.gif')
  assert.equal(existsSync(path.join(root, asset.revisions.rev_001.artifacts.sheet)), true)
  assert.equal(existsSync(path.join(root, asset.revisions.rev_001.artifacts.inspection_strip_walk_down)), true)
  assert.equal(validateEditorProject(imported.project).status, 'pass')
})

test('artifact registry maps provider-style character source provenance to protocol values', async () => {
  const root = await tempRoot()
  const project = createDefaultEditorProject({
    id: 'project_demo',
    name: 'Demo Project',
    createdAt: '2026-06-22T00:00:00.000Z',
    updatedAt: '2026-06-22T00:00:00.000Z',
  })
  await writeCharacterJob(root, 'job_provider_hero', { sourceType: 't2i_production_sheet', provider: 'openrouter' })

  const imported = await importGeneratedJobAsAsset({
    project,
    kind: 'character_pack',
    jobId: 'job_provider_hero',
    generatedDir: path.join(root, 'generated'),
    projectRoot: root,
    assetId: 'asset_provider_hero',
  })

  assert.equal(imported.project.assets.asset_provider_hero.provenance.source_type, 'provider')
  assert.equal(validateEditorProject(imported.project).status, 'pass')
})

test('artifact registry imports repaired character jobs as new parented revisions', async () => {
  const root = await tempRoot()
  const project = createDefaultEditorProject({
    id: 'project_demo',
    name: 'Demo Project',
    createdAt: '2026-06-22T00:00:00.000Z',
    updatedAt: '2026-06-22T00:00:00.000Z',
  })
  await writeCharacterJob(root, 'job_hero_original')
  const first = await importGeneratedJobAsAsset({
    project,
    kind: 'character_pack',
    jobId: 'job_hero_original',
    generatedDir: path.join(root, 'generated'),
    projectRoot: root,
    assetId: 'asset_hero',
    now: '2026-06-22T00:03:00.000Z',
  })

  await writeCharacterJob(root, 'job_hero_repaired', { sourceType: 'provider_repair' })
  const repaired = await importGeneratedJobAsAsset({
    project: first.project,
    kind: 'character_pack',
    jobId: 'job_hero_repaired',
    generatedDir: path.join(root, 'generated'),
    projectRoot: root,
    assetId: 'asset_hero',
    now: '2026-06-22T00:04:00.000Z',
  })

  const asset = repaired.project.assets.asset_hero
  assert.equal(asset.active_revision_id, 'rev_002')
  assert.equal(asset.revisions.rev_002.parent_revision_id, 'rev_001')
  assert.equal(asset.revisions.rev_001.source_job_id, 'job_hero_original')
  assert.equal(asset.revisions.rev_002.source_job_id, 'job_hero_repaired')
  assert.equal(asset.revisions.rev_002.artifacts.sheet, 'workspace/projects/project_demo/assets/asset_hero/rev_002/normalized_sheet.png')
  assert.equal(existsSync(path.join(root, asset.revisions.rev_001.artifacts.sheet)), true)
  assert.equal(existsSync(path.join(root, asset.revisions.rev_002.artifacts.sheet)), true)
  assert.equal(validateEditorProject(repaired.project).status, 'pass')
})

test('artifact registry keeps failed scene jobs blocked and does not mutate generated sources', async () => {
  const root = await tempRoot()
  const project = createDefaultEditorProject({
    id: 'project_demo',
    name: 'Demo Project',
    createdAt: '2026-06-22T00:00:00.000Z',
    updatedAt: '2026-06-22T00:00:00.000Z',
  })
  const sourceDir = await writeSceneJob(root, 'scene_job_fail', { status: 'fail' })
  const before = await readFile(path.join(sourceDir, 'quality_gate.json'), 'utf8')

  const imported = await importGeneratedJobAsAsset({
    project,
    kind: 'scene_pack',
    jobId: 'scene_job_fail',
    generatedDir: path.join(root, 'generated'),
    projectRoot: root,
    assetId: 'asset_forest',
    now: '2026-06-22T00:03:00.000Z',
  })

  const revision = imported.project.assets.asset_forest.revisions.rev_001
  assert.equal(revision.quality_status, 'fail')
  assert.equal(revision.production_status, 'blocked')
  assert.equal(revision.artifacts.preview, 'workspace/projects/project_demo/assets/asset_forest/rev_001/tileset.png')
  assert.equal(await readFile(path.join(sourceDir, 'quality_gate.json'), 'utf8'), before)
  assert.equal(validateEditorProject(imported.project).status, 'pass')
})

test('artifact registry rejects missing required files and path traversal job ids', async () => {
  const root = await tempRoot()
  const project = createDefaultEditorProject({
    id: 'project_demo',
    name: 'Demo Project',
    createdAt: '2026-06-22T00:00:00.000Z',
    updatedAt: '2026-06-22T00:00:00.000Z',
  })
  await mkdir(path.join(root, 'generated', 'partial_job'), { recursive: true })

  await assert.rejects(
    importGeneratedJobAsAsset({
      project,
      kind: 'character_pack',
      jobId: '../bad',
      generatedDir: path.join(root, 'generated'),
      projectRoot: root,
    }),
    /generated job id is unsafe/
  )
  await assert.rejects(
    importGeneratedJobAsAsset({
      project,
      kind: 'character_pack',
      jobId: 'partial_job',
      generatedDir: path.join(root, 'generated'),
      projectRoot: root,
    }),
    /missing required character_pack artifacts/
  )
})

test('specialized reprocess import copies the captured known manifest into an immutable child revision', async () => {
  const root = await tempRoot()
  const project = await createParentCharacterProject(root)
  const job = await writeCharacterReprocessJob(root, 'job_hero_reprocess')
  const manifest = await captureReprocessManifest(job.dir)
  const sourceBefore = new Map(
    await Promise.all(manifest.map(async (entry) => [entry.key, await readFile(path.join(job.dir, CHARACTER_REPROCESS_TEST_FILES[entry.key]))]))
  )

  const imported = await importAcceptedCharacterReprocessAsAsset(
    reprocessImportInput({ project, job, manifest, root })
  )

  assert.equal(imported.revision.id, 'rev_002')
  assert.equal(imported.revision.parent_revision_id, 'rev_001')
  assert.equal(imported.revision.source_job_id, 'job_hero_reprocess')
  assert.equal(imported.revision.quality_status, 'pass')
  assert.equal(imported.revision.production_status, 'ready')
  assert.equal(imported.asset.active_revision_id, 'rev_002')
  assert.equal(imported.asset.clips.walk_down.fps, 10)
  assert.equal(project.assets.asset_hero.active_revision_id, 'rev_001')
  assert.equal(
    imported.revision.processing_recipe_ref,
    'workspace/projects/project_demo/assets/asset_hero/rev_002/processing_recipe.json'
  )
  assert.equal(imported.revision.artifacts.reprocess_context.endsWith('/editor_reprocess_context.json'), true)
  assert.equal(imported.revision.artifacts.multi_resolution.endsWith('/multi_resolution.json'), true)
  for (const size of [96, 64, 48, 32, 16]) {
    assert.equal(imported.revision.artifacts[`sheet_${size}`].endsWith(`/normalized_sheet_${size}.png`), true)
  }

  assert.deepEqual(Object.keys(imported.revision.artifacts).sort(), manifest.map((entry) => entry.key).sort())
  for (const entry of manifest) {
    const managedContent = await readFile(path.join(root, imported.revision.artifacts[entry.key]))
    assert.equal(managedContent.byteLength, entry.size)
    assert.equal(createHash('sha256').update(managedContent).digest('hex'), entry.sha256)
    assert.deepEqual(await readFile(path.join(job.dir, CHARACTER_REPROCESS_TEST_FILES[entry.key])), sourceBefore.get(entry.key))
  }
  assert.equal(validateEditorProject(imported.project).status, 'pass')
})

test('specialized reprocess import binds identity and rejects missing, stale, or cross-bound inputs', async () => {
  const root = await tempRoot()
  const project = await createParentCharacterProject(root)
  const job = await writeCharacterReprocessJob(root, 'job_hero_identity')
  const manifest = await captureReprocessManifest(job.dir)
  const input = reprocessImportInput({ project, job, manifest, root })

  await assert.rejects(
    importAcceptedCharacterReprocessAsAsset({ ...input, assetId: 'asset_missing' }),
    (error) => error?.code === 'asset_not_found'
  )
  await assert.rejects(
    importAcceptedCharacterReprocessAsAsset({
      ...input,
      verifiedContext: { ...job.context, parent_revision_id: 'rev_999' },
      verifiedArtifactManifest: replaceCapturedJson(
        manifest,
        'reprocess_context',
        { ...job.context, parent_revision_id: 'rev_999' }
      ),
    }),
    (error) => error?.code === 'asset_revision_conflict'
  )
  await assert.rejects(
    importAcceptedCharacterReprocessAsAsset({ ...input, jobId: 'job_wrong_preview' }),
    (error) => error?.code === 'asset_revision_conflict'
  )
  for (const sourcePatch of [
    { asset_id: 'asset_other' },
    { source_job_id: 'job_other_parent' },
    { source_layout: 'another_layout' },
  ]) {
    const changedRecipe = { ...job.recipe, source: { ...job.recipe.source, ...sourcePatch } }
    await assert.rejects(
      importAcceptedCharacterReprocessAsAsset({
        ...input,
        verifiedRecipe: changedRecipe,
        verifiedArtifactManifest: replaceCapturedJson(manifest, 'processing_recipe', changedRecipe),
      }),
      (error) => error?.code === 'identity_mismatch'
    )
  }
})

test('specialized reprocess import rejects corrupt captures before reservation and never reuses a pre-existing orphan directory', async () => {
  const root = await tempRoot()
  const project = await createParentCharacterProject(root)
  const job = await writeCharacterReprocessJob(root, 'job_hero_integrity')
  const manifest = await captureReprocessManifest(job.dir)
  const projectBefore = JSON.stringify(project)
  const sourceEntry = manifest.find((entry) => entry.key === 'source')
  const capturedSource = Buffer.from(sourceEntry.content)
  const mutatedSource = Buffer.from('source path changed after manifest capture')
  await writeFile(path.join(job.dir, 'source.png'), mutatedSource)

  const corruptManifest = manifest.map((entry, index) => index === manifest.length - 1
    ? { ...entry, content: Buffer.from('captured bytes do not match the sealed hash') }
    : entry)
  await assert.rejects(
    importAcceptedCharacterReprocessAsAsset(
      reprocessImportInput({ project, job, manifest: corruptManifest, root })
    ),
    (error) => error?.code === 'artifact_integrity_failed'
  )

  const orphanDir = path.join(root, 'workspace/projects/project_demo/assets/asset_hero/rev_002')
  assert.equal(existsSync(orphanDir), false)
  assert.equal(JSON.stringify(project), projectBefore)
  await mkdir(orphanDir)
  await writeFile(path.join(orphanDir, 'orphan-sentinel.txt'), 'do not replace')

  const imported = await importAcceptedCharacterReprocessAsAsset(
    reprocessImportInput({ project, job, manifest, root })
  )
  assert.equal(imported.revision.id, 'rev_003')
  assert.deepEqual(await readFile(path.join(root, imported.revision.artifacts.source)), capturedSource)
  assert.deepEqual(await readFile(path.join(job.dir, 'source.png')), mutatedSource)
  assert.equal(await readFile(path.join(orphanDir, 'orphan-sentinel.txt'), 'utf8'), 'do not replace')
  assert.equal(JSON.stringify(project), projectBefore)
})

test('specialized reprocess import rejects unknown and duplicate captured artifact targets without changing project state', async () => {
  const root = await tempRoot()
  const project = await createParentCharacterProject(root)
  const job = await writeCharacterReprocessJob(root, 'job_hero_no_replace')
  const manifest = await captureReprocessManifest(job.dir)
  const projectBefore = JSON.stringify(project)
  const unknown = {
    key: 'request_controlled_file',
    content: Buffer.from('untrusted'),
    size: 9,
    sha256: createHash('sha256').update('untrusted').digest('hex'),
  }

  await assert.rejects(
    importAcceptedCharacterReprocessAsAsset(
      reprocessImportInput({ project, job, manifest: [unknown], root })
    ),
    (error) => error?.code === 'artifact_integrity_failed'
  )
  await assert.rejects(
    importAcceptedCharacterReprocessAsAsset(
      reprocessImportInput({ project, job, manifest: [...manifest, { ...manifest[0] }], root })
    ),
    (error) => error?.code === 'artifact_integrity_failed'
  )
  assert.equal(JSON.stringify(project), projectBefore)
})

test('specialized reprocess import carries black matte authority only through the dedicated artifact key', async () => {
  const root = await tempRoot()
  const project = await createParentCharacterProject(root, { withBlackMatte: true })
  const parent = project.assets.asset_hero.revisions.rev_001
  const job = await writeCharacterReprocessJob(root, 'job_hero_black_matte', {
    blackMatteArtifactRef: parent.artifacts.black_matte,
  })
  const manifest = await captureReprocessManifest(job.dir, { includeBlackMatte: true })
  const imported = await importAcceptedCharacterReprocessAsAsset(
    reprocessImportInput({ project, job, manifest, root })
  )
  const child = imported.revision
  const copiedRecipe = JSON.parse(await readFile(path.join(root, child.processing_recipe_ref), 'utf8'))
  const sourceContextFor = (revision) => ({
    inputMode: 'managed_source',
    sourceFileName: 'source.png',
    sourceLayout: 'topdown_rpg_v0',
    sourceLayoutKind: 'uniform_grid',
    blackMatteArtifactRef: revision.artifacts.black_matte ?? null,
  })

  assert.equal(child.artifacts.black_matte.endsWith('/input_black_matte.png'), true)
  const rebound = createRepairRecipeDraft({
    asset: imported.asset,
    revision: child,
    loadedRecipe: copiedRecipe,
    sourceContext: sourceContextFor(child),
  })
  assert.equal(rebound.recipe.source.black_matte_artifact_ref, child.artifacts.black_matte)
  assert.equal(rebound.recipe.background.mode, 'dual_matte')

  const decoy = structuredClone(child)
  decoy.artifacts.unrelated_historical_file = decoy.artifacts.black_matte
  delete decoy.artifacts.black_matte
  const notRebound = createRepairRecipeDraft({
    asset: imported.asset,
    revision: decoy,
    loadedRecipe: copiedRecipe,
    sourceContext: sourceContextFor(decoy),
  })
  assert.equal(notRebound.recipe.source.black_matte_artifact_ref, null)
  assert.equal(notRebound.recipe.background.mode, 'auto')
  assert.ok(notRebound.diagnostics.includes('dual_matte_unavailable_for_input'))
})

test('general importer rejects the specialized marker, does not ignore malformed context, and preserves legacy imports', async () => {
  const root = await tempRoot()
  const project = createDefaultEditorProject({
    id: 'project_demo',
    name: 'Demo Project',
    createdAt: '2026-06-22T00:00:00.000Z',
    updatedAt: '2026-06-22T00:00:00.000Z',
  })
  await writeCharacterReprocessJob(root, 'job_specialized_only')
  await assert.rejects(
    importGeneratedJobAsAsset({
      project,
      kind: 'character_pack',
      jobId: 'job_specialized_only',
      generatedDir: path.join(root, 'generated'),
      projectRoot: root,
    }),
    (error) => error?.code === 'specialized_accept_required'
  )

  const frameRepair = await writeCharacterJob(root, 'job_frame_repair_specialized')
  await writeJson(path.join(frameRepair, 'editor_frame_repair_context.json'), {
    job_type: 'editor_character_frame_repair',
  })
  await assert.rejects(
    importGeneratedJobAsAsset({
      project,
      kind: 'character_pack',
      jobId: 'job_frame_repair_specialized',
      generatedDir: path.join(root, 'generated'),
      projectRoot: root,
    }),
    (error) => error?.code === 'specialized_accept_required',
  )

  const malformed = await writeCharacterJob(root, 'job_malformed_context')
  await writeFile(path.join(malformed, 'editor_reprocess_context.json'), '{not-json')
  await assert.rejects(
    importGeneratedJobAsAsset({
      project,
      kind: 'character_pack',
      jobId: 'job_malformed_context',
      generatedDir: path.join(root, 'generated'),
      projectRoot: root,
    }),
    (error) => error instanceof SyntaxError && error?.code !== 'artifact_not_found'
  )

  const malformedFrame = await writeCharacterJob(root, 'job_malformed_frame_context')
  await writeFile(path.join(malformedFrame, 'editor_frame_repair_context.json'), '{not-json')
  await assert.rejects(
    importGeneratedJobAsAsset({
      project,
      kind: 'character_pack',
      jobId: 'job_malformed_frame_context',
      generatedDir: path.join(root, 'generated'),
      projectRoot: root,
    }),
    (error) => error instanceof SyntaxError && error?.code !== 'artifact_not_found',
  )

  await writeCharacterJob(root, 'job_legacy_still_supported')
  const legacy = await importGeneratedJobAsAsset({
    project,
    kind: 'character_pack',
    jobId: 'job_legacy_still_supported',
    generatedDir: path.join(root, 'generated'),
    projectRoot: root,
    assetId: 'asset_legacy',
  })
  assert.equal(legacy.revision.source_job_id, 'job_legacy_still_supported')
  assert.equal(legacy.revision.processing_recipe_ref, null)
})

test('general importer resolves fixed and explicit preview inputs through generated-job containment', async () => {
  const root = await tempRoot()
  const project = createDefaultEditorProject({
    id: 'project_demo',
    name: 'Demo Project',
    createdAt: '2026-06-22T00:00:00.000Z',
    updatedAt: '2026-06-22T00:00:00.000Z',
  })
  const outside = path.join(root, 'outside.png')
  await writeFile(outside, await tinyPng())

  const fixedEscape = await writeCharacterJob(root, 'job_fixed_symlink_escape')
  await symlink(outside, path.join(fixedEscape, 'source_layout_overlay.png'))
  await assert.rejects(
    importGeneratedJobAsAsset({
      project,
      kind: 'character_pack',
      jobId: 'job_fixed_symlink_escape',
      generatedDir: path.join(root, 'generated'),
      projectRoot: root,
    }),
    (error) => error?.code === 'unsafe_artifact_path'
  )

  const previewEscape = await writeCharacterJob(root, 'job_preview_symlink_escape')
  await symlink(outside, path.join(previewEscape, 'inspection_gifs', 'escape.gif'))
  await writeJson(path.join(previewEscape, 'inspection_index.json'), {
    mode: 'inspection_preview_v1',
    actions: [{ name: 'escape', file: 'inspection_gifs/escape.gif', strip_file: 'inspection_strips/walk_down.png' }],
  })
  await assert.rejects(
    importGeneratedJobAsAsset({
      project,
      kind: 'character_pack',
      jobId: 'job_preview_symlink_escape',
      generatedDir: path.join(root, 'generated'),
      projectRoot: root,
    }),
    (error) => error?.code === 'unsafe_artifact_path'
  )

  const benign = await writeCharacterJob(root, 'job_benign_dot_prefix')
  await writeFile(path.join(benign, 'inspection_gifs', '..valid.gif'), Buffer.from('GIF89a'))
  await writeJson(path.join(benign, 'inspection_index.json'), {
    mode: 'inspection_preview_v1',
    actions: [{ name: 'dot_valid', file: 'inspection_gifs/..valid.gif', strip_file: 'inspection_strips/walk_down.png' }],
  })
  const imported = await importGeneratedJobAsAsset({
    project,
    kind: 'character_pack',
    jobId: 'job_benign_dot_prefix',
    generatedDir: path.join(root, 'generated'),
    projectRoot: root,
    assetId: 'asset_dot_prefix',
  })
  assert.equal(imported.revision.artifacts.inspection_gif_dot_valid.endsWith('/inspection_gifs/..valid.gif'), true)
})

test('specialized reprocess import rejects captured Recipe and context bytes that contradict verified evidence before reservation', async () => {
  const root = await tempRoot()
  const project = await createParentCharacterProject(root)
  const job = await writeCharacterReprocessJob(root, 'job_contradictory_evidence')
  const manifest = await captureReprocessManifest(job.dir)
  const contradictoryRecipe = {
    ...job.recipe,
    source: { ...job.recipe.source, asset_id: 'asset_attacker' },
  }
  const contradictoryContext = {
    ...job.context,
    job_type: 'legacy_character_import',
  }
  const contradictoryManifest = replaceCapturedJson(
    replaceCapturedJson(manifest, 'processing_recipe', contradictoryRecipe),
    'reprocess_context',
    contradictoryContext
  )
  const before = JSON.stringify(project)

  await assert.rejects(
    importAcceptedCharacterReprocessAsAsset(
      reprocessImportInput({ project, job, manifest: contradictoryManifest, root })
    ),
    (error) => error?.code === 'identity_mismatch' || error?.code === 'artifact_integrity_failed'
  )
  assert.equal(JSON.stringify(project), before)
  assert.equal(
    existsSync(path.join(root, 'workspace/projects/project_demo/assets/asset_hero/rev_002')),
    false
  )
})

test('specialized reprocess import snapshots adversarial manifest getters and captured bytes exactly once', async () => {
  const root = await tempRoot()
  const project = await createParentCharacterProject(root)
  const job = await writeCharacterReprocessJob(root, 'job_adversarial_manifest')
  const manifest = await captureReprocessManifest(job.dir)
  const sourceIndex = manifest.findIndex((entry) => entry.key === 'source')
  const source = manifest[sourceIndex]
  const attackerBytes = Buffer.from('mutable getter substituted bytes after validation')
  const attackerHash = createHash('sha256').update(attackerBytes).digest('hex')
  const reads = { key: 0, content: 0, size: 0, sha256: 0 }
  const adversarialSource = {
    get key() {
      reads.key += 1
      return reads.key <= 4 ? source.key : 'source_changed_after_validation'
    },
    get content() {
      reads.content += 1
      return reads.content <= 3 ? source.content : attackerBytes
    },
    get size() {
      reads.size += 1
      return reads.size <= 3 ? source.size : attackerBytes.byteLength
    },
    get sha256() {
      reads.sha256 += 1
      return reads.sha256 <= 3 ? source.sha256 : attackerHash
    },
  }
  const adversarialManifest = [...manifest]
  adversarialManifest[sourceIndex] = adversarialSource

  const imported = await importAcceptedCharacterReprocessAsAsset(
    reprocessImportInput({ project, job, manifest: adversarialManifest, root })
  )

  assert.deepEqual(reads, { key: 1, content: 1, size: 1, sha256: 1 })
  assert.deepEqual(await readFile(path.join(root, imported.revision.artifacts.source)), source.content)
})

test('specialized reprocess import requires the complete base integrity artifact set before reservation', async (t) => {
  for (const missingKey of ['source', 'source_layout_overlay', 'debug_overlay', 'onion_skin_overlay', 'zip']) {
    await t.test(`missing ${missingKey}`, async () => {
      const root = await tempRoot()
      const project = await createParentCharacterProject(root)
      const job = await writeCharacterReprocessJob(root, `job_missing_${missingKey}`)
      const manifest = (await captureReprocessManifest(job.dir)).filter((entry) => entry.key !== missingKey)
      const before = JSON.stringify(project)

      await assert.rejects(
        importAcceptedCharacterReprocessAsAsset(
          reprocessImportInput({ project, job, manifest, root })
        ),
        (error) => error?.code === 'artifact_integrity_failed'
      )
      assert.equal(JSON.stringify(project), before)
      assert.equal(
        existsSync(path.join(root, 'workspace/projects/project_demo/assets/asset_hero/rev_002')),
        false
      )
    })
  }
})

test('specialized reprocess import rejects managed symlink ancestors before creating external descendants', async () => {
  const seedRoot = await tempRoot()
  const project = await createParentCharacterProject(seedRoot)
  const job = await writeCharacterReprocessJob(seedRoot, 'job_managed_symlink_ancestor')
  const manifest = await captureReprocessManifest(job.dir)
  const root = await tempRoot()
  const workspace = path.join(root, 'workspace')
  const outside = path.join(root, 'outside-managed-target')
  await mkdir(workspace)
  await mkdir(outside)
  await symlink(outside, path.join(workspace, 'projects'))

  await assert.rejects(
    importAcceptedCharacterReprocessAsAsset(
      reprocessImportInput({ project, job, manifest, root })
    ),
    (error) => error?.code === 'unsafe_artifact_path'
  )
  assert.deepEqual(await readdir(outside), [])
})

test('specialized reprocess import accepts the configured workspace root as a symlink trust-anchor alias', async () => {
  const seedRoot = await tempRoot()
  const project = await createParentCharacterProject(seedRoot)
  const job = await writeCharacterReprocessJob(seedRoot, 'job_workspace_alias')
  const manifest = await captureReprocessManifest(job.dir)
  const root = await tempRoot()
  const realWorkspace = path.join(root, 'real-workspace')
  const workspaceAlias = path.join(root, 'workspace-alias')
  await mkdir(realWorkspace)
  await symlink(realWorkspace, workspaceAlias)

  const imported = await importAcceptedCharacterReprocessAsAsset({
    ...reprocessImportInput({ project, job, manifest, root }),
    workspaceRoot: workspaceAlias,
  })

  assert.equal(imported.revision.id, 'rev_002')
  assert.equal(imported.revision.artifacts.source.startsWith('workspace-alias/'), true)
  assert.equal(existsSync(path.join(realWorkspace, 'projects/project_demo/assets/asset_hero/rev_002/source.png')), true)
})
