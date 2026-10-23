// P2-04 canvas binding · allowlisted editor project APIs only.
// Does not call generate/process/provider endpoints.

export const VNEXT_EDITOR_API_PREFIX = '/api/editor/projects'
export const VNEXT_PROJECT_V0 = 'editor_project_v0'
export const VNEXT_PROJECT_V1 = 'editor_project_v1'

export const VNEXT_PROJECT_COPY = Object.freeze({
  menuNew: 'New project',
  menuOpen: 'Open project…',
  menuImport: 'Import image…',
  menuSave: 'Save canvas positions',
  openTitle: 'Open project',
  searchPlaceholder: 'Find a project by name or ID',
  chooseHint: 'Choose a project, then press Open.',
  countInWorkspace: (n) => `${n} project${n === 1 ? '' : 's'} in this workspace`,
  countCanOpen: (n) => `${n} project${n === 1 ? '' : 's'} can be opened`,
  lastSaved: (text) => `Last saved ${text}`,
  olderFormat: 'Older format · Opens as an upgraded copy',
  omittedTitle: (n) => `${n} project${n === 1 ? '' : 's'} couldn't be read`,
  omittedBody: "They aren't shown here. The other projects can still be opened.",
  noMatchTitle: (q) => `Nothing matches “${q}”.`,
  noMatchBody: 'Check the spelling or clear the search.',
  allUnreadTitle: 'None of your projects could be read',
  allUnreadBody: 'This workspace has projects, but none of them could be read right now.',
  loading: 'Loading projects from this workspace...',
  emptyTitle: 'No projects yet',
  emptyBody: 'This workspace has no saved projects yet.',
  listError: 'Projects could not be loaded.',
  cancel: 'Cancel',
  open: 'Open',
  refresh: 'Refresh list',
  clearSearch: 'Clear search',
  upgradeTitle: 'Open as an upgraded copy',
  upgradeBody: 'This project uses an older format. Opening creates a new v1 copy. The original project stays unchanged. Copied assets do not become canvases.',
  upgradeAction: 'Open copy',
  leaveTitle: 'Leave without saving canvas positions?',
  leaveBody: 'Canvas positions have unsaved changes. Imports already on the server stay there. Viewport and selection are not saved.',
  stay: 'Stay',
  leave: 'Leave',
  conflictTitle: 'Canvas positions changed',
  conflictBody: 'The saved positions differ from this draft. Keep the draft or discard it and load the latest values. Positions are not overwritten automatically.',
  keepDraft: 'Keep draft',
  discardLoad: 'Discard and load',
  unknownTitle: 'Server did not confirm',
  unknownBody: 'The request finished without a receipt. This is not proof it was not submitted. Retry uses the same operation and payload.',
  retry: 'Retry',
  dismiss: 'Dismiss',
  openFailed: 'This project could not be opened. The current project is unchanged.',
  upgradeFailed: 'The upgraded copy could not be created. The original project is unchanged.',
  upgradeNotOpened: 'The upgraded copy was created but not opened. Open it from the project list.',
  createdNotOpened: 'The new project was created but not opened. Open it from the project list.',
  importFailed: 'The PNG could not be imported.',
  saveFailed: 'Canvas positions could not be saved.',
  saved: 'Saved',
  noProject: 'Untitled project',
})

const ALLOWED_PATH = /^\/api\/editor\/projects(?:\/|$)/
const KNOWN_REJECT = new Set([400, 403, 404, 409, 413, 415, 422])

export function createOperationId() {
  return crypto.randomUUID()
}

export function isAllowedEditorProjectUrl(url) {
  try {
    const path = new URL(url, 'http://127.0.0.1').pathname
    return ALLOWED_PATH.test(path)
  } catch {
    return typeof url === 'string' && ALLOWED_PATH.test(url.split('?')[0])
  }
}

export function filterProjectSummaries(projects, query) {
  const list = Array.isArray(projects) ? projects : []
  const q = String(query ?? '').trim().toLowerCase()
  if (!q) return list.slice()
  return list.filter((item) => {
    const name = String(item?.name ?? '').toLowerCase()
    const id = String(item?.id ?? '').toLowerCase()
    return name.includes(q) || id.includes(q)
  })
}

export function formatLastSaved(iso, now = new Date()) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const sameYear = date.getUTCFullYear() === now.getUTCFullYear()
  const month = date.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })
  const day = date.getUTCDate()
  const year = date.getUTCFullYear()
  const hh = String(date.getUTCHours()).padStart(2, '0')
  const mm = String(date.getUTCMinutes()).padStart(2, '0')
  return sameYear ? `${month} ${day}, ${hh}:${mm}` : `${month} ${day}, ${year}, ${hh}:${mm}`
}

export function projectListViewModel({
  status = 'idle',
  projects = [],
  omitted_count = 0,
  has_more = false,
  query = '',
  selectedId = null,
  error = null,
} = {}) {
  const filtered = filterProjectSummaries(projects, query)
  const omitted = Number(omitted_count) || 0
  const selectedVisible = Boolean(selectedId && filtered.some((item) => item.id === selectedId))
  const emptyWorkspace = status === 'ready' && projects.length === 0 && omitted === 0
  const allUnreadable = status === 'ready' && projects.length === 0 && omitted > 0
  const noMatch = status === 'ready' && projects.length > 0 && filtered.length === 0
  const loading = status === 'loading'
  const wholeError = status === 'error'
  let countText = ''
  if (!loading && !wholeError && !emptyWorkspace && !allUnreadable && !noMatch) {
    countText = omitted > 0
      ? VNEXT_PROJECT_COPY.countCanOpen(filtered.length)
      : VNEXT_PROJECT_COPY.countInWorkspace(filtered.length)
    if (has_more) {
      countText = `${countText} (first ${projects.length} loaded)`
    }
  }
  return {
    status,
    projects,
    filtered,
    omitted,
    hasMore: Boolean(has_more),
    query,
    selectedId: selectedVisible ? selectedId : null,
    error,
    emptyWorkspace,
    allUnreadable,
    noMatch,
    loading,
    wholeError,
    showSearch: !loading && !wholeError && !emptyWorkspace && !allUnreadable,
    showOmitted: omitted > 0 && !loading && !wholeError && !emptyWorkspace,
    canOpen: selectedVisible && !loading && !wholeError,
    openDisabled: !(selectedVisible && !loading && !wholeError),
    showRefresh: !loading && (omitted > 0 || wholeError || allUnreadable),
    countText,
    hintText: status === 'ready' && filtered.length > 0 && !selectedVisible
      ? VNEXT_PROJECT_COPY.chooseHint
      : '',
  }
}

export function classifyEditorHttpError({
  status = 0,
  body = null,
  offline = false,
  bodyBroken = false,
} = {}) {
  const code = typeof body?.error === 'string' ? body.error : (bodyBroken ? 'body_unreadable' : '')
  const reason = typeof body?.reason === 'string'
    ? body.reason
    : (bodyBroken ? 'Response body could not be read.' : '')
  if (bodyBroken) {
    return { kind: 'unknown', code, status, reason, submittedUnknown: true }
  }
  if (offline || status === 0) {
    return { kind: 'unknown', code, status, reason, submittedUnknown: true }
  }
  if (code === 'stale_revision') {
    return { kind: 'stale', code, status, reason, submittedUnknown: false }
  }
  if (code === 'operation_conflict') {
    return { kind: 'operation_conflict', code, status, reason, submittedUnknown: false }
  }
  if (code === 'tool_unavailable') {
    return { kind: 'known_reject', code, status, reason, submittedUnknown: false }
  }
  if (KNOWN_REJECT.has(status)) {
    return { kind: 'known_reject', code, status, reason, submittedUnknown: false }
  }
  if (status >= 500) {
    return { kind: 'unknown', code, status, reason, submittedUnknown: true }
  }
  return { kind: 'unknown', code, status, reason, submittedUnknown: true }
}

export function shouldProtectLeave({ dirty = false, pendingImport = false, pendingSave = false } = {}) {
  return Boolean(dirty || pendingImport || pendingSave)
}

export function listedDirtyPositions(canvases, drafts) {
  const listed = []
  for (const canvas of canvases || []) {
    if (canvas?.transient) continue
    const draft = drafts?.[canvas.id]
    if (!draft) continue
    if (draft.x !== canvas.x || draft.y !== canvas.y) {
      listed.push({ canvas_id: canvas.id, x: draft.x, y: draft.y })
    }
  }
  return listed.sort((left, right) => left.canvas_id.localeCompare(right.canvas_id))
}

export function compareLayoutConflict(drafts, serverCanvases) {
  const rows = []
  for (const canvas of serverCanvases || []) {
    const draft = drafts?.[canvas.id]
    if (!draft) continue
    if (draft.x !== canvas.x || draft.y !== canvas.y) {
      rows.push({
        canvas_id: canvas.id,
        draft: { x: draft.x, y: draft.y },
        latest: { x: canvas.x, y: canvas.y },
      })
    }
  }
  return rows
}

export function createRequestEpoch() {
  let current = 0
  return {
    next() {
      current += 1
      return current
    },
    cancel() {
      current += 1
      return current
    },
    isCurrent(token) {
      return token === current
    },
    get current() {
      return current
    },
  }
}

export async function sha256Hex(bytes) {
  const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || [])
  const copy = source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength)
  const digest = await crypto.subtle.digest('SHA-256', copy)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function bytesOf(body) {
  if (body == null) return null
  if (body instanceof Uint8Array) return body
  if (body instanceof ArrayBuffer) return new Uint8Array(body)
  return null
}

export function createFrameCoalescer(run, schedule = (callback) => callback()) {
  let queued = false
  let runs = 0
  return {
    get runs() { return runs },
    request() {
      if (queued) return
      queued = true
      schedule(() => {
        queued = false
        runs += 1
        run()
      })
    },
  }
}

function sameRecoverable(left, right) {
  if (!left || !right) return false
  if (left === right) return true
  if (left.method !== right.method || left.url !== right.url) return false
  if (typeof left.body === 'string' || typeof right.body === 'string') return left.body === right.body
  if (left.body instanceof Uint8Array && right.body instanceof Uint8Array) {
    if (left.body.length !== right.body.length) return false
    for (let i = 0; i < left.body.length; i += 1) if (left.body[i] !== right.body[i]) return false
    return true
  }
  return left.body == null && right.body == null
}

function confirmedDocumentReceipt(body, spec) {
  const receipt = body?.receipt
  const document = body?.document
  if (!receipt || receipt.operation_id !== spec.requiredOperationId) return false
  if (receipt.project_id !== spec.projectId || body.project?.id !== spec.projectId) return false
  if (typeof document?.document_id !== 'string' || !document.document_id) return false
  if (!Number.isInteger(document.revision) || document.revision < 1) return false
  if (typeof receipt.document_id !== 'string' || !receipt.document_id) return false
  if (!Number.isInteger(receipt.document_revision) || receipt.document_revision < 1) return false
  return document.document_id === receipt.document_id && document.revision === receipt.document_revision
}

export function recoverableRequest(spec) {
  if (!spec || typeof spec.url !== 'string' || typeof spec.method !== 'string') return null
  const body = spec.body instanceof Uint8Array ? spec.body.slice() : spec.body ?? null
  return {
    method: spec.method,
    url: spec.url,
    headers: spec.headers ? { ...spec.headers } : undefined,
    body,
    rememberUnknown: true,
    requiredOperationId: spec.requiredOperationId,
    allowAlreadyImported: Boolean(spec.allowAlreadyImported),
    projectId: spec.projectId,
  }
}

export function createVnextProjectClient({ fetchImpl } = {}) {
  const fetchFn = fetchImpl || globalThis.fetch.bind(globalThis)
  const listEpoch = createRequestEpoch()
  const openEpoch = createRequestEpoch()
  let lastUnknown = null

  async function request(spec) {
    if (!isAllowedEditorProjectUrl(spec.url)) {
      throw Object.assign(new Error('blocked_url'), { code: 'blocked_url' })
    }
    const init = {
      method: spec.method,
      headers: { ...spec.headers, 'X-Editor-Storage-Version': '2' },
      signal: spec.signal,
    }
    if (spec.body instanceof Uint8Array) {
      init.body = spec.body
    } else if (typeof spec.body === 'string') {
      init.body = spec.body
    }
    let response
    try {
      response = await fetchFn(spec.url, init)
    } catch (error) {
      if (error?.name === 'AbortError') {
        const aborted = Object.assign(new Error('aborted'), { code: 'aborted', aborted: true })
        throw aborted
      }
      const classified = classifyEditorHttpError({ status: 0, offline: true })
      const wrapped = Object.assign(new Error(classified.reason || 'network_error'), {
        ...classified,
        request: spec,
      })
      if (spec.rememberUnknown) lastUnknown = spec
      wrapped.request = recoverableRequest(spec) || spec
      throw wrapped
    }
    let body = null
    try {
      const contentType = String(response.headers.get('content-type') || '')
      if (contentType.includes('application/json')) {
        body = await response.json()
      } else if (contentType.includes('application/octet-stream')) {
        body = new Uint8Array(await response.arrayBuffer())
      } else if (response.status !== 204) {
        try {
          body = await response.json()
        } catch {
          body = null
        }
      }
    } catch (error) {
      const classified = classifyEditorHttpError({
        status: response.status,
        bodyBroken: true,
      })
      const wrapped = Object.assign(new Error(classified.reason || 'body_unreadable'), {
        ...classified,
        request: spec,
        httpStatus: response.status,
        cause: error,
      })
      if (spec.rememberUnknown) lastUnknown = spec
      wrapped.request = recoverableRequest(spec) || spec
      throw wrapped
    }
    if (!response.ok) {
      const classified = classifyEditorHttpError({ status: response.status, body })
      const error = Object.assign(new Error(classified.reason || classified.code || 'request_failed'), {
        ...classified,
        body,
        request: spec,
      })
      if (classified.kind === 'unknown' && spec.rememberUnknown) lastUnknown = spec
      else if (sameRecoverable(lastUnknown, spec)) lastUnknown = null
      error.request = recoverableRequest(spec) || spec
      throw error
    }
    const alreadyImported = Boolean(spec.allowAlreadyImported && body?.already_imported === true && body?.project?.id === spec.projectId)
    if (spec.requiredOperationId && !alreadyImported && !confirmedDocumentReceipt(body, spec)) {
      lastUnknown = spec
      const frozen = recoverableRequest(spec) || spec
      throw Object.assign(new Error('Canvas creation was not confirmed.'), { kind: 'unknown', request: frozen })
    }
    if (sameRecoverable(lastUnknown, spec)) lastUnknown = null
    return {
      status: response.status,
      body,
      headers: response.headers,
    }
  }

  return {
    listEpoch,
    openEpoch,
    lastUnknown() {
      return lastUnknown
    },
    async listProjects({ signal } = {}) {
      const token = listEpoch.next()
      const maxPages = 8
      try {
        const byId = new Map()
        let omittedCount = 0
        let cursor = null
        let hasMore = false
        let nextCursor = null
        for (let page = 0; page < maxPages; page += 1) {
          const url = cursor
            ? `${VNEXT_EDITOR_API_PREFIX}?cursor=${encodeURIComponent(cursor)}`
            : VNEXT_EDITOR_API_PREFIX
          const result = await request({
            method: 'GET',
            url,
            signal,
            rememberUnknown: false,
          })
          for (const item of result.body?.projects ?? []) {
            if (item && typeof item.id === 'string' && !byId.has(item.id)) {
              byId.set(item.id, item)
            }
          }
          omittedCount += Number(result.body?.omitted_count) || 0
          hasMore = Boolean(result.body?.has_more && typeof result.body?.next_cursor === 'string' && result.body.next_cursor)
          nextCursor = hasMore ? result.body.next_cursor : null
          if (!hasMore || nextCursor === cursor || !listEpoch.isCurrent(token)) break
          cursor = nextCursor
        }
        const projects = [...byId.values()].sort((left, right) => {
          const leftTime = String(left?.updated_at ?? '')
          const rightTime = String(right?.updated_at ?? '')
          if (leftTime !== rightTime) return leftTime < rightTime ? 1 : -1
          const leftId = String(left?.id ?? '')
          const rightId = String(right?.id ?? '')
          if (leftId === rightId) return 0
          return leftId < rightId ? -1 : 1
        })
        return {
          ok: true,
          token,
          stale: !listEpoch.isCurrent(token),
          projects,
          omitted_count: omittedCount,
          ...(hasMore ? { has_more: true, next_cursor: nextCursor } : {}),
        }
      } catch (error) {
        if (error.aborted) {
          return { ok: false, aborted: true, token, stale: !listEpoch.isCurrent(token) }
        }
        return {
          ok: false,
          token,
          stale: !listEpoch.isCurrent(token),
          error,
        }
      }
    },
    cancelList() {
      return listEpoch.cancel()
    },
    async getProject(projectId, { signal, token } = {}) {
      const used = token ?? openEpoch.next()
      try {
        const result = await request({
          method: 'GET',
          url: `${VNEXT_EDITOR_API_PREFIX}/${encodeURIComponent(projectId)}`,
          signal,
        })
        return {
          ok: true,
          token: used,
          stale: !openEpoch.isCurrent(used),
          project: result.body?.project ?? null,
        }
      } catch (error) {
        if (error.aborted) {
          return { ok: false, aborted: true, token: used, stale: !openEpoch.isCurrent(used) }
        }
        return { ok: false, token: used, stale: !openEpoch.isCurrent(used), error }
      }
    },
    cancelOpen() {
      return openEpoch.cancel()
    },
    async createProjectV1({ operationId, name } = {}) {
      const payload = { operation_id: operationId || createOperationId() }
      if (name != null) payload.name = name
      const spec = {
        method: 'POST',
        url: `${VNEXT_EDITOR_API_PREFIX}/v1`,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        rememberUnknown: true,
      }
      const result = await request(spec)
      return {
        project: result.body.project,
        receipt: result.body.receipt,
        status: result.status,
      }
    },
    async upgradeCopy(projectId, { operationId, expectedRevision, name } = {}) {
      const payload = {
        operation_id: operationId || createOperationId(),
        expected_revision: expectedRevision,
      }
      if (name != null) payload.name = name
      const spec = {
        method: 'POST',
        url: `${VNEXT_EDITOR_API_PREFIX}/${encodeURIComponent(projectId)}/upgrade-copy`,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        rememberUnknown: true,
      }
      const result = await request(spec)
      return {
        project: result.body.project,
        receipt: result.body.receipt,
        status: result.status,
      }
    },
    async createBlank(projectId, { operationId, expectedRevision, name, width, height }) {
      operationId ||= createOperationId()
      const result = await request({ method: 'POST',
        url: `${VNEXT_EDITOR_API_PREFIX}/${encodeURIComponent(projectId)}/sprite-documents/blank`,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ operation_id: operationId, expected_revision: expectedRevision, name, width, height }),
        requiredOperationId: operationId, projectId,
        rememberUnknown: true })
      return { project: result.body.project, document: result.body.document, canvas: result.body.canvas,
        receipt: result.body.receipt, status: result.status }
    },
    async importGeneralSequence(projectId, {
      operationId,
      expectedRevision,
      expectedSha256,
      background = 'auto',
      appendDocumentId = null,
      sourceJobId = null,
      name,
      bytes,
      preview = false,
      signal,
    }) {
      const frozenOperationId = operationId || createOperationId()
      const query = new URLSearchParams({
        operation_id: frozenOperationId,
        expected_revision: String(expectedRevision),
        expected_sha256: expectedSha256,
        background: background || 'auto',
        preview: preview ? '1' : '0',
      })
      if (name != null) query.set('name', name)
      if (appendDocumentId) query.set('append_document_id', appendDocumentId)
      if (sourceJobId) query.set('source_job_id', sourceJobId)
      const result = await request({
        method: 'POST',
        url: `${VNEXT_EDITOR_API_PREFIX}/${encodeURIComponent(projectId)}/sprite-documents/general-sequence?${query}`,
        headers: { 'content-type': 'application/octet-stream' },
        body: bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes),
        rememberUnknown: !preview,
        requiredOperationId: preview ? undefined : frozenOperationId,
        allowAlreadyImported: Boolean(!preview && sourceJobId && !appendDocumentId),
        projectId,
        signal,
      })
      return {
        project: result.body.project,
        document: result.body.document,
        receipt: result.body.receipt,
        alreadyImported: result.body.already_imported === true,
        preview: result.body.preview === true ? result.body : null,
        status: result.status,
      }
    },
    async importMotionTimeline(projectId, {
      operationId,
      expectedRevision,
      expectedSha256,
      action = 'preview',
      kind = null,
      fileName = '',
      name,
      startSec = null,
      endSec = null,
      samplingMode = null,
      fps = null,
      stride = null,
      bytes = null,
      signal,
    }) {
      const frozenOperationId = operationId || createOperationId()
      const query = new URLSearchParams({
        operation_id: frozenOperationId,
        expected_revision: String(expectedRevision),
        expected_sha256: expectedSha256,
        action,
      })
      if (kind) query.set('kind', kind)
      if (fileName) query.set('file_name', fileName)
      if (name != null) query.set('name', name)
      if (startSec != null) query.set('start_sec', String(startSec))
      if (endSec != null) query.set('end_sec', String(endSec))
      if (samplingMode) query.set('sampling_mode', samplingMode)
      if (fps != null) query.set('fps', String(fps))
      if (stride != null) query.set('stride', String(stride))
      const isCommit = action === 'commit'
      const bodyBytes = bytes instanceof Uint8Array
        ? bytes
        : (bytes ? new Uint8Array(bytes) : new Uint8Array(0))
      const result = await request({
        method: 'POST',
        url: `${VNEXT_EDITOR_API_PREFIX}/${encodeURIComponent(projectId)}/sprite-documents/motion-import?${query}`,
        headers: { 'content-type': 'application/octet-stream' },
        body: bodyBytes,
        rememberUnknown: isCommit,
        requiredOperationId: isCommit ? frozenOperationId : undefined,
        projectId,
        signal,
      })
      return {
        project: result.body.project,
        document: result.body.document,
        canvas: result.body.canvas,
        receipt: result.body.receipt,
        probe: result.body.probe === true ? result.body : null,
        preview: result.body.preview === true ? result.body : null,
        status: result.status,
      }
    },
    async importPng(projectId, {
      operationId,
      expectedRevision,
      expectedSha256,
      name,
      bytes,
    }) {
      const query = new URLSearchParams({
        operation_id: operationId || createOperationId(),
        expected_revision: String(expectedRevision),
        expected_sha256: expectedSha256,
      })
      if (name != null) query.set('name', name)
      const spec = {
        method: 'POST',
        url: `${VNEXT_EDITOR_API_PREFIX}/${encodeURIComponent(projectId)}/sprite-documents/import-png?${query}`,
        headers: { 'content-type': 'image/png' },
        body: bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes),
        rememberUnknown: true,
      }
      const result = await request(spec)
      return {
        project: result.body.project,
        document: result.body.document,
        receipt: result.body.receipt,
        status: result.status,
      }
    },
    async importGeneratedImage(projectId, jobId, { operationId, expectedRevision, expectedSha256, name }) {
      const query = new URLSearchParams({ operation_id: operationId || createOperationId(),
        expected_revision: String(expectedRevision), expected_sha256: expectedSha256 })
      if (name != null) query.set('name', name)
      const result = await request({ method: 'POST',
        url: `${VNEXT_EDITOR_API_PREFIX}/${encodeURIComponent(projectId)}/image-generation/${encodeURIComponent(jobId)}/import?${query}`,
        rememberUnknown: true })
      return { project: result.body.project, document: result.body.document, receipt: result.body.receipt,
        alreadyImported: result.body.already_imported === true, status: result.status }
    },
    async importJpeg(projectId, {
      operationId,
      expectedRevision,
      expectedSha256,
      name,
      bytes,
    }) {
      const query = new URLSearchParams({
        operation_id: operationId || createOperationId(),
        expected_revision: String(expectedRevision),
        expected_sha256: expectedSha256,
      })
      if (name != null) query.set('name', name)
      const spec = {
        method: 'POST',
        url: `${VNEXT_EDITOR_API_PREFIX}/${encodeURIComponent(projectId)}/sprite-documents/import-jpeg?${query}`,
        headers: { 'content-type': 'image/jpeg' },
        body: bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes),
        rememberUnknown: true,
      }
      const result = await request(spec)
      return {
        project: result.body.project,
        document: result.body.document,
        receipt: result.body.receipt,
        status: result.status,
      }
    },
    async renameCanvas(projectId, canvasId, {
      operationId,
      expectedRevision,
      displayName,
    }) {
      const spec = {
        method: 'POST',
        url: `${VNEXT_EDITOR_API_PREFIX}/${encodeURIComponent(projectId)}/canvases/${encodeURIComponent(canvasId)}/rename`,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          operation_id: operationId || createOperationId(),
          expected_revision: expectedRevision,
          display_name: displayName,
        }),
        rememberUnknown: true,
      }
      const result = await request(spec)
      return {
        project: result.body.project,
        receipt: result.body.receipt,
        status: result.status,
      }
    },
    async resetCanvasName(projectId, canvasId, { operationId, expectedRevision } = {}) {
      const spec = {
        method: 'POST',
        url: `${VNEXT_EDITOR_API_PREFIX}/${encodeURIComponent(projectId)}/canvases/${encodeURIComponent(canvasId)}/reset-name`,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          operation_id: operationId || createOperationId(),
          expected_revision: expectedRevision,
        }),
        rememberUnknown: true,
      }
      const result = await request(spec)
      return { project: result.body.project, receipt: result.body.receipt, status: result.status }
    },
    async detachCanvas(projectId, canvasId, { operationId, expectedRevision } = {}) {
      const spec = {
        method: 'POST',
        url: `${VNEXT_EDITOR_API_PREFIX}/${encodeURIComponent(projectId)}/canvases/${encodeURIComponent(canvasId)}/detach`,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          operation_id: operationId || createOperationId(),
          expected_revision: expectedRevision,
        }),
        rememberUnknown: true,
      }
      const result = await request(spec)
      return { project: result.body.project, receipt: result.body.receipt, status: result.status }
    },
    async restoreCanvas(projectId, canvasId, { operationId, expectedRevision, detachOperationId } = {}) {
      const spec = {
        method: 'POST',
        url: `${VNEXT_EDITOR_API_PREFIX}/${encodeURIComponent(projectId)}/canvases/${encodeURIComponent(canvasId)}/restore`,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          operation_id: operationId || createOperationId(),
          expected_revision: expectedRevision,
          detach_operation_id: detachOperationId,
        }),
        rememberUnknown: true,
      }
      const result = await request(spec)
      return { project: result.body.project, receipt: result.body.receipt, status: result.status }
    },
    async promoteReference(projectId, {
      operationId,
      expectedRevision,
      canvasId,
      documentId,
      workingRevision,
      expectedWorkingRevision,
      frameId,
      layerId = null,
      sourceKind = 'frame_composite',
      purpose = 'frame',
      name = null,
    } = {}) {
      const frozenOperationId = operationId || createOperationId()
      const payload = {
        operation_id: frozenOperationId,
        expected_revision: expectedRevision,
        canvas_id: canvasId,
        document_id: documentId,
        working_revision: workingRevision ?? expectedWorkingRevision,
        frame_id: frameId,
        source_kind: sourceKind,
        purpose,
        ...(layerId != null ? { layer_id: layerId } : {}),
        ...(name != null ? { name } : {}),
      }
      const spec = {
        method: 'POST',
        url: `${VNEXT_EDITOR_API_PREFIX}/${encodeURIComponent(projectId)}/references`,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        rememberUnknown: true,
        projectId,
      }
      const result = await request(spec)
      const receipt = result.body?.receipt
      const project = result.body?.project
      const reference = result.body?.reference
      if (!receipt || receipt.operation_id !== frozenOperationId || receipt.project_id !== projectId
        || project?.id !== projectId || !reference?.id) {
        lastUnknown = spec
        throw Object.assign(new Error('Reference save was not confirmed.'), {
          kind: 'unknown',
          request: recoverableRequest(spec) || spec,
        })
      }
      return {
        project,
        reference,
        receipt,
        status: result.status,
      }
    },
    async revokeReference(projectId, referenceId, { operationId, expectedRevision } = {}) {
      const frozenOperationId = operationId || createOperationId()
      const spec = {
        method: 'POST',
        url: `${VNEXT_EDITOR_API_PREFIX}/${encodeURIComponent(projectId)}/references/${encodeURIComponent(referenceId)}/revoke`,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          operation_id: frozenOperationId,
          expected_revision: expectedRevision,
        }),
        rememberUnknown: true,
        projectId,
      }
      const result = await request(spec)
      const receipt = result.body?.receipt
      const project = result.body?.project
      const reference = result.body?.reference
      if (!receipt || receipt.operation_id !== frozenOperationId || receipt.project_id !== projectId
        || project?.id !== projectId || reference?.id !== referenceId || reference?.status !== 'revoked') {
        lastUnknown = spec
        throw Object.assign(new Error('Reference revocation was not confirmed.'), {
          kind: 'unknown',
          request: recoverableRequest(spec) || spec,
        })
      }
      return {
        project,
        reference,
        receipt,
        status: result.status,
      }
    },
    referencePngUrl(projectId, referenceId) {
      return `${VNEXT_EDITOR_API_PREFIX}/${encodeURIComponent(projectId)}/references/${encodeURIComponent(referenceId)}/png`
    },
    async createFromJob(projectId, {
      operationId,
      expectedRevision,
      jobId,
      expectedSha256,
      name = null,
    }) {
      const payload = {
        operation_id: operationId || createOperationId(),
        expected_revision: expectedRevision,
        source: {
          job_id: jobId,
          artifact: 'sheet',
          expected_sha256: expectedSha256,
        },
        name,
      }
      const spec = {
        method: 'POST',
        url: `${VNEXT_EDITOR_API_PREFIX}/${encodeURIComponent(projectId)}/sprite-documents/from-job`,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        rememberUnknown: true,
      }
      const result = await request(spec)
      return {
        project: result.body.project,
        document: result.body.document,
        receipt: result.body.receipt,
        status: result.status,
      }
    },
    async listDocuments(projectId) {
      const result = await request({
        method: 'GET',
        url: `${VNEXT_EDITOR_API_PREFIX}/${encodeURIComponent(projectId)}/sprite-documents`,
      })
      return result.body?.documents ?? []
    },
    async deriveWorking(projectId, { operationId, expectedRevision, sourceCanvasId, sourceDocumentId, sourceRevision, name }) {
      const result = await request({
        method: 'POST',
        url: `${VNEXT_EDITOR_API_PREFIX}/${encodeURIComponent(projectId)}/sprite-documents/derive-working`,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ operation_id: operationId, expected_revision: expectedRevision,
          source_canvas_id: sourceCanvasId, source_document_id: sourceDocumentId, source_revision: sourceRevision, name }),
      })
      return result.body
    },
    async createScopeGrant(projectId, documentId, body) {
      const result = await request({ method: 'POST',
        url: `${VNEXT_EDITOR_API_PREFIX}/${encodeURIComponent(projectId)}/sprite-documents/${encodeURIComponent(documentId)}/scope-grants`,
        headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      return result.body.grant
    },
    async getExternalBridgeStatus(projectId, { canvasId, grantId, signal } = {}) {
      const query = new URLSearchParams()
      if (canvasId) query.set('canvas_id', canvasId)
      if (grantId) query.set('grant_id', grantId)
      const suffix = query.toString() ? `?${query}` : ''
      const result = await request({
        method: 'GET',
        url: `${VNEXT_EDITOR_API_PREFIX}/${encodeURIComponent(projectId)}/external-bridge${suffix}`,
        signal,
      })
      return result.body
    },
    async connectExternalBridge(projectId, {
      operationId,
      expectedRevision,
      expectedWorkingRevision,
      canvasId,
      rect,
      allowedOperations,
    }) {
      const result = await request({
        method: 'POST',
        url: `${VNEXT_EDITOR_API_PREFIX}/${encodeURIComponent(projectId)}/external-bridge/connect`,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          operation_id: operationId || createOperationId(),
          expected_revision: expectedRevision,
          expected_working_revision: expectedWorkingRevision,
          canvas_id: canvasId,
          ...(rect ? { rect } : {}),
          ...(allowedOperations ? { allowed_operations: allowedOperations } : {}),
        }),
        rememberUnknown: true,
      })
      return result.body
    },
    async revokeExternalBridge(projectId, { grantId, checkoutId, sessionId, discardOnly } = {}) {
      const result = await request({
        method: 'POST',
        url: `${VNEXT_EDITOR_API_PREFIX}/${encodeURIComponent(projectId)}/external-bridge/revoke`,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...(grantId ? { grant_id: grantId } : {}),
          ...(checkoutId ? { checkout_id: checkoutId } : {}),
          ...(sessionId ? { session_id: sessionId } : {}),
          ...(discardOnly ? { discard_only: true } : {}),
        }),
      })
      return result.body
    },
    async createAsepriteCheckout(projectId, {
      operationId,
      grantId,
      bridgeToken,
      expectedRevision,
      expectedWorkingRevision,
      canvasId,
    }) {
      const result = await request({
        method: 'POST',
        url: `${VNEXT_EDITOR_API_PREFIX}/${encodeURIComponent(projectId)}/external-bridge/aseprite/checkout`,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          operation_id: operationId || createOperationId(),
          ...(grantId ? { grant_id: grantId } : {}),
          ...(bridgeToken ? { bridge_token: bridgeToken } : {}),
          expected_revision: expectedRevision,
          expected_working_revision: expectedWorkingRevision,
          canvas_id: canvasId,
        }),
        rememberUnknown: true,
      })
      return result.body
    },
    async returnAsepriteCheckout(projectId, checkoutId, {
      operationId,
      bridgeToken,
      expectedRevision,
      expectedWorkingRevision,
    } = {}) {
      const result = await request({
        method: 'POST',
        url: `${VNEXT_EDITOR_API_PREFIX}/${encodeURIComponent(projectId)}/external-bridge/aseprite/checkouts/${encodeURIComponent(checkoutId)}/return`,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          operation_id: operationId || createOperationId(),
          ...(bridgeToken ? { bridge_token: bridgeToken } : {}),
          ...(expectedRevision ? { expected_revision: expectedRevision } : {}),
          ...(expectedWorkingRevision ? { expected_working_revision: expectedWorkingRevision } : {}),
        }),
        rememberUnknown: true,
      })
      return result.body
    },
    async writeWorkingPixels(projectId, documentId, { operationId, expectedRevision, expectedWorkingRevision, width, height, expectedSha256, bytes, x = 0, y = 0, target, grantId, commandSha256 }) {
      const query = new URLSearchParams({ operation_id: operationId, expected_revision: expectedRevision,
        expected_working_revision: expectedWorkingRevision, x, y, w: width, h: height, expected_sha256: expectedSha256,
        ...(target || {}), ...(grantId ? { grant_id: grantId, command_sha256: commandSha256 } : {}) })
      const result = await request({ method: 'POST',
        url: `${VNEXT_EDITOR_API_PREFIX}/${encodeURIComponent(projectId)}/sprite-documents/${encodeURIComponent(documentId)}/working-pixels?${query}`,
        headers: { 'content-type': 'application/octet-stream' }, body: bytes })
      return result.body
    },
    async changeStructure(projectId, documentId, { operationId, expectedRevision, expectedWorkingRevision, command }) {
      const result = await request({ method: 'POST',
        url: `${VNEXT_EDITOR_API_PREFIX}/${encodeURIComponent(projectId)}/sprite-documents/${encodeURIComponent(documentId)}/working-structure`,
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operation_id: operationId,
          expected_revision: expectedRevision, expected_working_revision: expectedWorkingRevision, command }) })
      return result.body
    },
    async restoreWorking(projectId, documentId, { operationId, expectedRevision, expectedWorkingRevision, targetRevision, mode }) {
      const result = await request({ method: 'POST',
        url: `${VNEXT_EDITOR_API_PREFIX}/${encodeURIComponent(projectId)}/sprite-documents/${encodeURIComponent(documentId)}/restore-working`,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ operation_id: operationId, expected_revision: expectedRevision,
          expected_working_revision: expectedWorkingRevision, target_revision: targetRevision, ...(mode ? { mode } : {}) }) })
      return result.body
    },
    async getDocument(projectId, documentId) {
      const result = await request({
        method: 'GET',
        url: `${VNEXT_EDITOR_API_PREFIX}/${encodeURIComponent(projectId)}/sprite-documents/${encodeURIComponent(documentId)}`,
      })
      return result.body
    },
    async getBlock(projectId, documentId, sha256) {
      const result = await request({
        method: 'GET',
        url: `${VNEXT_EDITOR_API_PREFIX}/${encodeURIComponent(projectId)}/sprite-documents/${encodeURIComponent(documentId)}/blocks/${encodeURIComponent(sha256)}`,
      })
      return {
        bytes: result.body,
        width: Number(result.headers.get('x-sprite-block-width')),
        height: Number(result.headers.get('x-sprite-block-height')),
        sha256: result.headers.get('x-sprite-block-sha256') || sha256,
      }
    },
    async savePalette(projectId, { operationId, expectedRevision, colors, activeId, active_id, items }) {
      const payload = {
        operation_id: operationId,
        expected_revision: expectedRevision,
        colors,
        ...(Array.isArray(items) ? {
          active_id: activeId ?? active_id ?? items[0]?.id ?? 'custom',
          items,
        } : {}),
      }
      const result = await request({ method: 'POST', url: `${VNEXT_EDITOR_API_PREFIX}/${encodeURIComponent(projectId)}/palette`,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload), rememberUnknown: true })
      const receipt = result.body?.receipt, project = result.body?.project
      if (receipt?.operation_id !== operationId || receipt?.project_id !== projectId
        || receipt?.project_revision !== expectedRevision + 1 || receipt?.document_id !== null || receipt?.document_revision !== null
        || !/^[a-f0-9]{64}$/.test(receipt?.payload_sha256 || '') || project?.id !== projectId
        || !Number.isInteger(project?.revision) || project.revision < receipt.project_revision) {
        throw Object.assign(new Error('Palette save receipt is not confirmed.'), { kind: 'unknown' })
      }
      return { project, receipt, status: result.status }
    },
    async saveLayout(projectId, { operationId, expectedRevision, positions }) {
      const payload = {
        operation_id: operationId || createOperationId(),
        expected_revision: expectedRevision,
        positions,
      }
      const spec = {
        method: 'POST',
        url: `${VNEXT_EDITOR_API_PREFIX}/${encodeURIComponent(projectId)}/canvas-layout`,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        rememberUnknown: true,
      }
      const result = await request(spec)
      return {
        project: result.body.project,
        receipt: result.body.receipt,
        status: result.status,
      }
    },
    async replay(spec) {
      const bound = recoverableRequest(spec)
      if (!bound) throw Object.assign(new Error('no_bound_request'), { code: 'no_bound_request' })
      return request(bound)
    },
    async retryUnknown() {
      if (!lastUnknown) {
        throw Object.assign(new Error('no_unknown_request'), { code: 'no_unknown_request' })
      }
      return request(lastUnknown)
    },
  }
}
