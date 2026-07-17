import { fileToBase64 } from '../dom.js'

const TERMINAL_JOB_STATUSES = new Set(['done', 'failed_post_processing', 'failed_model_error', 'failed_safety_filter'])

export async function buildTwoPointFiveDTileset({ materialSourceFile = null, options = {} } = {}) {
  const response = await fetch('/api/build-two-point-five-d-tileset', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      material_source_base64: materialSourceFile ? await fileToBase64(materialSourceFile) : null,
      material_source_name: materialSourceFile?.name ?? null,
      options,
    }),
  })
  if (!response.ok) throw new Error(`2.5D tileset build failed: ${response.status}`)
  return response.json()
}

export async function planTwoPointFiveDMaterialSourceBenchmark(options = {}) {
  const response = await fetch('/api/two-point-five-d-material-source-benchmark', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...options,
      dryRunPlan: true,
    }),
  })
  const body = await response.json()
  if (!response.ok) throw new Error(body.reason || `2.5D benchmark plan failed: ${response.status}`)
  return body
}

export async function runTwoPointFiveDMaterialSourceBenchmark(options = {}) {
  const response = await fetch('/api/two-point-five-d-material-source-benchmark', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...options,
      confirm_live_generation: true,
    }),
  })
  const body = await response.json()
  if (!response.ok) throw new Error(body.reason || `2.5D benchmark run failed: ${response.status}`)
  return body
}

async function pollTilesetJob(jobId) {
  const response = await fetch(`/api/jobs/${jobId}`)
  if (!response.ok) throw new Error(`2.5D job poll failed: ${response.status}`)
  return response.json()
}

export async function waitForTwoPointFiveDJob(job, onUpdate = () => {}) {
  let current = job
  onUpdate(current)
  for (let index = 0; current.id && !TERMINAL_JOB_STATUSES.has(current.status) && index < 240; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500))
    current = await pollTilesetJob(current.id)
    onUpdate(current)
  }
  return current
}

export async function fetchJsonArtifact(url) {
  if (!url) return null
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Unable to fetch artifact: ${response.status}`)
  return response.json()
}
