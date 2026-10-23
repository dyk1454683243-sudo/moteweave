import { createHash, createHmac, randomBytes } from 'node:crypto'
import { createRuntimeRecords } from './runtimeRecords.js'
import { pixelDocumentTarget, pixelRectInside } from './pixelDocumentTarget.js'
import { pixelLinkScope } from './pixelLinks.js'
import { spriteDocumentError, payloadSha256 } from './spriteDocumentValidation.js'

const defaultRecords = createRuntimeRecords()
const RUNTIME_BRIDGE_SECRET = randomBytes(32)
export const PIXEL_SCOPE_OPERATIONS = ['replace-color', 'fill-rect', 'erase', 'pencil', 'eraser', 'line', 'rectangle', 'flood-fill', 'text', 'working_pixels', 'read_region', 'patch_region', 'read_canvas', 'draw_pixels', 'undo_pixels', 'pixel_tools']
export const EXTERNAL_BRIDGE_OPERATIONS = Object.freeze(['read_region', 'patch_region', 'read_canvas', 'draw_pixels', 'undo_pixels', 'external_file_import'])
const ALL_STORED_GRANT_OPERATIONS = Object.freeze([...new Set([...PIXEL_SCOPE_OPERATIONS, ...EXTERNAL_BRIDGE_OPERATIONS])])
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const hex64 = /^[a-f0-9]{64}$/
const tokenSha256 = token => createHash('sha256').update(String(token || ''), 'utf8').digest('hex')
const deriveBridgeToken = (grantId, payloadSha) => `btok_${createHmac('sha256', RUNTIME_BRIDGE_SECRET).update(`${grantId}:${payloadSha}`, 'utf8').digest('hex').slice(0, 48)}`
const digest = payloadSha256
const commandDigest = (target, rect, sha256, linkScope) => digest({ frame_id: target.frame_id, layer_id: target.layer_id, cel_id: target.cel_id,
  rect, sha256, ...(linkScope ? { link_scope: linkScope } : {}) })
const reject = (message, code = 'invalid_request') => { throw spriteDocumentError(code, message) }
const resolveTarget = (manifest, target) => { try { return pixelDocumentTarget(manifest, target, { writable: true }) } catch (error) { reject(error.message, 'unsupported_input') } }
const exact = (value, keys) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) reject('Invalid scope grant fields.')
}

// Called under the existing project mutation lock; grant records never publish a pixel revision.
export async function issuePixelScopeGrant(scope, project, manifest, body, { records = defaultRecords } = {}) {
  exact(body, ['operation_id', 'expected_revision', 'expected_working_revision', 'frame_id', 'layer_id', 'cel_id', 'rect', 'allowed_operations', 'command', 'link_scope'])
  if (!uuid.test(body.operation_id || '')) reject('Invalid grant operation.')
  exact(body.rect, ['x', 'y', 'w', 'h'])
  const target = { frame_id: body.frame_id, layer_id: body.layer_id, cel_id: body.cel_id }
  if (Object.values(target).some(v => typeof v !== 'string' || !v)) reject('An explicit cel is required.')
  const { cel } = resolveTarget(manifest, target)
  let requestedLinks
  if (body.link_scope !== undefined) {
    exact(body.link_scope, ['group_id', 'cel_ids'])
    if (typeof body.link_scope.group_id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(body.link_scope.group_id)
      || !Array.isArray(body.link_scope.cel_ids) || !body.link_scope.cel_ids.length || body.link_scope.cel_ids.length > 256
      || body.link_scope.cel_ids.some(id => typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id))
      || new Set(body.link_scope.cel_ids).size !== body.link_scope.cel_ids.length) reject('Invalid linked scope.')
    requestedLinks = { group_id: body.link_scope.group_id, cel_ids: [...body.link_scope.cel_ids].sort() }
  }
  if (!pixelRectInside(body.rect, { x: 0, y: 0, w: manifest.canvas.w, h: manifest.canvas.h })) reject('Selection exceeds the canvas.')
  if (!Array.isArray(body.allowed_operations) || !body.allowed_operations.length || body.allowed_operations.length > PIXEL_SCOPE_OPERATIONS.length
    || body.allowed_operations.some(v => !PIXEL_SCOPE_OPERATIONS.includes(v)) || new Set(body.allowed_operations).size !== body.allowed_operations.length) reject('Invalid allowed operations.')
  const rect = { x: body.rect.x, y: body.rect.y, w: body.rect.w, h: body.rect.h }
  let command = null
  if (body.command !== undefined) {
    exact(body.command, ['rect', 'sha256']); exact(body.command.rect, ['x', 'y', 'w', 'h'])
    if (!body.allowed_operations.includes('working_pixels') || !hex64.test(body.command.sha256 || '')
      || !pixelRectInside(body.command.rect, rect)) reject('Pixel command exceeds the selection.')
    command = { rect: { x: body.command.rect.x, y: body.command.rect.y, w: body.command.rect.w, h: body.command.rect.h }, sha256: body.command.sha256 }
  }
  const input = { operation_id: body.operation_id, project_id: project.id, document_id: manifest.document_id,
    expected_revision: body.expected_revision, expected_working_revision: body.expected_working_revision, ...target,
    rect, allowed_operations: [...body.allowed_operations].sort(), command, ...(requestedLinks ? { link_scope: requestedLinks } : {}) }
  const grant_id = `grant_${body.operation_id.replaceAll('-', '')}`, payload_sha256 = digest(input)
  const existing = await records.get(scope, 'grants', grant_id)
  if (existing) {
    if (existing.payload_sha256 !== payload_sha256) reject('Grant operation was reused with different content.', 'operation_conflict')
    return existing
  }
  if (project.revision !== body.expected_revision || manifest.revision !== body.expected_working_revision) reject('The selection version changed.', 'stale_revision')
  const linked = pixelLinkScope(manifest, cel.id)
  if (digest(requestedLinks || null) !== digest(linked)) reject('Explicit authorization for the complete linked group is required.')
  const grant = { ...input, grant_id, payload_sha256, command_sha256: command ? commandDigest(target, command.rect, command.sha256, linked) : null,
    read_dependencies: (linked?.cel_ids || [cel.id]).map(cel_id => ({ document_id: manifest.document_id, revision: manifest.revision, cel_id, block_sha256: manifest.cels[cel_id].block?.sha256 || null })) }
  await records.put(scope, 'grants', grant_id, grant)
  return grant
}

export async function issueExternalBridgeGrant(scope, project, manifest, body, { records = defaultRecords, now = Date.now, ttlMs = 15 * 60 * 1000 } = {}) {
  exact(body, ['operation_id', 'canvas_id', 'expected_revision', 'expected_working_revision', 'frame_id', 'layer_id', 'cel_id', 'rect', 'allowed_operations', 'source_sha256'])
  if (!uuid.test(body.operation_id || '')) reject('Invalid grant operation.')
  if (typeof body.canvas_id !== 'string' || !body.canvas_id || project.canvases?.[body.canvas_id]?.document_id !== manifest.document_id) {
    reject('Grant canvas does not match the selected document.')
  }
  if (typeof body.source_sha256 !== 'string' || !hex64.test(body.source_sha256)) {
    reject('A valid source_sha256 is required.')
  }
  const requestedRect = body.rect ?? { x: 0, y: 0, w: manifest.canvas.w, h: manifest.canvas.h }
  exact(requestedRect, ['x', 'y', 'w', 'h'])
  if (!pixelRectInside(requestedRect, { x: 0, y: 0, w: manifest.canvas.w, h: manifest.canvas.h })) {
    reject('Selection exceeds the canvas.')
  }
  const ops = body.allowed_operations ?? [...EXTERNAL_BRIDGE_OPERATIONS]
  if (!Array.isArray(ops) || !ops.length || ops.length > EXTERNAL_BRIDGE_OPERATIONS.length
    || ops.some(v => !EXTERNAL_BRIDGE_OPERATIONS.includes(v)) || new Set(ops).size !== ops.length) {
    reject('Invalid external bridge operations.')
  }
  const target = { frame_id: body.frame_id, layer_id: body.layer_id, cel_id: body.cel_id }
  if (Object.values(target).some(v => typeof v !== 'string' || !v)) reject('An explicit cel is required.')
  const { cel } = resolveTarget(manifest, target)
  const linked = pixelLinkScope(manifest, cel.id)
  if (linked) reject('Linked cels are not supported in external bridge first delivery.', 'unsupported_input')
  const rect = { x: requestedRect.x, y: requestedRect.y, w: requestedRect.w, h: requestedRect.h }
  const input = {
    operation_id: body.operation_id,
    project_id: project.id,
    document_id: manifest.document_id,
    canvas_id: body.canvas_id,
    expected_revision: body.expected_revision,
    expected_working_revision: body.expected_working_revision,
    ...target,
    rect,
    allowed_operations: [...ops].sort(),
    source_sha256: body.source_sha256,
    command: null,
  }
  const grant_id = `grant_${body.operation_id.replaceAll('-', '')}`
  const payload_sha256 = digest(input)
  const existing = await records.get(scope, 'grants', grant_id)
  if (existing) {
    if (existing.payload_sha256 !== payload_sha256) reject('Grant operation was reused with different content.', 'operation_conflict')
    await verifyExternalBridgeGrant(scope, project, manifest, {
      grantId: grant_id,
      requireToken: false,
      records,
      now,
    })
    const replayedToken = deriveBridgeToken(grant_id, payload_sha256)
    if (existing.bridge_token_sha256 && tokenSha256(replayedToken) !== existing.bridge_token_sha256) {
      throw Object.assign(new Error('The external tool grant expired across server restarts.'), { code: 'pixel_tool_session_expired', http_status: 409 })
    }
    return { grant: existing, bridge_token: replayedToken, replayed: true }
  }
  if (project.revision !== body.expected_revision || manifest.revision !== body.expected_working_revision) {
    reject('The selection version changed.', 'stale_revision')
  }
  const nowMs = now()
  const bridgeToken = deriveBridgeToken(grant_id, payload_sha256)
  const grant = {
    ...input,
    grant_id,
    payload_sha256,
    command_sha256: null,
    read_dependencies: [{
      document_id: manifest.document_id,
      revision: manifest.revision,
      cel_id: cel.id,
      block_sha256: manifest.cels[cel.id].block?.sha256 || null,
    }],
    bridge_token_sha256: tokenSha256(bridgeToken),
    created_at: new Date(nowMs).toISOString(),
    expires_at: new Date(nowMs + ttlMs).toISOString(),
    revoked_at: null,
  }
  await records.put(scope, 'grants', grant_id, grant)
  return { grant, bridge_token: bridgeToken, replayed: false }
}

export async function readPixelScopeGrant(scope, project, manifest, grantId, { records = defaultRecords, now = Date.now, allowExternalBridge = true } = {}) {
  if (!/^grant_[a-f0-9]{32}$/i.test(grantId || '')) reject('A scope grant is required.')
  const grant = await records.get(scope, 'grants', grantId)
  if (!grant || grant.project_id !== project.id || grant.document_id !== manifest.document_id) reject('Scope grant belongs to another selection.')
  if (grant.revoked_at) reject('Scope grant was revoked.', 'grant_revoked')
  if (grant.expires_at) {
    const expiresMs = Date.parse(grant.expires_at)
    if (!Number.isFinite(expiresMs) || now() > expiresMs) reject('Scope grant expired.', 'grant_expired')
  }
  const {
    grant_id,
    payload_sha256,
    command_sha256,
    read_dependencies,
    bridge_token_sha256,
    created_at,
    expires_at,
    revoked_at,
    ...input
  } = grant
  const allowedPool = allowExternalBridge ? ALL_STORED_GRANT_OPERATIONS : PIXEL_SCOPE_OPERATIONS
  if (grant_id !== grantId || !uuid.test(grant.operation_id || '') || digest(input) !== payload_sha256
    || !Array.isArray(grant.allowed_operations) || !grant.allowed_operations.length || grant.allowed_operations.some(v => !allowedPool.includes(v))
    || !pixelRectInside(grant.rect, { x: 0, y: 0, w: manifest.canvas.w, h: manifest.canvas.h })
    || !Array.isArray(read_dependencies) || !read_dependencies.length) reject('Invalid stored scope grant.')
  if (grant.expected_revision !== project.revision || grant.expected_working_revision !== manifest.revision) reject('Scope grant is stale.', 'stale_revision')
  const { cel } = resolveTarget(manifest, grant)
  const linked = pixelLinkScope(manifest, cel.id)
  if (digest(grant.link_scope || null) !== digest(linked)) reject('The linked selection changed.', 'stale_revision')
  const expectedDependencies = (linked?.cel_ids || [cel.id]).map(cel_id => ({ document_id: manifest.document_id, revision: manifest.revision,
    cel_id, block_sha256: manifest.cels[cel_id].block?.sha256 || null }))
  if (digest(read_dependencies) !== digest(expectedDependencies)) reject('Scope dependency changed.', 'stale_revision')
  if (grant.command && (!pixelRectInside(grant.command.rect, grant.rect)
    || commandDigest(grant, grant.command.rect, grant.command.sha256, linked) !== command_sha256)) reject('Invalid stored pixel command.')
  return grant
}

export async function verifyExternalBridgeGrant(scope, project, manifest, {
  grantId,
  bridgeToken = null,
  requireToken = true,
  requiredOperation = null,
  records = defaultRecords,
  now = Date.now,
} = {}) {
  let grant
  try {
    grant = await readPixelScopeGrant(scope, project, manifest, grantId, { records, now, allowExternalBridge: true })
  } catch (error) {
    if (error?.code === 'grant_revoked') {
      throw Object.assign(new Error('The external tool grant was revoked.'), { code: 'pixel_tool_grant_revoked', http_status: 403 })
    }
    if (error?.code === 'grant_expired') {
      throw Object.assign(new Error('The external tool grant expired.'), { code: 'pixel_tool_session_expired', http_status: 409 })
    }
    if (error?.code === 'stale_revision') {
      throw Object.assign(new Error('The canvas changed since the external grant was issued.'), { code: 'pixel_tool_context_changed', http_status: 409 })
    }
    throw Object.assign(new Error('A valid external tool grant is required.'), { code: 'pixel_tool_unauthorized', http_status: 403 })
  }
  if (requireToken && grant.bridge_token_sha256) {
    if (typeof bridgeToken !== 'string' || !bridgeToken || tokenSha256(bridgeToken) !== grant.bridge_token_sha256) {
      throw Object.assign(new Error('A valid external bridge token is required.'), { code: 'pixel_tool_unauthorized', http_status: 403 })
    }
  }
  if (requiredOperation && !grant.allowed_operations.includes(requiredOperation)) {
    throw Object.assign(new Error(`Grant does not allow ${requiredOperation}.`), { code: 'pixel_tool_unauthorized', http_status: 403 })
  }
  return grant
}

export async function revokePixelScopeGrant(scope, grantId, { records = defaultRecords, now = Date.now } = {}) {
  if (!/^grant_[a-f0-9]{32}$/i.test(grantId || '')) reject('A scope grant is required.')
  const grant = await records.get(scope, 'grants', grantId)
  if (!grant || grant.project_id !== scope.projectId) {
    throw Object.assign(new Error('Scope grant not found.'), { code: 'grant_not_found', http_status: 404 })
  }
  const revokedAt = grant.revoked_at || new Date(now()).toISOString()
  const updated = { ...grant, revoked_at: revokedAt }
  if (!grant.revoked_at) {
    await records.put(scope, 'grants', grantId, updated)
  }
  return {
    grant_id: updated.grant_id,
    project_id: updated.project_id,
    document_id: updated.document_id,
    canvas_id: updated.canvas_id || null,
    revoked: true,
    revoked_at: revokedAt,
  }
}

export async function checkScopedPixelWrite(scope, project, manifest, { grantId, commandSha256, target, rect, expectedSha256 }) {
  const grant = await readPixelScopeGrant(scope, project, manifest, grantId, { allowExternalBridge: false })
  if (!target || ['frame_id', 'layer_id', 'cel_id'].some(k => grant[k] !== target[k])
    || !grant.allowed_operations.includes('working_pixels') || !grant.command
    || !pixelRectInside(rect, grant.rect) || commandSha256 !== grant.command_sha256
    || commandDigest(target, rect, expectedSha256, grant.link_scope) !== grant.command_sha256) reject('Pixel command does not match the frozen selection grant.')
  return grant
}
