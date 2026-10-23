import { createHash } from 'node:crypto'
import { appendFile, chmod, lstat, mkdir, mkdtemp, readdir, readFile, rename, symlink, writeFile } from 'node:fs/promises'
import http from 'node:http'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  createEditorArtifactAccessRegistry,
  createEditorProject,
  createEditorProjectV1,
  EDITOR_PROJECT_LIST_LIMITS,
  handleEditorProjectApi,
  listEditorProjects,
} from '../../src/editor-project/index.js'

const createOp = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

async function tempRoot(prefix = 'editor-project-list-') {
  return mkdtemp(path.join(os.tmpdir(), prefix))
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

function summaryJson({
  id,
  name = id,
  version = 'editor_project_v0',
  revision = 1,
  updated_at = '2026-01-01T00:00:00.000Z',
  extra,
} = {}) {
  return JSON.stringify({
    id,
    name,
    version,
    revision,
    updated_at,
    ...extra,
  })
}

async function writeIndex(root, workspaceName, projectId, contents) {
  const projectDir = path.join(root, workspaceName, 'projects', projectId)
  await mkdir(projectDir, { recursive: true })
  const filePath = path.join(projectDir, 'project.json')
  await writeFile(filePath, contents)
  return filePath
}

async function snapshotTree(directoryPath) {
  let names
  try {
    names = await readdir(directoryPath)
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
  const rows = []
  for (const name of names.sort()) {
    const full = path.join(directoryPath, name)
    const stat = await lstat(full)
    rows.push(`${name}:${stat.isSymbolicLink() ? 'l' : stat.isDirectory() ? 'd' : 'f'}:${stat.size}`)
  }
  return rows
}

async function fdCount() {
  return (await readdir('/dev/fd')).length
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  })
}

async function startServer(root, workspaceRoot = path.join(root, 'workspace')) {
  const artifactAccessRegistry = createEditorArtifactAccessRegistry()
  const server = http.createServer((req, res) => handleEditorProjectApi(req, res, {
    projectRoot: root,
    workspaceRoot,
    generatedDir: path.join(root, 'generated'),
    artifactAccessRegistry,
  }))
  const port = await listen(server)
  return { server, baseUrl: `http://127.0.0.1:${port}` }
}

function requestChunkedJson(baseUrl, pathname, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathname, baseUrl)
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      headers: {
        Host: url.host,
        'Transfer-Encoding': 'chunked',
        Connection: 'close',
      },
    }, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        resolve({
          status: res.statusCode,
          json: text ? JSON.parse(text) : {},
        })
      })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

function requestJson(baseUrl, pathname, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathname, baseUrl)
    const req = http.request(url, { method, headers }, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        resolve({
          status: res.statusCode,
          json: text ? JSON.parse(text) : {},
        })
      })
    })
    req.on('error', reject)
    if (body != null) req.write(body)
    req.end()
  })
}

function pathFree(error) {
  const reason = String(error?.message ?? error?.reason ?? '')
  return !reason.includes('/') && !reason.includes('\\')
}

test('empty configured workspace creates nothing and lists no projects', async () => {
  const root = await tempRoot()
  const workspaceRoot = path.join(root, 'workspace')
  const before = await snapshotTree(root)
  const listed = await listEditorProjects({ projectRoot: root, workspaceRoot })
  assert.deepEqual(listed, { projects: [], omitted_count: 0 })
  assert.deepEqual(await snapshotTree(root), before)
  await mkdir(workspaceRoot)
  const afterWorkspace = await snapshotTree(workspaceRoot)
  const stillEmpty = await listEditorProjects({ projectRoot: root, workspaceRoot })
  assert.deepEqual(stillEmpty, { projects: [], omitted_count: 0 })
  assert.deepEqual(await snapshotTree(workspaceRoot), afterWorkspace)
})

test('lists mixed v0/v1 summaries from the configured workspace only', async () => {
  const root = await tempRoot()
  const defaultWorkspace = path.join(root, 'workspace')
  const altWorkspace = path.join(root, 'workspace-alt')
  await writeIndex(root, 'workspace-alt', 'project_b', summaryJson({
    id: 'project_b',
    name: 'Bravo Long Name Stays Intact',
    updated_at: '2026-02-01T00:00:00.000Z',
  }))
  await writeIndex(root, 'workspace-alt', 'project_a', summaryJson({
    id: 'project_a',
    name: 'Alpha',
    updated_at: '2026-02-01T00:00:00.000Z',
  }))
  await writeIndex(root, 'workspace-alt', 'project_c', summaryJson({
    id: 'project_c',
    name: 'Charlie',
    version: 'editor_project_v1',
    revision: 4,
    updated_at: '2026-03-01T00:00:00.000Z',
  }))
  await writeIndex(root, 'workspace', 'project_default', summaryJson({
    id: 'project_default',
    name: 'Should Not Appear',
  }))

  const listed = await listEditorProjects({ projectRoot: root, workspaceRoot: altWorkspace })
  assert.deepEqual(listed, {
    projects: [
      {
        id: 'project_c',
        name: 'Charlie',
        version: 'editor_project_v1',
        revision: 4,
        updated_at: '2026-03-01T00:00:00.000Z',
      },
      {
        id: 'project_a',
        name: 'Alpha',
        version: 'editor_project_v0',
        revision: 1,
        updated_at: '2026-02-01T00:00:00.000Z',
      },
      {
        id: 'project_b',
        name: 'Bravo Long Name Stays Intact',
        version: 'editor_project_v0',
        revision: 1,
        updated_at: '2026-02-01T00:00:00.000Z',
      },
    ],
    omitted_count: 0,
  })
  assert.equal(listed.projects[1].name.includes('…'), false)
  const fallback = await listEditorProjects({ projectRoot: root, workspaceRoot: defaultWorkspace })
  assert.equal(fallback.projects.length, 1)
  assert.equal(fallback.projects[0].id, 'project_default')
})

test('repeat list leaves formal bytes, revision, receipt, and directory listing unchanged', async () => {
  const root = await tempRoot()
  const workspaceRoot = path.join(root, 'workspace')
  const v0 = await createEditorProject({
    id: 'project_v0_keep',
    name: 'Keep V0',
    projectRoot: root,
    workspaceRoot,
    now: '2026-01-02T00:00:00.000Z',
  })
  const v1 = await createEditorProjectV1({
    operationId: createOp,
    name: 'Keep V1',
    payload: { operation_id: createOp },
    projectRoot: root,
    workspaceRoot,
    now: '2026-01-03T00:00:00.000Z',
  })
  const v0Path = path.join(workspaceRoot, 'projects', v0.project.id, 'project.json')
  const v1Path = path.join(workspaceRoot, 'projects', v1.project.id, 'project.json')
  const before = {
    v0: sha256(await readFile(v0Path)),
    v1: sha256(await readFile(v1Path)),
    tree: await snapshotTree(path.join(workspaceRoot, 'projects')),
    v0Meta: {
      revision: v0.project.revision,
      updated_at: v0.project.updated_at,
    },
    v1Meta: {
      revision: v1.project.revision,
      updated_at: v1.project.updated_at,
      receipts: v1.project.operation_receipts,
    },
  }
  const first = await listEditorProjects({ projectRoot: root, workspaceRoot })
  const second = await listEditorProjects({ projectRoot: root, workspaceRoot })
  assert.deepEqual(first, second)
  assert.deepEqual(first.projects.map((item) => item.id), [v1.project.id, v0.project.id])
  assert.equal(sha256(await readFile(v0Path)), before.v0)
  assert.equal(sha256(await readFile(v1Path)), before.v1)
  assert.deepEqual(await snapshotTree(path.join(workspaceRoot, 'projects')), before.tree)
  const v0Again = JSON.parse(await readFile(v0Path, 'utf8'))
  const v1Again = JSON.parse(await readFile(v1Path, 'utf8'))
  assert.equal(v0Again.revision, before.v0Meta.revision)
  assert.equal(v0Again.updated_at, before.v0Meta.updated_at)
  assert.equal(v1Again.revision, before.v1Meta.revision)
  assert.equal(v1Again.updated_at, before.v1Meta.updated_at)
  assert.deepEqual(v1Again.operation_receipts, before.v1Meta.receipts)
})

test('omits bad singles, ignores uncommitted dirs, and rejects links or ownership drift', async () => {
  const root = await tempRoot()
  const workspaceRoot = path.join(root, 'workspace')
  await writeIndex(root, 'workspace', 'project_ok', summaryJson({
    id: 'project_ok',
    name: 'Readable',
    updated_at: '2026-04-01T00:00:00.000Z',
  }))
  await writeIndex(root, 'workspace', 'project_badjson', '{not-json')
  await writeIndex(root, 'workspace', 'project_unknown', summaryJson({
    id: 'project_unknown',
    version: 'editor_project_v9',
  }))
  await writeIndex(root, 'workspace', 'project_mismatch', summaryJson({
    id: 'project_other',
    name: 'Wrong Id',
  }))
  const uncommitted = path.join(workspaceRoot, 'projects', 'project_draft')
  await mkdir(uncommitted, { recursive: true })
  await writeFile(path.join(uncommitted, 'autosave.json'), summaryJson({
    id: 'project_draft',
    name: 'Autosave Only',
  }))
  await writeFile(path.join(workspaceRoot, 'projects', 'README.txt'), 'ignore')
  const outside = path.join(root, 'outside.json')
  await writeFile(outside, summaryJson({ id: 'project_link', name: 'Linked' }))
  const linkedDir = path.join(workspaceRoot, 'projects', 'project_linkdir')
  await symlink(path.join(workspaceRoot, 'projects', 'project_ok'), linkedDir)
  const linkedFileDir = path.join(workspaceRoot, 'projects', 'project_linkfile')
  await mkdir(linkedFileDir)
  await symlink(outside, path.join(linkedFileDir, 'project.json'))

  const listed = await listEditorProjects({ projectRoot: root, workspaceRoot })
  assert.deepEqual(listed.projects, [{
    id: 'project_ok',
    name: 'Readable',
    version: 'editor_project_v0',
    revision: 1,
    updated_at: '2026-04-01T00:00:00.000Z',
  }])
  assert.equal(listed.omitted_count, 5)

  const onlyBadRoot = await tempRoot()
  await writeIndex(onlyBadRoot, 'workspace', 'project_badjson', '{not-json')
  await writeIndex(onlyBadRoot, 'workspace', 'project_mismatch', summaryJson({
    id: 'project_other',
  }))
  const allOmitted = await listEditorProjects({
    projectRoot: onlyBadRoot,
    workspaceRoot: path.join(onlyBadRoot, 'workspace'),
  })
  assert.deepEqual(allOmitted, { projects: [], omitted_count: 2 })
})

test('unsafe or unreadable roots fail instead of returning an empty list', async () => {
  const fileRoot = await tempRoot()
  await mkdir(path.join(fileRoot, 'workspace'))
  await writeFile(path.join(fileRoot, 'workspace', 'projects'), 'not-a-directory')
  await assert.rejects(
    listEditorProjects({ projectRoot: fileRoot, workspaceRoot: path.join(fileRoot, 'workspace') }),
    (error) => error.code === 'artifact_integrity_failed' && pathFree(error),
  )

  const linkRoot = await tempRoot()
  const realProjects = path.join(linkRoot, 'real-projects')
  await mkdir(realProjects)
  await writeIndex(linkRoot, 'real-workspace', 'project_hidden', summaryJson({
    id: 'project_hidden',
    name: 'Hidden',
  }))
  await mkdir(path.join(linkRoot, 'workspace'))
  await symlink(path.join(linkRoot, 'real-workspace', 'projects'), path.join(linkRoot, 'workspace', 'projects'))
  await assert.rejects(
    listEditorProjects({ projectRoot: linkRoot, workspaceRoot: path.join(linkRoot, 'workspace') }),
    (error) => error.code === 'artifact_integrity_failed' && pathFree(error),
  )

  const ioRoot = await tempRoot()
  const projectsDir = path.join(ioRoot, 'workspace', 'projects')
  await mkdir(projectsDir, { recursive: true })
  await chmod(projectsDir, 0o000)
  try {
    await assert.rejects(
      listEditorProjects({ projectRoot: ioRoot, workspaceRoot: path.join(ioRoot, 'workspace') }),
      (error) => error.code === 'storage_commit_failed'
        && /read/i.test(error.message)
        && pathFree(error),
    )
  } finally {
    await chmod(projectsDir, 0o700)
  }
})

test('list budgets skip one oversized index and fail closed on whole-list limits', async () => {
  const oversizeRoot = await tempRoot()
  await writeIndex(oversizeRoot, 'workspace', 'project_ok', summaryJson({
    id: 'project_ok',
    name: 'Ok',
  }))
  await writeIndex(
    oversizeRoot,
    'workspace',
    'project_huge',
    `${'{'}${'x'.repeat(EDITOR_PROJECT_LIST_LIMITS.maxIndexBytes + 1)}`,
  )
  const skipped = await listEditorProjects({
    projectRoot: oversizeRoot,
    workspaceRoot: path.join(oversizeRoot, 'workspace'),
  })
  assert.deepEqual(skipped.projects.map((item) => item.id), ['project_ok'])
  assert.equal(skipped.omitted_count, 1)

  const entryRoot = await tempRoot()
  const entryProjects = path.join(entryRoot, 'workspace', 'projects')
  await mkdir(entryProjects, { recursive: true })
  for (let index = 0; index < EDITOR_PROJECT_LIST_LIMITS.maxFirstLevelEntries; index += 1) {
    await writeFile(path.join(entryProjects, `note_${index}`), 'x')
  }
  assert.deepEqual(
    await listEditorProjects({ projectRoot: entryRoot, workspaceRoot: path.join(entryRoot, 'workspace') }),
    { projects: [], omitted_count: 0 },
  )
  await writeFile(path.join(entryProjects, 'note_extra'), 'x')
  await assert.rejects(
    listEditorProjects({ projectRoot: entryRoot, workspaceRoot: path.join(entryRoot, 'workspace') }),
    (error) => error.code === 'resource_limit' && pathFree(error),
  )

  const candidateRoot = await tempRoot()
  for (let index = 0; index < EDITOR_PROJECT_LIST_LIMITS.maxCandidates; index += 1) {
    await writeIndex(candidateRoot, 'workspace', `project_${index}`, '{')
  }
  const maxCandidates = await listEditorProjects({
    projectRoot: candidateRoot,
    workspaceRoot: path.join(candidateRoot, 'workspace'),
  })
  assert.deepEqual(maxCandidates, {
    projects: [],
    omitted_count: EDITOR_PROJECT_LIST_LIMITS.maxCandidates,
  })
  await writeIndex(candidateRoot, 'workspace', 'project_extra', '{')
  await assert.rejects(
    listEditorProjects({ projectRoot: candidateRoot, workspaceRoot: path.join(candidateRoot, 'workspace') }),
    (error) => error.code === 'resource_limit' && pathFree(error),
  )

  const cumulativeRoot = await tempRoot()
  const fileSize = EDITOR_PROJECT_LIST_LIMITS.maxIndexBytes
  const filesNeeded = Math.floor(EDITOR_PROJECT_LIST_LIMITS.maxCumulativeReadBytes / fileSize) + 1
  for (let index = 0; index < filesNeeded; index += 1) {
    const id = `project_pad_${index}`
    const head = `{"id":"${id}","name":"${id}","version":"editor_project_v0","revision":1,"updated_at":"2026-01-01T00:00:00.000Z","pad":"`
    const tail = '"}'
    const pad = fileSize - Buffer.byteLength(head + tail)
    await writeIndex(cumulativeRoot, 'workspace', id, `${head}${'x'.repeat(pad)}${tail}`)
  }
  await assert.rejects(
    listEditorProjects({
      projectRoot: cumulativeRoot,
      workspaceRoot: path.join(cumulativeRoot, 'workspace'),
    }),
    (error) => error.code === 'resource_limit' && pathFree(error),
  )

  const responseRoot = await tempRoot()
  await writeIndex(responseRoot, 'workspace', 'project_name', summaryJson({
    id: 'project_name',
    name: 'n'.repeat(EDITOR_PROJECT_LIST_LIMITS.maxResponseBytes),
  }))
  await assert.rejects(
    listEditorProjects({
      projectRoot: responseRoot,
      workspaceRoot: path.join(responseRoot, 'workspace'),
    }),
    (error) => error.code === 'resource_limit' && pathFree(error),
  )
})

test('list HTTP enforces origin before read and keeps old POST plus GET by id', async () => {
  const root = await tempRoot()
  const workspaceRoot = path.join(root, 'workspace')
  await writeIndex(root, 'workspace', 'project_ok', summaryJson({
    id: 'project_ok',
    name: 'Listed',
    updated_at: '2026-05-01T00:00:00.000Z',
  }))
  const { server, baseUrl } = await startServer(root, workspaceRoot)
  try {
    const listed = await requestJson(baseUrl, '/api/editor/projects')
    assert.equal(listed.status, 200)
    assert.deepEqual(Object.keys(listed.json).sort(), ['omitted_count', 'projects'])
    assert.deepEqual(listed.json.projects, [{
      id: 'project_ok',
      name: 'Listed',
      version: 'editor_project_v0',
      revision: 1,
      updated_at: '2026-05-01T00:00:00.000Z',
    }])
    assert.equal(listed.json.omitted_count, 0)

    const query = await requestJson(baseUrl, '/api/editor/projects?limit=1')
    assert.equal(query.status, 400)
    assert.equal(query.json.error, 'invalid_request')
    assert.equal(pathFree(query.json), true)

    const body = await requestJson(baseUrl, '/api/editor/projects', {
      headers: { 'content-length': '2' },
      body: '{}',
    })
    assert.equal(body.status, 400)
    assert.equal(body.json.error, 'invalid_request')

    const chunked = await requestChunkedJson(baseUrl, '/api/editor/projects', '{"chunked":true}')
    assert.equal(chunked.status, 400)
    assert.equal(chunked.json.error, 'invalid_request')
    assert.equal(pathFree(chunked.json), true)
    const afterChunked = await requestJson(baseUrl, '/api/editor/projects')
    assert.equal(afterChunked.status, 200)
    assert.equal(afterChunked.json.projects[0].id, 'project_ok')

    const created = await requestJson(baseUrl, '/api/editor/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'project_posted',
        name: 'Posted',
        now: '2026-05-02T00:00:00.000Z',
      }),
    })
    assert.equal(created.status, 201)
    assert.equal(created.json.project.id, 'project_posted')
    const loaded = await requestJson(baseUrl, '/api/editor/projects/project_posted')
    assert.equal(loaded.status, 200)
    assert.equal(loaded.json.project.name, 'Posted')
    assert.equal(Object.hasOwn(loaded.json, 'omitted_count'), false)
  } finally {
    server.close()
  }

  const blockedRoot = await tempRoot()
  await mkdir(path.join(blockedRoot, 'workspace'))
  await writeFile(path.join(blockedRoot, 'workspace', 'projects'), 'blocked')
  const blocked = await startServer(blockedRoot)
  try {
    const requestOrigin = new URL(blocked.baseUrl).origin
    const sameOrigin = await requestJson(blocked.baseUrl, '/api/editor/projects', {
      headers: { origin: requestOrigin },
    })
    assert.equal(sameOrigin.status, 422)
    assert.equal(sameOrigin.json.error, 'artifact_integrity_failed')
    assert.equal(pathFree(sameOrigin.json), true)

    const crossOrigin = await requestJson(blocked.baseUrl, '/api/editor/projects', {
      headers: { origin: 'https://evil.example' },
    })
    assert.equal(crossOrigin.status, 403)
    assert.equal(crossOrigin.json.error, 'forbidden_origin')
    assert.equal(pathFree(crossOrigin.json), true)

    const nullOrigin = await requestJson(blocked.baseUrl, '/api/editor/projects', {
      headers: { origin: 'null' },
    })
    assert.equal(nullOrigin.status, 403)

    const referer = await requestJson(blocked.baseUrl, '/api/editor/projects', {
      headers: { referer: 'https://evil.example/app' },
    })
    assert.equal(referer.status, 403)
  } finally {
    blocked.server.close()
  }
})

test('list closes directory and index handles before returning', async () => {
  const root = await tempRoot()
  await writeIndex(root, 'workspace', 'project_ok', summaryJson({
    id: 'project_ok',
    name: 'Handle',
  }))
  const workspaceRoot = path.join(root, 'workspace')
  const before = await fdCount()
  const listed = await listEditorProjects({ projectRoot: root, workspaceRoot })
  assert.equal(listed.projects.length, 1)
  const missing = await listEditorProjects({
    projectRoot: root,
    workspaceRoot: path.join(root, 'missing-root-does-not-create'),
  })
  assert.deepEqual(missing, { projects: [], omitted_count: 0 })
  const after = await fdCount()
  assert.equal(after, before)
})

test('L1 root swap after identity is recorded fails closed and writes nothing', async () => {
  const root = await tempRoot()
  const workspaceRoot = path.join(root, 'workspace')
  const insidePath = await writeIndex(root, 'workspace', 'project_ok', summaryJson({
    id: 'project_ok',
    name: 'Inside',
    updated_at: '2026-06-01T00:00:00.000Z',
  }))
  const outsidePath = await writeIndex(root, 'outside-workspace', 'project_out', summaryJson({
    id: 'project_out',
    name: 'Outside Secret',
    updated_at: '2026-06-02T00:00:00.000Z',
  }))
  const projectsDir = path.join(workspaceRoot, 'projects')
  const parkedDir = path.join(root, 'parked-projects')
  const before = {
    inside: sha256(await readFile(insidePath)),
    outside: sha256(await readFile(outsidePath)),
    insideTree: await snapshotTree(path.join(workspaceRoot, 'projects')),
    outsideTree: await snapshotTree(path.join(root, 'outside-workspace', 'projects')),
  }
  await assert.rejects(
    listEditorProjects({
      projectRoot: root,
      workspaceRoot,
      onListReadEvent: async (event) => {
        if (event.stage !== 'after-root-identity') return
        await rename(projectsDir, parkedDir)
        await symlink(path.join(root, 'outside-workspace', 'projects'), projectsDir)
      },
    }),
    (error) => error.code === 'artifact_integrity_failed' && pathFree(error),
  )
  assert.equal(sha256(await readFile(path.join(parkedDir, 'project_ok', 'project.json'))), before.inside)
  assert.equal(sha256(await readFile(outsidePath)), before.outside)
  assert.deepEqual(await snapshotTree(parkedDir), before.insideTree)
  assert.deepEqual(await snapshotTree(path.join(root, 'outside-workspace', 'projects')), before.outsideTree)
})

test('L1 project swap after identity is recorded is omitted and writes nothing', async () => {
  const root = await tempRoot()
  const workspaceRoot = path.join(root, 'workspace')
  const keepPath = await writeIndex(root, 'workspace', 'project_keep', summaryJson({
    id: 'project_keep',
    name: 'Keep',
    updated_at: '2026-06-03T00:00:00.000Z',
  }))
  const okPath = await writeIndex(root, 'workspace', 'project_ok', summaryJson({
    id: 'project_ok',
    name: 'Inside',
    updated_at: '2026-06-01T00:00:00.000Z',
  }))
  const outsidePath = await writeIndex(root, 'outside-workspace', 'project_ok', summaryJson({
    id: 'project_ok',
    name: 'Outside Secret',
    updated_at: '2026-06-04T00:00:00.000Z',
  }))
  const parkedIndex = path.join(`${path.dirname(okPath)}.parked`, 'project.json')
  const before = {
    keep: sha256(await readFile(keepPath)),
    ok: sha256(await readFile(okPath)),
    outside: sha256(await readFile(outsidePath)),
    outsideTree: await snapshotTree(path.join(root, 'outside-workspace', 'projects')),
  }
  const listed = await listEditorProjects({
    projectRoot: root,
    workspaceRoot,
    onListReadEvent: async (event) => {
      if (event.stage !== 'after-project-identity' || event.projectId !== 'project_ok') return
      const parked = `${event.projectDir}.parked`
      await rename(event.projectDir, parked)
      await symlink(path.join(root, 'outside-workspace', 'projects', 'project_ok'), event.projectDir)
    },
  })
  assert.deepEqual(listed.projects, [{
    id: 'project_keep',
    name: 'Keep',
    version: 'editor_project_v0',
    revision: 1,
    updated_at: '2026-06-03T00:00:00.000Z',
  }])
  assert.equal(listed.omitted_count, 1)
  assert.equal(listed.projects.some((item) => item.name === 'Outside Secret'), false)
  assert.equal(sha256(await readFile(keepPath)), before.keep)
  assert.equal(sha256(await readFile(parkedIndex)), before.ok)
  assert.equal(sha256(await readFile(outsidePath)), before.outside)
  assert.deepEqual(await snapshotTree(path.join(root, 'outside-workspace', 'projects')), before.outsideTree)
})

test('L2 grown index files still consume the list budget and then fail closed', async () => {
  const smallRoot = await tempRoot()
  await writeIndex(smallRoot, 'workspace', 'project_a', summaryJson({ id: 'project_a', name: 'A' }))
  await writeIndex(smallRoot, 'workspace', 'project_b', summaryJson({ id: 'project_b', name: 'B' }))
  let smallReads = 0
  const omitted = await listEditorProjects({
    projectRoot: smallRoot,
    workspaceRoot: path.join(smallRoot, 'workspace'),
    onListReadEvent: async (event) => {
      if (event.stage !== 'before-index-read') return
      smallReads += 1
      await appendFile(event.filePath, 'x')
    },
  })
  assert.deepEqual(omitted, { projects: [], omitted_count: 2 })
  assert.equal(smallReads, 2)

  const limitRoot = await tempRoot()
  const fileSize = EDITOR_PROJECT_LIST_LIMITS.maxIndexBytes
  const filesNeeded = Math.floor(EDITOR_PROJECT_LIST_LIMITS.maxCumulativeReadBytes / fileSize) + 1
  for (let index = 0; index < filesNeeded; index += 1) {
    const id = `project_fail_${index}`
    const head = `{"id":"${id}","name":"${id}","version":"editor_project_v0","revision":1,"updated_at":"2026-01-01T00:00:00.000Z","pad":"`
    const tail = '"}'
    const pad = fileSize - Buffer.byteLength(head + tail)
    await writeIndex(limitRoot, 'workspace', id, `${head}${'x'.repeat(pad)}${tail}`)
  }
  let limitReads = 0
  await assert.rejects(
    listEditorProjects({
      projectRoot: limitRoot,
      workspaceRoot: path.join(limitRoot, 'workspace'),
      onListReadEvent: async (event) => {
        if (event.stage !== 'before-index-read') return
        limitReads += 1
        await appendFile(event.filePath, 'x')
      },
    }),
    (error) => error.code === 'resource_limit' && pathFree(error),
  )
  assert.equal(limitReads, filesNeeded - 1)
})

test('GET /api/editor/projects paginates >256 projects (294 candidates) with cursor without hitting maxCandidates resource_limit', async () => {
  const root = await tempRoot('editor-project-list-294-')
  const workspaceRoot = path.join(root, 'workspace')
  const totalProjects = 294
  for (let i = 0; i < totalProjects - 1; i += 1) {
    const id = `proj_${String(i).padStart(4, '0')}`
    await writeIndex(root, 'workspace', id, summaryJson({
      id,
      name: `Project ${i}`,
      version: 'editor_project_v1',
      revision: 1,
      updated_at: `2026-07-${String((i % 28) + 1).padStart(2, '0')}T00:00:00.000Z`,
    }))
  }
  await writeIndex(root, 'workspace', 'p0eff76c5a5e9a925', summaryJson({
    id: 'p0eff76c5a5e9a925',
    name: 'Fire Magma Sequence Trial',
    version: 'editor_project_v1',
    revision: 12,
    updated_at: '2026-10-14T10:00:00.000Z',
  }))

  // Unpaginated single-call listEditorProjects still enforces maxCandidates (256)
  await assert.rejects(
    listEditorProjects({ projectRoot: root, workspaceRoot }),
    (error) => error.code === 'resource_limit' && pathFree(error),
  )

  const { server, baseUrl } = await startServer(root, workspaceRoot)
  try {
    const page1 = await requestJson(baseUrl, '/api/editor/projects')
    assert.equal(page1.status, 200)
    assert.equal(page1.json.projects.length, EDITOR_PROJECT_LIST_LIMITS.maxCandidates)
    assert.equal(page1.json.omitted_count, 0)
    assert.equal(page1.json.has_more, true)
    assert.equal(typeof page1.json.next_cursor, 'string')
    assert.equal(page1.json.next_cursor.length > 0, true)

    const page2 = await requestJson(baseUrl, `/api/editor/projects?cursor=${encodeURIComponent(page1.json.next_cursor)}`)
    assert.equal(page2.status, 200)
    assert.equal(page2.json.projects.length, totalProjects - EDITOR_PROJECT_LIST_LIMITS.maxCandidates)
    assert.equal(page2.json.omitted_count, 0)
    assert.equal(page2.json.has_more, false)
    assert.equal(page2.json.next_cursor, null)

    const combinedIds = new Set([...page1.json.projects.map((p) => p.id), ...page2.json.projects.map((p) => p.id)])
    assert.equal(combinedIds.size, totalProjects)
    assert.equal(combinedIds.has('p0eff76c5a5e9a925'), true)

    // Invalid cursor query params fail closed with 400 invalid_request
    for (const badQuery of ['?cursor=../escape', '?cursor=', '?cursor=proj_0001&limit=1', '?other=proj_0001']) {
      const bad = await requestJson(baseUrl, `/api/editor/projects${badQuery}`)
      assert.equal(bad.status, 400)
      assert.equal(bad.json.error, 'invalid_request')
      assert.equal(pathFree(bad.json), true)
    }

    // Add entries up to exact maxFirstLevelEntries (512): formal paginated GET /api/editor/projects succeeds across 2 pages (256 + 256)
    for (let i = totalProjects - 1; i < EDITOR_PROJECT_LIST_LIMITS.maxFirstLevelEntries - 1; i += 1) {
      const id = `proj_${String(i).padStart(4, '0')}`
      await writeIndex(root, 'workspace', id, summaryJson({
        id,
        name: `Project ${i}`,
        version: 'editor_project_v1',
        revision: 1,
        updated_at: `2026-07-${String((i % 28) + 1).padStart(2, '0')}T00:00:00.000Z`,
      }))
    }
    const maxPage1 = await requestJson(baseUrl, '/api/editor/projects')
    assert.equal(maxPage1.status, 200)
    assert.equal(maxPage1.json.projects.length, EDITOR_PROJECT_LIST_LIMITS.maxCandidates)
    assert.equal(maxPage1.json.has_more, true)
    const maxPage2 = await requestJson(baseUrl, `/api/editor/projects?cursor=${encodeURIComponent(maxPage1.json.next_cursor)}`)
    assert.equal(maxPage2.status, 200)
    assert.equal(maxPage2.json.projects.length, EDITOR_PROJECT_LIST_LIMITS.maxFirstLevelEntries - EDITOR_PROJECT_LIST_LIMITS.maxCandidates)
    assert.equal(maxPage2.json.has_more, false)
    assert.equal(maxPage2.json.next_cursor, null)
    const maxCombined = new Set([...maxPage1.json.projects.map((p) => p.id), ...maxPage2.json.projects.map((p) => p.id)])
    assert.equal(maxCombined.size, EDITOR_PROJECT_LIST_LIMITS.maxFirstLevelEntries)

    // 513th first-level entry exceeds maxFirstLevelEntries (512) even on paginated GET /api/editor/projects
    await mkdir(path.join(workspaceRoot, 'projects', 'proj_overflow_513'), { recursive: true })
    const overflowResp = await requestJson(baseUrl, '/api/editor/projects')
    assert.equal(overflowResp.status, 413)
    assert.equal(overflowResp.json.error, 'resource_limit')
    assert.equal(pathFree(overflowResp.json), true)
  } finally {
    server.close()
  }
})
