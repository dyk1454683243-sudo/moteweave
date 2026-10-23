import test from 'node:test'
import assert from 'node:assert/strict'
import { bindPixelProcessing } from '../../src/ui/vnext/vnext-pixel-processing.js'

function fixture({ expired = false, saveError = null, committed = false, processResult = null, processHang = false, acceptErrorOnce = false, deselectOnShow = false, undoResult = true, laterEdit = false, showGate = null, discardFailOnce = false } = {}) {
  const events = new Map(), revealed = [], actions = { items: [], replaceChildren() { this.items=[] }, append(b) { this.items.push(b) }, scrollIntoView(options) { revealed.push(['actions', options]) } },
    status = { textContent:'', dataset:{}, scrollIntoView(options) { revealed.push(['status', options]) } }
  const makeButton = () => ({ textContent:'', dataset:{}, setAttribute(){}, addEventListener(_,fn){this.click=fn} })
  const start = makeButton(); start.dataset.pixelProcess='recover-grid'
  const panel = { hidden: false, querySelector:s=>s.includes('status')?status:actions, querySelectorAll:()=>[start] }
  const root = { querySelector:()=>panel, createElement:makeButton }
  let selected=true, saves=0, acceptFailures=acceptErrorOnce?1:0, undoCalls=[], discardFailures=discardFailOnce?1:0, undoOutcome=undoResult
  const undoEntry={kind:'document'}
  const source = { projectId:'p', projectRevision:2, sourceCanvasId:'c', sourceDocumentId:'d', sourceRevision:1,
    manifest:{frame_order:['f'],layer_order:['l']},isSelected:()=>selected }
  const session = { prepareDocumentEdit:async()=>source, pixelTargetInfo:()=>selected ? ({}) : null, renderCanvas(){},
    showDocumentCandidate:async()=>{session.documentCandidate={source,showSource:false};session.manualWrite={};if(deselectOnShow)selected=false;if(showGate)await showGate},
    // A later edit makes another entry the latest; otherwise this result's entry stays the latest.
    latestUndoEntry:()=>saves?(laterEdit?{kind:'later'}:undoEntry):null,
    undoIfLatest:async entry=>{undoCalls.push(entry);return undoOutcome},
    clearDocumentCandidate:()=>{session.documentCandidate=null;session.manualWrite=null},
    saveDocumentCandidate:async(_,save)=>{if(committed)session.documentCandidate.result={receipt:{}};if(saveError)throw Object.assign(new Error('save'),{code:saveError});await save();session.clearDocumentCandidate()} }
  const calls=[]
  const client = {
    processDocument:async(_b,_o,signal)=>{
      if(processHang) return new Promise((_,rej)=>signal?.addEventListener('abort',()=>rej(Object.assign(new Error('aborted'),{name:'AbortError'})),{once:true}))
      return processResult || {candidate_id:'candidate',sha256:'hash'}
    },
    documentCandidate:async r=>{calls.push(r);if(r.action==='accept')saves++;if(expired && ['accept','discard'].includes(r.action))throw Object.assign(new Error(),{code:'candidate_expired'})
      if(r.action==='discard'&&discardFailures){discardFailures--;throw new Error('connection reset')}
      if(r.action==='accept'&&acceptFailures){acceptFailures--;throw new Error('connection reset')}
      return{width:16,height:16,frames:1}}
  }
  const controller = bindPixelProcessing({root,session,client})
  const wait=async()=>{for(let i=0;i<8;i++)await new Promise(r=>setImmediate(r))}
  return {panel,actions,status,start,session,controller,calls,wait,undoEntry,undoCalls,revealed,setSelected:v=>selected=v,setUndoResult:v=>undoOutcome=v,get saves(){return saves}}
}
const click = (f,label) => {const b=f.actions.items.find(b=>b.textContent===label);assert.ok(b,`missing ${label}`);b.click()}
test('an expired result is not applied or retried; it is cleared and releases the workspace', async()=>{
  const f=fixture({expired:true});f.start.click();await f.wait()
  assert.equal(f.saves,1,'one apply attempt, no automatic retry');assert.equal(f.controller.busy,false);assert.equal(f.session.documentCandidate,null)
  assert.match(f.status.textContent,/could not be applied because the canvas or its content changed\. The source is unchanged\./)
  assert.ok(!f.actions.items.some(b=>['Save','Discard','Resolve'].includes(b.textContent)),'no approval or recovery step for a definite rejection')
})
test('a selection change while processing applies nothing and stays visible until reselected and deselected', async()=>{
  const f=fixture();f.start.click();f.setSelected(false);await f.wait()
  assert.equal(f.saves,0);assert.equal(f.controller.busy,false);assert.match(f.status.textContent,/changed/)
  assert.ok(f.calls.some(c=>c.action==='discard'),'the unapplied result is released')
  assert.equal(f.panel.hidden, false, 'context-change notice stays visible until user selects and deselects again')
  f.setSelected(true);f.controller.sync();f.setSelected(false);f.controller.sync()
  assert.equal(f.panel.hidden, true, 'idle state with no selected canvas hides Perfect pixels card')
})
test('a selection change after processing and before applying applies nothing', async()=>{
  const f=fixture({deselectOnShow:true});f.start.click();await f.wait()
  assert.equal(f.saves,0);assert.equal(f.controller.busy,false);assert.equal(f.session.documentCandidate,null)
  assert.match(f.status.textContent,/The selected canvas changed\. Nothing was applied\./)
  assert.equal(f.actions.items.length,0)
})
test('an uncertain apply keeps same-operation recovery without a discard, and resolving reuses that operation', async()=>{
  const f=fixture({saveError:'stale_revision',committed:true});f.start.click();await f.wait()
  assert.ok(f.actions.items.some(b=>b.textContent==='Resolve'));assert.ok(!f.actions.items.some(b=>['Discard','Clear result'].includes(b.textContent)))
  assert.match(f.status.textContent,/may already be applied\. Resolve this same change/)
  f.setSelected(false);f.controller.sync()
  assert.equal(f.panel.hidden, false, 'Resolve recovery stays visible even when selection is cleared')
  const g=fixture({acceptErrorOnce:true});g.start.click();await g.wait()
  assert.equal(g.saves,1);click(g,'Resolve');await g.wait()
  const accepts=g.calls.filter(c=>c.action==='accept')
  assert.equal(accepts.length,2);assert.equal(accepts[1].operation_id,accepts[0].operation_id,'resolving replays the same operation identity')
  assert.equal(g.calls.filter(c=>c.action==='discard').length,0,'an uncertain result is never discarded')
  assert.match(g.status.textContent,/^Applied · 16 × 16 px · 1 frame/)
})
test('failure notice and in-flight Stop keep panel visible across first deselect until reselected and deselected', async()=>{
  const f=fixture({processResult:{candidate_id:null,processing:{reason:'no_background_detected'}}})
  f.start.click();await f.wait()
  assert.match(f.status.textContent,/No removable background was detected/)
  f.setSelected(false);f.controller.sync()
  assert.equal(f.panel.hidden,false);assert.match(f.status.textContent,/No removable background was detected/)
  f.setSelected(true);f.controller.sync();f.setSelected(false);f.controller.sync()
  assert.equal(f.panel.hidden,true)

  const g=fixture({processHang:true})
  g.start.click();await g.wait()
  assert.equal(g.panel.hidden,false);click(g,'Stop');await g.wait()
  assert.match(g.status.textContent,/Stopped\. No candidate was saved\./)
  g.setSelected(false);g.controller.sync()
  assert.equal(g.panel.hidden,false);assert.match(g.status.textContent,/Stopped\. No candidate was saved\./)
})
test('perfect pixels applies a requested result directly with status tone and an optional Undo that only reverts the latest change', async () => {
  const { readFile } = await import('node:fs/promises')
  const html = await readFile(new URL('../../src/ui/vnext/vnext-preview.html', import.meta.url), 'utf8')
  const section = html.match(/<section[^>]*id="vnext-perfect-pixels"[\s\S]*?<\/section>/)?.[0] || ''
  assert.match(section, /data-pixel-process="recover-grid"[^>]*data-tooltip="Recover pixel grid/)
  assert.match(section, /data-pixel-process="remove-background"[^>]*data-tooltip="Remove background/)
  assert.doesNotMatch(section, /Save|Discard|Source|Candidate/, 'no review controls are advertised')
  const notes = [...section.matchAll(/<p[^>]*class="[^"]*vnext-brush-note[^"]*"[^>]*>/g)]
  assert.equal(notes.length, 1, 'only the dynamic status line uses vnext-brush-note inside #vnext-perfect-pixels')

  const f = fixture()
  assert.equal(f.status.hidden, true, 'empty status is hidden when idle')
  f.start.click()
  await f.wait()
  assert.equal(f.saves, 1, 'clicking the operation is the request: it applies once')
  assert.equal(f.calls.filter(c => c.action === 'read').length, 1)
  assert.equal(f.status.hidden, false)
  assert.equal(f.status.dataset.tone, 'done')
  assert.match(f.status.textContent, /^Applied · 16 × 16 px · 1 frame · Undo restores the previous pixels\./)
  assert.equal(f.status.dataset.figmaVariant, '2855:2534', 'the applied outcome maps to its Figma Current node')
  assert.ok(!f.actions.items.some(b => ['Save', 'Discard', 'Source', 'Candidate'].includes(b.textContent)))
  assert.deepEqual(f.revealed.at(-1), ['actions', { block: 'nearest' }], 'the result and its Undo are scrolled into view, not left below the fold')
  click(f, 'Undo')
  await f.wait()
  assert.deepEqual(f.undoCalls, [f.undoEntry], 'Undo reverts exactly this result')
  assert.match(f.status.textContent, /^Undone · Previous pixels restored\./)
  assert.equal(f.status.dataset.figmaVariant, undefined, 'no node is claimed for an outcome that is not drawn')

  const g = fixture({ laterEdit: true })
  g.start.click(); await g.wait()
  click(g, 'Undo'); await g.wait()
  assert.match(g.status.textContent, /^Applied · 16 × 16 px · 1 frame · Undo here was withdrawn because a later change was made; nothing was reverted\. ⌘Z \/ Ctrl\+Z steps back through changes in order\./, 'a later edit is never overwritten; the result stays described')
  assert.equal(g.status.dataset.tone, 'done', 'a withdrawn Undo is a neutral note, not an error')
  assert.equal(g.status.dataset.figmaVariant, '2909:2426', 'the withdrawn Undo maps to its Figma Current node')
  assert.deepEqual(g.revealed.at(-1), ['status', { block: 'nearest' }], 'the superseded explanation is shown in view')
  assert.deepEqual(g.undoCalls, [], 'Undo is not attempted once another change is the latest')

  // Already reverted with ⌘Z / Ctrl+Z: the panel says so instead of claiming a later change.
  const k = fixture({ laterEdit: true })
  k.session.undoEntryState = entry => (entry ? 'redo' : 'absent') // this result's entry sits in redo
  k.start.click(); await k.wait()
  click(k, 'Undo'); await k.wait()
  assert.match(k.status.textContent, /^Already undone with ⌘Z \/ Ctrl\+Z · Previous pixels restored\./)
  assert.equal(k.status.dataset.figmaVariant, undefined)
  assert.deepEqual(k.undoCalls, [], 'nothing is reverted twice')

  // A save still in progress keeps the same Undo offered instead of reporting a later edit.
  const h = fixture({ undoResult: false })
  h.start.click(); await h.wait()
  click(h, 'Undo'); await h.wait()
  assert.match(h.status.textContent, /Undo could not run while another change was saving; try again\./)
  const undo = h.actions.items.find(b => b.textContent === 'Undo')
  assert.ok(undo); assert.equal(undo.disabled, false)
  h.setUndoResult(true); click(h, 'Undo'); await h.wait()
  assert.match(h.status.textContent, /^Undone · Previous pixels restored\./)
})

test('a selection change while the result is shown releases it; a failed release offers Clear result and nothing is applied', async () => {
  let release
  const gate = new Promise(resolve => { release = resolve })
  const f = fixture({ showGate: gate })
  f.start.click(); await f.wait()
  f.setSelected(false); f.controller.sync(); await f.wait()
  assert.match(f.status.textContent, /The selected canvas changed\. Nothing was applied\./)
  release(); await f.wait()
  assert.equal(f.calls.filter(c => c.action === 'discard').length, 1); assert.equal(f.saves, 0)
  assert.equal(f.controller.busy, false)

  let releaseG
  const gateG = new Promise(resolve => { releaseG = resolve })
  const g = fixture({ showGate: gateG, discardFailOnce: true })
  g.start.click(); await g.wait()
  g.setSelected(false); g.controller.sync(); await g.wait()
  assert.match(g.status.textContent, /Clear this unapplied result before continuing\./)
  click(g, 'Clear result'); await g.wait()
  assert.match(g.status.textContent, /Discarded · Source unchanged\./)
  releaseG(); await g.wait()
  assert.equal(g.calls.filter(c => c.action === 'discard').length, 2, 'Clear result discards the same result again')
  assert.equal(g.saves, 0, 'nothing is applied after the release'); assert.equal(g.controller.busy, false)
})
