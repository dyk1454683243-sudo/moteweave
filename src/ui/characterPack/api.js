import { fileToBase64 } from '../dom.js'
import { DEFAULT_GENERATION_PRESET } from '../../character-pack/generationDefaults.js'

const TERMINAL_JOB_STATUSES = new Set([
  'done',
  'failed_quality_gate',
  'failed_post_processing',
  'failed_model_error',
  'failed_safety_filter',
])

export async function processCharacterSheet(file, options, blackFile = null) {
  const source_base64 = await fileToBase64(file)
  const source_black_base64 = blackFile ? await fileToBase64(blackFile) : null
  const response = await fetch('/api/process-sheet', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ source_base64, source_black_base64, options }),
  })
  if (!response.ok) throw new Error(`process failed: ${response.status}`)
  return response.json()
}

export async function generateCharacterSheet(description, options) {
  const reference_image_base64 = options.referenceFile ? await fileToBase64(options.referenceFile) : null
  const palette_image_base64 = options.paletteFile ? await fileToBase64(options.paletteFile) : null
  const aspectRatio = options.aspectRatio ||
    (options.t2iMode === 'quality_character_v0' && options.characterPreset === 'two_to_one_character_v0' ? '2:1' : '1:1')
  const pixelFinishing = options.pixelFinishing
    ? {
        maxColors: options.pixelFinishingMaxColors,
        outline: options.pixelFinishingOutline !== false,
        outlineMode: options.pixelFinishingOutlineMode,
      }
    : {}
  const response = await fetch('/api/generate-character', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      description,
      name: options.name,
      t2iMode: options.t2iMode,
      characterPreset: options.characterPreset,
      preset: options.generationLayout || DEFAULT_GENERATION_PRESET,
      providerPresetId: options.providerPresetId,
      maxProviderCalls: options.maxProviderCalls ?? options.candidateCount,
      imageConfig: {
        aspect_ratio: aspectRatio,
        image_size: options.imageSize,
      },
      pixelFinishing,
      generationOptions: {
        candidateCount: options.candidateCount,
        seed: options.seed,
        temperature: options.temperature,
        topP: options.topP,
        topK: options.topK,
      },
      promptFields: options.promptFields,
      reference_image_base64,
      reference_image_mime: options.referenceFile?.type,
      reference_image_name: options.referenceFile?.name,
      palette_image_base64,
      palette_image_mime: options.paletteFile?.type,
      palette_image_name: options.paletteFile?.name,
      options: {
        ...options,
        sourceLayout: options.generationLayout || DEFAULT_GENERATION_PRESET,
      },
    }),
  })
  if (!response.ok) throw new Error(`generate failed: ${response.status}`)
  return response.json()
}

export async function repairCharacterAction(options = {}) {
  const response = await fetch('/api/repair-character-action', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(options),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.reason || body.error || `repair failed: ${response.status}`)
  return body
}

export async function fetchBenchmarkGallery() {
  const response = await fetch('/api/benchmark-gallery')
  if (!response.ok) throw new Error(`benchmark gallery failed: ${response.status}`)
  return response.json()
}

async function pollJob(jobId) {
  const response = await fetch(`/api/jobs/${jobId}`)
  if (!response.ok) throw new Error(`job poll failed: ${response.status}`)
  return response.json()
}

export async function waitForJob(job, onUpdate = () => {}) {
  let current = job
  onUpdate(current)
  for (let i = 0; current.id && !TERMINAL_JOB_STATUSES.has(current.status) && i < 240; i++) {
    await new Promise((resolve) => setTimeout(resolve, 500))
    current = await pollJob(current.id)
    onUpdate(current)
  }
  return current
}
