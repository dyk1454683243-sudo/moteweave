import test from 'node:test'
import assert from 'node:assert/strict'
import { createPixelToolSession, PIXEL_TOOLS, PIXEL_TOOL_INSTRUCTIONS, LEGACY_PIXEL_TOOL_INSTRUCTIONS, PIXEL_TOOL_DIAGNOSTIC_BYTES, pixelToolDiagnostic, pixelArgumentCorrection } from '../../src/editor-project/pixelToolSession.js'
import { createAssistantConversations } from '../../src/editor-project/assistantConversation.js'
import { ASTRA_PIXEL_MODEL } from '../../src/editor-project/assistantCodex.js'

const blank = () => new Uint8Array(64 * 64 * 4)
const paint = { type: 'fill-rect', rect: { x: 20, y: 30, w: 4, h: 5 }, color: [255, 80, 0, 255] }
const draw = session => session.call('draw_pixels', { operations: [paint] })
test('shared tools produce actual preview and undo; source remains untouched', async () => {
  const source = blank(), session = createPixelToolSession({ rgba: source }), before = await session.candidate()
  assert.equal(session.instructions, LEGACY_PIXEL_TOOL_INSTRUCTIONS)
  const result = await draw(session), changed = await session.candidate(), pixels = Buffer.from(changed.rgba_hex, 'hex')
  assert.match(result.contentItems[1].imageUrl, /^data:image\/png;base64,/)
  assert.deepEqual([...pixels.subarray(7760, 7764)], paint.color)
  assert.equal(source.every(v => v === 0), true); assert.equal(changed.source_sha256, before.sha256)
  assert.notEqual(changed.sha256, before.sha256)
  await session.call('undo_pixels', {})
  assert.equal((await session.candidate()).sha256, before.sha256)
  assert.equal((await session.candidate()).drawing_batches, 1)
})
test('tool schema states the runtime limits without widening them', () => {
  const draw = PIXEL_TOOLS.find(tool => tool.name === 'draw_pixels')
  const fill = draw.inputSchema.properties.operations.items.anyOf.find(item => item.properties.type.enum[0] === 'fill-rect')
  assert.deepEqual(fill.properties.color.prefixItems[3].enum, [0, 255])
  assert.match(fill.properties.rect.description, /fit completely/)
  assert.match(fill.properties.color.description, /0 or 255/)
  assert.match(draw.description, /inside its declared rectangle/)
  assert.match(draw.description, /entire JSON-serialized arguments object must not exceed 65536 characters/)
  assert.match(PIXEL_TOOL_INSTRUCTIONS, /within 65536 characters/)
  assert.match(PIXEL_TOOL_INSTRUCTIONS, /read_region/)
  assert.match(PIXEL_TOOL_INSTRUCTIONS, /patch_region/)
  assert.match(LEGACY_PIXEL_TOOL_INSTRUCTIONS, /within 65536 characters/)
  assert.doesNotMatch(LEGACY_PIXEL_TOOL_INSTRUCTIONS, /read_region|patch_region/)
  assert.equal(draw.inputSchema.properties.operations.maxItems, 64)
})
test('all eight schema operation types still compose in one atomic batch', async () => {
  const rect = { x: 0, y: 0, w: 64, h: 64 }, point = { x: 1, y: 1 }, color = [5, 6, 7, 255]
  const operations = [
    { type: 'pencil', rect, points: [point], color }, { type: 'eraser', rect, points: [point] },
    { type: 'line', rect, start: point, end: { x: 3, y: 3 }, color },
    { type: 'rectangle', rect, start: point, end: { x: 3, y: 3 }, color },
    { type: 'flood-fill', rect, seed: point, color }, { type: 'fill-rect', rect, color },
    { type: 'replace-color', rect, from: color, to: [8, 9, 10, 255] }, { type: 'erase', rect },
  ]
  const session = createPixelToolSession({ rgba: blank() }), before = await session.candidate()
  await session.call('draw_pixels', { operations })
  assert.equal(session.status().drawing_batches, 1); assert.equal(session.status().argument_corrections, 0)
  await session.call('undo_pixels', {})
  assert.equal((await session.candidate()).sha256, before.sha256)
})
test('argument feedback identifies safe schema paths and expected formats without exposing caller data', async () => {
  const secret = 'private-secret'
  const pencil = { type: 'pencil', rect: paint.rect, points: [{ x: 20, y: 30 }], color: paint.color }
  const cases = [
    [{ type: paint.type, rect: paint.rect }, 'color', 'missing_field', 'rgba'],
    [{ ...paint, [secret]: secret }, '', 'unexpected_field', 'operation_fill-rect'],
    [{ ...paint, rect: { ...paint.rect, [secret]: secret } }, 'rect', 'unexpected_field', 'rect'],
    [{ ...pencil, points: [{ x: 20, y: 30, [secret]: secret }] }, 'points[0]', 'unexpected_field', 'point'],
    [{ ...pencil, points: [{ x: 20 }] }, 'points[0].y', 'missing_field', 'coordinate'],
    [{ ...paint, color: [1, 2, 3] }, 'color', 'invalid_length', 'rgba'],
    [{ ...paint, color: [1, 2, secret, 255] }, 'color', 'invalid_value', 'rgba'],
    [{ ...paint, rect: { ...paint.rect, x: '20' } }, 'rect.x', 'invalid_type', 'coordinate'],
    [{ ...paint, type: secret }, 'type', 'invalid_value', 'operation_type'],
  ]
  const messages = new Set()
  for (const [bad, suffix, issue, expected] of cases) {
    const session = createPixelToolSession({ rgba: blank() }), before = await session.candidate()
    await assert.rejects(session.call('draw_pixels', { operations: [paint, bad] }), error => {
      const detail = error.diagnostic.last_argument_rejection
      assert.equal(detail.field, `operations[1]${suffix ? `.${suffix}` : ''}`)
      assert.equal(detail.issue, issue); assert.equal(detail.expected, expected)
      assert.equal(error.code, 'pixel_tool_invalid_arguments'); assert.equal(error.recoverable, true)
      const message = pixelArgumentCorrection(error.diagnostic)
      assert.match(message, /Expected:/); assert.match(message, /entire rejected arguments object/)
      assert.match(message, /remaining_tool_calls=8/)
      assert.equal(message.includes(secret), false); assert.equal(JSON.stringify(error.diagnostic).includes(secret), false)
      assert.ok(Buffer.byteLength(JSON.stringify(error.diagnostic)) <= PIXEL_TOOL_DIAGNOSTIC_BYTES)
      messages.add(message)
      return true
    })
    const rejected = await session.candidate()
    assert.equal(rejected.sha256, before.sha256); assert.equal(rejected.drawing_batches, 0)
    assert.deepEqual(rejected.trace, [])
    await assert.rejects(session.call('undo_pixels', {}), error => error.diagnostic?.reason === 'unsupported')
    await draw(session)
    assert.equal((await session.candidate()).drawing_batches, 1)
    assert.equal(session.status().calls, 3)
    assert.equal(session.status().last_argument_rejection.issue, issue)
  }
  assert.equal(messages.size, cases.length)
})
test('combined argument size remains bounded even when each operation meets its array limits', async () => {
  const session = createPixelToolSession({ rgba: blank() }), before = await session.candidate()
  const args = { operations: Array.from({ length: 64 }, () => ({ type: 'eraser', rect: { x: 0, y: 0, w: 64, h: 64 },
    points: Array.from({ length: 80 }, () => ({ x: 20, y: 30 })) })) }
  assert.ok(JSON.stringify(args).length > 65536)
  await assert.rejects(session.call('draw_pixels', args), error => {
    assert.deepEqual(error.diagnostic.last_argument_rejection, { tool: 'draw_pixels', rule: 'argument_shape', operation_index: null,
      field: 'arguments', issue: 'limit_exceeded', expected: 'serialized_arguments' })
    assert.match(pixelArgumentCorrection(error.diagnostic), /at most 65536 characters; reduce operations or points/)
    return true
  })
  assert.equal((await session.candidate()).sha256, before.sha256)
  args.operations.forEach(operation => { operation.points.length = 40 })
  assert.ok(JSON.stringify(args).length < 65536)
  await session.call('draw_pixels', args)
  assert.equal(session.status().drawing_batches, 1); assert.equal(session.status().calls, 2)
})
test('bad batch is atomic: bounds, integer pixels, alpha, unsupported tool and arbitrary fields rejected', async () => {
  for (const bad of [{ ...paint, rect: { x: 63, y: 0, w: 2, h: 1 } }, { ...paint, color: [1, 2, 3, 128] },
    { ...paint, rect: { x: 0.5, y: 0, w: 1, h: 1 } }, { type: 'text', rect: paint.rect }, { ...paint, path: '/other' }]) {
    const session = createPixelToolSession({ rgba: blank() }), before = await session.candidate()
    await assert.rejects(session.call('draw_pixels', { operations: [paint, bad] }))
    assert.equal((await session.candidate()).sha256, before.sha256)
    assert.equal((await session.candidate()).drawing_batches, 0)
  }
  const session = createPixelToolSession({ rgba: blank() })
  await assert.rejects(session.call('shell', {})); await assert.rejects(session.call('read_canvas', { path: 'other' }))
  await assert.rejects(session.call('draw_pixels', { operations: Array(65).fill(paint) }))
})
test('argument rejection is recoverable and classified separately from budget, authorization, and source alpha', async () => {
  const secret = 'sk-live-secret'
  const session = createPixelToolSession({ rgba: blank() })
  const before = await session.candidate()
  await assert.rejects(session.call('draw_pixels', { operations: [paint, { ...paint, rect: { x: 60, y: 0, w: 8, h: 1 }, note: secret }] }), error => {
    assert.equal(error.code, 'pixel_tool_invalid_arguments')
    assert.equal(error.recoverable, true)
    assert.equal(error.diagnostic.reason, 'invalid_arguments')
    assert.equal(error.diagnostic.rule, 'argument_shape')
    assert.equal(error.diagnostic.last_argument_rejection.issue, 'unexpected_field')
    assert.equal(error.diagnostic.terminal, false)
    assert.equal(error.diagnostic.operation_index, 1)
    assert.equal(error.diagnostic.calls, 1)
    assert.equal(JSON.stringify(error.diagnostic).includes(secret), false)
    assert.ok(Buffer.byteLength(JSON.stringify(error.diagnostic)) <= PIXEL_TOOL_DIAGNOSTIC_BYTES)
    return true
  })
  const unchanged = await session.candidate()
  assert.equal(unchanged.sha256, before.sha256)
  assert.equal(unchanged.drawing_batches, 0)
  await draw(session)
  assert.equal((await session.candidate()).drawing_batches, 1)
  await assert.rejects(session.call('draw_pixels', { operations: [{ type: 'pencil', rect: { x: 0, y: 0, w: 2, h: 2 }, points: [{ x: 4, y: 0 }], color: [1, 2, 3, 255] }] }), error => error.diagnostic.rule === 'point_outside_rect' && error.recoverable === true)
  await assert.rejects(session.call('shell', {}), error => error.code === 'assistant_tool_blocked' && error.diagnostic.reason === 'authorization')
  const limited = createPixelToolSession({ rgba: blank() })
  for (let i = 0; i < 9; i++) await limited.call('read_canvas', {})
  await assert.rejects(limited.call('read_canvas', {}), error => error.diagnostic.reason === 'budget' && error.diagnostic.rule === 'call_limit' && error.code === 'assistant_tool_blocked')
  const translucent = blank(); translucent[3] = 128
  await assert.rejects(async () => createPixelToolSession({ rgba: translucent }), error => error.code === 'assistant_context_changed' && error.diagnostic.reason === 'source_alpha')
})
test('exhausted batches and stale context terminate before malformed arguments can be corrected', async () => {
  const session = createPixelToolSession({ rgba: blank() })
  for (let i = 0; i < 3; i++) await draw(session)
  const before = await session.candidate()
  await assert.rejects(session.call('draw_pixels', null), error => error.code === 'assistant_tool_blocked' && error.diagnostic.reason === 'budget' && error.diagnostic.rule === 'batch_limit' && error.recoverable !== true)
  const after = await session.candidate()
  assert.equal(after.sha256, before.sha256)
  assert.equal(after.drawing_batches, 3)
  assert.equal(after.tool_calls, before.tool_calls + 1)
  const stale = createPixelToolSession({ rgba: blank(), checkCurrent: async () => { throw Object.assign(new Error('stale'), { code: 'assistant_context_changed' }) } })
  await assert.rejects(stale.call('draw_pixels', null), error => error.code === 'assistant_context_changed' && error.recoverable !== true)
  assert.equal(stale.status().calls, 1)
  assert.equal(stale.status().drawing_batches, 0)
})
test('latest argument rejection is sanitized, immutable and kept separately from terminal failure', async () => {
  const session = createPixelToolSession({ rgba: blank() }), before = await session.candidate()
  await assert.rejects(session.call('read_canvas', { path: 'private-secret' }), error => {
    assert.deepEqual(error.diagnostic.last_argument_rejection, { tool: 'read_canvas', rule: 'argument_shape', operation_index: null,
      field: 'arguments', issue: 'unexpected_field', expected: 'empty' })
    return true
  })
  // Shape feedback keeps the failing index without echoing the unknown key.
  await assert.rejects(session.call('draw_pixels', { operations: [paint, { ...paint, private: 'private-secret' }] }), error => {
    assert.equal(error.diagnostic.operation_index, 1)
    return true
  })
  const expected = { tool: 'draw_pixels', rule: 'argument_shape', operation_index: 1,
    field: 'operations[1]', issue: 'unexpected_field', expected: 'operation_fill-rect' }
  assert.deepEqual(session.status().last_argument_rejection, expected)
  session.status().last_argument_rejection.rule = 'tampered'
  assert.deepEqual(session.status().last_argument_rejection, expected)
  assert.equal((await session.candidate()).sha256, before.sha256)
  for (let i = 0; i < 7; i++) await session.call('read_canvas', {})
  await assert.rejects(session.call('read_canvas', {}), error => {
    assert.equal(error.diagnostic.rule, 'call_limit')
    assert.equal(error.diagnostic.terminal, true)
    assert.deepEqual(error.diagnostic.last_argument_rejection, expected)
    assert.equal(error.diagnostic.argument_corrections, 2)
    assert.equal(JSON.stringify(error.diagnostic).includes('private-secret'), false)
    assert.ok(Buffer.byteLength(JSON.stringify(error.diagnostic)) <= PIXEL_TOOL_DIAGNOSTIC_BYTES)
    return true
  })
  const safe = pixelToolDiagnostic({ last_argument_rejection: { ...expected, private: 'private-secret' } })
  assert.deepEqual(safe.last_argument_rejection, expected)
  assert.equal(JSON.stringify(safe).includes('private-secret'), false)
  assert.equal(pixelToolDiagnostic({ last_argument_rejection: { tool: 'shell', rule: 'argument_shape' } }).last_argument_rejection, undefined)
  assert.equal(pixelToolDiagnostic({ last_argument_rejection: { tool: 'draw_pixels', rule: 'private-secret' } }).last_argument_rejection, undefined)
  const legacy = { tool: 'draw_pixels', rule: 'argument_shape', operation_index: 1 }
  assert.deepEqual(pixelToolDiagnostic({ last_argument_rejection: legacy }).last_argument_rejection, legacy)
  for (const detail of [{ field: 'operations[1].private-secret' }, { field: 'operations[0].color' }, { field: 'operations[1].points[256]' },
    { issue: 'private-secret' }, { expected: 'private-secret' }, { expected: ['rgba'] }]) {
    const result = pixelToolDiagnostic({ last_argument_rejection: { ...expected, ...detail } })
    assert.deepEqual(result.last_argument_rejection, legacy)
    assert.equal(pixelArgumentCorrection(result).includes('private-secret'), false)
  }
})
test('three drawing batches and total tools are bounded; undo cannot replenish budget', async () => {
  const session = createPixelToolSession({ rgba: blank() })
  for (let i = 0; i < 3; i++) { await draw(session); await session.call('undo_pixels', {}) }
  await assert.rejects(draw(session)); await session.call('read_canvas', {}); await session.call('read_canvas', {})
  await assert.rejects(session.call('read_canvas', {}))
})
test('stop or stale source prevents tools and delivery', async () => {
  const controller = new AbortController(), session = createPixelToolSession({ rgba: blank(), signal: controller.signal })
  controller.abort()
  await assert.rejects(draw(session), { code: 'assistant_cancelled' }); await assert.rejects(session.candidate(), { code: 'assistant_cancelled' })
  const stale = createPixelToolSession({ rgba: blank(), checkCurrent: async () => { throw Object.assign(new Error(), { code: 'assistant_context_changed' }) } })
  await assert.rejects(draw(stale), { code: 'assistant_context_changed' })
})

function fixture(afterDraw) {
  const project = { version: 'editor_project_v1', id: 'project_a', revision: 2,
    canvases: { canvas_a: { id: 'canvas_a', document_id: 'doc_a' } }, sprite_documents: { doc_a: { working_revision: 1 } } }
  const scope = { workspaceRoot: '/fixture', projectId: project.id }
  const manifest = { revision: 1, canvas: { w: 64, h: 64 }, frame_order: ['f'], layer_order: ['l'],
    layers: { l: { locked: false } }, cels: { c: { id: 'c', frame_id: 'f', layer_id: 'l', block: null } } }
  let runs = 0
  const service = createAssistantConversations({ records: null, load: async () => ({ project }), readDocument: async () => ({ manifest }),
    adapters: { astra: async ({ message, pixelTools, referenceDataUrl }) => {
      runs++; assert.match(referenceDataUrl, /^data:image\/png;base64,/)
      assert.doesNotMatch(message, /read_region|patch_region/)
      assert.equal(pixelTools.instructions, LEGACY_PIXEL_TOOL_INSTRUCTIONS)
      await draw(pixelTools); afterDraw?.(project)
      return { status: 'completed', provider: 'codex', model: ASTRA_PIXEL_MODEL, threadId: 'native-1', reply: 'Preview ready.' }
    } } })
  return { project, scope, manifest, service, get runs() { return runs } }
}
const request = conversation => ({ conversation, operation_id: '22222222-2222-4222-8222-222222222222', message: 'Draw a flame',
  expected_revision: 2, canvas_id: 'canvas_a', expected_working_revision: 1, pixel_tools: true })
test('conversation dispatches tools on frozen canvas without saving; same receipt never calls twice', async () => {
  const f = fixture(), opened = await f.service.open(f.scope, { provider: 'astra', model: ASTRA_PIXEL_MODEL })
  const ordinary = request(opened.conversation); delete ordinary.pixel_tools
  await assert.rejects(f.service.send(f.scope, ordinary), { code: 'assistant_drawing_unavailable' }); assert.equal(f.runs, 0)
  const result = await f.service.send(f.scope, request(opened.conversation))
  assert.equal(result.requestedModel, ASTRA_PIXEL_MODEL); assert.equal(result.provider, 'astra')
  assert.equal(result.pixel_candidate.drawing_batches, 1); assert.equal(result.context.pixel_tools, true)
  assert.equal(result.termination, 'managed'); assert.equal(f.project.revision, 2)
  assert.equal((await f.service.send(f.scope, request(opened.conversation))).pixel_candidate.sha256, result.pixel_candidate.sha256)
  assert.equal(f.runs, 1)
})
test('conversation receipt keeps a sanitized diagnostic when the turn fails before drawing', async () => {
  const project = { version: 'editor_project_v1', id: 'project_a', revision: 2,
    canvases: { canvas_a: { id: 'canvas_a', document_id: 'doc_a' } }, sprite_documents: { doc_a: { working_revision: 1 } } }
  const scope = { workspaceRoot: '/fixture', projectId: project.id }
  const manifest = { revision: 1, canvas: { w: 64, h: 64 }, frame_order: ['f'], layer_order: ['l'],
    layers: { l: { locked: false, visible: true } }, cels: { c: { id: 'c', frame_id: 'f', layer_id: 'l', block: { sha256: 'abc', w: 64, h: 64 } } } }
  const rgba = blank(); rgba[7] = 128
  let runs = 0
  const service = createAssistantConversations({ records: null, load: async () => ({ project }), readDocument: async () => ({ manifest }),
    readBlock: async () => ({ bytes: rgba }),
    adapters: { astra: async () => { runs++; throw new Error('model') } } })
  const opened = await service.open(scope, { provider: 'astra' })
  await assert.rejects(service.send(scope, request(opened.conversation)), error => error.code === 'assistant_context_changed' && error.diagnostic.reason === 'source_alpha')
  const history = await service.history(scope, 'astra')
  assert.equal(runs, 0)
  assert.equal(project.revision, 2)
  assert.equal(history.turns[0].error, 'assistant_context_changed')
  assert.equal(history.turns[0].diagnostic.reason, 'source_alpha')
  assert.equal(history.turns[0].diagnostic.terminal, true)
  assert.equal(JSON.stringify(history.turns[0].diagnostic).includes('128'), false)
  await assert.rejects(service.send(scope, request(opened.conversation)), error => error.diagnostic?.reason === 'source_alpha' && error.code === 'assistant_context_changed')
})
test('wrong size, locked layer, multiple frames and changed final revision reject candidate', async () => {
  for (const change of [f => { f.manifest.canvas.w = 32 }, f => { f.manifest.layers.l.locked = true }, f => { f.manifest.layers.l.visible = false }, f => { f.manifest.frame_order.push('f2') }]) {
    const f = fixture(); change(f); const opened = await f.service.open(f.scope, { provider: 'astra' })
    await assert.rejects(f.service.send(f.scope, request(opened.conversation)), { code: 'assistant_context_changed' }); assert.equal(f.runs, 0)
  }
  const f = fixture(project => { project.revision++ }), opened = await f.service.open(f.scope, { provider: 'astra' })
  await assert.rejects(f.service.send(f.scope, request(opened.conversation)), { code: 'assistant_context_changed' }); assert.equal(f.runs, 1)
})

test('N1 codebook freezes 0-9A-Za-z up to 62 RGBA8 colors, preserves hidden RGB on transparent pixels via dot, and requires explicit transparent symbol to erase', async () => {
  const source = blank()
  const put = (x, y, rgba) => {
    const i = (y * 64 + x) * 4
    source[i] = rgba[0]; source[i + 1] = rgba[1]; source[i + 2] = rgba[2]; source[i + 3] = rgba[3]
  }
  const get = (buf, x, y) => {
    const i = (y * 64 + x) * 4
    return [buf[i], buf[i + 1], buf[i + 2], buf[i + 3]]
  }
  // Hidden RGB on transparent pixel at (2, 2), opaque red at (3, 2), opaque blue outside allowedRect at (0, 0)
  put(0, 0, [10, 20, 250, 255])
  put(2, 2, [11, 22, 33, 0])
  put(3, 2, [200, 10, 20, 255])
  put(2, 3, [200, 10, 20, 255])
  put(3, 3, [0, 0, 0, 0])

  const allowedRect = { x: 2, y: 2, w: 2, h: 2 }
  const target = { frame_id: 'f', layer_id: 'l', cel_id: 'c' }
  const session = createPixelToolSession({
    rgba: source,
    allowedRect,
    allowedColors: [[0, 255, 100, 255], [0, 0, 0, 0]],
    target,
    grantId: 'grant-1',
  })

  const readRes = await session.call('read_region', { rect: allowedRect })
  const obs = JSON.parse(readRes.contentItems[0].text)
  assert.deepEqual(obs.rect, allowedRect)
  assert.deepEqual(obs.allowed_rect, allowedRect)
  assert.deepEqual(obs.target, target)
  assert.equal(obs.grant_id, 'grant-1')
  assert.equal(obs.codebook_version, 'pixel_codebook_v1')
  assert.equal(obs.grid.length, 2)
  assert.equal(obs.grid[0].length, 2)
  // Codebook maps '0' -> [11,22,33,0], '1' -> [200,10,20,255], '2' -> [0,0,0,0], '3' -> [0,255,100,255]
  assert.deepEqual(obs.codebook['0'], [11, 22, 33, 0])
  assert.deepEqual(obs.codebook['1'], [200, 10, 20, 255])
  assert.deepEqual(obs.codebook['2'], [0, 0, 0, 0])
  assert.deepEqual(obs.codebook['3'], [0, 255, 100, 255])
  assert.deepEqual(obs.grid, ['01', '12'])

  // Patch: keep (2,2) with '.', erase (3,2) with '2' ([0,0,0,0]), recolor (2,3) with '3' ([0,255,100,255]), keep (3,3) with '.'
  const patchRes = await session.call('patch_region', {
    rect: allowedRect,
    grid: ['.2', '3.'],
    codebook_hash: obs.codebook_hash,
    expected_candidate_hash: obs.candidate_sha256,
    target,
  })
  const patchObs = JSON.parse(patchRes.contentItems[0].text)
  assert.equal(patchObs.drawing_batches, 1)
  assert.equal(patchObs.codebook_hash, obs.codebook_hash, 'codebook_hash stays frozen after patch')
  assert.notEqual(patchObs.candidate_sha256, obs.source_sha256)

  const cand = await session.candidate()
  const candBuf = Buffer.from(cand.rgba_hex, 'hex')
  assert.deepEqual(get(candBuf, 0, 0), [10, 20, 250, 255], 'pixel outside allowedRect untouched')
  assert.deepEqual(get(candBuf, 2, 2), [11, 22, 33, 0], 'dot preserved hidden RGB on transparent pixel')
  assert.deepEqual(get(candBuf, 3, 2), [0, 0, 0, 0], 'explicit transparent symbol erased opaque pixel')
  assert.deepEqual(get(candBuf, 2, 3), [0, 255, 100, 255], 'new allowed color applied')
  assert.deepEqual(get(candBuf, 3, 3), [0, 0, 0, 0], 'dot preserved transparent pixel')

  // Subsequent read_region keeps the exact frozen codebook even if color '1' no longer appears in the region
  const readAfter = JSON.parse((await session.call('read_region', {})).contentItems[0].text)
  assert.equal(readAfter.codebook_hash, obs.codebook_hash)
  assert.deepEqual(readAfter.codebook, obs.codebook)
  assert.deepEqual(readAfter.grid, ['02', '32'])

  // Undo reverts candidate and restores candidate_sha256 to source_sha256 without refunding drawing_batches
  const undoObs = JSON.parse((await session.call('undo_pixels', {})).contentItems[0].text)
  assert.equal(undoObs.candidate_sha256, obs.source_sha256)
  assert.equal(undoObs.drawing_batches, 1)
})

test('N1 preserves >62-color legacy sessions without grant, requires grant for regional character-grid tools, rejects >62 colors in N1 codebook mode, and enforces frozen codebook across draw_pixels', async () => {
  const many = blank()
  for (let i = 0; i < 63; i += 1) {
    many[i * 4] = i; many[i * 4 + 1] = 10; many[i * 4 + 2] = 20; many[i * 4 + 3] = 255
  }
  // 0a. Legacy session without grantId succeeds on a 63-color binary-alpha canvas and exposes only legacy tools
  const legacyMany = createPixelToolSession({ rgba: many })
  assert.equal(legacyMany.codebookMode, false)
  assert.equal(legacyMany.codebook, null)
  assert.deepEqual(legacyMany.tools.map(t => t.name), ['read_canvas', 'draw_pixels', 'undo_pixels'])
  await legacyMany.call('read_canvas', {})
  await legacyMany.call('draw_pixels', { operations: [{ type: 'pencil', rect: { x: 0, y: 0, w: 2, h: 2 }, points: [{ x: 1, y: 1 }], color: [250, 240, 230, 255] }] })
  await assert.rejects(
    legacyMany.call('read_region', {}),
    error => error.code === 'assistant_tool_blocked' && error.diagnostic.reason === 'authorization' && error.diagnostic.rule === 'tool_identity',
  )
  await assert.rejects(
    legacyMany.call('patch_region', { rect: { x: 0, y: 0, w: 1, h: 1 }, grid: ['.'], codebook_hash: '0'.repeat(64), expected_candidate_hash: '0'.repeat(64) }),
    error => error.code === 'assistant_tool_blocked' && error.diagnostic.reason === 'authorization' && error.diagnostic.rule === 'tool_identity',
  )

  // 0b. Grantless session cannot claim allowedRect, allowedColors, or regional tool operations
  await assert.rejects(
    async () => createPixelToolSession({ rgba: blank(), allowedRect: { x: 0, y: 0, w: 8, h: 8 } }),
    error => error.code === 'assistant_context_changed' && error.diagnostic.reason === 'authorization',
  )
  await assert.rejects(
    async () => createPixelToolSession({ rgba: blank(), allowedColors: [[1, 2, 3, 255]] }),
    error => error.code === 'assistant_context_changed' && error.diagnostic.reason === 'authorization',
  )
  await assert.rejects(
    async () => createPixelToolSession({ rgba: blank(), allowedOperations: ['read_region', 'patch_region'] }),
    error => error.code === 'assistant_context_changed' && error.diagnostic.reason === 'authorization',
  )

  // 0c. Grant-bound N1 session rejects >62 colors without quantization
  await assert.rejects(
    async () => createPixelToolSession({ rgba: many, allowedRect: { x: 0, y: 0, w: 64, h: 2 }, grantId: 'grant-many' }),
    error => error.code === 'assistant_context_changed' && error.diagnostic.reason === 'unsupported' && error.diagnostic.rule === 'codebook_limit',
  )

  const source = blank()
  // Fill a connected line of red across (1,2)..(6,2) so flood-fill / replace-color would cross x=2..3 if not bounded
  for (let x = 1; x <= 6; x += 1) {
    const i = (2 * 64 + x) * 4
    source[i] = 250; source[i + 1] = 0; source[i + 2] = 0; source[i + 3] = 255
  }
  const allowedRect = { x: 2, y: 2, w: 2, h: 2 }
  const target = { frame_id: 'f', layer_id: 'l', cel_id: 'c' }
  const session = createPixelToolSession({
    rgba: source,
    allowedRect,
    allowedColors: [[0, 200, 0, 255]],
    target,
    grantId: 'grant-2',
  })
  const obs = JSON.parse((await session.call('read_region', {})).contentItems[0].text)
  const beforeSha = obs.candidate_sha256

  // 1. Unknown character
  await assert.rejects(
    session.call('patch_region', { rect: allowedRect, grid: ['?0', '..'], codebook_hash: obs.codebook_hash, expected_candidate_hash: beforeSha }),
    error => error.code === 'pixel_tool_invalid_arguments' && error.diagnostic.last_argument_rejection.rule === 'unknown_symbol',
  )
  // 2. Wrong grid dimensions
  await assert.rejects(
    session.call('patch_region', { rect: allowedRect, grid: ['000', '..'], codebook_hash: obs.codebook_hash, expected_candidate_hash: beforeSha }),
    error => error.code === 'pixel_tool_invalid_arguments' && error.diagnostic.last_argument_rejection.rule === 'grid_dimensions',
  )
  // 3. Out of allowedRect bounds
  await assert.rejects(
    session.call('patch_region', { rect: { x: 1, y: 2, w: 2, h: 2 }, grid: ['..', '..'], codebook_hash: obs.codebook_hash, expected_candidate_hash: beforeSha }),
    error => error.code === 'pixel_tool_invalid_arguments' && error.diagnostic.rule === 'rect_bounds',
  )
  // 4. Codebook hash mismatch
  await assert.rejects(
    session.call('patch_region', { rect: allowedRect, grid: ['..', '..'], codebook_hash: 'f'.repeat(64), expected_candidate_hash: beforeSha }),
    error => error.code === 'pixel_tool_invalid_arguments' && error.diagnostic.last_argument_rejection.rule === 'codebook_mismatch',
  )
  // 5. Target identity mismatch
  await assert.rejects(
    session.call('patch_region', { rect: allowedRect, grid: ['..', '..'], codebook_hash: obs.codebook_hash, expected_candidate_hash: beforeSha, target: { frame_id: 'f', layer_id: 'l', cel_id: 'other' } }),
    error => error.code === 'assistant_context_changed' && error.diagnostic.rule === 'target_mismatch',
  )
  // 6. Stale expected_candidate_hash
  await assert.rejects(
    session.call('patch_region', { rect: allowedRect, grid: ['..', '..'], codebook_hash: obs.codebook_hash, expected_candidate_hash: 'a'.repeat(64) }),
    error => error.code === 'assistant_context_changed' && error.diagnostic.rule === 'candidate_hash',
  )
  assert.equal((await session.candidate()).sha256, beforeSha, 'all rejected patches left candidate untouched')

  // 6b & 6c. In an N1 session, draw_pixels with an out-of-codebook color or eraser/erase when [0,0,0,0] is not in the frozen codebook is rejected atomically before committing so subsequent read_region remains valid
  const opaqueSource = blank()
  for (let i = 0; i < opaqueSource.length; i += 4) {
    opaqueSource[i] = 40; opaqueSource[i + 1] = 50; opaqueSource[i + 2] = 60; opaqueSource[i + 3] = 255
  }
  const opaqueSession = createPixelToolSession({
    rgba: opaqueSource,
    allowedRect,
    allowedColors: [[80, 90, 100, 255]],
    target,
    grantId: 'grant-opaque',
  })
  const opaqueBefore = (await opaqueSession.candidate()).sha256
  await assert.rejects(
    opaqueSession.call('draw_pixels', {
      operations: [
        { type: 'pencil', rect: allowedRect, points: [{ x: 2, y: 2 }], color: [80, 90, 100, 255] },
        { type: 'pencil', rect: allowedRect, points: [{ x: 3, y: 2 }], color: [123, 45, 67, 255] },
      ],
    }),
    error => error.code === 'pixel_tool_invalid_arguments'
      && error.diagnostic.last_argument_rejection.rule === 'codebook_mismatch'
      && error.diagnostic.last_argument_rejection.field === 'operations[1].color'
      && error.diagnostic.last_argument_rejection.expected === 'codebook_color',
  )
  await assert.rejects(
    opaqueSession.call('draw_pixels', { operations: [{ type: 'erase', rect: allowedRect }] }),
    error => error.code === 'pixel_tool_invalid_arguments'
      && error.diagnostic.last_argument_rejection.rule === 'codebook_mismatch'
      && error.diagnostic.last_argument_rejection.field === 'operations[0]',
  )
  assert.equal((await opaqueSession.candidate()).sha256, opaqueBefore)
  const opaqueReadAfter = JSON.parse((await opaqueSession.call('read_region', {})).contentItems[0].text)
  assert.deepEqual(opaqueReadAfter.grid, ['00', '00'])

  // 7. Legacy flood-fill and replace-color cannot cross allowedRect
  await assert.rejects(
    session.call('draw_pixels', { operations: [{ type: 'flood-fill', rect: { x: 0, y: 0, w: 64, h: 64 }, seed: { x: 2, y: 2 }, color: [0, 200, 0, 255] }] }),
    error => error.code === 'pixel_tool_invalid_arguments' && error.diagnostic.rule === 'rect_bounds',
  )
  await session.call('draw_pixels', { operations: [{ type: 'flood-fill', rect: allowedRect, seed: { x: 2, y: 2 }, color: [0, 200, 0, 255] }] })
  const afterFlood = Buffer.from((await session.candidate()).rgba_hex, 'hex')
  assert.deepEqual([...afterFlood.subarray((2 * 64 + 1) * 4, (2 * 64 + 1) * 4 + 4)], [250, 0, 0, 255], 'pixel at (1,2) outside allowedRect untouched by flood-fill')
  assert.deepEqual([...afterFlood.subarray((2 * 64 + 4) * 4, (2 * 64 + 4) * 4 + 4)], [250, 0, 0, 255], 'pixel at (4,2) outside allowedRect untouched by flood-fill')
  assert.deepEqual([...afterFlood.subarray((2 * 64 + 2) * 4, (2 * 64 + 2) * 4 + 4)], [0, 200, 0, 255], 'pixel at (2,2) inside allowedRect updated')
})

test('N1 conversation binds regional scope grant and rejects missing or mismatched grant without falling back to full canvas', async () => {
  const f = fixture()
  const grantRect = { x: 4, y: 5, w: 6, h: 6 }
  let activeGrant = {
    grant_id: 'grant_11111111111111111111111111111111',
    project_id: 'project_a',
    document_id: 'doc_a',
    project_revision: 2,
    working_revision: 1,
    frame_id: 'f',
    layer_id: 'l',
    cel_id: 'c',
    rect: grantRect,
    allowed_operations: ['read_region', 'patch_region'],
  }
  const service = createAssistantConversations({
    records: null,
    load: async () => ({ project: f.project }),
    readDocument: async () => ({ manifest: f.manifest }),
    readGrant: async (_scope, _project, _manifest, grantId) => {
      if (activeGrant && activeGrant.grant_id === grantId) return activeGrant
      throw new Error('grant_not_found')
    },
    adapters: {
      astra: async ({ message, pixelTools }) => {
        assert.match(message, /read_region/)
        assert.match(message, /patch_region/)
        assert.equal(pixelTools.instructions, PIXEL_TOOL_INSTRUCTIONS)
        // Attempt unapproved draw_pixels when grant only allows read_region/patch_region
        await assert.rejects(
          pixelTools.call('draw_pixels', { operations: [paint] }),
          err => err.diagnostic?.reason === 'authorization',
        )
        const readRes = await pixelTools.call('read_region', {})
        const obs = JSON.parse(readRes.contentItems[0].text)
        assert.deepEqual(obs.allowed_rect, grantRect)
        const row = `1${'.'.repeat(grantRect.w - 1)}`
        const grid = [row, ...Array(grantRect.h - 1).fill('.'.repeat(grantRect.w))]
        await pixelTools.call('patch_region', {
          rect: grantRect,
          grid,
          codebook_hash: obs.codebook_hash,
          expected_candidate_hash: obs.candidate_sha256,
        })
        return { status: 'completed', provider: 'codex', model: ASTRA_PIXEL_MODEL, threadId: 'native-regional', reply: 'Region updated.' }
      },
    },
  })
  const opened = await service.open(f.scope, { provider: 'astra', model: ASTRA_PIXEL_MODEL })
  await assert.rejects(
    service.send(f.scope, {
      ...request(opened.conversation),
      operation_id: '33333333-3333-4333-8333-333333333333',
      grant_id: 'grant_99999999999999999999999999999999',
    }),
    { code: 'assistant_context_changed' },
  )
  // allowed_colors without grant_id is rejected
  await assert.rejects(
    service.send(f.scope, {
      ...request(opened.conversation),
      operation_id: '35353535-3535-4353-8353-353535353535',
      allowed_colors: [[255, 120, 0, 255]],
    }),
    { code: 'invalid_assistant_message' },
  )
  const res = await service.send(f.scope, {
    ...request(opened.conversation),
    operation_id: '44444444-4444-4444-8444-444444444444',
    grant_id: activeGrant.grant_id,
    allowed_colors: [[255, 120, 0, 255]],
  })
  assert.deepEqual(res.context.allowed_rect, grantRect)
  assert.deepEqual(res.pixel_candidate.allowed_rect, grantRect)
  assert.equal(res.pixel_candidate.drawing_batches, 1)
})

test('N1 legacy command expression vs character-grid patch expression produces identical RGBA with smaller payload', async () => {
  const source = blank()
  const rect = { x: 16, y: 16, w: 8, h: 8 }
  const palette = [
    [0, 0, 0, 0],
    [240, 60, 40, 255],
    [40, 180, 240, 255],
    [250, 220, 60, 255],
  ]
  const legacySession = createPixelToolSession({ rgba: source, allowedRect: rect, allowedColors: palette, grantId: 'grant-cmp-legacy' })
  const gridSession = createPixelToolSession({ rgba: source, allowedRect: rect, allowedColors: palette, grantId: 'grant-cmp-grid' })
  const obs = JSON.parse((await gridSession.call('read_region', { rect })).contentItems[0].text)
  const symbolByColor = new Map(Object.entries(obs.codebook).map(([sym, rgba]) => [rgba.join(','), sym]))

  const byColor = new Map()
  const gridRows = []
  for (let row = 0; row < rect.h; row += 1) {
    let chars = ''
    for (let col = 0; col < rect.w; col += 1) {
      const color = palette[(row + col) % palette.length]
      const key = color.join(',')
      if ((row + col) % palette.length === 0) {
        chars += '.'
      } else {
        chars += symbolByColor.get(key)
        if (!byColor.has(key)) byColor.set(key, { color, points: [] })
        byColor.get(key).points.push({ x: rect.x + col, y: rect.y + row })
      }
    }
    gridRows.push(chars)
  }

  const legacyArgs = {
    operations: [...byColor.values()].map(group => ({
      type: 'pencil',
      rect,
      points: group.points,
      color: group.color,
    })),
  }
  const gridArgs = {
    rect,
    grid: gridRows,
    codebook_hash: obs.codebook_hash,
    expected_candidate_hash: obs.candidate_sha256,
  }
  const legacyBytes = Buffer.byteLength(JSON.stringify(legacyArgs))
  const gridBytes = Buffer.byteLength(JSON.stringify(gridArgs))

  await legacySession.call('draw_pixels', legacyArgs)
  await gridSession.call('patch_region', gridArgs)

  const legacyCand = await legacySession.candidate()
  const gridCand = await gridSession.candidate()
  assert.equal(gridCand.sha256, legacyCand.sha256, 'character-grid patch and legacy pencil operations produce identical RGBA')
  assert.equal(legacyArgs.operations.length, 3)
  assert.ok(gridBytes < legacyBytes, `grid payload (${gridBytes} B) is smaller than legacy coordinate payload (${legacyBytes} B)`)
})
