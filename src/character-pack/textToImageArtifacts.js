import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { buildCharacterPackZip } from './zipExport.js'
import { resolveGenerationArtifactDisposition } from './generationReleaseGate.js'

function generatedUrl(jobId, name) {
  return `/generated/${jobId}/${name}`
}

function optionalFile(name, content) {
  return content ? [{ name, content }] : []
}

function firstGenerationReleaseBlocker(gate) {
  const blocker = gate?.blocking_errors?.[0]
  if (typeof blocker === 'string' && blocker) return blocker
  if (typeof blocker?.code === 'string' && blocker.code) return blocker.code
  if (typeof blocker?.reason === 'string' && blocker.reason) return blocker.reason
  return 'generation_release_gate_failed'
}

export function buildTextToImageArtifactManifest(jobId, result) {
  const artifactDisposition = resolveGenerationArtifactDisposition(result)
  const publishReleaseArtifacts = artifactDisposition !== 'diagnostic_only'
  const candidateFiles = (result.candidates ?? [])
    .filter((candidate) => candidate.buffer)
    .map((candidate) => ({
      name: `candidate_${candidate.index}.png`,
      content: candidate.buffer,
      index: candidate.index,
      score: candidate.score,
    }))
  const files = [
    { name: 'source.png', content: result.sourcePng },
    { name: 't2i_result.png', content: result.resultPng },
    { name: 't2i_report.json', content: result.report },
    ...optionalFile('generation_release_gate.json', result.generationReleaseGate),
    ...optionalFile('prompt.txt', result.promptTxt),
    ...optionalFile('generation.json', result.generationJson),
    ...candidateFiles,
  ]
  return {
    files,
    urls: {
      result_url: generatedUrl(jobId, 't2i_report.json'),
      source_url: generatedUrl(jobId, 'source.png'),
      t2i_result_url: generatedUrl(jobId, 't2i_result.png'),
      ...(result.generationReleaseGate ? { generation_release_gate_url: generatedUrl(jobId, 'generation_release_gate.json') } : {}),
      prompt_url: generatedUrl(jobId, 'prompt.txt'),
      generation_url: generatedUrl(jobId, 'generation.json'),
      candidate_urls: candidateFiles.map((file) => ({
        index: file.index,
        score: file.score,
        url: generatedUrl(jobId, file.name),
      })),
      ...(publishReleaseArtifacts ? { zip_url: generatedUrl(jobId, 't2i_pack.zip') } : {}),
    },
    ...(artifactDisposition ? { artifactDisposition } : {}),
  }
}

export async function writeTextToImageArtifacts({ jobId, outputDir, result } = {}) {
  if (!jobId) throw new Error('jobId is required')
  if (!outputDir) throw new Error('outputDir is required')
  if (!result) throw new Error('result is required')
  const jobDir = path.join(outputDir, jobId)
  await mkdir(outputDir, { recursive: true })
  await mkdir(jobDir)
  const manifest = buildTextToImageArtifactManifest(jobId, result)
  const zipFiles = {}
  for (const file of manifest.files) {
    const content = Buffer.isBuffer(file.content) ? file.content : JSON.stringify(file.content, null, 2)
    await writeFile(path.join(jobDir, file.name), content)
    zipFiles[file.name] = content
  }
  const generationGateFailed = manifest.artifactDisposition === 'diagnostic_only'
  if (!generationGateFailed) {
    const zipBuffer = await buildCharacterPackZip(zipFiles)
    await writeFile(path.join(jobDir, 't2i_pack.zip'), zipBuffer)
  }
  return {
    job_id: jobId,
    dir: jobDir,
    status: generationGateFailed ? 'failed_quality_gate' : 'done',
    reason: generationGateFailed ? firstGenerationReleaseBlocker(result.generationReleaseGate) : null,
    retry_hint: generationGateFailed ? 'inspect_generation_evidence' : null,
    ...(result.generationReleaseGate ? {
      failure_status: generationGateFailed ? 'generation_release_gate_failed' : null,
      artifact_disposition: manifest.artifactDisposition,
    } : {}),
    urls: manifest.urls,
  }
}
