import test from 'node:test'
import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  BACKGROUND_MATTE_V2_ARTIFACT_FILES,
  BACKGROUND_MATTE_V2_AUXILIARY_ARTIFACT_FILES,
} from '../../src/character-pack/backgroundMatteV2.js'
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

test('writeCharacterPackArtifacts publishes a strict human acceptance even when automated validation failed', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'artifact-writer-human-accepted-'))
  const result = makeResult('fail')
  const manualAcceptance = {
    schema_version: 1,
    protocol: 'full_sheet_manual_acceptance_v1',
    acceptance_id: 'accepted_v1_job_reviewed',
    source_job_id: 'job_reviewed',
    published_job_id: 'accepted_v1_job_reviewed',
    decision: 'accepted',
    decision_authority: 'human',
    generation_profile_id: 'full_sheet_fixed_region_v1',
    prompt_contract_version: 'character_prompt_contract_v1_18',
    accepted_at: '2026-08-09T08:00:00.000Z',
    human_reviewed_issue_count: 1,
    provider_calls_used: 0,
    generation_review: {
      reviewed_run_id: 'generation_review_1',
      plan_hash: 'a'.repeat(64),
      reference_manifest_sha256: 'b'.repeat(64),
      prompt_text_sha256: '1'.repeat(64),
    },
    source_artifacts: {
      raw_provider_output_file: 'raw_provider_output.png',
      raw_provider_output_sha256: 'c'.repeat(64),
      raw_provider_output_byte_length: 3,
      source_sha256: 'd'.repeat(64),
      source_byte_length: 4,
      normalized_sheet_sha256: 'e'.repeat(64),
      normalized_sheet_byte_length: 5,
      prompt_sha256: '1'.repeat(64),
      prompt_byte_length: 6,
      generation_release_gate_sha256: 'f'.repeat(64),
    },
    publication_artifacts: {
      release_files: [
        { file: 'godot_npc_pack.zip', sha256: '2'.repeat(64), byte_length: 7 },
        { file: 'ocad_pack.zip', sha256: '4'.repeat(64), byte_length: 9 },
        { file: 'rpgmaker_pack.zip', sha256: '3'.repeat(64), byte_length: 8 },
      ],
      character_pack_entries: [
        { file: 'animations.json', sha256: '5'.repeat(64), byte_length: 10 },
      ],
      metadata_without_generation_sha256: '6'.repeat(64),
      engine_zips: {
        godot_npc: { file: 'godot_npc_pack.zip', sha256: '2'.repeat(64), byte_length: 7 },
        rpgmaker: { file: 'rpgmaker_pack.zip', sha256: '3'.repeat(64), byte_length: 8 },
        ocad: { file: 'ocad_pack.zip', sha256: '4'.repeat(64), byte_length: 9 },
      },
    },
  }
  result.debugReport.generation_profile = { id: 'full_sheet_fixed_region_v1' }
  result.generationReleaseGate = {
    schema_version: 1,
    mode: 'generation_release_gate_v1',
    generation_mode: 'production_sheet_v0',
    policy: 'strict_live_generation_v1',
    status: 'accepted',
    release_ready: true,
    manual_review_required: false,
    human_decision_status: 'accepted',
    generation_profile_id: 'full_sheet_fixed_region_v1',
    prompt_contract_version: 'character_prompt_contract_v1_18',
    blocking_errors: [],
    automated_review_findings: ['validation.status_not_pass'],
    warnings: ['validation:frame_0_empty'],
    evidence: {},
    manual_acceptance: manualAcceptance,
  }
  result.releaseReady = true
  result.manualReviewRequired = false
  result.humanDecisionStatus = 'accepted'
  result.generationProfileId = 'full_sheet_fixed_region_v1'
  result.promptContractVersion = 'character_prompt_contract_v1_18'
  result.artifactDisposition = 'release'
  result.files.manualAcceptanceJson = Buffer.from(JSON.stringify(manualAcceptance))

  const summary = await writeCharacterPackArtifacts({
    jobId: 'accepted_v1_job_reviewed',
    outputDir,
    result,
  })

  assert.equal(summary.status, 'done')
  assert.equal(summary.artifact_disposition, 'release')
  assert.equal(summary.human_decision_status, 'accepted')
  assert.equal(await exists(path.join(outputDir, 'accepted_v1_job_reviewed', 'character_pack.zip')), true)
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

test('writeCharacterPackArtifacts completes strict generation as review-required without automatic quality failure', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'artifact-writer-review-'))
  const result = makeResult('fail')
  result.generationReleaseGate = {
    schema_version: 1,
    mode: 'generation_release_gate_v1',
    generation_mode: 'production_sheet_v0',
    policy: 'strict_live_generation_v1',
    status: 'needs_review',
    release_ready: false,
    manual_review_required: true,
    human_decision_status: 'pending',
    blocking_errors: [],
    automated_review_findings: ['validation.status_not_pass'],
    warnings: [],
    evidence: {},
  }
  result.releaseReady = false
  result.manualReviewRequired = true
  result.humanDecisionStatus = 'pending'
  result.artifactDisposition = 'review_required'
  result.files.rawProviderOutputBuffer = Buffer.from('exact raw provider bytes')
  result.files.rawProviderOutputFileName = 'raw_provider_output.png'
  result.files.backgroundRemovedProviderOutputBuffer = Buffer.from('exact matte output bytes')
  result.files.backgroundRemovedProviderOutputFileName = BACKGROUND_MATTE_V2_ARTIFACT_FILES.OUTPUT
  result.files.backgroundMatteV2ArtifactBuffers = Object.fromEntries(
    BACKGROUND_MATTE_V2_AUXILIARY_ARTIFACT_FILES.map((file) => [file, Buffer.from(file)]),
  )
  result.files.sourceSubjectCountReportJson = { status: 'blocked' }
  result.files.sourceSubjectCountOverlayPng = Buffer.from('source overlay')
  result.files.normalizedSubjectCountReportJson = { status: 'blocked' }
  result.files.normalizedSubjectCountOverlayPng = Buffer.from('normalized overlay')
  result.files.godotNpcZipBuffer = Buffer.from('godot')

  const summary = await writeCharacterPackArtifacts({
    jobId: 'job_review',
    outputDir,
    result,
  })

  assert.equal(summary.status, 'done')
  assert.equal(summary.reason, null)
  assert.equal(summary.retry_hint, null)
  assert.equal(summary.failure_status, null)
  assert.equal(summary.artifact_disposition, 'review_required')
  assert.equal(summary.manual_review_required, true)
  assert.equal(summary.review_status, 'awaiting_human_review')
  assert.equal(summary.human_decision_status, 'pending')
  assert.equal(summary.urls.raw_provider_output_url, '/generated/job_review/raw_provider_output.png')
  assert.equal(
    summary.urls.background_review_url,
    '/generated/job_review/background_review.json',
  )
  assert.deepEqual(
    await readFile(path.join(outputDir, 'job_review', 'raw_provider_output.png')),
    Buffer.from('exact raw provider bytes')
  )
  assert.equal(await exists(path.join(outputDir, 'job_review', 'source.png')), true)
  assert.equal(await exists(path.join(outputDir, 'job_review', 'normalized_sheet.png')), true)
  assert.equal(await exists(path.join(outputDir, 'job_review', 'source_subject_count_overlay.png')), true)
  assert.equal(await exists(path.join(outputDir, 'job_review', 'normalized_subject_count_overlay.png')), true)
  for (const file of Object.values(BACKGROUND_MATTE_V2_ARTIFACT_FILES)) {
    assert.equal(await exists(path.join(outputDir, 'job_review', file)), true)
  }
  assert.equal(await exists(path.join(outputDir, 'job_review', 'character_pack.zip')), false)
  assert.equal(await exists(path.join(outputDir, 'job_review', 'godot_npc_pack.zip')), false)
})

test('writeCharacterPackArtifacts verifies and preserves a raw Provider image written before processing', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'artifact-writer-prewritten-raw-'))
  const jobId = 'job_prewritten_raw'
  const jobDir = path.join(outputDir, jobId)
  const raw = Buffer.from('exact raw Provider image bytes')
  const result = makeResult('pass')
  result.files.rawProviderOutputBuffer = raw
  result.files.rawProviderOutputFileName = 'raw_provider_output.png'
  await mkdir(jobDir)
  await writeFile(path.join(jobDir, 'raw_provider_output.png'), raw, { flag: 'wx' })

  const summary = await writeCharacterPackArtifacts({
    jobId,
    outputDir,
    result,
    allowExistingJobDir: true,
    verifiedExistingFiles: ['raw_provider_output.png'],
  })

  assert.equal(summary.status, 'done')
  assert.deepEqual(await readFile(path.join(jobDir, 'raw_provider_output.png')), raw)
  assert.equal(await exists(path.join(jobDir, 'source.png')), true)
})

test('writeCharacterPackArtifacts rejects a changed prewritten raw Provider image', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'artifact-writer-prewritten-raw-mismatch-'))
  const jobId = 'job_prewritten_raw_mismatch'
  const jobDir = path.join(outputDir, jobId)
  const result = makeResult('pass')
  result.files.rawProviderOutputBuffer = Buffer.from('expected raw bytes')
  result.files.rawProviderOutputFileName = 'raw_provider_output.png'
  await mkdir(jobDir)
  await writeFile(path.join(jobDir, 'raw_provider_output.png'), 'changed raw bytes', { flag: 'wx' })

  await assert.rejects(
    writeCharacterPackArtifacts({
      jobId,
      outputDir,
      result,
      allowExistingJobDir: true,
      verifiedExistingFiles: ['raw_provider_output.png'],
    }),
    (error) => error?.code === 'EEXIST'
  )
  assert.equal(await exists(path.join(jobDir, 'source.png')), false)
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
