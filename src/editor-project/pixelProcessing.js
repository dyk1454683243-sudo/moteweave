import { Worker } from 'node:worker_threads'
import { assertPixelStructure } from './pixelStructure.js'
import { documentHash, preserveProtected } from './documentToolSession.js'

// Local processing has its own bounded envelope; the AI tool budget is unchanged.
export const PIXEL_PROCESSING_BYTES = 32 * 1024 * 1024
export function validatePixelProcessing(manifest, operation, layerId) {
  assertPixelStructure(manifest)
  const { w, h } = manifest.canvas
  if (w > 2048 || h > 2048 || w * h * 4 * manifest.frame_order.length * manifest.layer_order.length > PIXEL_PROCESSING_BYTES) throw Object.assign(new Error('Local processing limit'), { code: 'resource_limit' })
  if (!['recover-grid', 'remove-background'].includes(operation) || !manifest.layer_order.includes(layerId)) throw Object.assign(new Error('Invalid operation'), { code: 'invalid_assistant_message' })
  if (manifest.text_objects?.items?.length || manifest.layers[layerId].locked || (operation === 'recover-grid' && (manifest.layer_order.length !== 1 || manifest.tags?.length || manifest.anchors?.length))) throw Object.assign(new Error('Unsupported document'), { code: 'unsupported_input' })
}

export function validatePixelCandidate(source, candidate) {
  preserveProtected(source, candidate.document, m => { if (m.canvas.w > 2048 || m.canvas.h > 2048 || m.canvas.w * m.canvas.h * 4 * m.frame_order.length * m.layer_order.length > PIXEL_PROCESSING_BYTES) throw Object.assign(new Error('Local processing limit'), { code: 'resource_limit' }) })
  let total = 0
  for (const bytes of candidate.blocks.values()) total += bytes.length
  if (total > PIXEL_PROCESSING_BYTES) throw Object.assign(new Error('Local processing limit'), { code: 'resource_limit' })
  for (const cel of Object.values(candidate.document.cels)) if (cel.block) {
    const bytes = candidate.blocks.get(cel.block.sha256)
    if (!bytes || bytes.length !== candidate.document.canvas.w * candidate.document.canvas.h * 4 || documentHash(bytes) !== cel.block.sha256) throw Object.assign(new Error('Invalid candidate pixels'), { code: 'artifact_integrity_failed' })
  }
}

// One worker at a time, including its termination. CPU-bound work never blocks
// request cancellation; the server's resource supervisor bounds the process tree.
let active = false
export async function runPixelProcessing(input, signal) {
  if (active) throw Object.assign(new Error('Processing busy'), { code: 'assistant_busy' })
  if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { code: 'assistant_cancelled' })
  active = true
  let worker, timer, abort
  try {
    worker = new Worker(new URL('./pixelProcessingWorker.js', import.meta.url), { workerData: input, resourceLimits: { maxOldGenerationSizeMb: 256 } })
    return await new Promise((resolve, reject) => {
      const fail = code => reject(Object.assign(new Error(code), { code }))
      abort = () => fail('assistant_cancelled')
      signal?.addEventListener('abort', abort, { once: true })
      timer = setTimeout(() => fail('pixel_processing_timeout'), 60_000)
      worker.once('message', value => value.error ? fail(value.error) : resolve(value))
      worker.once('error', () => fail('pixel_processing_failed'))
      worker.once('exit', code => { if (code !== 0) fail('pixel_processing_failed') })
      if (signal?.aborted) abort()
    })
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', abort)
    if (worker) await worker.terminate()
    active = false
  }
}
