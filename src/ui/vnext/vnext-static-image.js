import { generalAssetBackgroundClause } from '../../character-pack/generalAssetBackground.js'
import { plainFailureText } from './vnext-thread-turns.js'

export const STATIC_IMAGE_ROUTE = Object.freeze({
  endpoint: '/api/editor/projects/:id/image-generation',
  imageSize: '1K',
  aspectRatio: '1:1',
  candidateCount: 1,
  maxProviderCalls: 1,
  artifact: 'source',
  output: 'native_png_or_jpeg',
  characterRoute: false,
  generalImage: true,
  referenceUploaded: 'selected-canvas-when-supported',
  processSheet: false,
})

// What the conversation says when an image request fails: plain language, never a raw code or job ID.
const STATIC_IMAGE_FAILURES = Object.freeze({
  image_credits_blocked: 'This would use extra provider credits, which are not used here. Nothing was added.',
  image_busy: 'Another image is still being generated. Nothing new was sent.',
  image_unavailable: 'Image generation is unavailable for this model right now. Nothing was sent.',
  image_configuration_changed: 'The provider app changed and is not verified. Nothing was sent.',
  image_version_unverified: 'The provider app version is not verified. Nothing was sent.',
  image_reference_changed: 'The selected canvas changed before the request. Nothing was sent.',
  image_reference_unsupported: 'That canvas cannot be used as a reference. Nothing was sent.',
  image_reference_policy: 'Reference images are not enabled for this model. Nothing was sent.',
  image_unsafe_output: 'The provider refused this image. Nothing was added; no automatic retry.',
  image_tool_blocked: 'The provider blocked this image request. Nothing was added; no automatic retry.',
  image_cancelled: 'The image request was cancelled. Nothing was added.',
})
export function staticImageFailureCopy(value, fallback = 'The provider did not return a usable image. Nothing was added; no automatic retry.') {
  const text = String(value ?? '').trim()
  return Object.hasOwn(STATIC_IMAGE_FAILURES, text) ? STATIC_IMAGE_FAILURES[text] : plainFailureText(text, fallback)
}

export function selectStaticImagePreset(state, provider = 'antigravity') {
  const choice = Array.isArray(state?.providers) ? state.providers.find(item => item.provider === provider) : state
  const expected = { antigravity: 'native-generate-image', codex: 'gpt-image-2', grok: 'native-imagine' }
  if (choice?.available !== true || choice.provider !== provider || !Object.hasOwn(expected, choice.provider) || choice.model !== expected[choice.provider]
    || typeof choice.reference_upload !== 'boolean'
    || (choice.provider === 'antigravity' ? choice.extra_credits !== false : choice.extra_credits !== 'native_account_policy')) return null
  return { id: `${choice.provider}-native`, provider: choice.provider, model: choice.model, referenceUpload: choice.reference_upload }
}

export function staticImageRequest({ description, preset, reference = null, background = 'green' } = {}) {
  const text = String(description ?? '').trim()
  const bound = preset?.id && preset.provider && preset.model ? preset : null
  if (!text) {
    const error = new Error('Describe the image before generating.')
    error.code = 'static_image_empty'
    throw error
  }
  if (!bound?.id || !bound.provider || !bound.model) {
    const error = new Error('Image generation is unavailable for the selected provider. Nothing was sent.')
    error.code = 'static_image_unavailable'
    throw error
  }
  const clause = generalAssetBackgroundClause(background)
  const combined = `${text}\n${clause}`
  if (combined.length > 4000) {
    const error = new Error('The image description and background color are too long. Nothing was sent.')
    error.code = 'static_image_empty'
    throw error
  }
  return Object.freeze({
    description: combined,
    operation_id: globalThis.crypto.randomUUID(),
    provider: bound.provider,
    ...(reference ? { reference: Object.freeze({ ...reference }) } : {}),
  })
}

export function staticImagePosition(view, anchor = null, size = null) {
  const gap = 16
  const width = size?.width || anchor?.width || 64
  const height = size?.height || anchor?.height || 64
  const origin = anchor?.id ? view.positionOf(anchor.id) : { x: 0, y: 0 }
  let x = origin.x + (anchor?.id ? (anchor.width || width) + gap : 0)
  const y = origin.y
  const others = (view.canvases || []).filter((canvas) => canvas.id !== anchor?.id
    && canvas.id !== size?.canvasId && !canvas.transient)
  for (let step = 0; step <= others.length; step += 1) {
    const hit = others.find((canvas) => {
      const point = view.positionOf(canvas.id)
      return x < point.x + canvas.width + gap && x + width + gap > point.x
        && y < point.y + canvas.height && y + height > point.y
    })
    if (!hit && Number.isSafeInteger(x) && Number.isSafeInteger(y)) return { x, y }
    if (!hit) break
    x = view.positionOf(hit.id).x + hit.width + gap
  }
  const error = new Error('No free position for the new image. Nothing was added.')
  error.code = 'static_image_position'
  throw error
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export async function pollStaticImageJob({
  start,
  getJob,
  request,
  isCurrent,
  sleep = () => delay(500),
  maxAttempts = 240,
  jobId = null,
} = {}) {
  if (!isCurrent()) {
    const error = new Error('The project changed. Nothing was sent.')
    error.code = 'static_image_stale'
    throw error
  }
  if (!jobId) {
    try {
      const started = await start(request)
      jobId = started?.id || started?.job_id || null
      if (!jobId && request?.operation_id) jobId = request.operation_id
      if (!jobId) {
        const error = new Error('The image request result is unknown. It was not sent again.')
        error.code = 'static_image_unknown'
        throw error
      }
    } catch (error) {
      if (!jobId) {
        if ([400, 403, 404, 409, 413, 415, 422].includes(error.status)) {
          error.code = 'static_image_failed'
          throw error
        }
        if (request?.operation_id) {
          const pending = new Error('The submission reply was interrupted. Continue checks the same request without sending it again.')
          pending.code = 'static_image_query'
          pending.jobId = request.operation_id
          throw pending
        }
        const wrapped = new Error(error.message || 'The image request result is unknown. It was not sent again.')
        wrapped.code = 'static_image_unknown'
        throw wrapped
      }
    }
  }
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (!isCurrent()) {
      const error = new Error('Waiting stopped. The same job was not submitted again.')
      error.code = 'static_image_pending'
      error.jobId = jobId
      throw error
    }
    let job
    try {
      job = await getJob(jobId)
    } catch (error) {
      const wrapped = new Error(error.message || 'The same job could not be read. It was not submitted again.')
      wrapped.code = 'static_image_query'
      wrapped.jobId = jobId
      throw wrapped
    }
    if (job?.id && job.id !== jobId) {
      const error = new Error('A different job came back. Nothing was added.')
      error.code = 'static_image_stale'
      error.jobId = jobId
      throw error
    }
    if (job?.status === 'unknown') {
      const error = new Error('The image result is unknown after restart. No new request was sent.')
      error.code = 'static_image_failed'
      throw error
    }
    if (job?.status === 'done' && job.source_url) return { jobId, job }
    if (String(job?.status || '').startsWith('failed')) {
      const error = new Error(staticImageFailureCopy(job.reason))
      error.code = 'static_image_failed'
      error.reason = job.reason || null
      error.jobId = jobId
      throw error
    }
    await sleep()
  }
  const error = new Error('Still waiting for the same job. It was not submitted again.')
  error.code = 'static_image_pending'
  error.jobId = jobId
  throw error
}
