import test from 'node:test'
import assert from 'node:assert/strict'
import { FakeElement } from '../helpers/fakeEditorDom.js'
import { bindDocumentTimeline } from '../../src/ui/vnext/vnext-document-timeline.js'

// Reuse the existing DOM double; only cloning/SVG markup are needed by layer rows.
class TimelineNode extends FakeElement {
  constructor(tag, doc) { super(tag, doc); this.style.setProperty = (key, value) => { this.style[key] = value } }
  set innerHTML(value) { this.markup = value; this.replaceChildren(); if (value.includes('<use')) this.append(new TimelineNode('use', this.ownerDocument)) }
  get innerHTML() { return this.markup || '' }
  replaceWith(node) { this.parentNode.insertBefore(node, this); this.remove() }
  cloneNode(deep) {
    const copy = new TimelineNode(this.tagName, this.ownerDocument)
    copy.className = this.className; copy.dataset = { ...this.dataset }; copy.attributes = new Map(this.attributes); copy.markup = this.markup
    if (deep) this.children.forEach(child => copy.append(child.cloneNode(true)))
    return copy
  }
}

function fixture(t) {
  const saved = new Map(['document', 'window', 'setTimeout', 'clearTimeout'].map(key => [key, globalThis[key]]))
  const events = new Map(), timers = new Map(), nodes = new Map()
  const doc = { createElement: tag => new TimelineNode(tag, doc), addEventListener: (name, fn) => events.set(name, fn) }
  const make = (selector, tag = 'div') => { const node = doc.createElement(tag); nodes.set(selector, node); return node }
  const frames = make('#vnext-frame-cols'), layers = make('#vnext-layer-col')
  const row = doc.createElement('div'); row.className = 'vnext-layer-row'
  for (let index = 0; index < 2; index++) { const icon = doc.createElement('button'); icon.className = 'vnext-layer-icon'; icon.innerHTML = '<svg><use/></svg>'; row.append(icon) }
  const link = doc.createElement('button'); link.dataset.capability = 'TIME-07'; link.innerHTML = '<svg><use/></svg>'; row.append(link)
  const name = doc.createElement('span'); name.className = 'vnext-layer-name'; row.append(name)
  const add = doc.createElement('button'); add.setAttribute('aria-label', 'Add layer'); layers.append(row, add)
  for (const selector of ['.vnext-grid', '.vnext-selected-row', '.vnext-play-current', '.vnext-play-total', '.vnext-playback-params-start .vnext-text-btn span', '#vnext-timeline-tags', '#vnext-timeline-menu', '#vnext-confirm-dialog', '#vnext-confirm-details', '#vnext-confirm-primary', '#vnext-confirm-secondary']) make(selector)
  const nav = Array.from({ length: 5 }, () => { const button = doc.createElement('button'); button.innerHTML = '<svg><use/></svg>'; return button })
  const root = { querySelector: selector => nodes.get(selector) || null, querySelectorAll: selector => selector === '.vnext-play-nav button' ? nav : [] }
  let timerId = 0, renders = 0, stateRenders = 0, rebuilds = 0, scopeChanges = 0
  let confirmState = null
  const commands = [], promoted = [], statuses = []
  const replace = frames.replaceChildren.bind(frames)
  frames.replaceChildren = (...children) => { rebuilds++; replace(...children) }
  globalThis.document = doc; globalThis.window = { addEventListener: (name, fn) => events.set(name, fn) }
  globalThis.setTimeout = (fn, delay) => { timers.set(++timerId, { fn, delay }); return timerId }
  globalThis.clearTimeout = id => timers.delete(id)
  const manifest = { document_id: 'd', revision: 1, canvas: { w: 64, h: 64 }, frame_order: ['f1', 'f2'], layer_order: ['l'],
    frames: { f1: { id: 'f1', duration_ms: 125 }, f2: { id: 'f2', duration_ms: 240 } },
    layers: { l: { id: 'l', name: 'Ink', kind: 'raster', visible: true, locked: false } },
    cels: { a: { id: 'a', frame_id: 'f1', layer_id: 'l', block: null }, b: { id: 'b', frame_id: 'f2', layer_id: 'l', block: null } } }
  const original = { frame: 'edit' }, canvas = { id: 'c', preview: original }, calls = []
  const session = { project: { id: 'p', revision: 1, canvases: { c: { document_id: 'd' } } }, documents: new Map([['d', manifest]]),
    view: { selectedId: 'c', canvases: [canvas] }, api: { openEpoch: { current: 1 } }, pixelSelection: { x: 1 } }
  let compose = async (_manifest, frame) => { calls.push(frame); return { frame } }
  let timeline
  timeline = bindDocumentTimeline({
    root,
    session,
    command: async cmd => { commands.push(cmd); return { ok: true, document: manifest } },
    compose: (...args) => compose(...args),
    renderCanvas: () => { renders++; timeline.render() },
    renderPlaybackState: () => { stateRenders++; timeline.render() },
    confirm: opts => { confirmState = opts },
    closeConfirm: () => { confirmState = null },
    historyPending: () => false,
    status: msg => { statuses.push(msg) },
    promoteReference: async spec => { promoted.push(spec) },
    onScopeChange: () => { scopeChanges++ },
  })
  timeline.render()
  t.after(() => { timeline.stop(); for (const [key, value] of saved) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value } })
  return { timeline, nav, frames, layers, nodes, manifest, session, canvas, original, timers, events, calls, commands, promoted, statuses,
    getConfirm: () => confirmState,
    scopeChanges: () => scopeChanges,
    counters: () => ({ renders, stateRenders, rebuilds }), setCompose: fn => { compose = fn },
    tick: async () => { assert.equal(timers.size, 1); const [id, timer] = timers.entries().next().value; timers.delete(id); await timer.fn(); return timer.delay } }
}

test('unsaved document candidate browses and plays in the existing timeline without editing saved targets or previews', async t => {
  const f = fixture(t), manifest = structuredClone(f.manifest), guard = { kind: 'document-candidate' }
  manifest.canvas = { w: 32, h: 48 }; manifest.frame_order.reverse()
  const preview = { frame: 'candidate-first' }
  f.session.documentCandidate = { id: 'candidate-1', manifest, guard, phase: 'review', canvas: { ...f.canvas, preview } }
  f.session.manualWrite = guard; f.timeline.render()
  assert.equal(f.timeline.target(manifest).frame_id, 'f2')
  assert.equal(f.timeline.target(f.manifest).frame_id, 'f1', 'formal edit target stays separate')
  assert.equal(f.nav[2].disabled, false, 'candidate playback remains available')
  assert.equal(f.layers.querySelector('button[aria-label="Add layer"]').disabled, true)
  await f.timeline.select('f1', 'l')
  assert.equal(f.session.documentCandidate.canvas.preview.frame, 'f1'); assert.equal(f.canvas.preview, f.original)
  f.nav[2].onclick(); await f.tick()
  assert.equal(f.session.documentCandidate.canvas.preview.frame, 'f2')
  f.nav[2].onclick(); await Promise.resolve()
  assert.equal(f.session.documentCandidate.canvas.preview.frame, 'f1', 'Pause returns to the edit target')
  assert.equal(f.canvas.preview, f.original)
  f.session.documentCandidate = null; f.session.manualWrite = null; f.timeline.render()
  assert.equal(f.timeline.target(f.manifest).frame_id, 'f1'); assert.equal(f.layers.querySelector('button[aria-label="Add layer"]').disabled, false)
})

test('VNext playback refreshes the canvas once per composed frame and reuses timeline nodes', async t => {
  const f = fixture(t), columns = [...f.frames.children], row = f.layers.querySelector('.vnext-layer-row')
  f.nav[2].onclick()
  for (let step = 0; step < 12; step++) {
    assert.equal(await f.tick(), step % 2 ? 240 : 125, 'original per-frame duration is retained')
    const frame = step % 2 ? 'f1' : 'f2'
    assert.equal(f.canvas.preview.frame, frame)
    assert.deepEqual(f.frames.children, columns, 'playback keeps frame nodes and their listeners')
    assert.equal(f.layers.querySelector('.vnext-layer-row'), row)
    assert.equal(f.frames.children[step % 2 ? 0 : 1].classList.contains('is-head'), true)
    assert.equal(f.nodes.get('.vnext-play-current').textContent, step % 2 ? '01' : '02')
    assert.equal(f.nodes.get('.vnext-playback-params-start .vnext-text-btn span').textContent, step % 2 ? '125 ms' : '240 ms')
  }
  assert.deepEqual(f.counters(), { renders: 12, stateRenders: 12, rebuilds: 1 })
  assert.deepEqual(f.timeline.target(f.manifest), { frame_id: 'f1', layer_id: 'l', cel_id: 'a' }, 'playback does not change edit target')
  f.nav[2].onclick(); await Promise.resolve()
  assert.equal(f.timers.size, 0); assert.equal(f.canvas.preview, f.original)
  assert.equal(f.timeline.isPlaying(), false)
  t.diagnostic('12 playback frames: 12 full canvas renders, 12 state-only renders, 0 timeline rebuilds after initial mount')
})

test('VNext manual selection, document edits, and late playback results retain their gates', async t => {
  const f = fixture(t)
  let resolve
  f.setCompose(() => new Promise(done => { resolve = done }))
  const selected = f.timeline.select('f2', 'l')
  assert.equal(f.session.frameLoading, true)
  assert.equal(f.counters().renders, 1, 'manual loading still refreshes all edit controls immediately')
  resolve({ frame: 'f2' }); await selected
  assert.equal(f.session.frameLoading, false); assert.equal(f.timeline.target(f.manifest).frame_id, 'f2')
  assert.equal(f.session.pixelSelection, null)
  const oldColumn = f.frames.children[0]
  f.manifest.revision++; f.manifest.frames.f2.duration_ms = 300; f.timeline.render()
  assert.notEqual(f.frames.children[0], oldColumn, 'a document edit rebuilds the structure')
  assert.equal(f.nodes.get('.vnext-playback-params-start .vnext-text-btn span').textContent, '300 ms')
  f.nav[2].onclick()
  const advancing = f.tick()
  f.timeline.stop(); await Promise.resolve()
  const stoppedPreview = f.canvas.preview
  resolve({ frame: 'late' }); await advancing
  assert.equal(f.canvas.preview, stoppedPreview); assert.equal(f.timers.size, 0)
  f.nav[2].onclick(); f.events.get('pagehide')(); await Promise.resolve()
  assert.equal(f.timeline.isPlaying(), false); assert.equal(f.timers.size, 0)
})

test('animation tags render chips, scope forward/reverse/pingpong playback, edit/delete tags, and do not block frame edits', async t => {
  const f = fixture(t)
  f.manifest.frame_order = ['f1', 'f2', 'f3', 'f4']
  f.manifest.frames = {
    f1: { id: 'f1', duration_ms: 100 },
    f2: { id: 'f2', duration_ms: 110 },
    f3: { id: 'f3', duration_ms: 120 },
    f4: { id: 'f4', duration_ms: 130 },
  }
  f.manifest.cels = {
    c1: { id: 'c1', frame_id: 'f1', layer_id: 'l', block: null },
    c2: { id: 'c2', frame_id: 'f2', layer_id: 'l', block: null },
    c3: { id: 'c3', frame_id: 'f3', layer_id: 'l', block: null },
    c4: { id: 'c4', frame_id: 'f4', layer_id: 'l', block: null },
  }
  f.manifest.tags = [
    { id: 'tag_walk', name: 'Walk', from_frame_id: 'f2', to_frame_id: 'f4', direction: 'pingpong' },
    { id: 'tag_rev', name: 'Back', from_frame_id: 'f2', to_frame_id: 'f3', direction: 'reverse' },
  ]
  f.manifest.revision++
  f.timeline.render()

  const tagsBar = f.nodes.get('#vnext-timeline-tags')
  const tagButtons = tagsBar.children
  assert.equal(tagButtons.length, 4, 'All frames + 2 tags + (+ Tag)')
  assert.equal(tagButtons[0].textContent, 'All frames')
  assert.equal(tagButtons[1].textContent, 'Walk · F2–4 ↔')
  assert.equal(tagButtons[2].textContent, 'Back · F2–3 ←')
  assert.equal(tagButtons[3].textContent, '+ Tag')

  // Selecting Walk tag jumps from f1 to f2 and plays pingpong: f2 -> f3 -> f4 -> f3 -> f2
  tagButtons[1].onclick()
  await Promise.resolve()
  assert.equal(f.timeline.activeTag()?.id, 'tag_walk')
  assert.equal(f.timeline.target(f.manifest).frame_id, 'f2')

  f.nav[2].onclick()
  const played = []
  for (let step = 0; step < 4; step++) {
    await f.tick()
    played.push(f.canvas.preview.frame)
  }
  assert.deepEqual(played, ['f3', 'f4', 'f3', 'f2'], 'pingpong tag cycles f2 -> f3 -> f4 -> f3 -> f2')
  f.timeline.stop()

  // Selecting reverse tag plays f3 -> f2 -> f3
  const revBtn = tagsBar.children[2]
  revBtn.onclick()
  await Promise.resolve()
  f.nav[2].onclick()
  await f.tick()
  assert.equal(f.canvas.preview.frame, 'f2')
  await f.tick()
  assert.equal(f.canvas.preview.frame, 'f3')
  f.timeline.stop()

  // Double-clicking tag chip opens tag editor dialog via confirm + #vnext-confirm-details
  tagsBar.children[2].ondblclick({ preventDefault() {}, stopPropagation() {} })
  const details = f.nodes.get('#vnext-confirm-details')
  assert.equal(details.hidden, false)
  const inputs = details.querySelectorAll('input')
  const selects = details.querySelectorAll('select')
  assert.equal(inputs[0].value, 'Back')
  inputs[0].value = 'Retreat'
  selects[0].value = 'f2'
  selects[1].value = 'f3'
  selects[2].value = 'forward'
  await f.getConfirm().onPrimary()
  assert.deepEqual(f.commands.at(-1), {
    type: 'update-tag',
    tag_id: 'tag_rev',
    name: 'Retreat',
    from_frame_id: 'f2',
    to_frame_id: 'f3',
    direction: 'forward',
  })

  // Delete button inside tag editor dispatches delete-tag
  tagsBar.children[2].ondblclick({ preventDefault() {}, stopPropagation() {} })
  const delBtn = details.querySelectorAll('button').find(b => b.textContent === 'Delete tag')
  assert.ok(delBtn)
  await delBtn.onclick()
  assert.deepEqual(f.commands.at(-1), { type: 'delete-tag', tag_id: 'tag_rev' })

  // Clicking + Tag opens create dialog and dispatches add-tag
  tagsBar.children[3].onclick()
  const createSelects = details.querySelectorAll('select')
  createSelects[0].value = 'f1'
  createSelects[1].value = 'f2'
  createSelects[2].value = 'forward'
  await f.getConfirm().onPrimary()
  assert.equal(f.commands.at(-1).type, 'add-tag')

  // Frame context menu allows Move and Delete even when tags exist
  const menu = f.nodes.get('#vnext-timeline-menu')
  const frameHead = f.frames.children[1].children[0]
  frameHead.oncontextmenu({ preventDefault() {}, stopPropagation() {}, clientX: 20, clientY: 20 })
  const frameMenuBtns = menu.querySelectorAll('button')
  const deleteFrameBtn = frameMenuBtns.find(b => b.textContent === 'Delete frame')
  assert.equal(deleteFrameBtn.disabled, false, 'tags do not block frame deletion')
})

test('manual cel linking marks linked groups, prompts before replacing differing cel pixels, and unlinks cleanly', async t => {
  const f = fixture(t)
  const block1 = { sha256: 'a'.repeat(64), w: 64, h: 64 }
  const block2 = { sha256: 'b'.repeat(64), w: 64, h: 64 }
  f.manifest.cels.a.block = block1
  f.manifest.cels.b.block = block1
  f.manifest.links = { copy_layers: [], groups: { g1: ['a', 'b'] } }
  f.manifest.revision++
  f.timeline.render()

  const celF1 = f.frames.children[0].children[1]
  const celF2 = f.frames.children[1].children[1]
  assert.equal(celF1.classList.contains('is-linked'), true, 'linked group marks cel as linked')
  assert.equal(celF2.classList.contains('is-linked'), true)

  // Context menu on linked cel shows Unlink cel
  const menu = f.nodes.get('#vnext-timeline-menu')
  celF2.oncontextmenu({ preventDefault() {}, stopPropagation() {}, clientX: 30, clientY: 30 })
  assert.equal(menu.hidden, false)
  const unlinkBtn = menu.querySelectorAll('button').find(b => b.textContent === 'Unlink cel')
  assert.ok(unlinkBtn, 'Unlink option is available for linked cel')
  assert.equal(unlinkBtn.disabled, false)
  unlinkBtn.onclick({ stopPropagation() {} })
  assert.deepEqual(f.commands.at(-1), { type: 'unlink-cel', layer_id: 'l', frame_id: 'f2' })

  // When cels have different non-empty blocks, linking asks for confirmation first
  f.manifest.cels.b.block = block2
  f.manifest.links = { copy_layers: [], groups: {} }
  f.manifest.revision++
  f.timeline.render()
  const unlinkedCelF1 = f.frames.children[0].children[1]
  assert.equal(unlinkedCelF1.classList.contains('is-linked'), false)
  unlinkedCelF1.oncontextmenu({ preventDefault() {}, stopPropagation() {}, clientX: 30, clientY: 30 })
  const linkBtn = menu.querySelectorAll('button').find(b => b.textContent.includes('Link with frame 2'))
  assert.ok(linkBtn)
  linkBtn.onclick({ stopPropagation() {} })
  assert.notEqual(f.commands.at(-1)?.type, 'link-cels', 'does not overwrite differing cel pixels without confirmation')
  assert.equal(f.getConfirm()?.primary, 'Link & replace cel')
  f.getConfirm().onPrimary()
  assert.deepEqual(f.commands.at(-1), { type: 'link-cels', layer_id: 'l', source_frame_id: 'f1', target_frame_id: 'f2' })
})

test('N4 timeline frame scope selects editable frames, locks remaining frames, and promotes frame/cel references', async t => {
  const f = fixture(t)
  const block1 = { sha256: 'a'.repeat(64), w: 64, h: 64 }
  f.manifest.cels.a.block = block1
  f.manifest.revision++
  f.timeline.render()

  assert.equal(f.timeline.editableFrameIds(), null, 'default scope unlocks all frames')
  assert.deepEqual(f.timeline.lockedFrameIds(), [])

  // Frame 1 header menu: Revise only frame 1 (lock others) + Save frame to project references
  const menu = f.nodes.get('#vnext-timeline-menu')
  const f1Header = f.frames.children[0].children[0]
  f1Header.oncontextmenu({ preventDefault() {}, stopPropagation() {}, clientX: 20, clientY: 20 })
  assert.equal(menu.hidden, false)
  const reviseOnlyBtn = menu.querySelectorAll('button').find(b => b.textContent === 'Revise only frame 1 (lock others)')
  assert.ok(reviseOnlyBtn, 'frame menu offers Revise only frame 1 (lock others)')
  reviseOnlyBtn.onclick({ stopPropagation() {} })

  assert.deepEqual(f.timeline.editableFrameIds(), ['f1'])
  assert.deepEqual(f.timeline.lockedFrameIds(), ['f2'])
  assert.equal(f.frames.children[0].classList.contains('is-scope-editable'), true)
  assert.equal(f.frames.children[1].classList.contains('is-scope-locked'), true)
  const tagsBar = f.nodes.get('#vnext-timeline-tags')
  const scopeChip = tagsBar.children.find(n => n.dataset?.timelineScope === 'subset')
  assert.ok(scopeChip, 'tags bar renders active frame scope chip')
  assert.equal(scopeChip.textContent, 'Revise F1 · Lock F2 ×')
  assert.equal(f.scopeChanges(), 1)

  // R2: When only F1 is editable, "Exclude frame 1 from revision scope" is disabled with an explicit reason,
  // and Alt+click on F1 does NOT silently unlock all frames.
  f.frames.children[0].children[0].oncontextmenu({ preventDefault() {}, stopPropagation() {}, clientX: 20, clientY: 20 })
  const excludeLastBtn = menu.querySelectorAll('button').find(b => b.textContent === 'Exclude frame 1 from revision scope')
  assert.ok(excludeLastBtn, 'frame menu renders Exclude frame 1 from revision scope')
  assert.equal(excludeLastBtn.disabled, true, 'cannot exclude the last editable frame')
  assert.match(excludeLastBtn.title, /Keep at least one editable frame in scope/i)
  const unlockAllMenuBtn = menu.querySelectorAll('button').find(b => b.textContent === 'Unlock all frames (revise all)')
  assert.ok(unlockAllMenuBtn, 'frame menu offers explicit Unlock all frames (revise all)')
  assert.equal(unlockAllMenuBtn.disabled, false)

  f.frames.children[0].children[0].onclick({ preventDefault() {}, shiftKey: false, altKey: true, metaKey: false, ctrlKey: false })
  assert.deepEqual(f.timeline.editableFrameIds(), ['f1'], 'Alt+click on last editable frame keeps scope on F1')
  assert.deepEqual(f.timeline.lockedFrameIds(), ['f2'])
  assert.equal(tagsBar.children.some(n => n.dataset?.timelineScope === 'subset'), true)
  assert.match(f.statuses.at(-1), /Keep at least one editable frame in scope/i)

  // Explicit "Unlock all frames (revise all)" menu item unlocks all frames
  f.frames.children[0].children[0].oncontextmenu({ preventDefault() {}, stopPropagation() {}, clientX: 20, clientY: 20 })
  menu.querySelectorAll('button').find(b => b.textContent === 'Unlock all frames (revise all)').onclick({ stopPropagation() {} })
  assert.equal(f.timeline.editableFrameIds(), null)
  assert.deepEqual(f.timeline.lockedFrameIds(), [])
  assert.equal(tagsBar.children.some(n => n.dataset?.timelineScope === 'subset'), false)

  // Alt+click on F2 while all frames are unlocked restricts editable scope to F2;
  // Alt+click on F2 again does NOT silently expand scope to all frames
  f.frames.children[1].children[0].onclick({ preventDefault() {}, shiftKey: false, altKey: true, metaKey: false, ctrlKey: false })
  assert.deepEqual(f.timeline.editableFrameIds(), ['f2'])
  assert.deepEqual(f.timeline.lockedFrameIds(), ['f1'])
  f.frames.children[1].children[0].onclick({ preventDefault() {}, shiftKey: false, altKey: true, metaKey: false, ctrlKey: false })
  assert.deepEqual(f.timeline.editableFrameIds(), ['f2'], 'excluding last editable frame F2 via modifier click is blocked')
  assert.deepEqual(f.timeline.lockedFrameIds(), ['f1'])

  // Alt+click on F1 while F2 is scoped adds F1 -> all frames selected -> resets scope to null (all unlocked)
  f.frames.children[0].children[0].onclick({ preventDefault() {}, shiftKey: false, altKey: true, metaKey: false, ctrlKey: false })
  assert.equal(f.timeline.editableFrameIds(), null, 'selecting all frames resets scope to all unlocked')
  assert.deepEqual(f.timeline.lockedFrameIds(), [])

  // Alt+click on F2 again, then click the scope chip × to unlock all frames
  f.frames.children[1].children[0].onclick({ preventDefault() {}, shiftKey: false, altKey: true, metaKey: false, ctrlKey: false })
  assert.deepEqual(f.timeline.editableFrameIds(), ['f2'])
  const scopeChip2 = tagsBar.children.find(n => n.dataset?.timelineScope === 'subset')
  scopeChip2.onclick()
  assert.equal(f.timeline.editableFrameIds(), null)

  // Frame composite reference promotion from frame menu
  f.frames.children[0].children[0].oncontextmenu({ preventDefault() {}, stopPropagation() {}, clientX: 20, clientY: 20 })
  const saveFrameRefBtn = menu.querySelectorAll('button').find(b => b.textContent === 'Save frame to project references')
  assert.ok(saveFrameRefBtn)
  assert.equal(saveFrameRefBtn.disabled, false)
  saveFrameRefBtn.onclick({ stopPropagation() {} })
  assert.deepEqual(f.promoted.at(-1), {
    frameId: 'f1',
    sourceKind: 'frame_composite',
  })

  // Cel reference promotion: non-empty cel is enabled, empty cel is disabled
  const celF1 = f.frames.children[0].children[1]
  celF1.oncontextmenu({ preventDefault() {}, stopPropagation() {}, clientX: 25, clientY: 25 })
  const saveCelRefBtn = menu.querySelectorAll('button').find(b => b.textContent === 'Save cel to project references')
  assert.ok(saveCelRefBtn)
  assert.equal(saveCelRefBtn.disabled, false)
  saveCelRefBtn.onclick({ stopPropagation() {} })
  assert.deepEqual(f.promoted.at(-1), {
    frameId: 'f1',
    layerId: 'l',
    sourceKind: 'cel',
  })

  const emptyCelF2 = f.frames.children[1].children[1]
  emptyCelF2.oncontextmenu({ preventDefault() {}, stopPropagation() {}, clientX: 25, clientY: 25 })
  const saveEmptyCelBtn = menu.querySelectorAll('button').find(b => b.textContent === 'Save cel to project references')
  assert.ok(saveEmptyCelBtn)
  assert.equal(saveEmptyCelBtn.disabled, true, 'empty cel cannot be promoted as reference')
})
