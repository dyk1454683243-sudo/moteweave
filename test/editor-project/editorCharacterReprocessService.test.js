import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rename, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  CHARACTER_REPROCESS_INTEGRITY_FILES,
  CHARACTER_REPROCESS_OPTIONAL_INTEGRITY_FILES,
  createCharacterReprocessService,
  writeCharacterReprocessEvidence,
} from '../../src/editor-project/characterReprocessService.js'
import * as editorProject from '../../src/editor-project/index.js'

const CREATED_AT = '2026-07-10T00:00:00.000Z'
const RECIPE_HASH = 'a'.repeat(64)
const SETTINGS_HASH = 'b'.repeat(64)

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

async function tempRoot(label = 'editor-character-reprocess-') {
  return mkdtemp(path.join(os.tmpdir(), label))
}

function createHarness({
  jobId = 'job_editor_reprocess',
  createdAt = CREATED_AT,
  extraCreatedFields = {},
} = {}) {
  const jobs = new Map()
  const createCalls = []
  const updates = []
  const tasks = []
  return {
    jobs,
    createCalls,
    updates,
    tasks,
    createJob(initial) {
      createCalls.push(initial)
      const job = {
        id: jobId,
        status: 'queued',
        created_at: createdAt,
        ...initial,
        ...extraCreatedFields,
      }
      jobs.set(job.id, job)
      return job
    },
    getJob(id) {
      return jobs.get(id) ?? null
    },
    updateJob(id, patch) {
      updates.push(structuredClone(patch))
      const current = jobs.get(id)
      if (!current) return null
      const next = { ...current, ...patch, updated_at: '2026-07-10T00:00:01.000Z' }
      jobs.set(id, next)
      return next
    },
    jobQueue: {
      enqueue(task, onError) {
        tasks.push({ task, onError })
      },
    },
  }
}

function baseContext(overrides = {}) {
  return {
    version: 'editor_reprocess_context_v0',
    project_id: 'project_demo',
    project_revision: 4,
    asset_id: 'asset_hero',
    parent_revision_id: 'rev_003',
    input_mode: 'managed_source',
    input_artifact_key: 'source',
    input_artifact_ref: 'workspace/projects/project_demo/assets/asset_hero/rev_003/source.png',
    input_artifact_sha256: sha256(Buffer.from('source-before')),
    black_matte_artifact_sha256: null,
    authoritative_source_layout: 'topdown_rpg_v0',
    recipe_hash: RECIPE_HASH,
    draft_settings_hash: SETTINGS_HASH,
    implementation_revision: 'package-0.4.0',
    ...overrides,
  }
}

function baseRecipe({ blackMatteRef = null } = {}) {
  return {
    version: 'processing_recipe_v0',
    source: {
      asset_id: 'asset_hero',
      source_job_id: 'job_parent',
      source_layout: 'topdown_rpg_v0',
      black_matte_artifact_ref: blackMatteRef,
    },
    nested: { marker: 'recipe-before' },
  }
}

function baseInput({ blackSourceBuffer = null, blackMatteRef = null } = {}) {
  return {
    sourceBuffer: Buffer.from('source-before'),
    processOptions: {
      createdAt: 'client-value-must-not-win',
      blackSourceBuffer,
      nested: { marker: 'options-before' },
    },
    canonicalRecipe: baseRecipe({ blackMatteRef }),
    reprocessContextBase: baseContext({
      black_matte_artifact_sha256: blackMatteRef && Buffer.isBuffer(blackSourceBuffer)
        ? sha256(blackSourceBuffer)
        : null,
      nested: { marker: 'context-before' },
    }),
    blackSourceBuffer,
  }
}

function manifestFor({ hasBlackMatte = false } = {}) {
  const files = hasBlackMatte
    ? { ...CHARACTER_REPROCESS_INTEGRITY_FILES, ...CHARACTER_REPROCESS_OPTIONAL_INTEGRITY_FILES }
    : CHARACTER_REPROCESS_INTEGRITY_FILES
  return Object.entries(files).map(([key, fileName], index) => ({
    key,
    file_name: fileName,
    size: index + 1,
    sha256: String(index % 10).repeat(64),
  }))
}

function evidenceFor(job, { hasBlackMatte = false, extras = {} } = {}) {
  return {
    processing_recipe_url: `/generated/${job.id}/processing_recipe.json`,
    reprocess_context_url: `/generated/${job.id}/editor_reprocess_context.json`,
    artifact_integrity_manifest: manifestFor({ hasBlackMatte }),
    ...extras,
  }
}

function createService({ generatedDir, harness, processSheet, writeCharacterArtifacts, writeEvidence }) {
  return createCharacterReprocessService({
    generatedDir,
    jobQueue: harness.jobQueue,
    createJob: harness.createJob,
    getJob: harness.getJob,
    updateJob: harness.updateJob,
    processSheet,
    writeCharacterArtifacts,
    writeEvidence,
  })
}

async function runQueued(item) {
  try {
    await item.task()
  } catch (error) {
    await item.onError(error)
  }
}

function containsBuffer(value, seen = new Set()) {
  if (Buffer.isBuffer(value)) return true
  if (!value || typeof value !== 'object' || seen.has(value)) return false
  seen.add(value)
  return Object.values(value).some((item) => containsBuffer(item, seen))
}

test('service exports a frozen provider-free public boundary with only enqueue and getJob', async () => {
  const root = await tempRoot()
  const harness = createHarness()
  const service = createService({
    generatedDir: path.join(root, 'generated'),
    harness,
    processSheet: async () => ({}),
    writeCharacterArtifacts: async () => ({ status: 'done', urls: {} }),
    writeEvidence: async ({ job }) => evidenceFor(job),
  })

  assert.equal(Object.isFrozen(service), true)
  assert.deepEqual(Object.keys(service).sort(), ['enqueue', 'getJob'])
  assert.equal(editorProject.createCharacterReprocessService, createCharacterReprocessService)
  assert.equal(editorProject.writeCharacterReprocessEvidence, writeCharacterReprocessEvidence)
})

test('enqueue creates one public job, uses the shared queue once, and snapshots all private authority synchronously', async () => {
  const root = await tempRoot()
  const source = Buffer.from('source-before')
  const black = Buffer.from('black-before')
  const optionsNested = { marker: 'options-before' }
  const recipeNested = { marker: 'recipe-before' }
  const contextNested = { marker: 'context-before' }
  const input = {
    sourceBuffer: source,
    processOptions: {
      createdAt: 'caller-time',
      blackSourceBuffer: black,
      nested: optionsNested,
    },
    canonicalRecipe: {
      ...baseRecipe({ blackMatteRef: 'workspace/managed-black.png' }),
      nested: recipeNested,
    },
    reprocessContextBase: {
      ...baseContext({ black_matte_artifact_sha256: sha256(black) }),
      nested: contextNested,
    },
    blackSourceBuffer: black,
  }
  const harness = createHarness({
    extraCreatedFields: {
      sourceBuffer: Buffer.from('injected-private-source'),
      processOptions: { injected: true },
      canonicalRecipe: { injected: true },
      private_token: 'must-not-leak',
    },
  })
  const calls = []
  const service = createService({
    generatedDir: path.join(root, 'generated'),
    harness,
    processSheet: async (capturedSource, effectiveOptions) => {
      calls.push({ type: 'process', capturedSource, effectiveOptions })
      return { processed: true }
    },
    writeCharacterArtifacts: async ({ job, result }) => {
      calls.push({ type: 'artifacts', job, result })
      return {
        status: 'done',
        urls: {
          normalized_sheet_url: `/generated/${job.id}/normalized_sheet.png`,
          privateBuffer: Buffer.from('not-public'),
          prompt_url: `/generated/${job.id}/prompt.txt`,
        },
        injected_private: Buffer.from('not-public'),
      }
    },
    writeEvidence: async (captured) => {
      calls.push({ type: 'evidence', ...captured })
      return evidenceFor(captured.job, {
        hasBlackMatte: true,
        extras: { privateBuffer: Buffer.from('not-public') },
      })
    },
  })

  const summary = service.enqueue(input)
  assert.equal(harness.createCalls.length, 1)
  assert.equal(harness.tasks.length, 1)
  assert.deepEqual(harness.createCalls[0], {
    type: 'editor_character_reprocess',
    project_id: 'project_demo',
    asset_id: 'asset_hero',
    parent_revision_id: 'rev_003',
    recipe_hash: RECIPE_HASH,
    draft_settings_hash: SETTINGS_HASH,
    implementation_revision: 'package-0.4.0',
  })
  assert.equal(summary.type, 'editor_character_reprocess')
  assert.equal(summary.project_id, 'project_demo')
  assert.equal(summary.asset_id, 'asset_hero')
  assert.equal(summary.parent_revision_id, 'rev_003')
  assert.equal(summary.recipe_hash, RECIPE_HASH)
  assert.equal(summary.sourceBuffer, undefined)
  assert.equal(summary.processOptions, undefined)
  assert.equal(summary.canonicalRecipe, undefined)
  assert.equal(summary.private_token, undefined)
  assert.equal(containsBuffer(summary), false)

  source.fill(120)
  black.fill(121)
  optionsNested.marker = 'options-after'
  recipeNested.marker = 'recipe-after'
  contextNested.marker = 'context-after'
  input.processOptions.createdAt = 'caller-time-after'
  input.canonicalRecipe.source.black_matte_artifact_ref = 'workspace/changed.png'
  input.reprocessContextBase.project_id = 'project_changed'

  await runQueued(harness.tasks[0])

  assert.deepEqual(harness.updates.map((patch) => patch.status), ['post_processing', 'done'])
  assert.deepEqual(calls.map((call) => call.type), ['process', 'artifacts', 'evidence'])
  const processCall = calls[0]
  assert.equal(processCall.capturedSource.toString(), 'source-before')
  assert.notEqual(processCall.capturedSource, source)
  assert.equal(processCall.effectiveOptions.createdAt, CREATED_AT)
  assert.equal(processCall.effectiveOptions.nested.marker, 'options-before')
  assert.equal(processCall.effectiveOptions.blackSourceBuffer.toString(), 'black-before')
  assert.notEqual(processCall.effectiveOptions.blackSourceBuffer, black)

  const evidenceCall = calls[2]
  assert.equal(evidenceCall.canonicalRecipe.nested.marker, 'recipe-before')
  assert.equal(evidenceCall.canonicalRecipe.source.black_matte_artifact_ref, 'workspace/managed-black.png')
  assert.equal(evidenceCall.reprocessContext.nested.marker, 'context-before')
  assert.equal(evidenceCall.reprocessContext.project_id, 'project_demo')
  assert.equal(evidenceCall.reprocessContext.job_type, 'editor_character_reprocess')
  assert.equal(evidenceCall.reprocessContext.preview_job_id, 'job_editor_reprocess')
  assert.equal(evidenceCall.reprocessContext.submitted_at, CREATED_AT)
  assert.equal(evidenceCall.blackSourceBuffer.toString(), 'black-before')
  assert.notEqual(evidenceCall.blackSourceBuffer, black)

  const completed = service.getJob(summary.id)
  assert.equal(completed.normalized_sheet_url, `/generated/${summary.id}/normalized_sheet.png`)
  assert.equal(completed.processing_recipe_url, `/generated/${summary.id}/processing_recipe.json`)
  assert.equal(completed.reprocess_context_url, `/generated/${summary.id}/editor_reprocess_context.json`)
  assert.equal(completed.prompt_url, undefined)
  assert.equal(completed.privateBuffer, undefined)
  assert.equal(completed.injected_private, undefined)
  assert.equal(containsBuffer(completed), false)
})

test('invalid envelopes and caller-owned server context keys fail before job creation or queueing', async () => {
  const root = await tempRoot()
  const harness = createHarness()
  const service = createService({
    generatedDir: path.join(root, 'generated'),
    harness,
    processSheet: async () => ({}),
    writeCharacterArtifacts: async () => ({ status: 'done', urls: {} }),
    writeEvidence: async ({ job }) => evidenceFor(job),
  })

  const invalidInputs = [
    { ...baseInput(), sourceBuffer: new Uint8Array([1]) },
    { ...baseInput(), processOptions: null },
    { ...baseInput(), canonicalRecipe: [] },
    { ...baseInput(), reprocessContextBase: null },
    { ...baseInput(), reprocessContextBase: { ...baseContext(), job_type: 'caller' } },
    { ...baseInput(), reprocessContextBase: { ...baseContext(), preview_job_id: 'caller' } },
    { ...baseInput(), reprocessContextBase: { ...baseContext(), submitted_at: CREATED_AT } },
  ]
  for (const input of invalidInputs) {
    assert.throws(() => service.enqueue(input), (error) => error?.code === 'invalid_reprocess_request')
  }
  assert.equal(harness.createCalls.length, 0)
  assert.equal(harness.tasks.length, 0)
})

test('black-matte Recipe, private input, and process options must agree exactly before create or queue', async () => {
  const root = await tempRoot()
  const harness = createHarness()
  const service = createService({
    generatedDir: path.join(root, 'generated'),
    harness,
    processSheet: async () => ({}),
    writeCharacterArtifacts: async () => ({ status: 'done', urls: {} }),
    writeEvidence: async ({ job }) => evidenceFor(job),
  })
  const black = Buffer.from('black-authority')

  const invalidInputs = [
    baseInput({ blackMatteRef: 'workspace/black.png' }),
    {
      ...baseInput({ blackMatteRef: 'workspace/black.png', blackSourceBuffer: black }),
      processOptions: { blackSourceBuffer: null },
    },
    {
      ...baseInput({ blackMatteRef: 'workspace/black.png', blackSourceBuffer: black }),
      processOptions: { blackSourceBuffer: Buffer.from('different') },
    },
    {
      ...baseInput(),
      processOptions: { blackSourceBuffer: Buffer.from('unexpected') },
    },
    {
      ...baseInput(),
      blackSourceBuffer: Buffer.from('unexpected'),
    },
  ]
  for (const input of invalidInputs) {
    assert.throws(() => service.enqueue(input), (error) => error?.code === 'invalid_recipe')
  }
  assert.equal(harness.createCalls.length, 0)
  assert.equal(harness.tasks.length, 0)
})

test('private source and black-matte bytes must match their exact lower-case context digests before create or queue', async () => {
  const root = await tempRoot()
  const harness = createHarness()
  const service = createService({
    generatedDir: path.join(root, 'generated'),
    harness,
    processSheet: async () => ({}),
    writeCharacterArtifacts: async () => ({ status: 'done', urls: {} }),
    writeEvidence: async ({ job }) => evidenceFor(job),
  })
  const black = Buffer.from('black-authority')
  const sourceDigest = sha256(Buffer.from('source-before'))
  const blackDigest = sha256(black)
  const invalidInputs = [
    {
      ...baseInput(),
      reprocessContextBase: baseContext({ input_artifact_sha256: '0'.repeat(64) }),
    },
    {
      ...baseInput(),
      reprocessContextBase: baseContext({ input_artifact_sha256: sourceDigest.toUpperCase() }),
    },
    {
      ...baseInput({ blackMatteRef: 'workspace/black.png', blackSourceBuffer: black }),
      reprocessContextBase: baseContext({
        input_artifact_sha256: sourceDigest,
        black_matte_artifact_sha256: '0'.repeat(64),
      }),
    },
    {
      ...baseInput(),
      reprocessContextBase: baseContext({ black_matte_artifact_sha256: blackDigest }),
    },
    {
      ...baseInput(),
      reprocessContextBase: baseContext({ black_matte_artifact_sha256: undefined }),
    },
  ]

  for (const input of invalidInputs) {
    assert.throws(() => service.enqueue(input), (error) => ['invalid_reprocess_request', 'invalid_recipe'].includes(error?.code))
  }
  assert.equal(harness.createCalls.length, 0)
  assert.equal(harness.tasks.length, 0)
})

test('terminal job state is published atomically only after evidence completes', async () => {
  const root = await tempRoot()
  const harness = createHarness()
  let releaseEvidence
  let evidenceStarted
  const started = new Promise((resolve) => { evidenceStarted = resolve })
  const barrier = new Promise((resolve) => { releaseEvidence = resolve })
  const service = createService({
    generatedDir: path.join(root, 'generated'),
    harness,
    processSheet: async () => ({ ok: true }),
    writeCharacterArtifacts: async ({ job }) => ({
      status: 'done',
      urls: { normalized_sheet_url: `/generated/${job.id}/normalized_sheet.png` },
      reason: null,
      retry_hint: null,
    }),
    writeEvidence: async ({ job }) => {
      evidenceStarted()
      await barrier
      return evidenceFor(job)
    },
  })
  const summary = service.enqueue(baseInput())
  const running = harness.tasks[0].task()
  await started

  const held = service.getJob(summary.id)
  assert.equal(held.status, 'post_processing')
  assert.equal(held.normalized_sheet_url, undefined)
  assert.equal(held.processing_recipe_url, undefined)
  assert.equal(held.artifact_integrity_manifest, undefined)
  assert.equal(harness.updates.length, 1)

  releaseEvidence()
  await running
  const completed = service.getJob(summary.id)
  assert.equal(completed.status, 'done')
  assert.equal(completed.normalized_sheet_url, `/generated/${summary.id}/normalized_sheet.png`)
  assert.equal(completed.processing_recipe_url, `/generated/${summary.id}/processing_recipe.json`)
  assert.equal(harness.updates.length, 2)
})

test('artifact writer rejects noncanonical scalar, list, and preview generated URLs before evidence publication', async (t) => {
  const cases = [
    ['scalar encoded parent', (id) => ({ normalized_sheet_url: `/generated/${id}/%2e%2e/normalized_sheet.png` })],
    ['scalar encoded slash', (id) => ({ normalized_sheet_url: `/generated/${id}/nested%2Fnormalized_sheet.png` })],
    ['list encoded parent', (id) => ({ row_gif_urls: [`/generated/${id}/%2e%2e/escape.gif`] })],
    ['list encoded slash', (id) => ({ row_gif_urls: [`/generated/${id}/nested%2Fescape.gif`] })],
    ['list encoded backslash', (id) => ({ row_gif_urls: [`/generated/${id}/nested%5Cescape.gif`] })],
    ['list raw backslash', (id) => ({ row_gif_urls: [`/generated/${id}/nested\\escape.gif`] })],
    ['preview encoded parent', (id) => ({ row_gif_previews: [{ url: `/generated/${id}/%2e%2e/escape.gif` }] })],
    ['preview wrong job prefix', (id) => ({ row_gif_previews: [{ url: `/generated/${id}_other/escape.gif` }] })],
    ['scalar query', (id) => ({ normalized_sheet_url: `/generated/${id}/normalized_sheet.png?raw=1` })],
    ['scalar fragment', (id) => ({ normalized_sheet_url: `/generated/${id}/normalized_sheet.png#raw` })],
  ]

  for (const [index, [label, buildUrls]] of cases.entries()) {
    await t.test(label, async () => {
      const root = await tempRoot()
      const jobId = `job_url_case_${index}`
      const harness = createHarness({ jobId })
      let evidenceCalls = 0
      const service = createService({
        generatedDir: path.join(root, 'generated'),
        harness,
        processSheet: async () => ({ ok: true }),
        writeCharacterArtifacts: async () => ({ status: 'done', urls: buildUrls(jobId) }),
        writeEvidence: async ({ job }) => {
          evidenceCalls += 1
          return evidenceFor(job)
        },
      })
      const summary = service.enqueue(baseInput())
      await runQueued(harness.tasks[0])
      const failed = service.getJob(summary.id)
      assert.equal(failed.status, 'failed_post_processing')
      assert.equal(failed.processing_recipe_url, undefined)
      assert.equal(failed.artifact_integrity_manifest, undefined)
      assert.equal(evidenceCalls, 0)
    })
  }
})

test('evidence failure publishes artifact_integrity_failed without terminal artifacts or quality-blocked semantics', async () => {
  const root = await tempRoot()
  const harness = createHarness()
  const service = createService({
    generatedDir: path.join(root, 'generated'),
    harness,
    processSheet: async () => ({ ok: true }),
    writeCharacterArtifacts: async ({ job }) => ({
      status: 'done',
      urls: { normalized_sheet_url: `/generated/${job.id}/normalized_sheet.png` },
    }),
    writeEvidence: async () => {
      throw new Error('sealing exploded')
    },
  })
  const summary = service.enqueue(baseInput())
  await runQueued(harness.tasks[0])

  const failed = service.getJob(summary.id)
  assert.equal(failed.status, 'failed_post_processing')
  assert.equal(failed.reason, 'artifact_integrity_failed')
  assert.equal(failed.retry_hint, 'inspect_editor_character_reprocess')
  assert.equal(failed.normalized_sheet_url, undefined)
  assert.equal(failed.processing_recipe_url, undefined)
  assert.equal(failed.reprocess_context_url, undefined)
  assert.equal(failed.artifact_integrity_manifest, undefined)
  assert.equal(JSON.stringify(failed).includes('blocked_quality'), false)
})

test('processor, writer, reservation, and queue failures reuse failed_post_processing without evidence fields', async (t) => {
  for (const failure of ['processor', 'writer']) {
    await t.test(failure, async () => {
      const root = await tempRoot()
      const harness = createHarness({ jobId: `job_${failure}_failure` })
      let evidenceCalls = 0
      const service = createService({
        generatedDir: path.join(root, 'generated'),
        harness,
        processSheet: async () => {
          if (failure === 'processor') throw new Error('private processor detail')
          return { ok: true }
        },
        writeCharacterArtifacts: async () => {
          if (failure === 'writer') throw new Error('private writer detail')
          return { status: 'done', urls: {} }
        },
        writeEvidence: async ({ job }) => {
          evidenceCalls += 1
          return evidenceFor(job)
        },
      })
      const summary = service.enqueue(baseInput())
      await runQueued(harness.tasks[0])
      const failed = service.getJob(summary.id)
      assert.equal(failed.status, 'failed_post_processing')
      assert.equal(failed.processing_recipe_url, undefined)
      assert.equal(failed.artifact_integrity_manifest, undefined)
      assert.equal(evidenceCalls, 0)
    })
  }

  await t.test('queue onError', async () => {
    const root = await tempRoot()
    const harness = createHarness({ jobId: 'job_queue_failure' })
    const service = createService({
      generatedDir: path.join(root, 'generated'),
      harness,
      processSheet: async () => ({}),
      writeCharacterArtifacts: async () => ({ status: 'done', urls: {} }),
      writeEvidence: async ({ job }) => evidenceFor(job),
    })
    const summary = service.enqueue(baseInput())
    await harness.tasks[0].onError(new Error('private queue detail'))
    const failed = service.getJob(summary.id)
    assert.equal(failed.status, 'failed_post_processing')
    assert.equal(failed.processing_recipe_url, undefined)
    assert.equal(failed.artifact_integrity_manifest, undefined)
  })
})

test('successful evidence preserves either low-level done or failed_post_processing terminal result', async (t) => {
  for (const terminal of ['done', 'failed_post_processing']) {
    await t.test(terminal, async () => {
      const root = await tempRoot()
      const harness = createHarness({ jobId: `job_terminal_${terminal}` })
      const service = createService({
        generatedDir: path.join(root, 'generated'),
        harness,
        processSheet: async () => ({ ok: true }),
        writeCharacterArtifacts: async ({ job }) => ({
          status: terminal,
          urls: { debug_report_url: `/generated/${job.id}/debug_report.json` },
          reason: terminal === 'done' ? null : 'validation_failed',
          retry_hint: terminal === 'done' ? null : 'manual_inspect',
        }),
        writeEvidence: async ({ job }) => evidenceFor(job),
      })
      const summary = service.enqueue(baseInput())
      await runQueued(harness.tasks[0])
      const completed = service.getJob(summary.id)
      assert.equal(completed.status, terminal)
      assert.equal(completed.processing_recipe_url, `/generated/${summary.id}/processing_recipe.json`)
      assert.deepEqual(completed.artifact_integrity_manifest, manifestFor())
      assert.equal(completed.reason, terminal === 'done' ? null : 'validation_failed')
    })
  }
})

test('pre-existing job-directory symlink fails reservation before processing and leaves its external target empty', async () => {
  const root = await tempRoot()
  const generatedDir = path.join(root, 'generated')
  const externalDir = path.join(root, 'external')
  await mkdir(generatedDir, { recursive: true })
  await mkdir(externalDir, { recursive: true })
  await symlink(externalDir, path.join(generatedDir, 'job_symlink_reservation'))
  const harness = createHarness({ jobId: 'job_symlink_reservation' })
  let processCalls = 0
  let artifactCalls = 0
  let evidenceCalls = 0
  const service = createService({
    generatedDir,
    harness,
    processSheet: async () => { processCalls += 1 },
    writeCharacterArtifacts: async () => { artifactCalls += 1 },
    writeEvidence: async () => { evidenceCalls += 1 },
  })
  const summary = service.enqueue(baseInput())
  await runQueued(harness.tasks[0])

  assert.equal(service.getJob(summary.id).status, 'failed_post_processing')
  assert.equal(processCalls, 0)
  assert.equal(artifactCalls, 0)
  assert.equal(evidenceCalls, 0)
  assert.deepEqual(await readdir(externalDir), [])
})

test('replacing a reserved job directory with an external symlink while processing is detected before artifact writing', async () => {
  const root = await tempRoot()
  const generatedDir = path.join(root, 'generated')
  const externalDir = path.join(root, 'external-replacement')
  const movedDir = path.join(root, 'reserved-job-moved')
  await mkdir(externalDir, { recursive: true })
  const harness = createHarness({ jobId: 'job_replaced_during_processing' })
  let processStarted
  let releaseProcess
  const started = new Promise((resolve) => { processStarted = resolve })
  const barrier = new Promise((resolve) => { releaseProcess = resolve })
  let artifactCalls = 0
  let evidenceCalls = 0
  const service = createService({
    generatedDir,
    harness,
    processSheet: async () => {
      processStarted()
      await barrier
      return { ok: true }
    },
    writeCharacterArtifacts: async () => {
      artifactCalls += 1
      return { status: 'done', urls: {} }
    },
    writeEvidence: async ({ job }) => {
      evidenceCalls += 1
      return evidenceFor(job)
    },
  })
  const summary = service.enqueue(baseInput())
  const running = harness.tasks[0].task()
  await started
  const lexicalJobDir = path.join(generatedDir, summary.id)
  await rename(lexicalJobDir, movedDir)
  await symlink(externalDir, lexicalJobDir)
  releaseProcess()
  await running

  const failed = service.getJob(summary.id)
  assert.equal(failed.status, 'failed_post_processing')
  assert.equal(failed.processing_recipe_url, undefined)
  assert.equal(failed.artifact_integrity_manifest, undefined)
  assert.equal(artifactCalls, 0)
  assert.equal(evidenceCalls, 0)
  assert.deepEqual(await readdir(externalDir), [])
})

test('replacing the reserved directory inside evidence writing prevents terminal publication', async () => {
  const root = await tempRoot()
  const generatedDir = path.join(root, 'generated')
  const movedDir = path.join(root, 'job-moved-by-evidence')
  const harness = createHarness({ jobId: 'job_replaced_by_evidence' })
  const service = createService({
    generatedDir,
    harness,
    processSheet: async () => ({ ok: true }),
    writeCharacterArtifacts: async ({ job }) => ({
      status: 'done',
      urls: { normalized_sheet_url: `/generated/${job.id}/normalized_sheet.png` },
    }),
    writeEvidence: async ({ job }) => {
      const lexicalJobDir = path.join(generatedDir, job.id)
      await rename(lexicalJobDir, movedDir)
      await mkdir(lexicalJobDir)
      return evidenceFor(job)
    },
  })
  const summary = service.enqueue(baseInput())
  await runQueued(harness.tasks[0])

  const failed = service.getJob(summary.id)
  assert.equal(failed.status, 'failed_post_processing')
  assert.equal(failed.reason, 'artifact_integrity_failed')
  assert.equal(failed.normalized_sheet_url, undefined)
  assert.equal(failed.processing_recipe_url, undefined)
  assert.equal(failed.reprocess_context_url, undefined)
  assert.equal(failed.artifact_integrity_manifest, undefined)
})

async function writeLowLevelIntegrityFiles(jobDir) {
  await mkdir(jobDir, { recursive: true })
  for (const [key, fileName] of Object.entries(CHARACTER_REPROCESS_INTEGRITY_FILES)) {
    if (key === 'processing_recipe' || key === 'reprocess_context') continue
    await writeFile(path.join(jobDir, fileName), Buffer.from(`sealed-${key}`), { flag: 'wx' })
  }
}

test('evidence writer creates only controlled evidence, seals the exact complete set, and never publishes a black-matte URL', async () => {
  const root = await tempRoot()
  const generatedDir = path.join(root, 'generated')
  const job = { id: 'job_real_evidence' }
  const jobDir = path.join(generatedDir, job.id)
  await writeLowLevelIntegrityFiles(jobDir)
  const blackSourceBuffer = Buffer.from('private-black-matte')
  const canonicalRecipe = baseRecipe({ blackMatteRef: 'workspace/managed-black.png' })
  const reprocessContext = baseContext({ black_matte_artifact_sha256: createHash('sha256').update(blackSourceBuffer).digest('hex') })

  const evidence = await writeCharacterReprocessEvidence({
    generatedDir,
    job,
    canonicalRecipe,
    reprocessContext,
    blackSourceBuffer,
  })

  assert.deepEqual(Object.keys(evidence).sort(), [
    'artifact_integrity_manifest',
    'processing_recipe_url',
    'reprocess_context_url',
  ])
  assert.equal(evidence.processing_recipe_url, `/generated/${job.id}/processing_recipe.json`)
  assert.equal(evidence.reprocess_context_url, `/generated/${job.id}/editor_reprocess_context.json`)
  assert.equal(evidence.black_matte_url, undefined)
  assert.deepEqual(
    evidence.artifact_integrity_manifest.map(({ key, file_name }) => ({ key, file_name })),
    Object.entries({
      ...CHARACTER_REPROCESS_INTEGRITY_FILES,
      ...CHARACTER_REPROCESS_OPTIONAL_INTEGRITY_FILES,
    }).map(([key, file_name]) => ({ key, file_name })),
  )
  const blackEntry = evidence.artifact_integrity_manifest.find((entry) => entry.key === 'black_matte')
  assert.equal(blackEntry.sha256, createHash('sha256').update(blackSourceBuffer).digest('hex'))
  assert.equal(blackEntry.size, blackSourceBuffer.byteLength)
  assert.deepEqual(Object.keys(blackEntry).sort(), ['file_name', 'key', 'sha256', 'size'])
  assert.deepEqual(JSON.parse(await readFile(path.join(jobDir, 'processing_recipe.json'), 'utf8')), canonicalRecipe)
  assert.deepEqual(JSON.parse(await readFile(path.join(jobDir, 'editor_reprocess_context.json'), 'utf8')), reprocessContext)
  assert.equal((await readFile(path.join(jobDir, 'input_black_matte.png'))).toString(), 'private-black-matte')
  assert.deepEqual((await readdir(jobDir)).sort(), Object.values({
    ...CHARACTER_REPROCESS_INTEGRITY_FILES,
    ...CHARACTER_REPROCESS_OPTIONAL_INTEGRITY_FILES,
  }).sort())
})

test('evidence writer enforces black authority, exclusive wx writes, and exact parent-escape containment', async (t) => {
  await t.test('authority mismatch and wx collision', async () => {
    const root = await tempRoot()
    const generatedDir = path.join(root, 'generated')
    const job = { id: 'job_evidence_collision' }
    const jobDir = path.join(generatedDir, job.id)
    await writeLowLevelIntegrityFiles(jobDir)
    await assert.rejects(
      writeCharacterReprocessEvidence({
        generatedDir,
        job,
        canonicalRecipe: baseRecipe({ blackMatteRef: 'workspace/black.png' }),
        reprocessContext: baseContext(),
      }),
      (error) => error?.code === 'artifact_integrity_failed',
    )
    const blackSourceBuffer = Buffer.from('private-black')
    await assert.rejects(
      writeCharacterReprocessEvidence({
        generatedDir,
        job,
        canonicalRecipe: baseRecipe({ blackMatteRef: 'workspace/black.png' }),
        reprocessContext: baseContext({ black_matte_artifact_sha256: '0'.repeat(64) }),
        blackSourceBuffer,
      }),
      (error) => error?.code === 'artifact_integrity_failed',
    )
    assert.equal((await readdir(jobDir)).includes('input_black_matte.png'), false)

    const canonicalRecipe = baseRecipe()
    const reprocessContext = baseContext()
    await writeCharacterReprocessEvidence({ generatedDir, job, canonicalRecipe, reprocessContext })
    const recipeBefore = await readFile(path.join(jobDir, 'processing_recipe.json'))
    await assert.rejects(
      writeCharacterReprocessEvidence({
        generatedDir,
        job,
        canonicalRecipe: { ...canonicalRecipe, changed: true },
        reprocessContext,
      }),
      (error) => error?.code === 'EEXIST',
    )
    assert.deepEqual(await readFile(path.join(jobDir, 'processing_recipe.json')), recipeBefore)
  })

  await t.test('a direct job child under a configured root beginning with two dots is not mistaken for parent escape', async () => {
    const root = await tempRoot()
    const generatedDir = path.join(root, '..valid-generated-root')
    const jobDir = path.join(generatedDir, 'job_dotdot_valid')
    await writeLowLevelIntegrityFiles(jobDir)

    const evidence = await writeCharacterReprocessEvidence({
      generatedDir,
      job: { id: 'job_dotdot_valid' },
      canonicalRecipe: baseRecipe(),
      reprocessContext: baseContext(),
    })
    assert.equal(evidence.artifact_integrity_manifest.length, Object.keys(CHARACTER_REPROCESS_INTEGRITY_FILES).length)
  })

  await t.test('a same-root symlink is rejected because it is not the exact reserved job directory', async () => {
    const root = await tempRoot()
    const generatedDir = path.join(root, 'generated')
    const target = path.join(generatedDir, '..valid-target')
    await mkdir(generatedDir, { recursive: true })
    await writeLowLevelIntegrityFiles(target)
    await symlink(target, path.join(generatedDir, 'job_same_root_symlink'))

    await assert.rejects(
      writeCharacterReprocessEvidence({
        generatedDir,
        job: { id: 'job_same_root_symlink' },
        canonicalRecipe: baseRecipe(),
        reprocessContext: baseContext(),
      }),
      (error) => error?.code === 'unsafe_artifact_path',
    )
    assert.equal((await readdir(target)).includes('processing_recipe.json'), false)
    assert.equal((await readdir(target)).includes('editor_reprocess_context.json'), false)
  })

  await t.test('an external real target is rejected before evidence is written', async () => {
    const root = await tempRoot()
    const generatedDir = path.join(root, 'generated')
    const externalDir = path.join(root, 'external-target')
    await mkdir(generatedDir, { recursive: true })
    await writeLowLevelIntegrityFiles(externalDir)
    await symlink(externalDir, path.join(generatedDir, 'job_external_evidence'))
    await assert.rejects(
      writeCharacterReprocessEvidence({
        generatedDir,
        job: { id: 'job_external_evidence' },
        canonicalRecipe: baseRecipe(),
        reprocessContext: baseContext(),
      }),
      (error) => error?.code === 'unsafe_artifact_path',
    )
    assert.equal((await readdir(externalDir)).includes('processing_recipe.json'), false)
    assert.equal((await readdir(externalDir)).includes('editor_reprocess_context.json'), false)
  })
})
