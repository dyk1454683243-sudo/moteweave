import test from 'node:test'
import assert from 'node:assert/strict'
import { createPixelStroke, createPixelFill, createPixelLine, createPixelRectangle, createPixelText, pixelWriteReceipt } from '../../src/ui/vnext/vnext-manual-pixels.js'
import { pixelTextBounds, pixelTextFits, pixelTextLineStep } from '../../src/editor-project/pixelDrawingTools.js'
import { textPlacementFits } from '../../src/ui/vnext/vnext-text-objects.js'
import { createVnextProjectClient } from '../../src/ui/vnext/vnext-project-client.js'
import { copyPixelPattern } from '../../src/editor-project/pixelDrawingTools.js'

const source = () => ({ width: 8, height: 8, rgba: new Uint8Array(8 * 8 * 4) })
const pattern = () => ({ width: 3, height: 2, rgba: new Uint8Array([
  200,10,20,255, 1,2,3,0, 30,40,200,128,
  0,0,0,0, 10,200,30,255, 40,20,10,64,
]) })
test('pattern brush freezes exact sample colors, skips transparent holes and keeps rectangular anchors', () => {
  const p = pattern(), s = source(); s.rgba.fill(99)
  const expected = s.rgba.slice(), stroke = createPixelStroke(s, [9,9,9,9], { shape: 'pattern', pattern: p })
  for (let y = 0; y < 2; y++) for (let x = 0; x < 3; x++) {
    const i = (y * 3 + x) * 4
    if (p.rgba[i + 3]) expected.set(p.rgba.slice(i, i + 4), ((3 + y) * 8 + 2 + x) * 4)
  }
  p.rgba.fill(0); stroke.point({x:3,y:3}); stroke.point({x:3,y:3})
  assert.deepEqual(stroke.bytes, expected); assert.ok(s.rgba.every(v => v === 99))
  assert.equal(stroke.changed, true)
})
test('pattern brush clips at edges, breaks outside, and erases only its nontransparent mask', () => {
  const p = pattern(), s = source(); s.rgba.fill(255)
  const stroke = createPixelStroke(s, [9,9,9,9], { shape: 'pattern', pattern: p, erase: true })
  stroke.point({x:0,y:0}); stroke.point(null); stroke.point({x:7,y:7})
  const expected = s.rgba.slice()
  for (const [x,y] of [[1,0],[0,1],[1,1],[6,7]]) expected.set([0,0,0,0], (y * 8 + x) * 4)
  assert.deepEqual(stroke.bytes, expected)
})
test('pattern snapshots reject empty/oversized/malformed samples and own their pixel bytes', () => {
  const p = pattern(), saved = copyPixelPattern(p); p.rgba.fill(0); assert.equal(saved.rgba[0], 200)
  for (const bad of [null, p, {...saved,width:65}, {...saved,height:0}, {...saved,rgba:new Uint8Array(2)}, {...saved,rgba:[...saved.rgba]}]) assert.throws(() => copyPixelPattern(bad))
  assert.throws(() => createPixelStroke(source(), [0,0,0,0], {shape:'pattern'}))
  const max = copyPixelPattern({width:64,height:64,rgba:new Uint8Array(64*64*4).fill(128)})
  assert.equal(max.rgba.length, 16384)
})
test('brush sizes and hard round/square masks use exact RGBA with stable odd/even anchors', () => {
  for (const size of [1, 2, 3, 4, 5, 64]) for (const shape of ['square', 'round']) {
    const s = { width: 80, height: 80, rgba: new Uint8Array(80 * 80 * 4) }, ink = [12, 34, 56, 128]
    const options = { size, shape }, stroke = createPixelStroke(s, ink, options)
    options.size = 1; ink[0] = 99
    stroke.point({ x: 38, y: 38 }); stroke.point({ x: 38, y: 38 })
    const offset = Math.floor((size - 1) / 2), expected = new Uint8Array(s.rgba.length)
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      if (shape === 'square' || (x - (size - 1) / 2) ** 2 + (y - (size - 1) / 2) ** 2 <= size * size / 4) {
        expected.set([12, 34, 56, 128], ((38 + y - offset) * s.width + 38 + x - offset) * 4)
      }
    }
    assert.deepEqual(stroke.bytes, expected); assert.ok(s.rgba.every(v => v === 0))
  }
})
test('large brushes clip at edges, break outside and retain transparent paint without overlap buildup', () => {
  const s = source(), stroke = createPixelStroke(s, [9, 8, 7, 0], { size: 3, shape: 'square' })
  stroke.point({ x: 0, y: 0 }); stroke.point({ x: -1, y: 0 }); stroke.point({ x: 7, y: 7 })
  for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1], [6, 6], [7, 6], [6, 7], [7, 7]]) {
    assert.deepEqual([...stroke.bytes.slice((y * 8 + x) * 4, (y * 8 + x) * 4 + 4)], [9, 8, 7, 0])
  }
  assert.equal(stroke.bytes.filter((v, i) => i % 4 === 0 && v === 9).length, 8)
  const painted = { ...s, rgba: new Uint8Array(s.rgba.length).fill(255) }, eraser = createPixelStroke(painted, [0, 0, 0, 0], { size: 5, shape: 'round' })
  eraser.point({ x: 3, y: 3 }); assert.deepEqual([...eraser.bytes.slice(108, 112)], [0, 0, 0, 0])
  const ink = createPixelStroke(s, [1, 2, 3, 128], { size: 3 })
  ink.point({ x: 1, y: 2 }); ink.point({ x: 6, y: 2 }); ink.point({ x: 1, y: 2 })
  assert.equal(ink.bytes[3 * 4 + 2 * 8 * 4 + 3], 128)
})
test('brush rejects invalid options and keeps the default one-pixel behavior', () => {
  for (const options of [{ size: 0 }, { size: 65 }, { size: 1.5 }, { size: NaN }, { size: '3' }, { shape: 'triangle' }]) {
    assert.throws(() => createPixelStroke(source(), [1, 2, 3, 4], options), /brush/)
  }
  const stroke = createPixelStroke(source(), [1, 2, 3, 4]); stroke.point({ x: 2, y: 3 })
  assert.equal(stroke.bytes.filter((v, i) => i % 4 === 3 && v === 4).length, 1)
})
test('rectangle draws a one-pixel hollow border for all drag directions and replaces previews', () => {
  for (const [a,b] of [[{x:1,y:1},{x:6,y:5}],[{x:6,y:5},{x:1,y:1}],[{x:1,y:5},{x:6,y:1}],[{x:6,y:1},{x:1,y:5}]]) {
    const s=source(),r=createPixelRectangle(s,[1,2,3,255],a),expected=new Uint8Array(s.rgba.length),buffer=r.bytes
    r.point({x:7,y:7}); r.point(b)
    for(let y=1;y<=5;y++)for(let x=1;x<=6;x++)if(y===1||y===5||x===1||x===6)expected.set([1,2,3,255],(y*8+x)*4)
    assert.deepEqual(r.bytes,expected);assert.equal(r.bytes,buffer);assert.equal(r.changed,true);assert.ok(s.rgba.every(v=>v===0))
  }
})
test('rectangle supports degenerate lines/points, no-op, frozen inputs, outside clear and re-entry', () => {
  const s=source(),a={x:2,y:2},color=[2,3,4,0],r=createPixelRectangle(s,color,a)
  a.x=7;color[0]=99;r.point({x:2,y:5})
  for(let y=2;y<=5;y++)assert.deepEqual([...r.bytes.slice((y*8+2)*4,(y*8+2)*4+4)],[2,3,4,0])
  r.point({x:5,y:2});assert.equal(r.bytes.filter((v,i)=>i%4===0&&v===2).length,4)
  r.point({x:2,y:2});assert.equal(r.bytes.filter((v,i)=>i%4===0&&v===2).length,1)
  const same=createPixelRectangle({...s,rgba:r.bytes},[2,3,4,0],{x:2,y:2});same.point({x:2,y:2});assert.equal(same.changed,false)
  for(const p of [null,{x:NaN,y:0},{x:8,y:2},{x:-1,y:2},{x:2.2,y:2}]){r.point(p);assert.equal(r.changed,false)}
  r.point({x:2,y:3});assert.equal(r.changed,true)
})
test('rectangle maximum perimeter is bounded and never fills its interior', () => {
  const s={width:1024,height:1024,rgba:new Uint8Array(1024*1024*4)},r=createPixelRectangle(s,[1,2,3,255],{x:0,y:0})
  r.point({x:1023,y:1023});assert.equal(r.bytes.filter((v,i)=>i%4===3&&v===255).length,4092)
  r.point({x:1e9,y:1e9});assert.equal(r.changed,false)
})
function textCanvas(width=32,height=32,metrics={width:5,actualBoundingBoxLeft:0,actualBoundingBoxRight:5,actualBoundingBoxAscent:5,actualBoundingBoxDescent:0}) {
  const mask=new Uint8ClampedArray(width*height*4),calls=[]
  mask[3]=127;mask[7]=128;mask[11]=255
  const ctx={measureText:()=>metrics,fillText:(...args)=>calls.push(args),strokeText:(...args)=>calls.push(['stroke',...args]),getImageData:()=>({data:mask})}
  return {ctx,calls,make:()=>({getContext:()=>ctx})}
}
test('text bounds follow measured glyph width instead of a 0.7em estimate', () => {
  const cjk = pixelTextBounds({ x: 1, y: 2 }, '中文', 16, {}, textCanvas(64, 48, { width: 32, actualBoundingBoxLeft: 0, actualBoundingBoxRight: 32, actualBoundingBoxAscent: 14, actualBoundingBoxDescent: 2 }).make)
  assert.ok(cjk.w > Math.ceil(2 * 16 * 0.7))
  assert.ok(cjk.x + cjk.w >= 1 + 32)
  const mixed = pixelTextBounds({ x: 0, y: 0 }, 'A中', 16, {}, textCanvas(64, 48, { width: 24, actualBoundingBoxLeft: 0, actualBoundingBoxRight: 24, actualBoundingBoxAscent: 14, actualBoundingBoxDescent: 2 }).make)
  assert.ok(mixed.w >= 24)
  const lines = pixelTextBounds({ x: 0, y: 0 }, '中文\nHi', 16, {}, textCanvas(64, 64, { width: 32, actualBoundingBoxLeft: 0, actualBoundingBoxRight: 32, actualBoundingBoxAscent: 14, actualBoundingBoxDescent: 2 }).make)
  assert.ok(lines.h >= 16 + Math.ceil(16 * 1.25))
})
test('stroke text line step matches the drawn second line, not a fill-only estimate', () => {
  const metrics = { width: 32, actualBoundingBoxLeft: 0, actualBoundingBoxRight: 32, actualBoundingBoxAscent: 14, actualBoundingBoxDescent: 2 }
  for (const mode of ['stroke', 'both']) {
    const fake = textCanvas(96, 96, metrics)
    const bounds = pixelTextBounds({ x: 2, y: 2 }, '中文\n文', 16, { mode, strokeWidth: 8 }, fake.make)
    assert.equal(bounds.step, 28)
    assert.equal(pixelTextLineStep(16, { mode, strokeWidth: 8 }), bounds.step)
    fake.calls.length = 0
    createPixelText({ width: 96, height: 96, rgba: new Uint8Array(96 * 96 * 4) }, [1, 2, 3, 255], { x: 2, y: 2 }, '中文\n文', 16, fake.make, { mode, strokeWidth: 8 })
    const drawn = fake.calls.filter(call => call[0] === 'stroke')
    assert.equal(drawn[1][3] - drawn[0][3], 28)
  }
})
test('text raster uses exact paint RGBA above alpha threshold and preserves source', () => {
  const s={width:32,height:32,rgba:new Uint8Array(4096)},fake=textCanvas(),color=[8,9,10,40]
  const r=createPixelText(s,color,{x:1,y:2},'守\nA',8,fake.make)
  assert.equal(fake.ctx.font,'8px sans-serif');assert.deepEqual(fake.calls,[['守',1,10],['A',1,20]])
  assert.deepEqual([...r.bytes.slice(0,12)],[0,0,0,0,...color,...color]);assert.equal(r.changed,true)
  assert.ok(s.rgba.every(v=>v===0))
  assert.equal(createPixelText({...s,rgba:r.bytes},color,{x:1,y:2},'守\nA',8,fake.make).changed,false)
})
test('text keeps style/input limits but permits coordinates beyond the canvas', () => {
  const s={width:32,height:32,rgba:new Uint8Array(4096)},fake=textCanvas()
  for(const size of [5,97,8.5,NaN])assert.throws(()=>createPixelText(s,[1,2,3,4],{x:1,y:1},'A',size,fake.make))
  for(const text of ['x'.repeat(161),'a\nb\nc\nd\ne',null])assert.throws(()=>createPixelText(s,[1,2,3,4],{x:1,y:1},text,8,fake.make))
  for (const start of [{x:30,y:1},{x:1,y:30},{x:-1,y:1},{x:64,y:-64}]) assert.doesNotThrow(()=>createPixelText(s,[1,2,3,4],start,'A',8,fake.make))
  for (const x of [NaN,Infinity,0.5,Number.MAX_SAFE_INTEGER+1]) assert.throws(()=>createPixelText(s,[1,2,3,4],{x,y:1},'A',8,fake.make),/coordinates/)
  assert.equal(createPixelText(s,[1,2,3,4],{x:1,y:1},' \n ',8,()=>{throw Error('should not raster')}).changed,false)
})
test('text compensates glyph bearings and leaves clipping to the fixed canvas', () => {
  const s={width:32,height:32,rgba:new Uint8Array(4096)},fake=textCanvas(32,32,{width:5,actualBoundingBoxLeft:2,actualBoundingBoxRight:8,actualBoundingBoxAscent:10,actualBoundingBoxDescent:3})
  createPixelText(s,[1,2,3,4],{x:1,y:2},'A',8,fake.make);assert.deepEqual(fake.calls,[['A',3,12]])
  fake.calls.length=0
  createPixelText(s,[1,2,3,4],{x:24,y:2},'A',8,fake.make);assert.deepEqual(fake.calls,[['A',26,12]])
  assert.throws(()=>createPixelText(s,[1,2,3,4],{x:1,y:2},'A',8,()=>({getContext:()=>null})),/unavailable/)
})
test('text binds validated family, styles, stroke mode and accounts for stroke overflow', () => {
  const s={width:32,height:32,rgba:new Uint8Array(4096)},fake=textCanvas()
  createPixelText(s,[1,2,3,255],{x:1,y:1},'A',8,fake.make,{family:'GameToolFont1',bold:true,italic:true,mode:'both',strokeWidth:4})
  assert.equal(fake.ctx.font,'italic bold 8px GameToolFont1');assert.equal(fake.ctx.lineWidth,4)
  assert.deepEqual(fake.calls,[['stroke','A',3,11],['A',3,11]])
  fake.calls.length=0
  createPixelText(s,[1,2,3,255],{x:1,y:1},'A',8,fake.make,{mode:'stroke'})
  assert.equal(fake.calls.length,1);assert.equal(fake.calls[0][0],'stroke')
  assert.doesNotThrow(()=>createPixelText(s,[1,2,3,255],{x:26,y:1},'A',8,fake.make,{mode:'stroke',strokeWidth:2}))
  for(const options of [{family:'url(https://example.org/a)'},{family:'Arial'},{mode:'bad'},{strokeWidth:0},{strokeWidth:9},{bold:1},{antialias:'yes'}]) {
    assert.throws(()=>createPixelText(s,[1,2,3,255],{x:1,y:1},'A',8,fake.make,options),/Invalid text style/)
  }
})
test('text anti-alias uses coverage with exact full-coverage replacement, including transparent paint', () => {
  const s={width:32,height:32,rgba:new Uint8Array(4096)},fake=textCanvas(),ink=[20,30,40,255]
  const r=createPixelText(s,ink,{x:1,y:1},'A',8,fake.make,{antialias:true})
  assert.deepEqual([...r.bytes.slice(0,12)],[20,30,40,127,20,30,40,128,...ink])
  const opaque={...s,rgba:s.rgba.map((v,i)=>i%4===3?255:100)}
  const erased=createPixelText(opaque,[0,0,0,0],{x:1,y:1},'A',8,fake.make,{antialias:true})
  assert.deepEqual([...erased.bytes.slice(0,12)],[100,100,100,128,100,100,100,127,0,0,0,0])
  assert.equal(opaque.rgba[0],100);assert.equal(opaque.rgba[3],255)
})
test('text rejects non-finite font metrics before any raster drawing', () => {
  const s={width:32,height:32,rgba:new Uint8Array(4096)},fake=textCanvas(32,32,{width:5,actualBoundingBoxLeft:NaN,actualBoundingBoxRight:5,actualBoundingBoxAscent:5,actualBoundingBoxDescent:0})
  assert.throws(()=>createPixelText(s,[1,2,3,255],{x:1,y:1},'A',8,fake.make),/measured safely/)
  assert.equal(fake.calls.length,0)
})
test('line replaces old previews, freezes start and color, and reuses one candidate buffer', () => {
  const s = source(), start = {x:1,y:1}, color = [1,2,3,255], line = createPixelLine(s,color,start), buffer=line.bytes
  start.x=7; color[0]=200
  line.point({x:6,y:6}); line.point({x:6,y:1})
  const expected=new Uint8Array(s.rgba.length)
  for(let x=1;x<=6;x++)expected.set([1,2,3,255],(8+x)*4)
  assert.deepEqual(line.bytes,expected); assert.equal(line.bytes,buffer); assert.equal(line.changed,true)
  assert.ok(s.rgba.every(v=>v===0))
})
test('line covers horizontal, vertical, diagonal, shallow, steep and reversed endpoints', () => {
  const cases=[[[1,2],[5,2],[[1,2],[2,2],[3,2],[4,2],[5,2]]],[[2,5],[2,1],[[2,1],[2,2],[2,3],[2,4],[2,5]]],
    [[5,5],[1,1],[[1,1],[2,2],[3,3],[4,4],[5,5]]],[[1,1],[5,3],[[1,1],[2,2],[3,2],[4,3],[5,3]]],
    [[1,1],[3,5],[[1,1],[2,2],[2,3],[3,4],[3,5]]],[[5,1],[1,5],[[5,1],[4,2],[3,3],[2,4],[1,5]]]]
  for(const [a,b,points] of cases){
    const s=source(),line=createPixelLine(s,[8,9,10,255],{x:a[0],y:a[1]}),expected=new Uint8Array(s.rgba.length)
    line.point({x:b[0],y:b[1]}); for(const [x,y] of points)expected.set([8,9,10,255],(y*8+x)*4)
    assert.deepEqual(line.bytes,expected)
  }
})
test('line outside clears candidate without clamping; re-entry keeps original anchor', () => {
  const s=source(),line=createPixelLine(s,[2,3,4,255],{x:1,y:1})
  for(const p of [null,{x:8,y:1},{x:1,y:-1},{x:NaN,y:1},{x:1.5,y:1}]){
    line.point({x:6,y:6});line.point(p);assert.equal(line.changed,false);assert.deepEqual(line.bytes,s.rgba)
  }
  line.point({x:1,y:3});const expected=new Uint8Array(s.rgba.length)
  for(let y=1;y<=3;y++)expected.set([2,3,4,255],(y*8+1)*4)
  assert.deepEqual(line.bytes,expected)
  const invalid=createPixelLine(s,[2,3,4,255],{x:99,y:0});invalid.point({x:1,y:1});assert.equal(invalid.changed,false)
})
test('line supports one-pixel clicks, exact transparent RGBA, and same-color no-op', () => {
  const s=source(),line=createPixelLine(s,[5,6,7,0],{x:2,y:2})
  line.point({x:2,y:2});assert.equal(line.changed,true);assert.deepEqual([...line.bytes.slice(72,76)],[5,6,7,0])
  const same=createPixelLine({...s,rgba:line.bytes},[5,6,7,0],{x:2,y:2});same.point({x:2,y:2});assert.equal(same.changed,false)
  assert.throws(()=>createPixelLine(s,[0,0,0,256],{x:0,y:0}))
})
test('line handles maximum supported dimensions and large invalid endpoints without unbounded work', () => {
  const s={width:1024,height:1024,rgba:new Uint8Array(1024*1024*4)},line=createPixelLine(s,[1,2,3,255],{x:0,y:0})
  line.point({x:1023,y:1023});assert.equal(line.bytes.filter((v,i)=>i%4===3&&v===255).length,1024)
  line.point({x:1e9,y:1e9});assert.equal(line.changed,false)
})
test('fill visits only four-connected exact-color pixels, not diagonal or disconnected regions', () => {
  const mask = ['00100', '01110', '11111', '00100', '00100']
  const rgba = Uint8Array.from(mask.flatMap(row => [...row].flatMap(v => [Number(v), 0, 0, 255])))
  const s = { width:5, height:5, rgba }, before = rgba.slice()
  const result = createPixelFill(s, [12,34,56,255], {x:0,y:0})
  const expected = before.slice()
  for (const [x,y] of [[0,0],[1,0],[0,1]]) expected.set([12,34,56,255], (y*5+x)*4)
  assert.equal(result.changed,true); assert.deepEqual(result.bytes,expected); assert.deepEqual(rgba,before)
})
test('fill compares hidden RGB and alpha exactly, and can fill with transparent RGBA', () => {
  const s = {width:4,height:1,rgba:Uint8Array.from([8,9,10,0, 8,9,10,0, 0,0,0,0, 8,9,10,1])}
  const result = createPixelFill(s,[0,0,0,0],{x:0,y:0})
  assert.deepEqual([...result.bytes],[0,0,0,0, 0,0,0,0, 0,0,0,0, 8,9,10,1])
  assert.deepEqual([...s.rgba.slice(0,4)],[8,9,10,0])
})
test('fill rejects malformed buffers and treats same color or out-of-image seeds as no-op', () => {
  const s = source()
  for (const seed of [null,{x:-1,y:0},{x:8,y:0},{x:0,y:8},{x:0.5,y:0},{x:NaN,y:0}]) {
    const result = createPixelFill(s,[1,2,3,4],seed)
    assert.equal(result.changed,false); assert.deepEqual(result.bytes,s.rgba)
  }
  assert.equal(createPixelFill(s,[0,0,0,0],{x:0,y:0}).changed,false)
  assert.throws(() => createPixelFill({...s,width:1025},[0,0,0,0],{x:0,y:0}))
  assert.throws(() => createPixelFill(s,[0,0,0,256],{x:0,y:0}))
})
test('fill processes the maximum supported image without recursion or queue overflow', () => {
  const s = {width:1024,height:1024,rgba:new Uint8Array(1024*1024*4)}
  const result = createPixelFill(s,[1,2,3,4],{x:1023,y:1023})
  assert.equal(result.changed,true)
  assert.ok(result.bytes.every((value,i) => value === i%4+1))
  assert.ok(s.rgba.every(value => value === 0))
})
test('one-pixel stroke interpolates diagonal, horizontal and vertical moves without modifying source', () => {
  const s = source(), color = [1, 2, 3, 255], stroke = createPixelStroke(s, color)
  stroke.point({ x: 0, y: 0 }); stroke.point({ x: 3, y: 3 }); stroke.point({ x: 7, y: 3 }); stroke.point({ x: 7, y: 7 })
  const expected = new Uint8Array(s.rgba.length)
  for (const [x, y] of [[0,0],[1,1],[2,2],[3,3],[4,3],[5,3],[6,3],[7,3],[7,4],[7,5],[7,6],[7,7]]) expected.set(color, (y * 8 + x) * 4)
  assert.deepEqual(stroke.bytes, expected); assert.equal(stroke.changed, true)
  assert.ok(s.rgba.every(v => v === 0))
})
test('outside and non-integer coordinates break the stroke, never clamp or bridge across re-entry', () => {
  const stroke = createPixelStroke(source(), [8, 9, 10, 255])
  stroke.point({ x: 1, y: 1 }); stroke.point({ x: 1e9, y: 5 }); stroke.point({ x: 5, y: 1 })
  stroke.point({ x: 1.5, y: 3 }); stroke.point({ x: 5, y: 5 })
  assert.equal(stroke.bytes.filter((v,i) => i % 4 === 3 && v === 255).length, 3)
})
test('transparent eraser is exact RGBA and unchanged strokes are no-op', () => {
  const s = source(), noop = createPixelStroke(s, [0,0,0,0])
  noop.point({ x: 2, y: 2 }); assert.equal(noop.changed, false)
  s.rgba.fill(255)
  const eraser = createPixelStroke(s, [0,0,0,0]); eraser.point({x:2,y:2})
  assert.deepEqual([...eraser.bytes.slice(72,76)], [0,0,0,0]); assert.ok(s.rgba.every(v => v === 255))
  assert.throws(() => createPixelStroke(s, [256,0,0,255]))
  assert.throws(() => createPixelStroke({ ...s, rgba: new Uint8Array(2) }, [0,0,0,255]))
})
test('pixel receipts check exact operation and document but allow newer project and non-contiguous document revisions', () => {
  const req = { operationId: 'op', expectedRevision: 5, expectedWorkingRevision: 2 }
  const valid = { project: { id:'p', revision:9 }, document:{document_id:'d',revision:8},
    receipt: { operation_id:'op',project_id:'p',document_id:'d',project_revision:6,document_revision:8 } }
  assert.equal(pixelWriteReceipt(valid,req,'p','d'),8)
  for (const change of [{operation_id:'other'},{document_id:'other'},{project_revision:7},{document_revision:2}]) {
    assert.throws(() => pixelWriteReceipt({...valid,receipt:{...valid.receipt,...change}},req,'p','d'), {kind:'unknown'})
  }
})
test('client restores an existing revision through the narrow restore-working route', async () => {
  const calls = []
  const client = createVnextProjectClient({ fetchImpl: async (url,options) => {
    calls.push({url,...options}); return {ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>({receipt:{operation_id:'op'}})}
  } })
  await client.restoreWorking('p','d',{operationId:'op',expectedRevision:5,expectedWorkingRevision:8,targetRevision:2})
  assert.equal(calls.length,1); assert.equal(calls[0].url,'/api/editor/projects/p/sprite-documents/d/restore-working')
  assert.deepEqual(JSON.parse(calls[0].body),{operation_id:'op',expected_revision:5,expected_working_revision:8,target_revision:2})
})
test('geometric fit is informational and does not prevent clipped rasterization', () => {
  const metrics = { width: 5, actualBoundingBoxLeft: 0, actualBoundingBoxRight: 5, actualBoundingBoxAscent: 14, actualBoundingBoxDescent: 2 }
  const make = textCanvas(64, 64, metrics).make
  const item = { text: 'Hi', x: 0, y: 0, size: 16, bold: false, italic: false, mode: 'fill', stroke_width: 1, font: { kind: 'generic', name: 'sans-serif' } }
  assert.equal(textPlacementFits({ ...item, x: 30, y: 30 }, 32, 32, 'sans-serif', make), false)
  assert.equal(textPlacementFits(item, 64, 64, 'sans-serif', make), true)
  const edge = { ...item, x: 0, y: 14 }
  const box = pixelTextBounds({ x: edge.x, y: edge.y }, edge.text, edge.size, { family: 'sans-serif' }, make)
  assert.equal(box.y + box.h > 32, true)
  assert.equal(textPlacementFits(edge, 32, 32, 'sans-serif', make), true)
  assert.equal(pixelTextFits({ x: edge.x, y: edge.y }, edge.text, edge.size, 32, 32, { family: 'sans-serif' }, make), true)
  const source = { width: 32, height: 32, rgba: new Uint8Array(32 * 32 * 4) }
  assert.doesNotThrow(() => createPixelText(source, [1, 2, 3, 255], { x: edge.x, y: edge.y }, edge.text, edge.size, make))
  const stroked = { ...item, text: 'Hi\nYo', mode: 'stroke', stroke_width: 8, y: 0 }
  assert.equal(textPlacementFits(stroked, 32, 32, 'sans-serif', make), false)
  assert.doesNotThrow(() => createPixelText(source, [1, 2, 3, 255], { x: 0, y: 0 }, stroked.text, 16, make, { mode: 'stroke', strokeWidth: 8 }))
  assert.equal(textPlacementFits(stroked, 96, 96, 'sans-serif', make), true)
})
