// Provider-free UI check. Run under the repository resource guard, 4096 MiB / 180 s.
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { encodeRgbaPng } from '../src/editor-project/spriteDocumentStore.js'
const { chromium } = await import(process.env.GAMETOOL_PLAYWRIGHT_MODULE || 'playwright')
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const evidence = await mkdtemp('/private/tmp/gametool-onion-'), workspace = await mkdtemp(path.join(repo, '.tmp-onion-'))
const delay = ms => new Promise(r => setTimeout(r, ms)), hash = b => createHash('sha256').update(Buffer.from(b)).digest('hex')
const sock = net.createServer(); sock.listen(0, '127.0.0.1'); await once(sock, 'listening'); const port = sock.address().port; await new Promise(r => sock.close(r))
const origin = `http://127.0.0.1:${port}`, checks = [], errors = [], posts = []
const report = { evidence, workspace, viewport: [1920, 1080], locale: 'en-US', modelCalls: 0, checks, errors, consoleErrors: [] }
let server, browser, page, output = '', step = 'setup', release
const input = path.join(workspace, 'onion-fixture.png'); await writeFile(input, encodeRgbaPng(32, 32, Buffer.alloc(32 * 32 * 4)))
async function wait(fn, label) { for (let i = 0; i < 140; i++) { if (await fn()) return; await delay(50) } throw Error(label) }
const idle = () => page.waitForFunction(() => { const s = window.getVnextProjectSession(); return !s.frameLoading && !s.manualGesture && !s.manualWrite && !s.pendingImport && !s.pendingSave && !s.historyBusy && !s.openInFlight() })
const ready = () => page.waitForFunction(() => document.querySelector('#vnext-onion-toggle').dataset.state === 'ready')
const state = () => page.evaluate(() => { const s = window.getVnextProjectSession(), d = s.documents.get(s.project?.canvases?.[s.view.selectedId]?.document_id); return { id: s.project?.id, revision: s.project?.revision, canvas: s.view.selectedId, ids: Object.keys(s.project?.canvases || {}), doc: d, target: s.documentTimeline?.target(d) } })
const tool = id => page.locator(`[data-capability="${id}"]`), toggle = () => page.locator('#vnext-onion-toggle')
const header = id => page.locator(`[data-structure-kind="frame"][data-structure-id="${id}"]`)
const shot = name => page.screenshot({ path: path.join(evidence, name + '.png') })
const pixel = (x, y) => page.locator('.vnext-onion-overlay').evaluate((n, p) => [...n.getContext('2d').getImageData(p.x, p.y, 1, 1).data], { x, y })
const point = (x, y) => page.evaluate(({ x, y }) => { const s = window.getVnextProjectSession(), p = s.view.positionOf(s.view.selectedId); return s.view.worldToScreen(p.x + x + .5, p.y + y + .5, document.querySelector('#vnext-canvas-stage').getBoundingClientRect()) }, { x, y })
async function choose(id) { await tool('TOOL-01').click(); await page.locator(`.vnext-canvas-tile[data-canvas-id="${id}"]`).click(); await page.locator('#vnext-zoom').click() }
async function paint(x, color) { await page.locator('#vnext-paint-hex').fill(color); await page.locator('#vnext-paint-hex').press('Enter'); await tool('TOOL-03').click(); const p = await point(x, 16); await page.mouse.click(p.x, p.y); await idle() }
async function structure(command) { await page.evaluate(c => window.getVnextProjectSession().changeStructure(c), command); await idle() }
async function setting(name, value) { const n = page.locator(`[data-onion-setting="${name}"]`); await n.fill(String(value)); await n.dispatchEvent('change') }
async function exportPng(name, mode = 'sheet') { await tool('FILE-01').click(); await page.locator(`#vnext-export-${mode}`).click(); await page.waitForFunction(() => !document.querySelector('#vnext-export-submit').disabled); const got = page.waitForEvent('download'); await page.locator('#vnext-export-submit').click(); const d = await got, file = path.join(evidence, name + '.png'); await d.saveAs(file); await page.keyboard.press('Escape'); return hash(await readFile(file)) }
async function stop(p) { if (!p || p.exitCode !== null || p.signalCode !== null) return; const done = once(p, 'exit'); p.kill('SIGTERM'); await Promise.race([done, delay(1000)]); if (p.exitCode === null && p.signalCode === null) { p.kill('SIGKILL'); await done } }
try {
  server = spawn(process.execPath, ['server.js'], { cwd: repo, env: { ...process.env, PORT: String(port), EDITOR_WORKSPACE_ROOT: workspace, EDITOR_GENERATED_DIR: path.join(workspace, 'generated'), OPENROUTER_API_KEY: '', GEMINI_API_KEY: '', GOOGLE_API_KEY: '', CHARACTER_IMAGE_API_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'] })
  for (const s of [server.stdout, server.stderr]) s.on('data', b => { output = (output + b).slice(-2048) })
  await wait(() => output.includes('Character tool running'), 'server')
  browser = await chromium.launch({ executablePath: process.env.GAMETOOL_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--disable-gpu'] })
  page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, locale: 'en-US' }); page.setDefaultTimeout(8000)
  page.on('pageerror', e => errors.push(e.message.slice(0, 200)))
  page.on('console', m => { if (m.type() === 'error' && report.consoleErrors.length < 20) report.consoleErrors.push(m.text().slice(0, 200)) })
  await page.route('**/*', r => { const u = new URL(r.request().url()); return u.origin === origin && !/generate-character|\/messages$/.test(u.pathname) ? r.continue() : r.abort() })
  page.on('request', r => { if (r.method() === 'POST') posts.push(new URL(r.url()).pathname) })
  await page.goto(origin + '/src/ui/vnext/vnext-preview.html'); await page.waitForFunction(() => !!window.getVnextProjectSession?.()); report.url = page.url(); report.title = await page.title()
  assert.match(report.title, /GameTool/); assert.equal(await page.locator('main').isVisible(), true)
  assert.equal(await toggle().isDisabled(), true); await page.getByRole('button', { name: 'Close preview', exact: true }).click()
  await page.locator('#vnext-project-btn').click(); await page.locator('[data-project-action="new"]').click(); await wait(async () => Boolean((await state()).id), 'new'); await idle()
  await page.locator('#vnext-import-input').setInputFiles(input); await wait(async () => (await state()).ids.length === 1, 'import'); await idle(); await choose((await state()).ids[0])
  await page.locator('#vnext-brush-size').fill('5'); await page.locator('#vnext-brush-size').press('Enter'); await paint(9, '203040FF'); await choose((await state()).canvas)
  let s = await state(); const f1 = s.target.frame_id
  await structure({ type: 'add-frame' }); await paint(16, '203040FF'); const f2 = (await state()).target.frame_id
  await structure({ type: 'add-frame' }); await paint(23, '203040FF'); const f3 = (await state()).target.frame_id
  await header(f2).click(); await idle(); s = await state(); report.project = s.id; report.document = s.doc.document_id
  const baseline = JSON.stringify(s.doc), beforePosts = posts.length, originalPng = await exportPng('export-off'), originalFrame = await exportPng('frame-off', 'frame')
  step = 'display and controls'; await toggle().click(); await ready(); assert.equal((await pixel(9, 16))[3], 89); assert.equal((await pixel(23, 16))[3], 89); assert.equal((await pixel(16, 16))[3], 0)
  await page.getByRole('button', { name: 'Onion skin settings', exact: true }).click(); await page.locator('.vnext-onion-pop').waitFor(); await shot('01-onion-settings')
  await setting('opacity', 70); await ready(); assert.equal((await pixel(9, 16))[3], 179)
  await setting('previousTint', '#22aa44'); await ready(); const green = await pixel(9, 16); assert.ok(Math.abs(green[0] - 34) <= 1 && Math.abs(green[1] - 170) <= 1)
  await setting('previous', 0); await ready(); assert.equal((await pixel(9, 16))[3], 0); await page.getByRole('button', { name: 'More previous frames', exact: true }).click(); await ready(); assert.equal((await pixel(9, 16))[3], 179)
  await setting('previous', 9); assert.equal(await page.locator('[data-onion-setting="previous"]').inputValue(), '1')
  await setting('previousTint', '#de9693'); await setting('opacity', 35); await ready(); await page.locator('[data-onion-setting="opacity"]').press('Escape'); assert.equal(await page.locator('.vnext-onion-pop').isVisible(), false)
  assert.equal(JSON.stringify((await state()).doc), baseline); assert.equal(posts.length, beforePosts); assert.equal(await exportPng('export-on'), originalPng); assert.equal(await exportPng('frame-on', 'frame'), originalFrame)
  checks.push('Existing settings, bounds, tint, opacity and steppers work; onion toggles/settings make no writes; PNG sheet is byte-identical')

  step = 'first/last and playback'; await header(f1).click(); await idle(); await ready(); assert.equal((await pixel(23, 16))[3], 0)
  await page.getByRole('button', { name: 'Onion skin settings', exact: true }).click(); await setting('next', 3); await ready(); assert.equal((await pixel(23, 16))[3], 45); await page.locator('[data-onion-setting="next"]').press('Escape')
  await header(f3).click(); await idle(); await ready(); assert.equal((await pixel(9, 16))[3], 0)
  await header(f2).click(); await idle(); await ready(); await page.locator('.vnext-play-nav button').nth(2).click(); assert.equal(await page.locator('.vnext-onion-overlay').count(), 0); await page.locator('.vnext-play-nav button').nth(2).click(); await ready()
  checks.push('First/last frames do not wrap; distance fades; playback hides and stop restores ghosts')

  step = 'eyedropper and drawing isolation'; await tool('COLOR-06').click(); const eyedrop = await point(9, 16); await page.mouse.click(eyedrop.x, eyedrop.y); await idle(); assert.equal(await page.locator('#vnext-paint-alpha').inputValue(), '0')
  await page.locator('#vnext-paint-hex').fill('203040FF'); await page.locator('#vnext-paint-hex').press('Enter'); await tool('TOOL-03').click(); const draw = await point(16, 23); await page.mouse.move(draw.x, draw.y); await page.mouse.down(); await page.locator('.vnext-pixel-stroke-preview').waitFor(); assert.equal(await page.locator('.vnext-onion-overlay').count(), 1); await shot('02-drawing-with-ghosts'); await page.keyboard.press('Escape'); await page.mouse.up(); await idle(); assert.equal(JSON.stringify((await state()).doc), baseline)
  checks.push('Eyedropper samples transparent saved pixels, not ghost tint; cancelled stroke keeps display ghosts and writes nothing')

  step = 'late response and project context'; await toggle().click(); const match = u => u.pathname.includes('/blocks/'), gate = new Promise(r => release = r); let waiting = false
  await page.route(match, async r => { waiting = true; await gate; await r.continue() }, { times: 1 }); await toggle().click(); await wait(() => waiting, 'delayed onion read'); await toggle().click(); release(); await delay(100); assert.equal(await page.locator('.vnext-onion-overlay').count(), 0)
  let waitingAgain = false; const nextGate = new Promise(r => release = r)
  await page.route(match, async r => { waitingAgain = true; await nextGate; await r.continue() }, { times: 1 }); await toggle().click(); await wait(() => waitingAgain, 'delayed owner read'); await choose(s.ids.find(id => id !== s.canvas)); release(); await delay(100); assert.equal(await toggle().isDisabled(), true); assert.equal(await page.locator('.vnext-onion-overlay').count(), 0); await choose(s.canvas); await ready()
  checks.push('Turning off while a neighbor read is delayed discards its result; selecting the one-frame source hides ghosts')

  step = 'read failure recovery'; await toggle().click(); await page.route(match, r => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"injected"}' }), { times: 1 }); await toggle().click(); await page.waitForFunction(() => document.querySelector('#vnext-onion-toggle').dataset.state === 'error'); assert.equal(await page.locator('.vnext-onion-overlay').count(), 0); assert.equal(await tool('TOOL-03').isDisabled(), false)
  await toggle().click(); await toggle().click(); await ready(); assert.equal(await page.locator('#vnext-canvas-status').textContent(), ''); await shot('03-onion-restored'); assert.deepEqual(errors, []); assert.equal(JSON.stringify((await state()).doc), baseline)
  await toggle().click(); await page.route(match, r => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"injected"}' }), { times: 1 }); await toggle().click(); await page.waitForFunction(() => document.querySelector('#vnext-onion-toggle').dataset.state === 'error')
  await page.locator('#vnext-canvas-status').evaluate(n => { n.textContent = 'A later save needs recovery.' }); await toggle().click(); await toggle().click(); await ready(); assert.equal(await page.locator('#vnext-canvas-status').textContent(), 'A later save needs recovery.')
  checks.push('Neighbor failure clears ghosts without locking edits; off/on retries; saved document is unchanged')
  step = 'project transition'; let creating = false; const createGate = new Promise(r => release = r)
  await page.route('**/api/editor/projects/v1', async r => { creating = true; await createGate; await r.fulfill({ status: 400, contentType: 'application/json', body: '{"error":"invalid_request"}' }) }, { times: 1 })
  await page.locator('#vnext-project-btn').click(); await page.locator('[data-project-action="new"]').click(); await wait(() => creating, 'create transition'); assert.equal(await toggle().isDisabled(), true); assert.equal(await page.locator('.vnext-onion-overlay').count(), 0)
  release(); await idle(); await ready(); assert.equal((await state()).id, s.id); assert.equal(JSON.stringify((await state()).doc), baseline)
  await toggle().click(); await shot('04-onion-off'); await toggle().click(); await ready()
  assert.ok(report.consoleErrors.every(message => /Failed to load resource.*status of (400|500)/.test(message)), JSON.stringify(report.consoleErrors))
  checks.push('New-project transition hides and disables onion controls; confirmed failure restores ghosts on the unchanged original document; no unexpected console errors')
  report.status = 'passed'; report.pngHash = originalPng; console.log('PASS ' + checks.length + ' groups; ' + evidence)
} catch (e) { report.status = 'failed'; report.step = step; report.error = e.stack; await shot('failure').catch(() => {}); console.error(step + ': ' + e.stack); process.exitCode = 1 }
finally { release?.(); await browser?.close(); await stop(server); await writeFile(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2)); console.log('report: ' + path.join(evidence, 'report.json')) }
