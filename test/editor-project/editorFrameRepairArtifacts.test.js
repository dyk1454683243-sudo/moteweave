import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  access,
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Worker } from 'node:worker_threads'

import {
  FRAME_REPAIR_INTEGRITY_FILES,
  recoverSealedFrameRepairArtifacts,
  verifySealedFrameRepairArtifacts,
  writeFrameRepairArtifacts,
} from '../../src/editor-project/frameRepairArtifacts.js'
import { hashFrameRepairPlan } from '../../src/editor-project/frameRepairPlan.js'

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)
function characterResultFixture() {
  const sizes = [96, 64, 48, 32, 16]
  return {
    files: {
      sourcePng: Buffer.from(TINY_PNG),
      sourceLayoutOverlayPng: Buffer.from(TINY_PNG),
      normalizedSheetPng: Buffer.from(TINY_PNG),
      multiResolutionManifest: {
        version: 'multi_resolution_v1',
        sheets: sizes.map((frameSize) => ({
          frame_size: frameSize,
          file: `normalized_sheet_${frameSize}.png`,
        })),
      },
      multiResolutionSheets: Object.fromEntries(
        sizes.map((frameSize) => [frameSize, Buffer.from(TINY_PNG)]),
      ),
      debugOverlayPng: Buffer.from(TINY_PNG),
      onionSkinOverlayPng: Buffer.from(TINY_PNG),
      inspectionIndexJson: { version: 'inspection_index_v1', previews: [] },
      inspectionSheetPng: Buffer.from(TINY_PNG),
      godotNpcZipBuffer: Buffer.from('godot-zip'),
      rpgmakerZipBuffer: Buffer.from('rpgmaker-zip'),
      ocadZipBuffer: Buffer.from('ocad-zip'),
      zipBuffer: Buffer.from('character-pack-zip'),
    },
    animationsJson: { version: 'animations_v1', animations: {} },
    metadataJson: { version: 'metadata_v1', profile: 'topdown_rpg_v0' },
    editorMetadataJson: { version: 'editor_metadata_v1', frames: [] },
    debugReport: { version: 'debug_report_v1', validation: { valid: true } },
    rowPreviews: [],
    inspectionPreviews: [],
  }
}

function frameRepairEvidenceFixture(jobId = 'job_frame_repair') {
  const plan = {
    version: 'frame_repair_plan_v1',
    project: { id: 'project_demo', revision: 4 },
    asset: { id: 'asset_hero', parent_revision_id: 'rev_003' },
    profile: { id: 'topdown_rpg_v0', frame_size: { w: 96, h: 96 } },
    clip: {
      id: 'walk_down',
      frames: [15, 16, 17, 18],
      position: 2,
      sheet_frame_index: 17,
      context_frames: [
        { position: 1, sheet_frame_index: 16, sha256: '3'.repeat(64) },
        { position: 3, sheet_frame_index: 18, sha256: '4'.repeat(64) },
      ],
    },
    parent_sheet_sha256: '1'.repeat(64),
    target_frame_sha256: '2'.repeat(64),
    references: {
      input_reference_roles: [
        'target_enlarged',
        'mask_visualization',
        'clip_context',
        'full_sheet',
      ],
      context_sha256: '5'.repeat(64),
      items: [],
    },
    mask: {
      width: 96,
      height: 96,
      source: 'user_scoped',
      confidence: 'user_confirmed',
      runs: [{ start: 0, length: 1 }],
      activePixelCount: 1,
      sha256: '6'.repeat(64),
    },
    instruction: 'Fix: repair the selected hand',
    provider: {
      id: 'gemini-default',
      provider: 'gemini',
      label: 'Gemini default',
      model: 'model-a',
      image_config: { image_size: '1K', aspect_ratio: '1:1' },
    },
    estimated_provider_calls: 1,
    max_provider_calls: 1,
    implementation_revision: 'package-0.4.0',
  }
  const planHash = hashFrameRepairPlan(plan)
  return {
    frame_repair_plan: plan,
    frame_repair_context_base: {
      version: 'editor_frame_repair_context_v1',
      job_type: 'editor_character_frame_repair',
      job_id: jobId,
      operation_id: 'operation_repair_001',
      submitted_at: '2026-07-11T00:00:00.000Z',
      project_id: 'project_demo',
      project_revision: 4,
      asset_id: 'asset_hero',
      parent_revision_id: 'rev_003',
      parent_sheet_ref: 'workspace/projects/project_demo/assets/asset_hero/rev_003/normalized_sheet.png',
      parent_sheet_sha256: '1'.repeat(64),
      parent_processing_recipe_ref: null,
      profile: 'topdown_rpg_v0',
      frame_size: { w: 96, h: 96 },
      sheet_size: { w: 1152, h: 384 },
      clip_id: 'walk_down',
      clip_frame_position: 2,
      sheet_frame_index: 17,
      target_frame_sha256: '2'.repeat(64),
      context_frames: [
        { position: 1, sheet_frame_index: 16, sha256: '3'.repeat(64) },
        { position: 3, sheet_frame_index: 18, sha256: '4'.repeat(64) },
      ],
      reference_context_sha256: '5'.repeat(64),
      mask_sha256: '6'.repeat(64),
      plan_hash: planHash,
      provider_preset: {
        id: 'gemini-default',
        provider: 'gemini',
        label: 'Gemini default',
        model: 'model-a',
        image_config: { image_size: '1K', aspect_ratio: '1:1' },
      },
      provider_call_budget: 1,
      provider_calls_used: 1,
      implementation_revision: 'package-0.4.0',
      input_reference_roles: [
        'target_enlarged',
        'mask_visualization',
        'clip_context',
        'full_sheet',
      ],
    },
    target_before: Buffer.from(TINY_PNG),
    frame_repair_mask: Buffer.from(TINY_PNG),
    frame_repair_context_image: Buffer.from(TINY_PNG),
    raw_provider_output: Buffer.from(TINY_PNG),
    normalized_candidate_frame: Buffer.from(TINY_PNG),
    composited_candidate_frame: Buffer.from(TINY_PNG),
    frame_repair_difference: Buffer.from(TINY_PNG),
    frame_repair_quality: { version: 'frame_repair_quality_v1', accepted: true },
    frame_repair_prompt: Buffer.from('Repair the selected frame.\n', 'utf8'),
    patched_normalized_sheet: Buffer.from(TINY_PNG),
  }
}

async function completedArtifactFixture() {
  const fixture = await artifactHarness()
  const written = await writeFrameRepairArtifacts({
    generatedDir: fixture.generatedDir,
    job: fixture.job,
    characterResult: characterResultFixture(),
    evidence: frameRepairEvidenceFixture(fixture.job.id),
  })
  return {
    ...fixture,
    written,
    job: { ...fixture.job, ...written },
  }
}

async function artifactHarness({ jobId = 'job_frame_repair', createJobDir = true } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'frame-repair-artifacts-'))
  const generatedDir = path.join(root, 'generated')
  const job = {
    id: jobId,
    status: 'processing',
    created_at: '2026-07-11T00:00:00.000Z',
  }
  const jobDir = path.join(generatedDir, job.id)
  if (createJobDir) await mkdir(jobDir, { recursive: true })
  else await mkdir(generatedDir, { recursive: true })
  return { root, generatedDir, jobDir, job }
}

function artifactSha256(content) {
  return createHash('sha256').update(content).digest('hex')
}

async function expectArtifactFailure(action) {
  await assert.rejects(action, (error) => {
    assert.equal(error?.code, 'artifact_integrity_failed')
    assert.equal(error?.message, 'frame repair artifact integrity failed')
    return true
  })
}

async function expectInvalidEvidence(mutator) {
  const fixture = await artifactHarness()
  const evidence = frameRepairEvidenceFixture(fixture.job.id)
  mutator(evidence)
  await expectArtifactFailure(() => writeFrameRepairArtifacts({
    generatedDir: fixture.generatedDir,
    job: fixture.job,
    characterResult: characterResultFixture(),
    evidence,
  }))
}

test('Frame Repair writer emits, verifies, and recovers the complete sealed artifact contract', async () => {
  const fixture = await completedArtifactFixture()

  assert.equal(fixture.written.status, 'done')
  assert.equal(
    fixture.written.frame_repair_plan_url,
    `/generated/${fixture.job.id}/frame_repair_plan.json`,
  )
  assert.deepEqual(
    fixture.written.artifact_integrity_manifest.map((entry) => entry.key).sort(),
    Object.keys(FRAME_REPAIR_INTEGRITY_FILES).sort(),
  )

  const verified = await verifySealedFrameRepairArtifacts({
    generatedDir: fixture.generatedDir,
    job: fixture.job,
  })
  assert.equal(verified.length, Object.keys(FRAME_REPAIR_INTEGRITY_FILES).length)
  assert.equal(Object.isFrozen(verified), true)
  assert.ok(verified.every((entry) => Object.isFrozen(entry) && Buffer.isBuffer(entry.content)))

  const context = JSON.parse(await readFile(
    path.join(fixture.jobDir, 'editor_frame_repair_context.json'),
    'utf8',
  ))
  assert.equal(context.job_type, 'editor_character_frame_repair')
  assert.deepEqual(
    context.sealed_artifacts,
    fixture.written.artifact_integrity_manifest.filter(
      (entry) => entry.key !== 'frame_repair_context',
    ),
  )

  const recovered = await recoverSealedFrameRepairArtifacts({
    generatedDir: fixture.generatedDir,
    jobId: fixture.job.id,
    expectedManifestSha256: fixture.written.artifact_manifest_sha256,
  })
  assert.deepEqual(recovered.manifest, fixture.written.artifact_integrity_manifest)
  assert.equal(Object.isFrozen(recovered), true)
  assert.equal(Object.isFrozen(recovered.manifest), true)
  assert.deepEqual(
    fixture.written.artifact_integrity_manifest.map((entry) => entry.key),
    Object.keys(FRAME_REPAIR_INTEGRITY_FILES),
  )
  assert.equal(Object.isFrozen(fixture.written), true)
  assert.equal(Object.isFrozen(fixture.written.artifact_integrity_manifest), true)
  assert.equal(JSON.stringify(fixture.written).includes(fixture.root), false)

  for (const name of [
    'frame_repair_plan.json',
    'frame_repair_quality.json',
    'editor_frame_repair_context.json',
    'metadata.json',
  ]) {
    assert.equal((await readFile(path.join(fixture.jobDir, name), 'utf8')).endsWith('\n'), true)
  }
  assert.equal((await readdir(fixture.jobDir)).includes('artifact_manifest.json'), false)

  verified[0].content[0] ^= 0xff
  assert.equal((await verifySealedFrameRepairArtifacts({
    generatedDir: fixture.generatedDir,
    job: fixture.job,
  })).length, verified.length)
})

test('Frame Repair sealed verification rejects tampered quality evidence', async () => {
  const fixture = await completedArtifactFixture()
  await writeFile(path.join(fixture.jobDir, 'frame_repair_quality.json'), '{}')

  await assert.rejects(
    () => verifySealedFrameRepairArtifacts({ generatedDir: fixture.generatedDir, job: fixture.job }),
    (error) => error?.code === 'artifact_integrity_failed',
  )
})

test('Frame Repair sealed verification rejects a caller URL that names another job', async () => {
  const fixture = await completedArtifactFixture()
  fixture.job.frame_repair_plan_url = '/generated/other/frame_repair_plan.json'

  await assert.rejects(
    () => verifySealedFrameRepairArtifacts({ generatedDir: fixture.generatedDir, job: fixture.job }),
    (error) => error?.code === 'artifact_integrity_failed',
  )
})

test('writer accepts protocol-valid slash separators in instruction and prompt text', async () => {
  const fixture = await artifactHarness()
  const evidence = frameRepairEvidenceFixture(fixture.job.id)
  evidence.frame_repair_plan.instruction = 'Repair hand / sword overlap'
  evidence.frame_repair_context_base.plan_hash = hashFrameRepairPlan(evidence.frame_repair_plan)
  evidence.frame_repair_prompt = Buffer.from('Repair hand / sword overlap.\n', 'utf8')

  const written = await writeFrameRepairArtifacts({
    generatedDir: fixture.generatedDir,
    job: fixture.job,
    characterResult: characterResultFixture(),
    evidence,
  })

  assert.equal(written.status, 'done')
})

test('exclusive writer rejects collisions, missing jobs, and symlinked job directories without overwrite', async () => {
  const collision = await artifactHarness()
  const sentinel = Buffer.from('existing-source')
  await writeFile(path.join(collision.jobDir, 'source.png'), sentinel, { flag: 'wx' })
  await expectArtifactFailure(() => writeFrameRepairArtifacts({
    generatedDir: collision.generatedDir,
    job: collision.job,
    characterResult: characterResultFixture(),
    evidence: frameRepairEvidenceFixture(collision.job.id),
  }))
  assert.deepEqual(await readFile(path.join(collision.jobDir, 'source.png')), sentinel)

  const missing = await artifactHarness({ createJobDir: false })
  await expectArtifactFailure(() => writeFrameRepairArtifacts({
    generatedDir: missing.generatedDir,
    job: missing.job,
    characterResult: characterResultFixture(),
    evidence: frameRepairEvidenceFixture(missing.job.id),
  }))

  const linked = await artifactHarness({ createJobDir: false })
  const outside = path.join(linked.root, 'outside-job')
  await mkdir(outside)
  await symlink(outside, linked.jobDir, 'dir')
  await expectArtifactFailure(() => writeFrameRepairArtifacts({
    generatedDir: linked.generatedDir,
    job: linked.job,
    characterResult: characterResultFixture(),
    evidence: frameRepairEvidenceFixture(linked.job.id),
  }))

  const escaping = await artifactHarness({ jobId: 'job_frame_repair', createJobDir: false })
  const unsafeJob = { ...escaping.job, id: '../escape' }
  await expectArtifactFailure(() => writeFrameRepairArtifacts({
    generatedDir: escaping.generatedDir,
    job: unsafeJob,
    characterResult: characterResultFixture(),
    evidence: frameRepairEvidenceFixture(unsafeJob.id),
  }))
})

test('standard manifest rejects duplicate, missing, traversal, absolute, and backslash names', async () => {
  const mutations = [
    (result) => { result.files.rowGifBuffers = { 'source.png': Buffer.from('duplicate') } },
    (result) => { result.files.rowGifBuffers = { '../escape.gif': Buffer.from('escape') } },
    (result) => { result.files.rowGifBuffers = { '/absolute.gif': Buffer.from('absolute') } },
    (result) => { result.files.rowGifBuffers = { 'inspection_gifs\\escape.gif': Buffer.from('slash') } },
    (result) => { result.files.sourceLayoutOverlayPng = null },
  ]
  for (const mutate of mutations) {
    const fixture = await artifactHarness()
    const result = characterResultFixture()
    mutate(result)
    await expectArtifactFailure(() => writeFrameRepairArtifacts({
      generatedDir: fixture.generatedDir,
      job: fixture.job,
      characterResult: result,
      evidence: frameRepairEvidenceFixture(fixture.job.id),
    }))
    assert.deepEqual(await readdir(fixture.jobDir), [])
  }
})

test('writer creates only controlled preview directories and rejects a symlinked preview parent', async () => {
  const success = await artifactHarness()
  const result = characterResultFixture()
  result.files.rowGifBuffers = { 'walk_down.gif': Buffer.from('GIF89a-preview') }
  result.files.inspectionGifBuffers = {
    'inspection_gifs/walk_down.gif': Buffer.from('GIF89a-inspection'),
  }
  result.files.inspectionStripPngBuffers = {
    'inspection_strips/walk_down.png': Buffer.from(TINY_PNG),
  }
  const written = await writeFrameRepairArtifacts({
    generatedDir: success.generatedDir,
    job: success.job,
    characterResult: result,
    evidence: frameRepairEvidenceFixture(success.job.id),
  })
  for (const directory of ['inspection_gifs', 'inspection_strips']) {
    const value = await lstat(path.join(success.jobDir, directory))
    assert.equal(value.isDirectory(), true)
    assert.equal(value.isSymbolicLink(), false)
  }
  await access(path.join(success.jobDir, 'inspection_gifs', 'walk_down.gif'))
  assert.equal(written.artifact_integrity_manifest.some(
    (entry) => entry.file_name === 'inspection_gifs/walk_down.gif',
  ), false)

  const linked = await artifactHarness()
  const linkedResult = characterResultFixture()
  linkedResult.files.inspectionGifBuffers = {
    'inspection_gifs/walk_down.gif': Buffer.from('GIF89a-inspection'),
  }
  const outside = path.join(linked.root, 'outside-preview')
  await mkdir(outside)
  await symlink(outside, path.join(linked.jobDir, 'inspection_gifs'), 'dir')
  await expectArtifactFailure(() => writeFrameRepairArtifacts({
    generatedDir: linked.generatedDir,
    job: linked.job,
    characterResult: linkedResult,
    evidence: frameRepairEvidenceFixture(linked.job.id),
  }))
  assert.deepEqual(await readdir(outside), [])
})

test('writer rejects malformed, unsafe, secret, and non-exact evidence before writing', async () => {
  const mutations = [
    (value) => { value.extra = true },
    (value) => { delete value.target_before },
    (value) => { value.frame_repair_plan.apiKey = 'private-key' },
    (value) => { value.frame_repair_plan.note = 'sk-abcdefghijklmnop' },
    (value) => { value.frame_repair_plan.note = 'data:image/png;base64,AAAA' },
    (value) => { value.frame_repair_plan.note = '/Users/private/plan.json' },
    (value) => { value.frame_repair_plan.bytes = Buffer.from('private') },
    (value) => { Object.defineProperty(value, 'hidden', { value: true }) },
    (value) => { value.frame_repair_quality['x'.repeat(241)] = true },
    (value) => { value.frame_repair_quality.result = undefined },
    (value) => { value.frame_repair_context_base.sealed_artifacts = [] },
    (value) => { value.frame_repair_context_base.parent_sheet_ref = '/private/sheet.png' },
    (value) => { value.frame_repair_context_base.provider_preset.apiKey = 'private-key' },
    (value) => { value.frame_repair_context_base.provider_calls_used = 0 },
    (value) => { value.frame_repair_context_base.context_frames.reverse() },
    (value) => { value.frame_repair_context_base.input_reference_roles.reverse() },
    (value) => { value.frame_repair_context_base.plan_hash = 'f'.repeat(64) },
    (value) => {
      value.frame_repair_context_base.asset_id = 'asset_other'
      value.frame_repair_context_base.parent_sheet_ref =
        'workspace/projects/project_demo/assets/asset_other/rev_003/normalized_sheet.png'
    },
    (value) => { value.frame_repair_context_base.mask_sha256 = 'f'.repeat(64) },
    (value) => { value.frame_repair_context_base.provider_preset.label = 'Different provider label' },
    (value) => { value.frame_repair_context_base.context_frames[0].sheet_frame_index = 15 },
  ]
  for (const mutate of mutations) await expectInvalidEvidence(mutate)

  await expectInvalidEvidence((value) => {
    value.frame_repair_plan.self = value.frame_repair_plan
  })
  for (const prompt of [
    Buffer.from('Bearer private.token\n'),
    Buffer.from('/Users/private/prompt.txt\n'),
    Buffer.from('data:image/png;base64,AAAA\n'),
    Buffer.from([0xff, 0xfe, 0xfd]),
  ]) {
    await expectInvalidEvidence((value) => { value.frame_repair_prompt = prompt })
  }
  await expectInvalidEvidence((value) => { value.target_before = Buffer.from('not-png') })
})

test('writer rejects oversized plan JSON before creating any artifacts', async () => {
  const fixture = await artifactHarness()
  const evidence = frameRepairEvidenceFixture(fixture.job.id)
  evidence.frame_repair_plan.notes = Array.from({ length: 80 }, () => 'x'.repeat(20_000))
  evidence.frame_repair_context_base.plan_hash = hashFrameRepairPlan(evidence.frame_repair_plan)

  await expectArtifactFailure(() => writeFrameRepairArtifacts({
    generatedDir: fixture.generatedDir,
    job: fixture.job,
    characterResult: characterResultFixture(),
    evidence,
  }))
  assert.deepEqual(await readdir(fixture.jobDir), [])
})

test('writer rejects caller Buffer mutation between validation and write', async () => {
  const fixture = await artifactHarness()
  const evidence = frameRepairEvidenceFixture(fixture.job.id)
  const sharedTarget = new SharedArrayBuffer(TINY_PNG.length)
  const targetBefore = Buffer.from(sharedTarget)
  TINY_PNG.copy(targetBefore)
  evidence.target_before = targetBefore
  const worker = new Worker(`
    const { parentPort, workerData } = require('node:worker_threads')
    const { watch } = require('node:fs')
    const target = new Uint8Array(workerData.target)
    const watcher = watch(workerData.jobDir, (_eventType, fileName) => {
      if (String(fileName) !== 'source.png') return
      target.fill(0)
      watcher.close()
      parentPort.postMessage({ type: 'mutated' })
    })
    const timeout = setTimeout(() => {
      watcher.close()
      parentPort.postMessage({ type: 'timeout' })
    }, 5000)
    watcher.on('close', () => clearTimeout(timeout))
    parentPort.postMessage({ type: 'ready' })
  `, {
    eval: true,
    workerData: {
      jobDir: fixture.jobDir,
      target: sharedTarget,
    },
  })
  const waitForWorkerMessage = (type) => new Promise((resolve, reject) => {
    const onMessage = (message) => {
      if (message?.type === 'timeout') {
        cleanup()
        reject(new Error('source write was not observed'))
        return
      }
      if (message?.type !== type) return
      cleanup()
      resolve(message)
    }
    const onError = (error) => {
      cleanup()
      reject(error)
    }
    const cleanup = () => {
      worker.off('message', onMessage)
      worker.off('error', onError)
    }
    worker.on('message', onMessage)
    worker.on('error', onError)
  })

  try {
    await waitForWorkerMessage('ready')
    const failure = expectArtifactFailure(() => writeFrameRepairArtifacts({
      generatedDir: fixture.generatedDir,
      job: fixture.job,
      characterResult: characterResultFixture(),
      evidence,
    }))
    await waitForWorkerMessage('mutated')
    await failure
  } finally {
    await worker.terminate()
  }
})

test('verification and recovery reject missing files, symlinks, outer tamper, and digest mismatch', async () => {
  const missing = await completedArtifactFixture()
  await unlink(path.join(missing.jobDir, 'frame_repair_mask.png'))
  await expectArtifactFailure(() => verifySealedFrameRepairArtifacts({
    generatedDir: missing.generatedDir,
    job: missing.job,
  }))
  await expectArtifactFailure(() => recoverSealedFrameRepairArtifacts({
    generatedDir: missing.generatedDir,
    jobId: missing.job.id,
    expectedManifestSha256: missing.written.artifact_manifest_sha256,
  }))

  const linked = await completedArtifactFixture()
  const outside = path.join(linked.root, 'outside.png')
  await writeFile(outside, TINY_PNG)
  await unlink(path.join(linked.jobDir, 'target_before.png'))
  await symlink(outside, path.join(linked.jobDir, 'target_before.png'))
  await expectArtifactFailure(() => verifySealedFrameRepairArtifacts({
    generatedDir: linked.generatedDir,
    job: linked.job,
  }))

  const containedLink = await completedArtifactFixture()
  await unlink(path.join(containedLink.jobDir, 'target_before.png'))
  await symlink('frame_repair_mask.png', path.join(containedLink.jobDir, 'target_before.png'))
  await expectArtifactFailure(() => verifySealedFrameRepairArtifacts({
    generatedDir: containedLink.generatedDir,
    job: containedLink.job,
  }))
  await expectArtifactFailure(() => recoverSealedFrameRepairArtifacts({
    generatedDir: containedLink.generatedDir,
    jobId: containedLink.job.id,
    expectedManifestSha256: containedLink.written.artifact_manifest_sha256,
  }))

  const outer = await completedArtifactFixture()
  const malformedJob = {
    ...outer.job,
    artifact_integrity_manifest: structuredClone(outer.job.artifact_integrity_manifest),
  }
  malformedJob.artifact_integrity_manifest[0].size += 1
  await expectArtifactFailure(() => verifySealedFrameRepairArtifacts({
    generatedDir: outer.generatedDir,
    job: malformedJob,
  }))
  await expectArtifactFailure(() => recoverSealedFrameRepairArtifacts({
    generatedDir: outer.generatedDir,
    jobId: outer.job.id,
    expectedManifestSha256: 'f'.repeat(64),
  }))
})

test('inner Context binding rejects replacement and a recomputed outer manifest', async () => {
  const fixture = await completedArtifactFixture()
  const replacement = Buffer.from('{"tampered":true}\n')
  await writeFile(path.join(fixture.jobDir, 'frame_repair_quality.json'), replacement)
  const manifest = structuredClone(fixture.job.artifact_integrity_manifest)
  const quality = manifest.find((entry) => entry.key === 'frame_repair_quality')
  quality.size = replacement.length
  quality.sha256 = artifactSha256(replacement)
  const forgedJob = {
    ...fixture.job,
    artifact_integrity_manifest: manifest,
    artifact_manifest_sha256: hashFrameRepairPlan(manifest),
  }
  await expectArtifactFailure(() => verifySealedFrameRepairArtifacts({
    generatedDir: fixture.generatedDir,
    job: forgedJob,
  }))

  const contextFixture = await completedArtifactFixture()
  const contextPath = path.join(contextFixture.jobDir, 'editor_frame_repair_context.json')
  const context = JSON.parse(await readFile(contextPath, 'utf8'))
  context.sealed_artifacts[0].size += 1
  await writeFile(contextPath, `${JSON.stringify(context, null, 2)}\n`)
  await expectArtifactFailure(() => verifySealedFrameRepairArtifacts({
    generatedDir: contextFixture.generatedDir,
    job: contextFixture.job,
  }))
  await expectArtifactFailure(() => recoverSealedFrameRepairArtifacts({
    generatedDir: contextFixture.generatedDir,
    jobId: contextFixture.job.id,
    expectedManifestSha256: contextFixture.written.artifact_manifest_sha256,
  }))
})
