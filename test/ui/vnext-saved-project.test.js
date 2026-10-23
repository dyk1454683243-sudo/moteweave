// r7 shared state rules: a project snapshot returned by a write or a read is never adopted or shown
// over a newer revision of the same project, and a saved sheet counts as placed only on a canvas.
import assert from 'node:assert/strict'
import test from 'node:test'
import { UNDONE_PLACEMENTS_KEY, adoptSavedProject, createUndonePlacementStore, olderThanShown, sheetPlacement, showSavedAddition, shownCanvasFor } from '../../src/ui/vnext/vnext-saved-project.js'

const project = (revision, canvases = {}, extra = {}) => ({ id: 'proj', revision, canvases, ...extra })

test('a write response is adopted only for the shown project and never over a newer revision of it', () => {
  const session = { project: project(9) }
  assert.equal(olderThanShown(session.project, project(8)), true)
  assert.equal(olderThanShown(session.project, project(9)), false)
  assert.equal(olderThanShown(session.project, { id: 'other', revision: 1 }), false)
  assert.equal(adoptSavedProject(session, project(8)), false)
  assert.equal(session.project.revision, 9, 'the newer saved revision stays')
  assert.equal(adoptSavedProject(session, { id: 'other', revision: 20 }), false, 'another project is never adopted')
  assert.equal(adoptSavedProject(session, project(10)), true)
  assert.equal(session.project.revision, 10)
})

test('a saved addition is shown from its own snapshot, or from the newest read when a newer revision is already shown', async () => {
  const reads = [], reloads = []
  const canvases = { sheet: { id: 'sheet', document_id: 'doc_sheet' }, other: { id: 'other', document_id: 'doc_other' } }
  const make = ({ shown, newest, commit = 'commit' }) => {
    const session = {
      project: shown,
      view: { canvases: [{ id: 'other' }] },
      api: { openEpoch: { current: 1 }, async getProject(id, { token }) { reads.push([id, token]); return { ok: true, project: newest } } },
      async reloadProject(next) {
        reloads.push(next.revision)
        if (commit === 'superseded') return { stale: true, committed: false, superseded: true }
        session.project = next
        session.view.canvases = Object.values(next.canvases).map(canvas => ({ id: canvas.id }))
        return { stale: false, committed: true }
      },
    }
    return session
  }
  // The snapshot is not older than the shown project: it is shown as is (no read).
  let session = make({ shown: project(7), newest: project(9, canvases) })
  let shown = await showSavedAddition(session, { projectId: 'proj', documentId: 'doc_sheet', snapshot: project(8, canvases), minimumRevision: 8 })
  assert.deepEqual({ shown: shown.shown, canvasId: shown.canvasId }, { shown: true, canvasId: 'sheet' })
  assert.deepEqual(reads, []); assert.deepEqual(reloads, [8])
  // A newer same-project save is already shown: the late snapshot is never shown; the newest read is.
  reads.length = 0; reloads.length = 0
  session = make({ shown: project(10, { other: canvases.other }), newest: project(10, canvases) })
  shown = await showSavedAddition(session, { projectId: 'proj', documentId: 'doc_sheet', snapshot: project(8, canvases), minimumRevision: 8 })
  assert.equal(shown.shown, true)
  assert.deepEqual(reads, [['proj', 1]]); assert.deepEqual(reloads, [10], 'the newest revision, not the older snapshot')
  // A read older than the save keeps the recovery (nothing is shown).
  reads.length = 0; reloads.length = 0
  session = make({ shown: project(10), newest: project(7, canvases) })
  shown = await showSavedAddition(session, { projectId: 'proj', documentId: 'doc_sheet', minimumRevision: 8 })
  assert.deepEqual({ shown: shown.shown, reason: shown.reason }, { shown: false, reason: 'read_failed' })
  assert.deepEqual(reloads, [])
  // Superseded: complete only when the shown canvas already holds the sheet.
  session = make({ shown: project(11, canvases), newest: project(10, canvases), commit: 'superseded' })
  shown = await showSavedAddition(session, { projectId: 'proj', documentId: 'doc_sheet', minimumRevision: 8 })
  assert.deepEqual({ shown: shown.shown, reason: shown.reason }, { shown: false, reason: 'superseded' }, 'stored but not rendered: pending')
  session.view.canvases.push({ id: 'sheet' })
  assert.equal(shownCanvasFor(session, 'proj', 'doc_sheet'), 'sheet')
  shown = await showSavedAddition(session, { projectId: 'proj', documentId: 'doc_sheet', minimumRevision: 8 })
  assert.deepEqual({ shown: shown.shown, canvasId: shown.canvasId, committed: shown.committed }, { shown: true, canvasId: 'sheet', committed: false })
  // A project change during the read ends nothing.
  session = make({ shown: project(10), newest: project(10, canvases) })
  session.api.getProject = async () => { session.api.openEpoch.current = 2; return { ok: true, project: project(10, canvases) } }
  shown = await showSavedAddition(session, { projectId: 'proj', documentId: 'doc_sheet' })
  assert.deepEqual({ shown: shown.shown, reason: shown.reason }, { shown: false, reason: 'not_here' })
})

test('a saved sheet is placed only while a canvas shows it: the placement document, or an original document of its saved revision', () => {
  const assets = { a1: { revisions: { rev_001: { source_job_id: 'job_sheet' } } } }
  const documents = new Map([
    ['doc_original', { source_ref: { asset_id: 'a1', revision_id: 'rev_001' } }],
    ['doc_copy', { source_ref: { asset_id: 'a1', revision_id: 'rev_001' }, derived_from: { document_id: 'doc_original', revision: 1 } }],
  ])
  const on = project(5, { c1: { id: 'c1', document_id: 'doc_original' } }, { assets })
  assert.deepEqual(sheetPlacement({ project: on, documents, jobId: 'job_sheet' }), { saved: true, canvasId: 'c1', known: true })
  const undone = project(6, { c2: { id: 'c2', document_id: 'doc_copy' } }, { assets })
  assert.deepEqual(sheetPlacement({ project: undone, documents, jobId: 'job_sheet' }), { saved: true, canvasId: null, known: true }, 'an edited copy is not the placed sheet')
  assert.deepEqual(sheetPlacement({ project: undone, jobId: 'job_sheet' }), { saved: true, canvasId: null, known: false }, 'without manifests it cannot be told')
  assert.deepEqual(sheetPlacement({ project: on, documentId: 'doc_original' }), { saved: true, canvasId: 'c1', known: true })
  assert.deepEqual(sheetPlacement({ project: undone, documentId: 'doc_original', jobId: 'job_sheet' }), { saved: true, canvasId: null, known: true })
  assert.deepEqual(sheetPlacement({ project: project(1), jobId: 'job_new' }), { saved: false, canvasId: null, known: true })
})

// r8: the record of a result canvas this page's own Undo removed, so the same saved canvas can be put
// back after a page reload. Only the given storage is used; a lookup needs the saved document and
// offers nothing while a canvas shows it.
test('undone placement records are bounded, exact and offered only while the saved sheet is off the canvas', () => {
  const memory = new Map()
  const storage = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, String(value)) }
  const store = createUndonePlacementStore(() => storage)
  const record = { projectId: 'proj', canvasId: 'c_sheet', documentId: 'doc_sheet', detachOperationId: 'op_detach_1', jobId: 'job_a' }
  assert.equal(store.remember(record), true)
  assert.equal(store.remember({ ...record, detachOperationId: '' }), false, 'a record needs the detach request')
  const off = project(5, { other: { id: 'other', document_id: 'doc_other' } }, { sprite_documents: { doc_sheet: {}, doc_other: {} } })
  assert.deepEqual(store.find({ project: off, jobId: 'job_a' }), record, 'found by the job that made the sheet')
  assert.deepEqual(store.find({ project: off, documentId: 'doc_sheet' }), record, 'or by its document')
  assert.equal(store.find({ project: off, jobId: 'job_b' }), null, 'another job is not matched')
  assert.equal(store.find({ project: { ...off, id: 'proj_other' }, jobId: 'job_a' }), null, 'another project is not matched')
  assert.equal(store.find({ project: { ...off, canvases: { ...off.canvases, c_sheet: { id: 'c_sheet', document_id: 'doc_sheet' } } }, jobId: 'job_a' }), null,
    'nothing is offered while the canvas is in the project')
  assert.equal(store.find({ project: { ...off, canvases: { ...off.canvases, c_copy: { id: 'c_copy', document_id: 'doc_sheet' } } }, jobId: 'job_a' }), null,
    'nothing is offered while another canvas shows that document')
  assert.equal(store.find({ project: { ...off, sprite_documents: { doc_other: {} } }, jobId: 'job_a' }), null, 'nor once the document is gone')
  // A newer Undo of the same canvas replaces the record; forgetting drops exactly that canvas.
  store.remember({ ...record, detachOperationId: 'op_detach_2' })
  assert.equal(store.find({ project: off, jobId: 'job_a' }).detachOperationId, 'op_detach_2')
  assert.equal(JSON.parse(memory.get(UNDONE_PLACEMENTS_KEY)).length, 1)
  store.forget({ projectId: 'proj', canvasId: 'c_sheet' })
  assert.equal(store.find({ project: off, jobId: 'job_a' }), null)
  // At most 32 records; malformed or unavailable storage offers nothing and never throws.
  for (let index = 0; index < 40; index += 1) store.remember({ ...record, canvasId: `c_${index}`, documentId: `doc_${index}` })
  assert.equal(JSON.parse(memory.get(UNDONE_PLACEMENTS_KEY)).length, 32)
  memory.set(UNDONE_PLACEMENTS_KEY, '{not json')
  assert.equal(store.find({ project: off, jobId: 'job_a' }), null)
  memory.set(UNDONE_PLACEMENTS_KEY, JSON.stringify([{ ...record, detachOperationId: 7 }]))
  assert.equal(store.find({ project: off, jobId: 'job_a' }), null, 'a malformed record is ignored')
  const blocked = createUndonePlacementStore(() => { throw new Error('storage blocked') })
  assert.equal(blocked.remember(record), false)
  assert.equal(blocked.find({ project: off, jobId: 'job_a' }), null)
  assert.doesNotThrow(() => blocked.forget(record))
})
