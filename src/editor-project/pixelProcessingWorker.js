import { parentPort, workerData } from 'node:worker_threads'
import { recoverPixelGrid } from '../character-pack/pixelGridSampling.js'
import { documentHash } from './documentToolSession.js'
import { validatePixelProcessing, validatePixelCandidate } from './pixelProcessing.js'
import { runFullMethodAandFixedSolve, evaluateSharedScaleCandidateA, evaluatePhaseUnwrappingCandidateB, runBackgroundRemovalOnImage } from './pixelProcessingAlgorithms.js'

export function processPixels({ manifest, blocks, operation, layerId }) {
  validatePixelProcessing(manifest, operation, layerId)
  const cells = manifest.frame_order.map(f => Object.values(manifest.cels).find(c => c.frame_id === f && c.layer_id === layerId))
  const inputs = cells.map((c, i) => ({ frame_id: manifest.frame_order[i], image: { width: manifest.canvas.w, height: manifest.canvas.h,
    data: new Uint8ClampedArray(c?.block ? blocks.get(c.block.sha256) : manifest.canvas.w * manifest.canvas.h * 4) } }))
  let images, diagnostic
  if (operation === 'recover-grid') {
    if (inputs.length === 1) {
      const result = recoverPixelGrid(inputs[0].image)
      diagnostic = { verdict: result.report.status === 'resampled' ? 'accepted' : 'undetermined', reason: result.report.reason }
      if (diagnostic.verdict !== 'accepted') return { processing: { operation, ...diagnostic }, available: false }
      images = [result.image]
    } else {
      const { methodA, methodBRows, sharedPeriod } = runFullMethodAandFixedSolve(inputs)
      const gate = evaluateSharedScaleCandidateA(inputs.map(f => ({ width: f.image.width, height: f.image.height })), methodA, methodBRows, sharedPeriod)
      diagnostic = { ...gate.strict_gate, shared_period: sharedPeriod }
      if (diagnostic.verdict !== 'accepted') return { processing: { operation, ...diagnostic }, available: false }
      const phase = evaluatePhaseUnwrappingCandidateB(inputs, sharedPeriod, methodBRows.map(f => ({ x: f.solved_axes.x.phase, y: f.solved_axes.y.phase })))
      images = phase.frames.map(f => f._newPlacedImg)
      diagnostic.motion_verified = false
    }
  } else {
    let omitted = 0, blankFrames = 0
    images = inputs.map(f => {
      const result = runBackgroundRemovalOnImage(f.image, { allowSubRect: true })
      const chosen = result.sub_rect_adapted?.applicable ? result.sub_rect_adapted : result.raw_full_canvas
      omitted += chosen.omitted_count || 0
      if (!chosen._image.data.some((v, i) => i % 4 === 3 && v)) blankFrames++
      return chosen._image
    })
    diagnostic = { verdict: omitted ? 'accepted' : 'undetermined', reason: omitted ? 'background_preview' : 'no_background_detected', removed_pixels: omitted, blank_frames: blankFrames }
    if (!omitted) return { processing: { operation, ...diagnostic }, available: false }
  }
  const document = structuredClone(manifest), nextBlocks = new Map(blocks)
  document.canvas = { ...document.canvas, w: images[0].width, h: images[0].height }
  document.derived_from ||= { document_id: manifest.document_id, revision: manifest.revision, manifest_sha256: documentHash(manifest) }
  for (let i = 0; i < cells.length; i++) {
    const bytes = new Uint8Array(images[i].data), sha256 = documentHash(bytes)
    if (!cells[i]) throw Object.assign(new Error('Missing cel'), { code: 'unsupported_input' })
    document.cels[cells[i].id].block = { sha256, w: images[i].width, h: images[i].height }
    nextBlocks.set(sha256, bytes)
  }
  const used = new Set(Object.values(document.cels).filter(c => c.block).map(c => c.block.sha256))
  for (const key of nextBlocks.keys()) if (!used.has(key)) nextBlocks.delete(key)
  const candidate = { document, blocks: nextBlocks }
  validatePixelCandidate(manifest, candidate)
  return { candidate, processing: { operation, ...diagnostic }, available: true }
}
if (parentPort) {
  try { parentPort.postMessage(processPixels(workerData)) }
  catch (error) { parentPort.postMessage({ error: error.code || 'pixel_processing_failed' }) }
}
