import { runPixelProcessing, validatePixelProcessing, validatePixelCandidate, PIXEL_PROCESSING_BYTES } from './pixelProcessing.js'
import { lookupProjectReceipt } from './projectHistoryStore.js'
import { payloadSha256 } from './spriteDocumentValidation.js'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { loadEditorProject } from './projectStore.js'
import { getSpriteDocument, readSpriteBlock, encodeRgbaPng, acceptDocumentCandidate, readVerifiedProjectReference } from './spriteDocumentStore.js'
import { assertLinkGroupsWithinEditableScope, createDocumentToolSession, documentHash, DOCUMENT_CANDIDATE_BYTES } from './documentToolSession.js'

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i
const hash = /^[a-f0-9]{64}$/
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,96}$/.test(value)
const fail = code => { throw Object.assign(new Error(code), { code }) }
const exact = (body, keys) => body && typeof body === 'object' && !Array.isArray(body) && Object.keys(body).length === keys.length && keys.every(k => Object.hasOwn(body, k))
const allowedKeys = (body, required, optional = []) => (
  body && typeof body === 'object' && !Array.isArray(body)
  && required.every(k => Object.hasOwn(body, k))
  && Object.keys(body).every(k => required.includes(k) || optional.includes(k))
)

// Only transient grants and previews live here. Project history stores compact
// candidate identities; pixels become durable only through the existing atomic writer.
export function createDocumentAssistant({ load = loadEditorProject, readDocument = getSpriteDocument, readBlock = readSpriteBlock, readReference = readVerifiedProjectReference, accept = acceptDocumentCandidate, now = () => Date.now() } = {}) {
  const grants = new Map(), candidates = new Map()
  let processing = false
  const scopeKey = s => `${path.resolve(s.workspaceRoot || path.join(s.projectRoot || process.cwd(), 'workspace'))}\0${s.projectId}`
  function prune() {
    for (const [key, value] of grants) if (value.expires <= now()) grants.delete(key)
    for (const [key, value] of candidates) if (!value.pending && value.expires <= now()) candidates.delete(key)
  }
  async function source(scope, body) {
    const { project } = await load(scope), canvas = project.canvases?.[body.canvas_id]
    if (project.revision !== body.expected_revision || !canvas || project.sprite_documents?.[canvas.document_id]?.working_revision !== body.expected_working_revision) fail('assistant_context_changed')
    const { manifest } = await readDocument({ ...scope, documentId: canvas.document_id, revision: body.expected_working_revision })
    return { project, canvas, manifest }
  }
  async function parseScopeAndReferences(scope, project, manifest, body) {
    let editableFrameIds = null
    if (Object.hasOwn(body, 'editable_frame_ids') && body.editable_frame_ids != null) {
      if (!Array.isArray(body.editable_frame_ids) || !body.editable_frame_ids.length) fail('invalid_assistant_message')
      try {
        editableFrameIds = assertLinkGroupsWithinEditableScope(manifest, body.editable_frame_ids)
      } catch (error) {
        if (error?.code === 'invalid_request') fail('invalid_assistant_message')
        throw error
      }
    }
    let referenceIds = []
    const references = []
    if (Object.hasOwn(body, 'reference_ids') && body.reference_ids != null) {
      if (!Array.isArray(body.reference_ids)) fail('invalid_assistant_message')
      if (body.reference_ids.length > 8) {
        throw Object.assign(new Error('Maximum 8 project references per turn.'), { code: 'resource_limit' })
      }
      const seen = new Set()
      for (const refId of body.reference_ids) {
        if (!validId(refId) || seen.has(refId)) fail('invalid_assistant_message')
        seen.add(refId)
        referenceIds.push(refId)
      }
      for (const refId of referenceIds) {
        const verified = await readReference({ ...scope, project, referenceId: refId })
        references.push({
          id: verified.reference.id,
          name: verified.reference.name,
          purpose: verified.reference.purpose,
          source_kind: verified.reference.source_kind,
          width: verified.width,
          height: verified.height,
          sha256: verified.sha256,
          provenance: verified.provenance,
          rgba: verified.rgba,
        })
      }
    }
    return { editableFrameIds, referenceIds, references }
  }
  function register(scope, body, manifest, candidate, processing = null, limit = DOCUMENT_CANDIDATE_BYTES) {
    prune()
    // Bounded transient candidates; a local preview has a separate 32 MiB cap.
    if (candidates.size >= 4) fail('assistant_candidate_limit')
    let total = 0
    for (const bytes of candidate.blocks.values()) total += bytes.length
    if (total > limit) fail('assistant_candidate_limit')
    const candidate_id = `candidate_${randomUUID()}`, sha256 = documentHash(candidate.document)
    const summary = {
      candidate_id,
      sha256,
      document_id: manifest.document_id,
      canvas_id: body.canvas_id,
      project_revision: body.expected_revision,
      working_revision: body.expected_working_revision,
      width: candidate.document.canvas.w,
      height: candidate.document.canvas.h,
      frames: candidate.document.frame_order.length,
      layers: candidate.document.layer_order.length,
      saved: false,
      ...(candidate.editableFrameIds ? { editable_frame_ids: candidate.editableFrameIds, locked_frame_ids: candidate.lockedFrameIds || [] } : {}),
      ...(candidate.referenceIds ? { reference_ids: candidate.referenceIds, used_reference_ids: candidate.usedReferenceIds || [] } : {}),
      ...(processing ? { processing } : {}),
    }
    candidates.set(candidate_id, { key: scopeKey(scope), candidate, summary, expires: now() + 30 * 60 * 1000, pending: null, operationId: null })
    return summary
  }
  return {
    async process(scope, body, signal) {
      if (!exact(body, ['canvas_id', 'expected_revision', 'expected_working_revision', 'operation', 'layer_id']) || typeof body.canvas_id !== 'string' || !Number.isSafeInteger(body.expected_revision) || !Number.isSafeInteger(body.expected_working_revision)) fail('invalid_assistant_message')
      if (processing) fail('assistant_busy')
      processing = true
      try {
      prune(); if (candidates.size >= 4) fail('assistant_candidate_limit')
      const { manifest } = await source(scope, body), originalHash = documentHash(manifest)
      validatePixelProcessing(manifest, body.operation, body.layer_id)
      const blocks = new Map()
      for (const cel of Object.values(manifest.cels)) if (cel.block && !blocks.has(cel.block.sha256)) {
        if (signal?.aborted) fail('assistant_cancelled')
        const { bytes } = await readBlock({ ...scope, documentId: manifest.document_id, sha256: cel.block.sha256 })
        if (bytes.length !== manifest.canvas.w * manifest.canvas.h * 4 || documentHash(bytes) !== cel.block.sha256) fail('artifact_integrity_failed')
        blocks.set(cel.block.sha256, bytes)
      }
      if (documentHash((await source(scope, body)).manifest) !== originalHash) fail('assistant_context_changed')
      const result = await runPixelProcessing({ manifest, blocks, operation: body.operation, layerId: body.layer_id }, signal)
      if (signal?.aborted) fail('assistant_cancelled')
      if (documentHash((await source(scope, body)).manifest) !== originalHash) fail('assistant_context_changed')
      if (signal?.aborted) fail('assistant_cancelled')
      if (!result.candidate) return result
      validatePixelCandidate(manifest, result.candidate)
      return register(scope, body, manifest, result.candidate, result.processing, PIXEL_PROCESSING_BYTES)
      } finally { processing = false }
    },
    async prepare(scope, body) {
      if (!allowedKeys(body, ['canvas_id', ['expected_revision'][0], 'expected_working_revision'], ['editable_frame_ids', 'reference_ids']) || typeof body.canvas_id !== 'string' || !Number.isSafeInteger(body.expected_revision) || !Number.isSafeInteger(body.expected_working_revision)) fail('invalid_assistant_message')
      prune(); if (grants.size >= 64) fail('assistant_session_limit')
      const { project, manifest } = await source(scope, body)
      const { editableFrameIds, referenceIds, references } = await parseScopeAndReferences(scope, project, manifest, body)
      // Validate support and budget without allocating source pixels.
      createDocumentToolSession({ manifest, blocks: new Map(), encodePng: encodeRgbaPng, editableFrameIds, references })
      prune(); if (grants.size >= 64) fail('assistant_session_limit')
      const grant_id = `docgrant_${randomUUID()}`
      const lockedFrameIds = editableFrameIds && editableFrameIds.length < manifest.frame_order.length
        ? manifest.frame_order.filter(frameId => !editableFrameIds.includes(frameId))
        : []
      grants.set(grant_id, {
        key: scopeKey(scope),
        body: {
          canvas_id: body.canvas_id,
          expected_revision: body.expected_revision,
          expected_working_revision: body.expected_working_revision,
        },
        editableFrameIds,
        referenceIds,
        manifestHash: documentHash(manifest),
        expires: now() + 10 * 60 * 1000,
      })
      return {
        grant_id,
        document_id: manifest.document_id,
        width: manifest.canvas.w,
        height: manifest.canvas.h,
        frames: manifest.frame_order.length,
        layers: manifest.layer_order.length,
        ...(editableFrameIds ? { editable_frame_ids: editableFrameIds, locked_frame_ids: lockedFrameIds } : {}),
        ...(referenceIds.length ? { reference_ids: referenceIds } : {}),
      }
    },
    async begin(scope, body, signal) {
      prune()
      if (candidates.size >= 4) fail('assistant_candidate_limit')
      const grant = grants.get(body.document_grant)
      if (!grant || grant.key !== scopeKey(scope) || ['canvas_id', 'expected_revision', 'expected_working_revision'].some(k => grant.body[k] !== body[k])) fail('assistant_context_changed')
      // Each explicit send requires a fresh document grant. Never upgrade an N1 grant.
      grants.delete(body.document_grant)
      const { project, manifest } = await source(scope, body)
      if (documentHash(manifest) !== grant.manifestHash) fail('assistant_context_changed')
      if (body.editable_frame_ids !== undefined) {
        const parsedScope = await parseScopeAndReferences(scope, project, manifest, { editable_frame_ids: body.editable_frame_ids })
        if (JSON.stringify(parsedScope.editableFrameIds) !== JSON.stringify(grant.editableFrameIds)) fail('assistant_context_changed')
      }
      if (body.reference_ids !== undefined) {
        if (!Array.isArray(body.reference_ids) || JSON.stringify(body.reference_ids) !== JSON.stringify(grant.referenceIds)) fail('assistant_context_changed')
      }
      const { editableFrameIds, referenceIds, references } = await parseScopeAndReferences(scope, project, manifest, {
        editable_frame_ids: grant.editableFrameIds,
        reference_ids: grant.referenceIds,
      })
      const checkCurrent = async () => {
        const { project: p, manifest: m } = await source(scope, body)
        if (documentHash(m) !== grant.manifestHash) fail('assistant_context_changed')
        if (referenceIds.length) {
          await parseScopeAndReferences(scope, p, m, { reference_ids: referenceIds })
        }
      }
      const blocks = new Map()
      for (const cel of Object.values(manifest.cels)) if (cel.block && !blocks.has(cel.block.sha256)) {
        const { bytes } = await readBlock({ ...scope, documentId: manifest.document_id, sha256: cel.block.sha256 })
        if (bytes.length !== manifest.canvas.w * manifest.canvas.h * 4 || documentHash(bytes) !== cel.block.sha256) fail('assistant_context_changed')
        blocks.set(cel.block.sha256, bytes)
      }
      await checkCurrent()
      const session = createDocumentToolSession({ manifest, blocks, encodePng: encodeRgbaPng, signal, checkCurrent, editableFrameIds, references })
      return {
        session,
        manifest,
        editableFrameIds,
        lockedFrameIds: session.lockedFrameIds,
        referenceIds,
        references: session.references,
        async finish() {
          const candidate = await session.candidate()
          if (!candidate) return null
          return register(scope, body, manifest, candidate)
        },
      }
    },
    async candidate(scope, body) {
      if (!allowedKeys(body, ['action', 'candidate_id', 'sha256', 'canvas_id', 'document_id', 'expected_revision', 'expected_working_revision', 'operation_id'], ['expected_editable_frame_ids'])
        || !['read', 'discard', 'accept', 'resolve'].includes(body.action) || !/^candidate_[a-f0-9-]{36}$/.test(body.candidate_id || '') || !hash.test(body.sha256 || '')
        || !uuid.test(body.operation_id || '') || !Number.isSafeInteger(body.expected_revision) || !Number.isSafeInteger(body.expected_working_revision)
        || (body.expected_editable_frame_ids !== undefined && (!Array.isArray(body.expected_editable_frame_ids) || !body.expected_editable_frame_ids.length || body.expected_editable_frame_ids.some(id => typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,96}$/.test(id))))) fail('invalid_assistant_message')
      prune()
      const entry = candidates.get(body.candidate_id)
      if (entry && (entry.key !== scopeKey(scope) || entry.summary.sha256 !== body.sha256 || entry.summary.canvas_id !== body.canvas_id || entry.summary.document_id !== body.document_id
        || entry.summary.project_revision !== body.expected_revision || entry.summary.working_revision !== body.expected_working_revision
        || ((['accept', 'resolve'].includes(body.action) || body.expected_editable_frame_ids !== undefined)
          && JSON.stringify(entry.summary.editable_frame_ids || null) !== JSON.stringify(body.expected_editable_frame_ids ?? null)))) fail('assistant_context_changed')
      const expectedEditableFrameIds = Array.isArray(body.expected_editable_frame_ids) && body.expected_editable_frame_ids.length
        ? body.expected_editable_frame_ids
        : null
      const payload = { type: 'assistant-document-candidate', candidate_id: body.candidate_id, sha256: body.sha256, canvas_id: body.canvas_id, document_id: body.document_id,
        expected_revision: body.expected_revision, expected_working_revision: body.expected_working_revision,
        ...(expectedEditableFrameIds ? { expected_editable_frame_ids: expectedEditableFrameIds } : {}) }
      if (body.action === 'resolve') {
        if (entry?.pending) {
          if (entry.operationId !== body.operation_id) fail('assistant_operation_conflict')
          try { await entry.pending } catch { /* The durable receipt decides after the writer has settled, including a lost ACK. */ }
        }
        const { project } = await load(scope)
        const receipt = await lookupProjectReceipt(project, body.operation_id, scope)
        if (receipt && receipt.payload_sha256 !== payloadSha256(payload)) fail('assistant_operation_conflict')
        if (!receipt) return { saved: false, available: Boolean(entry), receipt: null }
        const verified = await accept({ ...scope, documentId: body.document_id, canvasId: body.canvas_id, operationId: body.operation_id,
          expectedRevision: body.expected_revision, expectedWorkingRevision: body.expected_working_revision, expectedEditableFrameIds, payload })
        return { saved: true, available: false, receipt: verified.receipt }
      }
      if (body.action === 'accept') {
        // The writer checks the durable receipt BEFORE requiring a live candidate.
        // A lost ACK can therefore be resolved after a service restart with the same operation.
        if (entry?.operationId && entry.operationId !== body.operation_id) fail('assistant_operation_conflict')
        if (entry?.pending) return entry.pending
        if (entry) entry.operationId = body.operation_id
        const pending = accept({ ...scope, documentId: body.document_id, canvasId: body.canvas_id, operationId: body.operation_id,
          expectedRevision: body.expected_revision, expectedWorkingRevision: body.expected_working_revision, expectedEditableFrameIds, payload, candidate: entry?.candidate })
        if (entry) entry.pending = pending
        try { const result = await pending; candidates.delete(body.candidate_id); return result }
        catch (error) {
          if (['stale_revision', 'candidate_expired', 'unsupported_input', 'resource_limit', 'artifact_integrity_failed', 'invalid_request'].includes(error.code)) {
            const { project } = await load(scope)
            if (await lookupProjectReceipt(project, body.operation_id, scope)) fail('assistant_result_unknown')
            if (entry) entry.operationId = null
          }
          throw error
        }
        finally { if (entry) entry.pending = null }
      }
      if (!entry) fail('candidate_expired')
      if (entry.operationId) fail('assistant_result_unknown')
      if (body.action === 'discard') { candidates.delete(body.candidate_id); return { discarded: true } }
      await source(scope, body)
      return { ...entry.summary, document: entry.candidate.document, blocks: Object.fromEntries([...entry.candidate.blocks].map(([key, bytes]) => [key, Buffer.from(bytes).toString('base64')])) }
    },
  }
}
