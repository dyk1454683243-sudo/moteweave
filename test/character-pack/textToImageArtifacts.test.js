import test from 'node:test'
import assert from 'node:assert/strict'
import { access, mkdtemp, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  buildTextToImageArtifactManifest,
  writeTextToImageArtifacts,
} from '../../src/character-pack/textToImageArtifacts.js'

async function exists(filePath) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

function makeResult() {
  return {
    sourcePng: Buffer.from('source'),
    resultPng: Buffer.from('result'),
    report: { status: 'done' },
    promptTxt: Buffer.from('prompt'),
    generationJson: { provider: 'mock' },
    candidates: [
      { index: 0, score: 12, buffer: Buffer.from('candidate') },
    ],
  }
}

test('buildTextToImageArtifactManifest preserves provider-free release behavior without a generation gate', () => {
  const manifest = buildTextToImageArtifactManifest('t2i_legacy', makeResult())

  assert.equal('artifactDisposition' in manifest, false)
  assert.equal(manifest.files.some((file) => file.name === 'generation_release_gate.json'), false)
  assert.equal(manifest.urls.zip_url, '/generated/t2i_legacy/t2i_pack.zip')
  assert.equal('generation_release_gate_url' in manifest.urls, false)
})

test('buildTextToImageArtifactManifest keeps the package and gate URL for a passing live generation gate', () => {
  const result = makeResult()
  result.generationReleaseGate = {
    schema_version: 1,
    mode: 'generation_release_gate_v1',
    generation_mode: 'quality_character_v0',
    policy: 'golden_review_hard_thresholds_v1',
    status: 'pass',
    release_ready: true,
    blocking_errors: [],
    warnings: [],
    evidence: {},
  }
  result.releaseReady = true
  result.artifactDisposition = 'release'

  const manifest = buildTextToImageArtifactManifest('t2i_release', result)

  assert.equal(manifest.artifactDisposition, 'release')
  assert.equal(manifest.files.some((file) => file.name === 'generation_release_gate.json'), true)
  assert.equal(manifest.urls.generation_release_gate_url, '/generated/t2i_release/generation_release_gate.json')
  assert.equal(manifest.urls.zip_url, '/generated/t2i_release/t2i_pack.zip')
})

test('buildTextToImageArtifactManifest keeps candidate evidence but omits the package URL for a failed live generation gate', () => {
  const result = makeResult()
  result.generationReleaseGate = {
    schema_version: 1,
    mode: 'generation_release_gate_v1',
    status: 'fail',
    release_ready: false,
    blocking_errors: ['quality_character.edge_crop'],
  }
  result.releaseReady = false
  result.artifactDisposition = 'diagnostic_only'

  const manifest = buildTextToImageArtifactManifest('t2i_diagnostic', result)
  const names = manifest.files.map((file) => file.name)

  assert.equal(manifest.artifactDisposition, 'diagnostic_only')
  assert.deepEqual(names, [
    'source.png',
    't2i_result.png',
    't2i_report.json',
    'generation_release_gate.json',
    'prompt.txt',
    'generation.json',
    'candidate_0.png',
  ])
  assert.equal(manifest.urls.generation_release_gate_url, '/generated/t2i_diagnostic/generation_release_gate.json')
  assert.equal(manifest.urls.candidate_urls[0].url, '/generated/t2i_diagnostic/candidate_0.png')
  assert.equal('zip_url' in manifest.urls, false)
})

test('writeTextToImageArtifacts keeps provider-free behavior and writes the package', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 't2i-artifact-legacy-'))
  const summary = await writeTextToImageArtifacts({
    jobId: 't2i_legacy',
    outputDir,
    result: makeResult(),
  })

  assert.equal(summary.status, 'done')
  assert.equal('artifact_disposition' in summary, false)
  assert.equal(summary.urls.zip_url, '/generated/t2i_legacy/t2i_pack.zip')
  assert.equal(await exists(path.join(outputDir, 't2i_legacy', 't2i_pack.zip')), true)
})

test('writeTextToImageArtifacts persists diagnostic evidence without building a package for a failed live generation gate', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 't2i-artifact-gate-fail-'))
  const result = makeResult()
  result.generationReleaseGate = {
    schema_version: 1,
    mode: 'generation_release_gate_v1',
    status: 'fail',
    release_ready: false,
    blocking_errors: ['quality_character.edge_crop'],
  }
  result.releaseReady = false
  result.artifactDisposition = 'diagnostic_only'

  const summary = await writeTextToImageArtifacts({
    jobId: 't2i_gate_fail',
    outputDir,
    result,
  })

  assert.equal(summary.status, 'failed_quality_gate')
  assert.equal(summary.failure_status, 'generation_release_gate_failed')
  assert.equal(summary.artifact_disposition, 'diagnostic_only')
  assert.equal(summary.reason, 'quality_character.edge_crop')
  assert.equal(summary.retry_hint, 'inspect_generation_evidence')
  assert.equal(summary.urls.generation_release_gate_url, '/generated/t2i_gate_fail/generation_release_gate.json')
  assert.equal('zip_url' in summary.urls, false)
  assert.deepEqual(
    JSON.parse(await readFile(path.join(outputDir, 't2i_gate_fail', 'generation_release_gate.json'), 'utf8')),
    result.generationReleaseGate
  )
  assert.equal(await exists(path.join(outputDir, 't2i_gate_fail', 'source.png')), true)
  assert.equal(await exists(path.join(outputDir, 't2i_gate_fail', 't2i_result.png')), true)
  assert.equal(await exists(path.join(outputDir, 't2i_gate_fail', 't2i_report.json')), true)
  assert.equal(await exists(path.join(outputDir, 't2i_gate_fail', 'candidate_0.png')), true)
  assert.equal(await exists(path.join(outputDir, 't2i_gate_fail', 't2i_pack.zip')), false)
})

test('writeTextToImageArtifacts uses a stable fallback reason when a failed gate has no blocker detail', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 't2i-artifact-gate-fallback-'))
  const result = makeResult()
  result.generationReleaseGate = {
    schema_version: 1,
    mode: 'generation_release_gate_v1',
    status: 'fail',
    release_ready: false,
    blocking_errors: [],
  }

  const summary = await writeTextToImageArtifacts({
    jobId: 't2i_gate_fallback',
    outputDir,
    result,
  })

  assert.equal(summary.status, 'failed_quality_gate')
  assert.equal(summary.reason, 'generation_release_gate_failed')
  assert.equal(summary.artifact_disposition, 'diagnostic_only')
  assert.equal(await exists(path.join(outputDir, 't2i_gate_fallback', 't2i_pack.zip')), false)
})

test('writeTextToImageArtifacts rejects an existing job directory instead of reusing a release package', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 't2i-artifact-collision-'))
  const jobId = 't2i_collision'
  await writeTextToImageArtifacts({ jobId, outputDir, result: makeResult() })
  const zipPath = path.join(outputDir, jobId, 't2i_pack.zip')
  const originalZip = await readFile(zipPath)
  const blocked = makeResult()
  blocked.generationReleaseGate = {
    schema_version: 1,
    mode: 'generation_release_gate_v1',
    status: 'fail',
    release_ready: false,
    blocking_errors: ['quality_character.edge_crop'],
  }
  blocked.releaseReady = false
  blocked.artifactDisposition = 'diagnostic_only'

  await assert.rejects(
    writeTextToImageArtifacts({ jobId, outputDir, result: blocked }),
    (error) => error?.code === 'EEXIST'
  )
  assert.deepEqual(await readFile(zipPath), originalZip)
})
