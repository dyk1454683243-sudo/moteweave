// Provider-free real-UI regression. Run only inside run-with-resource-guard.mjs:
// 2048 MiB heap / 4096 MiB process tree / 180000 ms / 500 ms polling.
// GAMETOOL_PLAYWRIGHT_MODULE points to an installed Playwright ESM entry.
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { encodeRgbaPng, decodePngToRgba } from '../src/editor-project/spriteDocumentStore.js'
const { chromium } = await import(process.env.GAMETOOL_PLAYWRIGHT_MODULE || 'playwright')
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const evidence = await mkdtemp('/private/tmp/gametool-timeline-structure-'), workspace = await mkdtemp(path.join(repo, '.tmp-timeline-structure-'))
const delay = ms => new Promise(r => setTimeout(r, ms)), hash = b => createHash('sha256').update(Buffer.from(b)).digest('hex')
const sock = net.createServer(); sock.listen(0, '127.0.0.1'); await once(sock, 'listening'); const port = sock.address().port; await new Promise(r => sock.close(r))
const origin = `http://127.0.0.1:${port}`, checks = [], errors = [], posts = []
const report = { evidence, workspace, viewport: [1920, 1080], locale: 'en-US', modelCalls: 0, checks, errors }
let server, browser, page, output = '', step = 'setup', release
const W = 32, base = new Uint8Array(W * W * 4)
for (let i = 0; i < base.length; i += 4) base.set([20, 90, 170, 255], i)
const input = path.join(workspace, 'timeline-fixture.png'); await writeFile(input, encodeRgbaPng(W, W, Buffer.from(base)))
async function wait(fn, label) { for (let i = 0; i < 140; i++) { if (await fn()) return; await delay(50) } throw Error(label) }
const idle = () => page.waitForFunction(() => { const s = window.getVnextProjectSession(); return !s.frameLoading && !s.manualGesture && !s.manualWrite && !s.pendingImport && !s.pendingSave && !s.historyBusy && !s.openInFlight() })
const state = () => page.evaluate(() => { const s = window.getVnextProjectSession(), d = s.documents.get(s.project?.canvases?.[s.view.selectedId]?.document_id); return { id: s.project?.id, revision: s.project?.revision, canvas: s.view.selectedId, ids: Object.keys(s.project?.canvases || {}), doc: d, target: s.documentTimeline?.target(d) } })
const tool = id => page.locator(`[data-capability="${id}"]`)
const header = id => page.locator(`[data-structure-kind="frame"][data-structure-id="${id}"]`)
const layer = id => page.locator(`[data-structure-kind="layer"][data-structure-id="${id}"]`)
const shot = name => page.screenshot({ path: path.join(evidence, name + '.png') })
const menu = name => page.getByRole('menuitem', { name, exact: true })
async function choose(id) { await tool('TOOL-01').click(); await page.locator(`.vnext-canvas-tile[data-canvas-id="${id}"]`).click(); await page.locator('#vnext-zoom').click() }
async function paint(x, y, color, waitForSave = true) { await page.locator('#vnext-paint-hex').fill(color); await page.locator('#vnext-paint-hex').press('Enter'); await tool('TOOL-03').click(); const pt = await page.evaluate(({ x, y }) => { const s = window.getVnextProjectSession(), p = s.view.positionOf(s.view.selectedId); return s.view.worldToScreen(p.x + x + .5, p.y + y + .5, document.querySelector('#vnext-canvas-stage').getBoundingClientRect()) }, { x, y }); await page.mouse.click(pt.x, pt.y); if (waitForSave) await idle() }
// Direct session commands prepare data only; every newly delivered action below uses real controls.
async function structure(command) { await page.evaluate(command => window.getVnextProjectSession().changeStructure(command), command); await idle() }
async function action(node, name) { await node.click({ button: 'right' }); await menu(name).click(); await idle() }
async function undo(redo = false) { await page.locator('#vnext-zoom').focus(); await page.keyboard.press(redo ? 'Meta+Shift+z' : 'Meta+z'); await idle() }
async function stop(p) { if (!p || p.exitCode !== null || p.signalCode !== null) return; const done = once(p, 'exit'); p.kill('SIGTERM'); await Promise.race([done, delay(1000)]); if (p.exitCode === null && p.signalCode === null) { p.kill('SIGKILL'); await done } }
try {
  server = spawn(process.execPath, ['server.js'], { cwd: repo, env: { ...process.env, PORT: String(port), EDITOR_WORKSPACE_ROOT: workspace, EDITOR_GENERATED_DIR: path.join(workspace, 'generated'), OPENROUTER_API_KEY: '', GEMINI_API_KEY: '', GOOGLE_API_KEY: '', CHARACTER_IMAGE_API_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'] })
  for (const s of [server.stdout, server.stderr]) s.on('data', b => { output = (output + b).slice(-2048) })
  await wait(() => output.includes('Character tool running'), 'server')
  browser = await chromium.launch({ executablePath: process.env.GAMETOOL_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--disable-gpu'] })
  page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, locale: 'en-US' }); page.setDefaultTimeout(8000)
  page.on('pageerror', e => errors.push(e.message.slice(0, 200)))
  await page.route('**/*', r => { const u = new URL(r.request().url()); return u.origin === origin && !/generate-character|\/messages$/.test(u.pathname) ? r.continue() : r.abort() })
  page.on('request', r => { if (r.method() === 'POST') posts.push({ path: new URL(r.url()).pathname, body: r.postData() }) })
  await page.goto(origin + '/src/ui/vnext/vnext-preview.html'); await page.waitForFunction(() => !!window.getVnextProjectSession?.()); report.url = page.url()
  await page.getByRole('button', { name: 'Close preview', exact: true }).click()
  await page.locator('#vnext-project-btn').click(); await page.locator('[data-project-action="new"]').click(); await wait(async () => Boolean((await state()).id), 'new project'); await idle()
  await page.locator('#vnext-import-input').setInputFiles(input); await wait(async () => (await state()).ids.length === 1, 'import'); await idle(); await choose((await state()).ids[0]); await paint(12, 12, 'FF0000FF'); await choose((await state()).canvas)
  let s = await state(); const f1 = s.target.frame_id, bottom = s.target.layer_id, expected = new Map()
  await structure({ type: 'set-duration', frame_id: f1, duration_ms: 80 }); const p1 = base.slice(); p1.set([255, 0, 0, 255], (12 * W + 12) * 4); expected.set(f1, p1)
  await structure({ type: 'copy-frame', frame_id: f1 }); await paint(13, 12, '00FF00FF'); s = await state(); const f2 = s.target.frame_id, p2 = p1.slice(); p2.set([0, 255, 0, 255], (12 * W + 13) * 4); expected.set(f2, p2)
  await structure({ type: 'set-duration', frame_id: f2, duration_ms: 140 }); await structure({ type: 'copy-frame', frame_id: f2 }); await paint(14, 12, 'FFFF00FF'); s = await state(); const f3 = s.target.frame_id, p3 = p2.slice(); p3.set([255, 255, 0, 255], (12 * W + 14) * 4); expected.set(f3, p3)
  await structure({ type: 'set-duration', frame_id: f3, duration_ms: 220 }); await structure({ type: 'add-layer', name: 'Accent' }); await paint(12, 12, 'FF00FFFF'); s = await state(); const top = s.target.layer_id
  report.project = s.id; report.document = s.doc.document_id; report.canvas = s.canvas

  step = 'keyboard ownership and menus'; await header(f2).click(); await idle(); assert.equal(await page.evaluate(() => document.activeElement.dataset.structureId), f2)
  const count = posts.length; await page.keyboard.press('Delete'); await page.getByText('Delete frame 2?', { exact: true }).waitFor(); assert.equal(await page.evaluate(() => document.activeElement.id), 'vnext-confirm-secondary'); await page.keyboard.press('Tab'); assert.equal(await page.evaluate(() => document.activeElement.id), 'vnext-confirm-primary'); await page.keyboard.press('Tab'); assert.equal(await page.evaluate(() => document.activeElement.id), 'vnext-confirm-secondary'); await shot('01-delete-confirm'); await page.keyboard.press('Space'); assert.equal(posts.length, count); assert.equal(await page.evaluate(() => document.activeElement.dataset.structureId), f2)
  await header(f3).click({ button: 'right' }); await shot('02-frame-menu'); await page.keyboard.press('Escape'); assert.equal(await page.evaluate(() => document.activeElement.dataset.structureId), f3)
  await header(f3).click({ button: 'right' }); await menu('Move earlier').focus(); await page.keyboard.press('Space'); await idle(); await action(header(f3), 'Move earlier'); assert.deepEqual((await state()).doc.frame_order, [f3, f1, f2]); assert.equal((await state()).target.frame_id, f3)
  checks.push('Frame-header Delete confirms; Cancel writes nothing; Escape returns focus; menu reorder keeps stable selected frame')

  step = 'real drag and layer order'; await header(f1).dragTo(header(f2), { targetPosition: { x: 28, y: 10 } }); await idle(); assert.deepEqual((await state()).doc.frame_order, [f3, f2, f1]); assert.equal((await state()).target.frame_id, f1)
  await layer(top).click({ button: 'right' }); await shot('03-layer-menu'); await page.keyboard.press('Escape')
  const a = await layer(top).boundingBox(), b = await layer(bottom).boundingBox(); await page.mouse.move(a.x + 25, a.y + a.height / 2); await page.mouse.down(); await page.mouse.move(b.x + 25, b.y + b.height - 2, { steps: 8 }); await page.mouse.move(b.x + 26, b.y + b.height - 2); await page.locator('.is-drop-after').waitFor(); await shot('04-layer-insertion'); await page.mouse.up(); await idle()
  assert.deepEqual((await state()).doc.layer_order, [bottom, top]); assert.equal((await state()).target.layer_id, top)
  await undo(); assert.deepEqual((await state()).doc.layer_order, [top, bottom]); await undo(true); assert.deepEqual((await state()).doc.layer_order, [bottom, top])
  checks.push('Real header/name drag uses insertion position; layer reorder Undo/Redo preserves both identities and all cels')

  step = 'delete and history'; await header(f2).click(); await idle(); await page.keyboard.press('Delete'); await page.locator('#vnext-confirm-primary').click(); await idle(); assert.deepEqual((await state()).doc.frame_order, [f3, f1]); assert.equal((await state()).target.frame_id, f1)
  await undo(); assert.deepEqual((await state()).doc.frame_order, [f3, f2, f1]); await undo(true); assert.deepEqual((await state()).doc.frame_order, [f3, f1])
  await layer(top).click(); await idle(); await page.keyboard.press('Delete'); await page.getByText('Delete layer “Accent”?', { exact: true }).waitFor(); await page.locator('#vnext-confirm-primary').click(); await idle(); assert.deepEqual((await state()).doc.layer_order, [bottom]); assert.equal((await state()).target.layer_id, bottom)
  await undo(); assert.deepEqual((await state()).doc.layer_order, [bottom, top]); await undo(true); assert.deepEqual((await state()).doc.layer_order, [bottom])
  await layer(bottom).click({ button: 'right' }); assert.equal(await menu('Delete layer').isDisabled(), true); await page.keyboard.press('Escape')
  checks.push('Frame/layer delete chooses the neighbor; Undo and Redo restore exact structure; last layer stays protected')

  step = 'locks, last frame and text/cel ownership'; await page.getByRole('button', { name: `Lock layer ${(await state()).doc.layers[bottom].name}`, exact: true }).click(); await idle(); await header(f1).click({ button: 'right' }); assert.equal(await menu('Delete frame').isDisabled(), true); await page.keyboard.press('Escape')
  await layer(bottom).click({ button: 'right' }); assert.equal(await menu('Move up').isDisabled(), true); await menu('Rename layer').click(); const rename = page.getByRole('textbox', { name: 'Rename layer', exact: true }); await rename.fill('abc'); await rename.press('Backspace'); assert.equal(await rename.inputValue(), 'ab'); await page.locator('#vnext-confirm-secondary').click()
  await page.getByRole('button', { name: `Unlock layer ${(await state()).doc.layers[bottom].name}`, exact: true }).click(); await idle()
  await page.locator('.vnext-cel').first().click(); await idle(); const beforeCel = posts.length; await page.keyboard.press('Delete'); assert.equal(await page.locator('#vnext-confirm-primary').isVisible(), false); assert.equal(posts.length, beforeCel)
  await header(f1).click({ button: 'right' }); await menu('Delete frame').click(); await page.locator('#vnext-confirm-primary').click(); await idle(); await header(f3).click({ button: 'right' }); assert.equal(await menu('Delete frame').isDisabled(), true); await shot('05-last-frame-protected'); await page.keyboard.press('Escape'); await undo()
  checks.push('Locked layers protect delete/move; last frame cannot be deleted; text Backspace and cel Delete cannot delete whole items')

  step = 'stale confirmation'; await header(f3).click({ button: 'right' }); await menu('Delete frame').click(); const beforeStale = posts.length; await page.evaluate(() => { const s = window.getVnextProjectSession(); s.api.openEpoch.next() }); await page.locator('#vnext-confirm-primary').click(); await idle(); assert.equal(posts.length, beforeStale); assert.deepEqual((await state()).doc.frame_order, [f3, f1])
  checks.push('A confirmation from a superseded open context cannot submit a delete')

  step = 'delayed failed write'; const route = u => u.pathname.endsWith('/working-structure'), gate = new Promise(r => release = r); let waiting = false
  await page.route(route, async r => { waiting = true; await gate; await r.fulfill({ status: 400, contentType: 'application/json', body: '{"error":"invalid_request"}' }) }, { times: 1 })
  const beforeFail = await state(); await header(f1).click({ button: 'right' }); await menu('Move earlier').click(); await wait(() => waiting, 'delayed structure write')
  assert.equal(await header(f3).isDisabled(), true); assert.equal(await page.getByRole('button', { name: 'Add layer', exact: true }).isDisabled(), true); assert.equal(await tool('FILE-01').isDisabled(), true); await shot('07-save-waiting'); release(); await idle()
  assert.deepEqual((await state()).doc.frame_order, beforeFail.doc.frame_order); assert.deepEqual((await state()).target, beforeFail.target); assert.equal(await header(f3).isDisabled(), false)
  step = 'unknown write and exact retry'; let seen = 0, first; await page.route(route, async r => { if (!seen++) { first = r.request().postData(); await r.fetch(); await r.abort('failed') } else { assert.equal(r.request().postData(), first); await r.continue() } }); await header(f1).click({ button: 'right' }); await menu('Move earlier').click(); await page.getByText('Layer or frame save pending', { exact: true }).waitFor(); assert.equal(await header(f3).isDisabled(), true); await page.locator('#vnext-confirm-primary').click(); await idle(); await page.unroute(route); assert.equal(seen, 2); assert.deepEqual((await state()).doc.frame_order, [f1, f3]); assert.equal((await state()).doc.revision, beforeFail.doc.revision + 1)
  checks.push('Known failure retains selection/order; lost response keeps lock and retries identical operation exactly once')

  step = 'reopen, playback, export'; s = await state(); await page.reload(); await page.waitForFunction(() => !!window.getVnextProjectSession?.()); await page.locator('#vnext-project-btn').click(); await page.locator('[data-project-action="open"]').click(); await page.locator(`[data-project-id="${s.id}"]`).click(); await page.locator('#vnext-open-confirm').click(); await idle(); await choose(s.canvas); assert.deepEqual((await state()).doc.frame_order, [f1, f3]); assert.deepEqual((await state()).doc.layer_order, [bottom])
  await header(f1).click(); await idle(); const beforePlay = posts.length; await page.locator('.vnext-play-nav button').nth(2).click(); await page.waitForFunction(() => document.querySelector('.vnext-play-current').textContent === '02'); await page.locator('.vnext-play-nav button').nth(2).click(); assert.equal(posts.length, beforePlay)
  await tool('FILE-01').click(); await page.waitForFunction(() => !document.querySelector('#vnext-export-submit').disabled); await page.locator('#vnext-export-preview').evaluate(n => n.decode()); await page.locator('#vnext-export-json').check(); await shot('06-reordered-export'); const downloads = []; page.on('download', d => downloads.push(d)); await page.locator('#vnext-export-submit').click(); await wait(() => downloads.length === 2, 'PNG and JSON download')
  const out = {}; for (const d of downloads) { const ext = d.suggestedFilename().endsWith('.json') ? 'json' : 'png'; const file = path.join(evidence, 'timeline-sheet.' + ext); await d.saveAs(file); out[ext] = await readFile(file) }
  const meta = JSON.parse(out.json), png = decodePngToRgba(out.png), grid = new Uint8Array(64 * 32 * 4); assert.deepEqual(meta.frames.map(f => f.id), [f1, f3]); assert.deepEqual(meta.frames.map(f => f.duration_ms), [80, 220]); assert.equal(meta.source.revision, (await state()).doc.revision)
  for (const [i, id] of [f1, f3].entries()) for (let y = 0; y < W; y++) grid.set(expected.get(id).subarray(y * W * 4, (y + 1) * W * 4), (y * 64 + i * W) * 4)
  assert.deepEqual([png.width, png.height], [64, 32]); assert.equal(hash(png.rgba), hash(grid)); assert.deepEqual(errors, [])
  checks.push('Reopen keeps saved order; playback follows it without writes; exported PNG pixels and JSON identities/durations/revision match exactly')

  step = 'linked copies'; await page.keyboard.press('Escape'); await header(f1).click(); await idle()
  const cel = (doc, frame, lid = bottom) => Object.values(doc.cels).find(c => c.frame_id === frame && c.layer_id === lid)
  const chain = () => page.getByRole('button', { name: `Link copies ${(s.doc.layers[bottom]).name}`, exact: true })
  const copy = async frame => { await header(frame).click({ button: 'right' }); await menu('Copy frame').click(); await page.locator('#vnext-confirm-primary').click(); await idle(); return (await state()).target.frame_id }
  s = await state(); const originalCanvas = s.canvas, originalDocument = s.doc.document_id
  assert.equal(await chain().getAttribute('aria-pressed'), 'false')
  await structure({ type: 'add-layer', name: 'Unlinked accent' }); const accent = (await state()).target.layer_id; await layer(bottom).click(); await idle()
  const beforeSpace = posts.filter(p => p.path.endsWith('/working-structure')).length; await chain().focus(); await page.keyboard.press('Space'); await idle(); assert.equal(await chain().getAttribute('aria-pressed'), 'true'); assert.equal(posts.filter(p => p.path.endsWith('/working-structure')).length, beforeSpace + 1)
  await header(f1).click({ button: 'right' }); await menu('Copy frame').click(); await page.getByText(`Linked layers: ${s.doc.layers[bottom].name}`, { exact: true }).waitFor(); await shot('08-linked-copy-confirm'); await page.locator('#vnext-confirm-primary').click(); await idle()
  const linkedFrame = (await state()).target.frame_id; s = await state(); const group = Object.values(s.doc.links.groups)[0]
  assert.deepEqual(new Set(group), new Set([cel(s.doc, f1).id, cel(s.doc, linkedFrame).id])); const independentHash = cel(s.doc, f3).block.sha256, oldGroupHash = cel(s.doc, f1).block.sha256
  const accentBefore = s.doc.frame_order.map(f => cel(s.doc, f, accent).block)
  await paint(17, 12, 'FFFFFFFF'); s = await state(); const groupHash = cel(s.doc, f1).block.sha256
  assert.notEqual(groupHash, oldGroupHash); assert.equal(cel(s.doc, linkedFrame).block.sha256, groupHash); assert.equal(cel(s.doc, f3).block.sha256, independentHash); assert.deepEqual(s.doc.frame_order.map(f => cel(s.doc, f, accent).block), accentBefore)
  await undo(); assert.equal(cel((await state()).doc, f1).block.sha256, oldGroupHash); await undo(true); assert.equal(cel((await state()).doc, linkedFrame).block.sha256, groupHash)
  checks.push('Existing chain enables future copies; two cels share a group and one write/Undo/Redo changes both, not other layers or equal-hash independent frames')

  step = 'off, blank, membership'; await chain().click(); await idle(); const independentFrame = await copy(linkedFrame)
  s = await state(); assert.equal(Object.values(s.doc.links.groups).flat().includes(cel(s.doc, independentFrame).id), false)
  await paint(18, 12, '00FFFFFF'); assert.equal(cel((await state()).doc, linkedFrame).block.sha256, groupHash)
  await header(linkedFrame).click(); await idle(); await paint(19, 12, 'FF00FFFF'); s = await state(); assert.equal(cel(s.doc, linkedFrame).block.sha256, cel(s.doc, f1).block.sha256, 'off does not unlink an old group')
  await chain().click(); await idle(); await page.getByRole('button', { name: 'Add blank frame', exact: true }).click(); await idle(); s = await state(); const blankFrame = s.target.frame_id
  assert.equal(cel(s.doc, blankFrame).block, null); assert.equal(Object.values(s.doc.links.groups).flat().includes(cel(s.doc, blankFrame).id), false)
  await header(linkedFrame).click({ button: 'right' }); await menu('Delete frame').click(); await page.locator('#vnext-confirm-primary').click(); await idle(); assert.equal(Object.values((await state()).doc.links.groups)[0].length, 1)
  await undo(); assert.equal(Object.values((await state()).doc.links.groups)[0].length, 2); await action(header(linkedFrame), 'Move earlier'); assert.equal(Object.values((await state()).doc.links.groups)[0].length, 2); await undo()
  checks.push('Off preserves existing links but new copies are independent; blank frames stay unlinked; deletion, reorder and Undo retain exact membership')

  step = 'linked locks and failures'; await page.getByRole('button', { name: `Lock layer ${s.doc.layers[bottom].name}`, exact: true }).click(); await idle(); assert.equal(await chain().isDisabled(), true)
  await header(f1).click({ button: 'right' }); assert.equal(await menu('Copy frame').isDisabled(), true); await page.keyboard.press('Escape'); await shot('09-linked-locked'); await page.getByRole('button', { name: `Unlock layer ${s.doc.layers[bottom].name}`, exact: true }).click(); await idle()
  const toggleGate = new Promise(r => release = r); waiting = false
  await page.route(route, async r => { waiting = true; await toggleGate; await r.fulfill({ status: 400, contentType: 'application/json', body: '{"error":"invalid_request"}' }) }, { times: 1 })
  await chain().click(); await wait(() => waiting, 'delayed link preference'); assert.equal(await chain().isDisabled(), true); assert.equal(await tool('TOOL-03').isDisabled(), true); await shot('10-link-saving'); release(); await idle(); assert.equal(await chain().getAttribute('aria-pressed'), 'true'); assert.equal(await chain().isDisabled(), false)
  checks.push('Locked linked layers reject both toggle and Copy frame; delayed preference save locks controls; known failure leaves saved preference unchanged')

  step = 'linked unknown pixel retry'; await header(f1).click(); await idle(); s = await state(); const beforePixel = s.revision, pixelRoute = u => u.pathname.endsWith('/working-pixels'); let pixelSeen = 0, frozenPixel
  await page.route(pixelRoute, async r => { const request = { url: r.request().url(), body: r.request().postDataBuffer() }; if (!pixelSeen++) { frozenPixel = request; await r.fetch(); await r.abort('failed') } else { assert.deepEqual(request, frozenPixel); await r.continue() } })
  await paint(20, 12, 'FFFF00FF', false); await page.getByText('Stroke save not confirmed', { exact: true }).waitFor(); assert.equal(await chain().isDisabled(), true); await page.locator('#vnext-confirm-primary').click(); await idle(); await page.unroute(pixelRoute)
  s = await state(); assert.equal(pixelSeen, 2); assert.equal(s.revision, beforePixel + 1); assert.equal(cel(s.doc, f1).block.sha256, cel(s.doc, linkedFrame).block.sha256)
  checks.push('Lost linked-write ACK keeps the lock; Retry sends identical bytes, URL, grant and operation; exactly one project revision commits')

  step = 'linked preview and isolated derived apply'; const sourceDoc = structuredClone(s.doc), canvasCount = s.ids.length
  const proposal = { type: 'fill-rect', rect: { x: 21, y: 12, w: 1, h: 1 }, color: [255, 255, 255, 255] }
  await page.evaluate(async operation => { const session = window.getVnextProjectSession(); window.linkedProposalSource = await session.preparePixelEdit(); window.linkedProposal = session.reviewPixelEdit(window.linkedProposalSource, operation) }, proposal)
  await page.getByText('Preview pixel edit', { exact: true }).waitFor(); const framesText = `Linked frames (2): ${sourceDoc.frame_order.map((f, i) => [f, i + 1]).filter(([f]) => [f1, linkedFrame].includes(f)).map(([, i]) => i).join(', ')}`
  await page.getByText(framesText, { exact: true }).waitFor(); await shot('11-linked-preview'); const beforeCancel = posts.length; await page.locator('#vnext-confirm-secondary').click(); assert.match(await page.evaluate(() => window.linkedProposal), /cancelled/); assert.equal(posts.length, beforeCancel)
  await page.evaluate(operation => { window.linkedProposal = window.getVnextProjectSession().reviewPixelEdit(window.linkedProposalSource, operation) }, proposal); await page.locator('#vnext-confirm-primary').click(); assert.match(await page.evaluate(() => window.linkedProposal), /beside the original/); await idle()
  s = await state(); assert.equal(s.ids.length, canvasCount + 1)
  const docs = await page.evaluate(original => { const session = window.getVnextProjectSession(); return { source: session.documents.get(original), copies: [...session.documents.values()].filter(d => d.document_id !== original && d.links) } }, originalDocument)
  assert.deepEqual(docs.source, sourceDoc); assert.equal(docs.copies.length, 1); assert.deepEqual(docs.copies[0].links, sourceDoc.links); assert.equal(cel(docs.copies[0], f1).block.sha256, cel(docs.copies[0], linkedFrame).block.sha256); assert.notEqual(cel(docs.copies[0], f1).block.sha256, cel(sourceDoc, f1).block.sha256)
  checks.push('Provider-free Preview names affected layer/frames; Cancel writes nothing; Apply changes only a new derived document and its linked group')

  step = 'linked reopen and rendered state'; await page.reload(); await page.waitForFunction(() => !!window.getVnextProjectSession?.()); await page.locator('#vnext-project-btn').click(); await page.locator('[data-project-action="open"]').click(); await page.locator(`[data-project-id="${s.id}"]`).click(); await page.locator('#vnext-open-confirm').click(); await idle(); await choose(originalCanvas); await layer(bottom).click(); await header(f1).click(); await idle()
  assert.deepEqual((await state()).doc.links, sourceDoc.links); assert.equal(await chain().getAttribute('aria-pressed'), 'true'); await shot('12-linked-reopened')
  await tool('TOOL-01').click(); await page.locator('#vnext-canvas-stage').click({ position: { x: 20, y: 20 } }); await wait(async () => !(await state()).canvas, 'deselected canvas'); assert.equal(await page.locator('[data-capability="TIME-07"]').first().isDisabled(), true); await choose(originalCanvas); assert.equal(await chain().isDisabled(), false); assert.deepEqual(errors, [])
  checks.push('Reopen restores links/preference; Space toggles once; no canvas disables the old chain and reselection restores it without page errors')

  step = 'linked export'; await tool('FILE-01').click(); await page.waitForFunction(() => !document.querySelector('#vnext-export-submit').disabled); await page.locator('#vnext-export-json').check(); const linkedDownloads = downloads.length; await page.locator('#vnext-export-submit').click(); await wait(() => downloads.length === linkedDownloads + 2, 'linked PNG and JSON')
  const linkedOutput = {}; for (const d of downloads.slice(linkedDownloads)) { const ext = d.suggestedFilename().endsWith('.json') ? 'json' : 'png'; const file = path.join(evidence, 'linked-sheet.' + ext); await d.saveAs(file); linkedOutput[ext] = await readFile(file) }
  const linkedMeta = JSON.parse(linkedOutput.json), linkedPng = decodePngToRgba(linkedOutput.png)
  const finalPixels = p1.slice(); for (const [x, color] of [[17,[255,255,255,255]],[19,[255,0,255,255]],[20,[255,255,0,255]]]) finalPixels.set(color, (12 * W + x) * 4)
  const independentPixels = p1.slice(); independentPixels.set([255,255,255,255], (12 * W + 17) * 4); independentPixels.set([0,255,255,255], (12 * W + 18) * 4)
  const expectedLinked = new Map([[f1,finalPixels],[f3,p3],[linkedFrame,finalPixels],[independentFrame,independentPixels],[blankFrame,new Uint8Array(W * W * 4)]])
  assert.equal(Object.hasOwn(linkedMeta, 'links'), false); assert.equal(linkedMeta.source.revision, sourceDoc.revision)
  for (const frame of linkedMeta.frames) { const extracted = new Uint8Array(W * W * 4); for (let y = 0; y < W; y++) extracted.set(linkedPng.rgba.subarray(((frame.y + y) * linkedPng.width + frame.x) * 4, ((frame.y + y) * linkedPng.width + frame.x + W) * 4), y * W * 4); assert.equal(hash(extracted), hash(expectedLinked.get(frame.id))) }
  await page.keyboard.press('Escape'); checks.push('Linked and independent frames export exact saved RGBA, blank pixels and revision without relationship metadata')

  step = 'cancelled project open cannot replace linked edits'; const projectA = s.id
  const openProject = async id => { await page.locator('#vnext-project-btn').click(); await page.locator('[data-project-action="open"]').click(); await page.locator(`button[data-project-id="${id}"]`).click(); await page.locator('#vnext-open-confirm').click() }
  await page.locator('#vnext-project-btn').click(); await page.locator('[data-project-action="new"]').click(); await wait(async () => (await state()).id !== projectA, 'new fixture project'); await idle(); const projectB = (await state()).id
  await openProject(projectA); await idle(); await choose(originalCanvas); await layer(bottom).click(); await header(f1).click(); await idle()
  const openGate = new Promise(r => release = r); waiting = false; let lateDelivered = false
  await page.route(u => u.pathname === `/api/editor/projects/${projectB}`, async r => { const response = await r.fetch(); waiting = true; await openGate; await r.fulfill({ response }).catch(() => {}); lateDelivered = true }, { times: 1 })
  await openProject(projectB); await wait(() => waiting, 'delayed open'); assert.equal(await chain().isDisabled(), true); assert.equal(await tool('TOOL-03').isDisabled(), true)
  await page.keyboard.press('Escape'); assert.equal(await chain().isDisabled(), false); await paint(22, 12, '00FFFFFF'); release(); await wait(() => lateDelivered, 'late cancelled response'); await idle()
  s = await state(); assert.equal(s.id, projectA); assert.equal(cel(s.doc, f1).block.sha256, cel(s.doc, linkedFrame).block.sha256); assert.deepEqual(errors, [])
  checks.push('A delayed project open disables link/pixel controls; Escape resumes group editing immediately and its late response cannot switch projects')
  report.status = 'passed'; report.finalRevision = (await state()).doc.revision; report.pngHash = hash(out.png); console.log('PASS ' + checks.length + ' groups; ' + evidence)
} catch (e) { report.status = 'failed'; report.step = step; report.error = e.stack; await shot('failure').catch(() => {}); console.error(step + ': ' + e.stack); process.exitCode = 1 }
finally { release?.(); await browser?.close(); await stop(server); await writeFile(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2)); console.log('report: ' + path.join(evidence, 'report.json')) }
