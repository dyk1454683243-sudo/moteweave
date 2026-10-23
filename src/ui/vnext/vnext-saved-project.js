// Shared state rules for a project snapshot that a write or a read returns while the same project
// may already have moved on (a newer same-project save, a reload), and for whether a saved sheet is
// on the canvas. Used by the session (vnext-preview.js) and by the preset and subscription sheets;
// it holds no DOM, and makes requests only through the session it is given (no writes). Records of
// undone result canvases use only the storage their caller gives (createUndonePlacementStore).

// A snapshot of the shown project that is older than what is shown.
export function olderThanShown(shown, project) {
  return Boolean(shown && project) && shown.id === project.id && (shown.revision ?? -1) > (project.revision ?? -1)
}

// A write's response becomes the shown project's record only if it is that project and not older.
export function adoptSavedProject(session, project) {
  if (!session || !project || session.project?.id !== project.id || olderThanShown(session.project, project)) return false
  session.project = project
  return true
}

// The canvas that shows a saved document: stored in the shown project and rendered on the canvas.
export function shownCanvasFor(session, projectId, documentId) {
  if (!documentId || session?.project?.id !== projectId) return null
  const stored = Object.values(session.project.canvases || {}).find(canvas => canvas?.document_id === documentId)
  if (!stored) return null
  const rendered = session.view?.canvases
  if (Array.isArray(rendered) && !rendered.some(canvas => canvas.id === stored.id && !canvas.transient)) return null
  return stored.id
}

// Shows a sheet that its own write added (a preset or subscription sheet). The write's snapshot is
// reloaded unless the shown project is already newer; then, or without a snapshot (Reload canvas and
// subscription recovery), the newest project is read instead, at least as recent as the save. The
// reload itself is refused if an even newer revision is shown by then (session.reloadProject); such
// a refusal still completes the result when the shown canvas already holds the sheet. Nothing is
// written, so nothing is generated, processed or placed again.
export async function showSavedAddition(session, { projectId, documentId, snapshot = null, minimumRevision = 0 } = {}) {
  const epoch = session?.api?.openEpoch?.current
  const here = () => session?.project?.id === projectId && !session?.openInFlight?.() && session?.api?.openEpoch?.current === epoch
  if (!here()) return { shown: false, reason: 'not_here' }
  let candidate = snapshot
  if (!candidate || olderThanShown(session.project, candidate)) {
    const loaded = typeof session.api?.getProject === 'function' ? await session.api.getProject(projectId, { token: epoch }) : null
    if (!here()) return { shown: false, reason: 'not_here' }
    if (!loaded?.ok || loaded.stale || loaded.aborted || loaded.project?.id !== projectId || (loaded.project.revision ?? -1) < minimumRevision) {
      return { shown: false, reason: 'read_failed' }
    }
    candidate = loaded.project
  }
  const applied = await session.reloadProject?.(candidate, { token: epoch })
  if (!here()) return { shown: false, reason: 'not_here' }
  const canvasId = shownCanvasFor(session, projectId, documentId)
  // A committed read ends the recovery (the result then reports where the sheet is). A reload refused
  // because an even newer revision is shown ends it only if the shown canvas already holds the sheet.
  if (applied?.committed === true && applied?.stale !== true) return { shown: true, canvasId, committed: true }
  if (applied?.superseded === true && canvasId) return { shown: true, canvasId, committed: false }
  return { shown: false, reason: applied?.superseded === true ? 'superseded' : 'not_committed' }
}

// Whether a generated sheet is saved in a project (an asset revision recorded its job) and which
// canvas shows it now. Saved only blocks a second add; the message and actions follow the canvas.
// A known document id (the placement's own) decides directly. Otherwise a canvas counts when its
// document's source is that saved revision and it is not an edited copy (derived_from); without
// the documents' manifests the canvas cannot be told (known: false).
export function sheetPlacement({ project, documents = null, jobId = null, documentId = null, rendered = null } = {}) {
  const sources = []
  for (const [assetId, asset] of Object.entries(project?.assets || {})) {
    for (const [revisionId, revision] of Object.entries(asset?.revisions || {})) {
      if (jobId && revision?.source_job_id === jobId) sources.push({ assetId, revisionId })
    }
  }
  const shown = canvas => Boolean(canvas) && (typeof rendered !== 'function' || rendered(canvas.id))
  const canvases = Object.values(project?.canvases || {})
  if (documentId) {
    const canvas = canvases.find(item => item?.document_id === documentId)
    return { saved: sources.length > 0 || Boolean(canvas), canvasId: shown(canvas) ? canvas.id : null, known: true }
  }
  if (!sources.length) return { saved: false, canvasId: null, known: true }
  if (typeof documents?.get !== 'function') return { saved: true, canvasId: null, known: false }
  const canvas = canvases.find(item => {
    const manifest = documents.get(item?.document_id)
    const ref = manifest?.source_ref
    return Boolean(ref) && !manifest.derived_from && sources.some(source => source.assetId === ref.asset_id && source.revisionId === ref.revision_id)
  })
  return { saved: true, canvasId: shown(canvas) ? canvas.id : null, known: true }
}

// A result's canvas (a preset or subscription sheet placed on the canvas) that this page's own Undo
// removed. The newest 32 are kept in this browser so that, after a page reload has emptied the
// in-memory history, the same saved canvas can be put back with the existing canvas restore. A record
// names only the detach request this page sent for exactly that canvas; nothing is inferred from
// other history, and the server still checks that the detach receipt records the canvas.
export const UNDONE_PLACEMENTS_KEY = 'vnext-undone-placements'
const UNDONE_PLACEMENTS_LIMIT = 32
const usableId = value => typeof value === 'string' && value.length > 0 && value.length <= 256

function readUndonePlacements(storage) {
  try {
    const raw = storage?.getItem?.(UNDONE_PLACEMENTS_KEY)
    if (!raw || raw.length > 65536) return []
    const list = JSON.parse(raw)
    if (!Array.isArray(list)) return []
    return list.filter(item => item && [item.projectId, item.canvasId, item.documentId, item.detachOperationId].every(usableId)
      && (item.jobId === null || usableId(item.jobId))).slice(-UNDONE_PLACEMENTS_LIMIT)
  } catch { return [] }
}

function writeUndonePlacements(storage, list) {
  try {
    if (typeof storage?.setItem !== 'function') return false
    storage.setItem(UNDONE_PLACEMENTS_KEY, JSON.stringify(list.slice(-UNDONE_PLACEMENTS_LIMIT)))
    return true
  } catch { return false }
}

const sameCanvasRecord = (item, { projectId, canvasId }) => item.projectId === projectId && item.canvasId === canvasId

// Kept when the Undo is sent (before its outcome is known), replacing an older record of that canvas.
function rememberUndonePlacement(storage, { projectId, canvasId, documentId, detachOperationId, jobId = null } = {}) {
  if (![projectId, canvasId, documentId, detachOperationId].every(usableId)) return false
  const record = { projectId, canvasId, documentId, detachOperationId, jobId: usableId(jobId) ? jobId : null }
  return writeUndonePlacements(storage, [...readUndonePlacements(storage).filter(item => !sameCanvasRecord(item, record)), record])
}

// Dropped once that canvas is back (Redo or a restore) or the server refuses the record.
function forgetUndonePlacement(storage, { projectId, canvasId } = {}) {
  const list = readUndonePlacements(storage)
  const kept = list.filter(item => !sameCanvasRecord(item, { projectId, canvasId }))
  if (kept.length !== list.length) writeUndonePlacements(storage, kept)
}

// The record for a sheet (its document, else the job that made it) while the shown project still
// saves that document but no canvas shows it; otherwise null (nothing to put back).
function undonePlacementFor(storage, { project, jobId = null, documentId = null } = {}) {
  if (!project?.id || (!documentId && !jobId)) return null
  const record = readUndonePlacements(storage).reverse().find(item => item.projectId === project.id
    && (documentId ? item.documentId === documentId : item.jobId === jobId))
  if (!record || !project.sprite_documents?.[record.documentId]) return null
  if (project.canvases?.[record.canvasId] || Object.values(project.canvases || {}).some(canvas => canvas?.document_id === record.documentId)) return null
  return record
}

// The records as the session uses them (session.undonePlacements). The session decides when a record
// is kept or dropped; the page that keeps result records in this browser (the preset view) creates
// the store, so the session itself persists nothing. `getStorage` may throw or return nothing (for
// example with storage blocked): then nothing is kept and nothing is offered.
export function createUndonePlacementStore(getStorage) {
  const storage = () => { try { return getStorage?.() ?? null } catch { return null } }
  return {
    remember: record => rememberUndonePlacement(storage(), record),
    forget: record => forgetUndonePlacement(storage(), record),
    find: query => undonePlacementFor(storage(), query),
  }
}
