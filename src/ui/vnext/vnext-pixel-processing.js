import { createVnextAssistantClient } from './vnext-assistant-client.js'
import { createResultLifecycle, undoEntryFor } from './vnext-result-lifecycle.js'

const copy = {
  unsupported_input: 'This operation needs an unlocked pixel layer. Grid recovery currently supports one layer, without tags, anchors or editable text.',
  resource_limit: 'This local preview supports up to 2048 px per edge and 32 MiB of frame/layer pixels.',
  assistant_context_changed: 'The selected canvas changed. No candidate was saved.',
  assistant_busy: 'Finish the current operation first.',
  assistant_candidate_limit: 'Too many earlier results are still unresolved. Resolve them, then try again. The source is unchanged.',
  assistant_cancelled: 'Stopped. No candidate was saved.',
  pixel_processing_timeout: 'Processing reached its time limit. The source is unchanged.',
  pixel_processing_failed: 'Processing could not complete. The source is unchanged.',
}
export function pixelProcessingResultCopy(result) {
  if (result.reason === 'no_background_detected') return 'No removable background was detected. The source is unchanged.'
  return result.verdict === 'rejected' ? 'These frames did not pass the common-scale check. The source is unchanged.'
    : 'A reliable pixel grid could not be confirmed for this canvas. The source is unchanged.'
}
export function bindPixelProcessing({ root, session, client = createVnextAssistantClient() }) {
  const panel = root.querySelector('#vnext-perfect-pixels')
  if (!panel) return { busy: false, sync() {} }
  const status = panel.querySelector('[data-pixel-status]'), actions = panel.querySelector('[data-pixel-actions]')
  const starts = [...panel.querySelectorAll('[data-pixel-process]')]
  let active = null, processing = false, guard = null, stickyNotice = false, sawDeselected = false, sawSelectedAfterDeselected = false
  const results = createResultLifecycle({
    latestUndoEntry: () => session.latestUndoEntry?.() || null,
    undoIfLatest: entry => (typeof session.undoIfLatest === 'function' ? session.undoIfLatest(entry) : false),
    entryState: entry => session.undoEntryState?.(entry) ?? null,
  })
  const state = { get busy() { return Boolean(active) }, sync }
  function syncVisibility(info = session.pixelTargetInfo?.()) {
    const hasActions = Boolean(actions?.children?.length || actions?.items?.length || actions?.childElementCount)
    if (actions) actions.hidden = !hasActions
    if (status) status.hidden = !status.textContent
    panel.hidden = !(info || active || processing || session.documentCandidate?.processing || hasActions || stickyNotice)
  }
  // Figma Current (state 2855:2559): the outcome node a status maps to, when one is drawn.
  const message = (text, { sticky = false, tone = '', figma = '' } = {}) => {
    status.textContent = text
    if (status.dataset) {
      if (tone && text) status.dataset.tone = tone
      else delete status.dataset.tone
      if (figma && text) status.dataset.figmaVariant = figma
      else delete status.dataset.figmaVariant
    }
    stickyNotice = Boolean(text && sticky)
    sawDeselected = !session.pixelTargetInfo?.()
    sawSelectedAfterDeselected = false
    syncVisibility()
  }
  const clearActions = () => { actions.replaceChildren(); syncVisibility() }
  // The panel sits at the bottom of the scrolling properties column: bring a result and its
  // follow-up action (Undo, Resolve, Clear result) into view instead of leaving it below the fold.
  function reveal() {
    const target = actions && !actions.hidden ? actions : status
    target?.scrollIntoView?.({ block: 'nearest' })
  }
  function button(text, fn, pressed, { primary = false } = {}) {
    const b = root.createElement ? root.createElement('button') : panel.ownerDocument.createElement('button')
    b.type = 'button'; b.className = primary ? 'vnext-prop-btn is-primary' : 'vnext-prop-btn'; b.textContent = text
    if (pressed !== undefined) b.setAttribute('aria-pressed', String(pressed))
    const owner = active
    b.addEventListener('click', () => { Promise.resolve(fn()).catch(error => { if (active === owner) message(copy[error.code] || error.message || 'The operation could not complete.', { sticky: true, tone: 'error' }) }) })
    actions.append(b); syncVisibility(); return b
  }
  function releaseGuard() { if (session.manualWrite === guard) session.manualWrite = null; guard = null }
  const request = (item, action) => ({ action, candidate_id: item.summary.candidate_id, sha256: item.summary.sha256,
    canvas_id: item.source.sourceCanvasId, document_id: item.source.sourceDocumentId,
    expected_revision: item.source.projectRevision, expected_working_revision: item.source.sourceRevision, operation_id: item.operationId })
  async function discard(item) {
    if (active !== item) return
    item.discarding = true; clearActions()
    try { await client.documentCandidate(request(item, 'discard'), item.source.projectId) }
    catch (error) { if (error.code !== 'candidate_expired' || session.documentCandidate?.result) { if (active === item) { item.discarding = false; offerDiscard(item) } throw error } }
    if (active !== item) return
    session.clearDocumentCandidate(); active = null; clearActions(); message('Discarded · Source unchanged.'); sync()
  }
  // Recovery only: an unapplied result whose cleanup failed can be cleared again.
  function offerDiscard(item) {
    if (active !== item || item.discarding) return
    clearActions(); button('Clear result', () => discard(item))
    reveal()
  }
  // Clicking an operation is the request: the processed result is applied directly as one
  // undoable change. Only an uncertain save leaves a recovery action; Undo is optional afterwards.
  async function apply(item) {
    if (active !== item || item.discarding) return
    if (!item.savingAttempted && !item.source.isSelected()) { await discard(item); message('The selected canvas changed. Nothing was applied.', { sticky: true, tone: 'error' }); return }
    item.savingAttempted = true; clearActions(); message('Applying…', { tone: 'busy', figma: '2855:2523' })
    const before = session.latestUndoEntry?.() || null
    try {
      await session.saveDocumentCandidate(item.source, () => client.documentCandidate(request(item, 'accept'), item.source.projectId))
      if (active !== item) return
      active = null; clearActions()
      // Undo binds only to an entry this save recorded, never to an earlier change.
      const entry = undoEntryFor(null, before, session.latestUndoEntry?.() || null)
      message(`${item.appliedMessage}${entry ? ' · Undo restores the previous pixels.' : ''}`, { tone: 'done', sticky: true, figma: entry ? '2855:2534' : '' })
      if (entry) {
        const undo = button('Undo', async () => {
          // Undo reverts this result only while it is the latest change; a save in progress keeps it offered.
          undo.disabled = true
          const outcome = await results.undo(entry)
          if (outcome === 'retry') {
            undo.disabled = false
            message('Undo could not run while another change was saving; try again.', { tone: 'error', sticky: true })
            return
          }
          clearActions()
          message(outcome === 'undone' ? 'Undone · Previous pixels restored.'
            : outcome === 'already_undone' ? 'Already undone with ⌘Z / Ctrl+Z · Previous pixels restored.'
            : `${item.appliedMessage} · Undo here was withdrawn because a later change was made; nothing was reverted. ⌘Z / Ctrl+Z steps back through changes in order.`, { tone: 'done', sticky: true, figma: outcome === 'superseded' ? '2909:2426' : '' })
          reveal()
        })
      }
      sync()
      reveal()
    } catch (error) {
      if (!session.documentCandidate?.result && ['candidate_expired', 'stale_revision', 'unsupported_input', 'resource_limit', 'artifact_integrity_failed', 'invalid_request'].includes(error.code)) {
        item.savingAttempted = false
        await discard(item).catch(() => {})
        message('The result could not be applied because the canvas or its content changed. The source is unchanged.', { sticky: true, tone: 'error', figma: '2855:2552' })
        reveal()
        return
      }
      message('The result may already be applied. Resolve this same change before continuing.', { sticky: true, tone: 'error', figma: '2855:2544' })
      clearActions(); button('Resolve', () => apply(item), undefined, { primary: true })
      reveal()
    }
  }
  async function start(operation) {
    if (active || session.hasAssistantWork?.()) return
    let item
    try {
      const source = await session.prepareDocumentEdit({ selectedOnly: true })
      const layerId = session.documentTimeline?.target(source.manifest)?.layer_id || source.manifest.layer_order[0]
      item = { source, operation, controller: new AbortController(), operationId: crypto.randomUUID() }
      active = item; processing = true; guard = { kind: 'local-pixel-processing', projectId: source.projectId }; session.manualWrite = guard
      message(operation === 'recover-grid' ? 'Recovering pixel grid…' : 'Removing background…', { tone: 'busy', figma: '2855:2523' })
      clearActions(); button('Stop', () => item.controller.abort()); session.renderCanvas(); sync(); reveal()
      item.summary = await client.processDocument({ canvas_id: source.sourceCanvasId, expected_revision: source.projectRevision,
        expected_working_revision: source.sourceRevision, operation, layer_id: layerId }, source.projectId, item.controller.signal)
      if (!item.summary.candidate_id) { message(pixelProcessingResultCopy(item.summary.processing), { sticky: true, tone: 'error' }); active = null; clearActions(); reveal(); return }
      if (item.controller.signal.aborted || !source.isSelected()) {
        await client.documentCandidate(request(item, 'discard'), source.projectId); throw Object.assign(new Error(), { code: 'assistant_context_changed' })
      }
      const value = await client.documentCandidate(request(item, 'read'), source.projectId)
      releaseGuard(); processing = false
      await session.showDocumentCandidate(source, value, () => active === item && !item.controller.signal.aborted)
      const framesLabel = `${value.frames} ${value.frames === 1 ? 'frame' : 'frames'}`
      const caution = value.processing?.blank_frames ? ' · Some frames are blank' : operation === 'remove-background' ? ' · Check light details' : ''
      item.appliedMessage = `Applied · ${value.width} × ${value.height} px · ${framesLabel}${caution}`
      await apply(item)
    } catch (error) {
      if (item?.summary?.candidate_id && !session.documentCandidate) {
        try { await client.documentCandidate(request(item, 'discard'), item.source.projectId) } catch { /* Cache expires; no project mutation. */ }
      }
      if (active === item) active = null
      message(copy[error.code] || (error.name === 'AbortError' ? copy.assistant_cancelled : error.message || 'Processing failed. The source is unchanged.'), { sticky: true, tone: 'error' }); clearActions(); reveal()
    } finally { processing = false; releaseGuard(); session.renderCanvas(); sync() }
  }
  function sync() {
    const info = session.pixelTargetInfo?.()
    if (!active && stickyNotice) {
      if (!info && !sawDeselected) sawDeselected = true
      else if (info && sawDeselected) sawSelectedAfterDeselected = true
      else if (!info && sawSelectedAfterDeselected) { stickyNotice = false; status.textContent = ''; if (status.dataset) delete status.dataset.tone }
    }
    for (const b of starts) {
      b.disabled = !info || Boolean(active) || Boolean(session.manualWrite || session.manualGesture || session.hasAssistantWork?.())
      b.setAttribute?.('aria-pressed', String(Boolean(active && active.operation === b.dataset.pixelProcess)))
    }
    if (active && !active.source.isSelected()) {
      if (processing) active.controller.abort()
      else if (!active.savingAttempted && !active.discarding) {
        const item = active; item.discarding = true
        void discard(item).then(() => message('The selected canvas changed. Nothing was applied.', { sticky: true, tone: 'error' })).catch(() => { item.discarding = false; message('Clear this unapplied result before continuing.', { sticky: true, tone: 'error' }); offerDiscard(item) })
      }
    }
    syncVisibility(info)
  }
  for (const b of starts) b.addEventListener('click', () => { void start(b.dataset.pixelProcess) })
  sync(); return state
}
