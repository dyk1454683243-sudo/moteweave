import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID, createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import http from 'node:http'
import { mkdtemp, writeFile, readFile, symlink, unlink, mkdir, rename, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { handleEditorProjectApi } from '../../src/editor-project/apiHandler.js'
import { loadEditorProject } from '../../src/editor-project/projectStore.js'
import {
  createEditorProjectV1,
  createBlankSpriteDocument,
  writeWorkingPixels,
  changeWorkingStructure,
  restoreWorkingSpriteDocument,
  getSpriteDocument,
  readSpriteBlock,
} from '../../src/editor-project/spriteDocumentStore.js'
import {
  APPROVED_ASEPRITE_EXECUTABLE,
  REJECTED_ASEPRITE_WRAPPER_PREFIX,
  EXTERNAL_BRIDGE_LIMITS,
  createExternalBridgeService,
  defaultAsepriteExec,
  probeAsepriteExecutable,
} from '../../src/editor-project/externalBridgeService.js'
import {
  EXTERNAL_BRIDGE_COMPATIBILITY,
  MCP_BRIDGE_TOOL_NAMES,
  createExternalPixelSessions,
  inspectExternalBridgeTarget,
} from '../../src/editor-project/externalPixelSession.js'
import {
  MCP_PIXEL_TOOLS,
  buildTaskScopedCodexMcpCommand,
  createPixelMcpServer,
  parseTaskScopedCodexMcpCommandLine,
} from '../../scripts/pixel-mcp-stdio.mjs'
import { readExternalPixels } from '../../src/ui/vnext/vnext-external-pixels.js'

const sha256Hex = bytes => createHash('sha256').update(bytes).digest('hex')

async function makeTempWorkspace() {
  const root = await mkdtemp('/private/tmp/gametool-ext3-test-')
  const workspaceRoot = path.join(root, 'workspace')
  return { projectRoot: root, workspaceRoot }
}

async function seedProjectWith64x64Canvas({ projectRoot, workspaceRoot, rgba = null, durationMs = 140, tagName = 'Idle' } = {}) {
  const created = await createEditorProjectV1({
    operationId: randomUUID(),
    name: 'Ext3 Bridge Test',
    projectRoot,
    workspaceRoot,
  })
  const projectId = created.project.id
  const blank = await createBlankSpriteDocument({
    projectId,
    operationId: randomUUID(),
    expectedRevision: created.project.revision,
    width: 64,
    height: 64,
    name: 'Hero 64',
    projectRoot,
    workspaceRoot,
  })
  let project = blank.project
  let document = blank.document
  const canvasId = blank.canvas.id
  const documentId = document.document_id
  const frameId = document.frame_order[0]
  const layerId = document.layer_order[0]
  const celId = Object.keys(document.cels)[0]

  if (durationMs !== 100) {
    const durRes = await changeWorkingStructure({
      projectId,
      documentId,
      operationId: randomUUID(),
      expectedRevision: project.revision,
      expectedWorkingRevision: document.revision,
      command: { type: 'set-duration', frame_id: frameId, duration_ms: durationMs },
      projectRoot,
      workspaceRoot,
    })
    project = durRes.project
    document = durRes.document
  }

  if (tagName) {
    const tagRes = await changeWorkingStructure({
      projectId,
      documentId,
      operationId: randomUUID(),
      expectedRevision: project.revision,
      expectedWorkingRevision: document.revision,
      command: {
        type: 'add-tag',
        name: tagName,
        from_frame_id: frameId,
        to_frame_id: frameId,
        direction: 'forward',
      },
      projectRoot,
      workspaceRoot,
    })
    project = tagRes.project
    document = tagRes.document
  }

  const initialRgba = rgba || new Uint8Array(EXTERNAL_BRIDGE_COMPATIBILITY.rgbaByteLength)
  if (!rgba) {
    // Non-zero RGB on transparent pixel (0,0) + opaque pixel at (2,2)
    initialRgba[0] = 17
    initialRgba[1] = 34
    initialRgba[2] = 51
    initialRgba[3] = 0
    const pIdx = (2 * 64 + 2) * 4
    initialRgba[pIdx] = 20
    initialRgba[pIdx + 1] = 40
    initialRgba[pIdx + 2] = 60
    initialRgba[pIdx + 3] = 255
  }
  const written = await writeWorkingPixels({
    projectId,
    documentId,
    operationId: randomUUID(),
    expectedRevision: project.revision,
    expectedWorkingRevision: document.revision,
    rect: { x: 0, y: 0, w: 64, h: 64 },
    rgba: Buffer.from(initialRgba),
    expectedSha256: sha256Hex(initialRgba),
    target: { frame_id: frameId, layer_id: layerId, cel_id: celId },
    projectRoot,
    workspaceRoot,
  })
  return {
    projectRoot,
    workspaceRoot,
    projectId,
    canvasId,
    documentId,
    frameId,
    layerId,
    celId,
    project: written.project,
    document: written.document,
    rgba: initialRgba,
  }
}

async function startTestApiServer({ projectRoot, workspaceRoot, sessions, bridgeService }) {
  const registry = new Set()
  const artifactAccessRegistry = {
    register: items => items.forEach(i => registry.add(i)),
    has: item => registry.has(item),
  }
  const server = http.createServer((req, res) => {
    handleEditorProjectApi(req, res, {
      projectRoot,
      workspaceRoot,
      artifactAccessRegistry,
      externalPixelSessions: sessions,
      externalBridgeService: bridgeService,
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise(resolve => server.close(resolve)),
  }
}

test('STDIO MCP server exposes only the 9 approved tools, enforces the 9-call edit budget, keeps get_job/cancel_job/request_acceptance available after exhaustion, and supports real STDIO transport', async () => {
  const { projectRoot, workspaceRoot } = await makeTempWorkspace()
  const seeded = await seedProjectWith64x64Canvas({ projectRoot, workspaceRoot })
  const sessions = createExternalPixelSessions()
  const bridgeService = createExternalBridgeService({ sessions })
  const api = await startTestApiServer({ projectRoot, workspaceRoot, sessions, bridgeService })

  try {
    const scope = { projectRoot, workspaceRoot, projectId: seeded.projectId }
    const connected = await bridgeService.connect(scope, {
      operation_id: randomUUID(),
      canvas_id: seeded.canvasId,
      expected_revision: seeded.project.revision,
      expected_working_revision: seeded.document.revision,
      rect: { x: 4, y: 4, w: 8, h: 8 },
    }, { origin: api.url })

    assert.match(connected.grant_id, /^grant_[a-f0-9]{32}$/)
    assert.match(connected.bridge_token, /^btok_[a-f0-9]{48}$/)

    // 1. Verify prohibited tools and budget behavior through createPixelMcpServer
    const mcp = createPixelMcpServer({
      url: api.url,
      projectId: seeded.projectId,
      canvasId: seeded.canvasId,
      expectedRevision: seeded.project.revision,
      expectedWorkingRevision: seeded.document.revision,
      grantId: connected.grant_id,
      bridgeToken: connected.bridge_token,
    })

    const initRes = await mcp.handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
    assert.equal(initRes.result.serverInfo.name, 'gametool-pixel-bridge')

    const listRes = await mcp.handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
    const toolNames = listRes.result.tools.map(t => t.name)
    assert.deepEqual(toolNames, [...MCP_BRIDGE_TOOL_NAMES])
    assert.equal(MCP_PIXEL_TOOLS.length, 9)
    for (const prohibited of ['propose_recipe', 'create_animation_draft', 'save', 'commit']) {
      assert.equal(toolNames.includes(prohibited), false)
      const blocked = await mcp.handleMessage({
        jsonrpc: '2.0',
        id: 99,
        method: 'tools/call',
        params: { name: prohibited, arguments: {} },
      })
      assert.equal(blocked.result.isError, true)
      const payload = JSON.parse(blocked.result.content[0].text)
      assert.equal(payload.error, 'assistant_tool_blocked')
      assert.equal(payload.diagnostic.reason, 'prohibited')
    }

    // Consume all 9 calls across read/render/analyze/propose/preview
    // Call 1: read_document
    const c1 = JSON.parse((await mcp.handleMessage({
      jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'read_document', arguments: {} },
    })).result.content[0].text)
    assert.equal(c1.tool_calls, 1)
    assert.equal(c1.remaining_tool_calls, 8)

    // Call 2: read_region
    const c2 = JSON.parse((await mcp.handleMessage({
      jsonrpc: '2.0', id: 11, method: 'tools/call', params: { name: 'read_region', arguments: { rect: { x: 4, y: 4, w: 2, h: 2 } } },
    })).result.content[0].text)
    assert.equal(c2.tool_calls, 2)
    assert.deepEqual(c2.grid, ['00', '00'])

    // Call 3: render_review
    const c3 = JSON.parse((await mcp.handleMessage({
      jsonrpc: '2.0', id: 12, method: 'tools/call', params: { name: 'render_review', arguments: {} },
    })).result.content[0].text)
    assert.equal(c3.tool_calls, 3)

    // Call 4: analyze_pixels
    const c4 = JSON.parse((await mcp.handleMessage({
      jsonrpc: '2.0', id: 13, method: 'tools/call', params: { name: 'analyze_pixels', arguments: { rect: { x: 4, y: 4, w: 2, h: 2 } } },
    })).result.content[0].text)
    assert.equal(c4.tool_calls, 4)
    assert.equal(c4.transparent_pixels, 4)

    // Call 5: preview_patch (does not mutate candidate)
    const c5 = JSON.parse((await mcp.handleMessage({
      jsonrpc: '2.0',
      id: 14,
      method: 'tools/call',
      params: {
        name: 'preview_patch',
        arguments: {
          rect: { x: 4, y: 4, w: 2, h: 2 },
          grid: ['11', '1.'],
          codebook_hash: c2.codebook_hash,
          expected_candidate_hash: c2.candidate_sha256,
        },
      },
    })).result.content[0].text)
    assert.equal(c5.tool_calls, 5)
    assert.equal(c5.preview_only, true)
    assert.equal(c5.changed_pixels, 3)
    assert.equal(c5.candidate_sha256, c2.candidate_sha256)

    // Call 6: propose_patch (mutates candidate, batch 1)
    const c6 = JSON.parse((await mcp.handleMessage({
      jsonrpc: '2.0',
      id: 15,
      method: 'tools/call',
      params: {
        name: 'propose_patch',
        arguments: {
          rect: { x: 4, y: 4, w: 2, h: 2 },
          grid: ['11', '1.'],
          codebook_hash: c2.codebook_hash,
          expected_candidate_hash: c2.candidate_sha256,
        },
      },
    })).result.content[0].text)
    assert.equal(c6.tool_calls, 6)
    assert.equal(c6.drawing_batches, 1)

    // Calls 7, 8, 9: read_document x3 to reach 9/9 tool_calls
    for (let step = 7; step <= 9; step++) {
      const res = JSON.parse((await mcp.handleMessage({
        jsonrpc: '2.0', id: 10 + step, method: 'tools/call', params: { name: 'read_document', arguments: {} },
      })).result.content[0].text)
      assert.equal(res.tool_calls, step)
      assert.equal(res.remaining_tool_calls, 9 - step)
    }

    // Call 10: read_document must be blocked by call_limit
    const exhaustedRead = await mcp.handleMessage({
      jsonrpc: '2.0', id: 25, method: 'tools/call', params: { name: 'read_document', arguments: {} },
    })
    assert.equal(exhaustedRead.result.isError, true)
    assert.equal(JSON.parse(exhaustedRead.result.content[0].text).diagnostic.rule, 'call_limit')

    // Bounded status/review calls (get_job, request_acceptance) remain available after 9/9 budget exhaustion!
    const jobRes = JSON.parse((await mcp.handleMessage({
      jsonrpc: '2.0', id: 26, method: 'tools/call', params: { name: 'get_job', arguments: {} },
    })).result.content[0].text)
    assert.equal(jobRes.tool_calls, 9)
    assert.equal(jobRes.remaining_tool_calls, 0)
    assert.equal(jobRes.status, 'open')

    const acceptRes = JSON.parse((await mcp.handleMessage({
      jsonrpc: '2.0', id: 27, method: 'tools/call', params: { name: 'request_acceptance', arguments: {} },
    })).result.content[0].text)
    assert.equal(acceptRes.status, 'review_ready')
    assert.match(acceptRes.review_path, /#pixel-preview=/)

    // Verify HTTP /api/editor/projects/:id/external-bridge status route reflects the ready candidate
    const statusRes = await fetch(`${api.url}/api/editor/projects/${seeded.projectId}/external-bridge?canvas_id=${seeded.canvasId}&grant_id=${connected.grant_id}`)
    assert.equal(statusRes.status, 200)
    const statusBody = await statusRes.json()
    assert.equal(statusBody.target.supported, true)
    assert.equal(statusBody.grant.status, 'active')
    assert.equal(statusBody.latest_candidate.session_id, acceptRes.session_id)

    // 2. Verify real STDIO child process execution via buildTaskScopedCodexMcpCommand
    const nextConnect = await bridgeService.connect(scope, {
      operation_id: randomUUID(),
      canvas_id: seeded.canvasId,
      expected_revision: seeded.project.revision,
      expected_working_revision: seeded.document.revision,
      rect: { x: 0, y: 0, w: 4, h: 4 },
    }, { origin: api.url })
    const cmd = buildTaskScopedCodexMcpCommand({
      url: api.url,
      projectId: seeded.projectId,
      canvasId: seeded.canvasId,
      expectedRevision: seeded.project.revision,
      expectedWorkingRevision: seeded.document.revision,
      grantId: nextConnect.grant_id,
      bridgeToken: nextConnect.bridge_token,
    })
    const child = spawn(cmd[0], cmd.slice(1), { stdio: ['pipe', 'pipe', 'pipe'] })
    const responses = []
    let buffer = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', chunk => {
      buffer += chunk
      let idx
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim()
        buffer = buffer.slice(idx + 1)
        if (line) responses.push(JSON.parse(line))
      }
    })
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) + '\n')
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n')
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_job', arguments: {} } }) + '\n')
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'cancel_job', arguments: {} } }) + '\n')
    child.stdin.end()
    await new Promise((resolve, reject) => {
      child.on('exit', code => (code === 0 ? resolve() : reject(new Error(`MCP exited with ${code}`))))
    })
    assert.equal(responses.length, 4)
    assert.equal(responses[0].id, 1)
    assert.deepEqual(responses[1].result.tools.map(t => t.name), [...MCP_BRIDGE_TOOL_NAMES])
    const cancelPayload = JSON.parse(responses[3].result.content[0].text)
    assert.equal(cancelPayload.closed, true)
  } finally {
    await api.close()
  }
})

test('Aseprite 1.3.18.5-arm64 probe rejects wrapper script and executes real .aseprite checkout, batch edit, validated return, Save/Undo/Redo, and negative/cap guards', async () => {
  // 1. Verify probe rejects wrapper path and accepts real Steam Aseprite binary
  const rejectedProbe = await probeAsepriteExecutable({
    executablePath: path.join(REJECTED_ASEPRITE_WRAPPER_PREFIX, 'Contents/MacOS/run.sh'),
  })
  assert.equal(rejectedProbe.available, false)
  assert.equal(rejectedProbe.reason, 'wrapper_prohibited')

  const realProbe = await probeAsepriteExecutable({
    executablePath: APPROVED_ASEPRITE_EXECUTABLE,
  })
  assert.equal(realProbe.available, true)
  assert.match(realProbe.version, /^Aseprite 1\.3\.18\.5-arm64/i)

  // 2. Seed a 64x64 canvas with >62 colors (65 distinct opaque colors + non-zero transparent RGB)
  // This proves external_file_import is separate from N1's 62-color character-grid codebook without widening N1!
  const { projectRoot, workspaceRoot } = await makeTempWorkspace()
  const initialRgba = new Uint8Array(EXTERNAL_BRIDGE_COMPATIBILITY.rgbaByteLength)
  initialRgba[0] = 12; initialRgba[1] = 34; initialRgba[2] = 56; initialRgba[3] = 0
  for (let i = 1; i <= 65; i++) {
    const idx = i * 4
    initialRgba[idx] = i * 3
    initialRgba[idx + 1] = (i * 7) % 256
    initialRgba[idx + 2] = (i * 11) % 256
    initialRgba[idx + 3] = 255
  }
  const seeded = await seedProjectWith64x64Canvas({
    projectRoot,
    workspaceRoot,
    rgba: initialRgba,
    durationMs: 180,
    tagName: 'Attack',
  })
  const scope = { projectRoot, workspaceRoot, projectId: seeded.projectId }
  const sessions = createExternalPixelSessions()
  const bridgeService = createExternalBridgeService({ sessions })

  // Connect grant with allowed_rect = { x: 10, y: 10, w: 6, h: 6 }
  const allowedRect = { x: 10, y: 10, w: 6, h: 6 }
  const connected = await bridgeService.connect(scope, {
    operation_id: randomUUID(),
    canvas_id: seeded.canvasId,
    expected_revision: seeded.project.revision,
    expected_working_revision: seeded.document.revision,
    rect: allowedRect,
  })

  // Create real .aseprite checkout
  const checkoutOpId = randomUUID()
  const checkout = await bridgeService.createAsepriteCheckout(scope, {
    operation_id: checkoutOpId,
    grant_id: connected.grant_id,
    bridge_token: connected.bridge_token,
    canvas_id: seeded.canvasId,
    expected_revision: seeded.project.revision,
    expected_working_revision: seeded.document.revision,
  })
  assert.match(checkout.checkout_id, /^chk_[a-f0-9]{32}$/)
  assert.equal(checkout.duration_ms, 180)
  assert.equal(checkout.tags[0].name, 'Attack')

  // Duplicate checkout operation_id replays idempotently; different params conflict
  const replayedCheckout = await bridgeService.createAsepriteCheckout(scope, {
    operation_id: checkoutOpId,
    grant_id: connected.grant_id,
    bridge_token: connected.bridge_token,
    canvas_id: seeded.canvasId,
    expected_revision: seeded.project.revision,
    expected_working_revision: seeded.document.revision,
  })
  assert.equal(replayedCheckout.checkout_file_sha256, checkout.checkout_file_sha256)
  await assert.rejects(
    bridgeService.createAsepriteCheckout(scope, {
      operation_id: checkoutOpId,
      grant_id: connected.grant_id,
      bridge_token: connected.bridge_token,
      canvas_id: 'other_canvas',
      expected_revision: seeded.project.revision,
      expected_working_revision: seeded.document.revision,
    }),
    { code: 'pixel_tool_operation_conflict' },
  )

  // Edit the checked-out .aseprite file using real Aseprite CLI batch mode inside allowedRect
  const edited = await bridgeService.editAsepriteCheckout(scope, checkout.checkout_id, {
    pixels: [
      { x: 11, y: 12, r: 250, g: 120, b: 40, a: 255 },
      { x: 12, y: 12, r: 40, g: 200, b: 250, a: 255 },
    ],
  })
  assert.notEqual(edited.edited_file_sha256, checkout.checkout_file_sha256)

  // Validate and return into the existing candidate service
  const returnOpId = randomUUID()
  const returned = await bridgeService.returnAsepriteCheckout(scope, checkout.checkout_id, {
    operation_id: returnOpId,
    bridge_token: connected.bridge_token,
  })
  assert.equal(returned.saved, false)
  assert.equal(returned.file_modified, true)
  assert.equal(returned.returned_file_sha256, edited.edited_file_sha256)
  assert.equal(returned.changed_pixels, 2)
  assert.match(returned.review_path, /#pixel-preview=/)

  // Duplicate return operation_id replays idempotently
  const replayedReturn = await bridgeService.returnAsepriteCheckout(scope, checkout.checkout_id, {
    operation_id: returnOpId,
    bridge_token: connected.bridge_token,
  })
  assert.equal(replayedReturn.replayed, true)
  assert.equal(replayedReturn.session_id, returned.session_id)
  assert.equal(replayedReturn.pixel_candidate.sha256, returned.pixel_candidate.sha256)

  // Before Save: verify project revision, document revision, and full 64x64 RGBA on disk are completely unchanged
  const preSaveProj = await loadEditorProject(scope)
  const preSaveDoc = await getSpriteDocument({ ...scope, documentId: seeded.documentId })
  const preSaveBlock = await readSpriteBlock({
    ...scope,
    documentId: seeded.documentId,
    sha256: preSaveDoc.manifest.cels[seeded.celId].block.sha256,
  })
  assert.equal(preSaveProj.project.revision, seeded.project.revision)
  assert.equal(preSaveDoc.manifest.revision, seeded.document.revision)
  assert.deepEqual(new Uint8Array(preSaveBlock.bytes), initialRgba)

  // Candidate validates through readExternalPixels and commits via writeWorkingPixels + supports Undo/Redo
  const reviewPayload = await sessions.review(scope, returned.session_id)
  const validated = await readExternalPixels(
    { projectId: seeded.projectId, sessionId: returned.session_id },
    async () => new Response(JSON.stringify(reviewPayload)),
  )
  assert.equal(validated.rgba[0], 12)
  assert.equal(validated.rgba[3], 0)
  const p11_12 = (12 * 64 + 11) * 4
  assert.deepEqual([...validated.rgba.subarray(p11_12, p11_12 + 4)], [250, 120, 40, 255])

  const savedWrite = await writeWorkingPixels({
    projectId: seeded.projectId,
    documentId: seeded.documentId,
    operationId: randomUUID(),
    expectedRevision: seeded.project.revision,
    expectedWorkingRevision: seeded.document.revision,
    rect: { x: 0, y: 0, w: 64, h: 64 },
    rgba: Buffer.from(validated.rgba),
    expectedSha256: validated.pixel_candidate.sha256,
    target: validated.context.target,
    projectRoot,
    workspaceRoot,
  })
  assert.equal(savedWrite.document.revision, seeded.document.revision + 1)
  const postSaveBlock = await readSpriteBlock({
    ...scope,
    documentId: seeded.documentId,
    sha256: savedWrite.document.cels[seeded.celId].block.sha256,
  })
  assert.deepEqual(new Uint8Array(postSaveBlock.bytes), validated.rgba)

  const undone = await restoreWorkingSpriteDocument({
    projectId: seeded.projectId,
    documentId: seeded.documentId,
    operationId: randomUUID(),
    expectedRevision: savedWrite.project.revision,
    expectedWorkingRevision: savedWrite.document.revision,
    targetRevision: seeded.document.revision,
    mode: 'undo',
    projectRoot,
    workspaceRoot,
  })
  assert.equal(undone.document.revision, seeded.document.revision + 2)
  const postUndoBlock = await readSpriteBlock({
    ...scope,
    documentId: seeded.documentId,
    sha256: undone.document.cels[seeded.celId].block.sha256,
  })
  assert.deepEqual(new Uint8Array(postUndoBlock.bytes), initialRgba)

  // Redo and undo back so undone revision state continues seamlessly
  const redone = await restoreWorkingSpriteDocument({
    projectId: seeded.projectId,
    documentId: seeded.documentId,
    operationId: randomUUID(),
    expectedRevision: undone.project.revision,
    expectedWorkingRevision: undone.document.revision,
    targetRevision: savedWrite.document.revision,
    mode: 'redo',
    projectRoot,
    workspaceRoot,
  })
  const reopenedDoc = await getSpriteDocument({ ...scope, documentId: seeded.documentId })
  const reopenedBlock = await readSpriteBlock({
    ...scope,
    documentId: seeded.documentId,
    sha256: reopenedDoc.manifest.cels[seeded.celId].block.sha256,
  })
  assert.deepEqual(new Uint8Array(reopenedBlock.bytes), validated.rgba)

  const undoneAgain = await restoreWorkingSpriteDocument({
    projectId: seeded.projectId,
    documentId: seeded.documentId,
    operationId: randomUUID(),
    expectedRevision: redone.project.revision,
    expectedWorkingRevision: redone.document.revision,
    targetRevision: seeded.document.revision,
    mode: 'undo',
    projectRoot,
    workspaceRoot,
  })

  // 3. Verify negative return cases and 3-attempt cap on a fresh checkout
  const reconnected = await bridgeService.connect(scope, {
    operation_id: randomUUID(),
    canvas_id: seeded.canvasId,
    expected_revision: undoneAgain.project.revision,
    expected_working_revision: undoneAgain.document.revision,
    rect: allowedRect,
  })
  const chk2 = await bridgeService.createAsepriteCheckout(scope, {
    operation_id: randomUUID(),
    grant_id: reconnected.grant_id,
    bridge_token: reconnected.bridge_token,
    canvas_id: seeded.canvasId,
    expected_revision: undoneAgain.project.revision,
    expected_working_revision: undoneAgain.document.revision,
  })
  const originalAseBytes = await readFile(chk2.working_copy_path)

  // Attempt 1: Out-of-scope pixel modification (outside allowedRect)
  await bridgeService.editAsepriteCheckout(scope, chk2.checkout_id, {
    pixels: [{ x: 0, y: 0, r: 255, g: 0, b: 0, a: 255 }],
  })
  await assert.rejects(
    bridgeService.returnAsepriteCheckout(scope, chk2.checkout_id, {
      operation_id: randomUUID(),
      bridge_token: reconnected.bridge_token,
    }),
    err => err.code === 'aseprite_return_invalid' && err.diagnostic?.rule === 'outside_allowed_rect' && err.diagnostic?.attempt === 1,
  )

  // Attempt 2: Restore baseline then write semitransparent pixel (alpha = 128) inside allowedRect
  await writeFile(chk2.working_copy_path, originalAseBytes)
  await bridgeService.editAsepriteCheckout(scope, chk2.checkout_id, {
    pixels: [{ x: 11, y: 11, r: 255, g: 0, b: 0, a: 128 }],
  })
  await assert.rejects(
    bridgeService.returnAsepriteCheckout(scope, chk2.checkout_id, {
      operation_id: randomUUID(),
      bridge_token: reconnected.bridge_token,
    }),
    err => err.code === 'aseprite_return_invalid' && err.diagnostic?.rule === 'binary_alpha' && err.diagnostic?.attempt === 2,
  )

  // Attempt 3: PNG substitution (not a native .aseprite file)
  await writeFile(chk2.working_copy_path, Buffer.alloc(200, 0x89))
  await assert.rejects(
    bridgeService.returnAsepriteCheckout(scope, chk2.checkout_id, {
      operation_id: randomUUID(),
      bridge_token: reconnected.bridge_token,
    }),
    err => err.code === 'aseprite_return_invalid' && err.diagnostic?.rule === 'invalid_magic' && err.diagnostic?.attempt === 3,
  )

  // Attempt 4: Exceeds 3-attempt cap -> 409 aseprite_return_limit_exceeded
  await writeFile(chk2.working_copy_path, originalAseBytes)
  await assert.rejects(
    bridgeService.returnAsepriteCheckout(scope, chk2.checkout_id, {
      operation_id: randomUUID(),
      bridge_token: reconnected.bridge_token,
    }),
    err => err.code === 'aseprite_return_limit_exceeded' && err.http_status === 409,
  )

  // 4. Verify structural violations (addFrame, addLayer) and max 4 live checkouts + revocation
  const chk3 = await bridgeService.createAsepriteCheckout(scope, {
    operation_id: randomUUID(),
    grant_id: reconnected.grant_id,
    bridge_token: reconnected.bridge_token,
    canvas_id: seeded.canvasId,
    expected_revision: undoneAgain.project.revision,
    expected_working_revision: undoneAgain.document.revision,
  })
  await bridgeService.editAsepriteCheckout(scope, chk3.checkout_id, { addFrame: true })
  await assert.rejects(
    bridgeService.returnAsepriteCheckout(scope, chk3.checkout_id, {
      operation_id: randomUUID(),
      bridge_token: reconnected.bridge_token,
    }),
    err => err.code === 'aseprite_return_invalid' && err.diagnostic?.rule === 'frame_count',
  )

  const chk4 = await bridgeService.createAsepriteCheckout(scope, {
    operation_id: randomUUID(),
    grant_id: reconnected.grant_id,
    bridge_token: reconnected.bridge_token,
    canvas_id: seeded.canvasId,
    expected_revision: undoneAgain.project.revision,
    expected_working_revision: undoneAgain.document.revision,
  })
  await bridgeService.editAsepriteCheckout(scope, chk4.checkout_id, { addLayer: true })
  await assert.rejects(
    bridgeService.returnAsepriteCheckout(scope, chk4.checkout_id, {
      operation_id: randomUUID(),
      bridge_token: reconnected.bridge_token,
    }),
    err => err.code === 'aseprite_return_invalid' && err.diagnostic?.rule === 'layer_count',
  )

  // Now 4 live checkouts exist (checkout, chk2, chk3, chk4) -> 5th checkout is rejected with 429 aseprite_checkout_limit
  await assert.rejects(
    bridgeService.createAsepriteCheckout(scope, {
      operation_id: randomUUID(),
      grant_id: reconnected.grant_id,
      bridge_token: reconnected.bridge_token,
      canvas_id: seeded.canvasId,
      expected_revision: undoneAgain.project.revision,
      expected_working_revision: undoneAgain.document.revision,
    }),
    err => err.code === 'aseprite_checkout_limit' && err.http_status === 429 && EXTERNAL_BRIDGE_LIMITS.maxLiveCheckouts === 4,
  )

  // Revoke reconnected.grant_id -> invalidates chk2, chk3, chk4 and frees live checkout slots
  const revoked = await bridgeService.revoke(scope, { grant_id: reconnected.grant_id })
  assert.equal(revoked.invalidated_checkouts, 3)
  await assert.rejects(
    bridgeService.returnAsepriteCheckout(scope, chk4.checkout_id, {
      operation_id: randomUUID(),
      bridge_token: reconnected.bridge_token,
    }),
    { code: 'pixel_tool_grant_revoked' },
  )
})

test('Block 3 Cycle-2 regressions: MCP pre-session argument validation, scoped render_review default rect, connect token replay, cancel_job receipt replay, 403 on revoked session review, target/Aseprite metadata guards, binary header precheck, and discard_only cleanup', async () => {
  const { projectRoot, workspaceRoot } = await makeTempWorkspace()
  const seeded = await seedProjectWith64x64Canvas({ projectRoot, workspaceRoot, tagName: null })
  const scope = { projectRoot, workspaceRoot, projectId: seeded.projectId }
  const sessions = createExternalPixelSessions()
  const bridgeService = createExternalBridgeService({ sessions })

  // 1. Target metadata precheck rejects anchors.items, slices, layer/cel user_data, and non-default tags
  const baseManifest = structuredClone(seeded.document)
  assert.equal(
    inspectExternalBridgeTarget({
      ...structuredClone(baseManifest),
      anchors: { version: 1, items: [{ id: 'a1', name: 'Origin', x: 0, y: 0 }] },
    }).reason,
    'unsupported_metadata',
  )
  assert.equal(
    inspectExternalBridgeTarget({
      ...structuredClone(baseManifest),
      slices: { version: 1, items: [{ id: 's1', name: 'Hitbox', x: 0, y: 0, w: 8, h: 8 }] },
    }).reason,
    'unsupported_metadata',
  )
  const manifestWithLayerData = structuredClone(baseManifest)
  manifestWithLayerData.layers[seeded.layerId].user_data = 'custom_note'
  assert.equal(
    inspectExternalBridgeTarget(manifestWithLayerData).reason,
    'unsupported_metadata',
  )
  const manifestWithTagColor = structuredClone(baseManifest)
  manifestWithTagColor.tags = {
    version: 1,
    items: [{ id: 't1', name: 'Idle', from_frame: 0, to_frame: 0, direction: 'forward', color: '#ff0000' }],
  }
  assert.equal(
    inspectExternalBridgeTarget(manifestWithTagColor).reason,
    'unsupported_metadata',
  )

  // 2. Connect same-operation_id replay returns a valid bridge_token, and rejects replay after revision change or revocation
  const connectOpId = randomUUID()
  const allowedRect = { x: 10, y: 10, w: 8, h: 8 }
  const firstConnect = await bridgeService.connect(scope, {
    operation_id: connectOpId,
    canvas_id: seeded.canvasId,
    expected_revision: seeded.project.revision,
    expected_working_revision: seeded.document.revision,
    rect: allowedRect,
  })
  assert.ok(firstConnect.bridge_token)
  const replayedConnect = await bridgeService.connect(scope, {
    operation_id: connectOpId,
    canvas_id: seeded.canvasId,
    expected_revision: seeded.project.revision,
    expected_working_revision: seeded.document.revision,
    rect: allowedRect,
  })
  assert.equal(replayedConnect.replayed, true)
  assert.equal(replayedConnect.grant_id, firstConnect.grant_id)
  assert.equal(replayedConnect.bridge_token, firstConnect.bridge_token)

  // 3. Scoped render_review with omitted rect defaults to scopeRect, and cancel_job replays idempotently
  const mcpSession = await sessions.create(scope, {
    operation_id: randomUUID(),
    canvas_id: seeded.canvasId,
    expected_revision: seeded.project.revision,
    expected_working_revision: seeded.document.revision,
    grant_id: replayedConnect.grant_id,
    bridge_token: replayedConnect.bridge_token,
  })
  const renderReviewDefault = await sessions.call(scope, mcpSession.session_id, {
    operation_id: randomUUID(),
    bridge_token: replayedConnect.bridge_token,
    tool: 'render_review',
    arguments: {},
  })
  assert.equal(renderReviewDefault.success, true)
  const renderObs = JSON.parse(renderReviewDefault.contentItems[0].text)
  assert.deepEqual(renderObs.rect, allowedRect)
  assert.equal(renderObs.width, 8)
  assert.equal(renderObs.height, 8)

  const cancelOpId = randomUUID()
  const cancelled1 = await sessions.call(scope, mcpSession.session_id, {
    operation_id: cancelOpId,
    bridge_token: replayedConnect.bridge_token,
    tool: 'cancel_job',
    arguments: {},
  })
  assert.equal(cancelled1.status, 'cancelled')
  assert.equal(cancelled1.closed, true)
  const cancelled2 = await sessions.call(scope, mcpSession.session_id, {
    operation_id: cancelOpId,
    bridge_token: replayedConnect.bridge_token,
    tool: 'cancel_job',
    arguments: {},
  })
  assert.equal(cancelled2.status, 'cancelled')
  assert.equal(cancelled2.closed, true)

  // 4. STDIO MCP pre-session argument validation rejects reserved keys and unexpected fields before creating a session
  const api = await startTestApiServer({
    projectRoot: seeded.projectRoot,
    workspaceRoot: seeded.workspaceRoot,
    sessions,
    bridgeService,
  })
  try {
    const mcp = createPixelMcpServer({
      url: api.url,
      projectId: seeded.projectId,
      canvasId: seeded.canvasId,
      expectedRevision: seeded.project.revision,
      expectedWorkingRevision: seeded.document.revision,
      grantId: replayedConnect.grant_id,
      bridgeToken: replayedConnect.bridge_token,
    })
    await mcp.handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
    const sessionsBeforeBadCalls = sessions.listForCanvas(scope, seeded.canvasId).length
    const badReservedCall = await mcp.handleMessage({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'read_document',
        arguments: { action: 'create' },
      },
    })
    assert.equal(badReservedCall.result.isError, true)
    assert.equal(JSON.parse(badReservedCall.result.content[0].text).error, 'invalid_pixel_tool_request')
    const badSchemaCall = await mcp.handleMessage({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'read_region',
        arguments: { rect: allowedRect, unexpected_flag: true },
      },
    })
    assert.equal(badSchemaCall.result.isError, true)
    assert.equal(JSON.parse(badSchemaCall.result.content[0].text).error, 'invalid_pixel_tool_request')
    assert.equal(
      sessions.listForCanvas(scope, seeded.canvasId).length,
      sessionsBeforeBadCalls,
      'invalid tool arguments must not create a session or charge a call before validation',
    )
  } finally {
    await api.close()
  }

  // 5. Revoked grant returns 403 pixel_tool_grant_revoked on session review (not 404), and connect replay after revoke returns 403
  const sessionForRevoke = await sessions.create(scope, {
    operation_id: randomUUID(),
    canvas_id: seeded.canvasId,
    expected_revision: seeded.project.revision,
    expected_working_revision: seeded.document.revision,
    grant_id: replayedConnect.grant_id,
    bridge_token: replayedConnect.bridge_token,
  })
  const rr = await sessions.call(scope, sessionForRevoke.session_id, {
    operation_id: randomUUID(),
    bridge_token: replayedConnect.bridge_token,
    tool: 'read_region',
    arguments: { rect: allowedRect },
  })
  const rrObs = JSON.parse(rr.contentItems[0].text)
  await sessions.call(scope, sessionForRevoke.session_id, {
    operation_id: randomUUID(),
    bridge_token: replayedConnect.bridge_token,
    tool: 'propose_patch',
    arguments: {
      rect: { x: 10, y: 10, w: 1, h: 1 },
      grid: ['1'],
      codebook_hash: rrObs.codebook_hash,
      expected_candidate_hash: rrObs.candidate_sha256,
    },
  })
  await sessions.call(scope, sessionForRevoke.session_id, {
    operation_id: randomUUID(),
    bridge_token: replayedConnect.bridge_token,
    tool: 'request_acceptance',
    arguments: {},
  })
  await bridgeService.revoke(scope, { grant_id: replayedConnect.grant_id })
  await assert.rejects(
    sessions.review(scope, sessionForRevoke.session_id),
    err => err.code === 'pixel_tool_grant_revoked' && err.http_status === 403,
  )
  await assert.rejects(
    bridgeService.connect(scope, {
      operation_id: connectOpId,
      canvas_id: seeded.canvasId,
      expected_revision: seeded.project.revision,
      expected_working_revision: seeded.document.revision,
      rect: allowedRect,
    }),
    err => err.code === 'pixel_tool_grant_revoked' && err.http_status === 403,
  )

  // 6. Aseprite binary header precheck and deleted-cel / layer-data / layer-color / discard_only checks
  const connAse = await bridgeService.connect(scope, {
    operation_id: randomUUID(),
    canvas_id: seeded.canvasId,
    expected_revision: seeded.project.revision,
    expected_working_revision: seeded.document.revision,
    rect: allowedRect,
  })
  const chkMeta = await bridgeService.createAsepriteCheckout(scope, {
    operation_id: randomUUID(),
    grant_id: connAse.grant_id,
    bridge_token: connAse.bridge_token,
    canvas_id: seeded.canvasId,
    expected_revision: seeded.project.revision,
    expected_working_revision: seeded.document.revision,
  })
  const cleanAse = await readFile(chkMeta.working_copy_path)

  // Corrupt frame magic in header -> rejected before Aseprite CLI is invoked
  const badFrameMagic = Buffer.from(cleanAse)
  badFrameMagic.writeUInt16LE(0xBEEF, 128 + 4)
  await writeFile(chkMeta.working_copy_path, badFrameMagic)
  await assert.rejects(
    bridgeService.returnAsepriteCheckout(scope, chkMeta.checkout_id, {
      operation_id: randomUUID(),
      bridge_token: connAse.bridge_token,
    }),
    err => err.code === 'aseprite_return_invalid' && err.diagnostic?.rule === 'file_truncated',
  )

  // Restore clean .aseprite, then delete the single cel -> rejected with rule 'cel_structure' (not treated as transparent)
  await writeFile(chkMeta.working_copy_path, cleanAse)
  await bridgeService.editAsepriteCheckout(scope, chkMeta.checkout_id, { deleteCel: true })
  await assert.rejects(
    bridgeService.returnAsepriteCheckout(scope, chkMeta.checkout_id, {
      operation_id: randomUUID(),
      bridge_token: connAse.bridge_token,
    }),
    err => err.code === 'aseprite_return_invalid' && err.diagnostic?.rule === 'cel_structure',
  )

  // Restore clean .aseprite, then set layer user data -> rejected with rule 'layer_structure'
  await writeFile(chkMeta.working_copy_path, cleanAse)
  await bridgeService.editAsepriteCheckout(scope, chkMeta.checkout_id, { setLayerData: 'secret_meta' })
  await assert.rejects(
    bridgeService.returnAsepriteCheckout(scope, chkMeta.checkout_id, {
      operation_id: randomUUID(),
      bridge_token: connAse.bridge_token,
    }),
    err => err.code === 'aseprite_return_invalid' && err.diagnostic?.rule === 'layer_structure',
  )

  // Create a fresh checkout, return a valid edit, then discard_only -> status() no longer revives checkout or candidate
  const chkDiscard = await bridgeService.createAsepriteCheckout(scope, {
    operation_id: randomUUID(),
    grant_id: connAse.grant_id,
    bridge_token: connAse.bridge_token,
    canvas_id: seeded.canvasId,
    expected_revision: seeded.project.revision,
    expected_working_revision: seeded.document.revision,
  })
  await bridgeService.editAsepriteCheckout(scope, chkDiscard.checkout_id, {
    fillRect: { rect: { x: 10, y: 10, w: 4, h: 4 }, color: [200, 100, 50, 255] },
    pixels: [{ x: 11, y: 11, color: [10, 240, 240, 255] }],
  })
  const retDiscard = await bridgeService.returnAsepriteCheckout(scope, chkDiscard.checkout_id, {
    operation_id: randomUUID(),
    bridge_token: connAse.bridge_token,
  })
  // Success then new ID on the same checkout rejects with 409 pixel_tool_preview_sealed
  await assert.rejects(
    bridgeService.returnAsepriteCheckout(scope, chkDiscard.checkout_id, {
      operation_id: randomUUID(),
      bridge_token: connAse.bridge_token,
    }),
    err => err.code === 'pixel_tool_preview_sealed' && err.http_status === 409,
  )
  // Wrong checkout ID and path traversal ID fail closed
  await assert.rejects(
    bridgeService.returnAsepriteCheckout(scope, 'chk_00000000000000000000000000000000', {
      operation_id: randomUUID(),
      bridge_token: connAse.bridge_token,
    }),
    err => err.code === 'aseprite_checkout_not_found' && err.http_status === 404,
  )
  await assert.rejects(
    bridgeService.returnAsepriteCheckout(scope, '../escape', {
      operation_id: randomUUID(),
      bridge_token: connAse.bridge_token,
    }),
    err => err.code === 'invalid_pixel_tool_request' && err.http_status === 400,
  )

  // Verify fillRect ran before pixels so (11,11) has the cyan pixel [10, 240, 240, 255]
  const revBeforeDiscard = await sessions.review(scope, retDiscard.session_id)
  const p11_11 = (11 * 64 + 11) * 4
  const candidateBytes = Buffer.from(revBeforeDiscard.pixel_candidate.rgba_hex, 'hex')
  assert.deepEqual([...candidateBytes.subarray(p11_11, p11_11 + 4)], [10, 240, 240, 255])

  const discardedRes = await bridgeService.revoke(scope, {
    checkout_id: chkDiscard.checkout_id,
    session_id: retDiscard.session_id,
    discard_only: true,
  })
  assert.equal(discardedRes.discarded, true)
  assert.equal(discardedRes.invalidated_sessions, 1)
  assert.equal(discardedRes.invalidated_checkouts, 1)
  const statusAfterDiscard = await bridgeService.status(scope, { canvasId: seeded.canvasId, grantId: connAse.grant_id })
  assert.equal(statusAfterDiscard.sessions.length, 0, 'discarded candidate session is not returned by status()')
  const discardedChkStatus = statusAfterDiscard.checkouts.find(c => c.checkout_id === chkDiscard.checkout_id)
  assert.equal(discardedChkStatus?.discarded, true, 'discarded checkout is marked discarded')
  const afterDiscardProj = await loadEditorProject(scope)
  const afterDiscardDoc = await getSpriteDocument({ ...scope, documentId: seeded.documentId })
  assert.equal(afterDiscardProj.project.revision, seeded.project.revision)
  assert.equal(afterDiscardDoc.manifest.revision, seeded.document.revision)
})

function findFirstCelChunkOffset(aseBuffer) {
  const oldChunks = aseBuffer.readUInt16LE(128 + 6)
  const newChunks = aseBuffer.readUInt32LE(128 + 12)
  const chunkCount = (oldChunks === 0xFFFF && newChunks > 0) ? newChunks : (newChunks || oldChunks)
  let pos = 128 + 16
  for (let i = 0; i < chunkCount; i += 1) {
    const chunkSize = aseBuffer.readUInt32LE(pos)
    const chunkType = aseBuffer.readUInt16LE(pos + 4)
    if (chunkType === 0x2005) return pos
    pos += chunkSize
  }
  throw new Error('cel_chunk_not_found')
}

test('Block 3 Cycle-3 regressions: shell-safe MCP command from /private/tmp, pre-app.open cel chunk bounds & valid cropped cel, stageExternalCandidate failure recovery, near-128MiB return quota, checkout-only discard, and native rejection matrix', async () => {
  const { projectRoot, workspaceRoot } = await makeTempWorkspace()
  // Seed a canvas where pixels outside (10,10,6,6) are transparent so a cropped 6x6 cel at (10,10) is valid
  const transparentCanvas = new Uint8Array(64 * 64 * 4)
  for (let y = 10; y < 16; y += 1) {
    for (let x = 10; x < 16; x += 1) {
      const idx = (y * 64 + x) * 4
      transparentCanvas[idx] = 20
      transparentCanvas[idx + 1] = 40
      transparentCanvas[idx + 2] = 60
      transparentCanvas[idx + 3] = 255
    }
  }
  const seeded = await seedProjectWith64x64Canvas({
    projectRoot,
    workspaceRoot,
    rgba: transparentCanvas,
    tagName: 'Idle',
  })
  const scope = { projectRoot, workspaceRoot, projectId: seeded.projectId }
  const sessions = createExternalPixelSessions()
  let nativeInspectCalls = 0
  const bridgeService = createExternalBridgeService({
    sessions,
    execImpl: async (file, args, options) => {
      if (Array.isArray(args) && args.includes('mode=inspect')) {
        nativeInspectCalls += 1
      }
      return defaultAsepriteExec(file, args, options)
    },
  })

  const api = await startTestApiServer({
    projectRoot: seeded.projectRoot,
    workspaceRoot: seeded.workspaceRoot,
    sessions,
    bridgeService,
  })

  try {
    const allowedRect = { x: 8, y: 8, w: 16, h: 16 }
    const connected = await bridgeService.connect(scope, {
      operation_id: randomUUID(),
      canvas_id: seeded.canvasId,
      expected_revision: seeded.project.revision,
      expected_working_revision: seeded.document.revision,
      rect: allowedRect,
      server_url: api.url,
    })

    // 1. Shell-safe task-scoped MCP command_line quotes spaces and runs from /private/tmp
    assert.ok(connected.codex_mcp.command_line.includes("'"), 'command_line quotes script path containing spaces')
    const parsedCmd = parseTaskScopedCodexMcpCommandLine(connected.codex_mcp.command_line)
    assert.equal(parsedCmd[0], 'node')
    assert.ok(path.isAbsolute(parsedCmd[1]), 'script path is absolute')
    const mcpChild = spawn(parsedCmd[0], parsedCmd.slice(1), {
      cwd: '/private/tmp',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const initReply = await new Promise((resolve, reject) => {
      let stdoutBuf = ''
      const timer = setTimeout(() => {
        mcpChild.kill('SIGKILL')
        reject(new Error('MCP child timed out from /private/tmp'))
      }, 5000)
      mcpChild.stdout.on('data', chunk => {
        stdoutBuf += chunk.toString('utf8')
        const nl = stdoutBuf.indexOf('\n')
        if (nl >= 0) {
          clearTimeout(timer)
          resolve(JSON.parse(stdoutBuf.slice(0, nl)))
        }
      })
      mcpChild.on('error', err => {
        clearTimeout(timer)
        reject(err)
      })
      mcpChild.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) + '\n')
    })
    mcpChild.stdin.end()
    await new Promise(resolve => mcpChild.once('close', resolve))
    assert.equal(initReply.result?.protocolVersion, '2025-11-25')

    // 2. Small-header .aseprite with oversized 4096x4096 compressed cel or negative cel offset is rejected before native app.open (0 native inspect calls)
    const chkBounds = await bridgeService.createAsepriteCheckout(scope, {
      operation_id: randomUUID(),
      grant_id: connected.grant_id,
      bridge_token: connected.bridge_token,
      canvas_id: seeded.canvasId,
      expected_revision: seeded.project.revision,
      expected_working_revision: seeded.document.revision,
    })
    const cleanAse = await readFile(chkBounds.working_copy_path)
    assert.ok(cleanAse.length < 4096, 'clean .aseprite fixture is small (< 4 KiB)')
    const celOffset = findFirstCelChunkOffset(cleanAse)

    const oversizedCelAse = Buffer.from(cleanAse)
    oversizedCelAse.writeUInt16LE(4096, celOffset + 22)
    oversizedCelAse.writeUInt16LE(4096, celOffset + 24)
    await writeFile(chkBounds.working_copy_path, oversizedCelAse)
    const inspectBeforeOversized = nativeInspectCalls
    await assert.rejects(
      bridgeService.returnAsepriteCheckout(scope, chkBounds.checkout_id, {
        operation_id: randomUUID(),
        bridge_token: connected.bridge_token,
      }),
      err => err.code === 'aseprite_return_invalid' && err.diagnostic?.rule === 'cel_structure',
    )
    assert.equal(nativeInspectCalls, inspectBeforeOversized, 'oversized cel header rejected before invoking native Aseprite')

    const negativeCelAse = Buffer.from(cleanAse)
    negativeCelAse.writeInt16LE(-2, celOffset + 8)
    await writeFile(chkBounds.working_copy_path, negativeCelAse)
    await assert.rejects(
      bridgeService.returnAsepriteCheckout(scope, chkBounds.checkout_id, {
        operation_id: randomUUID(),
        bridge_token: connected.bridge_token,
      }),
      err => err.code === 'aseprite_return_invalid' && err.diagnostic?.rule === 'cel_structure',
    )
    assert.equal(nativeInspectCalls, inspectBeforeOversized, 'negative cel offset rejected before invoking native Aseprite')

    // 3. Valid smaller cropped cel (6x6 at (10,10)) inside the 64x64 canvas is retained and decoded accurately
    await writeFile(chkBounds.working_copy_path, cleanAse)
    await bridgeService.editAsepriteCheckout(scope, chkBounds.checkout_id, {
      cropCel: { x: 10, y: 10, w: 6, h: 6, color: [30, 180, 90, 255] },
    })
    const croppedAse = await readFile(chkBounds.working_copy_path)
    const croppedCelOffset = findFirstCelChunkOffset(croppedAse)
    assert.equal(croppedAse.readInt16LE(croppedCelOffset + 8), 10)
    assert.equal(croppedAse.readInt16LE(croppedCelOffset + 10), 10)
    assert.equal(croppedAse.readUInt16LE(croppedCelOffset + 22), 6)
    assert.equal(croppedAse.readUInt16LE(croppedCelOffset + 24), 6)

    const croppedRet = await bridgeService.returnAsepriteCheckout(scope, chkBounds.checkout_id, {
      operation_id: randomUUID(),
      bridge_token: connected.bridge_token,
    })
    assert.equal(croppedRet.changed_pixels, 36)
    const croppedReview = await sessions.review(scope, croppedRet.session_id)
    const croppedRgba = Buffer.from(croppedReview.pixel_candidate.rgba_hex, 'hex')
    const p10_10 = (10 * 64 + 10) * 4
    const p0_0 = 0
    assert.deepEqual([...croppedRgba.subarray(p10_10, p10_10 + 4)], [30, 180, 90, 255])
    assert.deepEqual([...croppedRgba.subarray(p0_0, p0_0 + 4)], [0, 0, 0, 0])

    // 4. Checkout-only discard ({ checkout_id, discard_only: true } without session_id) retires both checkout and candidate session
    const discardDir = path.dirname(chkBounds.working_copy_path)
    const discardPaths = { receiptPath: path.join(discardDir, 'receipt.json'), diagnosticPath: path.join(discardDir, 'diagnostic.json') }
    const diagnosticBackup = `${discardPaths.diagnosticPath}.before-fault`
    await rename(discardPaths.diagnosticPath, diagnosticBackup)
    await mkdir(discardPaths.diagnosticPath)
    try {
      await assert.rejects(
        bridgeService.revoke(scope, { checkout_id: chkBounds.checkout_id, discard_only: true }),
        { code: 'runtime_storage_failed' },
      )
      const partialReceipt = JSON.parse(await readFile(discardPaths.receiptPath, 'utf8'))
      assert.ok(partialReceipt.discarded_at && partialReceipt.closed_at, 'receipt published before diagnostic failure')
      await assert.rejects(sessions.review(scope, croppedRet.session_id), { code: 'pixel_tool_session_expired' })
      const partialStatus = await bridgeService.status(scope, { canvasId: seeded.canvasId })
      assert.equal(partialStatus.latest_candidate, null, 'bookkeeping failure cannot revive the discarded candidate')
    } finally {
      // Keep the explicit empty fault directory in this temporary fixture; no deletion.
      await rename(discardPaths.diagnosticPath, `${discardPaths.diagnosticPath}.blocked-dir`)
      await rename(diagnosticBackup, discardPaths.diagnosticPath)
    }
    const chkOnlyDiscard = await bridgeService.revoke(scope, {
      checkout_id: chkBounds.checkout_id,
      discard_only: true,
    })
    assert.equal(chkOnlyDiscard.discarded, true)
    assert.equal(chkOnlyDiscard.invalidated_checkouts, 1)
    assert.equal(JSON.parse(await readFile(discardPaths.diagnosticPath, 'utf8')).status, 'discarded', 'retry repairs partial bookkeeping')
    await assert.rejects(
      sessions.review(scope, croppedRet.session_id),
      err => err.code === 'pixel_tool_session_expired' && err.http_status === 404,
    )
    const statusAfterChkOnlyDiscard = await bridgeService.status(scope, {
      canvasId: seeded.canvasId,
      grantId: connected.grant_id,
    })
    assert.equal(statusAfterChkOnlyDiscard.sessions.length, 0)
    assert.equal(statusAfterChkOnlyDiscard.latest_candidate, null)

    // 5. stageExternalCandidate failure (24 open sessions) finalizes return attempt, clears active_return_operation_id, replays failure on same ID, and succeeds on next ID once capacity is freed
    const chkStageFail = await bridgeService.createAsepriteCheckout(scope, {
      operation_id: randomUUID(),
      grant_id: connected.grant_id,
      bridge_token: connected.bridge_token,
      canvas_id: seeded.canvasId,
      expected_revision: seeded.project.revision,
      expected_working_revision: seeded.document.revision,
    })
    await bridgeService.editAsepriteCheckout(scope, chkStageFail.checkout_id, {
      pixels: [{ x: 10, y: 10, color: [220, 90, 40, 255] }],
    })
    const fillerSessions = []
    for (let i = 0; i < 24; i += 1) {
      const s = await sessions.create(scope, {
        operation_id: randomUUID(),
        canvas_id: seeded.canvasId,
        expected_revision: seeded.project.revision,
        expected_working_revision: seeded.document.revision,
      })
      fillerSessions.push(s.session_id)
    }
    const stageFailOpId = randomUUID()
    await assert.rejects(
      bridgeService.returnAsepriteCheckout(scope, chkStageFail.checkout_id, {
        operation_id: stageFailOpId,
        bridge_token: connected.bridge_token,
      }),
      err => err.code === 'pixel_tool_session_limit' && err.http_status === 429,
    )
    // Same operation_id replays the recorded failure without incrementing return_attempts
    await assert.rejects(
      bridgeService.returnAsepriteCheckout(scope, chkStageFail.checkout_id, {
        operation_id: stageFailOpId,
        bridge_token: connected.bridge_token,
      }),
      err => err.code === 'pixel_tool_session_limit' && err.http_status === 429,
    )
    // Free 1 session slot; next operation_id succeeds on attempt 2/3
    await sessions.call(scope, fillerSessions[0], {
      operation_id: randomUUID(),
      tool: 'close',
      arguments: {},
    })
    const stageRecovered = await bridgeService.returnAsepriteCheckout(scope, chkStageFail.checkout_id, {
      operation_id: randomUUID(),
      bridge_token: connected.bridge_token,
    })
    assert.equal(stageRecovered.return_attempts, 2)
    assert.ok(stageRecovered.session_id)
    for (const sid of fillerSessions.slice(1)) {
      await sessions.call(scope, sid, { operation_id: randomUUID(), tool: 'close', arguments: {} })
    }
    await bridgeService.revoke(scope, { checkout_id: chkStageFail.checkout_id, discard_only: true })

    // 6. Near-128MiB return quota boundary reserves workingCopyFile.size + 2 * maxSidecarBytes before writing snapshot/sidecar
    const chkQuota = await bridgeService.createAsepriteCheckout(scope, {
      operation_id: randomUUID(),
      grant_id: connected.grant_id,
      bridge_token: connected.bridge_token,
      canvas_id: seeded.canvasId,
      expected_revision: seeded.project.revision,
      expected_working_revision: seeded.document.revision,
    })
    await bridgeService.editAsepriteCheckout(scope, chkQuota.checkout_id, {
      pixels: [{ x: 11, y: 11, color: [100, 210, 90, 255] }],
    })
    const bridgeRoot = path.dirname(path.dirname(chkQuota.working_copy_path))
    let retainedBytes = 0
    for (const entry of await readdir(bridgeRoot, { withFileTypes: true })) {
      const entryPath = path.join(bridgeRoot, entry.name)
      if (entry.isFile()) retainedBytes += (await stat(entryPath)).size
      else if (entry.isDirectory()) {
        for (const child of await readdir(entryPath, { withFileTypes: true })) {
          if (child.isFile()) retainedBytes += (await stat(path.join(entryPath, child.name))).size
        }
      }
    }
    const quotaDir = path.join(bridgeRoot, chkQuota.checkout_id)
    const workingBytes = (await stat(path.join(quotaDir, 'working-copy.aseprite'))).size
    const sidecarReserve = 2 * EXTERNAL_BRIDGE_LIMITS.maxSidecarBytes
    const quotaCap = retainedBytes + workingBytes + sidecarReserve / 2
    assert.ok(retainedBytes + workingBytes <= quotaCap, 'snapshot alone fits')
    assert.ok(retainedBytes + workingBytes + sidecarReserve > quotaCap, 'sidecar reserve alone crosses the cap')
    const filesBeforeQuota = (await readdir(quotaDir)).sort()
    const inspectBeforeQuota = nativeInspectCalls
    const tightQuotaService = createExternalBridgeService({
      sessions,
      maxTotalCheckoutStorageBytes: quotaCap,
      execImpl: async (file, args, options) => {
        if (args.includes('mode=inspect')) nativeInspectCalls++
        return defaultAsepriteExec(file, args, options)
      },
    })
    await assert.rejects(
      tightQuotaService.returnAsepriteCheckout(scope, chkQuota.checkout_id, {
        operation_id: randomUUID(),
        bridge_token: connected.bridge_token,
      }),
      err => err.code === 'aseprite_storage_limit' && err.http_status === 429 && err.diagnostic?.rule === 'storage_limit',
    )
    assert.equal(nativeInspectCalls, inspectBeforeQuota, 'quota rejection precedes native parsing')
    assert.deepEqual((await readdir(quotaDir)).sort(), filesBeforeQuota, 'quota rejection creates no return snapshot')
    assert.equal((await bridgeService.status(scope, { canvasId: seeded.canvasId })).latest_candidate, null)
    assert.equal((await loadEditorProject(scope)).project.revision, seeded.project.revision)
    await bridgeService.revoke(scope, { checkout_id: chkQuota.checkout_id, discard_only: true })

    // 7. Representative native rejection matrix (corrupt receipt, oversized sidecar, truncated/oversized .aseprite, symlink, file changing during return, changed base) -> zero candidate/project mutation
    const chkMatrix = await bridgeService.createAsepriteCheckout(scope, {
      operation_id: randomUUID(),
      grant_id: connected.grant_id,
      bridge_token: connected.bridge_token,
      canvas_id: seeded.canvasId,
      expected_revision: seeded.project.revision,
      expected_working_revision: seeded.document.revision,
    })
    const chkDir = path.dirname(chkMatrix.working_copy_path)
    const receiptPath = path.join(chkDir, 'receipt.json')
    const diagPath = path.join(chkDir, 'diagnostic.json')
    const savedReceiptBytes = await readFile(receiptPath)
    const savedAseBytes = await readFile(chkMatrix.working_copy_path)

    // 7a. Corrupt receipt.json
    await writeFile(receiptPath, '{corrupt_receipt')
    await assert.rejects(
      bridgeService.returnAsepriteCheckout(scope, chkMatrix.checkout_id, {
        operation_id: randomUUID(),
        bridge_token: connected.bridge_token,
      }),
      err => err.code === 'aseprite_return_invalid' && err.http_status === 422 && err.diagnostic?.rule === 'corrupt_receipt',
    )
    await writeFile(receiptPath, savedReceiptBytes)

    // 7b. Tampered oversized sidecar (> 16 KiB)
    await writeFile(receiptPath, ' '.repeat(EXTERNAL_BRIDGE_LIMITS.maxSidecarBytes + 128))
    await assert.rejects(
      bridgeService.returnAsepriteCheckout(scope, chkMatrix.checkout_id, {
        operation_id: randomUUID(),
        bridge_token: connected.bridge_token,
      }),
      err => err.code === 'aseprite_return_invalid' && err.http_status === 422 && err.diagnostic?.rule === 'file_size_limit',
    )
    await writeFile(receiptPath, savedReceiptBytes)
    await unlink(diagPath).catch(() => {})

    // 7c. Truncated (< 128 bytes) and oversized (> 8 MiB) .aseprite files
    await writeFile(chkMatrix.working_copy_path, savedAseBytes.subarray(0, 64))
    await assert.rejects(
      bridgeService.returnAsepriteCheckout(scope, chkMatrix.checkout_id, {
        operation_id: randomUUID(),
        bridge_token: connected.bridge_token,
      }),
      err => err.code === 'aseprite_return_invalid' && err.http_status === 422 && err.diagnostic?.rule === 'file_truncated',
    )
    await writeFile(chkMatrix.working_copy_path, Buffer.alloc(EXTERNAL_BRIDGE_LIMITS.maxAsepriteFileBytes + 64))
    await assert.rejects(
      bridgeService.returnAsepriteCheckout(scope, chkMatrix.checkout_id, {
        operation_id: randomUUID(),
        bridge_token: connected.bridge_token,
      }),
      err => err.code === 'aseprite_return_invalid' && err.http_status === 422 && err.diagnostic?.rule === 'file_size_limit',
    )

    // 7d. Symlink replacing working-copy.aseprite
    const outsideTarget = path.join(projectRoot, 'outside.aseprite')
    await writeFile(outsideTarget, savedAseBytes)
    await unlink(chkMatrix.working_copy_path)
    await symlink(outsideTarget, chkMatrix.working_copy_path)
    await assert.rejects(
      bridgeService.returnAsepriteCheckout(scope, chkMatrix.checkout_id, {
        operation_id: randomUUID(),
        bridge_token: connected.bridge_token,
      }),
      err => err.code === 'aseprite_return_invalid' && err.http_status === 422 && err.diagnostic?.rule === 'unsafe_path',
    )
    await unlink(chkMatrix.working_copy_path)
    await writeFile(chkMatrix.working_copy_path, savedAseBytes)

    // 7e. File changing during return (working-copy.aseprite mutated while native inspect runs)
    const chkRace = await bridgeService.createAsepriteCheckout(scope, {
      operation_id: randomUUID(),
      grant_id: connected.grant_id,
      bridge_token: connected.bridge_token,
      canvas_id: seeded.canvasId,
      expected_revision: seeded.project.revision,
      expected_working_revision: seeded.document.revision,
    })
    await bridgeService.editAsepriteCheckout(scope, chkRace.checkout_id, {
      pixels: [{ x: 12, y: 12, color: [190, 50, 190, 255] }],
    })
    const raceService = createExternalBridgeService({
      sessions,
      execImpl: async (file, args, options) => {
        const res = await defaultAsepriteExec(file, args, options)
        if (Array.isArray(args) && args.includes('mode=inspect')) {
          await writeFile(chkRace.working_copy_path, savedAseBytes)
        }
        return res
      },
    })
    await assert.rejects(
      raceService.returnAsepriteCheckout(scope, chkRace.checkout_id, {
        operation_id: randomUUID(),
        bridge_token: connected.bridge_token,
      }),
      err => err.code === 'aseprite_return_invalid' && err.http_status === 422 && err.diagnostic?.rule === 'file_changed_during_return',
    )

    // 7f. Changed base (canvas modified in VNext after checkout)
    const mutatedPixels = new Uint8Array(transparentCanvas)
    mutatedPixels[(10 * 64 + 10) * 4] = 99
    await writeWorkingPixels({
      ...scope,
      documentId: seeded.documentId,
      operationId: randomUUID(),
      expectedRevision: seeded.project.revision,
      expectedWorkingRevision: seeded.document.revision,
      rect: { x: 0, y: 0, w: 64, h: 64 },
      rgba: Buffer.from(mutatedPixels),
      expectedSha256: sha256Hex(mutatedPixels),
      target: { frame_id: seeded.frameId, layer_id: seeded.layerId, cel_id: seeded.celId },
    })
    await assert.rejects(
      bridgeService.returnAsepriteCheckout(scope, chkRace.checkout_id, {
        operation_id: randomUUID(),
        bridge_token: connected.bridge_token,
      }),
      err => err.code === 'pixel_tool_context_changed' && err.http_status === 409,
    )
    assert.equal(sessions.listForCanvas(scope, seeded.canvasId).length, 0, 'no candidate session left staged after rejection matrix')
  } finally {
    await api.close()
  }
})
