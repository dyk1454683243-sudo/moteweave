#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'

import JSZip from 'jszip'
import sharp from 'sharp'

const CHROME_PATH =
  process.env.CHROME_PATH ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const DEFAULT_TIMEOUT_MS = 90_000

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] || fallback : fallback
}

function assertCondition(condition, message) {
  if (!condition) throw new Error(message)
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close((error) => error ? reject(error) : resolve(port))
    })
  })
}

function processGroupExists(processGroupId) {
  try {
    process.kill(-processGroupId, 0)
    return true
  } catch (error) {
    if (error?.code === 'ESRCH') return false
    if (error?.code === 'EPERM') return true
    throw error
  }
}

function signalProcessGroup(processGroupId, signal) {
  try {
    process.kill(-processGroupId, signal)
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error
  }
}

async function waitForProcessGroupExit(processGroupId, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (processGroupExists(processGroupId) && Date.now() < deadline) {
    await delay(25)
  }
  return !processGroupExists(processGroupId)
}

async function stopProcessGroup(processGroupId) {
  if (!processGroupId || !processGroupExists(processGroupId)) return
  signalProcessGroup(processGroupId, 'SIGTERM')
  if (await waitForProcessGroupExit(processGroupId, 2_000)) return
  signalProcessGroup(processGroupId, 'SIGKILL')
  if (!await waitForProcessGroupExit(processGroupId, 2_000)) {
    throw new Error(`process group ${processGroupId} survived SIGKILL`)
  }
}

async function makeMotionZip(filePath) {
  const zip = new JSZip()
  const width = 32
  const height = 32
  for (let frameIndex = 0; frameIndex < 8; frameIndex += 1) {
    const data = Buffer.alloc(width * height * 4)
    const left = 3 + frameIndex * 2
    const top = 10 + (frameIndex % 3)
    for (let y = top; y < top + 12; y += 1) {
      for (let x = left; x < Math.min(width, left + 8); x += 1) {
        const offset = (y * width + x) * 4
        data[offset] = 60 + frameIndex * 18
        data[offset + 1] = 210 - frameIndex * 12
        data[offset + 2] = 110 + (frameIndex % 2) * 70
        data[offset + 3] = 255
      }
    }
    const png = await sharp(data, {
      raw: { width, height, channels: 4 },
    }).png().toBuffer()
    zip.file(`frame_${String(frameIndex + 1).padStart(2, '0')}.png`, png)
  }
  await writeFile(filePath, await zip.generateAsync({ type: 'nodebuffer' }))
}

async function makeTargetSheet(filePath) {
  await sharp({
    create: {
      width: 768,
      height: 768,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).png().toFile(filePath)
}

class CdpClient {
  constructor(url) {
    this.url = url
    this.socket = null
    this.nextId = 1
    this.pending = new Map()
    this.events = new Set()
  }

  async connect() {
    this.socket = new WebSocket(this.url)
    this.socket.addEventListener('message', (event) => {
      const payload = JSON.parse(String(event.data))
      if (payload.id) {
        const pending = this.pending.get(payload.id)
        if (!pending) return
        this.pending.delete(payload.id)
        if (payload.error) {
          pending.reject(new Error(`${pending.method}: ${payload.error.message}`))
        } else {
          pending.resolve(payload.result ?? {})
        }
        return
      }
      for (const listener of this.events) listener(payload)
    })
    await new Promise((resolve, reject) => {
      const onOpen = () => {
        this.socket.removeEventListener('error', onError)
        resolve()
      }
      const onError = (event) => {
        this.socket.removeEventListener('open', onOpen)
        reject(event.error ?? new Error('CDP websocket failed'))
      }
      this.socket.addEventListener('open', onOpen, { once: true })
      this.socket.addEventListener('error', onError, { once: true })
    })
  }

  send(method, params = {}, sessionId = undefined) {
    const id = this.nextId
    this.nextId += 1
    const payload = {
      id,
      method,
      params,
      ...(sessionId ? { sessionId } : {}),
    }
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method })
      this.socket.send(JSON.stringify(payload))
    })
  }

  onEvent(listener) {
    this.events.add(listener)
    return () => this.events.delete(listener)
  }

  close() {
    this.socket?.close()
  }
}

async function waitForServer(child, timeoutMs) {
  let output = ''
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (output.includes('Character tool running')) return
    if (child.exitCode !== null) {
      throw new Error(`server exited before ready: ${child.exitCode}\n${output}`)
    }
    await new Promise((resolve) => {
      const onData = (chunk) => {
        output = `${output}${chunk.toString()}`.slice(-16_384)
        resolve()
      }
      child.stdout.once('data', onData)
      child.stderr.once('data', onData)
      setTimeout(resolve, 50)
    })
  }
  throw new Error(`server did not start within ${timeoutMs}ms\n${output}`)
}

async function waitForChrome(debugPort, child, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let lastError = null
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Chrome exited before CDP was ready: ${child.exitCode}`)
    }
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`)
      if (response.ok) {
        const payload = await response.json()
        if (payload.webSocketDebuggerUrl) return payload.webSocketDebuggerUrl
      }
    } catch (error) {
      lastError = error
    }
    await delay(50)
  }
  throw new Error(`Chrome CDP did not start: ${lastError?.message ?? 'timeout'}`)
}

async function evaluate(client, sessionId, expression) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  }, sessionId)
  if (result.exceptionDetails) {
    throw new Error(
      result.exceptionDetails.exception?.description ||
      result.exceptionDetails.text ||
      'browser evaluation failed'
    )
  }
  return result.result?.value
}

async function waitForExpression(
  client,
  sessionId,
  expression,
  timeoutMs,
  label
) {
  const deadline = Date.now() + timeoutMs
  let lastError = null
  while (Date.now() < deadline) {
    try {
      if (await evaluate(client, sessionId, expression)) return
    } catch (error) {
      lastError = error
    }
    await delay(100)
  }
  throw new Error(`${label} timed out: ${lastError?.message ?? expression}`)
}

async function click(client, sessionId, selector) {
  const clicked = await evaluate(
    client,
    sessionId,
    `(() => {
      const node = document.querySelector(${JSON.stringify(selector)})
      if (!node || node.disabled) return false
      node.click()
      return true
    })()`
  )
  assertCondition(clicked, `could not click ${selector}`)
}

async function setValue(client, sessionId, selector, value, eventName = 'change') {
  const changed = await evaluate(
    client,
    sessionId,
    `(() => {
      const node = document.querySelector(${JSON.stringify(selector)})
      if (!node || node.disabled) return false
      node.value = ${JSON.stringify(String(value))}
      node.dispatchEvent(new Event(${JSON.stringify(eventName)}, { bubbles: true }))
      return true
    })()`
  )
  assertCondition(changed, `could not change ${selector}`)
}

async function setInputFile(client, sessionId, selector, filePath) {
  const documentNode = await client.send('DOM.getDocument', {
    depth: -1,
    pierce: true,
  }, sessionId)
  const found = await client.send('DOM.querySelector', {
    nodeId: documentNode.root.nodeId,
    selector,
  }, sessionId)
  assertCondition(found.nodeId, `file input not found: ${selector}`)
  await client.send('DOM.setFileInputFiles', {
    nodeId: found.nodeId,
    files: [filePath],
  }, sessionId)
}

async function clearInputFile(client, sessionId, selector) {
  const documentNode = await client.send('DOM.getDocument', {
    depth: -1,
    pierce: true,
  }, sessionId)
  const found = await client.send('DOM.querySelector', {
    nodeId: documentNode.root.nodeId,
    selector,
  }, sessionId)
  assertCondition(found.nodeId, `file input not found: ${selector}`)
  await client.send('DOM.setFileInputFiles', {
    nodeId: found.nodeId,
    files: [],
  }, sessionId)
  await evaluate(
    client,
    sessionId,
    `document.querySelector(${JSON.stringify(selector)})
      .dispatchEvent(new Event('change', { bubbles: true }))`
  )
}

async function setViewport(client, sessionId, width, height) {
  await client.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width <= 480,
    screenWidth: width,
    screenHeight: height,
  }, sessionId)
  await delay(150)
}

async function captureScreenshot(client, sessionId, filePath) {
  const result = await client.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  }, sessionId)
  await writeFile(filePath, Buffer.from(result.data, 'base64'))
}

async function inspectLayout(client, sessionId) {
  return evaluate(
    client,
    sessionId,
    `(() => {
      const selectors = [
        '#motion-source',
        '.motion-source-shell',
        '.motion-source-layout',
        '#motion-source-guided-sidebar',
        '#motion-source-advanced-sidebar',
        '.motion-source-workspace',
        '.motion-source-preview-grid',
        '.motion-evidence-hud',
        '.motion-source-report-grid',
        '.motion-source-artifacts',
      ]
      const motionOverflow = selectors.flatMap((selector) => {
        const node = document.querySelector(selector)
        if (!node || node.hidden) return []
        return node.scrollWidth > node.clientWidth + 1
          ? [{ selector, clientWidth: node.clientWidth, scrollWidth: node.scrollWidth }]
          : []
      })
      const layout = document.querySelector('.motion-source-layout')
      const workspace = document.querySelector('.motion-source-workspace')
      const toolbar = document.querySelector('.motion-source-workspace .workspace-toolbar')
      const tabs = document.querySelector('.app-header .tabs')
      const activeTab = tabs.querySelector('.tab-button.active')
      const tabsRect = tabs.getBoundingClientRect()
      const activeTabRect = activeTab.getBoundingClientRect()
      const pageScrollWidth = Math.max(
        document.documentElement.scrollWidth,
        document.body.scrollWidth
      )
      return {
        viewport: [window.innerWidth, window.innerHeight],
        scrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
        overflow: pageScrollWidth > window.innerWidth + 1,
        motionOverflow,
        guidedHidden: document.querySelector('#motion-source-guided-sidebar').hidden,
        advancedHidden: document.querySelector('#motion-source-advanced-sidebar').hidden,
        reportColumns: getComputedStyle(document.querySelector('.motion-source-report-grid')).gridTemplateColumns,
        actionCount: document.querySelector('#motion-guide-action').options.length,
        targetFrames: document.querySelector('#motion-guide-target').value,
        recipe: document.querySelector('#motion-guide-selection-recipe').value,
        futureDisabled: [...document.querySelectorAll('.motion-guide-future-row button')].every((node) => node.disabled),
        maxTabHeight: Math.max(...[...document.querySelectorAll('.app-header .tab-button')].map((node) => node.getBoundingClientRect().height)),
        navScrollable: tabs.scrollWidth > tabs.clientWidth + 1,
        activeTabVisible:
          activeTabRect.left >= tabsRect.left - 1 &&
          activeTabRect.right <= tabsRect.right + 1,
        pageOffset: [window.scrollX, window.scrollY],
        visualViewportOffset: window.visualViewport
          ? [window.visualViewport.offsetLeft, window.visualViewport.offsetTop]
          : null,
        workspaceScrollTop: workspace.scrollTop,
        layoutTop: Math.round(layout.getBoundingClientRect().top),
        workspaceTop: Math.round(workspace.getBoundingClientRect().top),
        toolbarTop: Math.round(toolbar.getBoundingClientRect().top),
      }
    })()`
  )
}

const screenshotDir = argValue(
  '--screenshot-dir',
  path.join('/private/tmp', `gametool-motion-ui-${process.pid}`)
)
const timeoutMs = Number(argValue('--timeout-ms', DEFAULT_TIMEOUT_MS))
const motionZipPath = path.join('/private/tmp', `gametool-motion-source-${process.pid}.zip`)
const targetSheetPath = path.join('/private/tmp', `gametool-motion-target-${process.pid}.png`)
const chromeProfilePath = path.join('/private/tmp', `gametool-motion-chrome-${process.pid}`)

let server = null
let chrome = null
let client = null
let serverProcessGroupId = null
let chromeProcessGroupId = null
const consoleErrors = []
const browserExceptions = []

try {
  assertCondition(Number.isFinite(timeoutMs) && timeoutMs > 0, 'invalid timeout')
  await makeMotionZip(motionZipPath)
  await makeTargetSheet(targetSheetPath)

  const serverPort = await freePort()
  const debugPort = await freePort()
  server = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    detached: process.platform !== 'win32',
    env: {
      ...process.env,
      PORT: String(serverPort),
      OPENROUTER_API_KEY: '',
      GEMINI_API_KEY: '',
      GOOGLE_API_KEY: '',
      CHARACTER_IMAGE_API_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  serverProcessGroupId = server.pid
  await waitForServer(server, 10_000)

  chrome = spawn(CHROME_PATH, [
    '--headless=new',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-extensions',
    '--disable-features=Translate,OptimizationHints',
    '--disable-gpu',
    '--disable-sync',
    '--metrics-recording-only',
    '--mute-audio',
    '--no-default-browser-check',
    '--no-first-run',
    `--remote-debugging-port=${debugPort}`,
    '--remote-allow-origins=*',
    `--user-data-dir=${chromeProfilePath}`,
    'about:blank',
  ], {
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  chromeProcessGroupId = chrome.pid

  const webSocketUrl = await waitForChrome(debugPort, chrome, 10_000)
  client = new CdpClient(webSocketUrl)
  await client.connect()
  const { targetId } = await client.send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await client.send('Target.attachToTarget', {
    targetId,
    flatten: true,
  })
  await client.send('Page.enable', {}, sessionId)
  await client.send('Runtime.enable', {}, sessionId)
  await client.send('DOM.enable', {}, sessionId)
  await client.send('Log.enable', {}, sessionId)
  client.onEvent((event) => {
    if (event.sessionId !== sessionId) return
    if (event.method === 'Runtime.exceptionThrown') {
      browserExceptions.push(
        event.params?.exceptionDetails?.exception?.description ??
        event.params?.exceptionDetails?.text ??
        'unknown exception'
      )
    }
    if (
      event.method === 'Log.entryAdded' &&
      ['error', 'warning'].includes(event.params?.entry?.level)
    ) {
      consoleErrors.push(`${event.params.entry.level}: ${event.params.entry.text}`)
    }
  })

  await setViewport(client, sessionId, 1440, 1000)
  await client.send('Page.navigate', {
    url: `http://127.0.0.1:${serverPort}/`,
  }, sessionId)
  await waitForExpression(
    client,
    sessionId,
    `document.readyState === 'complete' && Boolean(document.querySelector('#motion-source-tab'))`,
    15_000,
    'homepage load'
  )
  await click(client, sessionId, '#motion-source-tab')
  await waitForExpression(
    client,
    sessionId,
    `!document.querySelector('#motion-source').hidden`,
    5_000,
    'Motion Source tab activation'
  )

  const initial = await inspectLayout(client, sessionId)
  assertCondition(initial.actionCount === 16, `expected 16 actions, got ${initial.actionCount}`)
  assertCondition(initial.targetFrames === '4', `expected target 4, got ${initial.targetFrames}`)
  assertCondition(
    initial.recipe === 'motion_selection_recipe_v2',
    `expected v2 recipe, got ${initial.recipe}`
  )
  assertCondition(!initial.guidedHidden && initial.advancedHidden, 'Guided should be default')
  assertCondition(initial.futureDisabled, 'future capability controls must stay disabled')
  assertCondition(!initial.overflow, `desktop overflow: ${JSON.stringify(initial)}`)
  assertCondition(
    initial.motionOverflow.length === 0,
    `desktop Motion containers overflow: ${JSON.stringify(initial)}`
  )

  await setValue(
    client,
    sessionId,
    '#motion-guide-selection-recipe',
    'motion_selection_v1_compat'
  )
  const v1Dependency = await evaluate(
    client,
    sessionId,
    `(() => ({
      loop: document.querySelector('#motion-guide-loop-expectation').value,
      loopDisabled: document.querySelector('#motion-guide-loop-expectation').disabled,
      matte: document.querySelector('#motion-guide-temporal-matte').value,
      matteDisabled: document.querySelector('#motion-guide-temporal-matte').disabled,
    }))()`
  )
  assertCondition(
    v1Dependency.loop === 'auto' &&
    v1Dependency.loopDisabled &&
    v1Dependency.matte === 'disabled' &&
    v1Dependency.matteDisabled,
    `v1 dependency mismatch: ${JSON.stringify(v1Dependency)}`
  )
  await setValue(
    client,
    sessionId,
    '#motion-guide-selection-recipe',
    'motion_selection_recipe_v2'
  )

  await setInputFile(client, sessionId, '#motion-source-file', motionZipPath)
  await waitForExpression(
    client,
    sessionId,
    `document.querySelector('#motion-guide-source-summary').textContent.includes('.zip') &&
      !document.querySelector('#motion-guide-preview').disabled`,
    10_000,
    'source selection'
  )
  await click(client, sessionId, '#motion-guide-preview')
  await waitForExpression(
    client,
    sessionId,
    `document.querySelectorAll('.motion-source-frame-card').length === 8 &&
      !document.querySelector('#motion-guide-build').disabled`,
    20_000,
    'Preview candidates'
  )
  const verifiedPreviewSrc = await evaluate(
    client,
    sessionId,
    `document.querySelector('#motion-source-frame-preview-sheet').src`
  )
  await evaluate(
    client,
    sessionId,
    `document.querySelector('#motion-source-frame-preview-sheet').src =
      'data:image/png;base64,AAAA'`
  )
  await waitForExpression(
    client,
    sessionId,
    `document.querySelector('.motion-guide-step[data-step="select"]').dataset.state === 'blocked' &&
      document.querySelector('#motion-guide-build').disabled`,
    5_000,
    'Preview post-load image gate'
  )
  const failedPreviewImageGate = await evaluate(
    client,
    sessionId,
    `(() => ({
      selectState: document.querySelector('.motion-guide-step[data-step="select"]').dataset.state,
      buildDisabled: document.querySelector('#motion-guide-build').disabled,
    }))()`
  )
  assertCondition(
    failedPreviewImageGate.selectState === 'blocked' &&
      failedPreviewImageGate.buildDisabled,
    `unreadable Preview image did not block Guided Build: ${JSON.stringify(failedPreviewImageGate)}`
  )
  await evaluate(
    client,
    sessionId,
    `document.querySelector('#motion-source-frame-preview-sheet').src =
      ${JSON.stringify(verifiedPreviewSrc)}`
  )
  await waitForExpression(
    client,
    sessionId,
    `document.querySelector('.motion-guide-step[data-step="select"]').dataset.state === 'ready' &&
      !document.querySelector('#motion-guide-build').disabled`,
    5_000,
    'Preview post-load image recovery'
  )

  await click(
    client,
    sessionId,
    '.motion-source-frame-card [data-frame-action="remove"]'
  )
  await waitForExpression(
    client,
    sessionId,
    `document.querySelectorAll('.motion-source-frame-card').length === 7 &&
      document.querySelector('#motion-guide-selection-mode').value === 'manual'`,
    5_000,
    'Manual candidate removal'
  )
  await click(client, sessionId, '#motion-guide-restore-auto')
  await waitForExpression(
    client,
    sessionId,
    `document.querySelectorAll('.motion-source-frame-card').length === 8 &&
      document.querySelector('#motion-guide-selection-mode').value === 'auto'`,
    5_000,
    'Restore Auto'
  )

  await click(client, sessionId, '#motion-guide-build')
  await waitForExpression(
    client,
    sessionId,
    `!document.querySelector('#motion-source-strip-preview').hidden &&
      document.querySelector('#motion-source-report').textContent.includes('motion_selection_report_v2')`,
    25_000,
    'Motion Selection v2 Build'
  )
  await setInputFile(client, sessionId, '#motion-source-sheet-file', targetSheetPath)
  await waitForExpression(
    client,
    sessionId,
    `!document.querySelector('#motion-guide-apply').disabled`,
    5_000,
    'Apply readiness'
  )

  await setValue(client, sessionId, '#motion-guide-target', '5', 'input')
  const staleGate = await evaluate(
    client,
    sessionId,
    `(() => ({
      disabled: document.querySelector('#motion-guide-apply').disabled,
      reviewState: document.querySelector('.motion-guide-step[data-step="review"]').dataset.state,
    }))()`
  )
  assertCondition(
    staleGate.disabled && staleGate.reviewState === 'stale',
    `stale gate failed: ${JSON.stringify(staleGate)}`
  )
  await setValue(client, sessionId, '#motion-guide-target', '4', 'input')
  await waitForExpression(
    client,
    sessionId,
    `!document.querySelector('#motion-guide-apply').disabled`,
    5_000,
    'Build binding restoration'
  )

  await click(client, sessionId, '#motion-guide-apply')
  await waitForExpression(
    client,
    sessionId,
    `!document.querySelector('#motion-source-apply-preview').hidden`,
    20_000,
    'Apply Strip'
  )
  const applyEvidence = await evaluate(
    client,
    sessionId,
    `(() => ({
      report: document.querySelector('#motion-source-report').textContent,
      step: document.querySelector('.motion-guide-step[data-step="apply"]').dataset.state,
    }))()`
  )
  assertCondition(
    applyEvidence.report.includes('"status": "warning"') &&
      applyEvidence.step === 'needs-review',
    `Apply warning evidence was not preserved: ${JSON.stringify(applyEvidence)}`
  )
  const verifiedApplySrc = await evaluate(
    client,
    sessionId,
    `document.querySelector('#motion-source-apply-preview').src`
  )
  const verifiedConcurrentStripSrc = await evaluate(
    client,
    sessionId,
    `document.querySelector('#motion-source-strip-preview').src`
  )
  const verifiedContactSrc = await evaluate(
    client,
    sessionId,
    `document.querySelector('#motion-source-contact-sheet').src`
  )
  await evaluate(
    client,
    sessionId,
    `(() => {
      document.querySelector('#motion-source-contact-sheet').src =
        'data:image/png;base64,AAAA'
      document.querySelector('#motion-source-strip-preview').src =
        'data:image/png;base64,AAAA'
    })()`
  )
  await waitForExpression(
    client,
    sessionId,
    `document.querySelector('.motion-guide-step[data-step="review"]').dataset.state === 'blocked' &&
      document.querySelector('#motion-guide-apply').disabled`,
    5_000,
    'Same-store Build image gates'
  )
  await evaluate(
    client,
    sessionId,
    `document.querySelector('#motion-source-strip-preview').src =
      ${JSON.stringify(verifiedConcurrentStripSrc)}`
  )
  await waitForExpression(
    client,
    sessionId,
    `!document.querySelector('#motion-source-strip-preview').hidden`,
    5_000,
    'Same-store strip-only recovery'
  )
  await delay(200)
  const failedSameStoreImageGates = await evaluate(
    client,
    sessionId,
    `(() => ({
      contactHidden: document.querySelector('#motion-source-contact-sheet').hidden,
      stripHidden: document.querySelector('#motion-source-strip-preview').hidden,
      reviewState: document.querySelector('.motion-guide-step[data-step="review"]').dataset.state,
      applyDisabled: document.querySelector('#motion-guide-apply').disabled,
    }))()`
  )
  assertCondition(
    failedSameStoreImageGates.contactHidden &&
      !failedSameStoreImageGates.stripHidden &&
      failedSameStoreImageGates.reviewState === 'blocked' &&
      failedSameStoreImageGates.applyDisabled,
    `one recovered Build image cleared a sibling error: ${JSON.stringify(failedSameStoreImageGates)}`
  )
  await evaluate(
    client,
    sessionId,
    `document.querySelector('#motion-source-contact-sheet').src =
      ${JSON.stringify(verifiedContactSrc)}`
  )
  await waitForExpression(
    client,
    sessionId,
    `!document.querySelector('#motion-source-contact-sheet').hidden &&
      document.querySelector('.motion-guide-step[data-step="review"]').dataset.state !== 'blocked' &&
      !document.querySelector('#motion-guide-apply').disabled`,
    5_000,
    'Same-store Build image recovery'
  )
  await evaluate(
    client,
    sessionId,
    `(() => {
      document.querySelector('#motion-source-strip-preview').src =
        'data:image/png;base64,AAAA'
      document.querySelector('#motion-source-apply-preview').src =
        'data:image/png;base64,AAAA'
    })()`
  )
  await waitForExpression(
    client,
    sessionId,
    `document.querySelector('.motion-guide-step[data-step="review"]').dataset.state === 'blocked' &&
      document.querySelector('.motion-guide-step[data-step="apply"]').dataset.state === 'blocked' &&
      document.querySelector('#motion-guide-apply').disabled`,
    5_000,
    'Concurrent Build and Apply image gates'
  )
  const failedConcurrentImageGates = await evaluate(
    client,
    sessionId,
    `(() => ({
      reviewState: document.querySelector('.motion-guide-step[data-step="review"]').dataset.state,
      applyState: document.querySelector('.motion-guide-step[data-step="apply"]').dataset.state,
      applyDisabled: document.querySelector('#motion-guide-apply').disabled,
    }))()`
  )
  assertCondition(
    failedConcurrentImageGates.reviewState === 'blocked' &&
      failedConcurrentImageGates.applyState === 'blocked' &&
      failedConcurrentImageGates.applyDisabled,
    `cross-store image errors overwrote one another: ${JSON.stringify(failedConcurrentImageGates)}`
  )
  await evaluate(
    client,
    sessionId,
    `(() => {
      document.querySelector('#motion-source-strip-preview').src =
        ${JSON.stringify(verifiedConcurrentStripSrc)}
      document.querySelector('#motion-source-apply-preview').src =
        ${JSON.stringify(verifiedApplySrc)}
    })()`
  )
  await waitForExpression(
    client,
    sessionId,
    `document.querySelector('.motion-guide-step[data-step="review"]').dataset.state !== 'blocked' &&
      document.querySelector('.motion-guide-step[data-step="apply"]').dataset.state === 'needs-review' &&
      !document.querySelector('#motion-guide-apply').disabled`,
    5_000,
    'Concurrent image gate recovery'
  )
  await evaluate(
    client,
    sessionId,
    `(() => {
      window.__motionUiVerifiedFetch = window.fetch
      window.fetch = (url, options) => {
        if (String(url).includes('/applied_normalized_sheet.png')) {
          return Promise.resolve(new Response('', { status: 503 }))
        }
        return window.__motionUiVerifiedFetch(url, options)
      }
    })()`
  )
  await click(client, sessionId, '#motion-guide-apply')
  await waitForExpression(
    client,
    sessionId,
    `document.querySelector('#motion-source-report').textContent.includes('"store_key": "apply"') &&
      document.querySelector('.motion-guide-step[data-step="apply"]').dataset.state === 'blocked'`,
    20_000,
    'Apply image artifact fail-closed gate'
  )
  const failedApplyImageGate = await evaluate(
    client,
    sessionId,
    `(() => ({
      appliedSrc: document.querySelector('#motion-source-apply-preview').src,
      applyState: document.querySelector('.motion-guide-step[data-step="apply"]').dataset.state,
    }))()`
  )
  assertCondition(
    failedApplyImageGate.appliedSrc === verifiedApplySrc &&
      failedApplyImageGate.applyState === 'blocked',
    `unverified Apply image became authoritative: ${JSON.stringify(failedApplyImageGate)}`
  )
  await evaluate(
    client,
    sessionId,
    `(() => {
      window.fetch = window.__motionUiVerifiedFetch
      delete window.__motionUiVerifiedFetch
    })()`
  )
  await click(client, sessionId, '#motion-guide-apply')
  await waitForExpression(
    client,
    sessionId,
    `document.querySelector('.motion-guide-step[data-step="apply"]').dataset.state === 'needs-review' &&
      !document.querySelector('#motion-source-apply-preview').hidden`,
    20_000,
    'Apply recovery after image artifact failure'
  )

  await captureScreenshot(
    client,
    sessionId,
    path.join(screenshotDir, 'guided-motion-source-1440.png')
  )
  await click(client, sessionId, '#motion-source-view-advanced')
  await waitForExpression(
    client,
    sessionId,
    `document.querySelector('#motion-source-guided-sidebar').hidden &&
      !document.querySelector('#motion-source-advanced-sidebar').hidden`,
    5_000,
    'Advanced view'
  )
  const advanced = await inspectLayout(client, sessionId)
  assertCondition(advanced.actionCount === 16, 'Advanced action list lost profile entries')
  assertCondition(
    advanced.toolbarTop === advanced.workspaceTop &&
      advanced.workspaceTop === advanced.layoutTop &&
      advanced.workspaceScrollTop === 0,
    `Advanced workspace shifted after view switch: ${JSON.stringify(advanced)}`
  )
  await captureScreenshot(
    client,
    sessionId,
    path.join(screenshotDir, 'advanced-motion-source-1440.png')
  )
  await click(client, sessionId, '#motion-source-view-guided')

  const responsive = []
  for (const [width, height] of [
    [1024, 900],
    [800, 900],
    [390, 844],
  ]) {
    await setViewport(client, sessionId, width, height)
    await evaluate(
      client,
      sessionId,
      `new Promise((resolve) => {
        window.scrollTo(0, 0)
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      })`
    )
    const layout = await inspectLayout(client, sessionId)
    assertCondition(!layout.overflow, `${width}px horizontal overflow: ${JSON.stringify(layout)}`)
    assertCondition(
      layout.motionOverflow.length === 0,
      `${width}px Motion container overflow: ${JSON.stringify(layout)}`
    )
    assertCondition(!layout.guidedHidden, `${width}px Guided view disappeared`)
    assertCondition(
      layout.activeTabVisible,
      `${width}px active module tab is not visible: ${JSON.stringify(layout)}`
    )
    assertCondition(
      layout.pageOffset[0] === 0 &&
        layout.pageOffset[1] === 0 &&
        (!layout.visualViewportOffset ||
          (layout.visualViewportOffset[0] === 0 && layout.visualViewportOffset[1] === 0)),
      `${width}px viewport offset drifted: ${JSON.stringify(layout)}`
    )
    if (width <= 760) {
      assertCondition(
        layout.maxTabHeight <= 40,
        `${width}px module tabs wrapped vertically: ${JSON.stringify(layout)}`
      )
    }
    responsive.push(layout)
    await captureScreenshot(
      client,
      sessionId,
      path.join(screenshotDir, `guided-motion-source-${width}.png`)
    )
  }

  await setValue(client, sessionId, '#language-select', 'en')
  const englishTitle = await evaluate(
    client,
    sessionId,
    `document.querySelector('#motion-guide-source-title').textContent`
  )
  assertCondition(englishTitle === 'Source', `English title mismatch: ${englishTitle}`)
  await setValue(client, sessionId, '#language-select', 'zh')
  const chineseTitle = await evaluate(
    client,
    sessionId,
    `document.querySelector('#motion-guide-source-title').textContent`
  )
  assertCondition(chineseTitle === '来源', `Chinese title mismatch: ${chineseTitle}`)

  await setViewport(client, sessionId, 1440, 1000)
  await evaluate(
    client,
    sessionId,
    `new Promise((resolve) => {
      window.scrollTo(0, 0)
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    })`
  )

  const verifiedStripSrc = await evaluate(
    client,
    sessionId,
    `document.querySelector('#motion-source-strip-preview').src`
  )
  await evaluate(
    client,
    sessionId,
    `document.querySelector('#motion-source-strip-preview').src =
      'data:image/png;base64,AAAA'`
  )
  await waitForExpression(
    client,
    sessionId,
    `document.querySelector('.motion-guide-step[data-step="review"]').dataset.state === 'blocked' &&
      document.querySelector('#motion-guide-apply').disabled`,
    5_000,
    'Existing Build image error before failed retry'
  )
  await evaluate(
    client,
    sessionId,
    `(() => {
      window.__motionUiVerifiedFetch = window.fetch
      window.fetch = (url, options) => {
        if (String(url).includes('/selected_frames.json')) {
          return Promise.resolve(new Response('', { status: 503 }))
        }
        return window.__motionUiVerifiedFetch(url, options)
      }
    })()`
  )
  await click(client, sessionId, '#motion-guide-build')
  await waitForExpression(
    client,
    sessionId,
    `document.querySelector('#motion-source-report').textContent.includes('"store_key": "build"') &&
      document.querySelector('#motion-guide-apply').disabled`,
    20_000,
    'Build artifact fail-closed gate'
  )
  await evaluate(
    client,
    sessionId,
    `document.querySelector('#motion-source-strip-preview').src =
      ${JSON.stringify(verifiedStripSrc)}`
  )
  await waitForExpression(
    client,
    sessionId,
    `!document.querySelector('#motion-source-strip-preview').hidden`,
    5_000,
    'Old Build image recovery after failed retry'
  )
  const failedBuildGate = await evaluate(
    client,
    sessionId,
    `(() => ({
      stripSrc: document.querySelector('#motion-source-strip-preview').src,
      reviewState: document.querySelector('.motion-guide-step[data-step="review"]').dataset.state,
      applyDisabled: document.querySelector('#motion-guide-apply').disabled,
    }))()`
  )
  assertCondition(
    failedBuildGate.stripSrc === verifiedStripSrc &&
      failedBuildGate.reviewState === 'blocked' &&
      failedBuildGate.applyDisabled,
    `unverified Build artifact became authoritative: ${JSON.stringify(failedBuildGate)}`
  )
  await evaluate(
    client,
    sessionId,
    `(() => {
      window.fetch = window.__motionUiVerifiedFetch
      delete window.__motionUiVerifiedFetch
    })()`
  )

  await click(client, sessionId, '#motion-guide-build')
  await waitForExpression(
    client,
    sessionId,
    `document.querySelector('#motion-source-report').textContent.includes('"mode": "motion_selection_report_v2"') &&
      !document.querySelector('#motion-guide-apply').disabled`,
    20_000,
    'Build recovery after artifact failure'
  )

  const verifiedImageStripSrc = await evaluate(
    client,
    sessionId,
    `document.querySelector('#motion-source-strip-preview').src`
  )
  await evaluate(
    client,
    sessionId,
    `(() => {
      window.__motionUiVerifiedFetch = window.fetch
      window.fetch = (url, options) => {
        if (String(url).includes('/normalized_motion_strip.png')) {
          return Promise.resolve(new Response('', { status: 503 }))
        }
        return window.__motionUiVerifiedFetch(url, options)
      }
    })()`
  )
  await click(client, sessionId, '#motion-guide-build')
  await waitForExpression(
    client,
    sessionId,
    `document.querySelector('#motion-source-report').textContent.includes('"store_key": "build"') &&
      document.querySelector('#motion-guide-apply').disabled`,
    20_000,
    'Build image artifact fail-closed gate'
  )
  const failedBuildImageGate = await evaluate(
    client,
    sessionId,
    `(() => ({
      stripSrc: document.querySelector('#motion-source-strip-preview').src,
      reviewState: document.querySelector('.motion-guide-step[data-step="review"]').dataset.state,
      applyDisabled: document.querySelector('#motion-guide-apply').disabled,
    }))()`
  )
  assertCondition(
    failedBuildImageGate.stripSrc === verifiedImageStripSrc &&
      failedBuildImageGate.reviewState === 'blocked' &&
      failedBuildImageGate.applyDisabled,
    `unverified Build image became authoritative: ${JSON.stringify(failedBuildImageGate)}`
  )
  await evaluate(
    client,
    sessionId,
    `(() => {
      window.fetch = window.__motionUiVerifiedFetch
      delete window.__motionUiVerifiedFetch
    })()`
  )
  await click(client, sessionId, '#motion-guide-build')
  await waitForExpression(
    client,
    sessionId,
    `document.querySelector('#motion-source-report').textContent.includes('"mode": "motion_selection_report_v2"') &&
      !document.querySelector('#motion-guide-apply').disabled`,
    20_000,
    'Build recovery after image artifact failure'
  )

  await setValue(client, sessionId, '#motion-guide-target', '8', 'input')
  await click(client, sessionId, '#motion-guide-build')
  await waitForExpression(
    client,
    sessionId,
    `document.querySelector('#motion-source-report').textContent.includes('"selected_frame_count": 8') &&
      document.querySelector('#motion-guide-apply').disabled`,
    20_000,
    'latest Build frame mismatch'
  )
  await setInputFile(client, sessionId, '#motion-source-strip-file', targetSheetPath)
  await waitForExpression(
    client,
    sessionId,
    `!document.querySelector('#motion-guide-apply').disabled`,
    5_000,
    'edited strip independent authority'
  )
  const editedOverrideGate = await evaluate(
    client,
    sessionId,
    `(() => ({
      applyDisabled: document.querySelector('#motion-guide-apply').disabled,
      sheetSummary: document.querySelector('#motion-guide-sheet-summary').textContent,
    }))()`
  )
  assertCondition(
    !editedOverrideGate.applyDisabled &&
      !editedOverrideGate.sheetSummary.includes('帧数不匹配'),
    `edited strip inherited the old Build frame count: ${JSON.stringify(editedOverrideGate)}`
  )
  await clearInputFile(client, sessionId, '#motion-source-strip-file')

  assertCondition(
    browserExceptions.length === 0,
    `browser exceptions: ${browserExceptions.join('\n')}`
  )
  assertCondition(
    consoleErrors.length === 0,
    `browser console warnings/errors: ${consoleErrors.join('\n')}`
  )

  console.log(JSON.stringify({
    status: 'pass',
    screenshots: [
      'guided-motion-source-1440.png',
      'advanced-motion-source-1440.png',
      'guided-motion-source-1024.png',
      'guided-motion-source-800.png',
      'guided-motion-source-390.png',
    ].map((name) => path.join(screenshotDir, name)),
    desktop: initial,
    advanced,
    responsive,
    evidence_gates: {
      failed_preview_image: failedPreviewImageGate,
      apply_warning: applyEvidence.step,
      failed_same_store_images: failedSameStoreImageGates,
      failed_concurrent_images: failedConcurrentImageGates,
      failed_apply_image: failedApplyImageGate,
      failed_build: failedBuildGate,
      failed_build_image: failedBuildImageGate,
      edited_override: editedOverrideGate,
    },
    source_fixture: motionZipPath,
    target_fixture: targetSheetPath,
  }, null, 2))

  await client.send('Target.closeTarget', { targetId })
  await client.send('Browser.close')
} finally {
  client?.close()
  await stopProcessGroup(chromeProcessGroupId)
  await stopProcessGroup(serverProcessGroupId)
}
