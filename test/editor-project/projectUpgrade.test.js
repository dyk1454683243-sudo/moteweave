import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  createAssetRef,
  createAssetRevision,
  createEditorProject,
  encodeRgbaPng,
  deriveStableId,
  saveEditorProject,
  sha256Bytes,
  upgradeEditorProjectCopy,
} from '../../src/editor-project/index.js'

const now = '2026-09-18T00:00:00.000Z'
const operation = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

async function tempRoot() {
  return mkdtemp(path.join(os.tmpdir(), 'p2-02-upgrade-'))
}

test('copy-upgrade creates a new v1 id and leaves the v0 files and hashes unchanged', async () => {
  const root = await tempRoot()
  const created = await createEditorProject({
    id: 'project_v0_source',
    name: 'Legacy Source',
    projectRoot: root,
    now,
  })
  const png = encodeRgbaPng(2, 2, Buffer.from([9, 8, 7, 0, 1, 2, 3, 255, 4, 5, 6, 128, 7, 8, 9, 0]))
  const revisionDir = path.join(root, 'workspace', 'projects', 'project_v0_source', 'assets', 'asset_source', 'rev_001')
  await mkdir(revisionDir, { recursive: true })
  const sourceFile = path.join(revisionDir, 'image.png')
  await writeFile(sourceFile, png)
  const project = created.project
  project.assets.asset_source = createAssetRef({
    id: 'asset_source',
    kind: 'static_image',
    name: 'Legacy Image',
    revision: createAssetRevision({
      id: 'rev_001',
      createdAt: now,
      qualityStatus: 'pass',
      productionStatus: 'ready',
      artifacts: {
        image: 'workspace/projects/project_v0_source/assets/asset_source/rev_001/image.png',
      },
    }),
  })
  const saved = await saveEditorProject({
    project,
    projectRoot: root,
    expectedRevision: 1,
    now,
  })
  const beforeProject = await readFile(path.join(root, 'workspace', 'projects', 'project_v0_source', 'project.json'))
  const beforeAsset = await readFile(sourceFile)
  const beforeHashes = {
    project: sha256Bytes(beforeProject),
    asset: sha256Bytes(beforeAsset),
  }
  const upgraded = await upgradeEditorProjectCopy({
    sourceProjectId: 'project_v0_source',
    operationId: operation,
    expectedRevision: saved.project.revision,
    payload: { operation_id: operation, expected_revision: saved.project.revision, name: null },
    projectRoot: root,
    now,
  })
  assert.equal(upgraded.project.version, 'editor_project_v1')
  assert.notEqual(upgraded.project.id, 'project_v0_source')
  assert.deepEqual(upgraded.project.upgraded_from, {
    project_id: 'project_v0_source',
    revision: saved.project.revision,
  })
  assert.equal(
    upgraded.project.assets.asset_source.revisions.rev_001.artifacts.image,
    `workspace/projects/${upgraded.project.id}/assets/asset_source/rev_001/image.png`,
  )
  const afterProject = await readFile(path.join(root, 'workspace', 'projects', 'project_v0_source', 'project.json'))
  const afterAsset = await readFile(sourceFile)
  assert.equal(sha256Bytes(afterProject), beforeHashes.project)
  assert.equal(sha256Bytes(afterAsset), beforeHashes.asset)
  const copied = await readFile(path.join(
    root,
    'workspace',
    'projects',
    upgraded.project.id,
    'assets',
    'asset_source',
    'rev_001',
    'image.png',
  ))
  assert.equal(sha256Bytes(copied), beforeHashes.asset)
  const replayed = await upgradeEditorProjectCopy({
    sourceProjectId: 'project_v0_source',
    operationId: operation,
    expectedRevision: saved.project.revision,
    payload: { operation_id: operation, expected_revision: saved.project.revision, name: null },
    projectRoot: root,
    now,
  })
  assert.equal(replayed.replayed, true)
  assert.equal(replayed.project.id, upgraded.project.id)
})

test('upgrade recovers a committed same-op receipt even after the source revision changes', async () => {
  const root = await tempRoot()
  const created = await createEditorProject({
    id: 'project_v0_source',
    name: 'Legacy Source',
    projectRoot: root,
    now,
  })
  const png = encodeRgbaPng(2, 2, Buffer.from([9, 8, 7, 0, 1, 2, 3, 255, 4, 5, 6, 128, 7, 8, 9, 0]))
  const revisionDir = path.join(root, 'workspace', 'projects', 'project_v0_source', 'assets', 'asset_source', 'rev_001')
  await mkdir(revisionDir, { recursive: true })
  await writeFile(path.join(revisionDir, 'image.png'), png)
  created.project.assets.asset_source = createAssetRef({
    id: 'asset_source',
    kind: 'static_image',
    name: 'Legacy Image',
    revision: createAssetRevision({
      id: 'rev_001',
      createdAt: now,
      qualityStatus: 'pass',
      productionStatus: 'ready',
      artifacts: {
        image: 'workspace/projects/project_v0_source/assets/asset_source/rev_001/image.png',
      },
    }),
  })
  const saved = await saveEditorProject({
    project: created.project,
    projectRoot: root,
    expectedRevision: 1,
    now,
  })
  const payload = { operation_id: operation, expected_revision: saved.project.revision, name: null }
  await assert.rejects(
    upgradeEditorProjectCopy({
      sourceProjectId: 'project_v0_source',
      operationId: operation,
      expectedRevision: saved.project.revision,
      payload,
      projectRoot: root,
      now,
      fault: 'ack',
    }),
    (error) => error.code === 'storage_commit_failed' && error.details?.committed === true,
  )
  saved.project.name = 'Source Changed After Commit'
  const later = await saveEditorProject({
    project: saved.project,
    projectRoot: root,
    expectedRevision: saved.project.revision,
    now,
  })
  assert.notEqual(later.project.revision, saved.project.revision)
  const replayed = await upgradeEditorProjectCopy({
    sourceProjectId: 'project_v0_source',
    operationId: operation,
    expectedRevision: saved.project.revision,
    payload,
    projectRoot: root,
    now,
  })
  assert.equal(replayed.replayed, true)
  assert.equal(replayed.project.revision, 1)
  const [left, right] = await Promise.all([
    upgradeEditorProjectCopy({
      sourceProjectId: 'project_v0_source',
      operationId: operation,
      expectedRevision: saved.project.revision,
      payload,
      projectRoot: root,
      now,
    }),
    upgradeEditorProjectCopy({
      sourceProjectId: 'project_v0_source',
      operationId: operation,
      expectedRevision: saved.project.revision,
      payload,
      projectRoot: root,
      now,
    }),
  ])
  assert.equal(left.project.id, replayed.project.id)
  assert.equal(right.project.id, replayed.project.id)
  assert.equal(left.replayed && right.replayed, true)
})

test('upgrade refuses a target path that is a symlink or directory', async () => {
  const root = await tempRoot()
  const created = await createEditorProject({
    id: 'project_v0_source',
    name: 'Legacy Source',
    projectRoot: root,
    now,
  })
  const plantedOp = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  const targetId = deriveStableId('p', `upgrade-copy:project_v0_source:${plantedOp}`)
  const targetDir = path.join(root, 'workspace', 'projects', targetId)
  const outside = path.join(root, 'outside.json')
  await writeFile(outside, '{"version":"editor_project_v1"}\n')
  await mkdir(targetDir, { recursive: true })
  await symlink(outside, path.join(targetDir, 'project.json'))
  await assert.rejects(
    upgradeEditorProjectCopy({
      sourceProjectId: 'project_v0_source',
      operationId: plantedOp,
      expectedRevision: created.project.revision,
      payload: {
        operation_id: plantedOp,
        expected_revision: created.project.revision,
        name: null,
      },
      projectRoot: root,
      now,
    }),
    (error) => error.code === 'storage_commit_failed' && !String(error.message).includes(root),
  )
  const dirOp = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  const dirTarget = deriveStableId('p', `upgrade-copy:project_v0_source:${dirOp}`)
  await mkdir(path.join(root, 'workspace', 'projects', dirTarget, 'project.json'), { recursive: true })
  await assert.rejects(
    upgradeEditorProjectCopy({
      sourceProjectId: 'project_v0_source',
      operationId: dirOp,
      expectedRevision: created.project.revision,
      payload: {
        operation_id: dirOp,
        expected_revision: created.project.revision,
        name: null,
      },
      projectRoot: root,
      now,
    }),
    (error) => error.code === 'storage_commit_failed' && !String(error.message).includes('/'),
  )
})

test('upgrade index durability failure keeps the published receipt and finishes sync on replay', async () => {
  const root = await tempRoot()
  const created = await createEditorProject({
    id: 'project_v0_source',
    name: 'Legacy Source',
    projectRoot: root,
    now,
  })
  const payload = {
    operation_id: operation,
    expected_revision: created.project.revision,
    name: null,
  }
  const targetId = deriveStableId('p', `upgrade-copy:project_v0_source:${operation}`)
  await assert.rejects(
    upgradeEditorProjectCopy({
      sourceProjectId: 'project_v0_source',
      operationId: operation,
      expectedRevision: created.project.revision,
      payload,
      projectRoot: root,
      now,
      fault: 'index_sync',
    }),
    (error) => error.code === 'storage_commit_failed' && error.details?.committed === true,
  )
  assert.equal(existsSync(path.join(root, 'workspace', 'projects', targetId, 'project.json')), true)
  const recovered = await upgradeEditorProjectCopy({
    sourceProjectId: 'project_v0_source',
    operationId: operation,
    expectedRevision: created.project.revision,
    payload,
    projectRoot: root,
    now,
  })
  assert.equal(recovered.replayed, true)
  assert.equal(recovered.project.id, targetId)
})
