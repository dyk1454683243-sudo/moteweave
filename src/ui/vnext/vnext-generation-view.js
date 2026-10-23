import {
  VNEXT_FILE02_FORMATS,
  VNEXT_GENERATION_COPY as COPY,
  canCreateFromJob,
  candidateImageUrl,
  classifyAfterGenerate,
  classifyGenerationJob,
  isJobNotFound,
  createVnextGenerationClient,
  displayJobImageUrl,
  file02Availability,
  isGeneratedArtifactUrl,
  isUsableJobId,
  normalizeJobId,
  restoreJobPhase,
} from './vnext-generation-client.js'
import { createOperationId, sha256Hex } from './vnext-project-client.js'
import { ASSISTANT_COPY, ASSISTANT_CHOICES, SERVICE_UNAVAILABLE_TOAST, assistantCopy, assistantErrorCopy, createVnextAssistantClient, nativeCandidateRestoreBlock } from './vnext-assistant-client.js'
import { pixelDrawingPng } from './vnext-pixel-drawing.js'
import { applicationPreset, APPLICATION_PRESETS, COMPOSER_WORKFLOW_PHASES, GENERATED_IMAGE_BACKGROUNDS } from '../../editor-project/composerCapabilities.js'
import { createComposerActionRouter } from './vnext-composer-actions.js'
import { groupWithPrevious, plainFailureText, renderPlainTurn, renderTurn, setText, turnActions } from './vnext-thread-turns.js'
import { createResultLifecycle, undoEntryFor } from './vnext-result-lifecycle.js'
import { adoptSavedProject, createUndonePlacementStore, sheetPlacement, showSavedAddition } from './vnext-saved-project.js'
import { renderPixelDrawing } from '../../editor-project/pixelDrawing.js'
import {
  pollStaticImageJob,
  selectStaticImagePreset,
  staticImagePosition,
  staticImageFailureCopy,
  staticImageRequest,
} from './vnext-static-image.js'

const countLabel = (count, noun) => `${count} ${noun}${count === 1 ? '' : 's'}`

export const VNEXT_TOAST_DURATION_MS = Object.freeze({
  info: 4000,
  success: 4000,
  warning: 8000,
  danger: 8000,
})

export const VNEXT_TOAST_FIGMA = Object.freeze({
  componentSet: '1970:130',
  info: Object.freeze({ root: '1970:59', icon: '1970:60', message: '1970:63', close: '1970:71' }),
  success: Object.freeze({ root: '1970:79', icon: '1970:80', message: '1970:83', close: '1970:90' }),
  warning: Object.freeze({ root: '1970:96', icon: '1970:97', message: '1970:100', close: '1970:107' }),
  danger: Object.freeze({ root: '1970:113', icon: '1970:114', message: '1970:117', close: '1970:124' }),
})

const VNEXT_TOAST_SVGS_HTML = '<svg class="vnext-toast-svg is-info" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M6.99996 9.33329V6.99996M6.99996 4.66663H7.00579M12.8333 6.99996C12.8333 10.2216 10.2216 12.8333 6.99996 12.8333C3.7783 12.8333 1.16663 10.2216 1.16663 6.99996C1.16663 3.7783 3.7783 1.16663 6.99996 1.16663C10.2216 1.16663 12.8333 3.7783 12.8333 6.99996Z" stroke="#3B6FD9" stroke-width="1.14286" stroke-linecap="round" stroke-linejoin="round"/></svg><svg class="vnext-toast-svg is-success" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M5.24996 6.99996L6.41663 8.16663L8.74996 5.83329M12.8333 6.99996C12.8333 10.2216 10.2216 12.8333 6.99996 12.8333C3.7783 12.8333 1.16663 10.2216 1.16663 6.99996C1.16663 3.7783 3.7783 1.16663 6.99996 1.16663C10.2216 1.16663 12.8333 3.7783 12.8333 6.99996Z" stroke="#1E8E5A" stroke-width="1.14286" stroke-linecap="round" stroke-linejoin="round"/></svg><svg class="vnext-toast-svg is-warning" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M7 5.25004V7.58337M7 9.91671H7.00583M12.6758 10.5002L8.00912 2.33351C7.90737 2.15396 7.75981 2.00461 7.5815 1.90071C7.40319 1.79681 7.2005 1.74207 6.99413 1.74207C6.78775 1.74207 6.58507 1.79681 6.40675 1.90071C6.22844 2.00461 6.08088 2.15396 5.97913 2.33351L1.31246 10.5002C1.20961 10.6783 1.15568 10.8804 1.15613 11.0861C1.15659 11.2918 1.21141 11.4937 1.31505 11.6714C1.41869 11.8491 1.56746 11.9962 1.74628 12.0978C1.9251 12.1995 2.12761 12.252 2.33329 12.2502H11.6666C11.8713 12.25 12.0723 12.1959 12.2495 12.0934C12.4267 11.9909 12.5738 11.8436 12.6761 11.6663C12.7783 11.489 12.8321 11.2879 12.8321 11.0832C12.832 10.8785 12.7781 10.6774 12.6758 10.5002Z" stroke="#B8791E" stroke-width="1.14286" stroke-linecap="round" stroke-linejoin="round"/></svg><svg class="vnext-toast-svg is-danger" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M8.74996 5.24996L5.24996 8.74996M5.24996 5.24996L8.74996 8.74996M12.8333 6.99996C12.8333 10.2216 10.2216 12.8333 6.99996 12.8333C3.7783 12.8333 1.16663 10.2216 1.16663 6.99996C1.16663 3.7783 3.7783 1.16663 6.99996 1.16663C10.2216 1.16663 12.8333 3.7783 12.8333 6.99996Z" stroke="#D14343" stroke-width="1.14286" stroke-linecap="round" stroke-linejoin="round"/></svg>'

function ensureToastIconSvgs(iconNode) {
  if (!iconNode) return
  if (iconNode.querySelector?.('.vnext-toast-svg')) return
  if (Array.isArray(iconNode.children) && iconNode.children.some(child => String(child?.className || '').includes('vnext-toast-svg'))) return
  iconNode.innerHTML = VNEXT_TOAST_SVGS_HTML
}

export function renderVnextToast(toast, options = {}) {
  if (!toast) return null
  const clearTimer = () => {
    if (toast._vnextToastTimer) {
      clearTimeout(toast._vnextToastTimer)
      toast._vnextToastTimer = null
    }
  }
  const messageNode = toast.querySelector?.('#vnext-project-toast-message') || toast.querySelector?.('.vnext-project-toast-message') || toast.querySelector?.('.vnext-toast-message')
  const iconNode = toast.querySelector?.('#vnext-project-toast-icon') || toast.querySelector?.('.vnext-project-toast-icon') || toast.querySelector?.('.vnext-toast-icon')
  const closeBtn = toast.querySelector?.('#vnext-project-toast-close') || toast.querySelector?.('[data-toast-action="dismiss"]') || toast.querySelector?.('.vnext-toast-close')
  if (closeBtn && !closeBtn._vnextToastBound) {
    closeBtn._vnextToastBound = true
    closeBtn.addEventListener?.('click', (event) => {
      event?.preventDefault?.()
      event?.stopPropagation?.()
      clearTimer()
      toast.hidden = true
      toast._vnextToastOnDismiss?.()
    })
  }
  if (!options || (typeof options === 'string' && !options.trim())) {
    clearTimer()
    toast.hidden = true
    if (toast.dataset) {
      toast.dataset.toastKey = ''
      toast.dataset.toastTone = ''
    }
    if (messageNode) messageNode.replaceChildren?.()
    if (!messageNode || Object.hasOwn(toast, 'textContent')) toast.textContent = ''
    if (messageNode && Object.hasOwn(messageNode, 'textContent')) messageNode.textContent = ''
    return toast
  }
  const spec = typeof options === 'string' ? { title: options, body: '', tone: 'info' } : options
  const tone = ['info', 'success', 'warning', 'danger'].includes(spec.tone) ? spec.tone : 'info'
  const title = String(spec.title ?? spec.message ?? '').trim()
  const body = String(spec.body ?? '').trim()
  if (!title && !body) return renderVnextToast(toast, '')
  const dedupeKey = spec.key ? String(spec.key) : ''
  const fullText = [title, body].filter(Boolean).join(' ')
  const figmaSpec = VNEXT_TOAST_FIGMA[tone] || VNEXT_TOAST_FIGMA.info
  toast._vnextToastOnDismiss = typeof spec.onDismiss === 'function' ? spec.onDismiss : null
  toast.classList?.remove?.('is-info', 'is-success', 'is-warning', 'is-danger')
  toast.classList?.add?.(`is-${tone}`)
  if (toast.dataset) {
    toast.dataset.toastTone = tone
    toast.dataset.toastKey = dedupeKey
    toast.dataset.figma = VNEXT_TOAST_FIGMA.componentSet
    toast.dataset.figmaVariant = figmaSpec.root
  }
  toast.setAttribute?.('data-toast-tone', tone)
  toast.setAttribute?.('role', tone === 'warning' || tone === 'danger' ? 'alert' : 'status')
  toast.setAttribute?.('aria-live', tone === 'warning' || tone === 'danger' ? 'assertive' : 'polite')
  ensureToastIconSvgs(iconNode)
  if (iconNode?.dataset) iconNode.dataset.figma = figmaSpec.icon
  iconNode?.setAttribute?.('data-figma', figmaSpec.icon)
  if (messageNode?.dataset) messageNode.dataset.figma = figmaSpec.message
  messageNode?.setAttribute?.('data-figma', figmaSpec.message)
  if (closeBtn?.dataset) closeBtn.dataset.figma = figmaSpec.close
  closeBtn?.setAttribute?.('data-figma', figmaSpec.close)
  if (messageNode && typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const children = []
    if (title) {
      const titleEl = document.createElement('span')
      titleEl.className = body ? 'vnext-project-toast-title has-body' : 'vnext-project-toast-title'
      titleEl.textContent = body ? `${title} ` : title
      children.push(titleEl)
    }
    if (body) {
      const bodyEl = document.createElement('span')
      bodyEl.className = 'vnext-project-toast-body'
      bodyEl.textContent = body
      children.push(bodyEl)
    }
    messageNode.replaceChildren(...children)
    if (Object.hasOwn(messageNode, 'textContent')) messageNode.textContent = fullText
    if (Object.hasOwn(toast, 'textContent')) toast.textContent = fullText
  } else {
    toast.textContent = fullText
  }
  const wasSameActiveKey = Boolean(dedupeKey && !toast.hidden && toast._vnextActiveKey === dedupeKey)
  toast._vnextActiveKey = dedupeKey
  toast.hidden = false
  if (!wasSameActiveKey) {
    clearTimer()
    const durationMs = Number.isFinite(spec.durationMs) ? Number(spec.durationMs) : VNEXT_TOAST_DURATION_MS[tone]
    if (durationMs > 0 && typeof setTimeout === 'function') {
      const shownAt = Date.now()
      toast._vnextToastTimer = setTimeout(() => {
        if (durationMs > 100 && Date.now() - shownAt < 50) return
        toast._vnextToastTimer = null
        toast.hidden = true
      }, durationMs)
      toast._vnextToastTimer?.unref?.()
    }
  }
  return toast
}

export function canFollowUpPhase(phase) {
  return phase === 'candidate' || phase === 'ready' || phase === 'process_failed' || phase === 'failed'
}

export function shouldShowCandidate(phase) {
  return phase === 'candidate' || phase === 'process_failed' || phase === 'ready' || phase === 'failed' || phase === 'processing'
}

export function candidateTransientCanvas(job, size = {}, phase = 'candidate') {
  const url = displayJobImageUrl(job, phase)
  if (!url || !job?.id) return null
  return {
    id: `candidate:${job.id}`,
    x: 0,
    y: 0,
    width: Number(size.width) || 0,
    height: Number(size.height) || 0,
    previewUrl: url,
    name: 'Generated candidate',
    transient: true,
  }
}

export const PRESET_RELOAD_NOT_YET = 'Saved, but the canvas could not be reloaded yet. Reload canvas tries again; nothing is added twice.'

export function renderCandidatePreview(root, state = {}, view) {
  if (view?.setTransients) {
    const item = shouldShowCandidate(state.phase) ? candidateTransientCanvas(state.job, {}, state.phase) : null
    view.setTransients(item ? [item] : [])
    if (item && !view.selectedId) view.select(item.id)
    return item
  }
  return null
}

export function runningProgress(job, now = Date.now()) {
  const status = job?.status
  const value = status === 'post_processing' ? 0.85 : status === 'generating' ? 0.55 : 0.2
  const stage = status === 'post_processing' ? 'Finishing' : status === 'generating' ? 'Generating' : 'Queued'
  const started = Date.parse(job?.created_at || '')
  if (!Number.isFinite(started)) return { value, label: stage }
  const seconds = Math.max(0, Math.floor((now - started) / 1000))
  const elapsed = seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`
  return { value, label: `${stage} · ${elapsed}` }
}

// A preset run is one turn updated in place: short progress while it runs, then the result or
// the one thing to do next. Only the finished sheet (downloads) and the Job ID recovery form use
// the richer block; everything else is conversational text (see vnext-thread-turns.js).
export function generationViewModel(state) {
  const job = state.job
  const kind = state.phase
  const author = state.runAuthor
  const stop = { label: COPY.stopWaiting, kind: 'secondary', action: 'stop', capability: 'GEN-08', figma: '2855:2399' }
  if (kind === 'ready') {
    const addKey = state.projectId && job?.id ? `${state.projectId}|${job.id}` : ''
    const addedHere = Boolean(addKey && state.addedKeys?.has?.(addKey))
    // A sheet the project holds (saved) is never offered for adding again. Whether it is on the canvas
    // follows the canvases actually shown (state.placement, sheetPlacement), not the saved asset: an
    // Undo removes the canvas but keeps the asset.
    const added = addedHere || Boolean(state.jobInProject) || Boolean(state.placement?.saved)
    const adding = Boolean(state.adding || state.reloadingSheet)
    // A pending reload belongs to a placement this page still holds (gen.savedPlacement).
    const reloadOwned = state.reloadPendingKey === undefined || state.reloadPendingKey === addKey
    const reloadFailed = Boolean(added && state.reloadFailed && !state.reloadingSheet && reloadOwned)
    // The placement's Undo belongs to this exact canvas addition (see addToCanvas), or to the same
    // canvas put back after a page reload (restored).
    const undo = (addedHere || state.placementUndo?.restored) && state.placementUndo?.key === addKey ? state.placementUndo : null
    // An undone placement is off the canvas (its Undo detached it); otherwise the canvases decide.
    const onCanvas = undo?.status !== 'undone' && (state.placement?.known ? Boolean(state.placement.canvasId) : added)
    const offCanvas = added && !onCanvas && !adding && !reloadFailed
    const undone = offCanvas && undo?.status === 'undone'
    const redo = undone && Boolean(state.canRedo)
    // Without Redo (after a page reload) this page's own Undo record puts the same canvas back.
    const putBack = offCanvas && !undone && Boolean(state.restorable)
    const restoring = Boolean(addKey && state.restoring === addKey)
    const restoreNote = offCanvas && !undone && state.restoreNote?.key === addKey ? state.restoreNote.body : null
    const lead = undo?.restored ? 'Back on the canvas.' : 'Added as a new canvas.'
    const body = adding
      ? (state.reloadingSheet ? 'Reloading the canvas… Nothing is added or generated again.' : 'Adding to the canvas…')
      : (reloadFailed
        ? (state.error || 'Saved, but the canvas did not reload.')
        : offCanvas ? (undone ? (redo ? (undo?.redoRetry ? COPY.undoneRedoRetryBody : COPY.undoneRedoBody) : COPY.undoneBody)
          : (restoreNote || (putBack ? COPY.putBackBody : COPY.savedOffCanvasBody)))
          : undo?.status === 'superseded' ? `${lead} Undo here was withdrawn because a later change was made; nothing was reverted. ⌘Z / Ctrl+Z steps back through changes in order.`
            : undo?.status === 'retry' ? `${lead} Undo could not run while another change was saving; try again.`
              : undo?.restored ? COPY.putBackDoneBody
                : (addedHere ? (undo ? 'Added as a new canvas. Undo removes it.' : 'Added as a new canvas.') : added ? 'Already in this project; it was not added again.' : (state.error || 'Ready to add to the canvas.')))
    // Figma Current: one node per result state (DIRECT-ACTIONS r4 row 2910:2426; added = 2855:2456).
    const figma = state.reloadingSheet ? '2910:2590'
      : reloadFailed ? (state.error === PRESET_RELOAD_NOT_YET ? '2910:2641' : '2910:2534')
        : adding ? '2910:2483'
          : offCanvas ? (undone ? '2910:2806' : putBack ? '2937:2736' : '2934:2702')
            : undo?.status === 'superseded' ? '2910:2753'
              : undo?.status === 'retry' ? '2910:2697'
                : undo?.restored ? '2937:2759'
                  : addedHere ? (undo ? '2855:2456' : '2916:2652') : added ? '2916:2688' : '2910:2429'
    const undoActions = undo && ['offered', 'retry'].includes(undo.status) && !reloadFailed
      ? [{ label: 'Undo', kind: 'secondary', action: 'astra-flow:undo', capability: 'CHAT-01', title: 'Undo this result', disabled: Boolean(undo.running), figma }]
      : []
    // After Undo the existing Redo restores the same canvas (only while it is the newest undone change).
    const redoActions = redo
      ? [{ label: 'Redo', kind: 'secondary', action: 'astra-flow:redo', capability: 'CHAT-01', title: 'Put the same canvas back', disabled: Boolean(undo.running), figma }]
      : putBack ? [{ label: restoring ? COPY.puttingBack : COPY.putBack, kind: 'secondary', action: 'restore-canvas', capability: 'GEN-10 CHAT-01',
        title: COPY.putBackTitle, disabled: restoring || Boolean(state.projectChanging), figma }]
        : []
    return {
      figma,
      capability: 'GEN-10 FILE-02',
      author,
      tone: reloadFailed || state.error || restoreNote || undo?.status === 'retry' || undo?.status === 'superseded' ? 'warning' : (added && !offCanvas ? 'success' : undefined),
      title: state.reloadingSheet ? 'Saved, reloading the canvas' : reloadFailed ? 'Saved, canvas did not reload'
        : offCanvas ? (undone ? 'Undone' : COPY.savedOffCanvasTitle) : (added ? COPY.readyTitle : COPY.readyPendingTitle),
      body,
      downloads: file02Availability(job),
      downloadTitle: COPY.download,
      // A saved sheet whose canvas did not reload offers only the reload (never a second add).
      actions: reloadFailed && addedHere && !adding
        ? [{ label: 'Reload canvas', kind: 'primary', action: 'reload-canvas', capability: 'GEN-10', figma, title: 'Reload the saved canvas; nothing is added or generated again' }]
        // No Undo while the sheet is still being added or its canvas reloaded (the placement is not complete).
        : adding ? [] : offCanvas ? redoActions : added ? undoActions : [
        {
          label: COPY.addCanvas,
          kind: 'primary',
          action: 'add-canvas',
          capability: 'GEN-10',
          figma,
          disabled: !state.projectId || Boolean(state.projectChanging),
          title: !state.projectId
            ? 'Open a v1 project before adding to canvas.'
            : state.projectChanging ? 'Wait for the project to finish opening' : COPY.addCanvas,
        },
      ],
    }
  }
  if (kind === 'process_failed' || kind === 'failed') {
    return {
      figma: '2855:2411',
      capability: 'GEN-10',
      author,
      tone: 'warning',
      title: kind === 'failed' ? COPY.generateFailedTitle : COPY.processFailedTitle,
      body: kind === 'failed'
        ? 'The provider did not return a usable image. Nothing was added; no automatic retry.'
        : 'The image did not pass the quality checks. Nothing was added to the canvas.',
      actions: [{ label: COPY.viewJob, kind: 'secondary', action: 'query', capability: 'GEN-08' }],
    }
  }
  if (kind === 'candidate') {
    if (state.autoRun) {
      return { figma: '2855:2461', capability: 'GEN-09', author, busy: true, title: COPY.processingTitle,
        progress: { value: 0.9, label: COPY.processingBody, tone: 'info' }, actions: [] }
    }
    // Only an unfinished run lands here (an interrupted page, or a Job ID restored from its saved files): finishing it is recovery, not approval.
    return {
      figma: '2855:2461',
      capability: 'GEN-09',
      author,
      title: COPY.candidateTitle,
      body: COPY.candidateResumeBody,
      actions: [{ label: COPY.adopt, kind: 'primary', action: 'adopt', capability: 'GEN-09', figma: '2855:2461' }],
    }
  }
  if (kind === 'processing') {
    return { figma: '2855:2399', capability: 'GEN-10', author, busy: true, title: COPY.processingTitle,
      progress: { ...runningProgress(job), tone: 'info' }, actions: [stop] }
  }
  if (kind === 'running') {
    // Only the job this run started (or the one being queried) is shown as generating; a follow-up's
    // plan check keeps the previous result in state.job but has not started a job yet.
    const live = job && (state.runJobId === undefined || state.runJobId === job.id) ? job : null
    return { figma: '2855:2399', capability: 'GEN-08', author, busy: true, title: live ? COPY.runningTitle : COPY.reviewTitle,
      body: live ? COPY.runningBody : COPY.preparingBody,
      ...(live ? { progress: { ...runningProgress(live), tone: 'info' } } : {}), actions: [stop] }
  }
  if (kind === 'review') {
    // The provider-free plan check is a step of the requested run, never a confirmation.
    return { figma: '2855:2399', capability: 'GEN-07', author, busy: true, title: COPY.reviewTitle, body: COPY.preparingBody, actions: [] }
  }
  // "Generate again" repeats only a request remembered for this project; it is a new provider call.
  const again = state.lastRequest && state.lastRequest.projectId === state.projectId
    ? [{ label: COPY.generateAgain, kind: 'secondary', action: 'review', capability: 'GEN-07', title: COPY.generateAgainTitle }]
    : []
  // The Job ID form appears only when this run may have a job (it started or queried one, or the
  // outcome of its live call is unknown); an error before any job is a plain notice. A follow-up
  // keeps the previous result in state.job, so that alone does not count.
  const jobMayExist = Boolean(state.runJobId)
    || [COPY.recoveryBody, COPY.stoppedBody, COPY.missingJobId, COPY.invalidJobId, COPY.jobNotFoundBody,
      COPY.jobUnavailableBody, COPY.jobLookupBody, COPY.jobGoneBody, COPY.jobLostBody, COPY.jobNeedsProjectBody].includes(state.error)
  // A stop before the live call and a lost job whose sheet the project holds are plain notices.
  const heldNotice = state.error === COPY.jobHeldBody || state.error === COPY.jobSavedOffCanvasBody
  const neutralNotice = state.error === COPY.stoppedBeforeCall || heldNotice
  if (!state.error || !jobMayExist || neutralNotice) {
    return {
      figma: state.error === COPY.stoppedBeforeCall ? '2858:2256' : state.error === COPY.jobHeldBody ? '2927:2746'
        : state.error === COPY.jobSavedOffCanvasBody ? '2934:2741' : '2855:2411',
      capability: heldNotice ? 'GEN-08' : 'GEN-07',
      author,
      tone: state.error && !neutralNotice ? 'warning' : null,
      title: state.error || COPY.recoveryTitle,
      actions: again,
    }
  }
  const jobField = document.createElement('label')
  jobField.className = 'vnext-workflow-job'
  jobField.dataset.capability = 'GEN-08'
  jobField.dataset.figma = '2855:2431'
  const jobLabel = document.createElement('span')
  setText(jobLabel, COPY.jobIdLabel)
  const jobInput = document.createElement('input')
  jobInput.id = 'vnext-job-id'
  jobInput.name = 'job_id'
  jobInput.autocomplete = 'off'
  jobInput.spellcheck = false
  jobInput.placeholder = COPY.jobIdPlaceholder
  jobInput.value = state.jobIdDraft || ''
  jobField.append(jobLabel, jobInput)
  // A job the local service does not have and a check that did not complete stay distinct states.
  const notFound = state.error === COPY.jobNotFoundBody
  const unavailable = state.error === COPY.jobUnavailableBody
  const notChecked = state.error === COPY.jobLookupBody
  const needsProject = state.error === COPY.jobNeedsProjectBody
  return {
    figma: notFound ? '2918:2689' : unavailable ? '2927:2694' : notChecked ? '2918:2708' : needsProject ? '2931:2700'
      : state.error === COPY.jobGoneBody ? '2918:2727' : state.error === COPY.jobLostBody ? '2927:2712' : '2855:2431',
    capability: state.error ? 'GEN-08' : 'GEN-07',
    author,
    tone: state.error ? 'warning' : null,
    title: notFound ? COPY.jobNotFoundTitle : unavailable ? COPY.jobUnavailableTitle : notChecked ? COPY.jobLookupTitle
      : needsProject ? COPY.jobNeedsProjectTitle
      : state.error === COPY.stoppedBody ? COPY.stoppedTitle : COPY.recoveryTitle,
    body: state.error || null,
    fields: [jobField],
    actions: [
      ...again,
      {
        label: COPY.continueQuery,
        kind: 'primary',
        action: 'query',
        capability: 'GEN-08',
        figma: '2855:2431',
      },
    ],
  }
}

// Conversation copy for a preset step that failed (see plainFailureText).
function presetErrorCopy(error, fallback) {
  return plainFailureText(error?.message, fallback)
}

async function referenceFromDraft(draft) {
  const ref = draft?.reference
  if (!ref?.objectUrl) return null
  const response = await fetch(ref.objectUrl)
  const buffer = new Uint8Array(await response.arrayBuffer())
  let binary = ''
  for (const byte of buffer) binary += String.fromCharCode(byte)
  return {
    base64: btoa(binary),
    mimeType: ref.mimeType || 'image/png',
    name: ref.name || 'reference.png',
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function bytesToBase64(bytes) {
  const buffer = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || [])
  const chunk = 0x8000
  let binary = ''
  for (let index = 0; index < buffer.length; index += chunk) {
    binary += String.fromCharCode(...buffer.subarray(index, index + chunk))
  }
  return btoa(binary)
}

const LAST_JOB_KEY = 'vnext-last-job-id'

function readLastJobId() {
  try {
    return window.localStorage.getItem(LAST_JOB_KEY) || ''
  } catch {
    return ''
  }
}

function writeLastJobId(id) {
  if (!isUsableJobId(id)) return
  try {
    window.localStorage.setItem(LAST_JOB_KEY, id)
  } catch {}
}

// A remembered job that does not exist is forgotten, so a reload does not restore it again.
function forgetLastJobId(id) {
  try {
    if (window.localStorage.getItem(LAST_JOB_KEY) === id) window.localStorage.removeItem(LAST_JOB_KEY)
  } catch {}
}

// Who ran a preset job, so a turn restored after a reload keeps its author instead of a generic
// label. Unknown authors fall back to the preset that produced the job.
const JOB_AUTHORS_KEY = 'vnext-job-authors'
const PRESET_AUTHOR = APPLICATION_PRESETS[0]?.name || null
const knownAuthor = value => typeof value === 'string'
  && (Object.values(ASSISTANT_CHOICES).some(choice => choice.label === value) || APPLICATION_PRESETS.some(preset => preset.name === value))
function readJobAuthors() {
  try {
    const value = JSON.parse(window.localStorage.getItem(JOB_AUTHORS_KEY) || '{}')
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  } catch { return {} }
}
function readJobAuthor(id) {
  const value = isUsableJobId(id) ? readJobAuthors()[id] : null
  return knownAuthor(value) ? value : null
}
function rememberJobAuthor(id, author) {
  if (!isUsableJobId(id) || !knownAuthor(author)) return
  try {
    const authors = readJobAuthors()
    delete authors[id]
    authors[id] = author
    const kept = Object.entries(authors).slice(-32)
    window.localStorage.setItem(JOB_AUTHORS_KEY, JSON.stringify(Object.fromEntries(kept)))
  } catch {}
}

// Jobs started in this browser (at most 32), with the generation job a processing job finished, so
// a job the local service no longer holds is reported accurately and a lost processing job is
// checked through the generation job it came from.
const JOB_RUNS_KEY = 'vnext-job-runs'
function readJobRuns() {
  try {
    const value = JSON.parse(window.localStorage.getItem(JOB_RUNS_KEY) || '{}')
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  } catch { return {} }
}
function readJobRun(id) {
  const value = isUsableJobId(id) ? readJobRuns()[id] : null
  return value && typeof value === 'object' ? { source: isUsableJobId(value.source) ? value.source : null } : null
}
function rememberJobRun(id, source = null) {
  if (!isUsableJobId(id)) return
  try {
    const runs = readJobRuns()
    delete runs[id]
    runs[id] = isUsableJobId(source) ? { source } : {}
    window.localStorage.setItem(JOB_RUNS_KEY, JSON.stringify(Object.fromEntries(Object.entries(runs).slice(-32))))
  } catch {}
}

const ASTRA_DISCARDED_PREFIX = 'vnext.astraDiscardedCandidates.'

function readDiscardedAstraCandidates(projectId) {
  try {
    const raw = window.localStorage.getItem(`${ASTRA_DISCARDED_PREFIX}${projectId}`)
    if (raw === null) return []
    if (raw.length > 16384) return null
    const ids = JSON.parse(raw)
    return Array.isArray(ids) && ids.length <= 64 && ids.every(id => typeof id === 'string' && id.length <= 256) ? ids : null
  } catch { return null }
}
export function bindVnextGenerationSession(root, {
  session,
  generationClient,
  getDraft,
  initialJobId,
  assistantClient,
} = {}) {
  const host = root.querySelector('#vnext-workflow')
  if (!host) return null
  const api = generationClient || createVnextGenerationClient()
  const assistant = assistantClient || createVnextAssistantClient()
  assistant.bind(session?.project?.id ?? null)
  // Like the job records above, this browser keeps the records of sheets whose canvas this page's own
  // Undo removed, so Put back on the canvas still works after a page reload.
  if (session && !session.undonePlacements) session.undonePlacements = createUndonePlacementStore(() => window.localStorage)
  // Shared result lifecycle: exact Undo binding and the originating turn of a held recovery.
  const results = createResultLifecycle({
    latestUndoEntry: () => session?.latestUndoEntry?.() || null,
    undoIfLatest: entry => (typeof session?.undoIfLatest === 'function' ? session.undoIfLatest(entry) : false),
    entryState: entry => session?.undoEntryState?.(entry) ?? null,
    latestRedoEntry: () => session?.latestRedoEntry?.() || null,
    redoIfLatest: entry => (typeof session?.redoIfLatest === 'function' ? session.redoIfLatest(entry) : false),
  })
  let assistantContext = null
  let assistantNote = ASSISTANT_COPY.ready
  let promptInputVersion = 0
  let astraDocumentMode = false
  let activeAstraCandidate = null
  let serviceUnavailable = false
  let serviceUnavailableNotified = false
  const toastNode = () => root.querySelector?.('#vnext-project-toast') || null
  const isServiceOffline = () => Boolean(serviceUnavailable || assistant.serviceUnavailable || assistant.errorCode === 'assistant_service_unavailable')
  function notifyServiceUnavailable({ keptAbove = false, stage = 'pre_send' } = {}) {
    serviceUnavailable = true
    let body = SERVICE_UNAVAILABLE_TOAST.body
    if (stage === 'post_result') {
      body = SERVICE_UNAVAILABLE_TOAST.postResultBody
      assistantNote = `The local service is unavailable. ${SERVICE_UNAVAILABLE_TOAST.postResultBody}`
    } else if (stage === 'post_save_unknown') {
      body = SERVICE_UNAVAILABLE_TOAST.postSaveBody
      assistantNote = `The local service is unavailable. ${SERVICE_UNAVAILABLE_TOAST.postSaveBody}`
    } else {
      body = keptAbove ? SERVICE_UNAVAILABLE_TOAST.keptAboveBody : SERVICE_UNAVAILABLE_TOAST.body
      assistantNote = assistantErrorCopy('assistant_service_unavailable', assistant.provider || 'grok')
      if (keptAbove) {
        assistantNote = assistantNote.replace('Draft kept.', 'Original message kept above; current draft unchanged.')
      }
    }
    const toast = toastNode()
    const spec = {
      key: 'assistant_service_unavailable',
      tone: 'warning',
      title: SERVICE_UNAVAILABLE_TOAST.title,
      body,
      durationMs: VNEXT_TOAST_DURATION_MS.warning,
    }
    if (!serviceUnavailableNotified) {
      serviceUnavailableNotified = true
      if (typeof session?.showToast === 'function') session.showToast(spec)
      else if (toast) renderVnextToast(toast, spec)
    } else if ((keptAbove || stage !== 'pre_send') && toast && !toast.hidden && toast.dataset?.toastKey === 'assistant_service_unavailable') {
      if (typeof session?.showToast === 'function') session.showToast(spec)
      else renderVnextToast(toast, spec)
    }
    updateSend()
  }
  function clearServiceUnavailable() {
    if (!serviceUnavailable && !serviceUnavailableNotified) return
    serviceUnavailable = false
    serviceUnavailableNotified = false
    const toast = toastNode()
    if (toast && !toast.hidden && toast.dataset?.toastKey === 'assistant_service_unavailable') {
      if (typeof session?.showToast === 'function') session.showToast('')
      else renderVnextToast(toast, '')
    }
    if (!assistant.blocked) {
      assistantNote = assistant.connection === 'connected'
        ? assistantCopy(assistant.provider || 'grok', astraDocumentMode).completed
        : assistantCopy(assistant.provider || 'grok', astraDocumentMode).ready
    }
  }
  function removeTurnNode(node) {
    if (!node) return
    node.remove?.()
    gen.thread = gen.thread.filter(turn => turn.node !== node)
    regroupThread()
  }
  // After turns are removed, same-author grouping is recomputed so every author shows once.
  function regroupThread() {
    let previous = null
    for (const turn of gen.thread) {
      if (turn.role === 'assistant') {
        turn.node.classList?.remove?.('is-continued')
        groupWithPrevious(turn.node, previous, turn.node.dataset?.author)
      }
      previous = turn.node
    }
  }
  const discardedAstraCandidates = new Map()
  const candidateIdentity = (operationId, candidate) => operationId || candidate?.sha256 || null
  function discardAstraCandidate(projectId, id) {
    if (!id) return false
    const ids = [...new Set([...(readDiscardedAstraCandidates(projectId) || []), ...(discardedAstraCandidates.get(projectId) || []), id])].slice(-64)
    discardedAstraCandidates.set(projectId, ids)
    try {
      window.localStorage.setItem(`${ASTRA_DISCARDED_PREFIX}${projectId}`, JSON.stringify(ids))
      return readDiscardedAstraCandidates(projectId)?.includes(id) === true
    } catch { return false }
  }
  const gen = {
    phase: 'idle',
    jobIdDraft: '',
    job: null,
    error: null,
    projectId: session?.project?.id ?? null,
    waiting: false,
    pendingFromJob: null,
    pendingAdds: new Map(),
    addedKeys: new Set(),
    review: null,
    reviewKey: null,
    reviewedSnapshot: null,
    promptCleared: false,
    adding: false,
    reloadFailed: false,
    thread: [],
    staticImageBusy: false,
    staticImageJobId: null,
    staticImageUnknown: false,
    staticImageStop: false,
    staticImageRequest: null,
    staticImageContext: null,
    staticImageAdding: false,
    staticImageSavePending: false,
    // A requested preset run continues through generation, processing and placement on its own.
    autoRun: null,
    // Each run (or restored job) is one thread turn; its phases update that turn in place.
    runSerial: 0,
    runAuthor: null,
    // The job the current run started, the request "Generate again" repeats (for its project only),
    // whether a Stop would land before the live call, and whether the run may preview on the canvas.
    runJobId: null,
    lastRequest: null,
    planChecking: false,
    previewLive: false,
    // The saved preset placement (for its reload) and the Undo of exactly its new canvas.
    savedPlacement: null,
    placementUndo: null,
    reloadingSheet: false,
    // Putting an undone sheet's canvas back after a page reload: the placement key in progress and the
    // note on its outcome (restorePlacement).
    restoring: false,
    restoreNote: null,
  }
  let projectEpoch = 0
  let waitEpoch = 0
  let announced = '' // the last run outcome written to #vnext-run-status
  const parkedGeneration = new Map()

  function currentProjectId() {
    return session?.project?.id ?? gen.projectId
  }

  // Where a job's sheet is now: saved in the shown project, and which of its canvases holds it (r7).
  // Without the placement's document id or a saved asset record the canvas cannot be told (known: false).
  function currentPlacement(jobId, documentId = null) {
    const placement = sheetPlacement({ project: session?.project, documents: session?.documents, jobId, documentId })
    return documentId || placement.saved ? placement : { ...placement, known: false }
  }
  // A sheet this project already holds (its asset revision records the job) is not added again.
  function jobInProject(job) {
    const id = job?.id
    if (!id) return false
    return Object.values(session?.project?.assets || {})
      .some(asset => Object.values(asset?.revisions || {}).some(revision => revision?.source_job_id === id))
  }

  function contextToken() {
    return { epoch: projectEpoch, projectId: currentProjectId() }
  }

  function isCurrentContext(token) {
    return Boolean(token)
      && token.epoch === projectEpoch
      && token.projectId === currentProjectId()
  }

  function waitStillOwned(token, waitId) {
    return isCurrentContext(token) && waitId === waitEpoch
  }

  function closeModelMenu(focus = false) {
    const menu = root.querySelector('#vnext-assistant-model-menu')
    if (menu) { if (menu.matches?.(':popover-open')) menu.hidePopover(); menu.hidden = true }
    const trigger = root.querySelector('#vnext-assistant-model')
    trigger?.setAttribute('aria-expanded', 'false')
    if (focus && !trigger?.disabled) trigger?.focus?.()
  }

  function updateSend() {
    activeAstraCandidate?.syncValidity?.()
    const send = root.querySelector('.vnext-send')
    if (!send) return
    const draft = typeof getDraft === 'function' ? getDraft() : {}
    const context = chatContext()
    const newChat = root.querySelector('.is-chat-new')
    if (newChat) newChat.disabled = !canStartDiscussion()
    root.querySelectorAll('[data-recover-job]').forEach(button => {
      button.disabled = button.dataset.recoveredDone === 'true' || !canStartDiscussion()
    })
    root.querySelectorAll('[data-dismiss-discussion-preview]').forEach(button => { button.disabled = button.dataset.recoveredDone === 'true' })
    root.querySelectorAll('[data-recover-discussion-preview]').forEach(button => {
      button.disabled = button.dataset.recoveredDone === 'true' || button.dataset.recovering === 'true' || !canStartDiscussion()
    })
    if (assistantContext && assistantContext !== context && assistant.busy) assistant.stop()
    const textMode = isAssistantMode(draft) || assistant.busy || Boolean(activeAstraCandidate) || session?.hasPixelDrawingSave?.()
    const selector = root.querySelector('#vnext-assistant-model')
    if (selector) {
      selector.hidden = !textMode
      selector.disabled = assistant.busy || assistantPreparing || Boolean(activeAstraCandidate) || Boolean(session?.pixelCopyPending)
        || gen.staticImageBusy || Boolean(gen.staticImageJobId) || gen.staticImageUnknown
      selector.value = assistant.provider || 'grok'
      selector.title = ASSISTANT_CHOICES[assistant.provider || 'grok'].label
      const label = root.querySelector('#vnext-assistant-model-label')
      if (label) label.textContent = selector.title
      root.querySelectorAll('[data-assistant-model]').forEach(item => item.setAttribute('aria-checked', String(item.dataset.assistantModel === selector.value)))
      if (selector.disabled || selector.hidden) closeModelMenu()
    }
    for (const id of ['GEN-04', 'GEN-06']) {
      const control = root.querySelector(`[data-capability="${id}"]`)
      if (control) control.hidden = textMode && !applicationPreset(draft.skillId)
    }
    syncPresetSummary(applicationPreset(draft.skillId))
    for (const turn of gen.thread) {
      if (turn.provider) turn.node.hidden = false
    }
    if (textMode) {
      if (assistant.restoring) {
        send.disabled = true; send.classList.remove('is-ready')
        send.title = 'Restoring saved discussion…'; send.setAttribute('aria-label', send.title)
        return
      }
      // A finished image not yet submitted waits for a project change; a submitted save can still be resolved.
      const waitProject = Boolean(session?.openInFlight?.()) && !session?.imageSaveRecoverable?.()
      if (staticImageOpenHere()) {
        if (selector) selector.disabled = true
        send.disabled = gen.staticImageAdding || (waitProject && !gen.staticImageBusy)
        send.classList.add('is-ready')
        send.dataset.capabilityStatus = 'bound'
        send.dataset.assistantRunning = 'false'
        const title = waitProject && !gen.staticImageBusy ? 'Wait for the project to finish opening'
          : gen.staticImageAdding ? 'Saving the new image'
          : gen.staticImageSavePending ? 'Resolve the same image save'
          : gen.staticImageUnknown
          ? 'Image request result is unknown. Not sent again.'
          : gen.staticImageBusy
            ? 'Waiting for the same image'
            : 'Check the same image job'
        send.title = title
        send.setAttribute('aria-label', title)
        const waiting = root.querySelector('#vnext-assistant-status')
        if (waiting) { waiting.hidden = false; waiting.textContent = title }
        return
      }
      if (session?.hasPixelDrawingSave?.()) {
        if (selector) selector.disabled = true
        send.dataset.assistantRunning = 'false'
        send.disabled = assistantPreparing || Boolean(session.staticImageWrite?.busy) || waitProject
        send.classList.toggle('is-ready', !send.disabled)
        send.title = waitProject ? 'Wait for the project to finish opening' : send.disabled ? 'Saving the pixel drawing…' : 'Resolve pixel drawing save'
        send.setAttribute('aria-label', send.title)
        const waiting = root.querySelector('#vnext-assistant-status')
        if (waiting) { waiting.hidden = false; waiting.textContent = `${send.title}. Keep this tab open until the drawing is saved; no new model request is needed.` }
        return
      }
      if (assistantPreparing || session?.pixelCopyPending) {
        send.disabled = assistantPreparing || Boolean(session?.pixelCopyBusy)
        send.classList.toggle('is-ready', !send.disabled)
        send.title = assistantPreparing ? 'Reading the selected image…' : session?.pixelCopyBusy ? 'Saving new image…' : 'Resolve image save'
        send.setAttribute('aria-label', send.title)
        return
      }
      const copy = assistantCopy(assistant.provider || 'grok', astraDocumentMode)
      const label = ASSISTANT_CHOICES[assistant.provider || 'grok'].label
      const offline = isServiceOffline()
      const blocked = Boolean(assistant.blocked || offline)
      const defaultBlockedReason = assistantErrorCopy(assistant.errorCode || (offline ? 'assistant_service_unavailable' : 'assistant_result_unknown'), assistant.provider)
      const blockedReason = offline && assistantNote && assistantNote.startsWith('The local service is unavailable.')
        ? assistantNote
        : assistant.interrupted ? copy.paused : defaultBlockedReason
      const ready = Boolean(String(draft.prompt ?? '').trim()) && Boolean(currentProjectId()) && !blocked
      send.disabled = !assistant.busy && !ready
      send.classList.toggle('is-ready', !send.disabled)
      send.dataset.assistantRunning = String(assistant.busy)
      send.dataset.capabilityStatus = send.disabled ? 'pending' : 'bound'
      send.title = assistant.busy ? `Stop ${label} reply` : !currentProjectId() ? copy.project
        : blocked ? blockedReason
          : `Send to ${label}`
      send.setAttribute('aria-label', send.title)
      const status = root.querySelector('#vnext-assistant-status')
      if (status) { status.hidden = false; status.textContent = assistant.busy ? copy.pending
        : !currentProjectId() ? copy.project : blocked ? (offline && assistantNote ? assistantNote : blockedReason) : assistantNote }
      syncPausedChannel()
      return
    }
    send.dataset.assistantRunning = 'false'
    const status = root.querySelector('#vnext-assistant-status')
    if (status) status.hidden = true
    const editingSelection = Boolean(session?.conversationRef)
    const ready = Boolean(String(draft.prompt ?? '').trim()) && !gen.waiting && !editingSelection
    send.disabled = !ready
    if (editingSelection) {
      send.classList.remove('is-ready')
      send.title = 'Conversational editing · Coming later'
      send.setAttribute('aria-label', 'Conversational editing coming later')
      send.dataset.capabilityStatus = 'pending'
      return
    }
    send.classList.toggle('is-ready', ready)
    send.dataset.capabilityStatus = ready ? 'bound' : 'pending'
    const label = 'Send'
    send.title = ready ? label : COPY.noProposal
    send.setAttribute('aria-label', ready ? label : 'Send disabled')
  }

  // A model channel paused by a reply whose result is unknown gets one plain note with an explicit
  // "Continue here". It keeps this discussion, its history and the draft; it never resends the
  // stopped request or applies an earlier action (see assistant.resume()).
  function syncPausedChannel() {
    const provider = assistant.provider || 'grok'
    const idle = !assistant.busy && !assistant.restoring && !assistantPreparing
    for (const turn of gen.thread) {
      const button = turn.node.querySelector?.('[data-resume-channel]')
      if (button && turn.node.dataset.resumeState === 'open') button.disabled = !idle || turn.node.dataset.resumeProvider !== provider || isServiceOffline()
    }
    if (!idle || !assistant.interrupted || typeof assistant.resume !== 'function' || !currentProjectId()) return
    if (gen.thread.some(turn => turn.node.dataset?.resumeProvider === provider && ['open', 'working'].includes(turn.node.dataset.resumeState))) return
    const note = appendAssistantNote(assistantCopy(provider).paused, provider, { management: true, figma: '2864:241' })
    note.dataset.resumeProvider = provider
    note.dataset.resumeState = 'open'
    const button = document.createElement('button')
    button.type = 'button'; button.className = 'vnext-dialog-btn is-secondary'
    button.dataset.resumeChannel = 'true'; button.dataset.figma = '2864:249'
    button.textContent = 'Continue here'
    button.title = 'Continue this discussion with this model; the stopped reply is not sent again'
    button.addEventListener('click', () => { void resumeChannel(note, button, provider) })
    turnActions(note)?.append(button)
  }
  async function resumeChannel(note, button, provider) {
    if (button.disabled || note.dataset.resumeState !== 'open' || assistant.busy || (assistant.provider || 'grok') !== provider) return
    const token = contextToken()
    const title = note.querySelector('[data-turn-title]')
    note.dataset.resumeState = 'working'
    button.disabled = true
    if (title) setText(title, 'Checking the stopped reply… Nothing is sent again.')
    updateSend()
    try {
      await assistant.resume()
      if (!isCurrentContext(token)) return
      note.dataset.resumeState = 'done'
      button.remove?.()
      if (title) setText(title, 'Ready to continue in this discussion. The stopped reply was not sent again.')
      assistantNote = assistantCopy(provider, astraDocumentMode).ready
      announce('Ready to continue')
    } catch (error) {
      if (!isCurrentContext(token)) return
      note.dataset.resumeState = 'open'
      button.disabled = false
      if (error.code === 'assistant_service_unavailable') {
        if (title) setText(title, assistantCopy(provider).paused)
        notifyServiceUnavailable()
      } else if (title) {
        setText(title, error.code === 'assistant_busy'
          ? 'Another reply is still running, or the stopped reply is still ending. Try Continue here again in a moment; nothing was sent.'
          : `${assistantCopy(provider).paused} ${assistantErrorCopy(error.code, provider)}`)
      }
    } finally {
      if (isCurrentContext(token)) updateSend()
    }
  }

  // GEN-04 is a read-only summary of the selected preset's fixed output (from its single profile
  // definition); there is no size choice to make, so it never shows a size the preset cannot send.
  function syncPresetSummary(preset) {
    const control = root.querySelector('[data-capability="GEN-04"]')
    const config = preset?.profile?.imageConfig
    if (!control || !config) return
    const label = control.querySelector('span')
    const text = `${config.aspect_ratio} · ${config.image_size}`
    if (label && label.textContent !== text) label.textContent = text
    control.title = `Fixed by the ${preset.name} preset: ${config.aspect_ratio}, ${config.image_size}. Not adjustable.`
    control.setAttribute?.('aria-label', control.title)
    control.dataset.capabilityStatus = 'bound'
  }

  function turnKey(state) {
    return `preset:${state.runSerial || 0}`
  }

  function isAssistantMode() { return !gen.waiting }
  let assistantPreparing = false
  function canStartDiscussion() {
    return Boolean(currentProjectId()) && !assistant.busy && !assistantPreparing && !activeAstraCandidate && !gen.waiting && !gen.staticImageBusy
      && !session?.openInFlight?.() // no new image placement while another project opens or is created
      && !session?.pixelCopyPending && !session?.hasPixelDrawingSave?.()
      && !gen.staticImageSavePending && !staticImageOpenHere()
  }
  function chatContext() {
    return JSON.stringify([currentProjectId(), session?.project?.revision, session?.conversationRef?.canvasId ?? null, assistant.provider || 'grok', session?.api?.openEpoch?.current])
  }
  // A project change that ended in this project (a reopen, or one that did not switch) leaves this project's
  // image job usable: follow the current open epoch. A save that is no longer current becomes a plain job
  // handle (the same job is read again; nothing is generated). A run still going continues here, except across
  // an explicit reopen, which ignores the old run's result (its finally then keeps only the job handle).
  // A stale context (an earlier visit) is left alone.
  // A deferred sheet reload is only for a project state older than the saved sheet; once the project shown
  // already includes it (a reopen or later load), it is dropped instead of rolling the canvas back.
  function dropLoadedReload() {
    const pending = gen.deferredReload
    // A Reload canvas in progress completes the placement itself (see reloadAddedSheet).
    if (!pending || gen.reloadingSheet || pending.projectId !== currentProjectId() || (session.project?.revision ?? -1) < (pending.project?.revision ?? 0)) return false
    gen.deferredReload = null; gen.reloadFailed = false; gen.error = null
    // The shown project already holds the saved sheet: the placement completes as on the direct
    // path (Undo for exactly that canvas, its place beside the others, the selection it owned).
    const saved = gen.savedPlacement
    if (saved?.projectId === pending.projectId) {
      const token = contextToken()
      void finishPlacement(saved.key, saved.projectId, saved.result, token, saved.ownedSelection ?? null)
        .then(() => { if (isCurrentContext(token)) render() })
    }
    return true
  }
  function keepImageJobHere({ reopened = false } = {}) {
    const owned = gen.staticImageContext, epoch = session?.api?.openEpoch?.current
    if (!owned || owned.openEpoch == null || owned.openEpoch === epoch || owned.projectId !== currentProjectId() || !isCurrentContext(owned.token)) return
    if (reopened && gen.staticImageBusy) return
    const reopening = session?.pendingOpen?.projectId === owned.projectId && session.pendingOpen.token === epoch
    if (session?.openInFlight?.() && !reopening) return // another project (or New project / upgrade) is still in progress
    if (gen.staticImageSavePending && !session?.imageSaveCurrentFor?.(gen.staticImageJobId)) gen.staticImageSavePending = false
    owned.openEpoch = epoch
  }
  function staticImageOpenHere() {
    if (!gen.staticImageBusy && !gen.staticImageJobId && !gen.staticImageUnknown) return false
    const owned = gen.staticImageContext
    if (!owned) return Boolean(gen.staticImageBusy)
    return owned.projectId === currentProjectId()
      && (owned.openEpoch == null || session?.api?.openEpoch?.current === owned.openEpoch)
  }

  function clearFrozenPrompt(version, text) {
    const input = root.querySelector('#vnext-prompt-input')
    if (!input || promptInputVersion !== version) return
    if (input.value.trim() !== String(text ?? '').trim()) return
    clearPrompt()
  }

  function resumeStaticImage() {
    const owned = gen.staticImageContext
    if (!owned || !gen.staticImageJobId || gen.staticImageBusy) return null
    return submitStaticImage({
      request: gen.staticImageRequest,
      projectId: owned.projectId,
      openEpoch: owned.openEpoch,
      token: owned.token,
      jobId: gen.staticImageJobId,
    })
  }

  async function offerStaticImage(prompt, { reference = false, background = null, fromComposer = false } = {}) {
    const imageProvider = assistant.provider || 'grok'
    const token = contextToken()
    const projectId = currentProjectId()
    const openEpoch = session?.api?.openEpoch?.current
    const promptVersion = promptInputVersion
    const referenceWanted = reference
    const selectedRef = session.conversationRef ? { ...session.conversationRef } : null
    const revision = session.project?.revision
    const referenceCurrent = () => !referenceWanted || (session.conversationRef?.canvasId === selectedRef?.canvasId
      && session.conversationRef?.documentId === selectedRef?.documentId && session.project?.revision === revision
      && session.project?.sprite_documents?.[selectedRef?.documentId]?.working_revision === selectedRef?.workingRevision)
    const stillHere = () => isCurrentContext(token) && currentProjectId() === projectId && session?.api?.openEpoch?.current === openEpoch
      && (assistant.provider || 'grok') === imageProvider && referenceCurrent()
    const anchorId = session?.conversationRef?.canvasId ?? session?.view?.selectedId ?? null
    const selected = session.view?.canvases?.find((canvas) => canvas.id === anchorId)
    const anchor = selected ? { id: selected.id, width: selected.width, height: selected.height } : null
    if (referenceWanted && (!selected || selectedRef?.projectId !== projectId || !Number.isInteger(selectedRef?.workingRevision))) {
      appendAssistantNote('Import the reference image onto the canvas and select it first. Nothing was sent.', imageProvider)
      return
    }
    let state
    try {
      state = await api.getStaticImageState(projectId)
    } catch (error) {
      if (!stillHere()) return
      appendAssistantNote(staticImageFailureCopy(error.message, 'Image generation could not be checked. Nothing was sent.'), imageProvider, { tone: 'warning' })
      return
    }
    if (!stillHere()) return
    const preset = selectStaticImagePreset(state, imageProvider)
    if (!preset) {
      const reason = state?.providers?.find(item => item.provider === imageProvider)?.reason
      appendAssistantNote(reason === 'image_reference_policy'
        ? `${ASSISTANT_CHOICES.codex.label} image generation is not enabled: its native tool cannot enforce the current no-reference policy. Nothing was sent.`
        : 'Image generation is unavailable for the selected provider. Nothing was sent.', imageProvider)
      return
    }
    if (referenceWanted && !preset.referenceUpload) {
      appendAssistantNote(`This model does not support reference-image generation here. Select ${ASSISTANT_CHOICES.codex.label} to redraw the selected image. Nothing was sent.`, imageProvider)
      return
    }
    // The request is the permission: the background comes from the request (or the panel
    // default), and the single native request starts now. Budget facts appear as progress.
    const chosenBackground = GENERATED_IMAGE_BACKGROUNDS.includes(background) ? background
      : (GENERATED_IMAGE_BACKGROUNDS.includes(root.querySelector('#vnext-general-background')?.value) ? root.querySelector('#vnext-general-background').value : 'green')
    let request
    try {
      request = staticImageRequest({ description: prompt, preset, background: chosenBackground, reference: referenceWanted ? {
        canvas_id: selectedRef.canvasId, document_id: selectedRef.documentId,
        expected_revision: revision, working_revision: selectedRef.workingRevision,
      } : null })
    } catch (error) {
      appendAssistantNote(error.message, imageProvider)
      return
    }
    if (!stillHere()) return
    const runTurn = openRunTurn(imageProvider)
    updateAstraFlowCard(runTurn, { title: 'Generating an image…', busy: true,
      body: `${request.reference ? 'Using the selected canvas as the reference. ' : ''}It goes beside the selection with its background removed. One request on your account, no automatic retry.` })
    return submitStaticImage({
      request,
      projectId,
      openEpoch,
      token,
      promptVersion,
      promptText: prompt,
      fromComposer,
      anchor,
      background: chosenBackground,
      runTurn,
    })
  }
  function confirmedBackground(value) {
    return ['auto', 'green', 'magenta', 'purple', 'white'].includes(value) ? value : null
  }
  function backgroundFromDescription(text) {
    if (typeof text !== 'string') return null
    if (text.includes('#8000ff')) return 'purple'
    if (text.includes('#ff00ff')) return 'magenta'
    if (text.includes('#00ff00')) return 'green'
    return null
  }
  async function submitStaticImage({ request, projectId, openEpoch, token, jobId = null, promptVersion = null, promptText = '', anchor = null, background = null, fromComposer = false, runTurn = null }) {
    let reported = false
    const report = (title, body, { tone, undoEntry = null, figma = null } = {}) => {
      reported = true
      renderRunResult(runTurn, { title, body, tone, undoEntry, figma })
    }
    if (!isCurrentContext(token) || currentProjectId() !== projectId || session?.api?.openEpoch?.current !== openEpoch) return null
    const notSent = text => runTurn ? renderRunResult(runTurn, { title: 'Not sent', body: text, tone: 'warning' }) : appendAssistantNote(text, assistant.provider || 'grok')
    if (gen.staticImageBusy) { notSent('Another image is still being generated. Nothing new was sent.'); return null }
    if (staticImageOpenHere() && !jobId) {
      notSent('The last image request result is unknown. It was not sent again.')
      return null
    }
    gen.staticImageBusy = true
    gen.staticImageStop = false
    gen.staticImageRequest = request
    if (!runTurn) {
      // Recovery of an image whose save committed belongs to the run that made it: its original
      // turn completes (with that run's author) instead of a new turn under the current model.
      const held = jobId ? results.peek(`image:${jobId}`) : null
      if (held && turnInThread(held.turn)) {
        runTurn = held.turn
        updateAstraFlowCard(runTurn, { title: 'Reloading the canvas…', busy: true, body: 'Reading the saved image again; nothing is generated or imported again.' })
      } else {
        // Checking a kept image job is its own turn, credited to the model that made the image.
        const provider = Object.hasOwn(ASSISTANT_CHOICES, request?.provider) ? request.provider : held?.provider || assistant.provider || 'grok'
        runTurn = openRunTurn(provider)
        updateAstraFlowCard(runTurn, { title: 'Checking the same image…', busy: true, body: 'Reading the kept image job; nothing is generated again.' })
      }
    }
    const owned = jobId ? gen.staticImageContext : { projectId, openEpoch, token, anchor, background: confirmedBackground(background) }
    if (owned && confirmedBackground(background) && !confirmedBackground(owned.background)) owned.background = confirmedBackground(background)
    gen.staticImageContext = owned
    if (!jobId) {
      gen.staticImageJobId = null
      gen.staticImageUnknown = false
      gen.staticImageSavePending = false
    }
    updateSend()
    if (!jobId) {
      if (!fromComposer) clearFrozenPrompt(promptVersion, promptText)
      if (!fromComposer && request?.reference) session.consumeConversationRef?.()
    }
    const sameProject = () => isCurrentContext(token) && currentProjectId() === projectId && gen.staticImageContext === owned
    // owned.openEpoch follows onOpenEpochKept, so a change that ended without switching does not orphan this job.
    const stillHere = () => !gen.staticImageStop && sameProject() && session?.api?.openEpoch?.current === owned.openEpoch
    try {
      let bytes
      // "Resolve the same image save" reuses the local save; without one, read the same job again (never generate).
      if (jobId && gen.staticImageSavePending && session?.imageSaveCurrentFor && !session.imageSaveCurrentFor(jobId)) gen.staticImageSavePending = false
      const recoveringSave = Boolean(jobId && gen.staticImageSavePending)
      if (!gen.staticImageSavePending) {
        const result = await pollStaticImageJob({
          request,
          jobId,
          sleep: () => wait(500),
          start: (body) => api.startStaticImage(projectId, body),
          getJob: (id) => api.getStaticImageJob(projectId, id),
          isCurrent: stillHere,
        })
        if (!isCurrentContext(token)) return null
        gen.staticImageJobId = result.jobId
        owned.fitted = result.job?.fitted === true
        if (!stillHere()) return null
        bytes = await api.downloadStaticImage(projectId, result.jobId)
      }
      if (!stillHere()) return null
      gen.staticImageAdding = true
      updateSend()
      const color = confirmedBackground(owned.background) || backgroundFromDescription(request?.description) || 'auto'
      owned.background = color
      const before = session.latestUndoEntry?.() || null
      const placed = await session.importGeneratedAsset?.({
        bytes,
        projectId,
        openEpoch: owned.openEpoch,
        background: owned.background,
        name: 'Generated image',
        sourceJobId: gen.staticImageJobId,
        anchor: owned.anchor || null,
      })
      if (placed?.abandoned || !stillHere()) {
        // Only the open epoch moved (a project change is under way): keep the same job and its save for later.
        if (sameProject() && !gen.staticImageStop && session?.api?.openEpoch?.current !== owned.openEpoch) {
          gen.staticImageSavePending = Boolean(session?.imageSaveFor?.(gen.staticImageJobId))
        } else { gen.staticImageJobId = null; gen.staticImageSavePending = false }
        return null
      }
      if (placed?.deferred || placed?.waiting) {
        gen.staticImageSavePending = true
        report('Image ready, not placed yet', 'Another project is opening. If you stay in this project, Resolve the same image save places this same image; otherwise it is listed when you reopen this one. It is not generated again.', { tone: 'warning' })
        return placed
      }
      if (placed?.busy) {
        report('Image ready, not placed yet', 'Another canvas change is still saving. Check the same image job from the send button when it finishes; it is not generated again.', { tone: 'warning' })
        return null
      }
      if (placed?.saved && placed.refreshPending) {
        // Saved, but the canvas has not shown it yet: not complete, and no Undo until it is. The
        // same turn keeps the result and offers the reload; recovery completes this result.
        gen.staticImageSavePending = true
        results.hold(`image:${gen.staticImageJobId}`, { turn: runTurn, provider: runTurn?.turnProvider || assistant.provider || 'grok', operationId: placed.operationId })
        reported = true
        runTurn.handleAstraFlowAction = act => { if (act === 'recover' && staticImageOpenHere() && !gen.staticImageBusy) void resumeStaticImage() }
        updateAstraFlowCard(runTurn, { title: 'Image saved, canvas not refreshed yet', tone: 'warning', figma: '2864:137',
          body: 'The image is saved in this project, but the canvas did not reload. Reload canvas shows it and adds Undo; nothing is generated or imported again.',
          actions: [{ label: 'Reload canvas', kind: 'primary', action: 'astra-flow:recover', capability: 'CHAT-01', figma: '2864:145' }] })
        announce('Image saved, canvas not refreshed yet')
        return placed
      }
      if (placed?.unknown || placed?.refreshFailed || placed?.positionFailed) {
        gen.staticImageSavePending = true
        report('Placing the image needs attention', 'Resolve the same image save finishes this same image; it does not generate or import another one.', { tone: 'warning' })
        return placed
      }
      if (placed?.alreadyImported) {
        results.complete(`image:${gen.staticImageJobId}`)
        gen.staticImageJobId = null; gen.staticImageUnknown = false; gen.staticImageSavePending = false
        report('Image already in this project', 'This generated image was placed earlier. Nothing was generated or imported again.')
        return placed
      }
      if (!placed?.placed) throw new Error('The generated image could not be placed.')
      results.complete(`image:${gen.staticImageJobId}`)
      gen.staticImageJobId = null
      gen.staticImageUnknown = false
      gen.staticImageSavePending = false
      const after = session.latestUndoEntry?.() || null
      report('Image added to the canvas', `${owned.fitted ? 'Scaled to fit 1024 px; the unscaled original is kept in the project. ' : ''}The background was removed automatically. Undo removes the new canvas.`,
        { undoEntry: undoEntryFor(placed.historyEntry, before, after), figma: recoveringSave ? '2864:150' : null })
      return placed
    } catch (error) {
      if (!sameProject()) return null
      if (error?.jobId) gen.staticImageJobId = error.jobId
      if (error?.code === 'static_image_failed') gen.staticImageJobId = null
      if (error?.code === 'static_image_unknown' && !error?.jobId) gen.staticImageUnknown = true
      if (session?.api?.openEpoch?.current !== owned.openEpoch) return null // a project change is under way: the same job is kept for when it ends
      if (!isCurrentContext(token) || currentProjectId() !== projectId) return null
      const text = staticImageFailureCopy(error.message)
      report('Image not added', /not sent again|was not submitted again|no automatic retry/i.test(text) ? text : `${text} It was not sent again.`, { tone: 'warning' })
      return null
    } finally {
      // A run that ended without a result (Stop waiting, a project change) still closes its progress turn.
      if (runTurn && !reported && isCurrentContext(token) && currentProjectId() === projectId) {
        renderRunResult(runTurn, { title: gen.staticImageStop ? 'Stopped waiting' : 'Image not placed yet', body: gen.staticImageJobId
          ? 'The image job is kept. Check the same image job from the send button; nothing is sent again.'
          : 'Nothing more was sent. A request already started may still count toward usage.' })
      }
      if (gen.staticImageContext === owned) {
        gen.staticImageBusy = false
        gen.staticImageAdding = false
        if (owned.projectId !== currentProjectId() || !isCurrentContext(owned.token)) { // its project was left meanwhile: the job stays listed in that project
          gen.staticImageSavePending = false; gen.staticImageJobId = null; gen.staticImageUnknown = false; gen.staticImageContext = null
        } else keepImageJobHere()
        updateSend()
      }
    }
  }
  async function offerPixelDrawing(prompt, drawing, { fromComposer = false, submittedRef = null, submittedPrompt = prompt } = {}) {
    const provider = assistant.provider || 'grok'
    if (drawing.error) { appendAssistantNote(drawing.error, provider); return }
    if (provider !== 'codex') { appendAssistantNote(assistantErrorCopy('assistant_drawing_unavailable', provider), provider); return }
    if (session.openInFlight?.()) { appendAssistantNote('Wait for the project to finish opening. Nothing was sent.', provider); return }
    if (staticImageOpenHere() || session.pendingImport || session.pendingSave || session.historyBusy || session.pixelCopyPending
      || session.canPlacePixelDrawing?.() === false) {
      appendAssistantNote('Finish or resolve the current image save first. Nothing was sent.', provider); return
    }
    const token = contextToken(), selection = chatContext(), projectId = currentProjectId()
    const revision = session.project.revision, openEpoch = session.api.openEpoch.current
    const inputVersion = promptInputVersion
    const reference = drawing.reference === true
    const selectedBlank = drawing.kind === 'selected'
    let source = null
    const owns = () => isCurrentContext(token) && (assistant.provider || 'grok') === provider
      && currentProjectId() === projectId && session.api.openEpoch.current === openEpoch
    const here = () => owns() && selection === chatContext()
    const unchanged = () => here() && session.project.revision === revision && (!source || source.isSelected())
    try {
      assistantPreparing = true; updateSend()
      if (selectedBlank) source = await session.prepareBlankPixelDrawing(drawing.size)
      else if (reference) source = await session.preparePixelEdit()
      if (source?.allowedRect || source?.multiCel) throw new Error('This image-aware drawing path uses a whole single-frame image. Use an exact scoped pixel command for this selection or layer.')
      if (!unchanged()) return
      if (drawing.kind === 'edit' && (source.width !== drawing.size || source.height !== drawing.size)) throw Object.assign(new Error('Select the 32×32 or 64×64 pixel image to edit.'), { code: 'pixel_source_unsupported' })
    } catch (error) {
      if (here()) appendAssistantNote(error.message || 'Select the reference image first. Nothing was sent.', provider)
      return
    } finally { assistantPreparing = false; updateSend() }
    const anchorId = session.conversationRef?.canvasId ?? null
    const selected = session.view?.canvases?.find(c => c.id === anchorId)
    const anchor = selected ? { id: selected.id, width: selected.width, height: selected.height } : null
    // The request is the permission: draw now, then place the result where it was asked for.
    if (!unchanged() || assistant.busy || inputVersion !== promptInputVersion || session.canPlacePixelDrawing?.() === false) {
      appendAssistantNote('The selection or project changed before drawing started. Nothing was sent; send the request again.', provider); return
    }
    if (!fromComposer) { clearPrompt() }
    const userTurn = !fromComposer ? appendUserTurn(prompt, provider) : null
    const consumedRef = fromComposer ? submittedRef : session.consumeConversationRef?.()
    const sentReferenceIdentity = referenceIdentity(getDraft?.())
    const sentVersion = promptInputVersion
    assistantContext = selection
    const runTurn = openRunTurn(provider)
    updateAstraFlowCard(runTurn, { title: `Drawing ${drawing.size}×${drawing.size} pixel art…`, busy: true,
      body: selectedBlank ? 'On the selected empty canvas.' : drawing.kind === 'edit' ? 'As a new canvas beside the selected image; the original stays unchanged.' : 'As a new canvas beside the selection.' })
    let result
    try {
      const pending = assistant.send({ message: prompt, revision, canvasId: anchorId,
        pixelDrawing: { ...drawing, kind: selectedBlank ? 'new' : drawing.kind, reference: selectedBlank ? false : reference },
        ...(source && !selectedBlank ? { workingRevision: source.sourceRevision, width: source.width, height: source.height } : {}) })
      updateSend()
      result = await pending
      clearServiceUnavailable()
    } catch (error) {
      if (!owns()) return
      const input = root.querySelector('#vnext-prompt-input')
      const restore = Boolean(here() && promptInputVersion === sentVersion && input?.value === '' && referenceIdentity(getDraft?.()) === sentReferenceIdentity)
      if (restore) {
        input.value = submittedPrompt; input.dispatchEvent(new Event('input', { bubbles: true })); session.restoreConversationRef?.(consumedRef)
      }
      if (error.code === 'assistant_service_unavailable') {
        removeTurnNode(runTurn)
        if (restore && userTurn) removeTurnNode(userTurn)
        notifyServiceUnavailable({ keptAbove: !restore })
        return
      }
      renderRunResult(runTurn, { title: 'Drawing stopped', body: error.code?.startsWith('pixel_') ? error.message : assistantErrorCopy(error.code, provider), tone: 'warning', figma: '2855:2360' })
      return
    } finally {
      if (owns()) assistantContext = null
      updateSend()
    }
    try {
      if (!result.pixel_drawing) { if (unchanged()) renderRunResult(runTurn, { title: 'No drawing produced', body: result.reply }); return }
      assistantPreparing = true; updateSend()
      const before = session.latestUndoEntry?.() || null
      const undoEntry = () => { const after = session.latestUndoEntry?.() || null; return after && after !== before ? after : null }
      if (selectedBlank) {
        if (!unchanged()) { renderRunResult(runTurn, { title: 'Not drawn', body: 'The selected canvas changed while drawing. Nothing was saved.', tone: 'warning' }); return }
        const rgba = renderPixelDrawing(result.pixel_drawing, drawing.size)
        const saved = await session.saveBlankPixelDrawing(source, rgba)
        if (!owns()) return
        const preview = rgbaPreview(rgba, drawing.size)
        renderRunResult(runTurn, saved?.saved
          ? { title: 'Drawn on the selected canvas', body: saved.settled ? 'Undo restores the empty canvas.' : 'Saved; the canvas is still refreshing. No new model request is needed.', fields: preview ? [preview] : [], undoEntry: undoEntry() }
          : { title: 'Drawing save not confirmed', body: 'Follow the current save notice to finish this same drawing; no new model request is needed.', tone: 'warning' })
        return
      }
      const bytes = await pixelDrawingPng(result.pixel_drawing, drawing.size, drawing.kind === 'edit' ? source.rgba : null)
      const name = `${drawing.size}×${drawing.size} pixel drawing`
      const candidate = session.retainPixelDrawing?.({ bytes, projectId, anchor, name })
      // Until it is placed, the kept drawing belongs to this run turn: a later recovery completes
      // this result (with its author and Undo), whichever model is selected by then.
      const drawingKey = `drawing:${projectId}`
      results.hold(drawingKey, { turn: runTurn, provider, size: drawing.size, projectId })
      // Context changes forbid automatic placement, but must not discard a completed drawing.
      if (!unchanged()) {
        if (currentProjectId() === projectId) renderRunResult(runTurn, { title: 'Drawing kept, not placed yet', body: 'The project changed while drawing. Resolve pixel drawing save after the change finishes; no new model request is needed.', tone: 'warning' })
        return
      }
      const placed = await session.placeStaticImage({ bytes, projectId, openEpoch, anchor,
        name, pixelDrawing: true, pixelDrawingCandidate: candidate })
      if (!owns() || placed?.abandoned) return
      if (placed?.deferred) {
        renderRunResult(runTurn, { title: 'Drawing kept, not placed yet', body: 'Another project is opening. Stay here or return to this project and use Resolve pixel drawing save; no new model request is needed. Keep this tab open until it is saved.', tone: 'warning' })
        return
      }
      const complete = placed?.canvasId && !placed.positionFailed && !placed.positionUnknown
      if (complete) {
        results.complete(drawingKey)
        renderRunResult(runTurn, drawingResult(drawing.size, undoEntryFor(placed.historyEntry, before, session.latestUndoEntry?.() || null)))
      } else renderRunResult(runTurn, { title: 'Placing the drawing needs attention', body: 'Resolve the existing save notice; it will not call the model again.', tone: 'warning', figma: '2864:188' })
    } catch (error) {
      if (!owns()) return
      if (error.code === 'assistant_service_unavailable') notifyServiceUnavailable({ stage: 'post_result' })
      renderRunResult(runTurn, { title: 'Placing the drawing needs attention', body: error.code?.startsWith('pixel_') ? error.message : 'The completed drawing could not be placed yet; it will not call the model again.', tone: 'warning', figma: '2864:188' })
    } finally {
      assistantPreparing = false
      if (owns()) assistantContext = null
      updateSend()
    }
  }

  // The normal completion of a placed pixel drawing, whether placed at once or after recovery.
  function drawingResult(size, undoEntry, { recovered = false } = {}) {
    return {
      title: size ? `Pixel drawing added (${size}×${size})` : 'Pixel drawing added',
      body: `Placed as a new canvas beside the selection; the original was not changed. Undo removes it.${recovered ? ' No additional model request was sent.' : ''}`,
      undoEntry,
      figma: recovered ? '2864:201' : null,
    }
  }
  // A resolved drawing save completes the run that drew it: its own turn and author when that
  // turn is still shown (a model change does not move it), otherwise a turn credited to that model.
  function completeRecoveredDrawing(projectId, result, before) {
    const record = results.complete(`drawing:${projectId}`)
    const turn = record && turnInThread(record.turn) ? record.turn : openRunTurn(record?.provider || 'codex')
    renderRunResult(turn, drawingResult(record?.size, undoEntryFor(result.historyEntry, before, session.latestUndoEntry?.() || null), { recovered: true }))
  }
  function rgbaPreview(rgba, size) {
    if (typeof document === 'undefined' || !document.createElement) return null
    const canvas = document.createElement('canvas')
    if (!canvas?.getContext) return null
    canvas.width = size; canvas.height = size
    const context = canvas.getContext('2d')
    if (!context?.createImageData) return null
    const image = context.createImageData(size, size)
    image.data.set(rgba)
    context.putImageData(image, 0, 0)
    canvas.className = 'vnext-pixel-edit-candidate is-native-drawing'
    canvas.setAttribute('aria-label', 'Drawing result')
    return canvas
  }

  // One inline turn per requested run: progress first, then the visible result. Undo is an
  // optional follow-up and only reverts this result while it is still the latest change.
  function openRunTurn(provider) {
    freezePastTurns()
    announced = ''
    const wrap = document.createElement('div')
    wrap.className = 'vnext-turn is-assistant is-astra-flow is-run-turn'
    wrap.turnAuthor = ASSISTANT_CHOICES[provider]?.label
    wrap.turnProvider = provider
    groupWithPrevious(wrap, gen.thread.at(-1)?.node, wrap.turnAuthor)
    host.append(wrap)
    gen.thread.push({ role: 'assistant', key: `run:${gen.thread.length}`, node: wrap, provider })
    return wrap
  }
  function turnInThread(node) {
    return Boolean(node) && gen.thread.some(turn => turn.node === node)
  }
  function renderRunResult(wrap, { title, body = '', tone, fields = [], undoEntry = null, figma = null }) {
    const actions = []
    if (undoEntry && typeof session.undoIfLatest === 'function') {
      const undo = { label: 'Undo', kind: 'secondary', action: 'astra-flow:undo', capability: 'CHAT-01', title: 'Undo this result' }
      actions.push(undo)
      const superseded = () => updateAstraFlowCard(wrap, { title, body: `${body} Undo here was withdrawn because a later change was made; nothing was reverted. ⌘Z / Ctrl+Z steps back through changes in order.`, tone: 'warning', fields, frozen: true, figma: fields.length ? '2855:2308' : '2911:5702' })
      wrap.handleAstraFlowAction = async act => {
        if (act !== 'undo' || wrap.dataset.undoing === 'true') return
        wrap.dataset.undoing = 'true'
        const button = wrap.querySelector('[data-gen-action="astra-flow:undo"]')
        if (button) button.disabled = true
        // Undo reverts this result only while it is still the latest change, never a later edit.
        const outcome = await results.undo(undoEntry)
        wrap.dataset.undoing = 'false'
        if (outcome === 'undone' || outcome === 'already_undone') {
          updateAstraFlowCard(wrap, { title: 'Undone', body: outcome === 'undone' ? 'The previous version is restored.' : 'Already undone with ⌘Z / Ctrl+Z; the previous version is restored.', frozen: true, figma: '2855:2289' })
          announce('Undone')
        } else if (outcome === 'retry') {
          // Still the latest change: another save was in progress, so the same Undo stays offered.
          updateAstraFlowCard(wrap, { title, body: `${body} Undo could not run while another change was saving; try again.`, tone: 'warning', fields, actions: [undo], figma: '2858:2270' })
        } else superseded()
        updateSend()
      }
    } else wrap.handleAstraFlowAction = null
    updateAstraFlowCard(wrap, { title, body, tone, fields, actions, figma })
    announce(title)
  }

  function updateAstraFlowCard(wrap, {
    title,
    body = '',
    tone = undefined,
    fields = [],
    actions = [],
    frozen = false,
    busy = false,
    figma = null,
  }) {
    // Progress and text results stay conversational; a result with an image gets the richer block.
    const card = renderTurn(wrap, {
      // Figma Current DIRECT-ACTIONS-20261020/r1: progress, image result, failure, text result.
      figma: figma || (busy ? '2855:2237' : fields.length ? '2855:2308' : tone === 'warning' ? '2855:2348' : '2855:2272'),
      capability: 'CHAT-01',
      author: wrap.turnAuthor,
      title,
      body,
      tone,
      fields,
      actions,
      busy,
    })
    bindFlowButtons(wrap)
    if (frozen) freezeTurn(wrap)
    layoutActionRows()
    scrollThread()
    return card
  }
  // A turn's own actions (Undo, Stop, recovery) answer on that turn even after later messages.
  function bindFlowButtons(wrap) {
    wrap.querySelectorAll('[data-gen-action]').forEach((btn) => {
      const act = btn.dataset.genAction || ''
      if (act.startsWith('astra-flow:')) {
        const flowAct = act.slice('astra-flow:'.length)
        btn.dataset.astraFlow = flowAct
        btn.addEventListener('click', (event) => {
          event?.preventDefault?.()
          event?.stopPropagation?.()
          if (btn.disabled) return
          wrap.handleAstraFlowAction?.(flowAct)
        })
      }
    })
  }

  const documentRequest = (candidate, operationId, action) => ({ action, candidate_id: candidate.candidate_id, sha256: candidate.sha256,
    canvas_id: candidate.canvas_id, document_id: candidate.document_id, expected_revision: candidate.project_revision,
    expected_working_revision: candidate.working_revision, operation_id: operationId,
    ...(Array.isArray(candidate?.editable_frame_ids) && candidate.editable_frame_ids.length > 0
      ? { expected_editable_frame_ids: candidate.editable_frame_ids }
      : {}) })
  // A produced canvas/timeline result is applied as one undoable change; only an uncertain
  // save keeps a recovery action. An earlier result the user asks to apply comes through here too.
  async function applyDocumentInCard({ wrap, source, candidate, operationId, token, isValid = () => true, value: initialValue = null }) {
    // The result belongs to its own run turn while no later message follows it (another run's
    // turn elsewhere in the thread, such as a finished sheet, does not take it over).
    const ownerProjectId = source?.projectId ?? null
    const ownerCandidateId = candidate?.candidate_id ?? null
    const ownerSha256 = candidate?.sha256 ?? null
    const ownerOpId = operationId ?? null
    let settled = false, inFlight = false, activeSeq = 0
    const sameIdentity = () => (source?.projectId ?? null) === ownerProjectId
      && (candidate?.candidate_id ?? null) === ownerCandidateId
      && (candidate?.sha256 ?? null) === ownerSha256
      && (operationId ?? null) === ownerOpId
    const inThread = () => wrap?.dataset?.stopped !== 'true'
      && isCurrentContext(token)
      && sameIdentity()
      && (!Array.isArray(gen?.thread) || gen.thread.some(turn => turn.node === wrap))
    const owned = () => !settled && inThread() && isValid() && Boolean(source?.isSelected?.()) && assistant.provider === 'astra' && latestTurnNode() === wrap
    const ownsAttempt = seq => !settled && seq === activeSeq && inThread()
    const abortByProjectSwitch = () => {
      settled = true
      inFlight = false
      activeSeq += 1
      wrap.handleAstraFlowAction = () => {}
      session.clearDocumentCandidate?.()
    }
    const invalidateNotApplied = (body = 'The canvas or the conversation changed before this result was applied. Nothing was saved; send the request again.') => {
      if (settled) return
      settled = true
      inFlight = false
      activeSeq += 1
      wrap.handleAstraFlowAction = () => {}
      session.clearDocumentCandidate?.()
      if (activeAstraCandidate?.wrap === wrap) activeAstraCandidate = null
      if (inThread()) {
        renderRunResult(wrap, { title: 'Not applied', body, tone: 'warning' })
      }
    }
    let readValue = initialValue
    const readAndApply = async (isRetry = false) => {
      if (settled || inFlight || activeAstraCandidate?.saving || activeAstraCandidate?.reading) return
      if (!inThread()) {
        abortByProjectSwitch()
        if (activeAstraCandidate?.wrap === wrap) activeAstraCandidate = null
        return
      }
      if (isRetry && !owned()) {
        invalidateNotApplied()
        return
      }
      const seq = ++activeSeq
      inFlight = true
      activeAstraCandidate = { wrap, saving: false, reading: true, recovering: Boolean(isRetry), abortByProjectSwitch }
      if (isRetry) {
        wrap.handleAstraFlowAction = () => {}
        updateAstraFlowCard(wrap, {
          title: 'Reading canvas & timeline changes…',
          busy: true,
          body: 'Reading the same result without calling the model again.',
          actions: [{ label: 'Retry same result', kind: 'primary', action: 'astra-flow:recover', capability: 'CHAT-01', figma: '2855:2365', disabled: true }],
        })
      }
      assistantPreparing = true; updateSend()
      try {
        const fetched = readValue || await assistant.documentCandidate(documentRequest(candidate, operationId, 'read'), source.projectId)
        if (!ownsAttempt(seq)) {
          inFlight = false
          if (activeAstraCandidate?.wrap === wrap) activeAstraCandidate = null
          return
        }
        if (!readValue) clearServiceUnavailable()
        if (!owned()) {
          invalidateNotApplied()
          return
        }
        await session.showDocumentCandidate(source, fetched, () => ownsAttempt(seq) && owned())
        if (!ownsAttempt(seq)) {
          inFlight = false
          session.clearDocumentCandidate()
          if (activeAstraCandidate?.wrap === wrap) activeAstraCandidate = null
          return
        }
        if (!owned()) {
          invalidateNotApplied()
          return
        }
        readValue = fetched
      } catch (error) {
        readValue = null
        if (!ownsAttempt(seq)) {
          if (seq === activeSeq) {
            inFlight = false
            if (activeAstraCandidate?.wrap === wrap) activeAstraCandidate = null
          }
          return
        }
        inFlight = false
        if (['candidate_expired', 'stale_revision', 'unsupported_input', 'resource_limit', 'artifact_integrity_failed', 'invalid_request'].includes(error.code)) {
          settled = true
          activeSeq += 1
          wrap.handleAstraFlowAction = () => {}
          try { await assistant.documentCandidate(documentRequest(candidate, operationId, 'discard'), source.projectId) } catch { /* The bounded cache expires independently. */ }
          session.clearDocumentCandidate()
          if (activeAstraCandidate?.wrap === wrap) activeAstraCandidate = null
          if (inThread()) {
            renderRunResult(wrap, { title: 'Not applied', body: 'The canvas changed or the result was rejected before it could be read. Nothing from this result was saved; send the request again.', tone: 'warning' })
          }
          return
        }
        if (!owned()) {
          invalidateNotApplied()
          return
        }
        if (error.code === 'assistant_service_unavailable') notifyServiceUnavailable({ stage: 'post_result' })
        activeAstraCandidate = { wrap, saving: false, reading: false, recovering: true, abortByProjectSwitch }
        wrap.handleAstraFlowAction = act => {
          if (act === 'recover' && !settled && !inFlight && !activeAstraCandidate?.saving && !activeAstraCandidate?.reading) void readAndApply(true)
        }
        updateAstraFlowCard(wrap, {
          title: 'Result could not be read yet',
          body: 'The result could not be read yet and was not applied. Restart the service, then reload or retry the same result; it does not call the model again.',
          tone: 'warning',
          actions: [{ label: 'Retry same result', kind: 'primary', action: 'astra-flow:recover', capability: 'CHAT-01', figma: '2855:2365' }],
        })
        return
      } finally { assistantPreparing = false; updateSend() }
      const before = session.latestUndoEntry?.() || null
      const save = async (fromRecovery = false) => {
        if (settled || activeAstraCandidate?.saving || (fromRecovery && (inFlight || activeAstraCandidate?.reading))) return
        if (!inThread()) {
          abortByProjectSwitch()
          if (activeAstraCandidate?.wrap === wrap) activeAstraCandidate = null
          return
        }
        const saveSeq = fromRecovery ? ++activeSeq : seq
        inFlight = true
        wrap.handleAstraFlowAction = () => {}
        activeAstraCandidate = { wrap, saving: true, reading: false, recovering: false, abortByProjectSwitch }
        updateAstraFlowCard(wrap, { title: 'Applying canvas & timeline changes…', busy: true })
        updateSend()
        try {
          await session.saveDocumentCandidate(source, () => assistant.documentCandidate(documentRequest(candidate, operationId, 'accept'), source.projectId))
          if (!ownsAttempt(saveSeq)) return
          settled = true
          inFlight = false
          activeSeq += 1
          wrap.handleAstraFlowAction = () => {}
          clearServiceUnavailable()
          if (activeAstraCandidate?.wrap === wrap) activeAstraCandidate = null
          if (session.documentCandidate) session.clearDocumentCandidate()
          const after = session.latestUndoEntry?.() || null
          renderRunResult(wrap, { title: 'Canvas & timeline updated', undoEntry: after && after !== before ? after : null, figma: '2949:2780' })
        } catch (error) {
          if (!ownsAttempt(saveSeq)) return
          inFlight = false
          if (['candidate_expired', 'stale_revision', 'unsupported_input', 'resource_limit', 'artifact_integrity_failed', 'invalid_request'].includes(error.code) && !session.documentCandidate?.result) {
            settled = true
            activeSeq += 1
            wrap.handleAstraFlowAction = () => {}
            try { await assistant.documentCandidate(documentRequest(candidate, operationId, 'discard'), source.projectId) } catch { /* The bounded cache expires independently. */ }
            session.clearDocumentCandidate()
            if (activeAstraCandidate?.wrap === wrap) activeAstraCandidate = null
            if (inThread()) {
              renderRunResult(wrap, { title: 'Not applied', body: 'The canvas changed or the result was rejected before it could be saved. Nothing from this result was saved; send the request again.', tone: 'warning' })
            }
            return
          }
          if (error.code === 'assistant_service_unavailable') notifyServiceUnavailable({ stage: 'post_save_unknown' })
          if (activeAstraCandidate?.wrap === wrap) { activeAstraCandidate.saving = false; activeAstraCandidate.reading = false; activeAstraCandidate.recovering = true }
          wrap.handleAstraFlowAction = act => {
            if (act === 'recover' && !settled && !inFlight && !activeAstraCandidate?.saving && !activeAstraCandidate?.reading) void save(true)
          }
          updateAstraFlowCard(wrap, { title: 'Saving needs attention', body: 'The save result or refresh is not confirmed. Resolve this same save before continuing; it does not call the model again.',
            tone: 'warning', actions: [{ label: 'Resolve same save', kind: 'primary', action: 'astra-flow:recover', capability: 'CHAT-01', figma: '2855:2365' }] })
        } finally { updateSend() }
      }
      await save(false)
    }
    await readAndApply(false)
  }
  async function offerDocumentTools(prompt, { fromComposer = false, submittedRef = null, submittedPrompt = prompt } = {}) {
    const token = contextToken(), inputVersion = promptInputVersion, selection = chatContext()
    let source, grant, stopped = false
    const valid = () => !stopped && isCurrentContext(token) && astraDocumentMode && assistant.provider === 'astra' && chatContext() === selection && source?.isSelected()
    try {
      assistantPreparing = true; updateSend()
      source = await session.prepareDocumentEdit()
      grant = await assistant.prepareDocument({
        canvas_id: source.sourceCanvasId,
        expected_revision: source.projectRevision,
        expected_working_revision: source.sourceRevision,
        ...(Array.isArray(source.editableFrameIds) && source.editableFrameIds.length ? { editable_frame_ids: source.editableFrameIds } : {}),
        ...(Array.isArray(source.referenceIds) && source.referenceIds.length ? { reference_ids: source.referenceIds } : {}),
      })
      clearServiceUnavailable()
      if (!valid()) return
    } catch (error) {
      if (isCurrentContext(token)) {
        if (error.code === 'assistant_service_unavailable') notifyServiceUnavailable()
        else appendAssistantNote(error.message || assistantErrorCopy(error.code, 'astra', error.details || error.diagnostic), 'astra')
      }
      return
    }
    finally { assistantPreparing = false; updateSend() }
    // The request is the permission; the scoped grant above binds this canvas and revision.
    if (inputVersion !== promptInputVersion || assistant.busy || session.canPlacePixelDrawing?.() === false) {
      appendAssistantNote('The canvas changed before the change started. Nothing was sent; send the request again.', 'astra'); return
    }
    if (!fromComposer) clearPrompt()
    const userTurn = !fromComposer ? appendUserTurn(prompt, 'astra') : null
    const wrap = openRunTurn('astra')
    wrap.classList?.add?.('is-astra-document')
    assistantContext = selection
    const consumedRef = fromComposer ? submittedRef : session.consumeConversationRef?.()
    const sentReferenceIdentity = referenceIdentity(getDraft?.())
    const sentVersion = promptInputVersion, started = Date.now()
    wrap.handleAstraFlowAction = act => { if (act === 'stop') { stopped = true; wrap.dataset.stopped = 'true'; assistant.stop(); updateAstraFlowCard(wrap, { title: 'Stopped', body: 'Nothing was changed.', frozen: true }); updateSend() } }
    const hasLockedFrames = Array.isArray(grant.locked_frame_ids) && grant.locked_frame_ids.length > 0 && Array.isArray(grant.editable_frame_ids)
    const refProgress = Array.isArray(grant.reference_ids) && grant.reference_ids.length > 0 ? ` · ${countLabel(grant.reference_ids.length, 'reference')}` : ''
    const scopeProgress = hasLockedFrames
      ? `Selected ${countLabel(grant.editable_frame_ids.length, 'frame')} (${countLabel(grant.locked_frame_ids.length, 'frame')} locked) across ${countLabel(grant.layers, 'layer')} of this ${source.width}×${source.height} canvas${refProgress}; locked content stays protected.`
      : `${grant.frames === 1 && grant.layers === 1 ? 'The frame and layer' : `All ${countLabel(grant.frames, 'frame')} and ${countLabel(grant.layers, 'layer')}`} of this ${source.width}×${source.height} canvas${refProgress}; locked content stays protected.`
    updateAstraFlowCard(wrap, { title: 'Changing canvas & timeline…', busy: true, body: scopeProgress,
      actions: [{ label: 'Stop', kind: 'secondary', action: 'astra-flow:stop', capability: 'CHAT-01' }] })
    const timer = setInterval(() => { const title = wrap.querySelector('[data-turn-title]'); if (title) setText(title, `Changing canvas & timeline… (${Math.floor((Date.now() - started) / 1000)}s)`) }, 1000)
    timer.unref?.()
    let result
    try {
      const pending = assistant.send({
        message: prompt,
        revision: source.projectRevision,
        canvasId: source.sourceCanvasId,
        workingRevision: source.sourceRevision,
        width: source.width,
        height: source.height,
        documentMode: true,
        documentGrant: grant.grant_id,
        ...(Array.isArray(source.editableFrameIds) && source.editableFrameIds.length ? { editableFrameIds: source.editableFrameIds } : {}),
        ...(Array.isArray(source.referenceIds) && source.referenceIds.length ? { referenceIds: source.referenceIds } : {}),
      })
      updateSend(); result = await pending; clearInterval(timer)
      clearServiceUnavailable()
    } catch (error) {
      clearInterval(timer)
      if (!isCurrentContext(token)) return
      const input = root.querySelector('#vnext-prompt-input')
      const restore = Boolean(input && !input.value && promptInputVersion === sentVersion && chatContext() === selection
        && referenceIdentity(getDraft?.()) === sentReferenceIdentity)
      if (restore) {
        input.value = submittedPrompt; input.dispatchEvent(new Event('input', { bubbles: true }))
        session.restoreConversationRef?.(consumedRef)
      }
      if (error.code === 'assistant_service_unavailable') {
        removeTurnNode(wrap)
        if (restore && userTurn) removeTurnNode(userTurn)
        notifyServiceUnavailable({ keptAbove: !restore })
        return
      }
      if (!stopped) renderRunResult(wrap, { title: 'Canvas & timeline change stopped', body: error.code === 'unsupported_input' && error.message ? error.message : assistantErrorCopy(error.code, 'astra', error.diagnostic || error.details), tone: 'warning' })
      return
    } finally { clearInterval(timer); assistantContext = null; updateSend() }
    if (!valid()) { renderRunResult(wrap, { title: 'Not applied', body: 'The canvas changed while Astra was working. Nothing was changed.', tone: 'warning' }); return }
    if (!result.document_candidate) { renderRunResult(wrap, { title: 'No changes needed', body: result.reply }); return }
    await applyDocumentInCard({ wrap, source, candidate: result.document_candidate, operationId: result.operation_id, token, isValid: valid })
  }

  async function offerNativePixelTools(prompt, { fromComposer = false, submittedRef = null, submittedPrompt = prompt } = {}) {
    if (activeAstraCandidate) return
    const provider = 'astra', token = contextToken(), selection = chatContext(), inputVersion = promptInputVersion
    const projectId = currentProjectId(), projectRevision = session.project?.revision
    if (session.openInFlight?.()) { appendAssistantNote('Wait for the project to finish opening. Nothing was sent.', provider); return }
    if (session.canPlacePixelDrawing?.() === false) { appendAssistantNote('Finish or resolve the current image save first. Nothing was sent.', provider); return }
    const pixelSelectionSnapshot = session.pixelSelection
    const pixelSelectionRect = session.pixelSelection?.rect ? { ...session.pixelSelection.rect } : null
    const samePixelSelection = () => {
      const cur = session.pixelSelection
      if (Boolean(cur) !== Boolean(pixelSelectionSnapshot)) return false
      if (!cur) return true
      if (cur.projectId !== pixelSelectionSnapshot.projectId || cur.canvasId !== pixelSelectionSnapshot.canvasId) return false
      const r = cur.rect
      return Boolean(r && pixelSelectionRect && r.x === pixelSelectionRect.x && r.y === pixelSelectionRect.y && r.w === pixelSelectionRect.w && r.h === pixelSelectionRect.h)
    }
    let source
    const unchanged = () => isCurrentContext(token) && assistant.provider === provider && chatContext() === selection
      && session.project?.revision === projectRevision && samePixelSelection() && source?.isSelected()
    try {
      assistantPreparing = true; updateSend()
      const hasSelection = Boolean(session.pixelSelection?.projectId === currentProjectId() && session.pixelSelection?.canvasId === session.conversationRef?.canvasId)
      source = await session.preparePixelEdit({
        scopeGrant: hasSelection,
        allowedOperations: hasSelection
          ? ['read_region', 'patch_region', 'read_canvas', 'draw_pixels', 'undo_pixels', 'pixel_tools', 'replace-color', 'fill-rect', 'erase', 'pencil', 'eraser', 'line', 'rectangle', 'flood-fill']
          : null,
      })
      if (!unchanged()) return
      if (source.width !== 64 || source.height !== 64 || source.multiCel || source.linkScope || source.previewPixels) {
        throw new Error('Select one visible, unlocked 64×64 image with one frame and one layer. Nothing was sent.')
      }
      if (hasSelection && (!source.allowedRect || !source.grantId)) {
        throw new Error('The selected region could not be authorized. Select the region again. Nothing was sent.')
      }
    } catch (error) {
      if (isCurrentContext(token)) {
        if (error.code === 'assistant_service_unavailable') notifyServiceUnavailable()
        else appendAssistantNote(error.message || 'Select a 64×64 canvas first. Nothing was sent.', provider)
      }
      return
    } finally { assistantPreparing = false; updateSend() }
    const rect = source.allowedRect
    let allowedColors
    if (rect && source.grantId) {
      const seenColors = new Set()
      if (source.rgba instanceof Uint8Array) {
        for (let y = rect.y; y < rect.y + rect.h; y += 1) {
          for (let x = rect.x; x < rect.x + rect.w; x += 1) {
            const i = (y * source.width + x) * 4
            seenColors.add(`${source.rgba[i]},${source.rgba[i + 1]},${source.rgba[i + 2]},${source.rgba[i + 3]}`)
          }
        }
      }
      allowedColors = []
      for (const match of String(prompt || '').matchAll(/#([0-9a-fA-F]{6})\b/g)) {
        const hex = match[1]
        const tuple = [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16), 255]
        const key = `${tuple[0]},${tuple[1]},${tuple[2]},${tuple[3]}`
        if (!seenColors.has(key)) {
          seenColors.add(key)
          allowedColors.push(tuple)
        }
      }
      if (seenColors.size > 62) {
        appendAssistantNote(assistantErrorCopy('assistant_context_changed', provider, { reason: 'unsupported', rule: 'codebook_limit' }), provider)
        return
      }
      const pushOptionalColor = (c) => {
        if (!Array.isArray(c) || c.length !== 4 || (c[3] !== 0 && c[3] !== 255)) return
        const key = `${c[0]},${c[1]},${c[2]},${c[3]}`
        if (seenColors.has(key) || seenColors.size >= 62) return
        seenColors.add(key)
        allowedColors.push([c[0], c[1], c[2], c[3]])
      }
      pushOptionalColor([0, 0, 0, 0])
      for (const color of session.project?.palette?.colors || []) pushOptionalColor(color)
    }
    const scopeDesc = rect
      ? `the selected region (${rect.x}, ${rect.y}, ${rect.w}×${rect.h}) of this 64×64 canvas`
      : 'this 64×64 canvas'
    // The request is the permission: run now. The scope grant minted above still bounds the tools.
    const executeNativePixelTools = async () => {
      if (!unchanged() || assistant.busy || activeAstraCandidate || session.openInFlight?.() || session.canPlacePixelDrawing?.() === false || inputVersion !== promptInputVersion) {
        appendAssistantNote('The selection or project changed before drawing started. Nothing was sent; send the request again.', provider)
        updateSend()
        return
      }
      const userTurn = !fromComposer ? appendUserTurn(prompt, provider) : null
      const wrap = openRunTurn(provider)
      if (!fromComposer) clearPrompt()
      const consumedRef = fromComposer ? submittedRef : session.consumeConversationRef?.()
      const sentReferenceIdentity = referenceIdentity(getDraft?.())
      assistantContext = selection
      const sentInputVersion = promptInputVersion
      const startedAt = Date.now()
      const runningBody = `On ${scopeDesc}.`
      let stoppedByUser = false
      wrap.handleAstraFlowAction = (act) => {
        if (act === 'stop') {
          stoppedByUser = true
          assistant.stop()
          updateSend()
        }
      }
      updateAstraFlowCard(wrap, {
        title: 'Drawing…',
        body: runningBody,
        busy: true,
        actions: [
          {
            label: 'Stop',
            kind: 'secondary',
            action: 'astra-flow:stop',
            capability: 'CHAT-01',
            figma: '2855:2257',
            title: 'Stop waiting for this drawing',
          },
        ],
      })
      const waitTimer = setInterval(() => {
        if (!assistant.busy || !isCurrentContext(token)) return
        const sec = Math.max(1, Math.floor((Date.now() - startedAt) / 1000))
        const titleNode = wrap.querySelector('[data-turn-title]')
        if (titleNode) setText(titleNode, `Drawing… (${sec}s)`)
      }, 1000)
      waitTimer.unref?.()
      let result
      try {
        const pending = assistant.send({ message: prompt, revision: source.projectRevision, canvasId: source.sourceCanvasId,
          workingRevision: source.sourceRevision, width: 64, height: 64, pixelTools: true,
          ...(source.grantId ? { grantId: source.grantId } : {}),
          ...(rect && source.grantId ? { allowedRect: rect, allowedColors } : {}) })
        updateSend()
        result = await pending
        clearInterval(waitTimer)
        clearServiceUnavailable()
        updateSend()
      } catch (error) {
        clearInterval(waitTimer)
        if (isCurrentContext(token) && assistant.provider === provider) {
          const input = root.querySelector('#vnext-prompt-input')
          const restore = selection === chatContext() && promptInputVersion === sentInputVersion && input?.value === '' && error.code !== 'assistant_context_changed' && referenceIdentity(getDraft?.()) === sentReferenceIdentity
          if (restore) { input.value = submittedPrompt; input.dispatchEvent(new Event('input', { bubbles: true })); session.restoreConversationRef?.(consumedRef) }
          if (error.code === 'assistant_service_unavailable') {
            removeTurnNode(wrap)
            if (restore && userTurn) removeTurnNode(userTurn)
            notifyServiceUnavailable({ keptAbove: !restore })
            return
          }
          const isAbort = stoppedByUser || error.name === 'AbortError' || error.code === 'assistant_cancelled'
          const isContextChanged = error.code === 'assistant_context_changed' && !error.diagnostic
          let note = isAbort
            ? 'No pixels were saved; no automatic retry. A request already started may still count toward usage.'
            : isContextChanged
              ? (error.message || 'The canvas changed. No pixels were saved.')
              : assistantErrorCopy(error.code, provider, error.diagnostic)
          if (!restore) {
            note = note
              .replace('Draft kept.', 'Original message kept above; current draft unchanged.')
              .replace('Draft kept;', 'Original message kept above; current draft unchanged;')
          }
          renderRunResult(wrap, {
            title: isAbort ? 'Drawing stopped' : isContextChanged ? 'Not applied' : 'Astra drawing failed',
            body: note,
            tone: isAbort ? undefined : 'warning',
            figma: isAbort ? '2855:2360' : null,
          })
        }
        return
      } finally {
        clearInterval(waitTimer)
        if (isCurrentContext(token)) { assistantContext = null; updateSend() }
      }
      if (!unchanged()) {
        if (isCurrentContext(token)) {
          renderRunResult(wrap, {
            title: 'Not applied',
            body: 'The canvas, selection or project changed while Astra was drawing. No pixels were saved; send the request again.',
            tone: 'warning',
          })
        }
        return
      }
      await applyAstraCandidateInCard({
        wrap,
        source,
        rgba: result.pixelCandidateBytes,
        candidate: result.pixel_candidate,
        token,
        saveOperationId: result.operation_id,
        isStillValid: unchanged,
        reply: result.reply,
      })
      if (isCurrentContext(token)) { assistantContext = null; updateSend() }
    }
    await executeNativePixelTools()
  }

  // Applies a native-tool result the user asked for: the same hash, scope and revision checks
  // as before, then the normal receipt-guarded save. Blank and derived canvases change in place;
  // imported originals get an editable copy beside them. Undo is the optional follow-up.
  async function applyAstraCandidateInCard({ wrap, source, rgba, candidate, token, saveOperationId = null, isStillValid, reply = '' }) {
    const before = session.latestUndoEntry?.() || null
    const scopeRect = candidate?.allowed_rect || source.allowedRect || null
    const regionLabel = scopeRect && (scopeRect.x !== 0 || scopeRect.y !== 0 || scopeRect.w !== 64 || scopeRect.h !== 64)
      ? `Region (${scopeRect.x}, ${scopeRect.y}, ${scopeRect.w}×${scopeRect.h})` : 'Full 64×64 canvas'
    const preview = rgbaPreview(rgba, 64)
    let recoveryDone = null, finishRecovery = null
    activeAstraCandidate = { wrap, saving: true, recovering: false, abortByProjectSwitch: () => finishRecovery?.(null) }
    updateAstraFlowCard(wrap, { title: 'Applying the drawing…', busy: true, body: `${regionLabel}. Saving now.`, fields: preview ? [preview] : [] })
    updateSend()
    try {
      let result = await session.reviewNativePixelCandidate(source, rgba, candidate, {
        saveOperationId,
        checkCurrent: async () => {
          if (!isStillValid() || session.pixelCopyPending) throw Object.assign(new Error('The canvas changed. No pixels were saved.'), { code: 'assistant_context_changed' })
        },
        renderRecovery: notice => {
          if (!isCurrentContext(token)) return
          recoveryDone ||= new Promise(resolve => { finishRecovery = resolve })
          const show = (busy = false, error = '') => updateAstraFlowCard(wrap, {
            title: busy ? 'Resolving the save…' : notice.title,
            body: `${notice.body}${error ? ` ${error}` : ''} Resolve this save before sending another message.`,
            tone: busy ? undefined : 'warning',
            fields: preview ? [preview] : [],
            actions: [{ label: busy ? 'Working…' : notice.primary, kind: 'primary', action: 'astra-flow:recover', capability: 'CHAT-01', figma: '2855:2365', disabled: busy }],
          })
          activeAstraCandidate = { wrap, saving: false, recovering: true, abortByProjectSwitch: () => finishRecovery(null) }
          wrap.handleAstraFlowAction = async act => {
            if (act !== 'recover' || activeAstraCandidate?.wrap !== wrap || activeAstraCandidate.saving || !isCurrentContext(token)) return
            activeAstraCandidate.saving = true
            show(true); updateSend()
            try {
              const resolved = await notice.onPrimary()
              if (!isCurrentContext(token) || activeAstraCandidate?.wrap !== wrap) return
              if (!resolved.pending) finishRecovery({ outcome: /saved|beside the original/i.test(resolved.message) && !/not confirmed|not saved/i.test(resolved.message) ? 'saved' : 'unconfirmed', message: resolved.message })
            } catch (error) {
              if (!isCurrentContext(token) || activeAstraCandidate?.wrap !== wrap) return
              activeAstraCandidate.saving = false
              show(false, error.message || 'The save could not be resolved.'); updateSend()
            }
          }
          show(); updateSend()
        },
      })
      if (recoveryDone) result = await recoveryDone
      if (activeAstraCandidate?.wrap === wrap) activeAstraCandidate = null
      if (!isCurrentContext(token) || !result) return result
      const after = session.latestUndoEntry?.() || null
      const undoEntry = after && after !== before ? after : null
      const lead = reply ? `${reply} ` : ''
      if (result.outcome === 'unchanged') renderRunResult(wrap, { title: 'No pixel changes', body: `${lead}${result.message}` })
      else if (result.outcome === 'copied') renderRunResult(wrap, { title: 'Drawing applied as a copy', body: `${lead}${regionLabel}. The imported original stays unchanged; the editable copy is beside it. Undo removes the copy.`, fields: preview ? [preview] : [], undoEntry })
      else if (result.outcome === 'saved' || result.outcome === 'saved_pending') renderRunResult(wrap, { title: 'Drawing applied', body: `${lead}${regionLabel}.${result.outcome === 'saved_pending' ? ' The canvas is still refreshing.' : ''} Undo restores the previous pixels.`, fields: preview ? [preview] : [], undoEntry })
      else renderRunResult(wrap, { title: 'Save not confirmed', body: `${result.message || 'Check the current save notice.'} No new model request is needed.`, tone: 'warning', fields: preview ? [preview] : [] })
      return result
    } catch (error) {
      if (activeAstraCandidate?.wrap === wrap) activeAstraCandidate = null
      if (isCurrentContext(token)) renderRunResult(wrap, { title: 'Not applied', body: error.code === 'assistant_context_changed' ? 'The canvas changed before the drawing could be saved. No pixels were saved; send the request again.' : (error.message || 'The drawing could not be saved.'), tone: 'warning' })
      return null
    } finally {
      if (activeAstraCandidate?.wrap === wrap) activeAstraCandidate = null
      if (isCurrentContext(token)) updateSend()
    }
  }
  function composerTarget() {
    const canvasId = session?.conversationRef?.canvasId ?? session?.view?.selectedId
    const documentId = session?.project?.canvases?.[canvasId]?.document_id
    const manifest = session?.documents?.get?.(documentId)
    const target = manifest ? session.documentTimeline?.target?.(manifest) : null
    const lockedFrames = manifest ? session.documentTimeline?.lockedFrameIds?.(manifest) : null
    const editableFrames = lockedFrames?.length ? session.documentTimeline?.editableFrameIds?.(manifest) : null
    const referenceIds = session?.activeReferenceIds?.() || []
    const selection = session?.pixelSelection
    return JSON.stringify([canvasId, session?.view?.selectedId, manifest?.revision,
      selection ? [selection.projectId, selection.canvasId, selection.rect] : null,
      target ? [target.frame_id, target.layer_id, target.cel_id] : null,
      ...(editableFrames || referenceIds.length ? [editableFrames || null, referenceIds.length ? referenceIds : null] : [])])
  }

  // One handler per catalog capability; chat and direct controls call the same operations.
  const composerActions = createComposerActionRouter({
    edit_pixels: (action, { options }) => { astraDocumentMode = false; return offerNativePixelTools(action.instruction, options) },
    edit_document: (action, { options }) => { astraDocumentMode = true; return offerDocumentTools(action.instruction, options) },
    draw_pixels: (action, { options }) => offerPixelDrawing(action.instruction, { size: action.size, kind: action.kind, reference: action.reference }, options),
    generate_image: action => offerStaticImage(action.instruction, { reference: action.reference, background: action.background, fromComposer: true }),
    use_preset: (action, { provider }) => {
      if (!applicationPreset(action.preset_id) || getDraft?.()?.skillId !== action.preset_id) {
        appendAssistantNote('This Skill is not selected. Nothing was generated.', provider)
        return null
      }
      return runPreset({ fromComposer: true, prompt: action.instruction, presetId: action.preset_id,
        useReference: action.reference, followUp: canFollowUpPhase(gen.phase), author: ASSISTANT_CHOICES[provider]?.label || null })
    },
  })
  function creativeWorkBusy() {
    return Boolean(activeAstraCandidate || session?.hasPixelDrawingSave?.() || session?.pixelCopyPending || staticImageOpenHere()
      || gen.waiting || gen.autoRun || gen.adding || ['running', 'processing', 'review'].includes(gen.phase))
  }

  async function sendAssistant(draft) {
    if (assistantPreparing) return
    if (session?.hasPixelDrawingSave?.()) {
      const projectId = currentProjectId(), epoch = session.api.openEpoch.current
      const before = session.latestUndoEntry?.() || null
      assistantPreparing = true; updateSend()
      try {
        const result = await session.resolvePixelDrawingSave()
        if (currentProjectId() !== projectId || session.api.openEpoch.current !== epoch) return
        if (result?.canvasId && !result.positionFailed && !result.positionUnknown) completeRecoveredDrawing(projectId, result, before)
      } catch { appendAssistantNote('The drawing save still needs attention. No model request was sent.', results.peek(`drawing:${projectId}`)?.provider || assistant.provider || 'grok') }
      finally { assistantPreparing = false; updateSend() }
      return
    }
    if (session?.pixelCopyPending) { session.resolvePixelCopy?.(); return }
    if (assistant.busy) { assistant.stop(); updateSend(); return }
    const originalPrompt = String(draft.prompt ?? '')
    const prompt = originalPrompt.trim()
    if (!prompt || !session?.project || assistant.blocked || isServiceOffline()) return
    const token = contextToken(), selected = chatContext(), provider = assistant.provider || 'grok'
    const submittedTarget = composerTarget()
    assistantContext = selected
    const userTurn = appendUserTurn(prompt, provider)
    clearPrompt()
    const sentInputVersion = promptInputVersion
    let consumedRef = null, sentReferenceIdentity = referenceIdentity(getDraft?.())
    let result
    try {
      if (!isCurrentContext(token) || selected !== chatContext()) return
      consumedRef = session.consumeConversationRef?.()
      sentReferenceIdentity = referenceIdentity(getDraft?.())
      const pending = assistant.send({ message: prompt, revision: session.project.revision,
        canvasId: session.conversationRef?.canvasId ?? null, composerActions: true, composerPresetId: draft.skillId || null,
        composerWorkflow: COMPOSER_WORKFLOW_PHASES.includes(gen.phase) ? gen.phase : 'unknown' })
      updateSend()
      result = await pending
      clearServiceUnavailable()
    } catch (error) {
      if (isCurrentContext(token) && provider === (assistant.provider || 'grok')) {
        const input = root.querySelector('#vnext-prompt-input')
        const restore = selected === chatContext() && promptInputVersion === sentInputVersion && input?.value === ''
          && referenceIdentity(getDraft?.()) === sentReferenceIdentity
        if (restore) {
          input.value = originalPrompt
          input.dispatchEvent(new Event('input', { bubbles: true }))
          session.restoreConversationRef?.(consumedRef)
        }
        if (error.code === 'assistant_service_unavailable') {
          if (restore && userTurn) removeTurnNode(userTurn)
          notifyServiceUnavailable({ keptAbove: !restore })
          return
        }
        // A stopped fetch rejects with a DOMException whose code is numeric (20), not a string.
        assistantNote = typeof error.code === 'string' && error.code.startsWith('pixel_') ? error.message
          : error.name === 'AbortError' ? assistantCopy(provider, astraDocumentMode).interrupted : assistantErrorCopy(error.code, provider)
        if (!restore) assistantNote = assistantNote.replace('Draft kept.', 'Original message kept above; current draft unchanged.')
        // A stopped reply that paused the channel is explained once, by the paused note with
        // Continue here (syncPausedChannel); a second "result unknown" line would repeat it.
        if (!(error.name === 'AbortError' && assistant.interrupted)) appendAssistantNote(assistantNote, provider)
      }
      return
    } finally {
      assistantPreparing = false
      if (isCurrentContext(token)) { assistantContext = null; updateSend() }
    }
    try {
      if (!isCurrentContext(token) || selected !== chatContext()) return
      assistantContext = null
      // Native document operations report their outcome through the host result card.
      // The model's operational commentary is not a user-facing chat answer.
      if (result.composer_action?.type !== 'edit_document') appendAssistantNote(result.reply, provider)
      if (result.composer_notice === 'preset_unavailable') appendAssistantNote(COPY.presetUnavailable, provider, { tone: 'warning' })
      const action = result.composer_action
      if (action) {
        // The request authorizes the action; only a context that moved while the model decided stops it.
        if (promptInputVersion !== sentInputVersion || referenceIdentity(getDraft?.()) !== sentReferenceIdentity || composerTarget() !== submittedTarget
          || (getDraft?.()?.skillId || null) !== (draft.skillId || null)) {
          appendAssistantNote('The selection or attachment changed while the reply was being written, so nothing was run. Send the request again for the current selection.', provider)
        } else if (session?.openInFlight?.()) {
          appendAssistantNote('Wait for the project to finish opening, then send the request again. Nothing was run.', provider)
        } else if (creativeWorkBusy()) {
          appendAssistantNote('The previous result is still being made or saved. Send this again when it finishes. Nothing new was run.', provider)
        } else {
          const { handled } = await composerActions.run(action, { provider, selectedPresetId: draft.skillId || null,
            options: { fromComposer: true, submittedRef: consumedRef, submittedPrompt: originalPrompt } })
          if (!handled) appendAssistantNote(`${ASSISTANT_CHOICES[provider]?.label || 'This model'} cannot run that here. Nothing was run.`, provider)
        }
      }
      if (!isServiceOffline()) assistantNote = assistantCopy(provider, astraDocumentMode).completed
    } finally {
      assistantPreparing = false
      if (isCurrentContext(token)) { assistantContext = null; updateSend() }
    }
  }

  function freezeTurn(node) {
    if (node.dataset.recoveredImage || node === activeAstraCandidate?.wrap || node === activeWorkflowTurn()?.node) return
    node.querySelectorAll('button, input, textarea').forEach((el) => {
      if (el.classList.contains('vnext-msg-more')) return
      // Undo stays an optional follow-up after later messages; undoIfLatest refuses it once anything else changed.
      if (el.dataset?.astraFlow === 'undo' || el.dataset?.astraFlow === 'redo') return
      el.disabled = true
      if (el.id === 'vnext-job-id') el.id = ''
    })
    node.querySelectorAll('.vnext-workflow-card').forEach((card) => {
      card.classList?.add?.('is-past')
    })
  }

  function freezePastTurns() {
    for (const turn of gen.thread) freezeTurn(turn.node)
  }

  function scrollThread() {
    host.scrollTop = host.scrollHeight
  }

  function layoutActionRows() {
    host.querySelectorAll('.vnext-workflow-actions').forEach((actions) => {
      const buttons = [...actions.querySelectorAll(':scope > .vnext-text-btn')]
      actions.classList?.remove?.('is-stacked')
      if (buttons.length < 2) return
      const gap = Number.parseFloat(getComputedStyle(actions).gap) || 8
      let need = gap * (buttons.length - 1)
      for (const btn of buttons) need += btn.getBoundingClientRect().width
      if (need > actions.clientWidth + 0.5) actions.classList.add('is-stacked')
    })
  }

  async function readJobPrompt(job) {
    const id = normalizeJobId(job?.id)
    const listed = [job?.prompt_url, job?.generation_prompt_url]
    if (isUsableJobId(id)) listed.push(`/generated/${id}/prompt.txt`)
    for (const url of listed) {
      if (!isGeneratedArtifactUrl(url, id, 'prompt.txt')) continue
      try {
        const response = await fetch(url)
        if (!response.ok) continue
        const text = String(await response.text()).trim()
        if (text) return text
      } catch {
        continue
      }
    }
    return String(job?.description || job?.prompt || '').trim()
  }

  // request: the user's sealed request text when it is known (a job rebuilt from its saved files),
  // shown instead of the composed generation prompt.
  async function seedConversation(job, token = null, request = '') {
    if (gen.thread.length) return
    const prompt = String(request || '').trim() || await readJobPrompt(job)
    if (token && !isCurrentContext(token)) return
    if (!prompt) return
    appendUserTurn(prompt)
  }

  function activeWorkflowTurn() {
    if (gen.phase === 'idle') return null
    const turn = [...gen.thread].reverse().find(item => item.role === 'assistant' && !item.provider
      && !item.management && !item.node.classList.contains('is-text-reply'))
    return turn?.key === turnKey(gen) ? turn : null
  }
  // The newest turn of the conversation, ignoring management notes.
  function latestTurnNode() {
    for (let i = gen.thread.length - 1; i >= 0; i -= 1) {
      if (!gen.thread[i]?.management) return gen.thread[i]?.node || null
    }
    return null
  }
  function lastInteractiveTurnNode() {
    if (activeAstraCandidate) return activeAstraCandidate.wrap
    if (activeWorkflowTurn()) return activeWorkflowTurn().node
    for (let i = gen.thread.length - 1; i >= 0; i -= 1) {
      if (!gen.thread[i]?.management) return gen.thread[i]?.node || null
    }
    return null
  }

  // Replies, questions and routine notices are plain conversational text under the author label.
  function appendAssistantNote(text, provider = null, { management = false, tone, figma = null } = {}) {
    if (!management) freezePastTurns()
    const wrap = document.createElement('div')
    wrap.className = 'vnext-turn is-assistant is-text-reply'
    groupWithPrevious(wrap, gen.thread.at(-1)?.node, ASSISTANT_CHOICES[provider]?.label)
    renderPlainTurn(wrap, {
      figma: figma || '2855:2210',
      capability: 'CHAT-01',
      author: ASSISTANT_CHOICES[provider]?.label,
      title: text,
      tone,
    })
    host.append(wrap)
    gen.thread.push({
      role: 'assistant',
      key: `note:${gen.thread.length}`,
      node: wrap,
      provider,
      ...(management ? { management: true } : {}),
    })
    layoutActionRows()
    scrollThread()
    return wrap
  }

  function appendUserTurn(text, provider = null, { beforeNode = null, management = false } = {}) {
    const last = activeWorkflowTurn() || gen.thread[gen.thread.length - 1]
    if (!beforeNode && last?.role === 'user' && last.text === text && last.provider === provider) return last.node
    if (beforeNode) {
      for (const turn of gen.thread) {
        if (turn.node !== beforeNode) freezeTurn(turn.node)
      }
    } else if (!management) {
      freezePastTurns()
    }
    const wrap = document.createElement('div')
    wrap.className = 'vnext-turn is-user'
    const card = document.createElement('article')
    card.className = 'vnext-workflow-card vnext-msg is-user'
    const role = document.createElement('span')
    role.className = 'vnext-msg-role'
    setText(role, 'You')
    const body = document.createElement('p')
    body.className = 'vnext-user-text vnext-msg-text'
    setText(body, text)
    card.append(body)
    wrap.append(role, card)
    const entry = { role: 'user', key: 'user', text, node: wrap, provider, management }
    const beforeThreadIdx = beforeNode ? gen.thread.findIndex((t) => t.node === beforeNode) : -1
    if (beforeNode && beforeThreadIdx >= 0) {
      if (typeof host.insertBefore === 'function' && beforeNode.parentNode === host) {
        host.insertBefore(wrap, beforeNode)
      } else if (Array.isArray(host.children)) {
        const domIdx = host.children.indexOf(beforeNode)
        if (domIdx >= 0) {
          wrap.parentNode = host
          host.children.splice(domIdx, 0, wrap)
        } else {
          host.append(wrap)
        }
      } else {
        host.append(wrap)
      }
      gen.thread.splice(beforeThreadIdx, 0, entry)
    } else {
      host.append(wrap)
      gen.thread.push(entry)
    }
    const schedule = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (fn) => setTimeout(fn, 0)
    schedule(() => {
      body.classList.add('is-clamped')
      if (body.scrollHeight <= body.clientHeight + 1) {
        body.classList.remove('is-clamped')
        return
      }
      const more = document.createElement('button')
      more.type = 'button'
      more.className = 'vnext-msg-more'
      more.textContent = 'View more'
      more.addEventListener('click', () => {
        const clamped = body.classList.toggle('is-clamped')
        more.textContent = clamped ? 'View more' : 'View less'
      })
      card.append(more)
    })
    scrollThread()
    return wrap
  }

  // A preset turn's Undo answers on that turn after later messages and reverts exactly the
  // placement it was rendered for, even when a newer run has started since.
  function bindPresetTurn(node, model, own = gen.placementUndo) {
    const placement = model.actions?.some(action => action.action === 'astra-flow:undo' || action.action === 'astra-flow:redo') ? own : null
    node.handleAstraFlowAction = placement ? act => {
      if (act === 'undo') void undoPlacement(placement)
      else if (act === 'redo') void redoPlacement(placement)
    } : null
    bindFlowButtons(node)
    if (placement && !placement.repaint) {
      // After later messages this card still answers for its own placement: an Undo / Redo (its own
      // or ⌘Z / ⌘⇧Z) re-renders it from where that placement is now (see repaintPastPlacements).
      const state = { ...gen, addedKeys: new Set(gen.addedKeys), thread: undefined }
      placement.repaint = () => {
        if (!node.isConnected && node.isConnected !== undefined) return
        const undo = results.settle(placement)
        const next = generationViewModel({ ...state, placementUndo: undo, adding: false, reloadingSheet: false, reloadFailed: false, error: null,
          restorable: false, restoring: false, restoreNote: null, // Put back belongs to the current turn only
          placement: currentPlacement(state.job?.id, placement.documentId), canRedo: Boolean(undo && results.canRedo(undo.entry)) })
        renderTurn(node, next)
        bindPresetTurn(node, next, undo)
        if (node !== lastInteractiveTurnNode()) freezeTurn(node)
      }
      // One placement answers for a card: a newer one bound to the same card (after Put back) replaces it.
      placement.node = node
      for (const other of pastPlacements) if (other.node === node) pastPlacements.delete(other)
      pastPlacements.add(placement)
    }
  }
  // Placements of earlier preset turns. The current turn renders with render(), which also shows what
  // only it offers (Put back), so a placement bound to that card never repaints it.
  const pastPlacements = new Set()
  function repaintPastPlacements() {
    const current = gen.phase !== 'idle' || gen.error ? gen.thread.find(item => item.role === 'assistant' && item.key === turnKey(gen))?.node || null : null
    for (const placement of pastPlacements) if (placement !== gen.placementUndo && (!current || placement.node !== current)) placement.repaint?.()
  }

  function render() {
    gen.projectId = currentProjectId()
    gen.projectChanging = Boolean(session?.openInFlight?.()) // Add to canvas waits while another project opens or is created
    if (gen.phase === 'idle' && !gen.error) {
      updateSend()
      return
    }
    gen.jobInProject = gen.phase === 'ready' && jobInProject(gen.job)
    if (gen.phase === 'ready') {
      // The placement's Undo follows its history entry (⌘Z / ⌘⇧Z included); placement follows the canvas.
      gen.placementUndo = results.settle(gen.placementUndo)
      const saved = gen.savedPlacement?.key === `${currentProjectId()}|${gen.job?.id}` ? gen.savedPlacement : null
      gen.placement = currentPlacement(gen.job?.id, saved?.result?.document?.document_id || saved?.result?.receipt?.document_id || null)
      gen.reloadPendingKey = gen.savedPlacement?.key || null
      gen.canRedo = Boolean(gen.placementUndo && results.canRedo(gen.placementUndo.entry))
      gen.restorable = Boolean(gen.job?.id && session?.undonePlacementFor?.({ projectId: currentProjectId(), jobId: gen.job.id,
        documentId: saved?.result?.document?.document_id || saved?.result?.receipt?.document_id || gen.placementUndo?.documentId || null }))
    }
    const model = generationViewModel(gen)
    const key = turnKey(gen)
    const turn = gen.thread.find(item => item.role === 'assistant' && item.key === key)
    let node = turn?.node
    if (node) {
      renderTurn(node, model)
      bindPresetTurn(node, model)
      // Re-rendering an earlier run's turn must not bring back controls a later message froze.
      if (node !== lastInteractiveTurnNode()) freezeTurn(node)
    } else {
      freezePastTurns()
      node = document.createElement('div')
      node.className = 'vnext-turn is-assistant is-preset-run'
      groupWithPrevious(node, gen.thread.at(-1)?.node, model.author)
      renderTurn(node, model)
      bindPresetTurn(node, model)
      host.append(node)
      gen.thread.push({ role: 'assistant', key, node })
    }
    if (!model.busy) announce(model.title)
    syncCandidateCanvas()
    updateSend()
    const input = node.querySelector('#vnext-job-id')
    if (input) {
      input.addEventListener('input', () => {
        gen.jobIdDraft = input.value
      })
    }
    scrollThread()
    layoutActionRows()
  }

  // A polite announcement of a finished run (progress updates are not announced).
  function announce(text) {
    const status = root.querySelector('#vnext-run-status')
    if (!status || !text || text === announced) return
    announced = text
    status.textContent = text
  }

  let fittedCandidateId = null
  // Each start or end of a run's temporary preview moves this epoch, so an image-size callback
  // from an earlier preview can never recreate or select a candidate afterwards.
  let previewEpoch = 0
  function setPreviewLive(value) {
    gen.previewLive = Boolean(value)
    previewEpoch += 1
    // A run the user asked for owns the selection it started with (see finishPlacement).
    if (gen.previewLive) gen.runSelection = session?.view?.selectedId || null
  }
  // A confirmed placement ends the run's temporary candidate: the transient goes away for good
  // (re-renders, Undo and late image loads do not bring it back).
  function endPreview() {
    setPreviewLive(false)
    fittedCandidateId = null
    session?.view?.setTransients?.([])
    session?.renderCanvas?.()
  }

  function naturalSize(url) {
    return new Promise((resolve) => {
      if (typeof Image !== 'function') {
        resolve(null)
        return
      }
      const image = new Image()
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
      image.onerror = () => resolve(null)
      image.src = url
    })
  }

  function syncCandidateCanvas() {
    const token = contextToken()
    const view = session?.view
    // Only a run asked for on this page shows its image on the canvas; a restored job never
    // previews, selects or refits anything on its own, and a sheet the project already holds is
    // never shown again as a candidate.
    const previewing = () => gen.previewLive && !(gen.phase === 'ready'
      && (jobInProject(gen.job) || gen.addedKeys.has(`${currentProjectId()}|${gen.job?.id}`)))
    const item = renderCandidatePreview(root, previewing() ? gen : { ...gen, phase: 'idle' }, view)
    session?.renderCanvas?.()
    session?.renderObjectPreview?.()
    if (!item?.previewUrl) {
      fittedCandidateId = null
      return
    }
    const current = view?.canvases?.find((canvas) => canvas.id === item.id)
    if (current?.width && current?.height) return
    const phase = gen.phase
    const jobId = gen.job?.id
    const previewUrl = item.previewUrl
    const epoch = previewEpoch
    naturalSize(previewUrl).then((size) => {
      if (!isCurrentContext(token) || !size || gen.job?.id !== jobId || gen.phase !== phase) return
      if (epoch !== previewEpoch || !previewing()) return // that preview has ended (placed, released or replaced)
      if (displayJobImageUrl(gen.job, phase) !== previewUrl) return
      if (!view.canvases?.some(canvas => canvas.id === item.id && canvas.transient)) return // its transient is gone
      const next = candidateTransientCanvas(gen.job, size, phase)
      if (!next) return
      view.setTransients([next])
      // The temporary candidate sits in free space beside the stored canvases, never on top of them.
      try {
        const at = staticImagePosition(view, null, { canvasId: next.id, width: size.width, height: size.height })
        view.moveDraft?.(next.id, at.x, at.y)
      } catch { /* no free spot found: it stays at the origin until placed */ }
      // The candidate is selected only when nothing else (or the candidate itself) is selected.
      if (!view.selectedId || view.selectedId === item.id) view.select(item.id)
      if (fittedCandidateId !== item.id) {
        fittedCandidateId = item.id
        const box = root.querySelector('#vnext-canvas-stage')?.getBoundingClientRect()
        view.fitAll(box?.width || 800, box?.height || 600)
      }
      session?.renderCanvas?.()
      session?.renderObjectPreview?.()
    })
  }

  function referenceIdentity(draft) {
    const ref = draft?.reference
    if (!ref) return ''
    return [ref.objectUrl, ref.name, ref.mimeType, ref.size, ref.lastModified].map((value) => String(value ?? '')).join('|')
  }

  function draftKey(draft) {
    return `${String(draft?.skillId ?? '')}\n${String(draft?.prompt ?? '').trim()}\n${referenceIdentity(draft)}`
  }

  function draftChangedSince(snapshot) {
    const live = typeof getDraft === 'function' ? getDraft() : {}
    if (String(live?.skillId ?? '') !== String(snapshot?.skillId ?? '')) return true
    if (referenceIdentity(live) !== referenceIdentity(snapshot)) return true
    const livePrompt = String(live?.prompt ?? '').trim()
    if (!livePrompt && gen.promptCleared) return false
    return livePrompt !== String(snapshot?.prompt ?? '').trim()
  }

  function reviewedDraftStillCurrent() {
    // A resolved request is frozen at send time; later composer edits are a new message, not a cancel.
    return Boolean(gen.reviewedSnapshot) && (gen.reviewedSnapshot.frozen === true || !draftChangedSince(gen.reviewedSnapshot))
  }

  let clearingPrompt = false

  function clearPrompt() {
    const input = root.querySelector('#vnext-prompt-input')
    if (!input) return
    clearingPrompt = true
    try {
      gen.promptCleared = true
      input.value = ''
      input.scrollTop = 0
      input.dispatchEvent(new Event('input', { bubbles: true }))
    } finally {
      clearingPrompt = false
    }
  }

  async function referenceForFollowUp(draft) {
    const fromDraft = await referenceFromDraft(draft)
    if (fromDraft) return fromDraft
    const url = displayJobImageUrl(gen.job, gen.phase) || candidateImageUrl(gen.job)
    if (!url) return null
    const bytes = await api.downloadUrl(url)
    return {
      base64: bytesToBase64(bytes),
      mimeType: 'image/png',
      name: 'current.png',
    }
  }

  async function watchStartedJob(started, token, waitId) {
    if (!waitStillOwned(token, waitId)) return
    gen.job = started
    gen.jobIdDraft = started.id
    gen.runJobId = started.id // the job this run started (a follow-up keeps the previous result in gen.job until now)
    writeLastJobId(started.id)
    rememberJobAuthor(started.id, gen.runAuthor)
    rememberJobRun(started.id)
    for (let i = 0; i < 240 && gen.waiting && waitStillOwned(token, waitId); i += 1) {
      const job = await api.getJob(started.id)
      if (!waitStillOwned(token, waitId) || !gen.waiting) return
      gen.job = job
      const kind = classifyAfterGenerate(job)
      if (kind === 'missing') {
        // The service lost this job (for example it restarted): checking its Job ID continues it
        // from its saved files if it finished; nothing is generated again.
        gen.job = null
        gen.phase = 'idle'
        gen.error = COPY.jobGoneBody
        gen.waiting = false
        render()
        return
      }
      if (kind !== 'running') {
        gen.phase = kind
        gen.waiting = false
        render()
        return
      }
      render()
      await wait(500)
    }
    if (gen.waiting && waitStillOwned(token, waitId)) {
      gen.phase = 'idle'
      gen.error = COPY.recoveryBody
    }
  }

  // The provider-free plan check that binds the one live call (prompt, profile, reference hashes).
  // A model-resolved request passes its instruction and stays frozen; a direct control reads the draft.
  // followUp reuses the current result image as the reference, as the follow-up flow always has.
  async function runReview({ fromComposer = false, useReference = null, prompt: requested = null, presetId = null, followUp = false, author = null } = {}) {
    if (gen.waiting) return false
    const draft = typeof getDraft === 'function' ? getDraft() : {}
    const skillId = presetId || draft.skillId
    const prompt = String(requested ?? draft.prompt ?? '').trim()
    if (!applicationPreset(skillId)) {
      gen.error = COPY.needSkill
      render()
      return false
    }
    if (!prompt) {
      gen.error = COPY.needPrompt
      render()
      return false
    }
    const frozen = requested !== null
    const snapshot = { ...draft, skillId, prompt }
    const snapshotKey = draftKey(snapshot)
    const token = contextToken()
    // Like the live call and processing, the plan check owns one wait epoch: Stop, a manual query
    // or a newer run moves it, and a late reply then writes nothing and cannot continue its run.
    const waitId = ++waitEpoch
    const owned = () => waitStillOwned(token, waitId)
    if (!fromComposer) appendUserTurn(prompt)
    if (!frozen) clearPrompt()
    gen.runSerial += 1 // a new run gets its own turn
    // A run without a model author (the composer's direct preset send) is credited to its preset.
    gen.runAuthor = author || applicationPreset(skillId)?.name || null
    gen.lastRequest = { prompt, presetId: skillId, useReference, followUp, author, projectId: currentProjectId() }
    gen.runJobId = null
    announced = ''
    gen.planChecking = true // Stop before the live call reports that nothing was generated
    setPreviewLive(true) // a run the user asked for may show its result on the canvas
    gen.waiting = true
    gen.review = null
    gen.reviewKey = null
    gen.reviewedSnapshot = null
    gen.promptCleared = !frozen
    gen.phase = 'running'
    gen.job = followUp ? gen.job : null
    gen.error = null
    render()
    try {
      const reference = useReference === false ? null : followUp ? await referenceForFollowUp(snapshot) : await referenceFromDraft(snapshot)
      if (useReference === true && !reference) throw new Error('Attach a reference image before using this preset with a reference. Nothing was generated.')
      if (!owned()) return false
      const review = await api.reviewCharacter({ description: prompt, reference })
      if (!owned()) return false
      gen.review = review
      if (!frozen && draftChangedSince(snapshot)) {
        gen.review = null
        gen.reviewKey = null
        gen.reviewedSnapshot = null
        gen.phase = 'idle'
        gen.error = COPY.reviewGate
        return false
      }
      gen.reviewedSnapshot = { frozen: true, skillId, prompt, reference: snapshot.reference || null }
      gen.reviewKey = snapshotKey
      gen.phase = 'review'
      return true
    } catch (error) {
      if (!owned()) return false
      gen.review = null
      gen.error = presetErrorCopy(error, 'The request could not be checked. Nothing was generated.')
      gen.phase = 'idle'
      return false
    } finally {
      if (owned()) {
        gen.planChecking = false
        gen.waiting = false
        render()
      }
    }
  }

  // A requested preset runs end to end: plan check, the single live call, processing, and
  // placement on a new canvas. Each step keeps its own server binding and recovery; a step
  // that cannot finish leaves the existing recovery card instead of asking for approval.
  async function runPreset(options = {}, { resume = false } = {}) {
    if (gen.waiting || gen.autoRun) return
    if (resume && gen.phase !== 'candidate') return
    const token = contextToken()
    const run = { token }
    gen.autoRun = run
    // Stop waiting, a manual job query or a project change releases the run; a released run never resumes.
    const owned = phase => isCurrentContext(token) && gen.autoRun === run && gen.phase === phase
    try {
      if (resume) setPreviewLive(true)
      else {
        if (!await runReview(options) || !owned('review')) return
        await confirmGenerate()
        if (!owned('candidate')) return
      }
      await adoptAndProcess()
      if (!owned('ready')) return
      await addToCanvas()
    } finally {
      if (gen.autoRun === run) gen.autoRun = null
      if (isCurrentContext(token)) render()
    }
  }

  async function confirmGenerate() {
    if (gen.waiting || !gen.review || !gen.reviewedSnapshot) return
    if (!reviewedDraftStillCurrent()) {
      gen.review = null
      gen.reviewKey = null
      gen.reviewedSnapshot = null
      gen.phase = 'idle'
      gen.error = COPY.reviewGate
      render()
      return
    }
    const token = contextToken()
    const waitId = ++waitEpoch
    gen.waiting = true
    gen.phase = 'running'
    gen.error = null
    render()
    try {
      const started = await api.startGenerate(gen.review)
      if (!waitStillOwned(token, waitId)) return
      await watchStartedJob(started, token, waitId)
    } catch (error) {
      if (!waitStillOwned(token, waitId)) return
      gen.phase = 'idle'
      gen.error = presetErrorCopy(error, COPY.recoveryBody)
    } finally {
      if (waitStillOwned(token, waitId)) {
        gen.waiting = false
        render()
      }
    }
  }

  function jobStillRunning(job) {
    return classifyAfterGenerate(job) === 'running' || classifyGenerationJob(job) === 'running'
  }

  function activeJobInput(turn = null) {
    const latest = lastInteractiveTurnNode()
    const card = turn || latest || null
    if (turn && card !== latest) return null
    return card?.querySelector('#vnext-job-id') || null
  }

  async function queryJob({ silent = false, turn = null } = {}) {
    if (turn && turn !== lastInteractiveTurnNode()) return
    const field = activeJobInput(turn)
    const jobId = normalizeJobId(field ? field.value : gen.jobIdDraft)
    if (!isUsableJobId(jobId)) {
      gen.error = jobId ? COPY.invalidJobId : COPY.missingJobId
      gen.phase = 'idle'
      render()
      return
    }
    const token = contextToken()
    const waitId = ++waitEpoch
    gen.autoRun = null // a manual query takes over; an earlier automatic run never resumes
    setPreviewLive(!silent) // a restored job never previews or selects anything on its own
    // A restored job keeps the author recorded when it ran (or its preset), not a generic label.
    if (silent) gen.runAuthor = gen.runAuthor || readJobAuthor(jobId) || PRESET_AUTHOR
    gen.waiting = true
    gen.error = null
    gen.jobIdDraft = jobId
    gen.runJobId = jobId
    if (!silent) {
      gen.phase = 'running'
      render()
    }
    try {
      for (let i = 0; i < 240 && gen.waiting && waitId === waitEpoch; i += 1) {
        let job = await api.getJob(jobId)
        let sealedRequest = ''
        if (!isCurrentContext(token) || !gen.waiting || waitId !== waitEpoch) return
        if (isJobNotFound(job)) {
          // The local service does not hold this job. A generated sheet whose files are saved is
          // rebuilt and verified from them and can be finished; anything else is reported, never
          // shown as a candidate whose action could not work.
          const restored = await api.restoreGenerationJob(jobId)
          if (!isCurrentContext(token) || !gen.waiting || waitId !== waitEpoch) return
          if (!restored?.job) {
            gen.job = null
            gen.phase = 'idle'
            const run = readJobRun(jobId)
            if (restored?.missing && run?.source && !currentProjectId()) {
              // Checked before any project is shown: whether that project already holds the sheet is not
              // known yet, so nothing is concluded and the Job ID is kept for the check that runs once a
              // project is bound. A manual check says so (a page load just waits).
              gen.error = silent ? null : COPY.jobNeedsProjectBody
              break
            }
            if (restored?.missing && jobInProject({ id: jobId })) {
              // Its sheet is saved in this project: nothing to finish or add again. Whether a canvas
              // shows it decides the wording (an Undo keeps the saved sheet).
              const where = currentPlacement(jobId)
              gen.error = where.known && !where.canvasId ? COPY.jobSavedOffCanvasBody : COPY.jobHeldBody
              forgetLastJobId(jobId)
            } else if (restored?.missing && run?.source) {
              // A lost processing job is checked through the generation job it was finishing.
              gen.error = COPY.jobGoneBody
              gen.jobIdDraft = run.source
              gen.runJobId = run.source
              writeLastJobId(run.source)
            } else {
              // A job started here whose result was never saved is an outcome lost by the service,
              // not an unknown ID.
              gen.error = !restored?.missing ? COPY.jobUnavailableBody : run ? COPY.jobLostBody : COPY.jobNotFoundBody
              forgetLastJobId(jobId)
            }
            break
          }
          job = restored.job
          sealedRequest = restored.description || ''
        }
        gen.job = job
        gen.jobIdDraft = job.id || jobId
        writeLastJobId(gen.jobIdDraft)
        gen.phase = restoreJobPhase(job)
        gen.error = null
        if (gen.thread.length === 0) await seedConversation(job, token, sealedRequest)
        if (!jobStillRunning(job)) break
        render()
        await wait(500)
      }
      if (isCurrentContext(token) && gen.waiting && waitId === waitEpoch && jobStillRunning(gen.job)) {
        gen.phase = 'idle'
        gen.error = COPY.recoveryBody
        gen.waiting = false
      }
    } catch (error) {
      if (!isCurrentContext(token) || !gen.waiting || waitId !== waitEpoch) return
      // The check itself did not complete (no answer, a server error): the job is kept for a retry.
      gen.phase = 'idle'
      gen.error = error?.code === 'invalid_job_id' ? COPY.invalidJobId : COPY.jobLookupBody
    } finally {
      if (isCurrentContext(token) && waitId === waitEpoch) {
        gen.waiting = false
        render()
      }
    }
  }

  async function adoptAndProcess() {
    const job = gen.job
    const jobId = normalizeJobId(job?.id)
    const url = candidateImageUrl(job)
    if (!url) {
      gen.error = 'No original image to adopt.'
      render()
      return
    }
    if (!isUsableJobId(jobId)) {
      gen.error = COPY.invalidJobId
      render()
      return
    }
    const token = contextToken()
    const waitId = ++waitEpoch
    gen.waiting = true
    gen.phase = 'processing'
    gen.error = null
    render()
    try {
      // The user's request is the acceptance decision for its own result. The client builds the
      // hash-bound acceptance from the job's verified artifacts and sealed review (not from this
      // view's state), and the server checks it again; a replay returns the same publication.
      const accepted = await api.acceptJob(jobId)
      if (!waitStillOwned(token, waitId)) return
      const acceptedUrl = candidateImageUrl(accepted) || url
      const bytes = await api.downloadUrl(acceptedUrl)
      if (!waitStillOwned(token, waitId)) return
      const started = await api.processSheet({
        name: String(session?.project?.name || 'Sprite').slice(0, 64),
        sourceBase64: bytesToBase64(bytes),
      })
      if (!waitStillOwned(token, waitId)) return
      gen.job = started
      gen.jobIdDraft = started.id
      writeLastJobId(started.id)
      rememberJobAuthor(started.id, gen.runAuthor)
      rememberJobRun(started.id, jobId)
      for (let i = 0; i < 240 && gen.waiting; i += 1) {
        const job = await api.getJob(started.id)
        if (!waitStillOwned(token, waitId) || !gen.waiting) return
        gen.job = job
        const kind = classifyGenerationJob(job)
        if (kind === 'running') {
          render()
          await wait(500)
          continue
        }
        if (kind === 'missing') {
          // The processing job was lost; the Job ID offered for checking is the sheet being finished,
          // whose saved files continue it (its acceptance replays; nothing is generated again).
          gen.job = null
          gen.phase = 'idle'
          gen.error = COPY.jobGoneBody
          gen.jobIdDraft = jobId
          writeLastJobId(jobId)
          gen.waiting = false
          render()
          return
        }
        gen.phase = kind === 'ready' ? 'ready' : 'process_failed'
        gen.waiting = false
        render()
        return
      }
      if (gen.waiting && waitStillOwned(token, waitId)) {
        gen.phase = 'idle'
        gen.error = COPY.recoveryBody
      }
    } catch (error) {
      if (!waitStillOwned(token, waitId)) return
      gen.phase = 'idle'
      gen.error = presetErrorCopy(error, 'Processing could not finish. Nothing was added; check the job with its Job ID.')
    } finally {
      if (waitStillOwned(token, waitId)) {
        gen.waiting = false
        render()
      }
    }
  }

  async function addToCanvas() {
    const job = gen.job
    const projectId = currentProjectId()
    if (!job || !projectId) return
    if (!canCreateFromJob(job)) {
      gen.error = COPY.needProcessed
      render()
      return
    }
    const url = job.normalized_sheet_url
    if (!isGeneratedArtifactUrl(url, job.id, 'normalized_sheet.png')) {
      gen.error = 'This Job has no sheet URL.'
      render()
      return
    }
    if (gen.adding) return
    if (session?.textDraftOpen?.()) { gen.error = 'Place or discard the text on the canvas first, then add this result.'; render(); return }
    if (session?.openInFlight?.()) { render(); return } // nothing is added during a project change; the processed sheet stays ready
    const token = contextToken()
    const pendingKey = `${projectId}|${job.id}`
    // The selection this operation owns: the one its run started with, or the one at this request.
    const ownedSelection = gen.previewLive ? (gen.runSelection ?? null) : (session?.view?.selectedId || null)
    if (gen.addedKeys.has(pendingKey) || jobInProject(job)) return
    let payload = null
    gen.adding = true
    gen.reloadFailed = false
    render()
    try {
      payload = gen.pendingAdds.get(pendingKey) || null
      if (payload && (payload.projectId !== projectId || payload.jobId !== job.id)) payload = null
      if (!payload) {
        const bytes = await api.downloadUrl(url)
        if (!isCurrentContext(token) || currentProjectId() !== projectId || gen.job?.id !== job.id) return
        const digest = await sha256Hex(bytes)
        if (!isCurrentContext(token) || currentProjectId() !== projectId || gen.job?.id !== job.id) return
        payload = {
          operationId: createOperationId(),
          expectedRevision: null,
          jobId: job.id,
          expectedSha256: digest,
          name: null,
          projectId,
          submitted: false,
        }
        gen.pendingAdds.set(pendingKey, payload)
        gen.pendingFromJob = payload
      }
      if (session?.openInFlight?.()) return // a project change began meanwhile: nothing is sent; the same payload is kept
      // Sent once no canvas save, Undo or import is still being written (its revision is not shown yet
      // and would race the one read here). Still writing after a short wait: nothing is sent and the
      // same payload stays for Add to canvas.
      const settled = await canvasWritesSettled(token, job.id)
      if (settled !== 'settled' || session?.canvasWriteInFlight?.()) {
        // A project change or another job ended the wait: nothing is said here; the same payload is kept.
        if (settled === 'left' || !isCurrentContext(token) || gen.job?.id !== job.id) return
        // An earlier send whose outcome is unknown stays unconfirmed (it may already be saved).
        gen.error = payload.submitted ? 'Adding the sheet was not confirmed. Add to canvas again finishes this same save; it does not create another canvas.'
          : COPY.addWaitedForSaveBody
        return
      }
      if (!payload.submitted) {
        // The first submission carries the revision shown now, after the download and hash, so a canvas
        // save meanwhile is not a conflict. Once sent, an unconfirmed request is resent exactly as it was.
        if (!isCurrentContext(token) || session.project?.id !== projectId || gen.job?.id !== job.id) return
        Object.assign(payload, { expectedRevision: session.project.revision, name: session.project.name ?? null, submitted: true })
      }
      const result = await session.api.createFromJob(projectId, payload)
      if (!isCurrentContext(token) || currentProjectId() !== projectId) return
      // Submitted before a project change began: saved, but never reloaded into that change.
      const changing = Boolean(session?.openInFlight?.())
      // Its own response never moves the shown project back if a newer same-project save landed first.
      if (!changing) adoptSavedProject(session, result.project)
      gen.pendingAdds.delete(pendingKey)
      gen.addedKeys.add(pendingKey)
      if (gen.pendingFromJob?.operationId === payload.operationId) gen.pendingFromJob = null
      gen.phase = 'ready'
      gen.error = null
      gen.reloadFailed = false
      gen.savedPlacement = { key: pendingKey, projectId, result, ownedSelection }
      endPreview()
      if (changing) { // reloaded if the change ends in this project (session.onOpenEpochKept)
        gen.deferredReload = { projectId, project: result.project }
        gen.reloadFailed = true
        gen.error = 'Saved. Another project is opening, so this canvas was not reloaded here.'
        return
      }
      try {
        // Shows this saved sheet: its own snapshot, or the newest project if a newer one is already shown.
        const shown = await showSavedAddition(session, { projectId, documentId: result.document?.document_id || result.receipt?.document_id,
          snapshot: result.project, minimumRevision: result.project?.revision ?? 0 })
        if (!shown.shown) throw new Error(shown.reason === 'superseded' || shown.reason === 'read_failed' ? PRESET_RELOAD_NOT_YET : 'Saved, but the canvas did not reload.')
        gen.reloadFailed = false
        gen.error = null
        // Undo binds only once the shown project holds the canvas, to exactly this addition, and
        // the new canvas becomes the selection.
        if (isCurrentContext(token)) await finishPlacement(pendingKey, projectId, result, token, ownedSelection)
      } catch (error) {
        // A project change meanwhile owns the state now: nothing is written for the earlier project.
        if (!isCurrentContext(token)) return
        gen.phase = 'ready'
        gen.reloadFailed = true
        gen.error = error?.message || 'Saved, but the canvas did not reload.'
      }
      if (!isCurrentContext(token)) return
      fitCanvasView()
    } catch (error) {
      if (!isCurrentContext(token)) return
      gen.phase = 'ready'
      gen.reloadFailed = false
      const keep = error?.kind === 'unknown' || error?.code === 'storage_commit_failed' || error?.kind === 'operation_conflict' || error?.code === 'operation_conflict'
      gen.error = keep
        ? 'Adding the sheet was not confirmed. Add to canvas again finishes this same save; it does not create another canvas.'
        : presetErrorCopy({ message: error?.reason || error?.message }, 'The sheet was not added to the canvas.')
      if (!keep) {
        gen.pendingAdds.delete(pendingKey)
        if (gen.pendingFromJob?.operationId === payload?.operationId) gen.pendingFromJob = null
      }
    } finally {
      gen.adding = false
      if (isCurrentContext(token)) render()
    }
  }

  // Waits up to 10 s while another canvas write is in flight (session.canvasWriteInFlight): 'settled',
  // 'busy' when still writing, or 'left' once this add no longer owns the context or a project opens.
  async function canvasWritesSettled(token, jobId) {
    for (let waited = 0; waited <= 10000; waited += 100) {
      if (!isCurrentContext(token) || gen.job?.id !== jobId || session?.openInFlight?.()) return 'left'
      if (!session?.canvasWriteInFlight?.()) return 'settled'
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    return 'busy'
  }

  function fitCanvasView() {
    const box = root.querySelector('#vnext-canvas-stage')?.getBoundingClientRect()
    session.view?.fitAll?.(box?.width || 800, box?.height || 600)
    session.renderCanvas?.()
  }

  // The placed sheet's Undo is the history entry of exactly its new canvas: Undo detaches that
  // canvas and leaves every other canvas and later edit alone. A replayed or recovered addition
  // of the same canvas returns the same entry, so one placement never gets two Undo entries.
  function placedCanvasId(projectId, saved) {
    const documentId = saved?.document?.document_id || saved?.receipt?.document_id || null
    if (!documentId || session.project?.id !== projectId) return null
    return Object.values(session.project?.canvases || {}).find(canvas => canvas.document_id === documentId)?.id || null
  }
  function bindPlacementUndo(key, projectId, saved) {
    const canvasId = placedCanvasId(projectId, saved)
    const jobId = String(key).startsWith(`${projectId}|`) ? String(key).slice(projectId.length + 1) : null
    const entry = canvasId && currentProjectId() === projectId ? session.recordCanvasAddition?.({ projectId, canvasId, jobId }) : null
    if (gen.placementUndo?.key === key && gen.placementUndo.entry === entry) return
    gen.placementUndo = entry ? { key, entry, status: 'offered', running: false,
      documentId: saved?.document?.document_id || saved?.receipt?.document_id || null } : null
  }
  // The placement is complete once the shown project holds its canvas: bind its Undo, keep the
  // sheet beside the canvases it would otherwise cover (saving only its own position) and, while
  // this operation still owns the context, select that saved, editable canvas (never a candidate).
  async function finishPlacement(key, projectId, saved, token, ownedSelection = null) {
    bindPlacementUndo(key, projectId, saved)
    const canvasId = placedCanvasId(projectId, saved)
    // Where its own add stored it: a later save that moved it keeps that layout (see placeAddedCanvas).
    const added = saved?.project?.canvases?.[canvasId]
    const origin = added ? { x: added.x ?? 0, y: added.y ?? 0 } : null
    if (canvasId && isCurrentContext(token) && currentProjectId() === projectId) await session.placeAddedCanvas?.({ projectId, canvasId, origin })
    if (!canvasId || !isCurrentContext(token) || currentProjectId() !== projectId || session?.openInFlight?.()) return
    const view = session.view
    const current = view?.selectedId || null
    // Never replace a canvas the user selected meanwhile; the selection the operation started with,
    // an empty selection or the run's own candidate hands over to the saved canvas.
    if (current && current !== canvasId && current !== ownedSelection && !String(current).startsWith('candidate:')) return
    if (view?.canvases && !view.canvases.some(canvas => canvas.id === canvasId && !canvas.transient)) return
    if (typeof session.selectCanvas === 'function') session.selectCanvas(canvasId)
    else view?.select?.(canvasId)
  }
  // Redo of exactly this placement after its Undo (the same canvas comes back; nothing is added again).
  async function redoPlacement(placement) {
    if (!placement || placement.running || placement.status !== 'undone') return
    const token = contextToken()
    placement.running = true
    if (placement === gen.placementUndo) render()
    const outcome = await results.redo(placement.entry)
    placement.running = false
    if (outcome === 'redone') placement.status = 'offered'
    // Another save blocked it: the same Redo stays offered and says so.
    placement.redoRetry = outcome === 'retry'
    if (!isCurrentContext(token)) return
    if (placement === gen.placementUndo) render()
    else placement.repaint?.()
    updateSend()
  }
  async function undoPlacement(placement) {
    if (!placement || placement.running || !['offered', 'retry'].includes(placement.status)) return
    const token = contextToken()
    placement.running = true
    if (placement === gen.placementUndo) render()
    const outcome = await results.undo(placement.entry)
    placement.running = false
    // Undone here or already with ⌘Z / Ctrl+Z: either way the new canvas is gone.
    placement.status = outcome === 'undone' || outcome === 'already_undone' ? 'undone' : outcome === 'retry' ? 'retry' : 'superseded'
    placement.redoRetry = false
    if (!isCurrentContext(token)) return
    if (placement === gen.placementUndo) render()
    else placement.repaint?.()
    updateSend()
  }
  // After Undo and a page reload there is no Redo: Put back on the canvas restores the same saved canvas
  // from this page's own Undo record (session.restoreUndonePlacement). Nothing is added, processed or
  // generated; the card then offers the Undo of that restored canvas, which ⌘Z also removes.
  async function restorePlacement() {
    const job = gen.job
    const projectId = currentProjectId()
    if (!job?.id || !projectId || gen.restoring || session?.openInFlight?.()) return
    const key = `${projectId}|${job.id}`
    const token = contextToken()
    const ownedSelection = session?.view?.selectedId || null
    gen.restoring = key
    gen.restoreNote = null
    render()
    let outcome = null
    try {
      outcome = await session.restoreUndonePlacement({ projectId, jobId: job.id })
    } catch {
      outcome = { outcome: 'unknown' }
    }
    if (gen.restoring === key) gen.restoring = false
    if (!isCurrentContext(token) || gen.job?.id !== job.id) return
    if (outcome?.outcome === 'restored' && outcome.shown) {
      gen.placementUndo = outcome.entry ? { key, entry: outcome.entry, status: 'offered', running: false,
        documentId: outcome.entry.documentId || null, restored: true } : gen.placementUndo
      // Like a completed placement: the selection made at the click (or none) hands over to the canvas,
      // and the view brings the canvases (with the restored one) into view.
      const current = session.view?.selectedId || null
      if ((!current || current === ownedSelection) && outcome.canvasId) {
        if (typeof session.selectCanvas === 'function') session.selectCanvas(outcome.canvasId)
        else session.view?.select?.(outcome.canvasId)
      }
      fitCanvasView()
    } else {
      const notes = { retry: COPY.putBackRetryBody, unknown: COPY.putBackUnknownBody, changed: COPY.putBackChangedBody,
        restored: COPY.putBackNotShownBody, refused: outcome?.limit ? COPY.putBackLimitBody : COPY.putBackRefusedBody }
      const body = notes[outcome?.outcome] || null
      gen.restoreNote = body ? { key, body } : null
    }
    render()
    updateSend()
  }
  // A saved sheet whose canvas did not reload: read the project again and show it. Only the newest
  // read counts, and only if it is at least as recent as the save: a failed, stale, missing or
  // older read keeps the recovery state instead of showing the saved snapshot. The result is
  // completed (Undo, selection) once the shown project was actually replaced by that read.
  // Nothing is added or generated again.
  async function reloadAddedSheet({ clicked = false } = {}) {
    const saved = gen.savedPlacement
    const projectId = currentProjectId()
    if (!saved || saved.projectId !== projectId || gen.adding || gen.reloadingSheet || session?.openInFlight?.()) return
    const token = contextToken()
    // A Reload canvas click owns the selection it was clicked with; a reload that completes on its own
    // (after a project change ended here) keeps the selection the add itself owned.
    const ownedSelection = clicked ? (session?.view?.selectedId || null) : (saved.ownedSelection ?? null)
    const notYet = PRESET_RELOAD_NOT_YET
    const mine = {}
    gen.reloadingSheet = mine
    render()
    try {
      // The newest read (never the saved snapshot, which session.project may already hold without the
      // canvas having been reloaded), at least as recent as the save. A failed, stale, older or
      // interrupted read, or one superseded before the canvas shows the sheet, keeps the recovery.
      const shown = await showSavedAddition(session, { projectId, documentId: saved.result?.document?.document_id || saved.result?.receipt?.document_id,
        minimumRevision: saved.result?.project?.revision ?? 0 })
      if (!isCurrentContext(token) || currentProjectId() !== projectId) return
      if (!shown.shown) {
        gen.reloadFailed = true
        gen.error = notYet
        return
      }
      gen.reloadFailed = false
      gen.error = null
      gen.deferredReload = null
      await finishPlacement(saved.key, projectId, saved.result, token, ownedSelection)
      // A recovered placement is shown like a direct one: the view fits the canvases.
      if (isCurrentContext(token) && currentProjectId() === projectId && !session?.openInFlight?.()) fitCanvasView()
    } catch (error) {
      if (!isCurrentContext(token)) return
      gen.reloadFailed = true
      gen.error = presetErrorCopy(error, notYet)
    } finally {
      if (gen.reloadingSheet === mine) gen.reloadingSheet = false
      if (isCurrentContext(token)) render()
    }
  }

  const modelSelector = root.querySelector('#vnext-assistant-model')
  // An earlier result that was produced but never applied is offered once, never applied on its
  // own: "Apply it" is the request (same checks and operation as when it was produced, then Undo);
  // "Dismiss" hides the offer. Only results that still match the current project are offered.
  function offerEarlierResult(history, token) {
    const turn = [...history.turns].reverse().find(item => item.status === 'done' && (item.document_candidate || item.pixel_candidate))
    if (!turn || session.project?.operation_receipts?.[turn.operation_id]) return
    const candidate = turn.document_candidate || turn.pixel_candidate
    const id = candidateIdentity(turn.operation_id, candidate)
    const dismissed = readDiscardedAstraCandidates(currentProjectId())
    if (dismissed === null) {
      appendAssistantNote('Saved dismissals could not be read from browser storage, so no earlier result is offered. No historical preview was activated.', 'astra', { management: true })
      return
    }
    if (!id || dismissed.includes(id) || discardedAstraCandidates.get(currentProjectId())?.includes(id)) return
    if (turn.document_candidate ? candidate.project_revision !== session.project?.revision
      : !turn.context || turn.context.project_id !== currentProjectId() || turn.context.project_revision !== session.project?.revision) return
    const note = appendAssistantNote(turn.document_candidate ? 'An earlier canvas & timeline change from this discussion was never applied.'
      : 'An earlier drawing from this discussion was never applied.', 'astra', { management: true })
    const apply = document.createElement('button')
    apply.type = 'button'; apply.className = 'vnext-dialog-btn is-secondary'
    apply.dataset.recoverDiscussionPreview = 'true'; apply.textContent = 'Apply it'
    apply.title = 'Apply this earlier result to its canvas; Undo restores the previous version'
    const dismiss = document.createElement('button')
    dismiss.type = 'button'; dismiss.className = 'vnext-dialog-btn is-secondary'
    dismiss.dataset.dismissDiscussionPreview = 'true'; dismiss.textContent = 'Dismiss'
    apply.addEventListener('click', () => {
      if (!isCurrentContext(token) || !canStartDiscussion() || !selectAssistantModel('astra', { restore: false })) return
      apply.dataset.recovering = 'true'; apply.disabled = true; dismiss.disabled = true
      void restoreDiscussion(false, { openPreview: true, offered: id }).then(handled => {
        if (handled) { apply.dataset.recoveredDone = 'true'; dismiss.dataset.recoveredDone = 'true' }
      }).finally(() => {
        apply.dataset.recovering = 'false'
        if (isCurrentContext(token)) updateSend()
      })
    })
    dismiss.addEventListener('click', () => {
      if (!isCurrentContext(token) || apply.dataset.recovering === 'true') return
      const remembered = discardAstraCandidate(currentProjectId(), id)
      if (turn.document_candidate) void assistant.documentCandidate?.(documentRequest(candidate, turn.operation_id, 'discard')).catch(() => {})
      apply.dataset.recoveredDone = 'true'; dismiss.dataset.recoveredDone = 'true'
      apply.disabled = true; dismiss.disabled = true
      setText(note.querySelector('[data-turn-title]'), remembered ? 'Earlier result dismissed. Nothing was applied.'
        : 'Earlier result dismissed for now. Browser storage could not remember this dismissal; the offer may reappear after reopening.')
    })
    turnActions(note)?.append(apply, dismiss)
  }
  async function restoreDiscussion(fresh = false, { openPreview = false, offered = null } = {}) {
    if (!currentProjectId() || !assistant.restore || assistant.busy || assistantPreparing || activeAstraCandidate) return
    const token = contextToken(), provider = assistant.provider || 'grok', documentMode = astraDocumentMode
    let interaction = { node: lastInteractiveTurnNode(), inputVersion: promptInputVersion }
    let previewContext = chatContext()
    const ownsThreadRestore = () => isCurrentContext(token) && (assistant.provider || 'grok') === provider
      && !assistant.busy && !assistantPreparing && !activeAstraCandidate
      && lastInteractiveTurnNode() === interaction.node
    const ownsRestore = () => ownsThreadRestore()
      && promptInputVersion === interaction.inputVersion
      && (!openPreview || previewContext === chatContext())
    const pending = assistant.restore({ fresh, refresh: openPreview || isServiceOffline() })
    updateSend()
    try {
      const history = await pending
      if (!history || !isCurrentContext(token)) return
      if (!assistant.serviceUnavailable && assistant.errorCode !== 'assistant_service_unavailable') {
        clearServiceUnavailable()
        updateSend()
      }
      if (!ownsThreadRestore() || (openPreview && !ownsRestore())) return
      if (!history.preserveView) {
        for (const turn of gen.thread.filter(turn => turn.provider && !turn.node.dataset.recoveredImage)) turn.node.remove()
        gen.thread = gen.thread.filter(turn => !turn.provider || turn.node.dataset.recoveredImage)
        regroupThread()
        for (const turn of history.turns) {
          const author = Object.hasOwn(ASSISTANT_CHOICES, turn.provider) ? turn.provider : provider
          appendUserTurn(turn.message, author)
          if (turn.document_candidate) appendAssistantNote('Canvas & timeline result', author)
          else if (turn.composer_action?.type === 'edit_document') continue
          else if (turn.reply) appendAssistantNote(turn.reply, author)
          else appendAssistantNote(turn.status === 'pending' ? 'Reply is still running. Refresh this page to check it; no request was sent again.'
            : turn.status === 'unknown' ? assistantCopy(author, astraDocumentMode).interrupted : assistantErrorCopy(turn.error, author, turn.diagnostic), author)
        }
        if (!fresh) offerEarlierResult(history, token)
      }
      // Restoring history (a reload, a project switch or a model change) never applies, previews or
      // selects anything: only the explicit "Apply it" on an offer continues past here, and it
      // applies exactly the offered result.
      if (!openPreview || provider !== 'astra' || fresh || !offered) return
      interaction = { node: lastInteractiveTurnNode(), inputVersion: promptInputVersion }
      const chosen = [...history.turns].reverse().find(turn => turn.status === 'done'
        && candidateIdentity(turn.operation_id, turn.document_candidate || turn.pixel_candidate) === offered)
      const dismissedNow = readDiscardedAstraCandidates(currentProjectId())
      if (dismissedNow === null) {
        appendAssistantNote('Saved dismissals could not be read from browser storage, so nothing was applied.', provider, { management: true })
        return
      }
      if (!chosen || dismissedNow.includes(offered) || discardedAstraCandidates.get(currentProjectId())?.includes(offered)
        || (chosen.operation_id && session.project?.operation_receipts?.[chosen.operation_id])) {
        appendAssistantNote('That earlier result was already applied, dismissed or is no longer in this discussion. Nothing was applied.', provider, { management: true })
        return true
      }
      const storedDocument = chosen.document_candidate ? chosen : null
      if (storedDocument) {
        astraDocumentMode = true
        const candidate = storedDocument.document_candidate, operationId = storedDocument.operation_id
        let handled = false
        try {
          const resolved = await assistant.documentCandidate(documentRequest(candidate, operationId, 'resolve'))
          if (!ownsRestore()) return
          if (resolved.saved) appendAssistantNote('Canvas & timeline candidate was saved. No model request was repeated.', provider, { management: true })
          else if (candidate.project_revision !== session.project?.revision) appendAssistantNote('The earlier canvas & timeline preview is no longer current. No model request was repeated.', provider, { management: true })
          else {
            const value = await assistant.documentCandidate(documentRequest(candidate, operationId, 'read'))
            if (!ownsRestore()) return
            session.selectCanvas?.(candidate.canvas_id)
            previewContext = chatContext()
            const source = await session.prepareDocumentEdit()
            if (!ownsRestore()) return
            // The click is the request: apply the earlier result as one undoable change.
            const wrap = openRunTurn('astra'); wrap.classList.add('is-astra-document')
            await applyDocumentInCard({ wrap, source, candidate, operationId, token, value })
          }
          handled = true
        } catch (error) {
          if (error.code === 'assistant_service_unavailable') {
            if (isCurrentContext(token)) notifyServiceUnavailable({ stage: 'post_result' })
            return false
          }
          handled = error.code === 'candidate_expired'
          if (isCurrentContext(token)) appendAssistantNote(handled ? 'The earlier unsaved canvas & timeline preview has expired or was discarded. No model request was repeated.' : 'The earlier canvas & timeline preview could not be restored. Resolve or reopen the project before trying again.', provider, { management: true })
        }
        return handled
      }
      astraDocumentMode = false
      const stored = chosen
      const candidate = stored.pixel_candidate
      if (!candidate || !stored.context) {
        appendAssistantNote('That earlier drawing no longer matches this canvas. Nothing was saved.', provider, { management: true })
        return true
      }
      const context = stored.context
      const documentRevision = session.project?.sprite_documents?.[context.document_id]?.working_revision
      if (context.project_id !== currentProjectId() || context.project_revision !== session.project?.revision
        || (documentRevision != null && documentRevision !== context.working_revision)) {
        appendAssistantNote('That drawing preview no longer matches this canvas. Nothing was saved.', provider, { management: true })
        return true
      }
      const rgba = candidate && /^[a-f0-9]{32768}$/.test(candidate.rgba_hex || '')
        ? Uint8Array.from(candidate.rgba_hex.match(/../g), byte => parseInt(byte, 16)) : null
      if (rgba && stored.context && session?.reviewNativePixelCandidate && isCurrentContext(token)) {
        try {
          if (session.conversationRef?.canvasId !== stored.context.canvas_id) session.selectCanvas?.(stored.context.canvas_id)
          previewContext = chatContext()
          const r = stored.context.allowed_rect
          if (r && (r.x !== 0 || r.y !== 0 || r.w !== 64 || r.h !== 64) && !session.pixelSelection && session.conversationRef?.canvasId === stored.context.canvas_id) {
            session.pixelSelection = { projectId: stored.context.project_id, canvasId: stored.context.canvas_id, rect: { x: r.x, y: r.y, w: r.w, h: r.h } }
          }
          const source = await session.preparePixelEdit({ scopeGrant: false })
          if (!ownsRestore()) return
          const blocked = nativeCandidateRestoreBlock({ source, context: stored.context, operationId: stored.operation_id, receipts: session.project?.operation_receipts })
          if (blocked) {
            if (blocked !== 'saved') appendAssistantNote('That drawing preview no longer matches this canvas. Nothing was saved.', provider)
            return
          }
          // The click is the request: apply the earlier drawing with its original operation and the
          // same scope, hash and revision checks as when it was produced; Undo follows.
          const sameRevision = () => [session.project?.sprite_documents?.[source.sourceDocumentId]?.working_revision,
            session.documents?.get?.(source.sourceDocumentId)?.revision, session.conversationRef?.workingRevision]
            .every(revision => revision == null || source.sourceRevision == null || revision === source.sourceRevision)
          const wrap = openRunTurn('astra')
          await applyAstraCandidateInCard({
            wrap,
            source,
            rgba,
            candidate,
            token,
            saveOperationId: stored.operation_id,
            isStillValid: () => isCurrentContext(token) && assistant.provider === provider && !nativeCandidateRestoreBlock({
              source,
              context: stored.context,
              operationId: stored.operation_id,
              receipts: session.project?.operation_receipts,
            }) && Boolean(source.isSelected?.()) && sameRevision(),
          })
          return true
        } catch (error) {
          if (isCurrentContext(token) && error.code !== 'assistant_context_changed') {
            appendAssistantNote(error.message || 'The saved drawing preview could not be opened. No pixels were saved.', provider)
          }
        }
      }
    } catch (error) {
      if (isCurrentContext(token)) {
        if (error.code === 'assistant_service_unavailable') notifyServiceUnavailable()
        else appendAssistantNote(error.code === 'assistant_discussion_changed'
          ? assistantErrorCopy(error.code, provider) : 'Saved discussion could not be read. No message was sent.', provider)
      }
    } finally {
      if (isCurrentContext(token)) {
        if (session?.hasPixelDrawingSave?.() && !gen.thread.some(turn => turn.node.dataset.keptPixelDrawing)) {
          const note = appendAssistantNote('Pixel drawing kept for this project. Click the send arrow to resolve its save without another model request. Keep this tab open until it is saved.', assistant.provider || 'grok')
          note.dataset.keptPixelDrawing = 'true'
        }
        updateSend()
      }
    }
  }
  async function restoreImages() {
    const projectId = currentProjectId(), token = contextToken()
    if (!projectId || !api.listStaticImages) return
    try {
      const result = await api.listStaticImages(projectId)
      if (!isCurrentContext(token)) return
      for (const job of result.jobs || []) {
        const saved = job.imported === true
        const providerLabel = ASSISTANT_CHOICES[job.provider]?.label
        const wrap = appendAssistantNote(`${providerLabel ? `${providerLabel} image` : 'Image'} · ` + (saved ? 'Saved in this project.'
          : job.status === 'unknown' ? 'Image result unknown after restart. Nothing was submitted again.'
          : job.status === 'failed' ? 'Image generation failed. Nothing was submitted again.'
          : 'An image request is saved in this project.'), job.provider, { management: true })
        wrap.dataset.recoveredImage = job.id
        if (!saved && ['done', 'running'].includes(job.status)) {
          const button = document.createElement('button')
          button.type = 'button'; button.className = 'vnext-dialog-btn is-secondary'
          button.dataset.recoverJob = job.id
          button.textContent = job.status === 'done' ? 'Add saved image to canvas' : 'Check image result'
          button.addEventListener('click', async () => {
            if (!isCurrentContext(token) || !canStartDiscussion()) return
            button.disabled = true
            const openEpoch = session?.api?.openEpoch?.current
            const previous = gen.staticImageJobId === job.id ? gen.staticImageContext : null
            const previousRequest = gen.staticImageJobId === job.id ? gen.staticImageRequest : null
            const anchorId = session?.conversationRef?.canvasId ?? session?.view?.selectedId ?? null
            const selected = session?.view?.canvases?.find(canvas => canvas.id === anchorId)
            gen.staticImageContext = {
              projectId,
              openEpoch,
              token,
              anchor: selected ? { id: selected.id, width: selected.width, height: selected.height } : null,
              background: confirmedBackground(previous?.background) || confirmedBackground(job.background) || backgroundFromDescription(previousRequest?.description),
            }
            gen.staticImageJobId = job.id
            gen.staticImageRequest = previousRequest?.description ? previousRequest : { provider: job.provider }
            const placed = await resumeStaticImage()
            if (isCurrentContext(token) && (placed?.canvasId || placed?.alreadyImported)) {
              button.dataset.recoveredDone = 'true'
              button.textContent = 'Saved in this project'
            }
            if (isCurrentContext(token)) updateSend()
          })
          turnActions(wrap)?.append(button)
        }
      }
      updateSend()
    } catch { if (isCurrentContext(token)) appendAssistantNote('Saved image tasks could not be read. No new request was sent.', null, { management: true }) }
  }
  const newDiscussion = root.querySelector('.is-chat-new')
  if (newDiscussion) {
    newDiscussion.disabled = !canStartDiscussion()
    newDiscussion.dataset.capabilityStatus = 'implemented'
    newDiscussion.title = 'Start a new discussion; earlier messages stay saved'
    newDiscussion.addEventListener('click', () => {
      if (canStartDiscussion()) restoreDiscussion(true)
    })
  }
  function selectAssistantModel(value, { restore = true } = {}) {
    if (modelSelector?.disabled) return false
    modelSelector.value = value
    const selectedMode = modelSelector.value === 'astra-document'
    if (!assistant.select?.(selectedMode ? 'astra' : modelSelector.value)) { updateSend(); return false }
    astraDocumentMode = selectedMode
    assistantContext = null
    const keepOfflineStageNote = isServiceOffline() && assistantNote && assistantNote.startsWith('The local service is unavailable.')
    assistantNote = keepOfflineStageNote ? assistantNote
      : assistant.errorCode ? assistantErrorCopy(assistant.errorCode, assistant.provider)
      : isServiceOffline() ? assistantErrorCopy('assistant_service_unavailable', assistant.provider)
      : assistant.connection === 'connected' ? assistantCopy(assistant.provider, astraDocumentMode).completed : assistantCopy(assistant.provider, astraDocumentMode).ready
    closeModelMenu(true)
    updateSend()
    scrollThread()
    if (restore) restoreDiscussion()
    return true
  }
  modelSelector?.addEventListener('change', () => selectAssistantModel(modelSelector.value))
  const modelMenu = root.querySelector('#vnext-assistant-model-menu')
  const modelItems = () => [...root.querySelectorAll('[data-assistant-model]')]
  function openModelMenu(last = false) {
    if (!modelMenu || modelSelector.disabled) return
    modelMenu.hidden = false; modelMenu.showPopover?.(); modelSelector.setAttribute('aria-expanded', 'true')
    const rect = root.querySelector('.vnext-composer')?.getBoundingClientRect?.()
    if (rect) {
      const width = modelMenu.offsetWidth || 210, height = modelMenu.offsetHeight || 166
      modelMenu.style.left = `${Math.max(8, Math.min(rect.right - width - 16, window.innerWidth - width - 8))}px`
      modelMenu.style.top = `${Math.max(8, rect.top - height + 8)}px`
    }
    const items = modelItems()
    ;(last ? items.at(-1) : items.find(item => item.dataset.assistantModel === assistant.provider) || items[0])?.focus?.()
  }
  modelSelector?.addEventListener('click', () => modelMenu?.hidden ? openModelMenu() : closeModelMenu(true))
  modelSelector?.addEventListener('keydown', event => {
    if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); openModelMenu(event.key === 'ArrowUp') }
    if (event.key === 'Escape') closeModelMenu(true)
  })
  for (const item of modelItems()) {
    item.addEventListener('click', () => selectAssistantModel(item.dataset.assistantModel))
    item.addEventListener('keydown', event => {
      const items = modelItems(), i = items.indexOf(item)
      if (event.key === 'Escape') { event.preventDefault(); closeModelMenu(true) }
      else if (event.key === 'Tab') closeModelMenu()
      else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault()
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (i + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
        items[next]?.focus?.()
      }
    })
  }
  const dismissModelMenu = event => {
    if (!event.target?.closest?.('.vnext-assistant-model-wrap')) closeModelMenu()
  }
  root.addEventListener('pointerdown', dismissModelMenu)
  document.addEventListener?.('pointerdown', dismissModelMenu)
  const send = root.querySelector('.vnext-send')
  function handleStaticImageAction() {
    if (!staticImageOpenHere()) return false
    if (gen.staticImageAdding) return true
    if (gen.staticImageBusy) { gen.staticImageStop = true; return true }
    if (gen.staticImageJobId) return resumeStaticImage()
    appendAssistantNote('The last image request result is unknown. It was not sent again.', assistant.provider || 'grok')
    return true
  }
  send?.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    const draft = typeof getDraft === 'function' ? getDraft() : {}
    if (staticImageOpenHere()) return handleStaticImageAction()
    if (send.disabled) return
    if (isAssistantMode(draft) || assistant.busy || session?.hasPixelDrawingSave?.()) return sendAssistant(draft)
    if (session?.conversationRef) return
    const prompt = String(draft.prompt ?? '').trim()
    if (!prompt) return
    if (!applicationPreset(draft.skillId)) {
      appendUserTurn(prompt)
      clearPrompt()
      appendAssistantNote(COPY.needSkill)
      return
    }
    return runPreset({ followUp: canFollowUpPhase(gen.phase) })
  })
  root.addEventListener('vnext-draft-change', () => {
    if (gen.phase === 'ready') render()
    else updateSend()
    repaintPastPlacements()
  })
  root.querySelector('#vnext-prompt-input')?.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) return
    const draft = typeof getDraft === 'function' ? getDraft() : {}
    if (!isAssistantMode(draft) && !session?.hasPixelDrawingSave?.()) return
    event.preventDefault()
    if (staticImageOpenHere()) return handleStaticImageAction()
    if (!send.disabled && !assistant.busy) return sendAssistant(draft)
  })
  root.querySelector('#vnext-prompt-input')?.addEventListener('input', () => {
    promptInputVersion += 1
    if (!clearingPrompt) gen.promptCleared = false
    updateSend()
  })
  updateSend()
  const left = root.querySelector('.vnext-left')
  if (left && typeof ResizeObserver !== 'undefined') {
    let lastWidth = -1
    new ResizeObserver(() => {
      const width = left.getBoundingClientRect().width
      if (Math.abs(width - lastWidth) < 0.5) return
      lastWidth = width
      layoutActionRows()
    }).observe(left)
  }

  host.addEventListener('click', (event) => {
    const control = event.target.closest?.('[data-gen-action]')
    if (!control || control.disabled) return
    const turn = control.closest?.('.vnext-turn') || null
    if (turn && gen.thread.length && turn !== lastInteractiveTurnNode()) return
    const action = control.dataset.genAction
    if (!action) return
    event.preventDefault()
    if (action === 'query') return queryJob({ turn })
    // "Generate again" repeats the last request as a new run (a new provider call the user clicked for).
    else if (action === 'review') {
      const last = gen.lastRequest
      if (!last || last.projectId !== currentProjectId()) return
      return runPreset({ prompt: last.prompt, presetId: last.presetId, useReference: last.useReference, followUp: last.followUp, author: last.author })
    } else if (action === 'stop') {
      waitEpoch += 1
      gen.waiting = false
      gen.autoRun = null
      gen.phase = 'idle'
      gen.error = gen.planChecking ? COPY.stoppedBeforeCall : COPY.stoppedBody
      gen.planChecking = false
      render()
    } else if (action === 'adopt') {
      // Recovery of an interrupted run: finish processing this same image, then place it. It is a
      // run of its own, so Stop, a manual query or a project change releases it like any other.
      return runPreset({}, { resume: true })
    } else if (action === 'add-canvas') {
      return addToCanvas()
    } else if (action === 'reload-canvas') {
      return reloadAddedSheet({ clicked: true })
    } else if (action === 'restore-canvas') {
      return restorePlacement()
    } else if (action.startsWith('astra-flow:')) {
      return turn?.handleAstraFlowAction?.(action.slice('astra-flow:'.length))
    } else if (action.startsWith('download:')) {
      const key = action.slice('download:'.length)
      const item = file02Availability(gen.job).find((entry) => entry.key === key)
      if (!item?.available || !item.url) return
      const link = document.createElement('a')
      link.href = item.url
      link.download = VNEXT_FILE02_FORMATS.find((entry) => entry.key === key)?.file || 'artifact'
      link.rel = 'noopener'
      link.click()
    }
  })

  if (session) {
    session.onChromeRendered = () => {
      activeAstraCandidate?.syncValidity?.()
    }
    // A pixel drawing save finished from its recovery dialog completes the run that drew it, as
    // Resolve pixel drawing save does. Undo binds only to the entry that save reported.
    session.onPixelDrawingResolved = (projectId, result) => {
      if (projectId !== currentProjectId() || !results.peek(`drawing:${projectId}`)) return
      completeRecoveredDrawing(projectId, result, result?.historyEntry ? null : session.latestUndoEntry?.() || null)
    }
    // A project change ended without switching: the finished image job of this project is still current.
    session.onOpenEpochKept = projectId => {
      if (projectId === currentProjectId()) keepImageJobHere()
      const pending = gen.deferredReload // a sheet saved during the change that has now ended here
      if (pending?.projectId === projectId && projectId === currentProjectId() && !dropLoadedReload()) {
        // Read the newest project (the saved snapshot may already be older than the server's); the
        // deferred reload stays pending until a read is actually shown, and is retried next time.
        if (gen.savedPlacement?.projectId === projectId) void reloadAddedSheet().finally(() => session.renderCanvas?.())
      }
      updateSend()
    }
    session.onProjectBound = () => {
      const nextProjectId = currentProjectId()
      if (nextProjectId === gen.projectId) {
        dropLoadedReload()
        keepImageJobHere({ reopened: true })
        activeAstraCandidate?.syncValidity?.()
        render()
        return
      }
      if (!gen.projectId) {
        clearServiceUnavailable()
        assistant.bind(nextProjectId)
        assistantContext = null
        assistantNote = assistantCopy(assistant.provider || 'grok', astraDocumentMode).ready
        gen.projectId = nextProjectId
        waitEpoch += 1
        gen.waiting = false
        render()
        restoreDiscussion()
        restoreImages()
        const restoreId = normalizeJobId(initialJobId || gen.jobIdDraft || readLastJobId())
        if (isUsableJobId(restoreId)) {
          gen.jobIdDraft = restoreId
          queryJob({ silent: true })
        }
        return
      }
      activeAstraCandidate?.abortByProjectSwitch?.()
      activeAstraCandidate = null
      projectEpoch += 1
      gen.deferredReload = null
      if (!gen.staticImageBusy) { // another project: its image job stays recoverable from that project's saved images
        gen.staticImageSavePending = false; gen.staticImageJobId = null; gen.staticImageUnknown = false; gen.staticImageContext = null
      }
      if (gen.projectId) parkedGeneration.set(gen.projectId, {
        job: gen.job, phase: gen.phase, reloadFailed: gen.reloadFailed, error: gen.error, pendingFromJob: gen.pendingFromJob,
        lastRequest: gen.lastRequest, runAuthor: gen.runAuthor, runJobId: gen.runJobId, jobIdDraft: gen.jobIdDraft,
      })
      clearServiceUnavailable()
      assistant.bind(nextProjectId)
      assistantContext = null
      assistantNote = assistantCopy(assistant.provider || 'grok', astraDocumentMode).ready
      waitEpoch += 1
      gen.autoRun = null // a run of the previous project never continues here
      gen.projectId = nextProjectId
      gen.waiting = false
      gen.adding = false
      gen.jobIdDraft = ''
      gen.review = null
      gen.reviewKey = null
      gen.reviewedSnapshot = null
      gen.promptCleared = false
      const parked = parkedGeneration.get(nextProjectId)
      parkedGeneration.delete(nextProjectId)
      gen.jobIdDraft = parked?.jobIdDraft || '' // a recovery card keeps the Job ID it offers to check
      gen.job = parked?.job || null
      gen.pendingFromJob = parked?.pendingFromJob || null
      gen.reloadFailed = Boolean(parked?.reloadFailed)
      gen.phase = parked?.phase || 'idle'
      gen.error = parked?.error || null
      gen.lastRequest = parked?.lastRequest || null
      gen.runAuthor = parked?.runAuthor || null
      gen.runJobId = parked?.runJobId || null
      gen.planChecking = false
      // Returning to a project shows its state; nothing is previewed or selected, and the run released by
      // the switch leaves no temporary candidate on the next project's canvas.
      endPreview()
      // Undo history belongs to the project that was shown; a placement there keeps no Undo here.
      gen.savedPlacement = null; gen.placementUndo = null; gen.reloadingSheet = false; gen.restoring = false; gen.restoreNote = null
      pastPlacements.clear()
      fittedCandidateId = null
      host.replaceChildren()
      gen.thread = []
      // A run released by the switch is never continued. A job it started is only read again
      // (no provider call); a step that had not started a job is reported as stopped.
      const releasedJobId = normalizeJobId(gen.phase === 'processing' ? gen.job?.id : gen.phase === 'running' ? parked?.runJobId : '')
      if (['running', 'processing', 'review'].includes(gen.phase)) {
        gen.phase = 'idle'
        gen.error = isUsableJobId(releasedJobId) ? null : COPY.stoppedBeforeCall
        if (isUsableJobId(releasedJobId)) gen.jobIdDraft = releasedJobId
      }
      render()
      restoreDiscussion()
      restoreImages()
      if (isUsableJobId(releasedJobId)) queryJob({ silent: true })
    }
  }
  render()
  if (currentProjectId()) { restoreDiscussion(); restoreImages() }
  if (session) session.hasAssistantWork = () => Boolean(session.pixelProcessing?.busy) || assistant.busy || assistantPreparing || Boolean(activeAstraCandidate) || gen.staticImageBusy || gen.staticImageAdding || gen.adding
  const restoreId = normalizeJobId(initialJobId || readLastJobId())
  if (isUsableJobId(restoreId)) {
    gen.jobIdDraft = restoreId
    queryJob({ silent: true })
  }
  return gen
}
