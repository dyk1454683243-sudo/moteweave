import test from 'node:test'
import assert from 'node:assert/strict'
import { createVnextProjectClient } from '../../src/ui/vnext/vnext-project-client.js'
import { projectPalette, sameColor } from '../../src/ui/vnext/vnext-palette.js'
test('palette defaults are independent copies, absence differs from empty and exact RGBA includes alpha', () => {
  const a = projectPalette(null), b = projectPalette(null)
  a[0][0] = 0; assert.equal(b.length, 24); assert.deepEqual(b[0], [255,255,255,255])
  assert.deepEqual(projectPalette({ settings: { palette: { colors: [] } } }), [])
  assert.equal(sameColor([1,2,3,0], [1,2,3,255]), false)
})
test('palette client requires matching receipt; failed request retry uses identical JSON', async () => {
  const seen = [], req = { operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', expectedRevision: 4, colors: [[1,2,3,128]] }
  let mode = 'lost'
  const api = createVnextProjectClient({ fetchImpl: async (url, init) => {
    seen.push({ url, body: init.body })
    if (mode === 'lost') throw Error('network lost')
    const receipt = { operation_id: req.operationId, project_id: 'p', project_revision: 5, document_id: null, document_revision: null, payload_sha256: 'a'.repeat(64) }
    return new Response(JSON.stringify(mode === 'bad' ? { project: { id: 'p', revision: 5 } } : { project: { id: 'p', revision: 5 }, receipt }), { headers: { 'content-type': 'application/json' } })
  } })
  await assert.rejects(api.savePalette('p', req), { kind: 'unknown' })
  mode = 'ok'; await api.savePalette('p', req); assert.deepEqual(seen[0], seen[1])
  mode = 'bad'; await assert.rejects(api.savePalette('p', req), { kind: 'unknown' })
})
