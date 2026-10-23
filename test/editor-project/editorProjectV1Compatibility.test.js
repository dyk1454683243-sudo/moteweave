import test from 'node:test'
import { editorFetch as fetch } from '../helpers/editorFetch.js'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdir, mkdtemp, readFile, unlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  createAssetRef,
  createAssetRevision,
  createDefaultEditorProject,
  createEditorArtifactAccessRegistry,
  createEditorProject,
  createEditorProjectV1,
  encodeRgbaPng,
  handleEditorProjectApi,
  mutateEditorProject,
  removeAssetFromProject,
  saveEditorProject,
  sha256Bytes,
  unlinkAssetFromScenes,
  writeEditorProjectPackArtifacts,
} from '../../src/editor-project/index.js'

const now = '2026-09-18T00:00:00.000Z'
const createOp = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const upgradeOp = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const docOp = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'

async function tempRoot() {
  return mkdtemp(path.join(os.tmpdir(), 'p2-02-compat-'))
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  })
}

async function startServer(root, extra = {}) {
  const artifactAccessRegistry = createEditorArtifactAccessRegistry()
  const server = http.createServer((req, res) => handleEditorProjectApi(req, res, {
    projectRoot: root,
    workspaceRoot: path.join(root, 'workspace'),
    generatedDir: path.join(root, 'generated'),
    artifactAccessRegistry,
    ...extra,
  }))
  const port = await listen(server)
  return { server, baseUrl: `http://127.0.0.1:${port}` }
}

async function fetchJson(baseUrl, pathname, options) {
  const response = await fetch(new URL(pathname, baseUrl), options)
  const contentType = response.headers.get('content-type') ?? ''
  const text = await response.text()
  return {
    status: response.status,
    json: contentType.includes('application/json') && text ? JSON.parse(text) : { raw: text },
    headers: response.headers,
  }
}

test('old writers and forged version cannot write v2 while v0 behavior stays intact', async () => {
  const root = await tempRoot()
  const v0 = await createEditorProject({
    id: 'project_v0_keep',
    name: 'Keep V0',
    projectRoot: root,
    now,
  })
  const renamed = await saveEditorProject({
    project: { ...v0.project, name: 'Still V0' },
    projectRoot: root,
    expectedRevision: 1,
    now,
  })
  assert.equal(renamed.project.version, 'editor_project_v0')
  assert.equal(renamed.project.name, 'Still V0')

  const created = await createEditorProjectV1({
    operationId: createOp,
    payload: { operation_id: createOp, name: null },
    projectRoot: root,
    now,
  })
  await assert.rejects(
    saveEditorProject({
      project: { ...created.project, name: 'Hacked', version: 'editor_project_v0' },
      projectRoot: root,
      expectedRevision: 1,
      now,
    }),
    (error) => error.code === 'unsupported_project_writer',
  )
  await assert.rejects(
    saveEditorProject({
      project: { ...createDefaultEditorProject({ id: created.project.id }), version: 'editor_project_v1' },
      projectRoot: root,
      expectedRevision: 1,
      now,
    }),
    (error) => error.code === 'unsupported_project_writer',
  )
  const beforeMutate = await readFile(path.join(root, 'workspace', 'projects', created.project.id, 'project.json'))
  let mutateCalled = false
  await assert.rejects(
    mutateEditorProject({
      projectId: created.project.id,
      expectedRevision: 1,
      projectRoot: root,
      mutate: (project) => {
        mutateCalled = true
        return { ...project, name: 'nope' }
      },
    }),
    (error) => error.code === 'unsupported_project_writer',
  )
  assert.equal(mutateCalled, false)
  const afterMutate = await readFile(path.join(root, 'workspace', 'projects', created.project.id, 'project.json'))
  assert.deepEqual(afterMutate, beforeMutate)
  assert.throws(
    () => removeAssetFromProject(created.project, 'asset_missing'),
    (error) => error.code === 'unsupported_project_writer',
  )
  assert.throws(
    () => unlinkAssetFromScenes(created.project, 'asset_missing'),
    (error) => error.code === 'unsupported_project_writer',
  )
  await assert.rejects(
    writeEditorProjectPackArtifacts({ project: created.project, projectRoot: root }),
    (error) => error.code === 'unsupported_input',
  )
})

test('v1 routes create, upgrade, read RGBA, and reject old HTTP writers and cross-origin', async () => {
  const root = await tempRoot()
  const { server, baseUrl } = await startServer(root)
  try {
    const legacy = await createEditorProject({ id: 'legacy_without_capability', name: 'Legacy', projectRoot: root, now })
    const legacyResponse = await globalThis.fetch(baseUrl + '/api/editor/projects/' + legacy.project.id, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(5000),
      body: JSON.stringify({ project: { ...legacy.project, name: 'Still supported' }, expectedRevision: legacy.project.revision }),
    })
    assert.equal(legacyResponse.status, 200)
    assert.equal((await legacyResponse.json()).project.version, 'editor_project_v0')
    const created = await fetchJson(baseUrl, '/api/editor/projects/v1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operation_id: createOp }),
    })
    assert.equal(created.status, 201)
    assert.equal(created.json.project.version, 'editor_project_v2')
    const replay = await fetchJson(baseUrl, '/api/editor/projects/v1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operation_id: createOp }),
    })
    assert.equal(replay.status, 200)
    assert.equal(replay.json.receipt.operation_id, createOp)

    const loaded = await fetchJson(baseUrl, `/api/editor/projects/${created.json.project.id}`)
    assert.equal(loaded.status, 200)
    assert.equal(loaded.json.project.version, 'editor_project_v2')

    const requestOrigin = new URL(baseUrl).origin
    const allowedOrigin = await fetchJson(baseUrl, '/api/editor/projects/v1', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: requestOrigin },
      body: JSON.stringify({ operation_id: createOp }),
    })
    assert.equal(allowedOrigin.status, 200)
    const forbidden = await fetchJson(baseUrl, '/api/editor/projects/v1', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
      body: JSON.stringify({ operation_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }),
    })
    assert.equal(forbidden.status, 403)
    assert.equal(forbidden.json.error, 'forbidden_origin')
    const crossPort = await fetchJson(baseUrl, '/api/editor/projects/v1', {
      method: 'POST',
      headers: {
        'content-type': 'text/plain',
        origin: `http://127.0.0.1:${Number(new URL(baseUrl).port) + 1}`,
      },
      body: JSON.stringify({ operation_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }),
    })
    assert.equal(crossPort.status, 403)
    assert.equal(crossPort.json.error, 'forbidden_origin')
    const crossScheme = await fetchJson(baseUrl, '/api/editor/projects/v1', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: requestOrigin.replace('http://', 'https://') },
      body: JSON.stringify({ operation_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }),
    })
    assert.equal(crossScheme.status, 403)
    const nullOrigin = await fetchJson(baseUrl, '/api/editor/projects/v1', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'null' },
      body: JSON.stringify({ operation_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }),
    })
    assert.equal(nullOrigin.status, 403)
    const crossHost = await fetchJson(baseUrl, '/api/editor/projects/v1', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: requestOrigin.replace('127.0.0.1', 'localhost') },
      body: JSON.stringify({ operation_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }),
    })
    assert.equal(crossHost.status, 403)

    const overwrite = await fetchJson(baseUrl, '/api/editor/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        project: {
          ...createDefaultEditorProject({ id: created.json.project.id, createdAt: now, updatedAt: now }),
        },
      }),
    })
    assert.equal(overwrite.status, 409)
    assert.equal(overwrite.json.error, 'unsupported_project_writer')

    const put = await fetchJson(baseUrl, `/api/editor/projects/${created.json.project.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        expectedRevision: 1,
        project: createDefaultEditorProject({ id: created.json.project.id, createdAt: now, updatedAt: now }),
      }),
    })
    assert.equal(put.status, 409)
    const autosave = await fetchJson(baseUrl, `/api/editor/projects/${created.json.project.id}/autosave`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        project: createDefaultEditorProject({ id: created.json.project.id, createdAt: now, updatedAt: now }),
      }),
    })
    assert.equal(autosave.status, 409)
    const imported = await fetchJson(baseUrl, `/api/editor/projects/${created.json.project.id}/import-job`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRevision: 1, jobId: 'job_x', kind: 'static_image' }),
    })
    assert.equal(imported.status, 409)
    const exported = await fetchJson(baseUrl, `/api/editor/projects/${created.json.project.id}/export-pack`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRevision: 1 }),
    })
    assert.equal(exported.status, 422)
    assert.equal(exported.json.error, 'unsupported_input')
    const deleted = await fetchJson(baseUrl, `/api/editor/projects/${created.json.project.id}/assets/asset_x`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRevision: 1 }),
    })
    assert.equal(deleted.status, 409)
    const unlinked = await fetchJson(baseUrl, `/api/editor/projects/${created.json.project.id}/assets/asset_x/unlink`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRevision: 1 }),
    })
    assert.equal(unlinked.status, 409)

    const source = await createEditorProject({
      id: 'project_v0_http',
      name: 'HTTP Source',
      projectRoot: root,
      now,
    })
    const png = encodeRgbaPng(2, 2, Buffer.from([5, 6, 7, 0, 8, 9, 10, 255, 11, 12, 13, 128, 14, 15, 16, 0]))
    const revisionDir = path.join(root, 'workspace', 'projects', 'project_v0_http', 'assets', 'asset_source', 'rev_001')
    await mkdir(revisionDir, { recursive: true })
    await writeFile(path.join(revisionDir, 'image.png'), png)
    const sourceProject = source.project
    sourceProject.assets.asset_source = createAssetRef({
      id: 'asset_source',
      kind: 'static_image',
      name: 'HTTP Image',
      revision: createAssetRevision({
        id: 'rev_001',
        createdAt: now,
        qualityStatus: 'pass',
        productionStatus: 'ready',
        artifacts: {
          image: 'workspace/projects/project_v0_http/assets/asset_source/rev_001/image.png',
        },
      }),
    })
    const saved = await saveEditorProject({
      project: sourceProject,
      projectRoot: root,
      expectedRevision: 1,
      now,
    })
    const upgraded = await fetchJson(baseUrl, '/api/editor/projects/project_v0_http/upgrade-copy', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        operation_id: upgradeOp,
        expected_revision: saved.project.revision,
      }),
    })
    assert.equal(upgraded.status, 201)
    assert.equal(upgraded.json.project.version, 'editor_project_v1')
    await assert.rejects(saveEditorProject({
      project: { ...upgraded.json.project, version: 'editor_project_v0', name: 'Old writer' },
      projectRoot: root, expectedRevision: upgraded.json.project.revision,
    }), { code: 'unsupported_project_writer' })
    const document = await fetchJson(baseUrl, `/api/editor/projects/${upgraded.json.project.id}/sprite-documents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        operation_id: docOp,
        expected_revision: 1,
        source: {
          asset_id: 'asset_source',
          revision_id: 'rev_001',
          artifact: 'image',
          expected_sha256: sha256Bytes(png),
        },
      }),
    })
    assert.equal(document.status, 201)
    const listed = await fetchJson(baseUrl, `/api/editor/projects/${upgraded.json.project.id}/sprite-documents`)
    assert.equal(listed.status, 200)
    assert.equal(listed.json.documents.length, 1)
    const manifest = await fetchJson(
      baseUrl,
      `/api/editor/projects/${upgraded.json.project.id}/sprite-documents/${document.json.document.document_id}`,
    )
    assert.equal(manifest.status, 200)
    const blockHash = manifest.json.document.cels.cel_frame_1_layer_1.block.sha256
    const block = await fetch(new URL(
      `/api/editor/projects/${upgraded.json.project.id}/sprite-documents/${document.json.document.document_id}/blocks/${blockHash}`,
      baseUrl,
    ))
    assert.equal(block.status, 200)
    assert.equal(block.headers.get('x-sprite-block-sha256'), blockHash)
    const bytes = Buffer.from(await block.arrayBuffer())
    assert.deepEqual(bytes.subarray(0, 4), Buffer.from([5, 6, 7, 0]))

    const documentId = document.json.document.document_id
    const manifestPath = path.join(
      root,
      'workspace',
      'projects',
      upgraded.json.project.id,
      'sprite-documents',
      documentId,
      'revisions',
      '1.json',
    )
    await unlink(manifestPath)
    await mkdir(manifestPath)
    const leaked = await fetchJson(
      baseUrl,
      `/api/editor/projects/${upgraded.json.project.id}/sprite-documents/${documentId}`,
    )
    assert.equal(leaked.status, 422)
    assert.equal(leaked.json.error, 'artifact_integrity_failed')
    assert.equal(String(leaked.json.reason).includes(root), false)
    assert.equal(String(leaked.json.reason).includes('/'), false)
    assert.equal(String(leaked.json.reason).includes('\\'), false)
  } finally {
    server.close()
  }
})

test('v1 HTTP maps bad JSON, oversized bodies, and filesystem failures to matching status and body', async () => {
  const root = await tempRoot()
  const { server, baseUrl } = await startServer(root)
  try {
    const badJson = await fetchJson(baseUrl, '/api/editor/projects/v1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    })
    assert.equal(badJson.status, 400)
    assert.equal(badJson.json.error, 'invalid_request')
    assert.equal(String(badJson.json.reason).includes('/'), false)

    const oversized = await fetchJson(baseUrl, '/api/editor/projects/v1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: `{"operation_id":"${createOp}","pad":"${'x'.repeat(64 * 1024)}"}`,
    })
    assert.equal(oversized.status, 413)
    assert.equal(oversized.json.error, 'resource_limit')
    assert.equal(String(oversized.json.reason).includes(root), false)
  } finally {
    server.close()
  }

  const fsRoot = await tempRoot()
  await writeFile(path.join(fsRoot, 'workspace'), 'not-a-directory')
  const { server: fsServer, baseUrl: fsBase } = await startServer(fsRoot)
  try {
    const fsFail = await fetchJson(fsBase, '/api/editor/projects/v1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operation_id: createOp }),
    })
    assert.equal(fsFail.status, 500)
    assert.equal(fsFail.json.error, 'storage_commit_failed')
    assert.equal(String(fsFail.json.reason).includes(fsRoot), false)
    assert.equal(String(fsFail.json.reason).includes('/'), false)
  } finally {
    fsServer.close()
  }
})

test('old Editor browser module graph stays free of node:crypto and spriteDocumentValidation', async () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  const entry = path.join(repoRoot, 'src', 'editor-app.js')
  const seen = new Set()
  const queue = [entry]
  while (queue.length) {
    const filePath = queue.pop()
    if (seen.has(filePath)) continue
    seen.add(filePath)
    const source = await readFile(filePath, 'utf8')
    assert.equal(/\bnode:crypto\b/.test(source), false, filePath)
    assert.equal(source.includes('spriteDocumentValidation.js'), false, filePath)
    for (const match of source.matchAll(/from ['"](\.[^'"]+)['"]/g)) {
      const resolved = path.resolve(path.dirname(filePath), match[1])
      const next = resolved.endsWith('.js') ? resolved : `${resolved}.js`
      queue.push(next)
    }
  }
  const html = await readFile(path.join(repoRoot, 'editor.html'), 'utf8')
  assert.equal(html.includes('./src/editor-app.js'), true)
  assert.equal(seen.has(path.join(repoRoot, 'src', 'editor-project', 'assetLibrary.js')), true)
  assert.equal(seen.has(path.join(repoRoot, 'src', 'editor-project', 'spriteDocumentValidation.js')), false)
})

test('v1 HTTP imports a PNG atomically and saves listed canvas positions', async () => {
  const root = await tempRoot()
  const { server, baseUrl } = await startServer(root)
  try {
    const created = await fetchJson(baseUrl, '/api/editor/projects/v1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operation_id: createOp }),
    })
    assert.equal(created.status, 201)
    const png = encodeRgbaPng(2, 2, Buffer.from([5, 6, 7, 0, 8, 9, 10, 128, 11, 12, 13, 255, 14, 15, 16, 0]))
    const digest = sha256Bytes(png)
    const query = new URLSearchParams({
      operation_id: docOp,
      expected_revision: '1',
      expected_sha256: digest,
    })
    const imported = await fetch(new URL(
      `/api/editor/projects/${created.json.project.id}/sprite-documents/import-png?${query}`,
      baseUrl,
    ), {
      method: 'POST',
      headers: { 'content-type': 'image/png' },
      body: png,
    })
    const importedJson = await imported.json()
    assert.equal(imported.status, 201)
    assert.equal(importedJson.project.revision, 2)
    assert.equal(importedJson.document.source_ref.expected_sha256, digest)
    const replay = await fetch(new URL(
      `/api/editor/projects/${created.json.project.id}/sprite-documents/import-png?${query}`,
      baseUrl,
    ), {
      method: 'POST',
      headers: { 'content-type': 'image/png' },
      body: png,
    })
    assert.equal(replay.status, 200)
    const canvasId = Object.keys(importedJson.project.canvases)[0]
    const layout = await fetchJson(baseUrl, `/api/editor/projects/${created.json.project.id}/canvas-layout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        operation_id: upgradeOp,
        expected_revision: 2,
        positions: [{ canvas_id: canvasId, x: -4, y: 12 }],
      }),
    })
    assert.equal(layout.status, 200)
    assert.equal(layout.json.project.canvases[canvasId].x, -4)
    assert.equal(layout.json.project.canvases[canvasId].y, 12)
    assert.equal(layout.json.receipt.document_id, null)
    const wrongType = await fetchJson(
      baseUrl,
      `/api/editor/projects/${created.json.project.id}/sprite-documents/import-png?${query}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nope: true }),
      },
    )
    assert.equal(wrongType.status, 400)
    assert.equal(wrongType.json.error, 'invalid_request')
  } finally {
    server.close()
  }
})

test('v1 from-job is allowed while old import-job still cannot write v1', async () => {
  const root = await tempRoot()
  const generatedDir = path.join(root, 'generated')
  const jobId = 'job_compat_from_job'
  const png = encodeRgbaPng(4, 2, Buffer.from([
    10, 20, 30, 0, 40, 50, 60, 128, 4, 5, 6, 0, 7, 8, 9, 255,
    70, 80, 90, 255, 1, 2, 3, 0, 11, 12, 13, 128, 14, 15, 16, 0,
  ]))
  const digest = sha256Bytes(png)
  await mkdir(path.join(generatedDir, jobId), { recursive: true })
  await writeFile(path.join(generatedDir, jobId, 'normalized_sheet.png'), png)
  await writeFile(path.join(generatedDir, jobId, 'animations.json'), `${JSON.stringify({
    frame_size: { w: 2, h: 2 },
    animations: { idle: { frames: [0, 1], fps: 8, mode: 'loop' } },
  })}\n`)
  await writeFile(path.join(generatedDir, jobId, 'metadata.json'), '{"name":"Compat Job"}\n')
  await writeFile(path.join(generatedDir, jobId, 'editor_metadata.json'), `${JSON.stringify({
    frames: {
      frame_1: { frame: { x: 0, y: 0, w: 2, h: 2 }, duration: 80 },
      frame_2: { frame: { x: 2, y: 0, w: 2, h: 2 }, duration: 160 },
    },
  })}\n`)
  await writeFile(path.join(generatedDir, jobId, 'debug_report.json'), '{"status":"pass"}\n')
  const jobs = new Map([[jobId, { id: jobId, status: 'done', type: 'process-sheet' }]])
  const { server, baseUrl } = await startServer(root, {
    generatedDir,
    getGeneratedJob: (id) => jobs.get(id) ?? null,
  })
  try {
    const created = await fetchJson(baseUrl, '/api/editor/projects/v1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operation_id: createOp }),
    })
    const blocked = await fetchJson(baseUrl, `/api/editor/projects/${created.json.project.id}/import-job`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jobId, expectedRevision: 1 }),
    })
    assert.equal(blocked.status, 409)
    assert.equal(blocked.json.error, 'unsupported_project_writer')
    const imported = await fetchJson(
      baseUrl,
      `/api/editor/projects/${created.json.project.id}/sprite-documents/from-job`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          operation_id: docOp,
          expected_revision: 1,
          source: { job_id: jobId, artifact: 'sheet', expected_sha256: digest },
          name: null,
        }),
      },
    )
    assert.equal(imported.status, 201)
    assert.equal(imported.json.project.revision, 2)
    assert.equal(imported.json.document.frames.frame_1.duration_ms, 80)
  } finally {
    server.close()
  }
})
