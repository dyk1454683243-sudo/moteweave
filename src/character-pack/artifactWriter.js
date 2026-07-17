import { access, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { buildCharacterPackArtifactManifest } from './artifactManifest.js'

function firstGenerationReleaseBlocker(gate) {
  const blocker = gate?.blocking_errors?.[0]
  if (typeof blocker === 'string' && blocker) return blocker
  if (typeof blocker?.code === 'string' && blocker.code) return blocker.code
  if (typeof blocker?.reason === 'string' && blocker.reason) return blocker.reason
  return 'generation_release_gate_failed'
}

async function assertManifestTargetsAbsent(jobDir, files) {
  for (const file of files) {
    const target = path.join(jobDir, file.name)
    try {
      await access(target)
    } catch (error) {
      if (error?.code === 'ENOENT') continue
      throw error
    }
    throw Object.assign(new Error(`character artifact target already exists: ${target}`), {
      code: 'EEXIST',
      path: target,
    })
  }
}

export async function writeCharacterPackArtifacts({
  jobId,
  outputDir,
  result,
  allowExistingJobDir = false,
} = {}) {
  if (!jobId) throw new Error('jobId is required')
  if (!outputDir) throw new Error('outputDir is required')
  if (!result) throw new Error('result is required')

  const jobDir = path.join(outputDir, jobId)
  await mkdir(outputDir, { recursive: true })
  await mkdir(jobDir, allowExistingJobDir ? { recursive: true } : undefined)
  const manifest = buildCharacterPackArtifactManifest(jobId, result)
  await assertManifestTargetsAbsent(jobDir, manifest.files)
  for (const file of manifest.files) {
    const content = Buffer.isBuffer(file.content) ? file.content : JSON.stringify(file.content, null, 2)
    const target = path.join(jobDir, file.name)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, content, { flag: 'wx' })
  }

  const generationGateFailed = manifest.artifactDisposition === 'diagnostic_only'
  const failed = result.debugReport?.validation?.status === 'fail'
  return {
    job_id: jobId,
    dir: jobDir,
    status: generationGateFailed ? 'failed_quality_gate' : failed ? 'failed_post_processing' : 'done',
    reason: generationGateFailed
      ? firstGenerationReleaseBlocker(result.generationReleaseGate)
      : failed ? result.debugReport?.validation?.blocking_errors?.[0] ?? 'validation_failed' : null,
    retry_hint: generationGateFailed ? 'inspect_generation_evidence' : failed ? 'manual_inspect' : null,
    ...(result.generationReleaseGate ? {
      failure_status: generationGateFailed ? 'generation_release_gate_failed' : null,
      artifact_disposition: manifest.artifactDisposition,
    } : {}),
    urls: manifest.urls,
  }
}
