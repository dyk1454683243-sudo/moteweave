#!/usr/bin/env node
/**
 * Capture public-site screenshots from the local MoteWeave app.
 *
 * Requires Node.js 22+ and Google Chrome. Starts an owned local server on a
 * free port. The editor workspace is a fresh directory under the gitignored
 * workspace/ folder, because managed asset paths must stay inside the project
 * root. Media files and the browser profile use a temporary directory outside
 * the checkout. Both are removed on exit. No provider credentials are read
 * or sent.
 * Outputs:
 *   website/assets/studio-character.png
 *   website/assets/studio-extract.png
 *   website/assets/studio-map.png
 *   website/assets/vnext-editor.png
 *
 * Set MOTEWEAVE_SKIP_STUDIO=1 to refresh only the VNext capture.
 */
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import { constants as fsConstants, openSync } from 'node:fs'
import { access, chmod, copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

import sharp from 'sharp'

import { encodeGifFromRgbaFrames } from '../src/character-pack/gifExport.js'
import { encodeGeneralSequenceBody } from '../src/editor-project/generalSequenceBody.js'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const assetDir = path.join(rootDir, 'website', 'assets')
const heroFixture = path.join(
  rootDir,
  'test/fixtures/character-pack/topdown_rpg_v0_sample_hero.png',
)
const fixedRegionFixture = path.join(
  rootDir,
  'test/fixtures/character-pack/local-image-golden/ocad-sheet/fixed_region_sample_hero.png',
)
const chromeCandidates = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
].filter(Boolean)

const VIEWPORT = Object.freeze({ width: 1280, height: 800, deviceScaleFactor: 1 })
const CELL = 192
const WALK_ROW = 2
const SECRET_ENV = /TOKEN|SECRET|PASSWORD|CREDENTIAL|API_KEY|_KEY$/i

function redact(value) {
  return String(value ?? '')
    .replace(/\/(?:home|workspace|Users)\/[^\s'"]+/g, '[path]')
    .replace(/\/tmp\/moteweave-[^\s'"]+/g, '[capture]')
}

function childEnv(port, workspaceRoot, generatedDir) {
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    if (SECRET_ENV.test(key)) env[key] = ''
  }
  delete env.FORCE_COLOR
  delete env.NO_COLOR
  env.CHARACTER_IMAGE_API_KEY = ''
  env.CHARACTER_PROVIDER_PRESETS = ''
  env.GEMINI_API_KEY = ''
  env.GOOGLE_API_KEY = ''
  env.OPENROUTER_API_KEY = ''
  env.OPENROUTER_PROVIDER_PRESETS = ''
  env.PORT = String(port)
  env.EDITOR_WORKSPACE_ROOT = workspaceRoot
  env.EDITOR_GENERATED_DIR = generatedDir
  return env
}

function portFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(true))
    })
  })
}

async function claimPort(start, attempts) {
  for (let offset = 0; offset < attempts; offset += 1) {
    const port = start + offset
    if (await portFree(port)) return port
  }
  throw new Error('no free local port for website capture')
}

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

function startServer(port, workspaceRoot, generatedDir, logFd) {
  return spawn(process.execPath, ['server.js'], {
    cwd: rootDir,
    env: childEnv(port, workspaceRoot, generatedDir),
    stdio: ['ignore', 'ignore', logFd],
  })
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
      if (message.error) reject(new Error(redact(message.error.message || 'cdp error')))
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

async function openPage(cdp, url, storage = {}) {
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
  const pairs = { gameToolLanguage: 'en', ...storage }
  const source = Object.entries(pairs)
    .map(([key, value]) => `try{localStorage.setItem(${JSON.stringify(key)},${JSON.stringify(value)})}catch(e){}`)
    .join('')
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source }, sessionId)
  const loaded = cdp.waitFor(sessionId, 'Page.loadEventFired', 20000)
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
    throw new Error(redact(result.exceptionDetails.text || 'page script failed'))
  }
  return result.result?.value
}

async function waitForText(cdp, sessionId, text, timeoutMs = 15000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const found = await evaluate(
      cdp,
      sessionId,
      `document.body && document.body.innerText.includes(${JSON.stringify(text)})`,
    )
    if (found) return
    await delay(150)
  }
  throw new Error(`text not found: ${text}`)
}

async function waitFor(cdp, sessionId, expression, timeoutMs, label) {
  const started = Date.now()
  let last = null
  while (Date.now() - started < timeoutMs) {
    last = await evaluate(cdp, sessionId, expression)
    if (last && last.ok) return last
    if (last && last.failed) {
      throw new Error(redact(`${label} failed: ${last.detail || 'unknown'}`))
    }
    await delay(250)
  }
  throw new Error(redact(`${label} timed out: ${JSON.stringify(last)?.slice(0, 400)}`))
}

async function click(cdp, sessionId, selector) {
  const clicked = await evaluate(cdp, sessionId, `(() => {
    const node = document.querySelector(${JSON.stringify(selector)})
    if (!node || node.disabled) return false
    node.click()
    return true
  })()`)
  if (!clicked) throw new Error(`could not click ${selector}`)
}

async function setInputFile(cdp, sessionId, selector, filePath) {
  const documentNode = await cdp.send('DOM.getDocument', { depth: -1, pierce: true }, sessionId)
  const found = await cdp.send('DOM.querySelector', {
    nodeId: documentNode.root.nodeId,
    selector,
  }, sessionId)
  if (!found.nodeId) throw new Error(`file input not found: ${selector}`)
  await cdp.send('DOM.setFileInputFiles', {
    nodeId: found.nodeId,
    files: [filePath],
  }, sessionId)
}

async function assertCleanPage(cdp, sessionId) {
  const text = await evaluate(cdp, sessionId, 'document.body ? document.body.innerText : ""')
  if (/\/home\/|\/Users\/|\/workspace\/|\/tmp\/moteweave-/.test(text)) {
    throw new Error('capture page exposes a home or workspace path')
  }
}

async function screenshot(cdp, sessionId, outputPath) {
  const shot = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  }, sessionId)
  const compressed = await sharp(Buffer.from(shot.data, 'base64'))
    .png({ compressionLevel: 9, effort: 9, palette: false })
    .toBuffer()
  await writeFile(outputPath, compressed)
  const meta = await sharp(compressed).metadata()
  return {
    file: path.basename(outputPath),
    width: meta.width,
    height: meta.height,
    bytes: compressed.length,
  }
}

function quantizeChannel(value) {
  return Math.max(0, Math.min(255, Math.round(value / 16) * 16))
}

async function opaqueCount(buffer) {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let opaque = 0
  const step = info.channels * 16
  for (let index = info.channels - 1; index < data.length; index += step) {
    if (data[index] > 20) opaque += 1
  }
  return { opaque, data, info }
}

async function samplePalette(buffer) {
  const { data, info, opaque } = await opaqueCount(buffer)
  if (opaque < 20) throw new Error('walk cell has too few opaque pixels')
  const counts = new Map()
  for (let index = 0; index < data.length; index += info.channels) {
    const alpha = data[index + 3]
    if (alpha < 128) continue
    const color = [
      quantizeChannel(data[index]),
      quantizeChannel(data[index + 1]),
      quantizeChannel(data[index + 2]),
      255,
    ]
    const key = color.join(',')
    const current = counts.get(key) || { color, count: 0 }
    current.count += 1
    counts.set(key, current)
  }
  const ranked = [...counts.values()].sort((left, right) => right.count - left.count)
  const colors = ranked.slice(0, 16).map((entry) => entry.color)
  if (colors.length < 2) throw new Error('walk cell palette is too small')
  return colors
}

async function prepareMedia(mediaDir) {
  const frames = []
  for (let column = 0; column < 4; column += 1) {
    const buffer = await sharp(heroFixture)
      .extract({ left: column * CELL, top: WALK_ROW * CELL, width: CELL, height: CELL })
      .png()
      .toBuffer()
    frames.push(buffer)
  }
  const palette = await samplePalette(frames[0])
  const rgbaFrames = []
  for (const frame of frames) {
    const { data, info } = await sharp(frame).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    rgbaFrames.push({ data, width: info.width, height: info.height })
  }
  const gif = encodeGifFromRgbaFrames(rgbaFrames, { delay: 12 })
  const gifPath = path.join(mediaDir, 'topdown_rpg_v0_walk_down.gif')
  const topdownPath = path.join(mediaDir, 'topdown_rpg_v0_sample_hero.png')
  const fixedPath = path.join(mediaDir, 'fixed_region_sample_hero.png')
  await writeFile(gifPath, gif)
  await copyFile(heroFixture, topdownPath)
  await copyFile(fixedRegionFixture, fixedPath)
  return { frames, palette, gifPath, topdownPath, fixedPath }
}

async function api(origin, pathname, { method = 'GET', headers = {}, body } = {}) {
  const response = await fetch(`${origin}${pathname}`, {
    method,
    headers: {
      'X-Editor-Storage-Version': '2',
      ...headers,
    },
    body,
  })
  const text = await response.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  if (!response.ok) {
    throw new Error(redact(`${method} ${pathname} ${response.status} ${text.slice(0, 300)}`))
  }
  return json
}

async function seedVnext(origin, frames, palette) {
  const created = await api(origin, '/api/editor/projects/v1', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      operation_id: crypto.randomUUID(),
      name: 'Walk cycle',
    }),
  })
  const projectId = created?.project?.id
  let revision = created?.project?.revision
  if (!projectId || !revision) throw new Error('v1 project was not created')
  const sequence = Buffer.from(encodeGeneralSequenceBody(frames.map((bytes) => ({ bytes: new Uint8Array(bytes) }))))
  const digest = crypto.createHash('sha256').update(sequence).digest('hex')
  const params = new URLSearchParams({
    operation_id: crypto.randomUUID(),
    expected_revision: String(revision),
    expected_sha256: digest,
    name: 'Walk down',
    background: 'auto',
  })
  const imported = await api(
    origin,
    `/api/editor/projects/${encodeURIComponent(projectId)}/sprite-documents/general-sequence?${params}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: sequence,
    },
  )
  revision = imported?.project?.revision
  if (!revision) throw new Error('walk sequence was not imported')
  await api(origin, `/api/editor/projects/${encodeURIComponent(projectId)}/palette`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      operation_id: crypto.randomUUID(),
      expected_revision: revision,
      colors: palette,
      active_id: 'hero',
      items: [{ id: 'hero', name: 'Hero', colors: palette }],
    }),
  })
  return projectId
}

async function captureVnext(cdp, origin, projectId) {
  const sessionId = await openPage(cdp, `${origin}/src/ui/vnext/vnext-preview.html`, {
    'vnext-last-project-id': projectId,
  })
  await waitForText(cdp, sessionId, 'Walk cycle', 20000)
  await waitFor(cdp, sessionId, `(() => {
    const tile = document.querySelector('#vnext-canvas-stage .vnext-canvas-tile')
    const surface = tile?.querySelector('canvas, img')
    const total = document.querySelector('.vnext-play-total')?.textContent || ''
    const palette = document.querySelector('[aria-label^="Select palette"]')?.getAttribute('aria-label') || ''
    if (!surface) return { ok: false, detail: 'no surface total=' + total + ' palette=' + palette }
    let opaque = 0
    let width = 0
    if (surface.tagName === 'IMG') {
      if (!surface.complete || surface.naturalWidth < 8) return { ok: false, detail: 'image loading' }
      width = surface.naturalWidth
      const probe = document.createElement('canvas')
      probe.width = surface.naturalWidth
      probe.height = surface.naturalHeight
      const context = probe.getContext('2d')
      context.drawImage(surface, 0, 0)
      const data = context.getImageData(0, 0, probe.width, probe.height).data
      for (let index = 3; index < data.length; index += 64) if (data[index] > 20) opaque += 1
    } else {
      width = surface.width
      const context = surface.getContext('2d')
      if (!context || width < 8) return { ok: false, detail: 'canvas ' + width }
      const data = context.getImageData(0, 0, surface.width, surface.height).data
      for (let index = 3; index < data.length; index += 64) if (data[index] > 20) opaque += 1
    }
    const box = surface.getBoundingClientRect()
    return {
      ok: opaque >= 20 && total.includes('04') && box.width >= 80 && palette.includes('Hero'),
      detail: 'opaque=' + opaque + ' total=' + total + ' box=' + Math.round(box.width) + ' palette=' + palette + ' width=' + width,
    }
  })()`, 30000, 'vnext canvas')
  await evaluate(cdp, sessionId, `(() => {
    document.querySelector('#vnext-canvas-stage .vnext-canvas-tile')?.click()
    const session = window.getVnextProjectSession?.()
    const stage = document.querySelector('#vnext-canvas-stage')
    const box = stage?.getBoundingClientRect()
    if (session?.view && box) session.view.fitAll(box.width, box.height)
    session?.renderCanvas?.()
    return true
  })()`)
  await delay(400)
  const onionReady = await evaluate(cdp, sessionId, `(() => {
    const button = document.querySelector('#vnext-onion-toggle')
    const session = window.getVnextProjectSession?.()
    const selected = session?.view?.selectedId || ''
    const record = session?.project?.canvases?.[selected]
    const manifest = session?.documents?.get?.(record?.document_id)
    return {
      enabled: Boolean(button && !button.disabled),
      title: button?.title || '',
      frames: manifest?.frame_order?.length || 0,
    }
  })()`)
  if (onionReady?.enabled) {
    await click(cdp, sessionId, 'button.vnext-frame-index[aria-label="Frame 2"]')
    await delay(200)
    await click(cdp, sessionId, '#vnext-onion-toggle')
    await waitFor(cdp, sessionId, `(() => {
      const overlay = document.querySelector('.vnext-onion-overlay')
      const pressed = document.querySelector('#vnext-onion-toggle')?.getAttribute('aria-pressed')
      return { ok: pressed === 'true' && Boolean(overlay), detail: 'pressed=' + pressed }
    })()`, 10000, 'onion overlay')
  } else {
    const frame = await evaluate(cdp, sessionId, `(() => {
      const button = document.querySelector('button.vnext-frame-index[aria-label="Frame 2"]')
      if (!button || button.disabled) return false
      button.click()
      return true
    })()`)
    if (!frame) throw new Error(redact(`onion unavailable (${onionReady?.title || 'missing'}; frames=${onionReady?.frames || 0})`))
  }
  await click(cdp, sessionId, '[aria-label="Pencil"]')
  await delay(250)
  await assertCleanPage(cdp, sessionId)
  return screenshot(cdp, sessionId, path.join(assetDir, 'vnext-editor.png'))
}

async function chooseCharacterLayout(cdp, sessionId, layout) {
  await waitFor(cdp, sessionId, `(() => ({
    ok: Boolean(document.querySelector('#character-advanced-layout-trigger')),
  }))()`, 15000, 'character layout')
  await click(cdp, sessionId, '#character-advanced-layout-trigger')
  await delay(150)
  const option = `#character-advanced-layout-option-${layout}`
  await waitFor(cdp, sessionId, `(() => ({
    ok: Boolean(document.querySelector(${JSON.stringify(option)})),
  }))()`, 5000, 'character layout option')
  await click(cdp, sessionId, option)
  await delay(150)
  const value = await evaluate(cdp, sessionId, `document.querySelector('#character-advanced-layout')?.value || ''`)
  if (value !== layout) throw new Error(`character layout stayed ${value}`)
}

async function loadCharacterSheet(cdp, sessionId, filePath) {
  await setInputFile(cdp, sessionId, '#character-local-file', filePath)
  await waitFor(cdp, sessionId, `(() => {
    const preview = document.querySelector('#character-local-source-preview')
    const primary = document.querySelector('#character-local-primary')
    const error = document.querySelector('#character-local-error')
    const failed = Boolean(error && !error.hidden && error.textContent.trim())
    return {
      ok: Boolean(preview && preview.complete && preview.naturalWidth > 0 && primary && !primary.disabled),
      failed,
      detail: failed ? error.textContent.slice(0, 180) : 'source',
    }
  })()`, 20000, 'character source')
}

async function processCharacter(cdp, sessionId) {
  await click(cdp, sessionId, '#character-local-primary')
  await waitFor(cdp, sessionId, `(() => {
    const preview = document.querySelector('#character-local-preview')
    const canvas = document.querySelector('#character-local-canvas')
    const error = document.querySelector('#character-local-error')
    const failed = Boolean(error && !error.hidden && error.textContent.trim())
    let opaque = 0
    if (canvas && preview && !preview.hidden) {
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (context) {
        const data = context.getImageData(0, 0, canvas.width, canvas.height).data
        for (let index = 3; index < data.length; index += 64) if (data[index] > 16) opaque += 1
      }
    }
    return {
      ok: opaque >= 20,
      failed,
      detail: failed ? error.textContent.slice(0, 180) : 'opaque=' + opaque,
    }
  })()`, 180000, 'character preview')
}

async function captureCharacter(cdp, origin, media) {
  const attempts = [
    { layout: 'topdown_rpg_v0', file: media.topdownPath },
    { layout: 'fixed_region_motion_v0', file: media.fixedPath },
  ]
  let lastError = null
  for (const attempt of attempts) {
    const sessionId = await openPage(cdp, `${origin}/src/ui/studio/studio.html#character`)
    try {
      await waitForText(cdp, sessionId, 'Character Studio')
      await chooseCharacterLayout(cdp, sessionId, attempt.layout)
      await loadCharacterSheet(cdp, sessionId, attempt.file)
      await processCharacter(cdp, sessionId)
      await assertCleanPage(cdp, sessionId)
      return screenshot(cdp, sessionId, path.join(assetDir, 'studio-character.png'))
    } catch (error) {
      lastError = error
    }
  }
  throw lastError || new Error('character capture failed')
}

async function captureExtract(cdp, origin, gifPath) {
  const sessionId = await openPage(cdp, `${origin}/src/ui/studio/studio.html#action`)
  await waitForText(cdp, sessionId, 'Frame Extraction')
  await waitFor(cdp, sessionId, `(() => ({
    ok: Boolean(document.querySelector('#studio-action-file')),
  }))()`, 15000, 'extract file input')
  await setInputFile(cdp, sessionId, '#studio-action-file', gifPath)
  await waitFor(cdp, sessionId, `(() => {
    const button = document.querySelector('#studio-action-analyze')
    const error = document.querySelector('#studio-action-error')
    const failed = Boolean(error && !error.hidden && error.textContent.trim())
    return { ok: Boolean(button && !button.disabled), failed, detail: failed ? error.textContent.slice(0, 180) : 'analyze' }
  })()`, 15000, 'extract analyze')
  await click(cdp, sessionId, '#studio-action-analyze')
  await waitFor(cdp, sessionId, `(() => {
    const button = document.querySelector('#studio-action-preview')
    const error = document.querySelector('#studio-action-error')
    const failed = Boolean(error && !error.hidden && error.textContent.trim())
    return { ok: Boolean(button && !button.disabled), failed, detail: failed ? error.textContent.slice(0, 180) : 'preview button' }
  })()`, 60000, 'extract analysis')
  await click(cdp, sessionId, '#studio-action-preview')
  await waitFor(cdp, sessionId, `(() => {
    const image = document.querySelector('#studio-action-preview-image')
    const error = document.querySelector('#studio-action-error')
    const failed = Boolean(error && !error.hidden && error.textContent.trim())
    const ready = Boolean(image && !image.hidden && image.complete && image.naturalWidth > 8)
    return { ok: ready, failed, detail: failed ? error.textContent.slice(0, 180) : 'image' }
  })()`, 60000, 'extract preview')
  await assertCleanPage(cdp, sessionId)
  return screenshot(cdp, sessionId, path.join(assetDir, 'studio-extract.png'))
}

async function captureMap(cdp, origin) {
  const sessionId = await openPage(cdp, `${origin}/src/ui/studio/studio.html#tiles`)
  await waitForText(cdp, sessionId, 'Map Studio')
  await waitFor(cdp, sessionId, `(() => {
    const button = document.querySelector('#studio-tiles-primary')
    return { ok: Boolean(button && !button.disabled) }
  })()`, 15000, 'map primary')
  await click(cdp, sessionId, '#studio-tiles-primary')
  await waitFor(cdp, sessionId, `(() => ({
    ok: document.querySelector('#studio-tiles-view')?.dataset.tilesPhase === 'ready',
    detail: document.querySelector('#studio-tiles-view')?.dataset.tilesPhase || '',
  }))()`, 15000, 'map editor')
  await click(cdp, sessionId, '#studio-tiles-primary')
  await waitFor(cdp, sessionId, `(() => {
    const view = document.querySelector('#studio-tiles-view')
    const image = document.querySelector('#studio-tiles-result-preview')
    const phase = view?.dataset.tilesPhase || ''
    const failed = phase === 'failed'
    const ready = phase === 'complete' && image && !image.hidden && image.complete && image.naturalWidth > 8
    return { ok: ready, failed, detail: phase }
  })()`, 120000, 'map preview')
  await assertCleanPage(cdp, sessionId)
  return screenshot(cdp, sessionId, path.join(assetDir, 'studio-map.png'))
}

async function main() {
  await mkdir(assetDir, { recursive: true })
  const chromePath = await findChrome()
  const mediaRoot = await mkdtemp(path.join(os.tmpdir(), 'moteweave-site-'))
  await chmod(mediaRoot, 0o700)
  const mediaDir = path.join(mediaRoot, 'media')
  await mkdir(mediaDir, { recursive: true, mode: 0o700 })
  const captureId = `site-capture-${crypto.randomBytes(4).toString('hex')}`
  const editorRoot = path.join(rootDir, 'workspace', captureId)
  const workspaceRoot = path.join(editorRoot, 'editor')
  const generatedDir = path.join(editorRoot, 'generated')
  await mkdir(workspaceRoot, { recursive: true, mode: 0o700 })
  await mkdir(generatedDir, { recursive: true, mode: 0o700 })
  const media = await prepareMedia(mediaDir)
  const port = await claimPort(Number(process.env.MOTEWEAVE_SITE_CAPTURE_PORT || 41873), 20)
  const origin = `http://127.0.0.1:${port}`
  const serverLog = openSync('/tmp/moteweave-capture-server.log', 'w')
  const server = startServer(port, workspaceRoot, generatedDir, serverLog)
  let chrome = null
  let userDataDir = null
  try {
    await waitForHttp(`${origin}/src/ui/studio/studio.html`)
    const projectId = await seedVnext(origin, media.frames, media.palette)
    const debuggingPort = await claimPort(Number(process.env.MOTEWEAVE_CHROME_PORT || 9334), 20)
    userDataDir = await mkdtemp(path.join(os.tmpdir(), 'moteweave-chrome-'))
    chrome = startChrome(chromePath, userDataDir, debuggingPort)
    await waitForHttp(`http://127.0.0.1:${debuggingPort}/json/version`)
    const version = await fetch(`http://127.0.0.1:${debuggingPort}/json/version`).then((response) => response.json())
    const cdp = connectCdp(version.webSocketDebuggerUrl)
    await cdp.opened
    const studio = process.env.MOTEWEAVE_SKIP_STUDIO
      ? []
      : [
        await captureCharacter(cdp, origin, media),
        await captureExtract(cdp, origin, media.gifPath),
        await captureMap(cdp, origin),
      ]
    const vnext = await captureVnext(cdp, origin, projectId)
    console.log(JSON.stringify({ studio, vnext }, null, 2))
    cdp.ws.close()
  } finally {
    chrome?.kill('SIGTERM')
    server.kill('SIGTERM')
    await delay(400)
    if (userDataDir) await rm(userDataDir, { recursive: true, force: true }).catch(() => {})
    await rm(mediaRoot, { recursive: true, force: true }).catch(() => {})
    await rm(editorRoot, { recursive: true, force: true }).catch(() => {})
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) {
  try {
    await main()
  } catch (error) {
    console.error(redact(error?.stack || error?.message || error))
    process.exitCode = 1
  }
}
