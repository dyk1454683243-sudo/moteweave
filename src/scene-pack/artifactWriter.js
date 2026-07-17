import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { buildScenePackArtifactManifest } from './artifactManifest.js'
import { buildScenePackZip } from './zipExport.js'

export async function writeScenePackArtifacts({ jobId, outputDir, result } = {}) {
  if (!jobId) throw new Error('jobId is required')
  if (!outputDir) throw new Error('outputDir is required')
  if (!result) throw new Error('result is required')

  const jobDir = path.join(outputDir, jobId)
  await mkdir(jobDir, { recursive: true })
  const resultWithZip = {
    ...result,
    files: {
      ...(result.files ?? {}),
      zipBuffer: result.files?.zipBuffer ?? await buildScenePackZip(result),
    },
  }
  const manifest = buildScenePackArtifactManifest(jobId, resultWithZip)
  for (const file of manifest.files) {
    const content = Buffer.isBuffer(file.content) ? file.content : JSON.stringify(file.content, null, 2)
    const filePath = path.join(jobDir, file.name)
    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(filePath, content)
  }

  const failed = resultWithZip.qualityGate?.status === 'fail'
  return {
    job_id: jobId,
    dir: jobDir,
    status: failed ? 'failed_quality_gate' : 'done',
    reason: failed ? resultWithZip.qualityGate?.blocking_errors?.[0] ?? 'tile_quality_gate_failed' : null,
    retry_hint: failed ? 'inspect_tile_quality_gate' : null,
    urls: manifest.urls,
  }
}
