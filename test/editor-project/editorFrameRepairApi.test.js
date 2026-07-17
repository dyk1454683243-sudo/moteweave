import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

import {
  createEditorArtifactAccessRegistry,
  handleEditorProjectApi,
} from '../../src/editor-project/index.js'

async function tempRoot() {
  return mkdtemp(path.join(os.tmpdir(), 'editor-frame-repair-api-'))
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  })
}

async function startEditorApi(options = {}) {
  const root = await tempRoot()
  const server = http.createServer((req, res) => handleEditorProjectApi(req, res, {
    projectRoot: root,
    workspaceRoot: path.join(root, 'workspace'),
    generatedDir: path.join(root, 'generated'),
    artifactAccessRegistry: createEditorArtifactAccessRegistry(),
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

function post(body = {}) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }
}

test('Editor API delegates the four exact Frame Repair routes', async (t) => {
  const calls = []
  const frameRepairCoordinator = Object.freeze({
    async planFrameRepair(input) {
      calls.push(['plan', input])
      return { kind: 'plan' }
    },
    async submitFrameRepair(input) {
      calls.push(['live', input])
      return { kind: 'live' }
    },
    async getFrameRepairOperation(input) {
      calls.push(['operation', input])
      return { kind: 'operation' }
    },
    async acceptFrameRepair(input) {
      calls.push(['accept', input])
      return { kind: 'accept', accepted: true }
    },
  })
  const { server, baseUrl } = await startEditorApi({ frameRepairCoordinator })
  t.after(() => server.close())

  const route = '/api/editor/projects/project_demo/assets/asset_hero/frame-repair'
  const planBody = { request: 'plan' }
  const liveBody = { request: 'live' }
  const acceptBody = { request: 'accept' }
  const plan = await fetchJson(baseUrl, `${route}/plan`, post(planBody))
  const live = await fetchJson(baseUrl, route, post(liveBody))
  const operation = await fetchJson(baseUrl, `${route}/operations/fr_0123456789abcdef`)
  const accepted = await fetchJson(baseUrl, `${route}/job_frame_repair/accept`, post(acceptBody))

  assert.deepEqual([plan.status, live.status, operation.status, accepted.status], [200, 202, 200, 200])
  assert.deepEqual(calls, [
    ['plan', { projectId: 'project_demo', assetId: 'asset_hero', body: planBody }],
    ['live', { projectId: 'project_demo', assetId: 'asset_hero', body: liveBody }],
    ['operation', {
      projectId: 'project_demo',
      assetId: 'asset_hero',
      operationId: 'fr_0123456789abcdef',
    }],
    ['accept', {
      projectId: 'project_demo',
      assetId: 'asset_hero',
      jobId: 'job_frame_repair',
      body: acceptBody,
    }],
  ])
})

test('unwired Frame Repair routes and controlled errors keep stable statuses', async (t) => {
  const unavailable = await startEditorApi()
  t.after(() => unavailable.server.close())
  const route = '/api/editor/projects/project_demo/assets/asset_hero/frame-repair'
  for (const [pathname, options] of [
    [`${route}/plan`, post()],
    [route, post()],
    [`${route}/operations/fr_0123456789abcdef`, {}],
    [`${route}/job_frame_repair/accept`, post()],
  ]) {
    const response = await fetchJson(unavailable.baseUrl, pathname, options)
    assert.equal(response.status, 503)
    assert.equal(response.json.error, 'frame_repair_unavailable')
  }

  const coordinator = Object.freeze({
    async planFrameRepair({ body }) {
      throw Object.assign(new Error(body.code), { code: body.code })
    },
    async acceptFrameRepair() {
      throw Object.assign(new Error('identity changed'), { code: 'identity_mismatch' })
    },
  })
  const injected = await startEditorApi({ frameRepairCoordinator: coordinator })
  t.after(() => injected.server.close())
  for (const [code, status] of [
    ['invalid_frame_repair_request', 400],
    ['operation_not_found', 404],
    ['stale_plan', 409],
    ['quality_blocked', 422],
    ['provider_unavailable', 503],
    ['provider_configuration_error', 503],
  ]) {
    const response = await fetchJson(injected.baseUrl, `${route}/plan`, post({ code }))
    assert.equal(response.status, status, code)
    assert.equal(response.json.error, code)
  }
  const identityConflict = await fetchJson(
    injected.baseUrl,
    `${route}/job_frame_repair/accept`,
    post({}),
  )
  assert.equal(identityConflict.status, 409)
  assert.equal(identityConflict.json.error, 'identity_mismatch')
})

test('general import blocks an in-memory Frame Repair job before project mutation', async (t) => {
  const frameRepairService = Object.freeze({
    getJob(jobId) {
      return jobId === 'job_frame_repair'
        ? { id: jobId, type: 'editor_character_frame_repair' }
        : null
    },
  })
  const { server, baseUrl } = await startEditorApi({ frameRepairService })
  t.after(() => server.close())
  const response = await fetchJson(
    baseUrl,
    '/api/editor/projects/project_demo/import-job',
    post({ jobId: 'job_frame_repair', expectedRevision: 1, kind: 'character_pack' }),
  )
  assert.equal(response.status, 400)
  assert.equal(response.json.error, 'specialized_accept_required')
})
