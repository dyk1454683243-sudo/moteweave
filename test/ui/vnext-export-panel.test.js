import test from 'node:test'
import assert from 'node:assert/strict'
import { bindExportPanel } from '../../src/ui/vnext/vnext-export-panel.js'
function host() {
  const nodes=new Map(),listeners=new Map(),anchors=[]
  const node=()=>({hidden:false,disabled:false,checked:false,value:'',textContent:'',children:[],replaceChildren(...kids){this.children=[...kids]},get options(){return this.children},classList:{toggle(){}},events:new Map(),attributes:{},setAttribute(k,v){this.attributes[k]=v},removeAttribute(k){delete this[k]},addEventListener(k,f){this.events.set(k,f)},focus(){doc.activeElement=this},click(){if(!this.disabled)return this.events.get('click')?.()},change(){if(!this.disabled)return this.events.get('change')?.()}})
  for(const id of ['title','name','status','frame','sheet','reload','submit','close','json','json-option','tag','tag-option','scope','layout','frame-size','filename','preview','placeholder','dimensions'])nodes.set(`#vnext-export-${id}`,node())
  const panel={...node(),hidden:true,querySelector:s=>nodes.get(s),querySelectorAll:()=>[]}
  const doc={ownerDocument:null,querySelector:s=>s==='#vnext-export-dialog'?panel:null,addEventListener:(type,fn,capture)=>listeners.set(type,{fn,capture}),createElement:tag=>tag==='option'?{tagName:'OPTION',value:'',textContent:'',selected:false}:{tagName:'A',click(){anchors.push(this)}}}
  return {doc,panel,nodes,listeners,anchors,trigger:node()}
}
const tick=()=>new Promise(r=>setImmediate(r))
const get=(h,id)=>h.nodes.get(`#vnext-export-${id}`)
const target=()=>({key:'a',name:'Saved',busy:false,canvas:{width:2,height:1}})
const frame={blob:new Blob(['pixels']),filename:'frame.png'}
function sheetFixture() {
  const document={version:'sprite_document_v1',project_id:'p',document_id:'d',revision:4,canvas:{w:2,h:1},color:{format:'rgba8',alpha:'straight',space:'srgb'},frame_order:['f'],layer_order:['l'],frames:{f:{id:'f',duration_ms:80}},layers:{l:{id:'l',name:'Layer',kind:'raster',visible:true,locked:false}},cels:{c:{id:'c',frame_id:'f',layer_id:'l',block:null}}}
  return {target:{...target(),projectId:'p',canvasId:'c',document},api:{getDocument:async()=>({document,revision:4,manifest_sha256:'a'.repeat(64)})}}
}
test('Document root opens a real preview without downloading; Export requests PNG and Escape returns focus',async()=>{
  const h=host()
  bindExportPanel({root:h.doc,trigger:h.trigger,context:target,currentFrame:async()=>frame})
  h.trigger.click();assert.equal(h.panel.hidden,false);assert.equal(h.doc.activeElement,get(h,'close'));await tick()
  assert.equal(h.anchors.length,0);assert.equal(get(h,'preview').hidden,false);assert.match(get(h,'preview').src,/^blob:/)
  assert.equal(get(h,'json-option').hidden,true);get(h,'submit').click();assert.equal(h.anchors.length,1);assert.equal(h.anchors[0].download,'frame.png');assert.match(get(h,'status').textContent,/requested/)
  const key=h.listeners.get('keydown');assert.equal(key.capture,true);let prevented=false,stopped=false
  key.fn({key:'Escape',preventDefault(){prevented=true},stopImmediatePropagation(){stopped=true}})
  assert.equal(prevented&&stopped,true);assert.equal(h.panel.hidden,true);assert.equal(h.doc.activeElement,h.trigger);assert.equal(get(h,'preview').src,undefined)
})
test('sheet defaults to PNG only; checked JSON exports the same prepared result without another read',async()=>{
  const h=host(),f=sheetFixture();let reads=0;const read=f.api.getDocument;f.api.getDocument=async()=>{reads++;return read()}
  const binding=bindExportPanel({root:h.doc,trigger:h.trigger,api:f.api,context:()=>f.target,currentFrame:async()=>frame})
  await h.trigger.click();assert.equal(get(h,'submit').disabled,false);assert.equal(get(h,'json').checked,false);assert.equal(h.anchors.length,0)
  assert.equal(get(h,'tag-option').hidden,true)
  get(h,'submit').click();assert.equal(h.anchors.length,1);assert.match(h.anchors[0].download,/\.png$/)
  get(h,'json').checked=true;get(h,'submit').click();assert.equal(h.anchors.length,3);assert.match(h.anchors[2].download,/\.json$/);assert.equal(reads,2)
  assert.match(get(h,'status').textContent,/multiple files/);binding.close()
})
test('tag range selector filters sheet preview and PNG/JSON export to the selected tag frames',async()=>{
  const h=host()
  const document={
    version:'sprite_document_v1',project_id:'p',document_id:'d',revision:4,canvas:{w:2,h:1},
    color:{format:'rgba8',alpha:'straight',space:'srgb'},
    frame_order:['f0','f1','f2'],layer_order:['l'],
    frames:{f0:{id:'f0',duration_ms:80},f1:{id:'f1',duration_ms:120},f2:{id:'f2',duration_ms:160}},
    layers:{l:{id:'l',name:'Layer',kind:'raster',visible:true,locked:false}},
    cels:{
      c0:{id:'c0',frame_id:'f0',layer_id:'l',block:null},
      c1:{id:'c1',frame_id:'f1',layer_id:'l',block:null},
      c2:{id:'c2',frame_id:'f2',layer_id:'l',block:null},
    },
    tags:[{id:'tag_walk',name:'Walk',from_frame_id:'f1',to_frame_id:'f2',direction:'forward'}],
  }
  const ctx={...target(),projectId:'p',canvasId:'c',document}
  const api={getDocument:async()=>({document,revision:4,manifest_sha256:'b'.repeat(64)})}
  const binding=bindExportPanel({root:h.doc,trigger:h.trigger,api,context:()=>ctx,currentFrame:async()=>frame})
  assert.throws(() => { get(h,'tag').options=[] }, TypeError)
  await h.trigger.click()
  assert.equal(get(h,'tag-option').hidden,false)
  assert.equal(get(h,'tag').value,'all')
  assert.deepEqual(
    get(h,'tag').options.map(o=>({tagName:o.tagName,value:o.value,textContent:o.textContent,selected:o.selected})),
    [
      {tagName:'OPTION',value:'all',textContent:'All frames (3)',selected:true},
      {tagName:'OPTION',value:'tag_walk',textContent:'Walk (#2–#3)',selected:false},
    ],
  )
  assert.equal(get(h,'scope').textContent,'All 3 frames · Visible layers')
  assert.equal(get(h,'dimensions').textContent,'4 × 2 px · 2 × 2 grid')
  get(h,'tag').value='tag_walk'
  await get(h,'tag').change()
  assert.deepEqual(
    get(h,'tag').options.map(o=>({value:o.value,selected:o.selected})),
    [
      {value:'all',selected:false},
      {value:'tag_walk',selected:true},
    ],
  )
  assert.equal(get(h,'scope').textContent,'Tag “Walk” (2 frames, #2–#3) · Visible layers')
  assert.equal(get(h,'dimensions').textContent,'4 × 1 px · 2 × 1 grid')
  assert.equal(get(h,'filename').textContent,'PNG · Saved-Walk-sheet-r4.png')
  get(h,'json').checked=true
  get(h,'submit').click()
  assert.equal(h.anchors.length,2)
  assert.equal(h.anchors[0].download,'Saved-Walk-sheet-r4.png')
  assert.equal(h.anchors[1].download,'Saved-Walk-sheet-r4.json')
  binding.close()
})
test('closing during a read prevents late results; busy transition invalidates ready or pending previews',async()=>{
  const h=host();let finish,busy=false
  const binding=bindExportPanel({root:h.doc,trigger:h.trigger,context:()=>({...target(),busy}),currentFrame:()=>new Promise(r=>finish=r)})
  h.trigger.click();binding.close();finish(frame);await tick();assert.equal(get(h,'preview').hidden,true);assert.equal(h.anchors.length,0)
  h.trigger.click();busy=true;binding.refresh();finish(frame);await tick();assert.equal(get(h,'submit').disabled,true);assert.equal(get(h,'preview').hidden,true);assert.match(get(h,'status').textContent,/changed/)
  busy=false;binding.refresh();const reloaded=get(h,'reload').click();finish(frame);await reloaded;assert.equal(get(h,'submit').disabled,false);binding.close()
})
test('type switch makes an older sheet read inert and frame preview never downloads automatically',async()=>{
  const h=host(),f=sheetFixture(),read=f.api.getDocument;let finish
  f.api.getDocument=()=>new Promise(r=>finish=r)
  const binding=bindExportPanel({root:h.doc,trigger:h.trigger,api:f.api,context:()=>f.target,currentFrame:async()=>frame})
  h.trigger.click();await get(h,'frame').click();const preview=get(h,'preview').src
  finish(await read());await tick();assert.equal(get(h,'preview').src,preview);assert.equal(get(h,'title').textContent,'Export current frame');assert.equal(get(h,'submit').disabled,false);assert.equal(h.anchors.length,0);binding.close()
})
test('read errors have explicit reload, no files, and successful retry restores the preview',async()=>{
  const h=host();let fail=true
  const binding=bindExportPanel({root:h.doc,trigger:h.trigger,context:target,currentFrame:async()=>{if(fail)throw Object.assign(new Error('not_found'),{kind:'known_reject'});return frame}})
  h.trigger.click();await tick();assert.match(get(h,'status').textContent,/could not be read.*Reload/);assert.equal(get(h,'reload').hidden,false);assert.equal(get(h,'submit').disabled,true);assert.equal(h.anchors.length,0)
  fail=false;await get(h,'reload').click();assert.equal(get(h,'submit').disabled,false);assert.equal(get(h,'reload').hidden,true);binding.close()
})
test('Tab includes the JSON input; object URLs are revoked when the preview is invalidated',async()=>{
  const h=host();let key='a';const revoked=[],original=URL.revokeObjectURL
  URL.revokeObjectURL=url=>{revoked.push(url);original(url)}
  try {
    const binding=bindExportPanel({root:h.doc,trigger:h.trigger,context:()=>({...target(),key}),currentFrame:async()=>frame})
    h.trigger.click();await tick();const preview=get(h,'preview').src;get(h,'submit').click();const download=h.anchors[0].href
    let selector;h.panel.querySelectorAll=s=>{selector=s;return [get(h,'frame'),get(h,'json'),get(h,'submit')].map(n=>Object.assign(n,{closest:()=>null}))}
    get(h,'submit').focus();let prevented=false;h.listeners.get('keydown').fn({key:'Tab',preventDefault(){prevented=true},stopImmediatePropagation(){}})
    assert.match(selector,/input/);assert.equal(prevented,true);assert.equal(h.doc.activeElement,get(h,'frame'))
    key='b';binding.refresh();assert.deepEqual(revoked,[preview,download]);assert.equal(get(h,'submit').disabled,true);binding.close()
  } finally {URL.revokeObjectURL=original}
})
