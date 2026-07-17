import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  createEditorArtifactAccessRegistry,
  handleEditorProjectApi,
} from '../../src/editor-project/index.js'

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))
}

async function startApi(options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'editor-frame-repair-quality-gate-api-'))
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

function post(body) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }
}

async function fetchJson(baseUrl, pathname, options = {}) {
  const response = await fetch(new URL(pathname, baseUrl), options)
  const text = await response.text()
  return { status: response.status, json: text ? JSON.parse(text) : {} }
}

test('delegates each exact quality-gate route once with the documented status', async (t) => {
  const calls = []
  const coordinator = Object.freeze({
    async setupQualityGate(input) { calls.push(['setup', input]); return { kind: 'setup' } },
    async planQualityGate(input) { calls.push(['plan', input]); return { kind: 'plan' } },
    async startQualityGate(input) { calls.push(['start', input]); return { kind: 'start' } },
    async getQualityGate(input) { calls.push(['get', input]); return { kind: 'get' } },
    async recordQualityGateReview(input) { calls.push(['review', input]); return { kind: 'review' } },
    async recordQualityGateOutcome(input) { calls.push(['outcome', input]); return { kind: 'outcome' } },
    async finalizeQualityGate(input) { calls.push(['finalize', input]); return { kind: 'finalize' } },
  })
  const { server, baseUrl } = await startApi({ frameRepairQualityGateCoordinator: coordinator })
  t.after(() => server.close())
  const root = '/api/editor/projects/project_gate/frame-repair-quality-gates'
  const setupBody = { request: 'setup' }
  const planBody = { request: 'plan' }
  const startBody = { request: 'start' }
  const reviewBody = { request: 'review' }
  const outcomeBody = { request: 'outcome' }
  const finalizeBody = { request: 'finalize' }
  const responses = [
    await fetchJson(baseUrl, `${root}/setup`, post(setupBody)),
    await fetchJson(baseUrl, `${root}/plan`, post(planBody)),
    await fetchJson(baseUrl, root, post(startBody)),
    await fetchJson(baseUrl, `${root}/frqg_20260713_primary`),
    await fetchJson(baseUrl, `${root}/frqg_20260713_primary/cases/case_shape_01/review`, post(reviewBody)),
    await fetchJson(baseUrl, `${root}/frqg_20260713_primary/cases/case_shape_01/outcome`, post(outcomeBody)),
    await fetchJson(baseUrl, `${root}/frqg_20260713_primary/finalize`, post(finalizeBody)),
  ]
  assert.deepEqual(responses.map((item) => item.status), [201, 200, 201, 200, 200, 200, 200])
  assert.deepEqual(calls, [
    ['setup', { sourceProjectId: 'project_gate', body: setupBody }],
    ['plan', { projectId: 'project_gate', body: planBody }],
    ['start', { projectId: 'project_gate', body: startBody }],
    ['get', { projectId: 'project_gate', sessionId: 'frqg_20260713_primary' }],
    ['review', { projectId: 'project_gate', sessionId: 'frqg_20260713_primary', caseId: 'case_shape_01', body: reviewBody }],
    ['outcome', { projectId: 'project_gate', sessionId: 'frqg_20260713_primary', caseId: 'case_shape_01', body: outcomeBody }],
    ['finalize', { projectId: 'project_gate', sessionId: 'frqg_20260713_primary', body: finalizeBody }],
  ])
})

test('unwired, oversized, and controlled failures use stable statuses without leaking unsafe error data', async (t) => {
  const unavailable = await startApi()
  t.after(() => unavailable.server.close())
  const root = '/api/editor/projects/project_gate/frame-repair-quality-gates'
  const missing = await fetchJson(unavailable.baseUrl, `${root}/plan`, post({}))
  assert.equal(missing.status, 503)
  assert.equal(missing.json.error, 'frame_repair_quality_gate_unavailable')

  let calls = 0
  const coordinator = {
    async planQualityGate({ body }) {
      calls += 1
      if (body.code) {
        const error = new Error(`remote secret /tmp/private ${body.code}`)
        error.code = body.code
        error.stack = 'private stack'
        error.cause = { apiKey: 'secret' }
        error.details = {
          reasons: ['revision_chain_drift'],
          current_revision: 2,
          path: '/tmp/private',
          secret: 'DO_NOT_LEAK',
        }
        throw error
      }
      return { ok: true }
    },
  }
  const injected = await startApi({ frameRepairQualityGateCoordinator: coordinator })
  t.after(() => injected.server.close())
  for (const [code, status] of [
    ['invalid_quality_gate_plan', 400],
    ['request_too_large', 413],
    ['session_not_found', 404],
    ['session_id_conflict', 409],
    ['artifact_integrity_failed', 422],
    ['provider_unavailable', 503],
  ]) {
    if (code === 'request_too_large') continue
    const response = await fetchJson(injected.baseUrl, `${root}/plan`, post({ code }))
    assert.equal(response.status, status, code)
    assert.equal(response.json.error, code)
    const serialized = JSON.stringify(response.json)
    for (const forbidden of ['/tmp/private', 'DO_NOT_LEAK', 'private stack', 'apiKey', 'secret']) {
      assert.equal(serialized.includes(forbidden), false)
    }
    assert.deepEqual(response.json.details, {
      reasons: ['revision_chain_drift'],
      current_revision: 2,
    })
  }
  const beforeOversized = calls
  const oversized = await fetchJson(injected.baseUrl, `${root}/plan`, post({
    padding: 'x'.repeat(128 * 1024),
  }))
  assert.equal(oversized.status, 413)
  assert.equal(oversized.json.error, 'request_too_large')
  assert.equal(calls, beforeOversized)
})
