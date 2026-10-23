import test from 'node:test'
import { editorFetch as fetch } from '../helpers/editorFetch.js'
import assert from 'node:assert/strict'
import http from 'node:http'
import { randomUUID, createHash } from 'node:crypto'
import { mkdtemp, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { handleEditorProjectApi, createEditorArtifactAccessRegistry } from '../../src/editor-project/index.js'
import { createImageGeneration } from '../../src/editor-project/imageGeneration.js'
import { prepareNativeImage } from '../../src/editor-project/imageAntigravity.js'

test('native PNG/JPEG flow uses local guards, immutable generated provenance and idempotent import', async t => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'image-embed-http-'))
  const workspaceRoot = path.join(projectRoot, 'workspace')
  let calls = 0, format = 'jpeg', edge = 4, commitFault = null
  const references = []
  const originals = []
  const prepared = []
  const service = createImageGeneration({ providers: { codex: { installed: async () => true, generate: async ({ reference }) => {
    references.push(reference)
    return { bytes: reference.bytes, mimeType: 'image/png', width: 4, height: 4 }
  } } }, installed: async () => true, generate: async () => {
    calls++
    const bytes = await sharp({ create: { width: edge, height: edge, channels: 3, background: 'blue' } })[format]().toBuffer()
    originals.push(bytes)
    const image = await prepareNativeImage(bytes)
    prepared.push(image)
    return image
  } })
  const server = http.createServer((req, res) => handleEditorProjectApi(req, res, {
    projectRoot, workspaceRoot, artifactAccessRegistry: createEditorArtifactAccessRegistry(), imageGeneration: service, v1CommitFault: commitFault,
  }))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const base = `http://127.0.0.1:${server.address().port}`
  const json = async (url, body, headers = {}) => {
    const response = await fetch(base + url, body === undefined ? { headers } : { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
    return { status: response.status, body: await response.json() }
  }
  const created = await json('/api/editor/projects/v1', { operation_id: randomUUID() })
  assert.equal(created.status, 201)
  const pid = created.body.project.id
  const endpoint = `/api/editor/projects/${pid}/image-generation`
  assert.equal((await json(endpoint)).body.available, true)
  const request = { operation_id: randomUUID(), description: 'blue guard' }
  assert.equal((await json(endpoint, request, { origin: 'https://elsewhere.example' })).status, 403)
  assert.equal(calls, 0)
  assert.equal((await json(endpoint, { ...request, reference: 'must not upload' })).status, 400)
  let revision = created.body.project.revision
  for (const spec of [{ format: 'jpeg', edge: 4 }, { format: 'png', edge: 4 }, { format: 'png', edge: 1254 }, { format: 'jpeg', edge: 1254 }]) {
    ;({ format, edge } = spec)
    const body = { ...request, operation_id: randomUUID() }
    const started = await json(endpoint, body)
    assert.equal(started.status, 202)
    assert.equal(started.body.id, body.operation_id)
    let job
    for (let attempt = 0; attempt < 100; attempt++) {
      job = (await json(`${endpoint}/${body.operation_id}`)).body
      if (job.status !== 'running') break
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    assert.equal(job.status, 'done')
    assert.equal((await json(endpoint, body)).body.id, job.id)
    const downloaded = Buffer.from(await (await fetch(base + job.source_url)).arrayBuffer())
    assert.deepEqual(downloaded, prepared.at(-1).bytes)
    const query = new URLSearchParams({ operation_id: randomUUID(), expected_revision: String(revision), expected_sha256: job.sha256, name: 'Generated image' })
    const url = `${endpoint}/${job.id}/import?${query}`
    const beforeImport = await readFile(path.join(workspaceRoot, 'projects', pid, 'project.json'))
    for (const headers of [{}, { 'X-Editor-Storage-Version': 'unknown' }]) {
      const refused = await globalThis.fetch(base + url, { method: 'POST', headers })
      assert.equal(refused.status, 409)
      assert.equal((await refused.json()).error, 'unsupported_project_writer')
      assert.deepEqual(await readFile(path.join(workspaceRoot, 'projects', pid, 'project.json')), beforeImport)
    }
    if (edge > 1024) {
      assert.equal(job.fitted, true)
      assert.equal(job.original.width, edge)
      assert.equal(job.original.sha256, createHash('sha256').update(originals.at(-1)).digest('hex'))
      commitFault = 'asset'
      assert.equal((await fetch(base + url, { method: 'POST' })).status, 500)
      commitFault = null
      assert.equal((await json(`/api/editor/projects/${pid}`)).body.project.revision, revision)
      const ordinary = await fetch(`${base}/api/editor/projects/${pid}/sprite-documents/import-${format}?${new URLSearchParams({
        operation_id: randomUUID(), expected_revision: String(revision), expected_sha256: job.original.sha256,
      })}`, { method: 'POST', headers: { 'content-type': job.original.mime_type }, body: originals.at(-1) })
      assert.equal(ordinary.status, 413, 'ordinary uploads must retain the 1024 edge limit')
    }
    const response = await fetch(base + url, { method: 'POST' })
    const imported = await response.json()
    assert.equal(response.status, 201, JSON.stringify(imported))
    const asset = Object.values(imported.project.assets).at(-1)
    assert.deepEqual(asset.provenance, { source_type: 'provider', provider: 'antigravity', model: 'native-generate-image' })
    const source = Object.values(asset.revisions).at(-1)
    assert.equal(source.source_job_id, job.id)
    assert.deepEqual(await readFile(path.join(projectRoot, source.artifacts.image)), prepared.at(-1).bytes)
    if (edge > 1024) {
      assert.deepEqual(await readFile(path.join(projectRoot, source.artifacts.native_original)), originals.at(-1))
      const metadata = JSON.parse(await readFile(path.join(projectRoot, source.artifacts.generation_metadata), 'utf8'))
      assert.equal(metadata.original.sha256, job.original.sha256)
      assert.equal(metadata.image.sha256, job.sha256)
      assert.deepEqual([metadata.image.width, metadata.image.height], [1024, 1024])
      assert.equal(metadata.transformation.kernel, 'nearest')
      const reopened = (await json(`/api/editor/projects/${pid}`)).body.project
      assert.deepEqual(reopened.assets[asset.id].revisions[source.id].artifacts, source.artifacts)
    }
    const replay = await fetch(base + url, { method: 'POST' })
    assert.equal(replay.status, 200)
    assert.equal((await replay.json()).project.revision, imported.project.revision)
    const recoveredQuery = new URLSearchParams(query)
    recoveredQuery.set('operation_id', randomUUID())
    // A different operation after a lost receipt must not import or place twice.
    const recovered = await fetch(`${base}${endpoint}/${job.id}/import?${recoveredQuery}`, { method: 'POST' })
    assert.equal(recovered.status, 200)
    const recoveredBody = await recovered.json()
    assert.equal(recoveredBody.already_imported, true)
    assert.deepEqual(recoveredBody.project, imported.project)
    revision = imported.project.revision
    // The same operation cannot cross into the ordinary upload route/provenance.
    const forged = await fetch(`${base}/api/editor/projects/${pid}/sprite-documents/import-${job.mime_type === 'image/png' ? 'png' : 'jpeg'}?${query}`, {
      method: 'POST', headers: { 'content-type': job.mime_type }, body: downloaded,
    })
    assert.equal(forged.status, 409)
    if (format === 'jpeg' && edge === 4) {
      const canvas = Object.values(imported.project.canvases).at(-1)
      const referenceRequest = { operation_id: randomUUID(), description: '参考这张图画成像素风', provider: 'codex',
        reference: { canvas_id: canvas.id, document_id: canvas.document_id, expected_revision: revision,
          working_revision: imported.project.sprite_documents[canvas.document_id].working_revision } }
      assert.equal((await json(endpoint, referenceRequest)).status, 202)
      let referenced
      for (let attempt = 0; attempt < 100; attempt++) {
        referenced = (await json(`${endpoint}/${referenceRequest.operation_id}`)).body
        if (referenced.status !== 'running') break
        await new Promise(resolve => setTimeout(resolve, 5))
      }
      assert.equal(referenced.status, 'done', JSON.stringify(referenced))
      assert.equal(references.length, 1)
      const pixels = await sharp(references[0].bytes).raw().toBuffer()
      const originalPixels = await sharp(originals.at(-1)).ensureAlpha().raw().toBuffer()
      assert.deepEqual(pixels, originalPixels)
      assert.equal((await json(endpoint, referenceRequest)).body.status, 'done')
      assert.equal(references.length, 1)
    }
  }
  assert.equal(calls, 4)
})

test('unsupported legacy project is rejected before native generation', async () => {
  let calls = 0
  const service = createImageGeneration({ load: async () => ({ project: { version: 'editor_project_v0' } }),
    generate: async () => { calls++ } })
  const scope = { projectId: 'legacy', workspaceRoot: '/tmp' }
  await assert.rejects(service.capabilities(scope), { code: 'image_project_unsupported' })
  await assert.rejects(service.start(scope, { operation_id: randomUUID(), description: 'guard' }), { code: 'image_project_unsupported' })
  assert.equal(calls, 0)
})
