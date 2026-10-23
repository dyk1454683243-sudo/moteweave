import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  bindSubscriptionSheet,
  buildSubscriptionFromJob,
  classifySubscriptionProcess,
  attachSubscriptionDebugReport,
  createSubscriptionSheetClient,
  subscriptionProcessAllowed,
  subscriptionQualityPassed,
  SUBSCRIPTION_SHEET_COPY,
  SUBSCRIPTION_SHEET_FIGMA,
  subscriptionOriginalReviewCopy,
  subscriptionSheetName,
} from '../../src/ui/vnext/vnext-subscription-sheet.js'

const passing = {
  id: 'job_sheet',
  status: 'done',
  debug_report: { status: 'pass', subject_count: { required: true, status: 'pass' } },
  normalized_sheet_url: '/generated/job_sheet/normalized_sheet.png',
}

test('subscription processing and canvas add stay closed until accept and a processed-sheet hash', async () => {
  assert.equal(subscriptionQualityPassed({ status: 'done', debug_report: { status: 'pass' } }), false)
  assert.equal(subscriptionQualityPassed(passing), true)
  assert.equal(subscriptionQualityPassed({ ...passing, debug_report: { validation: { status: 'pass' }, subject_count: { required: true, status: 'pass' } } }), true)
  assert.equal(subscriptionProcessAllowed({ accepted: false, status: 'ready', process_sheet: { source_base64: 'aa', options: { sourceLayout: 'fixed_region_motion_v0', backgroundMode: 'already_processed', backgroundRequestMode: 'deterministic_pixel_matte_v2', inputAlphaProvenance: 'calibrated', fixedRegionSourceStaging: 'none', subjectCountGate: true, source: { type: 'subscription_sheet' }, generation: { model: null, image_model: null } } } }), false)
  let posts = 0
  const client = createSubscriptionSheetClient({ fetchImpl: async () => { posts += 1; return { ok: true, text: async () => '{}' } } })
  await assert.rejects(() => client.processAccepted({ accepted: false, status: 'ready' }), /Accept the original/)
  await assert.rejects(() => client.processAccepted({ accepted: true, status: 'accepted', background_review_required: true }), /Accept the original/)
  assert.equal(posts, 0)
  assert.throws(() => buildSubscriptionFromJob({
    operationId: 'op', expectedRevision: 1, processJob: { status: 'done', debug_report: { status: 'pass' } },
    sheetSha256: 'b'.repeat(64), originalSha256: 'a'.repeat(64),
  }), /did not pass/)
  assert.throws(() => buildSubscriptionFromJob({
    operationId: 'op', expectedRevision: 1, processJob: passing, sheetSha256: 'a'.repeat(64), originalSha256: 'a'.repeat(64),
  }), /processed sheet hash/)
  const payload = buildSubscriptionFromJob({
    operationId: 'op', expectedRevision: 3, processJob: passing, sheetSha256: 'b'.repeat(64), originalSha256: 'a'.repeat(64), name: 'ranger',
  })
  assert.deepEqual(payload.source, { job_id: 'job_sheet', artifact: 'sheet', expected_sha256: 'b'.repeat(64) })
  const longName = 'a'.repeat(79) + ' rest of description'
  assert.equal(subscriptionSheetName(longName), 'a'.repeat(79))
  assert.equal(subscriptionSheetName('  first\nsecond  '), 'first second')
  assert.equal(buildSubscriptionFromJob({ operationId: 'op', expectedRevision: 3, processJob: passing,
    sheetSha256: 'b'.repeat(64), originalSha256: 'a'.repeat(64), name: longName.slice(0, 80) }).name, 'a'.repeat(79))
  const html = await readFile('src/ui/vnext/vnext-preview.html', 'utf8')
  assert.match(html, /id="vnext-subscription-sheet"/)
  assert.match(html, /id="vnext-subscription-accept"[^>]*hidden/, 'finishing is a recovery control, hidden by default')
  assert.match(html, /id="vnext-subscription-undo"/)
  assert.doesNotMatch(html, /Accept original|Add processed sheet|Nothing is processed or added yet/)
  assert.match(html, /One native-size candidate is generated, processed and added to the canvas/)
  assert.doesNotMatch(SUBSCRIPTION_SHEET_COPY.idle, /2048|2K/)
  assert.equal(subscriptionOriginalReviewCopy({ status: 'ready', original: { width: 1254, height: 1254 } }), `Original 1254×1254. ${SUBSCRIPTION_SHEET_COPY.preview}`)
  assert.equal(subscriptionOriginalReviewCopy({ status: 'rejected_size', original: { width: 1254, height: 1254 } }), `Original 1254×1254. ${SUBSCRIPTION_SHEET_COPY.reviewRejected}`)
  assert.equal(classifySubscriptionProcess({ id: 'job_sheet', status: 'post_processing' }), 'running')
  assert.equal(classifySubscriptionProcess({ id: 'job_sheet', status: 'failed_post_processing' }), 'failed')
  assert.equal(classifySubscriptionProcess(passing), 'ready')
  const bare = { id: 'job_sheet', status: 'done', generation_url: '/generated/job_sheet/generation.json', debug_report_url: '/generated/job_sheet/debug_report.json', normalized_sheet_url: '/generated/job_sheet/normalized_sheet.png' }
  const attached = await attachSubscriptionDebugReport(bare, async () => ({ ok: true, json: async () => ({ status: 'pass', subject_count: { required: true, status: 'pass' } }) }))
  assert.equal(classifySubscriptionProcess(attached), 'ready')
  const foreign = { ...bare, debug_report_url: 'https://example.test/report.json' }
  assert.equal(await attachSubscriptionDebugReport(foreign, async () => { throw new Error('off_origin') }), foreign)
})

test('subscription status queries its project-bound processing recovery endpoint', async () => {
  const requests = []
  const client = createSubscriptionSheetClient({ fetchImpl: async url => {
    requests.push(url)
    return { ok: true, text: async () => JSON.stringify(passing) }
  } })
  assert.equal((await client.processingJob('project', 'candidate')).id, passing.id)
  assert.deepEqual(requests, ['/api/editor/projects/project/subscription-sheet-candidates/candidate/processing'])
})

// ---- direct-execution flow of the subscription sheet panel (local fakes; no provider is reachable) ----
function fakeElement(id) {
  const listeners = new Map()
  const el = {
    id, hidden: false, disabled: false, textContent: '', dataset: {}, attributes: {},
    classList: { values: new Set(), toggle(name, on) { on ? this.values.add(name) : this.values.delete(name) } },
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn) },
    async click() { if (el.disabled) return; for (const fn of listeners.get('click') || []) await fn({ target: el }) },
    focus() {},
    getAttribute(name) { return name === 'src' ? (el.src || null) : (el.attributes[name] ?? null) },
    removeAttribute(name) { if (name === 'src') delete el.src; delete el.attributes[name] },
  }
  return el
}
function subscriptionPanel() {
  const ids = ['status', 'preview', 'request', 'refresh', 'accept', 'add', 'undo', 'description', 'close']
  const nodes = Object.fromEntries(ids.map(id => [id, fakeElement(`vnext-subscription-${id}`)]))
  const panel = fakeElement('vnext-subscription-dialog')
  panel.hidden = true
  panel.querySelector = selector => Object.values(nodes).find(node => `#${node.id}` === selector) || null
  const trigger = fakeElement('vnext-subscription-sheet')
  const root = { querySelector: selector => (selector === '#vnext-subscription-dialog' ? panel : selector === '#vnext-subscription-sheet' ? trigger : null) }
  return { root, panel, trigger, nodes }
}
const ORIGINAL = { width: 1254, height: 1254, sha256: 'a'.repeat(64), mime_type: 'image/png' }
const PROCESSED = { id: 'job_proc', status: 'done', debug_report: { status: 'pass', subject_count: { required: true, status: 'pass' } }, normalized_sheet_url: '/generated/job_proc/normalized_sheet.png' }
function subscriptionFakes({ statuses, current = null }) {
  const calls = { start: 0, status: 0, accept: [], process: 0, add: 0, reserve: 0, reload: 0 }
  let receipt = null
  let processReads = 0
  const client = {
    async start(_projectId, body) { calls.start += 1; receipt = { operation_id: body.operation_id, status: 'running', request: body }; return receipt },
    async current() { if (!current) throw Object.assign(new Error('none'), { status: 404 }); receipt = current; return current },
    async status() { calls.status += 1; const next = statuses.shift(); if (next) receipt = { ...receipt, ...next }; return receipt },
    async original() { return new Uint8Array([1, 2, 3]) },
    async accept(_projectId, _operationId, sha, basis) {
      calls.accept.push({ sha, basis })
      receipt = { ...receipt, accepted: true, status: 'accepted', ...(basis ? { acceptance_basis: basis } : {}), process_sheet: { source_base64: 'AA==', options: {} } }
      return receipt
    },
    async markProcessing() { receipt = { ...receipt, process_attempted: true, processing_acquired: true }; return receipt },
    async processAccepted() { calls.process += 1; return { id: 'job_proc' } },
    async bindProcessJob(_projectId, _operationId, id) { receipt = { ...receipt, process_job_id: id }; return receipt },
    async processingJob() { processReads += 1; return processReads === 1 ? { id: 'job_proc', status: 'post_processing' } : PROCESSED },
    async reserveAdd(_projectId, _operationId, frozen) { calls.reserve += 1; receipt = { ...receipt, add_request: frozen }; return receipt },
    async addProcessed() { calls.add += 1; return { project: { id: 'proj', revision: 6, canvases: { sheet: { id: 'sheet', document_id: 'doc_sheet' } } }, document: { document_id: 'doc_sheet' } } },
    async recordAdded(_projectId, _operationId, body) { receipt = { ...receipt, added: body, reload_pending: true }; return receipt },
    async noteReload() { calls.reload += 1; receipt = { ...receipt, reload_pending: false }; return receipt },
  }
  const entries = []
  let latest = null
  const undone = []
  const session = {
    project: { id: 'proj', revision: 5, canvases: {} },
    api: { async getProject() { return { ok: true, project: { id: 'proj', revision: 6, canvases: { sheet: { id: 'sheet', document_id: 'doc_sheet' } } } } } },
    async reloadProject(project) { session.project = project; return { committed: true } },
    recordCanvasAddition({ projectId, canvasId }) {
      const found = entries.find(entry => entry.canvasId === canvasId)
      if (found) return found
      const entry = { kind: 'import', projectId, canvasId }
      entries.push(entry); latest = entry
      return entry
    },
    latestUndoEntry: () => latest,
    async undoIfLatest(entry) { if (entry !== latest) return false; undone.push(entry); latest = null; return true },
  }
  const fetchImpl = async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([9, 9, 9]).buffer })
  return { client, session, calls, entries, undone, fetchImpl }
}

test('every fixed subscription status maps to one Figma Current dialog state', () => {
  const statusKeys = Object.keys(SUBSCRIPTION_SHEET_COPY).filter(key => !['title', 'request', 'refresh', 'accept', 'acceptRejected', 'add', 'undo', 'redo'].includes(key))
  for (const key of statusKeys) assert.match(SUBSCRIPTION_SHEET_FIGMA.states.get(SUBSCRIPTION_SHEET_COPY[key]) || '', /^\d+:\d+$/, `${key} has a Current node`)
  assert.equal(new Set(statusKeys.map(key => SUBSCRIPTION_SHEET_FIGMA.states.get(SUBSCRIPTION_SHEET_COPY[key]))).size, statusKeys.length, 'one node per state')
  assert.equal(SUBSCRIPTION_SHEET_FIGMA.row, '2874:2270')
})

test('a requested subscription sheet runs to placement without accept or add steps, records user_request and offers Undo', async () => {
  const fakes = subscriptionFakes({ statuses: [{ status: 'running' }, { status: 'ready', original: ORIGINAL, reviewable_original: true }] })
  const ui = subscriptionPanel()
  const binding = bindSubscriptionSheet({ root: ui.root, session: fakes.session, client: fakes.client, fetchImpl: fakes.fetchImpl,
    createOperationId: (() => { let n = 0; return () => `00000000-0000-4000-8000-00000000000${++n}` })(), wait: async () => {} })
  ui.nodes.description.value = 'forest messenger'
  await ui.trigger.click()
  assert.equal(ui.nodes.accept.hidden, true, 'no accept step before or during the run')
  await binding.requestCandidate()
  assert.equal(fakes.calls.start, 1, 'one candidate request')
  assert.deepEqual(fakes.calls.accept, [{ sha: ORIGINAL.sha256, basis: 'user_request' }], 'accepted by the request, recorded as user_request')
  assert.equal(fakes.calls.process, 1)
  assert.equal(fakes.calls.add, 1, 'placed once without an Add click')
  assert.equal(ui.nodes.status.textContent, SUBSCRIPTION_SHEET_COPY.added)
  assert.equal(ui.panel.dataset.figmaVariant, '2874:2342', 'the added state maps to its Figma Current dialog')
  assert.equal(ui.nodes.accept.hidden, true)
  assert.equal(ui.nodes.add.hidden, true)
  assert.equal(ui.nodes.undo.hidden, false)
  assert.deepEqual(fakes.entries.map(entry => entry.canvasId), ['sheet'], 'one Undo entry for exactly the added canvas')
  await ui.nodes.undo.click()
  assert.deepEqual(fakes.undone, [fakes.entries[0]])
  assert.equal(ui.nodes.status.textContent, SUBSCRIPTION_SHEET_COPY.undone)
  assert.equal(ui.panel.dataset.figmaVariant, '2874:2370', 'the undone state maps to its Figma Current dialog')
  assert.equal(ui.nodes.undo.hidden, true)
  await binding.refresh()
  assert.equal(fakes.calls.start, 1); assert.equal(fakes.calls.add, 1, 'checking status again never repeats a step')
})

test('a subscription canvas reload that a newer same-project save supersedes stays pending and binds no Undo; a later check completes it once', async () => {
  const fakes = subscriptionFakes({ statuses: [{ status: 'running' }, { status: 'ready', original: ORIGINAL, reviewable_original: true }] })
  // The shared reload refuses an older read once a newer revision of the project is shown (session.reloadProject);
  // the canvas shows only what a committed reload rendered.
  fakes.session.view = { canvases: [] }
  const reloadProject = fakes.session.reloadProject
  let superseded = true
  fakes.session.reloadProject = async project => {
    if (superseded) return { stale: true, committed: false, superseded: true }
    const applied = await reloadProject(project)
    fakes.session.view.canvases = Object.values(project.canvases || {}).map(canvas => ({ id: canvas.id }))
    return applied
  }
  const ui = subscriptionPanel()
  const binding = bindSubscriptionSheet({ root: ui.root, session: fakes.session, client: fakes.client, fetchImpl: fakes.fetchImpl,
    createOperationId: (() => { let n = 0; return () => `00000000-0000-4000-8000-00000000000${++n}` })(), wait: async () => {} })
  ui.nodes.description.value = 'forest messenger'
  await ui.trigger.click()
  await binding.requestCandidate()
  assert.equal(fakes.calls.add, 1)
  assert.equal(ui.nodes.status.textContent, SUBSCRIPTION_SHEET_COPY.reloadPending, 'a superseded reload never reports the sheet as on the canvas')
  assert.equal(ui.panel.dataset.figmaVariant, '2874:2551')
  assert.equal(fakes.calls.reload, 0, 'the reload is not recorded')
  assert.deepEqual(fakes.entries, [], 'no Undo is bound')
  assert.equal(ui.nodes.undo.hidden, true)
  superseded = false
  await binding.refresh()
  assert.equal(fakes.calls.add, 1, 'nothing is added again')
  assert.equal(fakes.calls.reload, 1)
  assert.equal(ui.nodes.status.textContent, SUBSCRIPTION_SHEET_COPY.added)
  assert.deepEqual(fakes.entries.map(entry => entry.canvasId), ['sheet'], 'Undo is bound to exactly the added canvas')
  assert.equal(ui.nodes.undo.hidden, false)
})

// r8 (found by the rendered check): when only the note that the canvas reload finished fails, the add is
// confirmed and recorded; the panel keeps the reload pending for Check status instead of an unconfirmed add.
test('r8: a confirmed subscription add whose reload note fails stays reload pending (never an unconfirmed add); Check status completes it once', async () => {
  const fakes = subscriptionFakes({ statuses: [{ status: 'running' }, { status: 'ready', original: ORIGINAL, reviewable_original: true }] })
  const noteReload = fakes.client.noteReload
  let failNote = true
  fakes.client.noteReload = async (...args) => {
    if (failNote) { failNote = false; throw Object.assign(new Error('storage_commit_failed'), { status: 500, code: 'storage_commit_failed' }) }
    return noteReload(...args)
  }
  const ui = subscriptionPanel()
  const binding = bindSubscriptionSheet({ root: ui.root, session: fakes.session, client: fakes.client, fetchImpl: fakes.fetchImpl,
    createOperationId: (() => { let n = 0; return () => `00000000-0000-4000-8000-00000000000${++n}` })(), wait: async () => {} })
  ui.nodes.description.value = 'forest messenger'
  await ui.trigger.click()
  await binding.requestCandidate()
  assert.equal(fakes.calls.add, 1)
  assert.equal(ui.nodes.status.textContent, SUBSCRIPTION_SHEET_COPY.reloadPendingShown, 'the shown sheet is never reported as not confirmed or not reloaded')
  assert.notEqual(ui.nodes.status.textContent, SUBSCRIPTION_SHEET_COPY.addUnknown)
  assert.equal(ui.panel.dataset.figmaVariant, '2942:2776')
  assert.equal(ui.nodes.add.hidden, true, 'no second add is offered')
  assert.equal(ui.nodes.refresh.hidden, false)
  await binding.refresh()
  assert.equal(fakes.calls.add, 1, 'nothing is added again')
  assert.equal(fakes.calls.reload, 1)
  assert.equal(ui.nodes.status.textContent, SUBSCRIPTION_SHEET_COPY.added)
  assert.deepEqual(fakes.entries.map(entry => entry.canvasId), ['sheet'], 'Undo is bound to exactly the added canvas')
})

// r8 (final audit): the reload note committed but its answer was lost (the server no longer holds it
// pending); Check status still completes the pending reload instead of leaving it pending forever.
test('r8: a subscription reload note that committed unanswered is completed by Check status', async () => {
  const fakes = subscriptionFakes({ statuses: [{ status: 'running' }, { status: 'ready', original: ORIGINAL, reviewable_original: true }] })
  const noteReload = fakes.client.noteReload
  let loseAnswer = true
  fakes.client.noteReload = async (...args) => {
    const committed = await noteReload(...args)
    if (loseAnswer) { loseAnswer = false; throw Object.assign(new Error('lost'), { status: 0 }) }
    return committed
  }
  const ui = subscriptionPanel()
  const binding = bindSubscriptionSheet({ root: ui.root, session: fakes.session, client: fakes.client, fetchImpl: fakes.fetchImpl,
    createOperationId: (() => { let n = 0; return () => `00000000-0000-4000-8000-00000000000${++n}` })(), wait: async () => {} })
  ui.nodes.description.value = 'forest messenger'
  await ui.trigger.click()
  await binding.requestCandidate()
  assert.equal(ui.nodes.status.textContent, SUBSCRIPTION_SHEET_COPY.reloadPendingShown)
  await binding.refresh()
  assert.equal(ui.nodes.status.textContent, SUBSCRIPTION_SHEET_COPY.added, 'Check status completes it')
  assert.equal(fakes.calls.add, 1, 'nothing is added again')
})

test('pending subscription recovery keeps the same Undo/Redo through Check status and keyboard changes', async () => {
  const fakes = subscriptionFakes({ statuses: [{ status: 'running' }, { status: 'ready', original: ORIGINAL, reviewable_original: true }] })
  const s = fakes.session
  const history = { undo: [], redo: [] }
  s.api.getProject = async () => ({ ok: true, project: s.project })
  s.recordCanvasAddition = ({ projectId, canvasId }) => {
    const found = history.undo.find(entry => entry.canvasId === canvasId)
    if (found) return found
    const entry = { kind: 'import', projectId, canvasId }
    history.undo.push(entry)
    return entry
  }
  s.latestUndoEntry = () => history.undo.at(-1) || null
  s.latestRedoEntry = () => history.redo.at(-1) || null
  s.undoEntryState = entry => history.undo.includes(entry) ? 'undo' : history.redo.includes(entry) ? 'redo' : 'absent'
  const canvas = { id: 'sheet', document_id: 'doc_sheet' }
  s.undoIfLatest = async entry => {
    if (history.undo.at(-1) !== entry) return false
    history.undo.pop(); history.redo.push(entry)
    s.project = { ...s.project, revision: s.project.revision + 1, canvases: {} }
    return true
  }
  s.redoIfLatest = async entry => {
    if (history.redo.at(-1) !== entry) return false
    history.redo.pop(); history.undo.push(entry)
    s.project = { ...s.project, revision: s.project.revision + 1, canvases: { sheet: canvas } }
    return true
  }
  const noteReload = fakes.client.noteReload
  let failNote = true
  fakes.client.noteReload = async (...args) => {
    if (failNote) { failNote = false; throw new Error('reload acknowledgement failed') }
    return noteReload(...args)
  }
  const ui = subscriptionPanel()
  const listeners = []
  ui.root.addEventListener = (type, fn) => { if (type === 'vnext-draft-change') listeners.push(fn) }
  const binding = bindSubscriptionSheet({ root: ui.root, session: s, client: fakes.client, fetchImpl: fakes.fetchImpl,
    createOperationId: (() => { let n = 0; return () => `00000000-0000-4000-8000-00000000000${++n}` })(), wait: async () => {} })
  ui.nodes.description.value = 'forest messenger'
  await ui.trigger.click()
  await binding.requestCandidate()
  const entry = s.latestUndoEntry()
  assert.equal(ui.nodes.status.textContent, SUBSCRIPTION_SHEET_COPY.reloadPendingShown)
  assert.equal(ui.nodes.undo.hidden, false)
  await ui.nodes.undo.click()
  assert.equal(ui.nodes.status.textContent, SUBSCRIPTION_SHEET_COPY.undoneRedo)
  assert.equal(ui.nodes.undo.textContent, SUBSCRIPTION_SHEET_COPY.redo)
  assert.equal(ui.nodes.undo.hidden, false, 'pending acknowledgement does not hide Redo')
  await binding.refresh()
  assert.equal(binding.recordOf('proj').undo.entry, entry, 'status reads preserve the same undone operation')
  assert.equal(ui.nodes.status.textContent, SUBSCRIPTION_SHEET_COPY.undoneRedo)
  assert.equal(s.project.canvases.sheet, undefined, 'Check status never puts the sheet back')
  await ui.nodes.undo.click()
  assert.deepEqual(s.project.canvases.sheet, canvas)
  assert.equal(ui.nodes.status.textContent, SUBSCRIPTION_SHEET_COPY.added)
  assert.equal(s.latestUndoEntry(), entry)
  // Keyboard history changes must also win over a pending acknowledgement.
  binding.recordOf('proj').reloadPending = true
  await s.undoIfLatest(entry)
  for (const fn of listeners) fn()
  assert.equal(ui.nodes.status.textContent, SUBSCRIPTION_SHEET_COPY.undoneRedo)
  await binding.refresh()
  assert.equal(binding.recordOf('proj').undo.entry, entry)
  await s.redoIfLatest(entry)
  for (const fn of listeners) fn()
  assert.equal(ui.nodes.status.textContent, SUBSCRIPTION_SHEET_COPY.added)
  assert.equal(fakes.calls.add, 1)
  assert.equal(fakes.calls.process, 1)
  assert.equal(history.undo.length, 1, 'recovery creates no duplicate history entry')
})

test('a superseded subscription reload completes once when the newer shown canvas already holds the sheet; nothing is added again', async () => {
  const fakes = subscriptionFakes({ statuses: [{ status: 'running' }, { status: 'ready', original: ORIGINAL, reviewable_original: true }] })
  // A newer same-project revision (for example a position save after a Discard and load) is shown and its
  // canvas already renders the sheet; the older read is refused, but the result is complete.
  fakes.session.view = { canvases: [{ id: 'sheet' }] }
  fakes.session.reloadProject = async () => ({ stale: true, committed: false, superseded: true })
  const ui = subscriptionPanel()
  const binding = bindSubscriptionSheet({ root: ui.root, session: fakes.session, client: fakes.client, fetchImpl: fakes.fetchImpl,
    createOperationId: (() => { let n = 0; return () => `00000000-0000-4000-8000-00000000000${++n}` })(), wait: async () => {} })
  ui.nodes.description.value = 'forest messenger'
  await ui.trigger.click()
  await binding.requestCandidate()
  assert.equal(fakes.calls.add, 1, 'added once')
  assert.equal(fakes.calls.reload, 1, 'the reload is recorded')
  assert.equal(ui.nodes.status.textContent, SUBSCRIPTION_SHEET_COPY.added)
  assert.deepEqual(fakes.entries.map(entry => entry.canvasId), ['sheet'], 'Undo is bound to exactly the added canvas')
  assert.equal(ui.nodes.undo.hidden, false)
})

test('a subscription candidate restored after a reload is only read until Finish processing; an older size rejection is used only by explicit choice', async () => {
  for (const scenario of ['restored', 'rejected']) {
    const restored = { operation_id: '00000000-0000-4000-8000-0000000000aa', status: scenario === 'restored' ? 'ready' : 'rejected_size', original: ORIGINAL,
      reviewable_original: true, accepted: false, request: { operation_id: '00000000-0000-4000-8000-0000000000aa', expected_revision: 4, description: 'messenger' } }
    const fakes = subscriptionFakes({ statuses: [], current: restored })
    const ui = subscriptionPanel()
    const binding = bindSubscriptionSheet({ root: ui.root, session: fakes.session, client: fakes.client, fetchImpl: fakes.fetchImpl, wait: async () => {} })
    await ui.trigger.click()
    for (let i = 0; i < 50; i++) await new Promise(resolve => setImmediate(resolve)) // opening reads the restored state
    assert.equal(fakes.calls.accept.length, 0, `${scenario}: nothing continues on its own after a reload`)
    assert.equal(fakes.calls.start, 0)
    assert.equal(ui.nodes.accept.hidden, false)
    assert.equal(ui.nodes.accept.textContent, scenario === 'restored' ? SUBSCRIPTION_SHEET_COPY.accept : SUBSCRIPTION_SHEET_COPY.acceptRejected)
    await ui.nodes.accept.click()
    assert.deepEqual(fakes.calls.accept.map(call => call.basis), [scenario === 'restored' ? 'user_request' : 'visual_inspection'])
    assert.equal(fakes.calls.add, 1, `${scenario}: the explicit finish runs through placement`)
    assert.equal(ui.nodes.undo.hidden, false)
    assert.equal(fakes.calls.start, 0, 'nothing is generated again')
  }
})

// ---- DIRECT-ACTIONS r4 (R2): every asynchronous step keeps its own project and operation ----
function projectAwareFakes() {
  const OPS = { A: '00000000-0000-4000-8000-0000000000a1', B: '00000000-0000-4000-8000-0000000000b2' }
  const calls = []
  const gates = new Map()
  const hold = name => { let release; const promise = new Promise(resolve => { release = resolve }); gates.set(name, { promise, release }); return promise }
  const receipts = {
    A: null,
    B: { operation_id: OPS.B, status: 'ready', original: ORIGINAL, reviewable_original: true, accepted: false,
      request: { operation_id: OPS.B, expected_revision: 2, description: 'B messenger' } },
  }
  const gated = async (name, value) => { if (gates.has(name)) { const gate = gates.get(name); await gate.promise; gates.delete(name) } return value() }
  const record = (kind, projectId, operationId) => { calls.push({ kind, projectId, operationId }) }
  const client = {
    async start(projectId, body) { record('start', projectId, body.operation_id); receipts[projectId] = { operation_id: body.operation_id, status: 'running', request: body }; return receipts[projectId] },
    async current(projectId) { record('current', projectId, null); return gated(`current:${projectId}`, () => { if (!receipts[projectId]) throw Object.assign(new Error('none'), { status: 404 }); return receipts[projectId] }) },
    async status(projectId, operationId) {
      record('status', projectId, operationId)
      return gated(`status:${projectId}`, () => {
        if (projectId === 'A') receipts.A = { ...receipts.A, status: 'ready', original: ORIGINAL, reviewable_original: true }
        return receipts[projectId]
      })
    },
    async original(projectId, operationId) { record('original', projectId, operationId); return new Uint8Array([projectId === 'A' ? 1 : 2]) },
    async accept(projectId, operationId, sha, basis) {
      record('accept', projectId, operationId)
      return gated(`accept:${projectId}`, () => { receipts[projectId] = { ...receipts[projectId], accepted: true, status: 'accepted', acceptance_basis: basis, process_sheet: { source_base64: 'AA==', options: {} } }; return receipts[projectId] })
    },
    async markProcessing(projectId, operationId) { record('mark', projectId, operationId); receipts[projectId] = { ...receipts[projectId], process_attempted: true, processing_acquired: true }; return receipts[projectId] },
    async processAccepted() { record('process', null, null); return gated('process', () => ({ id: 'job_proc' })) },
    async bindProcessJob(projectId, operationId, id) { record('bind', projectId, operationId); receipts[projectId] = { ...receipts[projectId], process_job_id: id }; return receipts[projectId] },
    async processingJob(projectId, operationId) { record('processing', projectId, operationId); return PROCESSED },
    async reserveAdd(projectId, operationId, frozen) { record('reserve', projectId, operationId); return gated(`reserve:${projectId}`, () => { receipts[projectId] = { ...receipts[projectId], add_request: frozen }; return receipts[projectId] }) },
    // The add carries its own add operation id (not the candidate's), so only its project is checked here.
    async addProcessed({ projectId }) { record('add', projectId, null); return { project: { id: projectId, revision: 9, canvases: { sheet: { id: 'sheet', document_id: 'doc_sheet' } } }, document: { document_id: 'doc_sheet' } } },
    async recordAdded(projectId, operationId, body) { record('added', projectId, operationId); receipts[projectId] = { ...receipts[projectId], added: body, reload_pending: true }; return receipts[projectId] },
    async noteReload(projectId, operationId) { record('reload', projectId, operationId); receipts[projectId] = { ...receipts[projectId], reload_pending: false }; return receipts[projectId] },
  }
  let latest = null
  const session = {
    project: { id: 'A', revision: 1, canvases: {} },
    api: { async getProject(projectId) { return { ok: true, project: { id: projectId, revision: 9, canvases: { sheet: { id: 'sheet', document_id: 'doc_sheet' } } } } } },
    async reloadProject(project) { session.project = project; return { committed: true } },
    recordCanvasAddition({ projectId, canvasId }) { latest = { kind: 'import', projectId, canvasId }; return latest },
    latestUndoEntry: () => latest,
    async undoIfLatest() { return false },
  }
  const fetchImpl = async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([9, 9, 9]).buffer })
  const mismatched = () => calls.filter(call => call.projectId && call.operationId && OPS[call.projectId] !== call.operationId)
  return { OPS, calls, hold, gates, client, session, fetchImpl, receipts, mismatched }
}
const settleSubscription = async () => { for (let i = 0; i < 60; i++) await new Promise(resolve => setImmediate(resolve)) }

test('a delayed status or accept from project A after switching to B never changes B or continues under B, and A keeps its own recovery state', async () => {
  for (const delayed of ['status', 'accept']) {
    const f = projectAwareFakes()
    const ui = subscriptionPanel()
    const binding = bindSubscriptionSheet({ root: ui.root, session: f.session, client: f.client, fetchImpl: f.fetchImpl,
      createOperationId: () => f.OPS.A, wait: async () => {} })
    await ui.trigger.click()
    ui.nodes.description.value = 'A knight'
    f.hold(`${delayed}:A`)
    const running = binding.requestCandidate()
    await settleSubscription()
    assert.ok(f.calls.some(call => call.kind === delayed && call.projectId === 'A'), `${delayed}: A's request is in flight`)
    await ui.nodes.close.click()
    f.session.project = { id: 'B', revision: 2, canvases: {} }
    await ui.trigger.click()
    await settleSubscription()
    const before = { status: ui.nodes.status.textContent, accept: ui.nodes.accept.hidden, description: ui.nodes.description.value, receipt: binding.capture().receipt }
    assert.equal(before.receipt.operation_id, f.OPS.B, `${delayed}: B shows its own restored request`)
    assert.equal(before.accept, false, `${delayed}: B's restored candidate offers Finish processing`)
    assert.equal(before.description, 'B messenger')
    f.gates.get(`${delayed}:A`).release()
    await running
    await settleSubscription()
    assert.equal(ui.nodes.status.textContent, before.status, `${delayed}: B's status text is unchanged`)
    assert.equal(ui.nodes.description.value, 'B messenger')
    assert.equal(binding.capture().receipt.operation_id, f.OPS.B, `${delayed}: B's operation is unchanged`)
    assert.deepEqual(f.mismatched(), [], `${delayed}: no request mixes a project with another project's operation`)
    assert.equal(f.calls.filter(call => ['mark', 'process', 'reserve', 'add'].includes(call.kind)).length, 0, `${delayed}: nothing continues while A is not shown`)
    if (delayed === 'status') assert.equal(f.calls.filter(call => call.kind === 'accept').length, 0, 'A is not accepted while B is shown')
    const a = binding.recordOf('A')
    assert.equal(a.receipt.operation_id, f.OPS.A, `${delayed}: A's record keeps A's operation`)
    assert.equal(a.receipt.status, delayed === 'status' ? 'ready' : 'accepted', `${delayed}: A's record holds A's latest response`)
    // Returning to A continues A's own run under A's identity.
    f.session.project = { id: 'A', revision: 1, canvases: {} }
    await ui.trigger.click()
    await settleSubscription()
    await binding.followThrough()
    await settleSubscription()
    assert.deepEqual(f.mismatched(), [])
    assert.ok(f.calls.some(call => call.kind === 'add' && call.projectId === 'A'), `${delayed}: A is placed after returning to A`)
    assert.equal(ui.nodes.status.textContent, SUBSCRIPTION_SHEET_COPY.added)
  }
})

test('a delayed restore read from project A cannot become B\'s restored state', async () => {
  const f = projectAwareFakes()
  f.receipts.A = { operation_id: f.OPS.A, status: 'ready', original: ORIGINAL, reviewable_original: true, accepted: false,
    request: { operation_id: f.OPS.A, expected_revision: 1, description: 'A knight' } }
  const ui = subscriptionPanel()
  const binding = bindSubscriptionSheet({ root: ui.root, session: f.session, client: f.client, fetchImpl: f.fetchImpl, wait: async () => {} })
  f.hold('current:A')
  const opening = ui.trigger.click()
  await settleSubscription()
  await ui.nodes.close.click()
  f.session.project = { id: 'B', revision: 2, canvases: {} }
  await ui.trigger.click()
  await settleSubscription()
  const shown = { status: ui.nodes.status.textContent, description: ui.nodes.description.value }
  f.gates.get('current:A').release()
  await opening
  await settleSubscription()
  assert.equal(binding.capture().receipt.operation_id, f.OPS.B, 'B keeps its own restored request')
  assert.equal(ui.nodes.status.textContent, shown.status)
  assert.equal(ui.nodes.description.value, 'B messenger')
  assert.equal(binding.recordOf('A').receipt.operation_id, f.OPS.A, 'A\'s restored request stays with A')
  assert.equal(binding.recordOf('A').owner.live, false, 'a restored request is never continued on its own')
  assert.deepEqual(f.mismatched(), [])
  assert.equal(f.calls.filter(call => ['accept', 'mark', 'process', 'add'].includes(call.kind)).length, 0)
})

test('delayed processing and placement responses for project A finish under A only; nothing is placed until A is shown again', async () => {
  for (const delayed of ['process', 'reserve:A']) {
    const f = projectAwareFakes()
    const ui = subscriptionPanel()
    const binding = bindSubscriptionSheet({ root: ui.root, session: f.session, client: f.client, fetchImpl: f.fetchImpl,
      createOperationId: (() => { let n = 0; return () => (n++ === 0 ? f.OPS.A : `00000000-0000-4000-8000-00000000c${String(n).padStart(3, '0')}`) })(), wait: async () => {} })
    await ui.trigger.click()
    f.hold(delayed)
    const running = binding.requestCandidate()
    await settleSubscription()
    assert.ok(f.calls.some(call => call.kind === (delayed === 'process' ? 'process' : 'reserve')), `${delayed}: in flight`)
    await ui.nodes.close.click()
    f.session.project = { id: 'B', revision: 2, canvases: {} }
    await ui.trigger.click(); await settleSubscription()
    const before = { status: ui.nodes.status.textContent, receipt: binding.capture().receipt }
    f.gates.get(delayed).release()
    await running; await settleSubscription()
    assert.equal(ui.nodes.status.textContent, before.status, `${delayed}: B unchanged`)
    assert.equal(binding.capture().receipt.operation_id, f.OPS.B)
    assert.deepEqual(f.mismatched(), [], `${delayed}: every request keeps its own project and operation`)
    assert.equal(f.calls.filter(call => call.kind === 'add').length, 0, `${delayed}: nothing is placed while A is not shown`)
    if (delayed === 'process') assert.ok(f.calls.some(call => call.kind === 'bind' && call.projectId === 'A'), 'an acquired process run is bound under A')
    const a = binding.recordOf('A')
    assert.equal(a.receipt.operation_id, f.OPS.A)
    // Back in A: the same run finishes (once), under A.
    f.session.project = { id: 'A', revision: 1, canvases: {} }
    await ui.trigger.click(); await settleSubscription()
    if (!ui.nodes.add.hidden) await ui.nodes.add.click()
    await binding.followThrough(); await settleSubscription()
    assert.deepEqual(f.mismatched(), [])
    assert.equal(f.calls.filter(call => call.kind === 'add').length, 1, `${delayed}: placed exactly once, in A`)
    assert.equal(f.calls.filter(call => call.kind === 'reserve').length, 1, `${delayed}: one reserved add`)
    assert.equal(ui.nodes.status.textContent, SUBSCRIPTION_SHEET_COPY.added)
  }
})

test('a restored subscription sheet whose canvas was removed later is not reported as on the canvas', async () => {
  const restored = { operation_id: '00000000-0000-4000-8000-0000000000aa', status: 'accepted', accepted: true, original: ORIGINAL,
    process_job_id: 'job_proc', added: { operation_id: 'op-add', document_id: 'doc_gone', project_revision: 6 },
    request: { operation_id: '00000000-0000-4000-8000-0000000000aa', expected_revision: 4, description: 'messenger' } }
  const fakes = subscriptionFakes({ statuses: [], current: restored })
  const ui = subscriptionPanel()
  const binding = bindSubscriptionSheet({ root: ui.root, session: fakes.session, client: fakes.client, fetchImpl: fakes.fetchImpl, wait: async () => {} })
  await ui.trigger.click()
  for (let i = 0; i < 50; i++) await new Promise(resolve => setImmediate(resolve))
  assert.equal(ui.nodes.status.textContent, SUBSCRIPTION_SHEET_COPY.removedLater)
  assert.equal(fakes.calls.add, 0); assert.equal(fakes.calls.start, 0)
  fakes.session.project = { ...fakes.session.project, canvases: { sheet: { id: 'sheet', document_id: 'doc_gone' } } }
  await binding.refresh()
  assert.equal(ui.nodes.status.textContent, SUBSCRIPTION_SHEET_COPY.addedNoUndo, 'still shown when the canvas exists')
})

test('a reload recorded after another project opens still leaves the sheet with its Undo and place; an Undo whose history was replaced is dropped', async () => {
  const fakes = subscriptionFakes({ statuses: [{ status: 'ready', original: ORIGINAL, reviewable_original: true }] })
  const placed = []
  fakes.session.placeAddedCanvas = async ({ projectId, canvasId }) => { placed.push(`${projectId}/${canvasId}`); return { unchanged: true } }
  const noteReload = fakes.client.noteReload
  let releaseNote = null
  fakes.client.noteReload = (...args) => new Promise(resolve => { releaseNote = () => resolve(noteReload(...args)) })
  const ui = subscriptionPanel()
  const binding = bindSubscriptionSheet({ root: ui.root, session: fakes.session, client: fakes.client, fetchImpl: fakes.fetchImpl,
    createOperationId: (() => { let n = 0; return () => `00000000-0000-4000-8000-00000000000${++n}` })(), wait: async () => {} })
  ui.nodes.description.value = 'forest messenger'
  await ui.trigger.click()
  const run = binding.requestCandidate()
  for (let i = 0; i < 200 && !releaseNote; i++) await new Promise(resolve => setImmediate(resolve))
  assert.ok(releaseNote, 'the reload is being recorded')
  assert.deepEqual(fakes.entries.map(entry => entry.canvasId), ['sheet'], 'Undo is bound while the sheet is shown, before the reload is recorded')
  assert.deepEqual(placed, ['proj/sheet'], 'the sheet keeps its place before the reload is recorded')
  const shown = fakes.session.project
  fakes.session.project = { id: 'other', revision: 1, canvases: {} } // another project opens meanwhile
  releaseNote(); await run
  fakes.session.project = shown // back in the first project, its history kept
  await binding.refresh()
  assert.equal(ui.nodes.status.textContent, SUBSCRIPTION_SHEET_COPY.added)
  assert.equal(ui.nodes.undo.hidden, false)
  // Had another project's history replaced this one meanwhile, that Undo could revert nothing.
  fakes.session.undoEntryState = () => 'absent'
  await binding.refresh()
  assert.equal(ui.nodes.status.textContent, SUBSCRIPTION_SHEET_COPY.addedNoUndo, 'no Undo is promised that cannot run')
  assert.equal(ui.nodes.undo.hidden, true)
  assert.equal(fakes.calls.add, 1, 'nothing is added again')
})

test('a run that becomes ready while another project is opening continues by itself once that open ends', async () => {
  const fakes = subscriptionFakes({ statuses: [{ status: 'ready', original: ORIGINAL, reviewable_original: true }] })
  let opening = false
  fakes.session.openInFlight = () => opening
  const bindProcessJob = fakes.client.bindProcessJob
  fakes.client.bindProcessJob = async (...args) => { opening = true; return bindProcessJob(...args) } // an open begins while processing runs
  const ui = subscriptionPanel()
  const binding = bindSubscriptionSheet({ root: ui.root, session: fakes.session, client: fakes.client, fetchImpl: fakes.fetchImpl,
    createOperationId: (() => { let n = 0; return () => `00000000-0000-4000-8000-00000000000${++n}` })(), wait: async () => {} })
  ui.nodes.description.value = 'forest messenger'
  await ui.trigger.click()
  await binding.requestCandidate()
  assert.equal(fakes.calls.reserve, 0, 'nothing is reserved while another project opens')
  assert.equal(fakes.calls.add, 0)
  opening = false
  await binding.refresh()
  assert.equal(fakes.calls.reserve, 1)
  assert.equal(fakes.calls.add, 1, 'the same run continues to placement without an Add click')
  assert.equal(ui.nodes.status.textContent, SUBSCRIPTION_SHEET_COPY.added)
})

test('a run whose project changes while its sheet is hashed reserves nothing and continues by itself when that project is shown again', async () => {
  const fakes = subscriptionFakes({ statuses: [{ status: 'ready', original: ORIGINAL, reviewable_original: true }] })
  const ui = subscriptionPanel()
  const binding = bindSubscriptionSheet({ root: ui.root, session: fakes.session, client: fakes.client, fetchImpl: fakes.fetchImpl,
    createOperationId: (() => { let n = 0; return () => `00000000-0000-4000-8000-00000000000${++n}` })(), wait: async () => {} })
  const shown = fakes.session.project
  const subtle = globalThis.crypto.subtle
  const digest = subtle.digest.bind(subtle)
  let switched = false
  // The project changes exactly while the processed sheet (bytes 9,9,9) is hashed for its add.
  Object.defineProperty(subtle, 'digest', { configurable: true, writable: true, value: async (algorithm, data) => {
    const bytes = new Uint8Array(data)
    if (!switched && bytes.length === 3 && bytes.every(byte => byte === 9)) { switched = true; fakes.session.project = { id: 'other', revision: 1, canvases: {} } }
    return digest(algorithm, data)
  } })
  try {
    ui.nodes.description.value = 'forest messenger'
    await ui.trigger.click()
    await binding.requestCandidate()
  } finally { delete subtle.digest }
  assert.equal(switched, true)
  assert.equal(fakes.calls.reserve, 0, 'nothing is reserved once the project changed during hashing')
  fakes.session.project = shown
  await binding.refresh()
  assert.equal(fakes.calls.reserve, 1)
  assert.equal(fakes.calls.add, 1, 'the same run continues to placement without an Add click')
  assert.equal(ui.nodes.status.textContent, SUBSCRIPTION_SHEET_COPY.added)
})

test('r7: after Undo the subscription panel says the processed sheet stays and offers Redo of exactly that canvas; Redo puts it back with its Undo', async () => {
  const fakes = subscriptionFakes({ statuses: [{ status: 'running' }, { status: 'ready', original: ORIGINAL, reviewable_original: true }] })
  const history = { undo: [], redo: [] }
  const s = fakes.session
  s.recordCanvasAddition = ({ projectId, canvasId }) => {
    const found = history.undo.find(entry => entry.canvasId === canvasId)
    if (found) return found
    const entry = { kind: 'import', projectId, canvasId }
    history.undo.push(entry)
    return entry
  }
  s.latestUndoEntry = () => history.undo.at(-1) || null
  s.latestRedoEntry = () => history.redo.at(-1) || null
  s.undoEntryState = entry => (history.undo.includes(entry) ? 'undo' : history.redo.includes(entry) ? 'redo' : 'absent')
  s.undoIfLatest = async entry => {
    if (history.undo.at(-1) !== entry) return false
    history.undo.pop(); history.redo.push(entry)
    s.project = { ...s.project, revision: s.project.revision + 1, canvases: {} }
    return true
  }
  s.redoIfLatest = async entry => {
    if (history.redo.at(-1) !== entry) return false
    history.redo.pop(); history.undo.push(entry)
    s.project = { ...s.project, revision: s.project.revision + 1, canvases: { sheet: { id: 'sheet', document_id: 'doc_sheet' } } }
    return true
  }
  const ui = subscriptionPanel()
  const binding = bindSubscriptionSheet({ root: ui.root, session: s, client: fakes.client, fetchImpl: fakes.fetchImpl,
    createOperationId: (() => { let n = 0; return () => `00000000-0000-4000-8000-00000000000${++n}` })(), wait: async () => {} })
  ui.nodes.description.value = 'forest messenger'
  await ui.trigger.click()
  await binding.requestCandidate()
  assert.equal(ui.nodes.status.textContent, SUBSCRIPTION_SHEET_COPY.added)
  assert.equal(ui.nodes.undo.textContent, SUBSCRIPTION_SHEET_COPY.undo)
  await ui.nodes.undo.click()
  assert.equal(ui.nodes.status.textContent, SUBSCRIPTION_SHEET_COPY.undoneRedo)
  assert.equal(ui.panel.dataset.figmaVariant, '2934:2752')
  assert.equal(ui.nodes.undo.hidden, false)
  assert.equal(ui.nodes.undo.textContent, SUBSCRIPTION_SHEET_COPY.redo, 'the same control offers Redo of exactly that canvas')
  assert.equal(ui.nodes.add.hidden, true, 'never added again')
  await ui.nodes.undo.click()
  assert.equal(ui.nodes.status.textContent, SUBSCRIPTION_SHEET_COPY.added)
  assert.equal(ui.nodes.undo.textContent, SUBSCRIPTION_SHEET_COPY.undo)
  assert.equal(fakes.calls.add, 1, 'nothing was added again')
  // ⌘Z / Ctrl+Z moves the same entry: the panel follows when it paints next.
  await s.undoIfLatest(history.undo.at(-1)); await binding.refresh()
  assert.equal(ui.nodes.status.textContent, SUBSCRIPTION_SHEET_COPY.undoneRedo)
})

test('r7: the open subscription panel follows ⌘Z / ⌘⇧Z, a blocked Redo stays offered and says so, and a restored record never moves a canvas changed since', async () => {
  const fakes = subscriptionFakes({ statuses: [{ status: 'running' }, { status: 'ready', original: ORIGINAL, reviewable_original: true }] })
  const history = { undo: [], redo: [] }
  const s = fakes.session
  const placed = []
  s.placeAddedCanvas = async args => { placed.push(args); return { unchanged: true } }
  s.recordCanvasAddition = ({ projectId, canvasId }) => {
    const found = history.undo.find(entry => entry.canvasId === canvasId)
    if (found) return found
    const entry = { kind: 'import', projectId, canvasId }
    history.undo.push(entry)
    return entry
  }
  s.latestUndoEntry = () => history.undo.at(-1) || null
  s.latestRedoEntry = () => history.redo.at(-1) || null
  s.undoEntryState = entry => (history.undo.includes(entry) ? 'undo' : history.redo.includes(entry) ? 'redo' : 'absent')
  let blocked = false
  const detach = () => { s.project = { ...s.project, revision: s.project.revision + 1, canvases: {} } }
  const attach = () => { s.project = { ...s.project, revision: s.project.revision + 1, canvases: { sheet: { id: 'sheet', document_id: 'doc_sheet' } } } }
  s.undoIfLatest = async entry => { if (history.undo.at(-1) !== entry) return false; history.undo.pop(); history.redo.push(entry); detach(); return true }
  s.redoIfLatest = async entry => { if (blocked || history.redo.at(-1) !== entry) return false; history.redo.pop(); history.undo.push(entry); attach(); return true }
  const ui = subscriptionPanel()
  const listeners = []
  ui.root.addEventListener = (type, fn) => { if (type === 'vnext-draft-change') listeners.push(fn) }
  const binding = bindSubscriptionSheet({ root: ui.root, session: s, client: fakes.client, fetchImpl: fakes.fetchImpl,
    createOperationId: (() => { let n = 0; return () => `00000000-0000-4000-8000-00000000000${++n}` })(), wait: async () => {} })
  ui.nodes.description.value = 'forest messenger'
  await ui.trigger.click()
  await binding.requestCandidate()
  assert.equal(ui.nodes.status.textContent, SUBSCRIPTION_SHEET_COPY.added)
  // ⌘Z from the keyboard: the session notifies after the history pointer moved; the open panel follows.
  const entry = history.undo.at(-1)
  history.undo.pop(); history.redo.push(entry); detach()
  for (const fn of listeners) fn()
  assert.equal(ui.nodes.status.textContent, SUBSCRIPTION_SHEET_COPY.undoneRedo)
  assert.equal(ui.nodes.undo.textContent, SUBSCRIPTION_SHEET_COPY.redo)
  // A blocked Redo stays offered and says so.
  blocked = true
  await ui.nodes.undo.click()
  assert.equal(ui.nodes.status.textContent, SUBSCRIPTION_SHEET_COPY.undoneRedoRetry)
  assert.equal(ui.panel.dataset.figmaVariant, '2936:2730')
  assert.equal(ui.nodes.undo.textContent, SUBSCRIPTION_SHEET_COPY.redo)
  blocked = false
  await ui.nodes.undo.click()
  assert.equal(ui.nodes.status.textContent, SUBSCRIPTION_SHEET_COPY.added)
  // ⌘⇧Z / ⌘Z again from the keyboard keep the panel accurate.
  history.undo.pop(); history.redo.push(entry); detach(); for (const fn of listeners) fn()
  assert.equal(ui.nodes.status.textContent, SUBSCRIPTION_SHEET_COPY.undoneRedo)
  history.redo.pop(); history.undo.push(entry); attach(); for (const fn of listeners) fn()
  assert.equal(ui.nodes.status.textContent, SUBSCRIPTION_SHEET_COPY.added)
  // A record restored after a reload has no add position: once a later revision exists, completing its
  // pending reload never moves the canvas (the later revision may hold the user's placement).
  const rec = binding.recordOf('proj')
  const placedBefore = placed.length
  rec.addedOrigin = null
  rec.reloadPending = true
  const restored = { ...rec.receipt, reload_pending: true, added: { ...rec.receipt.added, project_revision: 6 } }
  rec.receipt = restored
  fakes.client.status = async () => restored
  fakes.client.noteReload = async () => ({ ...restored, reload_pending: false })
  s.project = { ...s.project, revision: 12 }
  s.api.getProject = async () => ({ ok: true, project: { ...s.project } })
  await binding.refresh()
  assert.equal(placed.length, placedBefore, 'no place-beside after a later change')
  assert.equal(ui.nodes.status.textContent, SUBSCRIPTION_SHEET_COPY.added)
})
