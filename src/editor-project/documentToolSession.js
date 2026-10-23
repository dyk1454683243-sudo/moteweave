import { createHash } from 'node:crypto'
import { pixelLinkScope } from './pixelLinks.js'
import { assertPixelStructure, applyStructureCommand, compositePixelBuffers } from './pixelStructure.js'
import { extractPixelBlock } from './pixelSelectionOps.js'
import { createPixelEditCandidate } from './pixelEditOps.js'
import { spriteDocumentError } from './spriteDocumentValidation.js'

export const DOCUMENT_CANDIDATE_BYTES = 16 * 1024 * 1024
export const documentHash = value => createHash('sha256').update(typeof value === 'string' || value instanceof Uint8Array ? value : JSON.stringify(value)).digest('hex')
const fail = message => { throw Object.assign(new Error(message), { code: 'assistant_document_invalid' }) }
const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false })
const id = { type: 'string', pattern: '^[A-Za-z0-9_-]{1,96}$' }
const integer = { type: 'integer', minimum: 0 }
const nullable = schema => ({ anyOf: [schema, { type: 'null' }] })
const rect = object({ x: integer, y: integer, w: { type: 'integer', minimum: 1 }, h: { type: 'integer', minimum: 1 } })
const point = object({ x: integer, y: integer })
const color = { type: 'array', minItems: 4, maxItems: 4, items: { type: 'integer', minimum: 0, maximum: 255 } }
const paintOperations = {
  pencil: { points: { type: 'array', minItems: 1, maxItems: 256, items: point }, color },
  eraser: { points: { type: 'array', minItems: 1, maxItems: 256, items: point } },
  line: { start: point, end: point, color }, rectangle: { start: point, end: point, color },
  'fill-rect': { color }, erase: {}, 'flood-fill': { seed: point, color },
}
const paintOperationSchema = { anyOf: Object.entries(paintOperations).map(([type, properties]) =>
  object({ type: { type: 'string', enum: [type] }, rect, ...properties })) }
const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k))
const validId = v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,96}$/.test(v)
const checkSize = m => {
  const { w, h } = m.canvas || {}
  if (![w, h].every(n => Number.isSafeInteger(n) && n > 0 && n <= 1024)
    || w * h * 4 * m.frame_order.length * m.layer_order.length > DOCUMENT_CANDIDATE_BYTES) fail('Candidate exceeds 1024px per edge or 16 MiB of cel pixels.')
}
const editable = m => ({ ...m, derived_from: m.derived_from || { document_id: m.document_id, revision: m.revision, manifest_sha256: documentHash(m) } })
const celAt = (m, f, l) => Object.values(m.cels).find(c => c.frame_id === f && c.layer_id === l)
const bytesAt = (m, blocks, f, l) => {
  const c = celAt(m, f, l)
  if (!c) fail('Frame or layer does not exist.')
  return c.block ? blocks.get(c.block.sha256) : new Uint8Array(m.canvas.w * m.canvas.h * 4)
}

export function normalizeEditableFrameIds(manifest, editableFrameIds) {
  if (editableFrameIds == null) return null
  if (!Array.isArray(editableFrameIds) || !editableFrameIds.length || editableFrameIds.length > (manifest?.frame_order?.length ?? 0)) {
    throw spriteDocumentError('invalid_request', 'editable_frame_ids must be a non-empty subset of document frames.')
  }
  const seen = new Set()
  for (const frameId of editableFrameIds) {
    if (typeof frameId !== 'string' || !validId(frameId) || seen.has(frameId) || !manifest.frame_order.includes(frameId)) {
      throw spriteDocumentError('invalid_request', 'editable_frame_ids must contain unique frame IDs from the document.')
    }
    seen.add(frameId)
  }
  return manifest.frame_order.filter(frameId => seen.has(frameId))
}

export function assertLinkGroupsWithinEditableScope(manifest, editableFrameIds) {
  const normalized = normalizeEditableFrameIds(manifest, editableFrameIds)
  if (!normalized || normalized.length >= manifest.frame_order.length) return normalized
  const editableSet = new Set(normalized)
  for (const [groupId, members] of Object.entries(manifest.links?.groups || {})) {
    if (!Array.isArray(members) || !members.length) continue
    const cels = members.map(celId => manifest.cels?.[celId]).filter(Boolean)
    const frameIds = cels.map(cel => cel.frame_id)
    const hasEditable = frameIds.some(frameId => editableSet.has(frameId))
    const hasLocked = frameIds.some(frameId => !editableSet.has(frameId))
    if (hasEditable && hasLocked) {
      const layerId = cels[0]?.layer_id || null
      const layerName = manifest.layers?.[layerId]?.name || layerId || 'Layer'
      const orderedFrames = manifest.frame_order.filter(frameId => frameIds.includes(frameId))
      const labels = orderedFrames.map(frameId => `F${manifest.frame_order.indexOf(frameId) + 1} (${frameId})`).join(', ')
      throw spriteDocumentError(
        'unsupported_input',
        `Linked cels on layer "${layerName}" span selected and locked frames (${labels}). Select all linked frames together or unlink them first.`,
        {
          reason: 'linked_group_crosses_frame_scope',
          group_id: groupId,
          layer_id: layerId,
          layer_name: layerName,
          frame_ids: orderedFrames,
          editable_frame_ids: normalized,
        },
      )
    }
  }
  return normalized
}

function tagTouchesLockedFrames(frameOrder, tag, editableSet) {
  if (!tag || typeof tag !== 'object' || !Array.isArray(frameOrder)) return true
  const fromIdx = frameOrder.indexOf(tag.from_frame_id)
  const toIdx = frameOrder.indexOf(tag.to_frame_id)
  if (fromIdx < 0 || toIdx < 0) return true
  const start = Math.min(fromIdx, toIdx)
  const end = Math.max(fromIdx, toIdx)
  for (let i = start; i <= end; i += 1) {
    if (!editableSet.has(frameOrder[i])) return true
  }
  return false
}

export function assertScopedDocumentCandidate(source, next, editableFrameIds) {
  const normalized = assertLinkGroupsWithinEditableScope(source, editableFrameIds)
  if (!normalized || normalized.length >= source.frame_order.length) return next
  if (JSON.stringify(next.canvas) !== JSON.stringify(source.canvas)) {
    throw spriteDocumentError('unsupported_input', 'Scoped frame revisions cannot resize the canvas while frames are locked.')
  }
  if (JSON.stringify(next.frame_order) !== JSON.stringify(source.frame_order)) {
    throw spriteDocumentError('unsupported_input', 'Scoped frame revisions cannot add, delete, or reorder frames while frames are locked.')
  }
  if (JSON.stringify(next.layer_order) !== JSON.stringify(source.layer_order)) {
    throw spriteDocumentError('unsupported_input', 'Scoped frame revisions cannot add, delete, or reorder layers while frames are locked.')
  }
  for (const layerId of source.layer_order) {
    if (JSON.stringify(next.layers?.[layerId] ?? null) !== JSON.stringify(source.layers?.[layerId] ?? null)) {
      throw spriteDocumentError(
        'unsupported_input',
        `Shared layer "${source.layers?.[layerId]?.name || layerId}" properties (name, visibility, or lock state) cannot be changed while frames are locked.`,
      )
    }
  }
  const sourceCopyLayers = source.links?.copy_layers ?? []
  const nextCopyLayers = next.links?.copy_layers ?? []
  if (JSON.stringify(nextCopyLayers) !== JSON.stringify(sourceCopyLayers)) {
    throw spriteDocumentError('unsupported_input', 'Layer link-copy policy cannot be changed while frames are locked.')
  }
  assertLinkGroupsWithinEditableScope(next, normalized)
  const editableSet = new Set(normalized)
  const sourceTags = (Array.isArray(source.tags) ? source.tags : []).filter(tag => tagTouchesLockedFrames(source.frame_order, tag, editableSet))
  const nextTags = (Array.isArray(next.tags) ? next.tags : []).filter(tag => tagTouchesLockedFrames(next.frame_order, tag, editableSet))
  if (JSON.stringify(nextTags) !== JSON.stringify(sourceTags)) {
    throw spriteDocumentError('unsupported_input', 'Animation tags that cover locked frames cannot be added, modified, reordered, or deleted while frames are locked.')
  }
  if (JSON.stringify(next.anchors ?? []) !== JSON.stringify(source.anchors ?? [])) {
    throw spriteDocumentError('unsupported_input', 'Document anchors cannot be changed while frames are locked.')
  }
  for (const frameId of source.frame_order) {
    if (editableSet.has(frameId)) continue
    if (JSON.stringify(next.frames?.[frameId]) !== JSON.stringify(source.frames?.[frameId])) {
      throw spriteDocumentError('unsupported_input', `Locked frame ${frameId} duration or metadata cannot be changed.`)
    }
    const sourceFrameTexts = (source.text_objects?.items || []).filter(item => item?.frame_id === frameId)
    const nextFrameTexts = (next.text_objects?.items || []).filter(item => item?.frame_id === frameId)
    if (JSON.stringify(nextFrameTexts) !== JSON.stringify(sourceFrameTexts)) {
      throw spriteDocumentError('unsupported_input', `Locked frame ${frameId} text objects cannot be changed.`)
    }
    for (const layerId of source.layer_order) {
      const sourceCel = celAt(source, frameId, layerId) ?? null
      const nextCel = celAt(next, frameId, layerId) ?? null
      if (JSON.stringify(nextCel) !== JSON.stringify(sourceCel)) {
        throw spriteDocumentError('unsupported_input', `Locked frame ${frameId} pixels or cel identity on layer ${layerId} cannot be changed.`)
      }
      const sourceLink = sourceCel ? pixelLinkScope(source, sourceCel.id) : null
      const nextLink = nextCel ? pixelLinkScope(next, nextCel.id) : null
      if (JSON.stringify(nextLink?.cel_ids ?? null) !== JSON.stringify(sourceLink?.cel_ids ?? null)) {
        throw spriteDocumentError('unsupported_input', `Locked frame ${frameId} linked cel membership on layer ${layerId} cannot be changed.`)
      }
    }
  }
  return next
}

export function preserveProtected(source, next, checkBudget = checkSize, editableFrameIds = null) {
  for (const layerId of source.layer_order.filter(id => source.layers[id].locked)) {
    if (JSON.stringify(next.layers[layerId]) !== JSON.stringify(source.layers[layerId])
      || JSON.stringify(next.frame_order) !== JSON.stringify(source.frame_order)
      || JSON.stringify(next.canvas) !== JSON.stringify(source.canvas)
      || next.layer_order.indexOf(layerId) !== source.layer_order.indexOf(layerId)) fail('Locked layers cannot be changed by this request.')
    for (const f of source.frame_order) if (JSON.stringify(celAt(source, f, layerId)) !== JSON.stringify(celAt(next, f, layerId))) fail('Locked pixels cannot be changed.')
  }
  if ((source.tags?.length || source.anchors?.length || source.text_objects?.items?.length)
    && (JSON.stringify(source.canvas) !== JSON.stringify(next.canvas)
      || JSON.stringify(source.frame_order) !== JSON.stringify(next.frame_order)
      || JSON.stringify(source.layer_order) !== JSON.stringify(next.layer_order))) fail('Keep size and frame/layer identities for documents with tags, anchors or editable text.')
  if (editableFrameIds) {
    try {
      assertScopedDocumentCandidate(source, next, editableFrameIds)
    } catch (error) {
      fail(error.message || 'Locked frames cannot be changed by this request.')
    }
  }
  // The maintained validator enforces linked cel equality and text references.
  assertPixelStructure(next)
  checkBudget(next)
}

export const DOCUMENT_TOOL_INSTRUCTIONS = 'Use the supplied document tools to inspect the actual source and assemble an UNSAVED canvas/timeline candidate. Decide crop rectangles, semantic layers, chronological order and alignment anchors yourself. Exact copy/padding is available; there is no automatic splitter or alignment algorithm. Do not redraw, rescale, recolor or remove background unless the user requests it. draw_frames paints new pixels when requested; copy operations preserve pixels. Inspect read_image before editing, then inspect the returned candidate image and other frames as needed. Preserve intended motion rather than mechanically centering every bounding box. Frame durations inferred from a still image are provisional; state uncertainty. compose_document replaces the complete candidate in one atomic batch; edit_structure reuses native frame/layer operations. Read source, previous candidate cells/composites, or selected project references, copy multiple regions into a cel, retain existing cells with parts:null, or leave empty cells. When editable_frame_ids is a subset of frames, locked_frame_ids must keep their exact frame order, durations, cel IDs and pixels (use parts:null on locked frames). For new animation, compose transparent frames with chosen durations, then draw_frames paints all frames in one batch; do not copy one identical drawing and claim motion. Use read_image to inspect representative frames. Tools never save. Maximum 9 calls and 180 seconds, no retries outside that budget. Reply briefly with actual changes and unresolved limitations.'

export function createDocumentToolSession({ manifest, blocks, encodePng, signal, checkCurrent = async () => {}, editableFrameIds = null, references = [] }) {
  assertPixelStructure(manifest); checkSize(manifest)
  if (manifest.text_objects?.items?.length) throw Object.assign(new Error('Canvas & timeline AI tools do not yet support editable text. The existing text editor remains available.'), { code: 'assistant_document_text_unsupported' })
  const scopedFrames = assertLinkGroupsWithinEditableScope(manifest, editableFrameIds)
  const lockedFrames = scopedFrames && scopedFrames.length < manifest.frame_order.length
    ? manifest.frame_order.filter(frameId => !scopedFrames.includes(frameId))
    : []
  const lockedFrameSet = new Set(lockedFrames)
  const referenceMap = new Map()
  const referenceSummaries = []
  for (const ref of references || []) {
    if (!ref || !validId(ref.id) || !(ref.rgba instanceof Uint8Array) || ref.rgba.length !== ref.width * ref.height * 4) {
      throw spriteDocumentError('invalid_request', 'Invalid project reference supplied to document tool session.')
    }
    referenceMap.set(ref.id, ref)
    referenceSummaries.push({
      id: ref.id,
      name: ref.name,
      purpose: ref.purpose,
      source_kind: ref.source_kind,
      width: ref.width,
      height: ref.height,
      sha256: ref.sha256,
      provenance: ref.provenance,
    })
  }
  const usedReferenceIds = new Set()
  const original = structuredClone(manifest), sourceBlocks = new Map(blocks)
  let current = { document: structuredClone(manifest), blocks: new Map(blocks) }, calls = 0, edits = 0, observed = false
  const metadata = m => ({
    canvas: m.canvas,
    frame_order: m.frame_order,
    layer_order: m.layer_order,
    frames: m.frames,
    layers: m.layers,
    links: m.links || null,
    has_tags: Boolean(m.tags?.length),
    has_anchors: Boolean(m.anchors?.length),
    has_editable_text: Boolean(m.text_objects?.items?.length),
    ...(scopedFrames ? { editable_frame_ids: scopedFrames, locked_frame_ids: lockedFrames } : {}),
    ...(referenceSummaries.length ? { references: referenceSummaries } : {}),
  })
  const image = (m, map, f, l = null, region = null) => {
    if (!m.frame_order.includes(f)) fail('Unknown frame.')
    const rgba = l === null ? compositePixelBuffers(m, f, new Map(Object.values(m.cels).map(c => [c.id, bytesAt(m, map, c.frame_id, c.layer_id)]))) : bytesAt(m, map, f, l)
    return region ? extractPixelBlock({ width: m.canvas.w, height: m.canvas.h, rgba }, region) : { width: m.canvas.w, height: m.canvas.h, rgba }
  }
  const referenceImage = (refId, region = null) => {
    const ref = referenceMap.get(refId)
    if (!ref) fail('Unknown or unselected project reference.')
    usedReferenceIds.add(ref.id)
    return region
      ? extractPixelBlock({ width: ref.width, height: ref.height, rgba: ref.rgba }, region)
      : { width: ref.width, height: ref.height, rgba: ref.rgba }
  }
  const imageItem = value => ({ type: 'inputImage', imageUrl: `data:image/png;base64,${encodePng(value.width, value.height, Buffer.from(value.rgba)).toString('base64')}` })
  const textItem = value => ({ type: 'inputText', text: JSON.stringify(value) })
  const part = object({ from: { type: 'string', enum: ['source', 'candidate', 'reference'] }, frame_id: id, layer_id: nullable(id), rect, at: object({ x: integer, y: integer }) })
  const tools = [
    { type: 'function', name: 'read_document', description: 'Read original and unsaved candidate canvas, frame/layer IDs, durations, locks, link metadata, frame revision scope, and selected project references. First layer is topmost.', inputSchema: object({}) },
    { type: 'function', name: 'read_image', description: 'See actual source, candidate, or selected project reference pixels. For source/candidate, frame_id selects a frame and layer_id:null composites visible layers. For from:"reference", pass the reference ID in frame_id (and layer_id:null). rect:null sees the full image, otherwise exact crop. No resizing.', inputSchema: object({ from: { type: 'string', enum: ['source', 'candidate', 'reference'] }, frame_id: id, layer_id: nullable(id), rect: nullable(rect) }) },
    { type: 'function', name: 'compose_document', description: 'Replace the entire UNSAVED candidate atomically. Choose canvas size, ordered frames/layers and exact source/candidate/reference rectangles/offsets. Each cel contains ordered copy parts; last part replaces earlier bytes including alpha. For from:"reference", pass the reference ID in frame_id and layer_id:null. parts:null retains the same existing candidate frame/layer cel (same size required); [] is transparent. Omitted layer cels are empty. Original input stays readable. IDs can be retained or new. Locked layers, locked frames, links, tags and editable-text references stay protected. Max 256 frames, 32 layers, 1024px/edge and 16MiB total cel RGBA. Returns first candidate frame plus metadata; inspect other frames to check alignment.', inputSchema: object({ canvas: object({ w: integer, h: integer }), layers: { type: 'array', minItems: 1, maxItems: 32, items: object({ id, name: { type: 'string', maxLength: 120 }, visible: { type: 'boolean' } }) }, frames: { type: 'array', minItems: 1, maxItems: 256, items: object({ id, duration_ms: { type: 'integer', minimum: 1, maximum: 60000 }, cels: { type: 'array', maxItems: 32, items: object({ layer_id: id, parts: nullable({ type: 'array', maxItems: 64, items: part }) }) } }) } }) },
    { type: 'function', name: 'edit_structure', description: 'Apply a batch of existing frame/layer operations to the unsaved candidate: add-layer(name), rename-layer(layer_id,name), set-visible/set-locked/set-layer-link-copies(layer_id,value), add-frame, copy-frame(frame_id), set-duration(frame_id,duration_ms), delete-frame/delete-layer, move-frame/move-layer(id,index). commands is a JSON array of objects with type and exactly the named fields. Returns generated IDs. Original locked contents and locked frames cannot be unlocked or changed.', inputSchema: object({ commands: { type: 'string', maxLength: 24000 } }) },
    { type: 'function', name: 'draw_frames', description: 'Paint new pixels on existing candidate frames/layers with native brushes in one atomic batch. Create the frames first using compose_document or edit_structure. Use distinct drawings for animation, and set durations there. Coordinates are absolute canvas pixels; each operation must fit its rect. RGBA alpha must be 0 or 255. At most 64 cels, 64 operations per cel and 256 operations total, within the shared 128 KiB argument limit. Locked or linked cels cannot be painted. A rejected batch changes nothing. Returns the actual first painted frame; inspect other frames with read_image. Never saves.',
      inputSchema: object({ cels: { type: 'array', minItems: 1, maxItems: 64, items: object({ frame_id: id, layer_id: id, operations: { type: 'array', minItems: 1, maxItems: 64, items: paintOperationSchema } }) } }) },
  ]
  return {
    tools, instructions: DOCUMENT_TOOL_INSTRUCTIONS,
    editableFrameIds: scopedFrames,
    lockedFrameIds: lockedFrames,
    references: referenceSummaries,
    status: () => ({ calls, drawing_batches: edits, used_reference_ids: [...usedReferenceIds] }),
    candidate: async () => {
      await checkCurrent()
      if (signal?.aborted) fail('Cancelled.')
      if (!edits) return null
      return {
        ...current,
        ...(scopedFrames ? { editableFrameIds: scopedFrames, lockedFrameIds: lockedFrames } : {}),
        ...(referenceSummaries.length ? { referenceIds: referenceSummaries.map(r => r.id), usedReferenceIds: [...usedReferenceIds] } : {}),
      }
    },
    async call(name, raw) {
      await checkCurrent()
      if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { code: 'assistant_cancelled' })
      if (++calls > 9) throw Object.assign(new Error('Tool call budget reached'), { code: 'assistant_tool_blocked' })
      try {
        const encoded = typeof raw === 'string' ? raw : JSON.stringify(raw)
        if (!encoded || encoded.length > 128 * 1024) fail('Tool arguments are too large.')
        const args = JSON.parse(encoded)
        if (name === 'read_document' && exact(args, [])) {
          return {
            success: true,
            contentItems: [textItem({
              source: metadata(original),
              candidate: metadata(current.document),
              saved: false,
              ...(scopedFrames ? { editable_frame_ids: scopedFrames, locked_frame_ids: lockedFrames } : {}),
              ...(referenceSummaries.length ? { references: referenceSummaries } : {}),
            })],
          }
        }
        if (name === 'read_image' && args && typeof args === 'object' && !Array.isArray(args)) {
          if (args.from === 'reference' && (
            exact(args, ['from', 'frame_id', 'layer_id', 'rect'])
            || exact(args, ['from', 'reference_id', 'rect'])
            || exact(args, ['from', 'reference_id', 'frame_id', 'layer_id', 'rect'])
          )) {
            const refId = args.reference_id ?? args.frame_id
            const rendered = referenceImage(refId, args.rect)
            observed = true
            return {
              success: true,
              contentItems: [
                textItem({ from: 'reference', reference_id: refId, origin: args.rect, width: rendered.width, height: rendered.height }),
                imageItem(rendered),
              ],
            }
          }
          if (exact(args, ['from', 'frame_id', 'layer_id', 'rect']) && ['source', 'candidate'].includes(args.from)) {
            const m = args.from === 'source' ? original : current.document, b = args.from === 'source' ? sourceBlocks : current.blocks
            const rendered = image(m, b, args.frame_id, args.layer_id, args.rect)
            observed = true
            return { success: true, contentItems: [textItem({ from: args.from, frame_id: args.frame_id, layer_id: args.layer_id, origin: args.rect, width: rendered.width, height: rendered.height }), imageItem(rendered)] }
          }
        }
        if (!observed) fail('Inspect the actual image with read_image before editing.')
        let next = structuredClone(current.document), nextBlocks = new Map(current.blocks)
        if (name === 'draw_frames' && exact(args, ['cels'])) {
          if (!Array.isArray(args.cels) || !args.cels.length || args.cels.length > 64) fail('Use 1–64 cels per drawing batch.')
          let count = 0
          const targets = new Set()
          for (const target of args.cels) {
            if (!exact(target, ['frame_id', 'layer_id', 'operations']) || !Array.isArray(target.operations)
              || !target.operations.length || target.operations.length > 64 || (count += target.operations.length) > 256) fail('Use at most 64 operations per cel and 256 total.')
            const cel = celAt(next, target.frame_id, target.layer_id)
            if (!cel || targets.has(cel.id)) fail('Each drawing target must be a distinct existing cel.')
            targets.add(cel.id)
            if (next.layers[target.layer_id]?.locked || lockedFrameSet.has(target.frame_id)) fail('Locked frames or layers cannot be painted.')
            if (pixelLinkScope(next, cel.id)?.cel_ids?.length > 1) fail('Unlink linked cels before painting individual frames.')
            let pixels = { width: next.canvas.w, height: next.canvas.h, rgba: bytesAt(next, nextBlocks, target.frame_id, target.layer_id) }
            const allowedRect = { x: 0, y: 0, w: next.canvas.w, h: next.canvas.h }
            for (const op of target.operations) {
              if (!Object.hasOwn(paintOperations, op?.type) || (op.points && op.points.length > 256)
                || (op.color && ![0, 255].includes(op.color[3]))) fail('Unsupported brush, point count or alpha.')
              pixels = createPixelEditCandidate(pixels, op, allowedRect)
            }
            const hash = documentHash(pixels.rgba)
            nextBlocks.set(hash, pixels.rgba)
            cel.block = { sha256: hash, ...next.canvas }
          }
        } else if (name === 'edit_structure' && exact(args, ['commands'])) {
          const commands = JSON.parse(args.commands)
          if (!Array.isArray(commands) || !commands.length || commands.length > 256) fail('Use 1–256 structure commands.')
          commands.forEach((command, index) => {
            if (['upsert-text', 'delete-text'].includes(command.type)) fail('Text editing uses the existing text editor.')
            if (lockedFrameSet.size > 0) {
              if (['resize-canvas', 'add-frame', 'copy-frame', 'delete-frame', 'move-frame', 'add-layer', 'delete-layer', 'move-layer', 'rename-layer', 'set-visible', 'set-locked', 'set-layer-link-copies'].includes(command.type)) {
                fail('Scoped frame revisions cannot add, delete, reorder, resize, or change shared layer properties while frames are locked.')
              }
              if ([command.frame_id, command.source_frame_id, command.target_frame_id].some(fId => fId && lockedFrameSet.has(fId))) {
                fail('Locked frames cannot be modified by this request.')
              }
              if (command.type === 'add-tag' || command.type === 'update-tag') {
                const editableSet = new Set(scopedFrames)
                if (tagTouchesLockedFrames(next.frame_order, command, editableSet)) {
                  fail('Animation tags covering locked frames cannot be added or modified.')
                }
                if (command.type === 'update-tag') {
                  const existingTag = (next.tags || []).find(t => t.id === command.tag_id)
                  if (existingTag && tagTouchesLockedFrames(next.frame_order, existingTag, editableSet)) {
                    fail('Animation tags covering locked frames cannot be modified.')
                  }
                }
              }
              if (command.type === 'delete-tag') {
                const editableSet = new Set(scopedFrames)
                const existingTag = (next.tags || []).find(t => t.id === command.tag_id)
                if (existingTag && tagTouchesLockedFrames(next.frame_order, existingTag, editableSet)) {
                  fail('Animation tags covering locked frames cannot be deleted.')
                }
              }
            }
            next = applyStructureCommand(editable(next), command, label => `s${documentHash(`${calls}:${index}:${label}`).slice(0, 24)}`)
          })
          if (!original.derived_from) delete next.derived_from
        } else if (name === 'compose_document' && exact(args, ['canvas', 'layers', 'frames'])) {
          if (!exact(args.canvas, ['w', 'h']) || !Array.isArray(args.layers) || !args.layers.length || args.layers.length > 32 || !Array.isArray(args.frames) || !Array.isArray(args.frames) || !args.frames.length || args.frames.length > 256) fail('Invalid document dimensions or counts.')
          next.canvas = args.canvas; next.layer_order = []; next.layers = {}; next.frame_order = []; next.frames = {}; next.cels = {}; nextBlocks = new Map()
          // Check allocation before copying any pixels.
          checkSize({ canvas: args.canvas, frame_order: args.frames, layer_order: args.layers })
          for (const layer of args.layers) {
            if (!exact(layer, ['id', 'name', 'visible']) || !validId(layer.id) || Object.hasOwn(next.layers, layer.id) || typeof layer.name !== 'string' || !layer.name.trim() || layer.name.length > 120 || typeof layer.visible !== 'boolean') fail('Invalid layer.')
            if (lockedFrameSet.size > 0) {
              const origLayer = original.layers[layer.id]
              if (!origLayer || origLayer.name !== layer.name.trim() || origLayer.visible !== layer.visible) {
                fail('Shared layer name and visibility cannot be changed while frames are locked.')
              }
            }
            next.layer_order.push(layer.id); next.layers[layer.id] = { id: layer.id, name: layer.name, kind: 'raster', visible: layer.visible, locked: current.document.layers[layer.id]?.locked || false }
          }
          for (const frame of args.frames) {
            if (!exact(frame, ['id', 'duration_ms', 'cels']) || !validId(frame.id) || Object.hasOwn(next.frames, frame.id) || !Number.isSafeInteger(frame.duration_ms) || frame.duration_ms < 1 || frame.duration_ms > 60000 || !Array.isArray(frame.cels) || frame.cels.length > args.layers.length) fail('Invalid frame.')
            next.frame_order.push(frame.id); next.frames[frame.id] = { id: frame.id, duration_ms: frame.duration_ms }
            const supplied = new Map()
            for (const cel of frame.cels) {
              if (!exact(cel, ['layer_id', 'parts']) || !next.layer_order.includes(cel.layer_id) || supplied.has(cel.layer_id)) fail('Invalid or duplicate cel.')
              supplied.set(cel.layer_id, cel.parts)
            }
            for (const layerId of next.layer_order) {
              const parts = supplied.has(layerId) ? supplied.get(layerId) : []
              let rgba = new Uint8Array(next.canvas.w * next.canvas.h * 4)
              if (parts === null) {
                if (JSON.stringify(next.canvas) !== JSON.stringify(current.document.canvas)) fail('Retaining a cel requires the same canvas size.')
                rgba = new Uint8Array(bytesAt(current.document, current.blocks, frame.id, layerId))
              } else {
                if (!Array.isArray(parts) || parts.length > 64) fail('Invalid copy parts.')
                for (const p of parts) {
                  const isRefPart = p?.from === 'reference' && (
                    exact(p, ['from', 'frame_id', 'layer_id', 'rect', 'at'])
                    || exact(p, ['from', 'reference_id', 'rect', 'at'])
                    || exact(p, ['from', 'reference_id', 'frame_id', 'layer_id', 'rect', 'at'])
                  )
                  const isDocPart = exact(p, ['from', 'frame_id', 'layer_id', 'rect', 'at']) && ['source', 'candidate'].includes(p.from)
                  if ((!isRefPart && !isDocPart) || !exact(p.at, ['x', 'y']) || ![p.at.x, p.at.y].every(n => Number.isSafeInteger(n) && n >= 0) || (p.rect !== null && !p.rect)) fail('Invalid copy part.')
                  const src = isRefPart
                    ? referenceImage(p.reference_id ?? p.frame_id, p.rect)
                    : image(p.from === 'source' ? original : current.document, p.from === 'source' ? sourceBlocks : current.blocks, p.frame_id, p.layer_id, p.rect)
                  if (p.at.x + src.width > next.canvas.w || p.at.y + src.height > next.canvas.h) fail('Copy extends beyond candidate canvas. Choose explicit crop or padding.')
                  for (let y = 0; y < src.height; y++) rgba.set(src.rgba.subarray(y * src.width * 4, (y + 1) * src.width * 4), ((p.at.y + y) * next.canvas.w + p.at.x) * 4)
                }
              }
              const celId = celAt(current.document, frame.id, layerId)?.id || `s${documentHash(`${frame.id}:${layerId}`).slice(0, 24)}`
              const hash = documentHash(rgba); nextBlocks.set(hash, rgba)
              next.cels[celId] = { id: celId, frame_id: frame.id, layer_id: layerId, block: { sha256: hash, ...next.canvas } }
              // Keep true empty cells (and their identity) rather than changing locked nulls into zero blocks.
              if ((parts === null && !celAt(current.document, frame.id, layerId)?.block) || Array.isArray(parts) && parts.length === 0) next.cels[celId].block = null
            }
          }
        } else fail('Unknown tool or invalid arguments.')
        preserveProtected(original, next, checkSize, scopedFrames)
        const retained = new Map()
        for (const cel of Object.values(next.cels)) if (cel.block) {
          const bytes = nextBlocks.get(cel.block.sha256)
          if (!bytes || bytes.length !== next.canvas.w * next.canvas.h * 4 || documentHash(bytes) !== cel.block.sha256) fail('Candidate block is missing or invalid.')
          retained.set(cel.block.sha256, bytes)
        }
        await checkCurrent(); if (signal?.aborted) fail('Cancelled before candidate publication.')
        const previewFrameId = name === 'draw_frames' ? args.cels[0].frame_id : (scopedFrames && scopedFrames[0]) || next.frame_order[0]
        const preview = image(next, retained, previewFrameId)
        const contentItems = [textItem({ candidate: metadata(next), saved: false, preview_frame: previewFrameId }), imageItem(preview)]
        current = { document: next, blocks: retained }; edits++
        return { success: true, contentItems }
      } catch (error) {
        return { success: false, contentItems: [textItem({ error: String(error.message).slice(0, 280), candidate_unchanged: true, calls_remaining: 9 - calls })] }
      }
    },
  }
}
