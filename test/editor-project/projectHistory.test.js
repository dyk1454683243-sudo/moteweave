import test from 'node:test'
import http from 'node:http'
import { spawn } from 'node:child_process'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, readdir, stat, rename, symlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { historyFixture, pixelRequest, writeWorkingPixels, inlineHistoryFixture } from '../helpers/projectHistoryFixture.js'
import { createProjectHistoryIndex, documentHistoryKey, resetProjectHistoryCache, projectHistoryStatistics,
  readHistoryBytes, writeHistoryBytes } from '../../src/editor-project/projectHistoryIndex.js'
import { lookupProjectReceipt, lookupProjectRevision, prepareHistoryProject } from '../../src/editor-project/projectHistoryStore.js'
import { handleEditorProjectApi, createEditorArtifactAccessRegistry } from '../../src/editor-project/apiHandler.js'
import { resolveEditorProjectPaths } from '../../src/editor-project/paths.js'
import { loadEditorProject } from '../../src/editor-project/projectStore.js'
import { createEditorProjectV1, getSpriteDocument, saveCanvasLayout, detachCanvas, restoreCanvas } from '../../src/editor-project/spriteDocumentStore.js'
import { sha256Bytes } from '../../src/editor-project/spriteDocumentValidation.js'
import { serializeEditorProject } from '../../src/editor-project/serializer.js'
import * as documentStore from '../../src/editor-project/spriteDocumentStore.js'

test('page depth/range boundaries, missing files, symlinks and unpublished roots fail closed', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'history-boundary-'))
  const paths = resolveEditorProjectPaths({ projectId: 'project_boundary', projectRoot: root })
  await mkdir(paths.projectDir, { recursive: true })
  const tree = createProjectHistoryIndex(paths, 'receipts')
  const value = 'a'.repeat(64)
  const page = async (level, entries) => writeHistoryBytes(paths, 'pages',
    Buffer.from(JSON.stringify({ version: 'editor_history_page_v1', tree: 'receipts', level, entries })))
  const first = await page(0, [['a', value]])
  const unpublished = await tree.put(first, 'b', value)
  assert.equal(await tree.get(first, 'b'), null)
  assert.equal(await tree.get(unpublished, 'b'), value)
  let deepest = first
  for (let level = 1; level <= 7; level++) deepest = await page(level, [['a', deepest]])
  assert.equal(await tree.get(deepest, 'a'), value)
  const invalidDepth = await page(8, [['a', deepest]])
  await assert.rejects(tree.get(invalidDepth, 'a'), { code: 'artifact_integrity_failed' })
  const badRange = await page(1, [['b', first]])
  await assert.rejects(tree.get(badRange, 'a'), { code: 'artifact_integrity_failed' })
  await assert.rejects(tree.get('f'.repeat(64), 'a'), { code: 'artifact_integrity_failed' })
  await assert.rejects(tree.get('../escape', 'a'), { code: 'artifact_integrity_failed' })
  const file = path.join(paths.projectDir, 'history-v2/pages', first + '.json')
  await rename(file, file + '.retained')
  await symlink(file + '.retained', file)
  await assert.rejects(tree.get(first, 'a'), { code: 'artifact_integrity_failed' })
})

test('first migration serializes competing writes and retains detached documents and recovery receipts', async () => {
  const { root, result } = await historyFixture()
  const paths = resolveEditorProjectPaths({ projectId: result.project.id, projectRoot: root })
  const source = Object.values(result.project.canvases).find(c => c.id !== result.canvas.id)
  const operationId = randomUUID()
  const detached = await detachCanvas({ projectRoot: root, projectId: result.project.id,
    canvasId: source.id, operationId, expectedRevision: result.project.revision,
    payload: { action: 'detach_canvas', operation_id: operationId, expected_revision: result.project.revision, canvas_id: source.id } })
  const v1 = await inlineHistoryFixture(detached.project, root)
  const original = Buffer.from(serializeEditorProject(v1))
  await writeFile(paths.projectJson, original)
  const requests = [33, 44].map(value => pixelRequest(root, { ...result, project: v1 }, value))
  const outcomes = await Promise.allSettled(requests.map(request => writeWorkingPixels(request)))
  assert.equal(outcomes.filter(item => item.status === 'fulfilled').length, 1)
  assert.equal(outcomes.find(item => item.status === 'rejected').reason.code, 'stale_revision')
  const saved = outcomes.find(item => item.status === 'fulfilled').value
  assert.equal(saved.project.revision, v1.revision + 1)
  assert.ok(saved.project.sprite_documents[source.document_id])
  for (const [id, receipt] of Object.entries(v1.operation_receipts)) {
    assert.deepEqual(await lookupProjectReceipt(saved.project, id, { projectRoot: root }), receipt)
  }
  for (const [id, document] of Object.entries(v1.sprite_documents)) {
    for (const [revision, record] of Object.entries(document.revisions)) {
      assert.deepEqual(await lookupProjectRevision(saved.project, id, Number(revision), { projectRoot: root }), record)
    }
  }
  assert.equal(sha256Bytes(await readHistoryBytes(paths, 'legacy', saved.project.history.legacy_backup)), sha256Bytes(original))
  const restoreId = randomUUID()
  const restored = await restoreCanvas({ projectRoot: root, projectId: saved.project.id, canvasId: source.id,
    operationId: restoreId, expectedRevision: saved.project.revision, detachOperationId: operationId,
    payload: { action: 'restore_canvas', operation_id: restoreId, expected_revision: saved.project.revision,
      canvas_id: source.id, detach_operation_id: operationId } })
  assert.deepEqual(restored.project.canvases[source.id], source)
})

async function filesAt(dir) {
  const files = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...await filesAt(file))
    else files.push([file, (await stat(file)).size])
  }
  return files
}

test('bounded history index splits, preserves old roots, and fails closed on corrupt cold reads', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'history-index-'))
  const paths = resolveEditorProjectPaths({ projectId: 'project_test', projectRoot: root })
  await mkdir(paths.projectDir, { recursive: true })
  const tree = createProjectHistoryIndex(paths, 'receipts')
  let head = null, early
  const keys = Array.from({ length: 80 }, (_, i) => String(i).padStart(8, '0'))
  for (const key of keys) {
    head = await tree.put(head, key, sha256Bytes(Buffer.from(key)))
    if (key === keys[20]) early = head
  }
  for (const i of [0, 20, 51, 79]) assert.equal(await tree.get(head, keys[i]), sha256Bytes(Buffer.from(keys[i])))
  assert.equal(await tree.get(early, keys[79]), null)
  let count = 0
  for await (const entry of tree.entries(head)) { assert.equal(entry[0], keys[count]); count++ }
  assert.equal(count, 80)
  const traverse = async budget => { for await (const entry of tree.entries(head, budget)) assert.ok(entry) }
  await assert.rejects(traverse({ maxRecords: 79 }), { code: 'resource_limit' })
  await assert.rejects(traverse({ maxPages: 1 }), { code: 'resource_limit' })
  assert.ok(projectHistoryStatistics().cacheBytes <= 8 * 1024 * 1024)
  await assert.rejects(tree.put(head, keys[0], 'f'.repeat(64)), { code: 'artifact_integrity_failed' })
  await assert.rejects(writeHistoryBytes(paths, 'pages', Buffer.alloc(16385)), { code: 'resource_limit' })
  const pageFile = path.join(paths.projectDir, 'history-v2', 'pages', head + '.json')
  await writeFile(pageFile, '{}')
  await assert.rejects(tree.get(head, keys[0]), { code: 'artifact_integrity_failed' })
  const input = Buffer.from('unchanged')
  const hash = await writeHistoryBytes(paths, 'records', input)
  input.fill(0)
  assert.equal((await readHistoryBytes(paths, 'records', hash)).toString(), 'unchanged')
  resetProjectHistoryCache()
  await assert.rejects(tree.get(head, keys[0]), { code: 'artifact_integrity_failed' })
})

test('new projects use a small v2 root and retain every revision and complete receipt', async () => {
  const fixture = await historyFixture()
  let result = fixture.result
  const paths = resolveEditorProjectPaths({ projectId: result.project.id, projectRoot: fixture.root })
  assert.equal(result.project.version, 'editor_project_v2')
  assert.equal(result.project.operation_receipts, undefined)
  const requests = []
  for (let value = 1; value <= 12; value++) {
    const request = pixelRequest(fixture.root, result, value)
    requests.push(request)
    result = await writeWorkingPixels(request)
    assert.equal(result.project.sprite_documents[request.documentId].revisions, undefined)
  }
  resetProjectHistoryCache()
  const loaded = await loadEditorProject({ projectId: result.project.id, projectRoot: fixture.root })
  for (const request of [requests[0], requests[6], requests[11]]) {
    const replay = await writeWorkingPixels(request)
    assert.equal(replay.replayed, true)
    assert.equal(replay.project.revision, result.project.revision)
    await assert.rejects(writeWorkingPixels({ ...request, payload: { ...request.payload, x: 1 } }), { code: 'operation_conflict' })
  }
  const doc = await getSpriteDocument({ projectId: result.project.id, documentId: result.document.document_id, revision: 1, projectRoot: fixture.root })
  assert.equal(doc.revision, 1)
  const createReplay = await createEditorProjectV1({ projectRoot: fixture.root, operationId: fixture.createId, payload: fixture.createPayload })
  assert.equal(createReplay.replayed, true)
  const rootSize = (await stat(paths.projectJson)).size
  assert.ok(rootSize < 10000)
  assert.equal(loaded.project.revision, result.project.revision)
})

test('v1 read is byte-preserving; first mutation migrates complete history and exact backup once', async () => {
  const { root, result } = await historyFixture()
  const paths = resolveEditorProjectPaths({ projectId: result.project.id, projectRoot: root })
  const v1 = structuredClone(result.project)
  v1.version = 'editor_project_v1'
  v1.operation_receipts = {}
  const receiptIndex = createProjectHistoryIndex(paths, 'receipts')
  for await (const [id] of receiptIndex.entries(result.project.history.receipts)) {
    v1.operation_receipts[id] = await lookupProjectReceipt(result.project, id, { projectRoot: root })
  }
  for (const [id, doc] of Object.entries(v1.sprite_documents)) {
    v1.sprite_documents[id] = { id, working_revision: doc.working_revision, accepted_revision: doc.working_revision,
      revisions: { [doc.working_revision]: doc.working } }
  }
  delete v1.history
  const largeDocument = Object.values(v1.sprite_documents)[0]
  largeDocument.revisions[1].legacy_annotation = 'preserve'.repeat(5000)
  // Full recovery receipts may legally exceed a page. Their payload is not projected.
  const extraId = randomUUID()
  v1.operation_receipts[extraId] = { operation_id: extraId, project_id: v1.id, project_revision: 1,
    payload_sha256: 'a'.repeat(64), document_id: null, document_revision: null, detached_canvas: { name: 'x'.repeat(20000) } }
  const original = Buffer.from(serializeEditorProject(v1))
  await writeFile(paths.projectJson, original)
  assert.equal((await loadEditorProject({ projectId: v1.id, projectRoot: root })).project.version, 'editor_project_v1')
  assert.deepEqual(await readFile(paths.projectJson), original)
  const request = pixelRequest(root, { ...result, project: v1 }, 55)
  await assert.rejects(writeWorkingPixels({ ...request, fault: 'index' }), { code: 'storage_commit_failed' })
  assert.deepEqual(await readFile(paths.projectJson), original)
  const firstFiles = await filesAt(paths.projectDir)
  await assert.rejects(writeWorkingPixels({ ...request, fault: 'index', now: new Date(Date.now() + 1000) }), { code: 'storage_commit_failed' })
  assert.deepEqual(await filesAt(paths.projectDir), firstFiles)
  const saved = await writeWorkingPixels(request)
  assert.equal(saved.project.version, 'editor_project_v2')
  assert.equal(saved.project.revision, v1.revision + 1)
  assert.deepEqual(await readHistoryBytes(paths, 'legacy', saved.project.history.legacy_backup), original)
  for (const [id, receipt] of Object.entries(v1.operation_receipts)) {
    assert.deepEqual(await lookupProjectReceipt(saved.project, id, { projectRoot: root }), receipt)
  }
  for (const [id, doc] of Object.entries(v1.sprite_documents)) {
    assert.deepEqual(await lookupProjectRevision(saved.project, id, 1, { projectRoot: root }), doc.revisions[1])
    assert.equal(saved.project.sprite_documents[id].accepted_revision, 1)
  }
})

test('failed preparation leaves old root; lost ACK replays exactly once after cache reset', async () => {
  const { root, result } = await historyFixture()
  const paths = resolveEditorProjectPaths({ projectId: result.project.id, projectRoot: root })
  const before = await readFile(paths.projectJson)
  const request = pixelRequest(root, result, 100)
  for (const fault of ['history_records', 'history_pages', 'history_sync', 'index']) {
    await assert.rejects(writeWorkingPixels({ ...request, fault }))
    assert.deepEqual(await readFile(paths.projectJson), before)
  }
  await assert.rejects(writeWorkingPixels({ ...request, fault: 'ack' }), error => error.details?.committed === true)
  resetProjectHistoryCache()
  const replay = await writeWorkingPixels(request)
  assert.equal(replay.replayed, true)
  assert.equal(replay.project.revision, result.project.revision + 1)
  const id = Object.keys(replay.project.canvases)[0], operationId = randomUUID()
  const updated = await saveCanvasLayout({ projectRoot: root, projectId: replay.project.id, operationId,
    expectedRevision: replay.project.revision, positions: [{ canvas_id: id, x: 7, y: 8 }],
    payload: { operation_id: operationId, expected_revision: replay.project.revision, positions: [{ canvas_id: id, x: 7, y: 8 }] } })
  assert.equal(updated.project.history.revisions, replay.project.history.revisions)
  assert.equal(updated.project.canvases[id].x, 7)
})

test('an existing v2 head cannot be recreated when missing or drop a historical document', async () => {
  const { root, result } = await historyFixture()
  const paths = resolveEditorProjectPaths({ projectId: result.project.id, projectRoot: root })
  const next = structuredClone(result.project)
  next.revision++
  const id = Object.keys(next.sprite_documents)[0]
  delete next.sprite_documents[id]
  await assert.rejects(prepareHistoryProject(paths, next), { code: 'artifact_integrity_failed' })
  await rename(paths.projectJson, paths.projectJson + '.retained')
  await assert.rejects(prepareHistoryProject(paths, { ...result.project, revision: result.project.revision + 1 }), { code: 'artifact_integrity_failed' })
})

test('hash-valid malformed records and an oversized compact root fail with typed errors', async () => {
  const { root, result } = await historyFixture()
  const paths = resolveEditorProjectPaths({ projectId: result.project.id, projectRoot: root })
  const original = await readFile(paths.projectJson)
  const invalidRecord = await writeHistoryBytes(paths, 'records', Buffer.from('null\n'))
  const tree = createProjectHistoryIndex(paths, 'revisions')
  const entries = []
  const key = documentHistoryKey(result.document.document_id, result.document.revision)
  for await (const [id, hash] of tree.entries(result.project.history.revisions)) entries.push([id, id === key ? invalidRecord : hash])
  const broken = structuredClone(result.project)
  broken.history.revisions = await tree.build(entries)
  await writeFile(paths.projectJson, serializeEditorProject(broken))
  const brokenBytes = await readFile(paths.projectJson)
  await assert.rejects(lookupProjectRevision(broken, result.document.document_id, result.document.revision, { projectRoot: root }),
    { code: 'artifact_integrity_failed' })
  await assert.rejects(prepareHistoryProject(paths, { ...broken, revision: broken.revision + 1 }),
    { code: 'artifact_integrity_failed' })
  assert.deepEqual(await readFile(paths.projectJson), brokenBytes)
  const oversized = { ...result.project, name: 'x'.repeat(2 * 1024 * 1024) }
  assert.throws(() => serializeEditorProject(oversized), { code: 'resource_limit' })
  await writeFile(paths.projectJson, original)
})

async function historyChild(script) {
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = '', stderr = '', timedOut = false
  const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, 5000)
  child.stdout.on('data', bytes => { stdout += bytes; if (stdout.length > 4096) child.kill('SIGKILL') })
  child.stderr.on('data', bytes => { stderr += bytes; if (stderr.length > 4096) child.kill('SIGKILL') })
  const outcome = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => resolve({ code, signal, stdout, stderr }))
  }).finally(() => clearTimeout(timer))
  assert.equal(timedOut, false, 'cold history child must finish within 5 seconds')
  return outcome
}

test('cold restart after injected faults and in-flight publication termination preserves v1 migration and v2 receipts', async () => {
  const store = new URL('../../src/editor-project/spriteDocumentStore.js', import.meta.url).href
  const projectStore = new URL('../../src/editor-project/projectStore.js', import.meta.url).href
  const history = new URL('../../src/editor-project/projectHistoryStore.js', import.meta.url).href
  for (const [version, fault, committed, uncertainDependency = false] of [
    ['v1', 'history_legacy', false], ['v1', 'index_sync', true],
    ['v1', 'history_records', false], ['v1', 'history_pages', false],
    ['v2', 'history_sync', false], ['v2', 'block', false],
    ['v2', 'manifest', false], ['v2', 'block_sync', false, true],
    ['v2', 'manifest_sync', false, true], ['v2', 'dirsync', false],
    ['v2', 'index', false], ['v2', 'ack', true],
    ['v1', 'kill_before_rename', false], ['v2', 'kill_after_rename', true],
  ]) {
    const { root, result } = await historyFixture()
    const paths = resolveEditorProjectPaths({ projectId: result.project.id, projectRoot: root })
    if (version === 'v1') {
      result.project = await inlineHistoryFixture(result.project, root)
      await writeFile(paths.projectJson, serializeEditorProject(result.project))
    }
    const original = await readFile(paths.projectJson)
    const request = pixelRequest(root, result, 145)
    const requestSource = 'const request = ' + JSON.stringify(request) + '; request.rgba = Buffer.from(request.rgba.data);'
    const killed = await historyChild(`
      import fs from 'node:fs/promises';
      import { syncBuiltinESMExports } from 'node:module';
      const originalRename = fs.rename;
      fs.rename = async (...args) => {
        if (args[1] === ${JSON.stringify(paths.projectJson)} && ${JSON.stringify(fault)} === 'kill_before_rename') process.kill(process.pid, 'SIGKILL');
        const value = await originalRename(...args);
        if (args[1] === ${JSON.stringify(paths.projectJson)} && ${JSON.stringify(fault)} === 'kill_after_rename') process.kill(process.pid, 'SIGKILL');
        return value;
      };
      syncBuiltinESMExports();
      import { writeWorkingPixels } from ${JSON.stringify(store)};
      ${requestSource}
      try { await writeWorkingPixels({ ...request, fault: ${JSON.stringify(fault)} }); process.exit(31); }
      catch (error) {
        if (error.code !== 'storage_commit_failed' || Boolean(error.details?.committed) !== ${committed || uncertainDependency}) process.exit(32);
        process.kill(process.pid, 'SIGKILL');
      }
    `)
    assert.equal(killed.signal, 'SIGKILL', killed.stderr || fault)
    if (!committed) assert.deepEqual(await readFile(paths.projectJson), original)
    const restarted = await historyChild(`
      import { writeWorkingPixels, getSpriteDocument } from ${JSON.stringify(store)};
      import { loadEditorProject } from ${JSON.stringify(projectStore)};
      import { lookupProjectReceipt } from ${JSON.stringify(history)};
      ${requestSource}
      const options = { projectRoot: request.projectRoot, projectId: request.projectId };
      const before = (await loadEditorProject(options)).project;
      const receipt = await lookupProjectReceipt(before, request.operationId, options);
      const saved = await writeWorkingPixels(request);
      const current = await getSpriteDocument({ ...options, documentId: request.documentId });
      const oldest = await getSpriteDocument({ ...options, documentId: request.documentId, revision: 1 });
      process.stdout.write(JSON.stringify({ before: before.revision, hadReceipt: Boolean(receipt),
        revision: saved.project.revision, replayed: saved.replayed, version: saved.project.version,
        current: current.revision, oldest: oldest.revision }));
    `)
    assert.equal(restarted.code, 0, restarted.stderr)
    const report = JSON.parse(restarted.stdout)
    assert.equal(report.before, result.project.revision + Number(committed))
    assert.equal(report.hadReceipt, committed)
    assert.equal(report.replayed, committed)
    assert.equal(report.revision, result.project.revision + 1)
    assert.equal(report.version, 'editor_project_v2')
    assert.equal(report.current, request.expectedWorkingRevision + 1)
    assert.equal(report.oldest, 1)
  }
})

test('multi-generation legacy migration retains receipt shapes and rejects corrupt non-current history', async () => {
  const fixture = await historyFixture()
  const { root } = fixture
  let result = fixture.result
  const options = { projectRoot: root, projectId: result.project.id }
  const paths = resolveEditorProjectPaths(options)
  const first = pixelRequest(root, result, 61)
  result = await writeWorkingPixels(first)
  result = await writeWorkingPixels(pixelRequest(root, result, 99))
  const documentId = result.document.document_id, canvasId = fixture.result.canvas.id
  let operationId = randomUUID()
  result = await documentStore.changeWorkingStructure({ ...options, documentId, operationId,
    expectedRevision: result.project.revision, expectedWorkingRevision: result.document.revision,
    command: { type: 'add-layer', name: 'History layer' },
    payload: { action: 'structure', operation_id: operationId } })
  operationId = randomUUID()
  result = await documentStore.restoreWorkingSpriteDocument({ ...options, documentId, operationId,
    expectedRevision: result.project.revision, expectedWorkingRevision: result.document.revision, targetRevision: 1,
    mode: 'structure', payload: { action: 'restore_working', operation_id: operationId, target_revision: 1, mode: 'structure' } })
  const manifest = result.document
  result = await documentStore.saveProjectPalette({ ...options, operationId: randomUUID(),
    expectedRevision: result.project.revision, colors: [[17, 34, 51, 255]] })
  for (const [action, method, extra] of [
    ['rename', documentStore.renameCanvas, { displayName: 'Renamed' }],
    ['reset', documentStore.resetCanvasName, {}],
    ['layout', documentStore.saveCanvasLayout, { positions: [{ canvas_id: canvasId, x: 8, y: 12 }] }],
  ]) {
    operationId = randomUUID()
    result = await method({ ...options, canvasId, operationId, expectedRevision: result.project.revision,
      ...extra, payload: { action, operation_id: operationId } })
  }
  const v1 = await inlineHistoryFixture(result.project, root)
  v1.sprite_documents[documentId].accepted_revision = 2
  const original = Buffer.from(serializeEditorProject(v1))
  await writeFile(paths.projectJson, original)
  const old = await getSpriteDocument({ ...options, documentId, revision: 3 })
  const blockHash = Object.values(old.manifest.cels).find(c => c.block).block.sha256
  // Test the actual paths produced by the store rather than inventing history.
  const documentPaths = (await import('../../src/editor-project/paths.js')).resolveSpriteDocumentPaths({ ...options, documentId })
  const { spriteDocumentRevisionPath, spriteDocumentBlockPath } = await import('../../src/editor-project/paths.js')
  for (const file of [spriteDocumentRevisionPath(documentPaths, 3), spriteDocumentBlockPath(documentPaths, blockHash)]) {
    const bytes = await readFile(file)
    await writeFile(file, Buffer.from('corrupt'))
    await assert.rejects(writeWorkingPixels(pixelRequest(root, { project: v1, document: manifest }, 144)),
      { code: 'artifact_integrity_failed' })
    assert.deepEqual(await readFile(paths.projectJson), original)
    await writeFile(file, bytes)
  }
  const beforeReplay = await writeWorkingPixels(first)
  assert.equal(beforeReplay.replayed, true)
  assert.deepEqual(await readFile(paths.projectJson), original)
  const migrated = await writeWorkingPixels(pixelRequest(root, { project: v1, document: manifest }, 155))
  assert.equal(migrated.project.revision, v1.revision + 1)
  for (const [id, doc] of Object.entries(v1.sprite_documents)) {
    for (const [revision, record] of Object.entries(doc.revisions)) {
      assert.deepEqual(await lookupProjectRevision(migrated.project, id, Number(revision), options), record)
    }
  }
  for (const [id, receipt] of Object.entries(v1.operation_receipts)) {
    assert.deepEqual(await lookupProjectReceipt(migrated.project, id, options), receipt)
  }
  assert.equal(migrated.project.sprite_documents[documentId].accepted_revision, 2)
  assert.notEqual(migrated.project.sprite_documents[documentId].working_revision, 2)
  assert.equal((await writeWorkingPixels(first)).replayed, true)
})

test('near-limit legacy history upgrades before old-root growth and preserves complete large receipts', async () => {
  const { root, result, createId, createPayload } = await historyFixture()
  const paths = resolveEditorProjectPaths({ projectId: result.project.id, projectRoot: root })
  const v1 = await inlineHistoryFixture(result.project, root)
  const receipt = v1.operation_receipts[createId]
  receipt.retained_detail = ''
  const overhead = Buffer.byteLength(serializeEditorProject(v1))
  receipt.retained_detail = 'a'.repeat(2 * 1024 * 1024 - overhead - 16)
  const original = Buffer.from(serializeEditorProject(v1))
  await writeFile(paths.projectJson, original)
  assert.equal(original.length, 2 * 1024 * 1024 - 16)
  const replay = await createEditorProjectV1({ projectRoot: root, operationId: createId, payload: createPayload })
  assert.equal(replay.replayed, true)
  assert.equal(replay.project.version, 'editor_project_v1')
  assert.deepEqual(await readFile(paths.projectJson), original)
  const saved = await writeWorkingPixels(pixelRequest(root, { ...result, project: v1 }, 222))
  assert.equal(saved.project.revision, v1.revision + 1)
  assert.ok((await stat(paths.projectJson)).size < 10000)
  assert.deepEqual(await lookupProjectReceipt(saved.project, createId, { projectRoot: root }), receipt)
})

test('capability header rejects a stale client before writes and accepted v2 state remains readable', { timeout: 10000 }, async () => {
  const { root, result } = await historyFixture()
  const paths = resolveEditorProjectPaths({ projectId: result.project.id, projectRoot: root })
  const original = await readFile(paths.projectJson)
  const artifactAccessRegistry = createEditorArtifactAccessRegistry()
  const server = http.createServer((req, res) => {
    handleEditorProjectApi(req, res, { projectRoot: root, artifactAccessRegistry }).catch(() => {
      res.writeHead(500); res.end()
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = 'http://127.0.0.1:' + server.address().port
  try {
    const body = { operation_id: randomUUID(), expected_revision: result.project.revision,
      positions: [{ canvas_id: Object.keys(result.project.canvases)[0], x: 12, y: 13 }] }
    const request = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000) }
    const url = base + '/api/editor/projects/' + result.project.id + '/canvas-layout'
    for (const capability of [null, '1', 'unknown']) {
      const response = await fetch(url, { ...request, headers: { ...request.headers,
        ...(capability === null ? {} : { 'X-Editor-Storage-Version': capability }) } })
      assert.equal(response.status, 409)
      assert.equal((await response.json()).error, 'unsupported_project_writer')
      assert.deepEqual(await readFile(paths.projectJson), original)
    }
    const saved = await fetch(url, { ...request, headers: { ...request.headers, 'X-Editor-Storage-Version': '2' } })
    assert.equal(saved.status, 200)
    const savedBody = await saved.json()
    assert.equal(savedBody.project.version, 'editor_project_v2')
    assert.equal(savedBody.project.operation_receipts, undefined)
    const reread = await fetch(base + '/api/editor/projects/' + result.project.id)
    assert.equal(reread.status, 200)
  } finally {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
})
