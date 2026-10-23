import { createOperationId, sha256Hex } from './vnext-project-client.js'

export const ASSISTANT_CHOICES = Object.freeze({
  grok: { model: 'grok-4.7', label: 'Grok 4.7', available: true },
  codex: { model: 'gpt-6.1-sol', label: 'GPT 6.1', available: true },
  astra: { model: 'gpt-6-astra', label: 'Astra', available: true },
  antigravity: { model: 'gemini-3.8-flash-low', label: 'Gemini 3.8 Flash', available: true },
})
export function assistantCopy(provider = 'grok', documentMode = false) {
  const documentTools = provider === 'astra' && documentMode
  const label = ASSISTANT_CHOICES[provider]?.label || 'Assistant'
  return {
  ready: `${label} · Same discussion across models. Recent history is shared within the context limit.`,
  pending: `${label} is replying… Stop cancels waiting; a request already sent may still use account quota.`,
  completed: `${label} · Connected for this reply. Recent shared history is provided within the context limit.`,
  project: `Open or create a project to discuss it with ${label}.`,
  interrupted: 'Reply result unknown. It was not sent again. Continue here keeps this discussion and your draft.',
  paused: `${label}'s last reply ended without a known result, so this model is paused. Continue here keeps this discussion and your draft; nothing is sent again.`,
  }
}
export const ASSISTANT_COPY = Object.freeze(assistantCopy())

export const SERVICE_UNAVAILABLE_TOAST = Object.freeze({
  title: 'Local service unavailable',
  body: 'Draft kept. No message sent. Restart the service, then reload.',
  keptAboveBody: 'Original message kept above; current draft unchanged. No message sent. Restart the service, then reload.',
  postResultBody: 'Reply completed, but the result could not be read yet and was not applied. Restart the service, then reload or retry the same result.',
  postSaveBody: 'Save outcome unknown after disconnect. Restart the service, then reload before retrying.',
})

export function assistantErrorCopy(code, provider = 'grok', diagnostic = null) {
  const label = ASSISTANT_CHOICES[provider]?.label || 'Assistant'
  if (code === 'assistant_service_unavailable') return 'The local service is unavailable. Draft kept. No message sent. Restart the service, then reload.'
  if (code === 'assistant_discussion_changed') return 'The discussion changed in another page. Draft kept; reload to show the current discussion before sending. No message was sent.'
  if (code === 'assistant_document_text_unsupported') return 'Canvas & timeline AI tools do not yet support editable text. Use the existing text editor; nothing was sent.'
  if (code === 'unsupported_input') return diagnostic?.message || 'This canvas, frame scope, or reference selection cannot be used here. Nothing was changed.'
  if (code === 'candidate_expired') return 'This unsaved candidate expired. Nothing was saved; no automatic model retry.'
  if (code === 'assistant_document_invalid') return 'This document is outside the supported canvas or memory limits. Nothing was sent.'
  if (code === 'assistant_candidate_limit') return 'Too many earlier results are still unresolved. Resolve them, then try again. No result was saved.'
  if (code === 'assistant_login_required') return `${label} needs its native login. Draft kept; no message was sent.`
  if (code === 'assistant_version_unverified') {
    return `${label} CLI version is not verified for this connection. Draft kept; no message was sent. No automatic retry.`
  }
  if (['assistant_profile_unavailable', 'assistant_configuration_changed'].includes(code)) {
    return `${label} connection settings need attention. Draft kept; no message was sent. No automatic retry.`
  }
  if (['assistant_model_unavailable', 'assistant_model_mismatch'].includes(code)) return `${label} is unavailable. Draft kept; no model was substituted.`
  const reason = diagnostic?.reason
  if (diagnostic?.rule === 'time_limit') return 'The 180 second drawing limit ended. Nothing was saved. No automatic retry.'
  if (diagnostic?.rule === 'codebook_limit') return 'This region has more than 62 colors (source + allowed palette). Nothing was saved. No automatic retry.'
  if (diagnostic?.rule === 'candidate_hash') return 'The candidate baseline hash changed before this patch applied. Nothing was saved.'
  if (reason === 'budget') return 'The drawing tool limit was reached. Nothing was saved. No automatic retry.'
  if (reason === 'authorization') return 'That tool call was not authorized. Nothing was saved. No automatic retry.'
  if (reason === 'unsupported') return 'That action is not available for this canvas. Nothing was saved. No automatic retry.'
  if (reason === 'prohibited') return 'A blocked planning action stopped the drawing. Nothing was saved. No automatic retry.'
  if (reason === 'source_alpha') return 'This image uses transparency the tools cannot edit. Nothing was changed.'
  if (reason === 'invalid_arguments' || reason === 'internal') return 'The drawing tools rejected the request. Nothing was saved. No automatic retry.'
  if (code === 'assistant_tool_blocked') return 'The drawing tools rejected the request. Nothing was saved. No automatic retry.'
  if (code === 'assistant_busy') return 'An assistant is busy. Draft kept; nothing was queued.'
  if (code === 'assistant_result_unknown' || code === 'assistant_session_interrupted') return assistantCopy(provider).interrupted
  if (code === 'assistant_storage_failed') return 'The discussion could not be saved. No automatic retry. Check storage before continuing.'
  if (code === 'assistant_history_failed') return 'Saved discussion could not be read. Reload to retry reading, or explicitly start a new discussion. Draft kept.'
  if (code === 'assistant_session_limit') return 'This discussion has reached its storage limit. Start a new discussion to continue; earlier messages stay saved.'
  if (code === 'assistant_drawing_unavailable') return 'This kind of drawing runs with GPT 6.1 (pixel art) or Astra (canvas tools). Nothing was sent.'
  if (code === 'assistant_output_limit') return 'The reply exceeded the connection safety limit. No drawing was saved and no automatic retry was made.'
  if (code === 'assistant_message_too_long') return 'This message plus the shared context is too long for this model. Draft kept; shorten it and send again. Nothing was sent.'
  if (code === 'assistant_context_changed') return 'The selected canvas changed. Draft kept; send again for the current selection.'
  if (code === 'assistant_project_required') return assistantCopy(provider).project
  return `${label} did not complete this reply. Check the native login or account quota. Draft kept; no automatic retry.`
}

const isFullRect = r => !r || (r.x === 0 && r.y === 0 && r.w === 64 && r.h === 64)
const sameRect = (a, b) => Boolean(a && b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h)

export function nativeCandidateRestoreBlock({ source, context, operationId, receipts } = {}) {
  if (!context || context.pixel_tools !== true || !source) return 'missing'
  if (operationId && receipts?.[operationId]) return 'saved'
  if (source.projectId !== context.project_id || source.sourceCanvasId !== context.canvas_id
    || source.sourceDocumentId !== context.document_id || source.projectRevision !== context.project_revision
    || source.sourceRevision !== context.working_revision) return 'target'
  if (source.width !== 64 || source.height !== 64 || source.multiCel || source.linkScope || source.previewPixels) return 'scope'
  if (isFullRect(context.allowed_rect)) {
    if (source.allowedRect && !isFullRect(source.allowedRect)) return 'scope'
  } else if (source.allowedRect && !sameRect(source.allowedRect, context.allowed_rect)) {
    return 'scope'
  }
  return null
}
export function createVnextAssistantClient({ fetchImpl = globalThis.fetch?.bind(globalThis), operationId = createOperationId } = {}) {
  let projectId = null, provider = 'grok', controller = null, epoch = 0, bindEpoch = 0, restoring = false
  let discussion = null, historyShown = false, serviceUnavailable = false
  let requestClock = 0, lastConnectivitySeq = 0
  const inFlightControllers = new Set()
  const states = new Map()
  function state() {
    if (!states.has(provider)) states.set(provider, { conversation: null, blocked: false, connection: 'not_checked', error: null })
    return states.get(provider)
  }
  function markServiceUnavailable(reqStartSeq) {
    if (reqStartSeq <= lastConnectivitySeq) return
    lastConnectivitySeq = reqStartSeq
    serviceUnavailable = true
  }
  function markServiceAvailable(reqStartSeq) {
    if (reqStartSeq <= lastConnectivitySeq) return
    lastConnectivitySeq = reqStartSeq
    if (!serviceUnavailable) return
    serviceUnavailable = false
    for (const item of states.values()) {
      if (item.error === 'assistant_service_unavailable') {
        item.blocked = false
        item.error = null
        item.connection = 'not_checked'
      }
    }
  }
  async function request(endpoint, body, signal, owner = projectId) {
    if (!owner || typeof owner !== 'string') throw Object.assign(new Error(), { code: 'assistant_project_required' })
    const reqBindEpoch = bindEpoch
    const reqOwner = owner
    const reqStartSeq = ++requestClock
    const reqController = new AbortController()
    const onCallerAbort = () => reqController.abort()
    if (signal?.aborted) reqController.abort()
    else if (signal) signal.addEventListener('abort', onCallerAbort, { once: true })
    inFlightControllers.add(reqController)
    const isCurrentProjectRequest = () => reqBindEpoch === bindEpoch && reqOwner === projectId && !reqController.signal.aborted && !signal?.aborted
    let response
    try {
      try {
        response = await fetchImpl(`/api/editor/projects/${encodeURIComponent(reqOwner)}/assistant/${endpoint}`, {
          method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: reqController.signal,
        })
      } catch (error) {
        if (reqController.signal.aborted || signal?.aborted) throw error
        const code = endpoint === 'messages' ? 'assistant_result_unknown' : 'assistant_service_unavailable'
        if (code === 'assistant_service_unavailable' && isCurrentProjectRequest()) markServiceUnavailable(reqStartSeq)
        throw Object.assign(error, { code })
      }
      if (reqController.signal.aborted || signal?.aborted) throw Object.assign(new Error(), { code: 'assistant_cancelled' })
      let value
      try { value = await response.json() } catch {
        throw Object.assign(new Error(), { code: 'assistant_response_failed' })
      }
      if (!response.ok) {
        if (value?.error === 'assistant_service_unavailable' && isCurrentProjectRequest()) markServiceUnavailable(reqStartSeq)
        throw Object.assign(new Error(typeof value?.message === 'string' ? value.message : ''), {
          code: value?.error || 'assistant_response_failed',
          blocked: value?.blocked,
          diagnostic: value?.diagnostic,
          details: value?.details,
        })
      }
      if (isCurrentProjectRequest()) markServiceAvailable(reqStartSeq)
      return value
    } finally {
      inFlightControllers.delete(reqController)
      if (signal) signal.removeEventListener?.('abort', onCallerAbort)
    }
  }
  return {
    get busy() { return Boolean(controller) },
    get restoring() { return restoring },
    get blocked() { return serviceUnavailable || state().blocked },
    get provider() { return provider },
    get connection() { return serviceUnavailable ? 'unavailable' : state().connection },
    get errorCode() { return state().error || (serviceUnavailable ? 'assistant_service_unavailable' : null) },
    get serviceUnavailable() { return serviceUnavailable },
    // Paused by a reply whose result is unknown (Stop, a lost reply, a restart) rather than by the
    // service or an unreadable discussion; resume() is its explicit recovery.
    get interrupted() {
      const current = state()
      return !serviceUnavailable && current.blocked === true
        && !['assistant_history_failed', 'assistant_discussion_changed', 'assistant_service_unavailable'].includes(current.error)
    },
    select(next) {
      if (controller || typeof next !== 'string' || !Object.hasOwn(ASSISTANT_CHOICES, next)
        || !ASSISTANT_CHOICES[next].available) return false
      if (next !== provider) { provider = next; epoch++ }
      return true
    },
    bind(nextProjectId) {
      if (nextProjectId === projectId) return
      controller?.abort()
      for (const active of inFlightControllers) active.abort()
      inFlightControllers.clear()
      bindEpoch++; epoch++; projectId = nextProjectId; controller = null; restoring = false; states.clear()
      discussion = null; historyShown = false; serviceUnavailable = false
      requestClock = 0; lastConnectivitySeq = 0
    },
    stop() { state().blocked = true; state().connection = 'interrupted'; controller?.abort() },
    async restore({ fresh = false, refresh = false } = {}) {
      if (!projectId || controller) return null
      const owner = projectId, token = epoch, selected = provider, current = state(), active = new AbortController()
      if (current.restored && !serviceUnavailable && !fresh && !refresh) return null
      controller = active; restoring = true
      try {
        const value = fresh ? await request('session', { provider: selected, model: ASSISTANT_CHOICES[selected].model, shared: true, fresh: true }, active.signal, owner)
          : await request(`history?provider=${encodeURIComponent(selected)}&shared=true`, undefined, active.signal, owner)
        if (epoch !== token || active.signal.aborted) return null
        if (value.provider !== selected || value.model !== ASSISTANT_CHOICES[selected].model || (!fresh && !Array.isArray(value.turns))) throw Object.assign(new Error(), { code: 'assistant_response_failed' })
        if (!fresh && discussion && discussion !== value.discussion) throw Object.assign(new Error(), { code: 'assistant_discussion_changed' })
        const preserveView = !fresh && historyShown && discussion === (value.discussion ?? null)
        if (fresh || (discussion && discussion !== value.discussion)) { states.clear(); states.set(selected, current) }
        discussion = value.discussion ?? null; historyShown = true
        current.conversation = value.conversation; current.blocked = Boolean(value.blocked)
        current.restored = true; current.error = null
        current.connection = 'not_checked'
        return { ...value, preserveView, turns: value.turns || [] }
      } catch (error) {
        if (epoch === token) {
          current.blocked = true; current.error = ['assistant_service_unavailable', 'assistant_discussion_changed'].includes(error.code) ? error.code : 'assistant_history_failed'
          current.connection = error.code === 'assistant_service_unavailable' ? 'unavailable' : 'interrupted'
        }
        throw error
      } finally { if (epoch === token) { controller = null; restoring = false } }
    },
    // Explicit "Continue here" after an interrupted reply: reconcile with the saved discussion and,
    // only if the server still holds the channel paused, release it there. The same discussion,
    // channel and draft continue; the interrupted request is never sent again and no earlier
    // action is applied. Returns the refreshed history (turns) or null when superseded.
    async resume() {
      if (!projectId || controller || serviceUnavailable) throw Object.assign(new Error(), { code: 'assistant_busy' })
      const owner = projectId, token = epoch, selected = provider, current = state(), active = new AbortController()
      if (!current.blocked) return null
      controller = active; restoring = true
      const historyPath = `history?provider=${encodeURIComponent(selected)}&shared=true`
      const readHistory = async () => {
        const value = await request(historyPath, undefined, active.signal, owner)
        if (epoch !== token || active.signal.aborted) return null
        if (value.provider !== selected || value.model !== ASSISTANT_CHOICES[selected].model || !Array.isArray(value.turns)) throw Object.assign(new Error(), { code: 'assistant_response_failed' })
        if (discussion && (value.discussion ?? null) !== discussion) throw Object.assign(new Error(), { code: 'assistant_discussion_changed' })
        // The stopped request is still winding down on the server: it still owns this channel.
        if (value.turns.some(turn => turn.provider === selected && turn.status === 'pending')) throw Object.assign(new Error(), { code: 'assistant_busy' })
        return value
      }
      try {
        let value = await readHistory()
        if (!value) return null
        if (value.blocked === true && value.conversation) {
          await request('resolve', { provider: selected, conversation: value.conversation, ...(value.discussion ? { discussion: value.discussion } : {}) }, active.signal, owner)
          if (epoch !== token || active.signal.aborted) return null
          value = await readHistory()
          if (!value) return null
          if (value.blocked === true) throw Object.assign(new Error(), { code: 'assistant_session_interrupted' })
        }
        discussion = value.discussion ?? discussion
        historyShown = true
        current.conversation = value.conversation ?? current.conversation
        current.blocked = false; current.restored = true; current.error = null; current.connection = 'not_checked'
        return { ...value, preserveView: false, turns: value.turns }
      } catch (error) {
        // A failed recovery leaves the channel paused; only a definite service loss changes its reason.
        if (epoch === token && error.code === 'assistant_service_unavailable') { current.error = error.code; current.connection = 'unavailable' }
        throw error
      } finally { if (epoch === token) { controller = null; restoring = false } }
    },
    processDocument(body, owner = projectId, signal) { return request('document-process', body, signal, owner) },
    prepareDocument(body, owner = projectId, signal) { return request('document-grant', body, signal, owner) },
    documentCandidate(body, owner = projectId, signal) { return request('document-candidate', body, signal, owner) },
    async send({ message, composerActions = false, composerPresetId = null, composerWorkflow = null, revision, canvasId = null, workingRevision, width, height, pixelDrawing, grantId, allowedRect, allowedColors, pixelTools = false, documentMode = false, documentGrant, editableFrameIds = null, referenceIds = null }) {
      if (!projectId || controller || state().blocked) throw Object.assign(new Error(), { code: 'assistant_busy' })
      const owner = projectId, token = epoch, active = new AbortController(), selected = provider, current = state()
      const model = ASSISTANT_CHOICES[selected].model
      controller = active
      try {
        if (!current.conversation) {
          const opened = await request('session', { provider: selected, model, shared: true }, active.signal, owner)
          if (epoch !== token || active.signal.aborted) throw Object.assign(new Error(), { code: 'assistant_cancelled' })
          if (opened.provider !== selected || opened.model !== model || typeof opened.conversation !== 'string' || !opened.conversation) {
            throw Object.assign(new Error(), { code: 'assistant_response_failed' })
          }
          if (discussion && opened.discussion !== discussion) throw Object.assign(new Error(), { code: 'assistant_discussion_changed' })
          current.conversation = opened.conversation
          discussion = opened.discussion ?? discussion
        }
        const result = await request('messages', { conversation: current.conversation, operation_id: operationId(), message,
          ...(discussion ? { discussion } : {}),
          expected_revision: revision, canvas_id: canvasId,
          ...(composerActions ? { composer_actions: true } : {}),
          ...(composerActions && composerPresetId ? { composer_preset_id: composerPresetId } : {}),
          ...(composerActions && composerWorkflow ? { composer_workflow: composerWorkflow } : {}),
          ...(pixelDrawing ? { pixel_drawing: pixelDrawing } : {}),
          ...(pixelTools ? { pixel_tools: true } : {}),
          ...(documentMode ? {
            document_mode: true,
            document_grant: documentGrant,
            ...(Array.isArray(editableFrameIds) && editableFrameIds.length ? { editable_frame_ids: editableFrameIds } : {}),
            ...(Array.isArray(referenceIds) && referenceIds.length ? { reference_ids: referenceIds } : {}),
          } : {}),
          ...(grantId ? { grant_id: grantId } : {}),
          ...(pixelTools && Array.isArray(allowedColors) ? { allowed_colors: allowedColors } : {}),
          ...(workingRevision !== undefined ? { expected_working_revision: workingRevision } : {}) }, active.signal, owner)
        if (epoch !== token || active.signal.aborted) throw Object.assign(new Error(), { code: 'assistant_cancelled' })
        if (typeof result.reply !== 'string' || !result.reply.trim()
          || result.context?.project_id !== owner || result.context?.project_revision !== revision
          || result.context?.canvas_id !== canvasId || result.provider !== selected || result.requestedModel !== model
          || result.completed !== true || result.termination !== (['codex', 'astra'].includes(selected) ? 'managed' : 'natural')) {
          throw Object.assign(new Error(), { code: 'assistant_response_failed' })
        }
        if (workingRevision !== undefined && (result.context.working_revision !== workingRevision
          || result.context.width !== width || result.context.height !== height || !Object.hasOwn(result, documentMode ? 'document_candidate' : pixelTools ? 'pixel_candidate' : pixelDrawing ? 'pixel_drawing' : 'pixel_edit'))) {
          throw Object.assign(new Error(), { code: 'assistant_response_failed' })
        }
        if (documentMode && (selected !== 'astra' || result.context.document_mode !== true)) throw Object.assign(new Error(), { code: 'assistant_response_failed' })
        if (pixelDrawing && (!Object.hasOwn(result, 'pixel_drawing')
          || result.context.pixel_drawing?.size !== pixelDrawing.size || result.context.pixel_drawing?.kind !== pixelDrawing.kind
          || result.context.pixel_drawing?.reference !== pixelDrawing.reference)) throw Object.assign(new Error(), { code: 'assistant_response_failed' })
        if (pixelTools) {
          const value = result.pixel_candidate
          if (selected !== 'astra' || result.context.pixel_tools !== true || width !== 64 || height !== 64
            || value?.width !== 64 || value?.height !== 64 || typeof value.rgba_hex !== 'string'
            || !/^[a-f0-9]{32768}$/.test(value.rgba_hex) || !/^[a-f0-9]{64}$/.test(value.source_sha256 || '')
            || !Number.isInteger(value.drawing_batches) || value.drawing_batches < 0 || value.drawing_batches > 3
            || !Number.isInteger(value.tool_calls) || value.tool_calls < 0 || value.tool_calls > 9
            || (allowedRect && !sameRect(result.context.allowed_rect || value.allowed_rect, allowedRect))) {
            throw Object.assign(new Error(), { code: 'assistant_response_failed' })
          }
          const rgba = Uint8Array.from(value.rgba_hex.match(/../g), byte => parseInt(byte, 16))
          if (await sha256Hex(rgba) !== value.sha256 || epoch !== token || active.signal.aborted) throw Object.assign(new Error(), { code: 'assistant_response_failed' })
          result.pixelCandidateBytes = rgba
        }
        current.connection = 'connected'; current.error = null
        return result
      } catch (error) {
        if (epoch === token) {
          current.error = error.code || 'assistant_cancelled'
          current.connection = error.code === 'assistant_login_required' ? 'login_required' : 'unavailable'
          if (error.blocked === false) current.blocked = false
          else if (!['assistant_busy', 'assistant_context_changed', 'assistant_profile_unavailable', 'assistant_version_unverified',
            'assistant_login_required', 'assistant_model_unavailable', 'assistant_model_mismatch',
            'assistant_configuration_changed', 'assistant_project_required', 'unsupported_input', 'resource_limit'].includes(error.code)) current.blocked = true
        }
        throw error
      } finally { if (epoch === token) controller = null }
    },
  }
}
