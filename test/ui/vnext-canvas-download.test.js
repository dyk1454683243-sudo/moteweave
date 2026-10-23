import test from 'node:test'
import assert from 'node:assert/strict'
import { selectedCanvasPng, savedPixelsPng } from '../../src/ui/vnext/vnext-canvas-download.js'
import { decodePngToRgba } from '../../src/editor-project/spriteDocumentStore.js'
test('PNG uses native canvas dimensions and pixels, not zoomed stage or JPEG bytes', async () => {
  const calls = [], pixels = {}, decoded = {}, context = { drawImage: (...args) => calls.push(args) }
  const output = { getContext: () => context, toBlob: (done, mime) => done(new Blob(['pixels'], { type: mime })) }
  const options = { createCanvas: () => output, loadImage: async () => decoded }
  const result = await selectedCanvasPng({ width: 64, height: 32, preview: pixels, name: 'Forest/guard.jpg' }, options)
  assert.equal(result.blob.type, 'image/png'); assert.equal(result.filename, 'Forest_guard.png')
  assert.deepEqual([output.width, output.height], [64, 32]); assert.equal(context.imageSmoothingEnabled, false)
  assert.deepEqual(calls[0], [pixels, 0, 0, 64, 32])
  await selectedCanvasPng({ width: 2, height: 3, previewUrl: '/image.jpg' }, options)
  assert.equal(calls[1][0], decoded)
  await assert.rejects(selectedCanvasPng(null, options))
  await assert.rejects(selectedCanvasPng({ width: 64, height: 64, transient: true, preview: pixels }, options))
})
test('saved RGBA PNG preserves low-alpha and transparent RGB without Canvas roundtrip', async () => {
  const bytes=new Uint8Array([77,115,102,1,77,115,102,23,20,90,170,0,1,2,3,255])
  const {blob}=await selectedCanvasPng({width:2,height:2,preview:{},name:'Text'}, {
    loadPixels:async()=>bytes, createCanvas:()=>{throw new Error('must not use Canvas')},
  })
  assert.equal(blob.type,'image/png')
  const decoded=decodePngToRgba(Buffer.from(await blob.arrayBuffer()))
  assert.deepEqual([...decoded.rgba],[...bytes])
  await assert.rejects(savedPixelsPng(2,2,new Uint8Array(4)),/verified/)
  await assert.rejects(savedPixelsPng(4097,1,new Uint8Array(4097*4)),/verified/)
  await assert.rejects(selectedCanvasPng({width:2,height:2,preview:{}},{loadPixels:async()=>{throw new Error('read failed')}}),/read failed/)
})
