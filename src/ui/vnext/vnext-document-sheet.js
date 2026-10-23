import { compositePixelFrame, assertPixelStructure } from '../../editor-project/pixelStructure.js'
import { assertPixelLinks } from '../../editor-project/pixelLinks.js'
import { sha256Hex } from './vnext-project-client.js'
import { savedSheetPng } from './vnext-canvas-download.js'
import { paintLayerText } from './vnext-text-objects.js'
import { SPRITE_DOCUMENT_VERSION } from '../../editor-project/constants.js'

export const SHEET_STALE = 'The saved document or selection changed. Reload the preview.'

// Existing compositor validates its input. Give it only the current frame so
// validation cost does not multiply the whole document's cel count per frame.
function frameDocuments(doc, frameOrder = doc.frame_order) {
  const grouped = new Map(doc.frame_order.map(id => [id, {}]))
  for (const [id, cel] of Object.entries(doc.cels)) {
    if (!grouped.has(cel.frame_id)) throw new Error('Unsupported frame reference.')
    grouped.get(cel.frame_id)[id] = cel
  }
  // Full-document links are validated before this read-only projection. A
  // single-frame compositor must not carry references to the omitted frames.
  const { links, text_objects, tags, ...renderDocument } = doc
  return frameOrder.map(id => ({ ...renderDocument, frame_order: [id], frames: { [id]: doc.frames[id] }, cels: grouped.get(id) }))
}

function resolveTagSelection(doc, tagId = null) {
  if (!tagId || tagId === 'all') {
    return { frameOrder: doc.frame_order, selectedTag: null }
  }
  const selectedTag = Array.isArray(doc.tags) ? doc.tags.find(tag => tag.id === tagId) : null
  if (!selectedTag) throw new Error(SHEET_STALE)
  const from = doc.frame_order.indexOf(selectedTag.from_frame_id)
  const to = doc.frame_order.indexOf(selectedTag.to_frame_id)
  if (from < 0 || to < 0 || from > to) throw new Error('The saved document cannot be exported as a sprite sheet.')
  return { frameOrder: doc.frame_order.slice(from, to + 1), selectedTag }
}

// Budget the expanded image, including empty cels, before allocating pixels.
export function documentSheetLayout(doc, { tagId = null } = {}) {
  if (!doc?.frame_order?.length || doc.frame_order.length > 256 || !doc.layer_order?.length || doc.layer_order.length > 32) throw new Error('Unsupported document structure.')
  assertPixelStructure(doc)
  assertPixelLinks(doc)
  const { frameOrder } = resolveTagSelection(doc, tagId)
  for (const frame of frameDocuments(doc, frameOrder)) assertPixelStructure(frame)
  const { w, h } = doc.canvas || {}, count = frameOrder.length
  if (doc.version !== SPRITE_DOCUMENT_VERSION || ![w, h].every(v => Number.isInteger(v) && v >= 1 && v <= 4096)
    || count < 1 || count > 256 || new Set(doc.frame_order).size !== doc.frame_order.length
    || doc.color?.format !== 'rgba8' || doc.color?.alpha !== 'straight' || doc.color?.space !== 'srgb'
    || doc.frame_order.some(id => !Number.isInteger(doc.frames[id].duration_ms) || doc.frames[id].duration_ms < 0)) {
    throw new Error('The saved document cannot be exported as a sprite sheet.')
  }
  const maxColumns = Math.floor(4096 / w), minColumns = Math.ceil(count / Math.floor(4096 / h))
  if (minColumns > maxColumns) throw new Error('The sprite sheet exceeds 4096 × 4096 px. Export fewer or smaller frames.')
  const columns = Math.max(minColumns, Math.min(maxColumns, Math.ceil(Math.sqrt(count))))
  const rows = Math.ceil(count / columns)
  return { columns, rows, width: columns * w, height: rows * h }
}

export async function prepareDocumentSheet({ api, projectId, canvasId, documentId, expectedRevision, name, tagId = null, isCurrent = () => true, familyFor = item => item.font.kind === 'generic' ? item.font.name : null }) {
  const check = () => { if (!isCurrent()) throw new Error(SHEET_STALE) }
  check()
  const first = await api.getDocument(projectId, documentId)
  check()
  const doc = structuredClone(first.document)
  if (doc?.project_id !== projectId || doc?.document_id !== documentId || doc?.revision !== expectedRevision
    || first.revision !== doc.revision || !Number.isInteger(doc.revision) || doc.revision < 1
    || !/^[a-f0-9]{64}$/.test(first.manifest_sha256 || '')) throw new Error(SHEET_STALE)
  const { frameOrder, selectedTag } = resolveTagSelection(doc, tagId)
  const layout = documentSheetLayout(doc, { tagId })
  const documents = frameDocuments(doc, frameOrder)
  const pixels = new Uint8Array(layout.width * layout.height * 4), frames = []
  for (const [index, id] of frameOrder.entries()) {
    check()
    const bytes = await compositePixelFrame(documents[index], id, async block => {
      check()
      const value = await api.getBlock(projectId, documentId, block.sha256)
      check()
      if (value.width !== block.w || value.height !== block.h || value.sha256 !== block.sha256
        || !(value.bytes instanceof Uint8Array) || await sha256Hex(value.bytes) !== block.sha256) {
        throw new Error('Saved layer pixels could not be verified. No files were prepared.')
      }
      return value.bytes
    }, (rgba, layerId) => paintLayerText(rgba, doc, id, layerId, familyFor, { requireFonts: true }))
    const withText = bytes
    const x = (index % layout.columns) * doc.canvas.w, y = Math.floor(index / layout.columns) * doc.canvas.h
    for (let row = 0; row < doc.canvas.h; row++) {
      pixels.set(withText.subarray(row * doc.canvas.w * 4, (row + 1) * doc.canvas.w * 4), ((y + row) * layout.width + x) * 4)
    }
    frames.push({ id, index, x, y, w: doc.canvas.w, h: doc.canvas.h, duration_ms: doc.frames[id].duration_ms })
  }
  check()
  const base = String(name || 'Canvas').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 100).replace(/\.(png|jpe?g)$/i, '') || 'Canvas'
  const tagSuffix = selectedTag
    ? `-${String(selectedTag.name || selectedTag.id).replace(/[\\/:*?"<>|\u0000-\u001f\s]+/g, '_').slice(0, 48) || selectedTag.id}`
    : ''
  const filename = `${base}${tagSuffix}-sheet-r${doc.revision}`
  const exportedTags = selectedTag
    ? [{
      id: selectedTag.id,
      name: selectedTag.name,
      from: 0,
      to: frameOrder.length - 1,
      from_frame_id: selectedTag.from_frame_id,
      to_frame_id: selectedTag.to_frame_id,
      direction: selectedTag.direction || 'forward',
    }]
    : (Array.isArray(doc.tags) && doc.tags.length
      ? doc.tags.map(tag => ({
        id: tag.id,
        name: tag.name,
        from: doc.frame_order.indexOf(tag.from_frame_id),
        to: doc.frame_order.indexOf(tag.to_frame_id),
        from_frame_id: tag.from_frame_id,
        to_frame_id: tag.to_frame_id,
        direction: tag.direction || 'forward',
      }))
      : null)
  const metadata = { format: 'gametool.sprite-sheet.v1',
    source: {
      project_id: projectId,
      canvas_id: canvasId,
      document_id: documentId,
      revision: doc.revision,
      manifest_sha256: first.manifest_sha256,
      ...(selectedTag ? { tag_id: selectedTag.id, tag_name: selectedTag.name } : {}),
    },
    image: { filename: `${filename}.png`, width: layout.width, height: layout.height },
    layout: { columns: layout.columns, rows: layout.rows, order: 'row-major', padding: 0, spacing: 0 }, frames,
    ...(exportedTags ? { tags: exportedTags } : {}) }
  const pngBlob = await savedSheetPng(layout.width, layout.height, pixels)
  check()
  // A block may cease to be referenced while reading. Never mix snapshots or retry silently.
  const last = await api.getDocument(projectId, documentId)
  check()
  if (last.revision !== doc.revision || last.document?.revision !== doc.revision || last.manifest_sha256 !== first.manifest_sha256) throw new Error(SHEET_STALE)
  return { pngBlob, jsonBlob: new Blob([JSON.stringify(metadata, null, 2) + '\n'], { type: 'application/json' }),
    pngFilename: `${filename}.png`, jsonFilename: `${filename}.json`, metadata }
}
