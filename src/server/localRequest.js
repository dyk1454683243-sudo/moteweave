// Shared by the real server and the independently mounted editor API.
export const LEGACY_JSON_LIMIT = 16 * 1024 * 1024
const reject = (code, status, message = code) => { throw Object.assign(new Error(message), { code, http_status: status }) }
export const mediaType = req => String(req.headers?.['content-type'] || '').split(';')[0].trim().toLowerCase()

export function assertLocalRequest(req) {
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1', ':ffff:127.0.0.1'].includes(req.socket?.remoteAddress)) {
    reject('forbidden_origin', 403)
  }
  let expected
  try { expected = new URL(`${req.socket?.encrypted ? 'https' : 'http'}://${req.headers?.host}`) } catch { reject('forbidden_origin', 403) }
  if (!['localhost', '127.0.0.1', '[::1]'].includes(expected.hostname)
    || expected.username || expected.password || expected.pathname !== '/' || expected.search || expected.hash) reject('forbidden_origin', 403)
  for (const key of ['origin', 'referer']) {
    const value = req.headers?.[key]
    if (value == null) continue // Native local clients do not send browser origins.
    let actual
    try { actual = new URL(value) } catch { reject('forbidden_origin', 403) }
    if (actual.origin !== expected.origin || actual.username || actual.password) reject('forbidden_origin', 403)
  }
}

export function assertJsonRequest(req) {
  if (mediaType(req) !== 'application/json') reject('unsupported_media_type', 415)
}

export function assertApiRequest(req, pathname) {
  assertLocalRequest(req)
  if (!['POST', 'PUT', 'PATCH'].includes(req.method)) return
  const binary = pathname === '/api/motion-source/uploads'
    || /^\/api\/editor\/projects\/[^/]+\/sprite-documents\/(?:import-png|import-jpeg|general-sequence|motion-import)$/.test(pathname)
    || /\/working-pixels$/.test(pathname)
  const empty = !req.headers?.['transfer-encoding'] && Number(req.headers?.['content-length'] || 0) === 0
  // Import-by-receipt, cancellation and release intentionally have no JSON body.
  const emptyCommand = /\/cancel$/.test(pathname)
    || /^\/api\/editor\/projects\/[^/]+\/image-generation\/[^/]+\/import$/.test(pathname)
  if (!binary && !(empty && emptyCommand)) assertJsonRequest(req)
}

export async function readBoundedBody(req, maxBytes = LEGACY_JSON_LIMIT) {
  const length = req.headers?.['content-length']
  if (length != null && (!/^\d+$/.test(String(length)) || !Number.isSafeInteger(Number(length)))) reject('invalid_content_length', 400)
  if (length != null && Number(length) > maxBytes) { req.resume?.(); reject('request_too_large', 413) }
  let size = 0
  const chunks = []
  // Do not destroy the HTTP socket before its bounded error response can be sent.
  for await (const chunk of req.iterator ? req.iterator({ destroyOnReturn: false }) : req) {
    size += chunk.length
    if (size > maxBytes) { req.resume?.(); reject('request_too_large', 413) }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks, size)
}
