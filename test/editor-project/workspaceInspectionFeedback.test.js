import test from 'node:test'
import { editorFetch as fetch } from '../helpers/editorFetch.js'
import assert from 'node:assert/strict'
import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'

import {
  createEditorArtifactAccessRegistry,
  createSpriteDocumentFromUploadedJpeg,
  decodeJpegToRgba,
  encodeRgbaPng,
  handleEditorProjectApi,
  parseImportJpegQuery,
  parseRenameCanvasRequest,
  renameCanvas,
  sha256Bytes,
  validateEditorProject,
} from '../../src/editor-project/index.js'

const createOp = '11111111-1111-4111-8111-111111111111'
const jpegOp = '22222222-2222-4222-8222-222222222222'
const renameOp = '33333333-3333-4333-8333-333333333333'
const replayOp = '44444444-4444-4444-8444-444444444444'

async function tempRoot() {
  return mkdtemp(path.join(os.tmpdir(), 'r2-inspect-'))
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  })
}

async function startServer(root, overrides = {}) {
  const server = http.createServer((req, res) => handleEditorProjectApi(req, res, {
    projectRoot: root,
    workspaceRoot: path.join(root, 'workspace'),
    generatedDir: path.join(root, 'generated'),
    artifactAccessRegistry: createEditorArtifactAccessRegistry(),
    ...overrides,
  }))
  const port = await listen(server)
  return { server, baseUrl: `http://127.0.0.1:${port}` }
}

async function fetchJson(baseUrl, pathname, options) {
  const response = await fetch(new URL(pathname, baseUrl), options)
  const text = await response.text()
  const contentType = response.headers.get('content-type') ?? ''
  return {
    status: response.status,
    json: contentType.includes('application/json') && text ? JSON.parse(text) : { raw: text },
  }
}

async function createProject(baseUrl) {
  return fetchJson(baseUrl, '/api/editor/projects/v1', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ operation_id: createOp }),
  })
}

async function jpegBytes({ width, height, channels = 3, pixels, orientation, greyscale = false } = {}) {
  let image = pixels
    ? sharp(pixels, { raw: { width, height, channels } })
    : sharp({
      create: {
        width,
        height,
        channels,
        background: channels === 3 ? { r: 20, g: 40, b: 60 } : { r: 20, g: 40, b: 60, alpha: 1 },
      },
    })
  if (greyscale) image = image.greyscale()
  image = image.jpeg({ quality: 90 })
  if (orientation) image = image.withMetadata({ orientation })
  return image.toBuffer()
}

test('import-jpeg query and canvas rename reject unknown fields without widening limits', () => {
  const digest = 'a'.repeat(64)
  const query = new URLSearchParams({
    operation_id: jpegOp,
    expected_revision: '1',
    expected_sha256: digest,
  })
  const parsed = parseImportJpegQuery(query, query.toString())
  assert.equal(parsed.payload.action, 'import_jpeg')
  assert.throws(
    () => parseImportJpegQuery(new URLSearchParams('foo=1'), 'foo=1'),
    (error) => error.code === 'invalid_request',
  )
  assert.throws(
    () => parseImportJpegQuery(new URLSearchParams(`pad=${'x'.repeat(3000)}`), `pad=${'x'.repeat(3000)}`),
    (error) => error.code === 'resource_limit',
  )
  const rename = parseRenameCanvasRequest({
    operation_id: renameOp,
    expected_revision: 2,
    display_name: 'North gate',
  }, 'c0123456789abcdef')
  assert.equal(rename.payload.canvas_id, 'c0123456789abcdef')
  assert.throws(
    () => parseRenameCanvasRequest({
      operation_id: renameOp,
      expected_revision: 2,
      display_name: 'North gate',
      name: 'no',
    }, 'c0123456789abcdef'),
    (error) => error.code === 'invalid_request',
  )
  assert.throws(
    () => parseRenameCanvasRequest({
      operation_id: renameOp,
      expected_revision: 2,
      display_name: 'North gate',
    }, 'Bad Canvas'),
    (error) => error.code === 'invalid_request',
  )
})

test('v1 HTTP imports JPEG bytes unchanged and rename leaves pixels and source alone', async () => {
  const root = await tempRoot()
  const { server, baseUrl } = await startServer(root)
  try {
    const created = await createProject(baseUrl)
    assert.equal(created.status, 201)
    const projectId = created.json.project.id
    const raw = Buffer.alloc(2 * 2 * 3)
    raw.set([255, 0, 0, 0, 0, 255, 0, 255, 0, 255, 255, 0])
    const jpeg = await jpegBytes({ width: 2, height: 2, pixels: raw })
    const digest = sha256Bytes(jpeg)
    const query = new URLSearchParams({
      operation_id: jpegOp,
      expected_revision: '1',
      expected_sha256: digest,
      name: 'Gate',
    })
    const imported = await fetch(new URL(
      `/api/editor/projects/${projectId}/sprite-documents/import-jpeg?${query}`,
      baseUrl,
    ), {
      method: 'POST',
      headers: { 'content-type': 'image/jpeg' },
      body: jpeg,
    })
    const importedJson = await imported.json()
    assert.equal(imported.status, 201)
    assert.equal(importedJson.document.source_ref.expected_sha256, digest)
    assert.equal(importedJson.document.source_ref.artifact, 'image')
    assert.equal(importedJson.document.derived_from, undefined)
    assert.equal(importedJson.document.revision, 1)
    assert.equal(importedJson.project.sprite_documents[importedJson.document.document_id].working_revision, 1)
    assert.equal(importedJson.project.sprite_documents[importedJson.document.document_id].accepted_revision, null)
    const canvasId = Object.keys(importedJson.project.canvases)[0]
    const canvas = importedJson.project.canvases[canvasId]
    assert.equal(canvas.x, 0)
    assert.equal(canvas.y, 0)
    assert.equal(canvas.display_name, undefined)
    const asset = importedJson.project.assets[importedJson.document.source_ref.asset_id]
    const revision = asset.revisions[importedJson.document.source_ref.revision_id]
    const stored = await readFile(path.join(root, revision.artifacts.image))
    assert.equal(sha256Bytes(stored), digest)
    assert.equal(stored.equals(jpeg), true)
    assert.match(revision.artifacts.image, /image\.jpg$/)
    const decoded = await decodeJpegToRgba(jpeg)
    assert.equal(decoded.width, 2)
    assert.equal(decoded.height, 2)
    for (let index = 3; index < decoded.rgba.length; index += 4) assert.equal(decoded.rgba[index], 255)
    const cel = Object.values(importedJson.document.cels)[0]
    assert.equal(cel.block.sha256, sha256Bytes(decoded.rgba))

    const replay = await fetch(new URL(
      `/api/editor/projects/${projectId}/sprite-documents/import-jpeg?${query}`,
      baseUrl,
    ), {
      method: 'POST',
      headers: { 'content-type': 'image/jpeg' },
      body: jpeg,
    })
    assert.equal(replay.status, 200)

    const renamed = await fetchJson(baseUrl, `/api/editor/projects/${projectId}/canvases/${canvasId}/rename`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        operation_id: renameOp,
        expected_revision: 2,
        display_name: 'North gate',
      }),
    })
    assert.equal(renamed.status, 200)
    assert.equal(renamed.json.project.canvases[canvasId].display_name, 'North gate')
    assert.equal(renamed.json.project.canvases[canvasId].x, 0)
    assert.equal(renamed.json.project.canvases[canvasId].y, 0)
    assert.equal(renamed.json.project.revision, 3)
    const reopened = await fetchJson(baseUrl, `/api/editor/projects/${projectId}`)
    assert.equal(reopened.json.project.canvases[canvasId].display_name, 'North gate')
    const document = await fetchJson(
      baseUrl,
      `/api/editor/projects/${projectId}/sprite-documents/${importedJson.document.document_id}`,
    )
    assert.equal(document.json.document.name, 'Gate')
    assert.equal(document.json.document.source_ref.expected_sha256, digest)
    assert.equal(document.json.document.derived_from, undefined)
    const storedAfter = await readFile(path.join(root, revision.artifacts.image))
    assert.equal(storedAfter.equals(jpeg), true)

    const stale = await fetchJson(baseUrl, `/api/editor/projects/${projectId}/canvases/${canvasId}/rename`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        operation_id: replayOp,
        expected_revision: 2,
        display_name: 'Should not land',
      }),
    })
    assert.equal(stale.status, 409)
    assert.equal(stale.json.error, 'stale_revision')
    const afterStale = await fetchJson(baseUrl, `/api/editor/projects/${projectId}`)
    assert.equal(afterStale.json.project.canvases[canvasId].display_name, 'North gate')
    assert.equal(afterStale.json.project.revision, 3)

    const same = await fetchJson(baseUrl, `/api/editor/projects/${projectId}/canvases/${canvasId}/rename`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        operation_id: renameOp,
        expected_revision: 2,
        display_name: 'North gate',
      }),
    })
    assert.equal(same.status, 200)
    assert.equal(same.json.project.revision, 3)
  } finally {
    server.close()
  }
})

test('JPEG orientation, grayscale, bad input, and cross-origin do not commit', async () => {
  const oriented = await jpegBytes({
    width: 2,
    height: 4,
    pixels: Buffer.from([
      255, 0, 0, 0, 0, 255,
      255, 0, 0, 0, 0, 255,
      255, 0, 0, 0, 0, 255,
      255, 0, 0, 0, 0, 255,
    ]),
    orientation: 6,
  })
  const rotated = await decodeJpegToRgba(oriented)
  const unrotated = await sharp(oriented).raw().toBuffer({ resolveWithObject: true })
  assert.equal(rotated.width, 4)
  assert.equal(rotated.height, 2)
  assert.notEqual(rotated.width, unrotated.info.width)
  for (let index = 3; index < rotated.rgba.length; index += 4) assert.equal(rotated.rgba[index], 255)

  const mirrored = await jpegBytes({
    width: 2,
    height: 2,
    pixels: Buffer.from([255, 0, 0, 0, 0, 255, 0, 255, 0, 255, 255, 0]),
    orientation: 2,
  })
  const mirrorDecoded = await decodeJpegToRgba(mirrored)
  const mirrorPlain = await sharp(mirrored).ensureAlpha().raw().toBuffer()
  const mirrorOriented = await sharp(mirrored).rotate().ensureAlpha().raw().toBuffer()
  assert.equal(mirrorDecoded.rgba.equals(mirrorOriented), true)
  assert.equal(mirrorDecoded.rgba.equals(mirrorPlain), false)

  const gray = await jpegBytes({ width: 2, height: 2, greyscale: true })
  const grayDecoded = await decodeJpegToRgba(gray)
  for (let index = 0; index < grayDecoded.rgba.length; index += 4) {
    assert.equal(grayDecoded.rgba[index], grayDecoded.rgba[index + 1])
    assert.equal(grayDecoded.rgba[index], grayDecoded.rgba[index + 2])
    assert.equal(grayDecoded.rgba[index + 3], 255)
  }

  const root = await tempRoot()
  const { server, baseUrl } = await startServer(root)
  try {
    const created = await createProject(baseUrl)
    const projectId = created.json.project.id
    const wide = await jpegBytes({ width: 4097, height: 1 })
    const wideQuery = new URLSearchParams({
      operation_id: jpegOp,
      expected_revision: '1',
      expected_sha256: sha256Bytes(wide),
    })
    const rejected = await fetchJson(
      baseUrl,
      `/api/editor/projects/${projectId}/sprite-documents/import-jpeg?${wideQuery}`,
      {
        method: 'POST',
        headers: { 'content-type': 'image/jpeg' },
        body: wide,
      },
    )
    assert.equal(rejected.status, 413)
    assert.equal(rejected.json.error, 'resource_limit')
    const bad = await fetchJson(
      baseUrl,
      `/api/editor/projects/${projectId}/sprite-documents/import-jpeg?${wideQuery}`,
      {
        method: 'POST',
        headers: { 'content-type': 'image/jpeg' },
        body: Buffer.from('not-a-jpeg'),
      },
    )
    assert.equal(bad.status, 422)
    const png = encodeRgbaPng(1, 1, Buffer.from([1, 2, 3, 255]))
    const pngAsJpeg = await fetchJson(
      baseUrl,
      `/api/editor/projects/${projectId}/sprite-documents/import-jpeg?${new URLSearchParams({
        operation_id: replayOp,
        expected_revision: '1',
        expected_sha256: sha256Bytes(png),
      })}`,
      {
        method: 'POST',
        headers: { 'content-type': 'image/jpeg' },
        body: png,
      },
    )
    assert.equal(pngAsJpeg.status, 422)
    const jpeg = await jpegBytes({ width: 1, height: 1 })
    const jpegAsPng = await fetchJson(
      baseUrl,
      `/api/editor/projects/${projectId}/sprite-documents/import-png?${new URLSearchParams({
        operation_id: jpegOp,
        expected_revision: '1',
        expected_sha256: sha256Bytes(jpeg),
      })}`,
      {
        method: 'POST',
        headers: { 'content-type': 'image/png' },
        body: jpeg,
      },
    )
    assert.equal(jpegAsPng.status, 422)
    const cross = await fetchJson(
      baseUrl,
      `/api/editor/projects/${projectId}/sprite-documents/import-jpeg?${wideQuery}`,
      {
        method: 'POST',
        headers: { 'content-type': 'image/jpeg', origin: 'https://evil.example' },
        body: wide,
      },
    )
    assert.equal(cross.status, 403)
    assert.equal(cross.json.error, 'forbidden_origin')
    const reopen = await fetchJson(baseUrl, `/api/editor/projects/${projectId}`)
    assert.equal(reopen.json.project.revision, 1)
    assert.equal(Object.keys(reopen.json.project.canvases).length, 0)
    assert.equal(Object.keys(reopen.json.project.sprite_documents).length, 0)
  } finally {
    server.close()
  }
})

test('lost JPEG acknowledgement and rename acknowledgement replay the same receipt', async () => {
  const jpeg = await jpegBytes({ width: 1, height: 1 })
  const digest = sha256Bytes(jpeg)
  const payload = {
    action: 'import_jpeg',
    operation_id: jpegOp,
    expected_revision: 1,
    expected_sha256: digest,
    name: null,
  }
  const projectRoot = await tempRoot()
  const boot = await startServer(projectRoot)
  const project = await createProject(boot.baseUrl)
  boot.server.close()
  const direct = { projectRoot, projectId: project.json.project.id }
  await assert.rejects(
    createSpriteDocumentFromUploadedJpeg({
      projectId: direct.projectId,
      operationId: jpegOp,
      expectedRevision: 1,
      expectedSha256: digest,
      jpegBytes: jpeg,
      payload,
      projectRoot: direct.projectRoot,
      fault: 'ack',
    }),
    (error) => error.code === 'storage_commit_failed' && error.details?.committed === true,
  )
  const replay = await createSpriteDocumentFromUploadedJpeg({
    projectId: direct.projectId,
    operationId: jpegOp,
    expectedRevision: 1,
    expectedSha256: digest,
    jpegBytes: jpeg,
    payload,
    projectRoot: direct.projectRoot,
  })
  assert.equal(replay.replayed, true)
  const canvasId = Object.keys(replay.project.canvases)[0]
  const renamePayload = {
    action: 'rename_canvas',
    canvas_id: canvasId,
    operation_id: renameOp,
    expected_revision: replay.project.revision,
    display_name: 'Kept',
  }
  await assert.rejects(
    renameCanvas({
      projectId: direct.projectId,
      canvasId,
      operationId: renameOp,
      expectedRevision: replay.project.revision,
      displayName: 'Kept',
      payload: renamePayload,
      projectRoot: direct.projectRoot,
      fault: 'ack',
    }),
    (error) => error.code === 'storage_commit_failed' && error.details?.committed === true,
  )
  const renamed = await renameCanvas({
    projectId: direct.projectId,
    canvasId,
    operationId: renameOp,
    expectedRevision: replay.project.revision,
    displayName: 'Kept',
    payload: renamePayload,
    projectRoot: direct.projectRoot,
  })
  assert.equal(renamed.replayed, true)
  assert.equal(renamed.project.canvases[canvasId].display_name, 'Kept')
  assert.equal(renamed.project.sprite_documents[replay.document.document_id].working_revision, 1)
})

function withBrokenIcc(jpeg) {
  const marker = Buffer.from('ICC_PROFILE\0', 'ascii')
  const body = Buffer.concat([marker, Buffer.from([1, 1]), Buffer.from('not-an-icc-profile')])
  const segment = Buffer.alloc(4 + body.length)
  segment[0] = 0xff
  segment[1] = 0xe2
  segment.writeUInt16BE(body.length + 2, 2)
  body.copy(segment, 4)
  return Buffer.concat([jpeg.subarray(0, 2), segment, jpeg.subarray(2)])
}

test('rename receipt is bound to the route canvas and explicit null is not a missing name', async () => {
  const root = await tempRoot()
  const { server, baseUrl } = await startServer(root)
  try {
    const created = await createProject(baseUrl)
    const projectId = created.json.project.id
    const first = await jpegBytes({ width: 2, height: 2 })
    const second = await jpegBytes({ width: 3, height: 2 })
    async function importJpeg(bytes, operationId) {
      const query = new URLSearchParams({
        operation_id: operationId,
        expected_revision: '1',
        expected_sha256: sha256Bytes(bytes),
      })
      const response = await fetch(new URL(
        `/api/editor/projects/${projectId}/sprite-documents/import-jpeg?${query}`,
        baseUrl,
      ), {
        method: 'POST',
        headers: { 'content-type': 'image/jpeg' },
        body: bytes,
      })
      return response.json()
    }
    const imported = await importJpeg(first, jpegOp)
    const canvasA = Object.keys(imported.project.canvases)[0]
    const other = await fetch(new URL(
      `/api/editor/projects/${projectId}/sprite-documents/import-jpeg?${new URLSearchParams({
        operation_id: replayOp,
        expected_revision: String(imported.project.revision),
        expected_sha256: sha256Bytes(second),
      })}`,
      baseUrl,
    ), {
      method: 'POST',
      headers: { 'content-type': 'image/jpeg' },
      body: second,
    })
    const otherJson = await other.json()
    const canvasB = Object.keys(otherJson.project.canvases).find((id) => id !== canvasA)
    const body = JSON.stringify({
      operation_id: renameOp,
      expected_revision: otherJson.project.revision,
      display_name: 'North gate',
    })
    const renamed = await fetchJson(baseUrl, `/api/editor/projects/${projectId}/canvases/${canvasA}/rename`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    })
    assert.equal(renamed.status, 200)
    const conflict = await fetchJson(baseUrl, `/api/editor/projects/${projectId}/canvases/${canvasB}/rename`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    })
    assert.equal(conflict.status, 409)
    assert.equal(conflict.json.error, 'operation_conflict')
    const after = await fetchJson(baseUrl, `/api/editor/projects/${projectId}`)
    assert.equal(after.json.project.revision, renamed.json.project.revision)
    assert.equal(after.json.project.canvases[canvasA].display_name, 'North gate')
    assert.equal(after.json.project.canvases[canvasB].display_name, undefined)
    const omitted = validateEditorProject(after.json.project)
    assert.equal(omitted.status === 'fail' && omitted.blocking_errors.includes('invalid_canvas_display_name'), false)
    const nulled = structuredClone(after.json.project)
    nulled.canvases[canvasA].display_name = null
    const rejected = validateEditorProject(nulled)
    assert.equal(rejected.blocking_errors.includes('invalid_canvas_display_name'), true)
  } finally {
    server.close()
  }
})

test('a JPEG whose embedded profile cannot be converted is rejected without commit', async () => {
  const root = await tempRoot()
  const { server, baseUrl } = await startServer(root)
  try {
    const created = await createProject(baseUrl)
    const projectId = created.json.project.id
    const broken = withBrokenIcc(await jpegBytes({ width: 2, height: 2 }))
    const query = new URLSearchParams({
      operation_id: jpegOp,
      expected_revision: '1',
      expected_sha256: sha256Bytes(broken),
    })
    const rejected = await fetchJson(
      baseUrl,
      `/api/editor/projects/${projectId}/sprite-documents/import-jpeg?${query}`,
      {
        method: 'POST',
        headers: { 'content-type': 'image/jpeg' },
        body: broken,
      },
    )
    assert.equal(rejected.status, 422)
    assert.equal(rejected.json.error, 'unsupported_input')
    const after = await fetchJson(baseUrl, `/api/editor/projects/${projectId}`)
    assert.equal(after.json.project.revision, 1)
    assert.equal(Object.keys(after.json.project.canvases).length, 0)
  } finally {
    server.close()
  }
})

test('history routes bind canvas and project identities and reject precommit faults without index writes', async () => {
  const root = await tempRoot()
  const overrides = { v1CommitFault: null }
  const { server, baseUrl } = await startServer(root, overrides)
  const post = (pathname, body) => fetchJson(baseUrl, pathname, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  try {
    const first = await createProject(baseUrl)
    const second = await post('/api/editor/projects/v1', { operation_id: randomUUID() })
    const pid = first.json.project.id
    const otherPid = second.json.project.id
    const jpeg = await jpegBytes({ width: 2, height: 2 })
    let project = first.json.project
    const cids = []
    for (let i = 0; i < 2; i += 1) {
      const query = new URLSearchParams({ operation_id: randomUUID(), expected_revision: String(project.revision), expected_sha256: sha256Bytes(jpeg), name: `Gate ${i}` })
      const imported = await fetchJson(baseUrl, `/api/editor/projects/${pid}/sprite-documents/import-jpeg?${query}`, { method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: jpeg })
      assert.equal(imported.status, 201)
      project = imported.json.project
      cids.push(Object.keys(project.canvases).find((id) => !cids.includes(id)))
    }
    const route = (projectId, cid, action) => `/api/editor/projects/${projectId}/canvases/${cid}/${action}`
    const renamed = await post(route(pid, cids[0], 'rename'), { operation_id: randomUUID(), expected_revision: project.revision, display_name: 'Named' })
    assert.equal(renamed.status, 200)
    project = renamed.json.project
    let detachId
    for (const action of ['reset-name', 'detach', 'restore']) {
      const body = { operation_id: randomUUID(), expected_revision: project.revision, ...(action === 'restore' ? { detach_operation_id: detachId } : {}) }
      const beforeA = await fetchJson(baseUrl, `/api/editor/projects/${pid}`)
      const beforeB = await fetchJson(baseUrl, `/api/editor/projects/${otherPid}`)
      const indexPath = path.join(root, 'workspace', 'projects', pid, 'project.json')
      const beforeBytes = await readFile(indexPath)
      const crossProject = await post(route(otherPid, cids[0], action), { ...body, operation_id: randomUUID(), expected_revision: beforeB.json.project.revision })
      assert.equal(crossProject.status, 404, action)
      assert.deepEqual((await fetchJson(baseUrl, `/api/editor/projects/${otherPid}`)).json.project, beforeB.json.project)
      overrides.v1CommitFault = 'index'
      const failed = await post(route(pid, cids[0], action), body)
      overrides.v1CommitFault = null
      assert.equal(failed.status, 500, action)
      assert.equal(failed.json.error, 'storage_commit_failed')
      assert.deepEqual(await readFile(indexPath), beforeBytes)
      assert.deepEqual((await fetchJson(baseUrl, `/api/editor/projects/${pid}`)).json.project, beforeA.json.project)
      const success = await post(route(pid, cids[0], action), body)
      assert.equal(success.status, 200, action)
      project = success.json.project
      if (action === 'detach') detachId = body.operation_id
      const crossCanvas = await post(route(pid, cids[1], action), body)
      assert.equal(crossCanvas.status, 409, action)
      assert.equal(crossCanvas.json.error, 'operation_conflict')
      assert.equal(crossCanvas.json.project, undefined)
      assert.deepEqual((await fetchJson(baseUrl, `/api/editor/projects/${pid}`)).json.project, project)
    }
  } finally { server.close() }
})

test('reset-name removes only the label, and detach/restore keeps the same canvas identity', async () => {
  const root = await tempRoot()
  const { server, baseUrl } = await startServer(root)
  const resetOp = '55555555-5555-4555-8555-555555555555'
  const detachOp = '66666666-6666-4666-8666-666666666666'
  const restoreOp = '77777777-7777-4777-8777-777777777777'
  const conflictOp = '88888888-8888-4888-8888-888888888888'
  try {
    const created = await createProject(baseUrl)
    const projectId = created.json.project.id
    const jpeg = await jpegBytes({ width: 2, height: 2 })
    const digest = sha256Bytes(jpeg)
    const query = new URLSearchParams({
      operation_id: jpegOp,
      expected_revision: '1',
      expected_sha256: digest,
      name: 'Gate',
    })
    const imported = await fetchJson(baseUrl, `/api/editor/projects/${projectId}/sprite-documents/import-jpeg?${query}`, {
      method: 'POST',
      headers: { 'content-type': 'image/jpeg' },
      body: jpeg,
    })
    assert.equal(imported.status, 201)
    const canvasId = Object.keys(imported.json.project.canvases)[0]
    const documentId = imported.json.document.document_id
    const sourcePath = Object.values(imported.json.project.assets)[0].revisions
    const revision = Object.values(sourcePath)[0]
    const renamed = await fetchJson(baseUrl, `/api/editor/projects/${projectId}/canvases/${canvasId}/rename`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operation_id: renameOp, expected_revision: 2, display_name: 'North gate' }),
    })
    assert.equal(renamed.status, 200)
    const reset = await fetchJson(baseUrl, `/api/editor/projects/${projectId}/canvases/${canvasId}/reset-name`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operation_id: resetOp, expected_revision: renamed.json.project.revision }),
    })
    assert.equal(reset.status, 200)
    assert.equal(Object.hasOwn(reset.json.project.canvases[canvasId], 'display_name'), false)
    assert.equal(reset.json.project.sprite_documents[documentId].working_revision, 1)
    const resetReplay = await fetchJson(baseUrl, `/api/editor/projects/${projectId}/canvases/${canvasId}/reset-name`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operation_id: resetOp, expected_revision: renamed.json.project.revision }),
    })
    assert.equal(resetReplay.status, 200)
    assert.deepEqual(resetReplay.json.receipt, reset.json.receipt)
    assert.deepEqual(resetReplay.json.project, reset.json.project)
    const omitted = await fetchJson(baseUrl, `/api/editor/projects/${projectId}/canvases/${canvasId}/rename`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operation_id: replayOp, expected_revision: reset.json.project.revision }),
    })
    assert.equal(omitted.status, 400)
    const detached = await fetchJson(baseUrl, `/api/editor/projects/${projectId}/canvases/${canvasId}/detach`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operation_id: detachOp, expected_revision: reset.json.project.revision }),
    })
    assert.equal(detached.status, 200)
    assert.equal(detached.json.project.canvases[canvasId], undefined)
    assert.equal(detached.json.project.pages[0].canvas_order.includes(canvasId), false)
    assert.equal(detached.json.project.sprite_documents[documentId].working_revision, 1)
    const detachReplay = await fetchJson(baseUrl, `/api/editor/projects/${projectId}/canvases/${canvasId}/detach`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operation_id: detachOp, expected_revision: reset.json.project.revision }),
    })
    assert.equal(detachReplay.status, 200)
    assert.deepEqual(detachReplay.json.receipt, detached.json.receipt)
    assert.deepEqual(detachReplay.json.project, detached.json.project)
    const stored = await readFile(path.join(root, revision.artifacts.image))
    assert.equal(stored.equals(jpeg), true)
    const restored = await fetchJson(baseUrl, `/api/editor/projects/${projectId}/canvases/${canvasId}/restore`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        operation_id: restoreOp,
        expected_revision: detached.json.project.revision,
        detach_operation_id: detachOp,
      }),
    })
    assert.equal(restored.status, 200)
    assert.equal(restored.json.project.canvases[canvasId].document_id, documentId)
    assert.equal(restored.json.project.canvases[canvasId].x, 0)
    assert.equal(restored.json.project.pages[0].canvas_order[0], canvasId)
    const replay = await fetchJson(baseUrl, `/api/editor/projects/${projectId}/canvases/${canvasId}/restore`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        operation_id: restoreOp,
        expected_revision: detached.json.project.revision,
        detach_operation_id: detachOp,
      }),
    })
    assert.equal(replay.status, 200)
    assert.equal(replay.json.project.revision, restored.json.project.revision)
    assert.deepEqual(replay.json.receipt, restored.json.receipt)
    const conflict = await fetchJson(baseUrl, `/api/editor/projects/${projectId}/canvases/${canvasId}/restore`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        operation_id: restoreOp,
        expected_revision: detached.json.project.revision,
        detach_operation_id: conflictOp,
      }),
    })
    assert.equal(conflict.status, 409)
    assert.equal(conflict.json.error, 'operation_conflict')
    assert.equal(conflict.json.project, undefined)
    const stale = await fetchJson(baseUrl, `/api/editor/projects/${projectId}/canvases/${canvasId}/detach`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operation_id: conflictOp, expected_revision: detached.json.project.revision }),
    })
    assert.equal(stale.status, 409)
    assert.equal(stale.json.error, 'stale_revision')
    const cross = await fetchJson(baseUrl, `/api/editor/projects/${projectId}/canvases/${canvasId}/detach`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
      body: JSON.stringify({ operation_id: '99999999-9999-4999-8999-999999999999', expected_revision: restored.json.project.revision }),
    })
    assert.equal(cross.status, 403)
    const afterRejects = await fetchJson(baseUrl, `/api/editor/projects/${projectId}`)
    assert.equal(afterRejects.json.project.revision, restored.json.project.revision)
    assert.equal(afterRejects.json.project.canvases[canvasId].document_id, documentId)
  } finally {
    server.close()
  }
})
