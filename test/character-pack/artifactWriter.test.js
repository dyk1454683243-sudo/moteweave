import test from 'node:test'
import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { writeCharacterPackArtifacts } from '../../src/character-pack/artifactWriter.js'

async function exists(filePath) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

function makeResult(validationStatus = 'pass') {
  return {
    animationsJson: { animations: {} },
    inspectionPreviews: [
      {
        fileName: 'inspection_gifs/walk_down.gif',
        runtimeFileName: 'walk_down.gif',
        stripFileName: 'inspection_strips/walk_down.png',
        animation: 'walk_down',
        label: 'walk down',
      },
    ],
    metadataJson: { id: 'pack' },
    editorMetadataJson: { sheet: 'normalized_sheet.png' },
    debugReport: { validation: { status: validationStatus, blocking_errors: validationStatus === 'fail' ? ['frame_0_empty'] : [] } },
    files: {
      sourcePng: Buffer.from('source'),
      normalizedSheetPng: Buffer.from('sheet'),
      debugOverlayPng: Buffer.from('debug'),
      onionSkinOverlayPng: Buffer.from('onion'),
      inspectionIndexJson: { mode: 'inspection_preview_v1' },
      inspectionSheetPng: Buffer.from('inspection sheet'),
      inspectionGifBuffers: { 'inspection_gifs/walk_down.gif': Buffer.from('inspection gif') },
      inspectionStripPngBuffers: { 'inspection_strips/walk_down.png': Buffer.from('inspection strip') },
      rowGifBuffers: {},
      zipBuffer: Buffer.from('zip'),
    },
  }
}

test('writeCharacterPackArtifacts writes manifest files and returns done summary', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'artifact-writer-'))
  const summary = await writeCharacterPackArtifacts({
    jobId: 'job_cli',
    outputDir,
    result: makeResult('pass'),
  })

  assert.equal(summary.job_id, 'job_cli')
  assert.equal(summary.status, 'done')
  assert.equal(summary.reason, null)
  assert.equal(summary.retry_hint, null)
  assert.equal('artifact_disposition' in summary, false)
  assert.equal(summary.urls.editor_metadata_url, '/generated/job_cli/editor_metadata.json')
  assert.equal(summary.urls.inspection_sheet_url, '/generated/job_cli/inspection_sheet.png')
  assert.equal(await exists(path.join(outputDir, 'job_cli', 'editor_metadata.json')), true)
  assert.equal(await exists(path.join(outputDir, 'job_cli', 'inspection_gifs', 'walk_down.gif')), true)
  assert.equal(await exists(path.join(outputDir, 'job_cli', 'inspection_strips', 'walk_down.png')), true)
  assert.equal(await exists(path.join(outputDir, 'job_cli', 'character_pack.zip')), true)
})

test('writeCharacterPackArtifacts reports failed post-processing status', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'artifact-writer-fail-'))
  const summary = await writeCharacterPackArtifacts({
    jobId: 'job_fail',
    outputDir,
    result: makeResult('fail'),
  })

  assert.equal(summary.status, 'failed_post_processing')
  assert.equal(summary.reason, 'frame_0_empty')
  assert.equal(summary.retry_hint, 'manual_inspect')
})

test('writeCharacterPackArtifacts publishes a passing live generation gate', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'artifact-writer-release-'))
  const result = makeResult('pass')
  result.generationReleaseGate = {
    schema_version: 1,
    mode: 'generation_release_gate_v1',
    generation_mode: 'production_sheet_v0',
    policy: 'strict_live_generation_v1',
    status: 'pass',
    release_ready: true,
    blocking_errors: [],
    warnings: [],
    evidence: {},
  }
  result.releaseReady = true
  result.artifactDisposition = 'release'

  const summary = await writeCharacterPackArtifacts({
    jobId: 'job_release',
    outputDir,
    result,
  })

  assert.equal(summary.status, 'done')
  assert.equal(summary.failure_status, null)
  assert.equal(summary.artifact_disposition, 'release')
  assert.equal(summary.urls.generation_release_gate_url, '/generated/job_release/generation_release_gate.json')
  assert.equal(summary.urls.zip_url, '/generated/job_release/character_pack.zip')
  assert.equal(await exists(path.join(outputDir, 'job_release', 'generation_release_gate.json')), true)
  assert.equal(await exists(path.join(outputDir, 'job_release', 'character_pack.zip')), true)
})

test('writeCharacterPackArtifacts persists diagnostics without release packages when the live generation gate fails', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'artifact-writer-gate-fail-'))
  const result = makeResult('fail')
  result.generationReleaseGate = {
    schema_version: 1,
    mode: 'generation_release_gate_v1',
    status: 'fail',
    release_ready: false,
    blocking_errors: ['sheet.cell_empty'],
  }
  result.releaseReady = false
  result.artifactDisposition = 'diagnostic_only'
  result.files.sourceQualityReportJson = { status: 'fail' }
  result.files.promptTxt = Buffer.from('prompt')
  result.files.generationJson = { provider: 'mock' }
  result.files.godotNpcZipBuffer = Buffer.from('godot')
  result.files.rpgmakerZipBuffer = Buffer.from('rpgmaker')
  result.files.ocadZipBuffer = Buffer.from('ocad')

  const summary = await writeCharacterPackArtifacts({
    jobId: 'job_gate_fail',
    outputDir,
    result,
  })

  assert.equal(summary.status, 'failed_quality_gate')
  assert.equal(summary.failure_status, 'generation_release_gate_failed')
  assert.equal(summary.artifact_disposition, 'diagnostic_only')
  assert.equal(summary.reason, 'sheet.cell_empty')
  assert.equal(summary.retry_hint, 'inspect_generation_evidence')
  assert.equal(summary.urls.generation_release_gate_url, '/generated/job_gate_fail/generation_release_gate.json')
  assert.equal('zip_url' in summary.urls, false)
  assert.equal('godot_npc_zip_url' in summary.urls, false)
  assert.deepEqual(
    JSON.parse(await readFile(path.join(outputDir, 'job_gate_fail', 'generation_release_gate.json'), 'utf8')),
    result.generationReleaseGate
  )
  assert.equal(await exists(path.join(outputDir, 'job_gate_fail', 'source.png')), true)
  assert.equal(await exists(path.join(outputDir, 'job_gate_fail', 'normalized_sheet.png')), true)
  assert.equal(await exists(path.join(outputDir, 'job_gate_fail', 'debug_report.json')), true)
  assert.equal(await exists(path.join(outputDir, 'job_gate_fail', 'source_quality_report.json')), true)
  assert.equal(await exists(path.join(outputDir, 'job_gate_fail', 'prompt.txt')), true)
  assert.equal(await exists(path.join(outputDir, 'job_gate_fail', 'generation.json')), true)
  assert.equal(await exists(path.join(outputDir, 'job_gate_fail', 'inspection_sheet.png')), true)
  assert.equal(await exists(path.join(outputDir, 'job_gate_fail', 'character_pack.zip')), false)
  assert.equal(await exists(path.join(outputDir, 'job_gate_fail', 'godot_npc_pack.zip')), false)
  assert.equal(await exists(path.join(outputDir, 'job_gate_fail', 'rpgmaker_pack.zip')), false)
  assert.equal(await exists(path.join(outputDir, 'job_gate_fail', 'ocad_pack.zip')), false)
})

test('writeCharacterPackArtifacts rejects an existing job directory instead of reusing release artifacts', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'artifact-writer-collision-'))
  const jobId = 'job_collision'
  await writeCharacterPackArtifacts({
    jobId,
    outputDir,
    result: makeResult('pass'),
  })
  const zipPath = path.join(outputDir, jobId, 'character_pack.zip')
  const originalZip = await readFile(zipPath)
  const blocked = makeResult('fail')
  blocked.generationReleaseGate = {
    release_ready: false,
    blocking_errors: ['sheet.cell_empty'],
  }
  blocked.releaseReady = false
  blocked.artifactDisposition = 'diagnostic_only'

  await assert.rejects(
    writeCharacterPackArtifacts({ jobId, outputDir, result: blocked }),
    (error) => error?.code === 'EEXIST'
  )
  assert.deepEqual(await readFile(zipPath), originalZip)
})

test('writeCharacterPackArtifacts can append new artifacts to an explicit diagnostic job directory', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'artifact-writer-diagnostic-prefix-'))
  const jobId = 'job_repair'
  const jobDir = path.join(outputDir, jobId)
  const planPath = path.join(jobDir, 'repair_plan.json')
  await mkdir(jobDir)
  await writeFile(planPath, 'repair plan')

  const summary = await writeCharacterPackArtifacts({
    jobId,
    outputDir,
    result: makeResult('pass'),
    allowExistingJobDir: true,
  })

  assert.equal(summary.status, 'done')
  assert.equal(await readFile(planPath, 'utf8'), 'repair plan')
  assert.equal(await exists(path.join(jobDir, 'character_pack.zip')), true)
})

test('writeCharacterPackArtifacts never overwrites a manifest target in an allowed existing directory', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'artifact-writer-existing-target-'))
  const jobId = 'job_existing_target'
  const jobDir = path.join(outputDir, jobId)
  const zipPath = path.join(jobDir, 'character_pack.zip')
  await mkdir(jobDir)
  await writeFile(zipPath, 'existing release')

  await assert.rejects(
    writeCharacterPackArtifacts({
      jobId,
      outputDir,
      result: makeResult('pass'),
      allowExistingJobDir: true,
    }),
    (error) => error?.code === 'EEXIST' && error?.path === zipPath
  )
  assert.equal(await readFile(zipPath, 'utf8'), 'existing release')
  assert.equal(await exists(path.join(jobDir, 'source.png')), false)
})
