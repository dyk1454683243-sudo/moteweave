import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { buildProjectPackArtifactManifest } from './artifactManifest.js'
import { buildProjectPackZip } from './zipExport.js'

export async function writeProjectPackArtifacts({ jobId, outputDir, result } = {}) {
  if (!jobId) throw new Error('jobId is required')
  if (!outputDir) throw new Error('outputDir is required')
  if (!result) throw new Error('result is required')

  const jobDir = path.join(outputDir, jobId)
  await mkdir(jobDir, { recursive: true })
  const resultWithZip = {
    ...result,
    files: {
      ...(result.files ?? {}),
      zipBuffer: result.files?.zipBuffer ?? await buildProjectPackZip(result),
    },
  }
  const manifest = buildProjectPackArtifactManifest(jobId, resultWithZip)
  for (const file of manifest.files) {
    const content = Buffer.isBuffer(file.content) ? file.content : JSON.stringify(file.content, null, 2)
    await writeFile(path.join(jobDir, file.name), content)
  }

  const failed = resultWithZip.validation?.status === 'fail'
  return {
    job_id: jobId,
    dir: jobDir,
    status: failed ? 'failed_project_pack' : 'done',
    reason: failed ? resultWithZip.validation?.blocking_errors?.[0] ?? 'project_pack_validation_failed' : null,
    retry_hint: failed ? 'inspect_project_validation' : null,
    urls: manifest.urls,
  }
}
