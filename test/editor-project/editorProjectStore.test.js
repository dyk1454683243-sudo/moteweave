import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  createAssetRef,
  createAssetRevision,
  createDefaultEditorProject,
  createEditorProject,
  createPreparedEditorProject,
  EditorProjectStoreError,
  loadEditorProject,
  mutateEditorProject,
  resolveEditorProjectPaths,
  saveEditorProject,
  serializeEditorProject,
  validateEditorProject,
  withEditorProjectMutationLock,
} from '../../src/editor-project/index.js'

const PREPARED_SOURCE_TIME = '2026-07-12T00:00:00.000Z'
const PREPARED_PUBLISH_TIME = '2026-07-12T00:05:00.000Z'
const PREPARED_ARTIFACTS = Object.freeze({
  sheet: Object.freeze({ file: 'normalized_sheet.png', bytes: Buffer.from('exact-sheet-bytes') }),
  animations: Object.freeze({ file: 'animations.json', bytes: Buffer.from('{"profile":"topdown_rpg_v0"}\n') }),
  metadata: Object.freeze({ file: 'metadata.json', bytes: Buffer.from('{"id":"prepared_hero"}\n') }),
  editor_metadata: Object.freeze({ file: 'editor_metadata.json', bytes: Buffer.from('{"frames":{}}\n') }),
  debug_report: Object.freeze({ file: 'debug_report.json', bytes: Buffer.from('{"validation":{"status":"pass"}}\n') }),
})

async function tempRoot() {
  return mkdtemp(path.join(os.tmpdir(), 'editor-project-store-'))
}

function preparedProject(id = 'project_prepared') {
  const project = createDefaultEditorProject({
    id,
    name: 'Prepared Project',
    createdAt: PREPARED_SOURCE_TIME,
    updatedAt: PREPARED_SOURCE_TIME,
  })
  assert.equal(validateEditorProject(project).status, 'pass')
  return project
}

function expectStoreCode(code) {
  return (error) => {
    assert.equal(error instanceof EditorProjectStoreError, true)
    assert.equal(error.code, code)
    return true
  }
}

function assertSanitizedPreparationError(error, { code, projectId, forbidden, original = null }) {
  assert.equal(error instanceof EditorProjectStoreError, true)
  assert.equal(error.code, code)
  assert.equal(error.message, 'editor project preparation failed')
  assert.deepEqual(error.details, { project_id: projectId })
  if (original) assert.notStrictEqual(error, original)
  assert.equal(Object.hasOwn(error, 'cause'), false)
  const serialized = JSON.stringify(error)
  assert.equal(serialized.includes('"stack"'), false)
  assert.equal(serialized.includes('"cause"'), false)
  for (const secret of forbidden) {
    assert.equal(error.message.includes(secret), false)
    assert.equal(String(error.stack).includes(secret), false)
    assert.equal(serialized.includes(secret), false)
  }
}

async function populatePreparedCharacter({ project, paths }) {
  const assetId = 'asset_prepared_hero'
  const revisionId = 'rev_001'
  const revisionDir = path.join(paths.assetsDir, assetId, revisionId)
  await mkdir(revisionDir, { recursive: true })
  for (const artifact of Object.values(PREPARED_ARTIFACTS)) {
    await writeFile(path.join(revisionDir, artifact.file), artifact.bytes)
  }
  const relativeRevisionDir = path.relative(paths.projectRoot, revisionDir).split(path.sep).join('/')
  const revision = createAssetRevision({
    id: revisionId,
    sourceJobId: 'job_prepared_hero',
    createdAt: PREPARED_PUBLISH_TIME,
    qualityStatus: 'pass',
    productionStatus: 'ready',
    artifacts: Object.fromEntries(Object.entries(PREPARED_ARTIFACTS).map(([key, artifact]) => (
      [key, `${relativeRevisionDir}/${artifact.file}`]
    ))),
  })
  project.assets[assetId] = createAssetRef({
    id: assetId,
    kind: 'character_pack',
    name: 'Prepared Hero',
    profile: 'topdown_rpg_v0',
    revision,
    provenance: { source_type: 'local_procedural', provider: null, model: null },
    clips: {
      walk_down: {
        id: 'walk_down',
        source: 'animations.json',
        frames: [16, 17, 18, 19],
        fps: 8,
        loop_mode: 'loop',
        frame_size: { w: 96, h: 96 },
        anchor: { x: 48, y: 88 },
      },
    },
  })
  return project
}

test('editor project store writes formal saves atomically with backup and revision checks', async () => {
  const root = await tempRoot()
  const now = '2026-06-22T00:00:00.000Z'
  const created = await createEditorProject({
    id: 'project_demo',
    name: 'Demo Project',
    projectRoot: root,
    now,
  })

  assert.equal(created.project.revision, 1)
  const paths = resolveEditorProjectPaths({ projectId: 'project_demo', projectRoot: root })
  const saved = JSON.parse(await readFile(paths.projectJson, 'utf8'))
  assert.equal(saved.revision, 1)

  const edited = {
    ...created.project,
    name: 'Renamed Project',
  }
  const second = await saveEditorProject({
    project: edited,
    projectRoot: root,
    expectedRevision: 1,
    now: '2026-06-22T00:01:00.000Z',
  })
  assert.equal(second.project.revision, 2)
  assert.equal(second.project.name, 'Renamed Project')

  const backup = JSON.parse(await readFile(paths.backupJson, 'utf8'))
  assert.equal(backup.revision, 1)

  await assert.rejects(
    saveEditorProject({
      project: second.project,
      projectRoot: root,
      expectedRevision: 1,
    }),
    /revision conflict/
  )
})

test('editor project store keeps autosave separate from formal project revision', async () => {
  const root = await tempRoot()
  const project = createDefaultEditorProject({
    id: 'project_demo',
    name: 'Demo Project',
    createdAt: '2026-06-22T00:00:00.000Z',
    updatedAt: '2026-06-22T00:00:00.000Z',
  })
  await saveEditorProject({ project, projectRoot: root })

  const autosaveProject = {
    ...project,
    name: 'Autosave Draft',
  }
  const autosave = await saveEditorProject({
    project: autosaveProject,
    projectRoot: root,
    autosave: true,
    now: '2026-06-22T00:02:00.000Z',
  })
  assert.equal(autosave.project.revision, 1)

  const formal = await loadEditorProject({ projectId: 'project_demo', projectRoot: root })
  const draft = await loadEditorProject({ projectId: 'project_demo', projectRoot: root, autosave: true })
  assert.equal(formal.project.name, 'Demo Project')
  assert.equal(draft.project.name, 'Autosave Draft')
})

test('editor project paths reject traversal ids before writes', async () => {
  const root = await tempRoot()
  const project = createDefaultEditorProject({
    id: '../bad',
    name: 'Bad Project',
    createdAt: '2026-06-22T00:00:00.000Z',
    updatedAt: '2026-06-22T00:00:00.000Z',
  })

  await assert.rejects(
    saveEditorProject({ project, projectRoot: root }),
    /project id is unsafe/
  )
})

test('editor project mutations serialize same-revision writers before invoking callbacks', async () => {
  const root = await tempRoot()
  await createEditorProject({
    id: 'project_demo',
    name: 'Demo Project',
    projectRoot: root,
    now: '2026-06-22T00:00:00.000Z',
  })

  let releaseStart
  const startBarrier = new Promise((resolve) => {
    releaseStart = resolve
  })
  const callbackRevisions = []
  const rename = (name) => startBarrier.then(() => mutateEditorProject({
    projectId: 'project_demo',
    expectedRevision: 1,
    projectRoot: root,
    now: '2026-06-22T00:01:00.000Z',
    mutate(project) {
      callbackRevisions.push(project.revision)
      project.name = name
      return project
    },
  }))

  const pending = [rename('Rename A'), rename('Rename B')]
  releaseStart()
  const results = await Promise.allSettled(pending)

  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1)
  const rejected = results.find((result) => result.status === 'rejected')
  assert.equal(rejected.reason.code, 'revision_conflict')
  assert.deepEqual(rejected.reason.details, {
    expected_revision: 1,
    current_revision: 2,
  })
  assert.deepEqual(callbackRevisions, [1])

  const persisted = await loadEditorProject({ projectId: 'project_demo', projectRoot: root })
  assert.equal(persisted.project.revision, 2)
  assert.ok(['Rename A', 'Rename B'].includes(persisted.project.name))
})

test('editor project mutations reject callback results outside the locked project identity', async () => {
  const root = await tempRoot()
  await createEditorProject({
    id: 'project_alpha',
    name: 'Project Alpha',
    projectRoot: root,
    now: '2026-06-22T00:00:00.000Z',
  })
  await createEditorProject({
    id: 'project_beta',
    name: 'Project Beta',
    projectRoot: root,
    now: '2026-06-22T00:00:00.000Z',
  })

  await assert.rejects(
    mutateEditorProject({
      projectId: 'project_alpha',
      expectedRevision: 1,
      projectRoot: root,
      mutate(project) {
        return { ...project, id: 'project_beta', name: 'Wrong Lock Write' }
      },
    }),
    (error) => {
      assert.equal(error instanceof EditorProjectStoreError, true)
      assert.equal(error.code, 'mutation_project_id_mismatch')
      assert.equal(error.message, 'editor project mutation must preserve project id')
      assert.deepEqual(error.details, {
        expected_project_id: 'project_alpha',
        actual_project_id: 'project_beta',
      })
      return true
    },
  )

  await assert.rejects(
    mutateEditorProject({
      projectId: 'project_alpha',
      expectedRevision: 1,
      projectRoot: root,
      mutate: () => null,
    }),
    (error) => {
      assert.equal(error instanceof EditorProjectStoreError, true)
      assert.equal(error.code, 'invalid_mutation_result')
      assert.equal(error.message, 'editor project mutation must return a project object')
      assert.deepEqual(error.details, { project_id: 'project_alpha' })
      return true
    },
  )

  const alpha = await loadEditorProject({ projectId: 'project_alpha', projectRoot: root })
  const beta = await loadEditorProject({ projectId: 'project_beta', projectRoot: root })
  assert.equal(alpha.project.name, 'Project Alpha')
  assert.equal(alpha.project.revision, 1)
  assert.equal(beta.project.name, 'Project Beta')
  assert.equal(beta.project.revision, 1)
})

test('editor project mutations validate and save one stable callback-result snapshot', async () => {
  const root = await tempRoot()
  const alpha = await createEditorProject({
    id: 'project_alpha',
    name: 'Project Alpha',
    projectRoot: root,
    now: '2026-06-22T00:00:00.000Z',
  })
  await createEditorProject({
    id: 'project_beta',
    name: 'Project Beta',
    projectRoot: root,
    now: '2026-06-22T00:00:00.000Z',
  })

  const disguisedCrossProjectResult = {
    ...alpha.project,
    id: 'project_alpha',
    toJSON() {
      return {
        ...alpha.project,
        id: 'project_beta',
        name: 'Cross-project write',
      }
    },
  }
  await assert.rejects(
    mutateEditorProject({
      projectId: 'project_alpha',
      expectedRevision: 1,
      projectRoot: root,
      mutate: () => disguisedCrossProjectResult,
    }),
    (error) => {
      assert.equal(error instanceof EditorProjectStoreError, true)
      assert.equal(error.code, 'mutation_project_id_mismatch')
      assert.deepEqual(error.details, {
        expected_project_id: 'project_alpha',
        actual_project_id: 'project_beta',
      })
      return true
    },
  )

  await assert.rejects(
    mutateEditorProject({
      projectId: 'project_alpha',
      expectedRevision: 1,
      projectRoot: root,
      mutate: () => ({
        ...alpha.project,
        toJSON() {
          throw new Error('attacker-controlled serialization details')
        },
      }),
    }),
    (error) => {
      assert.equal(error instanceof EditorProjectStoreError, true)
      assert.equal(error.code, 'invalid_mutation_result')
      assert.equal(error.message, 'editor project mutation must return a project object')
      assert.deepEqual(error.details, { project_id: 'project_alpha' })
      assert.equal(String(error).includes('attacker-controlled'), false)
      return true
    },
  )

  await assert.rejects(
    mutateEditorProject({
      projectId: 'project_alpha',
      expectedRevision: 1,
      projectRoot: root,
      mutate: () => ({
        ...alpha.project,
        id: { attacker_controlled: true },
      }),
    }),
    (error) => {
      assert.equal(error instanceof EditorProjectStoreError, true)
      assert.equal(error.code, 'mutation_project_id_mismatch')
      assert.deepEqual(error.details, {
        expected_project_id: 'project_alpha',
        actual_project_id: null,
      })
      return true
    },
  )

  const unchangedAlpha = await loadEditorProject({ projectId: 'project_alpha', projectRoot: root })
  const unchangedBeta = await loadEditorProject({ projectId: 'project_beta', projectRoot: root })
  assert.equal(unchangedAlpha.project.name, 'Project Alpha')
  assert.equal(unchangedAlpha.project.revision, 1)
  assert.equal(unchangedBeta.project.name, 'Project Beta')
  assert.equal(unchangedBeta.project.revision, 1)

  let idReads = 0
  const timeVaryingResult = {
    ...alpha.project,
    name: 'Stable Snapshot',
  }
  Object.defineProperty(timeVaryingResult, 'id', {
    enumerable: true,
    get() {
      idReads += 1
      return idReads === 1 ? 'project_alpha' : 'project_beta'
    },
  })
  const saved = await mutateEditorProject({
    projectId: 'project_alpha',
    expectedRevision: 1,
    projectRoot: root,
    mutate: () => timeVaryingResult,
  })

  assert.equal(idReads, 1)
  assert.equal(saved.project.id, 'project_alpha')
  assert.equal(saved.project.name, 'Stable Snapshot')
  assert.equal(saved.project.revision, 2)
  const persistedAlpha = await loadEditorProject({ projectId: 'project_alpha', projectRoot: root })
  const persistedBeta = await loadEditorProject({ projectId: 'project_beta', projectRoot: root })
  assert.equal(persistedAlpha.project.id, 'project_alpha')
  assert.equal(persistedAlpha.project.name, 'Stable Snapshot')
  assert.equal(persistedAlpha.project.revision, 2)
  assert.equal(persistedBeta.project.name, 'Project Beta')
  assert.equal(persistedBeta.project.revision, 1)
})

test('formal store saves share the project mutation lock', async () => {
  const root = await tempRoot()
  const created = await createEditorProject({
    id: 'project_demo',
    name: 'Demo Project',
    projectRoot: root,
    now: '2026-06-22T00:00:00.000Z',
  })
  const save = (name) => saveEditorProject({
    project: { ...created.project, name },
    projectRoot: root,
    expectedRevision: 1,
    now: '2026-06-22T00:01:00.000Z',
  })

  const results = await Promise.allSettled([save('Rename A'), save('Rename B')])

  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
  const rejected = results.find((result) => result.status === 'rejected')
  assert.equal(rejected.reason.code, 'revision_conflict')
  const persisted = await loadEditorProject({ projectId: 'project_demo', projectRoot: root })
  assert.equal(persisted.project.revision, 2)
})

test('editor project mutation locks allow different project ids to proceed concurrently', async () => {
  const root = await tempRoot()
  const workspaceRoot = path.join(root, 'workspace')
  let entered = 0
  let releaseTasks
  let signalBothEntered
  const release = new Promise((resolve) => {
    releaseTasks = resolve
  })
  const bothEntered = new Promise((resolve) => {
    signalBothEntered = resolve
  })
  const enter = (projectId) => withEditorProjectMutationLock({ projectId, workspaceRoot }, async () => {
    entered += 1
    if (entered === 2) signalBothEntered()
    await release
  })

  const pending = [enter('project_alpha'), enter('project_beta')]
  const proceededConcurrently = await Promise.race([
    bothEntered.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 250)),
  ])
  releaseTasks()
  await Promise.all(pending)

  assert.equal(proceededConcurrently, true)
  assert.equal(entered, 2)
})

test('editor project mutation locks serialize workspace symlink aliases and release after failure', async () => {
  const root = await tempRoot()
  const workspaceRoot = path.join(root, 'workspace')
  const workspaceAlias = path.join(root, 'workspace-alias')
  await mkdir(workspaceRoot, { recursive: true })
  await symlink(workspaceRoot, workspaceAlias, 'dir')

  let signalFirstEntered
  let releaseFirst
  let signalSecondEntered
  const firstEntered = new Promise((resolve) => {
    signalFirstEntered = resolve
  })
  const firstRelease = new Promise((resolve) => {
    releaseFirst = resolve
  })
  const secondEntered = new Promise((resolve) => {
    signalSecondEntered = resolve
  })
  const first = withEditorProjectMutationLock({ projectId: 'project_demo', workspaceRoot }, async () => {
    signalFirstEntered()
    await firstRelease
  })
  await firstEntered
  const second = withEditorProjectMutationLock({ projectId: 'project_demo', workspaceRoot: workspaceAlias }, () => {
    signalSecondEntered()
  })

  const enteredBeforeRelease = await Promise.race([
    secondEntered.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 100)),
  ])
  assert.equal(enteredBeforeRelease, false)
  releaseFirst()
  await Promise.all([first, second])

  await assert.rejects(
    withEditorProjectMutationLock({ projectId: 'project_demo', workspaceRoot }, () => {
      throw new Error('lock task failed')
    }),
    /lock task failed/,
  )
  let reachedAfterFailure = false
  await withEditorProjectMutationLock({ projectId: 'project_demo', workspaceRoot }, () => {
    reachedAfterFailure = true
  })
  assert.equal(reachedAfterFailure, true)
})

test('prepared project creation waits for the project lock, prepares a detached project, and publishes one serialized revision', async () => {
  const root = await tempRoot()
  const workspaceRoot = path.join(root, 'controlled-workspace')
  const sourceProject = preparedProject()
  const sourceSnapshot = structuredClone(sourceProject)
  const expectedPaths = resolveEditorProjectPaths({
    projectId: sourceProject.id,
    projectRoot: root,
    workspaceRoot,
  })
  const globalSentinel = path.join(root, 'outside-project.txt')
  await writeFile(globalSentinel, 'outside-project')

  let releaseHeldLock
  let signalHeldLock
  const heldLockEntered = new Promise((resolve) => {
    signalHeldLock = resolve
  })
  const heldLockRelease = new Promise((resolve) => {
    releaseHeldLock = resolve
  })
  const heldLock = withEditorProjectMutationLock({ projectId: sourceProject.id, workspaceRoot }, async () => {
    signalHeldLock()
    await heldLockRelease
  })
  await heldLockEntered

  let signalPrepareEntered
  const prepareEntered = new Promise((resolve) => {
    signalPrepareEntered = resolve
  })
  let callbackCount = 0
  const pending = createPreparedEditorProject({
    project: sourceProject,
    projectRoot: root,
    workspaceRoot,
    now: PREPARED_PUBLISH_TIME,
    async prepareProject(input) {
      callbackCount += 1
      signalPrepareEntered()
      assert.deepEqual(Object.keys(input).sort(), ['paths', 'project'])
      assert.notStrictEqual(input.project, sourceProject)
      assert.notStrictEqual(input.project.scenes, sourceProject.scenes)
      assert.deepEqual(input.paths, expectedPaths)
      assert.equal(existsSync(input.paths.projectJson), false)
      input.project.name = 'Prepared And Populated'
      input.project.revision = 99
      input.project.created_at = '2000-01-01T00:00:00.000Z'
      input.project.updated_at = '2000-01-01T00:00:00.000Z'
      return populatePreparedCharacter(input)
    },
  })

  const enteredWhileLocked = await Promise.race([
    prepareEntered.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 75)),
  ])
  const projectDirCreatedWhileLocked = existsSync(expectedPaths.projectDir)
  releaseHeldLock()
  await heldLock
  assert.equal(enteredWhileLocked, false)
  assert.equal(projectDirCreatedWhileLocked, false)

  const created = await pending
  assert.equal(callbackCount, 1)
  assert.deepEqual(sourceProject, sourceSnapshot)
  assert.equal(created.project.name, 'Prepared And Populated')
  assert.equal(created.project.revision, 1)
  assert.equal(created.project.created_at, PREPARED_PUBLISH_TIME)
  assert.equal(created.project.updated_at, PREPARED_PUBLISH_TIME)
  assert.equal(validateEditorProject(created.project).status, 'pass')
  assert.deepEqual(created.paths, expectedPaths)
  assert.equal(await readFile(globalSentinel, 'utf8'), 'outside-project')

  const revisionDir = path.join(expectedPaths.assetsDir, 'asset_prepared_hero', 'rev_001')
  assert.deepEqual(
    (await readdir(revisionDir)).sort(),
    Object.values(PREPARED_ARTIFACTS).map(({ file }) => file).sort(),
  )
  for (const artifact of Object.values(PREPARED_ARTIFACTS)) {
    assert.deepEqual(await readFile(path.join(revisionDir, artifact.file)), artifact.bytes)
  }
  assert.equal(await readFile(expectedPaths.projectJson, 'utf8'), serializeEditorProject(created.project))
  const reloaded = await loadEditorProject({
    projectId: sourceProject.id,
    projectRoot: root,
    workspaceRoot,
  })
  assert.deepEqual(reloaded.project, created.project)
})

test('prepared project creation rejects every pre-existing target filesystem object as project_exists', async () => {
  const root = await tempRoot()
  const cases = [
    { id: 'project_orphan_dir', kind: 'directory' },
    { id: 'project_existing_file', kind: 'file' },
    { id: 'project_existing_symlink', kind: 'symlink' },
  ]

  for (const fixture of cases) {
    const project = preparedProject(fixture.id)
    const sourceSnapshot = structuredClone(project)
    const paths = resolveEditorProjectPaths({ projectId: project.id, projectRoot: root })
    await mkdir(paths.projectsDir, { recursive: true })
    if (fixture.kind === 'directory') {
      await mkdir(paths.projectDir)
      await writeFile(path.join(paths.projectDir, 'orphan.marker'), 'leave-orphan')
    } else if (fixture.kind === 'file') {
      await writeFile(paths.projectDir, 'leave-file')
    } else {
      const symlinkTarget = path.join(root, `${fixture.id}-target`)
      await mkdir(symlinkTarget)
      await symlink(symlinkTarget, paths.projectDir, 'dir')
    }

    let callbackEntered = false
    await assert.rejects(
      createPreparedEditorProject({
        project,
        projectRoot: root,
        prepareProject() {
          callbackEntered = true
          return project
        },
      }),
      expectStoreCode('project_exists'),
    )
    assert.equal(callbackEntered, false)
    assert.deepEqual(project, sourceSnapshot)
    const targetStat = await lstat(paths.projectDir)
    if (fixture.kind === 'directory') {
      assert.equal(targetStat.isDirectory(), true)
      assert.equal(await readFile(path.join(paths.projectDir, 'orphan.marker'), 'utf8'), 'leave-orphan')
    } else if (fixture.kind === 'file') {
      assert.equal(targetStat.isFile(), true)
      assert.equal(await readFile(paths.projectDir, 'utf8'), 'leave-file')
    } else {
      assert.equal(targetStat.isSymbolicLink(), true)
    }
  }
})

test('prepared project creation rejects a symlinked projects directory without writing outside', async () => {
  const root = await tempRoot()
  const outsideProjects = await mkdtemp(path.join(os.tmpdir(), 'editor-project-outside-projects-'))
  const project = preparedProject('project_symlinked_parent')
  const paths = resolveEditorProjectPaths({ projectId: project.id, projectRoot: root })
  await mkdir(paths.workspaceRoot, { recursive: true })
  await symlink(outsideProjects, paths.projectsDir, 'dir')

  let callbackEntered = false
  await assert.rejects(
    createPreparedEditorProject({
      project,
      projectRoot: root,
      prepareProject() {
        callbackEntered = true
        return project
      },
    }),
    (error) => {
      assert.equal(error instanceof EditorProjectStoreError, true)
      assert.equal(error.code, 'project_create_failed')
      assert.deepEqual(error.details, { project_id: project.id })
      const exposed = `${error.message}\n${error.stack}\n${JSON.stringify(error)}`
      assert.equal(exposed.includes(outsideProjects), false)
      assert.equal(Object.hasOwn(error, 'cause'), false)
      return true
    },
  )
  assert.equal(callbackEntered, false)
  assert.equal(existsSync(path.join(outsideProjects, project.id)), false)
  assert.equal(existsSync(path.join(outsideProjects, project.id, 'project.json')), false)
})

test('prepared project creation rechecks reserved directory identity before exclusive publication', async () => {
  const root = await tempRoot()
  const outsideTarget = await mkdtemp(path.join(os.tmpdir(), 'editor-project-outside-target-'))
  const project = preparedProject('project_swapped_target')
  const paths = resolveEditorProjectPaths({ projectId: project.id, projectRoot: root })
  const orphanDir = path.join(paths.projectsDir, `${project.id}_orphan`)
  const orphanMarker = path.join(orphanDir, 'reserved.marker')

  await assert.rejects(
    createPreparedEditorProject({
      project,
      projectRoot: root,
      async prepareProject({ project: detached, paths: callbackPaths }) {
        await writeFile(path.join(callbackPaths.projectDir, 'reserved.marker'), 'reserved-directory')
        await rename(callbackPaths.projectDir, orphanDir)
        await symlink(outsideTarget, callbackPaths.projectDir, 'dir')
        return detached
      },
    }),
    (error) => {
      assert.equal(error instanceof EditorProjectStoreError, true)
      assert.equal(error.code, 'project_publish_failed')
      assert.deepEqual(error.details, { project_id: project.id })
      const exposed = `${error.message}\n${error.stack}\n${JSON.stringify(error)}`
      assert.equal(exposed.includes(outsideTarget), false)
      assert.equal(Object.hasOwn(error, 'cause'), false)
      return true
    },
  )
  assert.equal(await readFile(orphanMarker, 'utf8'), 'reserved-directory')
  assert.equal(existsSync(path.join(orphanDir, 'project.json')), false)
  assert.equal(existsSync(path.join(outsideTarget, 'project.json')), false)
})

test('prepared project creation leaves failed preparation state untouched and never reuses its target directory', async () => {
  const root = await tempRoot()
  const project = preparedProject('project_failed_once')
  const sourceSnapshot = structuredClone(project)
  const paths = resolveEditorProjectPaths({ projectId: project.id, projectRoot: root })
  const marker = path.join(paths.projectDir, 'preparation.marker')

  await assert.rejects(
    createPreparedEditorProject({
      project,
      projectRoot: root,
      async prepareProject() {
        await writeFile(marker, 'failed-preparation-remains')
        throw new EditorProjectStoreError('prepare_failed', 'controlled preparation failure')
      },
    }),
    expectStoreCode('prepare_failed'),
  )
  assert.equal(await readFile(marker, 'utf8'), 'failed-preparation-remains')
  assert.equal(existsSync(paths.projectJson), false)

  let retryEntered = false
  await assert.rejects(
    createPreparedEditorProject({
      project,
      projectRoot: root,
      prepareProject() {
        retryEntered = true
        return project
      },
    }),
    expectStoreCode('project_exists'),
  )
  assert.equal(retryEntered, false)
  assert.equal(await readFile(marker, 'utf8'), 'failed-preparation-remains')
  assert.equal(existsSync(paths.projectJson), false)
  assert.deepEqual(project, sourceSnapshot)
})

test('prepared project creation sanitizes unexpected callback failures and preserves the orphan target', async () => {
  const root = await tempRoot()
  const project = preparedProject('project_plain_prepare_failure')
  const paths = resolveEditorProjectPaths({ projectId: project.id, projectRoot: root })
  const marker = path.join(paths.projectDir, 'unexpected-failure.marker')
  const secretToken = 'UNEXPECTED_PREPARE_SECRET_7b2c9f'
  const privatePath = path.join(root, 'private', 'do-not-expose.txt')

  await assert.rejects(
    createPreparedEditorProject({
      project,
      projectRoot: root,
      async prepareProject() {
        await writeFile(marker, 'unexpected-failure-remains')
        throw new Error(`unexpected callback ${secretToken} at ${privatePath}`)
      },
    }),
    (error) => {
      assert.equal(error instanceof EditorProjectStoreError, true)
      assert.equal(error.code, 'project_prepare_failed')
      assert.equal(error.message, 'editor project preparation failed')
      assert.deepEqual(error.details, { project_id: project.id })
      assert.equal(Object.hasOwn(error, 'cause'), false)
      assert.equal(String(error.stack).includes(secretToken), false)
      assert.equal(String(error.stack).includes(privatePath), false)
      const serialized = JSON.stringify(error)
      assert.equal(serialized.includes(secretToken), false)
      assert.equal(serialized.includes(privatePath), false)
      assert.equal(serialized.includes('"stack"'), false)
      assert.equal(serialized.includes('"cause"'), false)
      return true
    },
  )
  assert.equal(await readFile(marker, 'utf8'), 'unexpected-failure-remains')
  assert.equal(existsSync(paths.projectJson), false)

  let retryEntered = false
  await assert.rejects(
    createPreparedEditorProject({
      project,
      projectRoot: root,
      prepareProject() {
        retryEntered = true
        return project
      },
    }),
    expectStoreCode('project_exists'),
  )
  assert.equal(retryEntered, false)
  assert.equal(await readFile(marker, 'utf8'), 'unexpected-failure-remains')
  assert.equal(existsSync(paths.projectJson), false)
})

test('prepared project creation sanitizes native-coded errors and rewraps trusted application codes', async () => {
  const root = await tempRoot()

  const nativeProject = preparedProject('project_native_prepare_error')
  const nativePaths = resolveEditorProjectPaths({ projectId: nativeProject.id, projectRoot: root })
  const nativeSecret = 'NATIVE_ERROR_SECRET_31f9d2'
  const nativePrivatePath = path.join(root, 'private', 'missing-source.json')
  const nativeError = new Error(`ENOENT ${nativeSecret} ${nativePrivatePath}`)
  nativeError.code = 'ENOENT'
  await assert.rejects(
    createPreparedEditorProject({
      project: nativeProject,
      projectRoot: root,
      prepareProject() {
        throw nativeError
      },
    }),
    (error) => {
      assertSanitizedPreparationError(error, {
        code: 'project_prepare_failed',
        projectId: nativeProject.id,
        forbidden: [nativeSecret, nativePrivatePath],
        original: nativeError,
      })
      return true
    },
  )
  assert.equal(existsSync(nativePaths.projectJson), false)

  const applicationProject = preparedProject('project_application_prepare_error')
  const applicationPaths = resolveEditorProjectPaths({ projectId: applicationProject.id, projectRoot: root })
  const applicationSecret = 'APPLICATION_ERROR_SECRET_5e80c4'
  const applicationPrivatePath = path.join(root, 'private', 'captured-sheet.png')
  const applicationError = new Error(
    `artifact digest mismatch ${applicationSecret} ${applicationPrivatePath}`,
  )
  applicationError.code = 'artifact_integrity_failed'
  applicationError.details = { secret: applicationSecret, path: applicationPrivatePath }
  applicationError.cause = new Error(`raw cause ${applicationSecret}`)
  await assert.rejects(
    createPreparedEditorProject({
      project: applicationProject,
      projectRoot: root,
      prepareProject() {
        throw applicationError
      },
    }),
    (error) => {
      assertSanitizedPreparationError(error, {
        code: 'artifact_integrity_failed',
        projectId: applicationProject.id,
        forbidden: [applicationSecret, applicationPrivatePath],
        original: applicationError,
      })
      return true
    },
  )
  assert.equal(existsSync(applicationPaths.projectJson), false)
})

test('prepared project creation never publishes or cleans up invalid results, corrupt artifacts, or project.json collisions', async () => {
  const root = await tempRoot()

  const invalidProject = preparedProject('project_invalid_result')
  const invalidPaths = resolveEditorProjectPaths({ projectId: invalidProject.id, projectRoot: root })
  await assert.rejects(
    createPreparedEditorProject({
      project: invalidProject,
      projectRoot: root,
      prepareProject: () => null,
    }),
    expectStoreCode('invalid_prepare_result'),
  )
  assert.equal((await lstat(invalidPaths.projectDir)).isDirectory(), true)
  assert.equal(existsSync(invalidPaths.projectJson), false)
  assert.deepEqual(await readdir(invalidPaths.projectDir), [])

  const corruptProject = preparedProject('project_corrupt_artifact')
  const corruptPaths = resolveEditorProjectPaths({ projectId: corruptProject.id, projectRoot: root })
  const corruptArtifact = path.join(corruptPaths.projectDir, 'short-artifact.bin')
  await assert.rejects(
    createPreparedEditorProject({
      project: corruptProject,
      projectRoot: root,
      async prepareProject() {
        await writeFile(corruptArtifact, Buffer.from([0x00]))
        throw new EditorProjectStoreError(
          'artifact_integrity_failed',
          'captured artifact is shorter than its verified size',
        )
      },
    }),
    expectStoreCode('artifact_integrity_failed'),
  )
  assert.deepEqual(await readFile(corruptArtifact), Buffer.from([0x00]))
  assert.equal(existsSync(corruptPaths.projectJson), false)

  const collisionProject = preparedProject('project_json_collision')
  const collisionPaths = resolveEditorProjectPaths({ projectId: collisionProject.id, projectRoot: root })
  const collisionBytes = Buffer.from('unpublished-project-json-collision')
  await assert.rejects(
    createPreparedEditorProject({
      project: collisionProject,
      projectRoot: root,
      async prepareProject({ project, paths }) {
        await writeFile(paths.projectJson, collisionBytes)
        return project
      },
    }),
    expectStoreCode('project_exists'),
  )
  assert.deepEqual(await readFile(collisionPaths.projectJson), collisionBytes)
})

test('two concurrent prepared project creates yield one revision and one project_exists conflict', async () => {
  const root = await tempRoot()
  const project = preparedProject('project_concurrent_prepare')
  const sourceSnapshot = structuredClone(project)
  let releaseStart
  const start = new Promise((resolve) => {
    releaseStart = resolve
  })
  let callbackCount = 0
  const create = () => start.then(() => createPreparedEditorProject({
    project,
    projectRoot: root,
    now: PREPARED_PUBLISH_TIME,
    async prepareProject(input) {
      callbackCount += 1
      return populatePreparedCharacter(input)
    },
  }))
  const pending = [create(), create()]
  releaseStart()

  const results = await Promise.allSettled(pending)
  const fulfilled = results.filter(({ status }) => status === 'fulfilled')
  const rejected = results.filter(({ status }) => status === 'rejected')
  assert.equal(fulfilled.length, 1)
  assert.equal(rejected.length, 1)
  assert.equal(callbackCount, 1)
  assert.equal(fulfilled[0].value.project.revision, 1)
  assert.equal(rejected[0].reason instanceof EditorProjectStoreError, true)
  assert.equal(rejected[0].reason.code, 'project_exists')
  assert.deepEqual(project, sourceSnapshot)

  const persisted = await loadEditorProject({
    projectId: project.id,
    projectRoot: root,
  })
  assert.deepEqual(persisted.project, fulfilled[0].value.project)
})
