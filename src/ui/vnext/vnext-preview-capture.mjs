#!/usr/bin/env node
// VIS-02 browser self-check and evidence capture.
// Set VIS02_EVIDENCE_DIR to an explicit absolute evidence directory, then
// run only through the checked-in resource supervisor, e.g.
//   node scripts/run-with-resource-guard.mjs --max-old-space-mib 2048 --max-rss-mib 4096 \
//     --timeout-ms 180000 --poll-ms 500 -- node src/ui/vnext/vnext-preview-capture.mjs
// It starts the maintained server.js (real entry, empty provider keys), drives a
// headless Chrome through CDP at a real 1920×1080 viewport, then a short headed
// Chrome only for native file-picker Tab/Enter/Space/Escape. Records every network
// request, console/log entry, and page-level fetch/XMLHttpRequest call, reads the
// platform fonts Chrome actually used, and writes screenshots plus a JSON report
// (with SHA256 hashes) to the evidence directory.

import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import { encodeRgbaPng } from '../../editor-project/spriteDocumentStore.js'

const CHROME_PATH =
  process.env.CHROME_PATH ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const EVIDENCE_DIR = process.env.VIS02_EVIDENCE_DIR
if (!EVIDENCE_DIR || !path.isAbsolute(EVIDENCE_DIR)) {
  throw new Error('VIS02_EVIDENCE_DIR must be an explicit absolute directory')
}
const PREVIEW_PATH = '/src/ui/vnext/vnext-preview.html'
const VIEWPORT = { width: 1920, height: 1080 }
const SOURCE_FILES = [
  'src/ui/vnext/vnext-preview.html',
  'src/ui/vnext/vnext-preview.css',
  'src/ui/vnext/vnext-preview.js',
  'src/ui/vnext/vnext-generation-view.js',
  'src/ui/vnext/vnext-generation-client.js',
  'src/ui/vnext/vnext-project-client.js',
  'src/ui/vnext/vnext-canvas-view.js',
  'src/ui/vnext/vnext-preview-sprite.mjs',
  'src/ui/vnext/vnext-preview-capture.mjs',
  'test/ui/vnext-preview.test.js',
  'test/ui/vnext-generation.test.js',
  'test/ui/vnext-project.test.js',
  'ATTRIBUTIONS.md',
]
const SHOTS = {
  default: 'vis02-r4-home-1920x1080-en-default.png',
  prompt: 'vis02-r4-home-1920x1080-en-prompt.png',
  refValid: 'vis02-r4-home-1920x1080-en-ref-valid.png',
  refIllegal: 'vis02-r4-home-1920x1080-en-ref-illegal.png',
  refCorrupt: 'vis02-r4-home-1920x1080-en-ref-corrupt.png',
  refCleared: 'vis02-r4-home-1920x1080-en-ref-cleared.png',
  refKeyboard: 'vis02-r4-ref-keyboard-focus-crop.png',
  layersOnion: 'vis02-r4-home-1920x1080-en-layers-onion.png',
  skillHover: 'vis02-r4-skill-tag-hover-crop.png',
  skillFocus: 'vis02-r4-skill-tag-focus-crop.png',
  previewCollapsed: 'vis02-r4-preview-collapsed-crop.png',
  timelineUncovered: 'vis02-r4-timeline-skill-closed-crop.png',
  timelineLayers: 'vis02-r4-timeline-layers-crop.png',
  skillPop: 'vis02-r4-skill-pop-crop.png',
  projectMenu: 'p2-04-canvas-binding-fix3a-menu-1920x1080-en.png',
  projectListChoose: 'p2-04-canvas-binding-fix3a-list-choose-1920x1080-en.png',
  projectListLoading: 'p2-04-canvas-binding-fix3a-list-loading-1920x1080-en.png',
  projectListError: 'p2-04-canvas-binding-fix3a-list-error-1920x1080-en.png',
  projectListUnread: 'p2-04-canvas-binding-fix3a-list-unread-1920x1080-en.png',
  projectListOmitted: 'p2-04-canvas-binding-fix3a-list-omitted-1920x1080-en.png',
  projectListSelected: 'p2-04-canvas-binding-fix3a-list-selected-1920x1080-en.png',
  projectListNoMatch: 'p2-04-canvas-binding-fix3a-list-nomatch-1920x1080-en.png',
  projectListLong: 'p2-04-canvas-binding-fix3a-list-longname-1920x1080-en.png',
  projectUpgrade: 'p2-04-canvas-binding-fix3a-upgrade-1920x1080-en.png',
  projectOpen: 'p2-04-canvas-binding-fix3a-open-1920x1080-en.png',
  projectImported: 'p2-04-canvas-binding-fix3a-imported-1920x1080-en.png',
  projectSelected: 'p2-04-canvas-binding-fix3a-selected-1920x1080-en.png',
  projectTimeline: 'p2-04-canvas-binding-fix3a-timeline-1920x1080-en.png',
  projectDirty: 'p2-04-canvas-binding-fix3a-dirty-1920x1080-en.png',
  projectSaved: 'p2-04-canvas-binding-fix3a-saved-1920x1080-en.png',
  projectReopen: 'p2-04-canvas-binding-fix3a-reopen-1920x1080-en.png',
}
const REPORT_FILE = 'vis02-r4-browser-selfcheck.json'

// Exercise the real divider: the swatches shrink, so their selection ring must too.
async function capturePaletteResize(client, sessionId) {
  const states = []
  for (const width of [314, 240, 280, 314]) {
    const start = await evaluate(client, sessionId, `(() => {
      const handle = document.querySelector('.vnext-pane-resizer.is-right').getBoundingClientRect()
      const pane = document.querySelector('.vnext-color-sidebar').getBoundingClientRect()
      return { x: handle.x + handle.width / 2, y: handle.y + 60, width: pane.width }
    })()`)
    await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: start.x, y: start.y, button: 'left', clickCount: 1 }, sessionId)
    await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x + start.width - width, y: start.y, button: 'left', buttons: 1 }, sessionId)
    await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: start.x + start.width - width, y: start.y, button: 'left', clickCount: 1 }, sessionId)
    const state = await evaluate(client, sessionId, `(() => {
      const box = (selector) => {
        const r = document.querySelector(selector).getBoundingClientRect()
        return { x: r.x, y: r.y, w: r.width, h: r.height }
      }
      return {
        pane: box('.vnext-color-sidebar'), head: box('.vnext-palette-head'), palette: box('#vnext-palette'),
        swatch: box('#vnext-palette .is-selected'), ring: box('#vnext-palette .is-selected .vnext-swatch-ring'),
        quickRing: box('.vnext-quick .vnext-swatch-ring'),
        disabled: [...document.querySelectorAll('#vnext-palette button')].every((n) => n.disabled),
      }
    })()`)
    state.requestedWidth = width
    state.passed = Math.abs(state.pane.w - width) < 0.1
      && Math.abs(state.swatch.w - state.swatch.h) < 0.1
      && Math.abs(state.ring.w - state.swatch.w - 7) < 0.6
      && Math.abs(state.ring.h - state.swatch.h - 7) < 0.6
      && Math.abs((state.ring.x + state.ring.w / 2) - (state.swatch.x + state.swatch.w / 2)) < 0.6
      && Math.abs((state.ring.y + state.ring.h / 2) - (state.swatch.y + state.swatch.h / 2)) < 0.6
      && state.quickRing.w === 37 && state.disabled
    state.screenshot = await screenshot(client, sessionId, path.join(EVIDENCE_DIR, `palette-${states.length}-${width}.png`), {
      x: state.pane.x + 8, y: state.head.y - 8, width: state.pane.w - 8,
      height: Math.ceil(state.palette.y + state.palette.h + 12 - (state.head.y - 8)),
    })
    states.push(state)
  }
  return states
}

function fix1GenerateOk(calls) {
  return calls.filter((item) => item.path === '/api/generate-character' && item.method === 'POST').length === 1
}

function fulfillJson(client, sessionId, requestId, status, payload) {
  const raw = Buffer.from(JSON.stringify(payload))
  return client.send('Fetch.fulfillRequest', {
    requestId,
    responseCode: status,
    responseHeaders: [
      { name: 'content-type', value: 'application/json' },
      { name: 'content-length', value: String(raw.length) },
    ],
    body: raw.toString('base64'),
  }, sessionId)
}

function fulfillUnreadable(client, sessionId, requestId) {
  const raw = Buffer.from('not-json')
  return client.send('Fetch.fulfillRequest', {
    requestId,
    responseCode: 200,
    responseHeaders: [
      { name: 'content-type', value: 'application/json' },
      { name: 'content-length', value: String(raw.length) },
    ],
    body: raw.toString('base64'),
  }, sessionId)
}

const FIX1_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

function fulfillPng(client, sessionId, requestId) {
  return client.send('Fetch.fulfillRequest', {
    requestId,
    responseCode: 200,
    responseHeaders: [
      { name: 'content-type', value: 'image/png' },
      { name: 'content-length', value: String(FIX1_PNG.length) },
    ],
    body: FIX1_PNG.toString('base64'),
  }, sessionId)
}

const FIX2_TILE = 32
const FIX2_BLOCK = Buffer.alloc(FIX2_TILE * FIX2_TILE * 4)
for (let i = 0; i < FIX2_BLOCK.length; i += 4) {
  FIX2_BLOCK[i] = 220
  FIX2_BLOCK[i + 1] = 48
  FIX2_BLOCK[i + 2] = 48
  FIX2_BLOCK[i + 3] = 255
}

function fulfillBlock(client, sessionId, requestId, sha) {
  return client.send('Fetch.fulfillRequest', {
    requestId,
    responseCode: 200,
    responseHeaders: [
      { name: 'content-type', value: 'application/octet-stream' },
      { name: 'content-length', value: String(FIX2_BLOCK.length) },
      { name: 'x-sprite-block-width', value: String(FIX2_TILE) },
      { name: 'x-sprite-block-height', value: String(FIX2_TILE) },
      { name: 'x-sprite-block-sha256', value: sha },
    ],
    body: FIX2_BLOCK.toString('base64'),
  }, sessionId)
}

async function captureFix1Interactions(client, sessionId) {
  const calls = []
  const pausedJobs = []
  const parked = []
  let releaseJob
  const jobPaused = new Promise((resolve) => { releaseJob = resolve })
  const hash = 'a'.repeat(64)
  const addedDocId = 'doc_fix2_add'
  const addedCanvasId = 'canvas_fix2_add'
  const addedSha = 'b'.repeat(64)
  let reloadPlan = null
  let reloadFail = false
  let injected500Url = ''
  let injectedReloadUrl = ''
  const jobBPayload = {
    id: 'job_b', status: 'done', quality_status: 'pass', debug_report: { status: 'pass' },
    normalized_sheet_url: '/generated/job_b/normalized_sheet.png',
    animations_url: '/generated/job_b/animations.json',
    metadata_url: '/generated/job_b/metadata.json',
    editor_metadata_url: '/generated/job_b/editor_metadata.json',
    debug_report_url: '/generated/job_b/debug_report.json',
    human_decision_status: 'accepted',
  }
  const onFetch = async (event) => {
    if (event.method !== 'Fetch.requestPaused' || event.sessionId !== sessionId) return
    const request = event.params.request
    const path = new URL(request.url).pathname
    const method = request.method || 'GET'
    calls.push({ path, method, body: request.postData || '', url: request.url })
    const id = event.params.requestId
    if (path === '/api/gemini-state') {
      await fulfillJson(client, sessionId, id, 200, {
        active_preset_id: 'gemini_2k',
        presets: [{ id: 'gemini_2k', available: true, provider: 'gemini', route_kind: 'google_native', supports_image_size: true, image_config: { image_size: '2K', aspect_ratio: '1:1' } }],
      })
      return
    }
    if (path === '/api/generate-character/review') {
      await fulfillJson(client, sessionId, id, 200, { reviewed_run_id: 'run_fix1', plan_hash: hash, reference_manifest_sha256: hash })
      return
    }
    if (path === '/api/generate-character') {
      await fulfillJson(client, sessionId, id, 200, { id: 'job_fix1', status: 'queued' })
      return
    }
    if (path === '/api/jobs/job_fix1') {
      pausedJobs.push(id)
      releaseJob()
      return
    }
    if (path === '/api/jobs/job_b' || path.startsWith('/generated/') || path.includes('/from-job') || (method === 'GET' && path.includes('/sprite-documents'))) {
      parked.push({ id, path, method, url: request.url, body: request.postData || '' })
      return
    }
    await client.send('Fetch.continueRequest', { requestId: id }, sessionId)
  }
  async function takeParked(match, timeoutMs = 8000) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      await drainGenerated()
      const index = parked.findIndex(match)
      if (index >= 0) return parked.splice(index, 1)[0]
      await delay(20)
    }
    return null
  }
  async function drainGenerated() {
    for (let i = 0; i < parked.length;) {
      const item = parked[i]
      if (item.path.startsWith('/generated/') && item.path.endsWith('.png')) {
        parked.splice(i, 1)
        await fulfillPng(client, sessionId, item.id)
        continue
      }
      if (item.path.startsWith('/generated/') && item.path.endsWith('.json')) {
        parked.splice(i, 1)
        await fulfillJson(client, sessionId, item.id, 200, { status: 'pass' })
        continue
      }
      i += 1
    }
  }
  async function drainDocuments() {
    if (!reloadPlan) return
    for (let i = 0; i < parked.length;) {
      const item = parked[i]
      if (!item.path.includes('/sprite-documents') || item.path.includes('/from-job')) {
        i += 1
        continue
      }
      parked.splice(i, 1)
      if (item.method === 'GET' && item.path.endsWith('/sprite-documents')) {
        await fulfillJson(client, sessionId, item.id, 200, { documents: reloadPlan.documents })
        continue
      }
      if (item.path.endsWith(`/sprite-documents/${reloadPlan.documentId}`)) {
        if (reloadFail) {
          reloadFail = false
          injectedReloadUrl = item.url
          await fulfillUnreadable(client, sessionId, item.id)
          continue
        }
        await fulfillJson(client, sessionId, item.id, 200, { document: reloadPlan.manifest })
        continue
      }
      if (item.path.includes(`/blocks/${reloadPlan.sha}`)) {
        await fulfillBlock(client, sessionId, item.id, reloadPlan.sha)
        continue
      }
      await client.send('Fetch.continueRequest', { requestId: item.id }, sessionId)
    }
  }
  async function pollPage(expression, timeoutMs = 8000) {
    const deadline = Date.now() + timeoutMs
    let last = null
    while (Date.now() < deadline) {
      await drainGenerated()
      await drainDocuments()
      last = await evaluate(client, sessionId, expression)
      if (last?.done) return last
      await delay(40)
    }
    return last
  }
  async function shotNode(selector, fileName) {
    await evaluate(client, sessionId, `document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({ block: 'center', inline: 'nearest' }); true`)
    const box = await evaluate(client, sessionId, `(() => {
      const node = document.querySelector(${JSON.stringify(selector)})
      if (!node) return null
      const r = node.getBoundingClientRect()
      return { x: r.x, y: r.y, w: r.width, h: r.height, text: node.innerText || '' }
    })()`)
    if (!box) return null
    const file = await screenshot(client, sessionId, path.join(EVIDENCE_DIR, fileName), {
      x: Math.max(0, Math.floor(box.x)),
      y: Math.max(0, Math.floor(box.y)),
      width: Math.max(1, Math.ceil(box.w)),
      height: Math.max(1, Math.ceil(Math.min(box.h, 640))),
    })
    return { ...file, text: box.text }
  }
  client.on(onFetch)
  await client.send('Fetch.enable', { patterns: [
    { urlPattern: '*api/gemini-state*', requestStage: 'Request' },
    { urlPattern: '*api/generate-character*', requestStage: 'Request' },
    { urlPattern: '*api/jobs/*', requestStage: 'Request' },
    { urlPattern: '*generated/*', requestStage: 'Request' },
    { urlPattern: '*from-job*', requestStage: 'Request' },
    { urlPattern: '*sprite-documents*', requestStage: 'Request' },
  ] }, sessionId)
  const sent = await evaluate(client, sessionId, `(() => {
    const input = document.querySelector('#vnext-prompt-input')
    const send = document.querySelector('.vnext-send')
    input.value = 'fix1 brighter sprite'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    if (send.disabled) return { ok: false, reason: 'send disabled' }
    send.click()
    return new Promise((resolve, reject) => {
      const start = Date.now()
      const tick = () => {
        const confirm = document.querySelector('[data-gen-action="confirm-generate"]')
        if (confirm) { resolve({ ok: true }); return }
        if (Date.now() - start > 8000) reject(new Error('timed out waiting for confirm'))
        else setTimeout(tick, 16)
      }
      tick()
    })
  })()`).catch((error) => ({ ok: false, reason: String(error.message || error) }))
  if (!sent.ok) return { ok: false, reason: sent.reason, calls }
  await evaluate(client, sessionId, `(() => {
    const button = document.querySelector('[data-gen-action="confirm-generate"]')
    button.click()
    button.click()
    return true
  })()`)
  await jobPaused
  await evaluate(client, sessionId, `document.querySelector('[data-gen-action="stop"]').click(); true`)
  for (const id of pausedJobs) {
    await fulfillJson(client, sessionId, id, 200, { id: 'job_fix1', status: 'done', source_url: '/generated/job_fix1/source.png' })
  }
  await delay(40)
  const inputReady = await pollPage(`(() => ({ done: Boolean(document.querySelector('#vnext-workflow .vnext-turn:last-child #vnext-job-id')) }))()`)
  if (!inputReady?.done) return { ok: false, reason: 'recovery input missing', calls }
  const queried = await evaluate(client, sessionId, `(() => {
    const live = document.querySelector('#vnext-workflow .vnext-turn:last-child #vnext-job-id')
    if (!live) return false
    live.value = 'job_b'
    live.dispatchEvent(new Event('input', { bubbles: true }))
    live.closest('.vnext-turn')?.querySelector('[data-gen-action="query"]')?.click()
    return true
  })()`)
  if (queried !== true) return { ok: false, reason: 'query click failed', calls }
  const jobB = await takeParked((item) => item.path === '/api/jobs/job_b')
  if (!jobB) return { ok: false, reason: 'job_b not paused', calls }
  await fulfillJson(client, sessionId, jobB.id, 200, jobBPayload)
  await delay(80)
  const ready = await pollPage(`(() => ({ done: Boolean(document.querySelector('[data-gen-action="add-canvas"]')), tail: (document.querySelector('#vnext-workflow')?.innerText || '').slice(-400) }))()`)
  let diskSeen = false
  let recovered = false
  let errorShot = null
  let successShot = null
  let beforeAdd = null
  if (ready?.done) {
    beforeAdd = await evaluate(client, sessionId, `(() => {
      const session = window.getVnextProjectSession?.()
      const canvases = Object.values(session?.project?.canvases || {})
      return {
        id: session?.project?.id || '',
        revision: session?.project?.revision ?? null,
        project: session?.project || null,
        canvasIds: canvases.map((item) => item.id),
        drafts: session?.view?.drafts || {},
      }
    })()`)
    await evaluate(client, sessionId, `document.querySelector('[data-gen-action="add-canvas"]')?.click(); true`)
    const first = await takeParked((item) => item.path.includes('/from-job'))
    if (first) {
      injected500Url = first.url
      await fulfillJson(client, sessionId, first.id, 500, { error: 'storage_commit_failed', reason: 'disk' })
      const errored = await pollPage(`(() => {
        const card = document.querySelector('#vnext-workflow .vnext-turn:last-child')
        const text = card?.textContent || ''
        return { done: text.includes('disk') && Boolean(card?.querySelector('[data-gen-action="add-canvas"]')), tail: text.slice(0, 400) }
      })()`)
      diskSeen = errored?.done === true
      if (diskSeen) {
        errorShot = await shotNode('#vnext-workflow .vnext-turn:last-child', 'ui-review-fix-20260925-fix2-ready-error.png')
        diskSeen = Boolean(errorShot?.text?.includes('disk') && errorShot.text.includes('Add to selected canvas'))
      }
      if (diskSeen && beforeAdd?.project) {
        await evaluate(client, sessionId, `document.querySelector('[data-gen-action="add-canvas"]')?.click(); true`)
        const second = await takeParked((item) => item.path.includes('/from-job'))
        if (second) {
          const submitted = JSON.parse(second.body || calls.find((item) => item.path.includes('/from-job'))?.body || '{}')
          const next = structuredClone(beforeAdd.project)
          next.revision = Number(beforeAdd.revision) + 1
          next.canvases = { ...(next.canvases || {}) }
          next.canvases[addedCanvasId] = { id: addedCanvasId, document_id: addedDocId, x: 24, y: 24, name: 'fix2' }
          const existingIds = [...new Set(Object.values(beforeAdd.project.canvases || {}).map((item) => item.document_id).filter(Boolean))]
          reloadPlan = {
            documentId: addedDocId,
            sha: addedSha,
            documents: [...existingIds.map((document_id) => ({ document_id })), { document_id: addedDocId }],
            manifest: {
              document_id: addedDocId,
              canvas: { w: FIX2_TILE, h: FIX2_TILE },
              layer_order: ['layer_1'],
              frame_order: ['frame_1'],
              frames: { frame_1: { duration_ms: 125 } },
              cels: { cel_1: { frame_id: 'frame_1', layer_id: 'layer_1', block: { sha256: addedSha } } },
            },
          }
          await fulfillJson(client, sessionId, second.id, 201, {
            project: next,
            document: reloadPlan.manifest,
            receipt: { operation_id: submitted.operation_id, project_revision: next.revision, document_id: addedDocId },
          })
          const settled = await pollPage(`(() => {
            const session = window.getVnextProjectSession?.()
            const ids = Object.keys(session?.project?.canvases || {})
            const card = document.querySelector('#vnext-workflow .vnext-turn:last-child')
            const text = card?.textContent || ''
            const before = ${JSON.stringify(beforeAdd.canvasIds)}
            const added = ids.filter((id) => !before.includes(id))
            const drafts = JSON.stringify(session?.view?.drafts || {})
            const viewCount = (session?.view?.canvases || []).filter((item) => item.id === ${JSON.stringify(addedCanvasId)}).length
            const nodeCount = document.querySelectorAll(${JSON.stringify(`[data-canvas-id="${addedCanvasId}"]`)}).length
            const doc = session?.documents?.get?.(${JSON.stringify(addedDocId)})
            return {
              done: session?.project?.id === ${JSON.stringify(beforeAdd.id)}
                && text.includes('Added to the canvas')
                && !text.includes('disk')
                && !text.includes('did not reload')
                && card?.querySelector('.vnext-workflow-primary')?.disabled === true
                && added.length === 1
                && added[0] === ${JSON.stringify(addedCanvasId)}
                && before.every((id) => ids.includes(id))
                && drafts === ${JSON.stringify(JSON.stringify(beforeAdd.drafts))}
                && viewCount === 1
                && nodeCount === 1
                && Boolean(doc),
              tail: text.slice(0, 240),
              ids,
            }
          })()`)
          recovered = settled?.done === true
          if (recovered) {
            const postsBefore = calls.filter((item) => item.path.includes('/from-job')).length
            await evaluate(client, sessionId, `document.querySelector('#vnext-workflow .vnext-turn:last-child .vnext-workflow-primary')?.click(); true`)
            const quiet = await pollPage(`(() => ({
              done: document.querySelector('#vnext-workflow .vnext-turn:last-child .vnext-workflow-primary')?.disabled === true
                && (document.querySelector('#vnext-workflow .vnext-turn:last-child')?.textContent || '').includes('Added to the canvas'),
            }))()`)
            recovered = quiet?.done === true && calls.filter((item) => item.path.includes('/from-job')).length === postsBefore
            const framed = await pollPage(`(() => {
              document.querySelector('#vnext-project-menu')?.setAttribute('hidden', '')
              const preview = document.querySelector('.vnext-preview')
              if (preview && preview.hidden === false) document.querySelector('.vnext-preview [data-vnext-toggle="preview"]')?.click()
              const session = window.getVnextProjectSession?.()
              session?.view?.select?.(${JSON.stringify(addedCanvasId)})
              const stage = document.querySelector('#vnext-canvas-stage')?.getBoundingClientRect()
              if (stage && session?.view?.zoomAt && session.view.zoom < 4) {
                session.view.zoomAt(stage.left + stage.width / 2, stage.top + stage.height / 2, 8, stage)
                session.view.centerOn?.(${JSON.stringify(addedCanvasId)}, stage.width, stage.height)
              }
              window.__vnextRenderProject?.()
              window.__vnextRefreshTimeline?.()
              const tile = document.querySelector(${JSON.stringify(`[data-canvas-id="${addedCanvasId}"]`)})?.getBoundingClientRect()
              return { done: Boolean(tile && tile.width >= 128 && tile.height >= 128) }
            })()`)
            recovered = framed?.done === true
            if (recovered) {
              const canvasShot = await shotNode(`[data-canvas-id="${addedCanvasId}"]`, 'ui-review-fix-20260925-fix2-ready-canvas.png')
              const timelineShot = await shotNode('#vnext-frame-cols', 'ui-review-fix-20260925-fix2-ready-timeline.png')
              const addedShot = await shotNode('#vnext-workflow .vnext-turn:last-child', 'ui-review-fix-20260925-fix2-ready-added.png')
              const contextShot = await screenshot(client, sessionId, path.join(EVIDENCE_DIR, 'ui-review-fix-20260925-fix2-ready-context.png'))
              successShot = { canvas: canvasShot, timeline: timelineShot, added: addedShot, context: contextShot }
              recovered = canvasShot?.width >= 128 && canvasShot?.height >= 128
            }
          }
        }
      }
    }
  }
  await drainGenerated()
  await drainDocuments()
  for (const item of parked.splice(0)) {
    await client.send('Fetch.continueRequest', { requestId: item.id }, sessionId).catch(() => {})
  }
  client.off(onFetch)
  await client.send('Fetch.disable', {}, sessionId)
  const review = calls.find((item) => item.path === '/api/generate-character/review')
  const fromJobs = calls.filter((item) => item.path.includes('/from-job'))
  const fromJobBodies = fromJobs.map((item) => { try { return JSON.parse(item.body) } catch { return null } })
  const samePayload = fromJobBodies.length === 2 && fromJobBodies[0] && JSON.stringify(fromJobBodies[0]) === JSON.stringify(fromJobBodies[1])
  return {
    ok: sent.ok === true && fix1GenerateOk(calls),
    readyBrowser: ready?.done === true && diskSeen && samePayload && recovered,
    reason: !ready?.done ? (ready?.tail || 'add button missing') : (!diskSeen ? 'disk error not shown' : (!samePayload ? `payloads ${JSON.stringify(fromJobBodies)}` : (recovered ? '' : 'reload did not finish'))),
    reviewDescription: review ? JSON.parse(review.body).description : '',
    generateCount: calls.filter((item) => item.path === '/api/generate-character' && item.method === 'POST').length,
    jobGets: calls.filter((item) => item.path.startsWith('/api/jobs/')).map((item) => item.path),
    fromJobOps: fromJobBodies.map((item) => item?.operation_id || ''),
    fromJobBodies,
    confirmClicked: true,
    readyError: diskSeen,
    injected500Url,
    errorShot,
    successShot,
    screenshot: successShot || errorShot,
  }
}

async function captureReadyStateEvidence(client, sessionId) {
  const calls = []
  const parked = []
  const pausedJobs = []
  let releaseJob
  const jobPaused = new Promise((resolve) => { releaseJob = resolve })
  const hash = 'c'.repeat(64)
  const addedDocId = 'doc_state_add'
  const addedCanvasId = 'canvas_state_add'
  const addedSha = 'd'.repeat(64)
  let reloadPlan = null
  let reloadFail = false
  const jobPayload = {
    id: 'job_c', status: 'done', quality_status: 'pass', debug_report: { status: 'pass' },
    normalized_sheet_url: '/generated/job_c/normalized_sheet.png',
    animations_url: '/generated/job_c/animations.json',
    metadata_url: '/generated/job_c/metadata.json',
    editor_metadata_url: '/generated/job_c/editor_metadata.json',
    debug_report_url: '/generated/job_c/debug_report.json',
    human_decision_status: 'accepted',
  }
  const onFetch = async (event) => {
    if (event.method !== 'Fetch.requestPaused' || event.sessionId !== sessionId) return
    const request = event.params.request
    const path = new URL(request.url).pathname
    const method = request.method || 'GET'
    calls.push({ path, method, body: request.postData || '', url: request.url })
    const id = event.params.requestId
    if (path === '/api/gemini-state') {
      await fulfillJson(client, sessionId, id, 200, {
        active_preset_id: 'gemini_2k',
        presets: [{ id: 'gemini_2k', available: true, provider: 'gemini', route_kind: 'google_native', supports_image_size: true, image_config: { image_size: '2K', aspect_ratio: '1:1' } }],
      })
      return
    }
    if (path === '/api/generate-character/review') {
      await fulfillJson(client, sessionId, id, 200, { reviewed_run_id: 'run_state', plan_hash: hash, reference_manifest_sha256: hash })
      return
    }
    if (path === '/api/generate-character') {
      await fulfillJson(client, sessionId, id, 200, { id: 'job_state', status: 'queued' })
      return
    }
    if (path === '/api/jobs/job_state') {
      pausedJobs.push(id)
      releaseJob()
      return
    }
    if (path === '/api/jobs/job_c' || path.startsWith('/generated/') || path.includes('/from-job') || (method === 'GET' && path.includes('/sprite-documents'))) {
      parked.push({ id, path, method, url: request.url, body: request.postData || '' })
      return
    }
    await client.send('Fetch.continueRequest', { requestId: id }, sessionId)
  }
  async function drainGenerated() {
    for (let i = 0; i < parked.length;) {
      const item = parked[i]
      if (item.path.startsWith('/generated/') && item.path.endsWith('.png')) {
        parked.splice(i, 1)
        await fulfillPng(client, sessionId, item.id)
        continue
      }
      if (item.path.startsWith('/generated/') && item.path.endsWith('.json')) {
        parked.splice(i, 1)
        await fulfillJson(client, sessionId, item.id, 200, { status: 'pass' })
        continue
      }
      i += 1
    }
  }
  async function drainDocuments() {
    if (!reloadPlan) return
    for (let i = 0; i < parked.length;) {
      const item = parked[i]
      if (!item.path.includes('/sprite-documents') || item.path.includes('/from-job')) {
        i += 1
        continue
      }
      parked.splice(i, 1)
      if (item.method === 'GET' && item.path.endsWith('/sprite-documents')) {
        await fulfillJson(client, sessionId, item.id, 200, { documents: reloadPlan.documents })
        continue
      }
      if (item.path.endsWith(`/sprite-documents/${reloadPlan.documentId}`)) {
        if (reloadFail) {
          reloadFail = false
          await fulfillUnreadable(client, sessionId, item.id)
          continue
        }
        await fulfillJson(client, sessionId, item.id, 200, { document: reloadPlan.manifest })
        continue
      }
      if (item.path.includes(`/blocks/${reloadPlan.sha}`)) {
        await fulfillBlock(client, sessionId, item.id, reloadPlan.sha)
        continue
      }
      await client.send('Fetch.continueRequest', { requestId: item.id }, sessionId)
    }
  }
  async function takeParked(match, timeoutMs = 8000) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      await drainGenerated()
      await drainDocuments()
      const index = parked.findIndex(match)
      if (index >= 0) return parked.splice(index, 1)[0]
      await delay(40)
    }
    return null
  }
  async function pollPage(expression, timeoutMs = 8000) {
    const deadline = Date.now() + timeoutMs
    let last = null
    while (Date.now() < deadline) {
      await drainGenerated()
      await drainDocuments()
      last = await evaluate(client, sessionId, expression)
      if (last?.done) return last
      await delay(40)
    }
    return last
  }
  async function shotNode(selector, fileName, meta) {
    await evaluate(client, sessionId, `document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({ block: 'center', inline: 'nearest' }); true`)
    const box = await evaluate(client, sessionId, `(() => {
      const node = document.querySelector(${JSON.stringify(selector)})
      if (!node) return null
      const r = node.getBoundingClientRect()
      return { x: r.x, y: r.y, w: r.width, h: r.height, text: node.innerText || '', locale: document.documentElement.lang || navigator.language || '', viewport: window.innerWidth + 'x' + window.innerHeight }
    })()`)
    if (!box) return null
    const file = await screenshot(client, sessionId, path.join(EVIDENCE_DIR, fileName), {
      x: Math.max(0, Math.floor(box.x)),
      y: Math.max(0, Math.floor(box.y)),
      width: Math.max(1, Math.ceil(box.w)),
      height: Math.max(1, Math.ceil(Math.min(box.h, 640))),
    })
    return { ...file, text: box.text, locale: box.locale, viewport: box.viewport, ...meta }
  }
  async function noExtraPost(postsBefore) {
    const started = Date.now()
    while (Date.now() - started < 800) {
      await drainGenerated()
      await drainDocuments()
      if (calls.filter((item) => item.path.includes('/from-job')).length !== postsBefore) return false
      await delay(40)
    }
    return calls.filter((item) => item.path.includes('/from-job')).length === postsBefore
  }
  client.on(onFetch)
  await client.send('Fetch.enable', { patterns: [
    { urlPattern: '*api/gemini-state*', requestStage: 'Request' },
    { urlPattern: '*api/generate-character*', requestStage: 'Request' },
    { urlPattern: '*api/jobs/*', requestStage: 'Request' },
    { urlPattern: '*generated/*', requestStage: 'Request' },
    { urlPattern: '*from-job*', requestStage: 'Request' },
    { urlPattern: '*sprite-documents*', requestStage: 'Request' },
  ] }, sessionId)
  const sent = await evaluate(client, sessionId, `(() => {
    const input = document.querySelector('#vnext-prompt-input')
    const send = document.querySelector('.vnext-send')
    input.value = 'state evidence sprite'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    if (send.disabled) return { ok: false, reason: 'send disabled' }
    send.click()
    return { ok: true }
  })()`)
  const confirmed = sent?.ok ? await pollPage(`(() => ({ done: Boolean(document.querySelector('[data-gen-action="confirm-generate"]')) }))()`) : null
  if (!confirmed?.done) {
    client.off(onFetch)
    await client.send('Fetch.disable', {}, sessionId).catch(() => {})
    return { ok: false, reason: sent?.reason || 'confirm missing' }
  }
  await evaluate(client, sessionId, `document.querySelector('[data-gen-action="confirm-generate"]').click(); true`)
  await jobPaused
  await evaluate(client, sessionId, `document.querySelector('[data-gen-action="stop"]').click(); true`)
  for (const id of pausedJobs) {
    await fulfillJson(client, sessionId, id, 200, { id: 'job_state', status: 'done', source_url: '/generated/job_state/source.png' })
  }
  const inputReady = await pollPage(`(() => ({ done: Boolean(document.querySelector('#vnext-workflow .vnext-turn:last-child #vnext-job-id')) }))()`)
  if (!inputReady?.done) {
    client.off(onFetch)
    await client.send('Fetch.disable', {}, sessionId).catch(() => {})
    return { ok: false, reason: 'recovery input missing' }
  }
  await evaluate(client, sessionId, `(() => {
    const live = document.querySelector('#vnext-workflow .vnext-turn:last-child #vnext-job-id')
    live.value = 'job_c'
    live.dispatchEvent(new Event('input', { bubbles: true }))
    live.closest('.vnext-turn')?.querySelector('[data-gen-action="query"]')?.click()
    return true
  })()`)
  const jobC = await takeParked((item) => item.path === '/api/jobs/job_c')
  if (!jobC) {
    client.off(onFetch)
    await client.send('Fetch.disable', {}, sessionId).catch(() => {})
    return { ok: false, reason: 'job_c not paused' }
  }
  await fulfillJson(client, sessionId, jobC.id, 200, jobPayload)
  const ready = await pollPage(`(() => ({ done: Boolean(document.querySelector('[data-gen-action="add-canvas"]')) }))()`)
  const beforeAdd = await evaluate(client, sessionId, `(() => {
    const session = window.getVnextProjectSession?.()
    return {
      id: session?.project?.id || '',
      revision: session?.project?.revision ?? null,
      project: session?.project || null,
      canvasIds: Object.keys(session?.project?.canvases || {}),
      drafts: session?.view?.drafts || {},
    }
  })()`)
  await evaluate(client, sessionId, `document.querySelector('[data-gen-action="add-canvas"]')?.click(); true`)
  const first = await takeParked((item) => item.path.includes('/from-job'))
  const adding = first ? await pollPage(`(() => {
    const card = document.querySelector('#vnext-workflow .vnext-turn:last-child')
    const button = card?.querySelector('.vnext-workflow-primary')
    const text = card?.textContent || ''
    return { done: text.includes('Adding…') && button?.disabled === true && !card?.querySelector('[data-gen-action="add-canvas"]') }
  })()`) : null
  const addingShot = adding?.done ? await shotNode('#vnext-workflow .vnext-turn:last-child', 'ready-state-adding.png', { state: 'adding', trigger: 'Add click while from-job request is parked' }) : null
  const addingNoExtra = adding?.done ? await (async () => {
    const postsBefore = calls.filter((item) => item.path.includes('/from-job')).length
    await evaluate(client, sessionId, `document.querySelector('#vnext-workflow .vnext-turn:last-child .vnext-workflow-primary')?.click(); true`)
    return noExtraPost(postsBefore)
  })() : false
  if (first) await fulfillUnreadable(client, sessionId, first.id)
  const unknown = first ? await pollPage(`(() => {
    const card = document.querySelector('#vnext-workflow .vnext-turn:last-child')
    const text = card?.textContent || ''
    return { done: text.includes('Response body could not be read.') && Boolean(card?.querySelector('[data-gen-action="add-canvas"]')) && !text.includes('disk') }
  })()`) : null
  const unknownShot = unknown?.done ? await shotNode('#vnext-workflow .vnext-turn:last-child', 'ready-state-unknown.png', { state: 'unknown', trigger: 'from-job 200 with unreadable JSON; client classifies bodyBroken as unknown' }) : null
  let unknownRetrySame = false
  let reloadFailedSeen = false
  let reloadNoExtra = false
  let reloadFailedShot = null
  if (unknown?.done && beforeAdd?.project) {
    await evaluate(client, sessionId, `document.querySelector('[data-gen-action="add-canvas"]')?.click(); true`)
    const second = await takeParked((item) => item.path.includes('/from-job'))
    const firstBody = calls.find((item) => item.path.includes('/from-job'))?.body || ''
    unknownRetrySame = Boolean(second?.body) && second.body === firstBody
    if (unknownRetrySame) {
      const submitted = JSON.parse(second.body)
      const next = structuredClone(beforeAdd.project)
      next.revision = Number(beforeAdd.revision) + 1
      next.canvases = { ...(next.canvases || {}) }
      next.canvases[addedCanvasId] = { id: addedCanvasId, document_id: addedDocId, x: 24, y: 24, name: 'state' }
      const existingIds = [...new Set(Object.values(beforeAdd.project.canvases || {}).map((item) => item.document_id).filter(Boolean))]
      reloadPlan = {
        documentId: addedDocId,
        sha: addedSha,
        documents: [...existingIds.map((document_id) => ({ document_id })), { document_id: addedDocId }],
        manifest: {
          document_id: addedDocId,
          canvas: { w: FIX2_TILE, h: FIX2_TILE },
          layer_order: ['layer_1'],
          frame_order: ['frame_1'],
          frames: { frame_1: { duration_ms: 125 } },
          cels: { cel_1: { frame_id: 'frame_1', layer_id: 'layer_1', block: { sha256: addedSha } } },
        },
      }
      reloadFail = true
      await fulfillJson(client, sessionId, second.id, 201, {
        project: next,
        document: reloadPlan.manifest,
        receipt: { operation_id: submitted.operation_id, project_revision: next.revision, document_id: addedDocId },
      })
      const failedReload = await pollPage(`(() => {
        const card = document.querySelector('#vnext-workflow .vnext-turn:last-child')
        const button = card?.querySelector('.vnext-workflow-primary')
        const text = card?.textContent || ''
        return {
          done: text.includes('Saved, canvas did not reload')
            && button?.disabled === true
            && button?.textContent === 'Added'
            && !card?.querySelector('[data-gen-action="add-canvas"]'),
        }
      })()`)
      reloadFailedSeen = failedReload?.done === true
      if (reloadFailedSeen) {
        reloadFailedShot = await shotNode('#vnext-workflow .vnext-turn:last-child', 'ready-state-reload-failed.png', { state: 'reloadFailed', trigger: 'from-job 201 receipt, then document reload body unreadable' })
        const postsBefore = calls.filter((item) => item.path.includes('/from-job')).length
        await evaluate(client, sessionId, `document.querySelector('#vnext-workflow .vnext-turn:last-child .vnext-workflow-primary')?.click(); true`)
        reloadNoExtra = await noExtraPost(postsBefore)
      }
    }
  }
  for (const item of parked.splice(0)) {
    await client.send('Fetch.continueRequest', { requestId: item.id }, sessionId).catch(() => {})
  }
  client.off(onFetch)
  await client.send('Fetch.disable', {}, sessionId)
  const fromJobs = calls.filter((item) => item.path.includes('/from-job'))
  const fromJobBodies = fromJobs.map((item) => { try { return JSON.parse(item.body) } catch { return null } })
  const ok = Boolean(ready?.done && adding?.done && addingNoExtra && unknown?.done && unknownRetrySame && reloadFailedSeen && reloadNoExtra)
  return {
    ok,
    reason: ok ? '' : `states adding=${Boolean(adding?.done)}/${addingNoExtra} unknown=${Boolean(unknown?.done)}/${unknownRetrySame} reload=${reloadFailedSeen}/${reloadNoExtra}`,
    fromJobOps: fromJobBodies.map((item) => item?.operation_id || ''),
    fromJobBodies,
    addingShot,
    unknownShot,
    reloadFailedShot,
  }
}

async function captureProjectRaces(client, sessionId, phase = 'all') {
  const parked = []
  const calls = []
  const onFetch = async (event) => {
    if (event.method !== 'Fetch.requestPaused' || event.sessionId !== sessionId) return
    const request = event.params.request
    const path = new URL(request.url).pathname
    const method = request.method || 'GET'
    const item = { id: event.params.requestId, path, method, url: request.url, body: request.postData || '' }
    calls.push(item)
    if (path.endsWith('/canvas-layout') || /^\/api\/editor\/projects\/[^/]+$/.test(path)) {
      parked.push(item)
      return
    }
    await client.send('Fetch.continueRequest', { requestId: item.id }, sessionId)
  }
  async function take(match, timeoutMs = 8000) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const index = parked.findIndex(match)
      if (index >= 0) return parked.splice(index, 1)[0]
      await delay(20)
    }
    return null
  }
  client.on(onFetch)
  await client.send('Fetch.enable', { patterns: [
    { urlPattern: '*canvas-layout*', requestStage: 'Request' },
    { urlPattern: '*api/editor/projects/*', requestStage: 'Request' },
  ] }, sessionId)
  const before = await evaluate(client, sessionId, `(() => {
    const session = window.getVnextProjectSession?.()
    return { id: session?.project?.id || '', revision: session?.project?.revision ?? null }
  })()`)
  let stayed = null
  let otherId = ''
  let afterCancel = null
  if (phase !== 'late') {
  await evaluate(client, sessionId, `(() => {
    const session = window.getVnextProjectSession?.()
    const id = session?.view?.canvases?.[0]?.id
    if (id) session.view.moveDraft(id, 72, 36)
    window.__vnextRenderProject?.()
    return true
  })()`)
  await evaluate(client, sessionId, `document.querySelector('#vnext-project-btn').click(); true`)
  await evaluate(client, sessionId, `document.querySelector('[data-project-action="save"]')?.click(); true`)
  const save = await take((item) => item.path.endsWith('/canvas-layout'))
  await evaluate(client, sessionId, `document.querySelector('[data-project-action="open"]')?.click(); true`)
  const listedOther = await pollEval(client, sessionId, `(() => {
    const current = ${JSON.stringify(before.id)}
    const next = (window.getVnextProjectSession?.()?.list?.projects || []).find((item) => item.id !== current && item.version === 'editor_project_v1')
    return { done: Boolean(next?.id), id: next?.id || '' }
  })()`)
  const otherId = listedOther?.id || ''
  if (otherId) {
    await evaluate(client, sessionId, `(() => {
      const session = window.getVnextProjectSession?.()
      if (!session?.list) return false
      session.list.query = ''
      session.list.selectedId = ${JSON.stringify('${otherId}')}
      window.__vnextRenderList?.()
      return true
    })()`.replace('${otherId}', otherId))
    await pollEval(client, sessionId, `(() => ({ done: document.querySelector('#vnext-open-confirm')?.disabled === false }))()`)
    await evaluate(client, sessionId, `document.querySelector('#vnext-open-confirm')?.click(); true`)
    const gate = await pollEval(client, sessionId, `(() => {
      const title = document.querySelector('#vnext-confirm-title')?.textContent || ''
      const pending = window.getVnextProjectSession?.()?.pendingOpen?.projectId || ''
      return { done: title.includes('Leave without saving') || pending === ${JSON.stringify(otherId)}, title, pending }
    })()`)
    if (String(gate?.title || '').includes('Leave without saving')) {
      await evaluate(client, sessionId, `document.querySelector('#vnext-confirm-primary')?.click(); true`)
    }
  }
  const openB = otherId ? await take((item) => item.method === 'GET' && item.path === `/api/editor/projects/${otherId}`) : null
  if (openB) await evaluate(client, sessionId, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })); true`)
  if (save) await client.send('Fetch.continueRequest', { requestId: save.id }, sessionId)
  if (openB) await client.send('Fetch.continueRequest', { requestId: openB.id }, sessionId)
  const afterCancel = await pollEval(client, sessionId, `(() => {
    const session = window.getVnextProjectSession?.()
    const dialog = document.querySelector('#vnext-confirm-dialog')
    return {
      done: Boolean(${JSON.stringify(Boolean(true))} && ${openB ? 'true' : 'false'}) && session?.project?.id === ${JSON.stringify(before.id)} && !session?.pendingOpen && !session?.pendingSave && Boolean(session?.saveReceipt) && Number(session?.project?.revision) > ${JSON.stringify(Number(before.revision) || 0)} && dialog?.hidden !== false,
      id: session?.project?.id || '',
      revision: session?.project?.revision ?? null,
      pending: session?.pendingOpen?.projectId || '',
      hidden: dialog?.hidden !== false,
      started: ${openB ? 'true' : 'false'},
    }
  })()`)
  const stayed = afterCancel
  if (phase === 'cancel') {
    for (const item of parked.splice(0)) {
      await client.send('Fetch.continueRequest', { requestId: item.id }, sessionId).catch(() => {})
    }
    client.off(onFetch)
    await client.send('Fetch.disable', {}, sessionId)
    return {
      cancelKeptA: afterCancel?.done === true && afterCancel?.id === before.id && afterCancel?.hidden === true,
      lateSaveOpenB: null,
      beforeId: before.id,
      otherId,
      afterCancel,
    }
  }
  }
  await evaluate(client, sessionId, `(() => {
    const session = window.getVnextProjectSession?.()
    const id = session?.view?.canvases?.[0]?.id
    if (id) session.view.moveDraft(id, 88, 40)
    window.__vnextRenderProject?.()
    return true
  })()`)
  await evaluate(client, sessionId, `document.querySelector('#vnext-project-btn').click(); true`)
  await evaluate(client, sessionId, `document.querySelector('[data-project-action="save"]')?.click(); true`)
  const lateSave = await take((item) => item.path.endsWith('/canvas-layout'))
  await evaluate(client, sessionId, `(() => {
    if (document.querySelector('#vnext-confirm-dialog')?.hidden === false) document.querySelector('#vnext-confirm-secondary')?.click()
    return true
  })()`)
  await evaluate(client, sessionId, `document.querySelector('[data-project-action="open"]')?.click(); true`)
  const listed = await pollEval(client, sessionId, `(() => {
    const current = window.getVnextProjectSession?.()?.project?.id || ''
    const next = (window.getVnextProjectSession?.()?.list?.projects || []).find((item) => item.id !== current && item.version === 'editor_project_v1')
    return { done: Boolean(next?.id), id: next?.id || '' }
  })()`)
  const nextId = listed?.id || ''
  const chosen = nextId ? await evaluate(client, sessionId, `(() => {
    const session = window.getVnextProjectSession?.()
    if (!session?.list) return { id: '', version: '' }
    session.list.query = ''
    session.list.selectedId = ${JSON.stringify(nextId)}
    window.__vnextRenderList?.()
    const item = (session.list.projects || []).find((project) => project.id === ${JSON.stringify(nextId)})
    return { id: session.list.selectedId || '', version: item?.version || '' }
  })()`) : { id: '', version: '' }
  const selectedId = chosen?.id || ''
  if (chosen?.version === 'editor_project_v1') {
    await pollEval(client, sessionId, `(() => ({ done: document.querySelector('#vnext-open-confirm')?.disabled === false }))()`)
    await evaluate(client, sessionId, `document.querySelector('#vnext-open-confirm')?.click(); true`)
    const gate = await pollEval(client, sessionId, `(() => {
      const title = document.querySelector('#vnext-confirm-title')?.textContent || ''
      const pending = window.getVnextProjectSession?.()?.pendingOpen?.projectId || ''
      return { done: title.includes('Leave without saving') || pending === ${JSON.stringify(nextId)}, title, pending }
    })()`)
    if (String(gate?.title || '').includes('Leave without saving')) {
      await evaluate(client, sessionId, `document.querySelector('#vnext-confirm-primary')?.click(); true`)
    }
  }
  const lateOpen = selectedId === nextId && nextId ? await take((item) => item.method === 'GET' && item.path === `/api/editor/projects/${nextId}`) : null
  const injected409Url = lateSave?.url || ''
  if (lateSave && lateOpen) await fulfillJson(client, sessionId, lateSave.id, 409, { error: 'stale_revision', reason: 'stale' })
  const during = await pollEval(client, sessionId, `(() => {
    const session = window.getVnextProjectSession?.()
    const dialog = document.querySelector('#vnext-confirm-dialog')
    const conflictOpen = dialog?.hidden === false && (document.querySelector('#vnext-confirm-title')?.textContent || '') === 'Canvas positions changed'
    return {
      done: Boolean(session) && !session.pendingSave && session.pendingOpen?.projectId === ${JSON.stringify(nextId || '')} && conflictOpen === false,
      id: session?.project?.id || '',
      pending: session?.pendingOpen?.projectId || '',
      hidden: dialog?.hidden !== false,
      conflictOpen,
    }
  })()`)
  if (lateOpen && during?.done) await client.send('Fetch.continueRequest', { requestId: lateOpen.id }, sessionId)
  const opened = await pollEval(client, sessionId, `(() => {
    const session = window.getVnextProjectSession?.()
    const dialog = document.querySelector('#vnext-confirm-dialog')
    return {
      done: session?.project?.id === ${JSON.stringify(nextId || '')} && !session?.pendingOpen && dialog?.hidden !== false,
      id: session?.project?.id || '',
      hidden: dialog?.hidden !== false,
    }
  })()`)
  for (const item of parked.splice(0)) {
    await client.send('Fetch.continueRequest', { requestId: item.id }, sessionId).catch(() => {})
  }
  client.off(onFetch)
  await client.send('Fetch.disable', {}, sessionId)
  return {
    cancelKeptA: phase === 'late' ? null : stayed?.done === true && afterCancel?.id === before.id && afterCancel.title !== 'Canvas positions changed',
    lateSaveOpenB: Boolean(nextId) && during?.done === true && during?.conflictOpen === false && during?.pending === nextId && opened?.done === true && opened?.hidden === true,
    beforeId: before.id,
    otherId,
    nextId,
    selectedId,
    chosen,
    injected409Url,
    during,
    opened,
    afterCancel,
  }
}

async function pollEval(client, sessionId, expression, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs
  let last = null
  while (Date.now() < deadline) {
    last = await evaluate(client, sessionId, expression)
    if (last?.done) return last
    await delay(40)
  }
  return last
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function showCanvasSubject(client, sessionId) {
  return evaluate(client, sessionId, `(() => {
    const preview = document.querySelector('.vnext-preview')
    if (preview && preview.hidden === false) {
      document.querySelector('.vnext-preview [data-vnext-toggle="preview"]')?.click()
    }
    const menu = document.querySelector('#vnext-project-menu')
    if (menu && menu.hidden === false) {
      document.querySelector('#vnext-project-btn')?.click()
    }
    document.querySelector('#vnext-zoom')?.click()
    const stage = document.querySelector('#vnext-canvas-stage')?.getBoundingClientRect()
    const tiles = [...document.querySelectorAll('.vnext-canvas-tile')].map((node) => {
      const box = node.getBoundingClientRect()
      return {
        id: node.dataset.canvasId || '',
        x: Math.round(box.x),
        y: Math.round(box.y),
        w: Math.round(box.width),
        h: Math.round(box.height),
        inside: Boolean(
          stage
          && box.width >= 8
          && box.height >= 8
          && box.left >= stage.left - 1
          && box.right <= stage.right + 1
          && box.top >= stage.top - 1
          && box.bottom <= stage.bottom + 1
        ),
      }
    })
    const session = window.getVnextProjectSession?.()
    return {
      previewHidden: document.querySelector('.vnext-preview')?.hidden === true,
      zoom: session?.view.zoom,
      projectId: session?.project?.id || '',
      positions: session?.view.canvases.map((item) => ({ id: item.id, x: item.x, y: item.y })) || [],
      tiles,
      allInside: tiles.length >= 2 && tiles.every((item) => item.inside),
    }
  })()`)
}

function encodeVisibleImportPng() {
  const width = 64
  const height = 64
  const rgba = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4
      const inset = x >= 8 && x < 56 && y >= 8 && y < 56
      if (!inset) {
        rgba[index] = 10
        rgba[index + 1] = 20
        rgba[index + 2] = 30
        rgba[index + 3] = 0
        continue
      }
      if (x >= 40 && y >= 40) {
        rgba[index] = 40
        rgba[index + 1] = 50
        rgba[index + 2] = 60
        rgba[index + 3] = 128
        continue
      }
      rgba[index] = 77
      rgba[index + 1] = 115
      rgba[index + 2] = 102
      rgba[index + 3] = 255
    }
  }
  return encodeRgbaPng(width, height, rgba)
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close((error) => (error ? reject(error) : resolve(port)))
    })
  })
}

async function sha256File(filePath) {
  const data = await readFile(filePath)
  return createHash('sha256').update(data).digest('hex')
}

function pngSize(buffer) {
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

class CdpClient {
  constructor(url) {
    this.url = url
    this.nextId = 1
    this.pending = new Map()
    this.listeners = new Set()
  }

  async connect() {
    this.socket = new WebSocket(this.url)
    this.socket.addEventListener('message', (event) => {
      const payload = JSON.parse(String(event.data))
      if (payload.method) {
        this.listeners.forEach((listener) => listener(payload))
        return
      }
      const pending = this.pending.get(payload.id)
      if (!pending) return
      this.pending.delete(payload.id)
      if (payload.error) pending.reject(new Error(`${pending.method}: ${payload.error.message}`))
      else pending.resolve(payload.result ?? {})
    })
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true })
      this.socket.addEventListener('error', (event) => {
        reject(event.error ?? new Error('CDP websocket failed'))
      }, { once: true })
    })
  }

  on(listener) {
    this.listeners.add(listener)
  }

  off(listener) {
    this.listeners.delete(listener)
  }

  send(method, params = {}, sessionId, timeoutMs = 10_000) {
    const id = this.nextId
    this.nextId += 1
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.has(id)) return
        this.pending.delete(id)
        reject(new Error(`${method} timed out after ${timeoutMs}ms`))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value) },
        reject: (error) => { clearTimeout(timer); reject(error) },
        method,
      })
      this.socket.send(JSON.stringify({
        id,
        method,
        params,
        ...(sessionId ? { sessionId } : {}),
      }))
    })
  }

  close() {
    this.socket?.close()
  }
}

// Start the maintained server.js (the real entry) with empty provider keys and
// wait for its ready line; the child is tracked and stopped in the finally block.
async function waitForServer(child, timeoutMs) {
  let output = ''
  const deadline = Date.now() + timeoutMs
  const onData = (chunk) => { output = `${output}${chunk}`.slice(-8_192) }
  child.stdout.on('data', onData)
  child.stderr.on('data', onData)
  while (Date.now() < deadline) {
    if (output.includes('Character tool running')) return output
    if (child.exitCode !== null) throw new Error(`server exited: ${child.exitCode}\n${output}`)
    await delay(50)
  }
  throw new Error(`server did not start\n${output}`)
}

// Read-only probe of the maintained default entry: must still redirect to the Studio baseline.
async function probeDefaultEntry(origin) {
  const response = await fetch(`${origin}/`, { redirect: 'manual' })
  return { status: response.status, location: response.headers.get('location') }
}

async function waitForChrome(debugPort, child, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let lastError = null
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Chrome exited: ${child.exitCode}`)
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`)
      if (response.ok) {
        const payload = await response.json()
        if (payload.webSocketDebuggerUrl) return payload
      }
    } catch (error) {
      lastError = error
    }
    await delay(50)
  }
  throw new Error(`Chrome CDP did not start: ${lastError?.message ?? 'timeout'}`)
}

function runOsascript(source, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const child = spawn('osascript', ['-e', source], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout = `${stdout}${chunk}`.slice(-4_096) })
    child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-4_096) })
    const timer = setTimeout(() => {
      if (child.exitCode === null) child.kill('SIGTERM')
      resolve({ ok: false, stdout, stderr, error: 'osascript timeout' })
    }, timeoutMs)
    child.on('exit', (code) => {
      clearTimeout(timer)
      resolve({ ok: code === 0, code, stdout: stdout.trim(), stderr: stderr.trim() })
    })
  })
}

async function seedIsolatedProjects(origin) {
  const headers = { 'content-type': 'application/json' }
  const v0 = await fetch(`${origin}/api/editor/projects`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ id: 'village_03', name: 'Village archive', now: '2026-09-14T11:24:00.000Z' }),
  })
  const v1a = await fetch(`${origin}/api/editor/projects/v1`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ operation_id: randomUUID(), name: 'Forest creatures' }),
  })
  const v1b = await fetch(`${origin}/api/editor/projects/v1`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      operation_id: randomUUID(),
      name: 'Town characters — merchants, travellers and villagers for the northern region',
    }),
  })
  return {
    v0: v0.status,
    v1a: v1a.status,
    v1b: v1b.status,
  }
}

async function probeHeadedNativePicker({ origin, validPng, children }) {
  const result = {
    mode: 'headed',
    interceptEnabled: false,
    enterOpened: false,
    spaceOpened: false,
    enterMode: '',
    spaceMode: '',
    afterEnterFilled: null,
    afterSpaceFilled: null,
    afterEnterName: '',
    afterSpaceName: '',
    afterEnterPrompt: '',
    afterSpacePrompt: '',
    pageEnable: null,
    chromeVersion: '',
    verified: false,
    unverifiedReason: '',
    osEscape: null,
  }
  const debugPort = await freePort()
  const chrome = spawn(CHROME_PATH, [
    `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
    '--window-position=40,40',
    '--force-device-scale-factor=1',
    '--no-first-run',
    '--disable-extensions',
    `--remote-debugging-port=${debugPort}`,
    '--remote-allow-origins=*',
    `--user-data-dir=/private/tmp/gametool-vis02-headed-${process.pid}`,
    'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] })
  children.push(chrome)
  let headed = null
  try {
    const version = await waitForChrome(debugPort, chrome, 12_000)
    headed = new CdpClient(version.webSocketDebuggerUrl)
    await headed.connect()
    const { targetId } = await headed.send('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await headed.send('Target.attachToTarget', { targetId, flatten: true })
    const fileChooserEvents = []
    headed.on((event) => {
      if (event.method === 'Page.fileChooserOpened') {
        fileChooserEvents.push({
          mode: event.params?.mode || '',
          backendNodeId: event.params?.backendNodeId || 0,
        })
      }
    })
    result.chromeVersion = version.Browser || ''
    result.pageEnable = { params: { enableFileChooserOpenedEvent: true }, ok: false, error: '' }
    try {
      await headed.send('Page.enable', { enableFileChooserOpenedEvent: true }, sessionId)
      result.pageEnable.ok = true
    } catch (error) {
      result.pageEnable.error = error.message
      await headed.send('Page.enable', {}, sessionId)
    }
    await headed.send('Runtime.enable', {}, sessionId)
    await headed.send('Page.navigate', { url: `${origin}${PREVIEW_PATH}` }, sessionId)
    await waitUntil(headed, sessionId, 'document.readyState === "complete"', 5_000)
    await evaluate(headed, sessionId, 'document.fonts.ready.then(() => true)')
    await headed.send('DOM.enable', {}, sessionId)
    await headed.send('Page.bringToFront', {}, sessionId)
    const { root } = await headed.send('DOM.getDocument', { depth: 0 }, sessionId)
    const { nodeId: fileNodeId } = await headed.send('DOM.querySelector', {
      nodeId: root.nodeId,
      selector: '#vnext-ref-input',
    }, sessionId)
    const { node: fileNode } = await headed.send('DOM.describeNode', { nodeId: fileNodeId }, sessionId)
    await headed.send('DOM.setFileInputFiles', { files: [validPng], backendNodeId: fileNode.backendNodeId }, sessionId)
    await waitUntil(headed, sessionId, `document.querySelector('#vnext-ref-name')?.textContent === 'vis02-ok.png'`, 3_000)
    await evaluate(headed, sessionId, `(() => {
      const input = document.querySelector('#vnext-prompt-input')
      input.value = 'keep-headed-prompt'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      document.activeElement && document.activeElement.blur()
      return true
    })()`)
    await tabUntil(headed, sessionId, (state) => state.activeId === 'vnext-ref-input' && state.activeType === 'file')
    await runOsascript('tell application "Google Chrome" to activate')

    const tryNativeKey = async (key) => {
      const since = fileChooserEvents.length
      let keyError = ''
      try {
        await pressKey(headed, sessionId, key)
      } catch (error) {
        keyError = error.message
      }
      const opened = await waitForNextFileChooser(fileChooserEvents, since, keyError ? 200 : 2_000)
      const escape = await runOsascript(`tell application "Google Chrome" to activate
tell application "System Events" to key code 53`)
      const state = await evaluate(headed, sessionId, `(() => ({
        name: document.querySelector('#vnext-ref-name')?.textContent ?? '',
        prompt: document.querySelector('#vnext-prompt-input')?.value ?? '',
        filled: document.querySelector('.vnext-ref-image')?.classList.contains('is-filled') === true,
        error: document.querySelector('#vnext-ref-error')?.textContent ?? '',
      }))()`)
      return { opened, keyError, escape, state }
    }

    const enter = await tryNativeKey('Enter')
    result.enterOpened = Boolean(enter.opened)
    result.enterMode = enter.opened?.mode || ''
    result.afterEnterFilled = enter.state.filled
    result.afterEnterName = enter.state.name
    result.afterEnterPrompt = enter.state.prompt
    result.osEscape = enter.escape
    const space = await tryNativeKey(' ')
    result.spaceOpened = Boolean(space.opened)
    result.spaceMode = space.opened?.mode || ''
    result.afterSpaceFilled = space.state.filled
    result.afterSpaceName = space.state.name
    result.afterSpacePrompt = space.state.prompt
    const kept = result.afterEnterName === 'vis02-ok.png'
      && result.afterSpaceName === 'vis02-ok.png'
      && result.afterEnterPrompt === 'keep-headed-prompt'
      && result.afterSpacePrompt === 'keep-headed-prompt'
      && result.afterEnterFilled === true
      && result.afterSpaceFilled === true
    if (result.enterOpened && result.spaceOpened && kept && !enter.keyError && !space.keyError) {
      result.verified = true
    } else if (enter.keyError || space.keyError) {
      result.unverifiedReason = `Headed CDP key failed: ${enter.keyError || space.keyError}. Native open/cancel not claimed.`
    } else if (!result.enterOpened || !result.spaceOpened) {
      result.unverifiedReason = `Headed Chrome fileChooserOpened enter=${result.enterOpened} space=${result.spaceOpened}. Native OS picker not proven.`
    } else {
      result.unverifiedReason = `Headed picker opened but kept-state failed ${JSON.stringify({ enter: enter.state, space: space.state })}`
    }

    result.import = {
      created: false,
      tabReached: false,
      enterOpened: false,
      spaceOpened: false,
      afterEnterInputDisabled: null,
      afterSpaceInputDisabled: null,
      verified: false,
      unverifiedReason: '',
    }
    try {
      await evaluate(headed, sessionId, `(() => {
        document.querySelector('#vnext-project-btn')?.click()
        document.querySelector('[data-project-action="new"]')?.click()
        return true
      })()`)
      await waitUntil(headed, sessionId, `document.querySelector('#vnext-import-input') && document.querySelector('#vnext-import-input').disabled === false`, 5_000)
      result.import.created = true
      await evaluate(headed, sessionId, `document.activeElement && document.activeElement.blur(); true`)
      const importTab = await tabUntil(headed, sessionId, (state) => state.activeId === 'vnext-import-input' && state.activeType === 'file', 40)
      result.import.tabReached = Boolean(importTab)
      const importEnter = await tryNativeKey('Enter')
      result.import.enterOpened = Boolean(importEnter.opened)
      result.import.afterEnterInputDisabled = await evaluate(headed, sessionId, `document.querySelector('#vnext-import-input')?.disabled === true`)
      const importSpace = await tryNativeKey(' ')
      result.import.spaceOpened = Boolean(importSpace.opened)
      result.import.afterSpaceInputDisabled = await evaluate(headed, sessionId, `document.querySelector('#vnext-import-input')?.disabled === true`)
      if (result.import.tabReached && result.import.enterOpened && result.import.spaceOpened) {
        result.import.verified = true
      } else {
        result.import.unverifiedReason = `import picker tab=${result.import.tabReached} enter=${result.import.enterOpened} space=${result.import.spaceOpened}. fileChooserOpened=false is not proof the button is broken.`
      }
    } catch (error) {
      result.import.unverifiedReason = `Import headed probe failed: ${error.message}`
    }
    return result
  } catch (error) {
    result.unverifiedReason = `Headed native picker probe failed: ${error.message}`
    return result
  } finally {
    headed?.close()
    if (chrome.exitCode === null) chrome.kill('SIGTERM')
    await delay(300)
    if (chrome.exitCode === null) chrome.kill('SIGKILL')
  }
}

async function pressKey(client, sessionId, key) {
  const virtualKeys = { Tab: 9, Enter: 13, ' ': 32, Escape: 27 }
  const windowsVirtualKeyCode = virtualKeys[key]
  const code = key === ' ' ? 'Space' : key
  const params = { key, code, windowsVirtualKeyCode, nativeVirtualKeyCode: windowsVirtualKeyCode }
  await client.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...params }, sessionId)
  if (key === ' ' || key === 'Enter') {
    await client.send('Input.dispatchKeyEvent', { type: 'char', ...params, text: key === ' ' ? ' ' : '\r' }, sessionId)
  }
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', ...params }, sessionId)
}

async function waitForNextFileChooser(events, since, timeoutMs = 1500) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (events.length > since) return events[events.length - 1]
    await delay(50)
  }
  return null
}

async function dismissInterceptedChooser(client, sessionId, backendNodeId) {
  await client.send('DOM.setFileInputFiles', { files: [], backendNodeId }, sessionId)
}

async function pressKeyAndWatchChooser(client, sessionId, events, key, backendNodeId, timeoutMs = 1500) {
  const since = events.length
  const openedPromise = waitForNextFileChooser(events, since, timeoutMs)
  const keyPromise = pressKey(client, sessionId, key)
  const opened = await openedPromise
  if (backendNodeId) {
    try {
      await dismissInterceptedChooser(client, sessionId, backendNodeId)
    } catch {
      // Chooser may already be gone; keep going so CDP cannot stay blocked.
    }
  }
  await Promise.race([keyPromise, delay(500)])
  return opened
}

async function tabUntil(client, sessionId, check, maxTabs = 48) {
  const seen = []
  for (let i = 0; i < maxTabs; i += 1) {
    await pressKey(client, sessionId, 'Tab')
    const state = await evaluate(client, sessionId, REF_STATE_EXPRESSION)
    seen.push({ id: state.activeId, cls: state.activeClass, type: state.activeType })
    if (check(state)) return { state, seen, tabs: i + 1 }
  }
  throw new Error(`native Tab did not reach the expected control: ${JSON.stringify(seen)}`)
}

async function evaluate(client, sessionId, expression) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  }, sessionId)
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
  }
  return result.result?.value
}

const REF_STATE_EXPRESSION = `(() => {
  const img = document.querySelector('#vnext-ref-preview')
  const active = document.activeElement
  return {
    name: document.querySelector('#vnext-ref-name')?.textContent ?? '',
    previewSrc: img?.getAttribute('src') || '',
    naturalWidth: img?.naturalWidth ?? 0,
    naturalHeight: img?.naturalHeight ?? 0,
    complete: img?.complete === true,
    error: document.querySelector('#vnext-ref-error')?.textContent ?? '',
    filled: document.querySelector('.vnext-ref-image')?.classList.contains('is-filled') === true,
    activeId: active?.id || '',
    activeClass: typeof active?.className === 'string' ? active.className : '',
    activeTag: active?.tagName || '',
    activeType: active?.type || '',
    focusVisible: Boolean(active?.matches?.(':focus') || active?.matches?.(':focus-visible')),
    slotFocusWithin: document.querySelector('.vnext-ref-image')?.matches(':focus-within') === true,
    fileClicks: Number(window.__vnextFileClicks || 0),
  }
})()`

async function waitUntil(client, sessionId, expression, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let lastError = null
  while (Date.now() < deadline) {
    try {
      if (await evaluate(client, sessionId, expression)) return
    } catch (error) {
      lastError = error
    }
    await delay(50)
  }
  throw new Error(`timed out waiting for ${expression}: ${lastError?.message ?? ''}`)
}

async function screenshot(client, sessionId, filePath, clip) {
  const params = { format: 'png', captureBeyondViewport: false }
  if (clip) params.clip = { x: clip.x, y: clip.y, width: clip.width, height: clip.height, scale: 1 }
  const result = await client.send('Page.captureScreenshot', params, sessionId)
  const buffer = Buffer.from(result.data, 'base64')
  await writeFile(filePath, buffer)
  return { file: filePath, ...pngSize(buffer), bytes: buffer.length, sha256: createHash('sha256').update(buffer).digest('hex') }
}

const METRICS_EXPRESSION = `(() => {
  const box = (selector) => {
    const node = document.querySelector(selector)
    if (!node) return null
    const rect = node.getBoundingClientRect()
    const round = (value) => Math.round(value * 100) / 100
    return { x: round(rect.x), y: round(rect.y), w: round(rect.width), h: round(rect.height) }
  }
  const style = (selector, props) => {
    const node = document.querySelector(selector)
    if (!node) return null
    const computed = getComputedStyle(node)
    return Object.fromEntries(props.map((prop) => [prop, computed[prop]]))
  }
  const images = [...document.images]
  return {
    title: document.title,
    lang: document.documentElement.lang,
    viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
    scroll: {
      x: window.scrollX,
      y: window.scrollY,
      docW: document.documentElement.scrollWidth,
      docH: document.documentElement.scrollHeight,
      bodyOverflow: getComputedStyle(document.body).overflow,
    },
    fontStack: style('.vnext-workbench', ['fontFamily']).fontFamily,
    interAvailable: (() => {
      const probe = (family) => {
        const span = document.createElement('span')
        span.style.cssText = 'position:absolute;visibility:hidden;font-size:64px;white-space:nowrap;font-family:' + family
        span.textContent = 'Fixed-region motion 0123 What would you like to create?'
        document.body.append(span)
        const width = span.getBoundingClientRect().width
        span.remove()
        return width
      }
      return probe('Inter, monospace') !== probe('monospace')
    })(),
    fontFaces: [...document.fonts].map((face) => ({ family: face.family, weight: face.weight, status: face.status })),
    images: (() => {
      const sourced = images.filter((img) => Boolean(img.getAttribute('src')))
      return { total: sourced.length, loaded: sourced.filter((img) => img.complete && img.naturalWidth > 0).length }
    })(),
    inlineSvg: (() => {
      const uses = [...document.querySelectorAll('.vnext-workbench use')]
      const unresolved = uses.filter((use) => !document.getElementById((use.getAttribute('href') || '').slice(1)))
      const visible = uses.filter((use) => use.closest('svg').getBoundingClientRect().width > 0)
      const emptyBoxes = visible.filter((use) => { const b = use.getBBox(); return !(b.width > 0 && b.height > 0) })
      return {
        symbols: document.querySelectorAll('.vnext-sprite symbol').length,
        uses: uses.length,
        visibleUses: visible.length,
        unresolved: unresolved.map((use) => use.getAttribute('href')),
        emptyBoxes: emptyBoxes.map((use) => use.getAttribute('href')),
        eraserBox: (() => { const b = document.querySelector('[data-figma="1818:5306"] use').getBBox(); return { w: Math.round(b.width * 100) / 100, h: Math.round(b.height * 100) / 100 } })(),
        svGradient: getComputedStyle(document.querySelector('#vnext-color-sv-active rect')).fill,
      }
    })(),
    workbench: box('.vnext-workbench'),
    banner: box('.vnext-preview-banner'),
    left: box('.vnext-left'),
    leftTop: box('.vnext-left-top'),
    homeButton: box('[data-figma="1819:5318"]'),
    projectChip: box('[data-figma="1819:5338"]'),
    chatPair: box('.vnext-chat-pair'),
    sidebarButton: box('[data-figma="1819:5333"]'),
    composer: box('.vnext-composer'),
    refImage: box('.vnext-ref-image'),
    skillTag: box('.vnext-skill-tag'),
    prompt: box('.vnext-prompt'),
    promptInput: box('#vnext-prompt-input'),
    promptValue: document.querySelector('#vnext-prompt-input')?.value ?? '',
    refInput: box('#vnext-ref-input'),
    refPreview: box('#vnext-ref-preview'),
    refName: document.querySelector('#vnext-ref-name')?.textContent ?? '',
    refError: document.querySelector('#vnext-ref-error')?.textContent ?? '',
    linkCopies: [...document.querySelectorAll('button[data-capability~="TIME-07"]')].map((node) => ({
      disabled: node.disabled === true,
      label: node.getAttribute('aria-label'),
    })),
    addBlank: box('.vnext-add-blank'),
    addBlankDisabled: document.querySelector('.vnext-add-blank')?.disabled === true,
    spriteChip: box('[data-figma="I1824:5723;1819:5346"]'),
    sizeChip: box('[data-figma="I1824:5723;1819:5355"]'),
    brainButton: box('[data-figma="I1824:5723;1819:5362"]'),
    puzzleButton: box('[data-figma="I1824:5723;1819:5367"]'),
    send: box('.vnext-send'),
    sendStyle: style('.vnext-send', ['borderRadius', 'backgroundColor']),
    composerBar: box('.vnext-composer-bar'),
    sendInsideComposer: (() => {
      const composer = document.querySelector('.vnext-composer')?.getBoundingClientRect()
      const send = document.querySelector('.vnext-send')?.getBoundingClientRect()
      const bar = document.querySelector('.vnext-composer-bar')?.getBoundingClientRect()
      return Boolean(
        composer && send && bar
        && send.bottom <= composer.bottom + 0.5
        && send.top >= composer.top - 0.5
        && bar.bottom <= composer.bottom + 0.5
        && send.bottom <= 1080.5,
      )
    })(),
    refEmptyLabel: box('.vnext-ref-empty .vnext-ref-image-label'),
    refPreviewNatural: (() => {
      const img = document.querySelector('#vnext-ref-preview')
      return img ? { w: img.naturalWidth, h: img.naturalHeight, src: img.getAttribute('src') || '', complete: img.complete } : null
    })(),
    searchStyle: style('.vnext-search', ['backgroundColor', 'boxShadow']),
    homeFill: style('.vnext-workbench', ['backgroundColor']).backgroundColor,
    canvasFill: style('.vnext-canvas', ['backgroundColor']).backgroundColor,
    skillPopStyle: style('.vnext-skill-pop', ['backgroundColor', 'backdropFilter', 'boxShadow']),
    previewStyle: style('.vnext-preview', ['backgroundColor', 'backdropFilter', 'boxShadow']),
    skillTagIconOpacity: style('.vnext-skill-tag-icon', ['opacity']).opacity,
    skillPopDividers: document.querySelectorAll('.vnext-skill-pop .vnext-pop-divider').length,
    projectInk: style('.vnext-text-btn.is-project', ['color']).color,
    newSkillInk: style('[data-figma="I1814:5222;1826:5787"]', ['color']).color,
    spriteTypeInk: style('[data-figma="I1824:5723;1819:5346"]', ['color']).color,
    customInk: style('[data-figma="I1823:5415;1820:5387"]', ['color']).color,
    addColorInk: style('[data-figma="I1823:5415;1820:5395"]', ['color']).color,
    videoInk: style('.vnext-mode-btn.is-closed', ['color']).color,
    videoIconOpacity: style('.vnext-mode-btn.is-closed .vnext-icon', ['opacity']).opacity,
    promptRows: document.querySelector('#vnext-prompt-input')?.rows ?? null,
    center: box('.vnext-center'),
    pagebar: box('.vnext-pagebar'),
    pageTab: box('[data-figma="1819:5379"]'),
    addPage: box('[data-figma="1819:5391"]'),
    canvasHost: box('.vnext-canvas-host'),
    viewportBar: box('.vnext-viewport'),
    fileButton: box('[data-figma="1820:5403"]'),
    tvButton: box('[data-figma="1820:5408"]'),
    zoom: box('.vnext-zoom'),
    mode: box('.vnext-mode'),
    modeSprite: box('[data-figma="I1824:5772;1819:5395"]'),
    modeImage: box('[data-figma="I1824:5772;1819:5404"]'),
    modeVideo: box('[data-figma="I1824:5772;1819:5415"]'),
    tools: box('.vnext-tools'),
    tool: box('.vnext-tool'),
    toolIcon: box('.vnext-tool .vnext-icon'),
    toolLast: box('[data-figma="1818:5329"]'),
    preview: box('.vnext-preview'),
    previewHead: box('.vnext-preview-head'),
    previewBody: box('.vnext-preview-body'),
    previewCollapse: box('[data-figma="I1821:5412;1821:5402"]'),
    previewClose: box('[data-figma="I1821:5412;1821:5407"]'),
    timeline: box('.vnext-timeline'),
    playback: box('.vnext-playback'),
    firstFrameButton: box('[data-figma="I1824:5516;1990:208"]'),
    firstFrameIcon: box('[data-figma="I1824:5516;1990:208"] .vnext-icon'),
    playPosition: box('.vnext-play-position'),
    loop: box('[data-figma="I1824:5516;1990:233"]'),
    fps: box('[data-figma="I1824:5516;1990:238"]'),
    onion: box('.vnext-onion'),
    onionSettings: box('[data-figma="I1824:5516;1990:252"]'),
    grid: box('.vnext-grid'),
    layerCol: box('.vnext-layer-col'),
    selectedRow: box('.vnext-selected-row'),
    layersButton: box('[data-figma="I1824:5516;1990:284;1989:7613"]'),
    layerRowDetails: box('[data-figma="I1824:5516;1990:268"]'),
    layerRowSprite: box('[data-figma="I1824:5516;1990:284"]'),
    layerEyeSlot: box('[data-figma="I1824:5516;1990:268;2086:816"]'),
    layerEyeIcon: box('[data-figma="I1824:5516;1990:268;2086:816"] .vnext-icon'),
    layerLockSlot: box('[data-figma="I1824:5516;1990:268;2086:2753"]'),
    layerLinkSlot: box('[data-figma="I1824:5516;1990:268;2086:2754"]'),
    layerLinkIcon: box('[data-figma="I1824:5516;1990:268;2086:2754"] .vnext-icon'),
    layerNameDetails: box('[data-figma="I1824:5516;1990:268"] .vnext-layer-name'),
    layersPlusIcon: box('[data-figma="I1824:5516;1990:263"] .vnext-icon'),
    layerMoreIcon: box('[data-figma="I1824:5516;1990:284;1989:7613"] .vnext-icon'),
    durationLabel: box('.vnext-duration-label'),
    frames: box('.vnext-frames'),
    frameCol1: box('.vnext-frame-col[data-frame="1"]'),
    frameCol12: box('.vnext-frame-col[data-frame="12"]'),
    addFrame: box('.vnext-add-blank'),
    celSlot: box('.vnext-cel'),
    celFace: (() => {
      const slot = document.querySelector('.vnext-cel > svg')
      if (!slot) return null
      const rect = slot.getBoundingClientRect()
      return { x: rect.x, y: rect.y, w: rect.width, h: rect.height, source: '24px cel face inside 32px slot' }
    })(),
    celCount: document.querySelectorAll('.vnext-cel').length,
    celFilled: document.querySelectorAll('.vnext-cel.is-filled').length,
    celBlank: document.querySelectorAll('.vnext-cel.is-blank').length,
    celSelected: [...document.querySelectorAll('.vnext-cel.is-selected')].map((node) => node.closest('.vnext-frame-col').dataset.frame + ':' + node.dataset.layer),
    detailsDots: [...document.querySelectorAll('.vnext-frame-col')].filter((col) => col.querySelector('.vnext-cel[data-layer="Details"].is-filled')).map((col) => col.dataset.frame),
    frameIndexes: [...document.querySelectorAll('.vnext-frame-index')].map((node) => node.textContent),
    durations: [...new Set([...document.querySelectorAll('.vnext-frame-duration')].map((node) => node.textContent))],
    colorSidebar: box('.vnext-color-sidebar'),
    colorPanel: box('.vnext-color'),
    colorHead: box('.vnext-color-head'),
    sv: box('.vnext-sv'),
    hue: box('.vnext-hue'),
    alpha: box('.vnext-alpha'),
    colorValues: box('.vnext-color-values'),
    eyedropper: box('[data-figma="I1823:5415;1820:5382"]'),
    eyedropperIcon: box('[data-figma="I1823:5415;1820:5382"] .vnext-icon'),
    eyedropperStroke: (() => {
      const href = document.querySelector('[data-figma="I1823:5415;1820:5382"] use')?.getAttribute('href')
      const path = href ? document.querySelector(href)?.querySelector('path') : null
      return { stroke: path?.getAttribute('stroke') || '', width: path?.getAttribute('stroke-width') || '' }
    })(),
    hexInput: box('.vnext-hex-input'),
    alphaInput: box('.vnext-alpha-input'),
    quickRow: box('.vnext-quick-row'),
    quickSelected: box('[data-figma="I1823:5415;1725:5180"]'),
    quickRing: box('[data-figma="I1823:5415;1725:5180"] .vnext-swatch-ring'),
    quickSecond: box('[data-figma="I1823:5415;1725:5183"]'),
    paletteSep: box('.vnext-palette-sep'),
    paletteHead: box('.vnext-palette-head'),
    palette: box('.vnext-palette'),
    paletteFirst: box('#vnext-palette .vnext-swatch'),
    paletteSelected: box('#vnext-palette .vnext-swatch.is-selected'),
    swatchStyle: style('#vnext-palette .vnext-swatch', ['width', 'height', 'borderRadius']),
    swatchCount: document.querySelectorAll('#vnext-palette .vnext-swatch').length,
    swatchRings: document.querySelectorAll('.vnext-swatch .vnext-swatch-ring').length,
    skillPop: box('.vnext-skill-pop'),
    skillPopHead: box('.vnext-pop-head'),
    newSkill: box('[data-figma="I1814:5222;1826:5787"]'),
    search: box('.vnext-search'),
    skillRow0: box('[data-figma="I1814:5222;1793:5230"]'),
    skillRow1: box('[data-figma="I1814:5222;1793:5237"]'),
    skillThumb: box('.vnext-skill-thumb.is-template'),
    skillThumbImageLoaded: (() => { const img = document.querySelector('.vnext-skill-thumb.is-template img'); return Boolean(img && img.complete && img.naturalWidth > 0) })(),
    skillPopZ: style('.vnext-skill-pop', ['zIndex']).zIndex,
    timelineZ: style('.vnext-timeline', ['zIndex']).zIndex,
    sendDisabled: document.querySelector('.vnext-send')?.disabled === true,
    videoDisabled: document.querySelector('[data-capability="HOME-04"]')?.disabled === true,
    skillOpen: document.querySelector('.vnext-skill-pop')?.hidden === false,
    previewOpen: document.querySelector('.vnext-preview')?.hidden === false,
    layersOpen: document.querySelector('.vnext-layers-pop')?.hidden === false,
    onionOpen: document.querySelector('.vnext-onion-pop')?.hidden === false,
    capabilityIds: [...new Set([...document.querySelectorAll('[data-capability]')].flatMap((node) => node.dataset.capability.split(/\\s+/)))].sort(),
    notOnSurface: document.querySelector('.vnext-workbench')?.dataset.capabilityNotOnSurface ?? null,
    enabledControls: [...document.querySelectorAll('button:not([disabled])')].map((node) => node.dataset.figma || node.className),
  }
})()`

const CANVAS_FIRST_MEASURE = `(() => {
  const left = document.querySelector('.vnext-left')?.getBoundingClientRect()
  const box = (selector) => {
    const node = document.querySelector(selector)
    if (!node || !left) return null
    const rect = node.getBoundingClientRect()
    const round = (value) => Math.round(value * 100) / 100
    return {
      x: round(rect.x),
      y: round(rect.y),
      w: round(rect.width),
      h: round(rect.height),
      inside: rect.width > 0 && rect.height > 0 && rect.left >= left.left - 1 && rect.right <= left.right + 1 && rect.top >= left.top - 1 && rect.bottom <= left.bottom + 1,
    }
  }
  const name = document.querySelector('#vnext-canvas-ref-name')
  const later = document.querySelector('#vnext-edit-later')
  const status = document.querySelector('#vnext-canvas-status')
  const send = document.querySelector('.vnext-send')
  const composer = document.querySelector('.vnext-composer')
  return {
    left: left ? { w: Math.round(left.width), h: Math.round(left.height) } : null,
    refHidden: document.querySelector('#vnext-canvas-ref')?.hidden === true,
    name: name?.textContent || '',
    nameEllipsis: Boolean(name && name.scrollWidth > name.clientWidth + 1),
    laterText: later?.textContent || '',
    laterHidden: later?.hidden === true,
    laterWrapped: Boolean(later && later.getBoundingClientRect().height > 20),
    status: status?.textContent || '',
    statusHidden: status?.hidden === true,
    statusBox: box('#vnext-canvas-status'),
    sendDisabled: send?.disabled === true,
    sendLabel: send?.getAttribute('aria-label') || '',
    sendTitle: send?.title || '',
    composerClipped: Boolean(composer && composer.scrollWidth > composer.clientWidth + 1),
    selectionEdit: document.querySelector('.vnext-left')?.classList.contains('is-selection-edit') === true,
    composerH: Math.round(composer?.getBoundingClientRect().height || 0),
    refImageHidden: getComputedStyle(document.querySelector('.vnext-ref-image')).display === 'none',
    spriteHidden: getComputedStyle(document.querySelector('[data-capability="GEN-03"]')).display === 'none',
    sizeHidden: getComputedStyle(document.querySelector('[data-capability="GEN-04"]')).display === 'none',
    skillHidden: getComputedStyle(document.querySelector('[data-capability="SKILL-01"]')).display === 'none',
    laterBelowComposer: Boolean(later && composer && later.getBoundingClientRect().top >= composer.getBoundingClientRect().bottom - 1),
    refMeaning: document.querySelector('.vnext-canvas-ref-meaning')?.textContent || '',
    refRadius: getComputedStyle(document.querySelector('#vnext-canvas-ref')).borderRadius,
    refBg: getComputedStyle(document.querySelector('#vnext-canvas-ref')).backgroundColor,
    refShadow: getComputedStyle(document.querySelector('#vnext-canvas-ref')).boxShadow,
    refH: Math.round(document.querySelector('#vnext-canvas-ref')?.getBoundingClientRect().height || 0),
    ref: box('#vnext-canvas-ref'),
    remove: box('#vnext-canvas-ref-remove'),
    later: box('#vnext-edit-later'),
    send: box('.vnext-send'),
    composer: box('.vnext-composer'),
  }
})()`

async function captureConfirmedReload(client, sessionId, network) {
  const importCount = () => network.requests.filter((item) => item.method === 'POST' && item.url.includes('/import-png')).length
  const beforePosts = importCount()
  let failedList = false
  const onFetch = (event) => {
    if (event.method !== 'Fetch.requestPaused' || event.sessionId !== sessionId) return
    const request = event.params.request
    const requestId = event.params.requestId
    let path = request.url
    try { path = new URL(request.url).pathname } catch { /* keep raw */ }
    if (request.method === 'GET' && path.endsWith('/sprite-documents') && !failedList) {
      failedList = true
      fulfillJson(client, sessionId, requestId, 500, { error: 'storage_commit_failed', reason: 'disk' }).catch(() => {})
      return
    }
    client.send('Fetch.continueRequest', { requestId }, sessionId).catch(() => {})
  }
  client.on(onFetch)
  try {
    await client.send('Fetch.enable', {
      patterns: [{ urlPattern: '*sprite-documents*', requestStage: 'Request' }],
    }, sessionId)
    const pngB64 = encodeVisibleImportPng().toString('base64')
    const plan = await evaluate(client, sessionId, `(() => {
      const session = window.getVnextProjectSession?.()
      const stage = document.querySelector('#vnext-canvas-stage')
      const box = stage.getBoundingClientRect()
      session.view.panBy(12, 8)
      const clientX = box.left + 70
      const clientY = box.top + 90
      return { clientX, clientY, expected: session.view.screenToWorld(clientX, clientY, box) }
    })()`)
    await evaluate(client, sessionId, `(() => {
      const binary = atob(${JSON.stringify(pngB64)})
      const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0))
      const file = new File([bytes], 'reload-evidence.png', { type: 'image/png' })
      const stage = document.querySelector('#vnext-canvas-stage')
      const transfer = new DataTransfer()
      transfer.items.add(file)
      stage.dispatchEvent(new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        clientX: ${plan.clientX},
        clientY: ${plan.clientY},
        dataTransfer: transfer,
      }))
      return true
    })()`)
    await waitUntil(client, sessionId, `document.querySelector('#vnext-confirm-title')?.textContent === 'Imported, but the canvas did not refresh'`, 8_000)
    const afterDropPosts = importCount()
    const prompt = await evaluate(client, sessionId, `(() => {
      const dialog = document.querySelector('#vnext-confirm-dialog .vnext-dialog')
      const rect = dialog?.getBoundingClientRect()
      const status = document.querySelector('#vnext-canvas-status')
      const statusRect = status?.getBoundingClientRect()
      return {
        title: document.querySelector('#vnext-confirm-title')?.textContent || '',
        body: document.querySelector('#vnext-confirm-body')?.textContent || '',
        primary: document.querySelector('#vnext-confirm-primary')?.textContent || '',
        secondary: document.querySelector('#vnext-confirm-secondary')?.textContent || '',
        status: status?.textContent || '',
        dialog: rect ? { x: rect.x, y: rect.y, w: rect.width, h: rect.height } : null,
        statusBox: statusRect ? { x: statusRect.x, y: statusRect.y, w: statusRect.width, h: statusRect.height } : null,
      }
    })()`)
    const clip = (x, y, width, height) => {
      const left = Math.max(0, Math.min(x, 1919))
      const top = Math.max(0, Math.min(y, 1079))
      return {
        x: left,
        y: top,
        width: Math.max(1, Math.min(width, 1920 - left)),
        height: Math.max(1, Math.min(height, 1080 - top)),
      }
    }
    const shotDialog = prompt.dialog
      ? await screenshot(client, sessionId, path.join(EVIDENCE_DIR, 'canvas-first-reload-dialog.png'), clip(
        prompt.dialog.x - 16,
        prompt.dialog.y - 16,
        prompt.dialog.w + 32,
        prompt.dialog.h + 32,
      ))
      : null
    const shotStatus406 = prompt.statusBox
      ? await screenshot(client, sessionId, path.join(EVIDENCE_DIR, 'canvas-first-reload-status-406.png'), clip(
        0,
        prompt.statusBox.y - 24,
        406,
        Math.max(80, prompt.statusBox.h + 48),
      ))
      : null
    await evaluate(client, sessionId, `document.querySelector('.vnext-workbench')?.style.setProperty('--vnext-left-width', '280px'); true`)
    await delay(150)
    const status280 = await evaluate(client, sessionId, `(() => {
      const status = document.querySelector('#vnext-canvas-status')
      const rect = status?.getBoundingClientRect()
      const left = document.querySelector('.vnext-left')?.getBoundingClientRect()
      return {
        text: status?.textContent || '',
        w: rect ? Math.round(rect.width) : 0,
        h: rect ? Math.round(rect.height) : 0,
        inside: Boolean(rect && left && rect.right <= left.right + 1 && rect.bottom <= left.bottom + 1),
        x: rect?.x || 0,
        y: rect?.y || 0,
      }
    })()`)
    const shotStatus280 = await screenshot(client, sessionId, path.join(EVIDENCE_DIR, 'canvas-first-reload-status-280.png'), clip(
      0,
      status280.y - 24,
      280,
      Math.max(96, status280.h + 48),
    ))
    await evaluate(client, sessionId, `document.querySelector('.vnext-workbench')?.style.setProperty('--vnext-left-width', '406px'); true`)
    await evaluate(client, sessionId, `document.querySelector('#vnext-confirm-primary')?.click(); true`)
    const expectedX = Math.trunc(plan.expected.x)
    const expectedY = Math.trunc(plan.expected.y)
    await waitUntil(client, sessionId, `(() => {
      const session = window.getVnextProjectSession?.()
      const id = session?.view?.selectedId
      const pos = id ? session.view.positionOf(id) : null
      return document.querySelector('#vnext-confirm-dialog')?.hidden === true && pos && pos.x === ${expectedX} && pos.y === ${expectedY}
    })()`, 8_000)
    const afterReloadPosts = importCount()
    const recovered = await evaluate(client, sessionId, `(() => {
      const session = window.getVnextProjectSession?.()
      const id = session?.view?.selectedId
      return { id, position: id ? session.view.positionOf(id) : null }
    })()`)
    return {
      failedList,
      beforePosts,
      afterDropPosts,
      afterReloadPosts,
      plan,
      prompt,
      status280,
      recovered,
      shots: { shotDialog, shotStatus406, shotStatus280 },
    }
  } finally {
    client.off(onFetch)
    await client.send('Fetch.disable', {}, sessionId).catch(() => {})
  }
}

async function captureComposerContour(client, sessionId) {
  await client.send('DOM.enable', {}, sessionId)
  await evaluate(client, sessionId, `(() => {
    document.querySelector('#vnext-confirm-secondary')?.click()
    const confirm = document.querySelector('#vnext-confirm-dialog')
    if (confirm) confirm.hidden = true
    document.querySelector('#vnext-project-btn')?.click()
    document.querySelector('[data-project-action="new"]')?.click()
    return true
  })()`)
  await waitUntil(client, sessionId, `document.querySelector('#vnext-import-input')?.disabled === false && document.querySelector('#vnext-project-name')?.textContent === 'Untitled Project'`, 8_000)
  const stem = 'Northern region merchant traveller villager sprite sheet reference canvas selected for the conversation'
  const pngB64 = encodeVisibleImportPng().toString('base64')
  const dropPlan = await evaluate(client, sessionId, `(() => {
    const session = window.getVnextProjectSession?.()
    const stage = document.querySelector('#vnext-canvas-stage')
    const box = stage.getBoundingClientRect()
    session.view.panBy(36, 18)
    session.view.zoomAt(box.left + 80, box.top + 70, 2, box)
    const clientX = box.left + 90
    const clientY = box.top + 80
    return { clientX, clientY }
  })()`)
  await evaluate(client, sessionId, `(() => {
    const binary = atob(${JSON.stringify(pngB64)})
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0))
    const file = new File([bytes], ${JSON.stringify(`${stem}.png`)}, { type: 'image/png' })
    const stage = document.querySelector('#vnext-canvas-stage')
    const transfer = new DataTransfer()
    transfer.items.add(file)
    stage.dispatchEvent(new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      clientX: ${dropPlan.clientX},
      clientY: ${dropPlan.clientY},
      dataTransfer: transfer,
    }))
    return true
  })()`)
  await waitUntil(client, sessionId, `document.querySelector('#vnext-canvas-ref')?.hidden === false && document.querySelector('#vnext-canvas-ref-name')?.textContent === ${JSON.stringify(stem)}`, 8_000)
  await delay(150)
  const measure = `(() => {
    const node = document.querySelector('.vnext-composer')
    const face = document.querySelector('.vnext-composer-clip')
    const rect = node.getBoundingClientRect()
    const style = getComputedStyle(node)
    const faceStyle = face ? getComputedStyle(face) : null
    return {
      x: rect.x,
      y: rect.y,
      w: Math.round(rect.width),
      h: Math.round(rect.height),
      composerClip: style.clipPath,
      faceClip: faceStyle ? faceStyle.clipPath.slice(0, 40) : '',
      filter: style.filter,
      radius: style.borderRadius,
      selectionEdit: document.querySelector('.vnext-left')?.classList.contains('is-selection-edit') === true,
      refHidden: document.querySelector('#vnext-canvas-ref')?.hidden === true,
      name: document.querySelector('#vnext-canvas-ref-name')?.textContent || '',
    }
  })()`
  const states = []
  async function shot(name, width) {
    await evaluate(client, sessionId, `document.querySelector('.vnext-workbench')?.style.setProperty('--vnext-left-width', '${width}px'); true`)
    await delay(150)
    const metrics = await evaluate(client, sessionId, measure)
    const file = await screenshot(client, sessionId, path.join(EVIDENCE_DIR, name), { x: 0, y: 700, width, height: 380 })
    states.push({ name, width, metrics, file })
    return metrics
  }
  const selected406 = await shot('composer-contour-406-selected.png', 406)
  const selected280 = await shot('composer-contour-280-selected.png', 280)
  await evaluate(client, sessionId, `document.querySelector('#vnext-canvas-ref-remove')?.click(); true`)
  await waitUntil(client, sessionId, `document.querySelector('#vnext-canvas-ref')?.hidden === true && document.querySelector('.vnext-left')?.classList.contains('is-selection-edit') === false`, 8_000)
  await delay(150)
  const removed280 = await shot('composer-contour-280-removed.png', 280)
  const removed406 = await shot('composer-contour-406-removed.png', 406)
  const passed = selected406.selectionEdit === true
    && selected406.refHidden === false
    && selected406.h === 112
    && selected406.w === 381
    && selected280.selectionEdit === true
    && selected280.h === 112
    && selected280.w === 255
    && removed280.selectionEdit === false
    && removed280.refHidden === true
    && removed280.h === 197
    && removed406.selectionEdit === false
    && removed406.h === 197
    && removed406.w === 381
    && selected406.composerClip === 'none'
    && selected406.faceClip.startsWith('shape(')
    && selected406.filter.includes('drop-shadow')
  const result = { generatedAt: new Date().toISOString(), scope: 'composer-contour-shadow', passed, states }
  await writeFile(path.join(EVIDENCE_DIR, 'composer-contour.json'), `${JSON.stringify(result, null, 2)}\n`)
  console.log(JSON.stringify({ passed, report: path.join(EVIDENCE_DIR, 'composer-contour.json') }))
  if (!passed) process.exitCode = 1
}

async function captureCanvasFirstColumn(client, sessionId, network) {
  await client.send('DOM.enable', {}, sessionId)
  await evaluate(client, sessionId, `(() => {
    document.querySelector('#vnext-confirm-secondary')?.click()
    const confirm = document.querySelector('#vnext-confirm-dialog')
    if (confirm) confirm.hidden = true
    document.querySelector('#vnext-project-btn')?.click()
    document.querySelector('[data-project-action="new"]')?.click()
    return true
  })()`)
  await waitUntil(client, sessionId, `document.querySelector('#vnext-import-input')?.disabled === false && document.querySelector('#vnext-project-name')?.textContent === 'Untitled Project'`, 8_000)
  const stem = 'Northern region merchant traveller villager sprite sheet reference canvas selected for the conversation'
  const pngB64 = encodeVisibleImportPng().toString('base64')
  const dropPlan = await evaluate(client, sessionId, `(() => {
    const session = window.getVnextProjectSession?.()
    const stage = document.querySelector('#vnext-canvas-stage')
    const box = stage.getBoundingClientRect()
    session.view.panBy(36, 18)
    session.view.zoomAt(box.left + 80, box.top + 70, 2, box)
    const clientX = box.left + 90
    const clientY = box.top + 80
    const expected = session.view.screenToWorld(clientX, clientY, box)
    return {
      clientX,
      clientY,
      expected,
      zoom: session.view.zoom,
      panX: session.view.panX,
      panY: session.view.panY,
    }
  })()`)
  await evaluate(client, sessionId, `(() => {
    const binary = atob(${JSON.stringify(pngB64)})
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0))
    const file = new File([bytes], ${JSON.stringify(`${stem}.png`)}, { type: 'image/png' })
    const stage = document.querySelector('#vnext-canvas-stage')
    const transfer = new DataTransfer()
    transfer.items.add(file)
    stage.dispatchEvent(new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      clientX: ${dropPlan.clientX},
      clientY: ${dropPlan.clientY},
      dataTransfer: transfer,
    }))
    return true
  })()`)
  await waitUntil(client, sessionId, `document.querySelector('#vnext-canvas-ref')?.hidden === false && document.querySelector('#vnext-canvas-ref-name')?.textContent === ${JSON.stringify(stem)}`, 8_000)
  const placed = await evaluate(client, sessionId, `(() => {
    const session = window.getVnextProjectSession?.()
    const id = session?.view?.selectedId
    return {
      id,
      position: id ? session.view.positionOf(id) : null,
      zoom: session?.view?.zoom,
      panX: session?.view?.panX,
      panY: session?.view?.panY,
    }
  })()`)
  await delay(150)
  const at406 = await evaluate(client, sessionId, CANVAS_FIRST_MEASURE)
  const shotWorkspace = await screenshot(client, sessionId, path.join(EVIDENCE_DIR, 'canvas-first-workspace-406.png'))
  const shot406 = await screenshot(client, sessionId, path.join(EVIDENCE_DIR, 'canvas-first-left-406.png'), { x: 0, y: 0, width: 406, height: 1080 })
  const shot406Detail = await screenshot(client, sessionId, path.join(EVIDENCE_DIR, 'canvas-first-ref-406.png'), { x: 0, y: 700, width: 406, height: 380 })
  const removed = await evaluate(client, sessionId, `(() => {
    document.querySelector('#vnext-canvas-ref-remove')?.click()
    const composer = document.querySelector('.vnext-composer')?.getBoundingClientRect()
    return {
      refHidden: document.querySelector('#vnext-canvas-ref')?.hidden === true,
      selectionEdit: document.querySelector('.vnext-left')?.classList.contains('is-selection-edit') === true,
      composerH: Math.round(composer?.height || 0),
      refImageHidden: getComputedStyle(document.querySelector('.vnext-ref-image')).display === 'none',
      laterHidden: document.querySelector('#vnext-edit-later')?.hidden === true,
    }
  })()`)
  const reselected = await evaluate(client, sessionId, `(() => {
    document.querySelector('.vnext-canvas-tile')?.click()
    return {
      refHidden: document.querySelector('#vnext-canvas-ref')?.hidden === true,
      selectionEdit: document.querySelector('.vnext-left')?.classList.contains('is-selection-edit') === true,
      name: document.querySelector('#vnext-canvas-ref-name')?.textContent || '',
    }
  })()`)
  await evaluate(client, sessionId, `document.querySelector('.vnext-workbench')?.style.setProperty('--vnext-left-width', '280px'); true`)
  await delay(150)
  const at280 = await evaluate(client, sessionId, CANVAS_FIRST_MEASURE)
  const shot280 = await screenshot(client, sessionId, path.join(EVIDENCE_DIR, 'canvas-first-left-280.png'), { x: 0, y: 0, width: 280, height: 1080 })
  const shot280Detail = await screenshot(client, sessionId, path.join(EVIDENCE_DIR, 'canvas-first-ref-280.png'), { x: 0, y: 700, width: 280, height: 380 })
  await evaluate(client, sessionId, `document.querySelector('.vnext-workbench')?.style.setProperty('--vnext-left-width', '406px'); true`)
  const generationBefore = network.requests.filter((item) => /\/api\/(?:generate-character|process-sheet|gemini-state|jobs)/.test(item.url)).length
  await evaluate(client, sessionId, `document.querySelector('.vnext-send')?.click(); true`)
  await delay(200)
  const generationAfter = network.requests.filter((item) => /\/api\/(?:generate-character|process-sheet|gemini-state|jobs)/.test(item.url)).length
  const sendStillIdle = await evaluate(client, sessionId, `document.querySelector('.vnext-send')?.disabled === true`)
  await evaluate(client, sessionId, `document.querySelector('#vnext-project-btn')?.click(); document.querySelector('[data-project-action="save"]')?.click(); true`)
  await waitUntil(client, sessionId, `document.querySelector('#vnext-save-positions')?.textContent === 'Saved' || document.querySelector('#vnext-project-toast')?.textContent === 'Saved'`, 8_000)
  const saved = await evaluate(client, sessionId, `(() => {
    const session = window.getVnextProjectSession?.()
    return {
      id: session?.project?.id || '',
      positions: session?.view?.canvases.map((item) => ({ id: item.id, x: item.x, y: item.y })) || [],
    }
  })()`)
  await evaluate(client, sessionId, `window.__vnextReopenPrevProject = window.getVnextProjectSession?.().project; document.querySelector('[data-project-action="open"]')?.click(); true`)
  await waitUntil(client, sessionId, `document.querySelector('#vnext-open-dialog')?.hidden === false && Boolean(document.querySelector('#vnext-list-rows [data-project-id="${saved.id}"]'))`, 8_000)
  await evaluate(client, sessionId, `document.querySelector('#vnext-list-rows [data-project-id="${saved.id}"]')?.click(); true`)
  await waitUntil(client, sessionId, `document.querySelector('#vnext-open-confirm')?.disabled === false`, 3_000)
  await evaluate(client, sessionId, `document.querySelector('#vnext-open-confirm')?.click(); true`)
  await waitUntil(client, sessionId, `(() => {
    const session = window.getVnextProjectSession?.()
    const current = session?.project
    if (!current || current === window.__vnextReopenPrevProject || current.id !== ${JSON.stringify(saved.id)}) return false
    return JSON.stringify(session.view.canvases.map((item) => ({ id: item.id, x: item.x, y: item.y }))) === ${JSON.stringify(JSON.stringify(saved.positions))}
  })()`, 8_000)
  const reopened = await evaluate(client, sessionId, `(() => {
    const session = window.getVnextProjectSession?.()
    return {
      id: session?.project?.id || '',
      replaced: session?.project !== window.__vnextReopenPrevProject,
      positions: session?.view?.canvases.map((item) => ({ id: item.id, x: item.x, y: item.y })) || [],
    }
  })()`)
  const reload = await captureConfirmedReload(client, sessionId, network)
  const samePoint = placed.position
    && placed.position.x === Math.trunc(dropPlan.expected.x)
    && placed.position.y === Math.trunc(dropPlan.expected.y)
  const passed = at406.left?.w === 406
    && at280.left?.w === 280
    && dropPlan.zoom !== 1
    && (dropPlan.panX !== 0 || dropPlan.panY !== 0)
    && samePoint
    && at406.refHidden === false
    && at280.refHidden === false
    && at406.selectionEdit === true
    && at280.selectionEdit === true
    && at406.composerH === 112
    && at280.composerH === 112
    && at406.refImageHidden === true
    && at406.spriteHidden === true
    && at406.sizeHidden === true
    && at406.skillHidden === true
    && at406.laterBelowComposer === true
    && at280.laterBelowComposer === true
    && at406.name === stem
    && at406.nameEllipsis === true
    && at280.nameEllipsis === true
    && at406.remove?.inside === true
    && at280.remove?.inside === true
    && at406.send?.inside === true
    && at280.send?.inside === true
    && at406.sendDisabled === true
    && at280.sendDisabled === true
    && at280.laterHidden === false
    && at280.statusBox?.inside === true
    && removed.refHidden === true
    && removed.selectionEdit === false
    && removed.composerH === 197
    && removed.refImageHidden === false
    && removed.laterHidden === true
    && reselected.refHidden === false
    && reselected.selectionEdit === true
    && reselected.name === stem
    && generationAfter === generationBefore
    && sendStillIdle === true
    && reopened.replaced === true
    && reopened.id === saved.id
    && JSON.stringify(reopened.positions) === JSON.stringify(saved.positions)
    && shotWorkspace?.bytes > 0
    && at406.refMeaning === 'Selected on canvas'
    && at280.refMeaning === 'Selected on canvas'
    && at406.refRadius === '8px'
    && at280.refRadius === '8px'
    && at406.refBg === 'rgb(247, 247, 247)'
    && at280.refBg === 'rgb(247, 247, 247)'
    && at406.refShadow === 'none'
    && at406.refH === 56
    && at280.refH === 56
    && reload.failedList === true
    && reload.afterDropPosts === reload.beforePosts + 1
    && reload.afterReloadPosts === reload.afterDropPosts
    && reload.prompt?.title === 'Imported, but the canvas did not refresh'
    && reload.prompt?.primary === 'Reload'
    && reload.prompt?.status === 'Imported, but the canvas did not refresh. Reload does not import again.'
    && reload.status280?.h > 18
    && reload.status280?.inside === true
    && reload.recovered?.position?.x === Math.trunc(reload.plan.expected.x)
    && reload.recovered?.position?.y === Math.trunc(reload.plan.expected.y)
    && reload.shots?.shotDialog?.bytes > 0
  const result = {
    generatedAt: new Date().toISOString(),
    scope: 'canvas-first-fix1',
    passed,
    dropPlan,
    placed,
    removed,
    reselected,
    generationBefore,
    generationAfter,
    saved,
    reopened,
    reload,
    at406,
    at280,
    shots: { shotWorkspace, shot406, shot406Detail, shot280, shot280Detail },
  }
  await writeFile(path.join(EVIDENCE_DIR, 'canvas-first-column.json'), `${JSON.stringify(result, null, 2)}\n`)
  console.log(JSON.stringify({ passed, report: path.join(EVIDENCE_DIR, 'canvas-first-column.json'), at406: { w: at406.left?.w, ellipsis: at406.nameEllipsis, remove: at406.remove?.inside, send: at406.send?.inside }, at280: { w: at280.left?.w, ellipsis: at280.nameEllipsis, remove: at280.remove?.inside, send: at280.send?.inside, wrapped: at280.laterWrapped } }))
  if (!passed) process.exitCode = 1
}

async function main() {
  const repoRoot = process.cwd()
  const serverPort = await freePort()
  const debugPort = await freePort()
  const profileDir = `/private/tmp/gametool-vis02-chrome-${process.pid}`
  const workspaceRoot = await mkdtemp(path.join(repoRoot, '.tmp-p2-04-canvas-binding-ws-'))
  const children = []
  let client = null
  const network = { requests: [], responses: [], failed: [] }
  const consoleLog = { entries: [], exceptions: [] }
  let seedStatus = null
  let projectFlow = null

  try {
    const server = spawn(process.execPath, ['server.js'], {
      cwd: repoRoot,
      env: {
        ...process.env,
        PORT: String(serverPort),
        EDITOR_WORKSPACE_ROOT: workspaceRoot,
        OPENROUTER_API_KEY: '',
        GEMINI_API_KEY: '',
        GOOGLE_API_KEY: '',
        CHARACTER_IMAGE_API_KEY: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    children.push(server)
    const serverReadyLine = (await waitForServer(server, 15_000)).trim().split('\n').pop()
    const origin = `http://127.0.0.1:${serverPort}`
    seedStatus = await seedIsolatedProjects(origin)
    const defaultEntry = await probeDefaultEntry(origin)

    const chrome = spawn(CHROME_PATH, [
      '--headless=new',
      `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
      '--force-device-scale-factor=1',
      '--hide-scrollbars',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-default-apps',
      '--disable-extensions',
      '--disable-gpu',
      '--disable-sync',
      '--no-first-run',
      `--remote-debugging-port=${debugPort}`,
      '--remote-allow-origins=*',
      `--user-data-dir=${profileDir}`,
      'about:blank',
    ], { stdio: ['ignore', 'pipe', 'pipe'] })
    children.push(chrome)

    const version = await waitForChrome(debugPort, chrome, 10_000)
    client = new CdpClient(version.webSocketDebuggerUrl)
    await client.connect()
    const { targetId } = await client.send('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true })
    const fileChooserEvents = []
    client.on((event) => {
      if (event.method === 'Page.fileChooserOpened') {
        fileChooserEvents.push({
          mode: event.params?.mode || '',
          backendNodeId: event.params?.backendNodeId || 0,
        })
        return
      }
      if (event.sessionId !== sessionId) return
      if (event.method === 'Network.requestWillBeSent') {
        network.requests.push({ url: event.params.request.url, type: event.params.type, method: event.params.request.method })
      } else if (event.method === 'Network.responseReceived') {
        network.responses.push({ url: event.params.response.url, status: event.params.response.status, mimeType: event.params.response.mimeType, type: event.params.type })
      } else if (event.method === 'Network.loadingFailed') {
        network.failed.push({ requestId: event.params.requestId, error: event.params.errorText })
      } else if (event.method === 'Log.entryAdded') {
        consoleLog.entries.push({ source: event.params.entry.source, level: event.params.entry.level, text: event.params.entry.text, url: event.params.entry.url })
      } else if (event.method === 'Runtime.consoleAPICalled') {
        consoleLog.entries.push({ source: 'console', level: event.params.type, text: event.params.args.map((arg) => arg.value ?? arg.description ?? '').join(' ') })
      } else if (event.method === 'Runtime.exceptionThrown') {
        consoleLog.exceptions.push(event.params.exceptionDetails.exception?.description || event.params.exceptionDetails.text)
      }
    })
    let pageEnable = { params: { enableFileChooserOpenedEvent: true }, ok: false, error: '' }
    try {
      await client.send('Page.enable', { enableFileChooserOpenedEvent: true }, sessionId)
      pageEnable.ok = true
    } catch (error) {
      pageEnable.error = error.message
      await client.send('Page.enable', {}, sessionId)
    }
    await client.send('Runtime.enable', {}, sessionId)
    await client.send('Log.enable', {}, sessionId)
    await client.send('Network.enable', {}, sessionId)
    await client.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `(() => {
        window.__vnextNetworkCalls = { fetch: 0, xhr: 0 }
        const originalFetch = window.fetch
        window.fetch = function (...args) { window.__vnextNetworkCalls.fetch += 1; return originalFetch.apply(this, args) }
        const originalOpen = XMLHttpRequest.prototype.open
        XMLHttpRequest.prototype.open = function (...args) { window.__vnextNetworkCalls.xhr += 1; return originalOpen.apply(this, args) }
      })()`,
    }, sessionId)
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: VIEWPORT.width,
      height: VIEWPORT.height,
      deviceScaleFactor: 1,
      mobile: false,
      screenWidth: VIEWPORT.width,
      screenHeight: VIEWPORT.height,
    }, sessionId)

    const previewUrl = `${origin}${PREVIEW_PATH}`
    await client.send('Page.navigate', { url: previewUrl }, sessionId)
    await waitUntil(client, sessionId, 'document.readyState === "complete"', 5_000)
    await evaluate(client, sessionId, 'document.fonts.ready.then(() => true)')
    await waitUntil(client, sessionId, 'document.querySelectorAll(".vnext-cel").length === 36', 5_000)
    await waitUntil(client, sessionId, '[...document.images].every((img) => img.complete)', 5_000)
    await delay(150)

    await mkdir(EVIDENCE_DIR, { recursive: true })
    if (process.argv.includes('--composer-contour-only')) {
      await captureComposerContour(client, sessionId)
      return
    }
    if (process.argv.includes('--canvas-first-only')) {
      await captureCanvasFirstColumn(client, sessionId, network)
      return
    }
    const shots = {}
    const metrics = await evaluate(client, sessionId, METRICS_EXPRESSION)
    const paletteResize = await capturePaletteResize(client, sessionId)
    if (process.argv.includes('--palette-only')) {
      const passed = paletteResize.every((state) => state.passed)
      const result = { generatedAt: new Date().toISOString(), previewUrl, viewport: VIEWPORT, isolatedWorkspace: workspaceRoot, paletteResize, passed, consoleLog }
      await writeFile(path.join(EVIDENCE_DIR, 'palette-resize.json'), `${JSON.stringify(result, null, 2)}\n`)
      console.log(JSON.stringify({ passed, widths: paletteResize.map((s) => ({ pane: s.pane.w, swatch: s.swatch.w, ring: s.ring.w })), report: path.join(EVIDENCE_DIR, 'palette-resize.json') }))
      if (!passed) process.exitCode = 1
      return
    }
    // Which platform fonts Chrome actually used (Inter Regular/Medium are the design fonts).
    await client.send('DOM.enable', {}, sessionId)
    await client.send('CSS.enable', {}, sessionId)
    const { root: domRoot } = await client.send('DOM.getDocument', { depth: 0 }, sessionId)
    const FONT_PROBES = {
      prompt14Regular: ['.vnext-pop-title', 'Inter-Regular'],
      skillLabel12Regular: ['.vnext-skill-tag-label', 'Inter-Regular'],
      previewTitle12Medium: ['.vnext-preview-title', 'Inter-Medium'],
      colorHead12Medium: ['.vnext-color-head span', 'Inter-Medium'],
      frameIndex10Regular: ['.vnext-frame-index', 'Inter-Regular'],
      playPosition11Regular: ['.vnext-play-total', 'Inter-Regular'],
      banner11Regular: ['.vnext-preview-banner', 'Inter-Regular'],
    }
    metrics.platformFonts = {}
    for (const [key, [selector, expectedPostScriptName]] of Object.entries(FONT_PROBES)) {
      const { nodeId } = await client.send('DOM.querySelector', { nodeId: domRoot.nodeId, selector }, sessionId)
      const rendered = Number(nodeId) > 0 && await evaluate(client, sessionId, `(() => {
        const node = document.querySelector(${JSON.stringify(selector)})
        const rect = node?.getBoundingClientRect()
        return Boolean(node && rect && rect.width > 0 && rect.height > 0 && getComputedStyle(node).display !== 'none' && String(node.textContent || '').trim())
      })()`)
      const { fonts } = rendered
        ? await client.send('CSS.getPlatformFontsForNode', { nodeId }, sessionId)
        : { fonts: [] }
      metrics.platformFonts[key] = { expectedPostScriptName, rendered, fonts: fonts.map((font) => ({ familyName: font.familyName, postScriptName: font.postScriptName, isCustomFont: font.isCustomFont, glyphCount: font.glyphCount })) }
    }
    const { nodeId: fileNodeId } = await client.send('DOM.querySelector', {
      nodeId: domRoot.nodeId,
      selector: '#vnext-ref-input',
    }, sessionId)
    const { node: fileNode } = await client.send('DOM.describeNode', { nodeId: fileNodeId }, sessionId)
    shots.default = await screenshot(client, sessionId, path.join(EVIDENCE_DIR, SHOTS.default))
    shots.skillPop = await screenshot(client, sessionId, path.join(EVIDENCE_DIR, SHOTS.skillPop), {
      x: Math.max(0, metrics.skillPop.x - 8),
      y: Math.max(0, metrics.skillPop.y - 8),
      width: metrics.skillPop.w + 16,
      height: metrics.skillPop.h + 16,
    })

    await client.send('Page.bringToFront', {}, sessionId)
    await client.send('Emulation.setFocusEmulationEnabled', { enabled: true }, sessionId)
    await evaluate(client, sessionId, `(() => {
      document.activeElement && document.activeElement.blur()
      window.__vnextFileClicks = 0
      const input = document.querySelector('#vnext-ref-input')
      const original = HTMLInputElement.prototype.click
      input.click = function clickSpy(...args) {
        window.__vnextFileClicks += 1
        return original.apply(this, args)
      }
      return true
    })()`)
    const { state: keyboardFileState } = await tabUntil(client, sessionId, (state) => state.activeId === 'vnext-ref-input' && state.activeType === 'file')
    let keyboardNativePicker = {
      tabReached: true,
      interceptEnabled: false,
      pageEnable,
      enterOpened: false,
      spaceOpened: false,
      enterMode: '',
      spaceMode: '',
      afterEnterFilled: false,
      afterSpaceFilled: false,
      verified: false,
      unverifiedReason: 'Headless path does not send Enter/Space on the file input. Headed probe runs after this session.',
    }
    shots.refKeyboard = await screenshot(client, sessionId, path.join(EVIDENCE_DIR, SHOTS.refKeyboard), {
      x: Math.max(0, metrics.composer.x - 8),
      y: Math.max(0, metrics.composer.y - 8),
      width: metrics.composer.w + 16,
      height: metrics.composer.h + 16,
    })

    const fixtureDir = `/private/tmp/gametool-vis02-input-${process.pid}`
    await mkdir(fixtureDir, { recursive: true })
    const validPng = path.join(fixtureDir, 'vis02-ok.png')
    const replacePng = path.join(fixtureDir, 'vis02-replace.png')
    const illegalTxt = path.join(fixtureDir, 'vis02-notes.txt')
    const oversizedJpg = path.join(fixtureDir, 'vis02-huge.jpg')
    const corruptPng = path.join(fixtureDir, 'vis02-bad.png')
    await writeFile(validPng, Buffer.from(
      '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082',
      'hex',
    ))
    await writeFile(replacePng, Buffer.from(
      '89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c49444154789c6360f8cfffffc0070005fe02fe14d8cfdc0000000049454e44ae426082',
      'hex',
    ))
    await writeFile(illegalTxt, 'not an image\n')
    await writeFile(oversizedJpg, Buffer.alloc(2 * 1024 * 1024 + 1, 0xff))
    await writeFile(corruptPng, Buffer.from(
      '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489' + '00'.repeat(48),
      'hex',
    ))
    const importPng = path.join(fixtureDir, 'p2-04-import.png')
    const importPngB = path.join(fixtureDir, 'p2-04-import-b.png')
    const importBytes = encodeVisibleImportPng()
    await writeFile(importPng, importBytes)
    await writeFile(importPngB, importBytes)

    async function attachImportPng(filePath) {
      const { root } = await client.send('DOM.getDocument', { depth: 0 }, sessionId)
      const { nodeId } = await client.send('DOM.querySelector', {
        nodeId: root.nodeId,
        selector: '#vnext-import-input',
      }, sessionId)
      const { node } = await client.send('DOM.describeNode', { nodeId }, sessionId)
      await client.send('DOM.setFileInputFiles', { files: [filePath], backendNodeId: node.backendNodeId }, sessionId)
    }

    const promptState = await evaluate(client, sessionId, `(() => {
      const input = document.querySelector('#vnext-prompt-input')
      input.value = 'first line\\nsecond line'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      return { value: input.value, disabled: input.disabled === true, rows: input.rows }
    })()`)
    await waitUntil(client, sessionId, `document.querySelector('#vnext-prompt-input')?.value === 'first line\\nsecond line'`, 2_000)
    const promptMetrics = await evaluate(client, sessionId, METRICS_EXPRESSION)
    shots.prompt = await screenshot(client, sessionId, path.join(EVIDENCE_DIR, SHOTS.prompt))

    await client.send('DOM.setFileInputFiles', {
      files: [validPng],
      backendNodeId: fileNode.backendNodeId,
    }, sessionId)
    await waitUntil(client, sessionId, `(() => {
      const img = document.querySelector('#vnext-ref-preview')
      return document.querySelector('#vnext-ref-name')?.textContent === 'vis02-ok.png'
        && img?.complete === true && img.naturalWidth > 0 && img.naturalHeight > 0
    })()`, 3_000)
    const refValidState = await evaluate(client, sessionId, REF_STATE_EXPRESSION)
    shots.refValid = await screenshot(client, sessionId, path.join(EVIDENCE_DIR, SHOTS.refValid))

    await client.send('DOM.setFileInputFiles', {
      files: [],
      backendNodeId: fileNode.backendNodeId,
    }, sessionId)
    await evaluate(client, sessionId, `document.querySelector('#vnext-ref-input').dispatchEvent(new Event('change', { bubbles: true })); true`)
    const refCancelState = await evaluate(client, sessionId, REF_STATE_EXPRESSION)

    await client.send('DOM.setFileInputFiles', {
      files: [illegalTxt],
      backendNodeId: fileNode.backendNodeId,
    }, sessionId)
    await waitUntil(client, sessionId, `document.querySelector('#vnext-ref-error')?.textContent.includes('PNG, WebP, or JPEG')`, 3_000)
    const refIllegalState = await evaluate(client, sessionId, REF_STATE_EXPRESSION)
    shots.refIllegal = await screenshot(client, sessionId, path.join(EVIDENCE_DIR, SHOTS.refIllegal))

    await client.send('DOM.setFileInputFiles', {
      files: [oversizedJpg],
      backendNodeId: fileNode.backendNodeId,
    }, sessionId)
    await waitUntil(client, sessionId, `document.querySelector('#vnext-ref-error')?.textContent.includes('2 MiB')`, 3_000)
    const refOversizedState = await evaluate(client, sessionId, REF_STATE_EXPRESSION)

    await client.send('DOM.setFileInputFiles', {
      files: [corruptPng],
      backendNodeId: fileNode.backendNodeId,
    }, sessionId)
    await waitUntil(client, sessionId, `(() => {
      const img = document.querySelector('#vnext-ref-preview')
      return document.querySelector('#vnext-ref-name')?.textContent === 'vis02-ok.png'
        && document.querySelector('#vnext-ref-error')?.textContent.includes('decode')
        && img?.complete === true && img.naturalWidth > 0
    })()`, 3_000)
    const refCorruptState = await evaluate(client, sessionId, REF_STATE_EXPRESSION)
    shots.refCorrupt = await screenshot(client, sessionId, path.join(EVIDENCE_DIR, SHOTS.refCorrupt))

    await client.send('DOM.setFileInputFiles', {
      files: [replacePng],
      backendNodeId: fileNode.backendNodeId,
    }, sessionId)
    await waitUntil(client, sessionId, `(() => {
      const img = document.querySelector('#vnext-ref-preview')
      return document.querySelector('#vnext-ref-name')?.textContent === 'vis02-replace.png'
        && document.querySelector('#vnext-ref-error')?.textContent === ''
        && img?.complete === true && img.naturalWidth > 0
    })()`, 3_000)
    const refReplaceState = await evaluate(client, sessionId, REF_STATE_EXPRESSION)

    await evaluate(client, sessionId, `window.__vnextFileClicks = 0; document.activeElement && document.activeElement.blur(); true`)
    await tabUntil(client, sessionId, (state) => state.activeId === 'vnext-ref-input')
    const { state: keyboardClearState } = await tabUntil(client, sessionId, (state) => String(state.activeClass).includes('vnext-ref-clear'))
    const chooserBeforeClearEnter = fileChooserEvents.length
    await pressKey(client, sessionId, 'Enter')
    const clearEnterChooser = await waitForNextFileChooser(fileChooserEvents, chooserBeforeClearEnter, 400)
    await waitUntil(client, sessionId, `document.querySelector('.vnext-ref-image')?.classList.contains('is-filled') === false`, 3_000)
    const refClearedState = await evaluate(client, sessionId, REF_STATE_EXPRESSION)
    shots.refCleared = await screenshot(client, sessionId, path.join(EVIDENCE_DIR, SHOTS.refCleared))

    await client.send('DOM.setFileInputFiles', {
      files: [validPng],
      backendNodeId: fileNode.backendNodeId,
    }, sessionId)
    await waitUntil(client, sessionId, `(() => {
      const img = document.querySelector('#vnext-ref-preview')
      return document.querySelector('#vnext-ref-name')?.textContent === 'vis02-ok.png'
        && img?.complete === true && img.naturalWidth > 0
    })()`, 3_000)
    await evaluate(client, sessionId, `window.__vnextFileClicks = 0; document.activeElement && document.activeElement.blur(); true`)
    await tabUntil(client, sessionId, (state) => state.activeId === 'vnext-ref-input')
    await tabUntil(client, sessionId, (state) => String(state.activeClass).includes('vnext-ref-clear'))
    const chooserBeforeClearSpace = fileChooserEvents.length
    await pressKey(client, sessionId, ' ')
    const clearSpaceChooser = await waitForNextFileChooser(fileChooserEvents, chooserBeforeClearSpace, 400)
    await waitUntil(client, sessionId, `document.querySelector('.vnext-ref-image')?.classList.contains('is-filled') === false`, 3_000)
    const refClearedBySpaceState = await evaluate(client, sessionId, REF_STATE_EXPRESSION)
    const keyboardClearChooser = {
      enterOpenedPicker: Boolean(clearEnterChooser),
      spaceOpenedPicker: Boolean(clearSpaceChooser),
      enterFileClicks: refClearedState.fileClicks,
      spaceFileClicks: refClearedBySpaceState.fileClicks,
    }

    const escapeState = await evaluate(client, sessionId, `(() => {
      const skill = document.querySelector('.vnext-skill-pop')
      const open = skill.hidden === false
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      const afterEscape = skill.hidden === true
      document.querySelector('[data-figma="I1824:5723;1819:5367"]').click()
      return { wasOpen: open, closedByEscape: afterEscape, reopened: skill.hidden === false }
    })()`)
    const openSkillMetrics = await evaluate(client, sessionId, `(() => {
      const rect = (selector) => { const node = document.querySelector(selector); const r = node?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : { x: 0, y: 0, w: 0, h: 0 } }
      return { pop: rect('.vnext-skill-pop'), tag: rect('.vnext-skill-tag') }
    })()`)
    metrics.skillPop = openSkillMetrics.pop
    metrics.skillTag = openSkillMetrics.tag
    shots.skillPop = await screenshot(client, sessionId, path.join(EVIDENCE_DIR, SHOTS.skillPop), {
      x: Math.max(0, metrics.skillPop.x - 8),
      y: Math.max(0, metrics.skillPop.y - 8),
      width: metrics.skillPop.w + 16,
      height: metrics.skillPop.h + 16,
    })
    await evaluate(client, sessionId, `(() => {
      const item = document.querySelector('.vnext-skill-item[data-skill-id]')
      item?.click()
      return Boolean(item)
    })()`)
    metrics.skillTag = await evaluate(client, sessionId, `(() => {
      const r = document.querySelector('.vnext-skill-tag')?.getBoundingClientRect()
      return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : { x: 0, y: 0, w: 0, h: 0 }
    })()`)

    // Skill tag hover state (1791:5214): move the pointer onto the tag.
    const tag = metrics.skillTag
    await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: tag.x + tag.w / 2, y: tag.y + tag.h / 2 }, sessionId)
    await delay(120)
    const hoverState = await evaluate(client, sessionId, `(() => {
      const tag = document.querySelector('.vnext-skill-tag')
      const clear = document.querySelector('.vnext-skill-tag-clear')
      const tooltip = document.querySelector('.vnext-skill-tooltip')
      const rect = (node) => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } }
      return {
        hovering: tag.matches(':hover'),
        background: getComputedStyle(tag).backgroundColor,
        clearVisible: getComputedStyle(clear).display !== 'none',
        tooltipVisible: getComputedStyle(tooltip).display !== 'none',
        tooltip: rect(tooltip),
        tooltipText: tooltip.textContent,
      }
    })()`)
    shots.skillHover = await screenshot(client, sessionId, path.join(EVIDENCE_DIR, SHOTS.skillHover), { x: 0, y: 820, width: 406, height: 260 })
    await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 900, y: 300 }, sessionId)
    await delay(80)

    // Skill tag keyboard focus (1791:5219) via native Tab after the file input.
    await evaluate(client, sessionId, `document.activeElement && document.activeElement.blur(); true`)
    await tabUntil(client, sessionId, (state) => state.activeId === 'vnext-ref-input')
    await tabUntil(client, sessionId, (state) => String(state.activeClass).includes('vnext-skill-tag-action'))
    const focusState = await evaluate(client, sessionId, `(() => {
      const action = document.querySelector('.vnext-skill-tag-action')
      const tag = document.querySelector('.vnext-skill-tag')
      const tooltip = document.querySelector('.vnext-skill-tooltip')
      const after = getComputedStyle(tag, '::after')
      return {
        activeIsClearAction: document.activeElement === action,
        usedScriptFocus: false,
        activeId: document.activeElement?.id || '',
        activeClass: typeof document.activeElement?.className === 'string' ? document.activeElement.className : '',
        focusVisible: action.matches(':focus') || action.matches(':focus-visible'),
        background: getComputedStyle(tag).backgroundColor,
        ring: { width: after.width, height: after.height, border: after.borderTopWidth + ' ' + after.borderTopColor, radius: after.borderTopLeftRadius, left: after.left, top: after.top },
        tooltipVisible: getComputedStyle(tooltip).display !== 'none',
      }
    })()`)
    await delay(120)
    shots.skillFocus = await screenshot(client, sessionId, path.join(EVIDENCE_DIR, SHOTS.skillFocus), { x: 0, y: 820, width: 406, height: 260 })
    await evaluate(client, sessionId, `document.activeElement && document.activeElement.blur(); true`)

    // Layer actions (1707:5179) and Onion skin settings (1707:5185) opened together.
    const overlayState = await evaluate(client, sessionId, `(() => {
      document.querySelector('[data-vnext-toggle="layers"]').click()
      document.querySelector('[data-vnext-toggle="onion"]').click()
      const rect = (selector) => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } }
      return {
        layersOpen: document.querySelector('.vnext-layers-pop').hidden === false,
        onionOpen: document.querySelector('.vnext-onion-pop').hidden === false,
        layersPop: rect('.vnext-layers-pop'),
        onionPop: rect('.vnext-onion-pop'),
        layersExpanded: document.querySelector('[data-vnext-toggle="layers"]').getAttribute('aria-expanded'),
        onionExpanded: document.querySelector('[data-vnext-toggle="onion"]').getAttribute('aria-expanded'),
      }
    })()`)
    await delay(100)
    shots.layersOnion = await screenshot(client, sessionId, path.join(EVIDENCE_DIR, SHOTS.layersOnion))
    await evaluate(client, sessionId, `(() => {
      document.querySelector('[data-vnext-toggle="layers"]').click()
      document.querySelector('[data-vnext-toggle="onion"]').click()
      return true
    })()`)

    // Preview collapsed state (header only; the design draws the open variant only).
    const collapsedState = await evaluate(client, sessionId, `(() => {
      document.querySelector('[data-vnext-toggle="preview-collapse"]').click()
      const r = document.querySelector('.vnext-preview').getBoundingClientRect()
      return { collapsed: document.querySelector('.vnext-preview').classList.contains('is-collapsed'), preview: { x: r.x, y: r.y, w: r.width, h: r.height }, bodyHidden: getComputedStyle(document.querySelector('.vnext-preview-body')).display === 'none' }
    })()`)
    await delay(100)
    shots.previewCollapsed = await screenshot(client, sessionId, path.join(EVIDENCE_DIR, SHOTS.previewCollapsed), { x: 1180, y: 530, width: 426, height: 340 })
    await evaluate(client, sessionId, 'document.querySelector(\'[data-vnext-toggle="preview-collapse"]\').click(); true')

    // Timeline layer rows with the Skill popover closed (the design keeps it open, covering them).
    const skillClosedState = await evaluate(client, sessionId, `(() => {
      const pop = document.querySelector('.vnext-skill-pop')
      return {
        skillOpen: pop.hidden === false,
        skillDisplay: getComputedStyle(pop).display,
        puzzleExpanded: document.querySelector('[data-figma="I1824:5723;1819:5367"]').getAttribute('aria-expanded'),
      }
    })()`)
    await delay(100)
    shots.timelineUncovered = await screenshot(client, sessionId, path.join(EVIDENCE_DIR, SHOTS.timelineUncovered), { x: 406, y: 890, width: 1200, height: 190 })
    shots.timelineLayers = await screenshot(client, sessionId, path.join(EVIDENCE_DIR, SHOTS.timelineLayers), {
      x: Math.max(0, metrics.layerCol.x - 4),
      y: Math.max(0, metrics.layerCol.y - 4),
      width: metrics.layerCol.w + 8,
      height: metrics.layerCol.h + 8,
    })

    // Preview close (tv button) hides the panel; a second click restores it.
    const previewClosedState = await evaluate(client, sessionId, `(() => {
      const tv = document.querySelector('[data-figma="1820:5408"]')
      const preview = document.querySelector('.vnext-preview')
      tv.click()
      const closed = { hidden: preview.hidden, display: getComputedStyle(preview).display, tvExpanded: tv.getAttribute('aria-expanded') }
      tv.click()
      const reopened = { hidden: preview.hidden, display: getComputedStyle(preview).display, tvExpanded: tv.getAttribute('aria-expanded') }
      return { closed, reopened }
    })()`)

    // Disabled controls must stay disabled after clicks; measure page-level network calls.
    const clickState = await evaluate(client, sessionId, `(() => {
      const send = document.querySelector('.vnext-send')
      document.querySelector('.vnext-send').click()
      document.querySelector('[data-capability="HOME-04"]').click()
      document.querySelector('[data-figma="I1824:5723;1819:5346"]').click()
      return {
        sendWasDisabled: send.disabled === true,
        sendStillDisabled: document.querySelector('.vnext-send').disabled === true,
        videoStillDisabled: document.querySelector('[data-capability="HOME-04"]').disabled === true,
        pageNetworkCalls: window.__vnextNetworkCalls,
      }
    })()`)
    await delay(200)

    projectFlow = { steps: [] }
    await evaluate(client, sessionId, `document.querySelector('#vnext-project-btn').click(); true`)
    projectFlow.menuOpen = await evaluate(client, sessionId, `document.querySelector('#vnext-project-menu')?.hidden === false`)
    shots.projectMenu = await screenshot(client, sessionId, path.join(EVIDENCE_DIR, SHOTS.projectMenu))
    await evaluate(client, sessionId, `document.querySelector('[data-project-action="open"]').click(); true`)
    await waitUntil(client, sessionId, `document.querySelector('#vnext-open-dialog')?.hidden === false`, 5_000)
    await waitUntil(client, sessionId, `document.querySelectorAll('#vnext-list-rows [data-project-id]').length >= 1`, 5_000)
    projectFlow.listChrome = await evaluate(client, sessionId, `(() => {
      const dialog = document.querySelector('.vnext-dialog.is-list')
      const title = document.querySelector('.vnext-dialog.is-list .vnext-dialog-title')
      const search = document.querySelector('.vnext-list-search')
      const btn = document.querySelector('#vnext-open-confirm') || document.querySelector('.vnext-dialog.is-list .vnext-dialog-foot .vnext-dialog-btn')
      const cs = dialog ? getComputedStyle(dialog) : null
      const ts = title ? getComputedStyle(title) : null
      const ss = search ? getComputedStyle(search) : null
      const bs = btn ? getComputedStyle(btn) : null
      return {
        width: dialog ? Math.round(dialog.getBoundingClientRect().width) : 0,
        padding: cs?.padding || '',
        titleSize: ts?.fontSize || '',
        titleWeight: ts?.fontWeight || '',
        searchRadius: ss?.borderRadius || '',
        searchSvg: search ? search.querySelectorAll('svg').length : -1,
        btnHeight: btn ? Math.round(btn.getBoundingClientRect().height) : 0,
        btnRadius: bs?.borderRadius || '',
      }
    })()`)
    await evaluate(client, sessionId, `(() => {
      const session = window.getVnextProjectSession?.()
      if (!session) return false
      session.list.status = 'loading'
      window.__vnextRenderList?.()
      return true
    })()`)
    projectFlow.listLoading = await evaluate(client, sessionId, `document.querySelector('#vnext-list-status')?.textContent || ''`)
    shots.projectListLoading = await screenshot(client, sessionId, path.join(EVIDENCE_DIR, SHOTS.projectListLoading))
    await evaluate(client, sessionId, `(() => {
      const session = window.getVnextProjectSession?.()
      session.list.status = 'error'
      session.list.error = { message: 'Projects could not be loaded.' }
      window.__vnextRenderList?.()
      return true
    })()`)
    projectFlow.listError = await evaluate(client, sessionId, `document.querySelector('#vnext-list-status')?.textContent || ''`)
    shots.projectListError = await screenshot(client, sessionId, path.join(EVIDENCE_DIR, SHOTS.projectListError))
    await evaluate(client, sessionId, `(() => {
      const session = window.getVnextProjectSession?.()
      session.list.status = 'ready'
      session.list.projects = []
      session.list.omitted_count = 4
      session.list.selectedId = null
      session.list.error = null
      window.__vnextRenderList?.()
      return true
    })()`)
    projectFlow.listUnread = await evaluate(client, sessionId, `document.querySelector('#vnext-list-status')?.textContent || ''`)
    shots.projectListUnread = await screenshot(client, sessionId, path.join(EVIDENCE_DIR, SHOTS.projectListUnread))
    try {
      await mkdir(path.join(workspaceRoot, 'projects', 'punread1'), { recursive: true })
      await writeFile(path.join(workspaceRoot, 'projects', 'punread1', 'project.json'), '{not-json')
      await evaluate(client, sessionId, `document.querySelector('[data-project-action="refresh"]')?.click(); true`)
      await waitUntil(client, sessionId, `document.querySelectorAll('#vnext-list-rows [data-project-id]').length >= 1`, 5_000)
      projectFlow.listOmitted = await evaluate(client, sessionId, `(() => {
        const warning = document.querySelector('#vnext-list-warning')
        const icon = warning?.querySelector('.vnext-icon')
        const refresh = warning?.querySelector('[data-project-action="refresh"]')
        const search = document.querySelector('.vnext-list-search')
        const rs = refresh ? getComputedStyle(refresh) : null
        return {
          warning: warning?.hidden === false,
          title: document.querySelector('#vnext-list-warning-title')?.textContent || '',
          status: document.querySelector('#vnext-list-status')?.textContent || '',
          searchSvg: search ? search.querySelectorAll('svg').length : -1,
          iconW: icon ? Math.round(icon.getBoundingClientRect().width) : 0,
          refreshBg: rs?.backgroundColor || '',
        }
      })()`)
    } catch (error) {
      projectFlow.listOmitted = { warning: false, error: error.message }
      await evaluate(client, sessionId, `document.querySelector('[data-project-action="refresh"]')?.click(); true`)
      await waitUntil(client, sessionId, `document.querySelectorAll('#vnext-list-rows [data-project-id]').length >= 1`, 5_000)
    }
    shots.projectListOmitted = await screenshot(client, sessionId, path.join(EVIDENCE_DIR, SHOTS.projectListOmitted))
    projectFlow.listChoose = await evaluate(client, sessionId, `(() => ({
      openDisabled: document.querySelector('#vnext-open-confirm')?.disabled === true,
      rows: document.querySelectorAll('#vnext-list-rows [data-project-id]').length,
      selected: document.querySelectorAll('#vnext-list-rows .is-selected').length,
      status: document.querySelector('#vnext-list-status')?.textContent || '',
    }))()`)
    shots.projectListChoose = await screenshot(client, sessionId, path.join(EVIDENCE_DIR, SHOTS.projectListChoose))
    await evaluate(client, sessionId, `document.querySelector('#vnext-list-rows [data-project-id="village_03"]')?.click(); true`)
    projectFlow.listSelected = await evaluate(client, sessionId, `(() => {
      const row = document.querySelector('#vnext-list-rows .is-selected')
      const list = document.querySelector('#vnext-list-rows')
      row?.scrollIntoView({ block: 'center', inline: 'nearest' })
      const rowBox = row?.getBoundingClientRect()
      const listBox = list?.getBoundingClientRect()
      return {
        openDisabled: document.querySelector('#vnext-open-confirm')?.disabled === true,
        selectedId: row?.dataset.projectId || '',
        fullyVisible: Boolean(
          rowBox
          && listBox
          && rowBox.top >= listBox.top - 1
          && rowBox.bottom <= listBox.bottom + 1
        ),
      }
    })()`)
    shots.projectListSelected = await screenshot(client, sessionId, path.join(EVIDENCE_DIR, SHOTS.projectListSelected))
    await evaluate(client, sessionId, `(() => {
      const input = document.querySelector('#vnext-project-search')
      input.value = 'castle'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()`)
    projectFlow.noMatch = await evaluate(client, sessionId, `document.querySelector('#vnext-list-status')?.textContent || ''`)
    shots.projectListNoMatch = await screenshot(client, sessionId, path.join(EVIDENCE_DIR, SHOTS.projectListNoMatch))
    await evaluate(client, sessionId, `document.querySelector('[data-project-action="clear-search"]')?.click(); true`)
    await evaluate(client, sessionId, `document.querySelector('#vnext-list-rows [data-project-id]')?.click(); true`)
    const longId = await evaluate(client, sessionId, `([...document.querySelectorAll('#vnext-list-rows [data-project-id]')].find((row) => (row.querySelector('.vnext-list-row-name')?.textContent || '').length > 40)?.dataset.projectId) || ''`)
    if (longId) {
      await evaluate(client, sessionId, `document.querySelector('#vnext-list-rows [data-project-id="${longId}"]')?.click(); true`)
    }
    shots.projectListLong = await screenshot(client, sessionId, path.join(EVIDENCE_DIR, SHOTS.projectListLong))
    await evaluate(client, sessionId, `document.querySelector('#vnext-list-rows [data-project-id="village_03"]')?.click(); true`)
    await evaluate(client, sessionId, `document.querySelector('#vnext-open-confirm')?.click(); true`)
    await waitUntil(client, sessionId, `document.querySelector('#vnext-confirm-dialog')?.hidden === false`, 5_000)
    projectFlow.upgradeTitle = await evaluate(client, sessionId, `document.querySelector('#vnext-confirm-title')?.textContent || ''`)
    projectFlow.confirmChrome = await evaluate(client, sessionId, `(() => {
      const dialog = document.querySelector('#vnext-confirm-dialog .vnext-dialog')
      return {
        width: dialog ? Math.round(dialog.getBoundingClientRect().width) : 0,
        isList: dialog?.classList.contains('is-list') === true,
      }
    })()`)
    shots.projectUpgrade = await screenshot(client, sessionId, path.join(EVIDENCE_DIR, SHOTS.projectUpgrade))
    await evaluate(client, sessionId, `document.querySelector('#vnext-confirm-primary')?.click(); true`)
    await waitUntil(client, sessionId, `document.querySelector('#vnext-confirm-dialog')?.hidden === true && document.querySelector('#vnext-import-input')?.disabled === false && document.querySelector('#vnext-project-name')?.textContent === 'Village archive'`, 8_000)
    projectFlow.upgraded = await evaluate(client, sessionId, `(() => {
      const session = window.getVnextProjectSession?.()
      return {
        name: document.querySelector('#vnext-project-name')?.textContent || '',
        id: session?.project?.id || '',
        tiles: document.querySelectorAll('.vnext-canvas-tile').length,
        originalUnchanged: session?.project?.id !== 'village_03',
      }
    })()`)
    projectFlow.openedName = projectFlow.upgraded?.name || ''
    projectFlow.openedId = projectFlow.upgraded?.id || ''
    projectFlow.emptyTimeline = await evaluate(client, sessionId, `(() => ({
      current: document.querySelector('.vnext-play-current')?.textContent || '',
      total: document.querySelector('.vnext-play-total')?.textContent || '',
      fps: document.querySelector('.vnext-playback-params-start .vnext-text-btn span')?.textContent || '',
      frames: document.querySelectorAll('#vnext-frame-cols .vnext-frame-col').length,
    }))()`)
    shots.projectOpen = await screenshot(client, sessionId, path.join(EVIDENCE_DIR, SHOTS.projectOpen))

    await evaluate(client, sessionId, `(() => {
      document.querySelector('#vnext-confirm-secondary')?.click()
      const confirm = document.querySelector('#vnext-confirm-dialog')
      if (confirm) confirm.hidden = true
      document.querySelector('#vnext-project-btn').click()
      document.querySelector('[data-project-action="new"]').click()
      return true
    })()`)
    await waitUntil(client, sessionId, `document.querySelector('#vnext-import-input')?.disabled === false && document.querySelector('#vnext-project-name')?.textContent === 'Untitled Project'`, 5_000)
    await attachImportPng(importPng)
    await waitUntil(client, sessionId, `document.querySelectorAll('.vnext-canvas-tile').length >= 1`, 8_000).catch(async (error) => {
      const state = await evaluate(client, sessionId, `(() => {
        const session = window.getVnextProjectSession?.()
        return {
          name: document.querySelector('#vnext-project-name')?.textContent || '',
          importDisabled: document.querySelector('#vnext-import-input')?.disabled === true,
          toast: document.querySelector('#vnext-project-toast')?.textContent || '',
          tiles: document.querySelectorAll('.vnext-canvas-tile').length,
          confirm: document.querySelector('#vnext-confirm-title')?.textContent || '',
          viewTiles: session?.view?.canvases?.length || 0,
          docs: session?.documents?.size || 0,
          revision: session?.project?.revision || 0,
          lastError: session?.lastError || null,
        }
      })()`)
      throw new Error(`${error.message} ${JSON.stringify(state)}`)
    })
    await attachImportPng(importPngB)
    await waitUntil(client, sessionId, `document.querySelectorAll('.vnext-canvas-tile').length >= 2`, 8_000)
    projectFlow.importedTiles = await evaluate(client, sessionId, `document.querySelectorAll('.vnext-canvas-tile').length`)
    projectFlow.createdId = await evaluate(client, sessionId, `window.getVnextProjectSession?.().project?.id || ''`)
    await evaluate(client, sessionId, `(() => {
      const stage = document.querySelector('#vnext-canvas-stage')
      const box = stage?.getBoundingClientRect()
      window.getVnextProjectSession?.().view.fitAll(box?.width || 800, box?.height || 600)
      window.__vnextRenderProject?.()
      return true
    })()`)
    shots.projectImported = await screenshot(client, sessionId, path.join(EVIDENCE_DIR, SHOTS.projectImported))
    projectFlow.selectedByPointer = await evaluate(client, sessionId, `(() => {
      const tile = document.querySelector('.vnext-canvas-tile')
      const stage = document.querySelector('#vnext-canvas-stage')
      if (!tile || !stage) return false
      const box = tile.getBoundingClientRect()
      stage.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        clientX: box.left + box.width / 2,
        clientY: box.top + box.height / 2,
      }))
      tile.click()
      return tile.classList.contains('is-selected')
    })()`)
    shots.projectSelected = await screenshot(client, sessionId, path.join(EVIDENCE_DIR, SHOTS.projectSelected))
    projectFlow.realTimeline = await evaluate(client, sessionId, `(() => ({
      current: document.querySelector('.vnext-play-current')?.textContent || '',
      total: document.querySelector('.vnext-play-total')?.textContent || '',
      fps: document.querySelector('.vnext-playback-params-start .vnext-text-btn span')?.textContent || '',
      frames: document.querySelectorAll('#vnext-frame-cols .vnext-frame-col').length,
      layers: [...document.querySelectorAll('#vnext-layer-col .vnext-layer-row:not([hidden]) .vnext-layer-name')].map((node) => node.textContent),
    }))()`)
    shots.projectTimeline = await screenshot(client, sessionId, path.join(EVIDENCE_DIR, SHOTS.projectTimeline), {
      x: 406,
      y: 890,
      width: 1200,
      height: 190,
    })
    projectFlow.moved = await evaluate(client, sessionId, `(() => {
      const session = window.getVnextProjectSession?.()
      if (!session) return false
      const ids = session.view.canvases.map((item) => item.id)
      if (ids.length < 2) return false
      session.view.select(ids[0])
      session.view.moveDraft(ids[0], 48, 24)
      session.view.moveDraft(ids[1], 160, 40)
      window.__vnextRenderProject?.()
      return session.view.isDirty()
    })()`)
    await evaluate(client, sessionId, `document.querySelector('#vnext-project-btn').click(); true`)
    projectFlow.saveEnabled = await evaluate(client, sessionId, `document.querySelector('#vnext-save-positions')?.disabled === false`)
    shots.projectDirty = await screenshot(client, sessionId, path.join(EVIDENCE_DIR, SHOTS.projectDirty))
    await evaluate(client, sessionId, `document.querySelector('[data-project-action="save"]')?.click(); true`)
    await waitUntil(client, sessionId, `document.querySelector('#vnext-save-positions')?.textContent === 'Saved' || document.querySelector('#vnext-project-toast')?.textContent === 'Saved'`, 8_000)
    await evaluate(client, sessionId, `document.querySelector('#vnext-project-btn').click(); true`)
    projectFlow.savedLabel = await evaluate(client, sessionId, `document.querySelector('#vnext-save-positions')?.textContent || ''`)
    projectFlow.savedPositions = await evaluate(client, sessionId, `window.getVnextProjectSession?.().view.canvases.map((item) => ({ id: item.id, x: item.x, y: item.y })) || []`)
    projectFlow.savedView = await showCanvasSubject(client, sessionId)
    shots.projectSaved = await screenshot(client, sessionId, path.join(EVIDENCE_DIR, SHOTS.projectSaved))

    const reopenId = projectFlow.createdId
    const savedPosJson = JSON.stringify(projectFlow.savedPositions || [])
    await evaluate(client, sessionId, `window.__vnextReopenPrevProject = window.getVnextProjectSession?.().project`)
    await evaluate(client, sessionId, `document.querySelector('[data-project-action="open"]')?.click(); true`)
    await waitUntil(client, sessionId, `document.querySelector('#vnext-open-dialog')?.hidden === false && Boolean(document.querySelector('#vnext-list-rows [data-project-id="${reopenId}"]'))`, 8_000)
    projectFlow.villageStillListed = await evaluate(client, sessionId, `Boolean(document.querySelector('#vnext-list-rows [data-project-id="village_03"]'))`)
    await evaluate(client, sessionId, `document.querySelector('#vnext-list-rows [data-project-id="${reopenId}"]')?.click(); true`)
    await waitUntil(client, sessionId, `document.querySelector('#vnext-open-confirm')?.disabled === false`, 3_000)
    await evaluate(client, sessionId, `document.querySelector('#vnext-open-confirm')?.click(); true`)
    await waitUntil(client, sessionId, `(() => {
      const session = window.getVnextProjectSession?.()
      const current = session?.project
      if (!current || current === window.__vnextReopenPrevProject) return false
      if (current.id !== ${JSON.stringify(reopenId)}) return false
      const positions = session.view.canvases.map((item) => ({ id: item.id, x: item.x, y: item.y }))
      return JSON.stringify(positions) === ${JSON.stringify(savedPosJson)}
    })()`, 8_000)
    projectFlow.reopened = await evaluate(client, sessionId, `(() => {
      const session = window.getVnextProjectSession?.()
      return {
        id: session?.project?.id || '',
        replaced: session?.project !== window.__vnextReopenPrevProject,
        tiles: document.querySelectorAll('.vnext-canvas-tile').length,
        positions: session?.view.canvases.map((item) => ({ id: item.id, x: item.x, y: item.y })) || [],
        previewCount: session?.view.canvases.filter((item) => item.preview).length,
      }
    })()`)
    projectFlow.reopenView = await showCanvasSubject(client, sessionId)
    shots.projectReopen = await screenshot(client, sessionId, path.join(EVIDENCE_DIR, SHOTS.projectReopen))
    projectFlow.reopenViewAfterShot = await evaluate(client, sessionId, `(() => {
      const session = window.getVnextProjectSession?.()
      return {
        projectId: session?.project?.id || '',
        sameObject: session?.project === window.getVnextProjectSession?.().project,
        zoom: session?.view.zoom,
        positions: session?.view.canvases.map((item) => ({ id: item.id, x: item.x, y: item.y })) || [],
        previewCount: session?.view.canvases.filter((item) => item.preview).length,
      }
    })()`)
    const cancelOpen = await captureProjectRaces(client, sessionId, 'cancel')
    const fix1 = await captureFix1Interactions(client, sessionId)
    const lateOpen = await captureProjectRaces(client, sessionId, 'late')
    const readyStates = await captureReadyStateEvidence(client, sessionId)
    const projectRaces = {
      cancelOpen: {
        cancelKeptA: cancelOpen.cancelKeptA,
        beforeId: cancelOpen.beforeId,
        otherId: cancelOpen.otherId,
        afterCancel: cancelOpen.afterCancel,
      },
      lateOpen: {
        lateSaveOpenB: lateOpen.lateSaveOpenB,
        nextId: lateOpen.nextId,
        during: lateOpen.during,
        opened: lateOpen.opened,
        injected409Url: lateOpen.injected409Url,
      },
    }

    client.close()
    client = null
    if (chrome.exitCode === null) chrome.kill('SIGTERM')
    await delay(400)
    if (chrome.exitCode === null) chrome.kill('SIGKILL')
    await delay(200)
    keyboardNativePicker = {
      ...keyboardNativePicker,
      ...await probeHeadedNativePicker({ origin, validPng, children }),
      tabReached: true,
    }

    const requestSummary = {
      total: network.requests.length,
      external: network.requests.filter((request) => !request.url.startsWith(origin) && !request.url.startsWith('blob:') && !request.url.startsWith('data:')),
      fetchOrXhr: network.requests.filter((request) => request.type === 'Fetch' || request.type === 'XHR'),
      svgRequests: network.requests.filter((request) => request.url.endsWith('.svg')),
      byType: network.requests.reduce((acc, request) => { acc[request.type] = (acc[request.type] ?? 0) + 1; return acc }, {}),
      responses: network.responses.map((response) => ({ url: response.url.replace(origin, ''), status: response.status, mimeType: response.mimeType, type: response.type })),
      failed: network.failed,
    }
    const fontResponses = requestSummary.responses.filter((response) => response.type === 'Font')
    const consoleSummary = {
      entries: consoleLog.entries,
      exceptions: consoleLog.exceptions,
      errors: consoleLog.entries.filter((entry) => entry.level === 'error').length + consoleLog.exceptions.length,
      warnings: consoleLog.entries.filter((entry) => entry.level === 'warning').length,
    }
    // Every probed text node must be shaped by exactly one platform font: the bundled Inter
    // web font (custom, not a system font) at the weight the design specifies.
    const fontsAllInter = Object.values(metrics.platformFonts)
      .filter(({ rendered }) => rendered)
      .every(({ expectedPostScriptName, fonts }) =>
        fonts.length === 1 && fonts[0].postScriptName === expectedPostScriptName && fonts[0].isCustomFont === true)

    const sourceHashes = {}
    for (const file of SOURCE_FILES) sourceHashes[file] = await sha256File(path.join(repoRoot, file))
    const assetDir = path.join(repoRoot, 'src/ui/vnext/assets')
    const assetHashes = {}
    for (const name of (await readdir(assetDir)).sort()) assetHashes[`src/ui/vnext/assets/${name}`] = await sha256File(path.join(assetDir, name))

    const evidenceBytes = Object.values(shots).reduce((sum, shot) => sum + shot.bytes, 0)
    const report = {
      generatedAt: new Date().toISOString(),
      previewUrl,
      server: { entry: 'server.js', readyLine: serverReadyLine, defaultEntry },
      chrome: { product: version.Browser, protocol: version['Protocol-Version'] },
      viewport: VIEWPORT,
      metrics,
      paletteResize,
      fix1,
      readyStates,
      projectRaces,
      fontResponses,
      fontsAllInter,
      console: consoleSummary,
      promptState,
      promptMetrics: {
        composer: promptMetrics.composer,
        promptInput: promptMetrics.promptInput,
        send: promptMetrics.send,
        composerBar: promptMetrics.composerBar,
        sendInsideComposer: promptMetrics.sendInsideComposer,
      },
      keyboardFileState,
      keyboardClearState,
      keyboardNativePicker,
      keyboardClearChooser,
      refValidState,
      refCancelState,
      refIllegalState,
      refOversizedState,
      refCorruptState,
      refReplaceState,
      refClearedState,
      refClearedBySpaceState,
      escapeState,
      hoverState,
      focusState,
      overlayState,
      collapsedState,
      skillClosedState,
      previewClosedState,
      clickState,
      projectFlow,
      pageEnable,
      isolatedWorkspace: workspaceRoot,
      seedStatus,
      network: requestSummary,
      screenshots: shots,
      evidenceBytes,
      sourceHashes,
      assetHashes,
    }
    await writeFile(path.join(EVIDENCE_DIR, REPORT_FILE), `${JSON.stringify(report, null, 2)}\n`)
    await writeFile(path.join(EVIDENCE_DIR, 'p2-04-canvas-binding-fix3a-browser-selfcheck.json'), `${JSON.stringify({
      generatedAt: report.generatedAt,
      isolatedWorkspace: workspaceRoot,
      seedStatus,
      projectFlow,
      pageEnable,
      keyboardNativePicker: {
        gen01: {
          verified: keyboardNativePicker.verified,
          enterOpened: keyboardNativePicker.enterOpened,
          spaceOpened: keyboardNativePicker.spaceOpened,
          chromeVersion: keyboardNativePicker.chromeVersion || '',
          pageEnable: keyboardNativePicker.pageEnable || null,
          unverifiedReason: keyboardNativePicker.unverifiedReason,
        },
        import: keyboardNativePicker.import || null,
      },
      network: {
        editorApi: requestSummary.fetchOrXhr.filter((request) => request.url.includes('/api/editor/projects')).map((request) => ({ url: request.url.replace(origin, ''), method: request.method })),
        otherFetchOrXhr: requestSummary.fetchOrXhr.filter((request) => !request.url.includes('/api/editor/projects')).length,
        clickStateFetch: clickState.pageNetworkCalls,
      },
      screenshots: Object.fromEntries(Object.entries(shots).filter(([key]) => key.startsWith('project')).map(([key, shot]) => [key, { file: path.basename(shot.file), size: `${shot.width}x${shot.height}`, bytes: shot.bytes, sha256: shot.sha256 }])),
    }, null, 2)}\n`)
    console.log(JSON.stringify({
      previewUrl,
      server: report.server,
      viewport: metrics.viewport,
      scroll: metrics.scroll,
      interAvailable: metrics.interAvailable,
      fontFaces: metrics.fontFaces,
      platformFonts: metrics.platformFonts,
      fontsAllInter,
      fontResponses,
      images: metrics.images,
      inlineSvg: metrics.inlineSvg,
      console: { errors: consoleSummary.errors, warnings: consoleSummary.warnings, entries: consoleSummary.entries, exceptions: consoleSummary.exceptions },
      cels: { count: metrics.celCount, filled: metrics.celFilled, blank: metrics.celBlank, selected: metrics.celSelected, detailsDots: metrics.detailsDots },
      preview: metrics.preview,
      skillPop: metrics.skillPop,
      network: { total: requestSummary.total, external: requestSummary.external.length, fetchOrXhr: requestSummary.fetchOrXhr.length, svgRequests: requestSummary.svgRequests.length, byType: requestSummary.byType, failed: requestSummary.failed, pageNetworkCalls: clickState.pageNetworkCalls },
      promptState,
      promptMetrics: { sendInsideComposer: promptMetrics.sendInsideComposer, promptH: promptMetrics.promptInput?.h, composerH: promptMetrics.composer?.h },
      keyboardFileState: { activeId: keyboardFileState.activeId, activeType: keyboardFileState.activeType, slotFocusWithin: keyboardFileState.slotFocusWithin },
      keyboardClearState: { activeClass: keyboardClearState.activeClass, focusVisible: keyboardClearState.focusVisible, fileClicks: keyboardClearState.fileClicks },
      keyboardNativePicker,
      keyboardClearChooser,
      refValidState,
      refCancelState,
      refIllegalState,
      refOversizedState,
      refCorruptState,
      refReplaceState,
      refClearedState,
      refClearedBySpaceState,
      escapeState,
      hoverState,
      focusState: { activeIsClearAction: focusState.activeIsClearAction, usedScriptFocus: focusState.usedScriptFocus, focusVisible: focusState.focusVisible, tooltipVisible: focusState.tooltipVisible },
      overlayState,
      collapsedState,
      screenshots: Object.fromEntries(Object.entries(shots).map(([key, shot]) => [key, { file: path.basename(shot.file), size: `${shot.width}x${shot.height}`, bytes: shot.bytes, sha256: shot.sha256 }])),
      evidenceBytes,
      sourceHashes,
      report: path.join(EVIDENCE_DIR, REPORT_FILE),
    }, null, 2))

    const failures = []
    const expect = (condition, message) => { if (!condition) failures.push(message) }
    expect(paletteResize.every((state) => state.passed), 'palette ring must follow swatch width through 314/240/280/314 divider drags')
    expect(metrics.viewport.w === 1920 && metrics.viewport.h === 1080, `viewport is ${metrics.viewport.w}x${metrics.viewport.h}`)
    expect(metrics.scroll.docW === 1920 && metrics.scroll.docH === 1080 && metrics.scroll.x === 0 && metrics.scroll.y === 0, `document scroll box is ${metrics.scroll.docW}x${metrics.scroll.docH}`)
    expect(shots.default.width === 1920 && shots.default.height === 1080, `default screenshot is ${shots.default.width}x${shots.default.height}`)
    expect(metrics.workbench.w === 1920 && metrics.workbench.h === 1080 && metrics.workbench.x === 0 && metrics.workbench.y === 0, 'workbench must fill the viewport')
    expect(metrics.images.loaded === metrics.images.total, `images loaded ${metrics.images.loaded}/${metrics.images.total}`)
    expect(metrics.left.w === 406 && metrics.center.x === 406 && metrics.center.w === 1200 && metrics.colorSidebar.x === 1606 && metrics.colorSidebar.w === 314, 'column geometry must match 406/1200/314')
    expect(metrics.pagebar.h === 40 && metrics.timeline.y === 890 && metrics.timeline.h === 190, 'page bar 40 / timeline 890+190')
    expect(metrics.tool.w === 32 && metrics.tool.h === 32 && metrics.toolIcon.w === 16 && metrics.toolIcon.h === 16, 'tool 32 / icon 16')
    expect(metrics.preview.x === 1192 && metrics.preview.y === 544 && metrics.preview.w === 406 && metrics.preview.h === 310, `preview at ${metrics.preview.x},${metrics.preview.y} ${metrics.preview.w}x${metrics.preview.h}`)
    expect(metrics.skillPop.w === 299 && metrics.skillPop.h === 276 && metrics.skillPop.x >= 12 && metrics.skillPop.y >= 12, `skill popover at ${metrics.skillPop.x},${metrics.skillPop.y}`)
    expect(metrics.celSlot.w === 32 && metrics.celSlot.h === 32 && metrics.celFace?.w === 24 && metrics.celFace?.h === 24 && metrics.celCount === 36 && metrics.celFilled === 27 && metrics.celBlank === 9, `cels ${metrics.celCount}/${metrics.celFilled}/${metrics.celBlank} face ${JSON.stringify(metrics.celFace)}`)
    expect(metrics.celSelected.length === 1 && metrics.celSelected[0] === '3:Sprite', `selected cel ${metrics.celSelected}`)
    expect(metrics.detailsDots.join(',') === '1,2,3', `details dots ${metrics.detailsDots}`)
    expect(metrics.sendInsideComposer === true && metrics.composer.h === 197 && metrics.composer.y === 871, `composer/send ${JSON.stringify({ composer: metrics.composer, send: metrics.send, bar: metrics.composerBar, inside: metrics.sendInsideComposer })}`)
    expect(metrics.promptRows === 1 && metrics.promptInput.h === 20, `empty prompt ${JSON.stringify(metrics.promptInput)} rows ${metrics.promptRows}`)
    expect(metrics.searchStyle?.backgroundColor === 'rgb(255, 255, 255)', `skill search ${JSON.stringify(metrics.searchStyle)}`)
    expect(metrics.homeFill === 'rgb(245, 245, 245)', `home fill ${metrics.homeFill}`)
    expect(metrics.skillPopStyle?.backgroundColor === 'rgba(255, 255, 255, 0.72)', `skill pop fill ${JSON.stringify(metrics.skillPopStyle)}`)
    expect(String(metrics.skillPopStyle?.backdropFilter || '').includes('32px'), `skill pop blur ${JSON.stringify(metrics.skillPopStyle)}`)
    expect(metrics.previewStyle?.backgroundColor === 'rgba(255, 255, 255, 0.72)', `preview fill ${JSON.stringify(metrics.previewStyle)}`)
    expect(String(metrics.previewStyle?.backdropFilter || '').includes('32px'), `preview blur ${JSON.stringify(metrics.previewStyle)}`)
    expect(metrics.skillPopDividers === 1, `skill pop dividers ${metrics.skillPopDividers}`)
    expect(metrics.skillTagIconOpacity === '1', `skill tag icon opacity ${metrics.skillTagIconOpacity}`)
    expect(metrics.eyedropperStroke?.stroke === '#282828' && metrics.eyedropperStroke?.width === '1.5', `eyedropper ${JSON.stringify(metrics.eyedropperStroke)}`)
    expect(metrics.eyedropperIcon?.w === 16 && metrics.eyedropperIcon?.h === 16, `eyedropper icon ${JSON.stringify(metrics.eyedropperIcon)}`)
    expect(metrics.layerEyeSlot?.w === 16 && metrics.layerEyeSlot?.h === 16 && metrics.layerEyeIcon?.w === 12 && metrics.layerEyeIcon?.h === 12, `layer eye 16/12 ${JSON.stringify({ slot: metrics.layerEyeSlot, icon: metrics.layerEyeIcon })}`)
    expect(metrics.layerLockSlot?.w === 16 && metrics.layerLinkSlot?.w === 16 && metrics.layerLinkIcon?.w === 12, `layer lock/link slots ${JSON.stringify({ lock: metrics.layerLockSlot, link: metrics.layerLinkSlot, icon: metrics.layerLinkIcon })}`)
    expect(Math.abs((metrics.layerNameDetails?.x ?? 0) - (metrics.layerRowDetails?.x ?? 0) - 74) < 0.6, `layer name x ${JSON.stringify({ name: metrics.layerNameDetails, row: metrics.layerRowDetails })}`)
    expect(metrics.layersPlusIcon?.w === 10 && metrics.layerMoreIcon?.w === 10, `unchanged +/more ${JSON.stringify({ plus: metrics.layersPlusIcon, more: metrics.layerMoreIcon })}`)
    expect(metrics.projectInk === 'rgb(40, 40, 40)' && metrics.newSkillInk === 'rgb(40, 40, 40)' && metrics.spriteTypeInk === 'rgb(40, 40, 40)', `primary ink ${JSON.stringify({ project: metrics.projectInk, newSkill: metrics.newSkillInk, sprite: metrics.spriteTypeInk })}`)
    expect(metrics.customInk === 'rgb(102, 102, 102)' && metrics.addColorInk === 'rgb(102, 102, 102)', `secondary ink ${JSON.stringify({ custom: metrics.customInk, add: metrics.addColorInk })}`)
    expect(metrics.videoInk === 'rgb(155, 155, 155)' && metrics.videoIconOpacity === '1', `video ${metrics.videoInk} icon opacity ${metrics.videoIconOpacity}`)
    expect(promptMetrics.sendInsideComposer === true && promptMetrics.composer.h === 197 && promptMetrics.promptInput.h <= 40, `multiline composer ${JSON.stringify({ h: promptMetrics.composer?.h, prompt: promptMetrics.promptInput, send: promptMetrics.send, inside: promptMetrics.sendInsideComposer })}`)
    expect(keyboardFileState.activeId === 'vnext-ref-input' && keyboardFileState.activeType === 'file' && keyboardFileState.slotFocusWithin, `tab file ${JSON.stringify(keyboardFileState)}`)
    expect(keyboardClearState.activeClass.includes('vnext-ref-clear') && keyboardClearState.focusVisible, `tab clear ${JSON.stringify(keyboardClearState)}`)
    expect(metrics.selectedRow.w === 1184 && metrics.selectedRow.h === 32 && metrics.selectedRow.y === 991, `selected layer row ${metrics.selectedRow.w}×${metrics.selectedRow.h} at y ${metrics.selectedRow.y}`)
    expect(metrics.swatchCount === 24 && metrics.swatchStyle.width === '30px' && metrics.swatchStyle.borderRadius === '6px' && metrics.swatchRings === 2, 'palette 24 × 30px R6 with two selected rings')
    expect(metrics.firstFrameIcon.w === 16 && metrics.firstFrameButton.w === 24, 'playback glyph 16 in 24 button')
    expect(metrics.addBlankDisabled === true && metrics.linkCopies.every((item) => item.disabled), 'add-blank and Link copies stay disabled')
    expect(promptState.value === 'first line\nsecond line' && promptState.disabled === false, `prompt draft ${JSON.stringify(promptState)}`)
    expect(refValidState.filled && refValidState.name === 'vis02-ok.png' && refValidState.previewSrc.startsWith('blob:') && refValidState.naturalWidth > 0 && refValidState.naturalHeight > 0, `valid ref ${JSON.stringify(refValidState)}`)
    expect(refCancelState.filled && refCancelState.name === 'vis02-ok.png' && refCancelState.naturalWidth > 0, `cancel kept ${JSON.stringify(refCancelState)}`)
    expect(refIllegalState.filled && refIllegalState.name === 'vis02-ok.png' && refIllegalState.error.includes('PNG, WebP, or JPEG') && refIllegalState.naturalWidth > 0, `illegal ${JSON.stringify(refIllegalState)}`)
    expect(refOversizedState.filled && refOversizedState.name === 'vis02-ok.png' && refOversizedState.error.includes('2 MiB') && refOversizedState.naturalWidth > 0, `oversized ${JSON.stringify(refOversizedState)}`)
    expect(refCorruptState.filled && refCorruptState.name === 'vis02-ok.png' && refCorruptState.error.includes('decode') && refCorruptState.naturalWidth > 0, `corrupt ${JSON.stringify(refCorruptState)}`)
    expect(refReplaceState.filled && refReplaceState.name === 'vis02-replace.png' && refReplaceState.error === '' && refReplaceState.naturalWidth > 0, `replace ${JSON.stringify(refReplaceState)}`)
    expect(refClearedState.filled === false && refClearedState.name === '' && refClearedState.fileClicks === 0, `cleared ${JSON.stringify(refClearedState)}`)
    expect(refClearedBySpaceState.filled === false && refClearedBySpaceState.name === '' && refClearedBySpaceState.fileClicks === 0, `cleared by Space ${JSON.stringify(refClearedBySpaceState)}`)
    expect(keyboardClearChooser.enterOpenedPicker === false && keyboardClearChooser.spaceOpenedPicker === false, `clear must not reopen the file picker ${JSON.stringify(keyboardClearChooser)}`)
    if (keyboardNativePicker.verified) {
      expect(keyboardNativePicker.enterOpened && keyboardNativePicker.spaceOpened, `headed native picker opened ${JSON.stringify(keyboardNativePicker)}`)
      expect(keyboardNativePicker.afterEnterName === 'vis02-ok.png' && keyboardNativePicker.afterSpaceName === 'vis02-ok.png', `headed cancel kept image ${JSON.stringify(keyboardNativePicker)}`)
      expect(keyboardNativePicker.afterEnterPrompt === 'keep-headed-prompt' && keyboardNativePicker.afterSpacePrompt === 'keep-headed-prompt', `headed cancel kept prompt ${JSON.stringify(keyboardNativePicker)}`)
    }
    expect(focusState.usedScriptFocus === false, `skill focus must use Tab, not script.focus() ${JSON.stringify(focusState)}`)
    expect(escapeState.closedByEscape === true, `escape ${JSON.stringify(escapeState)}`)
    expect(metrics.sendDisabled && clickState.sendStillDisabled, 'send must stay disabled')
    expect(metrics.videoDisabled && clickState.videoStillDisabled, 'video must stay disabled')
    expect(hoverState.clearVisible && hoverState.tooltipVisible, 'skill tag hover must show × and tooltip')
    expect(focusState.activeIsClearAction && focusState.focusVisible && focusState.tooltipVisible, 'skill tag focus must show ring and tooltip')
    expect(overlayState.layersOpen && overlayState.onionOpen, 'layers and onion popovers must open')
    expect(collapsedState.collapsed && collapsedState.bodyHidden, 'preview collapse must hide the body')
    expect(skillClosedState.skillOpen === false && skillClosedState.skillDisplay === 'none' && skillClosedState.puzzleExpanded === 'false', 'skill popover must close (rendered display none) from the puzzle button')
    expect(previewClosedState.closed.display === 'none' && previewClosedState.closed.tvExpanded === 'false' && previewClosedState.reopened.display === 'flex' && previewClosedState.reopened.tvExpanded === 'true', 'preview must close and reopen from the tv button')
    const editorApi = requestSummary.fetchOrXhr.filter((request) => request.url.includes('/api/editor/projects'))
    const safeGenerationApi = requestSummary.fetchOrXhr.filter((request) => (
      (request.url.includes('/api/gemini-state') && request.method === 'GET')
      || (request.url.includes('/api/generate-character/review') && request.method === 'POST')
    ))
    const intercepted = new Set((fix1.jobGets || []).concat(fix1.reviewDescription ? ['/api/generate-character/review'] : [], fix1.generateCount ? ['/api/generate-character'] : []))
    const wasIntercepted = (url) => [...intercepted].some((path) => url.includes(path)) || url.includes('/api/gemini-state') || url.includes('/api/jobs/') || url.includes('/generated/')
    const otherApi = requestSummary.fetchOrXhr.filter((request) => (
      !request.url.includes('/api/editor/projects') && !safeGenerationApi.includes(request) && !wasIntercepted(request.url)
    ))
    const providerPosts = requestSummary.fetchOrXhr.filter((request) => (
      request.method === 'POST' && /\/api\/(?:generate-character|process-sheet)(?:$|\/)/.test(new URL(request.url).pathname)
      && !request.url.includes('/api/generate-character/review')
      && !wasIntercepted(request.url)
    ))
    expect(requestSummary.external.length === 0, `external requests: ${requestSummary.external.length}`)
    expect(otherApi.length === 0, `unwired fetch/XHR: ${JSON.stringify(otherApi)}`)
    expect(clickState.sendWasDisabled && clickState.sendStillDisabled, `review click must leave Send locked while pending ${JSON.stringify(clickState)}`)
    expect(providerPosts.length === 0, `provider/process POSTs must stay blocked in capture: ${JSON.stringify(providerPosts)}`)
    expect(fix1.ok === true, `fix1 success chain ${JSON.stringify(fix1)}`)
    expect(fix1.reviewDescription === 'fix1 brighter sprite', `review description ${fix1.reviewDescription}`)
    expect(fix1.generateCount === 1, `confirm must submit once ${fix1.generateCount}`)
    expect((fix1.jobGets || []).filter((path) => path.endsWith('/job_b')).length === 1, `job B query ${JSON.stringify(fix1.jobGets)}`)
    expect((fix1.jobGets || []).filter((path) => path.endsWith('/job_a')).length === 0, `history card must not query A ${JSON.stringify(fix1.jobGets)}`)
    if (fix1.readyBrowser !== true) failures.push(`ready success browser not proven: ${JSON.stringify({ ops: fix1.fromJobOps, reason: fix1.reason, shot: Boolean(fix1.successShot) })}`)
    if (readyStates?.ok !== true) failures.push(`ready state evidence not proven: ${JSON.stringify({ ops: readyStates?.fromJobOps, reason: readyStates?.reason })}`)
    expect(editorApi.length > 0, 'P2-04 allowlisted editor project fetches must run')
    expect(workspaceRoot.includes('p2-04-canvas-binding-ws-'), `isolated workspace ${workspaceRoot}`)
    expect(seedStatus?.v0 === 201 && seedStatus?.v1a === 201 && seedStatus?.v1b === 201, `seed ${JSON.stringify(seedStatus)}`)
    expect(projectFlow?.listChoose?.openDisabled === true, `list choose ${JSON.stringify(projectFlow?.listChoose)}`)
    expect(String(projectFlow?.listChoose?.status || '').includes('Choose a project'), `choose hint ${projectFlow?.listChoose?.status}`)
    expect(projectFlow?.listChrome?.width === 528, `list width ${JSON.stringify(projectFlow?.listChrome)}`)
    expect(projectFlow?.listChrome?.titleSize === '16px' && (projectFlow?.listChrome?.titleWeight === '600' || projectFlow?.listChrome?.titleWeight === 'semibold'), `list title ${JSON.stringify(projectFlow?.listChrome)}`)
    expect(projectFlow?.listChrome?.searchRadius === '6px', `list search ${JSON.stringify(projectFlow?.listChrome)}`)
    expect(projectFlow?.listChrome?.searchSvg === 0, `list search icon ${JSON.stringify(projectFlow?.listChrome)}`)
    expect(projectFlow?.listChrome?.btnHeight === 32 && projectFlow?.listChrome?.btnRadius === '10px', `list button ${JSON.stringify(projectFlow?.listChrome)}`)
    expect(String(projectFlow?.listLoading || '').includes('Loading'), `list loading ${projectFlow?.listLoading}`)
    expect(String(projectFlow?.listError || '').includes('could not be loaded'), `list error ${projectFlow?.listError}`)
    expect(String(projectFlow?.listUnread || '').includes('None of your projects'), `list unread ${projectFlow?.listUnread}`)
    expect(projectFlow?.confirmChrome?.width === 400 && projectFlow?.confirmChrome?.isList === false, `confirm shell ${JSON.stringify(projectFlow?.confirmChrome)}`)
    expect(projectFlow?.emptyTimeline?.current === '00' && projectFlow?.emptyTimeline?.total === '/ 00' && projectFlow?.emptyTimeline?.fps === '—', `empty timeline ${JSON.stringify(projectFlow?.emptyTimeline)}`)
    expect(projectFlow?.realTimeline?.frames >= 1 && projectFlow?.realTimeline?.current !== '03', `real timeline ${JSON.stringify(projectFlow?.realTimeline)}`)
    expect(!projectFlow?.listOmitted?.warning || projectFlow.listOmitted.iconW === 12, `list warning icon ${JSON.stringify(projectFlow?.listOmitted)}`)
    expect(!projectFlow?.listOmitted?.warning || projectFlow.listOmitted.refreshBg === 'rgb(255, 255, 255)', `list refresh ${JSON.stringify(projectFlow?.listOmitted)}`)
    expect(projectFlow?.listSelected?.openDisabled === false, `list selected ${JSON.stringify(projectFlow?.listSelected)}`)
    expect(projectFlow?.listSelected?.fullyVisible === true, `list selected visible ${JSON.stringify(projectFlow?.listSelected)}`)
    expect(String(projectFlow?.noMatch || '').includes('castle'), `no match ${projectFlow?.noMatch}`)
    expect(projectFlow?.upgradeTitle === 'Open as an upgraded copy', `upgrade ${projectFlow?.upgradeTitle}`)
    expect(projectFlow?.upgraded?.originalUnchanged === true && projectFlow?.upgraded?.tiles === 0, `upgrade copy ${JSON.stringify(projectFlow?.upgraded)}`)
    expect(Boolean(projectFlow?.openedName) && projectFlow.openedName !== 'Untitled project', `opened ${projectFlow?.openedName}`)
    expect(editorApi.some((request) => request.url.includes('/upgrade-copy')), `upgrade-copy ${JSON.stringify(editorApi.map((item) => item.url))}`)
    expect(projectFlow?.importedTiles >= 2, `imported tiles ${projectFlow?.importedTiles}`)
    expect(projectFlow?.selectedByPointer === true, `pointer select ${projectFlow?.selectedByPointer}`)
    expect(projectFlow?.moved === true && projectFlow?.saveEnabled === true, `dirty ${JSON.stringify({ moved: projectFlow?.moved, saveEnabled: projectFlow?.saveEnabled })}`)
    expect(projectFlow?.savedLabel === 'Saved', `saved ${projectFlow?.savedLabel}`)
    expect(projectFlow?.savedView?.allInside === true && projectFlow?.savedView?.projectId === projectFlow?.createdId, `saved canvases visible ${JSON.stringify(projectFlow?.savedView)}`)
    expect(
      JSON.stringify((projectFlow?.savedPositions || []).map((item) => ({ x: item.x, y: item.y }))) === JSON.stringify([{ x: 48, y: 24 }, { x: 160, y: 40 }])
      || JSON.stringify((projectFlow?.savedPositions || []).map((item) => ({ x: item.x, y: item.y }))) === JSON.stringify([{ x: 160, y: 40 }, { x: 48, y: 24 }]),
      `saved coordinates ${JSON.stringify(projectFlow?.savedPositions)}`,
    )
    expect(projectFlow?.villageStillListed === true, `village_03 still listed`)
    expect(projectFlow?.reopened?.id === projectFlow?.createdId && projectFlow?.reopened?.replaced === true && projectFlow?.reopened?.tiles >= 2, `reopen ${JSON.stringify(projectFlow?.reopened)}`)
    expect(
      JSON.stringify(projectFlow?.reopened?.positions) === JSON.stringify(projectFlow?.savedPositions),
      `reopen positions ${JSON.stringify({ saved: projectFlow?.savedPositions, reopened: projectFlow?.reopened?.positions })}`,
    )
    expect(projectFlow?.reopenView?.allInside === true && projectFlow?.reopenView?.projectId === projectFlow?.createdId, `reopen canvases visible ${JSON.stringify(projectFlow?.reopenView)}`)
    expect(
      projectFlow?.reopenViewAfterShot?.projectId === projectFlow?.createdId
      && projectFlow?.reopenViewAfterShot?.zoom === projectFlow?.reopenView?.zoom
      && JSON.stringify(projectFlow?.reopenViewAfterShot?.positions) === JSON.stringify(projectFlow?.reopenView?.positions)
      && projectFlow?.reopenViewAfterShot?.previewCount === projectFlow?.reopened?.previewCount,
      `reopen view after shot ${JSON.stringify({ before: projectFlow?.reopenView, after: projectFlow?.reopenViewAfterShot, opened: projectFlow?.reopened })}`,
    )
    if (keyboardNativePicker.import) {
      if (keyboardNativePicker.import.verified) {
        expect(keyboardNativePicker.import.enterOpened && keyboardNativePicker.import.spaceOpened, `headed import picker ${JSON.stringify(keyboardNativePicker.import)}`)
      }
    }
    expect(metrics.notOnSurface === 'SKILL-06' && !metrics.capabilityIds.includes('SKILL-06'), 'SKILL-06 must be recorded as absent from this surface')
    expect(defaultEntry.status === 302 && defaultEntry.location === '/src/ui/studio/studio.html#character', `default entry ${defaultEntry.status} ${defaultEntry.location}`)
    expect(fontsAllInter, `platform fonts must be Inter: ${JSON.stringify(metrics.platformFonts)}`)
    expect(metrics.fontFaces.length === 2 && metrics.fontFaces.every((face) => face.status === 'loaded'), `font faces ${JSON.stringify(metrics.fontFaces)}`)
    expect(fontResponses.length === 2 && fontResponses.every((response) => response.status === 200), `font responses ${JSON.stringify(fontResponses)}`)
    expect(metrics.inlineSvg.unresolved.length === 0 && metrics.inlineSvg.emptyBoxes.length === 0 && metrics.inlineSvg.symbols === 68, `inline svg ${JSON.stringify(metrics.inlineSvg)}`)
    expect(requestSummary.svgRequests.length === 0, `svg requests ${requestSummary.svgRequests.length}`)
    expect(requestSummary.failed.length === 0, `failed requests ${JSON.stringify(requestSummary.failed)}`)
    const rawConsoleErrors = consoleSummary.entries.filter((entry) => entry.level === 'error')
    const expected500 = rawConsoleErrors.filter((entry) => entry.source === 'network' && entry.url === fix1.injected500Url && String(entry.text || '').includes('500'))
    const expected409 = rawConsoleErrors.filter((entry) => entry.source === 'network' && entry.url === projectRaces.lateOpen?.injected409Url && String(entry.text || '').includes('409'))
    const expectedConsole = [...expected500, ...expected409]
    const unexpectedConsole = [
      ...rawConsoleErrors.filter((entry) => !expectedConsole.includes(entry)),
      ...consoleSummary.exceptions,
    ]
    report.consoleProbe = {
      rawErrors: rawConsoleErrors.length + consoleSummary.exceptions.length,
      expectedInjected: expectedConsole.length,
      expected500: expected500.length,
      expected409: expected409.length,
      unexpected: unexpectedConsole.length,
      injected500Url: fix1.injected500Url || '',
      injected409Url: projectRaces.lateOpen?.injected409Url || '',
    }
    expect(fix1.injected500Url && expected500.length === 1, `expected injected 500 ${JSON.stringify(report.consoleProbe)}`)
    expect(projectRaces.lateOpen?.injected409Url && expected409.length === 1, `expected injected 409 ${JSON.stringify(report.consoleProbe)}`)
    expect(unexpectedConsole.length === 0, `unexpected console errors ${JSON.stringify(unexpectedConsole)}`)
    expect(projectRaces.cancelOpen?.cancelKeptA === true, `cancel open kept A ${JSON.stringify(projectRaces.cancelOpen)}`)
    expect(projectRaces.lateOpen?.lateSaveOpenB === true, `late save during open B ${JSON.stringify(projectRaces.lateOpen)}`)
    await writeFile(path.join(EVIDENCE_DIR, REPORT_FILE), `${JSON.stringify(report, null, 2)}\n`)
    if (failures.length > 0) throw new Error(`self-check failed:\n- ${failures.join('\n- ')}`)
  } finally {
    client?.close()
    for (const child of children.reverse()) {
      if (child.exitCode !== null) continue
      child.kill('SIGTERM')
    }
    await delay(300)
    for (const child of children) {
      if (child.exitCode === null) child.kill('SIGKILL')
    }
    await delay(100)
    const alive = children.filter((child) => child.exitCode === null && child.signalCode === null)
    if (alive.length > 0) console.error(`warning: ${alive.length} child process(es) did not report exit`)
  }
}

await main()
