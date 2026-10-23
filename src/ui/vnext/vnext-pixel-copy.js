import { createPixelEditCandidate } from '../../editor-project/pixelEditOps.js'
import { createOperationId, sha256Hex } from './vnext-project-client.js'
import { pixelDocumentTarget } from '../../editor-project/pixelDocumentTarget.js'
import { pixelLinkScope } from '../../editor-project/pixelLinks.js'

const fail = (code, message, extra = {}) => { throw Object.assign(new Error(message), { code, ...extra }) }
export function pixelCopySource(project, canvasId, documents, target) {
  const canvas = project?.canvases?.[canvasId]
  const manifest = documents.get(canvas?.document_id)
  let checked
  try { checked = pixelDocumentTarget(manifest, target, { writable: true }) } catch { fail('pixel_source_unsupported', 'Select an unlocked raster layer and frame before editing.') }
  const cel = checked.cel
  const width = manifest?.canvas?.w, height = manifest?.canvas?.h
  if (!canvas || (cel.block && (cel.block.w !== width || cel.block.h !== height))
    || project.sprite_documents?.[canvas.document_id]?.working_revision !== manifest.revision) {
    fail('pixel_source_unsupported', 'Select one unlocked, single-frame image before editing.')
  }
  return { projectId: project.id, projectRevision: project.revision, sourceCanvasId: canvasId,
    sourceDocumentId: canvas.document_id, sourceRevision: manifest.revision, width, height,
    target: { frame_id: cel.frame_id, layer_id: cel.layer_id, cel_id: cel.id },
    multiCel: manifest.frame_order.length > 1 || manifest.layer_order.length > 1,
    hasLinks: Object.hasOwn(manifest, 'links'), linkScope: pixelLinkScope(manifest, cel.id),
    linkedLayerName: checked.layer.name,
    linkedFrames: pixelLinkScope(manifest, cel.id)?.cel_ids.map(id => manifest.frame_order.indexOf(manifest.cels[id].frame_id) + 1).sort((a, b) => a - b) || [],
    sha256: cel.block?.sha256 || null, name: `${(canvas.display_name || manifest.name || 'Image').slice(0, 120)} · copy` }
}

export const WORKING_PIXELS_MAX_BYTES = 4 * 1024 * 1024

export function diffPixelRect(before, after, width, height, clip = null) {
  if (!(before instanceof Uint8Array) || !(after instanceof Uint8Array) || before.length !== after.length) return null
  const startX = clip ? Math.max(0, clip.x) : 0
  const startY = clip ? Math.max(0, clip.y) : 0
  const endX = clip ? Math.min(width, clip.x + clip.w) : width
  const endY = clip ? Math.min(height, clip.y + clip.h) : height
  let minX = endX, minY = endY, maxX = -1, maxY = -1
  for (let y = startY; y < endY; y += 1) {
    let rowBase = (y * width + startX) * 4
    for (let x = startX; x < endX; x += 1, rowBase += 4) {
      if (
        before[rowBase] !== after[rowBase]
        || before[rowBase + 1] !== after[rowBase + 1]
        || before[rowBase + 2] !== after[rowBase + 2]
        || before[rowBase + 3] !== after[rowBase + 3]
      ) {
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < minX || maxY < minY) return null
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}

export function splitPixelRectStrips(rect, maxBytes = WORKING_PIXELS_MAX_BYTES) {
  const rowBytes = rect.w * 4
  if (rect.w * rect.h * 4 <= maxBytes) return [{ x: rect.x, y: rect.y, w: rect.w, h: rect.h }]
  const maxRows = Math.max(1, Math.floor(maxBytes / rowBytes))
  const strips = []
  for (let y = rect.y; y < rect.y + rect.h; y += maxRows) {
    const h = Math.min(maxRows, rect.y + rect.h - y)
    strips.push({ x: rect.x, y, w: rect.w, h })
  }
  return strips
}

export function extractPixelPatch(bytes, width, rect) {
  if (rect.x === 0 && rect.y === 0 && rect.w === width && bytes.length === rect.w * rect.h * 4) return bytes
  const patch = new Uint8Array(rect.w * rect.h * 4)
  for (let row = 0; row < rect.h; row += 1) {
    const start = ((rect.y + row) * width + rect.x) * 4
    patch.set(bytes.subarray(start, start + rect.w * 4), row * rect.w * 4)
  }
  return patch
}

export async function scopedPixelRequest(api, source, bytes, { documentId = source.sourceDocumentId, revision = source.sourceRevision, projectRevision = source.projectRevision, target = source.target, rect: explicitRect = null, operationId = null, state = {} } = {}) {
  if (state.result) return state.result
  const baseRect = explicitRect || source.allowedRect || { x: 0, y: 0, w: source.width, h: source.height }
  const rect = !explicitRect && baseRect.w * baseRect.h * 4 > WORKING_PIXELS_MAX_BYTES && source.rgba instanceof Uint8Array
    ? (diffPixelRect(source.rgba, bytes, source.width, source.height, baseRect) || baseRect)
    : baseRect
  const patch = extractPixelPatch(bytes, source.width, rect)
  const expectedSha256 = await sha256Hex(patch)
  const request = state.request ||= { operationId: operationId || createOperationId(), expectedRevision: projectRevision, expectedWorkingRevision: revision,
    x: rect.x, y: rect.y, width: rect.w, height: rect.h, bytes: patch, expectedSha256,
    ...(target ? { target } : {}) }
  if (source.allowedRect || source.linkScope) {
    const grantRect = source.allowedRect || { x: 0, y: 0, w: source.width, h: source.height }
    const grantBody = state.grantBody ||= Object.freeze({ operation_id: createOperationId(),
      expected_revision: projectRevision, expected_working_revision: revision, ...target,
      rect: grantRect, allowed_operations: ['working_pixels'], command: { rect, sha256: expectedSha256 },
      ...(source.linkScope ? { link_scope: source.linkScope } : {}) })
    const grant = await api.createScopeGrant(source.projectId, documentId, grantBody)
    if (!grant?.grant_id || !grant.command_sha256) fail('pixel_scope_invalid', 'Selection grant was not confirmed.')
    Object.assign(request, { grantId: grant.grant_id, commandSha256: grant.command_sha256 })
  }
  return state.result = Object.freeze(request)
}

export function pixelCopyPosition(view, source) {
  const gap = 16
  const point = view.positionOf(source.sourceCanvasId)
  let x = point.x + source.width + gap
  const y = point.y
  const others = view.canvases.filter(c => c.id !== source.sourceCanvasId && !c.transient)
  for (let step = 0; step <= others.length; step++) {
    const hit = others.find(c => {
      const p = view.positionOf(c.id)
      return x < p.x + c.width + gap && x + source.width + gap > p.x && y < p.y + c.height && y + source.height > p.y
    })
    if (!hit && Number.isSafeInteger(x) && Number.isSafeInteger(y)) return { x, y }
    if (!hit) break
    x = view.positionOf(hit.id).x + hit.width + gap
  }
  fail('pixel_position_unavailable', 'No free position beside this image. No new image was created.')
}

// The two existing document writes are deliberately not advertised as atomic.
// Each phase keeps its exact request so an explicit recovery never reruns the model.
export async function createPixelCopyOperation({ source, operation, rgba, api, isCurrent, onDerived, refresh, operationId = null }) {
  if (rgba !== undefined && (!(rgba instanceof Uint8Array) || rgba.length !== source.rgba.length)) fail('pixel_source_invalid', 'Invalid stroke buffer.')
  const candidate = rgba === undefined
    ? createPixelEditCandidate({ width: source.width, height: source.height, rgba: source.rgba }, operation,
      { x: 0, y: 0, w: source.width, h: source.height })
    : { rgba: new Uint8Array(rgba) }
  if (candidate.rgba.every((value, index) => value === source.rgba[index])) {
    fail('pixel_no_change', 'No pixels matched this change. No new image was created.')
  }
  const baseRect = source.allowedRect || { x: 0, y: 0, w: source.width, h: source.height }
  const changedRect = baseRect.w * baseRect.h * 4 > WORKING_PIXELS_MAX_BYTES
    ? (diffPixelRect(source.rgba, candidate.rgba, source.width, source.height, baseRect) || baseRect)
    : baseRect
  const strips = splitPixelRectStrips(changedRect, WORKING_PIXELS_MAX_BYTES)
  const fullSingleRect = strips.length === 1 && strips[0].x === 0 && strips[0].y === 0 && strips[0].w === source.width && strips[0].h === source.height
  const digest = fullSingleRect ? await sha256Hex(candidate.rgba) : null
  const deriveRequest = Object.freeze({ operationId: operationId || createOperationId(), expectedRevision: source.projectRevision,
    sourceCanvasId: source.sourceCanvasId, sourceDocumentId: source.sourceDocumentId,
    sourceRevision: source.sourceRevision, name: source.name })
  let pixelRequest, positionRequest, derived, saved, phase = 'derive', busy = false, stripIndex = 0, pixelsComplete = false
  const grantState = {}
  const stripStates = strips.map(() => ({}))
  function current() { if (!isCurrent()) fail('assistant_context_changed', 'The selected project changed. No further edit was submitted.') }
  function receipt(result, request) {
    const r = result?.receipt
    if (!r || r.operation_id !== request.operationId || r.project_id !== source.projectId
      || r.project_revision !== request.expectedRevision + 1 || result.project?.id !== source.projectId
      || result.project.revision < r.project_revision || !result.document?.document_id
      || r.document_id !== result.document.document_id || r.document_revision !== result.document.revision) {
      fail('pixel_receipt_unknown', 'The server did not confirm this step.', { kind: 'unknown' })
    }
  }
  return {
    get phase() { return phase }, get derived() { return derived }, get saved() { return saved },
    get pixelsComplete() { return pixelsComplete }, get stripIndex() { return stripIndex }, get stripCount() { return strips.length },
    async run() {
      if (busy) fail('assistant_busy', 'An image copy is already being saved.')
      busy = true
      try {
        current()
        if (phase === 'derive') {
          const result = await api.deriveWorking(source.projectId, deriveRequest)
          receipt(result, deriveRequest)
          if (!result.canvas?.id || result.canvas.document_id !== result.document.document_id) {
            fail('pixel_receipt_unknown', 'The server did not confirm the new canvas.', { kind: 'unknown' })
          }
          derived = result
          if (fullSingleRect && !source.allowedRect && !source.linkScope) {
            pixelRequest = Object.freeze({ operationId: createOperationId(), expectedRevision: result.receipt.project_revision,
              expectedWorkingRevision: result.document.revision, width: source.width, height: source.height,
              bytes: candidate.rgba, expectedSha256: digest, ...(source.target ? { target: source.target } : {}) })
          }
          phase = (source.allowedRect || source.linkScope) && strips.length === 1 ? 'grant' : 'pixels'
          current()
          onDerived(result)
        }
        if (phase === 'grant') {
          // Explicit Apply authorizes this exact derived target, never a silent retry of a stale source grant.
          current()
          const target = pixelDocumentTarget(derived.document, source.target).target
          pixelRequest = await scopedPixelRequest(api, source, candidate.rgba, { documentId: derived.document.document_id,
            revision: derived.document.revision, projectRevision: derived.receipt.project_revision, target, rect: strips[0], state: grantState })
          phase = 'pixels'
        }
        if (phase === 'pixels') {
          current()
          if (pixelRequest && strips.length === 1) {
            const result = await api.writeWorkingPixels(source.projectId, derived.document.document_id, pixelRequest)
            receipt(result, pixelRequest)
            if (result.document.document_id !== derived.document.document_id) fail('pixel_receipt_unknown', 'The saved image identity was not confirmed.', { kind: 'unknown' })
            saved = result
            stripIndex = 1
            pixelsComplete = true
          } else {
            const target = source.target ? pixelDocumentTarget(derived.document, source.target).target : undefined
            while (stripIndex < strips.length) {
              current()
              const curProjRev = saved ? saved.receipt.project_revision : derived.receipt.project_revision
              const curDocRev = saved ? saved.document.revision : derived.document.revision
              const req = await scopedPixelRequest(api, source, candidate.rgba, {
                documentId: derived.document.document_id,
                revision: curDocRev,
                projectRevision: curProjRev,
                target,
                rect: strips[stripIndex],
                state: stripStates[stripIndex],
              })
              const result = await api.writeWorkingPixels(source.projectId, derived.document.document_id, req)
              receipt(result, req)
              if (result.document.document_id !== derived.document.document_id) fail('pixel_receipt_unknown', 'The saved image identity was not confirmed.', { kind: 'unknown' })
              saved = result
              stripIndex += 1
            }
            pixelsComplete = true
          }
          const point = source.copyPosition
          if (point && (point.x !== derived.canvas.x || point.y !== derived.canvas.y)) {
            positionRequest = Object.freeze({ operationId: createOperationId(), expectedRevision: saved.receipt.project_revision,
              positions: [{ canvas_id: derived.canvas.id, x: point.x, y: point.y }] })
            phase = 'position'
          } else phase = 'refresh'
        }
        if (phase === 'position') {
          current()
          const result = await api.saveLayout(source.projectId, positionRequest)
          if (result?.receipt?.operation_id !== positionRequest.operationId || result.receipt.project_id !== source.projectId
            || result.receipt.project_revision !== positionRequest.expectedRevision + 1 || result.project?.id !== source.projectId) {
            fail('pixel_receipt_unknown', 'The new image position was not confirmed.', { kind: 'unknown' })
          }
          saved = { ...saved, project: result.project }
          phase = 'refresh'
        }
        current()
        if (phase === 'refresh') {
          await refresh(saved.project)
          current()
          phase = 'done'
        }
        return saved
      } catch (error) {
        if (error?.kind !== 'unknown' && phase === 'pixels' && strips.length > 1 && stripIndex < strips.length) {
          stripStates[stripIndex] = {}
        }
        throw error
      } finally { busy = false }
    },
  }
}
