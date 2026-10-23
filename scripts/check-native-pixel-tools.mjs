// Provider-free UI acceptance: the response is a native-kernel fixture, never AI artwork.
// Run inside resource guard: 2048 MiB heap / 4096 MiB tree / 180 seconds.
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, writeFile } from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { encodeRgbaPng } from '../src/editor-project/spriteDocumentStore.js'
import { createPixelToolSession } from '../src/editor-project/pixelToolSession.js'
const { chromium } = await import(process.env.GAMETOOL_PLAYWRIGHT_MODULE || 'playwright')
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const evidence = await mkdtemp('/private/tmp/gametool-native-pixels-'), workspace = await mkdtemp(path.join(repo, '.tmp-native-pixels-'))
const delay = ms => new Promise(r => setTimeout(r, ms)), checks = [], errors = []
const sock = net.createServer(); sock.listen(0, '127.0.0.1'); await once(sock, 'listening'); const port = sock.address().port; await new Promise(r => sock.close(r))
const origin = `http://127.0.0.1:${port}`, report = { evidence, workspace, viewport: [1920, 1080], locale: 'en-US', modelCalls: 0, checks, errors }
let server, browser, page, output = '', step = 'setup', responseMode = 'candidate', requests = 0, release
const input = path.join(workspace, 'blank-fixture.png'); await writeFile(input, encodeRgbaPng(64, 64, Buffer.alloc(16384)))
async function wait(fn, label) { for (let i = 0; i < 140; i++) { if (await fn()) return; await delay(50) } throw Error(label) }
const idle = () => page.waitForFunction(() => { const s = window.getVnextProjectSession(); return !s.frameLoading && !s.manualGesture && !s.manualWrite && !s.pendingImport && !s.pendingSave && !s.historyBusy && !s.openInFlight() })
const state = () => page.evaluate(() => { const s = window.getVnextProjectSession(), d = s.documents.get(s.project?.canvases?.[s.view.selectedId]?.document_id); return { id: s.project?.id, revision: s.project?.revision, canvas: s.view.selectedId, ids: Object.keys(s.project?.canvases || {}), doc: d } })
const shot = name => page.screenshot({ path: path.join(evidence, name + '.png') })
const primary = () => page.locator('#vnext-confirm-primary'), secondary = () => page.locator('#vnext-confirm-secondary')
async function choose(id) { await page.locator('[data-capability="TOOL-01"]').click(); await page.locator(`.vnext-canvas-tile[data-canvas-id="${id}"]`).click(); await page.locator('#vnext-zoom').click() }
async function start() { await page.locator('#vnext-prompt-input').fill('Test fixture: paint an orange square'); await page.locator('.vnext-send').click(); await page.getByText('Draw with Astra canvas tools', { exact: true }).waitFor(); await primary().click() }
async function stop(p) { if (!p || p.exitCode !== null || p.signalCode !== null) return; const done = once(p, 'exit'); p.kill('SIGTERM'); await Promise.race([done, delay(1000)]); if (p.exitCode === null && p.signalCode === null) { p.kill('SIGKILL'); await done } }
try {
  server = spawn(process.execPath, ['server.js'], { cwd: repo, env: { ...process.env, PORT: String(port), EDITOR_WORKSPACE_ROOT: workspace, EDITOR_GENERATED_DIR: path.join(workspace, 'generated'), OPENROUTER_API_KEY: '', GEMINI_API_KEY: '', GOOGLE_API_KEY: '', CHARACTER_IMAGE_API_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'] })
  for (const s of [server.stdout, server.stderr]) s.on('data', b => { output = (output + b).slice(-2048) })
  await wait(() => output.includes('Character tool running'), 'server')
  browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--disable-gpu'] })
  page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, locale: 'en-US' }); page.setDefaultTimeout(8000)
  page.on('pageerror', e => errors.push(e.message.slice(0, 200)))
  await page.route('**/*', async r => {
    const u = new URL(r.request().url())
    if (u.origin !== origin || /generate-character/.test(u.pathname)) return r.abort()
    if (!u.pathname.endsWith('/messages')) return r.continue()
    const body = r.request().postDataJSON(); assert.equal(body.pixel_tools, true); requests++
    if (responseMode === 'failure') return r.fulfill({ status: 409, contentType: 'application/json', body: '{"error":"assistant_login_required","blocked":false}' })
    const source = await page.evaluate(async () => { const s = await window.getVnextProjectSession().preparePixelEdit({ scopeGrant: false }); return Array.from(s.rgba) })
    const tools = createPixelToolSession({ rgba: Uint8Array.from(source) })
    await tools.call('draw_pixels', { operations: [{ type: 'fill-rect', rect: { x: 20, y: 20, w: 20, h: 20 }, color: responseMode === 'secondCandidate' ? [20, 180, 200, 255] : [255, 110, 20, 255] }] })
    const candidate = await tools.candidate()
    if (responseMode === 'delay') await new Promise(resolve => { release = resolve })
    await r.fulfill({ contentType: 'application/json', body: JSON.stringify({ reply: 'Native-kernel fixture, not model output.', provider: 'astra', requestedModel: 'gpt-6-astra', completed: true, termination: 'managed',
      context: { project_id: (await state()).id, project_revision: body.expected_revision, canvas_id: body.canvas_id, working_revision: body.expected_working_revision, width: 64, height: 64, pixel_tools: true }, pixel_candidate: candidate }) }).catch(() => {})
  })
  await page.goto(origin + '/src/ui/vnext/vnext-preview.html'); await page.waitForFunction(() => !!window.getVnextProjectSession?.()); report.url = page.url()
  await page.getByRole('button', { name: 'Close preview', exact: true }).click()
  await page.locator('#vnext-project-btn').click(); await page.locator('[data-project-action="new"]').click(); await wait(async () => Boolean((await state()).id), 'new project'); await idle()
  await page.locator('#vnext-import-input').setInputFiles(input); await wait(async () => (await state()).ids.length === 1, 'import'); await idle(); await choose((await state()).ids[0])
  await page.locator('#vnext-assistant-model').selectOption('astra'); await page.waitForFunction(() => !document.querySelector('#vnext-assistant-model').disabled)
  const original = await state()
  step = 'confirmation and discard'; await page.locator('#vnext-prompt-input').fill('Test fixture: paint an orange square'); await page.locator('.vnext-send').click(); await page.getByText('Draw with Astra canvas tools', { exact: true }).waitFor(); await shot('01-start-confirmation'); await secondary().click(); assert.equal(requests, 0)
  await start(); await page.getByText('Preview Astra drawing', { exact: true }).waitFor(); assert.equal((await state()).revision, original.revision); await shot('02-fixture-preview'); await secondary().click(); await idle(); assert.equal((await state()).revision, original.revision)
  checks.push('Confirmation cancel makes no request; native preview and discard make no pixel write')
  step = 'save and undo'; await start(); await page.getByText('Preview Astra drawing', { exact: true }).waitFor(); await primary().click(); await idle(); await wait(async () => (await state()).ids.length === 2, 'editable copy')
  const saved = await page.evaluate(async () => { const s = await window.getVnextProjectSession().preparePixelEdit({ scopeGrant: false }); return Array.from(s.rgba.slice((20 * 64 + 20) * 4, (20 * 64 + 20) * 4 + 4)) })
  assert.deepEqual(saved, [255, 110, 20, 255]); await shot('03-fixture-saved')
  responseMode = 'secondCandidate'; const editable = await state(); await start(); await page.getByText('Preview Astra drawing', { exact: true }).waitFor(); await primary().click(); await idle(); assert.equal((await state()).ids.length, 2); assert.equal((await state()).doc.revision, editable.doc.revision + 1)
  await page.locator('#vnext-zoom').focus(); await page.keyboard.press('Meta+z'); await idle()
  const restored = await page.evaluate(async () => { const s = await window.getVnextProjectSession().preparePixelEdit({ scopeGrant: false }); return Array.from(s.rgba.slice((20 * 64 + 20) * 4, (20 * 64 + 20) * 4 + 4)) }); assert.deepEqual(restored, saved)
  checks.push('Editable canvas updates in place; Undo restores exact previous pixel bytes')
  await page.keyboard.press('Meta+z'); await idle(); assert.equal((await state()).ids.length, 1)
  checks.push('Save uses existing pixel-copy writer with exact kernel RGBA; Undo removes copy and preserves original')
  step = 'failure draft'; await choose(original.canvas); responseMode = 'failure'; await start(); await page.getByText(/Draft kept/).last().waitFor(); assert.equal(await page.locator('#vnext-prompt-input').inputValue(), 'Test fixture: paint an orange square'); assert.equal((await state()).ids.length, 1)
  checks.push('Preflight failure restores unchanged draft and writes no pixels')
  step = 'stop and late result'; responseMode = 'delay'; const beforeStop = requests; await start(); await wait(() => Boolean(release), 'delayed tool result'); await page.locator('.vnext-send').click(); await page.getByText(/Drawing stopped/).last().waitFor(); release(); release = null; await delay(150); assert.equal(await page.getByText('Preview Astra drawing', { exact: true }).isVisible(), false); assert.equal(requests, beforeStop + 1); assert.equal((await state()).ids.length, 1)
  checks.push('Stop rejects delayed candidate, does not retry and makes no pixel write')
  step = 'stale candidate'; await page.locator('.is-chat-new').click(); await page.getByText(/New discussion/).last().waitFor(); await start(); await wait(() => Boolean(release), 'delayed stale result'); await page.evaluate(() => window.getVnextProjectSession().api.openEpoch.next()); release(); release = null; await delay(200); assert.equal(await page.getByText('Preview Astra drawing', { exact: true }).isVisible(), false); assert.equal((await state()).ids.length, 1)
  checks.push('A superseded open context cannot display or save the old result')
  assert.deepEqual(errors, []); report.status = 'passed'
} catch (error) { report.status = 'failed'; report.step = step; report.error = error.message.slice(0, 500); process.exitCode = 1; if (page) await shot('failure').catch(() => {}) }
finally { release?.(); if (browser) await browser.close(); await stop(server); report.fixtureRequests = requests; await writeFile(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report)) }
