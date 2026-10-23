import { qualityPassed } from './vnext-generation-client.js'
import { createOperationId, sha256Hex } from './vnext-project-client.js'
import { createResultLifecycle } from './vnext-result-lifecycle.js'
import { adoptSavedProject, sheetPlacement, showSavedAddition, shownCanvasFor } from './vnext-saved-project.js'

// A requested subscription sheet runs end to end in this tab: the one candidate, processing,
// placement on a new canvas, then optional Undo. Status checks never generate again. Only two
// cases ask for a click: finishing a candidate restored after a reload (recovery, never replayed
// on its own) and an original that older size rules rejected (the user decides from the preview).
export const SUBSCRIPTION_SHEET_COPY = Object.freeze({
  title: 'Subscription sheet',
  idle: 'Describe the character. One native-size candidate is generated, processed and added to the canvas.',
  running: 'Generating the candidate… Checking status never generates again.',
  preview: 'The candidate is ready. Finish processing processes it and adds it to the canvas; nothing is generated again.',
  rejected: 'Rejected: the original must be square and no larger than 4096×4096. It was not resized or processed.',
  reviewRejected: 'Older size rules rejected this original. Use this original only if the preview looks right; nothing is generated again.',
  unknown: 'The result is unknown. Checking status does not generate again.',
  failed: 'The candidate failed. No automatic retry.',
  accepted: 'Processing the candidate… Nothing is generated again.',
  processing: 'Processing the candidate… Checking status does not start another run.',
  processUnknown: 'Processing result is unknown. Checking status does not process or generate again.',
  qualityFailed: 'Processing did not pass. Not added.',
  backgroundReview: 'Background removal needs review. Processing is blocked.',
  backgroundReviewAdded: 'Background removal needs review. Existing output is unverified.',
  ready: 'Processed. Add to canvas places the processed sheet; nothing is generated again.',
  adding: 'Adding the processed sheet to the canvas…',
  added: 'Added to the canvas. Undo removes it.',
  addedNoUndo: 'Added to the canvas.',
  undone: 'Undo removed the added canvas. The processed sheet stays in this project.',
  undoneRedo: 'Undo removed the added canvas. The processed sheet stays in this project; Redo puts the same canvas back.',
  undoneRedoRetry: 'Undo removed the added canvas. The processed sheet stays in this project; Redo could not run while another change was saving; try again.',
  undoRetry: 'Added to the canvas. Undo could not run while another change was saving; try again.',
  undoSuperseded: 'Added to the canvas. Undo here was withdrawn because a later change was made; nothing was reverted. ⌘Z / Ctrl+Z steps back through changes in order.',
  addUnknown: 'Adding was not confirmed. Add to canvas finishes this same save; it does not add a second canvas.',
  reloadPending: 'Saved. The canvas reload is still pending. Checking status does not add again.',
  reloadPendingShown: 'The sheet is on the canvas. Check status to finish recovery; nothing is added again.',
  removedLater: 'Added earlier; that canvas is no longer in this project. Nothing is added again.',
  needProject: 'Open a project before requesting a subscription sheet.',
  request: 'Generate sheet',
  refresh: 'Check status',
  accept: 'Finish processing',
  acceptRejected: 'Use this original',
  add: 'Add to canvas',
  undo: 'Undo',
  redo: 'Redo',
})

// Figma Current (DIRECT-ACTIONS r4 row 2874:2270): the dialog node for each fixed status copy. A
// status the server words itself (an error sentence) maps to the row.
const C = SUBSCRIPTION_SHEET_COPY
export const SUBSCRIPTION_SHEET_FIGMA = Object.freeze({
  row: '2874:2270',
  states: new Map([
    [C.idle, '2874:2273'], [C.running, '2874:2298'], [C.accepted, '2874:2320'], [C.processing, '2912:2648'],
    [C.added, '2874:2342'], [C.undone, '2874:2370'], [C.undoSuperseded, '2874:2395'], [C.failed, '2874:2420'],
    [C.preview, '2874:2445'], [C.reviewRejected, '2874:2473'], [C.backgroundReviewAdded, '2874:2501'],
    [C.removedLater, '2874:2526'], [C.reloadPending, '2874:2551'], [C.needProject, '2911:2600'], [C.unknown, '2911:2625'],
    [C.reloadPendingShown, '2942:2776'],
    [C.processUnknown, '2911:2650'], [C.qualityFailed, '2911:2675'], [C.backgroundReview, '2911:2700'],
    [C.rejected, '2911:2725'], [C.ready, '2911:2750'], [C.adding, '2911:2778'], [C.addedNoUndo, '2911:2800'],
    [C.undoRetry, '2911:2825'], [C.addUnknown, '2911:2853'], [C.undoneRedo, '2934:2752'], [C.undoneRedoRetry, '2936:2730'],
  ]),
})

export function subscriptionOriginalReviewCopy(receipt) {
  const size = receipt?.original ? `Original ${receipt.original.width}×${receipt.original.height}. ` : ''
  return size + (receipt?.status === 'rejected_size' ? SUBSCRIPTION_SHEET_COPY.reviewRejected : SUBSCRIPTION_SHEET_COPY.preview)
}

function canReviewOriginal(receipt) {
  return receipt?.accepted !== true && (receipt?.status === 'ready' || (receipt?.status === 'rejected_size' && receipt.reviewable_original === true))
}

export function subscriptionQualityPassed(job) {
  const subject = job?.debug_report?.subject_count
  return qualityPassed(job) === true && subject?.required === true && subject.status === 'pass'
}

export function subscriptionStartBody(request) {
  return {
    operation_id: request?.operation_id,
    expected_revision: request?.expected_revision,
    description: request?.description,
  }
}

export function subscriptionProcessAllowed(receipt) {
  const options = receipt?.process_sheet?.options
  return receipt?.accepted === true
    && receipt.background_review_required !== true
    && receipt.status === 'accepted'
    && options?.sourceLayout === 'fixed_region_motion_v0'
    && options.backgroundMode === 'already_processed'
    && options.backgroundRequestMode === 'deterministic_pixel_matte_v2'
    && options.inputAlphaProvenance === 'calibrated'
    && options.fixedRegionSourceStaging === 'none'
    && options.subjectCountGate === true
    && options.source?.type === 'subscription_sheet'
    && options.generation?.model == null
    && options.generation?.image_model == null
    && typeof receipt.process_sheet.source_base64 === 'string'
    && receipt.process_sheet.source_base64.length > 0
}

const PROCESS_RUNNING = new Set(['queued', 'generating', 'post_processing'])

export async function attachSubscriptionDebugReport(job, fetchImpl) {
  if (job?.debug_report || job?.status !== 'done') return job
  const url = job?.debug_report_url
  if (typeof url !== 'string' || !url.startsWith('/generated/') || url.includes('..') || /[?#\\]/.test(url)) return job
  const response = await fetchImpl(url)
  if (!response?.ok) return job
  const report = await response.json()
  if (!report || typeof report !== 'object') return job
  return { ...job, debug_report: report }
}

export function classifySubscriptionProcess(job) {
  if (!job?.id) return 'missing'
  if (PROCESS_RUNNING.has(job.status)) return 'running'
  if (String(job.status || '').startsWith('failed')) return 'failed'
  if (job.status === 'done' && subscriptionQualityPassed(job) && Boolean(job.normalized_sheet_url || job.normalized_sheet_sha256)) return 'ready'
  if (job.status === 'done') return 'failed'
  return 'unknown'
}

export function subscriptionSheetName(value) {
  return String(value || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 80).trim() || 'character'
}

export function buildSubscriptionFromJob({ operationId, expectedRevision, processJob, sheetSha256, originalSha256, name = null }) {
  if (!subscriptionQualityPassed(processJob)) {
    const error = new Error(SUBSCRIPTION_SHEET_COPY.qualityFailed)
    error.code = 'subscription_sheet_quality_blocked'
    throw error
  }
  if (typeof sheetSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sheetSha256) || sheetSha256 === originalSha256) {
    const error = new Error('Add uses the processed sheet hash, not the native candidate.')
    error.code = 'subscription_sheet_hash_blocked'
    throw error
  }
  return {
    operation_id: operationId,
    expected_revision: expectedRevision,
    source: { job_id: processJob.id, artifact: 'sheet', expected_sha256: sheetSha256 },
    // Older reserved requests could end in whitespace after truncation. Such
    // names were rejected before commit; normalize them identically on retries.
    name: name === null ? null : subscriptionSheetName(name),
  }
}

function fail(code, message) {
  const error = new Error(message || code)
  error.code = code
  return error
}

export function createSubscriptionSheetClient({ fetchImpl, sha256 = sha256Hex } = {}) {
  const fetchFn = fetchImpl || globalThis.fetch.bind(globalThis)
  async function request(url, init) {
    const response = await fetchFn(url, init)
    const text = await response.text()
    let body = {}
    if (text) {
      try { body = JSON.parse(text) } catch { body = { raw: text } }
    }
    if (!response.ok) throw Object.assign(new Error(body.error || `http_${response.status}`), { status: response.status, code: body.error, body })
    return body
  }
  const root = projectId => `/api/editor/projects/${encodeURIComponent(projectId)}/subscription-sheet-candidates`
  return {
    start(projectId, body) {
      return request(root(projectId), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(subscriptionStartBody(body)) })
    },
    current(projectId) {
      return request(`${root(projectId)}/current`)
    },
    status(projectId, operationId) {
      return request(`${root(projectId)}/${encodeURIComponent(operationId)}`)
    },
    processingJob(projectId, operationId) {
      return request(`${root(projectId)}/${encodeURIComponent(operationId)}/processing`)
    },
    async original(projectId, operationId) {
      const response = await fetchFn(`${root(projectId)}/${encodeURIComponent(operationId)}/original`)
      if (!response.ok) throw fail('subscription_sheet_not_ready', 'The original candidate could not be read.')
      return new Uint8Array(await response.arrayBuffer())
    },
    accept(projectId, operationId, expectedOriginalSha256, acceptanceBasis = null) {
      return request(`${root(projectId)}/${encodeURIComponent(operationId)}/accept`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirm_manual_acceptance: true, expected_original_sha256: expectedOriginalSha256,
          ...(acceptanceBasis ? { acceptance_basis: acceptanceBasis } : {}) }),
      })
    },
    markProcessing(projectId, operationId) {
      return request(`${root(projectId)}/${encodeURIComponent(operationId)}/processing`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ process_attempted: true }),
      })
    },
    bindProcessJob(projectId, operationId, processJobId) {
      return request(`${root(projectId)}/${encodeURIComponent(operationId)}/processing`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ process_job_id: processJobId }),
      })
    },
    reserveAdd(projectId, operationId, frozen) {
      return request(`${root(projectId)}/${encodeURIComponent(operationId)}/add`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(frozen),
      })
    },
    noteReload(projectId, operationId, pending) {
      return request(`${root(projectId)}/${encodeURIComponent(operationId)}/reload`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pending }),
      })
    },
    recordAdded(projectId, operationId, body) {
      return request(`${root(projectId)}/${encodeURIComponent(operationId)}/added`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      })
    },
    async processAccepted(receipt) {
      if (!subscriptionProcessAllowed(receipt)) throw fail('subscription_sheet_not_accepted', 'Accept the original before processing.')
      return request('/api/process-sheet', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(receipt.process_sheet),
      })
    },
    async addProcessed({ projectApi, projectId, frozen, processJob, sheetBytes, originalSha256 }) {
      const sheetSha256 = await sha256(sheetBytes)
      if (sheetSha256 !== frozen.expected_sha256 || frozen.job_id !== processJob?.id) throw fail('subscription_sheet_hash_blocked', 'The saved add request does not match this sheet.')
      const payload = buildSubscriptionFromJob({
        operationId: frozen.operation_id, expectedRevision: frozen.expected_revision, processJob, sheetSha256, originalSha256, name: frozen.name,
      })
      return projectApi.createFromJob(projectId, {
        operationId: payload.operation_id,
        expectedRevision: payload.expected_revision,
        jobId: payload.source.job_id,
        expectedSha256: payload.source.expected_sha256,
        name: payload.name,
      })
    },
  }
}

export function bindSubscriptionSheet({ root, session, client, getJob, fetchImpl = globalThis.fetch.bind(globalThis), createOperationId: nextOperationId = createOperationId,
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)), pollMs = 2000, maxPolls = 450 }) {
  const panel = root.querySelector('#vnext-subscription-dialog')
  const trigger = root.querySelector('#vnext-subscription-sheet')
  if (!panel || !trigger) return null
  const find = id => panel.querySelector(`#vnext-subscription-${id}`)
  const status = find('status')
  const preview = find('preview')
  const requestButton = find('request')
  const refreshButton = find('refresh')
  const acceptButton = find('accept')
  const addButton = find('add')
  const undoButton = find('undo')
  const description = find('description')
  const results = createResultLifecycle({
    latestUndoEntry: () => session.latestUndoEntry?.() || null,
    undoIfLatest: entry => (typeof session.undoIfLatest === 'function' ? session.undoIfLatest(entry) : false),
    entryState: entry => session.undoEntryState?.(entry) ?? null,
    latestRedoEntry: () => session.latestRedoEntry?.() || null,
    redoIfLatest: entry => (typeof session.redoIfLatest === 'function' ? session.redoIfLatest(entry) : false),
  })
  // One record per project holds that project's request, receipt, processing job, sheet and Undo.
  // Every asynchronous step captures its record (with its project and operation) and writes only
  // there, so a late response from project A can never replace project B's panel state or be
  // continued with B's identity. The panel only paints the record of the project it shows.
  const records = new Map()
  let active = null
  let displayedProjectId = null
  function recordFor(projectId) {
    if (!records.has(projectId)) {
      records.set(projectId, { projectId, owner: null, receipt: null, processJob: null, sheetBytes: null, originalBytes: null,
        reloadPending: false, undo: null, note: null, description: '', submitting: false, processing: null, following: null })
    }
    return records.get(projectId)
  }
  // A record continues its own work only while its project is the one shown.
  const sameProject = rec => Boolean(rec?.owner && session.project?.id === rec.projectId)
  const descriptionOf = rec => (rec === active ? description.value : rec.description)
  function capture() {
    const rec = followProject()
    return rec ? { owner: rec.owner, receipt: rec.receipt, processJob: rec.processJob, sheetBytes: rec.sheetBytes, reloadPending: rec.reloadPending,
      undo: rec.undo, description: descriptionOf(rec) } : null
  }
  function followProject() {
    const projectId = session.project?.id || null
    if (displayedProjectId !== projectId) {
      if (active) active.description = description.value
      displayedProjectId = projectId
      if (preview.dataset.url) URL.revokeObjectURL(preview.dataset.url)
      delete preview.dataset.url
      preview.removeAttribute('src')
      preview.hidden = true
      active = projectId ? recordFor(projectId) : null
      description.value = active?.description || ''
      if (active?.originalBytes) showOriginal(active.originalBytes)
    }
    return active
  }
  const processedReady = rec => Boolean(rec.processJob && rec.sheetBytes && subscriptionQualityPassed(rec.processJob)
    && classifySubscriptionProcess(rec.processJob) === 'ready')
  // An explicit click is needed only to finish a candidate restored after a reload, or to use an
  // original that older size rules rejected; a run requested in this tab continues by itself.
  const needsFinish = rec => canReviewOriginal(rec.receipt) && !rec.receipt.process_attempted && !rec.receipt.process_job_id
    && (rec.receipt.status === 'rejected_size' || !rec.owner?.live)
  const needsAdd = rec => Boolean(sameProject(rec) && !rec.receipt?.background_review_required && !rec.receipt?.added && !rec.reloadPending && processedReady(rec)
    && (!rec.owner?.live || rec.owner.addAttempted?.has(rec.receipt.operation_id)))
  function paint(copy, error = false) {
    const rec = followProject()
    status.textContent = copy
    status.classList.toggle('is-error', error)
    panel.dataset.subscriptionState = rec?.receipt?.status || 'idle'
    // The review copies may lead with the original's size (subscriptionOriginalReviewCopy).
    panel.dataset.figmaVariant = SUBSCRIPTION_SHEET_FIGMA.states.get(String(copy).replace(/^Original \d+×\d+\. /, '')) || SUBSCRIPTION_SHEET_FIGMA.row
    const busy = Boolean(rec?.submitting || rec?.following)
    requestButton.hidden = Boolean(rec?.receipt || rec?.owner?.request)
    refreshButton.hidden = !rec?.owner?.request || Boolean(rec?.following)
    acceptButton.hidden = !rec || !sameProject(rec) || !needsFinish(rec)
    acceptButton.textContent = rec?.receipt?.status === 'rejected_size' ? SUBSCRIPTION_SHEET_COPY.acceptRejected : SUBSCRIPTION_SHEET_COPY.accept
    addButton.hidden = !rec || !needsAdd(rec)
    if (undoButton) {
      const undo = rec?.undo
      const redo = Boolean(undo && undo.status === 'undone' && (copy === SUBSCRIPTION_SHEET_COPY.undoneRedo || copy === SUBSCRIPTION_SHEET_COPY.undoneRedoRetry))
      undoButton.hidden = !rec || !sameProject(rec) || !undo || undo.projectId !== rec.projectId || !(['offered', 'retry'].includes(undo.status) || redo)
      undoButton.textContent = redo ? SUBSCRIPTION_SHEET_COPY.redo : SUBSCRIPTION_SHEET_COPY.undo
      undoButton.dataset.subscriptionAction = redo ? 'redo' : 'undo'
      undoButton.disabled = Boolean(undo?.running) || Boolean(rec?.submitting)
    }
    requestButton.disabled = busy || !session.project || Boolean(rec?.receipt || rec?.owner?.request)
    refreshButton.disabled = busy || !rec || !sameProject(rec)
    acceptButton.disabled = busy || acceptButton.hidden
    addButton.disabled = busy || addButton.hidden
    preview.hidden = !preview.getAttribute('src')
  }
  // Late work paints only when its own project is the one shown.
  function paintIf(rec, copy, error = false) {
    if (rec && rec === followProject()) paint(copy, error)
  }
  function showOriginal(bytes) {
    const blob = new Blob([bytes], { type: 'image/png' })
    const url = URL.createObjectURL(blob)
    if (preview.dataset.url) URL.revokeObjectURL(preview.dataset.url)
    preview.dataset.url = url
    preview.src = url
    preview.hidden = false
  }
  // An offered Undo whose entry left this project's history (the history is replaced when another
  // project is shown) is dropped; one already undone with ⌘Z / Ctrl+Z is shown as undone.
  // Its status follows the history entry, so ⌘Z / ⌘⇧Z are shown as undone / added again.
  function settleUndo(rec) {
    if (!rec?.undo || !sameProject(rec)) return
    rec.undo = results.settle(rec.undo)
  }
  function candidateCopy(rec) {
    settleUndo(rec)
    const receipt = rec?.receipt
    if (rec?.note) return rec.note
    if (receipt?.background_review_required) return receipt.added ? SUBSCRIPTION_SHEET_COPY.backgroundReviewAdded : SUBSCRIPTION_SHEET_COPY.backgroundReview
    if (receipt?.added) {
      // What the canvas shows decides the copy: the processed sheet stays saved after Undo, but only a
      // shown canvas counts as added. Undone offers Redo while it is the newest undone change.
      const documentId = receipt.added.document_id
      const onCanvas = documentId && sameProject(rec) && sheetPlacement({ project: session.project, documentId }).canvasId
      if (documentId && sameProject(rec) && !onCanvas) {
        if (rec.undo?.status === 'undone') {
          if (!results.canRedo(rec.undo.entry)) return SUBSCRIPTION_SHEET_COPY.undone
          return rec.undo.redoRetry ? SUBSCRIPTION_SHEET_COPY.undoneRedoRetry : SUBSCRIPTION_SHEET_COPY.undoneRedo
        }
        if (!rec.reloadPending) return SUBSCRIPTION_SHEET_COPY.removedLater
      }
      // A failed acknowledgement does not undo a shown placement or hide its actual history state.
      if (rec.reloadPending) {
        return shownCanvasFor(session, rec.projectId, documentId)
          ? SUBSCRIPTION_SHEET_COPY.reloadPendingShown : SUBSCRIPTION_SHEET_COPY.reloadPending
      }
      if (rec.undo?.status === 'undone') return SUBSCRIPTION_SHEET_COPY.undone
      if (rec.undo?.status === 'retry') return SUBSCRIPTION_SHEET_COPY.undoRetry
      if (rec.undo?.status === 'superseded') return SUBSCRIPTION_SHEET_COPY.undoSuperseded
      return rec.undo ? SUBSCRIPTION_SHEET_COPY.added : SUBSCRIPTION_SHEET_COPY.addedNoUndo
    }
    if (receipt?.process_job_id) {
      const kind = classifySubscriptionProcess(rec.processJob)
      if (kind === 'running') return SUBSCRIPTION_SHEET_COPY.processing
      if (kind === 'ready' && rec.sheetBytes) return receipt.add_request && rec.owner?.addAttempted?.has(receipt.operation_id) ? SUBSCRIPTION_SHEET_COPY.addUnknown : SUBSCRIPTION_SHEET_COPY.ready
      if (kind === 'failed' || kind === 'ready') return SUBSCRIPTION_SHEET_COPY.qualityFailed
      return SUBSCRIPTION_SHEET_COPY.processUnknown
    }
    if (receipt?.process_attempted) return SUBSCRIPTION_SHEET_COPY.processUnknown
    if (canReviewOriginal(receipt)) return rec.owner?.live && receipt.status === 'ready' ? SUBSCRIPTION_SHEET_COPY.accepted : subscriptionOriginalReviewCopy(receipt)
    if (receipt?.status === 'rejected_size') return SUBSCRIPTION_SHEET_COPY.rejected
    if (receipt?.status === 'unknown') return SUBSCRIPTION_SHEET_COPY.unknown
    if (receipt?.status === 'accepted') return SUBSCRIPTION_SHEET_COPY.accepted
    if (receipt?.status === 'running') return SUBSCRIPTION_SHEET_COPY.running
    return SUBSCRIPTION_SHEET_COPY.failed
  }
  const copyIsError = rec => Boolean(rec?.receipt?.background_review_required
    || (!canReviewOriginal(rec?.receipt) && ['rejected_size', 'failed', 'unknown'].includes(rec?.receipt?.status))
    || classifySubscriptionProcess(rec?.processJob) === 'failed')
  // A response belongs to the operation that asked for it; anything else is refused.
  function ownReceipt(rec, operationId, value) {
    if (value?.operation_id && value.operation_id !== operationId) throw fail('subscription_sheet_operation_mismatch', SUBSCRIPTION_SHEET_COPY.unknown)
    if (rec.owner?.request?.operation_id !== operationId) throw fail('subscription_sheet_operation_mismatch', SUBSCRIPTION_SHEET_COPY.unknown)
    rec.receipt = value
    return value
  }
  async function loadProcess(rec) {
    const operationId = rec.receipt?.operation_id
    if (!rec.receipt?.process_job_id) return
    const job = await attachSubscriptionDebugReport(await client.processingJob(rec.projectId, operationId), fetchImpl)
    if (rec.receipt?.operation_id !== operationId) return
    rec.processJob = job
    rec.sheetBytes = null
    if (classifySubscriptionProcess(job) !== 'ready') return
    const sheetResponse = await fetchImpl(job.normalized_sheet_url)
    if (!sheetResponse.ok) return
    const bytes = new Uint8Array(await sheetResponse.arrayBuffer())
    if (!bytes.length || rec.processJob !== job) return
    rec.sheetBytes = bytes
  }
  async function restoreCurrent(rec = followProject()) {
    if (!rec || rec.owner?.request) return
    try {
      const current = await client.current(rec.projectId)
      // A request started in this tab while the read was pending keeps the record.
      if (rec.owner?.request) return
      // Restored after a reload: shown and checked, never continued on its own.
      rec.owner = { id: rec.projectId, revision: current.request.expected_revision, request: subscriptionStartBody(current.request), live: false }
      rec.receipt = current
      rec.reloadPending = current.reload_pending === true
      rec.description = current.request.description
      if (rec === active) description.value = current.request.description
    } catch (error) {
      if (error.status !== 404) throw error
    }
  }
  // One status check. A run requested in this tab continues through processing and placement;
  // a restored one is only read. Nothing here generates again.
  async function step(rec) {
    const projectId = rec.projectId
    const operationId = rec.owner.request.operation_id
    let next
    try { next = await client.status(projectId, operationId) }
    catch (error) {
      if (error.status !== 404) throw error
      next = await client.start(projectId, subscriptionStartBody(rec.owner.request))
    }
    const receipt = ownReceipt(rec, operationId, next)
    // The response stays on its own record; nothing more runs for it until its project is shown.
    if (!sameProject(rec)) return
    if (rec.owner.live && receipt.status === 'ready' && receipt.accepted !== true && !receipt.background_review_required
      && !receipt.process_attempted && !receipt.process_job_id) {
      paintIf(rec, SUBSCRIPTION_SHEET_COPY.accepted)
      await continueProcessing(rec, 'user_request')
    } else if (receipt.accepted && !receipt.background_review_required && !receipt.process_attempted && !receipt.process_job_id) {
      await continueProcessing(rec)
    }
    // Also when only this page still holds it pending (its reload note may have committed unanswered).
    if (rec.receipt.added && (rec.receipt.reload_pending || rec.reloadPending)) {
      const reloaded = await recoverReload(rec)
      if (!reloaded) rec.reloadPending = true
    }
    if (rec.receipt.original && !rec.originalBytes) {
      const bytes = await client.original(projectId, operationId)
      rec.originalBytes = bytes
      if (rec === followProject() && !preview.getAttribute('src')) showOriginal(bytes)
    }
    await loadProcess(rec)
    if (rec.owner.live && sameProject(rec) && !session.openInFlight?.() && !rec.receipt.added && !rec.receipt.background_review_required && !rec.reloadPending && processedReady(rec)
      && !rec.owner.addAttempted?.has(operationId)) {
      ;(rec.owner.addAttempted ||= new Set()).add(operationId)
      paintIf(rec, SUBSCRIPTION_SHEET_COPY.adding)
      await addProcessedSheet(rec)
    }
  }
  function stillWorking(rec) {
    const receipt = rec.receipt
    if (!receipt || receipt.added || receipt.background_review_required) return false
    if (receipt.status === 'running') return true
    return Boolean(receipt.process_job_id && classifySubscriptionProcess(rec.processJob) === 'running')
  }
  async function refresh(rec = followProject()) {
    if (!rec || rec.submitting || !sameProject(rec) || !rec.owner?.request) return
    rec.submitting = true
    rec.note = null
    try { await step(rec) } finally { rec.submitting = false }
    paintIf(rec, candidateCopy(rec), copyIsError(rec))
  }
  // Follows a run requested in this tab with bounded status checks until it ends or its project
  // is no longer shown; returning to the project shows (and can continue) where it stopped.
  function followThrough(rec = followProject()) {
    if (!rec) return Promise.resolve()
    if (rec.following) return rec.following
    rec.following = (async () => {
      for (let i = 0; i < maxPolls && sameProject(rec); i += 1) {
        await refresh(rec)
        if (!sameProject(rec) || !stillWorking(rec)) return
        await wait(pollMs)
      }
    })().catch(error => {
      rec.note = error?.code === 'subscription_sheet_background_review_required' ? SUBSCRIPTION_SHEET_COPY.backgroundReview
        : rec.receipt?.process_attempted && !rec.receipt?.process_job_id ? SUBSCRIPTION_SHEET_COPY.processUnknown : (error?.message || SUBSCRIPTION_SHEET_COPY.unknown)
    }).finally(() => {
      rec.following = null
      paintIf(rec, candidateCopy(rec), Boolean(rec.note) || copyIsError(rec))
    })
    return rec.following
  }
  async function requestCandidate() {
    const rec = followProject()
    const project = session.project
    if (!rec || rec.submitting || !project || session.openInFlight?.()) { paint(SUBSCRIPTION_SHEET_COPY.needProject, !project); return }
    if (!rec.owner?.request) {
      rec.owner = { id: project.id, revision: project.revision, live: true, request: subscriptionStartBody({
        operation_id: nextOperationId(), expected_revision: project.revision, description: description.value,
      }) }
    }
    if (rec.receipt) return followThrough(rec)
    const operationId = rec.owner.request.operation_id
    rec.submitting = true
    try {
      ownReceipt(rec, operationId, await client.start(rec.projectId, subscriptionStartBody(rec.owner.request)))
      paintIf(rec, SUBSCRIPTION_SHEET_COPY.running)
    } catch (error) {
      if (rec.owner?.request?.operation_id === operationId) rec.receipt = { operation_id: operationId, status: 'unknown', reason: error.code || 'unknown' }
      rec.submitting = false
      paintIf(rec, SUBSCRIPTION_SHEET_COPY.unknown, true)
      return
    } finally { rec.submitting = false }
    return followThrough(rec)
  }
  // Accept, mark and start processing for exactly this record's operation and project. A step
  // starts only while that project is shown; once processing is acquired, its start and binding
  // finish under the same identity so the receipt never stays half-marked.
  function continueProcessing(rec, acceptanceBasis = null) {
    if (rec.processing) return rec.processing
    const projectId = rec.projectId
    const operationId = rec.receipt.operation_id
    const here = () => session.project?.id === projectId && !session.openInFlight?.() && rec.receipt?.operation_id === operationId
    rec.processing = (async () => {
      if (!here()) return
      if (rec.receipt.background_review_required) return
      if (rec.receipt.process_job_id || rec.receipt.process_attempted) return
      if (rec.receipt.accepted !== true || !rec.receipt.process_sheet) {
        ownReceipt(rec, operationId, await client.accept(projectId, operationId, rec.receipt.original.sha256, acceptanceBasis))
      }
      if (rec.receipt.process_job_id || rec.receipt.process_attempted) return
      if (!here()) return
      const payload = rec.receipt
      const marked = await client.markProcessing(projectId, operationId)
      ownReceipt(rec, operationId, { ...marked, process_sheet: payload.process_sheet })
      if (marked.processing_acquired !== true) return
      const started = await client.processAccepted(payload)
      ownReceipt(rec, operationId, await client.bindProcessJob(projectId, operationId, started.id))
      await loadProcess(rec)
    })().finally(() => { rec.processing = null })
    return rec.processing
  }
  // The Undo of exactly the added canvas, bound once the shown project holds it.
  function bindUndo(rec, documentId) {
    const shown = session.project?.id === rec.projectId
    const canvasId = shown && documentId ? Object.values(session.project?.canvases || {}).find(canvas => canvas.document_id === documentId)?.id : null
    // A status read after Undo legitimately has no canvas. Keep this result's live Redo association;
    // recovery acknowledges the saved placement, it must not replace or replay the user's Undo.
    if (shown && !canvasId) {
      settleUndo(rec)
      if (rec.undo?.projectId === rec.projectId && rec.undo.status === 'undone') return
    }
    const entry = canvasId ? session.recordCanvasAddition?.({ projectId: rec.projectId, canvasId }) : null
    rec.undo = entry ? { projectId: rec.projectId, entry, status: 'offered', running: false } : null
  }
  // Shows the newest project once it holds the added sheet (the same step as the preset sheet's
  // Reload canvas): a failed, stale or older read, or one superseded before the canvas shows the
  // sheet, keeps the reload pending instead of showing an earlier snapshot.
  async function recoverReload(rec) {
    const projectId = rec.projectId
    const operationId = rec.receipt.operation_id
    if (session.project?.id !== projectId || session.openInFlight?.()) return false
    const shown = await showSavedAddition(session, { projectId, documentId: rec.receipt.added?.document_id,
      minimumRevision: rec.receipt.added?.project_revision ?? 0 })
    if (!shown.shown || session.project?.id !== projectId) return false
    // Shown now: bind Undo to exactly this canvas and keep the sheet beside the canvases it would
    // otherwise cover (only its position is saved) before the reload is recorded, so a project
    // switch during that write cannot leave the shown sheet without its Undo or its place.
    bindUndo(rec, rec.receipt.added?.document_id)
    const canvasId = rec.undo?.status !== 'undone' ? rec.undo?.entry?.canvasId : null
    // Without the add's own position (a record restored after a page reload) a later revision may hold
    // the user's placement, so the sheet is only placed beside the others while nothing changed since.
    const laterChange = (session.project?.revision ?? -1) > (rec.receipt.added?.project_revision ?? -1)
    if (canvasId && (rec.addedOrigin || !laterChange)) await session.placeAddedCanvas?.({ projectId, canvasId, origin: rec.addedOrigin || null })
    ownReceipt(rec, operationId, await client.noteReload(projectId, operationId, false))
    rec.reloadPending = false
    return true
  }
  async function acceptOriginal() {
    const rec = followProject()
    if (!rec || rec.submitting || !sameProject(rec) || !needsFinish(rec) || session.openInFlight?.()) return
    // Finishing is the user's explicit decision: for an older size rejection after looking at the
    // original, otherwise as recovery of their own earlier request. Either way the run continues.
    const basis = rec.receipt.status === 'rejected_size' ? 'visual_inspection' : 'user_request'
    rec.owner.live = true
    rec.submitting = true
    rec.note = null
    try {
      paintIf(rec, SUBSCRIPTION_SHEET_COPY.accepted)
      await continueProcessing(rec, basis)
    } catch (error) {
      rec.submitting = false
      paintIf(rec, error?.code === 'subscription_sheet_background_review_required' ? SUBSCRIPTION_SHEET_COPY.backgroundReview
        : rec.receipt?.process_attempted ? SUBSCRIPTION_SHEET_COPY.processUnknown : error.message, true)
      return
    } finally { rec.submitting = false }
    return followThrough(rec)
  }
  async function addProcessedSheet(rec) {
    const projectId = rec.projectId
    const operationId = rec.receipt.operation_id
    try {
      // The add is reserved (its first write) only while its project is shown; a reserved add
      // then finishes under the same project and operation.
      // Nothing was sent, so the add is not marked as attempted (it continues when its project is shown).
      const notSent = () => { rec.owner?.addAttempted?.delete(operationId) }
      if (!rec.receipt.add_request && (!sameProject(rec) || session.openInFlight?.())) { notSent(); return }
      if (!rec.receipt.add_request) {
        const expectedSha256 = await sha256Hex(rec.sheetBytes)
        // Rechecked after hashing: the add is reserved only while its project is still shown.
        if (!sameProject(rec) || session.openInFlight?.()) { notSent(); return }
        ownReceipt(rec, operationId, await client.reserveAdd(projectId, operationId, {
          operation_id: nextOperationId(), expected_revision: session.project.revision, expected_sha256: expectedSha256,
          job_id: rec.processJob.id, name: subscriptionSheetName(descriptionOf(rec)),
        }))
      }
      const saved = rec.receipt.add_request
      // Like the preset add: nothing is sent while its project is not shown or another one opens;
      // the reserved add is kept and Add to canvas finishes this same save later.
      if (!sameProject(rec) || session.openInFlight?.()) return
      const result = await client.addProcessed({
        projectApi: session.api, projectId, frozen: saved, processJob: rec.processJob, sheetBytes: rec.sheetBytes, originalSha256: rec.receipt.original.sha256,
      })
      // Its own response never moves the shown project back if a newer same-project save landed first.
      if (session.project?.id === projectId && !session.openInFlight?.()) adoptSavedProject(session, result.project)
      // Where the add stored the canvas, so a later completion never moves a canvas the user moved since.
      const stored = Object.values(result.project?.canvases || {}).find(canvas => canvas?.document_id === result.document?.document_id)
      rec.addedOrigin = stored ? { x: stored.x ?? 0, y: stored.y ?? 0 } : null
      ownReceipt(rec, operationId, await client.recordAdded(projectId, operationId, {
        operation_id: saved.operation_id, document_id: result.document.document_id, project_revision: result.project.revision,
      }))
      rec.reloadPending = true
      if (session.project?.id === projectId) await recoverReload(rec)
    } catch (error) {
      // Once its record says added, the add is confirmed: a later failure (showing the canvas or noting
      // its reload) keeps that reload pending for Check status, never an unconfirmed add.
      if (rec.receipt?.added) { rec.reloadPending = true; rec.note = null; return }
      const keep = error?.kind === 'unknown' || error?.code === 'storage_commit_failed' || error?.code === 'operation_conflict'
      rec.note = keep ? SUBSCRIPTION_SHEET_COPY.addUnknown : (error.message || SUBSCRIPTION_SHEET_COPY.qualityFailed)
    }
  }
  async function addSheet() {
    const rec = followProject()
    if (!rec || rec.submitting || !sameProject(rec) || rec.receipt?.added || session.openInFlight?.()) return
    if (!processedReady(rec)) return
    ;(rec.owner.addAttempted ||= new Set()).add(rec.receipt.operation_id)
    rec.submitting = true
    rec.note = null
    try {
      paintIf(rec, SUBSCRIPTION_SHEET_COPY.adding)
      await addProcessedSheet(rec)
    } finally { rec.submitting = false }
    paintIf(rec, candidateCopy(rec), Boolean(rec.note) || rec.reloadPending)
  }
  async function undoAdded() {
    const rec = followProject()
    const current = rec?.undo
    if (!current || current.running || !['offered', 'retry'].includes(current.status) || !sameProject(rec) || current.projectId !== rec.projectId) return
    current.running = true
    paint(candidateCopy(rec))
    const outcome = await results.undo(current.entry)
    current.running = false
    current.status = outcome === 'undone' || outcome === 'already_undone' ? 'undone' : outcome === 'retry' ? 'retry' : 'superseded'
    current.redoRetry = false
    paintIf(rec, candidateCopy(rec), current.status !== 'undone')
  }
  // Redo of exactly the undone canvas (the existing Redo step); nothing is added again.
  async function redoAdded() {
    const rec = followProject()
    const current = rec?.undo
    if (!current || current.running || current.status !== 'undone' || !sameProject(rec) || current.projectId !== rec.projectId) return
    current.running = true
    paint(candidateCopy(rec))
    const outcome = await results.redo(current.entry)
    current.running = false
    if (outcome === 'redone') current.status = 'offered'
    // Another save blocked it: the same Redo stays offered and says so.
    current.redoRetry = outcome === 'retry'
    paintIf(rec, candidateCopy(rec))
  }
  // ⌘Z / ⌘⇧Z (or any change) moved a placed sheet's history entry: the open panel shows where it is now.
  root.addEventListener?.('vnext-draft-change', () => {
    const rec = followProject()
    if (panel.hidden || !rec || rec.submitting || rec.following || !rec.receipt?.added || !rec.undo || !sameProject(rec)) return
    paint(candidateCopy(rec), copyIsError(rec))
  })
  trigger.addEventListener('click', () => {
    if (trigger.disabled) return
    panel.hidden = false
    const rec = followProject()
    restoreCurrent(rec).then(() => {
      if (!rec) { paint(SUBSCRIPTION_SHEET_COPY.idle); return }
      if (rec !== followProject()) return
      paint(rec.owner?.request ? candidateCopy(rec) : SUBSCRIPTION_SHEET_COPY.idle)
      find('close').focus()
      if (!rec.owner?.request) return
      return rec.owner.live ? followThrough(rec) : refresh(rec)
    }).catch(error => paintIf(rec, error.message, true))
  })
  find('close').addEventListener('click', () => { panel.hidden = true; trigger.focus() })
  panel.querySelector('[data-subscription-dismiss]')?.addEventListener('click', () => { panel.hidden = true })
  requestButton.addEventListener('click', () => requestCandidate().catch(error => paint(error.message, true)))
  refreshButton.addEventListener('click', () => { const rec = followProject(); return (rec?.owner?.live ? followThrough(rec) : refresh(rec)).catch(error => paintIf(rec, error.message, true)) })
  acceptButton.addEventListener('click', () => acceptOriginal().catch(error => paint(error.message, true)))
  addButton.addEventListener('click', () => addSheet().catch(error => paint(error.message, true)))
  undoButton?.addEventListener('click', () => (undoButton.dataset.subscriptionAction === 'redo' ? redoAdded() : undoAdded()).catch(error => paint(error.message, true)))
  return { requestCandidate, refresh, acceptOriginal, addSheet, undoAdded, redoAdded, capture, followThrough, recordOf: projectId => records.get(projectId) || null }
}
