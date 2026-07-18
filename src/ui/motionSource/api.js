import {
  buildMotionEnginePackProcessingOptions,
  motionEnginePackExportReadiness,
} from './enginePackExportState.js'

const TERMINAL_JOB_STATUSES = new Set(['done', 'failed_quality_gate', 'failed_post_processing', 'failed_model_error', 'failed_safety_filter'])
const DEFAULT_RELEASE_REQUEST_TIMEOUT_MS = 3000
const DEFAULT_ARTIFACT_FETCH_TIMEOUT_MS = 10000

function abortError(signal) {
  const reason = signal?.reason
  if (reason?.name === 'AbortError') return reason
  return new DOMException(reason instanceof Error ? reason.message : 'Aborted', 'AbortError')
}

function pollTimeoutError(current) {
  return Object.assign(new Error('Motion source polling timed out; resume the existing job.'), {
    code: 'poll_timeout',
    job_id: current?.id ?? null,
    job: current ?? null,
  })
}

function jobBindingError(jobId, payload) {
  return Object.assign(new Error('Motion source poll response did not match the requested job.'), {
    code: 'motion_job_binding_mismatch',
    job_id: jobId,
    received_job_id: payload?.id ?? null,
    payload,
  })
}

function resolvedDeadline(deadlineAt, timeoutMs) {
  if (Number.isFinite(deadlineAt)) return deadlineAt
  const duration = Number.isFinite(timeoutMs) ? Math.max(0, timeoutMs) : 120000
  return Date.now() + duration
}

async function withDeadline(executor, {
  signal,
  deadlineAt,
  current,
} = {}) {
  if (signal?.aborted) throw abortError(signal)
  if (Date.now() >= deadlineAt) throw pollTimeoutError(current)

  const controller = new AbortController()
  let timer = null
  let onAbort = null
  let deadlineReached = false
  const boundary = new Promise((_, reject) => {
    onAbort = () => {
      controller.abort()
      reject(abortError(signal))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    timer = setTimeout(() => {
      deadlineReached = true
      controller.abort()
      reject(pollTimeoutError(current))
    }, Math.max(0, deadlineAt - Date.now()))
  })

  try {
    const result = await Promise.race([
      Promise.resolve().then(() => executor(controller.signal)),
      boundary,
    ])
    if (signal?.aborted) throw abortError(signal)
    if (deadlineReached || Date.now() >= deadlineAt) throw pollTimeoutError(current)
    return result
  } catch (error) {
    if (signal?.aborted) throw abortError(signal)
    if (deadlineReached || Date.now() >= deadlineAt) throw pollTimeoutError(current)
    throw error
  } finally {
    if (timer !== null) clearTimeout(timer)
    if (onAbort) signal?.removeEventListener('abort', onAbort)
  }
}

function apiError(url, response, payload) {
  return Object.assign(new Error(payload.reason || payload.error || `${url} failed: ${response.status}`), {
    code: payload.code ?? payload.error ?? 'motion_source_request_failed',
    status: response.status,
    payload,
  })
}

function releaseTimeoutError(url, timeoutMs) {
  return Object.assign(new Error('Motion source release request timed out.'), {
    code: 'motion_release_timeout',
    url,
    timeout_ms: timeoutMs,
  })
}

function artifactTimeoutError(url, timeoutMs) {
  return Object.assign(new Error('Motion source artifact fetch timed out.'), {
    code: 'motion_artifact_timeout',
    url,
    timeout_ms: timeoutMs,
  })
}

function artifactUnreadableError(url) {
  return Object.assign(new Error('Motion source image artifact could not be decoded.'), {
    code: 'motion_artifact_unreadable',
    url,
  })
}

async function withArtifactFetchTimeout(url, executor, {
  signal,
  timeoutMs = DEFAULT_ARTIFACT_FETCH_TIMEOUT_MS,
} = {}) {
  if (signal?.aborted) throw abortError(signal)
  const duration = Number.isFinite(timeoutMs)
    ? Math.max(1, Math.trunc(timeoutMs))
    : DEFAULT_ARTIFACT_FETCH_TIMEOUT_MS
  const controller = new AbortController()
  let timer = null
  let onAbort = null
  let timedOut = false
  const boundary = new Promise((_, reject) => {
    onAbort = () => {
      controller.abort(signal?.reason)
      reject(abortError(signal))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    timer = setTimeout(() => {
      timedOut = true
      const error = artifactTimeoutError(url, duration)
      controller.abort(error)
      reject(error)
    }, duration)
  })
  try {
    return await Promise.race([
      Promise.resolve().then(() => executor(controller.signal)),
      boundary,
    ])
  } catch (error) {
    if (signal?.aborted) throw abortError(signal)
    if (timedOut) throw artifactTimeoutError(url, duration)
    throw error
  } finally {
    if (timer !== null) clearTimeout(timer)
    if (onAbort) signal?.removeEventListener('abort', onAbort)
  }
}

async function withReleaseRequestTimeout(url, executor, {
  signal,
  timeoutMs = DEFAULT_RELEASE_REQUEST_TIMEOUT_MS,
} = {}) {
  if (signal?.aborted) throw abortError(signal)
  const duration = Number.isFinite(timeoutMs)
    ? Math.max(1, Math.trunc(timeoutMs))
    : DEFAULT_RELEASE_REQUEST_TIMEOUT_MS
  const controller = new AbortController()
  let timer = null
  let onAbort = null
  let timedOut = false
  const boundary = new Promise((_, reject) => {
    onAbort = () => {
      controller.abort(signal?.reason)
      reject(abortError(signal))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    timer = setTimeout(() => {
      timedOut = true
      const error = releaseTimeoutError(url, duration)
      controller.abort(error)
      reject(error)
    }, duration)
  })

  try {
    return await Promise.race([
      Promise.resolve().then(() => executor(controller.signal)),
      boundary,
    ])
  } catch (error) {
    if (signal?.aborted) throw abortError(signal)
    if (timedOut) throw releaseTimeoutError(url, duration)
    throw error
  } finally {
    if (timer !== null) clearTimeout(timer)
    if (onAbort) signal?.removeEventListener('abort', onAbort)
  }
}

async function postJson(url, body, { signal } = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  const payload = await response.json()
  if (!response.ok) throw apiError(url, response, payload)
  return payload
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError(signal)
}

async function blobToBase64(blob, { signal } = {}) {
  throwIfAborted(signal)
  const buffer = await blob.arrayBuffer()
  throwIfAborted(signal)
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  throwIfAborted(signal)
  return btoa(binary)
}

async function urlToBase64(url, { signal } = {}) {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`artifact fetch failed: ${response.status}`)
  return blobToBase64(await response.blob(), { signal })
}

async function readSourceSetPayload(manifestFile, stripFiles = [], { signal } = {}) {
  if (!manifestFile) throw new Error('Source-set manifest is required')
  throwIfAborted(signal)
  const manifest = JSON.parse(await manifestFile.text())
  throwIfAborted(signal)
  const strips = await Promise.all([...stripFiles].map(async (file) => ({
    id: file.name.replace(/\.[^.]+$/, ''),
    source_name: file.name,
    source_base64: await blobToBase64(file, { signal }),
  })))
  return { manifest, strips }
}

export function createMotionOperationId(prefix = 'motion_op') {
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
  return `${prefix}_${suffix}`
}

export async function uploadMotionSource(file, { operationId = createMotionOperationId('motion_upload_op'), signal } = {}) {
  if (!file) throw new Error('Motion source file is required')
  const query = new URLSearchParams({
    source_name: file.name,
    operation_id: operationId,
  })
  const response = await fetch(`/api/motion-source/uploads?${query}`, {
    method: 'POST',
    headers: { 'content-type': file.type || 'application/octet-stream' },
    body: file,
    signal,
  })
  const payload = await response.json()
  if (!response.ok) throw apiError('/api/motion-source/uploads', response, payload)
  return payload
}

export async function releaseMotionSourceUpload(uploadId, { signal, timeoutMs } = {}) {
  const exactUploadId = String(uploadId || '')
  if (!exactUploadId) throw new Error('Motion source upload id is required')
  const url = `/api/motion-source/uploads/${encodeURIComponent(exactUploadId)}`
  return withReleaseRequestTimeout(url, async (requestSignal) => {
    const response = await fetch(url, {
      method: 'DELETE',
      signal: requestSignal,
    })
    const payload = await response.json()
    if (!response.ok) throw apiError(url, response, payload)
    return payload
  }, {
    signal,
    timeoutMs,
  })
}

export async function releaseMotionSourceUploadOperation(operationId, { signal, timeoutMs } = {}) {
  const exactOperationId = String(operationId || '')
  if (!exactOperationId) throw new Error('Motion source upload operation id is required')
  const url = `/api/motion-source/upload-operations/${encodeURIComponent(exactOperationId)}`
  return withReleaseRequestTimeout(url, async (requestSignal) => {
    const response = await fetch(url, {
      method: 'DELETE',
      signal: requestSignal,
    })
    const payload = await response.json()
    if (!response.ok) throw apiError(url, response, payload)
    return payload
  }, {
    signal,
    timeoutMs,
  })
}

function sourceOperationBody(source, operationId, options) {
  if (!source?.upload_id || !source?.source_identity) throw new Error('Uploaded Motion source descriptor is required')
  return {
    source_upload_id: source.upload_id,
    source_identity: source.source_identity,
    operation_id: operationId,
    ...(options ? { options } : {}),
  }
}

export async function analyzeMotionSource(source, { operationId = createMotionOperationId('motion_analyze_op'), signal } = {}) {
  return postJson('/api/analyze-motion-source', sourceOperationBody(source, operationId), { signal })
}

export async function fetchMotionSourceToolStatus() {
  const response = await fetch('/api/motion-source-tool-status')
  if (!response.ok) throw new Error(`tool status failed: ${response.status}`)
  return response.json()
}

export async function previewMotionFrames(source, options, { operationId = createMotionOperationId('motion_preview_op'), signal } = {}) {
  return postJson('/api/preview-motion-frames', sourceOperationBody(source, operationId, options), { signal })
}

export async function buildMotionStrip(source, options, { operationId = createMotionOperationId('motion_build_op'), signal } = {}) {
  return postJson('/api/build-motion-strip', sourceOperationBody(source, operationId, options), { signal })
}

export async function applyMotionStrip({ sheetFile, stripFile, stripUrl, options }, { signal } = {}) {
  if (!sheetFile) throw new Error('Target normalized sheet is required')
  if (!stripFile && !stripUrl) throw new Error('Build a strip or upload an edited strip first')
  const stripBase64 = stripFile
    ? await blobToBase64(stripFile, { signal })
    : await urlToBase64(stripUrl, { signal })
  return postJson('/api/apply-motion-strip', {
    sheet_base64: await blobToBase64(sheetFile, { signal }),
    strip_base64: stripBase64,
    options,
  }, { signal })
}

export async function buildMotionEnginePacksFromAppliedSheet({
  applyJob,
  applyReport,
  applyResultStale = false,
  applyArtifactError = null,
}, { signal } = {}) {
  const readiness = motionEnginePackExportReadiness({
    applyJob,
    applyReport,
    applyResultStale,
    applyArtifactError,
  })
  if (!readiness.ready) {
    throw Object.assign(
      new Error(`Applied Motion sheet is not ready for engine package processing: ${readiness.reason}`),
      { code: readiness.reason }
    )
  }
  return postJson('/api/process-sheet', {
    source_base64: await urlToBase64(readiness.binding.applied_sheet_url, { signal }),
    source_black_base64: null,
    options: buildMotionEnginePackProcessingOptions(),
  }, { signal })
}

export async function analyzeMotionSourceSet({ manifestFile, stripFiles }, { signal } = {}) {
  const payload = await readSourceSetPayload(manifestFile, stripFiles, { signal })
  return postJson('/api/analyze-motion-source-set', {
    ...payload,
  }, { signal })
}

export async function applyMotionSourceSet({ sheetFile, manifestFile, stripFiles, options }, { signal } = {}) {
  if (!sheetFile) throw new Error('Target normalized sheet is required')
  const payload = await readSourceSetPayload(manifestFile, stripFiles, { signal })
  return postJson('/api/apply-motion-source-set', {
    sheet_base64: await blobToBase64(sheetFile, { signal }),
    ...payload,
    options,
  }, { signal })
}

export async function pollMotionSourceJob(jobId, {
  signal,
  deadlineAt = null,
  timeoutMs = 120000,
  currentJob = null,
} = {}) {
  const exactJobId = String(jobId || '')
  if (!exactJobId) throw new Error('Motion source job id is required')
  const current = currentJob ?? { id: exactJobId, status: 'queued' }
  const deadline = resolvedDeadline(deadlineAt, timeoutMs)
  const payload = await withDeadline(async (requestSignal) => {
    const response = await fetch(`/api/jobs/${encodeURIComponent(exactJobId)}`, { signal: requestSignal })
    const body = await response.json()
    if (!response.ok) throw apiError(`/api/jobs/${exactJobId}`, response, body)
    return body
  }, {
    signal,
    deadlineAt: deadline,
    current,
  })
  if (payload.status === 'not_found') {
    throw apiError(`/api/jobs/${exactJobId}`, { status: 404 }, {
      error: 'motion_job_not_found',
      reason: 'Motion source job is unavailable in this server session.',
    })
  }
  if (String(payload.id || '') !== exactJobId) throw jobBindingError(exactJobId, payload)
  return payload
}

async function wait(delayMs, { signal, deadlineAt, current } = {}) {
  return withDeadline((waitSignal) => new Promise((resolve, reject) => {
    if (waitSignal.aborted) return reject(new DOMException('Aborted', 'AbortError'))
    const timer = setTimeout(() => {
      waitSignal.removeEventListener('abort', onAbort)
      resolve()
    }, Math.max(0, delayMs))
    const onAbort = () => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    waitSignal.addEventListener('abort', onAbort, { once: true })
  }), {
    signal,
    deadlineAt,
    current,
  })
}

export async function waitForMotionSourceJob(job, {
  onUpdate = () => {},
  signal,
  timeoutMs = 120000,
  pollMs = 500,
  refreshFirst = false,
} = {}) {
  const exactJobId = String(job?.id || '')
  if (!exactJobId) return job
  let current = job
  const deadlineAt = resolvedDeadline(null, timeoutMs)
  if (String(current.id || '') !== exactJobId) throw jobBindingError(exactJobId, current)
  if (!refreshFirst) onUpdate(current)
  let shouldRefresh = refreshFirst
  while (shouldRefresh || !TERMINAL_JOB_STATUSES.has(current.status)) {
    if (!shouldRefresh) {
      await wait(pollMs, { signal, deadlineAt, current })
    }
    current = await pollMotionSourceJob(exactJobId, {
      signal,
      deadlineAt,
      currentJob: current,
    })
    onUpdate(current)
    shouldRefresh = false
  }
  return current
}

export async function cancelMotionSourceJob(jobId, { signal } = {}) {
  if (!jobId) throw new Error('Motion source job id is required')
  return postJson(`/api/motion-source/jobs/${encodeURIComponent(jobId)}/cancel`, {}, { signal })
}

export async function fetchJsonArtifact(url, {
  signal,
  timeoutMs = DEFAULT_ARTIFACT_FETCH_TIMEOUT_MS,
} = {}) {
  if (!url) return null
  return withArtifactFetchTimeout(url, async (requestSignal) => {
    const response = await fetch(url, { signal: requestSignal })
    if (!response.ok) throw new Error(`artifact fetch failed: ${response.status}`)
    return response.json()
  }, {
    signal,
    timeoutMs,
  })
}

export async function fetchImageArtifact(url, {
  signal,
  timeoutMs = DEFAULT_ARTIFACT_FETCH_TIMEOUT_MS,
} = {}) {
  if (!url) return null
  return withArtifactFetchTimeout(url, async (requestSignal) => {
    const response = await fetch(url, { signal: requestSignal })
    if (!response.ok) throw new Error(`artifact fetch failed: ${response.status}`)
    const blob = await response.blob()
    throwIfAborted(requestSignal)
    if (!blob?.size) throw artifactUnreadableError(url)

    if (typeof globalThis.createImageBitmap === 'function') {
      let bitmap = null
      try {
        bitmap = await globalThis.createImageBitmap(blob)
        throwIfAborted(requestSignal)
        if (!(bitmap.width > 0) || !(bitmap.height > 0)) {
          throw artifactUnreadableError(url)
        }
        return {
          width: bitmap.width,
          height: bitmap.height,
          size: blob.size,
          content_type: blob.type || null,
        }
      } catch (error) {
        if (error?.name === 'AbortError') throw error
        if (error?.code === 'motion_artifact_unreadable') throw error
        throw artifactUnreadableError(url)
      } finally {
        bitmap?.close?.()
      }
    }

    if (
      typeof globalThis.Image === 'function' &&
      typeof globalThis.URL?.createObjectURL === 'function'
    ) {
      const objectUrl = globalThis.URL.createObjectURL(blob)
      try {
        const dimensions = await new Promise((resolve, reject) => {
          const image = new globalThis.Image()
          const cleanup = () => {
            requestSignal.removeEventListener('abort', onAbort)
            image.onload = null
            image.onerror = null
          }
          const onAbort = () => {
            cleanup()
            image.src = ''
            reject(abortError(requestSignal))
          }
          image.onload = () => {
            const result = {
              width: image.naturalWidth,
              height: image.naturalHeight,
            }
            cleanup()
            if (!(result.width > 0) || !(result.height > 0)) {
              reject(artifactUnreadableError(url))
              return
            }
            resolve(result)
          }
          image.onerror = () => {
            cleanup()
            reject(artifactUnreadableError(url))
          }
          requestSignal.addEventListener('abort', onAbort, { once: true })
          if (requestSignal.aborted) {
            onAbort()
            return
          }
          image.src = objectUrl
        })
        return {
          ...dimensions,
          size: blob.size,
          content_type: blob.type || null,
        }
      } finally {
        globalThis.URL.revokeObjectURL(objectUrl)
      }
    }

    const header = new Uint8Array(await blob.slice(0, 32).arrayBuffer())
    const trailer = new Uint8Array(
      await blob.slice(Math.max(0, blob.size - 2), blob.size).arrayBuffer()
    )
    throwIfAborted(requestSignal)
    const view = new DataView(header.buffer, header.byteOffset, header.byteLength)
    const isPng =
      header.length >= 24 &&
      header[0] === 0x89 &&
      header[1] === 0x50 &&
      header[2] === 0x4e &&
      header[3] === 0x47 &&
      header[4] === 0x0d &&
      header[5] === 0x0a &&
      header[6] === 0x1a &&
      header[7] === 0x0a &&
      header[12] === 0x49 &&
      header[13] === 0x48 &&
      header[14] === 0x44 &&
      header[15] === 0x52 &&
      view.getUint32(16) > 0 &&
      view.getUint32(20) > 0
    const isGif =
      header.length >= 10 &&
      header[0] === 0x47 &&
      header[1] === 0x49 &&
      header[2] === 0x46 &&
      header[3] === 0x38 &&
      (header[4] === 0x37 || header[4] === 0x39) &&
      header[5] === 0x61 &&
      view.getUint16(6, true) > 0 &&
      view.getUint16(8, true) > 0
    const isJpeg =
      header.length >= 4 &&
      header[0] === 0xff &&
      header[1] === 0xd8 &&
      trailer[0] === 0xff &&
      trailer[1] === 0xd9
    const isWebp =
      header.length >= 12 &&
      header[0] === 0x52 &&
      header[1] === 0x49 &&
      header[2] === 0x46 &&
      header[3] === 0x46 &&
      header[8] === 0x57 &&
      header[9] === 0x45 &&
      header[10] === 0x42 &&
      header[11] === 0x50
    if (!isPng && !isGif && !isJpeg && !isWebp) {
      throw artifactUnreadableError(url)
    }
    return {
      width: null,
      height: null,
      size: blob.size,
      content_type: blob.type || null,
    }
  }, {
    signal,
    timeoutMs,
  })
}
