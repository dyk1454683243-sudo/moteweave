import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { prepareDocumentSheet, documentSheetLayout } from '../../src/ui/vnext/vnext-document-sheet.js'
import { savedSheetPng } from '../../src/ui/vnext/vnext-canvas-download.js'
import { decodePngToRgba } from '../../src/editor-project/spriteDocumentStore.js'
const hash = b => createHash('sha256').update(b).digest('hex')
function fixture(count = 3, w = 2, h = 1) {
  const blocks = new Map(), read = []
  const doc = { version: 'sprite_document_v1', project_id: 'p', document_id: 'd', revision: 4,
    canvas: { w, h }, color: { format: 'rgba8', alpha: 'straight', space: 'srgb' },
    frame_order: [], layer_order: ['top', 'base'], frames: {}, layers: {}, cels: {} }
  for (const id of doc.layer_order) doc.layers[id] = { id, name: id, kind: 'raster', visible: id === 'base', locked: false }
  for (let i = 0; i < count; i++) {
    const id = `f${i}`; doc.frame_order.push(id); doc.frames[id] = { id, duration_ms: [80, 140, 0][i % 3] }
    for (const layer of doc.layer_order) {
      const cel = `${id}-${layer}`
      let block = null
      if (w === 2 && h === 1) {
        const bytes = new Uint8Array(layer === 'base' ? [77 + i, 115, 102, 23, 20, 90, 170, 0] : [255, 0, 0, 255, 255, 0, 0, 255])
        const sha256 = hash(bytes); block = { sha256, w, h }; blocks.set(sha256, { sha256, width: w, height: h, bytes })
      }
      doc.cels[cel] = { id: cel, frame_id: id, layer_id: layer, block }
    }
  }
  const api = { getDocument: async () => ({ document: structuredClone(doc), revision: doc.revision, manifest_sha256: hash(JSON.stringify(doc)) }),
    getBlock: async (_p, _d, sha) => { read.push(sha); return blocks.get(sha) } }
  return { doc, api, blocks, read, args: { api, projectId: 'p', canvasId: 'c', documentId: 'd', expectedRevision: 4, name: 'hero/a.png' } }
}
test('saved sheet preserves frame order, durations, hidden layers and exact RGBA; repeated PNG/JSON are identical', async () => {
  const f = fixture(), a = await prepareDocumentSheet(f.args), b = await prepareDocumentSheet(f.args)
  assert.deepEqual(a.metadata.layout, { columns: 2, rows: 2, order: 'row-major', padding: 0, spacing: 0 })
  assert.deepEqual(a.metadata.frames.map(x => [x.id, x.x, x.y, x.w, x.h, x.duration_ms]), [['f0',0,0,2,1,80],['f1',2,0,2,1,140],['f2',0,1,2,1,0]])
  assert.equal(a.metadata.source.revision, 4); assert.equal(a.metadata.source.manifest_sha256.length, 64)
  assert.equal(a.pngFilename, 'hero_a-sheet-r4.png'); assert.equal(a.metadata.image.filename, a.pngFilename)
  const raw = decodePngToRgba(Buffer.from(await a.pngBlob.arrayBuffer())).rgba
  assert.deepEqual([...raw], [77,115,102,23,20,90,170,0,78,115,102,23,20,90,170,0,79,115,102,23,20,90,170,0,0,0,0,0,0,0,0,0])
  assert.equal(f.read.length, 6); assert.ok(f.read.every(h => h !== f.doc.cels['f0-top'].block.sha256))
  assert.deepEqual(await a.pngBlob.arrayBuffer(), await b.pngBlob.arrayBuffer())
  assert.equal(await a.jsonBlob.text(), await b.jsonBlob.text())
})
test('sheet uses existing top-to-bottom layer composition when both layers are visible', async () => {
  const f = fixture(1); f.doc.layers.top.visible = true
  const result = await prepareDocumentSheet(f.args)
  assert.deepEqual([...decodePngToRgba(Buffer.from(await result.pngBlob.arrayBuffer())).rgba], [255,0,0,255,255,0,0,255])
})
test('linked frames export identical composited pixels without link metadata; invalid whole-document links are rejected', async () => {
  const f = fixture(2)
  f.doc.cels['f1-base'].block = structuredClone(f.doc.cels['f0-base'].block)
  f.doc.links = { copy_layers: ['base'], groups: { g: ['f0-base', 'f1-base'] } }
  const a = await prepareDocumentSheet(f.args), b = await prepareDocumentSheet(f.args)
  const raw = decodePngToRgba(Buffer.from(await a.pngBlob.arrayBuffer())).rgba
  assert.deepEqual([...raw], [77,115,102,23,20,90,170,0,77,115,102,23,20,90,170,0])
  assert.equal(Object.hasOwn(a.metadata, 'links'), false)
  assert.deepEqual(await a.pngBlob.arrayBuffer(), await b.pngBlob.arrayBuffer()); assert.equal(await a.jsonBlob.text(), await b.jsonBlob.text())
  f.doc.links.groups.g.push('missing')
  await assert.rejects(prepareDocumentSheet(f.args), /linked cel member/)
})
test('layout bounds empty-frame expansion before block reads and rejects unsupported data', async () => {
  const f = fixture(256, 1024, 1024)
  await assert.rejects(prepareDocumentSheet(f.args), /4096/); assert.equal(f.read.length, 0)
  assert.deepEqual(documentSheetLayout(fixture(16,1024,1024).doc), { columns:4, rows:4, width:4096, height:4096 })
  assert.deepEqual(documentSheetLayout(fixture(20,1024,32).doc), { columns:4, rows:5, width:4096, height:160 })
  const texted = fixture(2)
  texted.doc.text_objects = { version: 1, items: [{ id: 't', frame_id: 'f0', layer_id: 'base', text: 'Hi', x: 0, y: 0, size: 8, font: { kind: 'generic', name: 'sans-serif' }, bold: false, italic: false, antialias: false, mode: 'fill', stroke_width: 1, color: '#ff0000ff' }] }
  assert.doesNotThrow(() => documentSheetLayout(texted.doc))
  f.doc.color.alpha='premultiplied'; assert.throws(()=>documentSheetLayout(f.doc),/cannot be exported/)
  const version=fixture(); version.doc.version='future'; assert.throws(()=>documentSheetLayout(version.doc),/cannot be exported/)
  await assert.rejects(savedSheetPng(4097,1,new Uint8Array(4097*4)),/verified/)
})
test('read failure and corrupt blocks produce no result, without retries', async () => {
  const f = fixture(); let calls=0
  f.api.getBlock=async()=>{calls++;throw Error('Block unavailable')}
  await assert.rejects(prepareDocumentSheet(f.args),/Block unavailable/); assert.equal(calls,1)
  const bad = fixture(); bad.api.getBlock=async()=>({width:2,height:1,sha256:bad.doc.cels['f0-base'].block.sha256,bytes:new Uint8Array(8)})
  await assert.rejects(prepareDocumentSheet(bad.args),/could not be verified/)
})
test('changed saved revision or manifest hash rejects the whole export', async () => {
  for (const change of ['revision','hash']) {
    const f=fixture(), get=f.api.getDocument; let reads=0
    f.api.getDocument=async()=>{const r=await get();if(++reads===2){if(change==='revision'){r.revision++;r.document.revision++}else r.manifest_sha256='f'.repeat(64)}return r}
    await assert.rejects(prepareDocumentSheet(f.args),/changed/);assert.equal(reads,2)
  }
  const f=fixture();await assert.rejects(prepareDocumentSheet({...f.args,expectedRevision:3}),/changed/);assert.equal(f.read.length,0)
})
test('local cancellation or target change drops a late response and stops further reads', async () => {
  const f=fixture(), get=f.api.getBlock;let live=true
  f.api.getBlock=async(...args)=>{const r=await get(...args);live=false;return r}
  await assert.rejects(prepareDocumentSheet({...f.args,isCurrent:()=>live}),/changed/);assert.equal(f.read.length,1)
})
test('256 frames and 32 empty layers export with bounded per-frame structure checks', async () => {
  const f=fixture(256,16,16)
  for(let i=2;i<32;i++) {
    const id=`layer${i}`;f.doc.layer_order.push(id);f.doc.layers[id]={id,name:id,kind:'raster',visible:true,locked:false}
    for(const frame_id of f.doc.frame_order){const cel=`${frame_id}-${id}`;f.doc.cels[cel]={id:cel,frame_id,layer_id:id,block:null}}
  }
  const out=await prepareDocumentSheet(f.args)
  assert.deepEqual([out.metadata.image.width,out.metadata.image.height],[256,256]);assert.equal(out.metadata.frames.length,256);assert.equal(f.read.length,0)
})
test('tag-filtered sheet export slices only the selected tag frame range, recomputes layout, and emits matching tag and frame metadata', async () => {
  const f = fixture(4, 2, 1)
  f.doc.tags = [
    { id: 'tag_idle', name: 'Idle', from_frame_id: 'f0', to_frame_id: 'f0', direction: 'forward' },
    { id: 'tag_run', name: 'Run Cycle', from_frame_id: 'f1', to_frame_id: 'f2', direction: 'pingpong' },
  ]
  const allOut = await prepareDocumentSheet(f.args)
  assert.equal(allOut.metadata.frames.length, 4)
  assert.deepEqual(allOut.metadata.tags.map(t => [t.id, t.from, t.to, t.direction]), [
    ['tag_idle', 0, 0, 'forward'],
    ['tag_run', 1, 2, 'pingpong'],
  ])
  f.read.length = 0
  const runOut = await prepareDocumentSheet({ ...f.args, tagId: 'tag_run' })
  assert.equal(runOut.pngFilename, 'hero_a-Run_Cycle-sheet-r4.png')
  assert.equal(runOut.jsonFilename, 'hero_a-Run_Cycle-sheet-r4.json')
  assert.equal(runOut.metadata.source.tag_id, 'tag_run')
  assert.equal(runOut.metadata.source.tag_name, 'Run Cycle')
  assert.deepEqual(runOut.metadata.layout, { columns: 2, rows: 1, order: 'row-major', padding: 0, spacing: 0 })
  assert.deepEqual(runOut.metadata.frames.map(x => [x.id, x.index, x.x, x.y, x.w, x.h, x.duration_ms]), [
    ['f1', 0, 0, 0, 2, 1, 140],
    ['f2', 1, 2, 0, 2, 1, 0],
  ])
  assert.deepEqual(runOut.metadata.tags, [{
    id: 'tag_run',
    name: 'Run Cycle',
    from: 0,
    to: 1,
    from_frame_id: 'f1',
    to_frame_id: 'f2',
    direction: 'pingpong',
  }])
  const raw = decodePngToRgba(Buffer.from(await runOut.pngBlob.arrayBuffer())).rgba
  assert.deepEqual([...raw], [78, 115, 102, 23, 20, 90, 170, 0, 79, 115, 102, 23, 20, 90, 170, 0])
  assert.equal(f.read.length, 2, 'only blocks in the selected tag range are read')
  await assert.rejects(prepareDocumentSheet({ ...f.args, tagId: 'tag_missing' }), /changed/)
})
