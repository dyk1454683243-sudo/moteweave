import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  buildCharacterPackArtifactManifest,
  encodeCharacterPackArtifactContent,
} from './artifactManifest.js'

function firstGenerationReleaseBlocker(gate) {
  const blocker = gate?.blocking_errors?.[0]
  if (typeof blocker === 'string' && blocker) return blocker
  if (typeof blocker?.code === 'string' && blocker.code) return blocker.code
  if (typeof blocker?.reason === 'string' && blocker.reason) return blocker.reason
  return 'generation_release_gate_failed'
}

async function assertManifestTargetsAbsent(jobDir, files, verifiedExistingFiles = []) {
  const verified = new Set(verifiedExistingFiles)
  const manifestNames = new Set(files.map((file) => file.name))
  for (const name of verified) {
    if (!manifestNames.has(name)) throw new Error(`verified existing artifact is not in manifest: ${name}`)
  }
  for (const file of files) {
    const target = path.join(jobDir, file.name)
    if (verified.has(file.name)) {
      if (!Buffer.isBuffer(file.content)) throw new Error(`verified existing artifact must be bytes: ${file.name}`)
      const existing = await readFile(target)
      if (!existing.equals(file.content)) {
        throw Object.assign(new Error(`verified existing artifact changed: ${target}`), {
          code: 'EEXIST',
          path: target,
        })
      }
      continue
    }
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
  verifiedExistingFiles = [],
} = {}) {
  if (!jobId) throw new Error('jobId is required')
  if (!outputDir) throw new Error('outputDir is required')
  if (!result) throw new Error('result is required')

  const jobDir = path.join(outputDir, jobId)
  if (verifiedExistingFiles.length && !allowExistingJobDir) {
    throw new Error('verified existing artifacts require allowExistingJobDir')
  }
  await mkdir(outputDir, { recursive: true })
  await mkdir(jobDir, allowExistingJobDir ? { recursive: true } : undefined)
  const manifest = buildCharacterPackArtifactManifest(jobId, result)
  await assertManifestTargetsAbsent(jobDir, manifest.files, verifiedExistingFiles)
  const verified = new Set(verifiedExistingFiles)
  for (const file of manifest.files) {
    if (verified.has(file.name)) continue
    const content = encodeCharacterPackArtifactContent(file.content)
    const target = path.join(jobDir, file.name)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, content, { flag: 'wx' })
  }

  const generationGateFailed = manifest.artifactDisposition === 'diagnostic_only'
  const manualReviewRequired = manifest.artifactDisposition === 'review_required'
  const humanAcceptedRelease =
    manifest.artifactDisposition === 'release' &&
    result.generationReleaseGate?.status === 'accepted' &&
    result.humanDecisionStatus === 'accepted'
  const failed = !humanAcceptedRelease && result.debugReport?.validation?.status === 'fail'
  return {
    job_id: jobId,
    dir: jobDir,
    status: manualReviewRequired
      ? 'done'
      : generationGateFailed ? 'failed_quality_gate' : failed ? 'failed_post_processing' : 'done',
    reason: manualReviewRequired
      ? null
      : generationGateFailed
      ? firstGenerationReleaseBlocker(result.generationReleaseGate)
      : failed ? result.debugReport?.validation?.blocking_errors?.[0] ?? 'validation_failed' : null,
    retry_hint: manualReviewRequired
      ? null
      : generationGateFailed ? 'inspect_generation_evidence' : failed ? 'manual_inspect' : null,
    ...(result.generationReleaseGate ? {
      failure_status: generationGateFailed ? 'generation_release_gate_failed' : null,
      artifact_disposition: manifest.artifactDisposition,
      manual_review_required: manualReviewRequired,
      review_status: manualReviewRequired ? 'awaiting_human_review' : null,
      human_decision_status: manualReviewRequired ? 'pending' : result.humanDecisionStatus ?? null,
    } : {}),
    urls: manifest.urls,
  }
}
