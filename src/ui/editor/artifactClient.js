function unsafeArtifactUrlError() {
  const error = new Error('repair artifact URL is outside the controlled allowlist')
  error.code = 'unsafe_artifact_path'
  return error
}

function safeRelativePath(value, { rejectGeneratedRoot = false } = {}) {
  let decoded
  try {
    decoded = decodeURIComponent(value)
  } catch {
    return false
  }
  if (!decoded || decoded.includes('%') || decoded.startsWith('/') || decoded.startsWith('~') || /^[a-z]:/i.test(decoded)) return false
  if (decoded.includes('\\') || decoded.includes('\0') || decoded.includes('?') || decoded.includes('#')) return false
  const segments = decoded.split('/')
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) return false
  if (rejectGeneratedRoot && segments[0] === 'generated') return false
  return true
}

function isSafeManagedUrl(value) {
  const prefix = '/api/editor/artifact?path='
  if (!value.startsWith(prefix)) return false
  const encodedPath = value.slice(prefix.length)
  if (!encodedPath || encodedPath.includes('&') || encodedPath.includes('#')) return false
  try {
    if (encodeURIComponent(decodeURIComponent(encodedPath)) !== encodedPath) return false
  } catch {
    return false
  }
  return safeRelativePath(encodedPath, { rejectGeneratedRoot: true })
}

function generatedUrlJobId(value) {
  if (!value.startsWith('/generated/') || value.includes('%') || value.includes('?') || value.includes('#') || value.includes('\\')) return null
  const segments = value.slice(1).split('/')
  if (segments.length !== 3 || segments[0] !== 'generated') return null
  if (!segments.slice(1).every((segment) => /^[a-z0-9][a-z0-9._-]*$/i.test(segment) && segment !== '.' && segment !== '..')) return null
  return segments[1]
}

function generatedQualityGateSessionId(value) {
  if (!value.startsWith('/generated/frame-repair-quality-gates/') || value.includes('%') ||
      value.includes('?') || value.includes('#') || value.includes('\\')) return null
  const segments = value.slice(1).split('/')
  if (segments.length !== 4 || segments[0] !== 'generated' ||
      segments[1] !== 'frame-repair-quality-gates') return null
  const sessionId = segments[2]
  const fileName = segments[3]
  if (!/^frqg_[a-z0-9][a-z0-9_-]{15,79}$/.test(sessionId)) return null
  const fixed = new Set([
    'session_plan.json', 'blind_order.json', 'frame_repair_quality_gate.json',
    'frame_repair_quality_gate.md', 'frame_repair_quality_gate_contact_sheet.png',
    'artifact_manifest.json',
  ])
  const caseFile = /^case_[a-z0-9][a-z0-9_-]{0,63}_(?:review|outcome)\.json$/.test(fileName)
  return fixed.has(fileName) || caseFile ? sessionId : null
}

function assertControlledUrl(identity, url, allowedManagedUrls, allowedGeneratedUrls) {
  const value = String(url ?? '')
  if (isSafeManagedUrl(value) && allowedManagedUrls.has(value)) return value
  const jobId = generatedUrlJobId(value)
  if (jobId && identity === `job:${jobId}` && allowedGeneratedUrls.has(value)) return value
  const sessionId = generatedQualityGateSessionId(value)
  if (sessionId && identity === `quality-gate:${sessionId}` && allowedGeneratedUrls.has(value)) {
    return value
  }
  throw unsafeArtifactUrlError()
}

function repairArtifactError(error) {
  if (error instanceof SyntaxError || error?.name === 'AbortError' || error?.name === 'RepairArtifactError') return error
  const wrapped = new Error(error?.message || String(error || 'artifact request failed'))
  wrapped.name = 'RepairArtifactError'
  wrapped.status = null
  wrapped.code = 'artifact_request_failed'
  wrapped.details = null
  return wrapped
}

async function artifactHttpError(response) {
  let body = {}
  try {
    const text = await response.text()
    const parsed = text ? JSON.parse(text) : {}
    body = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    body = {}
  }
  const controlledCode = ['artifact_not_found', 'unsafe_artifact_path'].includes(body.error)
    ? body.error
    : 'artifact_request_failed'
  const reason = typeof body.reason === 'string' && body.reason
    ? body.reason
    : `artifact request failed: ${response.status}`
  const error = new Error(reason)
  error.name = 'RepairArtifactError'
  error.status = response.status
  error.code = controlledCode
  error.details = body.details && typeof body.details === 'object' && !Array.isArray(body.details)
    ? body.details
    : null
  return error
}

export function createRepairArtifactClient({
  fetchImpl = globalThis.fetch,
  decodeImage = (blob) => createImageBitmap(blob),
} = {}) {
  const cache = new Map()
  const identities = new Map()

  function remember(identity, key) {
    if (!identities.has(identity)) identities.set(identity, new Set())
    identities.get(identity).add(key)
  }

  function cached(identity, url, allowedManagedUrls, allowedGeneratedUrls, loader) {
    const controlledUrl = assertControlledUrl(identity, url, allowedManagedUrls, allowedGeneratedUrls)
    const key = `${identity}\0${controlledUrl}`
    if (!cache.has(key)) {
      let promise
      promise = Promise.resolve()
        .then(() => loader(controlledUrl))
        .catch((error) => {
          if (cache.get(key) === promise) {
            cache.delete(key)
            identities.get(identity)?.delete(key)
          }
          throw repairArtifactError(error)
        })
      cache.set(key, promise)
      remember(identity, key)
    }
    return cache.get(key)
  }

  function loadJson({
    identity,
    url,
    allowedManagedUrls = new Set(),
    allowedGeneratedUrls = new Set(),
    signal,
  }) {
    return cached(identity, url, allowedManagedUrls, allowedGeneratedUrls, async (controlledUrl) => {
      const response = await fetchImpl(controlledUrl, { signal })
      if (!response.ok) throw await artifactHttpError(response)
      return response.json()
    })
  }

  function loadImage({
    identity,
    url,
    allowedManagedUrls = new Set(),
    allowedGeneratedUrls = new Set(),
    signal,
  }) {
    return cached(identity, url, allowedManagedUrls, allowedGeneratedUrls, async (controlledUrl) => {
      const response = await fetchImpl(controlledUrl, { signal })
      if (!response.ok) throw await artifactHttpError(response)
      return decodeImage(await response.blob())
    })
  }

  function clear(identity) {
    for (const key of identities.get(identity) ?? []) cache.delete(key)
    identities.delete(identity)
  }

  return Object.freeze({
    loadJson,
    loadImage,
    clearRepairArtifactCache: clear,
  })
}
