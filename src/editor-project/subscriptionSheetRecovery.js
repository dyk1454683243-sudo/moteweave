import { createHash } from 'node:crypto'
import { SPRITE_DOCUMENT_LIMITS } from './constants.js'
import { resolveGeneratedJobArtifactFile } from './paths.js'
import { captureCharacterPackProcessJob, readBoundedJobFile, readRequiredJobJson } from './spriteDocumentFromJob.js'

export function subscriptionMattePassed(report) {
  return report?.background_removal?.mode === 'deterministic_pixel_matte_v2'
    && report.background_removal.quality_status === 'pass'
}

// Only a project-owned, accepted candidate can recover its completed process job.
// This is a read-only projection; it never repopulates the generic in-memory job store.
export async function recoverSubscriptionProcessJob({ projectId, jobId, candidateId, generatedDir, readCandidate, currentJob = null }) {
  if (currentJob && currentJob.status !== 'done') return currentJob
  let metadata
  try { metadata = (await readRequiredJobJson(jobId, 'metadata', generatedDir)).value }
  catch { return currentJob }
  if (metadata.source?.type !== 'subscription_sheet') return currentJob
  try {
    const source = metadata.source
    if (source?.type !== 'subscription_sheet' || source.project_id !== projectId
      || !/^[A-Za-z0-9_-]{1,100}$/.test(source.candidate_id)
      || (candidateId && source.candidate_id !== candidateId)) return null
    const candidate = await readCandidate(source.candidate_id)
    if (!candidate || candidate.id !== source.candidate_id || candidate.projectId !== projectId
      || candidate.status !== 'accepted' || candidate.accepted !== true || candidate.process_attempted !== true
      || candidate.process_job_id !== jobId || !/^[0-9a-f]{64}$/.test(candidate.original?.sha256)
      || !/^[0-9a-f]{64}$/.test(candidate.derived?.sha256)
      || !subscriptionMattePassed(candidate.derivation?.report) || candidate.accepted_sha256 !== candidate.original.sha256
      || source.original_sha256 !== candidate.original.sha256 || source.derived_sha256 !== candidate.derived.sha256) return null
    const binding = candidate.process_binding
    if (binding?.candidate_id !== candidate.id || binding.project_id !== projectId
      || binding.process_job_id !== jobId || binding.original_sha256 !== candidate.original.sha256
      || binding.native_thread_id !== candidate.native_thread_id || binding.image_call_id !== candidate.image_call_id) return null
    const generation = metadata.generation
    if (generation?.provider !== 'subscription' || generation.channel !== 'subscription_native'
      || generation.candidate_id !== candidate.id || generation.original_sha256 !== candidate.original.sha256
      || generation.native_thread_id !== candidate.native_thread_id || generation.image_call_id !== candidate.image_call_id) return null
    const sourceFile = await resolveGeneratedJobArtifactFile({ jobId, fileName: 'source.png',
      allowedFiles: new Set(['source.png']), generatedDir })
    const sourceBytes = await readBoundedJobFile(sourceFile, SPRITE_DOCUMENT_LIMITS.maxManagedPngBytes)
    if (createHash('sha256').update(sourceBytes).digest('hex') !== candidate.derived.sha256) return null
    const urls = Object.fromEntries(Object.entries({ normalized_sheet: 'normalized_sheet.png', animations: 'animations.json',
      metadata: 'metadata.json', editor_metadata: 'editor_metadata.json', debug_report: 'debug_report.json' })
      .map(([key, file]) => [`${key}_url`, `/generated/${jobId}/${file}`]))
    const job = { id: jobId, status: 'done', type: 'process_sheet', ...urls }
    const captured = await captureCharacterPackProcessJob({ jobId, generatedDir, getGeneratedJob: () => job })
    const report = JSON.parse(captured.debugReportBytes.toString('utf8'))
    if (report.subject_count?.required !== true || report.subject_count.status !== 'pass'
      || !captured.pngBytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return null
    return { ...job, recovered_from_artifacts: true }
  } catch {
    // Missing, partial, unsafe or mismatched artifacts cannot establish completion.
    return null
  }
}
