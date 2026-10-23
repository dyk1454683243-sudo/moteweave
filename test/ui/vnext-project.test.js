import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  VNEXT_EDITOR_API_PREFIX,
  VNEXT_PROJECT_COPY,
  classifyEditorHttpError,
  compareLayoutConflict,
  createRequestEpoch,
  createFrameCoalescer,
  createVnextProjectClient,
  recoverableRequest,
  filterProjectSummaries,
  formatLastSaved,
  isAllowedEditorProjectUrl,
  listedDirtyPositions,
  projectListViewModel,
  sha256Hex,
  shouldProtectLeave,
} from '../../src/ui/vnext/vnext-project-client.js'
import { beginPendingSave } from '../../src/ui/vnext/vnext-preview.js'
import {
  VNEXT_ZOOM_MAX,
  VNEXT_ZOOM_MIN,
  clampZoom,
  createVnextCanvasView,
  locatorHitTest,
  locatorMapModel,
  locatorToWorld,
  zoomPercentLabel,
} from '../../src/ui/vnext/vnext-canvas-view.js'

const SAMPLE = [
  { id: 'forest_01', name: 'Forest creatures', version: 'editor_project_v1', revision: 3, updated_at: '2026-09-18T16:32:00.000Z' },
  { id: 'town_02', name: 'Town characters', version: 'editor_project_v1', revision: 1, updated_at: '2026-09-17T09:10:00.000Z' },
  { id: 'village_03', name: 'Village archive', version: 'editor_project_v0', revision: 2, updated_at: '2026-09-14T11:24:00.000Z' },
]

function jsonResponse(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        if (name === 'content-type') return 'application/json'
        return headers[name] || null
      },
    },
    async json() { return body },
  }
}

test('P2-04 client stays on allowlisted editor project URLs', () => {
  assert.equal(isAllowedEditorProjectUrl('/api/editor/projects'), true)
  assert.equal(isAllowedEditorProjectUrl('/api/editor/projects/abc/canvas-layout'), true)
  assert.equal(isAllowedEditorProjectUrl('/api/editor/projects/v1'), true)
  assert.equal(isAllowedEditorProjectUrl('/api/generate-character'), false)
  assert.equal(isAllowedEditorProjectUrl('/api/process-sheet'), false)
  assert.equal(VNEXT_EDITOR_API_PREFIX, '/api/editor/projects')
})

test('P2-04 local filter does not hide omitted and keeps Open disabled until a visible row is selected', () => {
  assert.deepEqual(filterProjectSummaries(SAMPLE, 'CASTLE'), [])
  assert.deepEqual(filterProjectSummaries(SAMPLE, 'village_03').map((item) => item.id), ['village_03'])
  const choose = projectListViewModel({ status: 'ready', projects: SAMPLE, omitted_count: 0, query: '', selectedId: null })
  assert.equal(choose.openDisabled, true)
  assert.equal(choose.hintText, VNEXT_PROJECT_COPY.chooseHint)
  assert.equal(choose.countText, VNEXT_PROJECT_COPY.countInWorkspace(3))
  assert.equal(choose.hintText || choose.countText, VNEXT_PROJECT_COPY.chooseHint)
  const selected = projectListViewModel({ status: 'ready', projects: SAMPLE, omitted_count: 2, query: '', selectedId: 'forest_01' })
  assert.equal(selected.canOpen, true)
  assert.equal(selected.showOmitted, true)
  assert.equal(selected.countText, VNEXT_PROJECT_COPY.countCanOpen(3))
  const noMatch = projectListViewModel({ status: 'ready', projects: SAMPLE, omitted_count: 2, query: 'castle' })
  assert.equal(noMatch.noMatch, true)
  assert.equal(noMatch.openDisabled, true)
  assert.equal(noMatch.showOmitted, true)
  const unread = projectListViewModel({ status: 'ready', projects: [], omitted_count: 4 })
  assert.equal(unread.allUnreadable, true)
  assert.equal(unread.openDisabled, true)
  const empty = projectListViewModel({ status: 'ready', projects: [], omitted_count: 0 })
  assert.equal(empty.emptyWorkspace, true)
  const loading = projectListViewModel({ status: 'loading', projects: SAMPLE, selectedId: 'forest_01' })
  assert.equal(loading.loading, true)
  assert.equal(loading.openDisabled, true)
  const error = projectListViewModel({ status: 'error', error: new Error('down') })
  assert.equal(error.wholeError, true)
  assert.equal(error.openDisabled, true)
})

test('P2-04 last-saved labels stay English and older-format copy is the accepted Claude text', () => {
  assert.equal(formatLastSaved('2026-09-18T16:32:00.000Z', new Date('2026-09-19T00:00:00.000Z')), 'Sep 18, 16:32')
  assert.equal(formatLastSaved('2025-09-14T11:24:00.000Z', new Date('2026-09-19T00:00:00.000Z')), 'Sep 14, 2025, 11:24')
  assert.equal(VNEXT_PROJECT_COPY.olderFormat, 'Older format · Opens as an upgraded copy')
  assert.equal(VNEXT_PROJECT_COPY.omittedBody, "They aren't shown here. The other projects can still be opened.")
})

test('P2-04 error kinds keep 500/offline as unknown and do not claim unsubmitted', () => {
  assert.equal(classifyEditorHttpError({ status: 409, body: { error: 'stale_revision' } }).kind, 'stale')
  assert.equal(classifyEditorHttpError({ status: 409, body: { error: 'operation_conflict' } }).kind, 'operation_conflict')
  assert.equal(classifyEditorHttpError({ status: 422, body: { error: 'invalid_request' } }).kind, 'known_reject')
  const five = classifyEditorHttpError({ status: 500, body: { error: 'storage_commit_failed' } })
  assert.equal(five.kind, 'unknown')
  assert.equal(five.submittedUnknown, true)
  const offline = classifyEditorHttpError({ status: 0, offline: true })
  assert.equal(offline.kind, 'unknown')
  assert.equal(offline.submittedUnknown, true)
})

test('P2-04 leave protection and conflict compare keep drafts unless discarded', () => {
  assert.equal(shouldProtectLeave({ dirty: true }), true)
  assert.equal(shouldProtectLeave({ pendingImport: true }), true)
  assert.equal(shouldProtectLeave({ pendingSave: true }), true)
  assert.equal(shouldProtectLeave({}), false)
  const drafts = { canvas_a: { x: 10, y: 20 }, canvas_b: { x: 0, y: 0 } }
  const latest = [
    { id: 'canvas_a', x: 4, y: 8 },
    { id: 'canvas_b', x: 0, y: 0 },
    { id: 'canvas_c', x: 9, y: 9 },
  ]
  assert.deepEqual(compareLayoutConflict(drafts, latest), [
    { canvas_id: 'canvas_a', draft: { x: 10, y: 20 }, latest: { x: 4, y: 8 } },
  ])
  assert.deepEqual(listedDirtyPositions(latest, drafts), [
    { canvas_id: 'canvas_a', x: 10, y: 20 },
  ])
})

test('P2-04 list cancel and late responses do not replace the current list token', async () => {
  let release
  const blocked = new Promise((resolve) => { release = resolve })
  let calls = 0
  const fetchImpl = async (url) => {
    calls += 1
    if (calls === 1) {
      await blocked
      return jsonResponse(200, { projects: SAMPLE, omitted_count: 0 })
    }
    return jsonResponse(200, { projects: [SAMPLE[0]], omitted_count: 1 })
  }
  const client = createVnextProjectClient({ fetchImpl })
  const first = client.listProjects()
  client.cancelList()
  release()
  const late = await first
  assert.equal(late.ok, true)
  assert.equal(late.stale, true)
  const second = await client.listProjects()
  assert.equal(second.stale, false)
  assert.equal(second.omitted_count, 1)
  assert.equal(second.projects.length, 1)
})

test('P2-04 GET list uses no query or body and open GET ignores a cancelled token', async () => {
  const seen = []
  const fetchImpl = async (url, init = {}) => {
    seen.push({ url, method: init.method, body: init.body || null })
    if (String(url).endsWith('/api/editor/projects')) {
      return jsonResponse(200, { projects: [], omitted_count: 0 })
    }
    return jsonResponse(200, { project: { id: 'forest_01', name: 'Forest creatures', version: 'editor_project_v1', canvases: {} } })
  }
  const client = createVnextProjectClient({ fetchImpl })
  await client.listProjects()
  assert.equal(seen[0].url, '/api/editor/projects')
  assert.equal(seen[0].method, 'GET')
  assert.equal(seen[0].body, null)
  const token = client.openEpoch.next()
  client.cancelOpen()
  const late = await client.getProject('forest_01', { token })
  assert.equal(late.ok, true)
  assert.equal(late.stale, true)
})

test('P2-04 unknown retry resends the original operation and payload only', async () => {
  const seen = []
  let fail = true
  const fetchImpl = async (url, init = {}) => {
    seen.push({ url, method: init.method, headers: init.headers, body: init.body })
    if (fail) {
      fail = false
      return jsonResponse(500, { error: 'storage_commit_failed', reason: 'disk' })
    }
    return jsonResponse(201, { project: { id: 'p1' }, receipt: { operation_id: '11111111-1111-4111-8111-111111111111' } })
  }
  const client = createVnextProjectClient({ fetchImpl })
  const op = '11111111-1111-4111-8111-111111111111'
  await assert.rejects(() => client.createProjectV1({ operationId: op, name: 'Keep' }))
  assert.equal(client.lastUnknown().body, JSON.stringify({ operation_id: op, name: 'Keep' }))
  const retry = await client.retryUnknown()
  assert.equal(retry.status, 201)
  assert.equal(seen[1].url, seen[0].url)
  assert.equal(seen[1].body, seen[0].body)
  assert.equal(seen[0].headers['X-Editor-Storage-Version'], '2')
  assert.equal(seen[1].headers['X-Editor-Storage-Version'], '2')
})

test('P2-04 import and save requests keep the existing query/body contract', async () => {
  const seen = []
  const png = Uint8Array.from([137, 80, 78, 71])
  const fetchImpl = async (url, init = {}) => {
    seen.push({ url, method: init.method, headers: init.headers, body: init.body })
    return jsonResponse(201, {
      project: { id: 'p1', revision: 3, canvases: {} },
      document: { document_id: 'd1' },
      receipt: { operation_id: '22222222-2222-4222-8222-222222222222', project_revision: 3 },
    })
  }
  const client = createVnextProjectClient({ fetchImpl })
  await client.importPng('p1', {
    operationId: '22222222-2222-4222-8222-222222222222',
    expectedRevision: 2,
    expectedSha256: 'a'.repeat(64),
    name: 'hero',
    bytes: png,
  })
  assert.match(seen[0].url, /\/api\/editor\/projects\/p1\/sprite-documents\/import-png\?/)
  assert.match(seen[0].url, /operation_id=22222222-2222-4222-8222-222222222222/)
  assert.match(seen[0].url, /expected_revision=2/)
  assert.match(seen[0].url, /expected_sha256=a{64}/)
  assert.match(seen[0].url, /name=hero/)
  assert.equal(seen[0].headers['content-type'], 'image/png')
  assert.equal(seen[0].headers['X-Editor-Storage-Version'], '2')
  assert.equal(seen[0].body, png)
  await client.saveLayout('p1', {
    operationId: '33333333-3333-4333-8333-333333333333',
    expectedRevision: 3,
    positions: [{ canvas_id: 'canvas_b', x: 8, y: 4 }],
  })
  assert.equal(seen[1].url, '/api/editor/projects/p1/canvas-layout')
  assert.equal(seen[1].headers['X-Editor-Storage-Version'], '2')
  assert.deepEqual(JSON.parse(seen[1].body), {
    operation_id: '33333333-3333-4333-8333-333333333333',
    expected_revision: 3,
    positions: [{ canvas_id: 'canvas_b', x: 8, y: 4 }],
  })
})

test('from-job client posts the v1 sprite-document contract and never generate-character', async () => {
  const seen = []
  const fetchImpl = async (url, init = {}) => {
    seen.push({ url, method: init.method, body: init.body })
    return jsonResponse(201, {
      project: { id: 'p1', revision: 4 },
      document: { document_id: 'd2', frames: { frame_1: { duration_ms: 110 } } },
      receipt: { operation_id: '44444444-4444-4444-8444-444444444444', project_revision: 4 },
    })
  }
  const client = createVnextProjectClient({ fetchImpl })
  await client.createFromJob('p1', {
    operationId: '44444444-4444-4444-8444-444444444444',
    expectedRevision: 3,
    jobId: 'job_ready',
    expectedSha256: 'b'.repeat(64),
    name: null,
  })
  assert.equal(seen[0].url, '/api/editor/projects/p1/sprite-documents/from-job')
  assert.deepEqual(JSON.parse(seen[0].body), {
    operation_id: '44444444-4444-4444-8444-444444444444',
    expected_revision: 3,
    source: { job_id: 'job_ready', artifact: 'sheet', expected_sha256: 'b'.repeat(64) },
    name: null,
  })
  assert.equal(seen.some((item) => String(item.url).includes('generate-character')), false)
})

test('P2-04 canvas view is memory-only: dirty drafts, zoom clamp, pointer zoom, and Fit all', () => {
  const view = createVnextCanvasView({ zoom: 1 })
  const preview = { kind: 'rgba-preview' }
  view.setCanvases([
    { id: 'canvas_a', x: 0, y: 0, width: 32, height: 32, preview },
    { id: 'canvas_b', x: 64, y: 0, width: 16, height: 16 },
  ])
  assert.equal(view.canvases[0].preview, preview)
  assert.equal(view.isDirty(), false)
  assert.equal(view.hitTest(12, 9, { left: 0, top: 0 }), 'canvas_a')
  view.moveDraft('canvas_a', 12, 9)
  assert.equal(view.isDirty(), true)
  assert.deepEqual(view.listedDirtyPositions(), [{ canvas_id: 'canvas_a', x: 12, y: 9 }])
  view.applySavedPositions([{ canvas_id: 'canvas_a', x: 12, y: 9 }])
  assert.equal(view.isDirty(), false)
  assert.equal(view.positionOf('canvas_a').x, 12)
  assert.equal(clampZoom(0.01), VNEXT_ZOOM_MIN)
  assert.equal(clampZoom(40), VNEXT_ZOOM_MAX)
  assert.equal(zoomPercentLabel(1), '100%')
  view.zoomAt(10, 10, 2, { left: 0, top: 0 })
  assert.equal(view.zoom, 2)
  view.fitAll(200, 200, 0)
  assert.ok(view.zoom > 0 && view.zoom <= VNEXT_ZOOM_MAX)
})

test('transient candidate canvases zoom, select, move, and stay out of save dirty', () => {
  const view = createVnextCanvasView({ zoom: 1 })
  view.setCanvases([{ id: 'canvas_a', x: 0, y: 0, width: 8, height: 8 }])
  view.setTransients([{
    id: 'candidate:job_1',
    x: 0,
    y: 0,
    width: 32,
    height: 32,
    previewUrl: '/generated/job_1/source.png',
    transient: true,
  }])
  assert.equal(view.canvases.length, 2)
  assert.equal(view.select('candidate:job_1'), 'candidate:job_1')
  assert.equal(view.hitTest(10, 10, { left: 0, top: 0 }), 'candidate:job_1')
  view.moveDraft('candidate:job_1', 40, 8)
  assert.equal(view.isDirty(), false)
  assert.deepEqual(view.listedDirtyPositions(), [])
  assert.deepEqual(view.positionOf('candidate:job_1'), { x: 40, y: 8 })
  view.zoomAt(0, 0, 2, { left: 0, top: 0 })
  assert.equal(view.zoom, 2)
  assert.equal(view.centerOn('candidate:job_1', 200, 200), true)
  assert.equal(Math.round(view.panX), 100 - (40 + 16) * 2)
  view.setCanvases([{ id: 'canvas_a', x: 0, y: 0, width: 8, height: 8 }])
  assert.equal(view.canvases.some((item) => item.id === 'candidate:job_1'), true)
  assert.deepEqual(view.positionOf('candidate:job_1'), { x: 40, y: 8 })
})

test('locator map fits canvases and converts a click back to world', () => {
  const model = locatorMapModel({
    canvases: [{
      id: 'candidate:job_1',
      width: 100,
      height: 50,
      position: { x: 0, y: 0 },
      previewUrl: '/generated/job_1/source.png',
      selected: true,
    }],
    panX: 0,
    panY: 0,
    zoom: 1,
    hostWidth: 200,
    hostHeight: 100,
    mapWidth: 220,
    mapHeight: 120,
    padding: 10,
  })
  assert.equal(model.items.length, 1)
  assert.equal(model.items[0].id, 'candidate:job_1')
  assert.equal(locatorHitTest(model, model.items[0].map.x + 1, model.items[0].map.y + 1), 'candidate:job_1')
  const world = locatorToWorld(model, model.offsetX, model.offsetY)
  assert.equal(Math.round(world.x), 0)
  assert.equal(Math.round(world.y), 0)
  viewCenterSanity(model)
})

function viewCenterSanity(model) {
  const mid = locatorToWorld(
    model,
    model.viewport.map.x + model.viewport.map.w / 2,
    model.viewport.map.y + model.viewport.map.h / 2,
  )
  assert.equal(Math.round(mid.x), Math.round(model.viewport.x + model.viewport.w / 2))
  assert.equal(Math.round(mid.y), Math.round(model.viewport.y + model.viewport.h / 2))
}

test('P2-04 pending save keeps new moves dirty and does not invent a second operation', () => {
  const view = createVnextCanvasView()
  view.setCanvases([
    { id: 'canvas_a', x: 0, y: 0, width: 8, height: 8 },
    { id: 'canvas_b', x: 10, y: 0, width: 8, height: 8 },
  ])
  view.moveDraft('canvas_a', 4, 0)
  const sent = view.listedDirtyPositions()
  const session = { pendingSave: null }
  assert.ok(beginPendingSave(session, sent))
  assert.equal(beginPendingSave(session, sent), null)
  view.moveDraft('canvas_b', 12, 6)
  view.applySavedPositions(sent)
  assert.deepEqual(view.listedDirtyPositions(), [{ canvas_id: 'canvas_b', x: 12, y: 6 }])
  assert.deepEqual(view.positionOf('canvas_a'), { x: 4, y: 0 })
  assert.equal(view.canvases.find((item) => item.id === 'canvas_a').x, 4)
  view.moveDraft('canvas_a', 9, 9)
  view.applySavedPositions(session.pendingSave.positions)
  assert.deepEqual(view.positionOf('canvas_a'), { x: 9, y: 9 })
  assert.deepEqual(view.listedDirtyPositions().map((item) => item.canvas_id).sort(), ['canvas_a', 'canvas_b'])
  assert.equal(shouldProtectLeave({ dirty: true, pendingSave: true }), true)
})

test('P2-04 200 headers then JSON reject stay unknown and retry the same write', async () => {
  const seen = []
  let calls = 0
  const fetchImpl = async (_url, init = {}) => {
    seen.push(init.body)
    calls += 1
    if (calls === 1) {
      return {
        ok: true,
        status: 200,
        headers: {
          get(name) {
            return name === 'content-type' ? 'application/json' : null
          },
        },
        async json() {
          throw new SyntaxError('Unexpected end of JSON input')
        },
      }
    }
    return jsonResponse(201, {
      project: { id: 'p1' },
      receipt: { operation_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    })
  }
  const client = createVnextProjectClient({ fetchImpl })
  const error = await client.createProjectV1({
    operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    name: 'Keep',
  }).then(() => null, (caught) => caught)
  assert.equal(error.kind, 'unknown')
  assert.equal(error.status, 200)
  assert.equal(error.submittedUnknown, true)
  assert.equal(error.code, 'body_unreadable')
  assert.equal(client.lastUnknown().body, JSON.stringify({
    operation_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    name: 'Keep',
  }))
  const retry = await client.retryUnknown()
  assert.equal(retry.status, 201)
  assert.equal(seen[1], seen[0])
})

test('P2-04 SHA-256 helper hashes the original PNG bytes', async () => {
  const png = Uint8Array.from(Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082',
    'hex',
  ))
  const digest = await sha256Hex(png)
  assert.equal(digest.length, 64)
  assert.equal(digest, await sha256Hex(png.slice()))
})

test('P2-04 epoch cancel marks the previous token stale', () => {
  const epoch = createRequestEpoch()
  const token = epoch.next()
  assert.equal(epoch.isCurrent(token), true)
  epoch.cancel()
  assert.equal(epoch.isCurrent(token), false)
})

test('P2-04 preview files do not add a new framework and keep unwired product actions off', async () => {
  const [html, js, client, view] = await Promise.all([
    readFile('src/ui/vnext/vnext-preview.html', 'utf8'),
    readFile('src/ui/vnext/vnext-preview.js', 'utf8'),
    readFile('src/ui/vnext/vnext-project-client.js', 'utf8'),
    readFile('src/ui/vnext/vnext-canvas-view.js', 'utf8'),
  ])
  assert.match(html, /Save canvas positions/)
  assert.match(html, /Find a project by name or ID/)
  assert.match(js, /bindVnextProjectSession/)
  assert.match(js, /beforeunload/)
  const withoutLastProjectPreference = js
    .replace("window.localStorage.setItem('vnext-last-project-id', bundle.project.id)", '')
    .replace("window.localStorage.getItem('vnext-last-project-id')", '')
  assert.equal(/indexedDB|localStorage|generate-character|process-sheet/.test(
    `${html}\n${withoutLastProjectPreference}\n${client}\n${view}`), false,
  'Only last project ID storage is permitted; no document cache or generation wiring')
  assert.match(html, /data-capability="HOME-06"[^>]*disabled/)
  assert.match(html, /data-capability="HOME-04"[^>]*disabled/)
  assert.match(html, /data-capability="GEN-05"[^>]*disabled/)
  assert.match(html, /data-capability="TIME-07"[^>]*disabled/)
})

test('replay resends the bound operation after a later unknown request', async () => {
  const seen = []
  const client = createVnextProjectClient({
    fetchImpl: async (url, init = {}) => {
      seen.push(init.body)
      return jsonResponse(500, { error: 'storage_commit_failed', reason: 'disk' })
    },
  })
  const first = '11111111-1111-4111-8111-111111111111'
  const second = '22222222-2222-4222-8222-222222222222'
  let bound = null
  await assert.rejects(() => client.createProjectV1({ operationId: first, name: 'First' }), (error) => {
    bound = error.request
    return error.kind === 'unknown'
  })
  await assert.rejects(() => client.createProjectV1({ operationId: second, name: 'Second' }))
  await assert.rejects(() => client.replay(bound))
  assert.equal(seen[2], seen[0])
  assert.notEqual(seen[2], seen[1])
  assert.equal(JSON.parse(seen[2]).operation_id, first)
  assert.equal(recoverableRequest(null), null)
})

test('pointer paint coalesces repeated move requests into one frame', () => {
  const queued = []
  let paints = 0
  const paint = createFrameCoalescer(() => { paints += 1 }, (callback) => queued.push(callback))
  for (let i = 0; i < 40; i += 1) paint.request()
  assert.equal(queued.length, 1)
  queued[0]()
  assert.equal(paints, 1)
  assert.equal(paint.runs, 1)
})
