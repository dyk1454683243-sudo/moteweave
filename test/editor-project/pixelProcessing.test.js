import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { documentHash } from '../../src/editor-project/documentToolSession.js'
import { processPixels } from '../../src/editor-project/pixelProcessingWorker.js'
import { runPixelProcessing, validatePixelProcessing } from '../../src/editor-project/pixelProcessing.js'
import { createDocumentAssistant } from '../../src/editor-project/documentAssistant.js'
import { pixelProcessingResultCopy } from '../../src/ui/vnext/vnext-pixel-processing.js'

function fixture({ frames = 1, otherLayer = false } = {}) {
  const w = 64, h = 64, bytes = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = (Math.floor(x / 4) + Math.floor(y / 4)) % 2 ? 0 : 255
    bytes.set([c,c,c,255], (y*w+x)*4)
  }
  const sha256 = documentHash(bytes), manifest = { document_id: 'd', revision: 1, canvas: { w,h }, frame_order: [], layer_order: ['l'], frames: {},
    layers: { l: { id: 'l', name: 'Pixels', kind: 'raster', visible: true, locked: false } }, cels: {}, tags: [], anchors: [] }
  if (otherLayer) { manifest.layer_order.unshift('locked'); manifest.layers.locked = { id: 'locked', name: 'Keep', kind: 'raster', visible: true, locked: true } }
  for (let i=0;i<frames;i++) {
    const f = `f${i}`; manifest.frame_order.push(f); manifest.frames[f] = { id: f, duration_ms: 100 + i*20 }
    for (const l of manifest.layer_order) { const id = `${f}_${l}`; manifest.cels[id] = { id, frame_id: f, layer_id: l, block: { sha256,w,h } } }
  }
  return { manifest, blocks: new Map([[sha256,bytes]]), operation: 'recover-grid', layerId: 'l' }
}
const req = (s, action='read', operation_id=randomUUID()) => ({ action, candidate_id:s.candidate_id, sha256:s.sha256, canvas_id:s.canvas_id,
  document_id:s.document_id, expected_revision:s.project_revision, expected_working_revision:s.working_revision, operation_id })
function service(f, extra={}) {
  const project = { revision: 2, canvases: { c: { document_id:'d' } }, sprite_documents: { d: { working_revision:1 } } }
  return createDocumentAssistant({ load:async()=>({project}), readDocument:async()=>({manifest:f.manifest}), readBlock:async({sha256})=>({bytes:f.blocks.get(sha256)}), ...extra })
}
const body = { canvas_id:'c', expected_revision:2, expected_working_revision:1, operation:'recover-grid', layer_id:'l' }
const scope = { projectId:'test-pixels', workspaceRoot:'/isolated-test' }

test('single and multi-frame production processing preserves source/identities/durations and produces only manual candidates', () => {
  for (const frames of [1,2]) {
    const input=fixture({frames}), original=structuredClone(input), out=processPixels(input)
    assert.equal(out.available,true); assert.equal(out.processing.verdict,'accepted')
    assert.deepEqual(out.candidate.document.canvas,{w:16,h:16})
    assert.deepEqual(out.candidate.document.frames,input.manifest.frames)
    assert.deepEqual(out.candidate.document.frame_order,input.manifest.frame_order)
    assert.deepEqual(out.candidate.document.layer_order,input.manifest.layer_order)
    assert.deepEqual(input,original)
    if(frames>1) assert.equal(out.processing.motion_verified,false)
  }
})
test('same-size background processing changes only requested unlocked layer and leaves original blocks intact', () => {
  const input=fixture({frames:2,otherLayer:true}); input.operation='remove-background'
  const bytes=input.blocks.values().next().value
  for(let y=0;y<64;y++)for(let x=0;x<64;x++)if(x<8||y<8||x>=56||y>=56)bytes.set([255,255,255,255],(y*64+x)*4)
  const sha256=documentHash(bytes);input.blocks=new Map([[sha256,bytes]])
  for(const c of Object.values(input.manifest.cels))c.block.sha256=sha256
  const original=structuredClone(input),out=processPixels(input)
  assert.equal(out.available,true); assert.deepEqual(out.candidate.document.canvas,input.manifest.canvas)
  for(const f of input.manifest.frame_order) assert.deepEqual(out.candidate.document.cels[`${f}_locked`],input.manifest.cels[`${f}_locked`])
  assert.deepEqual(input,original)
})
test('unsupported topology, protected metadata, oversized document and uncertain grid never create a candidate', () => {
  assert.throws(()=>processPixels(fixture({otherLayer:true})),{code:'unsupported_input'})
  const locked=fixture(); locked.manifest.layers.l.locked=true
  assert.throws(()=>processPixels(locked),{code:'unsupported_input'})
  const big=fixture();big.manifest.canvas={w:2049,h:64}
  assert.throws(()=>validatePixelProcessing(big.manifest,'recover-grid','l'))
  const empty=fixture(); empty.blocks.values().next().value.fill(0)
  const out=processPixels(empty); assert.equal(out.available,false); assert.equal(out.processing.verdict,'undetermined');assert.equal(out.candidate,undefined)
  assert.match(pixelProcessingResultCopy(out.processing),/could not be confirmed/)
})
test('worker is cancellable and single-owner; aborted work never publishes a result', async () => {
  const controller=new AbortController(),pending=runPixelProcessing(fixture({frames:4}),controller.signal)
  await assert.rejects(runPixelProcessing(fixture()),{code:'assistant_busy'})
  controller.abort(); await assert.rejects(pending,{code:'assistant_cancelled'})
  const out=await runPixelProcessing(fixture());assert.equal(out.available,true)
})
test('local service binds current canvas/revision and save identity; discard does not invoke writer', async () => {
  const f=fixture();let writes=0
  const s=service(f,{accept:async()=>{writes++;return{receipt:{}}}})
  const summary=await s.process(scope,body);assert.equal(summary.saved,false)
  const value=await s.candidate(scope,req(summary));assert.equal(value.document.canvas.w,16);assert.equal(writes,0)
  await assert.rejects(s.candidate(scope,{...req(summary),canvas_id:'other'}),{code:'assistant_context_changed'})
  await s.candidate(scope,req(summary,'discard'));assert.equal(writes,0)
  await assert.rejects(s.candidate(scope,req(summary)),{code:'candidate_expired'})
})
test('a source change during loading rejects the candidate without saving', async () => {
  const f=fixture();let reads=0
  const s=service(f,{readDocument:async()=>{reads++; const m=structuredClone(f.manifest); if(reads>1)m.frames.f0.duration_ms=999;return{manifest:m}}})
  await assert.rejects(s.process(scope,body),{code:'assistant_context_changed'})
})
