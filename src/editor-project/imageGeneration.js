import { createHash } from 'node:crypto'
import path from 'node:path'
import { createRuntimeRecords } from './runtimeRecords.js'
import { loadEditorProject } from './projectStore.js'
import { isPixelEditorProject } from './spriteDocumentValidation.js'
import { encodeRgbaPng, getSpriteDocument, readSpriteBlock } from './spriteDocumentStore.js'
import { imageCliInstalled, IMAGE_ID, IMAGE_MAX_BYTES, IMAGE_MODEL, imageFailure, runAntigravityImage } from './imageAntigravity.js'
import { codexImageInstalled, runCodexImage } from './imageCodex.js'
import { grokImageInstalled, runGrokImage } from './imageGrok.js'

const NATIVE_PROVIDERS = Object.freeze({
  antigravity: { model: 'native-generate-image', reasoning_model: IMAGE_MODEL, extra_credits: false,
    generate: runAntigravityImage, installed: imageCliInstalled },
  codex: { model: 'gpt-image-2', reasoning_model: 'gpt-6.1-sol', extra_credits: 'native_account_policy',
    reference_upload: true,
    generate: runCodexImage, installed: codexImageInstalled },
  grok: { model: 'native-imagine', reasoning_model: 'grok-4.7', extra_credits: 'native_account_policy',
    generate: runGrokImage, installed: grokImageInstalled },
})

// One native invocation at a time. Never evict an operation receipt and accidentally
// turn a repeated POST into another generation. Durable receipts survive cache eviction.
export function createImageGeneration({ generate = runAntigravityImage, installed = imageCliInstalled,
  load = loadEditorProject, readDocument = getSpriteDocument, readBlock = readSpriteBlock,
  maxJobs = 16, providers = {}, records = load === loadEditorProject ? createRuntimeRecords() : null } = {}) {
  const adapters = Object.fromEntries(Object.entries(NATIVE_PROVIDERS).map(([id, value]) =>
    [id, { ...value, ...(id === 'antigravity' ? { generate, installed } : {}), ...providers[id] }]))
  const jobs = new Map()
  let active = false
  const loadV1 = async scope => {
    const loaded = await load(scope)
    if (!isPixelEditorProject(loaded.project)) throw imageFailure('image_project_unsupported')
    return loaded.project
  }
  const referenceShape = ref => ref && !Array.isArray(ref)
    && Object.keys(ref).sort().join(',') === 'canvas_id,document_id,expected_revision,working_revision'
    && [ref.canvas_id, ref.document_id].every(id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(id))
    && [ref.expected_revision, ref.working_revision].every(n => Number.isSafeInteger(n) && n >= 1)
  const referenceImage = async (scope, ref) => {
    const matches = project => project.id === scope.projectId && project.revision === ref.expected_revision
      && Object.hasOwn(project.canvases || {}, ref.canvas_id)
      && project.canvases[ref.canvas_id].document_id === ref.document_id
      && project.sprite_documents?.[ref.document_id]?.working_revision === ref.working_revision
    if (!matches(await loadV1(scope))) throw imageFailure('image_reference_changed')
    const { manifest } = await readDocument({ ...scope, documentId: ref.document_id, revision: ref.working_revision })
    const cels = Object.values(manifest.cels || {})
    const cel = cels[0], w = manifest.canvas?.w, h = manifest.canvas?.h
    if (manifest.revision !== ref.working_revision) throw imageFailure('image_reference_changed')
    if (manifest.frame_order?.length !== 1 || manifest.layer_order?.length !== 1 || cels.length !== 1
      || !Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w > 1024 || h > 1024
      || cel?.block?.w !== w || cel?.block?.h !== h) throw imageFailure('image_reference_unsupported')
    const block = await readBlock({ ...scope, documentId: ref.document_id, sha256: cel.block.sha256 })
    if (block.bytes.length !== w * h * 4 || !matches(await loadV1(scope))) throw imageFailure('image_reference_changed')
    return { bytes: encodeRgbaPng(w, h, block.bytes), mimeType: 'image/png' }
  }
  const scopeKey = scope => `${path.resolve(scope.workspaceRoot)}\0${scope.projectId}`
  const key = (scope, id) => `${scopeKey(scope)}\0${id}`
  const dto = job => ({ id: job.id, status: job.status, reason: job.reason,
    provider: job.provider, model: job.model, reasoning_model: job.reasoning_model,
    ...(job.status === 'done' ? { source_url: `/api/editor/projects/${encodeURIComponent(job.projectId)}/image-generation/${job.id}/source`,
      mime_type: job.image.mimeType, sha256: job.sha256, width: job.image.width, height: job.image.height,
      ...(job.image.original ? { fitted: true, original: { width: job.image.original.width, height: job.image.original.height,
        mime_type: job.image.original.mimeType, sha256: job.image.original.sha256 } } : {}) } : {}) })
  const cache = (scope, job) => {
    jobs.set(key(scope, job.id), job)
    if (records) for (const [cacheKey, value] of jobs) {
      if (jobs.size <= maxJobs) break
      if (value.status !== 'running' && value !== job) jobs.delete(cacheKey)
    }
    return job
  }
  const save = async (scope, job) => {
    if (!records) return
    const { completion, image, ...metadata } = job
    const { bytes, original, ...imageInfo } = image || {}
    const { bytes: originalBytes, ...originalInfo } = original || {}
    await records.put(scope, 'images', job.id, { ...metadata, version: 1,
      ...(image ? { image: { ...imageInfo, ...(original ? { original: originalInfo } : {}) } } : {}) })
  }
  const get = async (scope, id, optional = false) => {
    if (!IMAGE_ID.test(id)) throw imageFailure('image_not_found')
    let job = jobs.get(key(scope, id))
    if (!job && records) {
      job = await records.get(scope, 'images', id)
      if (job && (job.id !== id || job.projectId !== scope.projectId || job.version !== 1 || !Object.hasOwn(adapters, job.provider))) throw imageFailure('image_storage_failed')
      if (job?.status === 'running') {
        job.status = 'unknown'; job.reason = 'image_result_unknown'
        await save(scope, job)
      }
      if (job) cache(scope, job)
    }
    if (!job && !optional) throw imageFailure('image_not_found')
    return job
  }
  return {
    async list(scope) {
      const project = await loadV1(scope)
      const index = records ? await records.get(scope, 'images', 'recent') : null
      const ids = index?.ids || [...jobs.values()].filter(job => job.projectId === scope.projectId).map(job => job.id)
      const imported = new Set(Object.values(project.assets || {}).flatMap(asset => Object.values(asset.revisions || {}).map(revision => revision.source_job_id)))
      const result = []
      for (const id of ids.slice(-32).reverse()) {
        const job = await get(scope, id, true)
        if (job) result.push({ ...dto(job), imported: imported.has(id) })
      }
      return { jobs: result }
    },
    async capabilities(scope) {
      await loadV1(scope)
      const choices = await Promise.all(Object.entries(adapters).map(async ([provider, adapter]) => ({
        available: adapter.enabled !== false && await adapter.installed(), provider, model: adapter.model,
        ...(adapter.enabled === false ? { reason: adapter.reason } : {}),
        reasoning_model: adapter.reasoning_model, extra_credits: adapter.extra_credits, reference_upload: adapter.reference_upload === true,
      })))
      return { ...choices[0], providers: choices }
    },
    async start(scope, body) {
      if (!body || !['description,operation_id', 'description,operation_id,provider', 'description,operation_id,provider,reference'].includes(Object.keys(body).sort().join(','))
        || !IMAGE_ID.test(body.operation_id) || typeof body.description !== 'string'
        || !body.description.trim() || body.description.length > 4000
        || (Object.hasOwn(body, 'reference') && !referenceShape(body.reference))) throw imageFailure('invalid_image_request')
      const provider = body.provider === undefined ? 'antigravity' : body.provider
      if (typeof provider !== 'string' || !Object.hasOwn(adapters, provider)) throw imageFailure('invalid_image_request')
      if (adapters[provider].enabled === false) throw imageFailure(adapters[provider].reason || 'image_unavailable')
      if (body.reference && !adapters[provider].reference_upload) throw imageFailure('image_reference_unsupported')
      await loadV1(scope)
      const reference = body.reference ? { canvas_id: body.reference.canvas_id, document_id: body.reference.document_id,
        expected_revision: body.reference.expected_revision, working_revision: body.reference.working_revision } : null
      const description = body.description
      const fingerprint = createHash('sha256').update(JSON.stringify([provider, description, reference])).digest('hex')
      const existing = jobs.get(key(scope, body.operation_id))
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw imageFailure('image_operation_conflict')
        return dto(existing)
      }
      if (active) throw imageFailure('image_busy')
      active = true
      let job
      try {
        const stored = await get(scope, body.operation_id, true)
        if (stored) {
          if (stored.fingerprint !== fingerprint) throw imageFailure('image_operation_conflict')
          active = false
          return dto(stored)
        }
        if (!records && jobs.size >= maxJobs) throw imageFailure('image_session_full')
        job = { id: body.operation_id, projectId: scope.projectId, provider, fingerprint, status: 'running',
          model: adapters[provider].model, reasoning_model: adapters[provider].reasoning_model, created_at: new Date().toISOString() }
        cache(scope, job)
        await save(scope, job) // Durable before any provider call.
        if (records) {
          const index = await records.get(scope, 'images', 'recent')
          await records.put(scope, 'images', 'recent', { ids: [...(index?.ids || []), job.id].slice(-32) })
        }
      } catch (error) {
        if (job) {
          job.status = 'failed'; job.reason = 'image_storage_failed'
          try { await save(scope, job) } catch { /* Cache stays terminal; never call the provider. */ }
        }
        active = false; throw error
      }
      job.completion = Promise.resolve().then(async () => adapters[provider].generate({ description, operationId: job.id,
        ...(reference ? { reference: await referenceImage(scope, reference) } : {}) }))
        .then(async image => {
          if (!Buffer.isBuffer(image.bytes) || image.bytes.length > IMAGE_MAX_BYTES
            || !['image/png', 'image/jpeg'].includes(image.mimeType)) throw imageFailure('image_unsupported_output')
          job.image = image
          job.sha256 = createHash('sha256').update(image.bytes).digest('hex')
          if (records) {
            await records.putBytes(scope, job.id, image.bytes)
            if (image.original) await records.putBytes(scope, `${job.id}-original`, image.original.bytes)
          }
          await save(scope, { ...job, status: 'done' })
          job.status = 'done'
        }).catch(async error => {
          job.status = job.image ? 'unknown' : 'failed'
          job.reason = job.image ? 'image_storage_failed' : safeImageFailure(error).body.error
          try { await save(scope, job) } catch { job.status = 'unknown'; job.reason = 'image_storage_failed' }
        }).finally(() => { active = false })
      return dto(job)
    },
    async status(scope, id) { await load(scope); return dto(await get(scope, id)) },
    async source(scope, id) {
      await load(scope)
      const job = await get(scope, id)
      if (job.status !== 'done') throw imageFailure('image_not_ready')
      if (!job.image.bytes && records) {
        const bytes = await records.getBytes(scope, id)
        if (!bytes || createHash('sha256').update(bytes).digest('hex') !== job.sha256) throw imageFailure('image_storage_failed')
        let originalBytes
        if (job.image.original) {
          originalBytes = await records.getBytes(scope, `${id}-original`)
          if (!originalBytes || createHash('sha256').update(originalBytes).digest('hex') !== job.image.original.sha256) throw imageFailure('image_storage_failed')
        }
        job.image.bytes = bytes
        if (job.image.original) job.image.original.bytes = originalBytes
      }
      return { bytes: job.image.bytes, mimeType: job.image.mimeType,
        original: job.image.original, transformation: job.image.transformation,
        provenance: { jobId: job.id, provider: job.provider, model: job.model } }
    },
  }
}

const FAILURES = Object.freeze({
  image_storage_failed: 500, image_result_unknown: 409,
  invalid_image_request: 400, image_project_unsupported: 422, image_not_found: 404, image_busy: 409, image_not_ready: 409,
  image_operation_conflict: 409, image_session_full: 409, image_credits_blocked: 503,
  image_configuration_changed: 503, image_version_unverified: 503, image_unavailable: 503,
  image_native_failed: 502, image_native_protocol: 502, image_unsafe_output: 502,
  image_unsupported_output: 422, image_tool_blocked: 502, image_tool_limit: 502,
  image_output_limit: 502, image_cancelled: 409,
  image_reference_policy: 503,
  image_reference_changed: 409, image_reference_unsupported: 422,
})
export function safeImageFailure(error) {
  const code = Object.hasOwn(FAILURES, error?.code || '') ? error.code : 'image_native_failed'
  return { status: FAILURES[code], body: { error: code } }
}
export const imageGeneration = createImageGeneration()
