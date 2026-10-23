import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import { loadEditorProject } from './projectStore.js'
import { getSpriteDocument, readSpriteBlock, encodeRgbaPng } from './spriteDocumentStore.js'
import { readPixelScopeGrant } from './pixelScopeGrants.js'
import { createPixelToolSession, PIXEL_TOOLS, PIXEL_CODEBOOK_VERSION } from './pixelToolSession.js'
import { createPixelEditCandidate } from './pixelEditOps.js'

export const EXTERNAL_BRIDGE_COMPATIBILITY = Object.freeze({
  width: 64,
  height: 64,
  maxFrames: 1,
  maxLayers: 1,
  pixelCount: 64 * 64,
  rgbaByteLength: 64 * 64 * 4,
})

const SIZE = EXTERNAL_BRIDGE_COMPATIBILITY.width
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const HEX64 = /^[a-f0-9]{64}$/
const ID = /^[A-Za-z0-9_-]{1,96}$/
const SESSION_ALLOWED_OPS = new Set([
  'replace-color', 'fill-rect', 'erase', 'pencil', 'eraser', 'line', 'rectangle', 'flood-fill',
  'text', 'working_pixels', 'read_region', 'patch_region', 'read_canvas', 'draw_pixels', 'undo_pixels', 'pixel_tools',
])
export const MCP_BRIDGE_TOOL_NAMES = Object.freeze([
  'read_document',
  'read_region',
  'render_review',
  'analyze_pixels',
  'propose_patch',
  'preview_patch',
  'get_job',
  'cancel_job',
  'request_acceptance',
])
const CALLABLE_TOOLS = new Set([
  'read_canvas', 'read_region', 'patch_region', 'draw_pixels', 'undo_pixels', 'review', 'close',
  ...MCP_BRIDGE_TOOL_NAMES,
])

const fail = (code, status = 409, diagnostic) => {
  throw Object.assign(new Error(code), { code, http_status: status, ...(diagnostic ? { diagnostic } : {}) })
}
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const sha256Bytes = bytes => createHash('sha256').update(bytes).digest('hex')
const tokenSha256 = token => createHash('sha256').update(String(token || ''), 'utf8').digest('hex')

function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) fail('invalid_pixel_tool_request', 400)
}
function validRect(rect) {
  if (!rect || typeof rect !== 'object' || Array.isArray(rect) || Object.keys(rect).length !== 4
    || ['x', 'y', 'w', 'h'].some(k => !Object.hasOwn(rect, k) || !Number.isInteger(rect[k]))) return null
  if (rect.w < 1 || rect.h < 1 || rect.x < 0 || rect.y < 0
    || rect.x + rect.w > EXTERNAL_BRIDGE_COMPATIBILITY.width
    || rect.y + rect.h > EXTERNAL_BRIDGE_COMPATIBILITY.height) return null
  return { x: rect.x, y: rect.y, w: rect.w, h: rect.h }
}

export function inspectExternalBridgeTarget(manifest, rgba = null) {
  const w = manifest?.canvas?.w ?? 0
  const h = manifest?.canvas?.h ?? 0
  const frameOrder = Array.isArray(manifest?.frame_order) ? manifest.frame_order : []
  const layerOrder = Array.isArray(manifest?.layer_order) ? manifest.layer_order : []
  const cels = Object.values(manifest?.cels || {})
  const frameId = frameOrder[0] || null
  const layerId = layerOrder[0] || null
  const layer = layerId ? manifest?.layers?.[layerId] : null
  const cel = cels[0] || null
  const hasText = Boolean(manifest?.text_objects?.items?.length)
  const hasLinks = Boolean(Object.keys(manifest?.links?.groups || {}).length || manifest?.links?.items?.length)
  const hasAnchors = Boolean(manifest?.anchors?.length || manifest?.anchors?.items?.length)
  const hasUnsupportedMeta = Boolean(
    manifest?.slices?.length
    || manifest?.slices?.items?.length
    || layer?.user_data
    || layer?.data
    || cel?.user_data
    || cel?.data,
  )
  if (w !== EXTERNAL_BRIDGE_COMPATIBILITY.width || h !== EXTERNAL_BRIDGE_COMPATIBILITY.height) {
    return { supported: false, reason: 'canvas_dimensions', message: `External tools currently support ${EXTERNAL_BRIDGE_COMPATIBILITY.width}×${EXTERNAL_BRIDGE_COMPATIBILITY.height} single-frame canvases.` }
  }
  if (frameOrder.length !== EXTERNAL_BRIDGE_COMPATIBILITY.maxFrames) {
    return { supported: false, reason: 'frame_count', message: 'External tools currently support single-frame canvases only.' }
  }
  if (layerOrder.length !== EXTERNAL_BRIDGE_COMPATIBILITY.maxLayers || cels.length !== 1 || !layer || !cel) {
    return { supported: false, reason: 'layer_count', message: 'External tools currently support a single layer and cel.' }
  }
  if (layer.locked || layer.visible === false) {
    return { supported: false, reason: 'layer_state', message: 'Unlock and show the layer before connecting external tools.' }
  }
  if (hasLinks) {
    return { supported: false, reason: 'linked_cels', message: 'Linked cels are not supported for external tools in this release.' }
  }
  if (hasText) {
    return { supported: false, reason: 'text_objects', message: 'Editable text layers are not supported for external pixel tools.' }
  }
  if (hasAnchors || hasUnsupportedMeta) {
    return { supported: false, reason: 'unsupported_metadata', message: 'Anchor, slice, or custom metadata is not supported for external tools in this release.' }
  }
  if (cel.block && (cel.block.w !== EXTERNAL_BRIDGE_COMPATIBILITY.width || cel.block.h !== EXTERNAL_BRIDGE_COMPATIBILITY.height)) {
    return { supported: false, reason: 'cel_dimensions', message: 'The cel block dimensions do not match the 64×64 compatibility boundary.' }
  }
  if (rgba instanceof Uint8Array) {
    if (rgba.length !== EXTERNAL_BRIDGE_COMPATIBILITY.rgbaByteLength) {
      return { supported: false, reason: 'rgba_length', message: 'Invalid source pixel buffer length.' }
    }
    for (let i = 3; i < rgba.length; i += 4) {
      if (rgba[i] !== 0 && rgba[i] !== 255) {
        return { supported: false, reason: 'source_alpha', message: 'External tools require binary alpha (0 or 255) without semitransparent pixels.' }
      }
    }
  }
  const durationMs = Number.isInteger(manifest?.frames?.[frameId]?.duration_ms) ? manifest.frames[frameId].duration_ms : 100
  const rawTags = Array.isArray(manifest?.tags)
    ? manifest.tags
    : Array.isArray(manifest?.tags?.items)
      ? manifest.tags.items
      : []
  const tags = []
  for (const tag of rawTags) {
    if (!tag || tag.from_frame_id !== frameId || tag.to_frame_id !== frameId) {
      return { supported: false, reason: 'unsupported_metadata', message: 'All timeline tags must target the single compatible frame.' }
    }
    const direction = tag.direction || 'forward'
    if (!['forward', 'reverse', 'pingpong'].includes(direction)
      || tag.color !== undefined || tag.repeats !== undefined || tag.user_data !== undefined || tag.data !== undefined) {
      return { supported: false, reason: 'unsupported_metadata', message: 'Custom tag color, repeats, direction, or user data are not supported in this release.' }
    }
    tags.push({
      id: tag.id,
      name: tag.name,
      direction,
      from_frame_id: tag.from_frame_id,
      to_frame_id: tag.to_frame_id,
    })
  }
  return {
    supported: true,
    reason: null,
    message: null,
    compatibility: EXTERNAL_BRIDGE_COMPATIBILITY,
    target: { frame_id: frameId, layer_id: layerId, cel_id: cel.id },
    layer_name: layer.name || 'Layer 1',
    duration_ms: durationMs,
    tags,
    cel,
  }
}

function diffRectAndCount(before, after, scopeRect) {
  let changedPixels = 0
  let minX = SIZE, minY = SIZE, maxX = -1, maxY = -1
  for (let y = scopeRect.y; y < scopeRect.y + scopeRect.h; y++) {
    for (let x = scopeRect.x; x < scopeRect.x + scopeRect.w; x++) {
      const idx = (y * SIZE + x) * 4
      if (before[idx] !== after[idx] || before[idx + 1] !== after[idx + 1]
        || before[idx + 2] !== after[idx + 2] || before[idx + 3] !== after[idx + 3]) {
        changedPixels++
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
  }
  return {
    changed_pixels: changedPixels,
    changed_rect: changedPixels > 0 ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } : null,
  }
}

function wrapObservation(payload, imageUrl = null) {
  const contentItems = [{ type: 'inputText', text: JSON.stringify(payload) }]
  if (imageUrl) contentItems.push({ type: 'inputImage', imageUrl })
  return { success: true, contentItems }
}

// External callers own an unsaved candidate only. There is intentionally no save tool.
export function createExternalPixelSessions({ load = loadEditorProject, readDocument = getSpriteDocument,
  readBlock = readSpriteBlock, readGrant = readPixelScopeGrant, now = Date.now, ttl = 15 * 60 * 1000, maxTerminalSessions = 64 } = {}) {
  const sessions = new Map(), pending = new Map()
  const isTerminal = s => Boolean(s.closed || s.revoked || s.discarded)
  const openSessionCount = () => {
    let count = 0
    for (const s of sessions.values()) if (!isTerminal(s)) count++
    return count
  }
  const enforceTerminalCap = () => {
    let terminalCount = 0
    for (const s of sessions.values()) if (isTerminal(s)) terminalCount++
    if (terminalCount <= maxTerminalSessions) return
    for (const [id, s] of sessions) {
      if (isTerminal(s)) {
        sessions.delete(id)
        terminalCount--
        if (terminalCount <= maxTerminalSessions) break
      }
    }
  }
  const retireSessionState = (state, { preserveReceiptId = null } = {}) => {
    state.tools = null
    state.candidate = null
    state.manifestMeta = null
    state.active = null
    state.busy = false
    if (state.receipts instanceof Map) {
      const preserved = preserveReceiptId ? state.receipts.get(preserveReceiptId) : undefined
      state.receipts.clear()
      if (preserveReceiptId && preserved) {
        state.receipts.set(preserveReceiptId, preserved)
      }
    }
    enforceTerminalCap()
  }
  const live = state => {
    if (state.revoked) fail('pixel_tool_grant_revoked', 403)
    if (state.closed || state.expires <= now()) fail('pixel_tool_session_expired', 404)
  }
  const owner = scope => `${path.resolve(scope.projectRoot)}\0${path.resolve(scope.workspaceRoot)}\0${scope.projectId}`
  const prune = () => {
    for (const [id, state] of sessions) if (state.expires <= now()) sessions.delete(id)
    enforceTerminalCap()
  }
  async function current(scope, context) {
    const { project } = await load(scope)
    if (!['editor_project_v1', 'editor_project_v2'].includes(project.version) || project.revision !== context.project_revision
      || project.canvases?.[context.canvas_id]?.document_id !== context.document_id
      || project.sprite_documents?.[context.document_id]?.working_revision !== context.working_revision) fail('pixel_tool_context_changed')
    return project
  }
  async function checkGrant(scope, project, manifest, grantId, bridgeToken = undefined) {
    let grant
    try {
      grant = await readGrant(scope, project, manifest, grantId)
    } catch (error) {
      if (error?.code === 'grant_revoked' || error?.code === 'pixel_tool_grant_revoked') fail('pixel_tool_grant_revoked', 403)
      if (error?.code === 'grant_expired' || error?.code === 'pixel_tool_session_expired') fail('pixel_tool_session_expired', 409)
      if (error?.code === 'stale_revision' || error?.code === 'pixel_tool_context_changed') fail('pixel_tool_context_changed', 409)
      return null
    }
    if (!grant) return null
    if (grant.revoked_at) fail('pixel_tool_grant_revoked', 403)
    if (grant.expires_at && now() > Date.parse(grant.expires_at)) fail('pixel_tool_session_expired', 409)
    if (grant.bridge_token_sha256 && bridgeToken !== undefined) {
      if (typeof bridgeToken !== 'string' || !bridgeToken || tokenSha256(bridgeToken) !== grant.bridge_token_sha256) {
        fail('pixel_tool_unauthorized', 403)
      }
    }
    return grant
  }
  function get(scope, id) {
    prune()
    const state = UUID.test(id || '') && sessions.get(id)
    if (!state || state.owner !== owner(scope)) fail('pixel_tool_session_expired', 404)
    if (state.revoked) fail('pixel_tool_grant_revoked', 403)
    return state
  }
  const reviewPath = (projectId, id) => `/src/ui/vnext/vnext-preview.html#pixel-preview=${projectId}/${id}`
  const info = state => ({
    session_id: state.id,
    context: state.context,
    expires_at: new Date(state.expires).toISOString(),
    saved: false,
    sealed: Boolean(state.candidate),
    ...(state.candidate ? { review_path: reviewPath(state.context.project_id, state.id) } : {}),
    tools: state.tools?.tools || PIXEL_TOOLS,
  })
  return {
    async create(scope, body) {
      exact(body, [
        'operation_id', 'canvas_id', 'expected_revision', 'expected_working_revision',
        'grant_id', 'bridge_token', 'rect', 'allowed_colors', 'allowed_operations', 'frame_id', 'layer_id', 'cel_id',
      ])
      if (!ID.test(scope.projectId) || !ID.test(body.canvas_id || '') || !UUID.test(body.operation_id || '')
        || !Number.isSafeInteger(body.expected_revision) || body.expected_revision < 1
        || !Number.isSafeInteger(body.expected_working_revision) || body.expected_working_revision < 1) fail('invalid_pixel_tool_request', 400)
      if (body.grant_id === undefined) {
        if (body.bridge_token !== undefined || body.rect !== undefined || body.allowed_colors !== undefined || body.allowed_operations !== undefined
          || body.frame_id !== undefined || body.layer_id !== undefined || body.cel_id !== undefined) {
          fail('invalid_pixel_tool_request', 400)
        }
      } else if (typeof body.grant_id !== 'string' || !/^grant_[a-f0-9]{32}$/i.test(body.grant_id)) {
        fail('invalid_pixel_tool_request', 400)
      }
      prune()
      const key = `${owner(scope)}\0${body.operation_id}`, fingerprint = hash(body)
      const existing = [...sessions.values()].find(s => s.key === key)
      if (existing) {
        if (existing.fingerprint !== fingerprint) fail('pixel_tool_operation_conflict')
        await current(scope, existing.context)
        live(existing)
        return info(existing)
      }
      if (pending.has(key)) fail('pixel_tool_busy')
      if (openSessionCount() + pending.size >= 24) fail('pixel_tool_session_limit', 429)
      pending.set(key, true)
      try {
        const { project } = await load(scope), canvas = project.canvases?.[body.canvas_id]
        const context = { project_id: scope.projectId, project_revision: body.expected_revision, canvas_id: body.canvas_id,
          document_id: canvas?.document_id, working_revision: body.expected_working_revision }
        if (!canvas?.document_id) fail('pixel_tool_context_changed')
        await current(scope, context)
        const { manifest } = await readDocument({ ...scope, documentId: canvas.document_id, revision: body.expected_working_revision })
        const targetCheck = inspectExternalBridgeTarget(manifest)
        if (manifest.revision !== context.working_revision || !targetCheck.supported) {
          fail('pixel_tool_target_unsupported', 422)
        }
        const { target, cel, duration_ms: durationMs, layer_name: layerName, tags } = targetCheck
        if ((body.frame_id !== undefined && body.frame_id !== target.frame_id)
          || (body.layer_id !== undefined && body.layer_id !== target.layer_id)
          || (body.cel_id !== undefined && body.cel_id !== target.cel_id)) {
          fail('pixel_tool_context_changed', 409)
        }
        let allowedRect
        let allowedOperations
        let grantId = null
        let bridgeTokenSha256 = null
        if (body.grant_id !== undefined) {
          const grant = await checkGrant(scope, project, manifest, body.grant_id, body.bridge_token ?? null)
          if (!grant) fail('invalid_pixel_tool_request', 400)
          if (grant.frame_id !== target.frame_id || grant.layer_id !== target.layer_id || grant.cel_id !== target.cel_id) {
            fail('pixel_tool_context_changed', 409)
          }
          if (body.rect !== undefined) {
            const requestedRect = validRect(body.rect)
            if (!requestedRect || requestedRect.x !== grant.rect.x || requestedRect.y !== grant.rect.y
              || requestedRect.w !== grant.rect.w || requestedRect.h !== grant.rect.h) {
              fail('invalid_pixel_tool_request', 400)
            }
          }
          const grantSessionOps = (grant.allowed_operations || []).filter(op => SESSION_ALLOWED_OPS.has(op))
          if (!grantSessionOps.length) fail('invalid_pixel_tool_request', 400)
          if (body.allowed_operations !== undefined) {
            if (!Array.isArray(body.allowed_operations) || !body.allowed_operations.length
              || body.allowed_operations.some(op => typeof op !== 'string' || !grantSessionOps.includes(op))) {
              fail('invalid_pixel_tool_request', 400)
            }
            allowedOperations = body.allowed_operations
          } else {
            allowedOperations = grantSessionOps
          }
          allowedRect = grant.rect
          grantId = grant.grant_id
          bridgeTokenSha256 = grant.bridge_token_sha256 || null
        }
        context.frame_id = target.frame_id
        context.layer_id = target.layer_id
        context.cel_id = target.cel_id
        context.target = target
        const rgba = cel.block
          ? (await readBlock({ ...scope, documentId: canvas.document_id, sha256: cel.block.sha256 })).bytes
          : new Uint8Array(EXTERNAL_BRIDGE_COMPATIBILITY.rgbaByteLength)
        await current(scope, context)
        const state = {
          id: randomUUID(),
          owner: owner(scope),
          key,
          fingerprint,
          context,
          manifestMeta: { duration_ms: durationMs, layer_name: layerName, tags },
          bridgeTokenSha256,
          expires: now() + ttl,
          busy: false,
          revoked: false,
          receipts: new Map(),
        }
        let defaultAllowedColors
        if (bridgeTokenSha256 && body.allowed_colors === undefined) {
          defaultAllowedColors = []
          if (Array.isArray(project?.settings?.palette?.colors)) {
            for (const hex of project.settings.palette.colors.slice(0, 32)) {
              if (typeof hex === 'string' && /^#[0-9a-fA-F]{8}$/.test(hex)) {
                const r = parseInt(hex.slice(1, 3), 16)
                const g = parseInt(hex.slice(3, 5), 16)
                const b = parseInt(hex.slice(5, 7), 16)
                const a = parseInt(hex.slice(7, 9), 16)
                if (a === 0 || a === 255) defaultAllowedColors.push([r, g, b, a])
              }
            }
          }
          if (!defaultAllowedColors.length) {
            defaultAllowedColors.push(
              [0, 0, 0, 255],
              [255, 255, 255, 255],
              [255, 80, 0, 255],
              [20, 40, 60, 255],
              [250, 40, 60, 255],
              [40, 200, 120, 255],
              [40, 120, 250, 255],
              [250, 200, 40, 255],
            )
          }
        }
        try {
          state.tools = createPixelToolSession({
            rgba,
            allowedRect,
            allowedColors: grantId ? (body.allowed_colors ?? defaultAllowedColors) : undefined,
            allowedOperations,
            target,
            grantId,
            checkCurrent: async () => {
              live(state)
              const latestProject = await current(scope, context)
              if (grantId) {
                const checked = await checkGrant(scope, latestProject, manifest, grantId, undefined)
                if (!checked) fail('pixel_tool_context_changed', 409)
              }
              live(state)
            },
          })
        } catch (error) {
          if (error?.diagnostic?.reason === 'source_alpha' || error?.diagnostic?.reason === 'unsupported') {
            fail('pixel_tool_target_unsupported', 422, error.diagnostic)
          }
          fail('invalid_pixel_tool_request', 400, error?.diagnostic)
        }
        context.allowed_rect = state.tools.allowedRect
        context.allowed_operations = state.tools.allowedOperations
        context.codebook_hash = state.tools.codebookHash
        if (grantId) context.grant_id = grantId
        sessions.set(state.id, state)
        return info(state)
      } finally { pending.delete(key) }
    },
    async call(scope, id, body) {
      exact(body, ['operation_id', 'tool', 'arguments', 'bridge_token'])
      if (!UUID.test(body.operation_id || '') || !CALLABLE_TOOLS.has(body.tool)
        || !body.arguments || typeof body.arguments !== 'object' || Array.isArray(body.arguments)
        || Buffer.byteLength(JSON.stringify(body.arguments)) > 64 * 1024) fail('invalid_pixel_tool_request', 400)
      const state = get(scope, id)
      if (state.bridgeTokenSha256 && tokenSha256(body.bridge_token) !== state.bridgeTokenSha256) {
        fail('pixel_tool_unauthorized', 403)
      }
      const fingerprint = hash({ operation_id: body.operation_id, tool: body.tool, arguments: body.arguments })
      const previous = state.receipts.get(body.operation_id)
      if (previous && previous.fingerprint !== fingerprint) fail('pixel_tool_operation_conflict')
      if (state.active?.id === body.operation_id && state.active.fingerprint !== fingerprint) fail('pixel_tool_operation_conflict')
      if (body.tool === 'close' || body.tool === 'cancel_job') {
        exact(body.arguments, [])
        if (previous) {
          if (previous.error) throw Object.assign(new Error(previous.error), { code: previous.error, http_status: previous.status, diagnostic: previous.diagnostic || undefined })
          return previous.result
        }
        live(state)
        const result = { session_id: id, status: 'cancelled', closed: true, saved: false }
        state.closed = true
        state.cancelled = true
        state.receipts.set(body.operation_id, { fingerprint, result })
        retireSessionState(state, { preserveReceiptId: body.operation_id })
        return result
      }
      if (state.busy) fail('pixel_tool_busy')
      state.busy = true
      state.active = { id: body.operation_id, fingerprint }
      try {
        const latestProject = await current(scope, state.context)
        live(state)
        if (state.context.grant_id) {
          const { manifest } = await readDocument({ ...scope, documentId: state.context.document_id, revision: state.context.working_revision })
          const checked = await checkGrant(scope, latestProject, manifest, state.context.grant_id, undefined)
          if (!checked) fail('pixel_tool_context_changed', 409)
        }
        if (previous) {
          if (previous.fingerprint !== fingerprint) fail('pixel_tool_operation_conflict')
          if (previous.error) throw Object.assign(new Error(previous.error), { code: previous.error, http_status: previous.status, diagnostic: previous.diagnostic || undefined })
          return previous.result
        }
        if (state.receipts.size >= 24) fail('pixel_tool_call_limit')
        if (state.candidate && body.tool !== 'get_job' && body.tool !== 'request_acceptance') {
          fail('pixel_tool_preview_sealed')
        }
        const receipt = { fingerprint }; state.receipts.set(body.operation_id, receipt)
        try {
          let result
          if (body.tool === 'get_job') {
            exact(body.arguments, [])
            const snap = state.tools ? state.tools.snapshotState() : null
            const cand = state.candidate
            const batches = cand ? cand.drawing_batches : (snap?.drawingBatches ?? 0)
            const calls = Math.min(9, cand ? cand.tool_calls : (snap?.toolCalls ?? 0))
            result = wrapObservation({
              session_id: id,
              project_id: state.context.project_id,
              canvas_id: state.context.canvas_id,
              document_id: state.context.document_id,
              grant_id: state.context.grant_id || null,
              status: state.candidate ? 'review_ready' : 'open',
              sealed: Boolean(state.candidate),
              review_path: state.candidate ? reviewPath(scope.projectId, id) : null,
              allowed_rect: state.context.allowed_rect,
              target: state.context.target,
              codebook_hash: state.context.codebook_hash || null,
              source_sha256: cand ? cand.source_sha256 : snap?.sourceSha256,
              candidate_sha256: cand ? cand.sha256 : snap?.candidateSha256,
              drawing_batches: batches,
              remaining_drawing_batches: Math.max(0, 3 - batches),
              tool_calls: calls,
              remaining_tool_calls: Math.max(0, 9 - calls),
              saved: false,
            })
          } else if (body.tool === 'review' || body.tool === 'request_acceptance') {
            exact(body.arguments, [])
            if (!state.candidate) state.candidate = await state.tools.candidate()
            result = {
              session_id: id,
              status: 'review_ready',
              context: state.context,
              saved: false,
              sealed: true,
              candidate_sha256: state.candidate.sha256,
              source_sha256: state.candidate.source_sha256,
              drawing_batches: state.candidate.drawing_batches,
              tool_calls: state.candidate.tool_calls,
              review_path: reviewPath(scope.projectId, id),
            }
          } else if (body.tool === 'read_document') {
            result = await state.tools.chargeExternalCall('read_document', body.arguments, ({
              width, height, sourceSha256, currentSha256, scopeRect, allowedOps,
              codebookMode, codebook, codebookHash, frozenTarget, grantId, batches, calls, requireFields, trace,
            }) => {
              requireFields(body.arguments, [], 'arguments', 'empty', null, 'read_document')
              trace.push({ tool: 'read_document', drawing_batches: batches, sha256: currentSha256 })
              return wrapObservation({
                session_id: id,
                project_id: state.context.project_id,
                canvas_id: state.context.canvas_id,
                document_id: state.context.document_id,
                project_revision: state.context.project_revision,
                working_revision: state.context.working_revision,
                compatibility: EXTERNAL_BRIDGE_COMPATIBILITY,
                canvas: { w: width, h: height },
                frame_order: [frozenTarget.frame_id],
                layer_order: [frozenTarget.layer_id],
                target: {
                  ...frozenTarget,
                  layer_name: state.manifestMeta?.layer_name || 'Layer 1',
                  duration_ms: state.manifestMeta?.duration_ms ?? 100,
                },
                tags: state.manifestMeta?.tags || [],
                allowed_rect: scopeRect,
                allowed_operations: allowedOps,
                codebook_mode: codebookMode,
                codebook,
                codebook_version: codebookMode ? PIXEL_CODEBOOK_VERSION : null,
                codebook_hash: codebookHash,
                grant_id: grantId,
                source_sha256: sourceSha256,
                candidate_sha256: currentSha256,
                drawing_batches: batches,
                remaining_drawing_batches: 3 - batches,
                tool_calls: calls,
                remaining_tool_calls: 9 - calls,
                saved: false,
              })
            })
          } else if (body.tool === 'render_review') {
            result = await state.tools.chargeExternalCall('render_review', body.arguments, ({
              width, height, pixels, sourceSha256, currentSha256, scopeRect, codebookHash, batches, calls,
              requireFields, requireRect, readOwned, trace, digest,
            }) => {
              requireFields(body.arguments, [], 'arguments', 'read_region_arguments', null, 'render_review', ['rect'])
              const renderRect = Object.hasOwn(body.arguments, 'rect')
                ? requireRect(readOwned(body.arguments, 'rect'), null, 'rect', 'render_review')
                : { ...scopeRect }
              let targetBuf = Buffer.from(pixels)
              if (renderRect.x !== 0 || renderRect.y !== 0 || renderRect.w !== width || renderRect.h !== height) {
                targetBuf = Buffer.alloc(renderRect.w * renderRect.h * 4)
                for (let row = 0; row < renderRect.h; row++) {
                  const srcStart = ((renderRect.y + row) * width + renderRect.x) * 4
                  targetBuf.set(pixels.subarray(srcStart, srcStart + renderRect.w * 4), row * renderRect.w * 4)
                }
              }
              const pngBytes = encodeRgbaPng(renderRect.w, renderRect.h, targetBuf)
              const pngSha256 = digest(pngBytes)
              const dataUrl = `data:image/png;base64,${pngBytes.toString('base64')}`
              trace.push({ tool: 'render_review', drawing_batches: batches, sha256: currentSha256, rect: renderRect })
              return wrapObservation({
                session_id: id,
                width: renderRect.w,
                height: renderRect.h,
                rect: renderRect,
                allowed_rect: scopeRect,
                png_sha256: pngSha256,
                png_byte_length: pngBytes.length,
                png_base64: pngBytes.toString('base64'),
                codebook_hash: codebookHash,
                source_sha256: sourceSha256,
                candidate_sha256: currentSha256,
                drawing_batches: batches,
                remaining_drawing_batches: 3 - batches,
                tool_calls: calls,
                remaining_tool_calls: 9 - calls,
                saved: false,
              }, dataUrl)
            })
          } else if (body.tool === 'analyze_pixels') {
            result = await state.tools.chargeExternalCall('analyze_pixels', body.arguments, ({
              width, pixels, sourceSha256, currentSha256, scopeRect, codebookHash, colorToSymbol, batches, calls,
              requireFields, requireRect, readOwned, trace, colorKey,
            }) => {
              requireFields(body.arguments, [], 'arguments', 'read_region_arguments', null, 'analyze_pixels', ['rect'])
              const regionRect = Object.hasOwn(body.arguments, 'rect')
                ? requireRect(readOwned(body.arguments, 'rect'), null, 'rect', 'analyze_pixels')
                : scopeRect
              let opaquePixels = 0
              let transparentPixels = 0
              let minX = width, minY = width, maxX = -1, maxY = -1
              const countsByColor = new Map()
              for (let y = regionRect.y; y < regionRect.y + regionRect.h; y++) {
                for (let x = regionRect.x; x < regionRect.x + regionRect.w; x++) {
                  const idx = (y * width + x) * 4
                  const r = pixels[idx], g = pixels[idx + 1], b = pixels[idx + 2], a = pixels[idx + 3]
                  if (a === 0) {
                    transparentPixels++
                  } else {
                    opaquePixels++
                    if (x < minX) minX = x
                    if (y < minY) minY = y
                    if (x > maxX) maxX = x
                    if (y > maxY) maxY = y
                  }
                  const key = colorKey(r, g, b, a)
                  const entry = countsByColor.get(key)
                  if (entry) entry.count++
                  else {
                    const hex = `#${[r, g, b, a].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase()}`
                    countsByColor.set(key, {
                      rgba: [r, g, b, a],
                      hex,
                      symbol: colorToSymbol?.get(key) || null,
                      count: 1,
                    })
                  }
                }
              }
              const palette = [...countsByColor.values()]
                .sort((a, b) => b.count - a.count)
                .slice(0, 62)
              trace.push({ tool: 'analyze_pixels', drawing_batches: batches, sha256: currentSha256, rect: regionRect })
              return wrapObservation({
                session_id: id,
                rect: regionRect,
                allowed_rect: scopeRect,
                total_pixels: regionRect.w * regionRect.h,
                opaque_pixels: opaquePixels,
                transparent_pixels: transparentPixels,
                non_transparent_bounds: opaquePixels > 0
                  ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
                  : null,
                unique_color_count: countsByColor.size,
                palette,
                codebook_hash: codebookHash,
                source_sha256: sourceSha256,
                candidate_sha256: currentSha256,
                drawing_batches: batches,
                remaining_drawing_batches: 3 - batches,
                tool_calls: calls,
                remaining_tool_calls: 9 - calls,
                saved: false,
              })
            })
          } else if (body.tool === 'preview_patch') {
            result = await state.tools.chargeExternalCall('preview_patch', body.arguments, ({
              width, height, pixels, sourceRgba, sourceSha256, currentSha256, scopeRect,
              codebookMode, codebook, codebookHash, batches, calls, counts,
              requireFields, requireRect, readOwned, rejectField, fail: failTool, trace, assertOutsideRectUnchanged, digest, colorKey,
            }) => {
              if (Object.keys(body.arguments).length === 0) {
                const diff = diffRectAndCount(sourceRgba, pixels, scopeRect)
                trace.push({ tool: 'preview_patch', drawing_batches: batches, sha256: currentSha256, preview_only: true })
                return wrapObservation({
                  session_id: id,
                  preview_only: true,
                  saved: false,
                  width,
                  height,
                  allowed_rect: scopeRect,
                  noop: diff.changed_pixels === 0,
                  changed_pixels: diff.changed_pixels,
                  changed_rect: diff.changed_rect,
                  current_candidate_sha256: currentSha256,
                  preview_candidate_sha256: currentSha256,
                  source_sha256: sourceSha256,
                  codebook_hash: codebookHash,
                  drawing_batches: batches,
                  remaining_drawing_batches: 3 - batches,
                  tool_calls: calls,
                  remaining_tool_calls: 9 - calls,
                })
              }
              if (!codebookMode) {
                failTool('assistant_tool_blocked', { reason: 'authorization', rule: 'tool_identity', terminal: true, ...counts() })
              }
              requireFields(body.arguments, ['rect', 'grid', 'codebook_hash', 'expected_candidate_hash'], 'arguments', 'patch_region_arguments', null, 'preview_patch', ['target'])
              const regionRect = requireRect(readOwned(body.arguments, 'rect'), null, 'rect', 'preview_patch')
              const rawCodebookHash = readOwned(body.arguments, 'codebook_hash')
              if (typeof rawCodebookHash !== 'string' || !HEX64.test(rawCodebookHash)) {
                rejectField('codebook_hash', 'invalid_value', 'codebook_hash', null, 'argument_shape', 'preview_patch')
              }
              if (rawCodebookHash !== codebookHash) {
                rejectField('codebook_hash', 'invalid_value', 'codebook_hash', null, 'codebook_mismatch', 'preview_patch')
              }
              const rawCandidateHash = readOwned(body.arguments, 'expected_candidate_hash')
              if (typeof rawCandidateHash !== 'string' || !HEX64.test(rawCandidateHash)) {
                rejectField('expected_candidate_hash', 'invalid_value', 'expected_candidate_hash', null, 'argument_shape', 'preview_patch')
              }
              const rawGrid = readOwned(body.arguments, 'grid')
              if (!Array.isArray(rawGrid)) rejectField('grid', 'invalid_type', 'grid', null, 'argument_shape', 'preview_patch')
              if (rawGrid.length !== regionRect.h) rejectField('grid', 'invalid_length', 'grid', null, 'grid_dimensions', 'preview_patch')
              for (let r = 0; r < regionRect.h; r++) {
                const rowField = `grid[${r}]`
                const row = readOwned(rawGrid, r)
                if (typeof row !== 'string') rejectField(rowField, 'invalid_type', 'grid_row', null, 'argument_shape', 'preview_patch')
                if (row.length !== regionRect.w) rejectField(rowField, 'invalid_length', 'grid_row', null, 'grid_dimensions', 'preview_patch')
                for (let c = 0; c < regionRect.w; c++) {
                  const ch = row[c]
                  if (ch !== '.' && !Object.hasOwn(codebook, ch)) {
                    rejectField(rowField, 'invalid_value', 'grid_symbol', null, 'unknown_symbol', 'preview_patch')
                  }
                }
              }
              if (rawCandidateHash !== currentSha256) {
                failTool('assistant_context_changed', { reason: 'stale_candidate', rule: 'candidate_hash', terminal: true, ...counts() })
              }
              const colorGroups = new Map()
              for (let r = 0; r < regionRect.h; r++) {
                const row = rawGrid[r]
                const y = regionRect.y + r
                for (let c = 0; c < regionRect.w; c++) {
                  const ch = row[c]
                  if (ch === '.') continue
                  const targetColor = codebook[ch]
                  const x = regionRect.x + c
                  const offset = (y * width + x) * 4
                  if (pixels[offset] === targetColor[0] && pixels[offset + 1] === targetColor[1]
                    && pixels[offset + 2] === targetColor[2] && pixels[offset + 3] === targetColor[3]) continue
                  const key = colorKey(targetColor[0], targetColor[1], targetColor[2], targetColor[3])
                  if (!colorGroups.has(key)) colorGroups.set(key, { color: [...targetColor], points: [] })
                  colorGroups.get(key).points.push({ x, y })
                }
              }
              const operations = []
              for (const group of colorGroups.values()) {
                for (let i = 0; i < group.points.length; i += 256) {
                  operations.push({
                    type: 'pencil',
                    rect: { ...regionRect },
                    color: [...group.color],
                    points: group.points.slice(i, i + 256),
                  })
                }
              }
              const loweredSerialized = JSON.stringify({ operations })
              if (operations.length > 64 || loweredSerialized.length > 64 * 1024) {
                rejectField('grid', 'limit_exceeded', 'patch_budget', null, 'patch_budget', 'preview_patch')
              }
              let previewPixels = new Uint8Array(pixels)
              for (const operation of operations) {
                previewPixels = createPixelEditCandidate({ width, height, rgba: previewPixels }, operation, scopeRect).rgba
              }
              if (!assertOutsideRectUnchanged(pixels, previewPixels, regionRect) || !assertOutsideRectUnchanged(pixels, previewPixels, scopeRect)) {
                failTool('assistant_tool_blocked', { reason: 'authorization', rule: 'rect_bounds', terminal: true, ...counts() })
              }
              const diff = diffRectAndCount(pixels, previewPixels, regionRect)
              const previewSha256 = digest(previewPixels)
              trace.push({ tool: 'preview_patch', drawing_batches: batches, sha256: currentSha256, preview_sha256: previewSha256, preview_only: true })
              return wrapObservation({
                session_id: id,
                preview_only: true,
                saved: false,
                width,
                height,
                rect: regionRect,
                allowed_rect: scopeRect,
                noop: operations.length === 0,
                changed_pixels: diff.changed_pixels,
                changed_rect: diff.changed_rect,
                operation_count: operations.length,
                lowered_byte_length: loweredSerialized.length,
                current_candidate_sha256: currentSha256,
                candidate_sha256: currentSha256,
                preview_candidate_sha256: previewSha256,
                source_sha256: sourceSha256,
                codebook_hash: codebookHash,
                drawing_batches: batches,
                remaining_drawing_batches: 3 - batches,
                tool_calls: calls,
                remaining_tool_calls: 9 - calls,
              })
            })
          } else if (body.tool === 'propose_patch') {
            const delegateTool = Object.hasOwn(body.arguments, 'operations') && !Object.hasOwn(body.arguments, 'grid')
              ? 'draw_pixels'
              : 'patch_region'
            result = await state.tools.call(delegateTool, body.arguments)
          } else {
            result = await state.tools.call(body.tool, body.arguments)
          }
          // A close while an async source check is pending invalidates its result.
          live(state)
          await current(scope, state.context)
          live(state)
          receipt.result = result
          return result
        } catch (error) {
          const recoverable = error?.code === 'pixel_tool_invalid_arguments' && error.recoverable === true
          const contextChanged = error?.code === 'assistant_context_changed' || error?.code === 'pixel_tool_context_changed'
          const grantRevoked = error?.code === 'pixel_tool_grant_revoked'
          receipt.error = grantRevoked
            ? 'pixel_tool_grant_revoked'
            : recoverable
              ? 'assistant_tool_blocked'
              : contextChanged
                ? 'pixel_tool_context_changed'
                : (error.code || 'pixel_tool_operation_rejected')
          receipt.status = error.http_status || (grantRevoked ? 403 : contextChanged ? 409 : 422)
          receipt.diagnostic = error.diagnostic || null
          throw Object.assign(new Error(receipt.error), { code: receipt.error, http_status: receipt.status, diagnostic: receipt.diagnostic || undefined })
        }
      } finally { state.busy = false; state.active = null }
    },
    async stageExternalCandidate(scope, payload) {
      prune()
      const {
        operation_id: operationId,
        grant_id: grantId,
        canvas_id: canvasId,
        expected_revision: expectedRevision,
        expected_working_revision: expectedWorkingRevision,
        target,
        allowed_rect: allowedRect,
        rgba,
        source_rgba: sourceRgba,
        bridge_source: bridgeSource = 'aseprite',
      } = payload || {}
      if (!UUID.test(operationId || '') || !(rgba instanceof Uint8Array) || !(sourceRgba instanceof Uint8Array)
        || rgba.length !== EXTERNAL_BRIDGE_COMPATIBILITY.rgbaByteLength
        || sourceRgba.length !== EXTERNAL_BRIDGE_COMPATIBILITY.rgbaByteLength) {
        fail('invalid_pixel_tool_request', 400)
      }
      const key = `${owner(scope)}\0stage:${operationId}`
      const fingerprint = hash({
        operation_id: operationId,
        grant_id: grantId,
        canvas_id: canvasId,
        expected_revision: expectedRevision,
        expected_working_revision: expectedWorkingRevision,
        sha256: sha256Bytes(rgba),
      })
      const existing = [...sessions.values()].find(s => s.key === key)
      if (existing) {
        if (existing.fingerprint !== fingerprint) fail('pixel_tool_operation_conflict')
        await current(scope, existing.context)
        live(existing)
        return {
          session_id: existing.id,
          context: existing.context,
          pixel_candidate: existing.candidate,
          review_path: reviewPath(scope.projectId, existing.id),
          saved: false,
          sealed: true,
        }
      }
      if (openSessionCount() + pending.size >= 24) fail('pixel_tool_session_limit', 429)
      const context = {
        project_id: scope.projectId,
        project_revision: expectedRevision,
        canvas_id: canvasId,
        document_id: null,
        working_revision: expectedWorkingRevision,
        frame_id: target.frame_id,
        layer_id: target.layer_id,
        cel_id: target.cel_id,
        target: { ...target },
        allowed_rect: { ...allowedRect },
        allowed_operations: ['external_file_import'],
        codebook_hash: null,
        grant_id: grantId,
        bridge_source: bridgeSource,
      }
      const { project } = await load(scope)
      context.document_id = project.canvases?.[canvasId]?.document_id || null
      if (!context.document_id) fail('pixel_tool_context_changed')
      await current(scope, context)
      const candidate = {
        width: EXTERNAL_BRIDGE_COMPATIBILITY.width,
        height: EXTERNAL_BRIDGE_COMPATIBILITY.height,
        rgba_hex: Buffer.from(rgba).toString('hex'),
        sha256: sha256Bytes(rgba),
        source_sha256: sha256Bytes(sourceRgba),
        allowed_rect: { ...allowedRect },
        allowed_operations: ['external_file_import'],
        codebook_hash: null,
        codebook_version: PIXEL_CODEBOOK_VERSION,
        target: { ...target },
        grant_id: grantId,
        bridge_source: bridgeSource,
        drawing_batches: 1,
        tool_calls: 1,
        trace: [{ tool: 'external_file_import', drawing_batches: 1, sha256: sha256Bytes(rgba) }],
      }
      const state = {
        id: randomUUID(),
        owner: owner(scope),
        key,
        fingerprint,
        context,
        candidate,
        expires: now() + ttl,
        busy: false,
        revoked: false,
        receipts: new Map(),
      }
      sessions.set(state.id, state)
      return {
        session_id: state.id,
        context: state.context,
        pixel_candidate: state.candidate,
        review_path: reviewPath(scope.projectId, state.id),
        saved: false,
        sealed: true,
      }
    },
    revokeGrant(scope, grantId) {
      prune()
      const scopeOwner = owner(scope)
      let revokedCount = 0
      for (const state of sessions.values()) {
        if (state.owner === scopeOwner && state.context?.grant_id === grantId && !state.revoked) {
          state.revoked = true
          state.closed = true
          retireSessionState(state)
          revokedCount++
        }
      }
      return revokedCount
    },
    discardSession(scope, id) {
      prune()
      const state = UUID.test(id || '') && sessions.get(id)
      if (!state || state.owner !== owner(scope)) return false
      state.closed = true
      state.discarded = true
      retireSessionState(state)
      return true
    },
    listForCanvas(scope, canvasId) {
      prune()
      const scopeOwner = owner(scope)
      const items = []
      for (const state of sessions.values()) {
        if (state.owner !== scopeOwner || state.closed || state.revoked || state.discarded) continue
        if (canvasId && state.context?.canvas_id !== canvasId) continue
        const snap = state.tools ? state.tools.snapshotState() : null
        items.push({
          session_id: state.id,
          grant_id: state.context?.grant_id || null,
          canvas_id: state.context?.canvas_id || null,
          bridge_source: state.context?.bridge_source || 'codex_mcp',
          sealed: Boolean(state.candidate),
          status: state.candidate ? 'review_ready' : 'open',
          review_path: state.candidate ? reviewPath(scope.projectId, state.id) : null,
          candidate_sha256: state.candidate ? state.candidate.sha256 : (snap?.candidateSha256 || null),
          source_sha256: state.candidate ? state.candidate.source_sha256 : (snap?.sourceSha256 || null),
          drawing_batches: state.candidate ? state.candidate.drawing_batches : (snap?.drawingBatches ?? 0),
          tool_calls: state.candidate ? state.candidate.tool_calls : (snap?.toolCalls ?? 0),
          expires_at: new Date(state.expires).toISOString(),
        })
      }
      return items
    },
    async review(scope, id) {
      const state = get(scope, id)
      live(state)
      if (state.busy || !state.candidate) fail('pixel_tool_preview_not_ready')
      const latestProject = await current(scope, state.context)
      if (state.context.grant_id) {
        const { manifest } = await readDocument({ ...scope, documentId: state.context.document_id, revision: state.context.working_revision })
        const checked = await checkGrant(scope, latestProject, manifest, state.context.grant_id, undefined)
        if (!checked) fail('pixel_tool_context_changed', 409)
      }
      live(state)
      return { session_id: id, context: state.context, pixel_candidate: state.candidate, saved: false }
    },
  }
}

export const externalPixelSessions = createExternalPixelSessions()
