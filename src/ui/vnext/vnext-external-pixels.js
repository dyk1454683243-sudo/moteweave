import { createOperationId, sha256Hex } from './vnext-project-client.js'

export const DEFAULT_EXTERNAL_BRIDGE_COMPATIBILITY = Object.freeze({
  width: 64,
  height: 64,
  max_frames: 1,
  max_layers: 1,
  alpha_values: Object.freeze([0, 255]),
  max_pixels: 4096,
  decoded_rgba_bytes: 16384,
})

export function externalPixelLink(hash) {
  const match = /^#pixel-preview=([A-Za-z0-9_-]{1,96})\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i.exec(hash || '')
  return match ? { projectId: match[1], sessionId: match[2] } : null
}

function validAllowedRect(rect, compat = DEFAULT_EXTERNAL_BRIDGE_COMPATIBILITY) {
  if (rect === undefined) return true
  if (!rect || typeof rect !== 'object' || Array.isArray(rect)) return false
  const { x, y, w, h } = rect
  return [x, y, w, h].every(Number.isInteger)
    && w >= 1
    && h >= 1
    && x >= 0
    && y >= 0
    && x + w <= compat.width
    && y + h <= compat.height
}

export async function readExternalPixels(link, fetchImpl = fetch) {
  if (!link || !externalPixelLink(`#pixel-preview=${link.projectId}/${link.sessionId}`)) throw Error('Invalid external drawing link.')
  const response = await fetchImpl(`/api/editor/projects/${link.projectId}/pixel-tools/${link.sessionId}`, {
    credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(10000), redirect: 'error' })
  if (!response.ok) throw Error('The external drawing expired or its canvas changed. No pixels were saved.')
  const result = await response.json(), c = result.context, value = result.pixel_candidate
  const compat = DEFAULT_EXTERNAL_BRIDGE_COMPATIBILITY
  const expectedHexLen = compat.decoded_rgba_bytes * 2
  if (result.session_id !== link.sessionId || c?.project_id !== link.projectId || result.saved !== false
    || !/^[A-Za-z0-9_-]{1,96}$/.test(c.canvas_id || '') || !/^[A-Za-z0-9_-]{1,96}$/.test(c.document_id || '')
    || !Number.isSafeInteger(c.project_revision) || c.project_revision < 1 || !Number.isSafeInteger(c.working_revision) || c.working_revision < 1
    || !validAllowedRect(c.allowed_rect, compat)
    || value?.width !== compat.width || value?.height !== compat.height
    || typeof value?.rgba_hex !== 'string' || value.rgba_hex.length !== expectedHexLen || !/^[a-f0-9]+$/.test(value.rgba_hex)
    || !/^[a-f0-9]{64}$/.test(value.source_sha256 || '') || !Number.isInteger(value.drawing_batches)
    || value.drawing_batches < 0 || value.drawing_batches > 3 || !Number.isInteger(value.tool_calls) || value.tool_calls < 0 || value.tool_calls > 9) {
    throw Error('The external drawing could not be verified. No pixels were saved.')
  }
  const rgba = Uint8Array.from(value.rgba_hex.match(/../g), byte => parseInt(byte, 16))
  if (await sha256Hex(rgba) !== value.sha256 || rgba.some((v, i) => i % 4 === 3 && v !== 0 && v !== 255)) throw Error('The external drawing could not be verified. No pixels were saved.')
  return { ...result, rgba }
}

export function inspectClientExternalTarget(manifest, info, compat = DEFAULT_EXTERNAL_BRIDGE_COMPATIBILITY) {
  if (!manifest || !info) {
    return { compatible: false, code: 'no_target', reason: 'Select a canvas to use external tools.' }
  }
  if (info.readOnly) {
    return { compatible: false, code: 'unsupported_target', reason: info.readOnly }
  }
  const width = manifest.canvas?.w ?? info.width
  const height = manifest.canvas?.h ?? info.height
  if (width !== compat.width || height !== compat.height) {
    return {
      compatible: false,
      code: 'unsupported_target',
      reason: `External tools currently support ${compat.width} × ${compat.height} px canvases (this canvas is ${width} × ${height} px).`,
    }
  }
  const maxFrames = compat.max_frames ?? compat.maxFrames ?? 1
  const frameCount = Array.isArray(manifest.frame_order) ? manifest.frame_order.length : 0
  if (frameCount !== maxFrames) {
    return {
      compatible: false,
      code: 'unsupported_target',
      reason: `External tools currently support single-frame canvases (this canvas has ${frameCount} frames).`,
    }
  }
  const maxLayers = compat.max_layers ?? compat.maxLayers ?? 1
  const layerCount = Array.isArray(manifest.layer_order) ? manifest.layer_order.length : 0
  if (layerCount !== maxLayers) {
    return {
      compatible: false,
      code: 'unsupported_target',
      reason: `External tools currently support single-layer canvases (this canvas has ${layerCount} layers).`,
    }
  }
  const layerId = manifest.layer_order[0]
  const layer = manifest.layers?.[layerId]
  if (!layer || layer.visible === false || layer.locked === true) {
    return {
      compatible: false,
      code: 'unsupported_target',
      reason: 'External tools require a single visible, unlocked raster layer.',
    }
  }
  if (Array.isArray(manifest.links?.groups) && manifest.links.groups.length > 0) {
    return {
      compatible: false,
      code: 'unsupported_target',
      reason: 'External tools do not support linked cels.',
    }
  }
  if (Array.isArray(manifest.text_objects?.items) && manifest.text_objects.items.length > 0) {
    return {
      compatible: false,
      code: 'unsupported_target',
      reason: 'External tools do not support canvases with editable text objects.',
    }
  }
  if (
    (Array.isArray(manifest.anchors) && manifest.anchors.length > 0)
    || (Array.isArray(manifest.anchors?.items) && manifest.anchors.items.length > 0)
  ) {
    return {
      compatible: false,
      code: 'unsupported_target',
      reason: 'External tools do not support canvases with anchor metadata.',
    }
  }
  if (
    (Array.isArray(manifest.slices) && manifest.slices.length > 0)
    || (Array.isArray(manifest.slices?.items) && manifest.slices.items.length > 0)
  ) {
    return {
      compatible: false,
      code: 'unsupported_target',
      reason: 'External tools do not support canvases with slice metadata.',
    }
  }
  const hasLayerUserData = (layer.user_data !== undefined && layer.user_data !== null && layer.user_data !== '')
    || (layer.data !== undefined && layer.data !== null && layer.data !== '')
  const frameId = manifest.frame_order[0]
  const cel = manifest.cels?.[`${layerId}:${frameId}`] || manifest.cels?.[Object.keys(manifest.cels || {})[0]]
  const hasCelUserData = (cel?.user_data !== undefined && cel?.user_data !== null && cel?.user_data !== '')
    || (cel?.data !== undefined && cel?.data !== null && cel?.data !== '')
  if (hasLayerUserData || hasCelUserData) {
    return {
      compatible: false,
      code: 'unsupported_target',
      reason: 'External tools do not support canvases with custom user data.',
    }
  }
  const tagItems = Array.isArray(manifest.tags)
    ? manifest.tags
    : (Array.isArray(manifest.tags?.items) ? manifest.tags.items : [])
  for (const tag of tagItems) {
    const fromIdx = Number.isInteger(tag?.from_frame) ? tag.from_frame : (Number.isInteger(tag?.from) ? tag.from : 0)
    const toIdx = Number.isInteger(tag?.to_frame) ? tag.to_frame : (Number.isInteger(tag?.to) ? tag.to : 0)
    const hasTagData = (tag?.user_data !== undefined && tag?.user_data !== null && tag?.user_data !== '')
      || (tag?.data !== undefined && tag?.data !== null && tag?.data !== '')
    if (
      fromIdx !== 0
      || toIdx !== 0
      || (tag?.direction && tag.direction !== 'forward')
      || tag?.color !== undefined
      || tag?.repeats !== undefined
      || tag?.repeat !== undefined
      || hasTagData
    ) {
      return {
        compatible: false,
        code: 'unsupported_target',
        reason: 'External tools do not support canvases with non-default timeline tag metadata.',
      }
    }
  }
  return {
    compatible: true,
    code: 'ok',
    reason: null,
  }
}

export function bindExternalBridge({ root, session, api }) {
  const panel = root?.querySelector?.('#vnext-external-tools')
  const availabilityNode = root?.querySelector?.('#vnext-external-availability')
  if (!panel) return { busy: false, state: null, sync() {}, async refresh() {} }

  const find = (selector) => panel.querySelector?.(selector) || root?.querySelector?.(selector) || null
  const connectBtn = find('#vnext-external-connect')
  const checkoutBtn = find('#vnext-external-checkout')
  const stateActions = find('#vnext-external-state-actions')
  const reviewBtn = find('#vnext-external-review')
  const revokeBtn = find('#vnext-external-revoke')
  const handoffRow = find('#vnext-external-handoff')
  const handoffInput = find('#vnext-external-handoff-value')
  const copyHandoffBtn = find('#vnext-external-copy-handoff')
  const statusNode = find('#vnext-external-status')
  const metaNode = find('#vnext-external-meta')

  let busy = false
  let availability = null
  let serverTargetStatus = null
  let activeConnection = null
  let activeCheckout = null
  let connectPending = null
  let checkoutPending = null
  // Tab-scoped recovery intent only: never persist tokens, commands or pixel data.
  const retirementStorageKey = 'vnext-external-retirement-v1'
  let retirementPersistenceFailed = false
  let pendingRetirement = readRetirementIntent()
  let retirementInFlight = null

  function readRetirementIntent() {
    try {
      const raw = globalThis.window?.sessionStorage?.getItem(retirementStorageKey)
      if (!raw || raw.length > 4096) return null
      const ret = JSON.parse(raw)
      if (!ret || ![ret.projectId, ret.canvasId, ret.sessionId].every(v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,96}$/.test(v))
        || !['saved', 'discarded'].includes(ret.mode)
        || (ret.checkoutId != null && !/^[A-Za-z0-9_-]{1,96}$/.test(ret.checkoutId))) return null
      return {
        projectId: ret.projectId, canvasId: ret.canvasId, sessionId: ret.sessionId,
        checkoutId: ret.checkoutId || null, targetName: ret.canvasId,
        isSaved: ret.mode === 'saved', isDiscarded: ret.mode === 'discarded',
        decisionMessage: ret.mode === 'saved' ? 'Saved · External drawing saved.' : 'Discarded · No pixels were saved.',
      }
    } catch { return null }
  }

  function persistRetirementIntent(ret) {
    try {
      const storage = globalThis.window?.sessionStorage
      if (!storage) throw new Error('Browser recovery storage unavailable')
      if (ret) storage.setItem(retirementStorageKey, JSON.stringify({
        projectId: ret.projectId, canvasId: ret.canvasId, sessionId: ret.sessionId,
        checkoutId: ret.checkoutId || null, mode: ret.isSaved ? 'saved' : 'discarded',
      }))
      else storage.removeItem(retirementStorageKey)
      retirementPersistenceFailed = false
    } catch { retirementPersistenceFailed = true }
  }
  let lastStatusKey = ''
  let notice = null // { text, tone, meta, mode }

  function shellQuoteArg(arg) {
    const str = String(arg ?? '')
    if (str.length > 0 && /^[A-Za-z0-9_./:@=-]+$/.test(str)) return str
    return `'${str.replace(/'/g, `'\\''`)}'`
  }

  function resolveUsableMcpCommandLine(conn) {
    const mcp = conn?.mcp
    if (!mcp) return ''
    if (
      typeof mcp.command_line === 'string'
      && mcp.command_line.trim()
      && mcp.command_line.includes('--grant-id')
      && mcp.command_line.includes('--bridge-token')
      && !mcp.command_line.includes('<BRIDGE_TOKEN>')
    ) {
      return mcp.command_line.trim()
    }
    const tokens = Array.isArray(mcp.command)
      ? mcp.command
      : (typeof mcp.command === 'string' && Array.isArray(mcp.args) ? [mcp.command, ...mcp.args] : null)
    if (
      Array.isArray(tokens)
      && tokens.includes('--grant-id')
      && tokens.includes('--bridge-token')
      && !tokens.includes('<BRIDGE_TOKEN>')
    ) {
      return tokens.map(shellQuoteArg).join(' ')
    }
    return ''
  }

  function applyPendingRetirementFailureNotice(ret, error) {
    const reason = (error?.reason || error?.message || 'server cleanup failed')
      + (retirementPersistenceFailed ? '; recovery storage unavailable — keep this tab open until cleanup succeeds' : '')
    notice = {
      projectId: ret.projectId,
      canvasId: currentSelectionContext().projectId === ret.projectId ? currentSelectionContext().canvasId : ret.canvasId,
      text: ret.isSaved
        ? `Saved locally · Server candidate cleanup failed (${reason}). Click Review returned edit or Revoke to finish retiring the preview without re-saving.`
        : `Discard incomplete · Could not retire external candidate on server (${reason}). Click Review returned edit or Revoke to finish discarding.`,
      tone: 'error',
      meta: `Target ${ret.targetName} (r${ret.projectRevision}/w${ret.workingRevision}) · ${ret.isSaved ? 'Saved once · Cleanup pending' : 'Source unchanged · Cleanup pending'}`,
      keepActions: true,
    }
  }

  async function completePendingRetirement(ret = pendingRetirement) {
    if (!ret) return true
    if (retirementInFlight?.ret === ret) return retirementInFlight.promise
    const promise = finishRetirement(ret)
    retirementInFlight = { ret, promise }
    try { return await promise } finally {
      if (retirementInFlight?.promise === promise) retirementInFlight = null
    }
  }

  async function finishRetirement(ret) {
    if (typeof api?.revokeExternalBridge !== 'function') throw new Error('Server cleanup unavailable')
    {
      await api.revokeExternalBridge(ret.projectId, {
        checkoutId: ret.checkoutId || undefined,
        sessionId: ret.sessionId || undefined,
        discardOnly: true,
      })
    }
    if (pendingRetirement === ret) {
      pendingRetirement = null
      persistRetirementIntent(null)
    }
    activeCheckout = null
    activeConnection = null
    lastStatusKey = ''
    if (ret.isSaved) {
      notice = {
        projectId: ret.projectId,
        canvasId: currentSelectionContext().projectId === ret.projectId ? currentSelectionContext().canvasId : ret.canvasId,
        text: /^Saved\b/i.test(ret.decisionMessage) ? ret.decisionMessage : `Saved · ${ret.decisionMessage}`,
        tone: 'done',
        meta: `Target ${ret.targetName} (r${ret.projectRevision}/w${ret.workingRevision})`,
      }
    } else if (ret.isDiscarded) {
      notice = {
        projectId: ret.projectId,
        canvasId: currentSelectionContext().projectId === ret.projectId ? currentSelectionContext().canvasId : ret.canvasId,
        text: 'Discarded · Preview discarded. No pixels were saved.',
        tone: 'done',
        meta: `Target ${ret.targetName} (r${ret.projectRevision}/w${ret.workingRevision}) · Source unchanged`,
      }
    }
    return true
  }

  async function retireCandidate(ret) {
    if (pendingRetirement && pendingRetirement.sessionId !== ret.sessionId) {
      await completePendingRetirement()
    }
    pendingRetirement = ret
    persistRetirementIntent(ret)
    try {
      await completePendingRetirement(ret)
      return true
    } catch (error) {
      applyPendingRetirementFailureNotice(ret, error)
      return false
    } finally { sync({ skipRefresh: true }) }
  }

  async function resumeRetirement(link) {
    const ret = pendingRetirement
    if (!ret) return null
    const sameCandidate = ret.projectId === link.projectId && ret.sessionId === link.sessionId
    try {
      await completePendingRetirement(ret)
      return sameCandidate ? { message: ret.decisionMessage, error: false } : null
    } catch (error) {
      applyPendingRetirementFailureNotice(ret, error)
      return { message: notice.text, error: true }
    } finally { sync({ skipRefresh: true }) }
  }

  function getCompat() {
    return availability?.compatibility || DEFAULT_EXTERNAL_BRIDGE_COMPATIBILITY
  }

  function currentSelectionContext() {
    const info = session.pixelTargetInfo?.()
    const projectId = session.project?.id || null
    const canvasId = session.view?.selectedId || null
    const stored = projectId && canvasId ? session.project?.canvases?.[canvasId] : null
    const manifest = stored ? session.documents?.get(stored.document_id) : null
    const target = manifest ? session.documentTimeline?.target?.(manifest) : null
    return {
      info,
      projectId,
      projectRevision: session.project?.revision ?? null,
      canvasId,
      stored,
      manifest,
      workingRevision: manifest?.revision ?? null,
      target,
    }
  }

  function updateAvailabilityCopy() {
    if (!availabilityNode) return
    if (!session.project) {
      availabilityNode.textContent = 'Codex STDIO MCP and Aseprite CLI status load when a project is open.'
      return
    }
    if (!availability) {
      availabilityNode.textContent = 'Checking local Codex STDIO MCP and Aseprite CLI availability…'
      return
    }
    const mcpPart = availability.codex_mcp?.available
      ? 'Codex STDIO MCP: Available'
      : `Codex STDIO MCP: Unavailable (${availability.codex_mcp?.reason || 'not found'})`
    const asePart = availability.aseprite?.available
      ? `Aseprite CLI: Available (${availability.aseprite.version || 'ready'})`
      : `Aseprite CLI: Unavailable (${availability.aseprite?.reason || 'not installed'})`
    availabilityNode.textContent = `${mcpPart} · ${asePart}`
  }

  function setStatus(text, tone = '') {
    if (!statusNode) return
    statusNode.textContent = text || ''
    statusNode.hidden = !text
    if (statusNode.dataset) {
      if (tone && text) statusNode.dataset.tone = tone
      else delete statusNode.dataset.tone
    }
  }

  function setMeta(text) {
    if (!metaNode) return
    metaNode.textContent = text || ''
    metaNode.hidden = !text
  }

  function updateHandoffControl(connForCanvas, connStale, checkoutForCanvas, checkoutStale) {
    if (!handoffRow || !handoffInput) return
    if (checkoutForCanvas && !checkoutStale && !checkoutForCanvas.checkout?.expired && !checkoutForCanvas.checkout?.discarded) {
      const val = checkoutForCanvas.checkout?.working_copy_path || checkoutForCanvas.checkout?.checkout_id || ''
      const changed = handoffInput.value !== val || handoffInput.dataset?.handoffKind !== 'aseprite_path'
      handoffRow.hidden = !val
      handoffInput.value = val
      if (handoffInput.dataset) handoffInput.dataset.handoffKind = 'aseprite_path'
      if (changed) {
        if (handoffInput.dataset) {
          delete handoffInput.dataset.copiedValue
          delete handoffInput.dataset.copyState
        }
        if (copyHandoffBtn) copyHandoffBtn.textContent = 'Copy .aseprite path'
      }
      return
    }
    const grantExpired = Boolean(connForCanvas?.grant?.expired || connForCanvas?.grant?.status === 'expired')
    if (connForCanvas && !connStale && !grantExpired) {
      const val = resolveUsableMcpCommandLine(connForCanvas)
      if (val) {
        const changed = handoffInput.value !== val || handoffInput.dataset?.handoffKind !== 'mcp_command'
        handoffRow.hidden = false
        handoffInput.value = val
        if (handoffInput.dataset) handoffInput.dataset.handoffKind = 'mcp_command'
        if (changed) {
          if (handoffInput.dataset) {
            delete handoffInput.dataset.copiedValue
            delete handoffInput.dataset.copyState
          }
          if (copyHandoffBtn) copyHandoffBtn.textContent = 'Copy MCP command'
        }
        return
      }
    }
    handoffRow.hidden = true
    handoffInput.value = ''
    if (handoffInput.dataset) {
      delete handoffInput.dataset.handoffKind
      delete handoffInput.dataset.copiedValue
      delete handoffInput.dataset.copyState
    }
  }

  async function copyHandoff() {
    const val = handoffInput?.value || ''
    if (!val) return null
    handoffInput?.focus?.()
    handoffInput?.select?.()
    const isAsepritePath = handoffInput?.dataset?.handoffKind === 'aseprite_path'
    const kindLabel = isAsepritePath ? '.aseprite path' : 'MCP command'
    const writeText = globalThis.navigator?.clipboard?.writeText
    if (typeof writeText === 'function') {
      try {
        await writeText.call(globalThis.navigator.clipboard, val)
        if (handoffInput?.dataset) {
          handoffInput.dataset.copiedValue = val
          handoffInput.dataset.copyState = 'copied'
        }
        if (copyHandoffBtn) {
          copyHandoffBtn.textContent = `Copied ${kindLabel}`
        }
        return val
      } catch {
        // Fall through to honest manual-copy fallback below
      }
    }
    if (handoffInput?.dataset) {
      delete handoffInput.dataset.copiedValue
      handoffInput.dataset.copyState = 'manual_fallback'
    }
    if (copyHandoffBtn) {
      copyHandoffBtn.textContent = 'Copy unavailable · Press Cmd/Ctrl+C'
    }
    setStatus(`Clipboard copy unavailable · Selected ${kindLabel} for manual copy (Cmd/Ctrl+C).`, 'review')
    return null
  }

  function activeBelongsTo(ctx, record) {
    if (!record || !ctx.projectId || !ctx.canvasId) return false
    return record.projectId === ctx.projectId && record.canvasId === ctx.canvasId
  }

  function activeIsStale(ctx, record) {
    if (!activeBelongsTo(ctx, record)) return false
    return record.projectRevision !== ctx.projectRevision || record.workingRevision !== ctx.workingRevision
  }

  async function refresh({ force = false } = {}) {
    const ctx = currentSelectionContext()
    updateAvailabilityCopy()
    if (!ctx.projectId || typeof api?.getExternalBridgeStatus !== 'function') return null
    if (pendingRetirement && pendingRetirement.projectId === ctx.projectId) {
      const ret = pendingRetirement
      try {
        await completePendingRetirement(ret)
      } catch (error) {
        applyPendingRetirementFailureNotice(ret, error)
      }
    }
    const key = [
      ctx.projectId,
      ctx.projectRevision,
      ctx.canvasId || '',
      ctx.workingRevision || '',
      ctx.target?.cel_id || '',
      activeConnection?.grant?.grant_id || '',
      activeCheckout?.checkout?.checkout_id || '',
      pendingRetirement?.sessionId || pendingRetirement?.checkoutId || '',
    ].join(':')
    if (!force && key === lastStatusKey) return null
    lastStatusKey = key
    try {
      const res = await api.getExternalBridgeStatus(ctx.projectId, {
        canvasId: ctx.canvasId || undefined,
        grantId: activeConnection?.grant?.grant_id || activeCheckout?.checkout?.grant_id || undefined,
      })
      if (res?.availability) {
        availability = res.availability
        updateAvailabilityCopy()
      } else if (res?.codex_mcp || res?.aseprite) {
        availability = {
          codex_mcp: res.codex_mcp,
          aseprite: res.aseprite,
          compatibility: res.compatibility || DEFAULT_EXTERNAL_BRIDGE_COMPATIBILITY,
        }
        updateAvailabilityCopy()
      }
      if (ctx.canvasId && session.view?.selectedId === ctx.canvasId && session.project?.id === ctx.projectId) {
        serverTargetStatus = res?.target || null
        const blockedByPendingRetirement = pendingRetirement
          && pendingRetirement.projectId === ctx.projectId
          && pendingRetirement.canvasId === ctx.canvasId
        const serverCheckout = res?.checkout
          || (Array.isArray(res?.checkouts)
            ? (activeCheckout
              ? res.checkouts.find(c => c.checkout_id === activeCheckout.checkout?.checkout_id)
              : res.checkouts.find(c => !c.revoked && !c.expired && !c.stale && !c.discarded && c.status !== 'discarded'))
            : null)
        if (
          !blockedByPendingRetirement
          && serverCheckout
          && !serverCheckout.cancelled
          && !serverCheckout.revoked
          && !serverCheckout.expired
          && !serverCheckout.discarded
          && serverCheckout.status !== 'discarded'
          && !activeCheckout
        ) {
          const candidateSid = serverCheckout.candidate_session_id || serverCheckout.sealed_session_id || null
          activeCheckout = {
            projectId: ctx.projectId,
            canvasId: ctx.canvasId,
            documentId: ctx.manifest?.document_id,
            projectRevision: serverCheckout.project_revision ?? ctx.projectRevision,
            workingRevision: serverCheckout.working_revision ?? ctx.workingRevision,
            target: ctx.target,
            checkout: serverCheckout,
            bridgeToken: null,
            returnOperationId: null,
            returnedCandidate: candidateSid
              ? {
                session_id: candidateSid,
                candidate: serverCheckout.candidate_summary,
                returned_file_sha256: serverCheckout.returned_file_sha256,
              }
              : null,
          }
        } else if (activeCheckout && serverCheckout && serverCheckout.checkout_id === activeCheckout.checkout?.checkout_id) {
          if (serverCheckout.discarded || serverCheckout.status === 'discarded' || serverCheckout.revoked) {
            activeCheckout = null
          } else {
            activeCheckout.checkout = { ...activeCheckout.checkout, ...serverCheckout }
          }
        }
        const rawServerSession = res?.session
          || res?.latest_candidate
          || (Array.isArray(res?.sessions) ? res.sessions[0] : null)
        const serverSession = !blockedByPendingRetirement
          && rawServerSession
          && !rawServerSession.discarded
          && !rawServerSession.cancelled
          && rawServerSession.status !== 'discarded'
          ? rawServerSession
          : null
        const grantRevoked = Boolean(res?.grant?.revoked || res?.grant?.status === 'revoked')
        const grantExpired = Boolean(res?.grant?.expired || res?.grant?.status === 'expired')
        if (!blockedByPendingRetirement && res?.grant && !grantRevoked && !grantExpired && !activeConnection && !activeCheckout) {
          activeConnection = {
            projectId: ctx.projectId,
            canvasId: ctx.canvasId,
            documentId: ctx.manifest?.document_id,
            projectRevision: res.grant.project_revision ?? ctx.projectRevision,
            workingRevision: res.grant.working_revision ?? ctx.workingRevision,
            target: ctx.target,
            grant: res.grant,
            bridgeToken: res.grant.bridge_token || null,
            mcp: res?.codex_mcp?.command_line ? res.codex_mcp : null,
            sessionId: serverSession?.session_id || null,
            session: serverSession || null,
          }
        } else if (activeConnection && serverSession) {
          activeConnection.session = {
            ...serverSession,
            has_candidate: Boolean(serverSession.has_candidate ?? serverSession.sealed),
          }
          activeConnection.sessionId = serverSession.session_id
        } else if (activeConnection && !serverSession && rawServerSession?.discarded) {
          activeConnection.session = null
          activeConnection.sessionId = null
        }
        sync({ skipRefresh: true })
      }
      return res
    } catch {
      return null
    }
  }

  function sync({ skipRefresh = false } = {}) {
    const ctx = currentSelectionContext()
    updateAvailabilityCopy()
    if (!ctx.info || !ctx.projectId || !ctx.canvasId || !ctx.manifest) {
      panel.hidden = true
      return
    }
    panel.hidden = false
    if (!skipRefresh) {
      void refresh()
    }

    const compat = getCompat()
    const clientCheck = inspectClientExternalTarget(ctx.manifest, ctx.info, compat)
    const serverIncompatible = serverTargetStatus
      && (serverTargetStatus.compatible === false || serverTargetStatus.supported === false)
      && serverTargetStatus.code !== 'no_target'
      && serverTargetStatus.reason !== 'missing_target'
    const compatible = clientCheck.compatible && !serverIncompatible
    const incompatibleReason = !clientCheck.compatible
      ? clientCheck.reason
      : (serverIncompatible ? (serverTargetStatus.message || serverTargetStatus.reason) : '')

    const mcpAvailable = availability ? Boolean(availability.codex_mcp?.available) : true
    const asepriteAvailable = availability ? Boolean(availability.aseprite?.available) : true

    const connForCanvas = activeBelongsTo(ctx, activeConnection) ? activeConnection : null
    const checkoutForCanvas = activeBelongsTo(ctx, activeCheckout) ? activeCheckout : null
    const pendingRetireForCanvas = pendingRetirement?.projectId === ctx.projectId ? pendingRetirement : null
    const connStale = connForCanvas ? activeIsStale(ctx, connForCanvas) : false
    const checkoutStale = checkoutForCanvas ? activeIsStale(ctx, checkoutForCanvas) : false

    updateHandoffControl(connForCanvas, connStale, checkoutForCanvas, checkoutStale)

    const otherWorkBusy = Boolean(
      busy
      || session.manualWrite
      || session.manualGesture
      || session.pendingImport
      || session.pendingSave
      || session.historyBusy
      || session.pixelCopyPending
      || session.pixelProcessing?.busy
      || session.hasAssistantWork?.(),
    )

    if (connectBtn) {
      connectBtn.disabled = !compatible || !mcpAvailable || otherWorkBusy
    }
    if (checkoutBtn) {
      checkoutBtn.disabled = !compatible || !asepriteAvailable || otherWorkBusy
    }

    const hasActiveState = Boolean(connForCanvas || checkoutForCanvas || pendingRetireForCanvas || notice?.keepActions)
    if (stateActions) stateActions.hidden = !hasActiveState
    if (reviewBtn) {
      reviewBtn.hidden = !hasActiveState
      reviewBtn.disabled = !hasActiveState || otherWorkBusy
      reviewBtn.className = checkoutForCanvas || connForCanvas?.session?.sealed || pendingRetireForCanvas
        ? 'vnext-prop-btn is-primary'
        : 'vnext-prop-btn'
    }
    if (revokeBtn) {
      revokeBtn.hidden = !hasActiveState
      revokeBtn.disabled = !hasActiveState || busy
    }

    const revLabel = `r${ctx.projectRevision}/w${ctx.workingRevision}`
    const scopeRect = session.pixelSelection?.projectId === ctx.projectId && session.pixelSelection?.canvasId === ctx.canvasId
      ? session.pixelSelection.rect
      : null
    const width = ctx.manifest.canvas?.w ?? ctx.info.width
    const height = ctx.manifest.canvas?.h ?? ctx.info.height
    const scopePart = scopeRect
      ? ` · Selection (${scopeRect.x}, ${scopeRect.y}, ${scopeRect.w}×${scopeRect.h})`
      : ` · ${width} × ${height} px`

    if (notice && notice.canvasId === ctx.canvasId && notice.projectId === ctx.projectId) {
      setStatus(notice.text, notice.tone)
      setMeta(notice.meta || `Target ${ctx.info.name} (${revLabel})${scopePart}`)
      return
    }

    if (!compatible) {
      setStatus(`Unsupported target · ${incompatibleReason}`, 'error')
      setMeta(`Target ${ctx.info.name} (${revLabel})${scopePart} · Source unchanged`)
      return
    }

    if (!mcpAvailable && !asepriteAvailable) {
      setStatus('External tools are unavailable on this machine.', 'error')
      setMeta(`Target ${ctx.info.name} (${revLabel})${scopePart}`)
      return
    }

    if (checkoutForCanvas) {
      if (checkoutStale || checkoutForCanvas.checkout?.expired) {
        setStatus(
          checkoutStale
            ? `Conflict · Canvas changed after external checkout (r${checkoutForCanvas.projectRevision}/w${checkoutForCanvas.workingRevision} → ${revLabel}). No pixels were saved.`
            : 'Expired · External edit copy expired after 15 minutes. Create a new external edit copy.',
          'error',
        )
        setMeta(`Target ${ctx.info.name} (${revLabel}) · Checkout ${checkoutForCanvas.checkout.checkout_id} · Unsaved`)
        return
      }
      if (checkoutForCanvas.returnedCandidate) {
        const changed = checkoutForCanvas.returnedCandidate.changed_pixels
          ?? checkoutForCanvas.returnedCandidate.diff?.changed_pixels
          ?? checkoutForCanvas.returnedCandidate.candidate?.changed_pixels
          ?? 0
        setStatus(`Returned candidate ready · ${changed} px changed · Unsaved`, 'review')
        setMeta(
          `Target ${ctx.info.name} (${revLabel}) · Checkout ${checkoutForCanvas.checkout.checkout_id} · File sha256 ${(checkoutForCanvas.returnedCandidate.returned_file_sha256 || '').slice(0, 12)}…`,
        )
        return
      }
      const attempts = checkoutForCanvas.checkout.return_attempts ?? 0
      const maxAttempts = checkoutForCanvas.checkout.max_return_attempts ?? 3
      const workingPath = checkoutForCanvas.checkout.working_copy_path
        ? ` · Path: ${checkoutForCanvas.checkout.working_copy_path}`
        : ''
      setStatus('External edit copy ready · Edit in Aseprite, then review · Unsaved', 'review')
      setMeta(
        `Target ${ctx.info.name} (${revLabel})${scopePart} · Checkout ${checkoutForCanvas.checkout.checkout_id} · ${attempts}/${maxAttempts} return attempts${workingPath}`,
      )
      return
    }

    if (connForCanvas) {
      const grantExpired = Boolean(connForCanvas.grant?.expired || connForCanvas.grant?.status === 'expired')
      if (connStale || grantExpired) {
        setStatus(
          connStale
            ? `Conflict · Canvas changed after connecting external tools (r${connForCanvas.projectRevision}/w${connForCanvas.workingRevision} → ${revLabel}). No pixels were saved.`
            : 'Expired · External tool authorization expired. Connect again for a fresh snapshot.',
          'error',
        )
        setMeta(`Target ${ctx.info.name} (${revLabel}) · Grant ${connForCanvas.grant.grant_id} · Unsaved`)
        return
      }
      if (connForCanvas.session?.sealed && (connForCanvas.session?.has_candidate ?? true)) {
        setStatus('Returned candidate ready · Codex STDIO MCP sealed proposal · Unsaved', 'review')
        setMeta(`Target ${ctx.info.name} (${revLabel}) · Session ${connForCanvas.session.session_id} · ${connForCanvas.session.drawing_batches}/3 batches`)
        return
      }
      const calls = connForCanvas.session?.tool_calls ?? 0
      const batches = connForCanvas.session?.drawing_batches ?? 0
      const mcpCommandLine = resolveUsableMcpCommandLine(connForCanvas)
      if (!mcpCommandLine && calls === 0) {
        setStatus('Authorized · Reconnect external tools to copy task-scoped MCP command · Unsaved', 'review')
        setMeta(
          `Target ${ctx.info.name} (${revLabel})${scopePart} · Grant ${connForCanvas.grant.grant_id} · Reconnect required for STDIO handoff`,
        )
        return
      }
      setStatus(
        calls > 0
          ? `Running · Codex STDIO MCP active (${calls}/9 calls, ${batches}/3 batches) · Unsaved`
          : 'Ready · Codex STDIO MCP authorized · Unsaved',
        'review',
      )
      setMeta(
        `Target ${ctx.info.name} (${revLabel})${scopePart} · Grant ${connForCanvas.grant.grant_id}${mcpCommandLine ? ` · STDIO: ${mcpCommandLine}` : ''}`,
      )
      return
    }

    setStatus('', '')
    setMeta(`Not authorized · Target ${ctx.info.name} (${revLabel})${scopePart} · Binary alpha`)
  }

  async function connect() {
    if (busy) return null
    const ctx = currentSelectionContext()
    if (!ctx.projectId || !ctx.canvasId || !ctx.manifest) return null
    busy = true
    notice = {
      projectId: ctx.projectId,
      canvasId: ctx.canvasId,
      text: 'Authorizing local external tools…',
      tone: 'busy',
      meta: `Target ${ctx.info?.name || ctx.canvasId} (r${ctx.projectRevision}/w${ctx.workingRevision})`,
    }
    sync({ skipRefresh: true })
    try {
      if (pendingRetirement) {
        try {
          await completePendingRetirement(pendingRetirement)
        } catch (retireError) {
          applyPendingRetirementFailureNotice(pendingRetirement, retireError)
          return null
        }
      }
      const source = await session.preparePixelEdit({ scopeGrant: false })
      if (
        !connectPending
        || connectPending.projectId !== source.projectId
        || connectPending.canvasId !== source.sourceCanvasId
        || connectPending.projectRevision !== source.projectRevision
        || connectPending.workingRevision !== source.sourceRevision
      ) {
        connectPending = {
          projectId: source.projectId,
          canvasId: source.sourceCanvasId,
          projectRevision: source.projectRevision,
          workingRevision: source.sourceRevision,
          operationId: createOperationId(),
        }
      }
      const res = await api.connectExternalBridge(source.projectId, {
        operationId: connectPending.operationId,
        expectedRevision: source.projectRevision,
        expectedWorkingRevision: source.sourceRevision,
        canvasId: source.sourceCanvasId,
        documentId: source.sourceDocumentId,
        frameId: source.target.frame_id,
        layerId: source.target.layer_id,
        celId: source.target.cel_id,
        rect: source.allowedRect || undefined,
      })
      connectPending = null
      if (res?.compatibility && availability) {
        availability = { ...availability, compatibility: res.compatibility }
      }
      const grantObj = res?.grant || {
        grant_id: res?.grant_id,
        bridge_token: res?.bridge_token,
        project_revision: res?.project_revision ?? source.projectRevision,
        working_revision: res?.working_revision ?? source.sourceRevision,
        allowed_rect: res?.allowed_rect ?? source.allowedRect,
        allowed_operations: res?.allowed_operations,
        expires_at: res?.expires_at,
      }
      activeConnection = {
        projectId: source.projectId,
        canvasId: source.sourceCanvasId,
        documentId: source.sourceDocumentId,
        projectRevision: source.projectRevision,
        workingRevision: source.sourceRevision,
        target: source.target,
        grant: grantObj,
        bridgeToken: grantObj.bridge_token || res?.bridge_token || null,
        mcp: res?.codex_mcp || res?.mcp || null,
        reviewHash: res?.review_hash || null,
        sessionId: grantObj?.session_id || null,
        session: null,
      }
      notice = null
      lastStatusKey = ''
      return res
    } catch (error) {
      if (error?.kind === 'unknown' && connectPending) {
        notice = {
          projectId: ctx.projectId,
          canvasId: ctx.canvasId,
          text: 'Connection status is uncertain · Retry Connect external tools with the same request before continuing.',
          tone: 'error',
          meta: `Target ${ctx.info?.name || ctx.canvasId} (r${ctx.projectRevision}/w${ctx.workingRevision}) · Same operation ID preserved`,
        }
      } else {
        connectPending = null
        notice = {
          projectId: ctx.projectId,
          canvasId: ctx.canvasId,
          text: `Could not connect external tools · ${error.reason || error.message || 'Source unchanged.'}`,
          tone: 'error',
          meta: `Target ${ctx.info?.name || ctx.canvasId} (r${ctx.projectRevision}/w${ctx.workingRevision}) · Source unchanged`,
        }
      }
      return null
    } finally {
      busy = false
      sync({ skipRefresh: true })
    }
  }

  async function createCheckout() {
    if (busy) return null
    const ctx = currentSelectionContext()
    if (!ctx.projectId || !ctx.canvasId || !ctx.manifest) return null
    busy = true
    notice = {
      projectId: ctx.projectId,
      canvasId: ctx.canvasId,
      text: 'Creating Aseprite (.aseprite) external edit copy…',
      tone: 'busy',
      meta: `Target ${ctx.info?.name || ctx.canvasId} (r${ctx.projectRevision}/w${ctx.workingRevision})`,
    }
    sync({ skipRefresh: true })
    try {
      if (pendingRetirement) {
        try {
          await completePendingRetirement(pendingRetirement)
        } catch (retireError) {
          applyPendingRetirementFailureNotice(pendingRetirement, retireError)
          return null
        }
      }
      const source = await session.preparePixelEdit({ scopeGrant: false })
      if (
        !checkoutPending
        || checkoutPending.projectId !== source.projectId
        || checkoutPending.canvasId !== source.sourceCanvasId
        || checkoutPending.projectRevision !== source.projectRevision
        || checkoutPending.workingRevision !== source.sourceRevision
      ) {
        checkoutPending = {
          projectId: source.projectId,
          canvasId: source.sourceCanvasId,
          projectRevision: source.projectRevision,
          workingRevision: source.sourceRevision,
          connectOperationId: createOperationId(),
          checkoutOperationId: createOperationId(),
          grantId: null,
          bridgeToken: null,
        }
      }
      let grantId = checkoutPending.grantId
      let bridgeToken = checkoutPending.bridgeToken
      if (
        !grantId
        && activeConnection
        && activeConnection.projectId === source.projectId
        && activeConnection.canvasId === source.sourceCanvasId
        && activeConnection.projectRevision === source.projectRevision
        && activeConnection.workingRevision === source.sourceRevision
        && activeConnection.grant?.grant_id
      ) {
        grantId = activeConnection.grant.grant_id
        bridgeToken = activeConnection.bridgeToken || activeConnection.grant.bridge_token || null
        checkoutPending.grantId = grantId
        checkoutPending.bridgeToken = bridgeToken
      } else if (!grantId && typeof api?.connectExternalBridge === 'function') {
        const connected = await api.connectExternalBridge(source.projectId, {
          operationId: checkoutPending.connectOperationId,
          expectedRevision: source.projectRevision,
          expectedWorkingRevision: source.sourceRevision,
          canvasId: source.sourceCanvasId,
          documentId: source.sourceDocumentId,
          frameId: source.target.frame_id,
          layerId: source.target.layer_id,
          celId: source.target.cel_id,
          rect: source.allowedRect || undefined,
        })
        const grantObj = connected?.grant || {
          grant_id: connected?.grant_id,
          bridge_token: connected?.bridge_token,
          project_revision: connected?.project_revision ?? source.projectRevision,
          working_revision: connected?.working_revision ?? source.sourceRevision,
          allowed_rect: connected?.allowed_rect ?? source.allowedRect,
          allowed_operations: connected?.allowed_operations,
          expires_at: connected?.expires_at,
        }
        grantId = grantObj.grant_id || null
        bridgeToken = grantObj.bridge_token || connected?.bridge_token || null
        checkoutPending.grantId = grantId
        checkoutPending.bridgeToken = bridgeToken
        activeConnection = {
          projectId: source.projectId,
          canvasId: source.sourceCanvasId,
          documentId: source.sourceDocumentId,
          projectRevision: source.projectRevision,
          workingRevision: source.sourceRevision,
          target: source.target,
          grant: grantObj,
          bridgeToken,
          mcp: connected?.codex_mcp || connected?.mcp || null,
          reviewHash: connected?.review_hash || null,
          sessionId: grantObj?.session_id || null,
          session: null,
        }
      }
      const res = await api.createAsepriteCheckout(source.projectId, {
        operationId: checkoutPending.checkoutOperationId,
        grantId,
        bridgeToken,
        expectedRevision: source.projectRevision,
        expectedWorkingRevision: source.sourceRevision,
        canvasId: source.sourceCanvasId,
        documentId: source.sourceDocumentId,
        frameId: source.target.frame_id,
        layerId: source.target.layer_id,
        celId: source.target.cel_id,
        rect: source.allowedRect || undefined,
      })
      checkoutPending = null
      const checkoutObj = res?.checkout || res
      activeCheckout = {
        projectId: source.projectId,
        canvasId: source.sourceCanvasId,
        documentId: source.sourceDocumentId,
        projectRevision: source.projectRevision,
        workingRevision: source.sourceRevision,
        target: source.target,
        checkout: checkoutObj,
        bridgeToken,
        returnOperationId: null,
        returnedCandidate: null,
      }
      notice = null
      lastStatusKey = ''
      return res
    } catch (error) {
      if (error?.kind === 'unknown' && checkoutPending) {
        notice = {
          projectId: ctx.projectId,
          canvasId: ctx.canvasId,
          text: 'Checkout status is uncertain · Retry Create external edit copy with the same request before continuing.',
          tone: 'error',
          meta: `Target ${ctx.info?.name || ctx.canvasId} (r${ctx.projectRevision}/w${ctx.workingRevision}) · Same operation ID preserved`,
        }
      } else {
        checkoutPending = null
        notice = {
          projectId: ctx.projectId,
          canvasId: ctx.canvasId,
          text: `Could not create external edit copy · ${error.reason || error.message || 'Source unchanged.'}`,
          tone: 'error',
          meta: `Target ${ctx.info?.name || ctx.canvasId} (r${ctx.projectRevision}/w${ctx.workingRevision}) · Source unchanged`,
        }
      }
      return null
    } finally {
      busy = false
      sync({ skipRefresh: true })
    }
  }

  async function reviewReturned() {
    if (busy) return null
    const ctx = currentSelectionContext()
    if (!ctx.projectId || !ctx.canvasId || !ctx.manifest) return null
    if (pendingRetirement) {
      const ret = pendingRetirement
      busy = true
      try {
        await completePendingRetirement(ret)
        return ret.decisionMessage
      } catch (error) {
        applyPendingRetirementFailureNotice(ret, error)
        return null
      } finally {
        busy = false
        sync({ skipRefresh: true })
      }
    }
    const checkoutForCanvas = activeBelongsTo(ctx, activeCheckout) ? activeCheckout : null
    const connForCanvas = activeBelongsTo(ctx, activeConnection) ? activeConnection : null
    if (!checkoutForCanvas && !connForCanvas) return null

    const record = checkoutForCanvas || connForCanvas
    if (activeIsStale(ctx, record)) {
      notice = {
        projectId: ctx.projectId,
        canvasId: ctx.canvasId,
        text: `Conflict · Canvas changed since external snapshot (r${record.projectRevision}/w${record.workingRevision} → r${ctx.projectRevision}/w${ctx.workingRevision}). No pixels were saved.`,
        tone: 'error',
        meta: `Target ${ctx.info?.name || ctx.canvasId} (r${ctx.projectRevision}/w${ctx.workingRevision}) · Source unchanged`,
        keepActions: true,
      }
      sync({ skipRefresh: true })
      return null
    }

    busy = true
    try {
      let sessionId = null
      if (checkoutForCanvas) {
        if (!checkoutForCanvas.returnedCandidate) {
          checkoutForCanvas.returnOperationId ||= createOperationId()
          notice = {
            projectId: ctx.projectId,
            canvasId: ctx.canvasId,
            text: 'Validating returned Aseprite (.aseprite) file…',
            tone: 'busy',
            meta: `Target ${ctx.info?.name || ctx.canvasId} (r${ctx.projectRevision}/w${ctx.workingRevision}) · Checkout ${checkoutForCanvas.checkout.checkout_id}`,
            keepActions: true,
          }
          sync({ skipRefresh: true })
          const ret = await api.returnAsepriteCheckout(
            checkoutForCanvas.projectId,
            checkoutForCanvas.checkout.checkout_id,
            {
              operationId: checkoutForCanvas.returnOperationId,
              bridgeToken: checkoutForCanvas.bridgeToken || undefined,
              expectedRevision: checkoutForCanvas.projectRevision,
              expectedWorkingRevision: checkoutForCanvas.workingRevision,
            },
          )
          checkoutForCanvas.returnedCandidate = ret
          const attempts = ret?.return_attempts ?? ret?.candidate?.return_attempts
          if (Number.isInteger(attempts)) {
            checkoutForCanvas.checkout.return_attempts = attempts
          } else {
            checkoutForCanvas.checkout.return_attempts = (checkoutForCanvas.checkout.return_attempts || 0) + 1
          }
        }
        sessionId = checkoutForCanvas.returnedCandidate.session_id
      } else if (connForCanvas) {
        const latest = await refresh({ force: true })
        const sess = latest?.session
          || latest?.latest_candidate
          || (Array.isArray(latest?.sessions) ? latest.sessions.find(s => s.sealed && s.status === 'review_ready') || latest.sessions[0] : null)
          || connForCanvas.session
        const grantRevoked = Boolean(latest?.grant?.revoked || latest?.grant?.status === 'revoked' || sess?.cancelled)
        if (grantRevoked) {
          notice = {
            projectId: ctx.projectId,
            canvasId: ctx.canvasId,
            text: 'Cancelled · External session was cancelled or revoked. Source unchanged.',
            tone: 'error',
            meta: `Target ${ctx.info?.name || ctx.canvasId} (r${ctx.projectRevision}/w${ctx.workingRevision})`,
          }
          activeConnection = null
          return null
        }
        const grantExpired = Boolean(latest?.grant?.expired || latest?.grant?.status === 'expired')
        if (grantExpired) {
          notice = {
            projectId: ctx.projectId,
            canvasId: ctx.canvasId,
            text: 'Expired · External tool authorization expired. Connect again for a fresh snapshot.',
            tone: 'error',
            meta: `Target ${ctx.info?.name || ctx.canvasId} (r${ctx.projectRevision}/w${ctx.workingRevision})`,
            keepActions: true,
          }
          return null
        }
        if (!sess?.session_id || !sess.sealed || !(sess.has_candidate ?? true)) {
          notice = {
            projectId: ctx.projectId,
            canvasId: ctx.canvasId,
            text: 'No returned edit ready yet · Seal a proposal with request_acceptance in MCP first.',
            tone: 'review',
            meta: `Target ${ctx.info?.name || ctx.canvasId} (r${ctx.projectRevision}/w${ctx.workingRevision}) · Grant ${connForCanvas.grant.grant_id}`,
            keepActions: true,
          }
          return null
        }
        sessionId = sess.session_id
      }

      if (!sessionId) return null
      notice = {
        projectId: ctx.projectId,
        canvasId: ctx.canvasId,
        text: 'Reviewing external candidate · Confirm Save drawing or Discard preview…',
        tone: 'review',
        meta: `Target ${ctx.info?.name || ctx.canvasId} (r${ctx.projectRevision}/w${ctx.workingRevision}) · Session ${sessionId}`,
        keepActions: true,
      }
      busy = false
      sync({ skipRefresh: true })

      const decisionMessage = await session.reviewExternalCandidate({
        projectId: ctx.projectId,
        sessionId,
      })

      const latestCtx = currentSelectionContext()
      const targetCanvasId = latestCtx.canvasId || ctx.canvasId
      const isSaved = typeof decisionMessage === 'string'
        && (/saved/i.test(decisionMessage) || /beside the original/i.test(decisionMessage))
        && !/not confirmed|no pixels were saved/i.test(decisionMessage)
      const isDiscarded = typeof decisionMessage === 'string' && /discarded/i.test(decisionMessage)

      if (isSaved || isDiscarded) {
        const retirement = {
          projectId: ctx.projectId,
          canvasId: ctx.canvasId,
          targetName: latestCtx.info?.name || ctx.info?.name || targetCanvasId,
          projectRevision: latestCtx.projectRevision ?? ctx.projectRevision,
          workingRevision: latestCtx.workingRevision ?? ctx.workingRevision,
          checkoutId: checkoutForCanvas?.checkout?.checkout_id || null,
          sessionId,
          grantId: connForCanvas?.grant?.grant_id || checkoutForCanvas?.checkout?.grant_id || null,
          isSaved,
          isDiscarded,
          decisionMessage,
        }
        await retireCandidate(retirement)
      } else if (typeof decisionMessage === 'string') {
        notice = {
          projectId: ctx.projectId,
          canvasId: targetCanvasId,
          text: decisionMessage,
          tone: /not confirmed/i.test(decisionMessage) ? 'error' : 'review',
          meta: `Target ${latestCtx.info?.name || ctx.info?.name || targetCanvasId} (r${latestCtx.projectRevision ?? ctx.projectRevision}/w${latestCtx.workingRevision ?? ctx.workingRevision})`,
          keepActions: true,
        }
      }
      return decisionMessage
    } catch (error) {
      if (error?.kind === 'unknown' && checkoutForCanvas) {
        notice = {
          projectId: ctx.projectId,
          canvasId: ctx.canvasId,
          text: 'Return status is uncertain · Retry Review returned edit with the same request before continuing.',
          tone: 'error',
          meta: `Target ${ctx.info?.name || ctx.canvasId} (r${ctx.projectRevision}/w${ctx.workingRevision}) · Same operation ID preserved`,
          keepActions: true,
        }
      } else {
        if (checkoutForCanvas) {
          checkoutForCanvas.returnOperationId = null
          await refresh({ force: true })
        }
        const attemptsMeta = checkoutForCanvas
          ? ` · ${checkoutForCanvas.checkout.return_attempts ?? 0}/${checkoutForCanvas.checkout.max_return_attempts ?? 3} return attempts`
          : ''
        const prefix = error?.code === 'stale_revision' || error?.code === 'pixel_tool_context_changed'
          ? 'Conflict'
          : error?.code === 'checkout_expired' || error?.code === 'grant_expired' || error?.code === 'pixel_tool_session_expired'
            ? 'Expired'
            : 'Invalid returned edit'
        notice = {
          projectId: ctx.projectId,
          canvasId: ctx.canvasId,
          text: `${prefix} · ${error.reason || error.message || 'The external edit could not be verified. Source unchanged.'}`,
          tone: 'error',
          meta: `Target ${ctx.info?.name || ctx.canvasId} (r${ctx.projectRevision}/w${ctx.workingRevision})${attemptsMeta} · Source unchanged`,
          keepActions: Boolean(checkoutForCanvas || connForCanvas),
        }
      }
      return null
    } finally {
      busy = false
      sync({ skipRefresh: true })
    }
  }

  async function revoke() {
    if (busy) return null
    if (pendingRetirement) return reviewReturned()
    const ctx = currentSelectionContext()
    if (!ctx.projectId) return null
    const grantId = activeConnection?.grant?.grant_id || activeCheckout?.checkout?.grant_id || pendingRetirement?.grantId || null
    const checkoutId = activeCheckout?.checkout?.checkout_id || pendingRetirement?.checkoutId || null
    const sessionId = activeConnection?.session?.session_id || activeConnection?.sessionId || pendingRetirement?.sessionId || null
    if (!grantId && !checkoutId && !sessionId) {
      activeConnection = null
      activeCheckout = null
      connectPending = null
      checkoutPending = null
      pendingRetirement = null
      notice = null
      sync({ skipRefresh: true })
      return null
    }
    busy = true
    try {
      const res = await api.revokeExternalBridge(ctx.projectId, {
        grantId: grantId || undefined,
        checkoutId: checkoutId || undefined,
        sessionId: sessionId || undefined,
        discardOnly: Boolean(!grantId && pendingRetirement),
      })
      activeConnection = null
      activeCheckout = null
      connectPending = null
      checkoutPending = null
      pendingRetirement = null
      lastStatusKey = ''
      notice = {
        projectId: ctx.projectId,
        canvasId: ctx.canvasId,
        text: 'Revoked · External access and unsaved candidates cancelled. Source unchanged.',
        tone: 'done',
        meta: `Target ${ctx.info?.name || ctx.canvasId} (r${ctx.projectRevision}/w${ctx.workingRevision}) · Source unchanged`,
      }
      return res
    } catch (error) {
      if (pendingRetirement) {
        applyPendingRetirementFailureNotice(pendingRetirement, error)
      } else {
        notice = {
          projectId: ctx.projectId,
          canvasId: ctx.canvasId,
          text: `Could not revoke external access · ${error.reason || error.message || 'Try again.'}`,
          tone: 'error',
          meta: `Target ${ctx.info?.name || ctx.canvasId} (r${ctx.projectRevision}/w${ctx.workingRevision})`,
          keepActions: true,
        }
      }
      return null
    } finally {
      busy = false
      sync({ skipRefresh: true })
    }
  }

  connectBtn?.addEventListener('click', () => { void connect() })
  checkoutBtn?.addEventListener('click', () => { void createCheckout() })
  reviewBtn?.addEventListener('click', () => { void reviewReturned() })
  revokeBtn?.addEventListener('click', () => { void revoke() })
  copyHandoffBtn?.addEventListener('click', () => { void copyHandoff() })

  sync()
  return {
    get busy() { return busy },
    get state() {
      return {
        availability,
        serverTargetStatus,
        activeConnection,
        activeCheckout,
        connectPending,
        checkoutPending,
        pendingRetirement,
        notice,
      }
    },
    sync,
    refresh,
    connect,
    createCheckout,
    reviewReturned,
    retireCandidate,
    resumeRetirement,
    revoke,
    copyHandoff,
  }
}
