const BASE_URL = process.env.CHARACTER_TOOL_URL || 'http://localhost:4173'
const POLL_MS = Number(process.env.OPENROUTER_SMOKE_POLL_MS || 2000)
const TIMEOUT_MS = Number(process.env.OPENROUTER_SMOKE_TIMEOUT_MS || 180000)
const TERMINAL = new Set(['done', 'failed_quality_gate', 'failed_safety_filter', 'failed_model_error', 'failed_post_processing'])
const DEFAULT_SMOKE_PRESET = 'fixed_region_motion_v0'

async function fetchJson(path, options) {
  const response = await fetch(new URL(path, BASE_URL), options)
  const text = await response.text()
  let json
  try {
    json = text ? JSON.parse(text) : {}
  } catch {
    throw new Error(`${path} returned non-JSON response: ${text.slice(0, 200)}`)
  }
  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}: ${JSON.stringify(json)}`)
  }
  return json
}

function assertPresent(value, message) {
  if (!value) throw new Error(message)
}

async function main() {
  const provider = await fetchJson('/api/gemini-state')
  if (!provider.implemented) {
    throw new Error('OpenRouter provider is not implemented by the running server')
  }
  if (!provider.available) {
    console.error('OPENROUTER_API_KEY is not configured in the running server environment.')
    console.error('Create .env from .env.example, set OPENROUTER_API_KEY, then rerun this smoke test.')
    process.exitCode = 2
    return
  }

  const description =
    process.env.OPENROUTER_SMOKE_DESCRIPTION ||
    'a small readable fantasy pixel RPG adventurer, silver hair, dark cloak, clear four-direction animation sheet'
  const imageSize = process.env.OPENROUTER_SMOKE_IMAGE_SIZE || '2K'
  const preset = process.env.OPENROUTER_SMOKE_PRESET || DEFAULT_SMOKE_PRESET
  const job = await fetchJson('/api/generate-character', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'openrouter_smoke',
      preset,
      description,
      imageConfig: {
        aspect_ratio: '1:1',
        image_size: imageSize,
      },
      generationOptions: {
        candidateCount: Number(process.env.OPENROUTER_SMOKE_CANDIDATE_COUNT || 1),
      },
      options: {
        name: 'openrouter_smoke',
        description,
        backgroundMode: 'auto',
        sourceLayout: preset,
      },
    }),
  })

  assertPresent(job.id, 'generation endpoint did not return a job id')
  const started = Date.now()
  let current = job
  while (!TERMINAL.has(current.status)) {
    if (Date.now() - started > TIMEOUT_MS) {
      throw new Error(`timed out waiting for ${job.id}; last status ${current.status}`)
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
    current = await fetchJson(`/api/jobs/${job.id}`)
  }

  if (current.status !== 'done') {
    throw new Error(`job ${job.id} failed: ${JSON.stringify(current, null, 2)}`)
  }

  assertPresent(current.source_url, 'missing source_url')
  assertPresent(current.prompt_url, 'missing prompt_url')
  assertPresent(current.generation_url, 'missing generation_url')
  assertPresent(current.normalized_sheet_url, 'missing normalized_sheet_url')
  assertPresent(current.debug_report_url, 'missing debug_report_url')
  assertPresent(current.debug_overlay_url, 'missing debug_overlay_url')
  assertPresent(current.onion_skin_overlay_url, 'missing onion_skin_overlay_url')
  assertPresent(current.zip_url, 'missing zip_url')
  assertPresent((current.row_gif_urls || []).length, 'missing row GIF previews')

  const report = await fetchJson(current.debug_report_url)
  if (report.validation?.status === 'fail') {
    throw new Error(`post-processing validation failed: ${JSON.stringify(report.validation, null, 2)}`)
  }

  console.log(
    JSON.stringify(
      {
        status: current.status,
        provider,
        job_id: current.id,
        source_url: current.source_url,
        normalized_sheet_url: current.normalized_sheet_url,
        debug_report_url: current.debug_report_url,
        row_gif_count: current.row_gif_urls.length,
        zip_url: current.zip_url,
        validation: report.validation?.status,
      },
      null,
      2
    )
  )
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error))
  process.exitCode = 1
})
