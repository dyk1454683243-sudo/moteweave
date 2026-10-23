import test from 'node:test'
import assert from 'node:assert/strict'
import { createVnextProjectClient } from '../../src/ui/vnext/vnext-project-client.js'

test('blank unknown response and missing receipt retain exactly the same operation for retry', async () => {
  for (const mode of ['network', 'missing', 'wrong-operation', 'incomplete']) {
    const calls = [], operationId = '66666666-6666-4666-8666-666666666661'
    const client = createVnextProjectClient({ fetchImpl: async (url, spec) => {
      calls.push({ url, body: spec.body })
      if (calls.length === 1 && mode === 'network') throw new Error('connection reset')
      const body = calls.length === 1 ? mode === 'missing' ? {}
        : mode === 'incomplete' ? { project: { id: 'p_test', revision: 2 }, document: {}, receipt: { operation_id: operationId, project_id: 'p_test' } }
        : { receipt: { operation_id: 'wrong' } }
        : { project: { id: 'p_test', revision: 2 }, document: { document_id: 'd_test', revision: 1 },
          receipt: { operation_id: operationId, project_id: 'p_test', document_id: 'd_test', document_revision: 1, project_revision: 2 } }
      return { ok: true, status: 201, headers: new Headers(), json: async () => body }
    } })
    await assert.rejects(client.createBlank('p_test', { operationId, expectedRevision: 1, width: 64, height: 64, name: 'Canvas' }), e => e.kind === 'unknown')
    assert.ok(client.lastUnknown())
    const result = await client.retryUnknown()
    assert.equal(result.body.receipt.operation_id, operationId)
    assert.deepEqual(calls[1], calls[0])
    assert.equal(JSON.parse(calls[1].body).operation_id, operationId)
    assert.equal(client.lastUnknown(), null)
  }
})

test('zero and negative document revisions stay unknown and retry the same bytes', async () => {
  for (const revision of [0, -1]) {
    const calls = []
    const operationId = '66666666-6666-4666-8666-666666666661'
    const client = createVnextProjectClient({ fetchImpl: async (url, spec) => {
      calls.push({ url, body: spec.body })
      const body = calls.length === 1
        ? { project: { id: 'p_test', revision: 2 }, document: { document_id: 'd_test', revision },
          receipt: { operation_id: operationId, project_id: 'p_test', document_id: 'd_test', document_revision: revision, project_revision: 2 } }
        : { project: { id: 'p_test', revision: 2 }, document: { document_id: 'd_test', revision: 1 },
          receipt: { operation_id: operationId, project_id: 'p_test', document_id: 'd_test', document_revision: 1, project_revision: 2 } }
      return { ok: true, status: 201, headers: new Headers(), json: async () => body }
    } })
    await assert.rejects(client.createBlank('p_test', { operationId, expectedRevision: 1, width: 64, height: 64, name: 'Canvas' }), (error) => error.kind === 'unknown')
    assert.ok(client.lastUnknown())
    const result = await client.retryUnknown()
    assert.equal(result.body.receipt.document_revision, 1)
    assert.deepEqual(calls[1], calls[0])
    assert.equal(JSON.parse(calls[1].body).operation_id, operationId)
    assert.equal(client.lastUnknown(), null)
  }
})
