import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createExternalPixelSessions } from '../../src/editor-project/externalPixelSession.js'
import { runPixelToolsCommand } from '../../scripts/pixel-tools-cli.mjs'
import { externalPixelLink, readExternalPixels } from '../../src/ui/vnext/vnext-external-pixels.js'

const paint = { type: 'fill-rect', rect: { x: 20, y: 30, w: 4, h: 5 }, color: [255, 80, 0, 255] }
function fixture({ rgba = null, grant = null } = {}) {
  const project = { version: 'editor_project_v1', id: 'project_a', revision: 2,
    canvases: { canvas_a: { id: 'canvas_a', document_id: 'doc_a' } }, sprite_documents: { doc_a: { working_revision: 1 } } }
  const scope = { projectRoot: '/fixture', workspaceRoot: '/fixture/workspace', projectId: project.id }
  const manifest = { revision: 1, canvas: { w: 64, h: 64 }, frame_order: ['f'], layer_order: ['l'],
    layers: { l: { locked: false, visible: true } }, cels: { c: { id: 'c', frame_id: 'f', layer_id: 'l', block: rgba ? { sha256: 'blk', w: 64, h: 64 } : null } } }
  let time = 0, intercept
  const service = createExternalPixelSessions({
    load: async () => { await intercept?.(); return { project } },
    readDocument: async () => ({ manifest }),
    readBlock: async () => ({ bytes: rgba || new Uint8Array(16384) }),
    readGrant: async (_scope, _proj, _man, grantId) => {
      if (grant && grant.grant_id === grantId) return grant
      throw new Error('grant_not_found')
    },
    now: () => time,
    ttl: 1000,
  })
  const body = { operation_id: randomUUID(), canvas_id: 'canvas_a', expected_revision: 2, expected_working_revision: 1 }
  const call = (id, tool, args = {}, operation_id = randomUUID()) => service.call(scope, id, { operation_id, tool, arguments: args })
  return { project, scope, manifest, service, body, call, expire: () => { time = 1001 }, intercept: fn => { intercept = fn } }
}

test('external tools reuse kernel, idempotent batches, candidate-only undo and sealed review', async () => {
  const f = fixture(), opened = await f.service.create(f.scope, f.body), id = opened.session_id
  assert.equal((await f.service.create(f.scope, f.body)).session_id, id)
  const operation = randomUUID(), drawn = await f.call(id, 'draw_pixels', { operations: [paint] }, operation)
  assert.deepEqual(await f.call(id, 'draw_pixels', { operations: [paint] }, operation), drawn)
  await assert.rejects(f.call(id, 'close', {}, operation), { code: 'pixel_tool_operation_conflict' })
  await assert.rejects(f.call(id, 'undo_pixels', {}, operation), { code: 'pixel_tool_operation_conflict' })
  await f.call(id, 'undo_pixels'); await f.call(id, 'draw_pixels', { operations: [paint] })
  const review = await f.call(id, 'review'), result = await f.service.review(f.scope, id)
  assert.match(review.review_path, /#pixel-preview=project_a\//)
  assert.equal(result.pixel_candidate.drawing_batches, 2); assert.equal(result.pixel_candidate.tool_calls, 3)
  assert.deepEqual([...Buffer.from(result.pixel_candidate.rgba_hex, 'hex').subarray(7760, 7764)], paint.color)
  assert.equal(f.project.revision, 2); assert.equal(result.saved, false)
  await assert.rejects(f.call(id, 'draw_pixels', { operations: [paint] }), { code: 'pixel_tool_preview_sealed' })
  const link = { projectId: 'project_a', sessionId: id }
  const validated = await readExternalPixels(link, async () => new Response(JSON.stringify(result)))
  assert.equal(validated.rgba.length, 16384)
  assert.equal(externalPixelLink(new URL('http://localhost' + review.review_path).hash).sessionId, id)
})
test('external source scope, malformed operations, close, expiry and stale versions fail closed', async () => {
  const f = fixture(), { session_id: id } = await f.service.create(f.scope, f.body)
  await assert.rejects(f.service.review({ ...f.scope, projectId: 'other' }, id), { code: 'pixel_tool_session_expired' })
  await assert.rejects(f.call(id, 'save', {}), { code: 'invalid_pixel_tool_request' })
  await assert.rejects(f.call(id, 'draw_pixels', { operations: [paint, { ...paint, rect: { x: 63, y: 0, w: 2, h: 1 } }] }))
  await f.call(id, 'review'); const candidate = (await f.service.review(f.scope, id)).pixel_candidate
  assert.equal(candidate.drawing_batches, 0); assert.equal(candidate.sha256, candidate.source_sha256)
  f.project.revision++; await assert.rejects(f.service.review(f.scope, id), { code: 'pixel_tool_context_changed' })
  await f.call(id, 'close'); await assert.rejects(f.service.review(f.scope, id), { code: 'pixel_tool_session_expired' })
  const g = fixture(), next = await g.service.create(g.scope, g.body)
  g.expire(); await assert.rejects(g.call(next.session_id, 'read_canvas'), { code: 'pixel_tool_session_expired' })
})
test('unsupported targets, creation conflict and session capacity are bounded', async () => {
  for (const change of [f => { f.manifest.layers.l.locked = true }, f => { f.manifest.layers.l.visible = false },
    f => { f.manifest.canvas.w = 65 }, f => { f.manifest.frame_order.push('f2') }]) {
    const f = fixture(); change(f); await assert.rejects(f.service.create(f.scope, f.body), { code: 'pixel_tool_target_unsupported' })
  }
  const f = fixture(); await f.service.create(f.scope, f.body)
  await assert.rejects(f.service.create(f.scope, { ...f.body, canvas_id: 'other' }), { code: 'pixel_tool_operation_conflict' })
  for (let i = 1; i < 24; i++) await f.service.create(f.scope, { ...f.body, operation_id: randomUUID() })
  await assert.rejects(f.service.create(f.scope, { ...f.body, operation_id: randomUUID() }), { code: 'pixel_tool_session_limit' })
})
test('concurrent tool commands cannot interleave; closing rejects an outstanding command', async () => {
  const f = fixture(), { session_id: id } = await f.service.create(f.scope, f.body)
  let release; f.intercept(() => new Promise(resolve => { release = resolve }))
  const operation = randomUUID(), active = f.call(id, 'read_canvas', {}, operation)
  await assert.rejects(f.call(id, 'close', {}, operation), { code: 'pixel_tool_operation_conflict' })
  await assert.rejects(f.call(id, 'draw_pixels', { operations: [paint] }), { code: 'pixel_tool_busy' })
  await f.call(id, 'close'); f.intercept(null); release()
  await assert.rejects(active, { code: 'pixel_tool_session_expired' })
})
test('CLI restricts origin, emits compact observation, saves only new preview files and never retries', async () => {
  let calls = 0, write
  const input = { action: 'read_canvas', project_id: 'project_a', session_id: randomUUID() }
  const f = fixture(), { session_id: id } = await f.service.create(f.scope, f.body), result = await f.call(id, 'read_canvas')
  const options = { url: 'http://127.0.0.1:7777', image: '/explicit/preview.png', fetchImpl: async (url, request) => {
    calls++; assert.match(url, /^http:\/\/127.0.0.1:7777\/api\/editor\/projects\/project_a\/pixel-tools\//)
    assert.equal(request.redirect, 'error'); return new Response(JSON.stringify(result))
  }, writeImage: async (...args) => { write = args } }
  const output = await runPixelToolsCommand(input, options)
  assert.equal(output.contentItems, undefined); assert.equal(output.observation.saved, false); assert.equal(calls, 1)
  assert.equal(write[2].flag, 'wx'); assert.equal(write[1].subarray(1, 4).toString(), 'PNG')
  await assert.rejects(runPixelToolsCommand(input, { ...options, url: 'https://example.com' })); assert.equal(calls, 1)
  await assert.rejects(runPixelToolsCommand({ ...input, project_id: '../other' }, options)); assert.equal(calls, 1)
  await assert.rejects(runPixelToolsCommand(input, { ...options, fetchImpl: async () => { calls++; throw Error('disconnected') } })); assert.equal(calls, 2)
  await assert.rejects(runPixelToolsCommand(input, { ...options, writeImage: async () => { throw Error('EEXIST') } }), e => Boolean(e.operation_id && e.message === 'EEXIST'))
  await assert.rejects(runPixelToolsCommand(input, { ...options, fetchImpl: async () => new Response(new ReadableStream({ start(c) { c.error(Error('body timed out')) } })) }), e => Boolean(e.operation_id && e.message === 'body timed out'))
})
test('close during replay or the final source check cannot return a late success', async () => {
  for (const mode of ['replay', 'final', 'create-replay']) {
    const f = fixture(), { session_id: id } = await f.service.create(f.scope, f.body), op = randomUUID()
    if (mode === 'replay') await f.call(id, 'read_canvas', {}, op)
    let release, reads = 0
    f.intercept(() => { reads++; if (reads === (mode === 'final' ? 3 : 1)) return new Promise(resolve => { release = resolve }) })
    const active = mode === 'create-replay' ? f.service.create(f.scope, f.body) : f.call(id, 'read_canvas', {}, op)
    // Three microtask-delimited load checks precede the final response.
    for (let i = 0; i < 20 && !release; i++) await Promise.resolve()
    assert.equal(typeof release, 'function', mode)
    await f.call(id, 'close'); f.intercept(null); release()
    await assert.rejects(active, { code: 'pixel_tool_session_expired' })
  }
})
test('external UI rejects injected links, mismatched target and modified candidate bytes', async () => {
  assert.equal(externalPixelLink('#pixel-preview=../bad/not-a-session'), null)
  const f = fixture(), { session_id: id } = await f.service.create(f.scope, f.body)
  await f.call(id, 'review'); const result = await f.service.review(f.scope, id), link = { projectId: 'project_a', sessionId: id }
  result.pixel_candidate.sha256 = '0'.repeat(64)
  await assert.rejects(readExternalPixels(link, async () => new Response(JSON.stringify(result))))
  result.context.project_id = 'other'
  await assert.rejects(readExternalPixels(link, async () => new Response(JSON.stringify(result))))
})
test('a rejected external drawing replays the same diagnostic without drawing', async () => {
  const f = fixture(), { session_id: id } = await f.service.create(f.scope, f.body)
  const operation = randomUUID()
  const bad = { operations: [{ type: 'fill-rect', rect: { x: 63, y: 0, w: 2, h: 1 }, color: [1, 2, 3, 255] }] }
  await assert.rejects(f.call(id, 'draw_pixels', bad, operation), error => error.code === 'assistant_tool_blocked' && error.diagnostic.rule === 'rect_bounds')
  await assert.rejects(f.call(id, 'draw_pixels', bad, operation), error => error.diagnostic.rule === 'rect_bounds' && error.code === 'assistant_tool_blocked')
  assert.equal(f.project.revision, 2)
})

test('N1 external session preserves >62-color legacy compatibility, rejects grantless regional parameters, and requires server-verified grant_id for read_region and patch_region', async () => {
  // 1. 63-color binary-alpha legacy session without grant_id succeeds and exposes only legacy tools
  const many = new Uint8Array(64 * 64 * 4)
  for (let i = 0; i < 63; i += 1) {
    many[i * 4] = i; many[i * 4 + 1] = 10; many[i * 4 + 2] = 20; many[i * 4 + 3] = 255
  }
  const legacyF = fixture({ rgba: many })
  const legacyCreated = await legacyF.service.create(legacyF.scope, legacyF.body)
  assert.deepEqual(legacyCreated.tools.map(t => t.name), ['read_canvas', 'draw_pixels', 'undo_pixels'])
  assert.equal(legacyCreated.context.codebook_hash, null)
  await legacyF.call(legacyCreated.session_id, 'read_canvas')
  await legacyF.call(legacyCreated.session_id, 'draw_pixels', { operations: [paint] })
  await assert.rejects(
    legacyF.call(legacyCreated.session_id, 'read_region', {}),
    error => error.code === 'assistant_tool_blocked' && error.diagnostic?.reason === 'authorization',
  )
  await assert.rejects(
    legacyF.call(legacyCreated.session_id, 'patch_region', { rect: { x: 0, y: 0, w: 1, h: 1 }, grid: ['.'], codebook_hash: '0'.repeat(64), expected_candidate_hash: '0'.repeat(64) }),
    error => error.code === 'assistant_tool_blocked' && error.diagnostic?.reason === 'authorization',
  )

  // 2. Client rect, allowed_colors, allowed_operations, or target fields without grant_id are rejected (400)
  const rect = { x: 8, y: 10, w: 3, h: 2 }
  for (const extra of [
    { rect },
    { allowed_colors: [[250, 40, 60, 255]] },
    { allowed_operations: ['read_region', 'patch_region'] },
    { frame_id: 'f', layer_id: 'l', cel_id: 'c' },
  ]) {
    await assert.rejects(
      legacyF.service.create(legacyF.scope, { ...legacyF.body, operation_id: randomUUID(), ...extra }),
      error => error.code === 'invalid_pixel_tool_request' && error.http_status === 400,
    )
  }

  // 3. Server-verified grant_id binds regional scope, freezes codebook, and enables read_region + patch_region
  const activeGrant = {
    grant_id: 'grant_22222222222222222222222222222222',
    project_id: 'project_a',
    document_id: 'doc_a',
    project_revision: 2,
    working_revision: 1,
    frame_id: 'f',
    layer_id: 'l',
    cel_id: 'c',
    rect,
    allowed_operations: ['read_region', 'patch_region', 'read_canvas', 'draw_pixels', 'undo_pixels'],
  }
  const f = fixture({ grant: activeGrant })
  const created = await f.service.create(f.scope, {
    ...f.body,
    grant_id: activeGrant.grant_id,
    rect,
    allowed_colors: [[250, 40, 60, 255]],
    frame_id: 'f',
    layer_id: 'l',
    cel_id: 'c',
  })
  const id = created.session_id
  assert.equal(created.context.grant_id, activeGrant.grant_id)
  assert.deepEqual(created.context.allowed_rect, rect)
  assert.deepEqual(created.context.target, { frame_id: 'f', layer_id: 'l', cel_id: 'c' })
  assert.deepEqual(created.tools.map(t => t.name), ['read_canvas', 'read_region', 'patch_region', 'draw_pixels', 'undo_pixels'])

  const readRes = await runPixelToolsCommand(
    { action: 'read_region', project_id: 'project_a', session_id: id, rect },
    {
      url: 'http://127.0.0.1:7777',
      fetchImpl: async (_url, req) => {
        const body = JSON.parse(req.body)
        return new Response(JSON.stringify(await f.service.call(f.scope, id, body)))
      },
    },
  )
  assert.deepEqual(readRes.observation.rect, rect)
  assert.deepEqual(readRes.observation.grid, ['000', '000'])
  assert.deepEqual(readRes.observation.codebook['1'], [250, 40, 60, 255])

  const patchRes = await runPixelToolsCommand(
    {
      action: 'patch_region',
      project_id: 'project_a',
      session_id: id,
      rect,
      grid: ['1.1', '.1.'],
      codebook_hash: readRes.observation.codebook_hash,
      expected_candidate_hash: readRes.observation.candidate_sha256,
    },
    {
      url: 'http://127.0.0.1:7777',
      fetchImpl: async (_url, req) => {
        const body = JSON.parse(req.body)
        return new Response(JSON.stringify(await f.service.call(f.scope, id, body)))
      },
    },
  )
  assert.equal(patchRes.observation.drawing_batches, 1)
  assert.notEqual(patchRes.observation.candidate_sha256, readRes.observation.candidate_sha256)

  // Stale expected_candidate_hash fails with pixel_tool_context_changed
  await assert.rejects(
    f.call(id, 'patch_region', {
      rect,
      grid: ['...', '...'],
      codebook_hash: readRes.observation.codebook_hash,
      expected_candidate_hash: readRes.observation.candidate_sha256,
    }),
    { code: 'pixel_tool_context_changed' },
  )

  await f.call(id, 'review')
  const reviewData = await f.service.review(f.scope, id)
  assert.deepEqual(reviewData.context.allowed_rect, rect)
  assert.deepEqual(reviewData.pixel_candidate.allowed_rect, rect)
  const validated = await readExternalPixels({ projectId: 'project_a', sessionId: id }, async () => new Response(JSON.stringify(reviewData)))
  assert.deepEqual(validated.context.allowed_rect, rect)
})

test('repeated create + close retires heavy session state, replays recent close deterministically, and caps retained terminal tombstones at 64', async () => {
  const f = fixture()
  const closedRecords = []
  for (let i = 0; i < 80; i += 1) {
    const created = await f.service.create(f.scope, {
      ...f.body,
      operation_id: randomUUID(),
    })
    await f.call(created.session_id, 'draw_pixels', { operations: [paint] })
    const closeOp = randomUUID()
    const closed = await f.call(created.session_id, 'close', {}, closeOp)
    assert.deepEqual(closed, { session_id: created.session_id, status: 'cancelled', closed: true, saved: false })
    closedRecords.push({ sessionId: created.session_id, closeOp })
  }

  // The most recent 64 closed sessions retain lightweight tombstones and replay same-operation_id close deterministically
  const recent = closedRecords[closedRecords.length - 1]
  const boundaryRetained = closedRecords[closedRecords.length - 64]
  assert.deepEqual(
    await f.call(recent.sessionId, 'close', {}, recent.closeOp),
    { session_id: recent.sessionId, status: 'cancelled', closed: true, saved: false },
  )
  assert.deepEqual(
    await f.call(boundaryRetained.sessionId, 'close', {}, boundaryRetained.closeOp),
    { session_id: boundaryRetained.sessionId, status: 'cancelled', closed: true, saved: false },
  )

  // Sessions older than the 64-tombstone cap have been evicted completely
  const evicted = closedRecords[0]
  await assert.rejects(
    f.call(evicted.sessionId, 'close', {}, evicted.closeOp),
    { code: 'pixel_tool_session_expired' },
  )
})
