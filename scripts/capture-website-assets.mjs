#!/usr/bin/env node
/**
 * Capture public-site screenshots from the local MoteWeave app.
 *
 * Requires Node.js 22+ and Google Chrome. Starts the repository server when
 * MOTEWEAVE_SITE_CAPTURE_URL is unset, using a temporary workspace inside this
 * checkout, then removes that workspace on exit. No provider credentials are
 * read or sent. Outputs:
 *   website/assets/studio-character.png
 *   website/assets/studio-extract.png
 *   website/assets/studio-map.png
 *   website/assets/vnext-editor.png
 *
 * Set MOTEWEAVE_SKIP_STUDIO=1 to refresh only the VNext capture.
 * Set MOTEWEAVE_SITE_CAPTURE_URL when a local server is already running.
 */
import { spawn } from 'node:child_process'
import { constants as fsConstants } from 'node:fs'
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

import sharp from 'sharp'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const assetDir = path.join(rootDir, 'website', 'assets')
const heroFixture = path.join(
  rootDir,
  'test/fixtures/character-pack/topdown_rpg_v0_sample_hero.png',
)
const chromeCandidates = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
].filter(Boolean)

const VIEWPORT = Object.freeze({ width: 1280, height: 800, deviceScaleFactor: 1 })

async function findChrome() {
  for (const candidate of chromeCandidates) {
    try {
      await access(candidate, fsConstants.X_OK)
      return candidate
    } catch {
      // try the next installed browser
    }
  }
  throw new Error('Google Chrome or Chromium is required to capture website assets')
}

async function waitForHttp(url, timeoutMs = 20000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // server still starting
    }
    await delay(200)
  }
  throw new Error(`local server did not respond at ${url}`)
}

function startServer(port, workspaceRoot, generatedDir) {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: rootDir,
    env: {
      ...process.env,
      FORCE_COLOR: '',
      NO_COLOR: '',
      CHARACTER_IMAGE_API_KEY: '',
      CHARACTER_PROVIDER_PRESETS: '',
      GEMINI_API_KEY: '',
      GOOGLE_API_KEY: '',
      OPENROUTER_API_KEY: '',
      OPENROUTER_PROVIDER_PRESETS: '',
      PORT: String(port),
      EDITOR_WORKSPACE_ROOT: workspaceRoot,
      EDITOR_GENERATED_DIR: generatedDir,
    },
    stdio: 'ignore',
  })
  return child
}

function startChrome(chromePath, userDataDir, debuggingPort) {
  return spawn(chromePath, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    `--remote-debugging-port=${debuggingPort}`,
    `--user-data-dir=${userDataDir}`,
    `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
    'about:blank',
  ], { stdio: 'ignore' })
}

function connectCdp(wsUrl) {
  const ws = new WebSocket(wsUrl)
  let nextId = 0
  const pending = new Map()
  const sessions = new Map()
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) reject(new Error(`${message.error.message || 'cdp error'}`))
      else resolve(message.result)
      return
    }
    if (message.method && message.sessionId) {
      const bucket = sessions.get(message.sessionId)
      bucket?.push(message)
    }
  })
  const opened = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', reject, { once: true })
  })
  function send(method, params = {}, sessionId) {
    const id = ++nextId
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
      const payload = { id, method, params }
      if (sessionId) payload.sessionId = sessionId
      ws.send(JSON.stringify(payload))
    })
  }
  return {
    ws,
    opened,
    send,
    waitFor(sessionId, method, timeoutMs = 15000) {
      const bucket = sessions.get(sessionId) ?? []
      sessions.set(sessionId, bucket)
      const existing = bucket.find((message) => message.method === method)
      if (existing) return Promise.resolve(existing)
      return new Promise((resolve, reject) => {
        const started = Date.now()
        const timer = setInterval(() => {
          const match = bucket.find((message) => message.method === method)
          if (match) {
            clearInterval(timer)
            resolve(match)
          } else if (Date.now() - started > timeoutMs) {
            clearInterval(timer)
            reject(new Error(`timed out waiting for ${method}`))
          }
        }, 50)
      })
    },
  }
}

async function openPage(cdp, url) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
  await cdp.send('Page.enable', {}, sessionId)
  await cdp.send('Runtime.enable', {}, sessionId)
  await cdp.send('DOM.enable', {}, sessionId)
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: VIEWPORT.width,
    height: VIEWPORT.height,
    deviceScaleFactor: VIEWPORT.deviceScaleFactor,
    mobile: false,
  }, sessionId)
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: "try{localStorage.setItem('gameToolLanguage','en')}catch(e){}",
  }, sessionId)
  const loaded = cdp.waitFor(sessionId, 'Page.loadEventFired')
  await cdp.send('Page.navigate', { url }, sessionId)
  await loaded
  await delay(400)
  return sessionId
}

async function evaluate(cdp, sessionId, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  }, sessionId)
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || 'page script failed')
  }
  return result.result?.value
}

async function waitForText(cdp, sessionId, text) {
  const started = Date.now()
  while (Date.now() - started < 15000) {
    const found = await evaluate(cdp, sessionId, `document.body && document.body.innerText.includes(${JSON.stringify(text)})`)
    if (found) return
    await delay(150)
  }
  throw new Error(`text not found: ${text}`)
}

async function screenshot(cdp, sessionId, outputPath) {
  const shot = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  }, sessionId)
  const compressed = await sharp(Buffer.from(shot.data, 'base64'))
    .png({ compressionLevel: 9, effort: 9 })
    .toBuffer()
  await writeFile(outputPath, compressed)
  const meta = await sharp(compressed).metadata()
  return { path: outputPath, width: meta.width, height: meta.height, bytes: compressed.length }
}

async function captureStudio(cdp, origin) {
  const pages = [
    {
      file: 'studio-character.png',
      url: `${origin}/src/ui/studio/studio.html#character`,
      ready: 'Character Studio',
    },
    {
      file: 'studio-extract.png',
      url: `${origin}/src/ui/studio/studio.html#action`,
      ready: 'Frame Extraction',
    },
    {
      file: 'studio-map.png',
      url: `${origin}/src/ui/studio/studio.html#tiles`,
      ready: 'Map Studio',
    },
  ]
  const written = []
  for (const page of pages) {
    const sessionId = await openPage(cdp, page.url)
    await waitForText(cdp, sessionId, page.ready)
    await delay(300)
    written.push(await screenshot(cdp, sessionId, path.join(assetDir, page.file)))
    await cdp.send('Target.closeTarget', { targetId: (await cdp.send('Target.getTargetInfo', {}, sessionId)).targetInfo.targetId })
  }
  return written
}

async function captureVnext(cdp, origin) {
  const sessionId = await openPage(cdp, `${origin}/src/ui/vnext/vnext-preview.html`)
  await waitForText(cdp, sessionId, 'Untitled project')
  await evaluate(cdp, sessionId, `document.querySelector('#vnext-project-btn').click()`)
  await delay(200)
  await evaluate(cdp, sessionId, `document.querySelector('[data-project-action="new"]').click()`)
  const started = Date.now()
  let projectName = 'Untitled project'
  while (Date.now() - started < 4000) {
    projectName = await evaluate(cdp, sessionId, `document.querySelector('#vnext-project-name')?.textContent || ''`)
    const ready = await evaluate(cdp, sessionId, `document.querySelector('#vnext-new-canvas') && !document.querySelector('#vnext-new-canvas').disabled`)
    if (ready && projectName && projectName !== 'Untitled project') break
    await delay(200)
  }
  const enabled = await evaluate(cdp, sessionId, `Boolean(document.querySelector('#vnext-new-canvas') && !document.querySelector('#vnext-new-canvas').disabled)`)
  if (enabled) {
    await evaluate(cdp, sessionId, `document.querySelector('#vnext-project-btn').click()`)
    await delay(150)
    await evaluate(cdp, sessionId, `document.querySelector('#vnext-new-canvas').click()`)
    await waitForText(cdp, sessionId, 'New canvas')
    await evaluate(cdp, sessionId, `document.querySelector('#vnext-blank-create').click()`)
  } else {
    // The New canvas menu row stays disabled while assistant restore marks the
    // workspace busy, even after the project itself has opened. Create the
    // same blank canvas the dialog would submit, then reload so the workspace
    // shows it.
    const created = await evaluate(cdp, sessionId, `(() => {
      const id = localStorage.getItem('vnext-last-project-id')
      return fetch('/api/editor/projects/' + encodeURIComponent(id), {
        headers: { 'X-Editor-Storage-Version': '2' },
      }).then((response) => response.json()).then((body) => {
        const revision = body.project && body.project.revision
        return fetch('/api/editor/projects/' + encodeURIComponent(id) + '/sprite-documents/blank', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'X-Editor-Storage-Version': '2',
          },
          body: JSON.stringify({
            operation_id: crypto.randomUUID(),
            expected_revision: revision,
            name: 'Capture',
            width: 64,
            height: 64,
          }),
        }).then(async (response) => ({ status: response.status, id, revision, body: (await response.text()).slice(0, 180) }))
      })
    })()`)
    if (!created || created.status !== 201 && created.status !== 200) {
      throw new Error(`blank canvas was not created (${projectName}): ${JSON.stringify(created)}`)
    }
    const reloaded = cdp.waitFor(sessionId, 'Page.loadEventFired')
    await cdp.send('Page.reload', { ignoreCache: true }, sessionId)
    await reloaded
    await delay(500)
  }
  const toolStarted = Date.now()
  while (Date.now() - toolStarted < 15000) {
    const pencilReady = await evaluate(
      cdp,
      sessionId,
      `(() => { const b = document.querySelector('[aria-label="Pencil"]'); return Boolean(b && !b.disabled) })()`,
    )
    if (pencilReady) break
    await delay(200)
  }
  const pencilReady = await evaluate(
    cdp,
    sessionId,
    `(() => { const b = document.querySelector('[aria-label="Pencil"]'); return Boolean(b && !b.disabled) })()`,
  )
  if (!pencilReady) {
    const note = await evaluate(cdp, sessionId, `document.querySelector('#vnext-blank-error')?.textContent || document.body.innerText.slice(0, 400)`)
    throw new Error(`Pencil stayed disabled: ${note}`)
  }
  await evaluate(cdp, sessionId, `document.querySelector('[aria-label="Pencil"]').click()`)
  await delay(400)
  return screenshot(cdp, sessionId, path.join(assetDir, 'vnext-editor.png'))
}

async function main() {
  await mkdir(assetDir, { recursive: true })
  const chromePath = await findChrome()
  const captureRoot = path.join(rootDir, '.site-capture')
  const workspaceRoot = path.join(captureRoot, 'workspace')
  const generatedDir = path.join(captureRoot, 'generated')
  await mkdir(workspaceRoot, { recursive: true, mode: 0o700 })
  await mkdir(generatedDir, { recursive: true, mode: 0o700 })
  const port = Number(process.env.MOTEWEAVE_SITE_CAPTURE_PORT || 4173)
  const origin = process.env.MOTEWEAVE_SITE_CAPTURE_URL || `http://127.0.0.1:${port}`
  let server = null
  if (!process.env.MOTEWEAVE_SITE_CAPTURE_URL) {
    try {
      await waitForHttp(`${origin}/src/ui/studio/studio.html`, 800)
    } catch {
      server = startServer(port, workspaceRoot, generatedDir)
      await waitForHttp(`${origin}/src/ui/studio/studio.html`)
    }
  }
  const debuggingPort = Number(process.env.MOTEWEAVE_CHROME_PORT || 9334)
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'moteweave-chrome-'))
  const chrome = startChrome(chromePath, userDataDir, debuggingPort)
  try {
    await waitForHttp(`http://127.0.0.1:${debuggingPort}/json/version`)
    const version = await fetch(`http://127.0.0.1:${debuggingPort}/json/version`).then((response) => response.json())
    const cdp = connectCdp(version.webSocketDebuggerUrl)
    await cdp.opened
    const studio = process.env.MOTEWEAVE_SKIP_STUDIO ? [] : await captureStudio(cdp, origin)
    const vnext = await captureVnext(cdp, origin)
    console.log(JSON.stringify({ studio, vnext }, null, 2))
    cdp.ws.close()
  } finally {
    chrome.kill('SIGTERM')
    if (server) server.kill('SIGTERM')
    await delay(300)
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {})
    if (!process.env.MOTEWEAVE_SITE_CAPTURE_URL) {
      await rm(captureRoot, { recursive: true, force: true }).catch(() => {})
    }
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) {
  await main()
}
