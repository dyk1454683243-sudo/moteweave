import test from 'node:test'
import assert from 'node:assert/strict'
import { pixelCopySource, scopedPixelRequest, createPixelCopyOperation } from '../../src/ui/vnext/vnext-pixel-copy.js'
import { sha256Hex } from '../../src/ui/vnext/vnext-project-client.js'

function fixture() {
  const doc = { document_id: 'd', revision: 3, name: 'Image', canvas: { w: 1, h: 1 }, frame_order: ['f1', 'f2'], layer_order: ['l'],
    frames: { f1: { id: 'f1', duration_ms: 100 }, f2: { id: 'f2', duration_ms: 100 } },
    layers: { l: { id: 'l', name: 'Ink', kind: 'raster', locked: false } },
    cels: { a: { id: 'a', frame_id: 'f1', layer_id: 'l', block: null }, b: { id: 'b', frame_id: 'f2', layer_id: 'l', block: null } },
    links: { copy_layers: ['l'], groups: { g: ['b', 'a'] } } }
  const project = { id: 'p', revision: 7, canvases: { c: { id: 'c', document_id: 'd' } }, sprite_documents: { d: { working_revision: 3 } } }
  const source = pixelCopySource(project, 'c', new Map([['d', doc]]), { frame_id: 'f1', layer_id: 'l', cel_id: 'a' })
  source.rgba = new Uint8Array(4)
  return { doc, source }
}

test('linked targets freeze complete group and affected frames, even with no pixel selection', async () => {
  const { doc, source } = fixture(), calls = [], state = {}, pixels = Uint8Array.of(1, 2, 3, 255)
  assert.deepEqual(source.linkScope, { group_id: 'g', cel_ids: ['a', 'b'] }); assert.deepEqual(source.linkedFrames, [1, 2]); assert.equal(source.hasLinks, true)
  doc.links.groups.g.length = 0; assert.equal(source.linkScope.cel_ids.length, 2, 'captured source is not a live mutable group')
  const api = { createScopeGrant: async (project, document, body) => { calls.push({ project, document, body }); return { grant_id: 'grant', command_sha256: 'frozen' } } }
  const req = await scopedPixelRequest(api, source, pixels, { state })
  assert.equal(calls.length, 1); assert.deepEqual(calls[0].body.link_scope, source.linkScope); assert.deepEqual(calls[0].body.rect, { x: 0, y: 0, w: 1, h: 1 })
  assert.equal(req.grantId, 'grant'); assert.equal(req.commandSha256, 'frozen'); assert.equal(req.expectedSha256, await sha256Hex(pixels))
  assert.equal(await scopedPixelRequest(api, source, pixels, { state }), req); assert.equal(calls.length, 1)
})

test('derived linked copy gets a new destination group grant and retries one frozen pixel operation', async () => {
  const { doc, source } = fixture(), calls = [], requests = [], pixels = Uint8Array.of(4, 5, 6, 255)
  source.copyPosition = { x: 16, y: 0 }
  const dest = { ...doc, document_id: 'copy', revision: 1 }
  const api = {
    deriveWorking: async (_pid, body) => ({ project: { id: 'p', revision: 8 }, canvas: { id: 'copy_canvas', document_id: 'copy' }, document: dest,
      receipt: { operation_id: body.operationId, project_id: 'p', project_revision: 8, document_id: 'copy', document_revision: 1 } }),
    createScopeGrant: async (pid, did, body) => { calls.push({ pid, did, body }); return { grant_id: 'new_grant', command_sha256: 'new_command' } },
    writeWorkingPixels: async (_pid, did, request) => {
      requests.push(request); assert.equal(did, 'copy'); assert.equal(request.grantId, 'new_grant')
      if (requests.length === 1) throw Object.assign(new Error('lost response'), { kind: 'unknown' })
      return { project: { id: 'p', revision: 9 }, document: { ...dest, revision: 2 }, receipt: { operation_id: request.operationId, project_id: 'p', project_revision: 9, document_id: 'copy', document_revision: 2 } }
    },
    saveLayout: async (_pid, body) => ({ project: { id: 'p', revision: 10 }, receipt: { operation_id: body.operationId, project_id: 'p', project_revision: 10 } }),
  }
  const op = await createPixelCopyOperation({ source, rgba: pixels, api, isCurrent: () => true, onDerived: () => {}, refresh: async () => {} })
  await assert.rejects(op.run(), { kind: 'unknown' }); await op.run()
  assert.equal(calls.length, 1); assert.equal(calls[0].did, 'copy'); assert.equal(calls[0].body.expected_revision, 8)
  assert.equal(calls[0].body.expected_working_revision, 1); assert.deepEqual(calls[0].body.link_scope, source.linkScope)
  assert.equal(requests.length, 2); assert.equal(requests[0], requests[1])
})
