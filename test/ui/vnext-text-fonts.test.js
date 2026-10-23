import test from 'node:test'
import assert from 'node:assert/strict'
import { validateFontFile, localFontChoices, createTextFontLibrary } from '../../src/ui/vnext/vnext-text-fonts.js'

test('font file extension, byte and page budgets are enforced before reading', () => {
  for (const name of ['a.ttf','a.OTF','a.woff','a.woff2']) validateFontFile({name,size:100},0,0)
  for (const file of [{name:'a.svg',size:2},{name:'a.ttf',size:0},{name:'a.ttf',size:8*1024*1024+1}]) assert.throws(()=>validateFontFile(file,0,0))
  assert.throws(()=>validateFontFile({name:'a.ttf',size:2},8,0),/limit/)
  assert.throws(()=>validateFontFile({name:'a.ttf',size:2},1,32*1024*1024),/limit/)
})
test('local choices keep only bounded safe unique names, never URL sources', () => {
  const result=localFontChoices([{postscriptName:'B',fullName:'Beta'},{postscriptName:'A',fullName:'Alpha'},{postscriptName:'B'},{postscriptName:'bad\nname'}])
  assert.deepEqual(result.map(f=>f.label),['Alpha','Beta']);assert.equal(result[0].local,'A')
  assert.equal(localFontChoices(Array.from({length:3000},(_,i)=>({postscriptName:`Font${i}`}))).length,2048)
})
function host() {
  const installed=new Set(),faces=[]
  class FontFace { constructor(family,source){this.family=family;this.source=source;faces.push(this)} async load(){return this} }
  return {FontFace,document:{fonts:installed},setTimeout,clearTimeout,installed,faces}
}
test('imported font is local binary, only installed after successful load and active request', async () => {
  const h=host(),lib=createTextFontLibrary(h),file={name:'Private.ttf',size:4,arrayBuffer:async()=>new ArrayBuffer(4)}
  const entry=await lib.importFile(file,()=>true)
  assert.match(entry.family,/^GameToolFont\d+$/);assert.equal(h.installed.size,1);assert.ok(h.faces[0].source instanceof ArrayBuffer)
  assert.equal(await lib.importFile(file,()=>false),null);assert.equal(h.installed.size,1)
  let release,active=true
  h.FontFace.prototype.load=function(){return new Promise(r=>{release=()=>r(this)})}
  const pending=lib.importFile(file,()=>active)
  await new Promise(r=>setImmediate(r));active=false
  await assert.rejects(lib.importFile(file,()=>true),/still loading/)
  release();assert.equal(await pending,null);assert.equal(h.installed.size,1)
})
test('timeout never installs a late font or releases its in-flight slot early', async () => {
  const h=host();let timeout,release
  h.setTimeout=callback=>{timeout=callback;return 1};h.clearTimeout=()=>{}
  h.FontFace.prototype.load=function(){return new Promise(r=>{release=()=>r(this)})}
  const lib=createTextFontLibrary(h),file={name:'Held.ttf',size:4,arrayBuffer:async()=>new ArrayBuffer(4)}
  const job=lib.importFile(file,()=>true)
  await new Promise(r=>setImmediate(r));timeout();await assert.rejects(job,/timed out/)
  await assert.rejects(lib.importFile(file,()=>true),/still loading/)
  release();await new Promise(r=>setImmediate(r));assert.equal(h.installed.size,0);assert.equal(lib.imported.length,0)
  assert.equal(await lib.resolve({family:'sans-serif'},()=>true),'sans-serif')
})
test('local fonts stay loaded for existing objects and missing permission is not success', async () => {
  const h=host(),lib=createTextFontLibrary(h)
  await assert.rejects(lib.list(),/unavailable/)
  await lib.resolve({local:'Font "Quoted"'},()=>true)
  assert.equal(h.faces[0].source,'local("Font \\"Quoted\\"")')
  const first = lib.familyFor('Font "Quoted"')
  await lib.resolve({local:'Second'},()=>true)
  assert.equal(h.installed.size,2)
  assert.equal(lib.familyFor('Font "Quoted"'), first)
  assert.equal(await lib.resolve({family:'serif'},()=>true),'serif')
  h.queryLocalFonts=async()=>{throw Object.assign(new Error('denied'),{name:'NotAllowedError'})}
  await assert.rejects(lib.list(),{name:'NotAllowedError'})
  h.queryLocalFonts=async()=>[]
  await assert.rejects(lib.list(),/No system fonts/)
})
test('stalled system font enumeration times out without repeated queries or blocking file import', async () => {
  const h=host();let timeout,release,calls=0
  h.setTimeout=callback=>{timeout=callback;return 1};h.clearTimeout=()=>{}
  h.queryLocalFonts=()=>{calls++;return new Promise(r=>{release=r})}
  const lib=createTextFontLibrary(h),query=lib.list()
  await new Promise(r=>setImmediate(r));timeout();await assert.rejects(query,/System font access timed out/)
  await assert.rejects(lib.list(),/still pending/);assert.equal(calls,1)
  await lib.importFile({name:'Fallback.ttf',size:4,arrayBuffer:async()=>new ArrayBuffer(4)},()=>true)
  assert.equal(h.installed.size,1)
  release([{postscriptName:'Late'}]);await new Promise(r=>setImmediate(r))
  assert.equal(h.installed.size,1)
})
test('same-name imports keep separate local identities and both faces', async () => {
  const h=host(),lib=createTextFontLibrary(h),file={name:'Private.ttf',size:4,arrayBuffer:async()=>new ArrayBuffer(4)}
  const first=await lib.importFile(file,()=>true), second=await lib.importFile(file,()=>true)
  assert.notEqual(first.local, second.local)
  assert.equal(lib.familyFor(first.local), first.family)
  assert.equal(lib.familyFor(second.local), second.family)
  assert.equal(h.installed.size, 2)
})
