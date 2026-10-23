// Provider-free real UI check. Existing resource guard: 4096 MiB / 180 seconds.
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
const evidence = await mkdtemp('/private/tmp/gametool-palette-'), workspace = await mkdtemp(path.join(repo, '.tmp-palette-'))
const delay = ms => new Promise(r => setTimeout(r, ms)), hash = b => createHash('sha256').update(b).digest('hex')
const sock = net.createServer(); sock.listen(0, '127.0.0.1'); await once(sock, 'listening'); const port = sock.address().port; await new Promise(r => sock.close(r))
const origin = `http://127.0.0.1:${port}`, checks = [], errors = [], posts = []
const report = { evidence, workspace, viewport: [1920,1080], locale: 'en-US', modelCalls: 0, checks, errors, consoleErrors: [] }
let server, browser, page, output = '', step = 'setup', release
const input = path.join(workspace, 'palette-fixture.png'); await writeFile(input, encodeRgbaPng(32, 32, Buffer.alloc(32 * 32 * 4)))
async function wait(fn, label) { for (let i=0;i<140;i++) { if (await fn()) return; await delay(50) } throw Error(label) }
const idle = () => page.waitForFunction(() => { const s=window.getVnextProjectSession(); return !s.frameLoading && !s.manualGesture && !s.manualWrite && !s.pendingImport && !s.pendingSave && !s.historyBusy && !s.openInFlight() })
const state = () => page.evaluate(() => { const s=window.getVnextProjectSession(); return { id:s.project?.id, revision:s.project?.revision, colors:s.project?.settings?.palette?.colors, selected:s.view.selectedId, ids:Object.keys(s.project?.canvases || {}), docs:[...s.documents], undo:s.history?.undo.length, redo:s.history?.redo.length } })
const add=()=>page.locator('#vnext-palette-add'), swatch=i=>page.locator(`[data-palette-index="${i}"]`), slot=i=>page.locator(`[data-working-color="${i}"]`)
const pair=()=>page.locator('[data-working-color]').evaluateAll(ns=>ns.map(n=>[n.dataset.paintColor,n.dataset.paintAlpha,n.getAttribute('aria-pressed')]))
const tool=id=>page.locator(`[data-capability="${id}"]`)
const shot=name=>page.screenshot({path:path.join(evidence, name+'.png')})
async function hex(value) { await page.locator('#vnext-paint-hex').fill(value); await page.locator('#vnext-paint-hex').press('Enter') }
async function newProject() { const id=(await state()).id; await page.locator('#vnext-project-btn').click(); await page.locator('[data-project-action="new"]').click(); await wait(async()=>(await state()).id!==id,'new project'); await idle(); return (await state()).id }
async function open(id) { await page.locator('#vnext-project-btn').click(); await page.locator('[data-project-action="open"]').click(); await page.locator(`#vnext-list-rows [data-project-id="${id}"]`).click(); await page.locator('#vnext-open-confirm').click() }
async function choose(id) { await tool('TOOL-01').click(); await page.locator(`.vnext-canvas-tile[data-canvas-id="${id}"]`).click(); await page.locator('#vnext-zoom').click() }
const point=()=>page.evaluate(()=>{const s=window.getVnextProjectSession(),p=s.view.positionOf(s.view.selectedId);return s.view.worldToScreen(p.x+16.5,p.y+16.5,document.querySelector('#vnext-canvas-stage').getBoundingClientRect())})
async function download(name) { await tool('FILE-01').click(); await page.locator('#vnext-export-frame').click(); await page.waitForFunction(()=>!document.querySelector('#vnext-export-submit').disabled); const pending=page.waitForEvent('download'); await page.locator('#vnext-export-submit').click(); const d=await pending,file=path.join(evidence,name+'.png'); await d.saveAs(file); await page.keyboard.press('Escape'); return hash(await readFile(file)) }
async function stop(p) { if(!p || p.exitCode!==null || p.signalCode!==null)return;const done=once(p,'exit');p.kill('SIGTERM');await Promise.race([done,delay(1000)]);if(p.exitCode===null && p.signalCode===null){p.kill('SIGKILL');await done} }
try {
  server=spawn(process.execPath,['server.js'],{cwd:repo,env:{...process.env,PORT:String(port),EDITOR_WORKSPACE_ROOT:workspace,EDITOR_GENERATED_DIR:path.join(workspace,'generated'),OPENROUTER_API_KEY:'',GEMINI_API_KEY:'',GOOGLE_API_KEY:'',CHARACTER_IMAGE_API_KEY:''},stdio:['ignore','pipe','pipe']})
  for(const s of [server.stdout,server.stderr])s.on('data',b=>{output=(output+b).slice(-2048)})
  await wait(()=>output.includes('Character tool running'),'server')
  browser=await chromium.launch({executablePath:process.env.GAMETOOL_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--disable-gpu']})
  page=await browser.newPage({viewport:{width:1920,height:1080},locale:'en-US'});page.setDefaultTimeout(8000)
  page.on('pageerror',e=>errors.push(e.message.slice(0,200)));page.on('console',m=>{if(m.type()==='error' && report.consoleErrors.length<20)report.consoleErrors.push(m.text().slice(0,200))})
  await page.route('**/*',r=>{const u=new URL(r.request().url());return u.origin===origin && !/generate-character|\/messages$/.test(u.pathname)?r.continue():r.abort()})
  page.on('request',r=>{if(r.method()==='POST' && r.url().endsWith('/palette'))posts.push(r.postData())})
  await page.goto(origin+'/src/ui/vnext/vnext-preview.html');await page.waitForFunction(()=>!!window.getVnextProjectSession?.())
  report.url=page.url();report.title=await page.title();assert.match(report.title,/GameTool/);assert.equal(await page.locator('main').isVisible(),true)
  assert.equal(await add().isDisabled(),true);await page.getByRole('button',{name:'Close preview',exact:true}).click()
  const project=await newProject();report.project=project
  await page.locator('#vnext-import-input').setInputFiles(input);await wait(async()=>(await state()).ids.length===1,'import');await idle();await choose((await state()).ids[0])
  await hex('203040FF');await tool('TOOL-03').click();let p=await point();await page.mouse.click(p.x,p.y);await idle();await choose((await state()).selected)
  await hex('FF1122FF');await tool('TOOL-03').click();p=await point();await page.mouse.click(p.x,p.y);await idle()
  const baseline=await state(), png=await download('before')
  step='independent RGBA and X';await slot(0).click();await hex('12345680');await slot(1).click();await hex('ABCDEF00')
  const before=await pair();await slot(1).press('x');let after=await pair()
  assert.deepEqual(after,[[before[1][0],before[1][1],'false'],[before[0][0],before[0][1],'true']])
  await page.locator('#vnext-paint-hex').press('x');assert.deepEqual(await pair(),after);await hex('12345680')
  await tool('TOOL-03').click();p=await point();await page.mouse.move(p.x,p.y);await page.mouse.down();await page.keyboard.press('x');assert.deepEqual(await pair(),after);await page.keyboard.press('Escape');await page.mouse.up();await idle()
  checks.push('Two independent RGBA slots; X swaps values without moving active slot; input and stroke do not intercept X')
  step='add duplicate replace remove';await add().click();await idle();assert.deepEqual((await state()).colors.at(-1),[18,52,86,128]);const count=posts.length
  await add().click();assert.equal(posts.length,count);await hex('AABBCC33');await swatch(24).click({button:'right'});await shot('01-palette-menu')
  const menuPair=await pair();await page.keyboard.press('x');assert.deepEqual(await pair(),menuPair)
  await page.locator('[data-palette-action="replace"]').click();await idle();assert.deepEqual((await state()).colors.at(-1),[170,187,204,51])
  await swatch(24).click();assert.equal(await page.locator('#vnext-paint-hex').inputValue(),'AABBCC33')
  await swatch(0).focus();await page.keyboard.press('Shift+F10');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');await idle();assert.equal((await state()).colors.length,24)
  checks.push('Add, exact duplicate no write, replace with current RGBA, swatch alpha selection, keyboard Remove; popup does not intercept X')
  step='lost ACK';await hex('99887766');const beforeUnknown=await state()
  await page.route('**/palette',async r=>{await r.fetch();await r.abort('failed')},{times:1});await add().click();await page.locator('#vnext-confirm-dialog').waitFor()
  assert.equal(await add().isDisabled(),true);await page.locator('#vnext-confirm-secondary').click();assert.equal(await add().isDisabled(),true)
  await page.locator('#vnext-project-btn').click();await page.locator('[data-project-action="new"]').click();await page.locator('#vnext-confirm-primary').click();await idle()
  assert.equal((await state()).id,project);assert.equal((await state()).revision,beforeUnknown.revision+1);assert.equal(posts.at(-1),posts.at(-2));assert.deepEqual((await state()).colors.at(-1),[153,136,119,102])
  checks.push('Lost ACK stays locked after dismiss; same JSON/op retry increments project revision once and does not create/switch projects')
  step='delayed and rejected writes';await hex('01020304');let waiting=false;const gate=new Promise(r=>release=r)
  await page.route('**/palette',async r=>{waiting=true;await gate;await r.fulfill({status:409,contentType:'application/json',body:'{"error":"stale_revision"}'})},{times:1})
  const beforeFail=await state();await add().click();await wait(()=>waiting,'save delay');assert.equal(await add().isDisabled(),true);assert.equal(await tool('TOOL-03').isDisabled(),true);await shot('02-saving-locked');release();await idle();assert.equal((await state()).revision,beforeFail.revision);assert.deepEqual((await state()).colors,beforeFail.colors)
  checks.push('Delayed palette save locks controls; known rejection restores controls without applying colors')
  step='pixels and history';assert.deepEqual((await state()).docs,baseline.docs);assert.equal((await state()).undo,baseline.undo);assert.equal(await download('after'),png)
  await tool('TOOL-03').focus();await page.keyboard.press('Meta+z');await idle();assert.notEqual(await download('undo'),png);await tool('TOOL-03').focus();await page.keyboard.press('Meta+Shift+z');await idle();assert.equal(await download('redo'),png)
  checks.push('Palette metadata never changes manifests or current-frame PNG; existing pixel Undo and Redo still work')
  step='project isolation reopen and transition';const saved=(await state()).colors;await newProject();assert.equal((await state()).colors,undefined)
  let opening=false;const openGate=new Promise(r=>release=r)
  await page.route(`**/api/editor/projects/${project}`,async r=>{opening=true;await openGate;await r.continue()},{times:1})
  await open(project);await wait(()=>opening,'open delay');assert.equal(await add().isDisabled(),true);await page.keyboard.press('Escape');assert.equal(await add().isDisabled(),false);release();await delay(100);assert.notEqual((await state()).id,project)
  await open(project);await wait(async()=>(await state()).id===project,'reopen');await idle();assert.deepEqual((await state()).colors,saved)
  await page.reload();await page.waitForFunction(()=>window.getVnextProjectSession?.()?.project);await idle();assert.deepEqual((await state()).colors,saved);await shot('03-palette-reopened')
  checks.push('Other project has defaults, cancelled delayed open cannot apply late, reopen and page reload restore RGBA palette')
  step='empty and capacity';await page.evaluate(()=>window.getVnextProjectSession().savePalette([]));await idle();assert.equal(await page.locator('.vnext-palette-empty').isVisible(),true)
  await page.evaluate(()=>window.getVnextProjectSession().savePalette(Array.from({length:256},(_,i)=>[i,0,0,255])));await idle();await hex('00010203');assert.equal(await add().isDisabled(),true)
  await swatch(255).click();assert.equal(await add().isDisabled(),false);const fullPosts=posts.length;await add().click();assert.equal(posts.length,fullPosts)
  await page.evaluate(colors=>window.getVnextProjectSession().savePalette(colors),saved);await idle();await page.setViewportSize({width:1280,height:800})
  assert.ok((await page.locator('.vnext-color-values').boundingBox()).height >= 32, 'Hex and opacity must not collapse on shorter viewports')
  await swatch(23).click({button:'right'});await shot('04-palette-narrow')
  checks.push('Empty palette renders honestly; 256 limit disables new Add while exact duplicate remains a no-write selection; 1280×800 menu stays visible')
  assert.deepEqual(errors,[]);assert.ok(report.consoleErrors.every(m=>/Failed to load resource/.test(m)),JSON.stringify(report.consoleErrors))
  report.status='passed';report.pngHash=png;report.palettePosts=posts.length;console.log(`PASS ${checks.length} groups; ${evidence}`)
} catch(e) {report.status='failed';report.step=step;report.error=e.stack;await shot('failure').catch(()=>{});console.error(step+': '+e.stack);process.exitCode=1}
finally {release?.();await browser?.close();await stop(server);await writeFile(path.join(evidence,'report.json'),JSON.stringify(report,null,2));console.log('report: '+path.join(evidence,'report.json'))}
