import test from 'node:test'
import assert from 'node:assert/strict'
import { createPixelCopyOperation, pixelCopyPosition } from '../../src/ui/vnext/vnext-pixel-copy.js'
import { createVnextProjectClient } from '../../src/ui/vnext/vnext-project-client.js'

const source = () => ({ projectId: 'project_a', projectRevision: 2, sourceCanvasId: 'c_old', sourceDocumentId: 'd_old',
  sourceRevision: 1, width: 2, height: 1, rgba: Uint8Array.of(255, 0, 0, 255, 0, 0, 255, 255), name: 'Original · copy' })
const fill = { type: 'fill-rect', rect: { x: 0, y: 0, w: 1, h: 1 }, color: [0, 255, 0, 255] }
const unknown = () => Object.assign(new Error('ack lost'), { kind: 'unknown' })
function fixture(overrides = {}) {
  const calls = [], histories = [], refreshes = []
  const derived = { project: { id: 'project_a', revision: 3 }, document: { document_id: 'd_new', revision: 1 },
    canvas: { id: 'c_new', document_id: 'd_new', x: 2, y: 0 }, receipt: { project_id: 'project_a', project_revision: 3, document_id: 'd_new', document_revision: 1 } }
  const saved = { ...derived, project: { id: 'project_a', revision: 4 }, document: { document_id: 'd_new', revision: 2 },
    receipt: { project_id: 'project_a', project_revision: 4, document_id: 'd_new', document_revision: 2 } }
  const api = {
    async deriveWorking(id, body) { calls.push(['derive', id, body]); derived.receipt.operation_id = body.operationId; if (overrides.derive) return overrides.derive(derived); return derived },
    async writeWorkingPixels(id, doc, body) { calls.push(['pixels', id, doc, body]); saved.receipt.operation_id = body.operationId; if (overrides.write) return overrides.write(saved); return saved },
    async saveLayout(id, body) { calls.push(['position', id, body]); if (overrides.position) return overrides.position(body); return { project: { id, revision: 5 }, receipt: { operation_id: body.operationId, project_id: id, project_revision: 5 } } },
  }
  const options = { source: source(), operation: fill, api, isCurrent: () => true,
    onDerived: value => histories.push(value.canvas.id), refresh: async value => { refreshes.push(value); await overrides.refresh?.() } }
  return { calls, histories, refreshes, options }
}

test('single copy writes actual candidate, preserves original bytes, records history once and refreshes saved result', async () => {
  for (const operation of [fill, { type: 'erase', rect: fill.rect },
    { type: 'replace-color', rect: fill.rect, from: [255, 0, 0, 255], to: [0, 255, 0, 255] }]) {
    const f = fixture(), before = f.options.source.rgba.slice()
    const op = await createPixelCopyOperation({ ...f.options, operation })
    await op.run(); await op.run()
    assert.equal(op.phase, 'done'); assert.deepEqual(f.histories, ['c_new'])
    assert.deepEqual(f.calls.map(c => c[0]), ['derive', 'pixels'])
    assert.equal(f.calls[1][2], 'd_new')
    assert.deepEqual([...f.calls[1][3].bytes], operation.type === 'erase' ? [0, 0, 0, 0, 0, 0, 255, 255] : [0, 255, 0, 255, 0, 0, 255, 255])
    assert.deepEqual(f.options.source.rgba, before); assert.equal(f.refreshes.length, 1)
  }
})

test('invalid and no-op candidates never derive or write', async () => {
  const f = fixture()
  await assert.rejects(createPixelCopyOperation({ ...f.options, operation: { ...fill, rect: { x: 2, y: 0, w: 1, h: 1 } } }), { code: 'invalid_request' })
  await assert.rejects(createPixelCopyOperation({ ...f.options, operation: { ...fill, color: [255, 0, 0, 255] } }), { code: 'pixel_no_change' })
  assert.equal(f.calls.length, 0)
})

test('unknown derive and pixel ACKs recover exact frozen requests without duplicate history or model calls', async () => {
  let derives = 0, writes = 0
  const f = fixture({ derive: result => { if (++derives === 1) throw unknown(); return result },
    write: result => { if (++writes === 1) throw unknown(); return result } })
  const op = await createPixelCopyOperation(f.options)
  await assert.rejects(op.run(), { kind: 'unknown' }); assert.equal(op.phase, 'derive')
  await assert.rejects(op.run(), { kind: 'unknown' }); assert.equal(op.phase, 'pixels')
  await op.run()
  assert.equal(f.calls[0][2], f.calls[1][2]); assert.equal(f.calls[2][3], f.calls[3][3])
  assert.deepEqual(f.histories, ['c_new']); assert.equal(f.refreshes.length, 1)
})

test('confirmed copy followed by rejected pixels stays partial; successful pixels plus failed refresh only reload', async () => {
  const bad = fixture({ write: () => { throw Object.assign(new Error('conflict'), { kind: 'stale' }) } })
  const partial = await createPixelCopyOperation(bad.options)
  await assert.rejects(partial.run(), { kind: 'stale' }); assert.equal(partial.derived.canvas.id, 'c_new')
  assert.equal(partial.saved, undefined); assert.deepEqual(bad.histories, ['c_new'])
  let refreshes = 0
  const f = fixture({ refresh: () => { if (++refreshes === 1) throw new Error('read failed') } })
  const op = await createPixelCopyOperation(f.options)
  await assert.rejects(op.run(), /read failed/); assert.equal(op.phase, 'refresh')
  await op.run(); assert.equal(f.calls.length, 2); assert.equal(f.refreshes.length, 2)
})

test('late derive never submits pixels after project/open epoch changes; concurrent run is rejected', async () => {
  let release, live = true
  const f = fixture({ derive: result => new Promise(resolve => { release = () => resolve(result) }) })
  const op = await createPixelCopyOperation({ ...f.options, isCurrent: () => live })
  const pending = op.run()
  await assert.rejects(op.run(), { code: 'assistant_busy' })
  live = false; release()
  await assert.rejects(pending, { code: 'assistant_context_changed' })
  assert.equal(f.calls.length, 1); assert.equal(f.histories.length, 0); assert.equal(f.refreshes.length, 0)
})

test('visible source draft placement avoids neighbors and persists only the new canvas position', async () => {
  const f = fixture()
  const view = { canvases: [{ id: 'c_old', width: 2, height: 1 }, { id: 'other', width: 2, height: 1 }],
    positionOf: id => id === 'c_old' ? { x: 10, y: 8 } : { x: 28, y: 8 } }
  f.options.source.copyPosition = pixelCopyPosition(view, f.options.source)
  assert.deepEqual(f.options.source.copyPosition, { x: 46, y: 8 })
  await (await createPixelCopyOperation(f.options)).run()
  assert.deepEqual(f.calls[2][2].positions, [{ canvas_id: 'c_new', x: 46, y: 8 }])
  assert.equal(f.calls[2][2].expectedRevision, 4)
})

test('ACK replay with a newer project cannot raise the next write boundary over an external move', async () => {
  for (const phase of ['derive', 'pixels']) {
    let once = true
    const replay = result => { if (once) { once = false; throw unknown() } return { ...result, project: { ...result.project, revision: 9 } } }
    const f = fixture(phase === 'derive' ? { derive: replay,
      write: () => { throw Object.assign(new Error('must conflict'), { kind: 'stale' }) } } : { write: replay,
      position: () => { throw Object.assign(new Error('external position must survive'), { kind: 'stale' }) } })
    f.options.source.copyPosition = { x: 10, y: 8 }
    const op = await createPixelCopyOperation(f.options)
    await assert.rejects(op.run(), { kind: 'unknown' })
    await assert.rejects(op.run(), { kind: 'stale' })
    const last = f.calls.at(-1)
    assert.equal(last[0], phase === 'derive' ? 'pixels' : 'position')
    assert.equal(last.at(-1).expectedRevision, phase === 'derive' ? 3 : 4)
    assert.notEqual(last.at(-1).expectedRevision, 9)
  }
})

test('unknown position ACK retries only the identical new-canvas layout request', async () => {
  let once = true
  const f = fixture({ position: body => {
    if (once) { once = false; throw unknown() }
    return { project: { id: 'project_a', revision: 5 }, receipt: { operation_id: body.operationId, project_id: 'project_a', project_revision: 5 } }
  } })
  f.options.source.copyPosition = { x: 10, y: 8 }
  const op = await createPixelCopyOperation(f.options)
  await assert.rejects(op.run(), { kind: 'unknown' }); assert.equal(op.phase, 'position')
  await op.run()
  assert.deepEqual(f.calls.map(c => c[0]), ['derive', 'pixels', 'position', 'position'])
  assert.equal(f.calls[2][2], f.calls[3][2]); assert.deepEqual(f.histories, ['c_new'])
})

test('thin browser methods use only existing B routes and exact raw RGBA bytes', async () => {
  const calls = []
  const api = createVnextProjectClient({ fetchImpl: async (url, init) => {
    calls.push({ url, init }); return { ok: true, status: 201, headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ project: { id: 'p' }, document: { document_id: 'd' }, receipt: {} }) }
  } })
  await api.deriveWorking('p', { operationId: 'op', expectedRevision: 2, sourceCanvasId: 'c', sourceDocumentId: 'd', sourceRevision: 1, name: 'Copy' })
  const bytes = Uint8Array.of(1, 2, 3, 4)
  await api.writeWorkingPixels('p', 'new', { operationId: 'write', expectedRevision: 3, expectedWorkingRevision: 1,
    width: 1, height: 1, expectedSha256: 'a'.repeat(64), bytes })
  assert.match(calls[0].url, /\/sprite-documents\/derive-working$/)
  assert.equal(JSON.parse(calls[0].init.body).source_canvas_id, 'c')
  assert.match(calls[1].url, /\/new\/working-pixels\?/); assert.equal(calls[1].init.body, bytes)
  assert.equal(new URL(calls[1].url, 'http://localhost').searchParams.get('expected_working_revision'), '1')
})
