import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rename } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { applyStructureCommand, compositePixelBuffers, compositePixelFrame, validateStructureCommand, transformCanvasRgba, inspectCanvasResizeImpact, computeCanvasContentBounds } from '../../src/editor-project/pixelStructure.js'
import { deriveStableId, parseWorkingStructureRequest, parseRestoreWorkingRequest, sha256Bytes } from '../../src/editor-project/spriteDocumentValidation.js'
import { assertPixelLinks, pixelLinkScope } from '../../src/editor-project/pixelLinks.js'
import { SPRITE_DOCUMENT_VERSION } from '../../src/editor-project/constants.js'
import { resolveSpriteDocumentPaths, spriteDocumentBlockPath } from '../../src/editor-project/paths.js'
import { loadEditorProject } from '../../src/editor-project/projectStore.js'
import {
  createEditorProjectV1,
  createBlankSpriteDocument,
  writeWorkingPixels,
  changeWorkingStructure,
  restoreWorkingSpriteDocument,
  getSpriteDocument,
  readSpriteBlock,
} from '../../src/editor-project/spriteDocumentStore.js'
import { paintLayerText, recompositeFrame, rememberLayerPixels } from '../../src/ui/vnext/vnext-text-objects.js'
import { selectedCanvasPng } from '../../src/ui/vnext/vnext-canvas-download.js'
import { prepareDocumentSheet } from '../../src/ui/vnext/vnext-document-sheet.js'

function fixture() {
  const m = { canvas: { w: 1, h: 1 }, derived_from: {}, frame_order: ['a', 'b', 'c'], layer_order: ['top', 'bottom'], frames: {}, layers: {}, cels: {}, tags: [], anchors: [] }
  for (const id of m.layer_order) m.layers[id] = { id, name: id, kind: 'raster', visible: true, locked: false }
  for (const [i, id] of m.frame_order.entries()) {
    m.frames[id] = { id, duration_ms: (i + 1) * 80 }
    for (const layer_id of m.layer_order) { const cid = `${id}_${layer_id}`; m.cels[cid] = { id: cid, frame_id: id, layer_id, block: null } }
  }
  return m
}
const apply = (m, command) => applyStructureCommand(m, command, () => { throw Error('No new identity needed') })

test('linked-copy preference affects future copies only; blanks, other layers, deletion and moves retain explicit identity', () => {
  let serial = 0, m = fixture()
  const run = command => m = applyStructureCommand(m, command, key => `${key.replaceAll(':', '_')}_${++serial}`)
  run({ type: 'copy-frame', frame_id: 'a' }); const independent = m.frame_order.at(-1)
  assert.equal(m.links, undefined)
  run({ type: 'set-layer-link-copies', layer_id: 'top', value: true })
  run({ type: 'copy-frame', frame_id: 'a' }); const linkedFrame = m.frame_order.at(-1), group = pixelLinkScope(m, 'a_top')
  assert.equal(group.cel_ids.length, 2)
  assert.ok(group.cel_ids.every(id => m.cels[id].layer_id === 'top'))
  assert.ok(Object.values(m.cels).filter(c => c.frame_id === independent || c.layer_id === 'bottom').every(c => !pixelLinkScope(m, c.id)))
  run({ type: 'set-layer-link-copies', layer_id: 'top', value: false })
  run({ type: 'copy-frame', frame_id: linkedFrame }); assert.deepEqual(pixelLinkScope(m, 'a_top'), group)
  run({ type: 'set-layer-link-copies', layer_id: 'top', value: true })
  run({ type: 'add-frame' }); assert.ok(Object.values(m.cels).filter(c => c.frame_id === m.frame_order.at(-1)).every(c => !c.block && !pixelLinkScope(m, c.id)))
  run({ type: 'move-frame', frame_id: linkedFrame, index: 0 }); assert.deepEqual(pixelLinkScope(m, 'a_top'), group)
  run({ type: 'set-locked', layer_id: 'top', value: true })
  assert.throws(() => run({ type: 'set-layer-link-copies', layer_id: 'top', value: false }), /Unlock/)
  assert.throws(() => run({ type: 'copy-frame', frame_id: 'a' }), /Unlock/)
  run({ type: 'set-locked', layer_id: 'top', value: false })
  run({ type: 'delete-frame', frame_id: linkedFrame }); assert.deepEqual(pixelLinkScope(m, 'a_top'), { group_id: group.group_id, cel_ids: ['a_top'] })
  run({ type: 'delete-layer', layer_id: 'top' }); assert.deepEqual(m.links, { copy_layers: [], groups: {} })
})

test('linked metadata rejects unknown fields, missing/duplicate/cross-layer members and unequal blocks', () => {
  const m = fixture(); m.links = { copy_layers: ['top'], groups: { g: ['a_top', 'b_top'] } }
  assert.doesNotThrow(() => assertPixelLinks(m))
  for (const links of [null, { ...m.links, extra: true }, { ...m.links, copy_layers: ['missing'] }, { ...m.links, copy_layers: ['top', 'top'] },
    { copy_layers: [], groups: { g: [] } }, { copy_layers: [], groups: { g: ['a_top', 'missing'] } },
    { copy_layers: [], groups: { g: ['a_top', 'b_bottom'] } }, { copy_layers: [], groups: { g: ['a_top'], h: ['a_top'] } }]) {
    assert.throws(() => assertPixelLinks({ ...m, links }))
  }
  m.cels.a_top.block = { sha256: 'a'.repeat(64), w: 1, h: 1 }; assert.throws(() => assertPixelLinks(m), /identical/)
  m.cels.b_top.block = { ...m.cels.a_top.block, w: 2 }; assert.throws(() => assertPixelLinks(m), /identical/)
})

test('frame/layer reorder changes order only, preserves identities and frame durations, and composites in stack order', () => {
  const m = fixture(), original = structuredClone(m)
  const moved = apply(m, { type: 'move-frame', frame_id: 'a', index: 2 })
  assert.deepEqual(moved.frame_order, ['b', 'c', 'a'])
  for (const key of ['frames', 'layers', 'cels', 'layer_order']) assert.deepEqual(moved[key], m[key])
  assert.deepEqual(apply(moved, { type: 'move-frame', frame_id: 'a', index: 0 }), m)
  assert.deepEqual(apply(m, { type: 'move-frame', frame_id: 'b', index: 1 }), m)
  const blocks = new Map([['a_top', Uint8Array.of(255, 0, 0, 255)], ['a_bottom', Uint8Array.of(0, 0, 255, 255)]])
  assert.deepEqual([...compositePixelBuffers(m, 'a', blocks)], [255, 0, 0, 255])
  const lower = apply(m, { type: 'move-layer', layer_id: 'top', index: 1 })
  assert.deepEqual([...compositePixelBuffers(lower, 'a', blocks)], [0, 0, 255, 255])
  assert.deepEqual(lower.cels, m.cels)
  assert.deepEqual(m, original)
})

test('delete removes only the requested manifest item and intersecting cels without mutating the source', () => {
  const m = fixture(), source = structuredClone(m)
  const frame = apply(m, { type: 'delete-frame', frame_id: 'b' })
  assert.deepEqual(frame.frame_order, ['a', 'c']); assert.equal(frame.frames.b, undefined)
  assert.deepEqual(Object.keys(frame.cels), ['a_top', 'a_bottom', 'c_top', 'c_bottom'])
  assert.deepEqual(frame.layers, m.layers)
  const layer = apply(frame, { type: 'delete-layer', layer_id: 'top' })
  assert.deepEqual(layer.layer_order, ['bottom']); assert.equal(layer.layers.top, undefined)
  assert.deepEqual(Object.keys(layer.cels), ['a_bottom', 'c_bottom'])
  assert.deepEqual(layer.frames, frame.frames); assert.deepEqual(m, source)
  assert.throws(() => apply(layer, { type: 'delete-layer', layer_id: 'bottom' }), /at least one/)
  const last = apply(layer, { type: 'delete-frame', frame_id: 'c' })
  assert.throws(() => apply(last, { type: 'delete-frame', frame_id: 'a' }), /at least one/)
})

test('locks, unsupported references, invalid indexes and unknown fields fail closed', () => {
  const m = fixture(); m.layers.top.locked = true
  for (const command of [{ type: 'delete-layer', layer_id: 'top' }, { type: 'move-layer', layer_id: 'top', index: 1 }, { type: 'delete-frame', frame_id: 'a' }]) assert.throws(() => apply(m, command), /Unlock/)
  assert.deepEqual(apply(m, { type: 'move-frame', frame_id: 'a', index: 2 }).frame_order, ['b', 'c', 'a'])
  m.layers.top.locked = false
  for (const field of ['tags', 'anchors']) {
    const tagged = { ...m, [field]: [{ future: 'reference' }] }
    for (const command of [{ type: 'delete-frame', frame_id: 'a' }, { type: 'delete-layer', layer_id: 'top' }, { type: 'move-frame', frame_id: 'a', index: 1 }, { type: 'move-layer', layer_id: 'top', index: 1 }]) assert.throws(() => apply(tagged, command), /tags or anchors/)
  }
  for (const index of [-1, 0.5, 3, NaN, '1']) assert.throws(() => apply(m, { type: 'move-frame', frame_id: 'a', index }), /position/)
  assert.throws(() => apply(m, { type: 'delete-frame', frame_id: 'missing' }), /does not exist/)
  assert.throws(() => validateStructureCommand({ type: 'delete-layer', layer_id: 'top', cascade: true }), /Unsupported/)
  assert.throws(() => validateStructureCommand({ type: 'move-layer', layer_id: 'top' }), /Unsupported/)
})

function textCommand(id, patch = {}) {
  return {
    type: 'upsert-text', id, frame_id: 'a', layer_id: 'top', text: 'Hi', x: 0, y: 0, size: 8,
    font: { kind: 'generic', name: 'sans-serif' }, bold: false, italic: false, antialias: false,
    mode: 'fill', stroke_width: 1, color: '#ff0000ff', ...patch,
  }
}

test('text objects save, move, and delete without rasterizing cels', () => {
  const source = fixture()
  source.canvas = { w: 32, h: 32 }
  const created = applyStructureCommand(source, textCommand('client_1'), () => { throw new Error('no new identity') })
  assert.equal(created.text_objects.items[0].id, 'client_1')
  assert.equal(created.cels.a_top.block, null)
  assert.equal(source.text_objects, undefined)
  const server = applyStructureCommand(fixture(), textCommand(null), () => 'text_server')
  assert.equal(server.text_objects.items[0].id, 'text_server')
  const moved = applyStructureCommand(created, textCommand('client_1', { x: 2, y: 3 }), () => { throw new Error('no') })
  assert.equal(moved.text_objects.items[0].x, 2)
  assert.equal(created.text_objects.items[0].x, 0)
  assert.deepEqual(moved.cels, created.cels)
  const kept = applyStructureCommand(moved, { type: 'set-duration', frame_id: 'b', duration_ms: 200 }, () => { throw new Error('no') })
  assert.equal(kept.text_objects.items[0].id, 'client_1')
  const removed = applyStructureCommand(moved, { type: 'delete-text', id: 'client_1' }, () => { throw new Error('no') })
  assert.equal(removed.text_objects, undefined)
  assert.equal(applyStructureCommand(moved, { type: 'delete-frame', frame_id: 'a' }, () => { throw new Error('no') }).text_objects, undefined)
  const locked = fixture(); locked.layers.top.locked = true
  assert.throws(() => applyStructureCommand(locked, textCommand('client_1'), () => 'text_locked'), /Unlock/)
  assert.throws(() => applyStructureCommand(fixture(), textCommand('client_1', { font: { kind: 'generic', name: 'Comic Sans' } }), () => 'text_bad'), /font/)
  assert.throws(() => validateStructureCommand({ ...textCommand('client_1'), extra: true }), /Unsupported/)
  assert.throws(() => applyStructureCommand(moved, { type: 'delete-text', id: 'missing' }, () => 'no'), /not found/)
  const held = structuredClone(moved); held.layers.top.locked = true
  assert.throws(() => applyStructureCommand(held, { type: 'delete-text', id: 'client_1' }, () => 'no'), /Unlock/)
  assert.throws(() => applyStructureCommand(held, textCommand('client_1', { x: 1 }), () => 'no'), /Unlock/)
  const other = structuredClone(moved); other.layers.bottom.locked = true
  assert.throws(() => applyStructureCommand(other, textCommand('client_1', { layer_id: 'bottom' }), () => 'no'), /Unlock/)
  assert.throws(() => applyStructureCommand(moved, textCommand('bad', { frame_id: 'toString' }), () => 'no'), /invalid/)
  assert.throws(() => applyStructureCommand(moved, textCommand('bad', { layer_id: 'constructor' }), () => 'no'), /invalid/)
})

test('outside text coordinates preserve complete objects through updates and frame copies', () => {
  let doc = fixture()
  for (const [x, y] of [[-8, 0], [0, -16], [64, 2], [2, 64], [-200, 300]]) {
    const command = textCommand('outside', { x, y, text: 'Hi完整文字', size: 16 })
    doc = apply(doc, command)
    const saved = JSON.parse(JSON.stringify(doc))
    const { type, ...expected } = command
    assert.deepEqual(saved.text_objects.items[0], expected)
    assert.deepEqual(saved.cels, fixture().cels)
    const copied = applyStructureCommand(saved, { type: 'copy-frame', frame_id: 'a' }, label => `copy_${label.replaceAll(':', '_')}`)
    const object = copied.text_objects.items.find(item => item.frame_id === copied.frame_order.at(-1))
    assert.equal(object.text, command.text); assert.equal(object.x, x); assert.equal(object.y, y)
  }
  for (const x of [NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => apply(doc, textCommand('outside', { x })), /safe integer/)
  doc.layers.top.locked = true
  assert.throws(() => apply(doc, textCommand('outside', { x: -10 })), /Unlock/)
})

test('copy-frame duplicates text as independent objects and refuses to pass 32', () => {
  const idFor = label => deriveStableId('s', `doc:op:${label}`)
  const source = fixture(); source.canvas = { w: 32, h: 32 }
  const first = applyStructureCommand(source, textCommand('keep'), idFor)
  const withText = applyStructureCommand(first, textCommand('keep_b', { x: 4 }), idFor)
  assert.equal(idFor('text'), idFor('text'))
  const copied = applyStructureCommand(withText, { type: 'copy-frame', frame_id: 'a' }, idFor)
  const copies = copied.text_objects.items.filter(item => item.frame_id === copied.frame_order.at(-1))
  assert.equal(copies.length, 2)
  assert.equal(new Set(copies.map(item => item.id)).size, 2)
  assert.equal(copied.links, undefined)
  const full = fixture(); full.canvas = { w: 32, h: 32 }
  full.text_objects = { version: 1, items: Array.from({ length: 32 }, (_, index) => ({ ...textCommand(`t${index}`), type: undefined, id: `t${index}` })) }
  full.text_objects.items.forEach(item => delete item.type)
  assert.throws(() => applyStructureCommand(full, { type: 'copy-frame', frame_id: 'a' }, idFor), /32/)
})

test('shared block bytes are cached for every layer', async () => {
  const m = fixture()
  const shared = Uint8Array.of(1, 2, 3, 4)
  const block = { sha256: 'a'.repeat(64), w: 1, h: 1 }
  m.cels.a_top.block = block
  m.cels.a_bottom.block = block
  let layers
  await compositePixelFrame(m, 'a', async () => shared, null, found => { layers = found })
  assert.equal(layers.get('top'), shared)
  assert.equal(layers.get('bottom'), shared)
})

test('empty lower text survives a transparent upper raster', () => {
  const m = fixture()
  const blocks = new Map([['a_top', Uint8Array.of(0, 0, 255, 0)]])
  const painted = compositePixelBuffers(m, 'a', blocks, (rgba, layerId) => {
    if (layerId !== 'bottom') return rgba
    const next = new Uint8Array(rgba)
    next.set([0, 255, 0, 255])
    return next
  })
  assert.deepEqual([...painted], [0, 255, 0, 255])
})

test('text paint follows layer order instead of covering every raster', () => {
  const m = fixture()
  const blocks = new Map([['a_top', Uint8Array.of(0, 0, 255, 255)], ['a_bottom', Uint8Array.of(255, 0, 0, 255)]])
  const painted = compositePixelBuffers(m, 'a', blocks, (rgba, layerId) => {
    if (layerId !== 'bottom') return rgba
    const next = new Uint8Array(rgba)
    next.set([0, 255, 0, 255])
    return next
  })
  assert.deepEqual([...painted], [0, 0, 255, 255])
})

test('per-layer text compositing preserves same-layer transparent text erase without punching through lower layers, blends alpha=128 and antialiased glyphs over lower layers, and matches across preview, playback, PNG download, and sprite-sheet export (§18.12 Item 11)', async () => {
  const prevDoc = globalThis.document
  // Deterministic 4x1 glyph mask: pixel 0 has full coverage (255), pixel 1 has AA edge coverage (128), pixels 2..3 have 0 coverage.
  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, 'canvas')
      return {
        width: 4,
        height: 1,
        getContext() {
          return {
            measureText() {
              return {
                width: 2,
                actualBoundingBoxLeft: 0,
                actualBoundingBoxRight: 2,
                actualBoundingBoxAscent: 6,
                actualBoundingBoxDescent: 1,
              }
            },
            fillText() {},
            strokeText() {},
            getImageData(x, y, w, h) {
              const data = new Uint8ClampedArray(w * h * 4)
              if (w >= 1) data[3] = 255
              if (w >= 2) data[7] = 128
              return { data }
            },
          }
        },
      }
    },
  }
  try {
    const redRow = Uint8Array.of(
      255, 0, 0, 255,
      255, 0, 0, 255,
      255, 0, 0, 255,
      255, 0, 0, 255,
    )
    const blueRow = Uint8Array.of(
      0, 0, 255, 255,
      0, 0, 255, 255,
      0, 0, 255, 255,
      0, 0, 255, 255,
    )
    const redSha = sha256Bytes(redRow)
    const blueSha = sha256Bytes(blueRow)

    const makeDoc = (textPatch, { topRaster = false } = {}) => {
      const base = {
        version: SPRITE_DOCUMENT_VERSION,
        project_id: 'proj_1',
        document_id: 'doc_1',
        name: 'TextLayers',
        revision: 2,
        canvas: { w: 4, h: 1 },
        color: { format: 'rgba8', alpha: 'straight', space: 'srgb' },
        derived_from: { document_id: 'orig_1', revision: 1 },
        frame_order: ['a'],
        layer_order: ['top', 'bottom'],
        frames: { a: { id: 'a', duration_ms: 100 } },
        layers: {
          top: { id: 'top', name: 'top', kind: 'raster', visible: true, locked: false },
          bottom: { id: 'bottom', name: 'bottom', kind: 'raster', visible: true, locked: false },
        },
        cels: {
          a_top: { id: 'a_top', frame_id: 'a', layer_id: 'top', block: topRaster ? { sha256: blueSha, w: 4, h: 1 } : null },
          a_bottom: { id: 'a_bottom', frame_id: 'a', layer_id: 'bottom', block: { sha256: redSha, w: 4, h: 1 } },
        },
        tags: [],
        anchors: [],
      }
      return apply(base, textCommand('t1', textPatch))
    }

    const familyFor = item => item.font.name
    const readBlock = async (block) => {
      if (block.sha256 === redSha) return redRow
      if (block.sha256 === blueSha) return blueRow
      throw new Error('unexpected block')
    }

    // 1a. Upper empty layer with transparent text (#00000000, alpha=0) over opaque red lower layer:
    // must NOT punch transparent holes into lower red layer
    const docEmptyAlpha0 = makeDoc({ color: '#00000000', antialias: false }, { topRaster: false })
    const compEmptyAlpha0 = await compositePixelFrame(
      docEmptyAlpha0,
      'a',
      readBlock,
      (rgba, layerId) => paintLayerText(rgba, docEmptyAlpha0, 'a', layerId, familyFor),
      (layers) => rememberLayerPixels(docEmptyAlpha0, 'a', layers)
    )
    assert.deepEqual([...compEmptyAlpha0], [...redRow], 'upper empty layer with alpha=0 text must preserve lower opaque red layer')

    // 1b. Upper blue layer with transparent text (#00000000, alpha=0) over opaque red lower layer:
    // erases pixel 0 of upper blue layer (revealing lower red), while pixel 2..3 keep upper blue
    const docBlueAlpha0 = makeDoc({ color: '#00000000', antialias: false }, { topRaster: true })
    const compBlueAlpha0 = await compositePixelFrame(
      docBlueAlpha0,
      'a',
      readBlock,
      (rgba, layerId) => paintLayerText(rgba, docBlueAlpha0, 'a', layerId, familyFor),
      (layers) => rememberLayerPixels(docBlueAlpha0, 'a', layers)
    )
    assert.deepEqual([...compBlueAlpha0.slice(0, 4)], [255, 0, 0, 255], 'pixel 0 erased on top layer reveals lower red layer with alpha=255')
    assert.deepEqual([...compBlueAlpha0.slice(8, 12)], [0, 0, 255, 255], 'pixel 2 outside glyph keeps top blue layer')

    // 2. Upper empty layer with semi-transparent green text (#00ff0080, alpha=128) over opaque red lower layer:
    // blends green (alpha=128) over opaque red -> composite alpha remains 255, not 128
    const docAlpha128 = makeDoc({ color: '#00ff0080', antialias: false }, { topRaster: false })
    const compAlpha128 = await compositePixelFrame(
      docAlpha128,
      'a',
      readBlock,
      (rgba, layerId) => paintLayerText(rgba, docAlpha128, 'a', layerId, familyFor),
      (layers) => rememberLayerPixels(docAlpha128, 'a', layers)
    )
    assert.deepEqual([...compAlpha128.slice(0, 4)], [127, 128, 0, 255], 'semi-transparent upper text must blend over lower opaque layer with alpha=255')
    assert.deepEqual([...compAlpha128.slice(8, 12)], [255, 0, 0, 255])

    // 3. Upper empty layer with antialiased opaque green text (#00ff00ff, antialias: true) over opaque red lower layer:
    // pixel 0 (mask=255) is [0,255,0,255]; pixel 1 (mask=128 AA edge) blends over red -> [127,128,0,255] with alpha=255
    const docAA = makeDoc({ color: '#00ff00ff', antialias: true }, { topRaster: false })
    const compAA = await compositePixelFrame(
      docAA,
      'a',
      readBlock,
      (rgba, layerId) => paintLayerText(rgba, docAA, 'a', layerId, familyFor),
      (layers) => rememberLayerPixels(docAA, 'a', layers)
    )
    assert.deepEqual([...compAA.slice(0, 4)], [0, 255, 0, 255])
    assert.deepEqual([...compAA.slice(4, 8)], [127, 128, 0, 255], 'AA edge pixel on upper layer must blend over lower opaque layer with alpha=255')
    assert.deepEqual([...compAA.slice(8, 12)], [255, 0, 0, 255])

    // 4. Layer reorder and visibility:
    // Reordering bottom above top covers top's green text with opaque red; hiding top also shows red
    const reordered = apply(docAA, { type: 'move-layer', layer_id: 'top', index: 1 })
    const compReordered = await compositePixelFrame(
      reordered,
      'a',
      readBlock,
      (rgba, layerId) => paintLayerText(rgba, reordered, 'a', layerId, familyFor)
    )
    assert.deepEqual([...compReordered], [...redRow])

    const hiddenTop = apply(docAA, { type: 'set-visible', layer_id: 'top', value: false })
    const compHiddenTop = await compositePixelFrame(
      hiddenTop,
      'a',
      readBlock,
      (rgba, layerId) => paintLayerText(rgba, hiddenTop, 'a', layerId, familyFor)
    )
    assert.deepEqual([...compHiddenTop], [...redRow])

    // 5. Verify preview (recompositeFrame), playback (compositePixelFrame), current-frame PNG download (selectedCanvasPng),
    // and sprite-sheet export (prepareDocumentSheet) all produce identical RGBA pixels
    const previewRgba = recompositeFrame(docAA, 'a', familyFor)
    assert.deepEqual([...previewRgba], [...compAA])

    const frameDownload = await selectedCanvasPng(
      { name: 'TextLayers', width: 4, height: 1, preview: {} },
      { loadPixels: async () => compAA }
    )
    const frameDownloadDecoded = await sharp(Buffer.from(await frameDownload.blob.arrayBuffer())).ensureAlpha().raw().toBuffer()
    assert.deepEqual([...frameDownloadDecoded], [...compAA])

    const manifestSha = sha256Bytes(Buffer.from(JSON.stringify(docAA)))
    const sheetPrepared = await prepareDocumentSheet({
      api: {
        async getDocument() {
          return { revision: docAA.revision, manifest_sha256: manifestSha, document: docAA }
        },
        async getBlock(_projectId, _docId, sha) {
          const bytes = await readBlock({ sha256: sha })
          return { width: 4, height: 1, sha256: sha, bytes }
        },
      },
      projectId: 'proj_1',
      canvasId: 'canvas_1',
      documentId: 'doc_1',
      expectedRevision: docAA.revision,
      name: 'TextLayers',
      familyFor,
    })
    const sheetDecoded = await sharp(Buffer.from(await sheetPrepared.pngBlob.arrayBuffer())).ensureAlpha().raw().toBuffer()
    assert.deepEqual([...sheetDecoded], [...compAA])
  } finally {
    globalThis.document = prevDoc
  }
})

test('animation tags create, update, delete, survive frame reorder/deletion, and export in sprite sheet metadata', async () => {
  let serial = 0
  let m = {
    version: SPRITE_DOCUMENT_VERSION,
    project_id: 'p1',
    document_id: 'd1',
    name: 'TaggedDoc',
    revision: 1,
    parent_revision: null,
    color: { format: 'rgba8', alpha: 'straight', space: 'srgb' },
    source_ref: null,
    palette: [],
    ...fixture(),
  }
  const run = cmd => { m = applyStructureCommand(m, cmd, key => `${key.replaceAll(':', '_')}_${++serial}`) }
  run({ type: 'add-tag', name: 'Idle', from_frame_id: 'a', to_frame_id: 'b', direction: 'forward' })
  run({ type: 'add-tag', name: 'Attack', from_frame_id: 'c', to_frame_id: 'c', direction: 'pingpong' })
  assert.equal(m.tags.length, 2)
  assert.deepEqual(m.tags[0], { id: 'tag_1', name: 'Idle', from_frame_id: 'a', to_frame_id: 'b', direction: 'forward' })
  run({ type: 'update-tag', tag_id: 'tag_1', name: 'Walk', from_frame_id: 'a', to_frame_id: 'c', direction: 'reverse' })
  assert.deepEqual(m.tags[0], { id: 'tag_1', name: 'Walk', from_frame_id: 'a', to_frame_id: 'c', direction: 'reverse' })

  // Reordering frames keeps tag endpoints ordered in frame_order
  run({ type: 'move-frame', frame_id: 'a', index: 2 })
  assert.deepEqual(m.frame_order, ['b', 'c', 'a'])
  assert.deepEqual(m.tags[0], { id: 'tag_1', name: 'Walk', from_frame_id: 'c', to_frame_id: 'a', direction: 'reverse' })

  // Deleting a single-frame tag's only frame removes that tag; multi-frame tag shrinks its range
  run({ type: 'delete-frame', frame_id: 'c' })
  assert.deepEqual(m.frame_order, ['b', 'a'])
  assert.equal(m.tags.length, 1)
  assert.deepEqual(m.tags[0], { id: 'tag_1', name: 'Walk', from_frame_id: 'a', to_frame_id: 'a', direction: 'reverse' })

  // Exported sheet metadata includes tags
  const manifestSha = sha256Bytes(Buffer.from(JSON.stringify(m)))
  const sheet = await prepareDocumentSheet({
    api: {
      async getDocument() { return { revision: m.revision, manifest_sha256: manifestSha, document: m } },
      async getBlock() { throw new Error('no blocks') },
    },
    projectId: 'p1',
    canvasId: 'c1',
    documentId: 'd1',
    expectedRevision: m.revision,
    name: 'TaggedDoc',
  })
  assert.deepEqual(sheet.metadata.tags, [{
    id: 'tag_1',
    name: 'Walk',
    from: 1,
    to: 1,
    from_frame_id: 'a',
    to_frame_id: 'a',
    direction: 'reverse',
  }])

  run({ type: 'delete-tag', tag_id: 'tag_1' })
  assert.deepEqual(m.tags, [])
})

test('manual cel linking and unlinking links existing cels on the same layer and dissolves two-member groups on unlink', () => {
  let serial = 0
  let m = fixture()
  const blockSha = 'b'.repeat(64)
  m.cels.a_top.block = { sha256: blockSha, w: 1, h: 1 }
  const run = cmd => { m = applyStructureCommand(m, cmd, key => `${key.replaceAll(':', '_')}_${++serial}`) }

  run({ type: 'link-cels', layer_id: 'top', source_frame_id: 'a', target_frame_id: 'b' })
  const group = pixelLinkScope(m, 'a_top')
  assert.deepEqual(group?.cel_ids, ['a_top', 'b_top'])
  assert.deepEqual(m.cels.b_top.block, { sha256: blockSha, w: 1, h: 1 })

  // Linking a third frame joins the same group
  run({ type: 'link-cels', layer_id: 'top', source_frame_id: 'b', target_frame_id: 'c' })
  assert.deepEqual(pixelLinkScope(m, 'a_top')?.cel_ids, ['a_top', 'b_top', 'c_top'])

  // Unlinking one member of a 3-cel group leaves the other 2 linked and keeps the unlinked cel's pixels
  run({ type: 'unlink-cel', layer_id: 'top', frame_id: 'c' })
  assert.equal(pixelLinkScope(m, 'c_top'), null)
  assert.deepEqual(m.cels.c_top.block, { sha256: blockSha, w: 1, h: 1 })
  assert.deepEqual(pixelLinkScope(m, 'a_top')?.cel_ids, ['a_top', 'b_top'])

  // Unlinking one member of a 2-cel group dissolves the group so neither remains linked
  run({ type: 'unlink-cel', layer_id: 'top', frame_id: 'b' })
  assert.equal(pixelLinkScope(m, 'a_top'), null)
  assert.equal(pixelLinkScope(m, 'b_top'), null)
  assert.deepEqual(m.cels.a_top.block, { sha256: blockSha, w: 1, h: 1 })
  assert.deepEqual(m.cels.b_top.block, { sha256: blockSha, w: 1, h: 1 })
})

test('resize-canvas pads and crops RGBA blocks, preserves linked cel groups, shifts text objects, and detects pixel and rendered glyph-extent clipping', () => {
  let serial = 0
  let m = fixture()
  m.canvas = { w: 2, h: 2 }
  // 2x2 block with opaque pixel at (1, 1) and transparent elsewhere
  const srcBytes = new Uint8Array([
    0, 0, 0, 0,   0, 0, 0, 0,
    0, 0, 0, 0,   255, 128, 0, 255,
  ])
  const srcSha = sha256Bytes(srcBytes)
  m.cels.a_top.block = { sha256: srcSha, w: 2, h: 2 }
  m.cels.b_top.block = { sha256: srcSha, w: 2, h: 2 }
  m.links = { copy_layers: ['top'], groups: { g1: ['a_top', 'b_top'] } }
  m = applyStructureCommand(m, textCommand('t1', { x: 1, y: 1 }), () => 't1')

  const bounds = computeCanvasContentBounds(m, () => srcBytes)
  assert.deepEqual(bounds, { x: 1, y: 1, w: 1, h: 1, width: 1, height: 1, offset_x: -1, offset_y: -1 })

  // Cropping to (0,0,1,1) clips the opaque pixel at (1,1) across 2 cels/frames and the text object
  const impactClip = inspectCanvasResizeImpact(m, () => srcBytes, { width: 1, height: 1, offset_x: 0, offset_y: 0 })
  assert.equal(impactClip.clipsContent, true)
  assert.equal(impactClip.clippedPixelCount, 2)
  assert.equal(impactClip.affectedFrameCount, 2)
  assert.equal(impactClip.outsideTextCount, 1)

  // Padding to 4x4 with offset (+1, +1) keeps text origin (2,2) inside 4x4, but rendered 8px 'Hi' glyph extents overflow 4x4
  const impactPadSmall = inspectCanvasResizeImpact(m, () => srcBytes, { width: 4, height: 4, offset_x: 1, offset_y: 1 })
  assert.equal(impactPadSmall.clipsPixels, false)
  assert.equal(impactPadSmall.clippedPixelCount, 0)
  assert.equal(impactPadSmall.clipsText, true, 'warns when visible text glyph extents overflow target canvas even though origin (2,2) is inside 4x4')
  assert.equal(impactPadSmall.clippedTextCount, 1)

  // Padding to 24x24 with offset (+1, +1) fits both pixels and rendered glyph extents
  const impactPadFit = inspectCanvasResizeImpact(m, () => srcBytes, { width: 24, height: 24, offset_x: 1, offset_y: 1 })
  assert.equal(impactPadFit.clipsContent, false)
  assert.equal(impactPadFit.clippedPixelCount, 0)
  assert.equal(impactPadFit.clippedTextCount, 0)

  // Hidden-layer text does not trigger a visible-text clipping warning
  const hiddenLayerDoc = structuredClone(m)
  hiddenLayerDoc.layers.top.visible = false
  const impactHiddenText = inspectCanvasResizeImpact(hiddenLayerDoc, () => srcBytes, { width: 4, height: 4, offset_x: 1, offset_y: 1 })
  assert.equal(impactHiddenText.clipsText, false)

  const paddedBytes = transformCanvasRgba(srcBytes, 2, 2, 4, 4, 1, 1)
  const paddedSha = sha256Bytes(paddedBytes)
  const blockMap = new Map([[srcSha, { sha256: paddedSha, w: 4, h: 4 }]])
  const padded = applyStructureCommand(
    m,
    { type: 'resize-canvas', width: 4, height: 4, offset_x: 1, offset_y: 1 },
    key => `${key}_${++serial}`,
    { blockMap },
  )
  assert.deepEqual(padded.canvas, { w: 4, h: 4 })
  assert.deepEqual(padded.cels.a_top.block, { sha256: paddedSha, w: 4, h: 4 })
  assert.deepEqual(padded.cels.b_top.block, { sha256: paddedSha, w: 4, h: 4 })
  assert.deepEqual(pixelLinkScope(padded, 'a_top')?.cel_ids, ['a_top', 'b_top'])
  assert.equal(padded.text_objects.items[0].x, 2)
  assert.equal(padded.text_objects.items[0].y, 2)
  // Pixel at old (1,1) moved to (2,2) in 4x4 canvas
  const dstIdx = (2 * 4 + 2) * 4
  assert.deepEqual([...paddedBytes.slice(dstIdx, dstIdx + 4)], [255, 128, 0, 255])
})

test('store-level changeWorkingStructure persists resize-canvas, linked cels, text objects, tags, preflight expanded-RGBA rejection, Undo/Redo, and reopening from disk', async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'structure-persistence-'))
  const createOp = randomUUID()
  const created = await createEditorProjectV1({
    projectRoot,
    operationId: createOp,
    payload: { operation_id: createOp, name: 'StructurePersistence' },
  })
  const projectId = created.project.id
  let expectedRevision = created.project.revision

  const blankOp = randomUUID()
  const blank = await createBlankSpriteDocument({
    projectRoot,
    projectId,
    operationId: blankOp,
    expectedRevision,
    width: 2,
    height: 2,
    name: 'HeroCanvas',
    payload: { action: 'create_blank', operation_id: blankOp, expected_revision: expectedRevision, width: 2, height: 2, name: 'HeroCanvas' },
  })
  expectedRevision = blank.project.revision
  const documentId = blank.document.document_id
  let workingRevision = blank.document.revision
  const frame0 = blank.document.frame_order[0]
  const layer0 = blank.document.layer_order[0]
  const cel0 = Object.values(blank.document.cels)[0].id

  const runStructure = async (command) => {
    const opId = randomUUID()
    const parsed = parseWorkingStructureRequest({
      operation_id: opId,
      expected_revision: expectedRevision,
      expected_working_revision: workingRevision,
      command,
    }, documentId)
    const res = await changeWorkingStructure({
      projectRoot,
      projectId,
      documentId,
      operationId: parsed.operation_id,
      expectedRevision: parsed.expected_revision,
      expectedWorkingRevision: parsed.expected_working_revision,
      command: parsed.command,
      payload: parsed.payload,
    })
    expectedRevision = res.project.revision
    workingRevision = res.document.revision
    return res
  }

  // Paint a 2x2 pixel block on frame0/layer0 with opaque pixel at (1, 1)
  const initialRgba = new Uint8Array([
    0, 0, 0, 0,   0, 0, 0, 0,
    0, 0, 0, 0,   20, 140, 240, 255,
  ])
  const initialSha = sha256Bytes(initialRgba)
  const paintOp = randomUUID()
  const painted = await writeWorkingPixels({
    projectRoot,
    projectId,
    documentId,
    operationId: paintOp,
    expectedRevision,
    expectedWorkingRevision: workingRevision,
    rect: { x: 0, y: 0, w: 2, h: 2 },
    rgba: initialRgba,
    expectedSha256: initialSha,
    target: { frame_id: frame0, layer_id: layer0, cel_id: cel0 },
    payload: {
      action: 'working_pixels',
      operation_id: paintOp,
      expected_revision: expectedRevision,
      expected_working_revision: workingRevision,
      document_id: documentId,
      x: 0, y: 0, w: 2, h: 2,
      expected_sha256: initialSha,
      frame_id: frame0, layer_id: layer0, cel_id: cel0,
    },
  })
  expectedRevision = painted.project.revision
  workingRevision = painted.document.revision

  // Add second frame, link frame0 and frame1 cels on layer0, add editable text, and add an animation tag
  const withFrame2 = await runStructure({ type: 'add-frame' })
  const frame1 = withFrame2.document.frame_order[1]
  await runStructure({ type: 'link-cels', layer_id: layer0, source_frame_id: frame0, target_frame_id: frame1 })
  await runStructure({
    type: 'upsert-text',
    id: 'txt_hero',
    frame_id: frame0,
    layer_id: layer0,
    text: 'Go',
    x: 1,
    y: 1,
    size: 8,
    font: { kind: 'generic', name: 'sans-serif' },
    bold: false,
    italic: false,
    antialias: false,
    mode: 'fill',
    stroke_width: 1,
    color: '#ff4400ff',
  })
  const beforeResizeStep = await runStructure({
    type: 'add-tag',
    name: 'Run',
    from_frame_id: frame0,
    to_frame_id: frame1,
    direction: 'forward',
  })
  const revisionBeforeResize = beforeResizeStep.document.revision

  // Resize canvas from 2x2 to 4x4 with offset (+1, +1)
  const resized = await runStructure({
    type: 'resize-canvas',
    width: 4,
    height: 4,
    offset_x: 1,
    offset_y: 1,
  })
  const revisionAfterResize = resized.document.revision
  assert.deepEqual(resized.document.canvas, { w: 4, h: 4 })
  assert.equal(resized.document.text_objects.items[0].x, 2)
  assert.equal(resized.document.text_objects.items[0].y, 2)

  // Both linked cels share the same transformed 4x4 block on disk
  const cel1 = Object.values(resized.document.cels).find(c => c.frame_id === frame1 && c.layer_id === layer0).id
  assert.deepEqual(pixelLinkScope(resized.document, cel0)?.cel_ids, [cel0, cel1])
  assert.equal(resized.document.cels[cel0].block.sha256, resized.document.cels[cel1].block.sha256)
  const resizedBlock = await readSpriteBlock({
    projectRoot,
    projectId,
    documentId,
    sha256: resized.document.cels[cel0].block.sha256,
  })
  assert.equal(resizedBlock.width, 4)
  assert.equal(resizedBlock.height, 4)
  const movedOffset = (2 * 4 + 2) * 4
  assert.deepEqual([...resizedBlock.bytes.slice(movedOffset, movedOffset + 4)], [20, 140, 240, 255])

  // Undo resize-canvas via restoreWorkingSpriteDocument(mode: 'structure') and verify reopened state
  const undoOp = randomUUID()
  const undoParsed = parseRestoreWorkingRequest({
    operation_id: undoOp,
    expected_revision: expectedRevision,
    expected_working_revision: workingRevision,
    target_revision: revisionBeforeResize,
    mode: 'structure',
  }, documentId)
  const undone = await restoreWorkingSpriteDocument({
    projectRoot,
    projectId,
    documentId,
    operationId: undoParsed.operation_id,
    expectedRevision: undoParsed.expected_revision,
    expectedWorkingRevision: undoParsed.expected_working_revision,
    targetRevision: undoParsed.target_revision,
    mode: undoParsed.mode,
    payload: undoParsed.payload,
  })
  expectedRevision = undone.project.revision
  workingRevision = undone.document.revision
  assert.deepEqual(undone.document.canvas, { w: 2, h: 2 })
  assert.equal(undone.document.text_objects.items[0].x, 1)
  assert.equal(undone.document.text_objects.items[0].y, 1)

  // Redo resize-canvas via restoreWorkingSpriteDocument(mode: 'structure') and reopen from disk
  const redoOp = randomUUID()
  const redoParsed = parseRestoreWorkingRequest({
    operation_id: redoOp,
    expected_revision: expectedRevision,
    expected_working_revision: workingRevision,
    target_revision: revisionAfterResize,
    mode: 'structure',
  }, documentId)
  const redone = await restoreWorkingSpriteDocument({
    projectRoot,
    projectId,
    documentId,
    operationId: redoParsed.operation_id,
    expectedRevision: redoParsed.expected_revision,
    expectedWorkingRevision: redoParsed.expected_working_revision,
    targetRevision: redoParsed.target_revision,
    mode: redoParsed.mode,
    payload: redoParsed.payload,
  })
  expectedRevision = redone.project.revision
  workingRevision = redone.document.revision

  const reopenedProject = (await loadEditorProject({ projectRoot, projectId })).project
  const reopenedDoc = await getSpriteDocument({ projectRoot, projectId, documentId })
  assert.equal(reopenedProject.sprite_documents[documentId].working_revision, workingRevision)
  assert.deepEqual(reopenedDoc.manifest.canvas, { w: 4, h: 4 })
  assert.equal(reopenedDoc.manifest.text_objects.items[0].x, 2)
  assert.equal(reopenedDoc.manifest.text_objects.items[0].y, 2)
  assert.deepEqual(pixelLinkScope(reopenedDoc.manifest, cel0)?.cel_ids, [cel0, cel1])
  assert.equal(reopenedDoc.manifest.tags.length, 1)
  assert.equal(reopenedDoc.manifest.tags[0].name, 'Run')

  // Preflight expanded-RGBA limit rejection: add linked copies up to 33 non-empty cels so resizing to 1024x1024 (33 * 4 MiB = 132 MiB > 128 MiB) fails before source-block reading or buffer allocation
  await runStructure({ type: 'set-layer-link-copies', layer_id: layer0, value: true })
  for (let i = 2; i < 33; i += 1) {
    await runStructure({ type: 'copy-frame', frame_id: frame0 })
  }
  const revBeforeOversized = expectedRevision
  const workRevBeforeOversized = workingRevision
  const sharedBlockSha = reopenedDoc.manifest.cels[cel0].block.sha256
  const docPaths = resolveSpriteDocumentPaths({ projectId, documentId, projectRoot })
  const sharedBlockFile = spriteDocumentBlockPath(docPaths, sharedBlockSha)
  await rename(sharedBlockFile, `${sharedBlockFile}.aside`)
  try {
    // Entering readCelBytes/transformCanvasRgba with the source block moved aside would throw not_found (as shown by the 6x6 control below);
    // rejecting with resource_limit proves preflight runs before reading source blocks or allocating transformed buffers.
    await assert.rejects(
      runStructure({ type: 'resize-canvas', width: 1024, height: 1024, offset_x: 0, offset_y: 0 }),
      { code: 'resource_limit' },
    )
    await assert.rejects(
      runStructure({ type: 'resize-canvas', width: 6, height: 6, offset_x: 0, offset_y: 0 }),
      { code: 'not_found' },
    )
  } finally {
    await rename(`${sharedBlockFile}.aside`, sharedBlockFile)
  }
  const afterRejectedProject = (await loadEditorProject({ projectRoot, projectId })).project
  const afterRejectedDoc = await getSpriteDocument({ projectRoot, projectId, documentId })
  assert.equal(afterRejectedProject.revision, revBeforeOversized, 'failed oversized resize does not modify project revision')
  assert.equal(afterRejectedDoc.revision, workRevBeforeOversized, 'failed oversized resize does not modify working revision')
  assert.deepEqual(afterRejectedDoc.manifest.canvas, { w: 4, h: 4 }, 'failed oversized resize leaves canvas size untouched')
})
